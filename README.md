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

A link only picks up a plugin that ships an omp extension. `teach` has none, so load it for a session with `--plugin-dir` instead:

```bash
omp --plugin-dir dist/omp/teach
```

In Claude Code, pass the plugin directories when you start a session, and run `/reload-plugins` after each build. `--plugin-dir` doesn't install dependencies, so `teach` needs its two alongside it, or pass the parent directory to load every plugin at once:

```bash
claude --plugin-dir dist/claude/teach --plugin-dir dist/claude/quiz --plugin-dir dist/claude/md-log
claude --plugin-dir dist/claude
```

The design behind all of this, including why there are two trees and what each harness can and can't do, is in [`docs/plans/2026-10-10-learning-plugins-design.md`](docs/plans/2026-10-10-learning-plugins-design.md).
