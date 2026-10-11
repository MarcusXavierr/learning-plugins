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
function isQuizResultDetails(value) {
  return isJsonObject(value) && Object.entries(FIELD_CHECKS).every(([field, check]) => check(value[field]));
}
var OPEN = "<quiz-result>";
var CLOSE = "</quiz-result>";
function encodeQuizResult(d) {
  return `${OPEN}${JSON.stringify(d).replace(/</g, "\\u003c")}${CLOSE}`;
}
function decodeQuizResult(text) {
  const start = text.indexOf(OPEN);
  if (start < 0) return void 0;
  const end = text.indexOf(CLOSE, start + OPEN.length);
  if (end < 0) return void 0;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start + OPEN.length, end));
  } catch {
    return void 0;
  }
  return isQuizResultDetails(parsed) ? parsed : void 0;
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

// plugins/quiz/src/core/dialog.ts
function dialogQuestion(quiz) {
  return quiz.context ? `${quiz.question}

${quiz.context}` : quiz.question;
}
function dialogLabels(quiz) {
  return [...quiz.options.map((option) => option.label), DONT_KNOW_LABEL];
}
function responseFromDialog(quiz, answer) {
  const parts = quiz.mode === "multi-select" ? answer.split(",").map((part) => part.trim()) : [answer.trim()];
  const answers = [];
  let dontKnow = false;
  for (const part of parts) {
    if (part === DONT_KNOW_LABEL) {
      dontKnow = true;
      continue;
    }
    const index = quiz.options.findIndex((option2) => option2.label === part) + 1;
    const option = quiz.options[index - 1];
    if (!option) {
      const note = answer.trim();
      return { dontKnow: true, ...note ? { note } : {}, answers: [] };
    }
    if (!answers.some((picked) => picked.index === index)) answers.push({ label: option.label, value: option.value, index });
  }
  return dontKnow ? { dontKnow: true, answers: [] } : { dontKnow: false, answers: answers.sort((a, b) => a.index - b.index) };
}

// plugins/quiz/src/core/grade.ts
function gradeQuiz(quiz, response) {
  const answers = response.dontKnow ? [] : [...response.answers].sort((a, b) => a.index - b.index);
  const picked = answers.map((a) => a.index);
  const correct = !response.dontKnow && picked.length === quiz.correctIndices.length && picked.every((index, i) => index === quiz.correctIndices[i]);
  const note = response.note?.trim() || void 0;
  return {
    status: "answered",
    question: quiz.question,
    ...quiz.context ? { context: quiz.context } : {},
    mode: quiz.mode,
    answers,
    correctIndices: quiz.correctIndices,
    options: displayedOptions(quiz.options),
    correct,
    dontKnow: response.dontKnow,
    ...note ? { note } : {},
    ...quiz.explanation ? { explanation: quiz.explanation } : {}
  };
}
function cancelledDetails(quiz) {
  return {
    status: "cancelled",
    question: quiz.question,
    ...quiz.context ? { context: quiz.context } : {},
    mode: quiz.mode,
    answers: [],
    correctIndices: quiz.correctIndices,
    message: "User cancelled the quiz"
  };
}
function unavailableDetails(quiz, message) {
  return {
    status: "unavailable",
    question: quiz.question,
    ...quiz.context ? { context: quiz.context } : {},
    mode: quiz.mode,
    answers: [],
    correctIndices: quiz.correctIndices,
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

// plugins/quiz/src/core/output.ts
function quizDetailsFromOutput(output) {
  if (typeof output === "string") return decodeQuizResult(output);
  if (!Array.isArray(output)) return void 0;
  const text = output.map(
    (block) => typeof block === "object" && block !== null && "text" in block && typeof block.text === "string" ? block.text : ""
  ).join("\n");
  return decodeQuizResult(text);
}

// shared/tool-map.ts
var TOOLS = {
  quiz: { omp: "quiz", claude: "mcp__quiz__quiz" },
  ask: { omp: "ask", claude: "AskUserQuestion" },
  read: { omp: "read", claude: "Read" },
  web_search: { omp: "web_search", claude: "WebSearch" },
  web_fetch: { omp: "read", claude: "WebFetch" }
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

// plugins/quiz/src/claude.ts
var INK = {
  success: { color: "green" },
  error: { color: "red" },
  warning: { color: "yellow" },
  muted: { dimColor: true },
  dim: { dimColor: true }
};
var interactive = false;
function withBlock(details) {
  return `${quizResultText(details)}

${encodeQuizResult(details)}`;
}
function register(on) {
  on("session.start", async ($, e, next) => {
    interactive = e.isInteractive;
    await $.tool.register({
      name: "quiz",
      description: quizDescription("claude"),
      inputSchema: quizInputSchema("claude"),
      isDeferred: false
    });
    return next(e);
  });
  on("tool.call", { tool: "mcp__quiz__quiz" }, async ($, e) => {
    let quiz;
    try {
      quiz = prepareQuiz(e, CLAUDE_LIMITS);
    } catch (error) {
      if (!(error instanceof QuizInputError)) throw error;
      return { deny: error.message };
    }
    if (!interactive) return { result: withBlock(unavailableDetails(quiz, "quiz requires an interactive Claude Code session")) };
    let answer;
    try {
      answer = await $.ui.ask(dialogQuestion(quiz), {
        options: dialogLabels(quiz),
        header: "Quiz",
        ...quiz.mode === "multi-select" ? { multiSelect: true } : {}
      });
    } catch {
      return { result: withBlock(cancelledDetails(quiz)) };
    }
    return { result: withBlock(gradeQuiz(quiz, responseFromDialog(quiz, answer))) };
  }).catch(($, e, next) => ({ deny: `quiz failed: ${next.error.message ?? next.error.kind}` }));
  on("ui.render", { component: "ToolResult" }, async ($, e, next) => {
    if (e.props.tool !== "mcp__quiz__quiz" || e.props.isErrored) return next(e);
    const details = quizDetailsFromOutput(e.props.output);
    if (!details) return next(e);
    const { Box, Text } = $.ui.resolve(e);
    return Box({
      flexDirection: "column",
      children: resultLines(details).map((line) => Text({ ...INK[line.tone], children: [line.text === "" ? " " : line.text] }))
    });
  });
}
export {
  register
};
