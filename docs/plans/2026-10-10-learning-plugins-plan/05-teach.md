# Phase 5: teach + release

Ports the `teach` skill and the `researcher` agent into a prompts-only `teach` plugin that depends on `quiz` and `md-log`, proves Claude Code installs those dependencies on its own, and writes the repository README. Then switches day-to-day sessions to the marketplace installs, publishes the repository on GitHub, and re-runs the master acceptance tests 2, 3 and 4 against the GitHub install in fresh sessions of both harnesses. It ends by closing the design doc.

**Prerequisites:**

- Phases 1-4 merged on `main`: `npm run check`, `npm run validate` and `npm test` exit 0; `plugins/md-log`, `plugins/quiz`, `plugins/visual-tools` exist; the `hello` plugin is gone.
- From Phase 1: `build/plugin-tree.ts` exports `renderPrompts(src: PluginSource, harness: Harness): Promise<Tree>` (keys `agents/<n>.md`, `skills/<s>/SKILL.md`); prompts-only plugins are covered by `build/test/plugin-tree.test.ts` (fixture `beta`); `shared/tool-map.ts` has `quiz`, `ask`, `read`, `web_search`, `web_fetch`; `.github/workflows/ci.yml` exists; `learning-plugins/.omp/agents/.gitkeep` is committed and open question 1 is answered in the design doc.
- Every shell: `cd /home/marcus/tmp/learn/learning-plugins && source ~/.nvm/nvm.sh && nvm use 24.15.0`.
- Facts already established while writing this phase (do not re-derive):
  - The GitHub repository `MarcusXavierr/learning-plugins` **already exists, is public and empty** (`git ls-remote origin` prints nothing), and `origin` already points at it. Do **not** run `gh repo create`.
  - `gh` on this machine is authenticated through the `GITHUB_TOKEN` environment variable as `marcusxavier-scrumlaunch`, which has `push: false` on that repository. Task 5 handles this.
  - Claude Code 2.1.296 installs bare-name `dependencies` from `plugin.json` out of the same marketplace and prints them on the success line. Verified with a throwaway marketplace (`/tmp/depspike`): `✔ Successfully installed plugin: a@depspike (scope: user) (+ 1 dependency: b)`. `uninstall --prune -y` printed `Removed 1 auto-installed plugin: b`. `claude --plugin-dir <a>` alone left `a@inline` disabled with `Dependency "b" is not installed — run ...`; `--plugin-dir <a> --plugin-dir <b>` and `--plugin-dir <parent of a and b>` both loaded both. A local-folder marketplace is read in place (`Read from: <repo>/dist/claude/<p>`). `CLAUDE_CONFIG_DIR=<tmpdir>` isolates all of this from `~/.claude`.
  - omp 18.2.10 `omp plugin install` loops over every target it is given (`src/cli/plugin-cli.ts:379`), so one line installs several plugins; `omp plugin uninstall` likewise (`:519`). Marketplace installs are copied into omp's plugin cache (`omp://marketplace.md`, "On-disk layout").
  - Phase 1's open-question-1 rule: **always install at user scope; never pass `--scope project`** (omp's project registry would resolve to `../.omp`).

## Acceptance tests (this phase)

1. **Given** `npm run build`, **when** I read `dist/claude/teach` and `dist/omp/teach`, **then** the CC tree declares `"dependencies": ["quiz", "md-log"]` and its skill and agent name `mcp__quiz__quiz`, `AskUserQuestion`, `teach:researcher`, `WebSearch, WebFetch` and `model: sonnet`, while the omp tree names `quiz`, `ask`, `researcher`, `web_search, read`, keeps `openai-codex/gpt-6-sol, zai/glm-5.3` with `thinking: medium`, and ships no extension.
2. **Given** an empty Claude Code config and this repo added as a local marketplace, **when** I run `claude plugin install teach@learning-plugins`, **then** `quiz` and `md-log` are installed and enabled with it, and pruning after uninstall removes them again.
3. **Given** the repository pushed to `MarcusXavierr/learning-plugins`, **when** CI runs on `main`, **then** it is green.
4. **Given** both harnesses switched to the GitHub marketplace with the README's install lines, **when** I open a fresh session in each, **then** master acceptance tests 2, 3 and 4 pass.
5. **Given** the release, **when** I read the design doc, **then** its status line says released and every open question row carries its recorded answer.

---

### Task 1: `teach` plugin (skill, researcher agent, golden files)

Prompts only: no `src/`, so the build emits no CC hooks and no omp extension (Phase 1 contract). The skill and agent are ported mechanically by a script so the diff against the originals is exactly the harness-specific literals and one added dispatch example.

Harness-specific literals replaced in `/home/marcus/tmp/learn/.pi/skills/teach/SKILL.md` (original line numbers):

| Line | Original | Source form | omp | CC |
|---|---|---|---|---|
| 62 | `` `quiz` `` ×1, `` `ask_user_question` `` ×2 | `` `{{tool:quiz}}` ``, `` `{{tool:ask}}` `` | `quiz`, `ask` | `mcp__quiz__quiz`, `AskUserQuestion` |
| 71 | a quick `` `researcher` `` subagent | `` `{{agent:teach/researcher}}` `` | `researcher` | `teach:researcher` |
| 71 (new lines after) | none: pi's subagent call syntax was implicit | `{{dispatch:teach/researcher\|…}}` | `task` tool example | `Agent` tool example |
| 73 | (applies to every `` `quiz` ``) | `` `{{tool:quiz}}` `` | `quiz` | `mcp__quiz__quiz` |
| 88, 97, 133 | `` `quiz` `` ×1 each | `` `{{tool:quiz}}` `` | `quiz` | `mcp__quiz__quiz` |
| 99 | `` `ask_user_question` `` ×2, `` `quiz` `` ×1 | `{{tool:ask}}`, `{{tool:quiz}}` | `ask`, `quiz` | `AskUserQuestion`, `mcp__quiz__quiz` |
| 105 | with a `` `researcher` `` subagent | `` `{{agent:teach/researcher}}` `` | `researcher` | `teach:researcher` |
| 131 | `` `quiz` `` ×1, `` `ask_user_question` `` ×1 | `{{tool:quiz}}`, `{{tool:ask}}` | `quiz`, `ask` | `mcp__quiz__quiz`, `AskUserQuestion` |

Totals: 7 `` `quiz` ``, 5 `` `ask_user_question` ``, 2 `` `researcher` `` subagent mentions. Left as prose on purpose: "quiz options" (73, 141), "Quiz-check"/"quiz-check" (133, 135), "fire a quick researcher" (105, already introduced by the placeholder one clause earlier), "Obsidian" and "mermaid" (both harnesses write the same note via `md-log`). Line 75's "The tool already tells you to keep options even" stays true: Phase 3 folds the original `promptGuidelines`, including "keep option phrasing/length even", into the quiz tool description in both harnesses.

Researcher agent: body from `.pi/agents/researcher.md` (which `.omp/agents/researcher.md` copies, swapping `web_fetch` for `read` and adding "on the URL"); `web_search`/`web_fetch` become placeholders; pi-only `safe_bash`, `system-prompt`, `auto-exit` and the `.omp` port comment are dropped; omp keeps `model: openai-codex/gpt-6-sol, zai/glm-5.3` and `thinking: medium` (under `harness.omp`); CC gets `model: sonnet`.

**Files:**
- Create: `plugins/teach/package.json`
- Create: `plugins/teach/test/prompts.test.ts`
- Create (by script): `plugins/teach/prompts/skills/teach/SKILL.md`, `plugins/teach/prompts/agents/researcher.md`
- Create (by Vitest): `plugins/teach/test/__golden__/{omp,claude}/agents/researcher.md`, `plugins/teach/test/__golden__/{omp,claude}/skills/teach/SKILL.md`
- Modify: `shared/tool-map.ts` (`AGENTS`)
- Generated: `dist/claude/teach/**`, `dist/omp/teach/**`, `.claude-plugin/marketplace.json`, `.omp-plugin/marketplace.json`

**Step 1: Write the manifest**

`plugins/teach/package.json`:

```json
{
  "name": "@learning-plugins/teach",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "A teaching skill that builds understanding from first principles and checks every step with a quiz, plus a researcher agent that fact-checks on the web.",
  "plugin": {
    "dependencies": ["quiz", "md-log"]
  }
}
```
After writing the manifest, run `npm install` from the repo root. It registers `@learning-plugins/teach` as a workspace in the root `package-lock.json`; inspect the lock diff and keep it with the manifest. Without this step, the clean-clone `npm ci` in CI rejects the out-of-sync lock.

`plugin.dependencies` becomes `dependencies` in `dist/claude/teach/.claude-plugin/plugin.json`; bare names resolve in the plugin's own marketplace (`/tmp/pref.md:208-210`; https://code.claude.com/docs/en/plugins/dependencies.md, "Declare a dependency with a version constraint"). No version ranges: those resolve against `<plugin>--v<version>` git tags we don't publish.

**Step 2: Write the failing test**

`plugins/teach/test/prompts.test.ts`:

```ts
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { loadPluginSource } from "../../../build/plugin-source.ts";
import { renderPrompts } from "../../../build/plugin-tree.ts";

const pluginDir = fileURLToPath(new URL("..", import.meta.url));

for (const h of ["omp", "claude"] as const) {
  test(`${h} prompts match golden files`, async () => {
    const tree = await renderPrompts(await loadPluginSource(pluginDir), h);
    expect([...tree.keys()].sort()).toEqual(["agents/researcher.md", "skills/teach/SKILL.md"]);
    for (const [path, text] of tree) {
      await expect(text).toMatchFileSnapshot(`./__golden__/${h}/${path}`);
    }
  });
}
```

The key-set assertion is what makes the first run red; it also catches a stray or missing prompt file shipping in the plugin.

**Step 3: Run it, expect failure**

Run: `npx vitest run plugins/teach/test/prompts.test.ts`
Expected: 2 failed, each `expected [] to deeply equal [ 'agents/researcher.md', 'skills/teach/SKILL.md' ]`.

**Step 4: Port the prompts with a script**

Save as `/tmp/port-teach.py` (throwaway, not committed) and run `python3 /tmp/port-teach.py` from the repo root:

```python
from pathlib import Path

learn = Path("/home/marcus/tmp/learn")
out = Path("plugins/teach/prompts")

skill = (learn / ".pi/skills/teach/SKILL.md").read_text()
assert skill.count("`quiz`") == 7, "expected 7 `quiz` literals"
assert skill.count("`ask_user_question`") == 5, "expected 5 `ask_user_question` literals"
assert skill.count("`researcher` subagent") == 2, "expected 2 `researcher` subagent mentions"
skill = (
    skill.replace("`ask_user_question`", "`{{tool:ask}}`")
    .replace("`quiz`", "`{{tool:quiz}}`")
    .replace("`researcher` subagent", "`{{agent:teach/researcher}}` subagent")
)
lines = skill.split("\n")
i = next(n for n, line in enumerate(lines) if line.startswith("**Accuracy is non-negotiable"))
lines[i + 1 : i + 1] = [
    "",
    "A verification dispatch looks like this:",
    "",
    "{{dispatch:teach/researcher|Check this claim and correct it if it is wrong, citing sources: <the exact fact, name, date, formula, or definition you are unsure of>}}",
]
(out / "skills/teach").mkdir(parents=True, exist_ok=True)
(out / "skills/teach/SKILL.md").write_text("\n".join(lines))

body = (learn / ".pi/agents/researcher.md").read_text().split("---\n", 2)[2]
assert body.count("`web_search`") == 1 and body.count("use `web_fetch` to get") == 1
body = body.replace("`web_search`", "`{{tool:web_search}}`").replace(
    "use `web_fetch` to get", "use `{{tool:web_fetch}}` on the URL to get"
)
frontmatter = """---
name: researcher
description: Web researcher — searches the web and synthesizes findings
tools: [web_search, web_fetch]
model:
  omp: openai-codex/gpt-6-sol, zai/glm-5.3
  claude: sonnet
harness:
  omp: { thinking: medium }
---
"""
(out / "agents").mkdir(parents=True, exist_ok=True)
(out / "agents/researcher.md").write_text(frontmatter + body)
```

Verify: `sha256sum plugins/teach/prompts/skills/teach/SKILL.md plugins/teach/prompts/agents/researcher.md` prints exactly

```
50b59c8362df3bfd546fc6a45d9f0263d152cd257a3f44c96e6d0bb0d86f2a41  plugins/teach/prompts/skills/teach/SKILL.md
ee6ea0a559d2359045a50fa904ff4534c621e935c8ca19e89cb8e2f1b5900b1c  plugins/teach/prompts/agents/researcher.md
```

A mismatch means `.pi` changed since this plan was written: inspect `diff` against the original and keep only the substitutions in the table above. Line 133 of the skill source (`2. **Establish.** `) carries a trailing space from the original; keep it (no formatter on `prompts/`).

**Step 5: Run, expect the generator to reject the unknown agent**

Run: `npx vitest run plugins/teach/test/prompts.test.ts`
Expected: 2 failed with a `PromptError` naming `plugins/teach/prompts/skills/teach/SKILL.md` and the unknown agent id `teach/researcher`. This is the generator guard doing its job before the map entry exists.

**Step 6: Register the agent**

In `shared/tool-map.ts`, add one entry to the `AGENTS` object literal (keep existing entries; keys stay in plugin order):

```ts
  "teach/researcher": { omp: "researcher", claude: "teach:researcher" },
```

**Step 7: Create the golden files**

Run: `npx vitest run -u plugins/teach/test/prompts.test.ts`
Expected: 2 passed; 4 files written under `plugins/teach/test/__golden__/`.

Then run without `-u`: `npx vitest run plugins/teach/test/prompts.test.ts` → 2 passed.

**Step 8: Review the goldens against the originals (exact)**

These diffs are the review. Any extra hunk is a bug in the port or the generator: fix the source, re-run Step 7.

```bash
diff ../.omp/agents/researcher.md plugins/teach/test/__golden__/omp/agents/researcher.md
```
Expected output, exactly:
```
8d7
< <!-- omp port of .pi/agents/researcher.md; pi-only frontmatter removed. -->
```

```bash
diff ../.pi/agents/researcher.md plugins/teach/test/__golden__/claude/agents/researcher.md
```
Expected output, exactly:
```
4,8c4,5
< tools: web_search, web_fetch, safe_bash
< model: openrouter/z-ai/glm-5.3
< thinking: medium
< system-prompt: append
< auto-exit: true
---
> tools: WebSearch, WebFetch
> model: sonnet
17c14
< 2. Search with `web_search` using varied angles
---
> 2. Search with `WebSearch` using varied angles
19c16
< 4. For the 2-3 most promising source URLs, use `web_fetch` to get full page content
---
> 4. For the 2-3 most promising source URLs, use `WebFetch` on the URL to get full page content
```

```bash
diff ../.pi/skills/teach/SKILL.md plugins/teach/test/__golden__/omp/skills/teach/SKILL.md | grep -E '^[0-9]' | tr '\n' ' '
diff ../.pi/skills/teach/SKILL.md plugins/teach/test/__golden__/claude/skills/teach/SKILL.md | grep -E '^[0-9]' | tr '\n' ' '
```
Expected, exactly (omp line first, then CC):
```
62c62 72a73,88 99c115 131c147
62c62 71c71,83 73c85 88c100 97c109 99c111 105c117 131c143 133c145
```

No hunk touches lines 1-4: the skill frontmatter renders byte-identical to the original. The inserted dispatch renders, in the omp golden:

````
A verification dispatch looks like this:

Call the `task` tool:

```json
{
  "context": "<background the agent needs beyond the brief>",
  "tasks": [
    {
      "agent": "researcher",
      "task": "Check this claim and correct it if it is wrong, citing sources: <the exact fact, name, date, formula, or definition you are unsure of>"
    }
  ]
}
```
````

and in the CC golden:

````
A verification dispatch looks like this:

Call the `Agent` tool:

```json
{
  "description": "<3-5 word summary of the brief>",
  "prompt": "Check this claim and correct it if it is wrong, citing sources: <the exact fact, name, date, formula, or definition you are unsure of>",
  "subagent_type": "teach:researcher"
}
```
````

Final literal sweep: `grep -c 'ask_user_question' plugins/teach/test/__golden__/*/skills/teach/SKILL.md` prints `0` for both files.

**Step 9: Build and inspect the trees**

Run: `npm run build`

`find dist/claude/teach dist/omp/teach -type f | sort` prints exactly:
```
dist/claude/teach/.claude-plugin/plugin.json
dist/claude/teach/agents/researcher.md
dist/claude/teach/skills/teach/SKILL.md
dist/omp/teach/agents/researcher.md
dist/omp/teach/package.json
dist/omp/teach/skills/teach/SKILL.md
```

`cat dist/claude/teach/.claude-plugin/plugin.json` prints exactly:
```json
{
  "name": "teach",
  "version": "0.1.0",
  "description": "A teaching skill that builds understanding from first principles and checks every step with a quiz, plus a researcher agent that fact-checks on the web.",
  "author": {
    "name": "Marcus Xavier"
  },
  "dependencies": [
    "quiz",
    "md-log"
  ]
}
```

`jq -c '[.plugins[].name]' .claude-plugin/marketplace.json .omp-plugin/marketplace.json` prints `["md-log","quiz","teach","visual-tools"]` twice.

`cmp dist/claude/teach/skills/teach/SKILL.md plugins/teach/test/__golden__/claude/skills/teach/SKILL.md && cmp dist/omp/teach/agents/researcher.md plugins/teach/test/__golden__/omp/agents/researcher.md` exits 0 (the tree ships what the goldens pin).

**Step 10: Repo checks**

Run: `npm run typecheck && npm test && npm run check && npm run validate`
Expected: every step exits 0. `validate` runs `claude plugin validate --strict` on `dist/claude/teach` among others; a warning about the agent or skill frontmatter fails here and means the generator emits a field CC doesn't know: fix it in `build/prompts.ts` with a failing generator test first.

Run: `npm run test:claude`
Expected: exit 0, and no suite for `teach` (it has no `src/claude.ts`). If it fails on `teach` for lack of tests, that is a Phase 1 bug in `build/cli.ts test-claude`: add a failing test in `build/test/` asserting prompts-only plugins are skipped, then fix.

**Step 11: Smoke the trees in both harnesses (no install yet)**

CC, no login needed:

```bash
claude --plugin-dir dist/claude/teach --plugin-dir dist/claude/quiz --plugin-dir dist/claude/md-log plugin details teach
```
Expected: `Component inventory` with `Skills (1)  teach`, `Agents (1)  researcher`, `Hooks (0)`.

omp (dogfooding as in the design until Task 4 switches to installs):

```bash
omp plugin link dist/omp/teach
omp -p "Use the task tool to run the researcher agent with this task: 'In what year was RFC 793 (Transmission Control Protocol) published? Give the year and one source URL.' Then reply with only the year."
```
Expected: `Linked @learning-plugins/teach from dist/omp/teach`; the print run ends with `1981`. A reply saying no agent named `researcher` exists means omp did not load `agents/` from a prompts-only plugin: run `omp plugin list` and `omp plugin doctor`, and stop; the dual-tree design assumes this works (`omp://marketplace.md`: plugin content "such as skills, commands, agents").

**Step 12: Commit**

```bash
git add plugins/teach shared/tool-map.ts package-lock.json dist .claude-plugin .omp-plugin
git commit -m "feat(teach): add teach skill and researcher agent"
```

---

### Task 2: Prove Claude Code installs `teach`'s dependencies

Runs in a throwaway `CLAUDE_CONFIG_DIR`, so `~/.claude` is untouched and the result does not depend on what is already installed. No session or login is needed. Behaviour cited from https://code.claude.com/docs/en/plugins/dependencies.md ("Bundle plugins for a team": "installing it installs every dependency"; "Test a plugin and its dependency locally") and https://code.claude.com/docs/en/plugins/install.md ("Plugins with dependencies": "Claude Code also installs and enables the plugin's declared dependencies at the same scope. The success message lists them."; "Uninstall: auto-installed dependencies stay until you run `claude plugin prune`").

**Files:**
- Modify: `docs/plans/2026-10-10-learning-plugins-design.md` (Verified facts)

**Step 1: Install from the local marketplace into an empty config**

```bash
export CLAUDE_CONFIG_DIR="$(mktemp -d)"
claude plugin marketplace add /home/marcus/tmp/learn/learning-plugins
claude plugin install teach@learning-plugins
```
Expected:
```
✔ Successfully added marketplace: learning-plugins (declared in user settings)
✔ Successfully installed plugin: teach@learning-plugins (scope: user) (+ 2 dependencies: …)
```
where `…` names `quiz` and `md-log` (order not specified by the docs).

**Step 2: Confirm all three are installed and enabled**

```bash
claude plugin list --json | jq -c 'sort_by(.id)[] | {id, enabled, scope}'
```
Expected, exactly:
```
{"id":"md-log@learning-plugins","enabled":true,"scope":"user"}
{"id":"quiz@learning-plugins","enabled":true,"scope":"user"}
{"id":"teach@learning-plugins","enabled":true,"scope":"user"}
```

`claude plugin list --json | jq '[.[] | .errors // empty] | length'` prints `0` (the `quiz` and `md-log` mods loaded without errors).

**Step 3: Confirm `--plugin-dir` does not resolve dependencies (why the README's dev loop passes three dirs)**

```bash
CLAUDE_CONFIG_DIR="$(mktemp -d)" claude --plugin-dir dist/claude/teach plugin list
```
The fresh config matters: the installs from Step 1 would otherwise satisfy the dependency.
Expected: `teach@inline` with `Status: ✘ disabled` and `Error: Dependency "…" is not installed — run \`claude plugin install …\``.

```bash
CLAUDE_CONFIG_DIR="$(mktemp -d)" claude --plugin-dir dist/claude plugin list
```
Expected: four `@inline` plugins, all `Status: ✔ loaded` (a non-plugin parent folder loads each child plugin; CC ≥ 2.1.265).

**Step 4: Uninstall prunes the dependencies**

```bash
claude plugin uninstall teach@learning-plugins --prune -y
claude plugin list
unset CLAUDE_CONFIG_DIR
```
Expected: `✔ Successfully uninstalled plugin: teach (scope: user)`, then `Removed 2 auto-installed plugins: …` naming `quiz` and `md-log`; then ``No plugins installed. Use `claude plugin install` to install a plugin.``

**Step 5: Record the facts**

Append to the design doc's `## Verified facts` section, after the `From docs and types:` list:

```markdown
Phase 5, Claude Code 2.1.296, local marketplace, empty `CLAUDE_CONFIG_DIR`:

- `claude plugin install teach@learning-plugins` installs and enables `quiz` and `md-log` from `plugin.json` `dependencies`; the success line ends `(+ 2 dependencies: …)`. `uninstall --prune -y` removes them again.
- `--plugin-dir dist/claude/teach` alone leaves `teach` disabled with `Dependency "…" is not installed`. Passing every dependency's dir, or the parent `dist/claude` once (CC ≥ 2.1.265), loads them all.
- A local-folder marketplace is read in place from `dist/claude/<plugin>`; omp copies marketplace installs into its plugin cache.
```

**Step 6: Commit**

```bash
git add docs/plans/2026-10-10-learning-plugins-design.md
git commit -m "docs: record Claude Code dependency resolution for teach"
```

---

### Task 3: README

Rewrites `README.md` (currently the single line `# learning-plugins`). Written per `skill://write-docs`: lead with what the reader can do, prose where steps depend on each other, no em or en dashes anywhere. Every command in it is executed somewhere in this phase (Tasks 2, 4, 5) or in the master command table.

**Files:**
- Modify: `README.md`

**Step 1: Write the file**

`README.md`, complete:

````markdown
# learning-plugins

Plugins for learning things with an AI coding agent: a teaching skill that checks your understanding with graded quizzes as it goes, a logger that turns the session into a markdown note, and diagram tools that let the agent draw a picture and look at what it drew. The same plugins install in [Claude Code](https://code.claude.com/docs) and in [Oh My Pi](https://omp.sh) (omp), and this repository is the marketplace both of them install from.

Status: 0.1.0. A personal setup in daily use, published as is.

## The plugins

| Plugin | What it adds |
|---|---|
| `teach` | The `teach` skill: it quizzes you to find where your knowledge runs out, proposes a plan with a small dependency map, waits for your go-ahead, then teaches one idea at a time and checks each with a quiz. A `researcher` agent fact-checks on the web before anything uncertain gets said. |
| `quiz` | A graded multiple-choice question tool. Options are shuffled, "I don't know" is always offered, you can attach a note, and the answer comes back marked right or wrong with an explanation. |
| `md-log` | `/md-log <file>` mirrors the session into an existing markdown note: your prompts, the agent's prose, and every question with your answer. `/md-unlog` stops. |
| `visual-tools` | Mermaid and SVG tools that render to PNG and hand the image back to the model, the `mermaid-maker` and `svg-maker` agents that use them, and the `visualize` skill that decides when a picture helps. |

`teach` leans on the other two: its checks are `quiz` calls, and it writes for someone following the lesson in the note that `md-log` keeps, rendered in Obsidian. Claude Code installs both automatically when you install `teach`. omp has no dependencies between plugins, so there you name all three.

Claude Code namespaces what a plugin adds, so a few names differ between the harnesses:

| | Claude Code | omp |
|---|---|---|
| Quiz tool | `mcp__quiz__quiz` | `quiz` |
| Teaching skill | `/teach:teach` | `teach` |
| Researcher agent | `teach:researcher` | `researcher` |
| Diagram agents | `visual-tools:mermaid-maker`, `visual-tools:svg-maker` | `mermaid-maker`, `svg-maker` |
| Note commands | `/md-log`, `/md-unlog` | `/md-log`, `/md-unlog` |

## Install in Claude Code

You need Claude Code 2.1.287 or later, the first version that runs plugin code like the quiz tool and the note logger.

```bash
claude plugin marketplace add MarcusXavierr/learning-plugins
claude plugin install teach@learning-plugins
claude plugin install visual-tools@learning-plugins
```

The `teach` install also installs `quiz` and `md-log`, and its success line says so with `(+ 2 dependencies: ...)`. Any plugin installs on its own the same way, for example `claude plugin install md-log@learning-plugins`. Plugins load in your next session, or after `/reload-plugins` in one that is already open.

## Install in omp

You need omp 18.2.

```bash
omp plugin marketplace add MarcusXavierr/learning-plugins
omp plugin install teach@learning-plugins quiz@learning-plugins md-log@learning-plugins
omp plugin install visual-tools@learning-plugins
```

Start a new session afterwards: omp loads new tools and commands when a session starts.

## Try it

`/md-log` links a note that already exists and never creates one, so make the file first:

```bash
touch notes.md
```

Then, in a session started in the same directory:

```text
/md-log notes.md
Teach me why the sky is blue.
```

The agent opens with a few quick quizzes to find the edge of what you know, then asks what you want out of the lesson, and shows a plan before teaching anything. Everything lands in `notes.md`, including each question exactly as you saw it and how you answered. The skill writes math as LaTeX and plans as Mermaid, both of which Obsidian renders.

## Good to know

**md-log.** Linking overwrites the note with the conversation so far, then appends as the session goes on. Keep one session per note; two sessions writing to the same note can interleave. In Claude Code, `/md-log` typed while the agent is working runs once the turn ends, and logging stops with a notice if the note would grow past 4 MiB (a limit of Claude Code's plugin file API). omp refuses `/md-log` while the agent is busy and has no size limit. `/md-unlog` works at any time.

**quiz in Claude Code** asks through Claude Code's own question dialog, which shapes it: at most three options plus "I don't know", no commas in option labels when several answers can be picked, and option descriptions are not shown. If you type your own answer under "Other", it is graded as "I don't know" and your text is kept as the note. Dismissing the dialog cancels the quiz, and in `claude -p` the tool reports that it can't ask.

**visual-tools** installs its renderer the first time something is drawn, into `${XDG_CACHE_HOME:-~/.cache}/learning-plugins/visual-tools/<hash>/`. The size on disk, npm-cache overhead and first-install timing measured during Phase 4 are recorded in the [design doc's open question 5 answer](docs/plans/2026-10-10-learning-plugins-design.md#open-questions-all-resolved); actual time and space vary by machine and cache state. It needs `node` (22.13 or later) and `npm` on your `PATH`. Mermaid renders through your installed Chrome or Chromium, found at the usual macOS and Linux locations or wherever `PUPPETEER_EXECUTABLE_PATH` points; SVG needs no browser. Finished pictures are copied to `viz/` in the session's directory under a new name each time, so nothing is overwritten. Deleting the cache directory is safe: the next drawing installs again. An update that changes the renderer's dependencies installs into a new `<hash>` directory and leaves the old one for you to delete.

## Develop

You need Node 24.15.0 (pinned in `.nvmrc`), Claude Code 2.1.287 or later for the plugin checks, omp 18.2 to try the omp side, and Chrome or Chromium to render Mermaid.

Each plugin's source lives in `plugins/<name>/`: pure logic in `src/core/`, one thin adapter per harness (`src/omp.ts`, `src/claude.ts`), and prompts in `prompts/` written once with placeholders for the names that differ. `npm run build` turns that into two install trees, `dist/claude/<name>` and `dist/omp/<name>`, plus the two catalogs that point at them, `.claude-plugin/marketplace.json` and `.omp-plugin/marketplace.json`. Both harnesses install straight from git, so the generated trees are committed; never edit them by hand, and rebuild before you commit, because CI fails on stale output.

```bash
nvm use
npm ci
npm run build
```

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript, strict, against both hosts' real types |
| `npm test` | Vitest: core logic, the omp adapters, the prompt generator, the build |
| `npm run build` | Regenerates `dist/` and both catalogs |
| `npm run check` | Fails and lists every file in `dist/` or the catalogs that a build would change |
| `npm run validate` | `claude plugin validate --strict` on the marketplace and every Claude Code plugin |
| `npm run test:claude` | Runs each plugin's Claude Code tests with `claude plugin test` |

To try your changes in a real session, point each harness at the build output. In omp, link a plugin once; the link follows `dist/`, so after each `npm run build` you only start a new session:

```bash
omp plugin link dist/omp/md-log
```

In Claude Code, pass the plugin directories when you start a session, and run `/reload-plugins` after each build. `--plugin-dir` doesn't install dependencies, so `teach` needs its two alongside it, or pass the parent directory to load every plugin at once:

```bash
claude --plugin-dir dist/claude/teach --plugin-dir dist/claude/quiz --plugin-dir dist/claude/md-log
claude --plugin-dir dist/claude
```

The design behind all of this, including why there are two trees and what each harness can and can't do, is in [`docs/plans/2026-10-10-learning-plugins-design.md`](docs/plans/2026-10-10-learning-plugins-design.md).
````

**Step 2: Check it**

```bash
grep -nP '[\x{2013}\x{2014}]' README.md; echo "dashes: $?"
```
Expected: no matches, `dashes: 1`.

Cross-check the facts it states against the plugins as built, and fix the README (not the plugins) where they disagree:
- `grep -rn "PUPPETEER_EXECUTABLE_PATH\|learning-plugins/visual-tools" plugins/visual-tools/src` finds the Chrome override and the cache path.
- `grep -rn "4 \* 1024 \* 1024\|4194304" plugins/md-log/src` finds the CC note cap.
- `grep -n '"engines"\|22.13' plugins/visual-tools/renderer/package.json plugins/visual-tools/src -r` confirms the renderer's Node floor.
- Read row 5 of `docs/plans/2026-10-10-learning-plugins-design.md` (Phase 4's recorded open-question-5 answer) and confirm the README links to that measurement rather than inventing size or timing numbers; if the row has no measured result, resolve Phase 4 before publishing this README.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: write README"
```

---

### Task 4: Dogfooding switch to marketplace installs

Until now sessions in this repo used `omp plugin link` and `claude --plugin-dir`. From here they use the plugins installed from the marketplace, exactly as a user gets them: first from the local checkout (this task), then from GitHub (Task 5). Everything is user scope (Phase 1's open-question-1 rule). Nothing under `../.pi` or `../.omp` is read for writing, moved, or deleted.

**Files:** none (harness state only; no commit).

**Step 1: Remove the omp links**

```bash
omp plugin list
```
For every line under `npm Plugins:` of the form `@learning-plugins/<p>@0.1.0`, run (one at a time, since a name that isn't installed exits 1 and stops the loop):

```bash
omp plugin uninstall @learning-plugins/<p>
```
Expected per call: `Uninstalled @learning-plugins/<p>`. Then `omp plugin list` shows no `@learning-plugins/` entries.

If uninstall reports an error for a linked plugin [UNVERIFIED: `PluginManager.uninstall` on a link]: run `omp plugin list --json | jq -r '.npm[].name'` to confirm the name, then remove only the symlink with `rm ~/.omp/plugins/node_modules/@learning-plugins/<p>` (no `-r`; it is a link into `dist/omp/<p>`), and re-run `omp plugin list`.

**Step 2: Install from the local marketplace in omp**

Phase 1 left `learning-plugins` registered. First run `omp plugin marketplace list` and inspect the source. If it is already `/home/marcus/tmp/learn/learning-plugins`, reuse it and run `omp plugin marketplace update learning-plugins` to refresh the catalog; if it is absent, run `omp plugin marketplace add /home/marcus/tmp/learn/learning-plugins`. Do not add a second marketplace with the same name. A different source under the same name is unexpected: inspect and resolve that registration before installing.

```bash
omp plugin discover learning-plugins
omp plugin install teach@learning-plugins quiz@learning-plugins md-log@learning-plugins
omp plugin install visual-tools@learning-plugins
```
Expected: `discover` lists `md-log@0.1.0`, `quiz@0.1.0`, `teach@0.1.0`, `visual-tools@0.1.0` with their descriptions; four lines `Installed <p> from learning-plugins (0.1.0)`. Only the absent-marketplace branch prints `Added marketplace: /home/marcus/tmp/learn/learning-plugins`.

Confirm omp read the omp catalog, not the CC one:

```bash
omp plugin list --json | jq -r '.marketplace[] | "\(.id) \(.entries[0].installPath)"'
ls "$(omp plugin list --json | jq -r '.marketplace[] | select(.id=="teach@learning-plugins") | .entries[0].installPath')"
```
Expected: four ids with paths in omp's plugin cache; the `teach` directory lists `agents  package.json  skills` and no `.claude-plugin`.

After later rebuilds, refresh an omp install with `omp plugin install --force <p>@learning-plugins` (installs are copies; the version stays 0.1.0, so `upgrade` sees nothing new).

**Step 3: Install from the local marketplace in Claude Code**

```bash
claude plugin marketplace add /home/marcus/tmp/learn/learning-plugins
claude plugin install teach@learning-plugins
claude plugin install visual-tools@learning-plugins
claude plugin list --json | jq -c 'sort_by(.id)[] | select(.id|endswith("@learning-plugins")) | {id, enabled, readFromFolder}'
```
Expected: `(+ 2 dependencies: …)` on the teach line; four entries, all `"enabled":true`, `readFromFolder` under `/home/marcus/tmp/learn/learning-plugins/dist/claude/`. CC reads this marketplace in place, so after a rebuild `/reload-plugins` picks up the change.

**Step 4: No duplicates in a session inside `learning-plugins/`**

```bash
cd /home/marcus/tmp/learn/learning-plugins && omp
```
In the session:
- `/tools`: `quiz` appears once; `ask_user_question` does not appear; `write_mermaid`, `edit_mermaid`, `render_mermaid`, `write_svg`, `edit_svg`, `render_svg` appear once each. omp extension tools default to `loadMode: "discoverable"` (mounted as `xd://` devices, `extensibility/extensions/types.d.ts:434`), so quiz and visual-tools register theirs with `loadMode: "essential"`; the prompts call them by bare name. If one shows up only as an `xd://` device, that phase's `pi.registerTool` call lost `loadMode: "essential"`: fix it there with a failing test first.
- `/extensions`: skills `teach` and `visualize` appear once each, from the plugin cache, and nothing is listed from `.pi/extensions` or `.pi/skills`.
- Type `/md-` and check autocomplete offers `/md-log` and `/md-unlog` once each.
- `/agents`: `researcher`, `mermaid-maker`, `svg-maker` appear once each.

Decision rule: all as listed → pass. Any duplicate, or anything from `../.pi` / `../.omp/agents`, means the open-question-1 mitigation recorded in the design doc is not in effect: confirm `git ls-files .omp/agents/.gitkeep` prints the path, then apply the fallback recorded with that answer (a committed `learning-plugins/.omp/config.yml` with `extensions: []` and `skills: { customDirectories: [] }`), commit it as `chore: shadow parent omp config`, and repeat this step.

**Step 5: Observe the parent directory (report only)**

User-scope installs are visible in every directory, including `/home/marcus/tmp/learn`, whose `.omp/config.yml` still loads the original `.pi` extensions and skills.

```bash
cd /home/marcus/tmp/learn && omp
```
`/tools`, then `/exit`. Record what you see: whether `quiz` appears once or twice, and any "conflicts with existing tool" error. Do **not** edit `../.omp/config.yml` or anything else there. If there is a conflict, tell the user in the phase's final report: the fix is theirs to choose (drop the ported entries from `../.omp/config.yml`, or disable the plugins while working in the parent). Record the observation for Task 6.

---

### Task 5: Release to GitHub and run acceptance tests 2-4 from the GitHub install

**Files:** none planned. CI fixes, if any, get their own commits.

**Step 1: Pre-flight (master acceptance test 1, locally)**

```bash
git status --porcelain
npm ci && npm run typecheck && npm test && npm run check && npm run validate && npm run test:claude
git status --porcelain
```
Expected: both status commands print nothing; the chain exits 0. In particular, `npm ci` verifies the committed lock has the new `teach` workspace.

**Step 2: GitHub access**

```bash
gh auth status
gh repo view MarcusXavierr/learning-plugins --json visibility --jq .visibility
gh api repos/MarcusXavierr/learning-plugins --jq .permissions.push
git remote get-url origin
```
Expected: `PUBLIC`, `true`, `https://github.com/MarcusXavierr/learning-plugins.git`.

Decision rules:
- `.permissions.push` is `false` (the state when this plan was written: `GITHUB_TOKEN` authenticates `marcusxavier-scrumlaunch`): **stop and ask the user** to authenticate as `MarcusXavierr` in this shell. The commands for them to run (interactive, browser): `unset GITHUB_TOKEN`, `gh auth login --hostname github.com --git-protocol https --web`, `gh auth setup-git`. Re-run the four checks above in the same shell afterwards; `GITHUB_TOKEN` must stay unset for every later step, because `gh` and its git credential helper prefer it over the stored login.
- Visibility `PRIVATE`: `gh repo edit MarcusXavierr/learning-plugins --visibility public --accept-visibility-change-consequences`.
- `gh repo view` reports the repository doesn't exist: `gh repo create MarcusXavierr/learning-plugins --public --source . --push`, then skip Step 3.

**Step 3: Push**

```bash
git push -u origin main
```
Expected: `branch 'main' set up to track 'origin/main'`.

**Step 4: CI green**

```bash
release_sha="$(git rev-parse HEAD)"
gh run list --workflow ci.yml --branch main --limit 20 --json databaseId,headSha,status | jq -r --arg sha "$release_sha" '.[] | select(.headSha == $sha) | .databaseId'
```
Repeat the list command until it prints a run ID for `release_sha` (a just-pushed workflow may still be queued). Capture that ID and watch exactly it:

```bash
run_id="$(gh run list --workflow ci.yml --branch main --limit 20 --json databaseId,headSha | jq -r --arg sha "$release_sha" '[.[] | select(.headSha == $sha) | .databaseId] | first // empty')"
test -n "$run_id" && gh run watch "$run_id" --exit-status
```
Expected: exit 0, every job `✓`, and the watched run's `headSha` is `release_sha`.

On failure: `gh run view "$run_id" --log-failed`. Reproduce the failing step locally with the exact command CI ran. A logic failure gets a failing test first; an environment-only failure (CI install of `claude`, Node setup, missing env) is fixed in `.github/workflows/ci.yml`. Commit as `fix(ci): <what>` (or `fix(<plugin>): <what>`), `git push`, and repeat this step with the new SHA. Do not tag yet: the GitHub-installed acceptance tests and design closure are still pending.

**Step 5: Switch Claude Code to the GitHub marketplace**
Both marketplaces would be named `learning-plugins`, so the local one goes first. Removing a marketplace uninstalls its plugins.

```bash
claude plugin marketplace remove learning-plugins
claude plugin marketplace add MarcusXavierr/learning-plugins
claude plugin install teach@learning-plugins
claude plugin install visual-tools@learning-plugins
claude plugin marketplace list --json | jq -c '.[] | select(.name=="learning-plugins")'
claude plugin list --json | jq -c 'sort_by(.id)[] | select(.id|endswith("@learning-plugins")) | {id, enabled, readFromFolder, installPath}'
```
Expected: `Successfully removed marketplace: learning-plugins` followed by `Also uninstalled 4 plugins from this marketplace:`; `Successfully added marketplace: learning-plugins (declared in user settings)`; the teach line ends `(+ 2 dependencies: …)`; the marketplace entry's source names `MarcusXavierr/learning-plugins`; four plugins enabled, `readFromFolder` null and `installPath` outside `/home/marcus/tmp/learn` (a GitHub install, not the checkout).

**Step 6: Switch omp to the GitHub marketplace (the README's lines)**

omp's marketplace removal keeps installed plugins, so uninstall first:

```bash
omp plugin uninstall teach@learning-plugins quiz@learning-plugins md-log@learning-plugins visual-tools@learning-plugins
omp plugin marketplace remove learning-plugins
omp plugin marketplace add MarcusXavierr/learning-plugins
omp plugin marketplace list
omp plugin install teach@learning-plugins quiz@learning-plugins md-log@learning-plugins
omp plugin install visual-tools@learning-plugins
```
Expected: four `Uninstalled …@learning-plugins`; `Removed marketplace: learning-plugins`; `Added marketplace: MarcusXavierr/learning-plugins` (`owner/repo` is omp's GitHub shorthand, `omp://marketplace.md` "Marketplace sources"); the list shows `learning-plugins` with a GitHub source; four `Installed <p> from learning-plugins (0.1.0)`.

**Step 7: Master acceptance test 2, fresh session in each harness**

Scratch directory with no `.omp` or `.claude` above it: `mkdir -p /tmp/lp-release && cd /tmp/lp-release`.

omp, `omp` (new session):
1. `/tools` lists `quiz` as a top-level tool (not only as an `xd://` device).
2. `/md-` autocompletes `/md-log` and `/md-unlog`.
3. `/extensions` lists the skill `teach`.
4. Prompt: `Use the task tool to run the researcher agent with this task: 'In what year was RFC 793 (Transmission Control Protocol) published? Give the year and one source URL.' Then reply with only the year.` → a task card for agent `researcher` runs `web_search`; the reply is `1981`.
5. Prompt: `Teach me why the sky is blue.` → the `teach` skill loads and its first move is a `quiz` call (the quiz TUI opens). Press Esc to cancel; `/exit`.

Claude Code, `claude` (new session):
1. `/md-` autocompletes `/md-log` and `/md-unlog`.
2. `/agents` lists `teach:researcher`.
3. Prompt: `Use the Agent tool with subagent_type teach:researcher and this prompt: 'In what year was RFC 793 (Transmission Control Protocol) published? Give the year and one source URL.' Then reply with only the year.` → the subagent uses `WebSearch`; the reply is `1981`.
4. Prompt: `Teach me why the sky is blue.` → the `teach:teach` skill loads and its first move is an `mcp__quiz__quiz` call (native dialog with header `Quiz`). Press Esc; `/exit`.

Pass: every check above in both harnesses.

**Step 8: Master acceptance test 3 from the GitHub install**

```bash
cd /tmp/lp-release && : > notes-omp.md && : > notes-claude.md
```
In a new `omp` session, then again in a new `claude` session (using `notes-claude.md`):
1. `/md-log /tmp/lp-release/notes-omp.md`
2. Prompt (Phase 3's single-select smoke, verbatim): `Call the quiz tool exactly once with these arguments and nothing else: question "Which planet is closest to the Sun?", options [{label:"Mercury",value:"mercury"},{label:"Venus",value:"venus"},{label:"Mars",value:"mars"}], correctAnswer "mercury", explanation "Mercury orbits at about 0.39 AU, closer than any other planet."`
3. Answer `Mercury`; wait for the reply.
4. `/md-unlog`, `/exit`.

Then compare the actual quiz callouts, not a search for the question text (which also occurs in the `YOU` prompt). The question and graded answer are separate callouts with a blank line between them. Run this throwaway check from the repo root:

```bash
python3 - <<'PY'
from pathlib import Path
import re

blocks = []
for harness in ("omp", "claude"):
    note = Path(f"/tmp/lp-release/notes-{harness}.md").read_text()
    assert re.search(r"(?m)^> \[!quote\] YOU\n\nCall the quiz tool exactly once", note), f"{harness}: missing user prompt"
    assert 'question "Which planet is closest to the Sun?"' in note, f"{harness}: wrong prompt"
    assert re.search(r"(?m)^> \[!abstract\] AGENT\n\n\S", note), f"{harness}: missing assistant prose"
    question = re.findall(r"(?m)^> \[!question\] Quiz\n(?:>.*\n)*", note)
    answer = re.findall(r"(?m)^> \[!success\] Quiz — correct ✓\n(?:>.*\n)*", note)
    assert len(question) == len(answer) == 1, f"{harness}: expected one question and one graded answer"
    assert "> Which planet is closest to the Sun?\n" in question[0], f"{harness}: wrong quiz question"
    options = re.findall(r"(?m)^> [1-3]\. (Mercury|Venus|Mars)$", question[0])
    assert len(options) == 3 and set(options) == {"Mercury", "Venus", "Mars"}, f"{harness}: missing or duplicate options"
    assert re.search(r"(?m)^> Your answer: [1-3]\. Mercury$", answer[0]), f"{harness}: answer not graded as Mercury"
    assert re.search(r"(?m)^> Correct answer: [1-3]\. Mercury$", answer[0]), f"{harness}: wrong correct answer"
    blocks.append((question[0], answer[0]))
assert blocks[0] == blocks[1], "quiz question/options or graded answer differ between harnesses"
print("question, displayed option order and graded answer identical")
PY
```
Expected: `question, displayed option order and graded answer identical`. Each note also has the `YOU` prompt and an `AGENT` prose block. This comparison covers both actual quiz callouts; assistant prose can differ between models. Byte-identity for equal normalized entries is independently guarded by the md-log golden suite, which CI ran in Step 4.

**Step 9: Master acceptance test 4 from the GitHub install**

Empty renderer cache, then a maker agent in omp:

```bash
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/learning-plugins/visual-tools"
cd /tmp/lp-release && omp
```
Prompt: `Use the task tool to run the mermaid-maker agent with this brief: 'A left-to-right flowchart with three nodes: Source, Build, Dist.' Report the published file name.`
Expected: the first `render_mermaid` installs the renderer (compare timing with Phase 4's measured answer to open question 5, not a fixed threshold); `ls "${XDG_CACHE_HOME:-$HOME/.cache}/learning-plugins/visual-tools/"` shows one 16-hex-digit directory; expanding the maker's tool result shows the PNG; `ls /tmp/lp-release/viz/` shows one `viz-*.png`, the name the agent reported.

Empty the cache again, then Claude Code:

```bash
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/learning-plugins/visual-tools"
cd /tmp/lp-release && claude
```
Prompt: `Use the Agent tool with subagent_type visual-tools:mermaid-maker and this prompt: 'A left-to-right flowchart with three nodes: Source, Build, Dist.' Report the published file name.`
Expected: same install pause and cache directory; in the transcript (Ctrl+O) the `mcp__visual-tools__render_mermaid` result carries the image and the agent describes it correctly; `ls /tmp/lp-release/viz/` now shows two `viz-*.png` with different names.

SVG path, both harnesses, cache warm: `Use the svg-maker agent to draw a red circle on a white square. Report the published file name.` (in CC: `Use the Agent tool with subagent_type visual-tools:svg-maker and this prompt: 'A red circle on a white square.' Report the published file name.`) → a third and fourth PNG in `viz/`, no reinstall.

**Step 10: Leave dogfooding on the GitHub install**

No further change: sessions in `learning-plugins/` now use the GitHub install, the same thing users get. Unreleased work still goes through the dev loop in the README (`omp plugin link`, `claude --plugin-dir`). After a later push, refresh with `claude plugin marketplace update learning-plugins && claude plugin update teach@learning-plugins` (and each other plugin), and `omp plugin marketplace update learning-plugins && omp plugin install --force <p>@learning-plugins`.

`rm -rf /tmp/lp-release` when done.

---

### Task 6: Close the design doc

**Files:**
- Modify: `docs/plans/2026-10-10-learning-plugins-design.md`

**Step 1: Status line**

Replace line 4

```markdown
Status: approved in a grill session, then hardened by a staff-engineer review. Implementation not started.
```

with (use the date on which the final tag will be pushed; do not publish the tag until Step 5 passes):

```markdown
Status: implemented and released as v0.1.0 on <YYYY-MM-DD> (https://github.com/MarcusXavierr/learning-plugins). Approved in a grill session, then hardened by a staff-engineer review.
```

**Step 2: Close the open questions**

The table under `## Open questions` must end with every row answered. Phases 1-4 recorded their answers (Phase 1 in "Verified facts" → "Skeleton findings" and the table; Phases 2-4 in their own tasks). Make the table:

```markdown
| # | Question | Resolved in | Answer |
|---|---|---|---|
```

and fill `Answer` for rows 1-5 with one sentence each, copied from the recorded finding (keep any wording a phase already put in the row). If any row has no recorded finding anywhere in the doc or the phase commits (`git log --oneline --grep "open question"`), the release is not done: go back to that phase's open-question task, resolve it, then return here. Rename the section heading to `## Open questions (all resolved)`.

**Step 3: Record the release findings**

Append under the Phase 5 list added in Task 2:

```markdown
- Release, <YYYY-MM-DD>: from `MarcusXavierr/learning-plugins`, both harnesses installed the README's lines and passed master acceptance tests 2, 3 and 4 in fresh sessions.
- Parent directory `/home/marcus/tmp/learn` with user-scope installs: <the Task 4 Step 5 observation, one sentence>.
```

In `## Delivery order`, after the `**Dogfooding**` paragraph, add:

```markdown
Since the release, sessions in this repo use the marketplace install from GitHub; the link and `--plugin-dir` loop is for unreleased work.
```

**Step 4: Commit and push the closed design**

```bash
git diff -U0 docs/plans/2026-10-10-learning-plugins-design.md | grep '^+' | grep -P '[\x{2013}\x{2014}]'; echo "new-dashes: $?"
git add docs/plans/2026-10-10-learning-plugins-design.md
git commit -m "docs: mark design released and close open questions"
git push
```
Expected: `new-dashes: 1` (no dashes introduced in the new lines); push succeeds.

**Step 5: Verify the exact release commit, then tag**

The GitHub-installed master acceptance tests 2, 3 and 4 in Task 5 Steps 7-9 and the design closure above must have passed. CI must be green on the design-closure commit itself, not on an earlier successful push. In the same shell:

```bash
release_sha="$(git rev-parse HEAD)"
gh run list --workflow ci.yml --branch main --limit 20 --json databaseId,headSha,status | jq -r --arg sha "$release_sha" '.[] | select(.headSha == $sha) | .databaseId'
```
Repeat the list command until it prints a run ID for `release_sha`; do not use `.[0]` before the queued run appears. Then:

```bash
set -e
run_id="$(gh run list --workflow ci.yml --branch main --limit 20 --json databaseId,headSha | jq -r --arg sha "$release_sha" '[.[] | select(.headSha == $sha) | .databaseId] | first // empty')"
test -n "$run_id" && gh run watch "$run_id" --exit-status
test "$(git rev-parse origin/main)" = "$release_sha"
test -z "$(git status --porcelain)"
git tag -a v0.1.0 "$release_sha" -m "learning-plugins 0.1.0"
git push origin v0.1.0
```
Expected: the watched run exits 0 with every job `✓`, `origin/main` and the clean checkout still point to the verified design-closure SHA, and `v0.1.0` is pushed pointing at that SHA. On CI failure, inspect `gh run view "$run_id" --log-failed`, fix and push, then repeat this step using the new SHA; if a fix changes installed behavior, repeat Task 5 Steps 7-9 against the new GitHub tree before tagging. If CI is green but the SHA or checkout checks fail, resolve the divergence and rerun verification before tagging.
