import { decodeQuizResult, type QuizResultDetails } from "../../../../shared/quiz-contract.ts";
import { toolName } from "../../../../shared/tool-map.ts";
import {
  answerItem, askQuestionEntries, askQuestions, assistantEntry, NO_RESULT,
  quizAnswerEntry, quizQuestionEntry, userEntry, type AskAnswerItem, type AskOutcome, type AskQuestion, type Entry,
} from "./entries.ts";
import { asRecord, asText, type Payload } from "./payload.ts";

const QUIZ = toolName("quiz", "claude");
const ASK = toolName("ask", "claude");

/** The parts of CC's `ToolUseSummary` md-log reads (cc.d.ts:10180-10211). */
export interface ClaudeToolUse {
  readonly tool_use_id: string;
  readonly tool: string;
  readonly input: unknown;
  readonly result?: unknown;
  readonly text?: string;
  readonly isError?: true;
}

/** The parts of CC's `SessionMessage` (`$.session.messages()`, cc.d.ts:8964-8990) md-log reads. */
export interface ClaudeMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly toolUses: readonly ClaudeToolUse[];
}

/** A tool use md-log logged a question for and still owes an answer: a `TurnStepToolUse` (cc.d.ts:10581-10590). */
interface PendingUse { readonly name: string; readonly input: unknown }

function isQaTool(name: string): boolean {
  return name === QUIZ || name === ASK;
}

/** Question blocks for an `mcp__quiz__quiz` or `AskUserQuestion` use; [] for every other tool. */
function claudeQuestionEntries(use: PendingUse): Entry[] {
  if (use.name === QUIZ) return [quizQuestionEntry(use.input)];
  if (use.name === ASK) return askQuestionEntries(use.input);
  return [];
}

/**
 * The text a tool result carries: a string, or the `text` blocks of an Anthropic content array. A mod tool's
 * `result` is the array it returned (Phase 1 probe, `/tmp/hello-smoke/hello-probe.json`).
 */
// eslint-disable-next-line llm-core/no-unknown-parameters -- decodes an untrusted tool result.
function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!Array.isArray(result)) return "";
  return result.map(asRecord).filter((b) => b?.type === "text").map((b) => asText(b?.text)).join("\n");
}

/** One answer's lines: offered labels by position (multi-select comma-joined), else the text the user typed. */
function askItems(q: AskQuestion, answer: string): AskAnswerItem[] {
  const parts = q.multi ? answer.split(",").map((p) => p.trim()).filter((p) => p.length > 0) : [answer];
  return parts.every((p) => q.options.includes(p))
    ? parts.map((p) => answerItem(p, q.options))
    : [{ kind: "other", text: answer }];
}

/**
 * `AskUserQuestion`'s record: `{questions, answers: {[question]: label}, response?, annotations?}`,
 * multi-select labels comma-joined (`@anthropic-ai/claude-agent-sdk@0.3.296` sdk-tools.d.ts:3794-3980,
 * built for CC 2.1.296; the Phase 1 probe recorded `annotations: {}`). A label that matches no offered option
 * is text the user typed.
 */
function claudeAskOutcome(q: AskQuestion, record: Payload): AskOutcome {
  const answer = asRecord(record.answers)?.[q.question];
  const note = asText(asRecord(asRecord(record.annotations)?.[q.question])?.notes).trim() || undefined;
  const response = asText(record.response);
  let items: AskAnswerItem[] = [];
  if (typeof answer === "string") items = askItems(q, answer);
  else if (response.trim()) items = [{ kind: "other", text: response }];
  return note ? { status: "answered", items, note } : { status: "answered", items };
}

/** The first `<quiz-result>` block of a finished quiz use, from its result, else from the text the model read. */
function quizDetails(summary: ClaudeToolUse | undefined): QuizResultDetails | undefined {
  if (!summary) return undefined;
  return decodeQuizResult(resultText(summary.result)) ?? decodeQuizResult(summary.text ?? "");
}

/** What the model read from a finished use; the reason an unavailable callout gives. */
function resultMessage(summary: ClaudeToolUse | undefined): string {
  return summary?.text?.trim() || resultText(summary?.result).trim() || NO_RESULT;
}

/** An `AskUserQuestion` use's answer record; undefined when it errored or carries no `answers` map. */
function askRecord(summary: ClaudeToolUse | undefined): Payload | undefined {
  const record = summary?.isError ? undefined : asRecord(summary?.result);
  return asRecord(record?.answers) ? record : undefined;
}

/** Answer blocks for a finished use (`summary` from `$.session.messages()`); [] for every other tool. */
export function claudeAnswerEntries(use: PendingUse, summary: ClaudeToolUse | undefined): Entry[] {
  const message = resultMessage(summary);
  // Successful quiz results include a block; validation errors may have only text. Keep the unavailable fallback.
  if (use.name === QUIZ) return [quizAnswerEntry(quizDetails(summary), message)];
  if (use.name !== ASK) return [];
  const record = askRecord(summary);
  return askQuestions(use.input).map((q) => ({
    kind: "ask-answer",
    outcome: record ? claudeAskOutcome(q, record) : { status: "unavailable", message },
  }));
}

/** A tool call's identity: its name and its JSON input with object keys sorted. */
// eslint-disable-next-line llm-core/no-unknown-parameters -- tool inputs are untrusted JSON.
function callKey(name: string, input: unknown): string {
  // eslint-disable-next-line llm-core/no-unknown-parameters -- JSON replacer over untrusted tool input.
  const canonical = JSON.stringify(input, (_key, v: unknown) => {
    const r = asRecord(v);
    return r ? Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]])) : v;
  });
  return `${name}\u0000${canonical}`;
}

function tally(keys: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

function hasOutcome(use: ClaudeToolUse): boolean {
  return use.text !== undefined || use.result !== undefined || Boolean(use.isError);
}

/**
 * Match pending uses oldest-first to unconsumed transcript occurrences in chronological order.
 * If a repeated call has not yet produced all its transcript occurrences, defer that ambiguous
 * group: a lone visible later result must not be assigned to an earlier identical question.
 * Only the answered prefix can be written.
 */
export function pairPending(
  pending: readonly PendingUse[],
  messages: readonly ClaudeMessage[],
  consumed: ReadonlySet<string>,
): ClaudeToolUse[] {
  const uses = messages.filter((m) => m.role === "assistant").flatMap((m) => m.toolUses)
    .filter((use) => !consumed.has(use.tool_use_id));
  const useKeys = uses.map((use) => callKey(use.tool, use.input));
  const wantKeys = pending.map((want) => callKey(want.name, want.input));
  const wanted = tally(wantKeys);
  const available = tally(useKeys);
  const done: ClaudeToolUse[] = [];
  let cursor = 0;
  for (const key of wantKeys) {
    const count = wanted.get(key) ?? 0;
    if (count > 1 && (available.get(key) ?? 0) < count) break;
    const at = useKeys.indexOf(key, cursor);
    const match = at < 0 ? undefined : uses[at];
    if (!match || !hasOutcome(match)) break;
    done.push(match);
    cursor = at + 1;
  }
  return done;
}

interface ClaudeBackfill { entries: Entry[]; consumed: string[] }

/**
 * The transcript as entries, Q&A paired from each assistant message's `toolUses` (a use with no outcome is
 * logged as unavailable, as live logging does at `turn.complete`); `consumed` lists every logged use's id.
 */
export function backfillFromClaude(messages: readonly ClaudeMessage[]): ClaudeBackfill {
  const entries: Entry[] = [];
  const consumed: string[] = [];
  for (const message of messages) {
    const prose = message.role === "user" ? userEntry(message.text) : assistantEntry([message.text]);
    if (prose) entries.push(prose);
    if (message.role !== "assistant") continue;
    for (const use of message.toolUses.filter((u) => isQaTool(u.tool))) {
      const pending = { name: use.tool, input: use.input };
      entries.push(...claudeQuestionEntries(pending), ...claudeAnswerEntries(pending, hasOutcome(use) ? use : undefined));
      consumed.push(use.tool_use_id);
    }
  }
  return { entries, consumed };
}
