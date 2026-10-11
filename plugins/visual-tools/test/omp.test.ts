import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFakeOmp } from "../../../test-support/fake-omp.ts";
import { installPaths } from "../src/core/install.ts";
import { parseRenderArgs } from "../src/core/protocol.ts";
import { registerVisualTools, type RendererRun } from "../src/omp.ts";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const LOCK = '{"name":"renderer","lockfileVersion":3,"packages":{}}\n';

let root: string;
let cwd: string;
let script: string;
let calls: { argv: string[]; timeoutMs: number }[];
let nextRun: (() => RendererRun) | undefined;

/** Stands in for `node render.js`: a PNG whose bytes carry the source it was given, created exclusively. */
function fakeRenderer(argv: string[], timeoutMs: number): Promise<RendererRun> {
  calls.push({ argv, timeoutMs });
  if (nextRun) return Promise.resolve(nextRun());
  const req = parseRenderArgs(argv.slice(2));
  mkdirSync(join(req.output, ".."), { recursive: true });
  writeFileSync(req.output, Buffer.concat([PNG_SIGNATURE, readFileSync(req.input)]), { flag: "wx" });
  return Promise.resolve({ exitCode: 0, stderr: "" });
}

/** argv of the first renderer run. */
function firstArgv(): string[] {
  const first = calls.at(0);
  if (first === undefined) throw new Error("the renderer never ran");
  return first.argv;
}

/** The private staging dir the first render wrote its source into. */
function firstStagingDir(): string {
  return dirname(parseRenderArgs(firstArgv().slice(2)).input);
}

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Result = { content: Content[]; isError?: boolean };

function imageBytes(result: Result): Buffer {
  const image = result.content.find((c) => c.type === "image");
  if (image?.type !== "image") throw new Error(`no image in ${JSON.stringify(result.content)}`);
  expect(image.mimeType).toBe("image/png");
  return Buffer.from(image.data, "base64");
}

function textOf(result: Result): string {
  return result.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
}

function setup() {
  const fake = createFakeOmp({ cwd });
  let now = 1760000000000;
  registerVisualTools(fake.api, { rendererScript: script, runRenderer: fakeRenderer, now: () => now++, random: () => 0 });
  const call = async (name: string, params: Record<string, string> = {}): Promise<Result> =>
    await fake.tools.get(name)!.execute("call-1", params, undefined, undefined, fake.ctx);
  return { fake, call };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vt-omp-"));
  cwd = join(root, "project");
  mkdirSync(cwd);
  mkdirSync(join(root, "plugin", "renderer"), { recursive: true });
  script = join(root, "plugin", "renderer", "render.js");
  writeFileSync(join(root, "plugin", "renderer", "package-lock.json"), LOCK);
  vi.stubEnv("XDG_CACHE_HOME", join(root, "cache"));
  calls = [];
  nextRun = undefined;
});

afterEach(() => vi.unstubAllEnvs());

test("render returns the PNG of the current (edited) source as an image; previews never touch the project", async () => {
  const { call } = setup();
  await call("write_mermaid", { source: "graph TD\n  A --> B" });
  await call("edit_mermaid", { old_text: "A --> B", new_text: "A --> C" });
  const result = await call("render_mermaid");

  expect(imageBytes(result)).toEqual(Buffer.concat([PNG_SIGNATURE, Buffer.from("graph TD\n  A --> C")]));
  expect(firstArgv().slice(0, 4)).toEqual(["node", script, "--kind", "mermaid"]);
  expect(readdirSync(cwd)).toEqual([]);
  expect(existsSync(firstStagingDir())).toBe(false);
});

test("save_as publishes the rendered PNG into <cwd>/viz under a unique name and returns that name", async () => {
  const { call } = setup();
  await call("write_svg", { source: '<svg width="10" height="10"></svg>' });
  const result = await call("render_svg", { save_as: "Number Line" });

  const filename = "viz-number-line-1760000000000-000000.png";
  expect(readdirSync(join(cwd, "viz"))).toEqual([filename]);
  expect(readFileSync(join(cwd, "viz", filename))).toEqual(imageBytes(result));
  expect(textOf(result)).toContain(`filename: ${filename}`);
  expect(existsSync(firstStagingDir())).toBe(false);
});

test("rendering or editing before writing fails and names the write tool", async () => {
  const { call } = setup();
  await expect(call("render_svg")).rejects.toThrow("No svg source yet: call write_svg first.");
  await expect(call("edit_mermaid", { old_text: "a", new_text: "b" })).rejects.toThrow("call write_mermaid first");
  expect(calls).toEqual([]);
});

test("an edit that does not match exactly once fails and leaves the source as it was", async () => {
  const { call } = setup();
  await call("write_mermaid", { source: "graph TD\n  A --> B\n  B --> C" });
  await expect(call("edit_mermaid", { old_text: "-->", new_text: "==>" })).rejects.toThrow(/matches 2 times/);
  expect(imageBytes(await call("render_mermaid")).subarray(8).toString()).toBe("graph TD\n  A --> B\n  B --> C");
});

test("a failed render is an error result carrying the renderer's stderr and no image", async () => {
  const { call } = setup();
  await call("write_mermaid", { source: "graph TD\n  A -->" });
  nextRun = () => ({ exitCode: 1, stderr: "warming up\nParse error on line 2:\nExpecting 'NODE_STRING'\n" });
  const result = await call("render_mermaid");

  expect(result.isError).toBe(true);
  expect(result.content.map((c) => c.type)).toEqual(["text"]);
  expect(textOf(result)).toContain("Parse error on line 2:\nExpecting 'NODE_STRING'");
  expect(existsSync(firstStagingDir())).toBe(false);
});

test("two sessions (e.g. parallel maker subagents) never see each other's source", async () => {
  const a = setup();
  const b = setup();
  await a.call("write_mermaid", { source: "graph TD\n  A --> B" });
  await expect(b.call("render_mermaid")).rejects.toThrow("call write_mermaid first");
});

test("the first render may install, so it gets ten minutes; once installed, two", async () => {
  const { call } = setup();
  await call("write_svg", { source: "<svg></svg>" });
  await call("render_svg");
  const { marker } = installPaths(LOCK, { XDG_CACHE_HOME: join(root, "cache") });
  mkdirSync(join(marker, ".."), { recursive: true });
  writeFileSync(marker, "");
  await call("render_svg");
  expect(calls.map((c) => c.timeoutMs)).toEqual([600_000, 120_000]);
});
