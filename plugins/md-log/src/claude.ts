import type { CommandRunResult, EngineInterface, On, SessionMessage, TurnStepResult } from "claude-code";
import { assistantEntry, userEntry, type Entry } from "./core/entries.ts";
import { appendBlocks, formatEntry, formatLog } from "./core/format.ts";
import {
  backfillFromClaude, claudeAnswerEntries, claudeQuestionEntries, isQaTool, pairPending, type PendingUse,
} from "./core/from-claude.ts";
import { createSerialQueue } from "./core/queue.ts";

/** `$.fs.read` and `$.fs.write` refuse files over 4 MiB (reference.md, Limits). */
const NOTE_LIMIT = 4 * 1024 * 1024;
/** The cap toast stays up long enough to read why logging stopped. */
const CAP_TOAST_MS = 10_000;

let link: string | undefined;
let linkGeneration = 0;
/** Quiz/AskUserQuestion uses whose question is logged and whose answer is not, oldest first. */
let pending: PendingUse[] = [];
/** `tool_use_id`s whose answers are logged, so a repeated question never takes an old answer. */
const consumed = new Set<string>();
const writes = createSerialQueue();

function clearLink(): void {
  linkGeneration++;
  link = undefined;
  pending = [];
  consumed.clear();
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function overLimit(text: string): boolean {
  return new TextEncoder().encode(text).length > NOTE_LIMIT;
}

/** Read, concatenate, write: `$.fs.write` has no append. Past 4 MiB the note is unlinked instead. */
async function appendToNote($: EngineInterface, file: string, generation: number, blocks: readonly string[]): Promise<void> {
  if (link !== file || linkGeneration !== generation) return;
  const info = await $.fs.stat(file).catch(() => undefined);
  const current = info === undefined ? "" : info.size > NOTE_LIMIT ? undefined : await $.fs.read(file);
  if (link !== file || linkGeneration !== generation) return;
  const next = current === undefined ? undefined : appendBlocks(current, blocks);
  if (next === undefined || overLimit(next)) {
    clearLink();
    $.ui.toast(`md-log: unlinked ${fileName(file)}: notes over 4 MiB cannot be written`, { timeoutMs: CAP_TOAST_MS });
    return;
  }
  // No await between the generation check and write initiation.
  await $.fs.write(file, next);
}

/** Append what `compute` derives from an event. Never throws: failures become a toast. */
async function observe($: EngineInterface, compute: () => readonly Entry[]): Promise<void> {
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

/**
 * The turn is over: a QA record still without an outcome never gets one. Retire it so a dead occurrence
 * from an aborted turn cannot capture a later identical question's answer.
 */
function retireUnanswered(messages: readonly SessionMessage[]): void {
  for (const use of messages.filter((m) => m.role === "assistant").flatMap((m) => m.toolUses)) {
    if (isQaTool(use.tool) && use.result === undefined && use.text === undefined && !use.isError)
      consumed.add(use.tool_use_id);
  }
}

/**
 * Log the answers of pending uses that the transcript now holds, in order. At the end of a turn
 * (`final`), uses that never got a result are logged as unavailable and dead QA records are retired.
 */
async function settle($: EngineInterface, final: boolean): Promise<void> {
  const owed = pending;
  if (!link || owed.length === 0) return;
  try {
    const messages = await $.session.messages();
    if (pending !== owed) return; // unlinked meanwhile
    const done = pairPending(owed, messages, consumed);
    for (const use of done) consumed.add(use.tool_use_id);
    if (final) retireUnanswered(messages);
    const rest = owed.slice(done.length);
    pending = final ? [] : rest;
    const answered = owed.slice(0, done.length).flatMap((use, i) => claudeAnswerEntries(use, done[i]));
    const missing = final ? rest.flatMap((use) => claudeAnswerEntries(use, undefined)) : [];
    await observe($, () => [...answered, ...missing]);
  } catch (error) {
    $.ui.toast(`md-log: ${errorText(error)}`);
  }
}

/** One model request's prose and the questions it asks; those uses stay pending until answered. */
async function logStep($: EngineInterface, result: TurnStepResult): Promise<void> {
  await observe($, () => {
    const uses = result.toolUses.filter((u) => isQaTool(u.name)).map((u) => ({ name: u.name, input: u.input }));
    pending.push(...uses);
    const prose = assistantEntry([result.answer]);
    return [...(prose ? [prose] : []), ...uses.flatMap(claudeQuestionEntries)];
  });
}

/** `/md-log <file>`: link an existing note and overwrite it with the transcript so far. */
async function linkNote($: EngineInterface, args: string): Promise<CommandRunResult> {
  const arg = args.trim();
  if (!arg) return { text: "Usage: /md-log <filepath>" };
  // Link existing notes only: a typo must not scatter new files around the vault.
  const info = await $.fs.stat(arg, { resolve: true }).catch(() => undefined);
  if (!info) return { text: `File does not exist: ${arg}` };
  if (info.kind !== "file") return { text: `Not a file: ${arg}` };
  const file = info.realPath ?? arg;
  const backfill = backfillFromClaude(await $.session.messages());
  const text = formatLog(backfill.entries);
  if (overLimit(text)) return { text: "Not linked: the conversation so far is over the 4 MiB note limit." };
  // Overwrites the note with the conversation so far; an empty conversation leaves it untouched.
  if (text) await writes.run(() => $.fs.write(file, text));
  clearLink();
  link = file;
  for (const id of backfill.consumed) consumed.add(id);
  return { text: `Linked: ${file} (${backfill.entries.length} entries backfilled)` };
}

function unlinkNote(): CommandRunResult {
  if (!link) return { text: "No file linked" };
  const name = fileName(link);
  clearLink();
  return { text: `Unlinked: ${name}` };
}

export function register(on: On): void {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "md-log",
      description: "Mirror the session to a markdown file (backfills history)",
      argumentHint: "<filepath>",
    });
    await $.command.register({ name: "md-unlog", description: "Stop mirroring the session to a markdown file", immediate: true });
    return next(e);
  }).catch(($, e, next) => next(e));

  // /clear, /resume and /branch end this conversation; the link belongs to it.
  on("session.end", async ($, e, next) => {
    clearLink();
    return next(e);
  }).catch(($, e, next) => next(e));

  // Not `immediate`: typed mid-turn, CC runs it once the turn ends, so the backfill never races a turn.
  on("command.run", { command: "md-log" }, async ($, e) => linkNote($, e.args))
    .catch(($, e, next) => ({ text: `md-log failed: ${next.error.message ?? next.error.kind}` }));

  on("command.run", { command: "md-unlog" }, () => unlinkNote())
    .catch(($, e, next) => ({ text: `md-unlog failed: ${next.error.message ?? next.error.kind}` }));

  // After next: a dropped prompt is skipped, a rewritten one is logged as sent.
  on("prompt.submit", async ($, e, next) => {
    const result = await next(e);
    if (result.drop === undefined) await observe($, () => [userEntry(result.text)].filter((entry) => entry !== undefined));
    return result;
  }).catch(($, e, next) => next(e));

  // One model request: settle answers the transcript now holds, then log this response's prose and the
  // questions it asks (before the tools run, so they appear live). Subagent requests are not the conversation.
  on("turn.step", async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e);
    await settle($, false);
    const result = yield* next(e);
    await logStep($, result);
    return result;
  }).catch(async function* ($, e, next) {
    return yield* next(e);
  });

  on("turn.complete", async ($, e, next) => {
    if (e.agentId === undefined) await settle($, true);
    return next(e);
  }).catch(($, e, next) => next(e));
}
