# Phase 3: quiz

Port `.pi/extensions/quiz.ts` to a `quiz` plugin that works in both harnesses: pure core (input validation, grading, model text, feedback marks, the omp dialog reducer), an omp tool that draws the same TUI as today on that reducer, and a CC tool that asks through the native `$.ui.ask` dialog. Both adapters deliver `QuizResultDetails` per the quiz contract (omp: `details`; CC: a `<quiz-result>` block), with options in exactly `displayOrder(input)` order so md-log can log the question live. Resolves design open question 2 (yes: the result is available to CC render hooks) and adds the optional ✓/✗ transcript rendering in CC.

**Prerequisites:** Phase 1 done (workspace, `npm run build|check|validate|test:claude`, `test-support/fake-omp.ts`, `shared/tool-map.ts` with `quiz` and `ask`). Phase 2's `shared/quiz-contract.ts` committed exactly as the master plan's contract (Tasks 1–10 need only the contract; Task 11's md-log re-check needs all of Phase 2). Every shell: `source ~/.nvm/nvm.sh && nvm use 24.15.0`, working directory `/home/marcus/tmp/learn/learning-plugins`.

**Acceptance tests (phase done when all hold):**

1. **Given** a quiz call with options and `correctAnswer` given by option value, **when** the user answers in either harness, **then** the user sees ✓/✗ feedback with the correct answer and the explanation, the model receives the graded text, and the result carries `QuizResultDetails` (omp `details`; CC `<quiz-result>` block) whose `options` are in exactly `displayOrder(input)` order.
2. **Given** a multi-select quiz, **when** the user submits a subset, a superset, or the exact set of correct options, **then** only the exact set is graded correct; "I don't know" (and, in CC, words typed under "Other") is reported as `dontKnow` — never as a wrong answer — with any note kept.
3. **Given** bad input (a `correctAnswer` matching no value, duplicate values, fewer than two options, several answers on a single-select quiz; in CC also more than 3 options, a comma in a multi-select label, duplicate or reserved labels), **when** the tool runs, **then** it returns a model-readable error and no dialog opens.
4. **Given** the user dismisses the dialog, the turn is aborted, or the session has no interactive UI, **when** the quiz runs, **then** the result status is `cancelled` or `unavailable` and nothing hangs.
5. **Given** md-log linked in both harnesses, **when** the same quiz is answered the same way in each, **then** the two notes' quiz question and answer blocks are byte-identical.

---

## Decisions and verified facts (read before Task 1)

Verified while writing this phase (throwaway prototype of this exact code: `tsc` 7.0.2 against `@oh-my-pi/pi-coding-agent@18.2.10` + `@oh-my-pi/pi-tui@18.2.10` types and CC mod types; Vitest 5.0.3: 61 tests green; `claude plugin test` 2.1.296: 10 kit tests green; `claude plugin validate --strict`: passed; `omp -p` 18.2.10 loaded the bundled extension):

- **CC dialog (`$.ui.ask`)**, cc.d.ts:2113-2128, `AskOptions` cc.d.ts:466-480. In the test kit the dialog arrives as a `tool.call` of `AskUserQuestion` with `e.questions = [{ question, header, options: [{ label, description: "" }], multiSelect }]`; a stub answering `{ result: { answers: { [question]: "<label>" } } }` makes `$.ui.ask` resolve to that string; a stub answering `{ deny }` makes it reject (`quiz: $.ui.ask: no answer (dismissed)`). Options are labels only, so option `description`s are not shown in CC.
- **`isInteractive`** is on `session.start`'s input (`SessionStartInput`, cc.d.ts:9181-9196). `session.start` runs before the first prompt and again after a reload (reference.md:116), so a module-level flag set there is current.
- **CC error result** `{ result, isError: true }` is a member of the hook-return union `ToolCallResult` (cc.d.ts:9822-9903); the kit passes it through verbatim. Whether the model then sees `is_error: true` is **[UNVERIFIED]** (CC session limit hit while checking) — Task 11 step 6 checks it. Phase 4 uses the same shape and the same check.
- **`.catch`**: `validate --strict` reports `gating hook with .catch: tool.call{tool=mcp__quiz__quiz}`; the handler gets `next.error` (`HookFailure`, cc.d.ts:4264-4276; `CatchHandler` cc.d.ts:875-904).
- **`isDeferred: false`** on `$.tool.register`: the CC 2.1.296 runtime accepts it (its own message: `tool.register takes { name, description, inputSchema?, isDeferred? }`; docs api.md "Add a tool" tip, v2.1.293+). The public 2.1.277 `ToolSpec` (cc.d.ts:10158-10174) lacks it; the vendored 2.1.296 types are **[UNVERIFIED]** — Task 9 step 5 has the decision rule.
- **Open question 2 — resolved: yes.** The `ToolUse` render site's props carry `output` ("the stored result once the call has resolved", cc.d.ts:7974-7982), and the result block under a standalone row is its own `ToolResult` site with `tool`, `output`, `isErrored` (cc.d.ts:7993-8036; reference.md:214 "The tool's name, input, and result"). Task 10 (optional) draws ✓/✗ at `ToolResult`; the kit verifies the hook receives `e.props.output` and its `Text` elements are findable.
- **omp tool parameters are a plain JSON Schema** — `TSchema = Type | TJsonSchema`, `TJsonSchema = Record<string, unknown>` (pi-ai dist/types/types.d.ts:1089-1100); validation treats any non-ArkType schema as JSON Schema (pi-ai src/utils/validation.ts:1728-1733). No TypeBox. Verified: `omp -p --no-extensions -e <bundle> --tools quiz` → the model called `quiz`; `tool_execution_end.result.details` = `{status: "unavailable", …}`.
- **`loadMode: "essential"`**: extension tools default to `"discoverable"` (xd:// devices; pi-coding-agent dist/types/extensibility/extensions/types.d.ts:434, pi-agent-core types.d.ts:831-839). Prompts call `quiz` by name, so it is essential.
- **omp ignores `promptSnippet`/`promptGuidelines` on extension tools** (`ToolDefinition`, types.d.ts:420-465, has neither; `promptGuidelines` exists only on `ToolInfo`, :485-491). The original guidelines (quiz.ts:925-943) move into the description, which is per harness (names `ask` / `AskUserQuestion` via the tool map).
- **Editor-theme compat (quiz.ts:198-226)**: the constructor-arity hack is gone — omp 18.2.10's `Editor` takes one `EditorTheme` (pi-tui dist/types/components/editor.d.ts:108). The theme part is still needed: `EditorTheme.symbols` and `selectList` are required (editor.d.ts:8-21), so the theme starts from the host's `getEditorTheme()`, now a typed import from `@oh-my-pi/pi-tui` (theme/tui-adapters.d.ts:29) instead of the untyped `host.getEditorTheme` probe.
- **`ctx.ui.custom`** signature: types.d.ts:151; `options.signal` aborts it (types.d.ts:114-115). **RPC mode** reports `hasUI` yet its `custom()` resolves `undefined` at once (pi-coding-agent src/modes/rpc/rpc-mode.ts:995-998), so the tool also requires `ctx.mode === "tui"` (`ExtensionMode`, types.d.ts:264).
- **pi-tui is Bun-only at runtime** (`Bun.stringWidth` in src/utils.ts:357, native addons), so Vitest must never load it. Only `src/omp.ts` imports it at runtime; `src/tui.ts` receives pi-tui's `truncateToWidth`/`wrapTextWithAnsi` (utils.d.ts:29-30) as a `TextKit`, and `src/omp-tool.ts` receives the dialog as a `QuizUi` port. `src/omp.ts` is covered by the omp smoke (Tasks 7, 11).
- **Keys**: `Key`, `matchesKey` (keys.d.ts:69-160, 200); typed text is detected with `extractPrintableText` (keys.d.ts:171-176), which also decodes Kitty CSI-u, replacing the original `isTypedText`.
- **No `onUpdate` order emission**: the contract's deterministic shuffle replaces it (design, quiz contract rule 1).
- **Deliberate changes from the original**: several `correctAnswer`s on a single-select quiz is a hard error (it could never be graded correct); bad input returns `isError: true` and no `details` (md-log logs such a result as "unavailable" with its text — agreed with Phase 2); RPC mode is unavailable.
- **Result shapes**. omp: `{ content: [{ type: "text", text: quizResultText(d) }], details: d }` — no `<quiz-result>` block in omp content. CC: `{ result: quizResultText(d) + "\n\n" + encodeQuizResult(d) }` (one string). In CC multi-select, "I don't know" among the chosen labels wins; any answer that is not exactly the offered labels was typed under "Other" and becomes `dontKnow` with the whole answer as the note (design line 199).

## File map

| Path | Role |
|---|---|
| `plugins/quiz/package.json` | workspace + manifest |
| `plugins/quiz/src/core/prepare.ts` | parse, validate, display order, correct indices, CC limits |
| `plugins/quiz/src/core/grade.ts` | grading, model text, feedback marks, transcript lines |
| `plugins/quiz/src/core/reducer.ts` | omp dialog reducer |
| `plugins/quiz/src/core/schema.ts` | per-harness description + JSON Schema |
| `plugins/quiz/src/core/dialog.ts` | CC dialog question/labels and answer mapping |
| `plugins/quiz/src/core/output.ts` | (optional Task 10) quiz result from a stored CC tool result |
| `plugins/quiz/src/tui.ts` | omp dialog render, pure |
| `plugins/quiz/src/omp-tool.ts` | omp tool: validation, mutex, results, transcript rendering |
| `plugins/quiz/src/omp.ts` | omp entry: pi-tui dialog glue |
| `plugins/quiz/src/claude.ts` | CC entry |
| `plugins/quiz/test/*.test.ts` | Vitest |
| `plugins/quiz/test/claude/quiz.test.ts` | CC kit |

Commit rule (every task): `npm run build` first when `plugins/` changed, then `npm run check` must exit 0, then commit including `dist/`, `.claude-plugin/`, `.omp-plugin/`.

---

### Task 1: Scaffold the quiz workspace and validate quiz input

**Files:**
- Create: `plugins/quiz/package.json`
- Modify: `package.json`, `package-lock.json` (root: workspace + `@oh-my-pi/pi-tui` devDependency)
- Create: `plugins/quiz/src/core/prepare.ts`
- Test: `plugins/quiz/test/prepare.test.ts`

**Step 1: Create the workspace**

**Create `plugins/quiz/package.json`:**

```json
{
  "name": "@learning-plugins/quiz",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Graded multiple-choice quiz tool: shuffled options, I don't know, a free-text note, and ✓/✗ feedback with an explanation."
}
```

Run: `npm install && npm install -D -E @oh-my-pi/pi-tui@18.2.10`
Then: `npm ls @oh-my-pi/pi-tui`
Expected: a single version, `18.2.10` (the copy `@oh-my-pi/pi-coding-agent@18.2.10` already pulls in, now also a direct dev dependency so the omp adapter's type imports do not lean on hoisting). If two versions appear, stop: the pin must equal pi-coding-agent's.

**Step 2: Write the failing test**

**Create `plugins/quiz/test/prepare.test.ts`:**

```ts
import { describe, expect, test } from "vitest";
import { displayOrder } from "../../../shared/quiz-contract.ts";
import { CLAUDE_LIMITS, prepareQuiz } from "../src/core/prepare.ts";

const planets = {
  question: "Which planet is closest to the Sun?",
  options: [
    { label: "Mercury", value: "mercury" },
    { label: "Venus", value: "venus" },
    { label: "Mars", value: "mars" },
  ],
  correctAnswer: "mercury",
  explanation: "Mercury orbits at about 0.39 AU.",
};
const inOrder = { ...planets, shuffle: false };

describe("prepareQuiz", () => {
  test("resolves correctAnswer by option value to its 1-based display position", () => {
    expect(prepareQuiz({ ...inOrder, correctAnswer: "venus" }).correctIndices).toEqual([2]);
  });

  test("shows options in the quiz contract's display order, which md-log recomputes from the same input", () => {
    const quiz = prepareQuiz(planets);
    expect(quiz.options).toEqual(displayOrder(planets));
    expect(quiz.options[quiz.correctIndices[0]! - 1]?.value).toBe("mercury");
  });

  test("repairs a multi-select correctAnswer that arrives as a JSON-stringified array", () => {
    const quiz = prepareQuiz({ ...inOrder, multiSelect: true, correctAnswer: '["mercury", "mars"]' });
    expect(quiz.correctIndices).toEqual([1, 3]);
  });

  test("treats a bracketed correctAnswer that is not JSON as one literal value", () => {
    const options = [{ label: "Draft", value: "[draft]" }, { label: "Final", value: "final" }];
    expect(prepareQuiz({ ...inOrder, options, correctAnswer: "[draft]" }).correctIndices).toEqual([1]);
  });

  test("rejects a correctAnswer that matches no option value, naming the known values", () => {
    expect(() => prepareQuiz({ ...inOrder, correctAnswer: "Mercury" })).toThrow(
      'quiz correctAnswer "Mercury" does not match any option value ("mercury", "venus", "mars")',
    );
  });

  test("rejects duplicate option values", () => {
    const options = [{ label: "A", value: "x" }, { label: "B", value: "x" }];
    expect(() => prepareQuiz({ ...inOrder, options, correctAnswer: "x" })).toThrow('duplicate option value "x"');
  });

  test("rejects fewer than two options once empty labels are dropped", () => {
    const options = [{ label: "Mercury", value: "mercury" }, { label: "   " }];
    expect(() => prepareQuiz({ ...inOrder, options })).toThrow("quiz requires at least two options");
  });

  test("rejects several correct answers on a single-select quiz", () => {
    expect(() => prepareQuiz({ ...inOrder, correctAnswer: ["mercury", "venus"] })).toThrow(
      "Set multiSelect: true when several options are correct",
    );
  });

  test("rejects a quiz without an explanation", () => {
    expect(() => prepareQuiz({ ...inOrder, explanation: "  " })).toThrow("quiz explanation is required");
  });

  test("uses trimmed details as context and drops blank details, as md-log does", () => {
    expect(prepareQuiz({ ...inOrder, details: "  Think orbits.  " }).context).toBe("Think orbits.");
    expect(prepareQuiz({ ...inOrder, details: "   " }).context).toBeUndefined();
  });
});

describe("prepareQuiz with Claude Code's dialog limits", () => {
  test("accepts three options and rejects a fourth, which would not fit beside I don't know", () => {
    expect(prepareQuiz(inOrder, CLAUDE_LIMITS).options).toHaveLength(3);
    const four = { ...inOrder, options: [...inOrder.options, { label: "Earth", value: "earth" }] };
    expect(() => prepareQuiz(four, CLAUDE_LIMITS)).toThrow("quiz takes at most 3 options here");
  });

  test("rejects a comma in a multi-select label but allows it in single-select", () => {
    const options = [{ label: "Mercury, the first", value: "mercury" }, { label: "Venus", value: "venus" }];
    expect(prepareQuiz({ ...inOrder, options }, CLAUDE_LIMITS).options).toHaveLength(2);
    expect(() => prepareQuiz({ ...inOrder, options, multiSelect: true }, CLAUDE_LIMITS)).toThrow(
      'must not contain "," here',
    );
  });

  test("rejects labels the answer could not tell apart", () => {
    const twins = [{ label: "Venus", value: "a" }, { label: "Venus", value: "b" }];
    expect(() => prepareQuiz({ ...inOrder, options: twins, correctAnswer: "a" }, CLAUDE_LIMITS)).toThrow(
      '"Venus" appears twice',
    );
    const reserved = [{ label: "I don't know", value: "idk" }, { label: "Venus", value: "venus" }];
    expect(() => prepareQuiz({ ...inOrder, options: reserved, correctAnswer: "venus" }, CLAUDE_LIMITS)).toThrow(
      `"I don't know" is reserved`,
    );
  });
});
```

**Step 3: Run it to verify it fails**

Run: `npx vitest run plugins/quiz/test/prepare.test.ts`
Expected: FAIL — `Error: Cannot find module '../src/core/prepare.ts'`.

**Step 4: Implement**

**Create `plugins/quiz/src/core/prepare.ts`:**

```ts
import {
  displayOrder,
  type QuizInput,
  type QuizMode,
  type QuizOption,
  type RawQuizOption,
} from "../../../../shared/quiz-contract.ts";

/** The always-added choice that signals a genuine gap instead of a guess. Never a real option. */
export const DONT_KNOW_LABEL = "I don't know";

/** Bad tool input. The message is written for the model: it names the problem and the fix. */
export class QuizInputError extends Error {}

/** Extra rules for a host whose dialog returns the chosen option *labels* (Claude Code's `$.ui.ask`). */
export interface QuizLimits {
  /** Most real options the host's dialog can show next to "I don't know". */
  maxOptions?: number;
  /** Answers come back as labels: labels must be unique, never "I don't know", and comma-free in multi-select. */
  answersByLabel?: boolean;
}

/** `$.ui.ask` shows 2-4 options (cc.d.ts AskOptions.options); one row is "I don't know". */
export const CLAUDE_LIMITS: QuizLimits = { maxOptions: 3, answersByLabel: true };

/** A validated quiz, options already in the order the user will see them. */
export interface PreparedQuiz {
  /** As the model wrote it: it seeds the shuffle, and md-log recomputes the order from it. */
  question: string;
  /** `details`, trimmed; absent when blank. md-log uses the same rule. */
  context?: string;
  mode: QuizMode;
  /** `displayOrder(input)` from the quiz contract. */
  options: QuizOption[];
  /** 1-based positions in `options`, ascending. */
  correctIndices: number[];
  explanation: string;
}

function parseQuizInput(raw: unknown): QuizInput {
  if (typeof raw !== "object" || raw === null) throw new QuizInputError("quiz input must be an object");
  // Tool arguments arrive unvalidated in CC; each field is checked below before use.
  const { question, details, options, multiSelect, correctAnswer, explanation, shuffle } = raw as Record<string, unknown>;
  if (typeof question !== "string" || question.trim() === "") {
    throw new QuizInputError("quiz question is required: one question per call");
  }
  if (!Array.isArray(options)) {
    throw new QuizInputError("quiz options must be an array of { label, value?, description? }");
  }
  const parsedOptions = options.map((option: unknown, i): RawQuizOption => {
    const { label, value, description } = (typeof option === "object" && option !== null ? option : {}) as Record<string, unknown>;
    if (typeof label !== "string") throw new QuizInputError(`quiz option ${i + 1} needs a string label`);
    return {
      label,
      ...(typeof value === "string" ? { value } : {}),
      ...(typeof description === "string" ? { description } : {}),
    };
  });
  if (
    !(
      typeof correctAnswer === "string" ||
      (Array.isArray(correctAnswer) && correctAnswer.every((v: unknown): v is string => typeof v === "string"))
    )
  ) {
    throw new QuizInputError(
      "quiz correctAnswer is required: the option value, or an array of values for multi-select",
    );
  }
  if (typeof explanation !== "string" || explanation.trim() === "") {
    throw new QuizInputError("quiz explanation is required: say why the correct answer is correct");
  }
  return {
    question,
    ...(typeof details === "string" ? { details } : {}),
    options: parsedOptions,
    ...(multiSelect === true ? { multiSelect: true } : {}),
    correctAnswer,
    explanation,
    ...(shuffle === false ? { shuffle: false } : {}),
  };
}

// The model sometimes sends a multi-select array as a JSON string ('["a", "b"]'),
// because the schema's union lists the string form first. Parse that back into
// an array; anything else, including a bracketed value that is not JSON, is one
// literal value. Port of quiz.ts:158-175.
function correctValues(correctAnswer: string | string[]): string[] {
  if (Array.isArray(correctAnswer)) return correctAnswer.map((v) => v.trim());
  const trimmed = correctAnswer.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim());
    } catch {
      // Not JSON: a literal value that happens to be bracketed.
    }
  }
  return [trimmed];
}

function checkLimits(options: readonly QuizOption[], mode: QuizMode, limits: QuizLimits): void {
  if (limits.maxOptions !== undefined && options.length > limits.maxOptions) {
    throw new QuizInputError(
      `quiz takes at most ${limits.maxOptions} options here (the dialog adds "${DONT_KNOW_LABEL}" as one more row); got ${options.length}`,
    );
  }
  if (!limits.answersByLabel) return;
  const seen = new Set<string>();
  for (const { label } of options) {
    if (label === DONT_KNOW_LABEL) {
      throw new QuizInputError(`quiz option label "${DONT_KNOW_LABEL}" is reserved: that choice is added automatically`);
    }
    if (seen.has(label)) {
      throw new QuizInputError(`quiz option labels must be unique here, because the answer comes back as a label: "${label}" appears twice`);
    }
    seen.add(label);
    if (mode === "multi-select" && label.includes(",")) {
      throw new QuizInputError(
        `quiz multi-select option labels must not contain "," here, because the answer comes back comma-joined: "${label}"`,
      );
    }
  }
}

/**
 * Validate raw tool arguments and resolve everything the dialog and the grader need.
 * Throws QuizInputError for any input the quiz cannot grade honestly.
 */
export function prepareQuiz(raw: unknown, limits: QuizLimits = {}): PreparedQuiz {
  const input = parseQuizInput(raw);
  const mode: QuizMode = input.multiSelect ? "multi-select" : "single-select";
  let options: QuizOption[];
  try {
    options = displayOrder(input);
  } catch (error) {
    throw new QuizInputError(`quiz ${error instanceof Error ? error.message : String(error)}`);
  }
  if (options.length < 2) throw new QuizInputError("quiz requires at least two options");
  checkLimits(options, mode, limits);

  const values = correctValues(input.correctAnswer);
  if (values.length === 0) throw new QuizInputError("quiz correctAnswer is required");
  const indices = new Set<number>();
  for (const value of values) {
    const position = options.findIndex((o) => o.value === value);
    if (position === -1) {
      const known = options.map((o) => `"${o.value}"`).join(", ");
      throw new QuizInputError(`quiz correctAnswer "${value}" does not match any option value (${known})`);
    }
    indices.add(position + 1);
  }
  const correctIndices = [...indices].sort((a, b) => a - b);
  if (mode === "single-select" && correctIndices.length > 1) {
    throw new QuizInputError(
      `quiz single-select needs exactly one correctAnswer; got ${correctIndices.length}. Set multiSelect: true when several options are correct.`,
    );
  }

  const context = input.details?.trim() || undefined;
  return {
    question: input.question,
    ...(context ? { context } : {}),
    mode,
    options,
    correctIndices,
    explanation: input.explanation.trim(),
  };
}
```

**Step 5: Run it to verify it passes**

Run: `npx vitest run plugins/quiz/test/prepare.test.ts && npm run typecheck`
Expected: 13 tests pass; typecheck exits 0.

**Step 6: Build and commit**

Run: `npm run build && npm run check`
Expected: exit 0. `dist/{claude,omp}/quiz/` now hold manifests only (no `src/omp.ts`/`src/claude.ts` yet), and both catalogs list `quiz`.

```bash
git add package.json package-lock.json plugins/quiz dist .claude-plugin .omp-plugin
git commit -m "feat(quiz): validate quiz input and resolve answers in display order"
```

---

### Task 2: Grade answers and write the model-facing text

**Files:**
- Create: `plugins/quiz/src/core/grade.ts`
- Test: `plugins/quiz/test/grade.test.ts`

**Step 1: Write the failing test**

**Create `plugins/quiz/test/grade.test.ts`:**

```ts
import { describe, expect, test } from "vitest";
import { cancelledDetails, gradeQuiz, quizResultText } from "../src/core/grade.ts";
import { prepareQuiz } from "../src/core/prepare.ts";

const single = prepareQuiz({
  question: "Which planet is closest to the Sun?",
  options: [
    { label: "Mercury", value: "mercury" },
    { label: "Venus", value: "venus" },
    { label: "Mars", value: "mars" },
  ],
  correctAnswer: "mercury",
  explanation: "Mercury orbits at about 0.39 AU.",
  shuffle: false,
});
const primes = prepareQuiz({
  question: "Which of these numbers are prime?",
  options: [
    { label: "2", value: "two" },
    { label: "3", value: "three" },
    { label: "4", value: "four" },
  ],
  multiSelect: true,
  correctAnswer: ["two", "three"],
  explanation: "4 = 2 × 2, so it is not prime.",
  shuffle: false,
});
const pick = (quiz: typeof single, ...indices: number[]) =>
  indices.map((index) => ({ label: quiz.options[index - 1]!.label, value: quiz.options[index - 1]!.value, index }));

describe("gradeQuiz", () => {
  test("grades a correct single-select pick and lists every displayed option", () => {
    const d = gradeQuiz(single, { dontKnow: false, answers: pick(single, 1) });
    expect(d).toMatchObject({ status: "answered", correct: true, dontKnow: false, correctIndices: [1] });
    expect(d.options).toEqual([
      { index: 1, label: "Mercury" },
      { index: 2, label: "Venus" },
      { index: 3, label: "Mars" },
    ]);
    expect(quizResultText(d)).toBe(
      "User answered correctly.\nSelected: 1. Mercury\nCorrect: 1. Mercury\nExplanation: Mercury orbits at about 0.39 AU.",
    );
  });

  test("grades multi-select as an exact set: a subset or a superset is incorrect", () => {
    expect(gradeQuiz(primes, { dontKnow: false, answers: pick(primes, 2, 1) }).correct).toBe(true);
    expect(gradeQuiz(primes, { dontKnow: false, answers: pick(primes, 1) }).correct).toBe(false);
    expect(gradeQuiz(primes, { dontKnow: false, answers: pick(primes, 1, 2, 3) }).correct).toBe(false);
  });

  test("tells the model which wrong answer was picked, with the user's note", () => {
    const d = gradeQuiz(primes, { dontKnow: false, note: "  4 felt prime  ", answers: pick(primes, 3, 1) });
    expect(quizResultText(d)).toBe(
      "User answered incorrectly.\nSelected: 1. 2, 3. 4\nCorrect: 1. 2, 2. 3\nUser's note: 4 felt prime\nExplanation: 4 = 2 × 2, so it is not prime.",
    );
  });

  test("never counts I don't know as correct and says it was not a guess", () => {
    const d = gradeQuiz(single, { dontKnow: true, note: "never learned this", answers: [] });
    expect(d).toMatchObject({ correct: false, dontKnow: true, answers: [], note: "never learned this" });
    expect(quizResultText(d)).toBe(
      'User selected "I don\'t know" — they did not attempt an answer (a genuine knowledge gap, not a wrong guess).\nCorrect: 1. Mercury\nUser\'s note: never learned this\nExplanation: Mercury orbits at about 0.39 AU.',
    );
  });

  test("omits a whitespace-only note", () => {
    expect(gradeQuiz(single, { dontKnow: false, note: "   ", answers: pick(single, 2) }).note).toBeUndefined();
  });

  test("reports a cancelled quiz to the model in plain words", () => {
    expect(quizResultText(cancelledDetails(single))).toBe("User cancelled the quiz");
  });
});
```

**Step 2: Run it to verify it fails**

Run: `npx vitest run plugins/quiz/test/grade.test.ts`
Expected: FAIL — `Error: Cannot find module '../src/core/grade.ts'`.

**Step 3: Implement** (wording ported from quiz.ts:264-332)

**Create `plugins/quiz/src/core/grade.ts`:**

```ts
import { displayedOptions, type OptionAnswer, type QuizResultDetails } from "../../../../shared/quiz-contract.ts";
import type { PreparedQuiz } from "./prepare.ts";

/** What the user did, in either harness: real picks (empty when dontKnow) plus an optional note. */
export interface QuizResponse {
  dontKnow: boolean;
  note?: string;
  answers: OptionAnswer[];
}

/** Grade a response. Multi-select is an exact-set match; "I don't know" is never correct. */
export function gradeQuiz(quiz: PreparedQuiz, response: QuizResponse): QuizResultDetails {
  const answers = response.dontKnow ? [] : [...response.answers].sort((a, b) => a.index - b.index);
  const picked = answers.map((a) => a.index);
  const correct =
    !response.dontKnow &&
    picked.length === quiz.correctIndices.length &&
    picked.every((index, i) => index === quiz.correctIndices[i]);
  const note = response.note?.trim() || undefined;
  return {
    status: "answered",
    question: quiz.question,
    ...(quiz.context ? { context: quiz.context } : {}),
    mode: quiz.mode,
    answers,
    correctIndices: quiz.correctIndices,
    options: displayedOptions(quiz.options),
    correct,
    dontKnow: response.dontKnow,
    ...(note ? { note } : {}),
    ...(quiz.explanation ? { explanation: quiz.explanation } : {}),
  };
}

export function cancelledDetails(quiz: PreparedQuiz): QuizResultDetails {
  return {
    status: "cancelled",
    question: quiz.question,
    ...(quiz.context ? { context: quiz.context } : {}),
    mode: quiz.mode,
    answers: [],
    correctIndices: quiz.correctIndices,
    message: "User cancelled the quiz",
  };
}

export function unavailableDetails(quiz: PreparedQuiz, message: string): QuizResultDetails {
  return {
    status: "unavailable",
    question: quiz.question,
    ...(quiz.context ? { context: quiz.context } : {}),
    mode: quiz.mode,
    answers: [],
    correctIndices: quiz.correctIndices,
    message,
  };
}

/** The text the model reads. Wording ported from quiz.ts:264-313. */
export function quizResultText(d: QuizResultDetails): string {
  if (d.status !== "answered") return d.message ?? `quiz ${d.status}`;
  const labelOf = (index: number) => d.options?.find((o) => o.index === index)?.label ?? "(unknown)";
  const correctStr = d.correctIndices.map((i) => `${i}. ${labelOf(i)}`).join(", ");
  let text = d.dontKnow
    ? `User selected "I don't know" — they did not attempt an answer (a genuine knowledge gap, not a wrong guess).\nCorrect: ${correctStr}`
    : `User answered ${d.correct ? "correctly" : "incorrectly"}.\nSelected: ${d.answers.map((a) => `${a.index}. ${a.label}`).join(", ")}\nCorrect: ${correctStr}`;
  if (d.note) text += `\nUser's note: ${d.note}`;
  if (d.explanation) text += `\nExplanation: ${d.explanation}`;
  return text;
}
```

**Step 4: Run it to verify it passes**

Run: `npx vitest run plugins/quiz/test/grade.test.ts && npm run typecheck`
Expected: 6 tests pass; typecheck exits 0.

**Step 5: Build and commit**

```bash
npm run build && npm run check
git add plugins/quiz dist .claude-plugin .omp-plugin
git commit -m "feat(quiz): grade answers and report them to the model"
```

---

### Task 3: Feedback marks and the transcript summary

Shared by the omp dialog's feedback screen (Task 5), omp's `renderResult` (Task 6), and CC's `ToolResult` row (Task 10). Rules ported from quiz.ts:335-401 and :1035-1103.

**Files:**
- Modify: `plugins/quiz/src/core/grade.ts` (append)
- Test: `plugins/quiz/test/feedback.test.ts`

**Step 1: Write the failing test**

**Create `plugins/quiz/test/feedback.test.ts`:**

```ts
import { describe, expect, test } from "vitest";
import { cancelledDetails, feedbackRows, gradeQuiz, resultLines } from "../src/core/grade.ts";
import { prepareQuiz } from "../src/core/prepare.ts";

const single = prepareQuiz({
  question: "Which planet is closest to the Sun?",
  options: [
    { label: "Mercury", value: "mercury" },
    { label: "Venus", value: "venus" },
    { label: "Mars", value: "mars" },
  ],
  correctAnswer: "mercury",
  explanation: "Mercury orbits at about 0.39 AU.",
  shuffle: false,
});
const primes = prepareQuiz({
  question: "Which of these numbers are prime?",
  options: [
    { label: "2", value: "two" },
    { label: "3", value: "three" },
    { label: "4", value: "four" },
  ],
  multiSelect: true,
  correctAnswer: ["two", "three"],
  explanation: "4 = 2 × 2, so it is not prime.",
  shuffle: false,
});
const pick = (quiz: typeof single, ...indices: number[]) =>
  indices.map((index) => ({ label: quiz.options[index - 1]!.label, value: quiz.options[index - 1]!.value, index }));

describe("feedback", () => {
  test("marks a wrong pick ✗ and every correct option ✓, including the one the user missed", () => {
    const d = gradeQuiz(primes, { dontKnow: false, answers: pick(primes, 1, 3) });
    expect(feedbackRows(d).map((r) => `${r.mark}:${r.tone}`)).toEqual(["✓:success", "✓:success", "✗:error"]);
  });

  test("after I don't know, shows only the correct answers and no ✗", () => {
    const d = gradeQuiz(single, { dontKnow: true, answers: [] });
    expect(feedbackRows(d).map((r) => r.mark)).toEqual(["✓", " ", " "]);
  });

  test("summarises the outcome under the marked options, then the note and explanation", () => {
    const d = gradeQuiz(single, { dontKnow: false, note: "close one", answers: pick(single, 2) });
    expect(resultLines(d).slice(3)).toEqual([
      { text: "", tone: "dim" },
      { text: "Incorrect", tone: "error" },
      { text: "Note: close one", tone: "muted" },
      { text: "Mercury orbits at about 0.39 AU.", tone: "muted" },
    ]);
  });

  test("summarises a cancelled quiz as one warning line", () => {
    expect(resultLines(cancelledDetails(single))).toEqual([{ text: "User cancelled the quiz", tone: "warning" }]);
  });
});
```

**Step 2: Run it to verify it fails**

Run: `npx vitest run plugins/quiz/test/feedback.test.ts`
Expected: FAIL — 4 tests, `TypeError: feedbackRows is not a function` (and `resultLines`).

**Step 3: Implement**

**Append to `plugins/quiz/src/core/grade.ts`:**

```ts
export type FeedbackTone = "success" | "error" | "dim";
export interface FeedbackRow {
  index: number;
  label: string;
  mark: "✓" | "✗" | " ";
  tone: FeedbackTone;
}

/**
 * One row per displayed option, marked for the user: ✓ on every correct option,
 * ✗ on a wrong pick. After "I don't know" there are no picks, so nothing is ✗.
 */
export function feedbackRows(d: QuizResultDetails): FeedbackRow[] {
  const picked = new Set(d.answers.map((a) => a.index));
  const key = new Set(d.correctIndices);
  const shown = d.options ?? d.answers.map((a) => ({ index: a.index, label: a.label }));
  return shown.map(({ index, label }) => {
    if (key.has(index)) return { index, label, mark: "✓", tone: "success" };
    if (picked.has(index)) return { index, label, mark: "✗", tone: "error" };
    return { index, label, mark: " ", tone: "dim" };
  });
}

export type LineTone = FeedbackTone | "warning" | "muted";
export interface StyledLine {
  text: string;
  tone: LineTone;
}

/** The transcript summary of a finished quiz: omp's renderResult and CC's ToolResult row both draw it. */
export function resultLines(d: QuizResultDetails): StyledLine[] {
  if (d.status !== "answered") return [{ text: d.message ?? `quiz ${d.status}`, tone: "warning" }];
  const lines: StyledLine[] = feedbackRows(d).map((r) => ({ text: `${r.mark} ${r.index}. ${r.label}`, tone: r.tone }));
  lines.push({ text: "", tone: "dim" });
  if (d.dontKnow) lines.push({ text: "I don't know", tone: "warning" });
  else if (d.correct) lines.push({ text: "Correct!", tone: "success" });
  else lines.push({ text: "Incorrect", tone: "error" });
  if (d.note) lines.push({ text: `Note: ${d.note}`, tone: "muted" });
  if (d.explanation) lines.push({ text: d.explanation, tone: "muted" });
  return lines;
}
```

**Step 4: Run it to verify it passes**

Run: `npx vitest run plugins/quiz/test/feedback.test.ts plugins/quiz/test/grade.test.ts && npm run typecheck`
Expected: 10 tests pass; typecheck exits 0.

**Step 5: Build and commit**

```bash
npm run build && npm run check
git add plugins/quiz dist .claude-plugin .omp-plugin
git commit -m "feat(quiz): mark options ✓/✗ and summarise the outcome"
```

---

### Task 4: The omp dialog reducer

Captures the current dialog (quiz.ts:444-886) as data. Keys, as today: ↑/↓ move (clamped); single-select Enter answers with the focused row (the last row is "I don't know"); multi-select Space/Enter toggle a row, "I don't know" is exclusive with real picks, Enter on the Submit row submits only when something is chosen, Space on Submit does nothing; Tab toggles options ⇄ note; typing on the options starts the note; in the note every key except Tab/Enter/Esc edits it and Enter/Esc go back to the options keeping the text; Esc while choosing cancels; on the feedback screen Enter/Esc close. The note's text lives in the pi-tui `Editor` (cursor, Ctrl+J newline, paste); the reducer decides when a key goes to it (`editNote`) and mirrors the buffer (`noteChanged`).

**Files:**
- Create: `plugins/quiz/src/core/reducer.ts`
- Test: `plugins/quiz/test/reducer.test.ts`

**Step 1: Write the failing test**

**Create `plugins/quiz/test/reducer.test.ts`:**

```ts
import { describe, expect, test } from "vitest";
import type { QuizOption } from "../../../shared/quiz-contract.ts";
import { initialQuizState, quizResponse, stepQuiz, type QuizEvent, type QuizState, type QuizStep } from "../src/core/reducer.ts";

const options: QuizOption[] = [
  { label: "Mercury", value: "mercury" },
  { label: "Venus", value: "venus" },
  { label: "Mars", value: "mars" },
];
type Key = "up" | "down" | "enter" | "space" | "tab" | "escape" | "text" | "other";

/** Press keys in order; return the last step. */
function press(state: QuizState, ...keys: (Key | QuizEvent)[]): QuizStep {
  let step: QuizStep = { state, effect: "none" };
  for (const key of keys) step = stepQuiz(step.state, typeof key === "string" ? { type: key } : key);
  return step;
}
const single = () => initialQuizState("single-select", options.length);
const multi = () => initialQuizState("multi-select", options.length);
const picks = (step: QuizStep) => quizResponse(step.state, options).answers.map((a) => a.label);

describe("single-select dialog", () => {
  test("Enter answers with the focused option and shows feedback", () => {
    const step = press(single(), "down", "enter");
    expect(step.state.phase).toBe("feedback");
    expect(quizResponse(step.state, options)).toEqual({
      dontKnow: false,
      answers: [{ label: "Venus", value: "venus", index: 2 }],
    });
  });

  test("the cursor stops at the first option and at the I don't know row", () => {
    expect(press(single(), "up").state.cursor).toBe(0);
    expect(press(single(), "down", "down", "down", "down", "down").state.cursor).toBe(3);
  });

  test("Enter on I don't know answers with dontKnow and no picks", () => {
    const step = press(single(), "down", "down", "down", "enter");
    expect(quizResponse(step.state, options)).toEqual({ dontKnow: true, answers: [] });
  });

  test("Esc while choosing cancels", () => {
    expect(press(single(), "down", "escape").effect).toBe("cancel");
  });

  test("on the feedback screen Enter or Esc closes with the answer, other keys do nothing", () => {
    const feedback = press(single(), "enter").state;
    expect(press(feedback, "down").effect).toBe("none");
    expect(press(feedback, "enter").effect).toBe("finish");
    expect(press(feedback, "escape").effect).toBe("finish");
  });

  test("Space does not answer", () => {
    expect(press(single(), "space").state.phase).toBe("select");
  });
});

describe("note field", () => {
  test("typing on the options moves focus to the note and hands the key to the editor", () => {
    const step = press(single(), "text");
    expect(step).toMatchObject({ effect: "editNote", state: { focus: "note" } });
  });

  test("in the note every key but Tab, Enter, and Esc edits the note", () => {
    const inNote = press(single(), "tab").state;
    for (const key of ["up", "down", "space", "text", "other"] as const) {
      expect(press(inNote, key)).toMatchObject({ effect: "editNote", state: { focus: "note", cursor: 0 } });
    }
  });

  test("Enter and Esc leave the note without answering or cancelling, keeping its text", () => {
    const typed = press(single(), "text", { type: "noteChanged", text: "orbits?" }).state;
    for (const key of ["enter", "escape"] as const) {
      const step = press(typed, key);
      expect(step).toMatchObject({ effect: "none", state: { focus: "options", phase: "select", note: "orbits?" } });
    }
  });

  test("the answer carries the note trimmed, and none when it is blank", () => {
    const noted = press(single(), "text", { type: "noteChanged", text: "  orbits?  " }, "escape", "enter");
    expect(quizResponse(noted.state, options).note).toBe("orbits?");
    const blank = press(single(), "text", { type: "noteChanged", text: "   " }, "escape", "enter");
    expect(quizResponse(blank.state, options)).not.toHaveProperty("note");
  });
});

describe("multi-select dialog", () => {
  test("Space and Enter toggle the focused option", () => {
    expect(picks(press(multi(), "space", "down", "enter"))).toEqual(["Mercury", "Venus"]);
    expect(picks(press(multi(), "space", "space"))).toEqual([]);
  });

  test("picks are reported in display order whatever order they were made in", () => {
    expect(picks(press(multi(), "down", "down", "space", "up", "up", "space"))).toEqual(["Mercury", "Mars"]);
  });

  test("I don't know is exclusive with real picks", () => {
    const dk = press(multi(), "space", "down", "down", "down", "space").state;
    expect(quizResponse(dk, options)).toEqual({ dontKnow: true, answers: [] });
    const repicked = press(dk, "up", "space").state;
    expect(quizResponse(repicked, options)).toMatchObject({ dontKnow: false });
    expect(picks({ state: repicked, effect: "none" })).toEqual(["Mars"]);
  });

  test("Submit needs at least one choice", () => {
    const toSubmit = ["down", "down", "down", "down"] as const;
    expect(press(multi(), ...toSubmit, "enter").state.phase).toBe("select");
    expect(press(multi(), "space", ...toSubmit, "enter").state.phase).toBe("feedback");
  });

  test("Space on Submit neither submits nor toggles", () => {
    const step = press(multi(), "space", "down", "down", "down", "down", "space");
    expect(step.state).toMatchObject({ phase: "select", picked: [1], dontKnow: false });
  });
});
```

**Step 2: Run it to verify it fails**

Run: `npx vitest run plugins/quiz/test/reducer.test.ts`
Expected: FAIL — `Error: Cannot find module '../src/core/reducer.ts'`.

**Step 3: Implement**

**Create `plugins/quiz/src/core/reducer.ts`:**

```ts
import type { QuizMode, QuizOption } from "../../../../shared/quiz-contract.ts";
import type { QuizResponse } from "./grade.ts";

/**
 * The omp quiz dialog as data. Rows, top to bottom: the real options (cursor
 * 0..n-1), "I don't know" (cursor n), and in multi-select a Submit row (n+1).
 * The note's text lives in a pi-tui Editor owned by the adapter; `note` mirrors it.
 */
export interface QuizState {
  mode: QuizMode;
  optionCount: number;
  cursor: number;
  focus: "options" | "note";
  phase: "select" | "feedback";
  /** 1-based picks, ascending. Single-select holds at most one, set by Enter. */
  picked: number[];
  dontKnow: boolean;
  note: string;
}

/** Keys after the adapter decoded raw terminal input; `text` is any printable input except a bare space. */
export type QuizEvent =
  | { type: "up" | "down" | "enter" | "space" | "tab" | "escape" | "text" | "other" }
  | { type: "noteChanged"; text: string };

/**
 * What the adapter must do after a step:
 * `editNote` → feed the same raw input to the note Editor, then send `noteChanged`;
 * `cancel` → close the dialog with no answer; `finish` → close it with `quizResponse(state)`.
 */
export type QuizEffect = "none" | "editNote" | "cancel" | "finish";

export interface QuizStep {
  state: QuizState;
  effect: QuizEffect;
}

export function initialQuizState(mode: QuizMode, optionCount: number): QuizState {
  return { mode, optionCount, cursor: 0, focus: "options", phase: "select", picked: [], dontKnow: false, note: "" };
}

// Multi-select toggles. "I don't know" is exclusive: choosing it clears the
// picks, and picking an option clears it.
function toggle(state: QuizState): QuizState {
  if (state.cursor === state.optionCount) {
    return state.dontKnow ? { ...state, dontKnow: false } : { ...state, dontKnow: true, picked: [] };
  }
  const index = state.cursor + 1;
  const picked = state.picked.includes(index)
    ? state.picked.filter((i) => i !== index)
    : [...state.picked, index].sort((a, b) => a - b);
  return { ...state, dontKnow: false, picked };
}

export function stepQuiz(state: QuizState, event: QuizEvent): QuizStep {
  const stay = (next: QuizState): QuizStep => ({ state: next, effect: "none" });

  if (state.phase === "feedback") {
    return event.type === "enter" || event.type === "escape" ? { state, effect: "finish" } : stay(state);
  }
  if (event.type === "noteChanged") return stay({ ...state, note: event.text });
  if (event.type === "tab") return stay({ ...state, focus: state.focus === "options" ? "note" : "options" });

  if (state.focus === "note") {
    // Enter and Esc leave the note and keep its text; every other key edits it.
    if (event.type === "enter" || event.type === "escape") return stay({ ...state, focus: "options" });
    return { state, effect: "editNote" };
  }

  // Typing while the options are focused starts the note instead of being dropped.
  if (event.type === "text") return { state: { ...state, focus: "note" }, effect: "editNote" };
  if (event.type === "escape") return { state, effect: "cancel" };

  const lastRow = state.mode === "multi-select" ? state.optionCount + 1 : state.optionCount;
  if (event.type === "up") return stay({ ...state, cursor: Math.max(0, state.cursor - 1) });
  if (event.type === "down") return stay({ ...state, cursor: Math.min(lastRow, state.cursor + 1) });

  if (state.mode === "single-select") {
    if (event.type !== "enter") return stay(state);
    return state.cursor === state.optionCount
      ? stay({ ...state, dontKnow: true, picked: [], phase: "feedback" })
      : stay({ ...state, dontKnow: false, picked: [state.cursor + 1], phase: "feedback" });
  }

  const onSubmit = state.cursor === state.optionCount + 1;
  if (event.type === "space") return onSubmit ? stay(state) : stay(toggle(state));
  if (event.type === "enter") {
    if (!onSubmit) return stay(toggle(state));
    return state.dontKnow || state.picked.length > 0 ? stay({ ...state, phase: "feedback" }) : stay(state);
  }
  return stay(state);
}

/** The user's answer as the grader takes it. `options` are the displayed options, in display order. */
export function quizResponse(state: QuizState, options: readonly QuizOption[]): QuizResponse {
  const note = state.note.trim() || undefined;
  const answers = state.dontKnow
    ? []
    : state.picked.flatMap((index) => {
        const option = options[index - 1];
        return option ? [{ label: option.label, value: option.value, index }] : [];
      });
  return { dontKnow: state.dontKnow, ...(note ? { note } : {}), answers };
}
```

**Step 4: Run it to verify it passes**

Run: `npx vitest run plugins/quiz/test/reducer.test.ts && npm run typecheck`
Expected: 15 tests pass; typecheck exits 0.

**Step 5: Build and commit**

```bash
npm run build && npm run check
git add plugins/quiz dist .claude-plugin .omp-plugin
git commit -m "feat(quiz): model the omp quiz dialog as a pure reducer"
```

---

### Task 5: Render the omp dialog as a pure function

Same layout, text, and colors as quiz.ts:403-430, 561-620, 793-874. Every line goes through `truncateToWidth` or `wrapTextWithAnsi` because omp aborts on an over-wide line (quiz.ts:562-565). The tests pass plain-text stand-ins for pi-tui's two width functions (pi-tui cannot load under Node); real widths are covered by the omp smoke.

**Files:**
- Create: `plugins/quiz/src/tui.ts`
- Test: `plugins/quiz/test/tui.test.ts`

**Step 1: Write the failing test**

**Create `plugins/quiz/test/tui.test.ts`:**

```ts
import { describe, expect, test } from "vitest";
import { prepareQuiz } from "../src/core/prepare.ts";
import { initialQuizState, stepQuiz, type QuizEvent, type QuizState } from "../src/core/reducer.ts";
import { renderQuiz, type QuizTheme, type TextKit } from "../src/tui.ts";

// pi-tui's width functions need Bun; for plain text these do the same job.
const kit: TextKit = {
  truncateToWidth: (text, width) => text.slice(0, width),
  wrapTextWithAnsi: (text, width) => {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (next.length <= width) line = next;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    return [...lines, line];
  },
};
const plain: QuizTheme = { fg: (_color, text) => text };
const tagged: QuizTheme = { fg: (color, text) => `<${color}>${text}</${color}>` };

const planets = {
  question: "Which planet is closest to the Sun?",
  options: [
    { label: "Mercury", value: "mercury" },
    { label: "Venus", value: "venus", description: "Hottest planet" },
    { label: "Mars", value: "mars" },
  ],
  correctAnswer: "mercury",
  explanation: "Mercury orbits at about 0.39 AU.",
  shuffle: false,
};
const quiz = prepareQuiz(planets);
const multiQuiz = prepareQuiz({ ...planets, multiSelect: true, correctAnswer: ["mercury", "venus"] });

function after(state: QuizState, ...types: Exclude<QuizEvent["type"], "noteChanged">[]): QuizState {
  return types.reduce((s, type) => stepQuiz(s, { type }).state, state);
}
const render = (state: QuizState, theme = plain, width = 80, q = state.mode === "multi-select" ? multiQuiz : quiz) =>
  renderQuiz({ quiz: q, state, noteLines: ["[note editor]"] }, theme, kit, width);

describe("omp quiz dialog", () => {
  test("lists the options numbered in display order, cursor on the first, I don't know below", () => {
    const lines = render(initialQuizState("single-select", 3));
    expect(lines).toContain("> 1. Mercury");
    expect(lines).toContain("  2. Venus");
    expect(lines).toContain("     Hottest planet");
    expect(lines).toContain("  I don't know");
    expect(lines).toContain(" ↑↓ navigate • Enter answer • type or Tab for note • Esc cancel");
  });

  test("hides the cursor and switches the hint while the note is focused", () => {
    const lines = render(after(initialQuizState("single-select", 3), "tab"));
    expect(lines.some((l) => l.startsWith("> "))).toBe(false);
    expect(lines).toContain("[note editor]");
    expect(lines).toContain(" Type note • Ctrl+J newline • Enter back to options • Tab options • Esc back");
  });

  test("multi-select warns until something is chosen, then counts the choices on Submit", () => {
    const empty = render(initialQuizState("multi-select", 3));
    expect(empty).toContain("  ○ Submit");
    expect(empty).toContain(" Select at least one answer before submitting.");
    const one = render(after(initialQuizState("multi-select", 3), "space"));
    expect(one).toContain("> [x] 1. Mercury");
    expect(one).toContain("  ✓ Submit (1 selected)");
    expect(one).not.toContain(" Select at least one answer before submitting.");
  });

  test("feedback for a wrong pick marks it ✗ in red, the answer ✓ in green, and explains", () => {
    const lines = render(after(initialQuizState("single-select", 3), "down", "enter"), tagged);
    expect(lines).toContain("<success> ✓ 1. Mercury</success>");
    expect(lines).toContain("<error> ✗ 2. Venus</error>");
    expect(lines).toContain("<error> ✗ Incorrect.</error>");
    expect(lines).toContain(" <muted>Correct answer: 1. Mercury</muted>");
    expect(lines).toContain(" <text>Mercury orbits at about 0.39 AU.</text>");
  });

  test("feedback after I don't know shows the answer and no ✗", () => {
    const lines = render(after(initialQuizState("single-select", 3), "up", "down", "down", "down", "enter"));
    expect(lines).toContain(" · You said: I don't know");
    expect(lines.some((l) => l.includes("✗"))).toBe(false);
    expect(lines).toContain(" ✓ 1. Mercury");
  });

  test("a long question wraps onto more lines without losing a word", () => {
    const question = "alpha beta gamma delta epsilon zeta eta theta";
    const lines = render(initialQuizState("single-select", 3), plain, 12, prepareQuiz({ ...planets, question }));
    expect(lines.join(" ").split(/\s+/)).toEqual(expect.arrayContaining(question.split(" ")));
  });

  test("no line is wider than the terminal, which omp would refuse to draw", () => {
    const long = prepareQuiz({ ...planets, question: "Which planet ".repeat(20), details: "context ".repeat(30) });
    const states = [
      initialQuizState("single-select", 3),
      after(initialQuizState("single-select", 3), "down", "enter"),
    ];
    for (const state of states) {
      for (const line of render(state, plain, 24, long)) expect(line.length).toBeLessThanOrEqual(24);
    }
  });
});
```

**Step 2: Run it to verify it fails**

Run: `npx vitest run plugins/quiz/test/tui.test.ts`
Expected: FAIL — `Error: Cannot find module '../src/tui.ts'`.

**Step 3: Implement**

**Create `plugins/quiz/src/tui.ts`:**

```ts
// The omp quiz dialog, drawn as a pure function of state. No runtime pi-tui import:
// pi-tui needs Bun (Bun.stringWidth) and native addons, so Vitest could not load it.
// The adapter passes pi-tui's own width functions in as `TextKit`.
import { feedbackRows, gradeQuiz } from "./core/grade.ts";
import { DONT_KNOW_LABEL, type PreparedQuiz } from "./core/prepare.ts";
import { quizResponse, type QuizState } from "./core/reducer.ts";

/** The theme colors the dialog uses; omp's Theme (pi-tui theme/theme-class.d.ts:55) satisfies this. */
export type QuizColor = "accent" | "text" | "muted" | "dim" | "success" | "error" | "warning";
export interface QuizTheme {
  fg(color: QuizColor, text: string): string;
}

/** pi-tui's `truncateToWidth` and `wrapTextWithAnsi` (pi-tui dist/types/utils.d.ts:29-30). */
export interface TextKit {
  truncateToWidth(text: string, width: number): string;
  wrapTextWithAnsi(text: string, width: number): string[];
}

export interface QuizView {
  quiz: PreparedQuiz;
  state: QuizState;
  /** The note Editor's own rendering at this width (it draws the cursor). */
  noteLines: readonly string[];
}

const NOTE_HINT = " Type note • Ctrl+J newline • Enter back to options • Tab options • Esc back";

/** Every returned line fits `width`: omp's TUI aborts on an over-wide line. */
export function renderQuiz(view: QuizView, theme: QuizTheme, kit: TextKit, width: number): string[] {
  const { quiz, state } = view;
  const lines: string[] = [];
  const add = (text: string) => lines.push(kit.truncateToWidth(text, width));
  const addWrapped = (text: string, indent: string) => {
    for (const line of kit.wrapTextWithAnsi(text, Math.max(1, width - indent.length))) add(`${indent}${line}`);
  };
  const rule = theme.fg("accent", "─".repeat(width));

  add(rule);
  addWrapped(theme.fg("text", quiz.question), " ");
  if (quiz.context) {
    lines.push("");
    addWrapped(theme.fg("muted", quiz.context), " ");
  }

  if (state.phase === "feedback") {
    const d = gradeQuiz(quiz, quizResponse(state, quiz.options));
    lines.push("");
    for (const row of feedbackRows(d)) add(theme.fg(row.tone, ` ${row.mark} ${row.index}. ${row.label}`));
    lines.push("");
    const correctStr = d.correctIndices.map((i) => `${i}. ${quiz.options[i - 1]?.label ?? "(unknown)"}`).join(", ");
    if (d.dontKnow) {
      add(theme.fg("warning", ` · You said: ${DONT_KNOW_LABEL}`));
      addWrapped(theme.fg("muted", `Correct answer: ${correctStr}`), " ");
    } else if (d.correct) {
      add(theme.fg("success", " ✓ Correct!"));
    } else {
      add(theme.fg("error", " ✗ Incorrect."));
      addWrapped(theme.fg("muted", `Correct answer: ${correctStr}`), " ");
    }
    if (d.note) addWrapped(theme.fg("muted", `Your note: ${d.note}`), " ");
    if (d.explanation) {
      lines.push("");
      addWrapped(theme.fg("text", d.explanation), " ");
    }
    lines.push("");
    add(theme.fg("dim", " Enter/Esc to continue"));
    add(rule);
    return lines;
  }

  const multi = state.mode === "multi-select";
  const focused = (row: number) => state.focus === "options" && state.cursor === row;
  const prefix = (row: number) => (focused(row) ? theme.fg("accent", "> ") : "  ");
  lines.push("");
  quiz.options.forEach((option, i) => {
    const checked = state.picked.includes(i + 1);
    const label = `${multi ? (checked ? "[x] " : "[ ] ") : ""}${i + 1}. ${option.label}`;
    add(`${prefix(i)}${theme.fg(focused(i) ? "accent" : checked ? "success" : "text", label)}`);
    if (option.description) addWrapped(theme.fg("muted", option.description), "     ");
  });

  const dk = state.optionCount;
  lines.push("");
  const dkLabel = multi ? `${state.dontKnow ? "[x]" : "[ ]"} ${DONT_KNOW_LABEL}` : DONT_KNOW_LABEL;
  add(`${prefix(dk)}${theme.fg(focused(dk) ? "accent" : state.dontKnow ? "warning" : "dim", dkLabel)}`);

  const count = state.picked.length + (state.dontKnow ? 1 : 0);
  if (multi) {
    const submit = count > 0 ? `✓ Submit (${count} selected)` : "○ Submit";
    add(`${prefix(dk + 1)}${theme.fg(focused(dk + 1) ? "accent" : count > 0 ? "success" : "dim", submit)}`);
  }

  lines.push("");
  addWrapped(theme.fg(state.focus === "note" ? "accent" : "muted", "Note (optional):"), " ");
  lines.push(...view.noteLines);

  lines.push("");
  if (multi && count === 0) add(theme.fg("warning", " Select at least one answer before submitting."));
  if (state.focus === "note") add(theme.fg("dim", NOTE_HINT));
  else if (multi) add(theme.fg("dim", " ↑↓ navigate • Space toggle • Enter submit • type or Tab for note • Esc cancel"));
  else add(theme.fg("dim", " ↑↓ navigate • Enter answer • type or Tab for note • Esc cancel"));
  add(rule);
  return lines;
}
```

**Step 4: Run it to verify it passes**

Run: `npx vitest run plugins/quiz/test/tui.test.ts && npm run typecheck`
Expected: 7 tests pass; typecheck exits 0.

**Step 5: Build and commit**

```bash
npm run build && npm run check
git add plugins/quiz dist .claude-plugin .omp-plugin
git commit -m "feat(quiz): render the omp quiz dialog from reducer state"
```

---

### Task 6: Register the omp quiz tool

`registerQuiz(pi, ui)` holds everything but pi-tui: validation, the unavailable/cancel paths, a module-level mutex (one `ctx.ui.custom` at a time, quiz.ts:892-917, now module-scoped per the design), the result shape, and transcript rendering. Tests drive it through `createFakeOmp()` (used as-is: `fake.tools`, `fake.ctx`; `hasUI`/`mode` set on the plain `ctx` object — no fake-omp change) and a scripted `QuizUi`.

**Files:**
- Create: `plugins/quiz/src/core/schema.ts`
- Create: `plugins/quiz/src/omp-tool.ts`
- Test: `plugins/quiz/test/omp.test.ts`

**Step 1: Write the failing test**

**Create `plugins/quiz/test/omp.test.ts`:**

```ts
import { describe, expect, test } from "vitest";
import { createFakeOmp } from "../../../test-support/fake-omp.ts";
import type { QuizResponse } from "../src/core/grade.ts";
import type { PreparedQuiz } from "../src/core/prepare.ts";
import { registerQuiz } from "../src/omp-tool.ts";

const planets = {
  question: "Which planet is closest to the Sun?",
  options: [
    { label: "Mercury", value: "mercury" },
    { label: "Venus", value: "venus" },
    { label: "Mars", value: "mars" },
  ],
  correctAnswer: "mercury",
  explanation: "Mercury orbits at about 0.39 AU.",
};

/** The dialog as the user drives it: each call answers with the next scripted reply. */
function setup(...replies: ((quiz: PreparedQuiz) => Promise<QuizResponse | null>)[]) {
  const fake = createFakeOmp();
  const shown: PreparedQuiz[] = [];
  registerQuiz(fake.api, {
    ask: (_ctx, quiz) => {
      shown.push(quiz);
      const reply = replies.shift();
      if (!reply) throw new Error("dialog opened more often than scripted");
      return reply(quiz);
    },
    text: (text) => ({ render: () => [text] }),
  });
  const run = (params: unknown, signal?: AbortSignal) =>
    fake.tools.get("quiz")!.execute("call-1", params, signal, undefined, fake.ctx);
  return { fake, shown, run };
}
const choose = (label: string) => async (quiz: PreparedQuiz): Promise<QuizResponse> => {
  const index = quiz.options.findIndex((o) => o.label === label) + 1;
  return { dontKnow: false, answers: [{ label, value: quiz.options[index - 1]!.value, index }] };
};

describe("omp quiz tool", () => {
  test("grades the answer: details carry the structured result, the text is for the model", async () => {
    const { run } = setup(choose("Mercury"));
    const result = await run(planets);
    expect(result.details).toMatchObject({ status: "answered", correct: true, mode: "single-select" });
    expect(result.content).toEqual([{ type: "text", text: expect.stringMatching(/^User answered correctly\./) }]);
    expect(JSON.stringify(result.content)).not.toContain("<quiz-result>");
  });

  test("bad input is an error the model can act on, and no dialog opens", async () => {
    const { run, shown } = setup();
    const result = await run({ ...planets, correctAnswer: "pluto" });
    expect(result).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringContaining('"pluto"') }] });
    expect(shown).toEqual([]);
  });

  test("without a UI the quiz is unavailable and no dialog opens", async () => {
    const { fake, run, shown } = setup();
    fake.ctx.hasUI = false;
    const result = await run(planets);
    expect(result.details).toMatchObject({ status: "unavailable", message: "quiz requires interactive mode UI" });
    expect(shown).toEqual([]);
  });

  test("in RPC mode, where custom dialogs cannot be shown, the quiz is unavailable", async () => {
    const { fake, run, shown } = setup();
    Object.assign(fake.ctx, { mode: "rpc" });
    expect((await run(planets)).details).toMatchObject({ status: "unavailable" });
    expect(shown).toEqual([]);
  });

  test("Esc in the dialog returns a cancelled result", async () => {
    const { run } = setup(async () => null);
    const result = await run(planets);
    expect(result.details).toMatchObject({ status: "cancelled" });
    expect(result.content).toEqual([{ type: "text", text: "User cancelled the quiz" }]);
  });

  test("aborting the turn while the dialog is open returns a cancelled result", async () => {
    const controller = new AbortController();
    const { run } = setup(async () => {
      controller.abort();
      throw new Error("aborted");
    });
    expect((await run(planets, controller.signal)).details).toMatchObject({ status: "cancelled" });
  });

  test("a quiz aborted before its dialog opened never shows it", async () => {
    const controller = new AbortController();
    controller.abort();
    const { run, shown } = setup();
    expect((await run(planets, controller.signal)).details).toMatchObject({ status: "cancelled" });
    expect(shown).toEqual([]);
  });

  test("concurrent quizzes take turns: the second dialog opens only after the first closes", async () => {
    const firstOpened = Promise.withResolvers<void>();
    const firstAnswer = Promise.withResolvers<QuizResponse | null>();
    const { run, shown } = setup(() => {
      firstOpened.resolve();
      return firstAnswer.promise;
    }, choose("Mercury"));
    const first = run(planets);
    const second = run({ ...planets, question: "Second?" });
    await firstOpened.promise;
    expect(shown.map((q) => q.question)).toEqual([planets.question]);
    firstAnswer.resolve({ dontKnow: true, answers: [] });
    expect((await first).details).toMatchObject({ dontKnow: true });
    expect((await second).details).toMatchObject({ question: "Second?", correct: true });
  });
});
```

**Step 2: Run it to verify it fails**

Run: `npx vitest run plugins/quiz/test/omp.test.ts`
Expected: FAIL — `Error: Cannot find module '../src/omp-tool.ts'`.

**Step 3: Implement the description and schema** (no test: static text; the CC `maxItems` is advisory, the enforcement is `CLAUDE_LIMITS`, tested in Task 1)

**Create `plugins/quiz/src/core/schema.ts`:**

```ts
import { toolName, type Harness } from "../../../../shared/tool-map.ts";
import { CLAUDE_LIMITS, DONT_KNOW_LABEL } from "./prepare.ts";

// omp 18.2.10 ignores `promptGuidelines` on extension tools (the field exists only on
// ToolInfo, pi-coding-agent dist/types/extensibility/extensions/types.d.ts:485-491) and
// CC has only `description`, so the original guidelines (quiz.ts:927-942) live here.

/** What the model reads about the quiz tool, per harness. */
export function quizDescription(harness: Harness): string {
  const ask = toolName("ask", harness);
  const note =
    harness === "omp"
      ? "An always-present optional note field (Tab to focus it) lets the user attach a free-text note to ANY answer; it reaches you only when non-empty."
      : `If the user types their own words under "Other" instead of choosing, the result is "${DONT_KNOW_LABEL}" with their words as the note; a note reaches you only when non-empty.`;
  const guidelines = [
    `quiz is GRADED; ${ask} is not. If the question has a correct answer, use quiz. If you just need a preference, decision, or open-ended input, use ${ask}.`,
    'correctAnswer is REQUIRED and is the option value, not a position number. Single-select: one string (e.g. "mercury"). Multi-select: an array of strings (e.g. ["belize", "niue"]).',
    "Always pass the option's `value` string as correctAnswer — it is self-checking and prevents miscounting positions. A value that matches no option is a hard error.",
    "explanation is REQUIRED — always say why the correct answer is correct.",
    "Multi-select is graded as an exact-set match: the user is correct only if they select every correct option and no incorrect ones.",
    `There is no free-text mode. An '${DONT_KNOW_LABEL}' choice is ALWAYS added automatically — provide ONLY the real, gradable options (at least two). Never add your own uncertainty/opt-out option like 'I don't know', 'I'm not sure', or 'Not sure'; that is handled for you and a manual one would be redundant or gradable-as-wrong.`,
    "If a result comes back as dontKnow, the user honestly did not know and did NOT guess — treat it as a genuine knowledge gap to teach into, not as a wrong answer.",
    "Any answer (right, wrong, or 'I don't know') may carry an optional free-text `note`. When present it reflects what they were thinking or unsure about — read it and let it steer your follow-up. It is omitted entirely when empty.",
    "Treat each wrong answer (distractor) as a diagnostic probe, not just filler: make it a specific, believable mistake the user might actually hold — a common misconception, or an adjacent/easily-confused concept — so that WHICH wrong answer they pick reveals WHICH nuance of their understanding is off.",
    "Guardrail: every distractor must be unambiguously wrong on the intended reading — tempting, but a real error, not a defensible alternative. Don't drift into trick questions.",
    "Anti-guessing hygiene: don't let the correct answer stand out by form (longest, most precise, most hedged, or the only one in the right format). Keep options similar in length, specificity, and phrasing so it can't be picked from shape alone.",
    "Set multiSelect: true only when more than one option is correct.",
    "Options are shuffled before display by default, so don't worry about which position you list the correct answer in. Set shuffle: false only when option order is meaningful (ordered values, or an 'All/None of the above' option that must stay last).",
    "To probe nuance, ask several quick quiz questions and adapt each one based on the previous answers, rather than writing one giant question.",
    "Don't leak the answer through formatting: keep option phrasing/length even and don't hint which is correct.",
  ];
  const limits =
    harness === "claude"
      ? `\n\nLimits in this harness: at most ${CLAUDE_LIMITS.maxOptions} options (the dialog shows at most four rows, one of them "${DONT_KNOW_LABEL}"). Option labels must be unique and must not be "${DONT_KNOW_LABEL}"; in multi-select they must not contain a comma, because the answer comes back comma-joined. Option descriptions are not shown, so put everything the user needs in the label.`
      : "";
  return (
    "Ask the user a GRADED question with a known correct answer, then instantly grade and give feedback. " +
    `Unlike ${ask} (which collects preferences/decisions with no right answer), quiz always has a correct answer supplied by you, marks the user's selection right/wrong (✓/✗), reveals the correct answer, and can show an explanation. ` +
    "Use it to (1) assess what the learner already understands before teaching, and (2) run tight practice/retrieval loops after explaining, or probe understanding whenever you're unsure they've got it. " +
    `Options-only: single-select or multi-select, plus an automatic '${DONT_KNOW_LABEL}' choice so the user can signal a genuine gap instead of guessing. ${note} ` +
    `No free-text answers — for non-graded questions use ${ask} instead.` +
    `\n\nGuidelines:\n${guidelines.map((g) => `- ${g}`).join("\n")}` +
    limits
  );
}

/** The input JSON Schema. omp takes a plain JSON Schema for `parameters`; CC takes it as `inputSchema`. */
export function quizInputSchema(harness: Harness): Record<string, unknown> {
  const max = harness === "claude" ? CLAUDE_LIMITS.maxOptions : undefined;
  return {
    type: "object",
    properties: {
      question: { type: "string", description: "The single quiz question to ask. Ask exactly one question per tool call." },
      details: { type: "string", description: "Optional extra context or instructions shown under the question." },
      options: {
        type: "array",
        minItems: 2,
        ...(max ? { maxItems: max } : {}),
        description: `The answer options (2${max ? `-${max}` : " or more"}). Options only — there is no free-text mode. Give each option a stable \`value\`; you reference the correct one by that value in correctAnswer.`,
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Display label for the answer option." },
            value: { type: "string", description: "Optional machine-readable value returned for the option. Defaults to the label." },
            description: { type: "string", description: "Optional extra detail shown below the option." },
          },
          required: ["label"],
        },
      },
      multiSelect: {
        type: "boolean",
        description: "Set to true when more than one option is correct and the user must select all of them.",
      },
      correctAnswer: {
        anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        description:
          'REQUIRED. The correct answer as the option value(s) — the `value` field of the option you intend. Single-select: a single string (e.g. "mercury"). Multi-select: an array of strings (e.g. ["belize", "niue"]); the user is only correct if their selection matches this set exactly. Always pass the value, not a position number — this is self-checking and prevents miscounting.',
      },
      explanation: {
        type: "string",
        description:
          "REQUIRED. Explanation revealed AFTER the user answers (shown whether they got it right or wrong). Use it to reinforce why the correct answer is correct.",
      },
      shuffle: {
        type: "boolean",
        description:
          "Defaults to true: options are reordered before display so the correct answer isn't always in the same position. Set to false only when option order is meaningful (e.g. ordered numeric values, or an 'All/None of the above' option that must stay last).",
      },
    },
    required: ["question", "options", "correctAnswer", "explanation"],
  };
}
```

**Step 4: Implement the tool**

**Create `plugins/quiz/src/omp-tool.ts`:**

```ts
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import type { Component } from "@oh-my-pi/pi-tui";
import type { QuizResultDetails } from "../../../shared/quiz-contract.ts";
import { cancelledDetails, gradeQuiz, quizResultText, resultLines, unavailableDetails, type QuizResponse } from "./core/grade.ts";
import { prepareQuiz, QuizInputError, type PreparedQuiz } from "./core/prepare.ts";
import { quizDescription, quizInputSchema } from "./core/schema.ts";

/** The omp UI the tool needs. `src/omp.ts` implements it with pi-tui; tests script it. */
export interface QuizUi {
  /** Show the dialog. Resolves to the answer, or null when the user cancels; rejects when `signal` aborts it. */
  ask(ctx: ExtensionContext, quiz: PreparedQuiz, signal: AbortSignal | undefined): Promise<QuizResponse | null>;
  /** A plain text component for the transcript (pi-tui `Text`). */
  text(text: string): Component;
}

// ctx.ui.custom shows one component at a time, so quiz calls take turns.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(run);
  queue = result.catch(() => undefined);
  return result;
}

function answer(details: QuizResultDetails) {
  return { content: [{ type: "text" as const, text: quizResultText(details) }], details };
}

export function registerQuiz(pi: ExtensionAPI, ui: QuizUi): void {
  pi.registerTool<Record<string, unknown>, QuizResultDetails>({
    name: "quiz",
    label: "quiz",
    // Extension tools default to "discoverable" (xd:// devices); prompts call quiz by name.
    loadMode: "essential",
    description: quizDescription("omp"),
    parameters: quizInputSchema("omp"),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      let quiz: PreparedQuiz;
      try {
        quiz = prepareQuiz(params);
      } catch (error) {
        if (!(error instanceof QuizInputError)) throw error;
        return { content: [{ type: "text", text: error.message }], isError: true };
      }
      // RPC mode reports hasUI but its ui.custom resolves undefined at once (pi-coding-agent src/modes/rpc/rpc-mode.ts:995-998).
      if (!ctx.hasUI || ctx.mode !== "tui") return answer(unavailableDetails(quiz, "quiz requires interactive mode UI"));

      return serialized(async () => {
        if (signal?.aborted) return answer(cancelledDetails(quiz));
        let response: QuizResponse | null;
        try {
          response = await ui.ask(ctx, quiz, signal);
        } catch (error) {
          if (signal?.aborted) return answer(cancelledDetails(quiz));
          throw error;
        }
        return answer(response ? gradeQuiz(quiz, response) : cancelledDetails(quiz));
      });
    },

    // Never shows options, correctAnswer, or explanation: the call row is drawn before the user answers.
    renderCall(args, _options, theme) {
      const { question, multiSelect, options } = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
      let text = theme.fg("toolTitle", theme.bold("quiz ")) + theme.fg("muted", typeof question === "string" ? question : "");
      if (multiSelect === true) text += theme.fg("dim", " [multi-select]");
      if (Array.isArray(options) && options.length > 0) text += theme.fg("dim", ` (${options.length} options)`);
      return ui.text(text);
    },

    renderResult(result, _options, theme) {
      const details = result.details;
      if (!details) {
        const first = result.content[0];
        return ui.text(first?.type === "text" ? first.text : "");
      }
      return ui.text(resultLines(details).map((line) => theme.fg(line.tone, line.text)).join("\n"));
    },
  });
}
```

**Step 5: Run it to verify it passes**

Run: `npx vitest run plugins/quiz/test/omp.test.ts && npm run typecheck`
Expected: 8 tests pass; typecheck exits 0.

**Step 6: Build and commit**

```bash
npm run build && npm run check
git add plugins/quiz dist .claude-plugin .omp-plugin
git commit -m "feat(quiz): register the omp quiz tool"
```

---

### Task 7: Wire the pi-tui dialog (omp entry) and smoke it

`src/omp.ts` is the only module importing pi-tui at runtime; it maps raw input to reducer events, keeps the note `Editor` in sync, caches lines per width (quiz.ts:562-565, 614-618), and passes `signal` to `ctx.ui.custom`. No Vitest test (pi-tui needs Bun); the smoke below is its test.

**Files:**
- Create: `plugins/quiz/src/omp.ts`

**Step 1: Implement**

**Create `plugins/quiz/src/omp.ts`:**

```ts
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import {
  Editor,
  extractPrintableText,
  getEditorTheme,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";
import type { QuizResponse } from "./core/grade.ts";
import type { PreparedQuiz } from "./core/prepare.ts";
import { initialQuizState, quizResponse, stepQuiz, type QuizEvent } from "./core/reducer.ts";
import { registerQuiz } from "./omp-tool.ts";
import { renderQuiz } from "./tui.ts";

const kit = { truncateToWidth, wrapTextWithAnsi };

function toEvent(data: string): QuizEvent {
  if (matchesKey(data, Key.up)) return { type: "up" };
  if (matchesKey(data, Key.down)) return { type: "down" };
  if (matchesKey(data, Key.enter)) return { type: "enter" };
  if (matchesKey(data, Key.space)) return { type: "space" };
  if (matchesKey(data, Key.tab)) return { type: "tab" };
  if (matchesKey(data, Key.escape)) return { type: "escape" };
  // Plain and Kitty CSI-u text alike (pi-tui keys.d.ts:171-176).
  return extractPrintableText(data) !== undefined ? { type: "text" } : { type: "other" };
}

function askInTui(ctx: ExtensionContext, quiz: PreparedQuiz, signal: AbortSignal | undefined): Promise<QuizResponse | null> {
  return ctx.ui.custom<QuizResponse | null>(
    (tui, theme, _keybindings, done) => {
      let state = initialQuizState(quiz.mode, quiz.options.length);
      // omp's Editor takes one EditorTheme argument and needs `symbols`; getEditorTheme supplies it
      // (pi-tui components/editor.d.ts:8-21,108; theme/tui-adapters.d.ts:29).
      const editor = new Editor({ ...getEditorTheme(), borderColor: (s: string) => theme.fg("accent", s) });
      // Enter must not submit: the Editor's submit clears its buffer. Ctrl+J still inserts a newline.
      editor.disableSubmit = true;
      editor.focused = false;
      let cache: { width: number; lines: string[] } | undefined;

      return {
        render(width: number): readonly string[] {
          // Keyed on width: a resize re-renders without invalidate().
          if (cache?.width === width) return cache.lines;
          const lines = renderQuiz({ quiz, state, noteLines: editor.render(width) }, theme, kit, width);
          // Not cached while the note is focused: the Editor draws a live cursor.
          if (state.focus !== "note") cache = { width, lines };
          return lines;
        },
        invalidate() {
          cache = undefined;
          editor.invalidate();
        },
        handleInput(data: string) {
          const step = stepQuiz(state, toEvent(data));
          state = step.state;
          editor.focused = state.focus === "note";
          if (step.effect === "cancel") return done(null);
          if (step.effect === "finish") return done(quizResponse(state, quiz.options));
          if (step.effect === "editNote") {
            editor.handleInput(data);
            state = stepQuiz(state, { type: "noteChanged", text: editor.getText() }).state;
          }
          cache = undefined;
          tui.requestRender();
        },
      };
    },
    { signal },
  );
}

export default function quiz(pi: ExtensionAPI): void {
  registerQuiz(pi, { ask: askInTui, text: (text) => new Text(text, 0, 0) });
}
```

**Step 2: Typecheck, build, check**

Run: `npm run typecheck && npm test && npm run build && npm run check`
Expected: exit 0; `dist/omp/quiz/extension.js` exists and its only bare import is `from "@oh-my-pi/pi-tui"` (`grep -n '^import\|from "' dist/omp/quiz/extension.js | head`).

**Step 3: Smoke — load + print mode (no TUI)**

```bash
omp plugin link /home/marcus/tmp/learn/learning-plugins/dist/omp/quiz
cd /home/marcus/tmp/learn/learning-plugins
omp -p --tools quiz --mode json 'Call the quiz tool exactly once with these arguments and nothing else: question "Which planet is closest to the Sun?", options [{label:"Mercury",value:"mercury"},{label:"Venus",value:"venus"},{label:"Mars",value:"mars"}], correctAnswer "mercury", explanation "Mercury orbits at about 0.39 AU, closer than any other planet."' | jq -c 'select(.type=="tool_execution_end") | .result.details'
```

Expected: one line, `{"status":"unavailable",…,"message":"quiz requires interactive mode UI"}`. (Verified on a prototype bundle with `-e`.) If the extension fails to load with an unresolved `@oh-my-pi/pi-tui`: rebuild with the legacy specifier `@mariozechner/pi-tui` in `src/omp.ts`'s import (omp rewrites legacy pi-package specifiers onto host copies, omp://extension-loading.md "loadLegacyPiModule"; today's quiz.ts loads that way), keep `@oh-my-pi/pi-tui` for `import type`, and record it in the commit message.

**Step 4: Smoke — interactive dialog**

Start `omp` in the repo dir (new session), send the SINGLE prompt from Step 3, and check:
- the dialog shows `> 1. …` on the first option, the "I don't know" row, the `Note (optional):` field, the hint `↑↓ navigate • Enter answer • type or Tab for note • Esc cancel`;
- typing `x` moves focus to the note and inserts `x`; Ctrl+J adds a line; Enter returns to the options with the text kept;
- Enter on an option shows ✓/✗ feedback, `Correct answer: …`, `Your note: …`, the explanation; Enter closes; the transcript row shows the marked options and `Correct!`/`Incorrect`;
- resizing the terminal while the dialog is open does not crash.

Then `omp plugin uninstall @learning-plugins/quiz` (Task 11 relinks).

**Step 5: Commit**

```bash
git add plugins/quiz dist .claude-plugin .omp-plugin
git commit -m "feat(quiz): draw the omp quiz dialog with pi-tui"
```

---

### Task 8: Map the quiz to Claude Code's native dialog

**Files:**
- Create: `plugins/quiz/src/core/dialog.ts`
- Test: `plugins/quiz/test/dialog.test.ts`

**Step 1: Write the failing test**

**Create `plugins/quiz/test/dialog.test.ts`:**

```ts
import { describe, expect, test } from "vitest";
import { dialogLabels, dialogQuestion, responseFromDialog } from "../src/core/dialog.ts";
import { prepareQuiz } from "../src/core/prepare.ts";

const base = {
  question: "Which of these numbers are prime?",
  options: [
    { label: "2", value: "two" },
    { label: "3", value: "three" },
    { label: "4", value: "four" },
  ],
  correctAnswer: "two",
  explanation: "4 = 2 × 2.",
  shuffle: false,
};
const single = prepareQuiz(base);
const multi = prepareQuiz({ ...base, multiSelect: true, correctAnswer: ["two", "three"] });

describe("Claude Code dialog", () => {
  test("offers the options in display order, then I don't know", () => {
    expect(dialogLabels(single)).toEqual(["2", "3", "4", "I don't know"]);
  });

  test("shows details under the question", () => {
    expect(dialogQuestion(prepareQuiz({ ...base, details: "Primes have two divisors." }))).toBe(
      "Which of these numbers are prime?\n\nPrimes have two divisors.",
    );
  });

  test("maps the chosen label to its option and display index", () => {
    expect(responseFromDialog(single, "3")).toEqual({ dontKnow: false, answers: [{ label: "3", value: "three", index: 2 }] });
  });

  test("maps comma-joined multi-select labels, with or without spaces", () => {
    const expected = [
      { label: "2", value: "two", index: 1 },
      { label: "3", value: "three", index: 2 },
    ];
    expect(responseFromDialog(multi, "2, 3").answers).toEqual(expected);
    expect(responseFromDialog(multi, "3,2").answers).toEqual(expected);
  });

  test("I don't know wins over real picks", () => {
    expect(responseFromDialog(single, "I don't know")).toEqual({ dontKnow: true, answers: [] });
    expect(responseFromDialog(multi, "2, I don't know")).toEqual({ dontKnow: true, answers: [] });
  });

  test("text typed under Other is I don't know with the text as the note", () => {
    expect(responseFromDialog(single, "  5, maybe?  ")).toEqual({ dontKnow: true, note: "5, maybe?", answers: [] });
    expect(responseFromDialog(multi, "2, and also 5")).toEqual({ dontKnow: true, note: "2, and also 5", answers: [] });
  });
});
```

**Step 2: Run it to verify it fails**

Run: `npx vitest run plugins/quiz/test/dialog.test.ts`
Expected: FAIL — `Error: Cannot find module '../src/core/dialog.ts'`.

**Step 3: Implement**

**Create `plugins/quiz/src/core/dialog.ts`:**

```ts
import type { OptionAnswer } from "../../../../shared/quiz-contract.ts";
import type { QuizResponse } from "./grade.ts";
import { DONT_KNOW_LABEL, type PreparedQuiz } from "./prepare.ts";

// Claude Code asks through its native AskUserQuestion dialog (`$.ui.ask`), which
// takes plain labels and answers with the chosen label, the chosen labels
// comma-joined (multi-select), or whatever the user typed under "Other".

/** The dialog's question: the quiz question, then its `details` as a second paragraph. */
export function dialogQuestion(quiz: PreparedQuiz): string {
  return quiz.context ? `${quiz.question}\n\n${quiz.context}` : quiz.question;
}

/** The dialog's options: the real options in display order, then "I don't know". */
export function dialogLabels(quiz: PreparedQuiz): string[] {
  return [...quiz.options.map((o) => o.label), DONT_KNOW_LABEL];
}

/**
 * Map the dialog's answer back to a response. Text that is not exactly the
 * offered labels was typed under "Other": the user answered in their own words
 * instead of choosing, so it counts as "I don't know" with the text as the note.
 * In multi-select, "I don't know" next to real picks still means "I don't know".
 */
export function responseFromDialog(quiz: PreparedQuiz, answer: string): QuizResponse {
  const parts = quiz.mode === "multi-select" ? answer.split(",").map((p) => p.trim()) : [answer.trim()];
  const answers: OptionAnswer[] = [];
  let dontKnow = false;
  for (const part of parts) {
    if (part === DONT_KNOW_LABEL) {
      dontKnow = true;
      continue;
    }
    const index = quiz.options.findIndex((o) => o.label === part) + 1;
    const option = quiz.options[index - 1];
    if (!option) {
      const note = answer.trim();
      return { dontKnow: true, ...(note ? { note } : {}), answers: [] };
    }
    if (!answers.some((a) => a.index === index)) answers.push({ label: option.label, value: option.value, index });
  }
  return dontKnow ? { dontKnow: true, answers: [] } : { dontKnow: false, answers: answers.sort((a, b) => a.index - b.index) };
}
```

**Step 4: Run it to verify it passes**

Run: `npx vitest run plugins/quiz/test/dialog.test.ts && npm run typecheck`
Expected: 6 tests pass; typecheck exits 0.

**Step 5: Build and commit**

```bash
npm run build && npm run check
git add plugins/quiz dist .claude-plugin .omp-plugin
git commit -m "feat(quiz): map quizzes to Claude Code's ask dialog and back"
```

---

### Task 9: The Claude Code quiz tool

`session.start` records `isInteractive` and registers the tool (the model sees `mcp__quiz__quiz`); `tool.call` validates with `CLAUDE_LIMITS`, asks with `$.ui.ask` (the wait is inside a mods API call, exempt from the 10 s budget), and answers without `next`. Tested only with the CC kit.

**Files:**
- Test: `plugins/quiz/test/claude/quiz.test.ts`
- Create: `plugins/quiz/src/claude.ts`

**Step 1: Write the failing test**

**Create `plugins/quiz/test/claude/quiz.test.ts`:**

```ts
import type { On } from "claude-code";
import { expect, test } from "claude-code/testing";

// Runs under `claude plugin test` against the built hooks bundle. `$.ui.ask` reaches a
// test as a tool.call of AskUserQuestion; the stub plays the user (mods docs, test.md).

const QUIZ = "mcp__quiz__quiz";
const planets = {
  question: "Which planet is closest to the Sun?",
  options: [
    { label: "Mercury", value: "mercury" },
    { label: "Venus", value: "venus" },
    { label: "Mars", value: "mars" },
  ],
  correctAnswer: "mercury",
  explanation: "Mercury orbits at about 0.39 AU.",
};
const primes = {
  question: "Which of these numbers are prime?",
  options: [
    { label: "2", value: "two" },
    { label: "3", value: "three" },
    { label: "4", value: "four" },
  ],
  multiSelect: true,
  correctAnswer: ["two", "three"],
  explanation: "4 = 2 × 2, so it is not prime.",
};

interface Dialog {
  question: string;
  header?: string;
  options: { label: string }[];
  multiSelect?: boolean;
}

/** The single question `$.ui.ask` put in the AskUserQuestion call. */
function dialogOf(e: unknown): Dialog {
  const questions = (e as { questions?: unknown }).questions;
  if (!Array.isArray(questions) || questions.length !== 1) throw new Error(`unexpected AskUserQuestion input: ${JSON.stringify(e)}`);
  return questions[0] as Dialog;
}

/** The structured result md-log reads, from the tool's result text. */
function detailsOf(result: unknown): Record<string, unknown> {
  const match = /<quiz-result>([\s\S]*?)<\/quiz-result>/.exec(String(result));
  if (!match?.[1]) throw new Error(`no quiz-result block in: ${String(result)}`);
  return JSON.parse(match[1]) as Record<string, unknown>;
}

/** Stubs every test needs: the session start and the tool registration it makes. */
function stubSession(on: On): void {
  on("session.start", () => ({ cwd: "/work" }));
  on("tool.register", () => ({ value: { tool: QUIZ } }));
}

test("asks in the native dialog: display-ordered labels, then I don't know", async ($, on) => {
  stubSession(on);
  const asked: Dialog[] = [];
  on("tool.call", ($, e) => {
    const dialog = dialogOf(e);
    asked.push(dialog);
    return { result: { answers: { [dialog.question]: "Mercury" } } };
  });
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  const { result } = await $.tool.call({ tool: QUIZ, ...planets });
  const labels = asked[0]?.options.map((o) => o.label);
  expect(asked[0]).toMatchObject({ question: planets.question, header: "Quiz", multiSelect: false });
  expect(labels?.slice(3)).toEqual(["I don't know"]);
  expect([...(labels ?? []).slice(0, 3)].sort()).toEqual(["Mars", "Mercury", "Venus"]);
  // md-log logs the options in the order the user saw them.
  expect(detailsOf(result).options).toEqual(labels?.slice(0, 3).map((label, i) => ({ index: i + 1, label })));
});

test("grades the chosen label against the correct answer", async ($, on) => {
  stubSession(on);
  on("tool.call", ($, e) => ({ result: { answers: { [dialogOf(e).question]: "Venus" } } }));
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  const { result, isError } = await $.tool.call({ tool: QUIZ, ...planets });
  expect(isError).toBeUndefined();
  expect(String(result)).toMatch(/^User answered incorrectly\.\nSelected: \d\. Venus\nCorrect: \d\. Mercury\n/);
  expect(detailsOf(result)).toMatchObject({ status: "answered", correct: false, answers: [{ label: "Venus", value: "venus" }] });
});

test("multi-select asks with multiSelect and grades the comma-joined answer as a set", async ($, on) => {
  stubSession(on);
  let multiSelect: boolean | undefined;
  on("tool.call", ($, e) => {
    const dialog = dialogOf(e);
    multiSelect = dialog.multiSelect;
    return { result: { answers: { [dialog.question]: "3, 2" } } };
  });
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  const { result } = await $.tool.call({ tool: QUIZ, ...primes });
  expect(multiSelect).toBe(true);
  expect(detailsOf(result)).toMatchObject({ status: "answered", mode: "multi-select", correct: true });
});

test("words typed under Other count as I don't know, kept as the note", async ($, on) => {
  stubSession(on);
  on("tool.call", ($, e) => ({ result: { answers: { [dialogOf(e).question]: "the one with no moons?" } } }));
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  const { result } = await $.tool.call({ tool: QUIZ, ...planets });
  expect(detailsOf(result)).toMatchObject({ dontKnow: true, correct: false, answers: [], note: "the one with no moons?" });
});

test("dismissing the dialog cancels the quiz", async ($, on) => {
  stubSession(on);
  on("tool.call", () => ({ deny: "dismissed" }));
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  const { result } = await $.tool.call({ tool: QUIZ, ...planets });
  expect(String(result)).toMatch(/^User cancelled the quiz\n\n<quiz-result>/);
  expect(detailsOf(result)).toMatchObject({ status: "cancelled" });
});

test("in a non-interactive session the quiz is unavailable and no dialog opens", async ($, on) => {
  stubSession(on);
  let asked = false;
  on("tool.call", () => {
    asked = true;
    return { deny: "no one to ask" };
  });
  await $.session.start({ surface: null, isInteractive: false, cwd: "/work" });
  const { result } = await $.tool.call({ tool: QUIZ, ...planets });
  expect(asked).toBe(false);
  expect(detailsOf(result)).toMatchObject({ status: "unavailable" });
});

test("more options than the dialog can hold is an error the model can fix", async ($, on) => {
  stubSession(on);
  on("tool.call", () => ({ deny: "dialog must not open" }));
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  const four = { ...planets, options: [...planets.options, { label: "Earth", value: "earth" }] };
  const answer = await $.tool.call({ tool: QUIZ, ...four });
  expect(answer).toEqual({ result: expect.stringContaining("at most 3 options"), isError: true });
});

test("a comma in a multi-select label is an error the model can fix", async ($, on) => {
  stubSession(on);
  on("tool.call", () => ({ deny: "dialog must not open" }));
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  const options = [{ label: "2, the even prime", value: "two" }, ...primes.options.slice(1)];
  const answer = await $.tool.call({ tool: QUIZ, ...primes, options });
  expect(answer).toEqual({ result: expect.stringContaining('must not contain ","'), isError: true });
});
```

**Step 2: Run it to verify it fails**

Run: `npm run build && npm run test:claude -- quiz`
Expected: FAIL — all 8 tests (no hook answers `mcp__quiz__quiz` yet, so the AskUserQuestion stub sees a quiz call: `unexpected AskUserQuestion input` / `no quiz-result block`).

**Step 3: Implement**

**Create `plugins/quiz/src/claude.ts`:**

```ts
import type { On, PluginOptions } from "claude-code";
import { encodeQuizResult, type QuizResultDetails } from "../../../shared/quiz-contract.ts";
import { dialogLabels, dialogQuestion, responseFromDialog } from "./core/dialog.ts";
import { cancelledDetails, gradeQuiz, quizResultText, unavailableDetails } from "./core/grade.ts";
import { CLAUDE_LIMITS, prepareQuiz, QuizInputError, type PreparedQuiz } from "./core/prepare.ts";
import { quizDescription, quizInputSchema } from "./core/schema.ts";

// Set from session.start, which runs before the first prompt and again after each reload.
let interactive = false;

/** The model reads the text; md-log reads the block (quiz contract). */
function withBlock(details: QuizResultDetails): string {
  return `${quizResultText(details)}\n\n${encodeQuizResult(details)}`;
}

export function register(on: On, _options: PluginOptions): void {
  on("session.start", async ($, e, next) => {
    interactive = e.isInteractive;
    await $.tool.register({
      name: "quiz",
      description: quizDescription("claude"),
      inputSchema: quizInputSchema("claude"),
      // Load the schema upfront: teach calls the tool by name every few turns.
      isDeferred: false,
    });
    return next(e);
  });

  on("tool.call", { tool: "mcp__quiz__quiz" }, async ($, e) => {
    let quiz: PreparedQuiz;
    try {
      quiz = prepareQuiz(e, CLAUDE_LIMITS);
    } catch (error) {
      if (!(error instanceof QuizInputError)) throw error;
      return { result: error.message, isError: true as const };
    }
    if (!interactive) return { result: withBlock(unavailableDetails(quiz, "quiz requires an interactive Claude Code session")) };

    let answer: string;
    try {
      // The wait sits inside a mods API call, so it does not count against the hook's 10 s budget.
      answer = await $.ui.ask(dialogQuestion(quiz), {
        options: dialogLabels(quiz),
        header: "Quiz",
        ...(quiz.mode === "multi-select" ? { multiSelect: true as const } : {}),
      });
    } catch {
      // Rejects on dismissal and on "Chat about this" (cc.d.ts:2113-2128).
      return { result: withBlock(cancelledDetails(quiz)) };
    }
    return { result: withBlock(gradeQuiz(quiz, responseFromDialog(quiz, answer))) };
  }).catch(($, e, next) => ({ result: `quiz failed: ${next.error.message ?? next.error.kind}`, isError: true as const }));
}
```

**Step 4: Run it to verify it passes**

Run: `npm run build && npm run test:claude -- quiz && npm run validate`
Expected: `8 pass  0 fail`; validate prints `gating hook with .catch: tool.call{tool=mcp__quiz__quiz}` and `calls: $.tool.register, $.ui.ask`, then passes.

**Step 5: [UNVERIFIED] `isDeferred` in the vendored types**

Run: `npm run typecheck`
- Exit 0 → keep `isDeferred: false`.
- Error "Object literal may only specify known properties, and 'isDeferred' does not exist in type 'ToolSpec'" → the vendored types predate the field although the 2.1.296 runtime accepts it. Remove the `isDeferred` line from `$.tool.register` and instead add, inside `register`, `on("tool.describe", { tool: "mcp__quiz__quiz" }, async ($, e, next) => ({ ...(await next(e)), isDeferred: false }));` (typed: `ToolDescribeResult`, cc.d.ts:10015-10022; example cc.d.ts:3467). Re-run Step 4.

**Step 6: Commit**

```bash
npm run check
git add plugins/quiz dist .claude-plugin .omp-plugin
git commit -m "feat(quiz): Claude Code quiz tool on the native ask dialog"
```

---

### Task 10 (optional): Draw ✓/✗ feedback in Claude Code's transcript

Open question 2 resolved yes (see Decisions). Without this task the CC transcript shows the result text including the raw `<quiz-result>{…}` JSON. With it, the quiz's `ToolResult` row draws the same lines as omp's `renderResult` (`resultLines`). Other tools pass through `next(e)`.

**Files:**
- Create: `plugins/quiz/src/core/output.ts`
- Test: `plugins/quiz/test/output.test.ts`
- Modify: `plugins/quiz/src/claude.ts` (whole file below)
- Modify: `plugins/quiz/test/claude/quiz.test.ts` (append)

**Step 1: Write the failing tests**

**Create `plugins/quiz/test/output.test.ts`:**

```ts
import { describe, expect, test } from "vitest";
import { encodeQuizResult } from "../../../shared/quiz-contract.ts";
import { cancelledDetails } from "../src/core/grade.ts";
import { quizDetailsFromOutput } from "../src/core/output.ts";
import { prepareQuiz } from "../src/core/prepare.ts";

const single = prepareQuiz({
  question: "Which planet is closest to the Sun?",
  options: [
    { label: "Mercury", value: "mercury" },
    { label: "Venus", value: "venus" },
  ],
  correctAnswer: "mercury",
  explanation: "Mercury orbits at about 0.39 AU.",
});

describe("quizDetailsFromOutput", () => {
  const details = cancelledDetails(single);
  test("finds the result block in a stored string result", () => {
    expect(quizDetailsFromOutput(`User cancelled the quiz\n\n${encodeQuizResult(details)}`)).toEqual(details);
  });

  test("finds it in stored text blocks too", () => {
    const blocks = [{ type: "text", text: "User cancelled the quiz" }, { type: "text", text: encodeQuizResult(details) }];
    expect(quizDetailsFromOutput(blocks)).toEqual(details);
  });
});
```

**Append to `plugins/quiz/test/claude/quiz.test.ts`:**

```ts
const TOOL_RESULT = { plugin: "quiz", surface: "terminal", component: "ToolResult" } as const;

test("the transcript shows the graded options and verdict, not the raw result block", async ($, on) => {
  stubSession(on);
  on("tool.call", ($, e) => ({ result: { answers: { [dialogOf(e).question]: "Venus" } } }));
  on("ui.render", () => ({ type: "Text", props: {}, children: ["drawn by Claude Code"] }));
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  const { result } = await $.tool.call({ tool: QUIZ, ...planets });
  const ui = await $.ui.mount({
    ...TOOL_RESULT,
    props: { tool_use_id: "toolu_1", tool: QUIZ, output: result, isErrored: false },
  });
  expect(await ui.find({ type: "Text", text: /^✗ \d\. Venus$/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /^✓ \d\. Mercury$/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "Incorrect" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /quiz-result/ })).toBeUndefined();
});

test("other tools' results are drawn as Claude Code draws them", async ($, on) => {
  on("ui.render", () => ({ type: "Text", props: {}, children: ["drawn by Claude Code"] }));
  const ui = await $.ui.mount({
    ...TOOL_RESULT,
    props: { tool_use_id: "toolu_2", tool: "Bash", output: "<quiz-result>{}</quiz-result>", isErrored: false },
  });
  expect(await ui.find({ type: "Text", text: "drawn by Claude Code" })).toBeDefined();
});
```

**Step 2: Run them to verify they fail**

Run: `npx vitest run plugins/quiz/test/output.test.ts; npm run build && npm run test:claude -- quiz`
Expected: Vitest FAIL — `Error: Cannot find module '../src/core/output.ts'`; kit: the 8 earlier tests pass, "the transcript shows the graded options…" FAILS (no hook draws `ToolResult`, so the stub's `drawn by Claude Code` is all that is found).

**Step 3: Implement**

**Create `plugins/quiz/src/core/output.ts`:**

```ts
import { decodeQuizResult, type QuizResultDetails } from "../../../../shared/quiz-contract.ts";

/**
 * The quiz result inside a stored tool result, as CC hands it to a render hook
 * (`ToolResult.output`): our `result` string, or text blocks if CC stored it as such.
 */
export function quizDetailsFromOutput(output: unknown): QuizResultDetails | undefined {
  if (typeof output === "string") return decodeQuizResult(output);
  if (!Array.isArray(output)) return undefined;
  const text = output
    .map((block: unknown) =>
      typeof block === "object" && block !== null && "text" in block && typeof block.text === "string" ? block.text : "",
    )
    .join("\n");
  return decodeQuizResult(text);
}
```

**Replace `plugins/quiz/src/claude.ts`:**

```ts
import type { On, PluginOptions } from "claude-code";
import { encodeQuizResult, type QuizResultDetails } from "../../../shared/quiz-contract.ts";
import { dialogLabels, dialogQuestion, responseFromDialog } from "./core/dialog.ts";
import { quizDetailsFromOutput } from "./core/output.ts";
import { cancelledDetails, gradeQuiz, quizResultText, resultLines, unavailableDetails, type LineTone } from "./core/grade.ts";
import { CLAUDE_LIMITS, prepareQuiz, QuizInputError, type PreparedQuiz } from "./core/prepare.ts";
import { quizDescription, quizInputSchema } from "./core/schema.ts";

const INK: Record<LineTone, { color?: string; dimColor?: boolean }> = {
  success: { color: "green" },
  error: { color: "red" },
  warning: { color: "yellow" },
  muted: { dimColor: true },
  dim: { dimColor: true },
};

// Set from session.start, which runs before the first prompt and again after each reload.
let interactive = false;

/** The model reads the text; md-log reads the block (quiz contract). */
function withBlock(details: QuizResultDetails): string {
  return `${quizResultText(details)}\n\n${encodeQuizResult(details)}`;
}

export function register(on: On, _options: PluginOptions): void {
  on("session.start", async ($, e, next) => {
    interactive = e.isInteractive;
    await $.tool.register({
      name: "quiz",
      description: quizDescription("claude"),
      inputSchema: quizInputSchema("claude"),
      // Load the schema upfront: teach calls the tool by name every few turns.
      isDeferred: false,
    });
    return next(e);
  });

  on("tool.call", { tool: "mcp__quiz__quiz" }, async ($, e) => {
    let quiz: PreparedQuiz;
    try {
      quiz = prepareQuiz(e, CLAUDE_LIMITS);
    } catch (error) {
      if (!(error instanceof QuizInputError)) throw error;
      return { result: error.message, isError: true as const };
    }
    if (!interactive) return { result: withBlock(unavailableDetails(quiz, "quiz requires an interactive Claude Code session")) };

    let answer: string;
    try {
      // The wait sits inside a mods API call, so it does not count against the hook's 10 s budget.
      answer = await $.ui.ask(dialogQuestion(quiz), {
        options: dialogLabels(quiz),
        header: "Quiz",
        ...(quiz.mode === "multi-select" ? { multiSelect: true as const } : {}),
      });
    } catch {
      // Rejects on dismissal and on "Chat about this" (cc.d.ts:2113-2128).
      return { result: withBlock(cancelledDetails(quiz)) };
    }
    return { result: withBlock(gradeQuiz(quiz, responseFromDialog(quiz, answer))) };
  }).catch(($, e, next) => ({ result: `quiz failed: ${next.error.message ?? next.error.kind}`, isError: true as const }));

  // Draw the quiz's result row as ✓/✗ feedback instead of the raw text and its JSON block.
  on("ui.render", { component: "ToolResult" }, async ($, e, next) => {
    if (e.props.tool !== "mcp__quiz__quiz" || e.props.isErrored) return next(e);
    const details = quizDetailsFromOutput(e.props.output);
    if (!details) return next(e);
    const { Box, Text } = $.ui.resolve(e);
    return Box({
      flexDirection: "column",
      children: resultLines(details).map((line) => Text({ ...INK[line.tone], children: [line.text || " "] })),
    });
  });
}
```

(If Task 9 Step 5 switched to the `tool.describe` hook, keep that hook and drop `isDeferred` here too.)

**Step 4: Run them to verify they pass**

Run: `npx vitest run plugins/quiz/test/output.test.ts && npm run typecheck && npm run build && npm run test:claude -- quiz && npm run validate`
Expected: 2 Vitest tests pass; kit `10 pass  0 fail`; validate lists `ui.render{component=ToolResult}` and `$.ui.resolve`, then passes.

**Step 5: [UNVERIFIED] shape of `output` in a real session** — covered by Task 11 step 5 (the row must show ✓/✗ lines, not the JSON). `quizDetailsFromOutput` accepts both a string and text blocks; if the real row still shows raw text, add a temporary `$.ui.log(JSON.stringify(e.props.output).slice(0, 300), { to: "debug" })` in the hook, read the debug log, extend `quizDetailsFromOutput` + `output.test.ts` with that shape, and remove the log.

**Step 6: Commit**

```bash
npm run check
git add plugins/quiz dist .claude-plugin .omp-plugin
git commit -m "feat(quiz): draw quiz feedback in Claude Code's transcript"
```

---

### Task 11: Smoke both harnesses, then re-check md-log

No code unless a check fails (then: write a failing test for the defect in the matching test file, fix, and commit `fix(quiz): …`). Use a new session after every rebuild.

Prompts (verbatim; Phase 5 reuses them):

- **SINGLE** = `Call the quiz tool exactly once with these arguments and nothing else: question "Which planet is closest to the Sun?", options [{label:"Mercury",value:"mercury"},{label:"Venus",value:"venus"},{label:"Mars",value:"mars"}], correctAnswer "mercury", explanation "Mercury orbits at about 0.39 AU, closer than any other planet."`
- **MULTI** = `Call the quiz tool exactly once with these arguments and nothing else: question "Which of these numbers are prime?", options [{label:"2",value:"two"},{label:"3",value:"three"},{label:"4",value:"four"}], multiSelect true, correctAnswer ["two","three"], explanation "4 = 2 × 2, so it is not prime."`
- **DETAILS** = SINGLE plus `, details "Think about orbital radius."`
- **FOUR** = SINGLE with a fourth option `{label:"Earth",value:"earth"}`.

**Step 1: Build and install for dogfooding**

```bash
cd /home/marcus/tmp/learn/learning-plugins && npm run build
omp plugin link /home/marcus/tmp/learn/learning-plugins/dist/omp/quiz
```

**Step 2: omp matrix** (`omp` in the repo dir; one prompt per session or per turn)

| Case | Do | Observe |
|---|---|---|
| single correct | SINGLE, Enter on Mercury | `✓ Correct!` + explanation; model text `User answered correctly.` |
| single wrong + note | SINGLE, type `orbits?`, Enter, choose Venus | `✗ Incorrect.`, `Correct answer: N. Mercury`, `Your note: orbits?` |
| I don't know + note | SINGLE, Tab, type `never learned this`, Esc, select I don't know | `· You said: I don't know`, no ✗ anywhere |
| multi | MULTI; Enter on Submit first, then Space on 2 and 3, Submit | warning `Select at least one answer…` until a pick; then `✓ Submit (2 selected)`, `✓ Correct!` |
| cancel | SINGLE, Esc | model receives `User cancelled the quiz` |
| abort | SINGLE, then Esc/Ctrl+C on the agent while the dialog is open | dialog closes; no hang; result cancelled |

**Step 3: CC matrix** (`claude --plugin-dir /home/marcus/tmp/learn/learning-plugins/dist/claude/quiz`, from the repo dir)

| Case | Do | Observe |
|---|---|---|
| single | SINGLE, pick Mercury | header chip `Quiz`, 3 labels then `I don't know`; result text `User answered correctly.` |
| multi | MULTI, check 2 and 3 | result `correct: true` |
| I don't know | SINGLE, pick `I don't know` | `dontKnow: true`, no note |
| typed Other | SINGLE, type `the one with no moons` under Other | `dontKnow: true`, `note` = typed text |
| multi + Other [UNVERIFIED join format] | MULTI, check 2 and type `5?` under Other | record the raw `note`; it must be a `dontKnow` result whose note is the whole answer. If CC returns only the typed text, that is also fine — no code change |
| dismiss | SINGLE, Esc | `User cancelled the quiz` |
| Chat about this | SINGLE, choose "Chat about this" | cancelled |
| details | DETAILS | dialog shows the question, a blank line, then `Think about orbital radius.` [UNVERIFIED multi-line rendering]. If the dialog collapses or garbles it, change `dialogQuestion` to join with ` — ` and update its test |
| too many options | FOUR | model gets the `at most 3 options` error; no dialog |
| transcript (Task 10) | after any answered case | the tool's result row shows `✓/✗ N. label` lines and the verdict, no `<quiz-result>` JSON |

**Step 4: Print mode**

```bash
claude -p --plugin-dir /home/marcus/tmp/learn/learning-plugins/dist/claude/quiz --output-format stream-json --verbose --allowedTools mcp__quiz__quiz -- "<SINGLE>" | jq -c 'select(.type=="user") | .message.content[]? | select(.type=="tool_result")'
```

Expected: one `tool_result` whose content contains `quiz requires an interactive Claude Code session` and a `<quiz-result>` block with `"status":"unavailable"`.

**Step 5: [UNVERIFIED] is the error flagged to the model?**

Same command with the FOUR prompt. Expected: the `tool_result` has `"is_error":true` and content containing `at most 3 options`.
- `is_error: true` → done.
- `is_error` absent/false → switch both error returns in `src/claude.ts` (the `QuizInputError` branch and the `.catch` handler) to `{ deny: <same text> }` (`deny`: "the model receives the text as an error result", cc.d.ts:9833-9837); change the two kit tests' expectation to `expect(answer).toEqual({ deny: expect.stringContaining(…) })`; rebuild, `npm run test:claude -- quiz`; tell the Phase 4 executor (same rule there); commit `fix(quiz): report bad input with deny`.

**Step 6: md-log re-check** (needs Phase 2 built)

```bash
omp plugin link /home/marcus/tmp/learn/learning-plugins/dist/omp/md-log
: > /tmp/quiz-md-omp.md && : > /tmp/quiz-md-cc.md
```

In a new `omp` session: `/md-log /tmp/quiz-md-omp.md`, then SINGLE → choose **Venus**; then SINGLE again → Tab, type `never learned this`, Esc, select **I don't know**.
In `claude --plugin-dir …/dist/claude/quiz --plugin-dir …/dist/claude/md-log`: `/md-log /tmp/quiz-md-cc.md`, then SINGLE → **Venus**; then SINGLE → type `never learned this` under **Other**.

```bash
q() { awk '/^> \[!(question|success|failure|warning)\] Quiz/{p=1} p&&/^$/{p=0} p' "$1"; }
diff <(q /tmp/quiz-md-omp.md) <(q /tmp/quiz-md-cc.md) && echo IDENTICAL
```

Expected: `IDENTICAL`; each note has two `> [!question] Quiz` blocks whose numbered options match the order each dialog showed, then `> [!failure] Quiz — incorrect ✗` and `> [!question] Quiz — I don't know` with the note. If the question blocks differ, check first that both tool calls carried identical arguments (`omp`'s session log / CC's transcript); a model that rephrased the question changes the seed — rerun, not a bug. Any other difference is a bug in the md-log or quiz adapter that produced it.

**Step 7: Clean up**

```bash
omp plugin uninstall @learning-plugins/quiz
omp plugin uninstall @learning-plugins/md-log
```

No commit unless a fix was needed.
