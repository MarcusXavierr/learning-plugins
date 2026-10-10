# Phase 1: Skeleton

This phase creates the npm workspace and its toolchain, vendored Claude Code (CC) types, the tool map, the build and prompt generator, both catalogs, the omp test fake and CI. A throwaway `hello` plugin proves the whole path in both real harnesses: a command, a tool that returns an image, and a probe that answers open question 4. The phase answers open question 1, records what it found in the design doc, and deletes `hello`. A small CC fixture under `build/test/fixtures/` remains outside the marketplace so CI still validates a bundled mod and executes its command test after `hello` is gone.

**Prerequisites:**

- Read the master plan ([`../2026-10-10-learning-plugins-plan.md`](../2026-10-10-learning-plugins-plan.md)) and the design ([`../2026-10-10-learning-plugins-design.md`](../2026-10-10-learning-plugins-design.md)).
- `/home/marcus/tmp/learn/learning-plugins` is already a git repo on `main` with `origin` set to `https://github.com/MarcusXavierr/learning-plugins.git`. It holds 5 doc commits and an untracked `.nvmrc` (`v24.15.0`). **Do not push** in this phase; Phase 5 pushes.
- `claude --version` prints `2.1.296 (Claude Code)`, `omp --version` prints `omp/18.2.10`, and `source ~/.nvm/nvm.sh && nvm use 24.15.0` works (`nvm use 24` does not, on this machine).
- `/tmp/cc.d.ts` exists (CC 2.1.277 mod types). If it doesn't, Task 2 has a fallback.
- **Shell note:** agent shells here export `CI=true`. Under it, Vitest **fails** on a missing golden file instead of writing it. Every task that adds a golden creates it with `npx vitest run -u <file>`, then you read it against the expected content in this plan.

All commands run from `/home/marcus/tmp/learn/learning-plugins` after `source ~/.nvm/nvm.sh && nvm use 24.15.0`, unless a step says otherwise.

## Acceptance tests

1. **Given** a clean clone at the end of this phase, **when** `npm ci && npm run typecheck && npm test && npm run check && npm run validate && npm run test:claude` runs on Node 24.15.0, **then** every step exits 0. The last two commands strictly validate and plugin-test the built `alpha` fixture even though the marketplace is empty. `.github/workflows/ci.yml` runs exactly this chain, with Claude Code 2.1.296 installed.
2. **Given** a built plugin, **when** a source change that alters output is left unbuilt, **then** `npm run check` exits 1 and names every stale, missing, or extra generated file.
3. **Given** the `hello` plugin, **when** it is loaded in CC (`--plugin-dir`) and in omp (installed from this repo as a local marketplace), **then** `/hello Ada` prints `Hello, Ada!`, and after the model calls `hello_image` it names the colour red. This holds in both harnesses.
4. **Given** a harness-neutral agent or skill using `{{tool:…}}`, `{{agent:…}}` and `{{dispatch:…}}`, **when** it is rendered, **then** omp gets the `task` call shape and CC gets the `Agent` call shape, byte-for-byte equal to the golden files. An unknown id, unknown placeholder or frontmatter key, or a legacy literal fails with a `PromptError` naming the file.
5. **Given** the phase is done, **then** the design doc records the answers to open questions 1 and 4 and the vendored CC types version, and `hello` is gone from `plugins/`, `dist/` and both catalogs.

## Facts this phase relies on (checked while writing it)

Grounded in source, types, or a throwaway prototype of this whole phase in `/tmp/skel-proto`, in which typecheck, 44 Vitest tests, build, check, validate and `claude plugin test` all passed.

| Fact | Evidence |
|---|---|
| TypeScript 7.0.2 accepts `module`/`moduleResolution: nodenext`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noEmit`. It reports missing `.ts` extensions (TS2835), enums (TS1294) and misspelled CC event names (TS2345). | prototype `tsc -p tsconfig.json --noEmit` |
| The vendored CC types are ambient (`declare module 'claude-code'`, `'claude-code/testing'`). They also declare web globals inside `declare module 'claude-code' { global {…} }`. Next to `@types/node` they typecheck cleanly with `skipLibCheck: true`. | `claude-code/index.d.ts:101, 14754, 14882` (2.1.296) |
| On an interactive `--plugin-dir` load, CC 2.1.296 writes `.claude-plugin/types/{.gitignore (*), claude-code/index.d.ts, claude-code-tools/index.d.ts, claude-code-mcp/index.d.ts, tsconfig.json}`, and adds `tsconfig.json` at the plugin root (`{"extends": "./.claude-plugin/types/tsconfig.json"}`). | live probe in `/tmp/cc-types-probe`; `/tmp/create.md:268-286` |
| In the CC test kit, `$.command.run` takes the whole `CommandRunInput` (`origin` and `presentation` are required by the type), while `$.tool.call({ tool })` typechecks as is. | `claude-code/index.d.ts` `Engine`/`EngineCall` (testing module) |
| `claude plugin validate --strict` fails on a marketplace without a top-level `description`, and on one with `"plugins": []`. | prototype runs |
| `claude plugin validate --strict` and `claude plugin test` both pass with an empty `HOME`, so no login is needed. | `env -i HOME=/tmp/emptyhome …` |
| Without a matching plugin to load, `claude plugin test` fails with `no hooks module to load; there is no hooks/hooks.json naming one in "modules"`. | prototype |
| esbuild with `platform: "neutral"` refuses `node:*` imports (`Could not resolve "node:fs"`), so the CC bundle cannot use Node APIs. | prototype |
| omp `task` with `task.batch` (default `true`) takes `{context, tasks: [{agent, task}]}`. CC `Agent` takes `{description, prompt, subagent_type?}`. | `@oh-my-pi/pi-coding-agent@18.2.10` `src/config/settings-schema.ts:5072`, `src/task/types.ts:87-97`; `claude-code-tools/index.d.ts` `BuiltinToolInputs.Agent` |
| omp extension tools default to `loadMode: "discoverable"` (mounted as `xd://` devices). `"essential"` keeps a tool top-level. `parameters` may be a plain JSON Schema object. | `dist/types/extensibility/extensions/types.d.ts:428-435`; `@oh-my-pi/pi-ai` `types.d.ts:1093-1100` (`TSchema = Type \| TJsonSchema`) |
| omp reads project settings (`extensions:`, `skills.customDirectories`) only from `<cwd>/.omp`. Inside `learning-plugins/`, `omp config get extensions --json` returns `[]`, while `/home/marcus/tmp/learn` returns the five `.pi/extensions/*` entries. | `src/discovery/builtin.ts:58-73`, `src/discovery/omp-extension-roots.ts:160-165, 221-235`; live `omp config get` |
| omp **agent** discovery walks every ancestor up to `/` with no repo boundary, so `../.omp/agents/*.md` load as project agents. Those outrank plugin agents. | `src/config.ts:218-247` (`findAllNearestProjectConfigDirs`), `src/task/discovery.ts:74-109` |
| The omp project plugin registry is the nearest ancestor `.omp/`, which from here is `../.omp`. **Never use `--scope project`** from this repo. | `src/discovery/helpers.ts:1024-1058` |
| omp marketplace installs and `omp plugin link` both claim `~/.omp/plugins/node_modules/<package.json name>`, so installing while a link of the same name exists throws `conflicts with installed package`. `omp plugin uninstall @scope/name` removes a link. | `src/extensibility/plugins/marketplace/manager.ts:1008-1021`, `src/extensibility/plugins/manager.ts:693-725` |
| A local marketplace is read in place (no clone). A reinstall at the same version needs `--force`. | `src/extensibility/plugins/marketplace/fetcher.ts:254-260`; `omp://marketplace.md` |
| `@anthropic-ai/claude-code@2.1.296` exists on npm (`bin: claude`, per-platform optional deps, `engines.node >=22`). | `npm view` |
| The pinned packages exist: `typescript@7.0.2`, `vitest@5.0.3`, `esbuild@0.28.2`, `yaml@2.9.1`, `@types/node@24.19.2` (the latest 24.x), `@oh-my-pi/pi-coding-agent@18.2.10`. `npm install` pulls about 2 GB, because pi-coding-agent's peers include `@huggingface/transformers`. | `npm view`, prototype install |

## Contract refinements this phase codes against

The master plan's Shared contracts must say the following. Each task below that introduces one checks the master in the same commit and adds the text if it is missing.

1. **Build module API.** `build/plugin-tree.ts` also exports:
   - `renderPrompts(src: PluginSource, harness: Harness): Promise<Tree>`. Its keys are `agents/<n>.md` and `skills/<s>/**`. Golden tests use it so they don't run esbuild.
   - `listFiles(dir: string): Promise<string[]>`.
2. **`shared/tool-map.ts`** also exports `HARNESSES: readonly Harness[]`, equal to `["omp", "claude"]`.
3. **Catalogs** have a top-level `description` (required by CC `--strict`; omp ignores unknown keys, `fetcher.ts:108-201`).
4. **`diffRepo`** ignores what CC writes into a plugin dir it loads: `dist/claude/*/.claude-plugin/types/**` and `dist/claude/*/tsconfig.json`. The first is self-ignored; `.gitignore` covers the second.
5. **`npm run validate`** runs `claude plugin validate --strict` on a staged built `alpha` fixture on every invocation; it also validates the repo root and every `dist/claude/*` when real plugins exist. An empty marketplace is skipped because CC rejects it under `--strict`, but validation is never a no-op.
6. **Generated trees.**
   - `dist/omp/<name>/package.json` has the `omp` key only when `src/omp.ts` exists.
   - `plugin.json#dependencies` is present only when it is non-empty.
7. **`test-claude`.** Default invocation always stages and runs the `alpha` fixture's `test/claude/alpha.test.ts`, plus every real plugin with CC tests. Explicit `-- <plugin>` runs that plugin alone. CC test files may import only `claude-code/testing` and files under their own `test/claude/`, because the staged built tree holds no `src/`.
8. **Prompt source format additions** (all `PromptError`):
   - an unknown top-level frontmatter key, so per-harness extras go under `harness.<h>`;
   - a `harness.<h>` key that collides with `name`, `description`, `tools` or `model`;
   - a `{{dispatch:…}}` that is not alone on its line;
   - a missing frontmatter;
   - a skill directory without `SKILL.md`.

   Rendering rules:
   - Tools are rendered deduplicated, joined with `", "`.
   - Output is `---\n` + `yaml.stringify(fm, {lineWidth: 0})` + `---\n` + the body with trailing whitespace trimmed + `\n`.
   - A dispatch line becomes the exact block shown in Task 5's golden files, keeping the line's indentation.
9. **Fake omp.** The signature is `createFakeOmp(options?: { cwd?: string; hasUI?: boolean })`. `fake.ctx` holds only `cwd`, `hasUI`, `mode: "tui"` and `ui.notify`, and later phases extend it additively.
10. **Typecheck scope.** `npm run typecheck` also covers `types/claude-code/**` and `vitest.config.ts`; the throwaway probe must live under the former. The root config is `tsconfig.json`; there is no `tsconfig.base.json`, and Task 15 fixes the design's layout to match.
11. **Manifest output safety.** `extraBundles[].entry`/`.out` and `copy[]` are normalized plugin-root-relative paths without empty, `.` or `..` segments or backslashes. `loadPluginSource` checks their shapes before building; `buildTree` rejects duplicate file paths (including a file/directory conflict) across metadata, bundles, copied files and rendered prompts rather than silently overwriting them. `buildRepo` rejects a collision or traversal before `writeRepo` can write any tree.

---

### Task 1: Workspace and toolchain

**Files:**
- Create: `.gitignore`, `package.json`, `tsconfig.json`, `vitest.config.ts`
- Generated: `package-lock.json`
- Commit: `.nvmrc` (already present, untracked)

**Step 1: Write `.gitignore`**

```gitignore
node_modules/
.test-build/
# Claude Code adds this to any plugin dir it loads with --plugin-dir (its .claude-plugin/types/ ignores itself)
dist/claude/*/tsconfig.json
```

**Step 2: Write `package.json`**

```json
{
  "name": "learning-plugins",
  "private": true,
  "type": "module",
  "workspaces": [
    "plugins/*"
  ],
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "build": "node build/cli.ts build",
    "check": "node build/cli.ts check",
    "validate": "node build/cli.ts validate",
    "test:claude": "node build/cli.ts test-claude",
    "types:claude": "node build/cli.ts refresh-claude-types"
  },
  "devDependencies": {
    "@oh-my-pi/pi-coding-agent": "18.2.10",
    "@types/node": "24.19.2",
    "esbuild": "0.28.2",
    "typescript": "7.0.2",
    "vitest": "5.0.3",
    "yaml": "2.9.1"
  }
}
```

`node build/cli.ts` runs through Node 24's type stripping. Everything under `build/` and `shared/` must therefore:

- use erasable syntax only (no `enum`, `namespace`, or parameter properties), which `erasableSyntaxOnly` enforces;
- write relative imports with their `.ts` extension.

**Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  },
  "include": [
    "build",
    "shared",
    "test-support",
    "plugins/*/src",
    "plugins/*/test",
    "types/claude-code",
    "vitest.config.ts"
  ]
}
```

`skipLibCheck` is required. The vendored CC types and `@types/node` both declare `URL`, `AbortController` and `TextEncoder` globals, and this flag keeps them from clashing. Node types are visible in `src/claude.ts` too, so `tsc` won't stop a Node API there. esbuild's `neutral` platform (Task 7) and `validate --strict` are the guard.

**Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "build/**/*.test.ts",
      "shared/**/*.test.ts",
      "test-support/**/*.test.ts",
      "plugins/*/test/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "plugins/*/test/claude/**", "build/test/fixtures/**", "dist/**", ".test-build/**"],
  },
});
```

**Step 5: Install**

Run: `npm install`
Expected: it ends with `added … packages`. It takes about 2–3 minutes and about 2 GB, and creates `package-lock.json`. `npm warn deprecated boolean@3.2.0` is expected.

**Step 6: Typecheck the empty project**

Run: `npm run typecheck`
Expected: exit 0, no output after the script banner. `vitest.config.ts` is the only input; including it keeps TS18003 "No inputs were found" away.

`npm test` and the `build`/`check`/`validate`/`test:claude`/`types:claude` scripts can't run yet: there are no tests, and `build/cli.ts` arrives in Task 10. Until then no plugin exists, so there is nothing to regenerate before commits.

**Step 7: Commit**

```bash
git add .gitignore .nvmrc package.json package-lock.json tsconfig.json vitest.config.ts
git commit -m "chore: set up npm workspace with TypeScript 7, Vitest and esbuild"
```

---

### Task 2: Vendored Claude Code types (bootstrap)

**Files:**
- Create: `types/claude-code/claude-code/index.d.ts`

The bootstrap copy is the public 2.1.277 file, a single file that also contains the `claude-code/testing` module and the built-in tool inputs. Task 13 replaces it with the version-matched files CC 2.1.296 writes.

**Step 1: Copy the declarations**

```bash
mkdir -p types/claude-code/claude-code
cp /tmp/cc.d.ts types/claude-code/claude-code/index.d.ts
head -1 types/claude-code/claude-code/index.d.ts
```

Expected: `// Written by Claude Code 2.1.277.`

*Fallback if `/tmp/cc.d.ts` is missing.* This gets version-matched files directly; starting the session sends no model request.

```bash
mkdir -p /tmp/lp-cc-probe/.claude-plugin /tmp/lp-cc-probe/hooks
printf '{"name":"lp-cc-probe","version":"0.0.0","description":"types probe","author":{"name":"x"}}\n' > /tmp/lp-cc-probe/.claude-plugin/plugin.json
printf '{"modules":["./register.js"]}\n' > /tmp/lp-cc-probe/hooks/hooks.json
printf 'export function register(on) {}\n' > /tmp/lp-cc-probe/hooks/register.js
(cd /tmp/lp-cc-probe && claude --plugin-dir /tmp/lp-cc-probe)   # accept the trust prompt if shown; once the input box appears, type /exit
mkdir -p types/claude-code/claude-code-tools
cp /tmp/lp-cc-probe/.claude-plugin/types/claude-code/index.d.ts types/claude-code/claude-code/index.d.ts
cp /tmp/lp-cc-probe/.claude-plugin/types/claude-code-tools/index.d.ts types/claude-code/claude-code-tools/index.d.ts
```

**Step 2: Prove that the types are seen (failing probe)**

Create the throwaway file `types/claude-code/probe.ts` (inside the `types/claude-code` tsconfig include):

```ts
import type { Register } from "claude-code";
import type { test } from "claude-code/testing";

export const register: Register = (on) => {
  on("session.strat", async ($, e, next) => next(e));
};
export type Test = typeof test;
```

Run: `npm run typecheck`
Expected: FAIL with `types/claude-code/probe.ts(5,6): error TS2345: Argument of type '"session.strat"' is not assignable to parameter of type 'Pattern'` (and possibly related implicit-any diagnostics). If TS2345 is absent, stop: the probe was not typechecked.

**Step 3: Fix the probe**

Change `"session.strat"` to `"session.start"`.

Run: `npm run typecheck`
Expected: exit 0.

**Step 4: Delete the probe and commit**

```bash
rm types/claude-code/probe.ts
git add types/claude-code
git commit -m "chore: vendor Claude Code mod types (2.1.277 bootstrap)"
```

---

### Task 3: Tool and agent map

**Files:**
- Create: `shared/tool-map.ts`
- Test: `shared/tool-map.test.ts`

**Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { agentName, toolName } from "./tool-map.ts";

test("an unknown tool id throws an error naming the id", () => {
  expect(() => toolName("web_fetcher", "claude")).toThrow('unknown tool id "web_fetcher"');
});

test("an unknown agent id throws an error naming the id", () => {
  expect(() => agentName("visual-tools/nobody", "omp")).toThrow('unknown agent id "visual-tools/nobody"');
});

test("inherited object keys are not tool or agent ids", () => {
  expect(() => toolName("constructor", "omp")).toThrow('unknown tool id "constructor"');
  expect(() => agentName("toString", "claude")).toThrow('unknown agent id "toString"');
});
```

**Step 2: Run it**

Run: `npx vitest run shared/tool-map.test.ts`
Expected: FAIL with `Error: Cannot find module './tool-map.ts' imported from …/shared/tool-map.test.ts`.

**Step 3: Implement**

```ts
/** The two harnesses every plugin ships to. The one definition; build/ imports it from here. */
export type Harness = "omp" | "claude";

export const HARNESSES: readonly Harness[] = ["omp", "claude"];

/** Abstract tool id → per-harness tool name. A CC mod tool is `mcp__<plugin>__<tool>`. */
export const TOOLS: Record<string, Record<Harness, string>> = {
  quiz: { omp: "quiz", claude: "mcp__quiz__quiz" },
  ask: { omp: "ask", claude: "AskUserQuestion" },
  read: { omp: "read", claude: "Read" },
  web_search: { omp: "web_search", claude: "WebSearch" },
  web_fetch: { omp: "read", claude: "WebFetch" },
};

/** "<plugin>/<agent>" → per-harness agent name: `<agent>` in omp, `<plugin>:<agent>` in CC. */
export const AGENTS: Record<string, Record<Harness, string>> = {};

function lookup(map: Record<string, Record<Harness, string>>, kind: string, id: string, h: Harness): string {
  const entry = Object.hasOwn(map, id) ? map[id] : undefined;
  if (entry === undefined) throw new Error(`unknown ${kind} id "${id}"`);
  return entry[h];
}

export function toolName(id: string, h: Harness): string {
  return lookup(TOOLS, "tool", id, h);
}

export function agentName(id: string, h: Harness): string {
  return lookup(AGENTS, "agent", id, h);
}
```

**Step 4: Run it**

Run: `npx vitest run shared/tool-map.test.ts && npm run typecheck`
Expected: 3 passed; typecheck exit 0.

**Step 5: Commit**

Check that the master plan's tool-map contract lists `HARNESSES` (refinement 2), and add it if missing.

```bash
git add shared/tool-map.ts shared/tool-map.test.ts docs/plans/2026-10-10-learning-plugins-plan.md
git commit -m "feat(shared): tool and agent map with per-harness names"
```

---

### Task 4: Plugin source manifest loader

**Files:**
- Create: `build/plugin-source.ts`
- Test: `build/test/plugin-source.test.ts`

**Step 1: Write the failing test**

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { loadPluginSource } from "../plugin-source.ts";

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); });

async function pluginDir(name: string, manifest: object): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lp-src-"));
  roots.push(root);
  const dir = join(root, name);
  await mkdir(dir);
  await writeFile(join(dir, "package.json"), JSON.stringify(manifest));
  return dir;
}

test("a manifest without a description fails, naming the file and the field", async () => {
  const dir = await pluginDir("demo", { name: "@learning-plugins/demo", version: "0.1.0" });
  await expect(loadPluginSource(dir)).rejects.toThrow(`${join(dir, "package.json")}: "description" must be a non-empty string`);
});

test("a manifest without a version fails", async () => {
  const dir = await pluginDir("demo", { name: "@learning-plugins/demo", description: "d" });
  await expect(loadPluginSource(dir)).rejects.toThrow('"version" must be a non-empty string');
});

test("a package name that does not match the directory fails", async () => {
  const dir = await pluginDir("demo", { name: "@learning-plugins/other", version: "0.1.0", description: "d" });
  await expect(loadPluginSource(dir)).rejects.toThrow('"name" must be "@learning-plugins/demo"');
});
```

`hasClaude`/`hasOmp` and the optional `plugin` fields get their proof in Task 7, where they show up as tree contents.

**Step 2: Run it**

Run: `npx vitest run build/test/plugin-source.test.ts`
Expected: FAIL with `Cannot find module '../plugin-source.ts'`.

**Step 3: Implement**

```ts
import { access, readFile } from "node:fs/promises";
import { basename, join, posix } from "node:path";

export interface ExtraBundle { entry: string; out: string; platform: "node" | "neutral" }
export interface PluginSource {
  dir: string; name: string; version: string; description: string;
  dependencies: string[]; extraBundles: ExtraBundle[]; copy: string[];
  hasClaude: boolean; hasOmp: boolean;
}

/** Manifest paths must stay inside one plugin in both distribution trees. */
function pluginPath(value: unknown, field: string, fail: (problem: string) => never): string {
  if (
    typeof value !== "string" || value === "" || value.includes("\\") || value.includes("\0") ||
    value.startsWith("/") || /^[A-Za-z]:/.test(value) ||
    value.split("/").some((part) => part === "" || part === "." || part === "..") ||
    posix.normalize(value) !== value
  ) fail(`"${field}" must be a normalized plugin-root-relative path`);
  return value as string;
}

/** Reads `plugins/<name>/package.json`. The plugin name is the directory name. */
export async function loadPluginSource(dir: string): Promise<PluginSource> {
  const name = basename(dir);
  const file = join(dir, "package.json");
  const pkg = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  const fail = (problem: string): never => {
    throw new Error(`${file}: ${problem}`);
  };

  if (pkg.name !== `@learning-plugins/${name}`) fail(`"name" must be "@learning-plugins/${name}"`);
  for (const key of ["version", "description"]) {
    if (typeof pkg[key] !== "string" || pkg[key] === "") fail(`"${key}" must be a non-empty string`);
  }
  if (pkg.plugin !== undefined && (pkg.plugin === null || typeof pkg.plugin !== "object" || Array.isArray(pkg.plugin))) {
    fail('"plugin" must be an object');
  }
  const plugin = (pkg.plugin ?? {}) as Record<string, unknown>;
  if (plugin.dependencies !== undefined && (!Array.isArray(plugin.dependencies) || !plugin.dependencies.every((v) => typeof v === "string" && v !== ""))) {
    fail('"plugin.dependencies" must be an array of non-empty strings');
  }
  if (plugin.copy !== undefined && !Array.isArray(plugin.copy)) fail('"plugin.copy" must be an array');
  if (plugin.extraBundles !== undefined && !Array.isArray(plugin.extraBundles)) fail('"plugin.extraBundles" must be an array');
  const copy = (plugin.copy ?? []) as unknown[];
  const bundles = (plugin.extraBundles ?? []) as unknown[];
  const extraBundles = bundles.map((item, index): ExtraBundle => {
    const field = `plugin.extraBundles[${index}]`;
    if (item === null || typeof item !== "object" || Array.isArray(item)) fail(`"${field}" must be an object`);
    const bundle = item as Record<string, unknown>;
    if (bundle.platform !== "node" && bundle.platform !== "neutral") fail(`"${field}.platform" must be "node" or "neutral"`);
    return {
      entry: pluginPath(bundle.entry, `${field}.entry`, fail),
      out: pluginPath(bundle.out, `${field}.out`, fail),
      platform: bundle.platform,
    };
  });
  const [hasClaude = false, hasOmp = false] = await Promise.all(
    ["src/claude.ts", "src/omp.ts"].map((entry) => access(join(dir, entry)).then(() => true, () => false)),
  );

  return {
    dir,
    name,
    version: pkg.version as string,
    description: pkg.description as string,
    dependencies: (plugin.dependencies ?? []) as string[],
    extraBundles,
    copy: copy.map((path, index) => pluginPath(path, `plugin.copy[${index}]`, fail)),
    hasClaude,
    hasOmp,
  };
}
```

**Step 4: Run it**

Run: `npx vitest run build/test/plugin-source.test.ts && npm run typecheck`
Expected: 3 passed; exit 0. Task 9 exercises malformed manifest paths and output collisions through `buildRepo`.

**Step 5: Commit**
When updating the master's manifest contract, add refinement 11's path rules beside the `extraBundles[].out`/`copy[]` description.

```bash
git add build/plugin-source.ts build/test/plugin-source.test.ts
git commit -m "feat(build): load and validate plugin source manifests"
```

---

### Task 5: Prompt generator

**Files:**
- Create: `build/prompts.ts`
- Create: `build/test/fixtures/prompts/researcher.md`, `build/test/fixtures/prompts/visualize-skill.md`
- Test: `build/test/prompts.test.ts`
- Golden (generated): `build/test/__golden__/prompts/{omp,claude}/{researcher.md,visualize-SKILL.md}`

**Step 1: Write the source fixtures**

`build/test/fixtures/prompts/researcher.md`. Line 13 deliberately carries a two-space indent and a quote in the brief; both must survive into the rendered output.

```markdown
---
name: researcher
description: Web researcher — searches the web and synthesizes findings
tools: [web_search, web_fetch, read]
model:
  omp: openai-codex/gpt-6-sol, zai/glm-5.3
  claude: sonnet
harness:
  omp: { thinking: medium }
---

Confirm facts before asserting them. Fetch pages with {{tool:web_fetch}}.
For graded checks use {{tool:quiz}}; for open questions use {{tool:ask}}.
Hand diagrams to {{agent:fixture/maker}}:

  {{dispatch:fixture/maker|<your minimal, concrete "brief">}}

```

`build/test/fixtures/prompts/visualize-skill.md`:

```markdown
---
name: visualize
description: "Add a visual: a diagram that renders inline"
harness:
  claude: { allowed-tools: "Agent" }
---
{{dispatch:fixture/maker|<brief>}}
```

**Step 2: Write the failing test**

`build/test/prompts.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AGENTS, HARNESSES } from "../../shared/tool-map.ts";
import { PromptError, renderAgent, renderSkill } from "../prompts.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/prompts/${name}`, import.meta.url), "utf8");

// The generator reads the shared agent map; Phase 1 seeds no agents, so this file adds one for its own run.
beforeAll(() => {
  AGENTS["fixture/maker"] = { omp: "maker", claude: "fixture:maker" };
});
afterAll(() => {
  delete AGENTS["fixture/maker"];
});

const AGENT_OK = "---\nname: a\ndescription: d\nmodel: { omp: m, claude: sonnet }\n---\n";

describe.each(HARNESSES)("%s", (harness) => {
  test("renders an agent: mapped tools, per-harness model and extras, expanded placeholders", async () => {
    await expect(renderAgent("fixture/researcher.md", fixture("researcher.md"), harness)).toMatchFileSnapshot(
      `./__golden__/prompts/${harness}/researcher.md`,
    );
  });

  test("renders a skill with a dispatch example", async () => {
    await expect(renderSkill("fixture/visualize/SKILL.md", fixture("visualize-skill.md"), harness)).toMatchFileSnapshot(
      `./__golden__/prompts/${harness}/visualize-SKILL.md`,
    );
  });
});

function expectPromptError(render: () => string, message: string): void {
  expect(render).toThrow(PromptError);
  expect(render).toThrow(message);
}

test("an unknown placeholder kind fails, naming the file", () => {
  expectPromptError(() => renderAgent("p/a.md", `${AGENT_OK}Use {{tol:quiz}}.\n`, "omp"), 'p/a.md: unknown placeholder "{{tol:quiz}}"');
});

test("an unknown tool id in the body fails", () => {
  expectPromptError(() => renderAgent("p/a.md", `${AGENT_OK}Use {{tool:quizz}}.\n`, "claude"), 'p/a.md: unknown tool id "quizz"');
});

test("an unknown tool id in frontmatter tools fails", () => {
  const text = "---\nname: a\ndescription: d\ntools: [web_search, grep]\nmodel: { omp: m, claude: sonnet }\n---\nBody\n";
  expectPromptError(() => renderAgent("p/a.md", text, "omp"), 'unknown tool id "grep"');
});

test("an unknown agent id in a dispatch fails", () => {
  expectPromptError(() => renderSkill("p/S.md", "---\nname: s\ndescription: d\n---\n{{dispatch:x/nobody|brief}}\n", "omp"), 'unknown agent id "x/nobody"');
});

test("an agent without a model for every harness fails, even when rendering the other harness", () => {
  const text = "---\nname: a\ndescription: d\nmodel: { claude: sonnet }\n---\nBody\n";
  expectPromptError(() => renderAgent("p/a.md", text, "claude"), '"model" needs a string entry for omp');
});

test.each(["ask_user_question", "subagent(", "web_fetch"])("legacy literal %s outside a placeholder fails", (literal) => {
  expectPromptError(() => renderAgent("p/a.md", `${AGENT_OK}Call ${literal} here.\n`, "omp"), `legacy literal "${literal}"`);
});

test("tools and model are not allowed in a skill", () => {
  const text = "---\nname: s\ndescription: d\ntools: [read]\n---\nBody\n";
  expectPromptError(() => renderSkill("p/S.md", text, "claude"), 'frontmatter key "tools" is not allowed in a skill');
});

test("an unknown top-level frontmatter key fails instead of being dropped", () => {
  const text = "---\nname: a\ndescription: d\nthinking: medium\nmodel: { omp: m, claude: sonnet }\n---\nBody\n";
  expectPromptError(() => renderAgent("p/a.md", text, "omp"), 'frontmatter key "thinking" is not allowed in an agent');
});

test("a per-harness extra cannot override a generated key", () => {
  const text = "---\nname: a\ndescription: d\nmodel: { omp: m, claude: sonnet }\nharness:\n  omp: { model: other }\n---\nBody\n";
  expectPromptError(() => renderAgent("p/a.md", text, "omp"), '"harness.omp.model" would override a generated key');
});

test("a dispatch that shares its line with other text fails", () => {
  const text = "---\nname: s\ndescription: d\n---\nThen {{dispatch:fixture/maker|brief}} now.\n";
  expectPromptError(() => renderSkill("p/S.md", text, "omp"), "{{dispatch:…}} must be alone on its line");
});

test("a file without frontmatter fails", () => {
  expectPromptError(() => renderSkill("p/S.md", "# Just markdown\n", "omp"), "p/S.md: missing frontmatter");
});
```

The fixture uses `{{tool:web_fetch}}` inside a placeholder, which is legal. The golden therefore also proves that the legacy-literal check ignores placeholder contents.

**Step 3: Run it**

Run: `npx vitest run build/test/prompts.test.ts`
Expected: FAIL with `Cannot find module '../prompts.ts'`.

**Step 4: Implement `build/prompts.ts`**

```ts
import { parse, stringify } from "yaml";
import { agentName, HARNESSES, toolName, type Harness } from "../shared/tool-map.ts";

/** Every generator failure. The message starts with the source path. */
export class PromptError extends Error {}

type Kind = "agent" | "skill";

const ALLOWED_KEYS: Record<Kind, readonly string[]> = {
  agent: ["name", "description", "tools", "model", "harness"],
  skill: ["name", "description", "harness"],
};
const RESERVED_KEYS = ["name", "description", "tools", "model"];
const LEGACY_LITERALS = ["ask_user_question", "subagent(", "web_fetch"];
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const DISPATCH_LINE = /^(\s*)\{\{dispatch:([^{}|]+)\|([^{}]*)\}\}\s*$/;

/** Dispatch examples. Field names follow the real tool schemas:
 *  omp `task` with task.batch on (default true, pi-coding-agent src/config/settings-schema.ts:5072):
 *  `{context, tasks: [{agent, task}]}` (src/task/types.ts:87-97);
 *  CC `Agent` (claude-code-tools BuiltinToolInputs.Agent): `{description, prompt, subagent_type}`. */
const DISPATCH: Record<Harness, (agent: string, brief: string) => { tool: string; args: object }> = {
  omp: (agent, brief) => ({
    tool: "task",
    args: { context: "<background the agent needs beyond the brief>", tasks: [{ agent, task: brief }] },
  }),
  claude: (agent, brief) => ({
    tool: "Agent",
    args: { description: "<3-5 word summary of the brief>", prompt: brief, subagent_type: agent },
  }),
};

export function renderAgent(path: string, text: string, harness: Harness): string {
  return render("agent", path, text, harness);
}

export function renderSkill(path: string, text: string, harness: Harness): string {
  return render("skill", path, text, harness);
}

function render(kind: Kind, path: string, text: string, harness: Harness): string {
  const fail = (problem: string): never => {
    throw new PromptError(`${path}: ${problem}`);
  };
  const resolve = (fn: (id: string, h: Harness) => string, id: string): string => {
    try {
      return fn(id, harness);
    } catch (error) {
      return fail((error as Error).message);
    }
  };

  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (match === null) return fail("missing frontmatter (--- … ---)");
  const source: unknown = parse(match[1] ?? "");
  if (source === null || typeof source !== "object" || Array.isArray(source)) return fail("frontmatter must be a mapping");
  const fm = source as Record<string, unknown>;
  const body = text.slice(match[0].length);

  for (const key of Object.keys(fm)) {
    if (!ALLOWED_KEYS[kind].includes(key)) fail(`frontmatter key "${key}" is not allowed in ${kind === "agent" ? "an agent" : "a skill"}`);
  }
  for (const key of ["name", "description"]) {
    if (typeof fm[key] !== "string" || fm[key] === "") fail(`frontmatter "${key}" must be a non-empty string`);
  }

  const out: Record<string, unknown> = { name: fm.name, description: fm.description };
  if (fm.tools !== undefined) {
    if (!Array.isArray(fm.tools) || !fm.tools.every((t) => typeof t === "string")) fail(`"tools" must be a list of tool ids`);
    out.tools = [...new Set((fm.tools as string[]).map((id) => resolve(toolName, id)))].join(", ");
  }
  if (kind === "agent") {
    const model = fm.model as Record<string, unknown> | undefined;
    for (const h of HARNESSES) {
      if (typeof model?.[h] !== "string") fail(`"model" needs a string entry for ${h}`);
    }
    out.model = model?.[harness];
  }
  const overrides = fm.harness as Record<string, unknown> | undefined;
  for (const h of Object.keys(overrides ?? {})) {
    if (!(HARNESSES as readonly string[]).includes(h)) fail(`unknown harness "${h}" under "harness"`);
  }
  const extra = overrides?.[harness];
  if (extra !== undefined) {
    if (extra === null || typeof extra !== "object" || Array.isArray(extra)) fail(`"harness.${harness}" must be a mapping`);
    for (const [key, value] of Object.entries(extra as Record<string, unknown>)) {
      if (RESERVED_KEYS.includes(key)) fail(`"harness.${harness}.${key}" would override a generated key`);
      out[key] = value;
    }
  }

  for (const literal of LEGACY_LITERALS) {
    if (body.replace(PLACEHOLDER, "").includes(literal)) fail(`legacy literal "${literal}" outside a placeholder`);
  }

  const lines = body.split("\n").flatMap((line) => {
    if (!line.includes("{{dispatch:")) return [line];
    const dispatch = DISPATCH_LINE.exec(line);
    if (dispatch === null) return fail("{{dispatch:…}} must be alone on its line");
    const [, indent = "", id = "", brief = ""] = dispatch;
    const { tool, args } = DISPATCH[harness](resolve(agentName, id.trim()), brief.trim());
    return [`Call the \`${tool}\` tool:`, "", "```json", ...JSON.stringify(args, null, 2).split("\n"), "```"].map(
      (l) => (l === "" ? l : indent + l),
    );
  });
  const expanded = lines.join("\n").replace(PLACEHOLDER, (whole, inner: string) => {
    const [, placeholderKind, id = ""] = /^(\w+):(.*)$/s.exec(inner) ?? [];
    if (placeholderKind === "tool") return resolve(toolName, id.trim());
    if (placeholderKind === "agent") return resolve(agentName, id.trim());
    return fail(`unknown placeholder "${whole}"`);
  });

  return `---\n${stringify(out, { lineWidth: 0 })}---\n${expanded.trimEnd()}\n`;
}
```

**Step 5: Run it**

Run: `npx vitest run build/test/prompts.test.ts`
Expected: the 13 error tests pass, and the 4 golden tests FAIL with `Snapshot … mismatched`, because no golden exists yet (`CI=true`).

**Step 6: Create the golden files and review them**

Run: `npx vitest run -u build/test/prompts.test.ts`
Expected: `Snapshots 4 written`, 17 passed. Each golden must read exactly as below; if one differs, fix the generator, not the golden.

`build/test/__golden__/prompts/omp/researcher.md`:

````markdown
---
name: researcher
description: Web researcher — searches the web and synthesizes findings
tools: web_search, read
model: openai-codex/gpt-6-sol, zai/glm-5.3
thinking: medium
---

Confirm facts before asserting them. Fetch pages with read.
For graded checks use quiz; for open questions use ask.
Hand diagrams to maker:

  Call the `task` tool:

  ```json
  {
    "context": "<background the agent needs beyond the brief>",
    "tasks": [
      {
        "agent": "maker",
        "task": "<your minimal, concrete \"brief\">"
      }
    ]
  }
  ```
````

`build/test/__golden__/prompts/claude/researcher.md`:

````markdown
---
name: researcher
description: Web researcher — searches the web and synthesizes findings
tools: WebSearch, WebFetch, Read
model: sonnet
---

Confirm facts before asserting them. Fetch pages with WebFetch.
For graded checks use mcp__quiz__quiz; for open questions use AskUserQuestion.
Hand diagrams to fixture:maker:

  Call the `Agent` tool:

  ```json
  {
    "description": "<3-5 word summary of the brief>",
    "prompt": "<your minimal, concrete \"brief\">",
    "subagent_type": "fixture:maker"
  }
  ```
````

`build/test/__golden__/prompts/omp/visualize-SKILL.md`:

````markdown
---
name: visualize
description: "Add a visual: a diagram that renders inline"
---
Call the `task` tool:

```json
{
  "context": "<background the agent needs beyond the brief>",
  "tasks": [
    {
      "agent": "maker",
      "task": "<brief>"
    }
  ]
}
```
````

`build/test/__golden__/prompts/claude/visualize-SKILL.md`:

````markdown
---
name: visualize
description: "Add a visual: a diagram that renders inline"
allowed-tools: Agent
---
Call the `Agent` tool:

```json
{
  "description": "<3-5 word summary of the brief>",
  "prompt": "<brief>",
  "subagent_type": "fixture:maker"
}
```
````

**Step 7: Typecheck and commit**

Run: `npm run typecheck`
Expected: exit 0.

Check that the master plan's "Prompt source format" section carries refinement 8, and add it if missing.

```bash
git add build/prompts.ts build/test/prompts.test.ts build/test/fixtures/prompts build/test/__golden__/prompts docs/plans/2026-10-10-learning-plugins-plan.md
git commit -m "feat(build): harness-neutral prompt generator with dispatch examples"
```

---

### Task 6: Fake omp ExtensionAPI

**Files:**
- Create: `test-support/fake-omp.ts`
- Test: `test-support/fake-omp.test.ts`

The types come from `@oh-my-pi/pi-coding-agent/extensibility/extensions`:

- `ExtensionAPI` is at `dist/types/extensibility/extensions/types.d.ts:790`; its `on` overloads are at `:801-845`, `registerTool` at `:847`, `registerCommand` at `:904`, and `appendEntry` at `:955`.
- `ExtensionFactory` is at `:1102`.
- `ExtensionContext` is at `:265`, with `ui.notify(message, type?)` at `:135`.

**Step 1: Write the failing test**

`emit` is the one piece of the fake with behaviour of its own, and later phases rely on its order and on its returned results.

```ts
import { expect, test } from "vitest";
import { createFakeOmp } from "./fake-omp.ts";

test("emit runs every handler for the event in registration order, awaiting each, and returns their results", async () => {
  const fake = createFakeOmp();
  const seen: string[] = [];
  fake.api.on("tool_call", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    seen.push("first");
  });
  fake.api.on("tool_call", () => {
    seen.push("second");
    return { block: true, reason: "second says no" };
  });
  fake.api.on("tool_result", () => {
    seen.push("other event");
  });
  expect(await fake.emit("tool_call", {})).toEqual([undefined, { block: true, reason: "second says no" }]);
  expect(seen).toEqual(["first", "second"]);
});
```

**Step 2: Run it**

Run: `npx vitest run test-support/fake-omp.test.ts`
Expected: FAIL with `Cannot find module './fake-omp.ts'`.

**Step 3: Implement**

```ts
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  RegisteredCommand,
  ToolDefinition,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions";

type NotifyType = "info" | "warning" | "error";

export interface FakeOmp {
  /** The subset of omp's ExtensionAPI the plugins use: on, registerCommand, registerTool, appendEntry. */
  api: ExtensionAPI;
  /** Runs every handler registered for `event`, in registration order, awaiting each; returns their results. */
  emit(event: string, payload?: unknown, ctx?: ExtensionContext): Promise<unknown[]>;
  commands: Map<string, { description?: string; handler: RegisteredCommand["handler"] }>;
  /** The definitions exactly as registered; call `execute(id, params, undefined, undefined, fake.ctx)`. */
  tools: Map<string, ToolDefinition<any, any>>;
  entries: { customType: string; data: unknown }[];
  notifications: { message: string; type?: NotifyType }[];
  /** One mutable context for commands, tools and events. Only the fields below exist. */
  ctx: ExtensionCommandContext;
}

export function createFakeOmp(options: { cwd?: string; hasUI?: boolean } = {}): FakeOmp {
  const handlers = new Map<string, ((event: unknown, ctx: ExtensionContext) => unknown)[]>();
  const commands: FakeOmp["commands"] = new Map();
  const tools: FakeOmp["tools"] = new Map();
  const entries: FakeOmp["entries"] = [];
  const notifications: FakeOmp["notifications"] = [];

  const ctx = {
    cwd: options.cwd ?? process.cwd(),
    hasUI: options.hasUI ?? true,
    mode: "tui",
    ui: {
      notify(message: string, type?: NotifyType) {
        notifications.push({ message, type });
      },
    },
  } as unknown as ExtensionCommandContext;

  const api = {
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerCommand(name: string, command: { description?: string; handler: RegisteredCommand["handler"] }) {
      commands.set(name, { description: command.description, handler: command.handler });
    },
    registerTool(tool: ToolDefinition<any, any>) {
      tools.set(tool.name, tool);
    },
    appendEntry(customType: string, data?: unknown) {
      entries.push({ customType, data });
    },
  } as unknown as ExtensionAPI;

  return {
    api,
    async emit(event, payload, eventCtx = ctx) {
      const results: unknown[] = [];
      for (const handler of handlers.get(event) ?? []) results.push(await handler(payload, eventCtx));
      return results;
    },
    commands,
    tools,
    entries,
    notifications,
    ctx,
  };
}
```

**Step 4: Run it**

Run: `npx vitest run test-support/fake-omp.test.ts && npm run typecheck`
Expected: 1 passed; exit 0.

**Step 5: Commit**

Check that the master's Test support section reflects refinement 9, and add it if missing.

```bash
git add test-support docs/plans/2026-10-10-learning-plugins-plan.md
git commit -m "test: fake omp ExtensionAPI for adapter tests"
```

---

### Task 7: Per-harness plugin trees

**Files:**
- Create: `build/plugin-tree.ts`
- Create fixture repo: `build/test/fixtures/repo/plugins/alpha/**`, `build/test/fixtures/repo/plugins/beta/**`
- Test: `build/test/plugin-tree.test.ts`

**Step 1: Write the fixture plugins**

`alpha` has both adapters, an extra bundle and a copied file. `beta` is prompts-only and depends on `alpha`. These files are under `build/`, so `tsc` typechecks them; Vitest excludes them.

`build/test/fixtures/repo/plugins/alpha/package.json`:

```json
{
  "name": "@learning-plugins/alpha",
  "version": "1.2.3",
  "private": true,
  "type": "module",
  "description": "Alpha fixture: both adapters, an extra bundle and a copied file.",
  "plugin": {
    "extraBundles": [{ "entry": "src/tool/cli.ts", "out": "tool/cli.js", "platform": "node" }],
    "copy": ["tool/data.txt"]
  }
}
```

`build/test/fixtures/repo/plugins/alpha/src/core/greet.ts`:

```ts
export function greet(name: string): string {
  return `hello, ${name}`;
}
```

`build/test/fixtures/repo/plugins/alpha/src/omp.ts`:

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { greet } from "./core/greet.ts";

export default function alpha(pi: ExtensionAPI): void {
  pi.registerCommand("alpha", {
    description: "Greets",
    handler: async (args, ctx) => ctx.ui.notify(greet(args)),
  });
}
```

`build/test/fixtures/repo/plugins/alpha/src/claude.ts`:

```ts
import type { On, PluginOptions } from "claude-code";
import { greet } from "./core/greet.ts";

export function register(on: On, _options: PluginOptions): void {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "alpha", description: "Greets" });
    return next(e);
  });
  on("command.run", { command: "alpha" }, async (_$, e) => ({ text: greet(e.args) })).catch(() => ({ text: "alpha failed" }));
}
```

`build/test/fixtures/repo/plugins/alpha/test/claude/alpha.test.ts` (kept after `hello` is deleted; excluded from Vitest, run against a staged built plugin by the CC test kit):

```ts
import { expect, test } from "claude-code/testing";

test("/alpha executes the bundled command", async ($) => {
  const answer = await $.command.run({
    command: "alpha",
    args: "Ada",
    origin: { kind: "composer" },
    presentation: { isFullscreen: false, columns: 80 },
  });
  expect(answer.text).toBe("hello, Ada");
});
```

`build/test/fixtures/repo/plugins/alpha/src/tool/cli.ts`:

```ts
import { greet } from "../core/greet.ts";

console.log(greet(process.argv[2] ?? "cli"));
```

`build/test/fixtures/repo/plugins/alpha/tool/data.txt` (one line, trailing newline):

```text
fixture data
```

`build/test/fixtures/repo/plugins/beta/package.json`:

```json
{
  "name": "@learning-plugins/beta",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "description": "Beta fixture: prompts only, depends on alpha.",
  "plugin": { "dependencies": ["alpha"] }
}
```

`build/test/fixtures/repo/plugins/beta/prompts/agents/helper.md`:

```markdown
---
name: helper
description: Fixture agent
tools: [read]
model:
  omp: zai/glm-5.3
  claude: haiku
---
Read files with {{tool:read}}.
```

`build/test/fixtures/repo/plugins/beta/prompts/skills/greeting/SKILL.md`:

```markdown
---
name: greeting
description: Fixture skill
---
Use template.txt.
```

`build/test/fixtures/repo/plugins/beta/prompts/skills/greeting/template.txt` (one line, trailing newline):

```text
Hi {name}
```

**Step 2: Write the failing test**

`build/test/plugin-tree.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { createFakeOmp } from "../../test-support/fake-omp.ts";
import { loadPluginSource } from "../plugin-source.ts";
import { buildTree, renderPrompts, type Tree } from "../plugin-tree.ts";

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); });

const FIXTURES = join(import.meta.dirname, "fixtures/repo/plugins");
const text = (tree: Tree, path: string): string => {
  const content = tree.get(path);
  if (content === undefined) throw new Error(`no ${path} in tree`);
  return typeof content === "string" ? content : Buffer.from(content).toString("utf8");
};

const alpha = await loadPluginSource(join(FIXTURES, "alpha"));
const beta = await loadPluginSource(join(FIXTURES, "beta"));

describe("a plugin with both adapters", () => {
  test("CC tree: manifest and hooks module list", async () => {
    const tree = await buildTree(alpha, "claude");
    expect([...tree.keys()].sort()).toEqual([".claude-plugin/plugin.json", "hooks/hooks.json", "hooks/register.js", "tool/cli.js", "tool/data.txt"]);
    expect(JSON.parse(text(tree, ".claude-plugin/plugin.json"))).toEqual({
      name: "alpha",
      version: "1.2.3",
      description: "Alpha fixture: both adapters, an extra bundle and a copied file.",
      author: { name: "Marcus Xavier" },
    });
    expect(JSON.parse(text(tree, "hooks/hooks.json"))).toEqual({ modules: ["./register.js"] });
  });

  test("omp tree: the extension bundle loads in Node and registers the plugin's command", async () => {
    const tree = await buildTree(alpha, "omp");
    expect(JSON.parse(text(tree, "package.json"))).toEqual({
      name: "@learning-plugins/alpha",
      version: "1.2.3",
      description: "Alpha fixture: both adapters, an extra bundle and a copied file.",
      type: "module",
      omp: { extensions: ["./extension.js"] },
    });
    const root = await mkdtemp(join(tmpdir(), "lp-ext-"));
    roots.push(root);
    const file = join(root, "extension.mjs");
    await writeFile(file, text(tree, "extension.js"));
    const factory = (await import(pathToFileURL(file).href)).default;
    const fake = createFakeOmp();
    await factory(fake.api);
    await fake.commands.get("alpha")?.handler("Ada", fake.ctx);
    expect(fake.notifications).toEqual([{ message: "hello, Ada", type: undefined }]);
  });

  test("extra bundles and copied files land at the same path, byte-identical, in both trees", async () => {
    const [claude, omp] = await Promise.all([buildTree(alpha, "claude"), buildTree(alpha, "omp")]);
    expect(text(omp, "tool/data.txt")).toBe("fixture data\n");
    expect(text(claude, "tool/data.txt")).toBe(text(omp, "tool/data.txt"));
    expect(text(claude, "tool/cli.js")).toBe(text(omp, "tool/cli.js"));
    expect(text(omp, "tool/cli.js")).toContain("hello, ");
  });
});

describe("a prompts-only plugin", () => {
  test("CC tree has the manifest with dependencies and the rendered prompts, and no hooks", async () => {
    const tree = await buildTree(beta, "claude");
    expect([...tree.keys()].sort()).toEqual([
      ".claude-plugin/plugin.json",
      "agents/helper.md",
      "skills/greeting/SKILL.md",
      "skills/greeting/template.txt",
    ]);
    expect(JSON.parse(text(tree, ".claude-plugin/plugin.json")).dependencies).toEqual(["alpha"]);
    expect(text(tree, "agents/helper.md")).toContain("Read files with Read.");
  });

  test("omp tree has a package.json without an omp key, and no extension", async () => {
    const tree = await buildTree(beta, "omp");
    expect([...tree.keys()].sort()).toEqual(["agents/helper.md", "package.json", "skills/greeting/SKILL.md", "skills/greeting/template.txt"]);
    expect(JSON.parse(text(tree, "package.json"))).not.toHaveProperty("omp");
    expect(text(tree, "skills/greeting/template.txt")).toBe("Hi {name}\n");
  });
});

test("a skill directory without SKILL.md fails instead of shipping the files unrendered", async () => {
  const root = await mkdtemp(join(tmpdir(), "lp-skill-"));
  roots.push(root);
  const dir = join(root, "demo");
  await mkdir(join(dir, "prompts/skills/oops"), { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "@learning-plugins/demo", version: "0.1.0", description: "d" }));
  await writeFile(join(dir, "prompts/skills/oops/skill.md"), "---\nname: oops\ndescription: d\n---\n");
  await expect(renderPrompts(await loadPluginSource(dir), "omp")).rejects.toThrow("demo/prompts/skills/oops: missing SKILL.md");
});
```

**Step 3: Run it**

Run: `npx vitest run build/test/plugin-tree.test.ts`
Expected: FAIL with `Cannot find module '../plugin-tree.ts'`.

**Step 4: Implement `build/plugin-tree.ts`**

```ts
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { build } from "esbuild";
import type { Harness } from "../shared/tool-map.ts";
import type { PluginSource } from "./plugin-source.ts";
import { PromptError, renderAgent, renderSkill } from "./prompts.ts";

/** Relative path → file content. Text that the build generates is a string; copied files are bytes. */
export type Tree = Map<string, string | Uint8Array>;

const AUTHOR = { name: "Marcus Xavier" };
const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";

/** Bundles one entry into a single ESM file. Paths in esbuild's comments are relative to the repo root,
 *  which keeps the output byte-identical wherever the repo is checked out. */
async function bundle(src: PluginSource, entry: string, platform: "node" | "neutral", external: string[]): Promise<string> {
  const result = await build({
    absWorkingDir: resolve(src.dir, "../.."),
    entryPoints: [join(src.dir, entry)],
    bundle: true,
    write: false,
    format: "esm",
    platform,
    target: "es2023",
    external,
    charset: "utf8",
    legalComments: "none",
    logLevel: "silent",
  });
  const [output] = result.outputFiles;
  if (output === undefined) throw new Error(`${src.name}: esbuild produced no output for ${entry}`);
  return output.text;
}

/** Every file under `dir`, as sorted `/`-separated paths relative to it; none when `dir` is missing. */
export async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split("\\").join("/"))
    .sort();
}

/** `prompts/agents/*.md` → `agents/*.md`; `prompts/skills/<s>/**` → `skills/<s>/**`, SKILL.md rendered, the rest copied. */
export async function renderPrompts(src: PluginSource, harness: Harness): Promise<Tree> {
  const tree: Tree = new Map();
  const agentsDir = join(src.dir, "prompts/agents");
  for (const file of await listFiles(agentsDir)) {
    if (file.includes("/") || !file.endsWith(".md")) continue;
    tree.set(`agents/${file}`, renderAgent(`${src.name}/prompts/agents/${file}`, await readFile(join(agentsDir, file), "utf8"), harness));
  }
  const skillsDir = join(src.dir, "prompts/skills");
  const skillFiles = await listFiles(skillsDir);
  for (const skill of new Set(skillFiles.map((f) => f.split("/")[0] ?? ""))) {
    if (!skillFiles.includes(`${skill}/SKILL.md`)) throw new PromptError(`${src.name}/prompts/skills/${skill}: missing SKILL.md`);
  }
  for (const file of skillFiles) {
    const content = await readFile(join(skillsDir, file));
    tree.set(
      `skills/${file}`,
      file.endsWith("/SKILL.md") ? renderSkill(`${src.name}/prompts/skills/${file}`, content.toString("utf8"), harness) : content,
    );
  }
  return tree;
}

export async function buildTree(src: PluginSource, harness: Harness): Promise<Tree> {
  const tree: Tree = new Map();
  const put = (path: string, content: string | Uint8Array): void => {
    for (const existing of tree.keys()) {
      if (existing === path || existing.startsWith(`${path}/`) || path.startsWith(`${existing}/`)) {
        throw new Error(`plugins/${src.name}: duplicate output path "${path}" in ${harness} tree`);
      }
    }
    tree.set(path, content);
  };
  if (harness === "claude") {
    put(".claude-plugin/plugin.json", json({
      name: src.name,
      version: src.version,
      description: src.description,
      author: AUTHOR,
      ...(src.dependencies.length > 0 ? { dependencies: src.dependencies } : {}),
    }));
    if (src.hasClaude) {
      put("hooks/hooks.json", json({ modules: ["./register.js"] }));
      put("hooks/register.js", await bundle(src, "src/claude.ts", "neutral", ["claude-code"]));
    }
  } else {
    put("package.json", json({
      name: `@learning-plugins/${src.name}`,
      version: src.version,
      description: src.description,
      type: "module",
      ...(src.hasOmp ? { omp: { extensions: ["./extension.js"] } } : {}),
    }));
    if (src.hasOmp) {
      put("extension.js", await bundle(src, "src/omp.ts", "node", ["@oh-my-pi/*", "@sinclair/typebox", "node:*"]));
    }
  }
  for (const extra of src.extraBundles) put(extra.out, await bundle(src, extra.entry, extra.platform, []));
  for (const path of src.copy) put(path, await readFile(join(src.dir, path)));
  for (const [path, content] of await renderPrompts(src, harness)) put(path, content);
  return tree;
}
```

Notes:

- A `neutral` CC bundle that imports `node:*` fails here with `Could not resolve "node:fs"`. That is intended: the CC mod runtime has no Node APIs.
- `extraBundles` get no explicit externals. `platform: "node"` already leaves Node built-ins external.

**Step 5: Run it**

Run: `npx vitest run build/test/plugin-tree.test.ts && npm run typecheck`
Expected: 6 passed; exit 0.

**Step 6: Commit**
Keep the master's generated-tree contract consistent with refinement 11: no manifest output can replace another output, metadata, or a rendered prompt. The built CC fixture is tested by `claude plugin validate --strict` and `claude plugin test` in Task 10; do not assert esbuild's export formatting.

Check that the master's Build module API lists `renderPrompts` and `listFiles` (refinement 1), and add them if missing:

```ts
export function renderPrompts(src: PluginSource, harness: Harness): Promise<Tree>; // keys agents/<n>.md, skills/<s>/** (SKILL.md rendered, rest copied)
export function listFiles(dir: string): Promise<string[]>;                         // sorted, "/"-separated, relative; [] when dir is missing
```

```bash
git add build/plugin-tree.ts build/test/plugin-tree.test.ts build/test/fixtures/repo docs/plans/2026-10-10-learning-plugins-plan.md
git commit -m "feat(build): per-harness plugin trees with esbuild bundles and rendered prompts"
```

---

### Task 8: Marketplace catalogs

**Files:**
- Create: `build/catalog.ts`
- Test: `build/test/catalog.test.ts`
- Golden (generated): `build/test/__golden__/catalog/{omp,claude}.json`

**Step 1: Write the failing test**

The plugins are passed in reverse directory order, so the golden proves the sorting.

```ts
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { HARNESSES } from "../../shared/tool-map.ts";
import { catalog } from "../catalog.ts";
import { loadPluginSource } from "../plugin-source.ts";

const FIXTURES = join(import.meta.dirname, "fixtures/repo/plugins");

const plugins = await Promise.all(["beta", "alpha"].map((name) => loadPluginSource(join(FIXTURES, name))));

describe.each(HARNESSES)("%s catalog", (harness) => {
  test("lists plugins in directory-name order with sources in the harness's tree", async () => {
    await expect(catalog(harness, plugins)).toMatchFileSnapshot(`./__golden__/catalog/${harness}.json`);
  });
});
```

**Step 2: Run it**

Run: `npx vitest run build/test/catalog.test.ts`
Expected: FAIL with `Cannot find module '../catalog.ts'`.

**Step 3: Implement**

```ts
import type { Harness } from "../shared/tool-map.ts";
import type { PluginSource } from "./plugin-source.ts";

/** One marketplace catalog. omp reads `.omp-plugin/marketplace.json`, CC reads `.claude-plugin/marketplace.json`. */
export function catalog(harness: Harness, plugins: PluginSource[]): string {
  const sorted = [...plugins].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const value = {
    name: "learning-plugins",
    description: "Learning workflow plugins for Oh My Pi and Claude Code, built from one source tree.",
    owner: { name: "Marcus Xavier" },
    plugins: sorted.map((p) => ({
      name: p.name,
      source: `./dist/${harness}/${p.name}`,
      description: p.description,
      version: p.version,
    })),
  };
  return JSON.stringify(value, null, 2) + "\n";
}
```

The sort compares UTF-16 code units, not `localeCompare`, so the order doesn't depend on the locale. CC `validate --strict` requires `description`.

**Step 4: Create and review the goldens**

Run: `npx vitest run build/test/catalog.test.ts` (expected: 2 FAIL, `Snapshot … mismatched`), then `npx vitest run -u build/test/catalog.test.ts` (expected: `Snapshots 2 written`).

`build/test/__golden__/catalog/claude.json` must read exactly as below. `omp.json` is identical except that both `source` values are `./dist/omp/…`.

```json
{
  "name": "learning-plugins",
  "description": "Learning workflow plugins for Oh My Pi and Claude Code, built from one source tree.",
  "owner": {
    "name": "Marcus Xavier"
  },
  "plugins": [
    {
      "name": "alpha",
      "source": "./dist/claude/alpha",
      "description": "Alpha fixture: both adapters, an extra bundle and a copied file.",
      "version": "1.2.3"
    },
    {
      "name": "beta",
      "source": "./dist/claude/beta",
      "description": "Beta fixture: prompts only, depends on alpha.",
      "version": "0.0.1"
    }
  ]
}
```

**Step 5: Commit**

Check the master's Generated trees catalog line (refinement 3) and change it if needed to: `.claude-plugin/marketplace.json  {name: "learning-plugins", description, owner: {name: "Marcus Xavier"}, plugins: [{name, source: "./dist/claude/<name>", description, version}]}`.

```bash
git add build/catalog.ts build/test/catalog.test.ts build/test/__golden__/catalog docs/plans/2026-10-10-learning-plugins-plan.md
git commit -m "feat(build): marketplace catalogs for both harnesses"
```

---

### Task 9: Build, write and diff the repo

**Files:**
- Create: `build/repo.ts`
- Test: `build/test/repo.test.ts`

**Step 1: Write the failing test**

```ts
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { buildRepo, diffRepo, writeRepo } from "../repo.ts";

const fixtureRoots: string[] = [];
afterAll(async () => { await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true }))); });

async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lp-repo-"));
  fixtureRoots.push(root);
  await cp(join(import.meta.dirname, "fixtures/repo"), root, { recursive: true });
  return root;
}

test("builds every plugin into both trees plus both catalogs", async () => {
  const files = await buildRepo(await fixtureRepo());
  expect([...files.keys()].sort()).toEqual([
    ".claude-plugin/marketplace.json",
    ".omp-plugin/marketplace.json",
    "dist/claude/alpha/.claude-plugin/plugin.json",
    "dist/claude/alpha/hooks/hooks.json",
    "dist/claude/alpha/hooks/register.js",
    "dist/claude/alpha/tool/cli.js",
    "dist/claude/alpha/tool/data.txt",
    "dist/claude/beta/.claude-plugin/plugin.json",
    "dist/claude/beta/agents/helper.md",
    "dist/claude/beta/skills/greeting/SKILL.md",
    "dist/claude/beta/skills/greeting/template.txt",
    "dist/omp/alpha/extension.js",
    "dist/omp/alpha/package.json",
    "dist/omp/alpha/tool/cli.js",
    "dist/omp/alpha/tool/data.txt",
    "dist/omp/beta/agents/helper.md",
    "dist/omp/beta/package.json",
    "dist/omp/beta/skills/greeting/SKILL.md",
    "dist/omp/beta/skills/greeting/template.txt",
  ]);
});

test("two builds of the same sources are byte-identical, even from different checkouts", async () => {
  const [a, b] = await Promise.all([buildRepo(await fixtureRepo()), buildRepo(await fixtureRepo())]);
  expect(b).toEqual(a);
});

test("a fresh write leaves nothing to report", async () => {
  const root = await fixtureRepo();
  const files = await buildRepo(root);
  await writeRepo(root, files);
  expect(await diffRepo(root, files)).toEqual([]);
});

test("reports stale, missing and extra generated files", async () => {
  const root = await fixtureRepo();
  const files = await buildRepo(root);
  await writeRepo(root, files);
  await writeFile(join(root, "dist/omp/beta/agents/helper.md"), "hand edit\n");
  await rm(join(root, ".omp-plugin/marketplace.json"));
  await writeFile(join(root, "dist/claude/alpha/leftover.js"), "");
  expect(await diffRepo(root, files)).toEqual([
    "extra: dist/claude/alpha/leftover.js",
    "missing: .omp-plugin/marketplace.json",
    "stale: dist/omp/beta/agents/helper.md",
  ]);
});

test("ignores the types and tsconfig Claude Code writes into a plugin dir it loads", async () => {
  const root = await fixtureRepo();
  const files = await buildRepo(root);
  await writeRepo(root, files);
  await mkdir(join(root, "dist/claude/alpha/.claude-plugin/types/claude-code"), { recursive: true });
  await writeFile(join(root, "dist/claude/alpha/.claude-plugin/types/claude-code/index.d.ts"), "");
  await writeFile(join(root, "dist/claude/alpha/tsconfig.json"), "{}");
  expect(await diffRepo(root, files)).toEqual([]);
});

test("writing replaces dist wholesale: files of a removed plugin disappear", async () => {
  const root = await fixtureRepo();
  await writeRepo(root, await buildRepo(root));
  await rm(join(root, "plugins/beta"), { recursive: true });
  const files = await buildRepo(root);
  await writeRepo(root, files);
  await expect(readFile(join(root, "dist/omp/beta/package.json"))).rejects.toThrow("ENOENT");
  expect(await diffRepo(root, files)).toEqual([]);
});

test("a dependency on a plugin that does not exist fails the build", async () => {
  const root = await fixtureRepo();
  const manifest = join(root, "plugins/beta/package.json");
  const pkg = JSON.parse(await readFile(manifest, "utf8"));
  await writeFile(manifest, JSON.stringify({ ...pkg, plugin: { dependencies: ["alpah"] } }));
  await expect(buildRepo(root)).rejects.toThrow('plugins/beta: unknown dependency "alpah"');
});

test.each([
  ["bundle overwrites CC metadata", { extraBundles: [{ entry: "src/tool/cli.ts", out: ".claude-plugin/plugin.json", platform: "node" }] }, 'duplicate output path ".claude-plugin/plugin.json"'],
  ["copy overwrites a generated hook", { copy: ["hooks/hooks.json"] }, 'duplicate output path "hooks/hooks.json"'],
  ["two bundles share an output", { extraBundles: [
    { entry: "src/tool/cli.ts", out: "tool/cli.js", platform: "node" },
    { entry: "src/tool/cli.ts", out: "tool/cli.js", platform: "node" },
  ] }, 'duplicate output path "tool/cli.js"'],
  ["copy overwrites a rendered prompt", { copy: ["skills/greeting/SKILL.md"] }, 'duplicate output path "skills/greeting/SKILL.md"'],
])("rejects %s before writing dist", async (_case, plugin, error) => {
  const root = await fixtureRepo();
  const manifest = join(root, "plugins/alpha/package.json");
  const pkg = JSON.parse(await readFile(manifest, "utf8"));
  await writeFile(manifest, JSON.stringify({ ...pkg, plugin }));
  if (_case === "copy overwrites a generated hook") {
    await mkdir(join(root, "plugins/alpha/hooks"), { recursive: true });
    await writeFile(join(root, "plugins/alpha/hooks/hooks.json"), "{}");
  }
  if (_case === "copy overwrites a rendered prompt") {
    const prompt = join(root, "plugins/alpha/prompts/skills/greeting");
    await mkdir(prompt, { recursive: true });
    await writeFile(join(prompt, "SKILL.md"), "---\nname: greeting\ndescription: d\n---\n");
    await mkdir(join(root, "plugins/alpha/skills/greeting"), { recursive: true });
    await writeFile(join(root, "plugins/alpha/skills/greeting/SKILL.md"), "copy");
  }
  await expect(buildRepo(root)).rejects.toThrow(error);
  await expect(readFile(join(root, "dist/claude/alpha/.claude-plugin/plugin.json"))).rejects.toThrow("ENOENT");
});

test.each([
  ["bundle entry", { extraBundles: [{ entry: "../escape.ts", out: "tool/cli.js", platform: "node" }] }, '"plugin.extraBundles[0].entry"'],
  ["bundle output", { extraBundles: [{ entry: "src/tool/cli.ts", out: "../escape.js", platform: "node" }] }, '"plugin.extraBundles[0].out"'],
  ["copied file", { copy: ["../escape.txt"] }, '"plugin.copy[0]"'],
  ["Windows drive path", { copy: ["C:/escape.txt"] }, '"plugin.copy[0]"'],
  ["non-string copy", { copy: [42] }, '"plugin.copy[0]"'],
  ["invalid platform", { extraBundles: [{ entry: "src/tool/cli.ts", out: "tool/cli.js", platform: "browser" }] }, '"plugin.extraBundles[0].platform"'],
])("rejects invalid %s through buildRepo", async (_case, plugin, field) => {
  const root = await fixtureRepo();
  const manifest = join(root, "plugins/alpha/package.json");
  const pkg = JSON.parse(await readFile(manifest, "utf8"));
  await writeFile(manifest, JSON.stringify({ ...pkg, plugin }));
  await expect(buildRepo(root)).rejects.toThrow(field);
});
```

**Step 2: Run it**

Run: `npx vitest run build/test/repo.test.ts`
Expected: FAIL with `Cannot find module '../repo.ts'`.

**Step 3: Implement**

```ts
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HARNESSES } from "../shared/tool-map.ts";
import { catalog } from "./catalog.ts";
import { loadPluginSource } from "./plugin-source.ts";
import { buildTree, listFiles, type Tree } from "./plugin-tree.ts";

/** Files Claude Code writes into a `--plugin-dir` it loads interactively. Git-ignored; never generated by us. */
const HOST_GENERATED = [/^dist\/claude\/[^/]+\/\.claude-plugin\/types\//, /^dist\/claude\/[^/]+\/tsconfig\.json$/];

/** Every generated file, keyed by repo-relative path: `dist/<harness>/<plugin>/**` and both catalogs. */
export async function buildRepo(root: string): Promise<Tree> {
  const entries = await readdir(join(root, "plugins"), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const names = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const sources = await Promise.all(names.map((name) => loadPluginSource(join(root, "plugins", name))));
  for (const src of sources) {
    for (const dep of src.dependencies) {
      if (!names.includes(dep)) throw new Error(`plugins/${src.name}: unknown dependency "${dep}"`);
    }
  }

  const files: Tree = new Map();
  for (const src of sources) {
    for (const harness of HARNESSES) {
      for (const [path, content] of await buildTree(src, harness)) files.set(`dist/${harness}/${src.name}/${path}`, content);
    }
  }
  files.set(".claude-plugin/marketplace.json", catalog("claude", sources));
  files.set(".omp-plugin/marketplace.json", catalog("omp", sources));
  return files;
}

/** Replaces `dist/` wholesale and writes the catalogs. */
export async function writeRepo(root: string, files: Tree): Promise<void> {
  await rm(join(root, "dist"), { recursive: true, force: true });
  for (const [path, content] of files) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

/** What `writeRepo(root, files)` would change, as sorted `extra: p`, `missing: p`, `stale: p` lines. */
export async function diffRepo(root: string, files: Tree): Promise<string[]> {
  const problems: string[] = [];
  for (const [path, content] of files) {
    const actual = await readFile(join(root, path)).catch(() => undefined);
    if (actual === undefined) problems.push(`missing: ${path}`);
    else if (!actual.equals(typeof content === "string" ? Buffer.from(content, "utf8") : content)) problems.push(`stale: ${path}`);
  }
  for (const file of await listFiles(join(root, "dist"))) {
    const path = `dist/${file}`;
    if (!files.has(path) && !HOST_GENERATED.some((re) => re.test(path))) problems.push(`extra: ${path}`);
  }
  return problems.sort();
}
```

**Step 4: Run it**

Run: `npx vitest run build/test/repo.test.ts && npm test && npm run typecheck`
Expected: 17 passed; the full suite (7 files) passes; exit 0.

**Step 5: Commit**

Check the master's `diffRepo` comment (refinement 4) and add `// ignores dist/claude/*/.claude-plugin/types/** and dist/claude/*/tsconfig.json (written by CC on --plugin-dir loads)` if needed.

```bash
git add build/repo.ts build/test/repo.test.ts docs/plans/2026-10-10-learning-plugins-plan.md
git commit -m "feat(build): build, write and diff the generated repo files"
```

---

### Task 10: Build CLI

**Files:**
- Create: `build/cli.ts`
- Generated: `.claude-plugin/marketplace.json`, `.omp-plugin/marketplace.json`

The CLI is glue over functions tested in Tasks 4–9. Its proof is running it with the persistent `alpha` fixture (strict validation and a real CC command test), then with `hello` in Task 12. The fixture is never added to the marketplace or `dist/`.

**Step 1: Implement**

```ts
// Run with Node 24's type stripping: `node build/cli.ts <command>`. Erasable syntax only.
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { loadPluginSource } from "./plugin-source.ts";
import { buildTree, listFiles } from "./plugin-tree.ts";
import { buildRepo, diffRepo, writeRepo } from "./repo.ts";

const root = resolve(import.meta.dirname, "..");
const [command, ...args] = process.argv.slice(2);

/** Vendored from what CC writes into `<plugin>/.claude-plugin/types/`; claude-code-mcp is machine-specific, so not vendored. */
const CLAUDE_TYPE_FILES = ["claude-code/index.d.ts", "claude-code-tools/index.d.ts"];
const FIXTURE = join(root, "build/test/fixtures/repo/plugins/alpha");

function run(cmd: string, argv: string[]): boolean {
  console.log(`$ ${cmd} ${argv.join(" ")}`);
  return spawnSync(cmd, argv, { cwd: root, stdio: "inherit" }).status === 0;
}

async function subdirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/** Stage the actual built tree, optionally copying the CC tests, without touching committed dist/. */
async function stageClaude(source: string, name: string, withTests: boolean): Promise<string> {
  const dir = source === FIXTURE ? join(root, ".test-build/fixtures/alpha") : join(root, ".test-build/claude", name);
  await rm(dir, { recursive: true, force: true });
  for (const [path, content] of await buildTree(await loadPluginSource(source), "claude")) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  if (withTests) {
    const testDir = join(source, "test/claude");
    for (const file of await listFiles(testDir)) {
      await mkdir(dirname(join(dir, "test/claude", file)), { recursive: true });
      await copyFile(join(testDir, file), join(dir, "test/claude", file));
    }
  }
  return dir;
}

switch (command) {
  case "build": {
    await writeRepo(root, await buildRepo(root));
    console.log("wrote dist/ and both catalogs");
    break;
  }
  case "check": {
    const problems = await diffRepo(root, await buildRepo(root));
    if (problems.length > 0) {
      console.error(`${problems.join("\n")}\n\ngenerated files are out of date: run \`npm run build\``);
      process.exitCode = 1;
    }
    break;
  }
  case "validate": {
    // CC rejects an empty marketplace, but the persistent fixture always validates the built bundle.
    const plugins = (await subdirs(join(root, "dist/claude"))).map((name) => join(root, "dist/claude", name));
    const fixture = await stageClaude(FIXTURE, "alpha-fixture", false);
    if (plugins.length === 0) console.log("no plugins in dist/claude: validating fixture only");
    const dirs = [...(plugins.length > 0 ? [root, ...plugins] : []), fixture];
    const failed = dirs.filter((dir) => !run("claude", ["plugin", "validate", "--strict", dir]));
    if (failed.length > 0) {
      console.error(`validate --strict failed for:\n${failed.join("\n")}`);
      process.exitCode = 1;
    }
    break;
  }
  case "test-claude": {
    const all = await subdirs(join(root, "plugins"));
    const withTests: string[] = [];
    for (const name of all) if ((await listFiles(join(root, "plugins", name, "test/claude"))).length > 0) withTests.push(name);
    const names = args.length > 0 ? args : ["alpha-fixture", ...withTests];
    const failed: string[] = [];
    for (const name of names) {
      const source = name === "alpha-fixture" ? FIXTURE : join(root, "plugins", name);
      if (name !== "alpha-fixture" && !withTests.includes(name)) throw new Error(`plugins/${name}/test/claude has no CC tests`);
      const dir = await stageClaude(source, name, true);
      if (!run("claude", ["plugin", "test", dir])) failed.push(name);
    }
    if (failed.length > 0) {
      console.error(`claude plugin test failed for: ${failed.join(", ")}`);
      process.exitCode = 1;
    }
    break;
  }
  case "refresh-claude-types": {
    const [pluginDir] = args;
    if (pluginDir === undefined) throw new Error("usage: npm run types:claude -- <plugin dir CC loaded with --plugin-dir>");
    const from = join(resolve(pluginDir), ".claude-plugin/types");
    for (const file of CLAUDE_TYPE_FILES) {
      await mkdir(dirname(join(root, "types/claude-code", file)), { recursive: true });
      await copyFile(join(from, file), join(root, "types/claude-code", file));
    }
    const header = (await readFile(join(root, "types/claude-code", CLAUDE_TYPE_FILES[0] ?? ""), "utf8")).split("\n", 1)[0];
    console.log(`types/claude-code refreshed: ${header}`);
    break;
  }
  default:
    console.error("usage: node build/cli.ts build | check | validate | test-claude [plugin…] | refresh-claude-types <dir>");
    process.exitCode = 2;
}
```

**Step 2: Run every command on the empty repo**

```bash
npm run build          # prints: wrote dist/ and both catalogs
npm run check          # exit 0, no output after the banner
npm run validate       # validates .test-build/fixtures/alpha with --strict; empty marketplace is skipped
npm run test:claude    # runs /alpha Ada against the built fixture; 1 pass, 0 fail
npm run typecheck && npm test
```

Expected:

- Every command exits 0.
- `.claude-plugin/marketplace.json` and `.omp-plugin/marketplace.json` exist with `"plugins": []` and the description from Task 8.
- No `dist/` directory exists.

**Step 3: Commit**

Check the master's Commands table for refinements 5 and 7. The `npm run validate` row must say that the built `alpha` fixture is always staged and validated under `--strict`, and the root plus `dist/claude/*` are validated when real plugins exist; the `npm run test:claude [-- <plugin>]` row must say that default invocation runs the staged fixture and every real plugin with CC tests, while an explicit plugin selects only that plugin.

```bash
git add build/cli.ts .claude-plugin/marketplace.json .omp-plugin/marketplace.json docs/plans/2026-10-10-learning-plugins-plan.md
git commit -m "feat(build): build CLI (build, check, validate, test-claude, refresh-claude-types)"
```

---

### Task 11: Throwaway `hello` plugin, core and omp adapter

**Files:**
- Create: `plugins/hello/package.json`, `plugins/hello/src/core/hello.ts`, `plugins/hello/src/omp.ts`
- Test: `plugins/hello/test/hello.test.ts`, `plugins/hello/test/omp.test.ts`

**Step 1: Write the manifest and register the workspace**

`plugins/hello/package.json`:

```json
{
  "name": "@learning-plugins/hello",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Throwaway skeleton plugin: a command, an image tool and a session probe in both harnesses."
}
```

Run: `npm install`
Expected: `added 1 package`, and `package-lock.json` gains `plugins/hello`.

**Step 2: Write the failing core test**

`plugins/hello/test/hello.test.ts`. The colour test matters: both smoke tests ask the model to name the colour, so the image must really be red.

```ts
import { inflateSync } from "node:zlib";
import { expect, test } from "vitest";
import { greet, HELLO_PNG_BASE64 } from "../src/core/hello.ts";

test("greets the given name, trimmed", () => {
  expect(greet("  Ada ")).toBe("Hello, Ada!");
});

test("greets the world when no name is given", () => {
  expect(greet("   ")).toBe("Hello, world!");
});

test("the image is a 64×64 PNG whose every pixel is pure red", () => {
  const png = Buffer.from(HELLO_PNG_BASE64, "base64");
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]]).toEqual([64, 64, 8, 2]); // width, height, 8-bit RGB
  const idatLength = png.readUInt32BE(33);
  const rows = inflateSync(png.subarray(41, 41 + idatLength));
  for (let y = 0; y < 64; y++) {
    const row = rows.subarray(y * 193 + 1, (y + 1) * 193);
    for (let x = 0; x < 64; x++) expect([...row.subarray(x * 3, x * 3 + 3)]).toEqual([255, 0, 0]);
  }
});
```

Run: `npx vitest run plugins/hello/test/hello.test.ts`
Expected: FAIL with `Cannot find module '../src/core/hello.ts'`.

**Step 3: Implement the core**

`plugins/hello/src/core/hello.ts`. The PNG is `RED_B64` from `/tmp/mod-image-spike/hooks/pngs.ts`, which the spike's model named correctly.

```ts
/** The greeting both adapters print for `/hello [name]`. */
export function greet(name: string): string {
  return `Hello, ${name.trim() || "world"}!`;
}

/** A 64×64 solid red PNG (generated by /tmp/mod-image-spike/generate.mjs). */
export const HELLO_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC";
```

Run: `npx vitest run plugins/hello/test/hello.test.ts`
Expected: 3 passed.

**Step 4: Write the failing omp adapter test**

`plugins/hello/test/omp.test.ts`:

```ts
import { expect, test } from "vitest";
import { createFakeOmp } from "../../../test-support/fake-omp.ts";
import { HELLO_PNG_BASE64 } from "../src/core/hello.ts";
import hello from "../src/omp.ts";

test("/hello notifies a greeting for the typed name", async () => {
  const fake = createFakeOmp();
  hello(fake.api);
  await fake.commands.get("hello")?.handler("Ada", fake.ctx);
  expect(fake.notifications).toEqual([{ message: "Hello, Ada!", type: "info" }]);
});

test("hello_image returns the PNG as omp image content", async () => {
  const fake = createFakeOmp();
  hello(fake.api);
  const result = await fake.tools.get("hello_image")?.execute("call-1", {}, undefined, undefined, fake.ctx);
  expect(result?.content).toContainEqual({ type: "image", data: HELLO_PNG_BASE64, mimeType: "image/png" });
});
```

Run: `npx vitest run plugins/hello/test/omp.test.ts`
Expected: FAIL with `Cannot find module '../src/omp.ts'`.

**Step 5: Implement the omp adapter**

`plugins/hello/src/omp.ts`. `parameters` is a plain JSON Schema (omp accepts `TJsonSchema`), so the bundle imports nothing from the host. `loadMode: "essential"` keeps `hello_image` a top-level tool rather than an `xd://` device.

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { greet, HELLO_PNG_BASE64 } from "./core/hello.ts";

export default function hello(pi: ExtensionAPI): void {
  pi.registerCommand("hello", {
    description: "Say hello (learning-plugins skeleton)",
    handler: async (args, ctx) => ctx.ui.notify(greet(args), "info"),
  });
  pi.registerTool({
    name: "hello_image",
    label: "Hello image",
    description: "Returns a small solid-colour PNG image. Look at it and tell the user its colour.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    loadMode: "essential",
    async execute() {
      return {
        content: [
          { type: "text", text: "A solid-colour square:" },
          { type: "image", data: HELLO_PNG_BASE64, mimeType: "image/png" },
        ],
      };
    },
  });
}
```

**Step 6: Run, build, check**

```bash
npx vitest run plugins/hello && npm run typecheck
npm run build
npm run check
```

Expected:

- 5 passed; typecheck exit 0.
- The build writes `dist/omp/hello/{package.json,extension.js}` and `dist/claude/hello/.claude-plugin/plugin.json`. There is no CC hooks module yet.
- Both catalogs list `hello`. `check` exits 0.

**Step 7: Commit**

```bash
git add plugins/hello package-lock.json dist .claude-plugin .omp-plugin
git commit -m "feat(hello): throwaway hello plugin core and omp adapter"
```

---

### Task 12: `hello` CC adapter

**Files:**
- Create: `plugins/hello/src/claude.ts`
- Test: `plugins/hello/test/claude/hello.test.ts` (CC test kit; Vitest excludes it)

**Step 1: Write the failing CC test**

`plugins/hello/test/claude/hello.test.ts`:

```ts
import { expect, test } from "claude-code/testing";

test("/hello answers with a greeting for the typed name", async ($) => {
  const answer = await $.command.run({
    command: "hello",
    args: "Ada",
    origin: { kind: "composer" },
    presentation: { isFullscreen: false, columns: 80 },
  });
  expect(answer.text).toBe("Hello, Ada!");
});

test("hello_image answers with Anthropic text and base64 image blocks", async ($) => {
  const answer = await $.tool.call({ tool: "mcp__hello__hello_image" });
  expect(answer.result).toEqual([
    { type: "text", text: "A solid-colour square:" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: expect.any(String) } },
  ]);
});
```

The test can't import `src/core` (see refinement 7), so the image data is matched with `expect.any(String)`. The core test already proves which bytes they are. `origin` and `presentation` are there because the kit's `$.command.run` takes the whole `CommandRunInput`.

Run: `npm run typecheck && npm run test:claude -- hello`
Expected: typecheck exit 0. The CC run FAILS with `claude plugin test: …/.test-build/claude/hello: no hooks module to load; there is no hooks/hooks.json naming one in "modules"`, then prints `claude plugin test failed for: hello`, exit 1.

**Step 2: Implement the CC adapter**

`plugins/hello/src/claude.ts`. Every `$` call sits in this file (CC static analysis), and every gating hook has a `.catch`. The image result is the Anthropic-shaped array proven in `/tmp/mod-image-spike` (`img_e`). `/hello-probe` writes `$.session.messages()` for open question 4.

```ts
import type { On, PluginOptions } from "claude-code";
import { greet, HELLO_PNG_BASE64 } from "./core/hello.ts";

export function register(on: On, _options: PluginOptions): void {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "hello", description: "Say hello (learning-plugins skeleton)", argumentHint: "[name]", immediate: true });
    await $.command.register({ name: "hello-probe", description: "Write $.session.messages() to ./hello-probe.json", immediate: true });
    await $.tool.register({
      name: "hello_image",
      description: "Returns a small solid-colour PNG image. Look at it and tell the user its colour.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    });
    return next(e);
  });

  on("command.run", { command: "hello" }, async (_$, e) => ({ text: greet(e.args) })).catch(() => ({ text: "hello failed" }));

  on("command.run", { command: "hello-probe" }, async ($) => {
    await $.fs.write("hello-probe.json", JSON.stringify(await $.session.messages(), null, 2) + "\n");
    return { text: "wrote hello-probe.json" };
  }).catch((_$, _e, next) => ({ text: `hello-probe failed: ${next.error.message ?? next.error.kind}` }));

  on("tool.call", { tool: "mcp__hello__hello_image" }, async () => ({
    result: [
      { type: "text", text: "A solid-colour square:" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: HELLO_PNG_BASE64 } },
    ],
  })).catch((_$, _e, next) => ({ result: `hello_image failed: ${next.error.message ?? next.error.kind}`, isError: true }));
}
```

**Step 3: Run the CC tests**

Run: `npm run typecheck && npm run test:claude -- hello`
Expected: exit 0, and the kit prints:

```text
test/claude/hello.test.ts:
(pass) /hello answers with a greeting for the typed name [..ms]
(pass) hello_image answers with Anthropic text and base64 image blocks [..ms]

 2 pass
 0 fail
```

**Step 4: Build, check, validate**

```bash
npm run build && npm run check && npm run validate
```

Expected: exit 0. Validate prints `✔ Validation passed` for the repo root marketplace and for `dist/claude/hello`, including:

```text
  ❯ ./register.js hooks: session.start, command.run{command=hello}, command.run{command=hello-probe}, tool.call{tool=mcp__hello__hello_image}
  ❯ ./register.js gating hook with .catch: command.run{command=hello-probe}
  ❯ ./register.js gating hook with .catch: tool.call{tool=mcp__hello__hello_image}
  ❯ ./register.js calls: $.command.register, $.fs.write, $.session.messages, $.tool.register
```

If a line reads `gating hook without .catch`, or `--strict` reports any warning, fix `src/claude.ts`.

**Step 5: Prove the freshness check (master acceptance test 5)**

```bash
sed -i 's/|| "world"/|| "there"/' plugins/hello/src/core/hello.ts
npm run check; echo "exit $?"
git checkout plugins/hello/src/core/hello.ts
npm run check; echo "exit $?"
```

Expected: the first `check` prints the lines below, then `exit 1`. After the revert it prints `exit 0`. A comment-only edit does *not* make files stale, because esbuild drops comments; that is correct.

```text
stale: dist/claude/hello/hooks/register.js
stale: dist/omp/hello/extension.js

generated files are out of date: run `npm run build`
```

**Step 6: Commit**

```bash
git add plugins/hello dist .claude-plugin .omp-plugin
git commit -m "feat(hello): CC adapter with image tool and session probe"
```

**Step 7: Run acceptance test 1 from a clean clone (with a real plugin)**

```bash
rm -rf /tmp/lp-clean && git clone -q /home/marcus/tmp/learn/learning-plugins /tmp/lp-clean
cd /tmp/lp-clean && npm ci && npm run typecheck && npm test && npm run check && npm run validate && npm run test:claude; echo "exit $?"
cd /home/marcus/tmp/learn/learning-plugins
```

Expected: `exit 0`, with the validate and CC test output of Steps 3–4. A failure here that doesn't happen in the working copy means some generated or vendored file isn't committed. Find it with `git status`, commit it, and repeat.

---

### Task 13: CC smoke test, types refresh, open question 4

**Files:**
- Modify: `types/claude-code/claude-code/index.d.ts`
- Create: `types/claude-code/claude-code-tools/index.d.ts`
- Scratch, outside the repo: `/tmp/hello-smoke/hello-probe.json`

**Step 1: Non-interactive check**

Run: `claude -p "/hello Ada" --plugin-dir /home/marcus/tmp/learn/learning-plugins/dist/claude/hello`
Expected [UNVERIFIED: taken from the docs, not run]: `hello: Hello, Ada!`. CC prefixes command output with the plugin name (`/tmp/create.md:206-216`). If nothing prints, see `/doctor` and https://code.claude.com/docs/en/plugins/mods/troubleshoot.md.

**Step 2: Interactive session**

Run it from a scratch cwd, so `hello-probe.json` lands outside the repo:

```bash
mkdir -p /tmp/hello-smoke && cd /tmp/hello-smoke
claude --plugin-dir /home/marcus/tmp/learn/learning-plugins/dist/claude/hello
```

Accept the trust prompt if shown. In the session:

1. Type `/hello Ada`. Observe `hello: Hello, Ada!`.
2. Prompt: `Call the mcp__hello__hello_image tool once, then tell me exactly what colour the image is. If you received no image, say NO IMAGE.` Approve the tool if asked. Observe an answer naming **red**.
3. Prompt: `Use the AskUserQuestion tool exactly once to ask me which colour I prefer, with the options Red and Blue. Then repeat my answer and stop.` Choose **Blue** in the dialog.
4. Type `/hello-probe`. Observe `hello: wrote hello-probe.json`.
5. Type `/exit`.

If step 2 answers `NO IMAGE` or the wrong colour, stop: the verified image transport (design, Verified facts) no longer holds on this CC version. Record the raw tool result from `hello-probe.json` and escalate before Phase 4.

**Step 3: Read the probe (open question 4)**

```bash
jq '[.[] | select(.role == "assistant") | .toolUses[] | {tool, input, result, text, isError}]' /tmp/hello-smoke/hello-probe.json
```

Each decision rule below gives the text that Task 15 writes into the design doc.

- **`mcp__hello__hello_image`:**
  - **R1 (expected):** `result` deep-equals the returned array: a `text` block, then an `image` block with a `base64` `source`, both as returned. The design holds: md-log reads the `<quiz-result>` text block from `toolUses[].result`.
  - **R2:** `result` is absent, or isn't that array, but `text` contains `A solid-colour square:`. md-log must read the `<quiz-result>` block from `toolUses[].text`. Record the exact `result` value (or its absence).
- **`AskUserQuestion`:**
  - **R3 (expected):** `result.answers` is an object mapping the question text to `"Blue"`. The design holds.
  - **R4:** anything else. Record the exact JSON of `result` and `text`, and name the field that carries `Blue`; md-log's CC adapter reads that field.

Copy the `jq` output into `/tmp/hello-smoke/q4.txt` for Task 15.

**Step 4: Refresh the vendored types**

The interactive load in Step 2 wrote version-matched declarations into the plugin dir.

```bash
cd /home/marcus/tmp/learn/learning-plugins
ls -A dist/claude/hello/.claude-plugin/types     # .gitignore  claude-code  claude-code-mcp  claude-code-tools  tsconfig.json
npm run types:claude -- dist/claude/hello
```

Expected:

- The refresh prints `types/claude-code refreshed: // Written by Claude Code 2.1.296.` If the version differs from `claude --version`, the load in Step 2 didn't happen with this binary; repeat Step 2.
- `claude-code/index.d.ts` is replaced, and `claude-code-tools/index.d.ts` is added. `claude-code-mcp` is not vendored, because it lists this machine's MCP servers.

**Step 5: Verify**

```bash
npm run typecheck && npm test && npm run check && npm run test:claude -- hello
git status --short
```

Expected:

- Everything exits 0. `check` passes even though `dist/claude/hello/tsconfig.json` and `dist/claude/hello/.claude-plugin/types/` now exist, because `diffRepo` ignores them.
- `git status` lists only `types/claude-code/claude-code/index.d.ts` (M) and `types/claude-code/claude-code-tools/` (??). The other new files are ignored.
- If `typecheck` now fails, the mods API changed between 2.1.277 and 2.1.296. Change `plugins/hello/src/claude.ts` (and the fixture `build/test/fixtures/repo/plugins/alpha/src/claude.ts`) to the new types, then re-run `npm run build && npm run test:claude -- hello && npm run validate`. The prototype typechecked unchanged against both versions.

**Step 6: Commit**

```bash
git add types/claude-code
git commit -m "chore: refresh vendored Claude Code types to 2.1.296"
```

---

### Task 14: omp smoke test, open question 1

**Files:**
- Create (outcome A or C only): `.omp/agents/.gitkeep`
- Create (outcome C only): `.omp/config.yml`

The source facts are listed under "Facts this phase relies on". `<cwd>/.omp/config.yml` is the only project config omp reads, so `../.omp/config.yml` does **not** load inside this repo. Agent discovery, however, walks up to `/`, so `../.omp/agents/{researcher,mermaid-maker,svg-maker}.md` **do** load as project agents and outrank plugin agents. This task confirms both live.

**Step 1: Settings layer**

```bash
cd /home/marcus/tmp/learn/learning-plugins
omp config get extensions --json
omp config get skills.customDirectories --json
```

Expected: both `"value": []`.

**Step 2: Install from the local marketplace (user scope)**

```bash
omp plugin marketplace add /home/marcus/tmp/learn/learning-plugins
omp plugin install hello@learning-plugins
omp plugin list
```

Expected:

- The marketplace `learning-plugins` is added; omp reads `.omp-plugin/marketplace.json`.
- `hello@learning-plugins` is installed at user scope. Never pass `--scope project`: the project registry would resolve to `../.omp/plugins`.

**Step 3: Session checks**

Start `omp` in `/home/marcus/tmp/learn/learning-plugins`. Extensions load at session start, so always open a new session after an install. Then:

1. `/hello Ada`: a notification reads `Hello, Ada!`.
2. `/tools`: the list includes `hello_image`, and **none of** `quiz`, `ask_user_question`, `write_mermaid`, `edit_mermaid`, `render_mermaid`, `write_svg`, `edit_svg`, `render_svg`.
3. Prompt: `Call the hello_image tool once, then tell me exactly what colour the image is. If you received no image, say NO IMAGE.` The answer names **red**.
4. `/agents`: note whether `researcher`, `mermaid-maker` and `svg-maker` are listed.
5. Exit the session.

**Step 4: Apply the decision rule (open question 1)**

- **A (expected): step 4 lists the three old agents.** Shield them with an empty project agents dir. It stops the upward walk for the `.omp` base (`src/config.ts:224-235`). It also makes `learning-plugins/.omp/` the project anchor, so `../.omp` is no longer the project registry.

  ```bash
  mkdir -p .omp/agents && touch .omp/agents/.gitkeep
  ```

  Open a new `omp` session and run `/agents`: the three old agents are gone. If they're still there, stop and record the `/agents` output; Phases 4 and 5 can't dogfood their agents until this is resolved.
- **B: step 4 doesn't list them.** Add nothing, and record that the agent walk-up wasn't observed.
- **C (contradicts the source): step 2 lists any old tool.** Do A, and also add `.omp/config.yml`:

  ```yaml
  # Shields this repo from ../.omp/config.yml when omp merges ancestor configs.
  extensions: []
  skills:
    customDirectories: []
  ```

  A project YAML `extensions` array replaces the user one (`omp-extension-roots.ts:229`). Open a new session; `/tools` is now clean.

**Step 5: The dev alternative (`link`)**

A marketplace install and a link of the same package name conflict, so remove one before adding the other:

```bash
omp plugin uninstall hello@learning-plugins
omp plugin link /home/marcus/tmp/learn/learning-plugins/dist/omp/hello
omp plugin list                       # @learning-plugins/hello (linked)
```

New `omp` session: `/hello Ada` gives `Hello, Ada!`. Exit, then clean up:

```bash
omp plugin uninstall @learning-plugins/hello
omp plugin list                       # hello is gone
```

Leave the `learning-plugins` marketplace added; later phases install from it.

**Step 6: Commit (outcomes A and C only)**

```bash
git add .omp
git commit -m "chore: shield ../.omp agents and config from omp sessions in this repo"
```

---

### Task 15: Record the findings, then delete `hello`

**Files:**
- Modify: `docs/plans/2026-10-10-learning-plugins-design.md` (Repository layout, Verified facts, Open questions)
- Delete: `plugins/hello/**`, `dist/**`
- Modify: `package-lock.json`, both catalogs

**Step 1: Fix the design's layout**

- In the "Repository layout" block, replace the line `├── tsconfig.base.json` with `├── tsconfig.json`.
- Under outcome A or C, also add `├── .omp/agents/.gitkeep             # shields ../.omp/agents (open question 1)` after the `.omp-plugin/marketplace.json` line.

**Step 2: Add the findings to "Verified facts"**

Append this sub-list at the end of the section, just before `## Open questions`. Use the bullet for the outcome you observed; the texts below are for A, R1 and R3.

```markdown
From the skeleton (Phase 1), Claude Code 2.1.296, omp 18.2.10:

- **Vendored CC types**: `types/claude-code/` holds `claude-code/index.d.ts` and `claude-code-tools/index.d.ts` as written by Claude Code 2.1.296 on an interactive `--plugin-dir` load. CC also writes `claude-code-mcp/` (not vendored: machine-specific) and a root `tsconfig.json` into that plugin dir; both are ignored by git and by `npm run check`.
- **CC marketplace**: `validate --strict` requires a top-level `description` and rejects a marketplace with no plugins.
- **CC test kit**: `$.command.run` takes the whole `CommandRunInput` (`origin`, `presentation`); `claude plugin validate` and `claude plugin test` need no login.
- **omp**: extension tools default to `loadMode: "discoverable"` (`xd://` devices); `"essential"` keeps them top-level. A plain JSON Schema is accepted as `parameters`.
- **Open question 1**: omp reads project config only from `<cwd>/.omp`, so `../.omp/config.yml` does not load inside `learning-plugins/` (`omp config get extensions` → `[]`; no old tools in `/tools`). Agent discovery walks every ancestor, so `../.omp/agents/*.md` did load as project agents and outranked plugin agents; the committed `.omp/agents/.gitkeep` shields them. Never use `--scope project` here.
- **Open question 4**: `$.session.messages()` returns a mod tool's `result` array as returned (`toolUses[].result` deep-equals the text + base64 image blocks), and `AskUserQuestion`'s `result.answers` maps the question text to the chosen label.
```

Replace bullets for other outcomes:

- **Outcome B** (open question 1): `… Agent discovery walks every ancestor (src/config.ts:218-247), but no ../.omp agent appeared in /agents; no shield is committed. Never use --scope project here.`
- **Outcome C** (open question 1): append `Contrary to the source, old tools appeared; .omp/config.yml with extensions: [] and skills.customDirectories: [] is committed.`
- **R2** (open question 4, first half): `A mod tool's result is not kept in toolUses[].result (observed: <the value from q4.txt>); its text is in toolUses[].text, so md-log reads <quiz-result> from text.` Also edit the md-log CC adapter "Answer" bullet in the design to say `toolUses[].text`.
- **R4** (open question 4, second half): `AskUserQuestion's toolUses[].result is <exact JSON from q4.txt>; the chosen label is at <field>.` Also edit the md-log CC adapter "Answer" bullet to name that field.

**Step 3: Mark open questions 1 and 4 resolved**

In the Open questions table, change the "Resolve in" cell of rows 1 and 4 from `skeleton` to `answered (Verified facts, skeleton)`.

**Step 4: Commit the doc**

```bash
git add docs/plans/2026-10-10-learning-plugins-design.md
git commit -m "docs: record skeleton findings (open questions 1 and 4, CC types 2.1.296)"
```

**Step 5: Delete `hello` and rebuild**

```bash
git rm -r -q plugins/hello
rm -rf .test-build /tmp/hello-smoke
npm install
npm run build
npm run typecheck && npm test && npm run check && npm run validate && npm run test:claude
```

Expected:

- `npm install` prints `removed 1 package`, and `package-lock.json` drops `plugins/hello`.
- The build deletes `dist/` and rewrites both catalogs with `"plugins": []`.
- `validate` skips the empty root marketplace but prints `✔ Validation passed` for `.test-build/fixtures/alpha`; `test:claude` runs `alpha.test.ts` and reports `1 pass, 0 fail`.
- Everything exits 0. `npm test` runs the 7 remaining files under `build/`, `shared/` and `test-support/`.

**Step 6: Commit**

```bash
git add -A plugins dist .claude-plugin .omp-plugin package-lock.json
git commit -m "chore: remove throwaway hello plugin"
```

---

### Task 16: CI

**Files:**
- Create: `.github/workflows/ci.yml`

The CC CLI is installed globally, pinned to the version the vendored types came from; bump both together. `claude plugin validate` and `claude plugin test` need no auth (verified with an empty `HOME`). `npm ci` installs about 2 GB, and the npm cache keeps reruns fast.

**Step 1: Write the workflow**

```yaml
name: ci
on:
  push:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-24.04
    env:
      DISABLE_AUTOUPDATER: "1"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - name: Install Claude Code (pinned to the vendored types' version)
        run: npm install --global @anthropic-ai/claude-code@2.1.296
      - run: claude --version
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run check
      - run: npm run validate
      - run: npm run test:claude
```

**Step 2: Check that it parses**

Run: `node --input-type=module -e 'import { parse } from "yaml"; import { readFileSync } from "node:fs"; const w = parse(readFileSync(".github/workflows/ci.yml", "utf8")); console.log(w.jobs.check.steps.map((s) => s.run ?? s.uses).join("\n"))'`
Expected: the 10 step lines, in the order above.

**Step 3: Run acceptance test 1 from a clean clone**

```bash
git add .github/workflows/ci.yml && git commit -m "ci: typecheck, tests, freshness, validate and CC tests on Node 24.15.0"
rm -rf /tmp/lp-clean && git clone -q /home/marcus/tmp/learn/learning-plugins /tmp/lp-clean
cd /tmp/lp-clean && npm ci && npm run typecheck && npm test && npm run check && npm run validate && npm run test:claude; echo "exit $?"
cd /home/marcus/tmp/learn/learning-plugins && rm -rf /tmp/lp-clean
```

Expected: `exit 0`. The workflow first runs on GitHub when Phase 5 pushes. Don't push here.

---

## [UNVERIFIED] items and how to settle them

| Item | Verify in | Decision rule |
|---|---|---|
| `claude -p "/hello Ada" --plugin-dir …` prints `hello: Hello, Ada!` (per the docs) | Task 13 Step 1 | Silent or a different prefix: rely on the interactive Step 2 check, and note the real output in Task 15's findings. |
| omp `/tools` and `/agents` show what this plan expects (based on reading source: `slash-commands/builtin-session.ts:440-504`) | Task 14 Step 3 | If `/tools` isn't available, use the prompt `List the names of every tool you can call, one per line, nothing else.`; if `/agents` isn't, use `List every agent name your task tool can spawn, one per line.` |
| omp `/hello` and `hello_image` work after a real marketplace install. Only the Node-side bundle load was tested; `omp -e … -p "/hello Ada"` printed nothing useful in print mode. | Task 14 Step 3 | If the command or tool is missing, check `/extensions` for load errors. A host-import failure means a non-external import reached `extension.js`, so fix `src/omp.ts` and rebuild. |
| `npm install` after removing `plugins/hello` prints `removed 1 package` | Task 15 Step 5 | Any output is fine as long as `package-lock.json` no longer mentions `plugins/hello`, and `npm ci` passes in Task 16. |
| `ToolUseSummary.result` shapes (open question 4) | Task 13 Step 3 | Rules R1–R4. |
| omp agent walk-up shadows plugin agents (open question 1) | Task 14 Step 4 | Outcomes A, B, C. |
| The GitHub Actions run itself (`setup-node` `node-version-file: .nvmrc` with `v24.15.0`, global CC install) | first push in Phase 5 | If the CC global install fails on the runner, swap Step "Install Claude Code" for `curl -fsSL https://claude.ai/install.sh \| bash -s 2.1.296` [UNVERIFIED] and re-run. |

## Phase exit checklist

- `git log --oneline` shows this phase's commits on top of `84332f0 docs: add implementation plan master`, and `git status` is clean.
- `plugins/` is absent or empty, `dist/` is absent, and both catalogs list no plugins; `build/test/fixtures/repo/plugins/alpha` remains and `npm run validate && npm run test:claude` exercises its built CC mod.
- `types/claude-code/claude-code/index.d.ts` starts with `// Written by Claude Code 2.1.296.`.
- The design doc answers open questions 1 and 4.
- The master plan's Shared contracts include refinements 1–11.
