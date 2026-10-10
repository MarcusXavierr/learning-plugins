# learning-plugins: design

Date: 2026-10-10
Status: approved in a grill session; implementation not started.

## Goal

One repository that is a plugin marketplace for two coding-agent harnesses:

- **Oh My Pi (omp)**: the author's daily driver.
- **Claude Code (CC)**: the distribution target.

A workflow improvement made once, in one source tree, ships to both harnesses. The first plugins are ports of the author's existing pi extensions, skills, and agents in `../.pi` and `../.omp`. Those folders stay untouched as reference material.

pi itself is not a target.

## Plugins

| Plugin | Contents | Port of |
|---|---|---|
| `md-log` | `/md-log <file>`, `/md-unlog`: mirrors the session (user prompts, assistant prose, question/answer blocks) into a markdown file | `.pi/extensions/md-log.ts` |
| `quiz` | Graded multiple-choice tool: shuffled options, "I don't know", free-text note, ✓/✗ with explanation | `.pi/extensions/quiz.ts` |
| `visual-tools` | `write_/edit_/render_` tools for Mermaid and SVG, plus the `mermaid-maker` and `svg-maker` agents and the `visualize` skill | `.pi/extensions/visual-tools/`, `.omp/agents/*-maker.md`, `.pi/skills/visualize` |
| `teach` | The `teach` skill and the `researcher` agent | `.pi/skills/teach`, `.omp/agents/researcher.md` |

`ask-user-question` is dropped. Both harnesses ship a native question tool (`ask` in omp, `AskUserQuestion` in CC), and the features unique to the custom tool (a free-text-only mode, `details`, `value`) are not worth a second question tool competing with the native one.

`teach` uses `quiz` and `md-log`. CC declares this through `dependencies` in `plugin.json`. omp has no inter-plugin dependencies, so the README lists the full install command.

## Repository layout

There is one source of truth per plugin. The build writes two distribution trees, and each harness reads only its own tree through its own catalog.

```
learning-plugins/
├── .claude-plugin/marketplace.json   # CC catalog   → ./dist/claude/<plugin>
├── .omp-plugin/marketplace.json      # omp catalog  → ./dist/omp/<plugin>
├── package.json                      # npm workspaces, scripts
├── tsconfig.base.json
├── vitest.config.ts
├── build/                            # build + generator code (TypeScript, tested)
├── shared/                           # cross-plugin constants (abstract tool ids, names)
├── plugins/<plugin>/                 # SOURCE: the only place anyone edits
│   ├── manifest.json                 # canonical name, version, description, dependencies
│   ├── src/core/                     # pure logic: no I/O, no host imports
│   ├── src/omp.ts                    # omp adapter: default-export ExtensionAPI factory
│   ├── src/claude.ts                 # CC adapter: `export function register(on, options)`
│   ├── prompts/agents/*.md           # canonical agents (placeholders + per-harness overrides)
│   ├── prompts/skills/<skill>/SKILL.md
│   └── test/                         # vitest + CC mod tests
└── dist/                             # GENERATED, committed (marketplaces install from git)
    ├── claude/<plugin>/
    │   ├── .claude-plugin/plugin.json
    │   ├── hooks/hooks.json          # {"modules": ["./register.js"]}
    │   ├── hooks/register.js         # esbuild bundle of src/claude.ts
    │   ├── agents/  skills/          # CC flavour
    └── omp/<plugin>/
        ├── package.json              # "omp": { "extensions": ["./extension.js"] }
        ├── extension.js              # esbuild bundle of src/omp.ts
        ├── agents/  skills/          # omp flavour
```

Why two trees: both harnesses read `agents/` and `skills/` from the plugin root, and the agent and skill text differs per harness (tool names, models, dispatch syntax). The omp docs support a dual catalog explicitly (`omp://marketplace.md`): *"A repository may ship both: omp reads the `.omp-plugin/` copy, Claude Code reads the `.claude-plugin/` copy."* Each tree also stays free of files the other harness would misread. omp never sees `hooks/hooks.json`, and CC never sees `package.json#omp`.

Install commands:

```bash
claude plugin marketplace add <owner>/learning-plugins
claude plugin install md-log@learning-plugins

omp plugin marketplace add <owner>/learning-plugins
omp plugin install md-log@learning-plugins
```

## Toolchain

- **Node 24.15.0** (`.nvmrc`) and npm workspaces. No bun in the repo. omp happens to run extensions under bun, but that is the host's concern.
- **TypeScript strict** with `tsc --noEmit` against the real host types:
  - CC: `claude-code.d.ts`, the version-matched copy Claude Code writes locally.
  - omp: `@oh-my-pi/pi-coding-agent`, pinned to the installed omp version.
- **esbuild**, driven from `build/`. It bundles each adapter into one ESM file. Host packages (`@oh-my-pi/*`, `@sinclair/typebox`) stay external. Bundling is what lets plugins share code from `shared/` even though every installed plugin is copied in isolation.
- **Vitest** for core, adapters (omp), the generator, and the build.
- **`claude plugin test`** for CC mod adapters in the real mod runtime. It works without a login.

## Adapter contract

`src/core/` exports pure functions and reducers. Each adapter does three jobs, all thin:

1. Translate host events into normalized core inputs.
2. Perform I/O with the host's own primitives: `node:fs`/`child_process` in omp; `$.fs`, `$.process`, `$.ui` in CC.
3. Translate core outputs into host results.

Two constraints shape this split:

- **The CC mod runtime has no Node APIs** (no `node:fs`, `setTimeout`, or global `fetch`). Every side effect goes through `$`. Core must therefore never touch I/O.
- **UI cannot be shared.** omp draws imperative, line-based TUI (`ctx.ui.custom`, `Editor`). CC mods return declarative element trees (`Box`, `Text`, `Button`, `Select`, `Input`). Interaction state lives in a core reducer, and each harness has its own render function over that state.

## Plugin designs

### md-log

- **Core**: a formatter from normalized entries to markdown.
  - Entries: `{kind: 'user' | 'assistant' | 'question' | 'answer', …}`.
  - The formatter is pure, so output is byte-identical in both harnesses, enforced by golden files.
- **omp adapter**:
  - Registers commands with `pi.registerCommand`.
  - Hooks `tool_call` (question) and `tool_result` / `tool_execution_update` (answer) for `quiz` and the native `ask`.
  - Writes with `fs.appendFile`.
- **CC adapter**:
  - `$.command.register({name: 'md-log', argumentHint: '<filepath>', immediate: true})` handled by `command.run`. `immediate` means no model turn.
  - Backfill comes from `$.session.messages()`.
  - User prompts are observed on `prompt.submit`, assistant prose on `turn.complete` (`e.answer`).
  - Q&A uses one `tool.call` hook matched on `AskUserQuestion` and `mcp__quiz__quiz`: write the question, `await next(e)`, write the answer, return the result.
  - `$.fs.write` has no append and caps files at 4 MiB, so the adapter reads, concatenates, and writes. Past the cap it stops logging and says so in a toast instead of failing the session.

### quiz

- **Core**:
  - Option normalization.
  - Shuffle with an injected RNG, so tests are deterministic.
  - Validation of `correctAnswer` by option value, including the stringified-array repair from the original.
  - A reducer for the interaction: navigate, toggle, "I don't know", note, submit, cancel.
  - Grading, and the result text returned to the model.
- **omp adapter**:
  - `pi.registerTool('quiz')`.
  - A `ctx.ui.custom` component whose `render(width)` is a pure function of reducer state plus theme.
  - Quiz calls are serialized with a module-level mutex.
- **CC adapter**:
  - `$.tool.register({name: 'quiz'})`, which the model sees as `mcp__quiz__quiz`.
  - The `tool.call` handler opens its own Pane with `$.ui.open({id: 'quiz', focus: true, closeOnEscape: true})`.
  - `ui.render` (`{component: 'Pane'}`) draws reducer state as elements, and button `onPress` dispatches actions.
  - The handler awaits a module-owned Promise that resolves on submit or cancel, then closes the Pane and returns `{result}`.

### visual-tools

- **Core**:
  - Session state for the managed source file.
  - Exact-match edit semantics.
  - Unique publish names.
  - The argv for the renderer.
- **Rendering** runs in a small Node CLI, `render.js`, bundled into both trees:
  - Mermaid goes through `@mermaid-js/mermaid-cli` using the system Chrome (`PUPPETEER_SKIP_DOWNLOAD=1`, puppeteer `executablePath`).
  - SVG goes through `@resvg/resvg-js`, which needs no Chrome and no system binaries.
- **Why a CLI**: the CC mod cannot import npm packages that need Node (no Node APIs), but it can run `$.process.run(['node', render.js, …])`. omp calls the same CLI through `child_process`. One renderer serves both.
- **Lazy install**:
  - On first render, the CLI installs its dependencies into `${XDG_CACHE_HOME:-~/.cache}/learning-plugins/visual-tools` with `npm install --omit=optional`.
  - It reinstalls only when the pinned versions change, so users who never draw never download.
  - The "is the install current?" decision is a pure core function.
- **Image return**:
  - omp returns `{type: 'image', data, mimeType}` content.
  - The CC tool's `result` must be an array of Anthropic API blocks: `[{type: 'text', text}, {type: 'image', source: {type: 'base64', media_type: 'image/png', data}}]` (verified, below).
- **Publish**: the PNG is copied to `<cwd>/viz/` with a unique name, for Obsidian, as today.

### teach

Only prompts: the `teach` skill and the `researcher` agent, run through the generator.

## Prompt generator

Agents and skills are written once with harness-neutral placeholders and per-harness frontmatter overrides:

```markdown
---
name: researcher
description: Web researcher; searches the web and synthesizes findings
tools: [web_search, web_fetch]          # abstract tool ids
model:
  omp: openai-codex/gpt-6-sol, zai/glm-5.3
  claude: sonnet
---
Confirm facts before asserting them. For graded checks use {{tool:quiz}};
for open questions use {{tool:ask}}. To draw, {{dispatch:mermaid-maker}}.
```

A tool map in `shared/` resolves abstract ids per harness:

| Abstract id | omp | CC |
|---|---|---|
| `quiz` | `quiz` | `mcp__quiz__quiz` |
| `ask` | `ask` | `AskUserQuestion` |
| `web_search` | `web_search` | `WebSearch` |
| `web_fetch` | `read` | `WebFetch` |
| `write_svg` and the other visual tools | `write_svg` | `mcp__visual-tools__write_svg` |

`{{dispatch:x}}` renders as each harness's subagent call (`task` in omp, `Agent` in CC). An unknown placeholder, tool id, or a missing per-harness model fails the build.

## Error handling

- **Observers** (md-log hooks) never break the session. In CC they catch, report via `$.ui.toast`/`$.ui.log`, and always pass through `next(e)`. In omp they catch and `ctx.ui.notify`.
- **Tool handlers** return model-readable errors. In omp that is error text content. In CC it is `{result: '<message>', isError: true}`. `claude plugin validate` flags gating hooks without error handling, and the build treats its warnings as failures.
- **Bad tool input** (a quiz `correctAnswer` matching no option, an edit target that doesn't match exactly once) is a hard error with an actionable message, never a silent fallback.
- **Render failures** return the renderer's stderr tail so the maker agent can fix its source, matching the current behaviour.
- **Lazy install failure** returns the exact manual command to run.

## Testing

| Layer | Tool | What it proves |
|---|---|---|
| Core | Vitest | Behaviour: formatting (golden files), grading, shuffling, reducers, edit semantics, install-staleness decisions |
| omp adapter | Vitest + fake `ExtensionAPI` | Events in → files written / tool results out |
| CC adapter | `claude plugin test` on the built tree | The same, in the real mod runtime |
| Generator | Vitest + golden files | Each harness's agent/skill output; build errors on bad placeholders |
| Build | `npm run check` | `dist/` equals a fresh build (no stale commits); `claude plugin validate` passes |
| Smoke | Manual, per plugin | Install from the local marketplace in both harnesses and exercise the feature |

Development is test-first. A test earns its place only if a plausible bug would fail it.

**CI** (GitHub Actions, Node 24.15.0) runs `npm ci`, `tsc`, `vitest`, the `dist/` freshness check, and `claude plugin validate` + `claude plugin test` for every `dist/claude/*`.

## Delivery order

1. **Skeleton**:
   - workspace, tsconfig, vitest, esbuild build, generator, both catalogs, CI;
   - a throwaway `hello` plugin proving load in both harnesses, including the image-returning tool;
   - resolution of the open questions marked *skeleton* below.
2. **md-log**.
3. **quiz**.
4. **visual-tools**.
5. **teach**.

**Dogfooding**: as each plugin lands, it is used from sessions in this repo via `omp plugin link dist/omp/<plugin>` and `claude --plugin-dir dist/claude/<plugin>`. `../.pi` and `../.omp` are never modified or deleted.

## Verified facts

Spike in `/tmp/mod-image-spike`, Claude Code 2.1.296, real `claude -p` sessions:

- A mod-registered tool's `result` must be `string | array | undefined`. Objects fail validation.
- An image reaches the model only as an array of Anthropic API blocks (`{type: 'image', source: {type: 'base64', media_type, data}}`); the model correctly named the colour. MCP-shaped blocks (`{type: 'image', data, mimeType}`) pass validation but the API rejects them.
- A mod's hooks module can import relative files outside `hooks/` (`../core/label.ts`).
- `claude plugin test` runs without authentication.

From docs:

- Mods need Claude Code ≥ 2.1.287.
- Mod hooks get 10 s of their own execution time; time spent inside `next` or `$` calls does not count, except `$.clock.sleep`.
- omp loads `package.json#omp.extensions` on marketplace installs.
- omp does not read `hooks/hooks.json`.
- omp has no inter-plugin dependencies.
- omp prefers `.omp-plugin/marketplace.json` over `.claude-plugin/marketplace.json`.

## Open questions

| # | Question | Resolve in |
|---|---|---|
| 1 | Does omp, started inside `learning-plugins/`, also load `../.omp/config.yml`? If so, old and new tools collide (`quiz` twice). | skeleton |
| 2 | Where must `claude plugin test` test files live relative to the plugin dir, and how do we keep them out of the committed `dist/claude` tree? | skeleton |
| 3 | What name does CC give plugin agents in `Agent` dispatch (`visual-tools:mermaid-maker`?) | skeleton |
| 4 | Does awaiting user input in a CC Pane count against the 10 s hook budget? Needs an interactive session; `-p` draws no UI. | quiz |
| 5 | What are the event and result shapes of omp's native `ask` tool, for md-log? | md-log |
| 6 | Does `$.process.run` accept a timeout long enough for the first lazy install? | visual-tools |
| 7 | How big is mermaid-cli with `--omit=optional`? | visual-tools |
