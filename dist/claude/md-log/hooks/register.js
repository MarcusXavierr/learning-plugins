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
var OPEN = "<quiz-result>";
var CLOSE = "</quiz-result>";
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

// plugins/md-log/src/core/from-claude.ts
var QUIZ = toolName("quiz", "claude");
var ASK = toolName("ask", "claude");
function isQaTool(name) {
  return name === QUIZ || name === ASK;
}
function claudeQuestionEntries(use) {
  if (use.name === QUIZ) return [quizQuestionEntry(use.input)];
  if (use.name === ASK) return askQuestionEntries(use.input);
  return [];
}
function resultText(result) {
  if (typeof result === "string") return result;
  if (!Array.isArray(result)) return "";
  return result.map(asRecord).filter((b) => b?.type === "text").map((b) => asText(b?.text)).join("\n");
}
function askItems(q, answer) {
  const parts = q.multi ? answer.split(",").map((p) => p.trim()).filter((p) => p.length > 0) : [answer];
  return parts.every((p) => q.options.includes(p)) ? parts.map((p) => answerItem(p, q.options)) : [{ kind: "other", text: answer }];
}
function claudeAskOutcome(q, record) {
  const answer = asRecord(record.answers)?.[q.question];
  const note = asText(asRecord(asRecord(record.annotations)?.[q.question])?.notes).trim() || void 0;
  const response = asText(record.response);
  let items = [];
  if (typeof answer === "string") items = askItems(q, answer);
  else if (response.trim()) items = [{ kind: "other", text: response }];
  return note ? { status: "answered", items, note } : { status: "answered", items };
}
function quizDetails(summary) {
  if (!summary) return void 0;
  return decodeQuizResult(resultText(summary.result)) ?? decodeQuizResult(summary.text ?? "");
}
function resultMessage(summary) {
  return summary?.text?.trim() || resultText(summary?.result).trim() || NO_RESULT;
}
function askRecord(summary) {
  const record = summary?.isError ? void 0 : asRecord(summary?.result);
  return asRecord(record?.answers) ? record : void 0;
}
function claudeAnswerEntries(use, summary) {
  const message = resultMessage(summary);
  if (use.name === QUIZ) return [quizAnswerEntry(quizDetails(summary), message)];
  if (use.name !== ASK) return [];
  const record = askRecord(summary);
  return askQuestions(use.input).map((q) => ({
    kind: "ask-answer",
    outcome: record ? claudeAskOutcome(q, record) : { status: "unavailable", message }
  }));
}
function callKey(name, input) {
  const canonical = JSON.stringify(input, (_key, v) => {
    const r = asRecord(v);
    return r ? Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]])) : v;
  });
  return `${name}\0${canonical}`;
}
function tally(keys) {
  const counts = /* @__PURE__ */ new Map();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}
function hasOutcome(use) {
  return use.text !== void 0 || use.result !== void 0 || Boolean(use.isError);
}
function pairPending(pending2, messages, consumed2) {
  const uses = messages.filter((m) => m.role === "assistant").flatMap((m) => m.toolUses).filter((use) => !consumed2.has(use.tool_use_id));
  const useKeys = uses.map((use) => callKey(use.tool, use.input));
  const wantKeys = pending2.map((want) => callKey(want.name, want.input));
  const wanted = tally(wantKeys);
  const available = tally(useKeys);
  const done = [];
  let cursor = 0;
  for (const key of wantKeys) {
    const count = wanted.get(key) ?? 0;
    if (count > 1 && (available.get(key) ?? 0) < count) break;
    const at = useKeys.indexOf(key, cursor);
    const match = at < 0 ? void 0 : uses[at];
    if (!match || !hasOutcome(match)) break;
    done.push(match);
    cursor = at + 1;
  }
  return done;
}
function backfillFromClaude(messages) {
  const entries = [];
  const consumed2 = [];
  for (const message of messages) {
    const prose = message.role === "user" ? userEntry(message.text) : assistantEntry([message.text]);
    if (prose) entries.push(prose);
    if (message.role !== "assistant") continue;
    for (const use of message.toolUses.filter((u) => isQaTool(u.tool))) {
      const pending2 = { name: use.tool, input: use.input };
      entries.push(...claudeQuestionEntries(pending2), ...claudeAnswerEntries(pending2, hasOutcome(use) ? use : void 0));
      consumed2.push(use.tool_use_id);
    }
  }
  return { entries, consumed: consumed2 };
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

// plugins/md-log/src/claude.ts
var NOTE_LIMIT = 4 * 1024 * 1024;
var CAP_TOAST_MS = 1e4;
var link;
var linkGeneration = 0;
var pending = [];
var consumed = /* @__PURE__ */ new Set();
var writes = createSerialQueue();
function clearLink() {
  linkGeneration++;
  link = void 0;
  pending = [];
  consumed.clear();
}
function errorText(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
function fileName(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}
function overLimit(text) {
  return new TextEncoder().encode(text).length > NOTE_LIMIT;
}
async function appendToNote($, file, generation, blocks) {
  if (link !== file || linkGeneration !== generation) return;
  const info = await $.fs.stat(file).catch(() => void 0);
  const current = info === void 0 ? "" : info.size > NOTE_LIMIT ? void 0 : await $.fs.read(file);
  if (link !== file || linkGeneration !== generation) return;
  const next = current === void 0 ? void 0 : appendBlocks(current, blocks);
  if (next === void 0 || overLimit(next)) {
    clearLink();
    $.ui.toast(`md-log: unlinked ${fileName(file)}: notes over 4 MiB cannot be written`, { timeoutMs: CAP_TOAST_MS });
    return;
  }
  await $.fs.write(file, next);
}
async function observe($, compute) {
  const file = link;
  const generation = linkGeneration;
  if (!file) return;
  try {
    const blocks = compute().map(formatEntry);
    if (blocks.length > 0) await writes.run(() => appendToNote($, file, generation, blocks));
  } catch (error) {
    $.ui.toast(`md-log: ${errorText(error)}`);
  }
}
function retireUnanswered(messages) {
  for (const use of messages.filter((m) => m.role === "assistant").flatMap((m) => m.toolUses)) {
    if (isQaTool(use.tool) && use.result === void 0 && use.text === void 0 && !use.isError)
      consumed.add(use.tool_use_id);
  }
}
async function settle($, final) {
  const owed = pending;
  if (!link || owed.length === 0) return;
  try {
    const messages = await $.session.messages();
    if (pending !== owed) return;
    const done = pairPending(owed, messages, consumed);
    for (const use of done) consumed.add(use.tool_use_id);
    if (final) retireUnanswered(messages);
    const rest = owed.slice(done.length);
    pending = final ? [] : rest;
    const answered = owed.slice(0, done.length).flatMap((use, i) => claudeAnswerEntries(use, done[i]));
    const missing = final ? rest.flatMap((use) => claudeAnswerEntries(use, void 0)) : [];
    await observe($, () => [...answered, ...missing]);
  } catch (error) {
    $.ui.toast(`md-log: ${errorText(error)}`);
  }
}
async function logStep($, result) {
  await observe($, () => {
    const uses = result.toolUses.filter((u) => isQaTool(u.name)).map((u) => ({ name: u.name, input: u.input }));
    pending.push(...uses);
    const prose = assistantEntry([result.answer]);
    return [...prose ? [prose] : [], ...uses.flatMap(claudeQuestionEntries)];
  });
}
async function linkNote($, args) {
  const arg = args.trim();
  if (!arg) return { text: "Usage: /md-log <filepath>" };
  const info = await $.fs.stat(arg, { resolve: true }).catch(() => void 0);
  if (!info) return { text: `File does not exist: ${arg}` };
  if (info.kind !== "file") return { text: `Not a file: ${arg}` };
  const file = info.realPath ?? arg;
  const backfill = backfillFromClaude(await $.session.messages());
  const text = formatLog(backfill.entries);
  if (overLimit(text)) return { text: "Not linked: the conversation so far is over the 4 MiB note limit." };
  if (text) await writes.run(() => $.fs.write(file, text));
  clearLink();
  link = file;
  for (const id of backfill.consumed) consumed.add(id);
  return { text: `Linked: ${file} (${backfill.entries.length} entries backfilled)` };
}
function unlinkNote() {
  if (!link) return { text: "No file linked" };
  const name = fileName(link);
  clearLink();
  return { text: `Unlinked: ${name}` };
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "md-log",
      description: "Mirror the session to a markdown file (backfills history)",
      argumentHint: "<filepath>"
    });
    await $.command.register({ name: "md-unlog", description: "Stop mirroring the session to a markdown file", immediate: true });
    return next(e);
  }).catch(($, e, next) => next(e));
  on("session.end", async ($, e, next) => {
    clearLink();
    return next(e);
  }).catch(($, e, next) => next(e));
  on("command.run", { command: "md-log" }, async ($, e) => linkNote($, e.args)).catch(($, e, next) => ({ text: `md-log failed: ${next.error.message ?? next.error.kind}` }));
  on("command.run", { command: "md-unlog" }, () => unlinkNote()).catch(($, e, next) => ({ text: `md-unlog failed: ${next.error.message ?? next.error.kind}` }));
  on("prompt.submit", async ($, e, next) => {
    const result = await next(e);
    if (result.drop === void 0) await observe($, () => [userEntry(result.text)].filter((entry) => entry !== void 0));
    return result;
  }).catch(($, e, next) => next(e));
  on("turn.step", async function* ($, e, next) {
    if (e.agentId !== void 0) return yield* next(e);
    await settle($, false);
    const result = yield* next(e);
    await logStep($, result);
    return result;
  }).catch(async function* ($, e, next) {
    return yield* next(e);
  });
  on("turn.complete", async ($, e, next) => {
    if (e.agentId === void 0) await settle($, true);
    return next(e);
  }).catch(($, e, next) => next(e));
}
export {
  register
};
