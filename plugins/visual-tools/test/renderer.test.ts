import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { beforeAll, describe, expect, test } from "vitest";
import { installPaths } from "../src/core/install.ts";
import { EXIT } from "../src/core/protocol.ts";

const PLUGIN = join(import.meta.dirname, "..");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const run = promisify(execFile);

/** Bundle render.js the way the build does and put it beside the given package files. */
async function bundle(dir: string, packageJson: string, lock: string): Promise<string> {
  mkdirSync(join(dir, "renderer"), { recursive: true });
  writeFileSync(join(dir, "renderer", "package.json"), packageJson);
  writeFileSync(join(dir, "renderer", "package-lock.json"), lock);
  const out = join(dir, "renderer", "render.js");
  await build({ entryPoints: [join(PLUGIN, "src/renderer/cli.ts")], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "warning" });
  return out;
}

/** Run render.js; never throws, so tests can assert on exit codes. */
async function render(script: string, cache: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  try {
    await run("node", [script, ...args], { env: { ...process.env, XDG_CACHE_HOME: cache, ...env }, timeout: 600_000 });
    return { code: 0, stderr: "" };
  } catch (error) {
    const e = error as { code?: number; stderr?: string };
    return { code: e.code ?? -1, stderr: e.stderr ?? "" };
  }
}

describe("render.js without network", () => {
  let dir: string;
  let script: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "vt-cli-"));
    // package.json and lockfile out of sync: `npm ci` refuses before touching the network.
    script = await bundle(
      dir,
      '{"name":"r","version":"0.0.0","private":true,"type":"module","dependencies":{"left-pad":"1.3.0"}}\n',
      '{"name":"r","version":"0.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"r","version":"0.0.0"}}}\n',
    );
    writeFileSync(join(dir, "in.svg"), "<svg/>");
  });

  test("bad arguments exit 2 with the reason, before any install", async () => {
    const cache = mkdtempSync(join(tmpdir(), "vt-cache-"));
    const r = await render(script, cache, ["--kind", "png", "--in", join(dir, "in.svg"), "--out", join(dir, "o.png")]);
    expect(r).toEqual({ code: EXIT.usage, stderr: '--kind must be mermaid or svg, got "png"\n' });
    expect(readdirSync(cache)).toEqual([]);
  });

  test("a missing --in file exits 2 naming it", async () => {
    const r = await render(script, mkdtempSync(join(tmpdir(), "vt-cache-")), ["--kind", "svg", "--in", join(dir, "nope.svg"), "--out", join(dir, "o.png")]);
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain(join(dir, "nope.svg"));
  });

  test("a failed install exits 4 with npm's reason and the manual command, and leaves nothing behind to block a retry", async () => {
    const cache = mkdtempSync(join(tmpdir(), "vt-cache-"));
    const r = await render(script, cache, ["--kind", "svg", "--in", join(dir, "in.svg"), "--out", join(dir, "o.png")]);
    expect(r.code).toBe(EXIT.install);
    expect(r.stderr).toContain("Missing: left-pad@1.3.0 from lock file");
    expect(r.stderr).toMatch(/Install manually with:\n {2}mkdir -p '.+' && cp .+ && PUPPETEER_SKIP_DOWNLOAD=1 npm ci --ignore-scripts --no-audit --no-fund && touch \.installed/);
    expect(readdirSync(join(cache, "learning-plugins", "visual-tools"))).toEqual([]);
    expect(existsSync(join(dir, "o.png"))).toBe(false);
    const retry = await render(script, cache, ["--kind", "svg", "--in", join(dir, "in.svg"), "--out", join(dir, "retry.png")]);
    expect(retry.code).toBe(EXIT.install);
    expect(readdirSync(join(cache, "learning-plugins", "visual-tools"))).toEqual([]);
  });

  test("the next invocation reclaims killed-install staging older than 20 minutes, not a live peer, a live reaper or an unowned destination", async () => {
    const cache = mkdtempSync(join(tmpdir(), "vt-cache-"));
    const paths = installPaths(readFileSync(join(dir, "renderer/package-lock.json"), "utf8"), { XDG_CACHE_HOME: cache });
    const root = join(cache, "learning-plugins", "visual-tools");
    mkdirSync(root, { recursive: true });
    const abandoned = join(root, `${paths.hash}.tmp-killed`);
    const active = join(root, `${paths.hash}.tmp-active`);
    // A reaper claimed this a moment ago: its mtime is old (rename keeps it) but its ctime is now.
    const reaping = join(root, `${paths.hash}.reap-live`);
    for (const d of [abandoned, active, reaping]) mkdirSync(d);
    writeFileSync(join(abandoned, "partial"), "bytes from killed npm");
    const old = new Date(Date.now() - 21 * 60_000);
    utimesSync(abandoned, old, old);
    utimesSync(reaping, old, old);
    const args = ["--kind", "svg", "--in", join(dir, "in.svg"), "--out", join(dir, "recovered.png")];
    expect((await render(script, cache, args)).code).toBe(EXIT.install); // fixture's lock is intentionally invalid
    // The abandoned stage is gone without a leftover reap dir; the failed install's own stage is gone too.
    expect(readdirSync(root).sort()).toEqual([`${paths.hash}.reap-live`, `${paths.hash}.tmp-active`]);
    mkdirSync(paths.dir);
    writeFileSync(join(paths.dir, "foreign"), "do not delete");
    const blocked = await render(script, cache, args);
    expect(blocked.code).toBe(EXIT.install);
    expect(blocked.stderr).toContain("Move it aside and retry");
    expect(readFileSync(join(paths.dir, "foreign"), "utf8")).toBe("do not delete");
  });
});

// Downloads ~100 MB and installs ~450 MB into a temp cache: opt in with VT_RENDER_IT=1.
describe.runIf(process.env.VT_RENDER_IT === "1")("render.js with the real renderer (VT_RENDER_IT=1)", () => {
  let dir: string;
  let script: string;
  let cache: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "vt-it-"));
    cache = mkdtempSync(join(tmpdir(), "vt-it-cache-"));
    script = await bundle(
      dir,
      readFileSync(join(PLUGIN, "renderer/package.json"), "utf8"),
      readFileSync(join(PLUGIN, "renderer/package-lock.json"), "utf8"),
    );
    writeFileSync(join(dir, "ok.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>');
    writeFileSync(join(dir, "ok.mmd"), "graph TD\n  A[packet] --> B[stream]\n");
    writeFileSync(join(dir, "bad.mmd"), "graph TD\n  A -->\n  ][\n");
  }, 600_000);

  test("an offline failed install using the shipped lock retries successfully with the same cache", async () => {
    const retryCache = mkdtempSync(join(tmpdir(), "vt-retry-"));
    const npmCache = mkdtempSync(join(tmpdir(), "vt-empty-npm-"));
    const paths = installPaths(readFileSync(join(PLUGIN, "renderer/package-lock.json"), "utf8"), { XDG_CACHE_HOME: retryCache });
    const args = ["--kind", "svg", "--in", join(dir, "ok.svg"), "--out", join(dir, "recovered.png")];
    const failed = await render(script, retryCache, args, { npm_config_offline: "true", npm_config_cache: npmCache });
    expect(failed.code).toBe(EXIT.install);
    expect(existsSync(paths.marker)).toBe(false);
    expect(readdirSync(join(retryCache, "learning-plugins", "visual-tools"))).toEqual([]);
    expect(await render(script, retryCache, args, { npm_config_offline: "false", npm_config_cache: npmCache })).toEqual({ code: 0, stderr: "" });
    expect(readFileSync(join(dir, "recovered.png")).subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(readFileSync(paths.marker, "utf8")).toBe(`${paths.hash}\n`);
  }, 600_000);

  test("concurrent first renders leave one complete cache and both PNGs", async () => {
    const concurrentCache = mkdtempSync(join(tmpdir(), "vt-concurrent-"));
    const paths = installPaths(readFileSync(join(PLUGIN, "renderer/package-lock.json"), "utf8"), { XDG_CACHE_HOME: concurrentCache });
    const outputs = [join(dir, "parallel-1.png"), join(dir, "parallel-2.png")];
    const results = await Promise.all(outputs.map((out) =>
      render(script, concurrentCache, ["--kind", "svg", "--in", join(dir, "ok.svg"), "--out", out])));
    expect(results).toEqual([{ code: 0, stderr: "" }, { code: 0, stderr: "" }]);
    expect(readFileSync(paths.marker, "utf8")).toBe(`${paths.hash}\n`);
    expect(readdirSync(join(concurrentCache, "learning-plugins", "visual-tools"))).toEqual([paths.hash]);
    for (const out of outputs) expect(readFileSync(out).subarray(0, 8)).toEqual(PNG_SIGNATURE);
  }, 600_000);

  test("shipped package/lock installs once; a second SVG render reuses the same marker", async () => {
    const paths = installPaths(readFileSync(join(PLUGIN, "renderer/package-lock.json"), "utf8"), { XDG_CACHE_HOME: cache });
    const out = join(dir, "svg.png");
    const first = await render(script, cache, ["--kind", "svg", "--in", join(dir, "ok.svg"), "--out", out]);
    expect(first).toEqual({ code: 0, stderr: "" });
    const png = readFileSync(out);
    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([80, 40]); // IHDR width, height
    expect(readFileSync(paths.marker, "utf8")).toBe(`${paths.hash}\n`);
    const marker = statSync(paths.marker);
    expect(await render(script, cache, ["--kind", "svg", "--in", join(dir, "ok.svg"), "--out", join(dir, "svg-2.png")])).toEqual({ code: 0, stderr: "" });
    expect(statSync(paths.marker).ino).toBe(marker.ino); // reinstall would create a different marker
    expect(readdirSync(join(cache, "learning-plugins", "visual-tools"))).toEqual([paths.hash]);
  }, 600_000);

  test("Mermaid renders through the system Chrome", async () => {
    const out = join(dir, "mmd.png");
    expect(await render(script, cache, ["--kind", "mermaid", "--in", join(dir, "ok.mmd"), "--out", out])).toEqual({ code: 0, stderr: "" });
    expect(readFileSync(out).subarray(0, 8)).toEqual(PNG_SIGNATURE);
  }, 120_000);

  test("an existing --out is never overwritten", async () => {
    const out = join(dir, "taken.png");
    copyFileSync(join(dir, "ok.svg"), out);
    const r = await render(script, cache, ["--kind", "svg", "--in", join(dir, "ok.svg"), "--out", out]);
    expect(r.code).toBe(EXIT.exists);
    expect(readFileSync(out, "utf8")).toContain("<svg");
  }, 120_000);

  test("a Mermaid syntax error exits 1 with mermaid's message", async () => {
    const r = await render(script, cache, ["--kind", "mermaid", "--in", join(dir, "bad.mmd"), "--out", join(dir, "bad.png")]);
    expect(r.code).toBe(EXIT.render);
    expect(r.stderr).toMatch(/error on line 3/i);
    expect(existsSync(join(dir, "bad.png"))).toBe(false);
  }, 120_000);
});
