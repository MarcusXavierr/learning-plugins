import type { HookStream, On, SessionMessage, TurnStepToolUse } from "claude-code";

/** What the stubbed engine holds: files by absolute path, the transcript, toasts, and the next model response. */
export interface StubbedEngine {
  files: Map<string, string>;
  dirs: Set<string>;
  failWrites: Set<string>;
  messages: SessionMessage[];
  toasts: string[];
  response: { answer: string; toolUses: TurnStepToolUse[] };
  readGate?: { entered: () => void; release: Promise<void> };
}

/**
 * Stubs every engine call md-log makes except `prompt.submit` (tests choose its answer).
 * Register before the test's first call on `$` (kit rule).
 */
export function stubEngine(on: On): StubbedEngine {
  const engine: StubbedEngine = {
    files: new Map(), dirs: new Set(), failWrites: new Set(), messages: [], toasts: [],
    response: { answer: "", toolUses: [] },
  };
  on("fs.stat", ($, e) => {
    if (engine.dirs.has(e.path)) return { value: { kind: "dir", size: 0, mtimeMs: 0, isLink: false, realPath: e.path } };
    const text = engine.files.get(e.path);
    if (text === undefined) return { deny: `ENOENT: no such file, stat '${e.path}'` };
    return { value: { kind: "file", size: new TextEncoder().encode(text).length, mtimeMs: 0, isLink: false, realPath: e.path } };
  });
  on("fs.read", async ($, e) => {
    const text = engine.files.get(e.path);
    engine.readGate?.entered();
    if (engine.readGate) await engine.readGate.release;
    return text === undefined ? { deny: `ENOENT: no such file, open '${e.path}'` } : { value: text };
  });
  on("fs.write", ($, e) => {
    if (engine.failWrites.has(e.path)) return { deny: `EACCES: permission denied, open '${e.path}'` };
    engine.files.set(e.path, e.text);
    return { value: undefined };
  });
  on("session.messages", () => ({ value: engine.messages }));
  on("ui.toast", ($, e) => {
    engine.toasts.push(e.text);
    return { value: undefined };
  });
  on("turn.complete", () => ({ text: "" }));
  on("session.end", ($, e) => ({ sessionId: e.sessionId }));
  // eslint-disable-next-line @typescript-eslint/require-await -- the kit runs a turn.step stub as an async generator.
  on("turn.step", async function* ($, e) {
    const { answer, toolUses } = engine.response;
    if (answer) yield { kind: "text", index: 0, text: answer };
    return {
      turnId: e.turnId, index: e.index, answer, toolUses,
      stopReason: toolUses.length > 0 ? "tool_use" : "end_turn", usage: null,
    };
  });
  return engine;
}

/** Reads a `turn.step` stream to its end, as the engine does, and returns the step's result. */
export async function drain<C, R>(stream: HookStream<C, R>): Promise<R> {
  let step = await stream.next();
  while (!step.done) step = await stream.next();
  return step.value;
}

const TERMINAL_COLUMNS = 80;
export const PRESENTATION = { origin: { kind: "composer" }, presentation: { isFullscreen: false, columns: TERMINAL_COLUMNS } } as const;
