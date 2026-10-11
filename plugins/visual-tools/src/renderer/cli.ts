/**
 * render.js: renders one Mermaid or SVG source file to a PNG.
 *   node render.js --kind mermaid|svg --in <abs> --out <abs>
 * Exit 0: the PNG exists at --out (created exclusively). Non-zero: stderr tail is the error (see EXIT).
 * First use installs pinned dependencies (./package-lock.json) into the user cache with `npm ci`.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installPaths, type InstallPaths } from "../core/install.ts";
import { EXIT, parseRenderArgs, UsageError, type RenderRequest } from "../core/protocol.ts";

// Ported from .pi/extensions/visual-tools/tools/_common.ts:26-32.
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

class CliError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

const RENDERER_DIR = dirname(fileURLToPath(import.meta.url));

function manualInstallCommand(paths: InstallPaths): string {
  return [
    `mkdir -p '${paths.dir}'`,
    `cp '${join(RENDERER_DIR, "package.json")}' '${join(RENDERER_DIR, "package-lock.json")}' '${paths.dir}/'`,
    `cd '${paths.dir}'`,
    "PUPPETEER_SKIP_DOWNLOAD=1 npm ci --ignore-scripts --no-audit --no-fund",
    "touch .installed",
  ].join(" && ");
}

/** Longer than npm ci's timeout and the host's 600 s render budget: no live installer owns an older stage. */
const STALE_STAGING_MS = 20 * 60_000;
/** npm ci must finish inside the host's 600 s render budget; an in-process failure still runs the finally block. */
const NPM_CI_TIMEOUT_MS = 540_000;
/** npm's usage text after a failure is huge; keep enough buffer for it plus the real error. */
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;
/** npm prints its whole usage text after the real error; the first lines carry the cause. */
const NPM_ERROR_LINES = 8;
/** mermaid-cli 12's `engines`: Node.js >= 22.13. */
const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 13;
/**
 * Runtime packages, resolved from the per-lockfile cache dir at run time; they are never installed in this repo.
 * Named here so both renderers load the same way: `createRequire(<cacheDir>)` (design, Renderer).
 */
const RUNTIME_PACKAGES = { mermaid: "@mermaid-js/mermaid-cli", resvg: "@resvg/resvg-js" } as const;

/**
 * Reclaim this lock's abandoned staging: `<hash>.tmp-*` left by a killed installer (judged by mtime, set when
 * the installer created and filled it) and `<hash>.reap-*` left by a killed reaper (judged by ctime, which the
 * claiming rename sets). Claim by rename first; only the rename's winner deletes. Never touches `<hash>` itself.
 */
function reclaimStaging(paths: InstallPaths): void {
  const root = dirname(paths.dir);
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    const reaping = name.startsWith(`${paths.hash}.reap-`);
    if (!reaping && !name.startsWith(`${paths.hash}.tmp-`)) continue;
    const candidate = join(root, name);
    try {
      const stat = lstatSync(candidate); // do not follow a symlink into another directory
      const touchedMs = reaping ? stat.ctimeMs : stat.mtimeMs;
      if (!stat.isDirectory() || Date.now() - touchedMs < STALE_STAGING_MS) continue;
      const claimed = join(root, `${paths.hash}.reap-${randomUUID()}`);
      renameSync(candidate, claimed); // only the process that wins the rename owns these bytes
      rmSync(claimed, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; // another reaper already claimed it
    }
  }
}

function foreignDestination(paths: InstallPaths): CliError {
  return new CliError(`Renderer cache path ${paths.dir} exists without .installed. Move it aside and retry; it was not removed.`, EXIT.install);
}

function npmFailure(r: SpawnSyncReturns<string>, paths: InstallPaths): CliError {
  const why = r.error
    ? String(r.error)
    : (r.stderr || r.stdout).split("\n").filter((l) => l.replace(/^npm error\s*/, "") !== "").slice(0, NPM_ERROR_LINES).join("\n");
  return new CliError(`Renderer install failed:\n${why}\n\nInstall manually with:\n  ${manualInstallCommand(paths)}`, EXIT.install);
}

/** Move a complete staging dir into place; a concurrent installer that won first is success, a foreign dir is not. */
function publishStaging(staging: string, paths: InstallPaths): void {
  try {
    if (existsSync(paths.marker)) return;
    if (existsSync(paths.dir)) throw foreignDestination(paths);
    renameSync(staging, paths.dir);
  } catch (error) {
    if (existsSync(paths.marker)) return; // a concurrent install completed first
    if (existsSync(paths.dir)) throw foreignDestination(paths);
    throw error;
  }
}

/** npm ci into a private staging dir; rename a complete install without ever deleting a competing destination. */
function install(paths: InstallPaths): void {
  mkdirSync(dirname(paths.dir), { recursive: true });
  if (existsSync(paths.marker)) return;
  if (existsSync(paths.dir)) throw foreignDestination(paths);
  const staging = mkdtempSync(join(dirname(paths.dir), `${paths.hash}.tmp-`));
  try {
    copyFileSync(join(RENDERER_DIR, "package.json"), join(staging, "package.json"));
    copyFileSync(join(RENDERER_DIR, "package-lock.json"), join(staging, "package-lock.json"));
    const r = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], {
      cwd: staging,
      encoding: "utf8",
      timeout: NPM_CI_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      // npm next to the node running us wins, so install and render agree on the Node version.
      env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "1", PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}` },
    });
    if (r.status !== 0) throw npmFailure(r, paths);
    writeFileSync(join(staging, ".installed"), `${paths.hash}\n`);
    publishStaging(staging, paths);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function findChrome(): string {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const found = CHROME_CANDIDATES.find((c) => existsSync(c));
  if (found === undefined) {
    throw new CliError(
      "No Chrome or Chromium found. Install Google Chrome, or set PUPPETEER_EXECUTABLE_PATH to a Chrome binary.",
      EXIT.render,
    );
  }
  return found;
}

interface MermaidCli {
  run(input: string, output: string, opts: object): Promise<void>;
}
interface ResvgModule {
  Resvg: new (svg: string, opts: object) => { render(): { asPng(): Uint8Array } };
}

async function renderTo(req: RenderRequest, tmpPng: string, paths: InstallPaths): Promise<void> {
  const require = createRequire(join(paths.dir, "package.json"));
  if (req.kind === "svg") {
    const { Resvg } = require(RUNTIME_PACKAGES.resvg) as ResvgModule;
    const svg = readFileSync(req.input, "utf8");
    // fitTo zoom 2 = rsvg-convert -z 2 in the original (svg_tools.ts:49).
    const png = new Resvg(svg, { fitTo: { mode: "zoom", value: 2 }, font: { loadSystemFonts: true, defaultFontFamily: "sans-serif" } })
      .render()
      .asPng();
    writeFileSync(tmpPng, png);
    return;
  }
  // Dynamic on purpose: the module lives in the per-lockfile cache dir, known only at run time.
  const mmdc = (await import(pathToFileURL(require.resolve(RUNTIME_PACKAGES.mermaid)).href)) as MermaidCli;
  // Same as the original `mmdc -s 2 -b white -p {executablePath, args:[--no-sandbox]}` (mermaid_tools.ts:146-160);
  // mmdc's own default `headless: "shell"` is kept (it merges our config over it, mermaid-cli src/index.js:462-476).
  await mmdc.run(req.input, tmpPng, {
    quiet: true,
    outputFormat: "png",
    puppeteerConfig: { headless: "shell", executablePath: findChrome(), args: ["--no-sandbox"] },
    parseMMDOptions: { backgroundColor: "white", viewport: { width: 0, height: 0, deviceScaleFactor: 2 } },
  });
}

function assertNodeVersion(): void {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major > MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR)) return;
  throw new CliError(`render.js needs Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} (mermaid-cli); ${process.execPath} is ${process.version}.`, EXIT.usage);
}

/** Exclusive create: an existing --out is never overwritten. */
function publishPng(tmpPng: string, out: string): void {
  if (!existsSync(tmpPng)) throw new CliError("renderer produced no PNG", EXIT.render);
  mkdirSync(dirname(out), { recursive: true });
  try {
    copyFileSync(tmpPng, out, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new CliError(`--out already exists: ${out}`, EXIT.exists);
    throw error;
  }
}

async function main(args: readonly string[]): Promise<void> {
  assertNodeVersion();
  const req = parseRenderArgs(args);
  if (!existsSync(req.input)) throw new CliError(`--in does not exist: ${req.input}`, EXIT.usage);
  const paths = installPaths(readFileSync(join(RENDERER_DIR, "package-lock.json"), "utf8"), process.env);
  reclaimStaging(paths);
  if (!existsSync(paths.marker)) install(paths);
  const work = mkdtempSync(join(tmpdir(), "visual-tools-"));
  try {
    const tmpPng = join(work, "out.png");
    await renderTo(req, tmpPng, paths);
    publishPng(tmpPng, req.output);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

try {
  await main(process.argv.slice(2));
  process.exit(EXIT.ok);
} catch (error) {
  const code = error instanceof CliError ? error.code : error instanceof UsageError ? EXIT.usage : EXIT.render;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(code);
}
