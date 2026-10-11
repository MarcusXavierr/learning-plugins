import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["build/**/*.test.ts", "shared/**/*.test.ts", "test-support/**/*.test.ts", "plugins/*/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "plugins/*/test/claude/**", "build/test/fixtures/**", "dist/**", ".test-build/**"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json"],
      include: ["build/**/*.ts", "shared/**/*.ts", "plugins/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "build/test/**", "plugins/*/src/claude.ts", "plugins/*/src/claude/**"],
    },
  },
});
