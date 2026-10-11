const LAYERS =
  "[Ports and adapters. plugins/<p>/src/core/** is the hexagon: pure logic, no I/O, no Node built-ins, no npm or host imports; it imports only its own core and shared/. " +
  "Adapters (src/omp.ts|src/omp/** for Oh My Pi, src/claude.ts|src/claude/** for Claude Code, src/renderer/** for the Node renderer CLI) translate host events into core inputs, do I/O with host primitives, and translate core outputs back; they stay thin. " +
  "shared/** holds pure cross-plugin contracts. build/** is dev tooling. Plugins never import each other; they share through shared/.] " +
  "The fix is to move the code to the right layer or invert the dependency through core. Excluding paths from these rules is never the answer.";

const CORE = "^plugins/[^/]+/src/core/";
const CC = "^plugins/[^/]+/src/(claude\\.ts$|claude/)";
const OMP = "^plugins/[^/]+/src/(omp\\.ts$|omp/)";
const RENDERER = "^plugins/[^/]+/src/renderer/";
const TEST = "(^|/)test/|\\.test\\.ts$|^test-support/";
const NPM = ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled", "npm-no-pkg", "npm-unknown"];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    { name: "core-no-io", severity: "error", comment: "Core must not use Node built-ins (no I/O in core). " + LAYERS, from: { path: CORE }, to: { dependencyTypes: ["core"] } },
    { name: "core-no-packages", severity: "error", comment: "Core must not import npm or host packages. " + LAYERS, from: { path: CORE }, to: { dependencyTypes: NPM } },
    { name: "core-no-claude-code", severity: "error", comment: "Core must not import the Claude Code host module. " + LAYERS, from: { path: CORE }, to: { path: "^claude-code(/|$)" } },
    { name: "core-no-adapters", severity: "error", comment: "Core must not import adapters; adapters depend on core, never the reverse. " + LAYERS, from: { path: CORE }, to: { path: "^plugins/[^/]+/src/", pathNot: CORE } },
    { name: "src-layout", severity: "error", comment: "Every file under plugins/<p>/src/ belongs to core/, an adapter (omp, claude) or renderer/. Move it. " + LAYERS, from: { path: "^plugins/[^/]+/src/", pathNot: "^plugins/[^/]+/src/(core/|omp\\.ts$|omp/|claude\\.ts$|claude/|renderer/)" }, to: {} },
    { name: "claude-adapter-no-node", severity: "error", comment: "The Claude Code mod runtime has no Node APIs; every side effect goes through $. " + LAYERS, from: { path: CC }, to: { dependencyTypes: ["core"] } },
    { name: "claude-adapter-no-omp", severity: "error", comment: "The Claude Code adapter must not import Oh My Pi code. " + LAYERS, from: { path: CC }, to: { path: ["node_modules/@oh-my-pi/", OMP] } },
    { name: "omp-adapter-no-claude", severity: "error", comment: "The Oh My Pi adapter must not import Claude Code code. " + LAYERS, from: { path: OMP }, to: { path: ["^claude-code(/|$)", CC] } },
    { name: "renderer-no-hosts", severity: "error", comment: "The renderer CLI runs outside both hosts. " + LAYERS, from: { path: RENDERER }, to: { path: ["^claude-code(/|$)", "node_modules/@oh-my-pi/", CC, OMP] } },
    { name: "no-cross-plugin", severity: "error", comment: "Plugins ship in isolation; share code through shared/. " + LAYERS, from: { path: "^plugins/([^/]+)/" }, to: { path: "^plugins/", pathNot: "^plugins/$1/" } },
    { name: "shared-pure", severity: "error", comment: "shared/ holds pure contracts: no Node built-ins, packages, hosts, plugins or build code. " + LAYERS, from: { path: "^shared/", pathNot: "\\.test\\.ts$" }, to: { dependencyTypes: ["core", ...NPM] } },
    { name: "shared-no-upward", severity: "error", comment: "shared/ must not import plugins, build or test support. " + LAYERS, from: { path: "^shared/", pathNot: "\\.test\\.ts$" }, to: { path: ["^plugins/", "^build/", "^test-support/", "^claude-code(/|$)"] } },
    { name: "no-build-imports", severity: "error", comment: "build/ is dev tooling; plugins and shared never import it. " + LAYERS, from: { path: "^(plugins|shared)/" }, to: { path: "^build/" } },
    { name: "test-support-only-in-tests", severity: "error", comment: "test-support/ is for tests only. " + LAYERS, from: { pathNot: TEST }, to: { path: "^test-support/" } },
    { name: "no-circular", severity: "error", comment: "Circular dependencies make modules inseparable. " + LAYERS, from: {}, to: { circular: true } },
    { name: "not-to-unresolvable", severity: "error", comment: "This import resolves to nothing (typo or hallucinated module).", from: {}, to: { couldNotResolve: true, pathNot: "^claude-code(/|$)" } },
    {
      name: "no-orphans", severity: "error", comment: "Nothing imports this module: delete it or wire it in.",
      from: { orphan: true, pathNot: ["\\.d\\.ts$", "\\.test\\.ts$", "^build/cli\\.ts$", "^plugins/[^/]+/src/(omp|claude)\\.ts$", "^plugins/[^/]+/src/renderer/cli\\.ts$", "^test-support/"] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^(dist|\\.test-build|coverage|reports|\\.stryker-tmp|types/claude-code|build/test/fixtures)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["types", "import", "require", "node", "default"], extensions: [".ts", ".js", ".json"] },
  },
};
