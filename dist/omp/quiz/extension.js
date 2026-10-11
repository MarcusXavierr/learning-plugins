// plugins/quiz/src/omp.ts
import {
  Editor,
  extractPrintableText,
  getEditorTheme,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
  wrapTextWithAnsi
} from "@oh-my-pi/pi-tui";

// plugins/quiz/src/core/reducer.ts
function initialQuizState(mode, optionCount) {
  return { mode, optionCount, cursor: 0, focus: "options", phase: "select", picked: [], dontKnow: false, note: "" };
}
function toggle(state) {
  if (state.cursor === state.optionCount) {
    return state.dontKnow ? { ...state, dontKnow: false } : { ...state, dontKnow: true, picked: [] };
  }
  const index = state.cursor + 1;
  const picked = state.picked.includes(index) ? state.picked.filter((i) => i !== index) : [...state.picked, index].sort((a, b) => a - b);
  return { ...state, dontKnow: false, picked };
}
function stepQuiz(state, event) {
  const stay = (next) => ({ state: next, effect: "none" });
  if (state.phase === "feedback") {
    return event.type === "enter" || event.type === "escape" ? { state, effect: "finish" } : stay(state);
  }
  if (event.type === "noteChanged") return stay({ ...state, note: event.text });
  if (event.type === "tab") return stay({ ...state, focus: state.focus === "options" ? "note" : "options" });
  if (state.focus === "note") {
    if (event.type === "enter" || event.type === "escape") return stay({ ...state, focus: "options" });
    return { state, effect: "editNote" };
  }
  if (event.type === "text") return { state: { ...state, focus: "note" }, effect: "editNote" };
  if (event.type === "escape") return { state, effect: "cancel" };
  const lastRow = state.mode === "multi-select" ? state.optionCount + 1 : state.optionCount;
  if (event.type === "up") return stay({ ...state, cursor: Math.max(0, state.cursor - 1) });
  if (event.type === "down") return stay({ ...state, cursor: Math.min(lastRow, state.cursor + 1) });
  if (state.mode === "single-select") {
    if (event.type !== "enter") return stay(state);
    return state.cursor === state.optionCount ? stay({ ...state, dontKnow: true, picked: [], phase: "feedback" }) : stay({ ...state, dontKnow: false, picked: [state.cursor + 1], phase: "feedback" });
  }
  const onSubmit = state.cursor === state.optionCount + 1;
  if (event.type === "space") return onSubmit ? stay(state) : stay(toggle(state));
  if (event.type === "enter") {
    if (!onSubmit) return stay(toggle(state));
    return state.dontKnow || state.picked.length > 0 ? stay({ ...state, phase: "feedback" }) : stay(state);
  }
  return stay(state);
}
function quizResponse(state, options) {
  const note = state.note.trim() || void 0;
  const answers = state.dontKnow ? [] : state.picked.flatMap((index) => {
    const option = options[index - 1];
    return option ? [{ label: option.label, value: option.value, index }] : [];
  });
  return { dontKnow: state.dontKnow, ...note ? { note } : {}, answers };
}

// shared/quiz-contract.ts
function normalizeOptions(raw) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const option of raw) {
    const label = option.label.trim();
    if (label.length === 0) continue;
    const value = option.value?.trim() || label;
    if (seen.has(value)) throw new Error(`duplicate option value "${value}"`);
    seen.add(value);
    const description = option.description?.trim();
    out.push(description ? { label, value, description } : { label, value });
  }
  return out;
}
var FNV_OFFSET_BASIS = 2166136261;
var FNV_PRIME = 16777619;
var MULBERRY_INCREMENT = 1831565813;
var UINT32_RANGE = 2 ** 32;
function fnv1a32(text) {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + MULBERRY_INCREMENT >>> 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / UINT32_RANGE;
  };
}
function displayOrder(input) {
  const { question, shuffle = true } = input;
  const options = normalizeOptions(input.options);
  if (!shuffle) return options;
  const random = mulberry32(fnv1a32([question, ...options.map((o) => o.value)].join("\0")));
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}
function displayedOptions(order) {
  return order.map((option, i) => ({ index: i + 1, label: option.label }));
}
function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var isIndex = (n) => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
var isString = (s) => typeof s === "string";
var optionalString = (s) => s === void 0 || typeof s === "string";
var optionalBoolean = (b) => b === void 0 || typeof b === "boolean";
var listOf = (item) => (list) => Array.isArray(list) && list.every(item);
var oneOf = (allowed) => (s) => typeof s === "string" && allowed.includes(s);
var isAnswer = (a) => isJsonObject(a) && isIndex(a.index) && isString(a.label) && isString(a.value);
var isDisplayed = (o) => isJsonObject(o) && isIndex(o.index) && isString(o.label);
var FIELD_CHECKS = {
  status: oneOf(["answered", "cancelled", "unavailable"]),
  question: isString,
  context: optionalString,
  mode: oneOf(["single-select", "multi-select"]),
  answers: listOf(isAnswer),
  correctIndices: listOf(isIndex),
  options: (o) => o === void 0 || listOf(isDisplayed)(o),
  correct: optionalBoolean,
  dontKnow: optionalBoolean,
  note: optionalString,
  explanation: optionalString,
  message: optionalString
};

// plugins/quiz/src/core/grade.ts
function gradeQuiz(quiz2, response) {
  const answers = response.dontKnow ? [] : [...response.answers].sort((a, b) => a.index - b.index);
  const picked = answers.map((a) => a.index);
  const correct = !response.dontKnow && picked.length === quiz2.correctIndices.length && picked.every((index, i) => index === quiz2.correctIndices[i]);
  const note = response.note?.trim() || void 0;
  return {
    status: "answered",
    question: quiz2.question,
    ...quiz2.context ? { context: quiz2.context } : {},
    mode: quiz2.mode,
    answers,
    correctIndices: quiz2.correctIndices,
    options: displayedOptions(quiz2.options),
    correct,
    dontKnow: response.dontKnow,
    ...note ? { note } : {},
    ...quiz2.explanation ? { explanation: quiz2.explanation } : {}
  };
}
function cancelledDetails(quiz2) {
  return {
    status: "cancelled",
    question: quiz2.question,
    ...quiz2.context ? { context: quiz2.context } : {},
    mode: quiz2.mode,
    answers: [],
    correctIndices: quiz2.correctIndices,
    message: "User cancelled the quiz"
  };
}
function unavailableDetails(quiz2, message) {
  return {
    status: "unavailable",
    question: quiz2.question,
    ...quiz2.context ? { context: quiz2.context } : {},
    mode: quiz2.mode,
    answers: [],
    correctIndices: quiz2.correctIndices,
    message
  };
}
function quizResultText(d) {
  if (d.status !== "answered") return d.message ?? `quiz ${d.status}`;
  const labelOf = (index) => d.options?.find((o) => o.index === index)?.label ?? "(unknown)";
  const correctStr = d.correctIndices.map((i) => `${i}. ${labelOf(i)}`).join(", ");
  let text = d.dontKnow ? `User selected "I don't know" — they did not attempt an answer (a genuine knowledge gap, not a wrong guess).
Correct: ${correctStr}` : `User answered ${d.correct ? "correctly" : "incorrectly"}.
Selected: ${d.answers.map((a) => `${a.index}. ${a.label}`).join(", ")}
Correct: ${correctStr}`;
  if (d.note) text += `
User's note: ${d.note}`;
  if (d.explanation) text += `
Explanation: ${d.explanation}`;
  return text;
}
function feedbackRows(d) {
  const picked = new Set(d.answers.map((a) => a.index));
  const key = new Set(d.correctIndices);
  const shown = d.options ?? d.answers.map((a) => ({ index: a.index, label: a.label }));
  return shown.map(({ index, label }) => {
    if (key.has(index)) return { index, label, mark: "✓", tone: "success" };
    if (picked.has(index)) return { index, label, mark: "✗", tone: "error" };
    return { index, label, mark: " ", tone: "dim" };
  });
}
function resultLines(d) {
  if (d.status !== "answered") return [{ text: d.message ?? `quiz ${d.status}`, tone: "warning" }];
  const lines = feedbackRows(d).map((r) => ({ text: `${r.mark} ${r.index}. ${r.label}`, tone: r.tone }));
  lines.push({ text: "", tone: "dim" });
  if (d.dontKnow) lines.push({ text: "I don't know", tone: "warning" });
  else if (d.correct) lines.push({ text: "Correct!", tone: "success" });
  else lines.push({ text: "Incorrect", tone: "error" });
  if (d.note) lines.push({ text: `Note: ${d.note}`, tone: "muted" });
  if (d.explanation) lines.push({ text: d.explanation, tone: "muted" });
  return lines;
}

// plugins/quiz/src/core/prepare.ts
var DONT_KNOW_LABEL = "I don't know";
var QuizInputError = class extends Error {
};
var MAX_CLAUDE_OPTIONS = 3;
var CLAUDE_LIMITS = { maxOptions: MAX_CLAUDE_OPTIONS, answersByLabel: true };
function parseQuizInput(raw) {
  if (typeof raw !== "object" || raw === null) throw new QuizInputError("quiz input must be an object");
  const { question, details, options, multiSelect, correctAnswer, explanation, shuffle } = raw;
  if (details !== void 0 && typeof details !== "string") throw new QuizInputError("quiz details must be a string");
  if (multiSelect !== void 0 && typeof multiSelect !== "boolean") throw new QuizInputError("quiz multiSelect must be a boolean");
  if (shuffle !== void 0 && typeof shuffle !== "boolean") throw new QuizInputError("quiz shuffle must be a boolean");
  if (typeof question !== "string" || question.trim() === "") {
    throw new QuizInputError("quiz question is required: one question per call");
  }
  if (!Array.isArray(options)) {
    throw new QuizInputError("quiz options must be an array of { label, value?, description? }");
  }
  const parsedOptions = options.map((option, i) => {
    const { label, value, description } = typeof option === "object" && option !== null ? option : {};
    if (typeof label !== "string") throw new QuizInputError(`quiz option ${i + 1} needs a string label`);
    if (value !== void 0 && typeof value !== "string") throw new QuizInputError(`quiz option ${i + 1} value must be a string`);
    if (description !== void 0 && typeof description !== "string") throw new QuizInputError(`quiz option ${i + 1} description must be a string`);
    return {
      label,
      ...typeof value === "string" ? { value } : {},
      ...typeof description === "string" ? { description } : {}
    };
  });
  if (!(typeof correctAnswer === "string" || Array.isArray(correctAnswer) && correctAnswer.every((v) => typeof v === "string"))) {
    throw new QuizInputError(
      "quiz correctAnswer is required: the option value, or an array of values for multi-select"
    );
  }
  if (typeof explanation !== "string" || explanation.trim() === "") {
    throw new QuizInputError("quiz explanation is required: say why the correct answer is correct");
  }
  return {
    question,
    ...typeof details === "string" ? { details } : {},
    options: parsedOptions,
    ...multiSelect ? { multiSelect: true } : {},
    correctAnswer,
    explanation,
    ...shuffle !== void 0 && !shuffle ? { shuffle: false } : {}
  };
}
function correctValues(correctAnswer) {
  if (Array.isArray(correctAnswer)) return correctAnswer.map((v) => v.trim());
  const trimmed = correctAnswer.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim());
    } catch {
      return [trimmed];
    }
  }
  return [trimmed];
}
function checkLimits(options, mode, limits) {
  if (limits.maxOptions !== void 0 && options.length > limits.maxOptions) {
    throw new QuizInputError(
      `quiz takes at most ${limits.maxOptions} options here (the dialog adds "${DONT_KNOW_LABEL}" as one more row); got ${options.length}`
    );
  }
  if (!limits.answersByLabel) return;
  const seen = /* @__PURE__ */ new Set();
  for (const { label } of options) {
    if (label === DONT_KNOW_LABEL) {
      throw new QuizInputError(`quiz option label "${DONT_KNOW_LABEL}" is reserved: that choice is added automatically`);
    }
    if (seen.has(label)) {
      throw new QuizInputError(`quiz option labels must be unique here, because the answer comes back as a label: "${label}" appears twice`);
    }
    seen.add(label);
    if (mode === "multi-select" && label.includes(",")) {
      throw new QuizInputError(
        `quiz multi-select option labels must not contain "," here, because the answer comes back comma-joined: "${label}"`
      );
    }
  }
}
function prepareQuiz(raw, limits = {}) {
  const input = parseQuizInput(raw);
  const mode = input.multiSelect ? "multi-select" : "single-select";
  let options;
  try {
    options = displayOrder(input);
  } catch (error) {
    throw new QuizInputError(`quiz ${error instanceof Error ? error.message : String(error)}`);
  }
  if (options.length < 2) throw new QuizInputError("quiz requires at least two options");
  checkLimits(options, mode, limits);
  const values = correctValues(input.correctAnswer);
  if (values.length === 0) throw new QuizInputError("quiz correctAnswer is required");
  const indices = /* @__PURE__ */ new Set();
  for (const value of values) {
    const position = options.findIndex((o) => o.value === value);
    if (position === -1) {
      const known = options.map((o) => `"${o.value}"`).join(", ");
      throw new QuizInputError(`quiz correctAnswer "${value}" does not match any option value (${known})`);
    }
    indices.add(position + 1);
  }
  const correctIndices = [...indices].sort((a, b) => a - b);
  if (mode === "single-select" && correctIndices.length > 1) {
    throw new QuizInputError(
      `quiz single-select needs exactly one correctAnswer; got ${correctIndices.length}. Set multiSelect: true when several options are correct.`
    );
  }
  const context = input.details?.trim() || void 0;
  return {
    question: input.question,
    ...context ? { context } : {},
    mode,
    options,
    correctIndices,
    explanation: input.explanation.trim()
  };
}

// shared/tool-map.ts
var TOOLS = {
  quiz: { omp: "quiz", claude: "mcp__quiz__quiz" },
  ask: { omp: "ask", claude: "AskUserQuestion" },
  read: { omp: "read", claude: "Read" },
  web_search: { omp: "web_search", claude: "WebSearch" },
  web_fetch: { omp: "read", claude: "WebFetch" },
  write_mermaid: { omp: "write_mermaid", claude: "mcp__visual-tools__write_mermaid" },
  edit_mermaid: { omp: "edit_mermaid", claude: "mcp__visual-tools__edit_mermaid" },
  render_mermaid: { omp: "render_mermaid", claude: "mcp__visual-tools__render_mermaid" },
  write_svg: { omp: "write_svg", claude: "mcp__visual-tools__write_svg" },
  edit_svg: { omp: "edit_svg", claude: "mcp__visual-tools__edit_svg" },
  render_svg: { omp: "render_svg", claude: "mcp__visual-tools__render_svg" }
};
function lookup(map, kind, id, h) {
  const entry = Object.hasOwn(map, id) ? map[id] : void 0;
  if (entry === void 0) throw new Error(`unknown ${kind} id "${id}"`);
  return entry[h];
}
function toolName(id, h) {
  return lookup(TOOLS, "tool", id, h);
}

// plugins/quiz/src/core/schema.ts
function quizDescription(harness) {
  const ask = toolName("ask", harness);
  const note = harness === "omp" ? "An always-present optional note field (Tab to focus it) lets the user attach a free-text note to ANY answer; it reaches you only when non-empty." : `If the user types their own words under "Other" instead of choosing, the result is "${DONT_KNOW_LABEL}" with their words as the note; a note reaches you only when non-empty.`;
  const guidelines = [
    `quiz is GRADED; ${ask} is not. If the question has a correct answer, use quiz. If you just need a preference, decision, or open-ended input, use ${ask}.`,
    'correctAnswer is REQUIRED and is the option value, not a position number. Single-select: one string (e.g. "mercury"). Multi-select: an array of strings (e.g. ["belize", "niue"]).',
    "Always pass the option's `value` string as correctAnswer — it is self-checking and prevents miscounting positions. A value that matches no option is a hard error.",
    "explanation is REQUIRED — always say why the correct answer is correct.",
    "Multi-select is graded as an exact-set match: the user is correct only if they select every correct option and no incorrect ones.",
    `There is no free-text mode. An '${DONT_KNOW_LABEL}' choice is ALWAYS added automatically — provide ONLY the real, gradable options (at least two). Never add your own uncertainty/opt-out option like 'I don't know', 'I'm not sure', or 'Not sure'; that is handled for you and a manual one would be redundant or gradable-as-wrong.`,
    "If a result comes back as dontKnow, the user honestly did not know and did NOT guess — treat it as a genuine knowledge gap to teach into, not as a wrong answer.",
    "Any answer (right, wrong, or 'I don't know') may carry an optional free-text `note`. When present it reflects what they were thinking or unsure about — read it and let it steer your follow-up. It is omitted entirely when empty.",
    "Treat each wrong answer (distractor) as a diagnostic probe, not just filler: make it a specific, believable mistake the user might actually hold — a common misconception, or an adjacent/easily-confused concept — so that WHICH wrong answer they pick reveals WHICH nuance of their understanding is off.",
    "Guardrail: every distractor must be unambiguously wrong on the intended reading — tempting, but a real error, not a defensible alternative. Don't drift into trick questions.",
    "Anti-guessing hygiene: don't let the correct answer stand out by form (longest, most precise, most hedged, or the only one in the right format). Keep options similar in length, specificity, and phrasing so it can't be picked from shape alone.",
    "Set multiSelect: true only when more than one option is correct.",
    "Options are shuffled before display by default, so don't worry about which position you list the correct answer in. Set shuffle: false only when option order is meaningful (ordered values, or an 'All/None of the above' option that must stay last).",
    "To probe nuance, ask several quick quiz questions and adapt each one based on the previous answers, rather than writing one giant question.",
    "Don't leak the answer through formatting: keep option phrasing/length even and don't hint which is correct."
  ];
  const limits = harness === "claude" ? `

Limits in this harness: at most ${CLAUDE_LIMITS.maxOptions} options (the dialog shows at most four rows, one of them "${DONT_KNOW_LABEL}"). Option labels must be unique and must not be "${DONT_KNOW_LABEL}"; in multi-select they must not contain a comma, because the answer comes back comma-joined. Option descriptions are not shown, so put everything the user needs in the label.` : "";
  return `Ask the user a GRADED question with a known correct answer, then instantly grade and give feedback. Unlike ${ask} (which collects preferences/decisions with no right answer), quiz always has a correct answer supplied by you, marks the user's selection right/wrong (✓/✗), reveals the correct answer, and can show an explanation. Use it to (1) assess what the learner already understands before teaching, and (2) run tight practice/retrieval loops after explaining, or probe understanding whenever you're unsure they've got it. Options-only: single-select or multi-select, plus an automatic '${DONT_KNOW_LABEL}' choice so the user can signal a genuine gap instead of guessing. ${note} No free-text answers — for non-graded questions use ${ask} instead.

Guidelines:
${guidelines.map((g) => `- ${g}`).join("\n")}` + limits;
}
function quizInputSchema(harness) {
  const max = harness === "claude" ? CLAUDE_LIMITS.maxOptions : void 0;
  return {
    type: "object",
    properties: {
      question: { type: "string", description: "The single quiz question to ask. Ask exactly one question per tool call." },
      details: { type: "string", description: "Optional extra context or instructions shown under the question." },
      options: {
        type: "array",
        minItems: 2,
        ...max ? { maxItems: max } : {},
        description: `The answer options (2${max ? `-${max}` : " or more"}). Options only — there is no free-text mode. Give each option a stable \`value\`; you reference the correct one by that value in correctAnswer.`,
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Display label for the answer option." },
            value: { type: "string", description: "Optional machine-readable value returned for the option. Defaults to the label." },
            description: { type: "string", description: "Optional extra detail shown below the option." }
          },
          required: ["label"]
        }
      },
      multiSelect: {
        type: "boolean",
        description: "Set to true when more than one option is correct and the user must select all of them."
      },
      correctAnswer: {
        anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        description: 'REQUIRED. The correct answer as the option value(s) — the `value` field of the option you intend. Single-select: a single string (e.g. "mercury"). Multi-select: an array of strings (e.g. ["belize", "niue"]); the user is only correct if their selection matches this set exactly. Always pass the value, not a position number — this is self-checking and prevents miscounting.'
      },
      explanation: {
        type: "string",
        description: "REQUIRED. Explanation revealed AFTER the user answers (shown whether they got it right or wrong). Use it to reinforce why the correct answer is correct."
      },
      shuffle: {
        type: "boolean",
        description: "Defaults to true: options are reordered before display so the correct answer isn't always in the same position. Set to false only when option order is meaningful (e.g. ordered numeric values, or an 'All/None of the above' option that must stay last)."
      }
    },
    required: ["question", "options", "correctAnswer", "explanation"]
  };
}

// plugins/quiz/src/omp/tool.ts
var queue = Promise.resolve();
async function serialized(run, signal, onAbort) {
  const previous = queue;
  const slot = Promise.withResolvers();
  queue = previous.then(() => slot.promise);
  const aborted = Promise.withResolvers();
  signal?.addEventListener("abort", aborted.resolve, { once: true });
  try {
    if (signal?.aborted) return onAbort();
    await Promise.race([previous, aborted.promise]);
    if (signal?.aborted) return onAbort();
    return await run();
  } finally {
    signal?.removeEventListener("abort", aborted.resolve);
    slot.resolve();
  }
}
function answer(details) {
  return { content: [{ type: "text", text: quizResultText(details) }], details };
}
function registerQuiz(pi, ui) {
  pi.registerTool({
    name: "quiz",
    label: "quiz",
    // Extension tools default to "discoverable" (xd:// devices); prompts call quiz by name.
    loadMode: "essential",
    description: quizDescription("omp"),
    parameters: quizInputSchema("omp"),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      let quiz2;
      try {
        quiz2 = prepareQuiz(params);
      } catch (error) {
        if (!(error instanceof QuizInputError)) throw error;
        return { content: [{ type: "text", text: error.message }], isError: true };
      }
      if (!ctx.hasUI || ctx.mode !== "tui") return answer(unavailableDetails(quiz2, "quiz requires interactive mode UI"));
      return serialized(async () => {
        if (signal?.aborted) return answer(cancelledDetails(quiz2));
        let response;
        try {
          response = await ui.ask(ctx, quiz2, signal);
        } catch (error) {
          if (signal?.aborted) return answer(cancelledDetails(quiz2));
          throw error;
        }
        return answer(response ? gradeQuiz(quiz2, response) : cancelledDetails(quiz2));
      }, signal, () => answer(cancelledDetails(quiz2)));
    },
    // Never shows options, correctAnswer, or explanation: the call row is drawn before the user answers.
    renderCall(args, _options, theme) {
      const { question, multiSelect, options } = typeof args === "object" && args !== null ? args : {};
      let text = theme.fg("toolTitle", theme.bold("quiz ")) + theme.fg("muted", typeof question === "string" ? question : "");
      if (typeof multiSelect === "boolean" && multiSelect) text += theme.fg("dim", " [multi-select]");
      if (Array.isArray(options) && options.length > 0) text += theme.fg("dim", ` (${options.length} options)`);
      return ui.text(text);
    },
    renderResult(result, _options, theme) {
      const details = result.details;
      if (!details) {
        const first = result.content[0];
        return ui.text(first?.type === "text" ? first.text : "");
      }
      return ui.text(resultLines(details).map((line) => theme.fg(line.tone, line.text)).join("\n"));
    }
  });
}

// plugins/quiz/src/omp/tui.ts
var NOTE_HINT = " Type note • Ctrl+J newline • Enter back to options • Tab options • Esc back";
function renderQuiz(view, theme, kit2, width) {
  const { quiz: quiz2, state } = view;
  const lines = [];
  const add = (text) => lines.push(kit2.truncateToWidth(text, width));
  const addWrapped = (text, indent) => {
    for (const line of kit2.wrapTextWithAnsi(text, Math.max(1, width - indent.length))) add(`${indent}${line}`);
  };
  const rule = theme.fg("accent", "─".repeat(width));
  add(rule);
  addWrapped(theme.fg("text", quiz2.question), " ");
  if (quiz2.context) {
    lines.push("");
    addWrapped(theme.fg("muted", quiz2.context), " ");
  }
  if (state.phase === "feedback") {
    const d = gradeQuiz(quiz2, quizResponse(state, quiz2.options));
    lines.push("");
    for (const row of feedbackRows(d)) add(theme.fg(row.tone, ` ${row.mark} ${row.index}. ${row.label}`));
    lines.push("");
    const correctStr = d.correctIndices.map((i) => `${i}. ${quiz2.options[i - 1]?.label ?? "(unknown)"}`).join(", ");
    if (d.dontKnow) {
      add(theme.fg("warning", ` · You said: ${DONT_KNOW_LABEL}`));
      addWrapped(theme.fg("muted", `Correct answer: ${correctStr}`), " ");
    } else if (d.correct) {
      add(theme.fg("success", " ✓ Correct!"));
    } else {
      add(theme.fg("error", " ✗ Incorrect."));
      addWrapped(theme.fg("muted", `Correct answer: ${correctStr}`), " ");
    }
    if (d.note) addWrapped(theme.fg("muted", `Your note: ${d.note}`), " ");
    if (d.explanation) {
      lines.push("");
      addWrapped(theme.fg("text", d.explanation), " ");
    }
    lines.push("");
    add(theme.fg("dim", " Enter/Esc to continue"));
    add(rule);
    return lines;
  }
  const multi = state.mode === "multi-select";
  const focused = (row) => state.focus === "options" && state.cursor === row;
  const prefix = (row) => focused(row) ? theme.fg("accent", "> ") : "  ";
  lines.push("");
  quiz2.options.forEach((option, i) => {
    const checked = state.picked.includes(i + 1);
    const label = `${multi ? checked ? "[x] " : "[ ] " : ""}${i + 1}. ${option.label}`;
    add(`${prefix(i)}${theme.fg(focused(i) ? "accent" : checked ? "success" : "text", label)}`);
    if (option.description) addWrapped(theme.fg("muted", option.description), "     ");
  });
  const dk = state.optionCount;
  lines.push("");
  const dkLabel = multi ? `${state.dontKnow ? "[x]" : "[ ]"} ${DONT_KNOW_LABEL}` : DONT_KNOW_LABEL;
  add(`${prefix(dk)}${theme.fg(focused(dk) ? "accent" : state.dontKnow ? "warning" : "dim", dkLabel)}`);
  const count = state.picked.length + (state.dontKnow ? 1 : 0);
  if (multi) {
    const submit = count > 0 ? `✓ Submit (${count} selected)` : "○ Submit";
    add(`${prefix(dk + 1)}${theme.fg(focused(dk + 1) ? "accent" : count > 0 ? "success" : "dim", submit)}`);
  }
  lines.push("");
  addWrapped(theme.fg(state.focus === "note" ? "accent" : "muted", "Note (optional):"), " ");
  lines.push(...view.noteLines);
  lines.push("");
  if (multi && count === 0) add(theme.fg("warning", " Select at least one answer before submitting."));
  if (state.focus === "note") add(theme.fg("dim", NOTE_HINT));
  else if (multi) add(theme.fg("dim", " ↑↓ navigate • Space toggle • Enter submit • type or Tab for note • Esc cancel"));
  else add(theme.fg("dim", " ↑↓ navigate • Enter answer • type or Tab for note • Esc cancel"));
  add(rule);
  return lines;
}

// plugins/quiz/src/omp.ts
var kit = { truncateToWidth, wrapTextWithAnsi };
function toEvent(data) {
  if (matchesKey(data, Key.up)) return { type: "up" };
  if (matchesKey(data, Key.down)) return { type: "down" };
  if (data === "\n" || matchesKey(data, Key.ctrl("j"))) return { type: "other" };
  if (matchesKey(data, Key.enter)) return { type: "enter" };
  if (matchesKey(data, Key.space)) return { type: "space" };
  if (matchesKey(data, Key.tab)) return { type: "tab" };
  if (matchesKey(data, Key.escape)) return { type: "escape" };
  return extractPrintableText(data) !== void 0 ? { type: "text" } : { type: "other" };
}
function askInTui(ctx, quiz2, signal) {
  return ctx.ui.custom(
    (tui, theme, _keybindings, done) => {
      let state = initialQuizState(quiz2.mode, quiz2.options.length);
      const editor = new Editor({ ...getEditorTheme(), borderColor: (s) => theme.fg("accent", s) });
      editor.disableSubmit = true;
      editor.focused = false;
      let cache;
      return {
        render(width) {
          if (cache?.width === width) return cache.lines;
          const lines = renderQuiz({ quiz: quiz2, state, noteLines: editor.render(width) }, theme, kit, width);
          if (state.focus !== "note") cache = { width, lines };
          return lines;
        },
        invalidate() {
          cache = void 0;
          editor.invalidate();
        },
        handleInput(data) {
          const step = stepQuiz(state, toEvent(data));
          state = step.state;
          editor.focused = state.focus === "note";
          if (step.effect === "cancel") return done(null);
          if (step.effect === "finish") return done(quizResponse(state, quiz2.options));
          if (step.effect === "editNote") {
            editor.handleInput(data);
            state = stepQuiz(state, { type: "noteChanged", text: editor.getText() }).state;
          }
          cache = void 0;
          tui.requestRender();
        }
      };
    },
    { signal }
  );
}
function quiz(pi) {
  registerQuiz(pi, { ask: askInTui, text: (text) => new Text(text, 0, 0) });
}
export {
  quiz as default
};
