# learning-plugins: design

Date: 2026-10-10
Status: approved in a grill session, then hardened by a staff-engineer review. Implementation not started.

## Goal

One repository that is a plugin marketplace for two coding-agent harnesses:

- **Oh My Pi (omp)**: the author's daily driver.
- **Claude Code (CC)**: the distribution target.

A workflow improvement made once, in one source tree, ships to both harnesses. The first plugins are ports of the author's existing pi extensions, skills, and agents in `../.pi` and `../.omp`. Those folders stay untouched as reference material.

pi itself is not a target.

## Plugins

| Plugin | Contents | Port of |
|---|---|---|
| `md-log` | `/md-log <file>`, `/md-unlog`: mirrors the session (user prompts, assistant prose, question/answer blocks) into a markdown note | `.pi/extensions/md-log.ts` |
| `quiz` | Graded multiple-choice tool: shuffled options, "I don't know", free-text note, ✓/✗ with explanation | `.pi/extensions/quiz.ts` |
| `visual-tools` | `write_/edit_/render_` tools for Mermaid and SVG, plus the `mermaid-maker` and `svg-maker` agents and the `visualize` skill | `.pi/extensions/visual-tools/`, `.omp/agents/*-maker.md`, `.pi/skills/visualize` |
| `teach` | The `teach` skill and the `researcher` agent | `.pi/skills/teach`, `.omp/agents/researcher.md` |

`ask-user-question` is dropped. Both harnesses ship a native question tool (`ask` in omp, `AskUserQuestion` in CC), and the features unique to the custom tool (a free-text-only mode, `details`, `value`) are not worth a second question tool competing with the native one.

`teach` uses `quiz` and `md-log`:

- **CC** declares this through `dependencies` in `plugin.json`.
- **omp** has no inter-plugin dependencies, so the README lists the full install command. Nothing more, by decision.
- **CC dogfooding** passes all three directories (`--plugin-dir` for teach, quiz, and md-log), because `--plugin-dir` alone does not resolve dependencies.

## Repository layout

There is one source of truth per plugin. One deterministic build writes two complete distribution trees plus both catalogs, and each harness reads only its own tree through its own catalog.

```
learning-plugins/
├── .claude-plugin/marketplace.json   # GENERATED CC catalog   → ./dist/claude/<plugin>
├── .omp-plugin/marketplace.json      # GENERATED omp catalog  → ./dist/omp/<plugin>
├── .omp/agents/.gitkeep             # shields ../.omp/agents (open question 1)
├── package.json, package-lock.json   # npm workspaces, scripts, pinned dev deps
├── tsconfig.json
├── vitest.config.ts
├── build/                            # build + generator code (TypeScript, tested)
├── shared/                           # cross-plugin code: tool map, quiz contract
├── types/claude-code/                # vendored CC mod types (see Toolchain)
├── plugins/<plugin>/                 # SOURCE: the only place anyone edits
│   ├── package.json                  # workspace package + canonical manifest: name, version, description, "plugin": {dependencies}
│   ├── src/core/                     # pure logic: no I/O, no host imports
│   ├── src/omp.ts                    # omp adapter: default-export ExtensionAPI factory
│   ├── src/claude.ts                 # CC adapter: `export function register(on, options)`
│   ├── prompts/agents/*.md           # canonical agents (placeholders + per-harness overrides)
│   ├── prompts/skills/<skill>/SKILL.md
│   └── test/                         # vitest; test/claude/*.test.ts for the CC test kit
└── dist/                             # GENERATED, committed (marketplaces install from git)
    ├── claude/<plugin>/
    │   ├── .claude-plugin/plugin.json
    │   ├── hooks/hooks.json          # {"modules": ["./register.js"]}
    │   ├── hooks/register.js         # esbuild bundle of src/claude.ts
    │   └── agents/  skills/          # CC flavour
    └── omp/<plugin>/
        ├── package.json              # "omp": { "extensions": ["./extension.js"] }
        ├── extension.js              # esbuild bundle of src/omp.ts
        └── agents/  skills/          # omp flavour
```

`visual-tools` also ships `renderer/` in both trees (see its section).

Why two trees: both harnesses read `agents/` and `skills/` from the plugin root, and the agent and skill text differs per harness (tool names, models, dispatch syntax). The omp docs support a dual catalog explicitly (`omp://marketplace.md`): *"A repository may ship both: omp reads the `.omp-plugin/` copy, Claude Code reads the `.claude-plugin/` copy."* Each tree also stays free of files the other harness would misread. omp never sees `hooks/hooks.json`, and CC never sees `package.json#omp`.

Install commands:

```bash
claude plugin marketplace add <owner>/learning-plugins
claude plugin install md-log@learning-plugins

omp plugin marketplace add <owner>/learning-plugins
omp plugin install md-log@learning-plugins
```

## Toolchain

- **Node 24.15.0** (`.nvmrc`), npm workspaces, a committed `package-lock.json`, and exact-pinned versions. No bun in the repo. omp happens to run extensions under bun, but that is the host's concern.
- **TypeScript strict** with `tsc --noEmit` against the real host types:
  - **CC**: the declaration files Claude Code writes into `.claude-plugin/types/` when it loads a mod from `--plugin-dir` interactively. They are version-matched, unlike the public GitHub copy, which is 2.1.277. We vendor them into `types/claude-code/` and refresh them with a script.
  - **omp**: `@oh-my-pi/pi-coding-agent`, pinned to the installed omp version (18.2.10).
- **esbuild**, driven from `build/`. It bundles each adapter into one ESM file. Host packages (`@oh-my-pi/*`, `@sinclair/typebox`) stay external. Bundling is required on CC, where a hooks module may import only relative files plus the bare `claude-code` specifier. It also lets plugins share `shared/`, even though every installed plugin is copied in isolation.
- **Vitest** for core, the omp adapter, the generator, and the build.
- **`claude plugin test`** (the CC test kit) for the CC adapter. It runs without a login. The build copies each plugin's `test/claude/` into an ephemeral, git-ignored copy of its built tree (`.test-build/claude/<plugin>`) and runs the kit there. Committed `dist/` stays test-free.
- **`claude plugin validate --strict`** on every `dist/claude/*`: warnings fail the build.

## Adapter contract

`src/core/` exports pure functions and reducers. Each adapter does three jobs, all thin:

1. Translate host events into normalized core inputs.
2. Perform I/O with the host's own primitives: `node:fs`/`child_process` in omp; `$.fs`, `$.process`, `$.ui` in CC.
3. Translate core outputs into host results.

Constraints that shape the split:

- **The CC mod runtime has no Node APIs** (no `node:fs`, `setTimeout`, or global `fetch`). Every side effect goes through `$`. Core never touches I/O.
- **CC static analysis**: `claude plugin validate` must see every `$` call.
  - `$` may only be passed to top-level functions in the same file, and never assigned or destructured.
  - Event names must be string literals.
  - No dynamic `import()`.
  - So every `$` call lives in `src/claude.ts`, and core never receives `$`. Validating the bundled output with `--strict` enforces this.
- **CC hook time budget**: a hook gets 10 s of its own execution time. Time inside `next(e)` and inside mods API calls (except `$.clock.sleep`) is exempt, but awaiting a Promise of our own counts. Any wait for the user must therefore sit inside a mods API call.
- **UI cannot be shared.** omp draws imperative, line-based TUI (`ctx.ui.custom`, `Editor`). CC mods return declarative element trees or use the native dialog. Interaction state lives in core, and each harness renders it its own way.
- **Observers never break the session**: they catch everything, report, and pass through `next(e)`.

## Shared contracts

### Quiz contract (`shared/quiz-contract.ts`)

`md-log` must log the quiz question in the order the user saw it, and the graded outcome, in both harnesses, without parsing prose. Two rules make that possible:

1. **Deterministic shuffle.** Quiz option order is `displayOrder(options, seed)`, a pure function both plugins bundle. The seed is a hash of the **question content** (question text plus option values), not the tool-call id, because CC's `turn.step` exposes tool uses as `{name, input}` with no id. md-log can therefore recompute the displayed order from the tool arguments alone, live and before the user answers, in both harnesses. `shuffle: false` keeps author order. This replaces the original's reliance on `tool_execution_update`, which omp does not deliver for extension tools (`md-log.ts:280-282`). Asking the identical question twice yields the identical order, which is acceptable.
2. **Structured result.** The quiz result carries `QuizResultDetails`: status, displayed options, answers, correct indices, `dontKnow`, note, explanation.
   - omp delivers it as the tool result's `details`.
   - CC delivers it as a text block `<quiz-result>{json}</quiz-result>` inside the `result` array. The model sees it too, which is harmless and useful.
   - md-log parses only this block.

### Tool map (`shared/tool-map.ts`)

Abstract tool and agent ids resolve per harness. The prompt generator and md-log both use this map.

## Plugin designs

### md-log

**Core**

- A formatter from normalized entries to markdown.
  - Entries: `user`, `assistant`, `question` (one per asked question; native ask tools can ask several per call), `quiz-answer`, `ask-answer`.
  - For the same entries, the output is byte-identical in both harnesses, enforced by golden files.
- Formatting rules are ported from `md-log.ts:84-202`: callouts, skill-block stripping, quiz and ask answer callouts.
- The assistant heading changes from `PI` to the harness-neutral `AGENT`. The user heading stays `YOU`.

**Shared behaviour**

- `/md-log <file>` links an existing file only; it never creates one. It refuses while the agent is busy, then backfills the current conversation by **overwriting** the file, exactly as the original does.
- After linking, live events append in order through one in-session serialized write queue.
- **One writer per note** is a documented constraint, as in the original: two sessions logging to the same note can interleave.

**omp adapter**

- Registers commands with `pi.registerCommand` and persists the link with `pi.appendEntry`, restored on `session_start` and `session_switch` from the newest md-log entry on the active branch (`/new`, `/resume`, and fork emit `session_switch`; `session_start` fires once at startup).
- User and assistant text come from `message_end`.
- **Q&A**:
  - The question is written for `quiz` (order from the quiz contract) and for the native `ask` (input `questions[]`: `{id, question, header?, options[{label, description?, preview?}], multi?, recommended?}`, from `@oh-my-pi/pi-coding-agent@18.2.10` `tools/ask.d.ts`). omp emits `tool_call` before the assistant `message_end` and runs the tools after it (pi-agent-core `agent-loop.ts:2031-2064`). So `message_end` writes the prose and questions of a streamed message in content-block order, which is still before the tools run. A `tool_call` outside a streamed message (`message_start` → `message_end`), such as a nested xd:// dispatch, writes its question at once, and `message_end` skips any question already written.
  - The answer is written on `tool_result`: quiz `details`; native `ask` `details` (`AskToolDetails`, `@oh-my-pi/pi-tui@18.2.10` `tools/ask.d.ts`), filled by pi-coding-agent `src/tools/ask.ts` as:
    - one question: `{question, options: string[], multi, selectedOptions: string[], customInput?, note?, timedOut?}`; a typed "Other" answer sets `customInput` and leaves `selectedOptions` empty.
    - several questions: `{results: QuestionResult[]}`, each with the same fields plus `id`.
    - "Chat about this": `{chatRedirect: true, questions: string[]}`.
    - cancel, Esc, headless: the tool throws; `tool_result` has `details: undefined`, `isError: true`, and the error message as content.
    - bad input: `details: {}` and an `Error: …` text, not flagged as an error.
  - omp events broadcast to every extension, so hook order between plugins does not matter.
- Writes read, concatenate, and write the file (as today) under the queue.

**CC adapter**

- **Commands**: `$.command.register({name: 'md-log', argumentHint: '<filepath>'})` without `immediate`, handled by `command.run`. `immediate` would run it mid-turn (`cc.d.ts:1579-1587`); without it CC defers `/md-log` until the turn ends, which is CC's form of "refuses while busy". `/md-unlog` is `immediate: true`. Neither costs a model turn.
- **User prompts**: `prompt.submit`, logged after `await next(e)`, so dropped prompts are skipped and rewritten prompts are logged as sent.
- **Assistant prose**: `turn.step`. The adapter does `const r = yield* next(e)` and logs `r.answer` for each model request. That captures the prose written before tool calls, which `turn.complete` (final answer only) would miss. Steps carrying `agentId` (subagents) are skipped.
- **Q&A**, independent of mod order.
  - CC hooks form one middleware chain, and among user-installed mods only `dependencies` orders it. A `tool.call` observer in md-log would never see quiz calls whenever `quiz` sits earlier in the chain and answers without `next`. md-log therefore does not hook `tool.call`.
  - **Question**: the same `turn.step` hook inspects `r.toolUses` for `AskUserQuestion` and `mcp__quiz__quiz`, and writes the question blocks from their inputs. This happens before the tools execute, so the question appears live.
  - **Answer**: those uses are kept as pending. At the next `turn.step` start, and at `turn.complete`, md-log reads `$.session.messages()` and takes the results of the pending uses from the latest assistant message's `toolUses[].result`, matched by tool name and input in order. For quiz, the answer comes from the `<quiz-result>` block. For `AskUserQuestion`, it comes from `result.answers`, a map from question to label.
  - Steps carrying `agentId` are skipped.
- **Backfill**: `$.session.messages()` (`{role, text, toolUses, toolResults}`), with Q&A paired from `toolUses`/`toolResults`.
- **Writes**: `$.fs.write` has no append, is not atomic, and rejects anything over 4 MiB. The adapter reads, concatenates, and writes under the queue. At the 4 MiB cap it stops logging (clears the link; `$.fs` has no delete) and shows a toast saying why. This is a deliberate divergence from omp, which has no cap. The link is also cleared on `session.end`.

### quiz

**Core**

- Option normalization and validation:
  - `correctAnswer` is matched by option value, including the stringified-array repair from the original (`quiz.ts:158-175`).
  - Duplicate values are rejected.
- The quiz-contract shuffle.
- Grading: single and multi-select, "I don't know", and a note.
- Building `QuizResultDetails` and the model-facing result text.
- The omp interaction reducer: navigate, toggle, "I don't know", note, submit, cancel.

**omp adapter**

- `pi.registerTool('quiz')`, with the same TUI as today rebuilt on the core reducer.
- `ctx.ui.custom` with `render(width)` as a pure function of state plus theme.
- Quiz calls are serialized with a module-level mutex.
- The result carries `details`.

**CC adapter**

- **Registration**: `$.tool.register({name: 'quiz'})`, which the model sees as `mcp__quiz__quiz`. The `tool.call` handler asks with **`$.ui.ask`**, the native dialog, because waiting inside a mods API call is exempt from the 10 s budget. A Pane is not viable for a model-initiated question: awaiting our own Promise counts against the budget, and a pane the user didn't open is placed only at ≥ 144 columns.
- **The dialog**:
  - `header: 'Quiz'`.
  - Options are the shuffled labels plus `I don't know`.
  - `multiSelect` for multi-answer quizzes, whose answer comes back comma-joined.
- **CC-specific limits, from the dialog's 2–4 options**:
  - At most 3 real options. The CC tool schema says so, and the generator emits it.
  - In multi-select, option labels must not contain `,`, or the answer would be ambiguous.
- **Typed "Other" text**: graded as `dontKnow: true` with the text as the note. The user answered in their own words instead of choosing.
- **Dismissal**: `$.ui.ask` rejects on dismissal or "Chat about this", which counts as `cancelled`. In a non-interactive session (from `session.start`'s `isInteractive`) it counts as `unavailable`.
- **Feedback to the user**: the result text (✓/✗, correct answer, explanation) appears in the transcript. A `ui.render` override for the `ToolUse` site, to draw that feedback nicely, is an optional enhancement gated on open question 2.

### visual-tools

**Core**

- Per-key session state: the managed source file for Mermaid and for SVG.
- Exact-match edit semantics: the target must match exactly once.
- Unique publish names.
- Renderer argv.
- The "is the renderer install current?" decision.

**State keying**

- omp: subagents share one process, and the extension factory runs once per session (`src/sdk.ts:2203-2205`), so state lives in the factory closure.
- CC: one module serves every agent loop, so state is keyed by the tool call's `agentId` (`main` when absent). Sources are in memory and each read-modify-write is synchronous, so per-key serialization holds by construction; a promise queue would count against the 10 s hook budget.

**Renderer**

`renderer/` ships in both trees and holds `render.js` (a bundled Node CLI), `package.json`, and `package-lock.json`. The last two pin `@mermaid-js/mermaid-cli` and `@resvg/resvg-js`.

- **Lazy install**: on first render, the CLI runs `npm ci` from that lockfile into `${XDG_CACHE_HOME:-~/.cache}/learning-plugins/visual-tools/<lock-hash>/`.
  - **No `--omit=optional`**: resvg's platform binaries are optional dependencies.
  - The CLI loads the renderers with `createRequire` anchored at that cache directory, not by ancestor lookup from the plugin tree.
  - Users who never draw never download.
- **Mermaid** uses the system Chrome (`PUPPETEER_SKIP_DOWNLOAD=1`, puppeteer `executablePath`), as today.
- **SVG** goes through resvg, with no Chrome and no system binaries.
- **Protocol**: `node render.js --kind mermaid|svg --in <abs> --out <abs>`.
  - Exit 0 means the PNG exists at `--out`.
  - Non-zero means the stderr tail is the error.
  - Stdout is never used for image data.
- **omp** runs the CLI through `child_process`.
- **CC** runs it through `$.process.run` with explicit `timeoutMs`: 600 000 when an install may happen, 120 000 for a render. It reads the PNG with `$.fs.read(out, {as: 'bytes'})`, and a PNG over 4 MiB is an error.

**Image return**

- omp: `{type: 'image', data, mimeType}` content.
- CC: the tool's `result` must be an array of Anthropic API blocks, `[{type: 'text', text}, {type: 'image', source: {type: 'base64', media_type: 'image/png', data}}]` (verified, below).

**Publish**

- The PNG is copied to `<cwd>/viz/` for Obsidian, as today.
- The name gets a random suffix, and the file is created with an exclusive create.

### teach

Prompts only: the `teach` skill and the `researcher` agent, run through the generator.

## Prompt generator

Agents and skills are written once, in harness-neutral form, with per-harness frontmatter overrides:

```markdown
---
name: researcher
description: Web researcher; searches the web and synthesizes findings
tools: [web_search, web_fetch]          # abstract ids → per-harness allowlist
model:
  omp: openai-codex/gpt-6-sol, zai/glm-5.3
  claude: sonnet
---
Confirm facts before asserting them. For graded checks use {{tool:quiz}};
for open questions use {{tool:ask}}.

{{dispatch:visual-tools/mermaid-maker|<your minimal, concrete brief>}}
```

**Tool map**

| Abstract id | omp | CC |
|---|---|---|
| `quiz` | `quiz` | `mcp__quiz__quiz` |
| `ask` | `ask` | `AskUserQuestion` |
| `web_search` | `web_search` | `WebSearch` |
| `web_fetch` | `read` | `WebFetch` |
| `write_svg` and the other visual tools | `write_svg` | `mcp__visual-tools__write_svg` |

**Agent identity**

| Abstract | omp | CC |
|---|---|---|
| `visual-tools/mermaid-maker` | `mermaid-maker` | `visual-tools:mermaid-maker` |

**Placeholder rules**

- `{{dispatch:agent|brief}}` expands to a complete, runnable invocation example in each harness's syntax:
  - omp: the `task` tool with `agent: "mermaid-maker"`.
  - CC: the `Agent` tool with `subagent_type: "visual-tools:mermaid-maker"`.
- Frontmatter `tools:` is mapped to the harness allowlist, and `model` must have an entry for each harness.
- These fail the build:
  - an unknown placeholder, tool id, or agent id;
  - a missing per-harness model;
  - a legacy literal left in the source: `ask_user_question`, `subagent(`, `web_fetch` outside a placeholder.

## Error handling

- **Observers** (md-log hooks) never break the session. In CC they catch, report via `$.ui.toast`, and always pass through `next(e)`. In omp they catch and `ctx.ui.notify`.
- **Tool handlers** return model-readable errors: error text content in omp, `{result: '<message>', isError: true}` in CC. Every gating CC hook has a `.catch`, enforced by `validate --strict`.
- **Bad tool input** is a hard error with an actionable message, never a silent fallback. Examples: a quiz `correctAnswer` matching no option, too many options for CC, a comma in a CC multi-select label, an edit target not matching exactly once.
- **Render failures** return the renderer's stderr tail so the maker agent can fix its source, as today.
- **Lazy install failure** returns the exact manual command, and the next render retries the install.

## Testing

| Layer | Tool | What it proves |
|---|---|---|
| Core | Vitest | Behaviour: formatting (golden files), grading, the shuffle contract, reducers, edit semantics, install-staleness decisions |
| omp adapter | Vitest + fake `ExtensionAPI` | Events in → files written / tool results out |
| CC adapter | `claude plugin test` on `.test-build/` | Hook behaviour in the real mod engine. `$.fs`, `$.process`, `$.ui` are stubbed: this proves logic and wiring, not real I/O |
| Generator | Vitest + golden files | Each harness's agent/skill output; build errors on bad placeholders and legacy literals |
| Build | `npm run check` | A clean build reproduces `dist/` and both catalogs byte for byte; `validate --strict` passes |
| E2E / smoke | Real harness sessions | Install from the local marketplace in both harnesses and exercise each plugin's critical path, including a renderer install from an empty cache and real writes to a note |

Development is test-first. A test earns its place only if a plausible bug would fail it.

**CI** (GitHub Actions, Node 24.15.0) runs `npm ci`, `tsc`, `vitest`, the `dist/` freshness check, and `claude plugin validate --strict` + `claude plugin test` for every plugin.

## Delivery order

1. **Skeleton**:
   - workspace, tsconfig, vitest, esbuild build, generator, both catalogs, CI;
   - a throwaway `hello` plugin proving load in both harnesses, including the image-returning tool;
   - resolution of the open questions marked *skeleton* below.
2. **md-log**.
3. **quiz**.
4. **visual-tools**.
5. **teach**.

**Dogfooding**: as each plugin lands, it is used from sessions in this repo via `omp plugin link dist/omp/<plugin>` and `claude --plugin-dir dist/claude/<plugin>` (plus its dependencies). `../.pi` and `../.omp` are never modified or deleted.

## Verified facts

Spike in `/tmp/mod-image-spike`, Claude Code 2.1.296, real `claude -p` sessions:

- A mod-registered tool's `result` must be `string | array | undefined`. Objects fail validation.
- An image reaches the model only as an array of Anthropic API blocks (`{type: 'image', source: {type: 'base64', media_type, data}}`); the model correctly named the colour. MCP-shaped blocks (`{type: 'image', data, mimeType}`) pass validation but the API rejects them.
- A mod's hooks module can import relative files outside `hooks/` (`../core/label.ts`).
- `claude plugin test` runs without authentication.

From docs and types:

- **CC mods, versions and budget**:
  - Mods need Claude Code ≥ 2.1.287.
  - A hook's 10 s budget excludes `next` and mods API calls except `$.clock.sleep`, and includes awaiting one's own Promise.
  - A pane the user didn't open is placed at ≥ 144 columns.
- **CC API surface**:
  - `$.ui.ask(question, {options (2–4), header, multiSelect})` resolves to the label, comma-joined for multi-select. Typed text comes back as-is. It rejects on dismissal or in `-p`.
  - `$.process.run` takes `{cwd, env, stdin, timeoutMs}`.
  - `$.fs.read(path, {as: 'bytes'})` exists, and reads and writes are capped at 4 MiB.
  - `tool.call` carries `tool_use_id` and, in a subagent, `agentId`.
  - CC test files (`*.test.ts`) may live anywhere in the plugin dir.
  - `claude plugin validate --strict` turns warnings into errors.
- **omp**:
  - omp loads `package.json#omp.extensions`, `agents/`, and `skills/` on marketplace installs.
  - omp does not read `hooks/hooks.json`.
  - omp has no inter-plugin dependencies.
  - omp prefers `.omp-plugin/marketplace.json` over `.claude-plugin/marketplace.json`.

From the skeleton (Phase 1), Claude Code 2.1.296, omp 18.2.10:

- **Vendored CC types**: `types/claude-code/` holds `claude-code/index.d.ts` and `claude-code-tools/index.d.ts` as written by Claude Code 2.1.296 on an interactive `--plugin-dir` load (`// Written by Claude Code 2.1.296.`). CC also writes `claude-code-mcp/` (not vendored: machine-specific) and a root `tsconfig.json` into that plugin dir; both are ignored by git and by `npm run check`.
- **CC marketplace**: `validate --strict` requires a top-level `description` and rejects a marketplace with no plugins.
- **CC test kit**: `$.command.run` takes the whole `CommandRunInput` (`origin`, `presentation`); `claude plugin validate` and `claude plugin test` need no login.
- **omp**: extension tools default to `loadMode: "discoverable"` (`xd://` devices); `"essential"` keeps them top-level. A plain JSON Schema is accepted as `parameters`. With `hello` installed from the user-scope local marketplace, `/hello Ada` notified `Hello, Ada!`, `/tools` listed `hello_image` but none of the old tools, and the model called `hello_image` and answered `Red (#FF0000)`. Linking the built plugin also made `/hello Ada` work in a new session.
- **Open question 1**: omp reads project config only from `<cwd>/.omp`, so `../.omp/config.yml` does not load inside `learning-plugins/` (`omp config get extensions` and `skills.customDirectories` both returned `[]`; no old tools appeared in `/tools`). Agent discovery walks every ancestor: before shielding, `/agents` listed `researcher`, `mermaid-maker`, and `svg-maker` as project agents; after committing `.omp/agents/.gitkeep`, a new session's `/agents` search for `mermaid-maker` found none. Never use `--scope project` here.
- **Open question 4**: `$.session.messages()` returns a mod tool's `ToolUseSummary.result` array as returned (the text and base64 image blocks), and `AskUserQuestion`'s `result.answers` maps the question text to the chosen label (probe: `/tmp/hello-smoke/hello-probe.json`, `"Which colour do you prefer?": "Blue"`).
- **CC adapter lint**: `eslint.config.js` scopes `@typescript-eslint/no-misused-promises` with `checksVoidReturn.arguments: false` to CC adapter files because the rule hangs on CC 2.1.296's `On` overloads.

## Open questions

| # | Question | Resolve in |
|---|---|---|
| 1 | Does omp, started inside `learning-plugins/`, also load `../.omp/config.yml`? If so, old and new tools collide (`quiz` twice). | answered (Verified facts, skeleton) |
| 2 | What props does the CC `ToolUse` render site receive (is the tool result available) to draw quiz feedback? | quiz |
| 3 | What is the exact `tool_result` `details` of omp's native `ask`? Capture it from a real session before writing md-log's mapping. | md-log |
| 4 | Does CC's `ToolUseSummary.result` (from `$.session.messages()`) hold the quiz `result` array and `AskUserQuestion`'s `{answers}` as returned? The skeleton's `hello` plugin captures both. | answered (Verified facts, skeleton) |
| 5 | How big is the renderer install, and how long does the first `npm ci` take? | visual-tools |
