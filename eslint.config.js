import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import js from "@eslint/js";
import llmCore from "eslint-plugin-llm-core";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import local from "./.sensors/maintainability/eslint-rules/index.js";

// Thresholds are raised per file at the end of this config, never disabled inline.
const THRESHOLD_RULES = ["max-lines", "max-lines-per-function", "complexity", "max-depth", "llm-core/max-params", "local/max-exports"];

export default defineConfig([
  { ignores: ["**/*.js", "**/*.cjs", "**/*.mjs", "dist/", ".test-build/", "coverage/", "reports/", ".stryker-tmp/", "types/claude-code/", "build/test/fixtures/"] },
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },
  llmCore.configs.recommended,
  comments.recommended,
  {
    plugins: { local },
    rules: {
      // Size and complexity use core rules because they skip comments: documenting an interface is never penalised.
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true }],
      complexity: ["error", { max: 10 }],
      "max-depth": ["error", 3],
      "llm-core/max-file-length": "off",
      "llm-core/max-function-length": "off",
      "llm-core/max-complexity": "off",
      "llm-core/max-nesting-depth": "off",
      // Deep modules: narrow public interfaces.
      "llm-core/max-params": ["error", { max: 3, maxInternal: 4, maxConstructor: 5 }],
      "local/max-exports": ["error", { max: 7 }],
      // Typed rule is more precise than llm-core's heuristic; llm-core's executor rule teaches better than core's.
      "llm-core/no-floating-promise": "off",
      "no-async-promise-executor": "off",
      // Suppression policy: reasoned inline disables only; thresholds never inline.
      "llm-core/no-inline-disable": "off",
      "@eslint-community/eslint-comments/require-description": "error",
      "@eslint-community/eslint-comments/no-restricted-disable": ["error", ...THRESHOLD_RULES],
      "no-console": "error",
    },
  },
  { files: ["build/**/*.ts"], rules: { "no-console": "off" } },
  // The design fixes adapter entry file names.
  { files: ["plugins/*/src/omp.ts", "plugins/*/src/claude.ts"], rules: { "llm-core/filename-match-export": "off" } },
  // CC's `On` is a huge overload set; checking every hook callback against it makes this rule hang (>5 min per file).
  // `on()` accepts async handlers by contract, so the void-return check on arguments has nothing to catch here.
  {
    files: ["plugins/*/src/claude.ts", "plugins/*/src/claude/**/*.ts", "plugins/*/test/claude/**/*.ts"],
    rules: { "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }] },
  },
  // Tests and test doubles: verbose by nature, and fakes bypass host types on purpose.
  {
    files: ["**/*.test.ts", "test-support/**/*.ts"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      complexity: "off",
      "local/max-exports": "off",
      "llm-core/no-chained-type-assertions": "off",
      "llm-core/no-type-system-bypass": "off",
    },
  },
  // Quiz input parsing and resolving are cohesive validation boundaries with independent field checks.
  { files: ["plugins/quiz/src/core/prepare.ts"], rules: { complexity: ["error", { max: 21 }] } },
  // Per-file threshold exceptions go below, one block per file, each with a comment saying why.
  // Manifest shape/path validation is one cohesive trust-boundary operation.
  { files: ["build/plugin-source.ts"], rules: { complexity: ["error", { max: 23 }] } },
  // Prompt validation and expansion form one cohesive rendering algorithm.
  { files: ["build/prompts.ts"], rules: { complexity: ["error", { max: 37 }], "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true }] } },
  // The md-log entry model is the shared vocabulary both harness mappings (from-omp, from-claude) build entries from.
  { files: ["plugins/md-log/src/core/entries.ts"], rules: { "local/max-exports": ["error", { max: 8 }] } },
  // The scripted session's parts (prompt, prose, quiz, ask, both transcripts) are shared by the parity and adapter tests.
  { files: ["plugins/md-log/test/fixtures/session.ts"], rules: { "local/max-exports": ["error", { max: 11 }] } },
]);
