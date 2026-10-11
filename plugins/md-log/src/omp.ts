import type {
  ExtensionAPI, ExtensionCommandContext, ExtensionContext, ToolCallEvent,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import type { Entry } from "./core/entries.ts";
import { appendBlocks, formatEntry, formatLog } from "./core/format.ts";
import { backfillFromOmp, contentText, ompToolCallEntries, ompToolResultEntries, type OmpMessage } from "./core/from-omp.ts";
import { createSerialQueue, type SerialQueue } from "./core/queue.ts";
import { asRecord, asText } from "./core/payload.ts";

const ENTRY_TYPE = "md-log";

/** What one md-log instance tracks: the linked note, its write queue, and the question calls in flight. */
interface LogState {
  link: string | null;
  readonly writes: SerialQueue;
  /** Between an assistant `message_start` and its `message_end`: its `tool_call`s are written at `message_end`. */
  streaming: boolean;
  /** Question tool call ids already written, so neither `tool_call` nor `message_end` writes one twice. */
  readonly loggedCalls: Set<string>;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Point `link` at the newest md-log entry on the active branch (null when none or after /md-unlog). */
function restore(state: LogState, ctx: ExtensionContext): void {
  state.loggedCalls.clear();
  state.streaming = false;
  state.link = null;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
    const file = asRecord(entry.data)?.file;
    state.link = typeof file === "string" ? file : null;
  }
  ctx.ui.setStatus(ENTRY_TYPE, state.link ? `🗒 ${basename(state.link)}` : undefined);
}

/** The note's text; "" when it was deleted after linking, so the next entry recreates it. */
async function readNote(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/**
 * Append the entries `compute` derives from an event. Runs synchronously up to the enqueue, so writes
 * keep event order; never throws (observers must not break the session).
 */
function observe(state: LogState, ctx: ExtensionContext, compute: () => readonly Entry[]): Promise<void> {
  const file = state.link;
  if (!file) return Promise.resolve();
  let blocks: string[];
  try {
    blocks = compute().map(formatEntry);
  } catch (error) {
    ctx.ui.notify(`md-log: ${errorText(error)}`, "error");
    return Promise.resolve();
  }
  if (blocks.length === 0) return Promise.resolve();
  return state.writes
    .run(async () => writeFile(file, appendBlocks(await readNote(file), blocks), "utf8"))
    .catch((cause: unknown) => ctx.ui.notify(`md-log: ${errorText(cause)}`, "error"));
}

/**
 * A completed message's entries: a user prompt, or an assistant's prose and questions in content-block order.
 * Its tools run after it ends, so its questions are still live; a question an earlier `tool_call` wrote is skipped.
 */
function messageEntries(state: LogState, message: OmpMessage): Entry[] {
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

/**
 * A question tool call's blocks. omp emits `tool_call` before the assistant `message_end` (pi-agent-core
 * agent-loop.ts:2031-2064), so a streamed message's calls are left to its `message_end`. A call outside a
 * streamed message (a nested xd:// dispatch, or a message whose `message_start` comes after) is written now.
 */
function toolCallEntries(state: LogState, event: ToolCallEvent): Entry[] {
  if (state.streaming || state.loggedCalls.has(event.toolCallId)) return [];
  const entries = ompToolCallEntries(event.toolName, event.input);
  if (entries.length > 0) state.loggedCalls.add(event.toolCallId);
  return entries;
}

/** `/md-log <file>`: link an existing note and overwrite it with the active branch so far. */
async function linkNote(pi: ExtensionAPI, state: LogState, args: string, ctx: ExtensionCommandContext): Promise<void> {
  const arg = args.trim();
  if (!arg) return ctx.ui.notify("Usage: /md-log <filepath>", "warning");
  if (!ctx.isIdle()) return ctx.ui.notify("Wait for the agent to finish before linking.", "warning");
  const file = isAbsolute(arg) ? arg : resolve(ctx.cwd, arg);
  // Link existing notes only: a typo must not scatter new files around the vault.
  const info = await stat(file).catch(() => undefined);
  if (!info) return ctx.ui.notify(`File does not exist: ${file}`, "error");
  if (!info.isFile()) return ctx.ui.notify(`Not a file: ${file}`, "error");
  const messages = ctx.sessionManager.getBranch().flatMap((e) => (e.type === "message" ? [e.message as OmpMessage] : []));
  const entries = backfillFromOmp(messages);
  try {
    // Overwrites the note with the conversation so far; an empty conversation leaves it untouched.
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

function unlinkNote(pi: ExtensionAPI, state: LogState, ctx: ExtensionCommandContext): void {
  if (!state.link) return ctx.ui.notify("No file linked", "warning");
  const name = basename(state.link);
  state.link = null;
  pi.appendEntry(ENTRY_TYPE, { file: null });
  ctx.ui.setStatus(ENTRY_TYPE, undefined);
  ctx.ui.notify(`Unlinked: ${name}`, "info");
}

export default function mdLog(pi: ExtensionAPI): void {
  const state: LogState = { link: null, writes: createSerialQueue(), streaming: false, loggedCalls: new Set() };

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
      text: contentText(event.content),
    });
  }));

  pi.registerCommand("md-log", {
    description: "Mirror the session to a markdown file (backfills history)",
    handler: (args, ctx) => linkNote(pi, state, args, ctx),
  });

  pi.registerCommand("md-unlog", {
    description: "Stop mirroring the session to a markdown file",
    handler: (_args, ctx) => {
      unlinkNote(pi, state, ctx);
      return Promise.resolve();
    },
  });
}
