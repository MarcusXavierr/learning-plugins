# Phase 4: visual-tools

Port the Mermaid/SVG authoring loop (`write_/edit_/render_` × `mermaid`/`svg`), the `mermaid-maker` and `svg-maker` agents, and the `visualize` skill to both harnesses. Rendering moves from system binaries and a plugin-local `node_modules` to one bundled Node CLI (`renderer/render.js`) that lazily `npm ci`s pinned `@mermaid-js/mermaid-cli` + `@resvg/resvg-js` into the user cache on first use. Resolves design open question 5 (install size and time).

**Prerequisites:** Phase 1 merged: workspace, `build/` (incl. `extraBundles`, `copy`, `renderPrompts(src, harness)` in `build/plugin-tree.ts`), `shared/tool-map.ts`, `test-support/fake-omp.ts` (`createFakeOmp({ cwd })`), vendored CC types, `npm run test:claude`. Node 24.15.0 (`source ~/.nvm/nvm.sh && nvm use 24.15.0`). Google Chrome or Chromium installed (Mermaid only). `CI=true` is set in this shell: golden files are created only with `npx vitest run -u <file>`.

## Acceptance tests (phase done when all hold)

1. **Given** a maker agent in either harness and an empty renderer cache (`XDG_CACHE_HOME=$(mktemp -d)`), **when** it calls `render_mermaid`/`render_svg` twice, **then** the renderer installs once into `$XDG_CACHE_HOME/learning-plugins/visual-tools/<16-hex>/` (verified by a persistent marker or npm-invocation count), the model receives each PNG as an image, and the second render does not reinstall.
2. **Given** `render_* { save_as: "number-line" }`, **when** it succeeds, **then** `<cwd>/viz/viz-number-line-<epochMs>-<6 base36>.png` exists, was created exclusively (an existing file is never overwritten), and the result text names that filename.
3. **Given** an `edit_*` whose `old_text` matches 0 or 2+ times, **when** it runs, **then** it fails with a message naming the count and the source is unchanged.
4. **Given** two maker subagents running at once (omp: two sessions in one process; CC: two `agentId`s in one module), **when** each writes and renders, **then** neither sees the other's source.
5. **Given** a broken source, a failed install, a missing `node` or a PNG over 4 MiB (CC), **when** render runs, **then** the tool returns a model-readable error (omp `isError` result, CC `{ result, isError: true }`) containing the renderer's stderr tail or the exact remedy; a failed install leaves no *current* cache, and a killed install's abandoned staging is reclaimed on a later invocation so the next render can retry.

## Decisions this phase makes (read before coding)

Grounded in source/types and in throwaway prototypes run on this machine (core + omp Vitest suites, CC kit suite and `validate --strict`, and the renderer CLI end to end, all green).

| # | Decision | Grounds |
|---|---|---|
| D1 | **omp state lives in the factory closure, not at module level.** The design says "each maker subagent runs in its own process, as today"; that was pi's `interactive-subagents`. omp 18.2.10 runs task subagents **in-process** and re-binds the already-imported extension factory per session (`@oh-my-pi/pi-coding-agent` `src/sdk.ts:2203-2205`, `src/task/executor.ts:512-519`). Module state would be shared by all parallel makers. | omp source |
| D2 | **omp: plain `pi.registerTool` with `hidden: true` + `loadMode: "essential"`; no `interactive-subagents` bridge.** `hidden`: "excluded unless explicitly listed in --tools or agent's tools field" (`dist/types/extensibility/extensions/types.d.ts:429-430`, enforced at `src/sdk.ts:4051`); task agents pass their frontmatter `tools` as the explicit list (`src/task/executor.ts:3358-3361`). That reproduces the original exposure (tools loaded only into maker subagents, `.pi/extensions/visual-tools/index.ts:20-26`). `loadMode: "essential"` (Main's directive, types.d.ts:434) keeps them top-level tools rather than `xd://` devices wherever enabled. | omp types/source |
| D3 | **Tool parameter schemas are plain JSON Schema, one builder for both harnesses** (`inputSchema` in core). omp's `TSchema = Type \| TJsonSchema` (`@oh-my-pi/pi-ai` `dist/types/types.d.ts:1089-1100`); no `@sinclair/typebox` dependency. | pi-ai types |
| D4 | **Per-key serialization holds by construction; no queue.** Sources live in memory (`SourceStore`), and every read-modify-write is synchronous (no `await` between read and write). A render snapshots the source synchronously and writes uniquely named staging/output files, so concurrent renders on one key cannot collide. A promise queue would *hurt* in CC: awaiting one's own Promise counts against the 10 s hook budget (design, CC hook time budget), so a call queued behind a 60 s render would overrun. | design + reasoning |
| D5 | **Publish = render straight into `<cwd>/viz/<unique>.png`.** The original re-rendered on `save_as` and copied (`mermaid_tools.ts:146-180`). `$.fs.write` is text-only (cc.d.ts:2758-2764), so CC cannot copy a PNG; instead `render.js` writes `--out` itself with `copyFileSync(tmp, out, COPYFILE_EXCL)`: exclusive create, exit 3 if it exists. Same code path in both harnesses. | cc.d.ts |
| D6 | **Names:** `viz-<slug>-<epochMs>-<6 base36>.png`, slug lowercased to `[a-z0-9-]`, ≤ 60 chars, `viz` when empty. Randomness and time are injected (`publishName(slug, nowMs, random)`). Previews use the same scheme with slug `preview` inside a private staging dir (omp: a fresh mode-0700 `mkdtemp(os.tmpdir()/visual-tools-)` per render, removed in `finally`; CC: `<cacheRoot>/previews`, i.e. under `${XDG_CACHE_HOME:-$HOME/.cache}`, never a shared `/tmp` path). Every render removes its staged source and its preview (CC: `rm -f` through `$.process.run`, since `$.fs` has no delete) on success and on failure; only published PNGs stay. | cc.d.ts:2738-2852 |
| D7 | **Install cache key:** FNV-1a 64 over the lockfile text (pure, no crypto API; identical in the CC mod runtime and Node). Dir `${XDG_CACHE_HOME:-$HOME/.cache}/learning-plugins/visual-tools/<hash>`; an XDG value is used only when absolute (XDG spec). Current ⇔ `<dir>/.installed` exists. Install runs in `mkdtemp(<root>/<hash>.tmp-)`, writes the marker last, then atomically `rename`s into place. Concurrent installers may both download, but only one becomes current; never delete an existing destination (a `<hash>` dir without `.installed` is reported, not removed). Before every render, reclaim only this hash's abandoned staging directories older than 20 minutes (more than the 9-minute `npm ci` timeout and the 10-minute host budget), first renaming each to a private `<hash>.reap-<uuid>` name: only the process that wins that rename deletes the bytes. A `.reap-` dir whose ctime (set by the claiming rename) is older than 20 minutes was left by a killed reaper and is reclaimed the same way. Crash-killed installers are therefore cleaned on the next invocation. | — |
| D8 | **Pins:** `@mermaid-js/mermaid-cli` **12.0.0**, `@resvg/resvg-js` **2.6.2**, `puppeteer` **25.13.0** (mermaid-cli 12 declares `puppeteer ^25` as a *peer* dependency; pinning it makes the lock explicit). `npm view` on 2026-10-10. `npm ci --ignore-scripts` (puppeteer's postinstall only downloads browsers; resvg ships prebuilt optional binaries) with `PUPPETEER_SKIP_DOWNLOAD=1`, no `--omit=optional`. | npm |
| D9 | **mermaid-cli via its JS API** (`run(input, output, opts)` from `src/index.js`, exported as `"."` default) loaded with `createRequire(<cacheDir>/package.json).resolve` + `import()`, options equal to the original `mmdc -s 2 -b white` with a puppeteer config `{headless:"shell", executablePath, args:["--no-sandbox"]}`. Verified rendering with Chrome 149 here. **SVG via resvg** `fitTo: zoom 2` (= `rsvg-convert -z 2`, `svg_tools.ts:49`), system fonts, `sans-serif` default, no background (as rsvg). | prototype |
| D10 | **`node` comes from PATH in both harnesses** (omp runs extensions under bun, so `process.execPath` is not Node). `render.js` refuses Node < 22.13 (mermaid-cli `engines`) with exit 2 and a message naming the binary. **Verified under real CC 2.1.296**: `$.process.run(["node", …])` resolves via the PATH of the shell that launched `claude`; with nvm's default v18 on PATH the render failed with exactly that message, with 24.15.0 it installed and rendered. | prototype |
| D11 | **CC errors** are `{ result: text, isError: true }` (design), agreed with Phase 3 (quiz). [UNVERIFIED] whether the model sees `is_error: true`: checked in the smoke (Task 9), same rule as Phase 3. | PlanQuiz |
| D12 | **CC tool names verified:** a mod named `visual-tools` registering `write_mermaid` etc. surfaces as `mcp__visual-tools__write_mermaid` (stream-json `init.tools` of a real `claude -p --plugin-dir` run). One `tool.call` hook with an **array matcher** of the six literal names (`Matcher`: "an array is any-of", cc.d.ts:4887-4897) passes `claude plugin validate --strict` with zero warnings, and the kit passes `agentId` through to the hook. | prototype |
| D13 | **CC source store lives for one conversation.** The CC module (and its `SourceStore`, keyed by `agentId ?? "main"`) survives `/clear`, `/resume` and `/branch`, and `session.start` does not rerun after them; `session.end` does fire for all three (`/branch` reports `resume`) and at exit (reference.md:116-117; `SessionEndInput`, cc.d.ts:8882-8897). So a `session.end` hook replaces the store; otherwise the next conversation's `main` key would render the previous conversation's source. Same rule as md-log's link (02-md-log.md, "CC clears the link on `session.end`"). | CC docs/types |

Measured so far (open question 5, preliminary, this laptop): first `npm ci` with an **empty npm cache** 41 s, `node_modules` 453 MB plus 95 MB npm download cache; with a warm npm cache 4–13 s. First Mermaid render ~1.6 s. Task 9 records the final numbers.

## File map

```
shared/tool-map.ts                                  modify: +6 TOOLS, +2 AGENTS
plugins/visual-tools/
├── package.json                                    plugin manifest (extraBundles + copy)
├── renderer/package.json, renderer/package-lock.json   runtime deps of render.js (NOT a workspace)
├── src/core/edit.ts        applyEdit (exact once, count in errors), snippetAround
├── src/core/sources.ts     SourceStore: per (key, kind) source
├── src/core/publish.ts     publishName, planRender
├── src/core/protocol.ts    Kind, EXIT, renderArgv, parseRenderArgs, stderrTail
├── src/core/install.ts     lockHash, cacheRoot, installPaths, renderTimeoutMs
├── src/core/tools.ts       toolSpecs(harness), inputSchema, result texts
├── src/renderer/cli.ts     → renderer/render.js (extraBundle, platform node)
├── src/omp.ts              omp adapter
├── src/claude.ts           CC adapter
├── prompts/agents/{mermaid-maker,svg-maker}.md, prompts/skills/visualize/SKILL.md
└── test/{core,renderer,omp,prompts}.test.ts, test/claude/visual-tools.test.ts, test/__golden__/**
```

`renderer/` is not a workspace: root `workspaces` is `["plugins/*"]`, which matches `plugins/visual-tools` only, and npm uses the **nearest** `package.json` as its prefix. Verified in a scratch workspace: `npm install --package-lock-only` inside `plugins/visual-tools/renderer/` wrote `renderer/package-lock.json` and left the root lock byte-identical (no `resvg` entries); `--workspaces=false` is accepted and changes nothing. Keep the flag as belt and braces.

---

### Task 1: Tool-map entries and plugin manifest

**Files:**
- Modify: `shared/tool-map.ts` (add entries to `TOOLS` and `AGENTS`)
- Create: `plugins/visual-tools/package.json`

No new test: these are data rows; Phase 1's tool-map tests cover lookup and unknown ids, and every row is exercised by Tasks 6–8 (adapter tests assert the CC names, prompt goldens show both).

**Step 1: Add exactly these rows** to `shared/tool-map.ts`:

```ts
// in TOOLS
write_mermaid: { omp: "write_mermaid", claude: "mcp__visual-tools__write_mermaid" },
edit_mermaid: { omp: "edit_mermaid", claude: "mcp__visual-tools__edit_mermaid" },
render_mermaid: { omp: "render_mermaid", claude: "mcp__visual-tools__render_mermaid" },
write_svg: { omp: "write_svg", claude: "mcp__visual-tools__write_svg" },
edit_svg: { omp: "edit_svg", claude: "mcp__visual-tools__edit_svg" },
render_svg: { omp: "render_svg", claude: "mcp__visual-tools__render_svg" },

// in AGENTS
"visual-tools/mermaid-maker": { omp: "mermaid-maker", claude: "visual-tools:mermaid-maker" },
"visual-tools/svg-maker": { omp: "svg-maker", claude: "visual-tools:svg-maker" },
```

**Step 2: Create `plugins/visual-tools/package.json`** (no `plugin` field yet; Task 5 adds it with its entry file):

```json
{
  "name": "@learning-plugins/visual-tools",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Mermaid and SVG drawing tools with render-and-look maker agents and the visualize skill."
}
```

**Step 3:** `npm install` (registers the workspace in the root lock), then `npx vitest run shared` → PASS, `npm run build && npm run check` → exit 0.

**Step 4: Commit**

```bash
git add shared/tool-map.ts plugins/visual-tools/package.json package-lock.json dist .claude-plugin .omp-plugin
git commit -m "feat(visual-tools): add plugin manifest and tool-map entries"
```

### Task 2: Core — exact-match edit and per-key source state

**Files:**
- Create: `plugins/visual-tools/src/core/edit.ts`, `plugins/visual-tools/src/core/sources.ts`, `plugins/visual-tools/src/core/protocol.ts` (only `Kind` is needed here; write the whole file now, Task 4 tests the rest)
- Test: `plugins/visual-tools/test/core.test.ts`

**Step 1: Write the failing tests** — create `test/core.test.ts` (Tasks 3 and 4 append to it; its final form is in Task 4):

```ts
import { describe, expect, test } from "vitest";
import { applyEdit, EditError } from "../src/core/edit.ts";
import { SourceError, SourceStore } from "../src/core/sources.ts";

/** Deterministic stand-in for Math.random: yields the given values in a cycle. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe("applyEdit", () => {
  test("replaces the single occurrence and reports where it was", () => {
    expect(applyEdit("graph TD\n  A --> B\n", "A --> B", "A --> C")).toEqual({ updated: "graph TD\n  A --> C\n", index: 11 });
  });

  test("zero matches is an error that names the count", () => {
    expect(() => applyEdit("A --> B", "A --> X", "Y")).toThrow(new EditError(
      "`old_text` matches 0 times; it must match exactly once. Nothing changed: copy it exactly from the current source.",
    ));
  });

  test("several matches is an error that names the count", () => {
    expect(() => applyEdit("A --> B\nA --> C\nA --> D", "A -->", "Z -->")).toThrow(/matches 3 times/);
  });

  test("overlapping occurrences count as separate matches", () => {
    expect(() => applyEdit("aaa", "aa", "b")).toThrow(/matches 2 times/);
  });

  test("empty and no-op edits are rejected", () => {
    expect(() => applyEdit("abc", "", "x")).toThrow(/non-empty/);
    expect(() => applyEdit("abc", "b", "b")).toThrow(/identical/);
  });
});

describe("SourceStore", () => {
  test("keys and kinds are independent", () => {
    const store = new SourceStore("omp");
    store.write("main", "mermaid", "graph TD\nA-->B");
    store.write("agent-1", "mermaid", "graph LR\nX-->Y");
    store.write("main", "svg", "<svg></svg>");
    expect(store.read("main", "mermaid")).toBe("graph TD\nA-->B");
    expect(store.read("agent-1", "mermaid")).toBe("graph LR\nX-->Y");
    expect(store.read("main", "svg")).toBe("<svg></svg>");
    expect(() => store.read("agent-1", "svg")).toThrow(SourceError);
  });

  test("reading before writing names the write tool of the harness", () => {
    expect(() => new SourceStore("omp").read("main", "svg")).toThrow("No svg source yet: call write_svg first.");
    expect(() => new SourceStore("claude").read("main", "mermaid")).toThrow(
      "No mermaid source yet: call mcp__visual-tools__write_mermaid first.",
    );
  });

  test("write trims the source and returns its line count", () => {
    const store = new SourceStore("omp");
    expect(store.write("main", "mermaid", "\n  graph TD\nA-->B\n\n")).toBe(2);
    expect(store.read("main", "mermaid")).toBe("graph TD\nA-->B");
  });

  test("blank sources and SVG without an <svg> element are rejected", () => {
    const store = new SourceStore("omp");
    expect(() => store.write("main", "mermaid", "  \n ")).toThrow(/non-empty/);
    expect(() => store.write("main", "svg", "<rect/>")).toThrow(/complete <svg>/);
  });

  test("a failed edit leaves the source unchanged; a good one returns the numbered region", () => {
    const store = new SourceStore("omp");
    store.write("main", "mermaid", "graph TD\n  A --> B\n  B --> C");
    expect(() => store.edit("main", "mermaid", "-->", "==>")).toThrow(/matches 2 times/);
    expect(store.read("main", "mermaid")).toBe("graph TD\n  A --> B\n  B --> C");
    expect(store.edit("main", "mermaid", "B --> C", "B --> D")).toBe("1  graph TD\n2    A --> B\n3    B --> D");
    expect(store.read("main", "mermaid")).toBe("graph TD\n  A --> B\n  B --> D");
  });
});
```

Note the overlapping-match case: the original counted non-overlapping matches after detecting an overlapping second one (`_common.ts:107-118`), so `"aa"` in `"aaa"` reported "appears 1 times". Counting overlapping start positions fixes that.

**Step 2:** `npx vitest run plugins/visual-tools/test/core.test.ts` → FAIL: cannot resolve `../src/core/edit.ts`.

**Step 3: Implement.**

`src/core/edit.ts`:

```ts
/** Exact-match single replacement (pi/omp `edit` semantics) and a numbered window around it. Pure. */

export class EditError extends Error {}

/** Start offsets of every occurrence of `needle`, overlapping ones included ("aa" occurs twice in "aaa"). */
function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) found.push(i);
  return found;
}

/** Replace the one occurrence of `oldText`. Throws EditError naming the match count when it is not exactly one. */
export function applyEdit(current: string, oldText: string, newText: string): { updated: string; index: number } {
  if (oldText === "") throw new EditError("`old_text` must be non-empty.");
  if (oldText === newText) throw new EditError("`old_text` and `new_text` are identical.");
  const hits = occurrences(current, oldText);
  if (hits.length !== 1) {
    const fix = hits.length === 0 ? "copy it exactly from the current source" : "add surrounding context to make it unique";
    throw new EditError(`\`old_text\` matches ${hits.length} times; it must match exactly once. Nothing changed: ${fix}.`);
  }
  const index = hits[0]!;
  return { updated: current.slice(0, index) + newText + current.slice(index + oldText.length), index };
}

/** Lines around char offset `index`, numbered from 1. Port of _common.ts:124-134. */
export function snippetAround(content: string, index: number, contextLines = 3): string {
  const hitLine = content.slice(0, index).split("\n").length - 1;
  const lines = content.split("\n");
  const start = Math.max(0, hitLine - contextLines);
  const end = Math.min(lines.length - 1, hitLine + contextLines);
  const width = String(end + 1).length;
  const out: string[] = [];
  for (let i = start; i <= end; i++) out.push(`${String(i + 1).padStart(width)}  ${lines[i]}`);
  return out.join("\n");
}
```

`src/core/protocol.ts`:

```ts
/** The renderer CLI protocol: `node render.js --kind mermaid|svg --in <abs> --out <abs>`. Pure. */

export type Kind = "mermaid" | "svg";

export interface RenderRequest {
  kind: Kind;
  /** Absolute path of the source file. */
  input: string;
  /** Absolute path of the PNG to create. Must not exist: the CLI creates it exclusively. */
  output: string;
}

/** Exit codes of render.js. Anything non-zero carries a human-readable stderr tail. */
export const EXIT = { ok: 0, render: 1, usage: 2, exists: 3, install: 4 } as const;

export class UsageError extends Error {}

/** Full argv for the host's process runner: `[node, script, ...flags]`. */
export function renderArgv(node: string, script: string, req: RenderRequest): string[] {
  return [node, script, "--kind", req.kind, "--in", req.input, "--out", req.output];
}

/** Inverse of the flag part of `renderArgv`. Throws UsageError naming the problem. */
export function parseRenderArgs(args: readonly string[]): RenderRequest {
  const seen = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag !== "--kind" && flag !== "--in" && flag !== "--out") throw new UsageError(`unknown argument "${flag}"`);
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    if (seen.has(flag)) throw new UsageError(`${flag} given twice`);
    seen.set(flag, value);
  }
  const kind = seen.get("--kind");
  const input = seen.get("--in");
  const output = seen.get("--out");
  if (kind === undefined || input === undefined || output === undefined) {
    throw new UsageError("usage: render.js --kind mermaid|svg --in <abs> --out <abs>");
  }
  if (kind !== "mermaid" && kind !== "svg") throw new UsageError(`--kind must be mermaid or svg, got "${kind}"`);
  for (const [flag, path] of [["--in", input], ["--out", output]] as const) {
    if (!path.startsWith("/")) throw new UsageError(`${flag} must be an absolute path, got "${path}"`);
  }
  if (!output.endsWith(".png")) throw new UsageError(`--out must end in .png, got "${output}"`);
  return { kind, input, output };
}

/** Last `lines` non-empty lines of a stderr stream: what the model sees on failure. */
export function stderrTail(stderr: string, lines = 30): string {
  const kept = stderr.split("\n").filter((l) => l.trim() !== "");
  return kept.slice(-lines).join("\n") || "unknown error (renderer wrote nothing to stderr)";
}
```

`src/core/sources.ts` (needs `toolName` from Task 1):

```ts
/** The managed Mermaid / SVG source of each agent loop. Pure, in memory. */
import { toolName, type Harness } from "../../../../shared/tool-map.ts";
import { applyEdit, snippetAround } from "./edit.ts";
import type { Kind } from "./protocol.ts";

export class SourceError extends Error {}

/**
 * One source per (key, kind). omp creates one store per session, key "main"; CC shares one store across
 * loops, key = `agentId ?? "main"`. Every method is synchronous, so a read-modify-write can never
 * interleave with another call on the same key: per-key serialization holds by construction.
 */
export class SourceStore {
  readonly #sources = new Map<string, string>();

  constructor(readonly harness: Harness) {}

  /** Replace the source; returns its line count. Leading/trailing whitespace is trimmed (as the original). */
  write(key: string, kind: Kind, source: string): number {
    const text = source.trim();
    const tool = toolName(`write_${kind}`, this.harness);
    if (text === "") throw new SourceError(`${tool} requires a non-empty \`source\`.`);
    if (kind === "svg" && !text.includes("<svg")) throw new SourceError(`${tool}: source must be a complete <svg>…</svg> document.`);
    this.#sources.set(`${key}\u0000${kind}`, text);
    return text.split("\n").length;
  }

  read(key: string, kind: Kind): string {
    const text = this.#sources.get(`${key}\u0000${kind}`);
    if (text === undefined) throw new SourceError(`No ${kind} source yet: call ${toolName(`write_${kind}`, this.harness)} first.`);
    return text;
  }

  /** Exact-once replacement; on any error the stored source is unchanged. Returns a numbered snippet of the edited region. */
  edit(key: string, kind: Kind, oldText: string, newText: string): string {
    const { updated, index } = applyEdit(this.read(key, kind), oldText, newText);
    this.#sources.set(`${key}\u0000${kind}`, updated);
    return snippetAround(updated, index);
  }
}
```

**Step 4:** same command → PASS.

**Step 5:** `npm run typecheck`, then commit:

```bash
git add plugins/visual-tools/src/core plugins/visual-tools/test/core.test.ts
git commit -m "feat(visual-tools): exact-match edit and per-key source store"
```

### Task 3: Core — unique publish names and render plan

**Files:**
- Create: `plugins/visual-tools/src/core/publish.ts`
- Test: `plugins/visual-tools/test/core.test.ts` (append)

**Step 1: Append failing tests** (`publishName`, `planRender` blocks of the full file in Task 4).

**Step 2:** run → FAIL: cannot resolve `../src/core/publish.ts`.

**Step 3: Implement** `src/core/publish.ts`:

```ts
/** File names and paths of one render. Pure: time and randomness are injected. */
import type { Kind } from "./protocol.ts";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const MAX_SLUG = 60;

/** `viz-<slug>-<nowMs>-<6 random base36 chars>.png`; slug = lowercase [a-z0-9-], at most 60 chars, "viz" when empty. */
export function publishName(slug: string, nowMs: number, random: () => number): string {
  const clean =
    slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, MAX_SLUG)
      .replace(/^-+|-+$/g, "") || "viz";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return `viz-${clean}-${nowMs}-${suffix}.png`;
}

export interface RenderPlan {
  /** Where the adapter writes the current source before rendering. */
  input: string;
  /** `--out` for render.js. */
  output: string;
  /** Set when the render publishes into `<cwd>/viz/`. */
  published?: { filename: string; path: string };
}

export interface PlanInput {
  kind: Kind;
  /** The tool's `save_as`; absent or blank means preview only. */
  saveAs?: string | undefined;
  cwd: string;
  /** Absolute, private to the harness process: previews and staged sources live here, never in cwd. */
  stagingDir: string;
  nowMs: number;
  random: () => number;
}

export function planRender(p: PlanInput): RenderPlan {
  const saveAs = p.saveAs?.trim() ? p.saveAs : undefined;
  const name = publishName(saveAs ?? "preview", p.nowMs, p.random);
  const input = `${p.stagingDir}/${name.slice(0, -".png".length)}.${p.kind === "mermaid" ? "mmd" : "svg"}`;
  if (saveAs === undefined) return { input, output: `${p.stagingDir}/${name}` };
  const path = `${p.cwd.replace(/\/+$/, "")}/viz/${name}`;
  return { input, output: path, published: { filename: name, path } };
}
```

**Step 4:** run → PASS. **Step 5:** commit `feat(visual-tools): unique publish names and render plan`.

### Task 4: Core — renderer protocol and install-staleness decision

**Files:**
- Create: `plugins/visual-tools/src/core/install.ts`
- Test: `plugins/visual-tools/test/core.test.ts` (append; final content below)

**Step 1: Append the failing tests.** The complete `test/core.test.ts` after this task:

```ts
import { describe, expect, test } from "vitest";
import { applyEdit, EditError } from "../src/core/edit.ts";
import { cacheRoot, installPaths, renderTimeoutMs } from "../src/core/install.ts";
import { parseRenderArgs, renderArgv, stderrTail, UsageError } from "../src/core/protocol.ts";
import { planRender, publishName } from "../src/core/publish.ts";
import { SourceError, SourceStore } from "../src/core/sources.ts";

/** Deterministic stand-in for Math.random: yields the given values in a cycle. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe("applyEdit", () => {
  test("replaces the single occurrence and reports where it was", () => {
    expect(applyEdit("graph TD\n  A --> B\n", "A --> B", "A --> C")).toEqual({ updated: "graph TD\n  A --> C\n", index: 11 });
  });

  test.each([
    ["A --> B", "A --> X", "Y", 0],
    ["A --> B\nA --> C\nA --> D", "A -->", "Z -->", 3],
  ])("rejects %j with a wrong match count", (current, oldText, newText, count) => {
    expect(() => applyEdit(current, oldText, newText)).toThrow(new RegExp(`matches ${count} times`));
  });

  test("overlapping occurrences count as separate matches", () => {
    expect(() => applyEdit("aaa", "aa", "b")).toThrow(/matches 2 times/);
  });

  test("empty and no-op edits are rejected", () => {
    expect(() => applyEdit("abc", "", "x")).toThrow(/non-empty/);
    expect(() => applyEdit("abc", "b", "b")).toThrow(/identical/);
  });
});

describe("SourceStore", () => {
  test("keys and kinds are independent", () => {
    const store = new SourceStore("omp");
    store.write("main", "mermaid", "graph TD\nA-->B");
    store.write("agent-1", "mermaid", "graph LR\nX-->Y");
    store.write("main", "svg", "<svg></svg>");
    expect(store.read("main", "mermaid")).toBe("graph TD\nA-->B");
    expect(store.read("agent-1", "mermaid")).toBe("graph LR\nX-->Y");
    expect(store.read("main", "svg")).toBe("<svg></svg>");
    expect(() => store.read("agent-1", "svg")).toThrow(SourceError);
  });

  test("reading before writing names the write tool of the harness", () => {
    expect(() => new SourceStore("omp").read("main", "svg")).toThrow("No svg source yet: call write_svg first.");
    expect(() => new SourceStore("claude").read("main", "mermaid")).toThrow(
      "No mermaid source yet: call mcp__visual-tools__write_mermaid first.",
    );
  });

  test("write trims the source and returns its line count", () => {
    const store = new SourceStore("omp");
    expect(store.write("main", "mermaid", "\n  graph TD\nA-->B\n\n")).toBe(2);
    expect(store.read("main", "mermaid")).toBe("graph TD\nA-->B");
  });

  test("blank sources and SVG without an <svg> element are rejected", () => {
    const store = new SourceStore("omp");
    expect(() => store.write("main", "mermaid", "  \n ")).toThrow(/non-empty/);
    expect(() => store.write("main", "svg", "<rect/>")).toThrow(/complete <svg>/);
  });

  test("a failed edit leaves the source unchanged; a good one returns the numbered region", () => {
    const store = new SourceStore("omp");
    store.write("main", "mermaid", "graph TD\n  A --> B\n  B --> C");
    expect(() => store.edit("main", "mermaid", "-->", "==>")).toThrow(/matches 2 times/);
    expect(store.read("main", "mermaid")).toBe("graph TD\n  A --> B\n  B --> C");
    expect(store.edit("main", "mermaid", "B --> C", "B --> D")).toBe("1  graph TD\n2    A --> B\n3    B --> D");
    expect(store.read("main", "mermaid")).toBe("graph TD\n  A --> B\n  B --> D");
  });
});

describe("publishName", () => {
  test("slugifies, stamps the time, and appends six random base36 chars", () => {
    expect(publishName("Internet Packets!", 1760000000000, seq(0, 0.5, 0.999999))).toBe(
      "viz-internet-packets-1760000000000-0iz0iz.png",
    );
  });

  test("an empty slug falls back to viz and a long one is cut to 60 chars without a trailing dash", () => {
    expect(publishName("!!!", 1, seq(0))).toBe("viz-viz-1-000000.png");
    const long = publishName(`${"a".repeat(59)} b`, 1, seq(0));
    expect(long).toBe(`viz-${"a".repeat(59)}-1-000000.png`);
  });

  test("different random draws give different names for the same slug and time", () => {
    expect(publishName("x", 1, seq(0.1))).not.toBe(publishName("x", 1, seq(0.2)));
  });
});

describe("planRender", () => {
  const base = { cwd: "/work/notes", stagingDir: "/tmp/vt-1", nowMs: 5, random: seq(0) };

  test("a preview renders into the staging dir and publishes nothing", () => {
    expect(planRender({ ...base, kind: "mermaid" })).toEqual({
      input: "/tmp/vt-1/viz-preview-5-000000.mmd",
      output: "/tmp/vt-1/viz-preview-5-000000.png",
    });
  });

  test("save_as renders straight into <cwd>/viz under the unique name", () => {
    expect(planRender({ ...base, kind: "svg", saveAs: "number-line" })).toEqual({
      input: "/tmp/vt-1/viz-number-line-5-000000.svg",
      output: "/work/notes/viz/viz-number-line-5-000000.png",
      published: { filename: "viz-number-line-5-000000.png", path: "/work/notes/viz/viz-number-line-5-000000.png" },
    });
  });

  test("a blank save_as is a preview", () => {
    expect(planRender({ ...base, kind: "svg", saveAs: "  " }).published).toBeUndefined();
  });
});

describe("render protocol", () => {
  const req = { kind: "svg", input: "/tmp/a.svg", output: "/tmp/a.png" } as const;

  test("parseRenderArgs inverts renderArgv", () => {
    expect(parseRenderArgs(renderArgv("node", "/p/renderer/render.js", req).slice(2))).toEqual(req);
  });

  test.each([
    [["--kind", "png", "--in", "/a", "--out", "/b.png"], '--kind must be mermaid or svg, got "png"'],
    [["--kind", "svg", "--in", "a.svg", "--out", "/b.png"], '--in must be an absolute path, got "a.svg"'],
    [["--kind", "svg", "--in", "/a.svg", "--out", "/b.jpg"], '--out must end in .png, got "/b.jpg"'],
    [["--kind", "svg", "--in", "/a.svg"], "usage: render.js --kind mermaid|svg --in <abs> --out <abs>"],
    [["--kind", "svg", "--kind", "svg", "--in", "/a", "--out", "/b.png"], "--kind given twice"],
    [["--kind", "--in", "/a", "--out", "/b.png"], "--kind needs a value"],
    [["--format", "png"], 'unknown argument "--format"'],
  ])("rejects %j", (args, message) => {
    expect(() => parseRenderArgs(args)).toThrow(new UsageError(message));
  });

  test("stderrTail keeps the last non-empty lines and never returns nothing", () => {
    const err = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n\n");
    expect(stderrTail(err).split("\n")).toEqual(Array.from({ length: 30 }, (_, i) => `line ${i + 11}`));
    expect(stderrTail("\n \n")).toMatch(/unknown error/);
  });
});

describe("renderer install location", () => {
  const LOCK = '{"lockfileVersion":3,"packages":{}}\n';

  test("same lockfile, same directory; any change to the lockfile, a new directory", () => {
    const env = { HOME: "/home/u" };
    const a = installPaths(LOCK, env);
    expect(installPaths(LOCK, env)).toEqual(a);
    expect(a.dir).toMatch(/^\/home\/u\/\.cache\/learning-plugins\/visual-tools\/[0-9a-f]{16}$/);
    expect(a.marker).toBe(`${a.dir}/.installed`);
    expect(installPaths(LOCK.replace("3", "4"), env).dir).not.toBe(a.dir);
  });

  test("an absolute XDG_CACHE_HOME wins over HOME; a relative or empty one is ignored", () => {
    expect(cacheRoot({ XDG_CACHE_HOME: "/x/cache/", HOME: "/home/u" })).toBe("/x/cache/learning-plugins/visual-tools");
    expect(cacheRoot({ XDG_CACHE_HOME: "cache", HOME: "/home/u" })).toBe("/home/u/.cache/learning-plugins/visual-tools");
    expect(cacheRoot({ XDG_CACHE_HOME: "", HOME: "/home/u" })).toBe("/home/u/.cache/learning-plugins/visual-tools");
  });

  test("no usable cache location is an error", () => {
    expect(() => cacheRoot({})).toThrow(/set HOME or an absolute XDG_CACHE_HOME/);
  });

  test("a render that may install gets ten minutes; an installed one two", () => {
    expect(renderTimeoutMs(false)).toBe(600_000);
    expect(renderTimeoutMs(true)).toBe(120_000);
  });
});
```

**Step 2:** run → FAIL: cannot resolve `../src/core/install.ts` (the protocol block passes already: `protocol.ts` exists since Task 2; that is fine, it documents the protocol).

**Step 3: Implement** `src/core/install.ts`:

```ts
/** Where the renderer's npm dependencies live, and how long a render may take. Pure. */

export interface CacheEnv {
  XDG_CACHE_HOME?: string | undefined;
  HOME?: string | undefined;
}

export interface InstallPaths {
  /** 16 lowercase hex chars: FNV-1a 64 of the lockfile text. */
  hash: string;
  /** `<cache>/learning-plugins/visual-tools/<hash>` */
  dir: string;
  /** `<dir>/.installed`: written last, so its presence means the install completed. */
  marker: string;
}

export const INSTALL_TIMEOUT_MS = 600_000;
export const RENDER_TIMEOUT_MS = 120_000;

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64 over UTF-16 code units. Deterministic in every JS runtime (no crypto API needed). */
export function lockHash(lockText: string): string {
  let h = FNV64_OFFSET;
  for (let i = 0; i < lockText.length; i++) {
    h ^= BigInt(lockText.charCodeAt(i));
    h = (h * FNV64_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, "0");
}

/** `${XDG_CACHE_HOME:-$HOME/.cache}/learning-plugins/visual-tools`. A relative XDG_CACHE_HOME is ignored (XDG spec). */
export function cacheRoot(env: CacheEnv): string {
  const xdg = env.XDG_CACHE_HOME;
  if (xdg !== undefined && xdg.startsWith("/")) return `${xdg.replace(/\/+$/, "")}/learning-plugins/visual-tools`;
  const home = env.HOME;
  if (home === undefined || !home.startsWith("/")) {
    throw new Error("Cannot locate a cache directory: set HOME or an absolute XDG_CACHE_HOME.");
  }
  return `${home.replace(/\/+$/, "")}/.cache/learning-plugins/visual-tools`;
}

export function installPaths(lockText: string, env: CacheEnv): InstallPaths {
  const hash = lockHash(lockText);
  const dir = `${cacheRoot(env)}/${hash}`;
  return { hash, dir, marker: `${dir}/.installed` };
}

/** A render that may have to install first gets the install budget. */
export function renderTimeoutMs(installed: boolean): number {
  return installed ? RENDER_TIMEOUT_MS : INSTALL_TIMEOUT_MS;
}
```

**Step 4:** run → PASS (29 tests). **Step 5:** `npm run typecheck`; commit `feat(visual-tools): renderer protocol and install location`.

### Task 5: Renderer CLI with lazy install

**Files:**
- Create: `plugins/visual-tools/renderer/package.json`, `plugins/visual-tools/renderer/package-lock.json` (generated), `plugins/visual-tools/src/renderer/cli.ts`
- Modify: `plugins/visual-tools/package.json` (add `plugin`)
- Test: `plugins/visual-tools/test/renderer.test.ts`

**Protocol (normative):** `node render.js --kind mermaid|svg --in <abs> --out <abs.png>`.

| Exit | Meaning | stderr |
|---|---|---|
| 0 | PNG exists at `--out`, created exclusively | empty |
| 1 | render failed (Mermaid/SVG error, no Chrome) | the error message |
| 2 | usage: bad flags, missing `--in`, Node < 22.13 | reason |
| 3 | `--out` already exists (never overwritten) | `--out already exists: <path>` |
| 4 | install failed | first lines of npm's error + `Install manually with:` + exact one-line command |

Stdout is never used. Sequence: check Node version → parse args → `--in` exists → read `./package-lock.json` (beside `render.js`) → `installPaths(lock, process.env)` → reclaim this hash's stale staging directories even when already installed → if no marker: install (D7) → render into `mkdtemp(os.tmpdir()/visual-tools-)/out.png` → `mkdir -p dirname(--out)` → `copyFileSync(tmp, out, COPYFILE_EXCL)` → remove temp dir. Chrome: `PUPPETEER_EXECUTABLE_PATH` if it exists, else first existing of `CHROME_CANDIDATES` (ported from `_common.ts:26-32`), else exit 1 "No Chrome or Chromium found…". npm: the `npm` on PATH with `dirname(process.execPath)` prepended, so install and render use the same Node.

**Step 1: Create `renderer/package.json`** (`"type": "module"` is required: `render.js` is ESM and `dist/claude/visual-tools/` has no other `package.json`; without it Node prints `MODULE_TYPELESS_PACKAGE_JSON` and reparses):

```json
{
  "name": "@learning-plugins/visual-tools-renderer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Runtime dependencies of render.js, installed lazily into the user cache.",
  "dependencies": {
    "@mermaid-js/mermaid-cli": "12.0.0",
    "@resvg/resvg-js": "2.6.2",
    "puppeteer": "25.13.0"
  }
}
```

**Step 2: Generate the lockfile** (never by hand; rerun after any change to `renderer/package.json`):

```bash
cd plugins/visual-tools/renderer
PUPPETEER_SKIP_DOWNLOAD=1 npm install --package-lock-only --workspaces=false --ignore-scripts --no-audit --no-fund
cd -
git diff --stat package-lock.json   # root lock: must show no change
```

Expected: `renderer/package-lock.json` created (~96 KB, lockfileVersion 3); no `renderer/node_modules`; root lock unchanged.

**Step 3: Add the bundle and copies** to `plugins/visual-tools/package.json`:

```json
  "plugin": {
    "extraBundles": [{ "entry": "src/renderer/cli.ts", "out": "renderer/render.js", "platform": "node" }],
    "copy": ["renderer/package.json", "renderer/package-lock.json"]
  }
```

**Step 4: Write the failing tests** `test/renderer.test.ts`. The first block needs no network: a package.json/lock pair that is out of sync makes `npm ci` refuse before fetching (verified: fails in 0.6 s with `Missing: left-pad@1.3.0 from lock file`). The second block downloads and is opt-in.

```ts
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
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
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
    expect(await render(script, cache, ["--kind", "svg", "--in", join(dir, "ok.svg"), "--out", out])).toEqual({ code: 0, stderr: "" });
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
```

**Step 5:** `npx vitest run plugins/visual-tools/test/renderer.test.ts` → FAIL: esbuild cannot resolve `src/renderer/cli.ts`.

**Step 6: Implement** `src/renderer/cli.ts`:

```ts
/**
 * render.js: renders one Mermaid or SVG source file to a PNG.
 *   node render.js --kind mermaid|svg --in <abs> --out <abs>
 * Exit 0: the PNG exists at --out (created exclusively). Non-zero: stderr tail is the error (see EXIT).
 * First use installs pinned dependencies (./package-lock.json) into the user cache with `npm ci`.
 */
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
  constructor(message: string, readonly code: number) {
    super(message);
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

/** Longer than npm ci's 540 s timeout and the host's 600 s render budget: no live installer owns an older stage. */
const STALE_STAGING_MS = 20 * 60_000;

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
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // another reaper already claimed it
    }
  }
}

/** npm ci into a private staging dir; rename a complete install without ever deleting a competing destination. */
function install(paths: InstallPaths): void {
  const root = dirname(paths.dir);
  mkdirSync(root, { recursive: true });
  if (existsSync(paths.marker)) return;
  if (existsSync(paths.dir)) throw new CliError(`Renderer cache path ${paths.dir} exists without .installed. Move it aside and retry; it was not removed.`, EXIT.install);
  const staging = mkdtempSync(join(root, `${paths.hash}.tmp-`));
  try {
    copyFileSync(join(RENDERER_DIR, "package.json"), join(staging, "package.json"));
    copyFileSync(join(RENDERER_DIR, "package-lock.json"), join(staging, "package-lock.json"));
    const r = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], {
      cwd: staging,
      encoding: "utf8",
      timeout: 540_000, // shorter than the host's 600 s deadline; an in-process failure runs finally
      maxBuffer: 64 * 1024 * 1024,
      // npm next to the node running us wins, so install and render agree on the Node version.
      env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "1", PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}` },
    });
    if (r.status !== 0) {
      // npm prints its whole usage text after the real error; the first lines carry the cause.
      const why = r.error
        ? String(r.error)
        : (r.stderr || r.stdout).split("\n").filter((l) => l.replace(/^npm error\s*/, "") !== "").slice(0, 8).join("\n");
      throw new CliError(`Renderer install failed:\n${why}\n\nInstall manually with:\n  ${manualInstallCommand(paths)}`, EXIT.install);
    }
    writeFileSync(join(staging, ".installed"), `${paths.hash}\n`);
    try {
      if (existsSync(paths.marker)) return;
      if (existsSync(paths.dir)) throw new CliError(`Renderer cache path ${paths.dir} exists without .installed. Move it aside and retry; it was not removed.`, EXIT.install);
      renameSync(staging, paths.dir);
    } catch (err) {
      if (existsSync(paths.marker)) return; // a concurrent install completed first
      if (existsSync(paths.dir)) {
        throw new CliError(`Renderer cache path ${paths.dir} exists without .installed. Move it aside and retry; it was not removed.`, EXIT.install);
      }
      throw err;
    }
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
    const { Resvg } = require("@resvg/resvg-js") as ResvgModule;
    const svg = readFileSync(req.input, "utf8");
    // fitTo zoom 2 = rsvg-convert -z 2 in the original (svg_tools.ts:49).
    const png = new Resvg(svg, { fitTo: { mode: "zoom", value: 2 }, font: { loadSystemFonts: true, defaultFontFamily: "sans-serif" } })
      .render()
      .asPng();
    writeFileSync(tmpPng, png);
    return;
  }
  // Dynamic on purpose: the module lives in the per-lockfile cache dir, known only at run time.
  const mmdc = (await import(pathToFileURL(require.resolve("@mermaid-js/mermaid-cli")).href)) as MermaidCli;
  // Same as the original `mmdc -s 2 -b white -p {executablePath, args:[--no-sandbox]}` (mermaid_tools.ts:146-160);
  // mmdc's own default `headless: "shell"` is kept (it merges our config over it, mermaid-cli src/index.js:462-476).
  await mmdc.run(req.input, tmpPng, {
    quiet: true,
    outputFormat: "png",
    puppeteerConfig: { headless: "shell", executablePath: findChrome(), args: ["--no-sandbox"] },
    parseMMDOptions: { backgroundColor: "white", viewport: { width: 0, height: 0, deviceScaleFactor: 2 } },
  });
}

async function main(args: readonly string[]): Promise<void> {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new CliError(`render.js needs Node.js >= 22.13 (mermaid-cli); ${process.execPath} is ${process.version}.`, EXIT.usage);
  }
  const req = parseRenderArgs(args);
  if (!existsSync(req.input)) throw new CliError(`--in does not exist: ${req.input}`, EXIT.usage);
  const paths = installPaths(readFileSync(join(RENDERER_DIR, "package-lock.json"), "utf8"), process.env);
  reclaimStaging(paths);
  if (!existsSync(paths.marker)) install(paths);
  const work = mkdtempSync(join(tmpdir(), "visual-tools-"));
  try {
    const tmpPng = join(work, "out.png");
    await renderTo(req, tmpPng, paths);
    if (!existsSync(tmpPng)) throw new CliError("renderer produced no PNG", EXIT.render);
    mkdirSync(dirname(req.output), { recursive: true });
    try {
      copyFileSync(tmpPng, req.output, constants.COPYFILE_EXCL);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new CliError(`--out already exists: ${req.output}`, EXIT.exists);
      throw err;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main(process.argv.slice(2)).then(
  () => process.exit(EXIT.ok),
  (err: unknown) => {
    const code = err instanceof CliError ? err.code : err instanceof UsageError ? EXIT.usage : EXIT.render;
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(code);
  },
);
```

**Step 7:** `npx vitest run plugins/visual-tools/test/renderer.test.ts` → 4 pass, 6 skipped. Then once, with network: `VT_RENDER_IT=1 npx vitest run plugins/visual-tools/test/renderer.test.ts` → 10 pass. The real block installs three times, each into its own empty `XDG_CACHE_HOME` (retry, concurrent, install-once); note the install-once test's duration for Task 9.

**Step 8:** `npm run typecheck && npm run build && npm run check`. Confirm `dist/omp/visual-tools/renderer/{render.js,package.json,package-lock.json}` and the same three under `dist/claude/visual-tools/renderer/`.

**Step 9: Commit**

```bash
git add plugins/visual-tools dist .claude-plugin .omp-plugin
git commit -m "feat(visual-tools): renderer CLI with lazy npm ci into the user cache"
```

### Task 6: omp adapter

**Files:**
- Create: `plugins/visual-tools/src/core/tools.ts`, `plugins/visual-tools/src/omp.ts`
- Test: `plugins/visual-tools/test/omp.test.ts`

`tools.ts` holds the six tool specs (descriptions ported from `mermaid_tools.ts:52-160` / `svg_tools.ts:63-150`, with sibling tool names resolved through `toolName` per harness) and the result texts. It has no tests of its own: its prose is not a contract; its behaviour is observed through both adapters.

The omp test fakes only the OS process (`runRenderer`): the fake parses the real argv with `parseRenderArgs` and writes "PNG signature + the source it was given" with an exclusive create, so tests can see *which* source reached the renderer.

**Step 1: Write the failing test** `test/omp.test.ts`:

```ts
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
async function fakeRenderer(argv: string[], timeoutMs: number): Promise<RendererRun> {
  calls.push({ argv, timeoutMs });
  if (nextRun) return nextRun();
  const req = parseRenderArgs(argv.slice(2));
  mkdirSync(join(req.output, ".."), { recursive: true });
  writeFileSync(req.output, Buffer.concat([PNG_SIGNATURE, readFileSync(req.input)]), { flag: "wx" });
  return { exitCode: 0, stderr: "" };
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
    (await fake.tools.get(name)!.execute("call-1", params, undefined, undefined, fake.ctx)) as Result;
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
  expect(calls[0]!.argv.slice(0, 4)).toEqual(["node", script, "--kind", "mermaid"]);
  expect(readdirSync(cwd)).toEqual([]);
  expect(existsSync(dirname(parseRenderArgs(calls[0]!.argv.slice(2)).input))).toBe(false);
});

test("save_as publishes the rendered PNG into <cwd>/viz under a unique name and returns that name", async () => {
  const { call } = setup();
  await call("write_svg", { source: '<svg width="10" height="10"></svg>' });
  const result = await call("render_svg", { save_as: "Number Line" });

  const filename = "viz-number-line-1760000000000-000000.png";
  expect(readdirSync(join(cwd, "viz"))).toEqual([filename]);
  expect(readFileSync(join(cwd, "viz", filename))).toEqual(imageBytes(result));
  expect(textOf(result)).toContain(`filename: ${filename}`);
  expect(existsSync(dirname(parseRenderArgs(calls[0]!.argv.slice(2)).input))).toBe(false);
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
  expect(existsSync(dirname(parseRenderArgs(calls[0]!.argv.slice(2)).input))).toBe(false);
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
```

**Step 2:** `npx vitest run plugins/visual-tools/test/omp.test.ts` → FAIL: cannot resolve `../src/omp.ts`.

**Step 3: Implement** `src/core/tools.ts`:

```ts
/** The six tools as both harnesses expose them, and the text of their results. Pure. */
import { toolName, type Harness } from "../../../../shared/tool-map.ts";
import type { Kind } from "./protocol.ts";

export type Op = "write" | "edit" | "render";

export interface ParamSpec {
  name: "source" | "old_text" | "new_text" | "save_as";
  description: string;
  optional: boolean;
}

export interface VisualToolSpec {
  /** Abstract id in shared/tool-map.ts, e.g. "render_svg"; also the omp tool name and the CC short name. */
  id: `${Op}_${Kind}`;
  kind: Kind;
  op: Op;
  label: string;
  description: string;
  params: ParamSpec[];
}

const NOUN: Record<Kind, string> = { mermaid: "Mermaid", svg: "SVG" };
const LOOK: Record<Kind, string> = {
  mermaid: "are arrows/relationships correct, labels right, nothing cramped?",
  svg: "are coordinates, angles, directions, and proportions correct? Labels clear and unclipped?",
};
const SLUG_EXAMPLE: Record<Kind, string> = { mermaid: "internet-packets", svg: "number-line" };

/** Ported from mermaid_tools.ts:52-160 and svg_tools.ts:63-150, with tool names resolved per harness. */
export function toolSpecs(h: Harness): VisualToolSpec[] {
  return (["mermaid", "svg"] as const).flatMap((kind): VisualToolSpec[] => {
    const n = NOUN[kind];
    const write = toolName(`write_${kind}`, h);
    const edit = toolName(`edit_${kind}`, h);
    const render = toolName(`render_${kind}`, h);
    const sourceShape =
      kind === "mermaid"
        ? "`source` is a complete Mermaid diagram, e.g. a `graph TD` / `graph LR` flow, `sequenceDiagram`, `stateDiagram-v2`, `erDiagram`, `classDiagram`, `mindmap`, or `timeline`."
        : "`source` is a complete `<svg ...>…</svg>` document with an explicit width/height (or viewBox), readable font sizes, and a light or transparent background.";
    return [
      {
        id: `write_${kind}`,
        kind,
        op: "write",
        label: `Write ${n}`,
        description:
          `Write the FULL ${n} source to this session's managed file (your first draft or a complete rewrite). ` +
          `You do NOT name the file — ${edit} and ${render} act on the same one.\n\n${sourceShape} ` +
          `Writing does NOT render — call ${render} when ready. For a small fix, prefer ${edit} over rewriting.`,
        params: [
          {
            name: "source",
            optional: false,
            description:
              kind === "mermaid"
                ? "The complete Mermaid diagram source (starts with the diagram type, e.g. `graph TD`)."
                : "The complete SVG document, from `<svg` to `</svg>`.",
          },
        ],
      },
      {
        id: `edit_${kind}`,
        kind,
        op: "edit",
        label: `Edit ${n}`,
        description:
          `Make a single exact-match replacement in this session's ${n} source. ` +
          "`old_text` must appear EXACTLY ONCE (include surrounding context for uniqueness); on 0 or >1 matches the call fails and nothing changes. " +
          `Call ${write} first. Editing does NOT render.`,
        params: [
          { name: "old_text", optional: false, description: "Exact substring of the current source to replace (must match once)." },
          { name: "new_text", optional: false, description: "Replacement text for `old_text`." },
        ],
      },
      {
        id: `render_${kind}`,
        kind,
        op: "render",
        label: `Render ${n}`,
        description:
          `Render the CURRENT session ${n} source to a PNG and return it inline so you can SEE it and iterate. ` +
          `You do NOT pass the source here — it comes from the managed file; call ${write} first.\n\n` +
          "Iterate freely with no `save_as` (preview only). When the picture is correct and clean, call once more with `save_as` " +
          "set to a short kebab-case topic slug: that publishes the PNG into <cwd>/viz with a unique filename and returns the filename to embed. " +
          `On a render error this returns the error text instead of an image — fix with ${edit} and re-render. ` +
          "The first render on a machine installs the renderer (about a minute).",
        params: [
          {
            name: "save_as",
            optional: true,
            description:
              `Short kebab-case topic slug (e.g. '${SLUG_EXAMPLE[kind]}'). When set, the rendered PNG is published to ` +
              "<cwd>/viz as viz-<slug>-<timestamp>-<suffix>.png and the filename is returned. Omit for a preview-only render.",
          },
        ],
      },
    ];
  });
}

/** JSON Schema for CC's `$.tool.register({ inputSchema })`: every parameter is a string. */
export function inputSchema(spec: VisualToolSpec): Record<string, unknown> {
  return {
    type: "object",
    properties: Object.fromEntries(spec.params.map((p) => [p.name, { type: "string", description: p.description }])),
    required: spec.params.filter((p) => !p.optional).map((p) => p.name),
    additionalProperties: false,
  };
}

export function wroteText(kind: Kind, lines: number, h: Harness): string {
  return `Wrote ${lines}-line ${NOUN[kind]} source.\nCall ${toolName(`render_${kind}`, h)} to render it, or ${toolName(`edit_${kind}`, h)} to tweak it.`;
}

export function editedText(kind: Kind, snippet: string, h: Harness): string {
  return `Applied edit. Updated region:\n\`\`\`\n${snippet}\n\`\`\`\nCall ${toolName(`render_${kind}`, h)} to see it.`;
}

export function renderedText(kind: Kind, h: Harness, published?: { filename: string; path: string }): string {
  if (published) {
    return `Published to viz/.\nfilename: ${published.filename}\npath: ${published.path}\n\nLOOK at the image below to confirm it is correct before returning it.`;
  }
  return `Preview render (not yet saved). LOOK: ${LOOK[kind]} Fix with ${toolName(`edit_${kind}`, h)}, or re-render with \`save_as\` to publish.`;
}

export function renderFailedText(kind: Kind, detail: string, h: Harness): string {
  return `${NOUN[kind]} render FAILED — no image produced. If the error is in your source, fix it with ${toolName(`edit_${kind}`, h)} and call ${toolName(`render_${kind}`, h)} again.\n\nError:\n${detail}`;
}
```

and `src/omp.ts`:

```ts
/**
 * visual-tools for omp: write_/edit_/render_ × mermaid/svg.
 *
 * Registered with plain `pi.registerTool` and `hidden: true`: hidden tools are left out of a session unless
 * its `--tools` list or its agent's `tools:` frontmatter names them (ToolDefinition.hidden,
 * extensibility/extensions/types.d.ts:429-430; sdk.ts:4051), which reproduces the original's
 * "maker subagents only" exposure without the interactive-subagents bridge. `loadMode: "essential"` keeps
 * them top-level tools instead of `xd://` devices (types.d.ts:434) wherever they are enabled.
 *
 * omp binds this factory once per session, subagents included, inside ONE process
 * (sdk.ts:2203-2205 "re-bind their factories to THIS session's ExtensionAPI"), so all state lives in the
 * factory closure, never at module level.
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installPaths, renderTimeoutMs } from "./core/install.ts";
import { EXIT, renderArgv, stderrTail, type Kind } from "./core/protocol.ts";
import { planRender } from "./core/publish.ts";
import { SourceStore } from "./core/sources.ts";
import { editedText, inputSchema, renderedText, renderFailedText, toolSpecs, wroteText } from "./core/tools.ts";

export interface RendererRun {
  /** null when the process could not start or was killed. */
  exitCode: number | null;
  stderr: string;
}

export interface OmpDeps {
  /** Absolute path of renderer/render.js; renderer/package-lock.json sits beside it. */
  rendererScript: string;
  /** Runs argv (argv[0] = "node") and resolves once it exits; the test seam for the OS process boundary. */
  runRenderer: (argv: string[], timeoutMs: number, signal: AbortSignal | undefined) => Promise<RendererRun>;
  now: () => number;
  random: () => number;
}

const KEY = "main"; // one store per session (see header), so one key

export function registerVisualTools(pi: ExtensionAPI, deps: OmpDeps): void {
  const store = new SourceStore("omp");

  async function render(kind: Kind, saveAs: string | undefined, signal: AbortSignal | undefined, ctx: ExtensionContext) {
    const source = store.read(KEY, kind);
    const stagingDir = mkdtempSync(join(tmpdir(), "visual-tools-"));
    try {
      const plan = planRender({ kind, saveAs, cwd: ctx.cwd, stagingDir, nowMs: deps.now(), random: deps.random });
      writeFileSync(plan.input, source, "utf8");
      const lock = readFileSync(join(dirname(deps.rendererScript), "package-lock.json"), "utf8");
      const { marker } = installPaths(lock, process.env);
      const argv = renderArgv("node", deps.rendererScript, { kind, input: plan.input, output: plan.output });
      const run = await deps.runRenderer(argv, renderTimeoutMs(existsSync(marker)), signal);
      if (run.exitCode !== EXIT.ok || !existsSync(plan.output)) {
        return { content: [{ type: "text" as const, text: renderFailedText(kind, stderrTail(run.stderr), "omp") }], details: undefined, isError: true };
      }
      const data = readFileSync(plan.output).toString("base64");
      return {
        content: [
          { type: "text" as const, text: renderedText(kind, "omp", plan.published) },
          { type: "image" as const, data, mimeType: "image/png" },
        ],
        details: { path: plan.published?.path, filename: plan.published?.filename },
      };
    } finally {
      rmSync(stagingDir, { recursive: true, force: true }); // source and preview, even on render failure/abort
    }
  }

  for (const spec of toolSpecs("omp")) {
    pi.registerTool({
      name: spec.id,
      label: spec.label,
      description: spec.description,
      // A plain JSON Schema is a valid TSchema (pi-ai types.d.ts:1089-1100); params arrive untyped.
      parameters: inputSchema(spec),
      hidden: true,
      loadMode: "essential",
      // write_/edit_ only change in-memory state; render_ creates files and runs the fixed renderer.
      approval: spec.op === "render" ? "write" : "read",
      async execute(_id, params, signal, _onUpdate, ctx) {
        const p = params as Partial<Record<"source" | "old_text" | "new_text" | "save_as", string>>;
        if (spec.op === "write") {
          const lines = store.write(KEY, spec.kind, String(p.source ?? ""));
          return { content: [{ type: "text", text: wroteText(spec.kind, lines, "omp") }], details: undefined };
        }
        if (spec.op === "edit") {
          const snippet = store.edit(KEY, spec.kind, String(p.old_text ?? ""), String(p.new_text ?? ""));
          return { content: [{ type: "text", text: editedText(spec.kind, snippet, "omp") }], details: undefined };
        }
        return render(spec.kind, p.save_as, signal, ctx);
      },
    });
  }
}

function runNode(argv: string[], timeoutMs: number, signal: AbortSignal | undefined): Promise<RendererRun> {
  const { promise, resolve } = Promise.withResolvers<RendererRun>();
  execFile(argv[0]!, argv.slice(1), { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024, signal }, (err, _stdout, stderr) => {
    if (!err) return resolve({ exitCode: 0, stderr });
    const exitCode = typeof err.code === "number" ? err.code : null;
    const why = err.killed ? `renderer stopped after ${timeoutMs / 1000}s (timeout or abort)` : exitCode === null ? err.message : "";
    resolve({ exitCode, stderr: [stderr, why].filter(Boolean).join("\n") });
  });
  return promise;
}

export default function visualTools(pi: ExtensionAPI): void {
  registerVisualTools(pi, {
    // extension.js sits at the plugin root, next to renderer/ (dist/omp/visual-tools/{extension.js,renderer/}).
    rendererScript: join(dirname(fileURLToPath(import.meta.url)), "renderer", "render.js"),
    runRenderer: runNode,
    now: Date.now,
    random: Math.random,
  });
}
```

**Step 4:** run → PASS (7 tests). **Step 5:** `npm run typecheck && npm run build && npm run check`; commit `feat(visual-tools): omp tools on the shared core`.

### Task 7: CC adapter

**Files:**
- Create: `plugins/visual-tools/src/claude.ts`
- Test: `plugins/visual-tools/test/claude/visual-tools.test.ts`

Every `$` call lives in `src/claude.ts`; `$` is only passed to top-level functions of that file. All awaits are mods API calls (exempt from the 10 s budget). The renderer path is `${$.plugin.root}/renderer/render.js` (`$.plugin.root`: "the plugin's directory … absolute", cc.d.ts:2020-2028). Timeout: `renderTimeoutMs(await $.fs.exists(marker))` → 600 000 / 120 000 (`ProcessRunInit.timeoutMs`, max ten minutes, cc.d.ts:2970-2977). PNG read: `$.fs.stat` first (> 4 MiB → error, since `$.fs.read` rejects above 4 MiB, cc.d.ts:2743), then `$.fs.read(out, { as: "bytes" })` → `{ base64 }` (cc.d.ts:2740-2757, 4044-4053). Image block shape proven in `/tmp/mod-image-spike` (design, Verified facts).

Kit stubs used (docs `plugins/mods/test.md`, "Look up what a stub returns"): `tool.register` answers `{ value: { tool } }` (its op value type, cc.d.ts:5845-5847), `fs.*`/`session.cwd`/`process.run` answer `{ value }` (`process.run` serves both `node render.js` and the `rm -f --` cleanup, which the fake records as `removed`), a failing call answers `{ deny }`, `session.end` answers core's `{ sessionId }` (cc.d.ts:8910-8915, as in 02-md-log.md's kit), `mock.env`, `mock.clock`.

**Step 1: Write the failing test** `test/claude/visual-tools.test.ts`:

```ts
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
      return { value: { exitCode: 0, stdout: "", stderr: "" } };
    }
    if (fake.startFails) return { deny: "spawn node ENOENT" };
    return { value: { exitCode: fake.exitCode ?? 0, stdout: "", stderr: fake.stderr ?? "" } };
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
  expect(answer.isError).toBeUndefined();
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
  expect(answer).toMatchObject({ isError: true, result: "No svg source yet: call mcp__visual-tools__write_svg first." });
  expect(h.runs).toEqual([]);
});

test("an edit matching twice is an error naming the count", async ($, on) => {
  host(on);
  await $.tool.call({ tool: T("write_mermaid"), source: "graph TD\n  A --> B\n  B --> C" });
  const answer = await $.tool.call({ tool: T("edit_mermaid"), old_text: "-->", new_text: "==>" });
  expect(answer.isError).toBe(true);
  expect(String(answer.result)).toContain("matches 2 times");
});

test("each agent loop has its own source", async ($, on) => {
  host(on);
  await $.tool.call({ tool: T("write_mermaid"), source: "graph TD\n  A --> B", agentId: "maker-1" });
  const fromMain = await $.tool.call({ tool: T("render_mermaid") });
  const fromMaker = await $.tool.call({ tool: T("render_mermaid"), agentId: "maker-1" });
  expect(fromMain.isError).toBe(true);
  expect(fromMaker.isError).toBeUndefined();
});

for (const reason of ["clear", "resume"] as const) {
  test(`session.end (${reason}) discards old main and maker sources without another session.start`, async ($, on) => {
    const h = host(on);
    await $.tool.call({ tool: T("write_svg"), source: "<svg></svg>" });
    await $.tool.call({ tool: T("write_mermaid"), source: "graph TD\n  A-->B", agentId: "maker-1" });
    await $.session.end({ reason, sessionId: "old", resume: { id: "old" } });
    const main = await $.tool.call({ tool: T("render_svg") });
    const maker = await $.tool.call({ tool: T("render_mermaid"), agentId: "maker-1" });
    expect(main).toMatchObject({ isError: true, result: "No svg source yet: call mcp__visual-tools__write_svg first." });
    expect(maker.isError).toBe(true);
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
  expect(answer.isError).toBe(true);
  expect(String(answer.result)).toContain("Parse error on line 2:\nExpecting 'NODE_STRING'");
  expect(h.removed).toEqual([flag(h.runs[0], "--in")]);
});

test("node that cannot start is an error telling the user what is needed", async ($, on) => {
  const h = host(on, { startFails: true });
  await $.tool.call({ tool: T("write_svg"), source: "<svg></svg>" });
  const answer = await $.tool.call({ tool: T("render_svg") });
  expect(answer.isError).toBe(true);
  expect(String(answer.result)).toContain("needs Node.js >= 22.13 on PATH");
  expect(h.removed).toEqual([flag(h.runs[0], "--in")]);
});

test("a PNG over 4 MiB is an error, not an image", async ($, on) => {
  const h = host(on, { size: 4 * 1024 * 1024 + 1 });
  await $.tool.call({ tool: T("write_svg"), source: "<svg></svg>" });
  const answer = await $.tool.call({ tool: T("render_svg") });
  expect(answer.isError).toBe(true);
  expect(String(answer.result)).toContain("over the 4 MiB");
  expect(h.removed).toEqual([flag(h.runs[0], "--in"), flag(h.runs[0], "--out")]);
});

test("an oversized published image is removed rather than left in viz", async ($, on) => {
  const h = host(on, { size: 4 * 1024 * 1024 + 1 });
  await $.tool.call({ tool: T("write_svg"), source: "<svg></svg>" });
  const answer = await $.tool.call({ tool: T("render_svg"), save_as: "oversized" });
  expect(answer.isError).toBe(true);
  expect(h.removed).toEqual([flag(h.runs[0], "--in"), flag(h.runs[0], "--out")]);
});
```

**Step 2:** `npm run build && npm run test:claude -- visual-tools` → FAIL (no `hooks/register.js` yet: no tool answers).

**Step 3: Implement** `src/claude.ts`:

```ts
/**
 * visual-tools for Claude Code: write_/edit_/render_ × mermaid/svg as mod tools (`mcp__visual-tools__<id>`).
 *
 * One module serves every agent loop, so sources are keyed by the call's `agentId` ("main" when absent).
 * Every `$` call lives in this file (validate's static analysis); core never sees `$`.
 * All awaits below are mods API calls, which the 10 s hook budget exempts (design: CC hook time budget).
 */
import type { EngineInterface, On, PluginOptions, ToolCallInput } from "claude-code";
import { toolName } from "../../../shared/tool-map.ts";
import { cacheRoot, installPaths, renderTimeoutMs } from "./core/install.ts";
import { renderArgv, stderrTail } from "./core/protocol.ts";
import { planRender } from "./core/publish.ts";
import { SourceStore } from "./core/sources.ts";
import { editedText, inputSchema, renderedText, renderFailedText, toolSpecs, wroteText, type VisualToolSpec } from "./core/tools.ts";

const SPECS = toolSpecs("claude");
const SPEC_BY_TOOL = new Map(SPECS.map((s) => [toolName(s.id, "claude"), s]));
let store = new SourceStore("claude"); // session.end resets it; session.start does not rerun after /clear or /resume
/** `$.fs.read` rejects anything larger (cc.d.ts:2743). */
const MAX_PNG_BYTES = 4 * 1024 * 1024;

type Answer = { result: string | readonly unknown[]; isError?: true };

function fail(text: string): Answer {
  return { result: text, isError: true };
}

async function render($: EngineInterface, spec: VisualToolSpec, key: string, saveAs: string | undefined): Promise<Answer> {
  const source = store.read(key, spec.kind);
  const script = `${$.plugin.root}/renderer/render.js`;
  const lock = await $.fs.read(`${$.plugin.root}/renderer/package-lock.json`);
  const env = { XDG_CACHE_HOME: await $.env.get("XDG_CACHE_HOME"), HOME: await $.env.get("HOME") };
  const { marker } = installPaths(lock, env);
  const timeoutMs = renderTimeoutMs(await $.fs.exists(marker));
  const plan = planRender({
    kind: spec.kind,
    saveAs,
    cwd: await $.session.cwd(),
    stagingDir: `${cacheRoot(env)}/previews`, // per-user, never a shared /tmp path; emptied after every render
    nowMs: await $.clock.now(),
    random: Math.random,
  });
  let outputCreated = false;
  let published = false;
  try {
    await $.fs.write(plan.input, source);
    let run;
    try {
      run = await $.process.run(renderArgv("node", script, { kind: spec.kind, input: plan.input, output: plan.output }), { timeoutMs });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      return fail(renderFailedText(spec.kind, `Could not run \`node ${script}\` (needs Node.js >= 22.13 on PATH; timeout ${timeoutMs / 1000}s): ${why}`, "claude"));
    }
    if (run.exitCode !== 0) return fail(renderFailedText(spec.kind, stderrTail(run.stderr), "claude"));
    outputCreated = true; // render.js exits 0 only after exclusive output creation
    const { size } = await $.fs.stat(plan.output);
    if (size > MAX_PNG_BYTES) {
      return fail(`The PNG at ${plan.output} is ${size} bytes, over the 4 MiB Claude Code can read back. Make the canvas smaller (fewer nodes, or a smaller SVG width/height) and render again.`);
    }
    const { base64 } = await $.fs.read(plan.output, { as: "bytes" });
    published = true;
    return {
      result: [
        { type: "text", text: renderedText(spec.kind, "claude", plan.published) },
        { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
      ],
    };
  } finally {
    // CC has no fs.delete; remove only paths this call created. An EEXIST failure must not remove someone else's output.
    const paths = [plan.input, ...(outputCreated && (!plan.published || !published) ? [plan.output] : [])];
    const cleanup = await $.process.run(["rm", "-f", "--", ...paths]);
    if (cleanup.exitCode !== 0) throw new Error(`Could not remove temporary visual source/preview: ${stderrTail(cleanup.stderr)}`);
  }
}

async function handle($: EngineInterface, e: ToolCallInput): Promise<Answer> {
  const spec = SPEC_BY_TOOL.get(e.tool);
  if (spec === undefined) return fail(`visual-tools does not provide ${e.tool}.`);
  const args = e as unknown as Partial<Record<"source" | "old_text" | "new_text" | "save_as", unknown>>;
  const key = e.agentId ?? "main";
  try {
    if (spec.op === "write") return { result: wroteText(spec.kind, store.write(key, spec.kind, String(args.source ?? "")), "claude") };
    if (spec.op === "edit") {
      return { result: editedText(spec.kind, store.edit(key, spec.kind, String(args.old_text ?? ""), String(args.new_text ?? "")), "claude") };
    }
    return await render($, spec, key, typeof args.save_as === "string" ? args.save_as : undefined);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export function register(on: On, _options: PluginOptions): void {
  on("session.start", async ($, e, next) => {
    for (const spec of SPECS) await $.tool.register({ name: spec.id, description: spec.description, inputSchema: inputSchema(spec) });
    return next(e);
  });

  on("session.end", ($, e, next) => {
    store = new SourceStore("claude"); // clear, resume, branch (reason resume), and exit; no later session.start for transitions
    return next(e);
  });

  on(
    "tool.call",
    {
      tool: [
        "mcp__visual-tools__write_mermaid",
        "mcp__visual-tools__edit_mermaid",
        "mcp__visual-tools__render_mermaid",
        "mcp__visual-tools__write_svg",
        "mcp__visual-tools__edit_svg",
        "mcp__visual-tools__render_svg",
      ],
    },
    ($, e) => handle($, e),
  ).catch(($, e, next) => fail(`visual-tools failed (${next.error.kind}): ${next.error.message ?? "no message"}`));
}
```

**Step 4:** `npm run build && npm run test:claude -- visual-tools` → 12 pass. `npm run validate` → passes with no warnings; the hooks line must list `session.start, session.end, tool.call{tool=mcp__visual-tools__write_mermaid|…|mcp__visual-tools__render_svg}`, then `gating hook with .catch: tool.call{…}`, and `calls:` must include `$.process.run` (renderer and `rm` cleanup).

**Step 5:** `npm run typecheck && npm run check`; commit `feat(visual-tools): Claude Code tools keyed by agentId`.

### Task 8: Maker agents and visualize skill

**Files:**
- Create: `plugins/visual-tools/prompts/agents/mermaid-maker.md`, `plugins/visual-tools/prompts/agents/svg-maker.md`, `plugins/visual-tools/prompts/skills/visualize/SKILL.md`
- Test: `plugins/visual-tools/test/prompts.test.ts`, goldens under `plugins/visual-tools/test/__golden__/{omp,claude}/`

Port rules applied: tool names → `{{tool:…}}`; maker names → `{{agent:visual-tools/…}}`; the two `subagent(agent=…, task=…)` blocks → `{{dispatch:…}}` lines (each alone on its line, outside any fence); `thinking: medium` → `harness.omp`; models per harness (omp keeps today's `anthropic/claude-sonnet-5-5` / `anthropic/claude-opus-5-5`, CC `sonnet` / `opus`); the `<!-- omp port … -->` comments are dropped; ".pi/agents" discovery text, `rsvg-convert`/ImageMagick and the filename format are updated to this plugin.

**Step 1: Write the failing test** `test/prompts.test.ts`:

```ts
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadPluginSource } from "../../../build/plugin-source.ts";
import { renderPrompts } from "../../../build/plugin-tree.ts";

const PLUGIN = join(import.meta.dirname, "..");

for (const h of ["omp", "claude"] as const) {
  test(`${h} prompts match golden files`, async () => {
    const tree = await renderPrompts(await loadPluginSource(PLUGIN), h);
    expect([...tree.keys()].sort()).toEqual(["agents/mermaid-maker.md", "agents/svg-maker.md", "skills/visualize/SKILL.md"]);
    for (const [path, text] of tree) {
      if (typeof text !== "string") throw new Error(`${path} is not text`);
      await expect(text).toMatchFileSnapshot(`./__golden__/${h}/${path}`);
    }
  });
}
```

**Step 2:** `npx vitest run plugins/visual-tools/test/prompts.test.ts` → FAIL (no prompt files: key list is `[]`).

**Step 3: Create the sources.**

`prompts/agents/mermaid-maker.md`:

````markdown
---
name: mermaid-maker
description: Authors ONE Mermaid diagram from a brief, renders it to a PNG, LOOKS at the result, iterates until it is correct and clean, publishes the PNG into the Obsidian vault, and returns the filename. For structural/relational visuals — dependency graphs, flows, sequences, state machines, trees, ER, timelines.
tools: [write_mermaid, edit_mermaid, render_mermaid, read]
model:
  omp: anthropic/claude-sonnet-5-5
  claude: sonnet
harness:
  omp: { thinking: medium }
---
# Mermaid Maker

You are a **diagram author + renderer**. You receive a brief describing ONE idea to visualize as a Mermaid diagram, and you return ONE clean, correct PNG published into the vault.

You do NOT decide *what* idea to show — the caller (a teacher) already decided that, and you must preserve it exactly. Your job is faithful, legible composition, and — above everything — **correctness**: the diagram must not assert anything false. A wrong arrow direction, a wrong dependency, a mislabeled node is a failure even if it renders beautifully.

You have exactly three authoring tools — `{{tool:write_mermaid}}`, `{{tool:edit_mermaid}}`, `{{tool:render_mermaid}}` — plus `{{tool:read}}`. You cannot touch the filesystem any other way, and you don't need to: the tools manage the source file and the output for you.

## The one rule that matters most: verify by looking

You are not done when the diagram renders. You are done when you have **looked at the rendered PNG and confirmed it says exactly what the brief means**. `{{tool:render_mermaid}}` returns the image inline — actually look at it. Rendering success only proves the syntax parsed; it says nothing about whether the picture is true or readable.

## Workflow (the render-and-inspect loop)

1. **Understand the idea, then cut.** A brief is a wish-list, not a spec. Keep the idea intact but drop any node/label that doesn't earn its place. If you're about to draw more than ~7 nodes, stop and simplify — a diagram of 4 nodes that each pull weight beats one of 12 that fight for space. Cramming is the #1 way these fail.
2. **Write the source** with `{{tool:write_mermaid}}({ source })`. Pick the diagram type that fits: `graph TD`/`LR` (dependency graphs, flows), `sequenceDiagram`, `stateDiagram-v2`, `erDiagram`, `mindmap`, `timeline`, `classDiagram`.
3. **Render a preview** with `{{tool:render_mermaid}}({})` (no `save_as`). Look at the returned image. The very first render on a machine also installs the renderer, which takes about a minute.
4. **LOOK critically:**
   - Is every arrow pointing the right way? Is every dependency/relationship actually true to the brief?
   - Are the labels correct and unambiguous?
   - Is anything overlapping, clipped, cramped, or unreadable? If so the fix is usually **fewer elements**, not more.
   - Would the learner instantly read the intended idea from this picture alone?
5. **Iterate** with `{{tool:edit_mermaid}}({ old_text, new_text })` and re-render. A few passes is normal. If `{{tool:render_mermaid}}` returns an error instead of an image, read it, fix the source, re-render.
6. **Publish** once it is correct and clean: call `{{tool:render_mermaid}}({ save_as: "<short-kebab-topic>" })`. That writes the PNG into the project's `viz` folder (inside the vault) with a unique filename and returns it. Confirm the published image one last time.

## Your output

End your response with EXACTLY this block (nothing after it):

```
RESULT:
filename: <the viz-....png filename returned by {{tool:render_mermaid}}>
path: <the absolute path returned by {{tool:render_mermaid}}>
```

If you genuinely cannot make a correct, sensible diagram of the brief, return:

```
RESULT:
NONE
```

with a one-line reason (e.g. the brief is self-contradictory, or needs a spatial/geometric picture that belongs to {{agent:visual-tools/svg-maker}}).

## Guidelines

- **Correctness is non-negotiable.** Never publish a diagram you have not looked at. If unsure whether an edge is true, it's better to omit it than to assert something false.
- **One idea, fewest elements.** Sparse beats busy — for both readability and layout reliability.
- **Keep labels short.** Nodes hold a term or short phrase, not a sentence. Long labels wreck layout.
- **Don't invent content.** Visualize only what the brief specifies. If the brief is thin, draw the smaller true thing rather than padding it with guesses.
- **Match the pedagogy when it fits.** Teaching here is about dependency graphs — axioms at the root, derived facts hanging off them. `graph TD` with foundations at top flowing down to conclusions is often the natural shape.
````

`prompts/agents/svg-maker.md`:

````markdown
---
name: svg-maker
description: Authors ONE hand-written SVG from a brief, renders it to a PNG, LOOKS at the result, iterates until it is correct and clean, publishes the PNG into the Obsidian vault, and returns the filename. For spatial/geometric visuals Mermaid can't express — coordinate geometry, number lines, vectors, function plots, physical layouts, custom shapes with exact positions.
tools: [write_svg, edit_svg, render_svg, read]
model:
  omp: anthropic/claude-opus-5-5
  claude: opus
harness:
  omp: { thinking: medium }
---
# SVG Maker

You are a **diagram author + renderer** for spatial and geometric pictures. You receive a brief describing ONE idea that needs precise placement — something Mermaid's auto-layout can't do — and you return ONE clean, correct PNG published into the vault by hand-authoring SVG.

You do NOT decide *what* idea to show — the caller (a teacher) already decided that, and you must preserve it exactly. Your job is faithful, precise composition, and — above everything — **correctness**: the picture must not assert anything false. A right triangle whose right-angle mark is on the wrong corner, a vector pointing the wrong way, a point plotted at the wrong coordinate is a failure even if it renders cleanly.

You have exactly three authoring tools — `{{tool:write_svg}}`, `{{tool:edit_svg}}`, `{{tool:render_svg}}` — plus `{{tool:read}}`. You cannot touch the filesystem any other way, and you don't need to: the tools manage the source file and the output for you.

## Your superpower: exact control

Unlike auto-laid-out diagrams, you place every element at coordinates you choose, so what you write is exactly what appears — fully deterministic. That precision is the whole reason to use SVG. It also means correctness is entirely on you: do the geometry deliberately, and verify it by looking.

## The one rule that matters most: verify by looking

You are done only when you have **looked at the rendered PNG and confirmed it is true to the brief**. `{{tool:render_svg}}` returns the image inline — actually look at it. Rendering success only proves the SVG parsed; it says nothing about whether the geometry is right or the picture is readable.

## Workflow (the render-and-inspect loop)

1. **Plan the coordinate space.** Choose a `viewBox` and sketch where each element sits before drawing. Leave margins so nothing touches the edge. Keep it to ONE idea and few elements.
2. **Write the source** with `{{tool:write_svg}}({ source })`: a complete `<svg>…</svg>` with explicit `width`/`height` (or viewBox), a white or transparent background, readable `font-family="sans-serif"`, and font sizes large enough to read when embedded.
3. **Render a preview** with `{{tool:render_svg}}({})` (no `save_as`). Look at the returned image. The very first render on a machine also installs the renderer, which takes about a minute.
4. **LOOK critically:**
   - Is every coordinate, angle, direction, and proportion actually correct? Re-derive the geometry if unsure.
   - Are labels placed clearly, not overlapping lines or each other?
   - Is anything clipped by the viewBox, too small to read, or cramped?
   - Would the learner instantly read the intended idea from this picture alone?
5. **Iterate** with `{{tool:edit_svg}}({ old_text, new_text })` and re-render until correct and clean. If `{{tool:render_svg}}` returns an error, read it, fix the source, re-render.
6. **Publish** once it is correct and clean: call `{{tool:render_svg}}({ save_as: "<short-kebab-topic>" })`. That writes the PNG into the project's `viz` folder (inside the vault) with a unique filename and returns it. Confirm the published image one last time.

## Your output

End your response with EXACTLY this block (nothing after it):

```
RESULT:
filename: <the viz-....png filename returned by {{tool:render_svg}}>
path: <the absolute path returned by {{tool:render_svg}}>
```

If you genuinely cannot make a correct, sensible picture of the brief, return:

```
RESULT:
NONE
```

with a one-line reason (e.g. the idea is purely relational and belongs to {{agent:visual-tools/mermaid-maker}}).

## Guidelines

- **Correctness is non-negotiable.** Never publish a picture you have not looked at. Do the arithmetic/geometry deliberately; don't eyeball positions that need to be exact.
- **One idea, fewest elements.** Sparse and large beats busy and tiny.
- **Draw only what the brief specifies.** Don't invent data points, values, or shapes to fill space.
- **Keep type legible.** Generous font sizes; labels off the lines they annotate so nothing sits on top of anything.
- **Prefer plain, clean styling.** A light background, dark strokes, one accent color at most. This is an explanatory diagram, not art.
````

`prompts/skills/visualize/SKILL.md`:

````markdown
---
name: visualize
description: "Add a correct, minimal visual to a lesson — a diagram or geometric picture — that renders inline in the Obsidian log. Use when an idea is genuinely clearer as a picture: a dependency graph, system/flow, sequence, state machine, tree, comparison, or a spatial/geometric thing (coordinate geometry, number line, vectors, a plot, a physical layout). Outsources authoring+rendering to a maker subagent that verifies the image by looking at it, then you embed the returned file."
---
# Visualize

A picture earns its place only when it shows something words can't — shape, structure, direction, relationship, geometry. This skill produces ONE such picture, guarantees it is **correct** (the maker renders it and looks at it before returning), and drops it into the lesson so it renders inline in the Obsidian `md-log` file.

You are the **creative director**. You decide the exact idea and distill it to its fewest carrying elements. A **maker subagent** does the authoring, rendering, visual verification, and saving, then returns a filename. You embed that filename in your reply.

## When to visualize (and when not to)

This teaching system builds a **dependency graph in the learner's head** — axioms at the root, derived facts hanging off them. A visual is powerful exactly when it makes that structure (or a geometry) visible. Reach for one when:

- The idea is a **structure or relationship**: dependencies, a system with parts and arrows, a flow/pipeline, a sequence of exchanges, a state machine, a tree/hierarchy, a comparison, a containment (what's inside vs outside).
- The idea is **spatial or geometric**: coordinate geometry, a number line, vectors, a function's shape, a physical arrangement.

Do NOT visualize when prose or a single equation already carries it. A decorative diagram that just restates the sentence next to it adds noise and a chance to be wrong. When in doubt, don't — a missing visual is cheaper than a false one.

## Choose the maker

Two makers ship with the visual-tools plugin:

- **`{{agent:visual-tools/mermaid-maker}}`** — structural/relational visuals: dependency graphs, flowcharts, sequence/state/ER/class diagrams, trees, mindmaps, timelines. This is the default and fits the dependency-graph pedagogy directly.
- **`{{agent:visual-tools/svg-maker}}`** — spatial/geometric visuals Mermaid can't lay out: exact coordinates, geometry figures, number lines, vectors, plots, custom shapes.

Rule of thumb: if it's *nodes-and-edges / relationships*, use the Mermaid maker. If it's *positions-and-shapes / geometry*, use the SVG maker.

## Brief the maker well: one idea, fewest elements

The most common failure is **cramming** — every extra label makes the picture harder to read AND harder to lay out correctly. Before briefing, prune to the fewest elements that carry the idea, and for each ask: *"if I delete this, is the idea still clear?"* If yes, delete it.

Give the maker the concept AND the concrete elements you want — not a vague topic, and not a long checklist.

- BAD: "make a diagram about how TCP works"
- GOOD: "graph TD: a node 'packet' at the top; arrows down to 'ordering' and 'retransmit on loss'; both arrows down into 'reliable stream'. No title. Show that reliability is built FROM packets, not alongside them."

Keep the idea intact but trust the maker to compose; if your brief lists more than ~5–7 elements, cut it first.

## Invoke

Dispatch the Mermaid maker for a structural visual:

{{dispatch:visual-tools/mermaid-maker|<your minimal, concrete brief>}}

Dispatch the SVG maker for a spatial one:

{{dispatch:visual-tools/svg-maker|<your minimal, concrete brief>}}

The maker owns its own purpose-built tools (`write_*`/`edit_*`/`render_*`) — it authors the source, renders it to a PNG, **looks at the PNG and iterates until it is correct and clean**, publishes it into the vault with a unique filename, and returns:

```
RESULT:
filename: viz-<slug>-<timestamp>-<suffix>.png
path: <cwd>/viz/viz-<slug>-<timestamp>-<suffix>.png
```

If it returns `RESULT: NONE`, it couldn't make a correct picture of the brief — simplify or rethink, or decide the visual isn't worth it. Never hand-author or fake a diagram yourself; correctness depends on the maker's render-and-inspect loop.

## Embed it in the lesson

Put the embed directly in your teaching reply, using Obsidian's wikilink embed with the returned **filename** (not the full path) and a display width:

```
![[viz-<slug>-<timestamp>-<suffix>.png|500]]
```

That's all. The `md-log` plugin mirrors your reply text verbatim into the linked `.md`, and Obsidian resolves the embed by filename anywhere in the vault (the maker saves into the project's `viz` folder, which is inside the vault) — so it renders inline in the lesson automatically. Width `|500` is a good default; use larger for dense diagrams. Introduce the visual in a sentence, then let it carry the idea — don't narrate every element back in prose.

## Why this is reliable

- The maker never returns a picture it hasn't **looked at**, so "renders fine but says something false" is caught before it reaches the learner.
- PNG embed means **what the maker verified is pixel-identical to what the learner sees** — no re-render drift.
- Unique filenames keep Obsidian's by-filename embed resolution unambiguous.

> The makers render through the `visual-tools` plugin: Mermaid via `@mermaid-js/mermaid-cli` and an installed Chrome, SVG via resvg. Both are installed into the user cache on the first render. You don't render anything yourself — you only brief the maker and embed the filename it returns.
````

**Step 4: Create the goldens** `npx vitest run -u plugins/visual-tools/test/prompts.test.ts`, then review every file against this checklist (fix the source, not the golden, on any miss):

- omp `agents/mermaid-maker.md` frontmatter is exactly `name: mermaid-maker`, `description: …`, `tools: write_mermaid, edit_mermaid, render_mermaid, read`, `model: anthropic/claude-sonnet-5-5`, `thinking: medium`; svg-maker likewise with `write_svg, edit_svg, render_svg, read` and `anthropic/claude-opus-5-5`.
- claude agents: `tools: mcp__visual-tools__write_mermaid, mcp__visual-tools__edit_mermaid, mcp__visual-tools__render_mermaid, Read`, `model: sonnet`, no `thinking`; svg-maker `… Read`, `model: opus`.
- Body: every tool mention is the harness name (`render_svg` vs `mcp__visual-tools__render_svg`), cross-references read `svg-maker` / `visual-tools:svg-maker`.
- Skill: two dispatch examples — omp: "Call the `task` tool:" + JSON with `context` and `tasks: [{ "agent": "mermaid-maker", "task": "<your minimal, concrete brief>" }]`; CC: "Call the `Agent` tool:" + JSON with `description`, `prompt`, `"subagent_type": "visual-tools:mermaid-maker"`; same for svg-maker. No `subagent(` anywhere.

**Step 5:** rerun without `-u` → PASS. `npm run build && npm run check && npm run validate`.

**Step 6: Commit** `feat(visual-tools): maker agents and visualize skill for both harnesses`.

### Task 9: Smoke in both harnesses from an empty cache (open question 5)

Run from a shell where `node -v` is ≥ 22.13 (`nvm use 24.15.0`): D10 showed CC (and omp) use the launching shell's PATH; nvm's default here is v18 and fails with exit 2. Run outside `/home/marcus/tmp/learn` so `../.omp/config.yml` (which loads the old visual-tools) cannot collide (open question 1).

Install from the **local marketplace** in both harnesses (design, Testing: "Install from the local marketplace in both harnesses"), at user scope, never `--scope project`. A linked or `--plugin-dir` build cannot catch a broken catalog entry or a file the marketplace copy leaves out. Use the real user config in both harnesses: 05-teach.md's throwaway `CLAUDE_CONFIG_DIR` works for `claude plugin` commands ("No session or login is needed"), but `claude -p` needs a login, which [INFERENCE] lives under the config dir. Every step below uses the same `XDG_CACHE_HOME` and `npm_config_cache` per harness, so the marker comparison proves reuse.

For debugging only (not acceptance evidence), `omp plugin link dist/omp/visual-tools` or `claude --plugin-dir dist/claude/visual-tools` loads the build directly. Uninstall the marketplace copy first: a link and an install of the same name conflict (01-skeleton.md, "Step 5: The dev alternative").

**omp** (Phase 1 left the `learning-plugins` marketplace registered; omp copies marketplace installs into its plugin cache, so refresh and reinstall after every build)

```bash
source ~/.nvm/nvm.sh && nvm use 24.15.0
omp plugin list                                   # if @learning-plugins/visual-tools shows (linked), `omp plugin uninstall @learning-plugins/visual-tools` first
omp plugin marketplace list                       # learning-plugins → /home/marcus/tmp/learn/learning-plugins; if absent: omp plugin marketplace add /home/marcus/tmp/learn/learning-plugins
omp plugin marketplace update learning-plugins
omp plugin install --force visual-tools@learning-plugins
W=$(mktemp -d) && cd "$W" && export XDG_CACHE_HOME=$(mktemp -d) npm_config_cache=$(mktemp -d)
R="$XDG_CACHE_HOME/learning-plugins/visual-tools"
TMPS_BEFORE=$(ls -d "${TMPDIR:-/tmp}"/visual-tools-* 2>/dev/null | wc -l)

# 1. Failed install through the harness: offline with an empty npm cache.
npm_config_offline=true omp -p --mode json --tools write_svg,render_svg \
  "Call write_svg with source '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"40\" height=\"20\"/>', then call render_svg once and quote its result exactly." > omp-fail.jsonl
ls -A "$R"                                        # expect: nothing (no <hash>, no *.tmp-*)

# 2. First real render installs.
time omp -p --mode json "Use the task tool with agent mermaid-maker: graph TD with 'packet' at the top, arrows to 'ordering' and 'retransmit on loss', both into 'reliable stream'. Report the RESULT block." > omp.jsonl
M1=$(stat -c '%i:%Y' "$R"/*/.installed); echo "$M1"
du -sh "$XDG_CACHE_HOME" "$npm_config_cache"

# 3. Second process, same cache: must reuse the install.
time omp -p --mode json "Use the task tool with agent svg-maker: a number line from 0 to 5 with a dot at 3. Report the RESULT block." > omp-svg.jsonl
M2=$(stat -c '%i:%Y' "$R"/*/.installed); [ "$M1" = "$M2" ] && echo SAME-INSTALL || echo REINSTALLED
ls -A "$R"                                        # expect: exactly one 16-hex dir
ls viz/
TMPS_AFTER=$(ls -d "${TMPDIR:-/tmp}"/visual-tools-* 2>/dev/null | wc -l); echo "$TMPS_BEFORE -> $TMPS_AFTER"

omp plugin uninstall visual-tools@learning-plugins
```

Observe:
- `omp-fail.jsonl`: the `render_svg` result has `isError: true` and its text contains `Renderer install failed:` and `Install manually with:`; `ls -A "$R"` printed nothing.
- `omp.jsonl` and `omp-svg.jsonl`: each maker's `render_*` result content holds `{ "type": "image", "mimeType": "image/png" }`, and each maker's final text describes the diagram it saw. Inspect the content array itself; a published file alone is not evidence.
- `SAME-INSTALL` is printed, and `$R` holds exactly one 16-hex dir (no `*.tmp-*`, no `*.reap-*`).
- `viz/` holds one `viz-*-<epochMs>-<6 chars>.png` per published render, and each opens as the diagram described.
- `TMPS_BEFORE -> TMPS_AFTER` is unchanged: no source or preview survived a render.

**Claude Code** (install fresh for every smoke run and uninstall at the end, so a stale install can never be what is tested)

```bash
source ~/.nvm/nvm.sh && nvm use 24.15.0
claude plugin marketplace list                    # note whether learning-plugins is already registered
claude plugin marketplace add /home/marcus/tmp/learn/learning-plugins   # ONLY if it was not
claude plugin install visual-tools@learning-plugins
W=$(mktemp -d) && cd "$W" && export XDG_CACHE_HOME=$(mktemp -d) npm_config_cache=$(mktemp -d)
R="$XDG_CACHE_HOME/learning-plugins/visual-tools"
T=mcp__visual-tools

# 1. Failed install through the harness. [INFERENCE] $.process.run inherits claude's environment, as it does PATH (D10).
npm_config_offline=true claude -p --output-format stream-json --verbose --allowedTools "${T}__write_svg,${T}__render_svg" \
  -- "Call ${T}__write_svg with source '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"40\" height=\"20\"/>', then call ${T}__render_svg once and quote its result exactly." > cc-fail.jsonl
ls -A "$R" "$R/previews"                          # expect: only an empty previews/

# 2. First real render installs.
time claude -p --output-format stream-json --verbose \
  --allowedTools "Agent,Read,${T}__write_mermaid,${T}__edit_mermaid,${T}__render_mermaid,${T}__write_svg,${T}__edit_svg,${T}__render_svg" \
  -- "Use the visual-tools:mermaid-maker agent to draw: graph TD 'packet' at the top, arrows to 'ordering' and 'retransmit on loss', both into 'reliable stream'. Report its RESULT block." > cc.jsonl
M1=$(stat -c '%i:%Y' "$R"/*/.installed); echo "$M1"

# 3. Second process, same cache: must reuse the install.
time claude -p --output-format stream-json --verbose \
  --allowedTools "Agent,Read,${T}__write_svg,${T}__edit_svg,${T}__render_svg" \
  -- "Use the visual-tools:svg-maker agent to draw a number line from 0 to 5 with a dot at 3. Report its RESULT block." > cc-svg.jsonl
M2=$(stat -c '%i:%Y' "$R"/*/.installed); [ "$M1" = "$M2" ] && echo SAME-INSTALL || echo REINSTALLED

# 4. A real PNG over 4 MiB: 1200x1200 turbulence noise at zoom 2 is a 2400x2400 incompressible RGBA image.
NOISE='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><filter id="n"><feTurbulence baseFrequency="0.9" numOctaves="4"/></filter><rect width="1200" height="1200" filter="url(#n)"/></svg>'
claude -p --output-format stream-json --verbose --allowedTools "${T}__write_svg,${T}__render_svg" \
  -- "Call ${T}__write_svg with exactly this source: ${NOISE} Then call ${T}__render_svg once with save_as \"oversized\" and quote its result exactly." > cc-big.jsonl

# 5. Render before write.
claude -p --output-format stream-json --verbose --allowedTools "${T}__render_svg" \
  -- "Call ${T}__render_svg with no arguments once and quote its result exactly." > cc-err.jsonl

ls -A "$R" "$R/previews"; ls viz/
claude plugin uninstall visual-tools@learning-plugins -y
claude plugin marketplace remove learning-plugins # ONLY if you added it above
```

Observe:
- `cc-fail.jsonl`: the `tool_result` for `render_svg` carries `Renderer install failed:` and `Install manually with:`; `$R` held only an empty `previews/` afterwards.
- `cc.jsonl` and `cc-svg.jsonl`: each `tool_result` for `mcp__visual-tools__render_*` carries an `image` block, and each maker describes its diagram correctly. `SAME-INSTALL` is printed.
- `cc-big.jsonl`: the `render_svg` result contains `over the 4 MiB` and no image block; `viz/` has no `viz-oversized-*` file.
- `cc-err.jsonl`: the result is `No svg source yet: call mcp__visual-tools__write_svg first.`
- Finally `$R` holds exactly one 16-hex dir and an empty `previews/` (no `*.tmp-*`, no `*.reap-*`), and `viz/` holds only the two makers' PNGs.

- [UNVERIFIED] **Mod tools in a plugin agent's `tools:` allowlist.** If the maker reports the visual tools unavailable, check `init.agents`/debug output (`claude --debug`). Decision: if CC filters mod tools out of agent allowlists, stop and raise a contract change with Main (generator support for omitting `tools` per harness); do not hand-edit `dist/`.
- [UNVERIFIED] **`isError` reaching the model** (D11). In `cc-err.jsonl`, the `tool_result` for `render_svg` must have `"is_error": true`. If not, switch `fail()` in `src/claude.ts` to return `{ deny: text }` (keep the `.catch` handler consistent), adjust the kit tests' `isError` assertions to `deny`, and tell Main so Phase 3 does the same.

**Record open question 5.** Replace row 5 of the design's Open questions table with the answer, e.g. `| 5 | Renderer install: N MB on disk (+M MB npm cache), first npm ci S s from an empty npm cache on <machine>; later renders ~1–2 s | resolved in Phase 4 |`, using the numbers above (Task 5 Step 7 for a second data point). Commit:

```bash
git add docs/plans/2026-10-10-learning-plugins-design.md
git commit -m "docs: resolve open question 5 (renderer install size and time)"
```

## Residual risks

- Windows is unsupported (POSIX paths, `npm` without `.cmd`, `HOME`); same as the original.
- A killed install can leave `<root>/<hash>.tmp-*` until its age passes 20 minutes; the next invocation reclaims it. The cache never treats such a stage as installed. If the host SIGKILLs `render.js`, its `npm ci` child can outlive it without the 540 s timeout; should it still run after 20 minutes, a reaper takes its stage and the orphan fails without ever publishing.
- The `.reap-*` branch (a reaper killed mid-delete) is reasoned, not tested: a test cannot backdate a ctime. The test covers its other half, that a freshly claimed `.reap-*` with an old mtime is left alone.
- If the harness process itself dies mid-render, one staged source/preview can remain: omp in its mode-0700 `visual-tools-*` temp dir, CC in `<cacheRoot>/previews/`. Normal success, failure, timeout and abort paths remove them.
- Old cache dirs from previous lockfiles are never removed; document `rm -rf ~/.cache/learning-plugins/visual-tools` in the README (Phase 5).
- The design text "omp: each maker subagent runs in its own process" and "serialized per key" should be updated to D1/D4 when this phase lands.
