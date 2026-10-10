# learning-plugins Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or executing-plans-with-subagent-waves) to implement this plan task-by-task. Each phase file is self-contained; an executor reads this file plus its own phase file only.

**Goal:** Build a git-hosted plugin marketplace whose plugins (`md-log`, `quiz`, `visual-tools`, `teach`) install and work in both Oh My Pi and Claude Code from one source tree.

**Architecture:** Each plugin has pure logic in `src/core/` and two thin adapters (`src/omp.ts`, `src/claude.ts`). A tested TypeScript build (`build/`) bundles adapters with esbuild, renders harness-neutral prompts per harness, and writes two committed distribution trees (`dist/omp/`, `dist/claude/`) plus both marketplace catalogs. The design and every decision behind it live in [`2026-10-10-learning-plugins-design.md`](./2026-10-10-learning-plugins-design.md); read it before any phase.

**Tech Stack:** Node 24.15.0 (native TypeScript type stripping for build scripts), npm workspaces, TypeScript 7.0.2 strict, Vitest 5.0.3, esbuild 0.28.2, `yaml` 2.9.1, `@oh-my-pi/pi-coding-agent` 18.2.10 (types + host runtime), Claude Code ≥ 2.1.296 (`claude plugin validate|test`), vendored CC mod types.

---

## Phases

| # | Phase file | Delivers | Depends on |
|---|---|---|---|
| 1 | [`01-skeleton.md`](./2026-10-10-learning-plugins-plan/01-skeleton.md) | Workspace, toolchain, build, prompt generator, catalogs, CI, test fakes; throwaway `hello` plugin proving both harnesses; open questions 1 and 4 | — |
| 2 | [`02-md-log.md`](./2026-10-10-learning-plugins-plan/02-md-log.md) | `shared/quiz-contract.ts`, md-log core + both adapters; open question 3 | 1 |
| 3 | [`03-quiz.md`](./2026-10-10-learning-plugins-plan/03-quiz.md) | quiz core, omp TUI on a pure reducer, CC tool on `$.ui.ask`; open question 2 | 1, 2 (contract) |
| 4 | [`04-visual-tools.md`](./2026-10-10-learning-plugins-plan/04-visual-tools.md) | Renderer CLI with lazy install, Mermaid/SVG tools in both harnesses, maker agents, `visualize` skill; open question 5 | 1 |
| 5 | [`05-teach.md`](./2026-10-10-learning-plugins-plan/05-teach.md) | `teach` skill, `researcher` agent, README, release to GitHub | 1–4 |

Phases run in order. Within a phase, tasks run in order unless the phase file says otherwise.

## Ground rules (every phase)

- **Never modify or delete** anything in `/home/marcus/tmp/learn/.pi` or `/home/marcus/tmp/learn/.omp`. They are read-only reference. All work happens in `/home/marcus/tmp/learn/learning-plugins/`.
- **Node:** run `source ~/.nvm/nvm.sh && nvm use 24.15.0` once per shell. `nvm use 24` fails on this machine; use the exact version.
- **TDD:** red → green → refactor, one behaviour per test. A test earns its place only if a plausible bug fails it; no tests of wiring, defaults, or source text. Follow `skill://testing-philosophy`.
- **Commits:** one commit per task, Conventional Commits (`feat(md-log): …`, `test(build): …`, `chore: …`). Run `npm run build` before committing any change under `plugins/`, `shared/`, or `build/` so `dist/` stays fresh; `npm run check` must pass at every commit.
- **No speculative generality.** Build only what a phase needs. Later phases extend shared files additively.
- **Never `omp plugin install --scope project`** from this repo: the project registry resolves to `../.omp`. Use user scope or `omp plugin link`.
- **Golden files:** agent shells export `CI=true`, so Vitest fails on a missing file snapshot instead of writing it. Create goldens with `npx vitest run -u <file>` and review the diff.
- **omp tools** register with `loadMode: "essential"`; the default `"discoverable"` mounts them as `xd://` devices, so agents could not call them by name (`types.d.ts:434`).

## Commands (contract; created in Phase 1)

| Command | Does |
|---|---|
| `npm run typecheck` | `tsc -p tsconfig.json --noEmit` over `build/`, `shared/`, `test-support/`, `plugins/*/src`, `plugins/*/test`, `types/claude-code/`, `vitest.config.ts` |
| `npm test` | `vitest run` (all Vitest suites) |
| `npx vitest run <path> -t "<name>"` | one test |
| `npx vitest run -u <path>` | update file snapshots (golden files) after a deliberate change |
| `npm run build` | `node build/cli.ts build`: regenerate `dist/` and both catalogs |
| `npm run check` | `node build/cli.ts check`: rebuild in memory, exit 1 listing every stale, missing, or extra generated file |
| `npm run validate` | `node build/cli.ts validate`: stage the built `build/test/fixtures/repo/plugins/alpha` under `.test-build/fixtures/alpha` and run `claude plugin validate --strict` on it every time; when real plugins exist, also validate the repo root and every `dist/claude/*`. Skip only the empty root marketplace, which CC rejects under `--strict` |
| `npm run test:claude [-- <plugin>]` | `node build/cli.ts test-claude`: by default run `claude plugin test` on the staged built alpha fixture and on each real plugin that has CC tests; an explicit plugin argument runs only that plugin. Each tree is staged with its own `test/claude/**`. CC test files import only `claude-code/testing` and files under that test directory |
| `npm run types:claude -- <dir>` | `node build/cli.ts refresh-claude-types <dir>`: copy CC-generated declaration files from `<dir>` into `types/claude-code/` |

## Shared contracts

These are fixed here so phases written and executed separately agree. A phase that needs to change one edits this section in the same commit.

### Plugin source manifest: `plugins/<name>/package.json`

```json
{
  "name": "@learning-plugins/<name>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "One sentence shown in both catalogs.",
  "plugin": {
    "dependencies": ["quiz"],
    "extraBundles": [{ "entry": "src/renderer/cli.ts", "out": "renderer/render.js", "platform": "node" }],
    "copy": ["renderer/package.json", "renderer/package-lock.json"]
  }
}
```

- The plugin name is the directory name. `plugin` and every field in it are optional.
- `src/claude.ts` present → CC hooks bundle. `src/omp.ts` present → omp extension bundle. Neither → prompts-only plugin.
- `prompts/agents/*.md` and `prompts/skills/<skill>/SKILL.md` (plus any other files in a skill dir, copied verbatim) are rendered per harness.
- `extraBundles[].out` and `copy[]` paths are relative to the plugin root and land at the same relative path in **both** trees.
- `extraBundles[].entry`, `extraBundles[].out`, and `copy[]` must be normalized plugin-root-relative paths: no traversal, no absolute or drive path, no empty or dot segment, no backslash. The build rejects malformed shapes, and duplicate or file/directory-conflicting output paths across generated metadata, bundles, copies, and rendered prompts, before writing any tree.

### Generated trees

```
dist/claude/<name>/.claude-plugin/plugin.json   {name, version, description, author: {name: "Marcus Xavier"}, dependencies?}   (dependencies only when non-empty)
dist/claude/<name>/hooks/hooks.json             {"modules": ["./register.js"]}       (only if src/claude.ts)
dist/claude/<name>/hooks/register.js            esbuild, format esm, platform neutral, externals: claude-code
dist/omp/<name>/package.json                    {name: "@learning-plugins/<name>", version, description, type: "module", omp?: {extensions: ["./extension.js"]}}   (omp key only if src/omp.ts)
dist/omp/<name>/extension.js                    esbuild, format esm, platform node, externals: @oh-my-pi/*, @sinclair/typebox, node:*
dist/<harness>/<name>/agents/*.md, skills/**    rendered prompts
.claude-plugin/marketplace.json                 {name: "learning-plugins", description: "Learning workflow plugins for Oh My Pi and Claude Code, built from one source tree.", owner: {name: "Marcus Xavier"}, plugins: [{name, source: "./dist/claude/<name>", description, version}]}
.omp-plugin/marketplace.json                    same shape, source "./dist/omp/<name>"
```

All JSON is `JSON.stringify(value, null, 2) + "\n"`. Plugins are listed in directory-name order. Build output must be byte-identical across runs. The top-level catalog `description` is required by CC `validate --strict`; omp ignores unknown keys (`fetcher.ts:108-201`). No plugin needs `@sinclair/typebox`: omp 18.2.10 accepts plain JSON Schema for `registerTool` parameters.

### Build module API (`build/`)

```ts
// build/plugin-source.ts
export interface ExtraBundle { entry: string; out: string; platform: "node" | "neutral" }
export interface PluginSource {
  dir: string; name: string; version: string; description: string;
  dependencies: string[]; extraBundles: ExtraBundle[]; copy: string[];
  hasClaude: boolean; hasOmp: boolean;
}
export function loadPluginSource(dir: string): Promise<PluginSource>;   // throws on missing name/version/description

// build/prompts.ts
import type { Harness } from "../shared/tool-map.ts";
export class PromptError extends Error {}                               // message names file + problem
export function renderAgent(path: string, text: string, harness: Harness): string;
export function renderSkill(path: string, text: string, harness: Harness): string;

// build/plugin-tree.ts
export type Tree = Map<string, string | Uint8Array>;                    // relative path → content
export function buildTree(src: PluginSource, harness: Harness): Promise<Tree>;
export function renderPrompts(src: PluginSource, harness: Harness): Promise<Tree>; // keys agents/<n>.md, skills/<s>/** (SKILL.md rendered, rest copied)
export function listFiles(dir: string): Promise<string[]>;                         // sorted, "/"-separated, relative; [] when dir is missing

// build/catalog.ts
export function catalog(harness: Harness, plugins: PluginSource[]): string;   // serialized JSON

// build/repo.ts
export function buildRepo(root: string): Promise<Tree>;                 // keys are repo-relative
export function writeRepo(root: string, files: Tree): Promise<void>;    // replaces dist/ wholesale, writes catalogs
export function diffRepo(root: string, files: Tree): Promise<string[]>; // sorted ["extra: …", "missing: …", "stale: …"]; ignores dist/claude/*/.claude-plugin/types/** and dist/claude/*/tsconfig.json (written by CC on --plugin-dir loads)
```

### Tool and agent map: `shared/tool-map.ts`

```ts
export type Harness = "omp" | "claude";                        // the one definition; build/ imports it from here
export const HARNESSES: readonly Harness[];                    // ["omp", "claude"]
export const TOOLS: Record<string, Record<Harness, string>>;   // abstract id → per-harness name
export const AGENTS: Record<string, Record<Harness, string>>;  // "<plugin>/<agent>" → per-harness name
export function toolName(id: string, h: Harness): string;      // throws on unknown id
export function agentName(id: string, h: Harness): string;     // throws on unknown id
```

Phase 1 seeds `quiz`, `ask`, `read`, `web_search`, `web_fetch`. A CC mod tool is `mcp__<plugin>__<tool>` (verified in the spike: plugin `imgspike`, tool `img_a` → `mcp__imgspike__img_a`). An agent is `<agent>` in omp and `<plugin>:<agent>` in CC. Phases 4 and 5 add their entries.

### Prompt source format

```markdown
---
name: researcher
description: Web researcher — searches the web and synthesizes findings
tools: [web_search, web_fetch]          # agents: abstract ids, rendered as a comma-joined per-harness list
model:                                  # agents: required, one entry per harness
  omp: openai-codex/gpt-6-sol, zai/glm-5.3
  claude: sonnet
harness:                                # optional extra frontmatter merged per harness
  omp: { thinking: medium }
---
Body with {{tool:quiz}}, {{agent:visual-tools/mermaid-maker}}, and
{{dispatch:visual-tools/mermaid-maker|<your minimal, concrete brief>}}.
```

Rendered frontmatter key order: `name`, `description`, `tools`, `model`, then `harness.<h>` keys in source order. Skills take `name`, `description`, and `harness`; `tools`/`model` in a skill are a `PromptError`. Tools render deduplicated, joined with `", "`. Output is `---\n` + `yaml.stringify(fm, {lineWidth: 0})` + `---\n` + `body.trimEnd()` + `\n`.

`{{dispatch:…}}` must stand alone on its line and expands, keeping the line's indentation, to "Call the `task` tool:", a blank line, and a ```json block of `{context: "<background the agent needs beyond the brief>", tasks: [{agent, task: brief}]}` (omp), or "Call the `Agent` tool:", a blank line, and a ```json block of `{description: "<3-5 word summary of the brief>", prompt: brief, subagent_type}` (CC).

Errors (all `PromptError`): unknown placeholder kind; unknown tool or agent id; missing per-harness `model` on an agent; unknown top-level frontmatter key (extras go under `harness.<h>`); a `harness.<h>` key colliding with `name`/`description`/`tools`/`model`; a dispatch not alone on its line; missing frontmatter; a skill dir without `SKILL.md`; legacy literals left in the body after placeholders are removed: `ask_user_question`, `subagent(`, `web_fetch`.

### Quiz contract: `shared/quiz-contract.ts` (created in Phase 2, consumed by Phases 2 and 3)

```ts
export type QuizStatus = "answered" | "cancelled" | "unavailable";
export type QuizMode = "single-select" | "multi-select";
export interface RawQuizOption { label: string; value?: string; description?: string }
export interface QuizOption { label: string; value: string; description?: string }
export interface OptionAnswer { label: string; value: string; index: number }   // 1-based display index
export interface DisplayedOption { index: number; label: string }                // 1-based display index
export interface QuizInput {
  question: string; details?: string; options: RawQuizOption[];
  multiSelect?: boolean; correctAnswer: string | string[]; explanation: string; shuffle?: boolean;
}
export interface QuizResultDetails {
  status: QuizStatus; question: string; context?: string; mode: QuizMode;
  answers: OptionAnswer[]; correctIndices: number[]; options?: DisplayedOption[];
  correct?: boolean; dontKnow?: boolean; note?: string; explanation?: string; message?: string;
}
/** Trim; value defaults to label; drop empty labels; throw `duplicate option value "<v>"`. Port of quiz.ts:124-140. */
export function normalizeOptions(raw: readonly RawQuizOption[]): QuizOption[];
/** Normalized options in display order. shuffle !== false → Fisher–Yates driven by mulberry32 seeded with
 *  FNV-1a-32 over the UTF-8 bytes of `question + "\u0000" + values.join("\u0000")`. Same input → same order, in every harness. */
export function displayOrder(input: Pick<QuizInput, "question" | "options" | "shuffle">): QuizOption[];
export function displayedOptions(order: readonly QuizOption[]): DisplayedOption[];
/** `<quiz-result>${JSON.stringify(d) with "<" written as \u003c}</quiz-result>`, so a payload cannot close the block early. */
export function encodeQuizResult(d: QuizResultDetails): string;
/** First block; undefined when absent, unterminated, malformed, or not isQuizResultDetails. */
export function decodeQuizResult(text: string): QuizResultDetails | undefined;
export function isQuizResultDetails(value: unknown): value is QuizResultDetails;
```

### Test support: `test-support/` (created in Phase 1, extended additively)

- `test-support/fake-omp.ts`: `createFakeOmp(options?: { cwd?: string; hasUI?: boolean })` returns `{ api, emit(event, payload?, ctx?), commands: Map<name, {description?, handler}>, tools: Map<name, ToolDefinition>, entries: {customType, data}[], notifications: {message, type?}[], ctx }`. `api` is typed against `@oh-my-pi/pi-coding-agent/extensibility/extensions`. `ctx` is one mutable object cast to `ExtensionCommandContext` with `cwd`, `hasUI`, `mode: "tui"`, `ui.notify`. `emit` awaits handlers sequentially in registration order and returns their results. Phase 2 adds `idle` (backs `ctx.isIdle()`), `branch: SessionEntry[]` (backs `ctx.sessionManager.getBranch()`; `appendEntry` also pushes a custom entry), and `statuses` (records `ctx.ui.setStatus`).
- CC adapters are tested only with `claude plugin test` (`import { expect, test } from 'claude-code/testing'`), never with a home-made fake of `$`.

## Acceptance tests (definition of done for the whole project)

1. **Given** a clean clone, **when** `npm ci && npm run typecheck && npm test && npm run check && npm run validate && npm run test:claude` runs on Node 24.15.0, **then** every step exits 0. CI runs exactly this on every push.
2. **Given** the repo added as a marketplace in each harness (`omp plugin marketplace add <path-or-owner/repo>`, `claude plugin marketplace add <same>`), **when** the user installs `teach@learning-plugins` (CC) or the README's omp install line, **then** the `teach` skill, `researcher` agent, `quiz` tool, and `/md-log` command are all available in a new session.
3. **Given** `/md-log notes.md` linked in a session that asks a quiz, **when** the user answers it, **then** `notes.md` contains the user prompt, the assistant prose, the question with options in the order shown, and the graded answer — and the same scripted entries produce byte-identical markdown in both harnesses (golden files).
4. **Given** a maker agent asked for a diagram on a machine with an empty renderer cache, **when** it calls `render_mermaid` (or `render_svg`), **then** the renderer installs once, the model receives the PNG as an image, and the PNG is published to `<cwd>/viz/` under a unique name, in both harnesses.
5. **Given** any change under `plugins/`, `shared/`, or `build/` without `npm run build`, **when** `npm run check` runs, **then** it exits 1 and names the stale files.
