# Agent guide: learning-plugins

Plans live in `docs/plans/`; the design is `docs/plans/2026-10-10-learning-plugins-design.md`.

## Departures from docs/plans (these override the plan files)

- **Phase 1 Task 1 is already done.** The commit `chore: set up npm workspace, TypeScript 6 toolchain and coding sensors` created `.gitignore`, `package.json`, `package-lock.json`, `tsconfig.json` and `vitest.config.ts`. Do not rewrite them from the plan's code blocks. Start Phase 1 at Task 2. Later tasks that edit these files edit the existing content.
- **TypeScript is 6.0.3, not 7.0.2.** 7.x has no JS API, which typescript-eslint and dependency-cruiser need. Wherever a plan says `typescript@7.0.2` or "TypeScript 7", read 6.0.3. Keep the version pinned until typescript-eslint supports 7.
- **Every verification chain also runs lint and structure.** Wherever a plan runs `npm run typecheck && npm test …`, run `npm run typecheck && npm run lint && npm run structure && npm test …`. When Phase 1 Task 16 writes `.github/workflows/ci.yml`, it adds `- run: npm run lint` and `- run: npm run structure` right after `- run: npm run typecheck`, so its step-count check expects 12 lines, not 10.
- **Plan code blocks are not exempt from the sensors.** Adapt them until the sensors pass, or use the escape hatches below. If knip reports an export pinned in a plan's Shared contracts, keep the export and mark it `/** @public */`. If that export trips `local/max-exports`, raise the cap for that file in `eslint.config.js`, with a comment naming the contract.

## Sensors

Maintainability sensors run next to you (`sensors` CLI; config `.sensors/learning-plugins.sensors.yaml`).

- At session start run `sensors status .`; if it exits 1, run `sensors start .`.
- After each change set, and always before you commit or say you are done, run `sensors check .` and fix every failure it lists, including ones you did not introduce, unless the fix is risky or large (then tell the user). The guidance under each finding is project policy.
- While the sidecar runs, use `sensors check .` (or `sensors check . --runner <name>`) instead of running eslint, tsc or vitest yourself. Results can lag an edit by up to a minute: trust a runner only once its `[ran …]` time postdates your edit.
- If the sidecar is not running and cannot start, run `npm run typecheck && npm run lint && npm run structure && npm test`.
- Mutation testing is manual and slow: run `npm run test:mutation` after finishing the tests for a core module, or when asked. `sensors check .` then lists surviving mutants in changed files (`mut_state`); kill them with sharper assertions through the public interface.
- `.githooks/pre-commit` blocks commits that fail typecheck, lint or structure. Never bypass it with `--no-verify`.

## Escape hatches (reviewers start here)

- Size, complexity and interface rules (`max-lines`, `max-lines-per-function`, `complexity`, `max-depth`, `llm-core/max-params`, `local/max-exports`) cannot be disabled inline. If a refactor would make the design worse, raise the cap for that one file in a block at the end of `eslint.config.js`, slightly above the current value, with a comment saying why.
- Any other lint rule may be suppressed inline only with a reason: `// eslint-disable-next-line <rule> -- <why>`.
- Layering rules (`npm run structure`) are never suppressed: move the code or invert the dependency.
- An export that a pinned contract in `docs/plans` requires stays exported and is marked `/** @public */` for knip.

## Architecture the sensors enforce

Ports and adapters, built from deep modules:

- `plugins/<p>/src/core/**`: pure logic. No I/O, no Node built-ins, no npm or host imports; it imports only its own core and `shared/`.
- Adapters: `src/omp.ts` (+ `src/omp/**`) for Oh My Pi; `src/claude.ts` (+ `src/claude/**`) for Claude Code, with no Node APIs at all; `src/renderer/**` for the visual-tools Node CLI. Adapters stay thin: translate events in, do I/O with host primitives, translate results out.
- `shared/**`: pure cross-plugin contracts. `build/**`: dev tooling, never imported by plugins or shared. Plugins never import each other.
- Deep modules: few exported entry points hiding substantial implementation. Don't export helpers to test them; test through the interface. Don't split cohesive code into pass-through layers to satisfy a size limit.
