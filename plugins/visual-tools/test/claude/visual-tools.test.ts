import type { On } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

const LOCK = '{"name":"renderer","lockfileVersion":3,"packages":{}}\n';
const PNG_B64 = "iVBORw0KGgo="; // the PNG signature: stands for whatever render.js wrote
const NOW = 1760000000000;
const T = (id: string) => `mcp__visual-tools__${id}` as const;

type Run = { argv: readonly string[]; timeoutMs?: number };
type Fake = { exitCode?: number; stderr?: string; size?: number; installed?: boolean; startFails?: boolean };

/**
 * Stands in for Claude Code: the host fs (files written by the mod, the lockfile, the PNG render.js made),
 * the renderer process, env, clock and cwd. Returns what the test inspects afterwards.
 */
function host(on: On, fake: Fake = {}) {
  const written = new Map<string, string>();
  const runs: Run[] = [];
  const removed: string[] = [];
  on("tool.register", ($, e) => {
    return { value: { tool: T(e.name) } };
  });
  on("session.start", () => ({ cwd: "/work/notes" }));
  on("tool.call", () => ({ result: "NOT ANSWERED BY THE MOD" }));
  mock.env(on, { HOME: "/home/u" });
  on("session.end", ($, e) => ({ sessionId: e.sessionId })); // core's echo (cc.d.ts:8910-8915), as in md-log's kit
  mock.clock(on, { now: NOW });
  on("session.cwd", () => ({ value: "/work/notes" }));
  on("fs.write", ($, e) => {
    written.set(e.path, e.text);
    return { value: undefined };
  });
  on("fs.exists", () => ({ value: fake.installed ?? true }));
  on("fs.stat", () => ({ value: { kind: "file", size: fake.size ?? 8, mtimeMs: NOW, isLink: false } }));
  on("fs.read", ($, e) => {
    if (e.path.endsWith("/renderer/package-lock.json")) return { value: LOCK };
    if (e.as === "bytes") return { value: { base64: PNG_B64 } };
    return { deny: `unexpected read of ${e.path}` };
  });
  on("process.run", ($, e) => {
    runs.push({ argv: e.argv, timeoutMs: e.init?.timeoutMs });
    if (e.argv[0] === "rm") {
      removed.push(...e.argv.slice(3));
      return { value: { exitCode: 0, stdout: "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
    }
    if (fake.startFails) return { deny: "spawn node ENOENT" };
    return { value: { exitCode: fake.exitCode ?? 0, stdout: "", stderr: fake.stderr ?? "", isStdoutTruncated: false, isStderrTruncated: false } };
  });
  return { written, removed, runs };
}

/** The value after a flag in a recorded renderer argv. */
const flag = (run: Run | undefined, name: string) => run?.argv[run.argv.indexOf(name) + 1];

test("render runs render.js on the edited source and returns the PNG as an Anthropic image block", async ($, on) => {
  const h = host(on);
  await $.tool.call({ tool: T("write_mermaid"), source: "graph TD\n  A --> B" });
  await $.tool.call({ tool: T("edit_mermaid"), old_text: "A --> B", new_text: "A --> C" });
  const answer = await $.tool.call({ tool: T("render_mermaid") });

  const run = h.runs[0];
  expect(run?.argv[0]).toBe("node");
  expect(run?.argv[1]).toMatch(/\/renderer\/render\.js$/);
  expect(flag(run, "--kind")).toBe("mermaid");
  expect(run?.timeoutMs).toBe(120_000);
  expect(h.written.get(flag(run, "--in") ?? "")).toBe("graph TD\n  A --> C");
  expect(flag(run, "--out")).toMatch(/^\/home\/u\/\.cache\/learning-plugins\/visual-tools\/previews\/viz-preview-1760000000000-[0-9a-z]{6}\.png$/);
  expect(answer.deny).toBeUndefined();
  expect(Array.isArray(answer.result) ? answer.result[1] : undefined).toEqual({
    type: "image",
    source: { type: "base64", media_type: "image/png", data: PNG_B64 },
  });
  expect(h.removed).toEqual([flag(run, "--in"), flag(run, "--out")]);
});

test("save_as renders straight into <cwd>/viz under a unique name and returns the name", async ($, on) => {
  const h = host(on);
  await $.tool.call({ tool: T("write_svg"), source: '<svg width="10" height="10"></svg>' });
  const answer = await $.tool.call({ tool: T("render_svg"), save_as: "number-line" });

  const out = flag(h.runs[0], "--out") ?? "";
  expect(out).toMatch(/^\/work\/notes\/viz\/viz-number-line-1760000000000-[0-9a-z]{6}\.png$/);
  const text = Array.isArray(answer.result) ? (answer.result[0] as { text: string }).text : "";
  expect(text).toContain(`filename: ${out.slice("/work/notes/viz/".length)}`);
  expect(h.removed).toEqual([flag(h.runs[0], "--in")]); // published PNG survives
});

test("rendering before writing is an error naming the CC write tool, and runs nothing", async ($, on) => {
  const h = host(on);
  const answer = await $.tool.call({ tool: T("render_svg") });
  expect(answer).toEqual({ deny: "No svg source yet: call mcp__visual-tools__write_svg first." });
  expect(h.runs).toEqual([]);
});

test("an edit matching twice is an error naming the count", async ($, on) => {
  host(on);
  await $.tool.call({ tool: T("write_mermaid"), source: "graph TD\n  A --> B\n  B --> C" });
  const answer = await $.tool.call({ tool: T("edit_mermaid"), old_text: "-->", new_text: "==>" });
  expect(answer).toEqual({ deny: expect.stringContaining("matches 2 times") });
});

test("each agent loop has its own source", async ($, on) => {
  host(on);
  await $.tool.call({ tool: T("write_mermaid"), source: "graph TD\n  A --> B", agentId: "maker-1" });
  const fromMain = await $.tool.call({ tool: T("render_mermaid") });
  const fromMaker = await $.tool.call({ tool: T("render_mermaid"), agentId: "maker-1" });
  expect(fromMain).toEqual({ deny: "No mermaid source yet: call mcp__visual-tools__write_mermaid first." });
  expect(fromMaker.deny).toBeUndefined();
});

for (const reason of ["clear", "resume"] as const) {
  test(`session.end (${reason}) discards old main and maker sources without another session.start`, async ($, on) => {
    const h = host(on);
    await $.tool.call({ tool: T("write_svg"), source: "<svg></svg>" });
    await $.tool.call({ tool: T("write_mermaid"), source: "graph TD\n  A-->B", agentId: "maker-1" });
    await $.session.end({ reason, sessionId: "old", resume: { id: "old" } });
    const main = await $.tool.call({ tool: T("render_svg") });
    const maker = await $.tool.call({ tool: T("render_mermaid"), agentId: "maker-1" });
    expect(main).toEqual({ deny: "No svg source yet: call mcp__visual-tools__write_svg first." });
    expect(maker).toEqual({ deny: "No mermaid source yet: call mcp__visual-tools__write_mermaid first." });
    expect(h.runs).toEqual([]);
  });
}

test("a render that may install gets 600 s", async ($, on) => {
  const h = host(on, { installed: false });
  await $.tool.call({ tool: T("write_svg"), source: "<svg></svg>" });
  await $.tool.call({ tool: T("render_svg") });
  expect(h.runs.filter((r) => r.argv[0] === "node").map((r) => r.timeoutMs)).toEqual([600_000]);
});

test("a failed render is an error carrying the renderer's stderr", async ($, on) => {
  const h = host(on, { exitCode: 1, stderr: "Parse error on line 2:\nExpecting 'NODE_STRING'\n" });
  await $.tool.call({ tool: T("write_mermaid"), source: "graph TD\n  A -->" });
  const answer = await $.tool.call({ tool: T("render_mermaid") });
  expect(answer).toEqual({ deny: expect.stringContaining("Parse error on line 2:\nExpecting 'NODE_STRING'") });
  expect(h.removed).toEqual([flag(h.runs[0], "--in")]);
});

test("node that cannot start is an error telling the user what is needed", async ($, on) => {
  const h = host(on, { startFails: true });
  await $.tool.call({ tool: T("write_svg"), source: "<svg></svg>" });
  const answer = await $.tool.call({ tool: T("render_svg") });
  expect(answer).toEqual({ deny: expect.stringContaining("needs Node.js >= 22.13 on PATH") });
  expect(h.removed).toEqual([flag(h.runs[0], "--in")]);
});

test("a PNG over 4 MiB is an error, not an image", async ($, on) => {
  const h = host(on, { size: 4 * 1024 * 1024 + 1 });
  await $.tool.call({ tool: T("write_svg"), source: "<svg></svg>" });
  const answer = await $.tool.call({ tool: T("render_svg") });
  expect(answer).toEqual({ deny: expect.stringContaining("over the 4 MiB") });
  expect(h.removed).toEqual([flag(h.runs[0], "--in"), flag(h.runs[0], "--out")]);
});

test("an oversized published image is removed rather than left in viz", async ($, on) => {
  const h = host(on, { size: 4 * 1024 * 1024 + 1 });
  await $.tool.call({ tool: T("write_svg"), source: "<svg></svg>" });
  const answer = await $.tool.call({ tool: T("render_svg"), save_as: "oversized" });
  expect(answer).toEqual({ deny: expect.stringContaining("over the 4 MiB") });
  expect(h.removed).toEqual([flag(h.runs[0], "--in"), flag(h.runs[0], "--out")]);
});
