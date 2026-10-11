const messageOverrides = {
  "max-lines": {
    short: "File over 400 lines (blank lines and comments excluded)",
    long: `About max-lines: A long file is fine when it is one deep module: a small interface hiding a lot of cohesive implementation. Split only along a real seam, such as a cohesive internal helper module this file imports (and does not re-export), or a second responsibility that changes for different reasons. Never split into pass-through files or a barrel that re-exports everything; that makes modules shallower. If the file is cohesive and a split would only scatter it, raise the cap for this one file: add a block at the end of eslint.config.js with files: ["<path>"] and "max-lines": ["error", { max: <current count + about 10%>, skipBlankLines: true, skipComments: true }], with a comment above it saying why. Inline disables of this rule are forbidden.`,
  },
  "max-lines-per-function": {
    short: "Function over 60 lines",
    long: `About max-lines-per-function: Extract a helper only when it gets a meaningful name and hides a decision. Do not chop a function into steps that each need the others' context, do not create pass-through functions, and do not thread long parameter chains through them. For a switch over a closed set of cases, prefer a lookup table or one function per case. If the function is one coherent algorithm, raise the cap for this one file at the end of eslint.config.js (same pattern as max-lines) with a comment saying why. Inline disables of this rule are forbidden.`,
  },
  "complexity": {
    long: `About complexity / max-depth: Simplify the design first. Use guard clauses, define errors out of existence (make the operation succeed for edge inputs instead of branching on them), and push special cases into data. Raising the cap is the rare exception: a per-file block at the end of eslint.config.js with a comment saying why. Inline disables are forbidden.`,
  },
  "max-depth": {
    long: `About complexity / max-depth: Simplify the design first. Use guard clauses, define errors out of existence (make the operation succeed for edge inputs instead of branching on them), and push special cases into data. Raising the cap is the rare exception: a per-file block at the end of eslint.config.js with a comment saying why. Inline disables are forbidden.`,
  },
  "llm-core/max-params": {
    long: `About max-params: Exported functions are the module's interface and take at most 3 parameters; internal functions take 4 and constructors 5. Many parameters usually mean the caller knows too much. Group values that travel together into one named type (a domain type or an options type), or move the work behind the interface so callers pass less. Do not just wrap the same parameters in an anonymous object. Inline disables are forbidden; a per-file cap in eslint.config.js with a comment is the rare exception.`,
  },
  "local/max-exports": {
    long: `About local/max-exports: We want deep modules, with few, powerful entry points hiding the implementation. Before anything else: (1) un-export helpers that are exported only for tests, and test through the public interface; (2) hide helpers that only one caller uses; (3) merge functions that callers always call together into one operation; (4) if the module really holds two concepts, split it along that seam. Type-only exports do not count. If the interface really is this wide (for example a pinned contract in docs/plans), raise the cap for this one file at the end of eslint.config.js with a comment naming the contract. Inline disables are forbidden.`,
  },
  "no-console": {
    short: "No console in core/shared/adapters",
    long: `About no-console: core/ and shared/ never log. Return data or throw, and let the adapter report. Adapters report through the host: ctx.ui.notify in Oh My Pi, $.ui.toast in Claude Code. build/ is a CLI and may print.`,
  },
  "@typescript-eslint/no-explicit-any": {
    long: `About no-explicit-any: At trust boundaries (JSON, tool arguments, host payloads) use unknown plus a type guard. Elsewhere use the real type. If any is truly the right call, suppress with // eslint-disable-next-line @typescript-eslint/no-explicit-any -- <reason>.`,
  },
  "@typescript-eslint/no-unused-vars": {
    long: `About no-unused-vars: Remove it, but first ask why it is there: a leftover, or a sign that a call site or a branch is missing.`,
  },
  "llm-core/no-unknown-parameters": {
    long: `About no-unknown-parameters: unknown parameters are right at trust boundaries: type guards and parsers over untrusted input (JSON, tool arguments, host payloads). There, suppress with // eslint-disable-next-line llm-core/no-unknown-parameters -- type guard over <source>. Elsewhere give the parameter its real type.`,
  },
  "@eslint-community/eslint-comments/require-description": {
    long: `About require-description: Every inline disable needs a reason after --, e.g. // eslint-disable-next-line <rule> -- <why this case is an exception>. Reviewers read these first.`,
  },
  "@eslint-community/eslint-comments/no-restricted-disable": {
    long: `About no-restricted-disable: Size, complexity and interface-width rules cannot be disabled inline. Refactor, or raise the cap for this one file in a block at the end of eslint.config.js, slightly above the current value, with a comment saying why.`,
  },
};

function processResults(results) {
  const files = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  const triggeredRules = new Set();

  for (const result of results) {
    if (result.messages.length === 0) continue;

    const messages = result.messages.map((msg) => {
      const override = messageOverrides[msg.ruleId];
      if (override) triggeredRules.add(msg.ruleId);
      if (msg.severity === 2) totalErrors++;
      else totalWarnings++;
      return { ...msg, shortText: override?.short ?? msg.message };
    });

    files.push({ filePath: result.filePath, messages });
  }

  return { files, totalErrors, totalWarnings, triggeredRules, messageOverrides };
}

module.exports = { processResults, messageOverrides };
