// plugins/visual-tools/src/renderer/cli.ts
import { spawnSync } from "node:child_process";
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
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// plugins/visual-tools/src/core/install.ts
var FNV64_OFFSET = 0xcbf29ce484222325n;
var FNV64_PRIME = 0x100000001b3n;
var MASK64 = 0xffffffffffffffffn;
var HASH_HEX_LENGTH = 16;
function lockHash(lockText) {
  let h = FNV64_OFFSET;
  for (let i = 0; i < lockText.length; i++) {
    h ^= BigInt(lockText.charCodeAt(i));
    h = h * FNV64_PRIME & MASK64;
  }
  return h.toString(HASH_HEX_LENGTH).padStart(HASH_HEX_LENGTH, "0");
}
function cacheRoot(env) {
  const xdg = env.XDG_CACHE_HOME;
  if (xdg !== void 0 && xdg.startsWith("/")) return `${xdg.replace(/\/+$/, "")}/learning-plugins/visual-tools`;
  const home = env.HOME;
  if (home === void 0 || !home.startsWith("/")) {
    throw new Error("Cannot locate a cache directory: set HOME or an absolute XDG_CACHE_HOME.");
  }
  return `${home.replace(/\/+$/, "")}/.cache/learning-plugins/visual-tools`;
}
function installPaths(lockText, env) {
  const hash = lockHash(lockText);
  const dir = `${cacheRoot(env)}/${hash}`;
  return { hash, dir, marker: `${dir}/.installed` };
}

// plugins/visual-tools/src/core/protocol.ts
var EXISTS_EXIT_CODE = 3;
var INSTALL_EXIT_CODE = 4;
var EXIT = { ok: 0, render: 1, usage: 2, exists: EXISTS_EXIT_CODE, install: INSTALL_EXIT_CODE };
var UsageError = class extends Error {
};
var VALID_FLAGS = { "--kind": true, "--in": true, "--out": true };
function flagsFrom(args) {
  const seen = /* @__PURE__ */ new Map();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === void 0 || !Object.hasOwn(VALID_FLAGS, flag)) throw new UsageError(`unknown argument "${flag}"`);
    if (value === void 0 || value.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    if (seen.has(flag)) throw new UsageError(`${flag} given twice`);
    seen.set(flag, value);
  }
  return seen;
}
function parseRenderArgs(args) {
  const seen = flagsFrom(args);
  const kind = seen.get("--kind");
  const input = seen.get("--in");
  const output = seen.get("--out");
  if (kind === void 0 || input === void 0 || output === void 0) {
    throw new UsageError("usage: render.js --kind mermaid|svg --in <abs> --out <abs>");
  }
  if (kind !== "mermaid" && kind !== "svg") throw new UsageError(`--kind must be mermaid or svg, got "${kind}"`);
  for (const [flag, path] of [["--in", input], ["--out", output]]) {
    if (!path.startsWith("/")) throw new UsageError(`${flag} must be an absolute path, got "${path}"`);
  }
  if (!output.endsWith(".png")) throw new UsageError(`--out must end in .png, got "${output}"`);
  return { kind, input, output };
}

// plugins/visual-tools/src/renderer/cli.ts
var CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium"
];
var CliError = class extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.code = code;
  }
};
var RENDERER_DIR = dirname(fileURLToPath(import.meta.url));
function manualInstallCommand(paths) {
  return [
    `mkdir -p '${paths.dir}'`,
    `cp '${join(RENDERER_DIR, "package.json")}' '${join(RENDERER_DIR, "package-lock.json")}' '${paths.dir}/'`,
    `cd '${paths.dir}'`,
    "PUPPETEER_SKIP_DOWNLOAD=1 npm ci --ignore-scripts --no-audit --no-fund",
    "touch .installed"
  ].join(" && ");
}
var STALE_STAGING_MS = 20 * 6e4;
var NPM_CI_TIMEOUT_MS = 54e4;
var MAX_BUFFER_BYTES = 64 * 1024 * 1024;
var NPM_ERROR_LINES = 8;
var MIN_NODE_MAJOR = 22;
var MIN_NODE_MINOR = 13;
var RUNTIME_PACKAGES = { mermaid: "@mermaid-js/mermaid-cli", resvg: "@resvg/resvg-js" };
function reclaimStaging(paths) {
  const root = dirname(paths.dir);
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    const reaping = name.startsWith(`${paths.hash}.reap-`);
    if (!reaping && !name.startsWith(`${paths.hash}.tmp-`)) continue;
    const candidate = join(root, name);
    try {
      const stat = lstatSync(candidate);
      const touchedMs = reaping ? stat.ctimeMs : stat.mtimeMs;
      if (!stat.isDirectory() || Date.now() - touchedMs < STALE_STAGING_MS) continue;
      const claimed = join(root, `${paths.hash}.reap-${randomUUID()}`);
      renameSync(candidate, claimed);
      rmSync(claimed, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
function foreignDestination(paths) {
  return new CliError(`Renderer cache path ${paths.dir} exists without .installed. Move it aside and retry; it was not removed.`, EXIT.install);
}
function npmFailure(r, paths) {
  const why = r.error ? String(r.error) : (r.stderr || r.stdout).split("\n").filter((l) => l.replace(/^npm error\s*/, "") !== "").slice(0, NPM_ERROR_LINES).join("\n");
  return new CliError(`Renderer install failed:
${why}

Install manually with:
  ${manualInstallCommand(paths)}`, EXIT.install);
}
function publishStaging(staging, paths) {
  try {
    if (existsSync(paths.marker)) return;
    if (existsSync(paths.dir)) throw foreignDestination(paths);
    renameSync(staging, paths.dir);
  } catch (error) {
    if (existsSync(paths.marker)) return;
    if (existsSync(paths.dir)) throw foreignDestination(paths);
    throw error;
  }
}
function install(paths) {
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
      env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "1", PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}` }
    });
    if (r.status !== 0) throw npmFailure(r, paths);
    writeFileSync(join(staging, ".installed"), `${paths.hash}
`);
    publishStaging(staging, paths);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
function findChrome() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const found = CHROME_CANDIDATES.find((c) => existsSync(c));
  if (found === void 0) {
    throw new CliError(
      "No Chrome or Chromium found. Install Google Chrome, or set PUPPETEER_EXECUTABLE_PATH to a Chrome binary.",
      EXIT.render
    );
  }
  return found;
}
async function renderTo(req, tmpPng, paths) {
  const require2 = createRequire(join(paths.dir, "package.json"));
  if (req.kind === "svg") {
    const { Resvg } = require2(RUNTIME_PACKAGES.resvg);
    const svg = readFileSync(req.input, "utf8");
    const png = new Resvg(svg, { fitTo: { mode: "zoom", value: 2 }, font: { loadSystemFonts: true, defaultFontFamily: "sans-serif" } }).render().asPng();
    writeFileSync(tmpPng, png);
    return;
  }
  const mmdc = await import(pathToFileURL(require2.resolve(RUNTIME_PACKAGES.mermaid)).href);
  await mmdc.run(req.input, tmpPng, {
    quiet: true,
    outputFormat: "png",
    puppeteerConfig: { headless: "shell", executablePath: findChrome(), args: ["--no-sandbox"] },
    parseMMDOptions: { backgroundColor: "white", viewport: { width: 0, height: 0, deviceScaleFactor: 2 } }
  });
}
function assertNodeVersion() {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major > MIN_NODE_MAJOR || major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR) return;
  throw new CliError(`render.js needs Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} (mermaid-cli); ${process.execPath} is ${process.version}.`, EXIT.usage);
}
function publishPng(tmpPng, out) {
  if (!existsSync(tmpPng)) throw new CliError("renderer produced no PNG", EXIT.render);
  mkdirSync(dirname(out), { recursive: true });
  try {
    copyFileSync(tmpPng, out, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code === "EEXIST") throw new CliError(`--out already exists: ${out}`, EXIT.exists);
    throw error;
  }
}
async function main(args) {
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
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
  process.exit(code);
}
