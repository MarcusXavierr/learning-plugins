// plugins/md-log/src/omp.ts
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

// plugins/md-log/src/core/format.ts
function callout(type, title, body) {
  const lines = [`> [!${type}] ${title}`];
  for (const line of body.flatMap((b) => b.split("\n"))) lines.push(line.length === 0 ? ">" : `> ${line}`);
  return lines.join("\n");
}
var VERDICTS = {
  dontKnow: ["question", "Quiz — I don't know"],
  correct: ["success", "Quiz — correct ✓"],
  incorrect: ["failure", "Quiz — incorrect ✗"]
};
function shownOption(d, index) {
  const label = d.options?.find((o) => o.index === index)?.label;
  return label ? `${index}. ${label}` : `${index}`;
}
function quizAnswer(d) {
  if (d.status === "cancelled") return callout("warning", "Quiz — cancelled", ["(user skipped)"]);
  if (d.status === "unavailable") return callout("warning", "Quiz — unavailable", [d.message ?? ""]);
  const chosen = d.answers.map((a) => `${a.index}. ${a.label}`);
  const body = [
    `Your answer: ${d.dontKnow ? "I don't know" : chosen.length > 0 ? chosen.join(", ") : "(none)"}`,
    `Correct answer: ${d.correctIndices.map((i) => shownOption(d, i)).join(", ")}`
  ];
  if (d.note) body.push("", `Note: ${d.note}`);
  if (d.explanation) body.push("", d.explanation);
  const [type, title] = VERDICTS[d.dontKnow ? "dontKnow" : d.correct ? "correct" : "incorrect"];
  return callout(type, title, body);
}
function askAnswer(o) {
  if (o.status === "cancelled") return callout("warning", "Question — cancelled", ["(user skipped)"]);
  if (o.status === "unavailable") return callout("warning", "Question — unavailable", [o.message]);
  const body = o.items.map((i) => i.kind === "option" ? `${i.index}. ${i.label}` : `Other: ${i.text}`);
  if (body.length === 0) body.push("(no answer)");
  if (o.note) body.push("", `Note: ${o.note}`);
  return callout("example", "Answer", body);
}
function formatEntry(e) {
  switch (e.kind) {
    case "user":
      return `> [!quote] YOU

${e.text}`;
    case "assistant":
      return `> [!abstract] AGENT

${e.text}`;
    case "question": {
      const body = [e.question];
      if (e.context) body.push("", e.context);
      if (e.options.length > 0) body.push("", ...e.options.map((label, i) => `${i + 1}. ${label}`));
      return callout("question", e.title, body);
    }
    case "quiz-answer":
      return quizAnswer(e.details);
    case "ask-answer":
      return askAnswer(e.outcome);
  }
}
function formatLog(entries) {
  return entries.length === 0 ? "" : `${entries.map(formatEntry).join("\n\n")}
`;
}
function appendBlocks(current, blocks) {
  let out = current;
  for (const block of blocks) {
    const sep = out.trim().length === 0 || out.endsWith("\n\n") ? "" : out.endsWith("\n") ? "\n" : "\n\n";
    out = `${out}${sep}${block}
`;
  }
  return out;
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

// plugins/md-log/src/core/payload.ts
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function asText(value) {
  return typeof value === "string" ? value : "";
}
function asFlag(value) {
  return typeof value === "boolean" && value;
}

// plugins/md-log/src/core/entries.ts
var NO_RESULT = "No answer was recorded.";
function stripSkillBlocks(text) {
  return text.replace(/<skill\b([^>]*)>[\s\S]*?<\/skill>/g, (_match, attrs) => `> [!note] SKILL loaded: ${/name="([^"]+)"/.exec(attrs)?.[1] ?? "(unknown)"}`);
}
function userEntry(raw) {
  const text = stripSkillBlocks(raw.trim());
  return text ? { kind: "user", text } : void 0;
}
function assistantEntry(parts) {
  const text = parts.map((p) => p.trim()).filter((p) => p.length > 0).join("\n\n");
  return text ? { kind: "assistant", text } : void 0;
}
function quizQuestionEntry(input) {
  const args = asRecord(input) ?? {};
  const question = asText(args.question);
  const context = asText(args.details).trim() || void 0;
  const raw = (Array.isArray(args.options) ? args.options : []).map(asRecord).flatMap((o) => typeof o?.label === "string" ? [{
    label: o.label,
    value: typeof o.value === "string" ? o.value : void 0,
    description: typeof o.description === "string" ? o.description : void 0
  }] : []);
  const shuffle = typeof args.shuffle === "boolean" ? args.shuffle : void 0;
  let options;
  try {
    options = displayOrder({ question, options: raw, shuffle }).map((o) => o.label);
  } catch {
    options = [];
  }
  return { kind: "question", title: "Quiz", question, context, options };
}
function quizAnswerEntry(details, fallback) {
  return {
    kind: "quiz-answer",
    details: details ?? {
      status: "unavailable",
      question: "",
      mode: "single-select",
      answers: [],
      correctIndices: [],
      message: fallback.trim() || NO_RESULT
    }
  };
}
function askQuestions(input) {
  const questions = asRecord(input)?.questions;
  return (Array.isArray(questions) ? questions : []).map(asRecord).filter((q) => q !== void 0).map((q) => ({
    question: asText(q.question),
    header: asText(q.header).trim() || void 0,
    options: (Array.isArray(q.options) ? q.options : []).map((o) => asText(asRecord(o)?.label)),
    // omp's `ask` says `multi`, CC's `AskUserQuestion` says `multiSelect`.
    multi: [q.multi, q.multiSelect].some(asFlag)
  }));
}
function askQuestionEntries(input) {
  return askQuestions(input).map((q) => ({
    kind: "question",
    title: q.header ? `Question — ${q.header}` : "Question",
    question: q.question,
    options: q.options
  }));
}
function answerItem(label, options) {
  const index = options.indexOf(label);
  return index >= 0 ? { kind: "option", index: index + 1, label } : { kind: "other", text: label };
}

// plugins/md-log/src/core/from-omp.ts
var QUIZ = toolName("quiz", "omp");
var ASK = toolName("ask", "omp");
function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(asRecord).filter((c) => c?.type === "text").map((c) => asText(c?.text)).join("\n");
}
function ompToolCallEntries(tool, input) {
  if (tool === QUIZ) return [quizQuestionEntry(input)];
  if (tool === ASK) return askQuestionEntries(input);
  return [];
}
function askResults(details) {
  if (!details) return [];
  if (asFlag(details.chatRedirect)) return "chat";
  if (Array.isArray(details.results)) return details.results.map(asRecord);
  return Array.isArray(details.selectedOptions) ? [details] : [];
}
function askAnswer2(options, record) {
  const selected = record?.selectedOptions;
  if (!Array.isArray(selected) || !selected.every((label) => typeof label === "string")) return void 0;
  const items = selected.map((label) => answerItem(label, options));
  if (typeof record?.customInput === "string") items.push({ kind: "other", text: record.customInput });
  const note = asText(record?.note).trim() || void 0;
  return note ? { status: "answered", items, note } : { status: "answered", items };
}
function ompAskOutcomes(input, result) {
  const questions = askQuestions(input);
  const results = result.isError ? [] : askResults(asRecord(result.details));
  if (results === "chat") return questions.map(() => ({ status: "cancelled" }));
  const unavailable = { status: "unavailable", message: result.text.trim() || NO_RESULT };
  return questions.map((q, i) => askAnswer2(q.options, results[i]) ?? unavailable);
}
function ompToolResultEntries(tool, input, result) {
  if (tool === QUIZ) {
    return [quizAnswerEntry(isQuizResultDetails(result.details) ? result.details : void 0, result.text)];
  }
  if (tool === ASK) return ompAskOutcomes(input, result).map((outcome) => ({ kind: "ask-answer", outcome }));
  return [];
}
function ompAssistantEntries(message) {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
  const out = [];
  let text = [];
  const flush = () => {
    const prose = assistantEntry(text);
    if (prose) out.push(prose);
    text = [];
  };
  for (const block of message.content.map(asRecord)) {
    if (block?.type === "text") text.push(asText(block.text));
    const calls = block?.type === "toolCall" ? ompToolCallEntries(asText(block.name), block.arguments) : [];
    if (calls.length === 0) continue;
    flush();
    out.push(...calls);
  }
  flush();
  return out;
}
function questionCalls(message) {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content.map(asRecord).flatMap((block) => {
    const tool = asText(block?.name);
    return block?.type === "toolCall" && (tool === QUIZ || tool === ASK) ? [{ id: asText(block.id), input: block.arguments }] : [];
  });
}
function backfillFromOmp(messages) {
  const inputs = /* @__PURE__ */ new Map();
  return messages.flatMap((message) => {
    if (message.role === "user") return [userEntry(contentText(message.content))].filter((entry) => entry !== void 0);
    if (message.role === "toolResult") {
      const id = asText(message.toolCallId);
      if (!inputs.has(id)) return [];
      return ompToolResultEntries(asText(message.toolName), inputs.get(id), {
        details: message.details,
        isError: asFlag(message.isError),
        text: contentText(message.content)
      });
    }
    for (const call of questionCalls(message)) inputs.set(call.id, call.input);
    return ompAssistantEntries(message);
  });
}

// plugins/md-log/src/core/queue.ts
function createSerialQueue() {
  let tail = Promise.resolve();
  return {
    run(task) {
      const result = tail.then(task);
      tail = result.catch(() => void 0);
      return result;
    }
  };
}

// plugins/md-log/src/omp.ts
var ENTRY_TYPE = "md-log";
function errorText(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
function restore(state, ctx) {
  state.loggedCalls.clear();
  state.streaming = false;
  state.link = null;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
    const file = asRecord(entry.data)?.file;
    state.link = typeof file === "string" ? file : null;
  }
  ctx.ui.setStatus(ENTRY_TYPE, state.link ? `🗒 ${basename(state.link)}` : void 0);
}
async function readNote(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}
function observe(state, ctx, compute) {
  const file = state.link;
  if (!file) return Promise.resolve();
  let blocks;
  try {
    blocks = compute().map(formatEntry);
  } catch (error) {
    ctx.ui.notify(`md-log: ${errorText(error)}`, "error");
    return Promise.resolve();
  }
  if (blocks.length === 0) return Promise.resolve();
  return state.writes.run(async () => writeFile(file, appendBlocks(await readNote(file), blocks), "utf8")).catch((cause) => ctx.ui.notify(`md-log: ${errorText(cause)}`, "error"));
}
function messageEntries(state, message) {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return backfillFromOmp([message]);
  const content = message.content.filter((block) => {
    const call = asRecord(block);
    const id = asText(call?.id);
    if (call?.type !== "toolCall" || !id || ompToolCallEntries(asText(call.name), call.arguments).length === 0) return true;
    if (state.loggedCalls.has(id)) return false;
    state.loggedCalls.add(id);
    return true;
  });
  return backfillFromOmp([{ ...message, content }]);
}
function toolCallEntries(state, event) {
  if (state.streaming || state.loggedCalls.has(event.toolCallId)) return [];
  const entries = ompToolCallEntries(event.toolName, event.input);
  if (entries.length > 0) state.loggedCalls.add(event.toolCallId);
  return entries;
}
async function linkNote(pi, state, args, ctx) {
  const arg = args.trim();
  if (!arg) return ctx.ui.notify("Usage: /md-log <filepath>", "warning");
  if (!ctx.isIdle()) return ctx.ui.notify("Wait for the agent to finish before linking.", "warning");
  const file = isAbsolute(arg) ? arg : resolve(ctx.cwd, arg);
  const info = await stat(file).catch(() => void 0);
  if (!info) return ctx.ui.notify(`File does not exist: ${file}`, "error");
  if (!info.isFile()) return ctx.ui.notify(`Not a file: ${file}`, "error");
  const messages = ctx.sessionManager.getBranch().flatMap((e) => e.type === "message" ? [e.message] : []);
  const entries = backfillFromOmp(messages);
  try {
    await state.writes.run(async () => {
      if (entries.length > 0) await writeFile(file, formatLog(entries), "utf8");
    });
  } catch (error) {
    return ctx.ui.notify(`md-log: ${errorText(error)}`, "error");
  }
  state.loggedCalls.clear();
  state.link = file;
  pi.appendEntry(ENTRY_TYPE, { file });
  ctx.ui.setStatus(ENTRY_TYPE, `🗒 ${basename(file)}`);
  ctx.ui.notify(`Linked: ${file} (${entries.length} entries backfilled)`, "info");
}
function unlinkNote(pi, state, ctx) {
  if (!state.link) return ctx.ui.notify("No file linked", "warning");
  const name = basename(state.link);
  state.link = null;
  pi.appendEntry(ENTRY_TYPE, { file: null });
  ctx.ui.setStatus(ENTRY_TYPE, void 0);
  ctx.ui.notify(`Unlinked: ${name}`, "info");
}
function mdLog(pi) {
  const state = { link: null, writes: createSerialQueue(), streaming: false, loggedCalls: /* @__PURE__ */ new Set() };
  pi.on("session_start", (_event, ctx) => restore(state, ctx));
  pi.on("session_switch", (_event, ctx) => restore(state, ctx));
  pi.on("message_start", (event) => {
    if (event.message.role === "assistant") state.streaming = true;
  });
  pi.on("message_end", (event, ctx) => {
    const written = observe(state, ctx, () => messageEntries(state, event.message));
    if (event.message.role === "assistant") state.streaming = false;
    return written;
  });
  pi.on("tool_call", (event, ctx) => observe(state, ctx, () => toolCallEntries(state, event)));
  pi.on("tool_result", (event, ctx) => observe(state, ctx, () => {
    state.loggedCalls.delete(event.toolCallId);
    return ompToolResultEntries(event.toolName, event.input, {
      details: event.details,
      isError: event.isError,
      text: contentText(event.content)
    });
  }));
  pi.registerCommand("md-log", {
    description: "Mirror the session to a markdown file (backfills history)",
    handler: (args, ctx) => linkNote(pi, state, args, ctx)
  });
  pi.registerCommand("md-unlog", {
    description: "Stop mirroring the session to a markdown file",
    handler: (_args, ctx) => {
      unlinkNote(pi, state, ctx);
      return Promise.resolve();
    }
  });
}
export {
  mdLog as default
};
