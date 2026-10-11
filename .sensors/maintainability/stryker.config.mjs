/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  mutate: [
    "build/**/*.ts", "shared/**/*.ts", "plugins/*/src/**/*.ts",
    "!**/*.test.ts", "!build/test/**", "!build/cli.ts", "!plugins/*/src/claude.ts", "!plugins/*/src/claude/**",
  ],
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  incremental: true,
  incrementalFile: "reports/mutation/stryker-incremental.json",
  tempDirName: ".stryker-tmp",
  // The live sensor sidecar socket cannot be copied into a mutation sandbox.
  ignorePatterns: [".sensors/*.sock"],
  thresholds: { high: 80, low: 60, break: null },
};
