import type { SessionEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { createFakeOmp, type FakeOmp } from "../../../test-support/fake-omp.ts";
import { backfillFromOmp, type OmpMessage } from "../src/core/from-omp.ts";
import { formatLog } from "../src/core/format.ts";
import mdLog from "../src/omp.ts";
import {
  OMP_ASK_DETAILS, OMP_ASK_INPUT, OMP_MESSAGES, PROMPT, PROSE_1, PROSE_2, PROSE_3, QUIZ_DETAILS, QUIZ_INPUT,
} from "./fixtures/session.ts";

let dir: string;
let note: string;
let omp: FakeOmp;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "md-log-"));
  note = join(dir, "notes.md");
  omp = createFakeOmp({ cwd: dir });
  mdLog(omp.api);
});

const run = (name: string, args = "") => omp.commands.get(name)!.handler(args, omp.ctx);
const say = (message: OmpMessage) => omp.emit("message_end", { type: "message_end", message });
const read = () => readFileSync(note, "utf8");
const messageEntry = (message: OmpMessage, i: number) =>
  ({ type: "message", id: `m${i}`, parentId: i ? `m${i - 1}` : null, timestamp: "", message }) as unknown as SessionEntry;

describe("/md-log", () => {
  test("logs a live session, prose and Q&A in order, exactly as golden/session.md", async () => {
    writeFileSync(note, "");
    await run("md-log", "notes.md");
    await say({ role: "user", content: [{ type: "text", text: PROMPT }] });
    await say({ role: "assistant", content: [{ type: "text", text: PROSE_1 }, { type: "toolCall", id: "q", name: "quiz", arguments: QUIZ_INPUT }] });
    await omp.emit("tool_call", { type: "tool_call", toolCallId: "q", toolName: "quiz", input: QUIZ_INPUT });
    await omp.emit("tool_result", {
      type: "tool_result", toolCallId: "q", toolName: "quiz", input: QUIZ_INPUT,
      content: [{ type: "text", text: "Correct ✓" }], details: QUIZ_DETAILS, isError: false,
    });
    await say({ role: "toolResult", toolCallId: "q", toolName: "quiz", content: [{ type: "text", text: "Correct ✓" }], isError: false });
    await say({ role: "assistant", content: [{ type: "text", text: PROSE_2 }] });
    await omp.emit("tool_call", { type: "tool_call", toolCallId: "a", toolName: "ask", input: OMP_ASK_INPUT });
    await omp.emit("tool_result", {
      type: "tool_result", toolCallId: "a", toolName: "ask", input: OMP_ASK_INPUT,
      content: [{ type: "text", text: "User selected: Slow" }], details: OMP_ASK_DETAILS, isError: false,
    });
    await say({ role: "assistant", content: [{ type: "text", text: PROSE_3 }] });
    await expect(read()).toMatchFileSnapshot("golden/session.md");
  });

  test("live and backfill agree for text, quiz, text in one assistant message", async () => {
    writeFileSync(note, "");
    await run("md-log", note);
    const mixed = { role: "assistant", content: [
      { type: "text", text: "Before." },
      { type: "toolCall", id: "mixed", name: "quiz", arguments: QUIZ_INPUT },
      { type: "text", text: "After." },
    ] };
    await say(mixed);
    await omp.emit("tool_call", { type: "tool_call", toolCallId: "mixed", toolName: "quiz", input: QUIZ_INPUT });
    const live = read();
    expect(live).toBe(formatLog(backfillFromOmp([mixed])));
    expect(live).toContain("> [!question] Quiz");
    expect(live.indexOf("Before.")).toBeLessThan(live.indexOf("> [!question] Quiz"));
    expect(live.indexOf("> [!question] Quiz")).toBeLessThan(live.indexOf("After."));
  });

  test("backfills the conversation so far by overwriting the note", async () => {
    writeFileSync(note, "old content\n");
    omp.branch.push(...OMP_MESSAGES.map(messageEntry));
    await run("md-log", note);
    await expect(read()).toMatchFileSnapshot("golden/session.md");
    expect(omp.notifications.at(-1)).toEqual({ message: `Linked: ${note} (8 entries backfilled)`, type: "info" });
    expect(omp.statuses.get("md-log")).toBe("🗒 notes.md");
  });

  test("with nothing to backfill, keeps the note's content and appends after it", async () => {
    writeFileSync(note, "# Primes\n");
    await run("md-log", "notes.md");
    await say({ role: "user", content: "Hi" });
    expect(read()).toBe("# Primes\n\n> [!quote] YOU\n\nHi\n");
  });

  test("refuses without a path, while the agent is busy, for a missing file, and for a directory", async () => {
    await run("md-log", "  ");
    omp.idle = false;
    writeFileSync(note, "");
    await run("md-log", "notes.md");
    omp.idle = true;
    await run("md-log", "missing.md");
    await run("md-log", dir);
    expect(omp.notifications).toEqual([
      { message: "Usage: /md-log <filepath>", type: "warning" },
      { message: "Wait for the agent to finish before linking.", type: "warning" },
      { message: `File does not exist: ${join(dir, "missing.md")}`, type: "error" },
      { message: `Not a file: ${dir}`, type: "error" },
    ]);
    await say({ role: "user", content: "Hi" });
    expect(read()).toBe("");
    expect(() => readFileSync(join(dir, "missing.md"))).toThrow();
  });
});

describe("/md-unlog", () => {
  test("stops logging and records the unlink for the next restart", async () => {
    writeFileSync(note, "");
    await run("md-log", "notes.md");
    await run("md-unlog");
    await say({ role: "user", content: "Hi" });
    expect(read()).toBe("");
    expect(omp.entries).toEqual([
      { customType: "md-log", data: { file: note } },
      { customType: "md-log", data: { file: null } },
    ]);
    expect(omp.notifications.at(-1)).toEqual({ message: "Unlinked: notes.md", type: "info" });
  });
});

describe("restoring the link", () => {
  test("session_start resumes logging to the newest linked note on the branch", async () => {
    writeFileSync(note, "");
    omp.branch.push({ type: "custom", id: "c1", parentId: null, timestamp: "", customType: "md-log", data: { file: note } });
    await omp.emit("session_start", { type: "session_start" });
    await say({ role: "user", content: "Hi" });
    expect(read()).toBe("> [!quote] YOU\n\nHi\n");
    expect(omp.statuses.get("md-log")).toBe("🗒 notes.md");
  });

  test("switching to a session that never linked a note stops logging", async () => {
    writeFileSync(note, "");
    await run("md-log", "notes.md");
    omp.branch.length = 0;
    await omp.emit("session_switch", { type: "session_switch", reason: "new", previousSessionFile: undefined });
    await say({ role: "user", content: "Hi" });
    expect(read()).toBe("");
    expect(omp.statuses.get("md-log")).toBeUndefined();
  });
});

describe("observers never break the session", () => {
  test("a failed write is reported and the event still completes", async () => {
    writeFileSync(note, "");
    await run("md-log", "notes.md");
    rmSync(note);
    mkdirSync(note);
    await expect(say({ role: "user", content: "Hi" })).resolves.toBeDefined();
    expect(omp.notifications.at(-1)?.type).toBe("error");
    expect(omp.notifications.at(-1)?.message).toMatch(/^md-log: .*EISDIR/);
  });

  test("a note deleted after linking is recreated by the next entry", async () => {
    writeFileSync(note, "");
    await run("md-log", "notes.md");
    rmSync(note);
    await say({ role: "user", content: "Hi" });
    expect(read()).toBe("> [!quote] YOU\n\nHi\n");
  });
});
