# Phase 2: md-log

Delivers `shared/quiz-contract.ts`, the md-log core (entry model, formatter, harness mappings, write queue), and both adapters: `/md-log <file>` and `/md-unlog` in omp and Claude Code. The core proof is golden-file parity: one scripted session, recorded once per harness, formats byte-identically (`test/golden/session.md`), and omp's live path writes the same file. Open question 3 (omp native `ask` result shape) is resolved below from source.

**Prerequisites:** Phase 1 merged: workspace, `npm run typecheck|test|build|check|validate|test:claude`, `shared/tool-map.ts` (with `quiz` and `ask`), `test-support/fake-omp.ts`, vendored CC types in `types/claude-code/`. Read the master plan's ground rules and shared contracts first. Run `source ~/.nvm/nvm.sh && nvm use 24.15.0` once per shell. This shell has `CI=true`: Vitest fails on a missing golden file instead of writing it, so every golden file below is created by hand, with the exact content given, BEFORE its test runs.

## Acceptance tests

1. **Given** the omp branch and the CC transcript of the same scripted session (a skill-prefixed prompt, prose, a shuffled quiz, an `ask`/`AskUserQuestion` question), **when** each is backfilled and formatted, **then** both produce `plugins/md-log/test/golden/session.md` byte for byte.
2. **Given** an empty note linked with `/md-log` in omp, **when** the same session arrives live (`message_end`, `tool_call`, `tool_result`), **then** the note equals `golden/session.md`: the quiz question shows its options in the order the quiz contract gives, written before the answer.
3. **Given** a note linked in Claude Code, **when** a model request writes prose and calls `AskUserQuestion` and the next request starts, **then** the note holds the prose, then the question, then the answer, and a subagent's requests add nothing.
4. **Given** `/md-log` with a missing path, a directory, or (omp) a busy agent, **then** nothing is linked or created. **Given** a CC note that would pass 4 MiB, **then** md-log unlinks it, shows a toast, and writes nothing more.
5. **Given** a real omp session and a real CC session, each with md-log loaded, **when** the user links an empty note and answers one native question, **then** both notes hold the same question and answer blocks, and re-linking a fresh note backfills the conversation identically to the live log.

## Facts this phase relies on (verified now, with sources)

**Open question 3, resolved from source.** omp native `ask`:
- Input: `{questions: [{id, question, header?, options: [{label, description?, preview?}], multi?, recommended?}]}`. Source: `@oh-my-pi/pi-coding-agent@18.2.10` dist/types/tools/ask.d.ts:6-33.
- `tool_result.details` is `AskToolDetails` (`@oh-my-pi/pi-tui@18.2.10` dist/types/tools/ask.d.ts:5-34). The shapes it is filled with come from pi-coding-agent src/tools/ask.ts:
  - one question: `{question, options: string[], multi, selectedOptions: string[], customInput?, note?, timedOut?}` (ask.ts:1019-1029, 1082-1100). A typed "Other" answer sets `customInput` and leaves `selectedOptions` empty (ask.ts:654-655).
  - several questions: `{results: QuestionResult[]}`, each with the same fields plus `id` (ask.ts:1031, 1160).
  - "Chat about this": `{chatRedirect: true, questions: string[]}` (ask.ts:980).
  - cancel, Esc, headless: the tool throws `ToolAbortError` (ask.ts:834, 969, 1017, 1080, 1126). The extension wrapper still emits `tool_result`, with `details: undefined`, `isError: true`, and the error message as content (src/extensibility/extensions/wrapper.ts:363-384).
  - bad input: `details: {}` and an `Error: …` text, not flagged as an error (ask.ts:848-936).
- `tool_call` and `tool_result` carry `toolName`, `toolCallId`, `input`. `tool_result` also carries `content`, `details`, `isError` (extensions/types.d.ts:641-711). Both are emitted for wrapped tools and nested xd:// dispatches (wrapper.ts:184-240, 371-384).

**CC `AskUserQuestion`** (not in the public cc.d.ts; taken from the version-matched `@anthropic-ai/claude-agent-sdk@0.3.296`, whose `claudeCodeVersion` is `2.1.296`):
- Input: `{questions: [{question, header, options: [{label, description, preview?}] (2-4), multiSelect}] (1-4)}` (sdk-tools.d.ts:1131-2707).
- Result record: `{questions, answers: {[question]: string}, response?, annotations?: {[question]: {preview?, notes?}}, afkTimeoutMs?}`. Multi-select answers are comma-separated (sdk-tools.d.ts:3794-3980). The CC test docs stub the same shape: `{ result: { answers: { [e.questions[0].question]: 'Run it' } } }` (mods/test.md, "Look up what a stub returns").

**CC mods API used by `src/claude.ts`.** cc.d.ts is the public 2.1.277 copy at /tmp/cc.d.ts. The vendored 2.1.296 types must typecheck the same code (Task 8 runs `npm run typecheck`).

| API | Source |
|---|---|
| `export function register(on, options)`, `On`, `.catch(handler)` (a generator on `turn.step`) | cc.d.ts:7410-7439, 876-904, 5446-5449 |
| `turn.step` hook `async function* ($, e, next)`, `const r = yield* next(e)` | cc.d.ts:9465-9530; events.md:247-265 |
| `TurnStepInput {turnId, index, model, effort?, messageCount, agentId?}` | cc.d.ts:10427-10461 |
| `TurnStepResult {turnId, index, answer, toolUses: {name, input}[], stopReason, usage}` | cc.d.ts:10487-10515, 10581-10590 |
| `turn.complete` input `{answer, durationMs, isAborted, turnId, agentId?, usage?, reason}` → `{text}` | cc.d.ts:10278-10357 |
| `prompt.submit` input `{text, attachments?, context?, turnId?, wait, origin}`; `next(e)` resolves to `{text, …}` or `{drop}` once the prompt entered | cc.d.ts:7188-7275 |
| `command.run` input `{command, args, origin, presentation}` → `{text?}` | cc.d.ts:1483-1551 |
| `$.command.register({name, description, argumentHint?, immediate?: true})`. `immediate` = "runs at once instead of waiting for the turn to end" | cc.d.ts:1565-1588, 2614-2650; mods/api.md:37 |
| `$.session.messages(): SessionMessage[]` `{role, text, toolUses: ToolUseSummary[], toolResults?}`; `ToolUseSummary {tool_use_id, tool, input, result?, text?, isError?}`; newest 4096 | cc.d.ts:2345-2357, 8964-8990, 10180-10211; reference.md:297 |
| `$.fs.read(path)`, `$.fs.write(path, text)` (no append, not atomic), `$.fs.stat(path, {resolve})` → `{kind, size, mtimeMs, isLink, realPath?}`, rejects ENOENT. **No delete/unlink exists.** | cc.d.ts:2738-2852, 4119-4164; reference.md:194, 287 |
| `$.ui.toast(text, {timeoutMs}): void` | cc.d.ts:2129-2141 |
| `session.start` `{cwd, surface, isInteractive}`; `session.end` `{reason, sessionId, resume}` → `{sessionId}` | cc.d.ts:9181-9204, 8882-8915 |
| `TextEncoder` available in the mod runtime (no Node APIs) | mods/api.md:263 |
| Kit: stubs `on('<ns>.<call>', ($, e) => ({ value }))` or `({ deny })` to reject; `turn.step` stub is a generator; register stubs before the first `$` call; `e.path` arrives absolute | mods/test.md:57-195 |

**Already proven in a throwaway prototype (/tmp/mdlog-proto, against these exact files):** all Vitest suites below pass under Vitest 5.0.3 and `tsc` 7.0.2 strict + `noUncheckedIndexedAccess`. The bundled `register.js` passes `claude plugin test` (9/9) and `claude plugin validate --strict` on CC 2.1.296 with an empty HOME. The validator accepts `$` used inside closures handed to the core queue (it reports `$.fs.read (via appendToNote)`).

**Design deviations (requested contract and design changes are listed at the end of this file):**
- CC `/md-log` is registered **without** `immediate`. `immediate` makes a command run mid-turn (cc.d.ts:1579-1587), the opposite of what the design wanted. Without it, CC defers `/md-log` typed mid-turn until the turn ends, so the backfill never races a turn. That is CC's form of "refuses while busy". `/md-unlog` is `immediate: true`.
- "At the 4 MiB cap it unlinks the note" means it **detaches the link** (the md-log sense of "unlink"). `$.fs` has no delete.
- omp restores the link on `session_switch` as well as `session_start`. `session_start` fires once at startup (src/modes/runtime-init.ts:163), while `/new`, `/resume` and fork emit `session_switch` (src/session/agent-session.ts:8442, 8535, 9650). Without this, a new session would keep writing into the old note.
- CC clears the link on `session.end` (`/clear`, `/resume`, `/branch`; reference.md:117).
- `appendBlocks` makes "live append" equal "backfill": the original put two blank lines between live blocks and one between backfilled blocks (md-log.ts:75 vs 456).
- Callout bodies quote every line of multi-line values, so typed "Other" text with newlines stays inside the callout.
- Native-ask answer titles keep the original "Answer" / "Question — cancelled" / "Question — unavailable". The question title gains the header: `Question — <header>`. Errors map to `unavailable` with the tool's message, and omp's "Chat about this" maps to `cancelled`.

## Files (whole phase)

```
shared/quiz-contract.ts                       shared/quiz-contract.test.ts
plugins/md-log/package.json
plugins/md-log/src/core/entries.ts            plugins/md-log/src/core/format.ts
plugins/md-log/src/core/queue.ts              plugins/md-log/src/core/from-omp.ts
plugins/md-log/src/core/from-claude.ts
plugins/md-log/src/omp.ts                     plugins/md-log/src/claude.ts
plugins/md-log/test/entries.test.ts           plugins/md-log/test/format.test.ts
plugins/md-log/test/queue.test.ts             plugins/md-log/test/from-omp.test.ts
plugins/md-log/test/from-claude.test.ts       plugins/md-log/test/parity.test.ts
plugins/md-log/test/omp.test.ts               plugins/md-log/test/fixtures/session.ts
plugins/md-log/test/golden/blocks.md          plugins/md-log/test/golden/session.md
plugins/md-log/test/claude/engine.ts          plugins/md-log/test/claude/md-log.test.ts
test-support/fake-omp.ts                      (additive)
```

---

### Task 1: Quiz contract (`shared/quiz-contract.ts`)

**Files:**
- Create: `shared/quiz-contract.ts`
- Test: `shared/quiz-contract.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import {
  decodeQuizResult, displayedOptions, displayOrder, encodeQuizResult, normalizeOptions, type QuizResultDetails,
} from "./quiz-contract.ts";

const PLANETS = ["Mercury", "Venus", "Earth", "Mars", "Jupiter"].map((label) => ({ label }));

const DETAILS: QuizResultDetails = {
  status: "answered",
  question: "Which planet is closest to the Sun?",
  mode: "single-select",
  answers: [{ label: "Mercury", value: "Mercury", index: 2 }],
  correctIndices: [2],
  options: [{ index: 1, label: "Venus" }, { index: 2, label: "Mercury" }],
  correct: true,
  explanation: "Mercury orbits at 0.39 AU.",
};

describe("normalizeOptions", () => {
  test("trims labels, values and descriptions, defaults the value to the label, and drops blank labels", () => {
    expect(normalizeOptions([
      { label: "  Mercury ", description: "  closest " },
      { label: "   " },
      { label: "Venus", value: " v " },
      { label: "Earth", value: "   ", description: "  " },
    ])).toEqual([
      { label: "Mercury", value: "Mercury", description: "closest" },
      { label: "Venus", value: "v" },
      { label: "Earth", value: "Earth" },
    ]);
  });

  test("rejects two options with the same value, naming it", () => {
    expect(() => normalizeOptions([{ label: "A", value: "x" }, { label: "B", value: " x " }]))
      .toThrow('duplicate option value "x"');
  });
});

describe("displayOrder", () => {
  test("gives the same order on every call for the same question and options", () => {
    const input = { question: "Which planet is closest to the Sun?", options: PLANETS };
    const first = displayOrder(input).map((o) => o.label);
    for (let i = 0; i < 5; i++) expect(displayOrder(input).map((o) => o.label)).toEqual(first);
  });

  test("shows every normalized option exactly once", () => {
    const order = displayOrder({ question: "Pick a planet", options: [...PLANETS, { label: "  " }] });
    expect(order.map((o) => o.label).sort()).toEqual(["Earth", "Jupiter", "Mars", "Mercury", "Venus"]);
  });

  test("keeps the author's order when shuffle is false", () => {
    expect(displayOrder({ question: "Pick a planet", options: PLANETS, shuffle: false }).map((o) => o.label))
      .toEqual(["Mercury", "Venus", "Earth", "Mars", "Jupiter"]);
  });

  test("varies the order with the question text", () => {
    const orders = new Set<string>();
    for (let i = 0; i < 20; i++) {
      orders.add(displayOrder({ question: `Question ${i}`, options: PLANETS }).map((o) => o.label).join("|"));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  test("rejects duplicate option values like normalizeOptions", () => {
    expect(() => displayOrder({ question: "q", options: [{ label: "A" }, { label: "A" }] }))
      .toThrow('duplicate option value "A"');
  });
});

describe("displayedOptions", () => {
  test("numbers the options from 1 in display order", () => {
    const order = displayOrder({ question: "Pick a planet", options: PLANETS });
    expect(displayedOptions(order)).toEqual(order.map((o, i) => ({ index: i + 1, label: o.label })));
  });
});

describe("encodeQuizResult / decodeQuizResult", () => {
  test("round-trips details, even when a string contains the closing tag", () => {
    const tricky = { ...DETAILS, explanation: "Literal </quiz-result> and <b>tags</b> survive." };
    expect(decodeQuizResult(encodeQuizResult(tricky))).toEqual(tricky);
  });

  test("finds the first block inside surrounding model text", () => {
    const text = `Correct ✓\n\n${encodeQuizResult(DETAILS)}\n\n${encodeQuizResult({ ...DETAILS, correct: false })}`;
    expect(decodeQuizResult(text)).toEqual(DETAILS);
  });

  test("returns undefined when the block is absent, unterminated, or not JSON", () => {
    expect(decodeQuizResult("Correct ✓")).toBeUndefined();
    expect(decodeQuizResult(`<quiz-result>${JSON.stringify(DETAILS)}`)).toBeUndefined();
    expect(decodeQuizResult("<quiz-result>{status: answered}</quiz-result>")).toBeUndefined();
  });

  test("returns undefined when the JSON is not quiz result details", () => {
    expect(decodeQuizResult("<quiz-result>{}</quiz-result>")).toBeUndefined();
    expect(decodeQuizResult(`<quiz-result>${JSON.stringify({ ...DETAILS, status: "graded" })}</quiz-result>`))
      .toBeUndefined();
    expect(decodeQuizResult(`<quiz-result>${JSON.stringify({ ...DETAILS, answers: "none" })}</quiz-result>`))
      .toBeUndefined();
  });
});
```

**Step 2: Run it, expect failure**

Run: `npx vitest run shared/quiz-contract.test.ts`
Expected: FAIL, `Failed to load url ./quiz-contract.ts` (module missing).

**Step 3: Implement**

This is the master contract, plus one additive export (`isQuizResultDetails`; see "Requested contract changes"). FNV-1a runs over UTF-8 bytes. `encodeQuizResult` writes `<` inside the JSON as `\u003c`, so a string field containing `</quiz-result>` cannot end the block early. The result is still valid JSON and decodes back to the same text.

```ts
export type QuizStatus = "answered" | "cancelled" | "unavailable";
export type QuizMode = "single-select" | "multi-select";
export interface RawQuizOption { label: string; value?: string; description?: string }
export interface QuizOption { label: string; value: string; description?: string }
export interface OptionAnswer { label: string; value: string; index: number }   // 1-based display index
export interface DisplayedOption { index: number; label: string }                // 1-based display index
export interface QuizInput {
  question: string; details?: string; options: RawQuizOption[];
  multiSelect?: boolean; correctAnswer: string | string[]; explanation: string; shuffle?: boolean;
}
export interface QuizResultDetails {
  status: QuizStatus; question: string; context?: string; mode: QuizMode;
  answers: OptionAnswer[]; correctIndices: number[]; options?: DisplayedOption[];
  correct?: boolean; dontKnow?: boolean; note?: string; explanation?: string; message?: string;
}

/** Trim; value defaults to label; drop empty labels; throw `duplicate option value "<v>"`. Port of quiz.ts:124-140. */
export function normalizeOptions(raw: readonly RawQuizOption[]): QuizOption[] {
  const seen = new Set<string>();
  const out: QuizOption[] = [];
  for (const option of raw) {
    const label = option.label.trim();
    if (label.length === 0) continue;
    const value = option.value?.trim() || label;
    if (seen.has(value)) throw new Error(`duplicate option value "${value}"`);
    seen.add(value);
    const description = option.description?.trim();
    out.push(description ? { label, value, description } : { label, value });
  }
  return out;
}

/** FNV-1a, 32-bit, over the UTF-8 bytes of `text`. */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a tiny seeded PRNG returning floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normalized options in display order. shuffle !== false → Fisher–Yates driven by mulberry32 seeded with
 *  FNV-1a-32 of `question + "\u0000" + values.join("\u0000")`. Same input → same order, in every harness. */
export function displayOrder(input: Pick<QuizInput, "question" | "options" | "shuffle">): QuizOption[] {
  const options = normalizeOptions(input.options);
  if (input.shuffle === false) return options;
  const random = mulberry32(fnv1a32([input.question, ...options.map((o) => o.value)].join("\u0000")));
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const picked = options[j]!;
    options[j] = options[i]!;
    options[i] = picked;
  }
  return options;
}

export function displayedOptions(order: readonly QuizOption[]): DisplayedOption[] {
  return order.map((option, i) => ({ index: i + 1, label: option.label }));
}

const STATUSES: Record<string, true> = { answered: true, cancelled: true, unavailable: true };
const MODES: Record<string, true> = { "single-select": true, "multi-select": true };

/** Structural check of a decoded or `details`-delivered quiz result. */
export function isQuizResultDetails(value: unknown): value is QuizResultDetails {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return STATUSES[String(d.status)] === true
    && typeof d.question === "string"
    && MODES[String(d.mode)] === true
    && Array.isArray(d.answers)
    && Array.isArray(d.correctIndices);
}

const OPEN = "<quiz-result>";
const CLOSE = "</quiz-result>";

/** `<quiz-result>${json}</quiz-result>`; `<` inside the JSON is written as `\u003c`, so no payload can close the block early. */
export function encodeQuizResult(d: QuizResultDetails): string {
  return `${OPEN}${JSON.stringify(d).replace(/</g, "\\u003c")}${CLOSE}`;
}

/** The first block's details; undefined when absent, unterminated, not JSON, or not QuizResultDetails-shaped. */
export function decodeQuizResult(text: string): QuizResultDetails | undefined {
  const start = text.indexOf(OPEN);
  if (start < 0) return undefined;
  const end = text.indexOf(CLOSE, start + OPEN.length);
  if (end < 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start + OPEN.length, end));
  } catch {
    return undefined;
  }
  return isQuizResultDetails(parsed) ? parsed : undefined;
}
```

**Step 4: Run, expect pass**

Run: `npx vitest run shared/quiz-contract.test.ts` → 12 passed. Then `npm run typecheck` → exit 0.

**Step 5: Build and commit**

```bash
npm run build && npm run check
git add shared/quiz-contract.ts shared/quiz-contract.test.ts dist .claude-plugin .omp-plugin
git commit -m "feat(shared): add quiz contract (deterministic shuffle, result block)"
```

---

### Task 2: md-log entry model and formatter (golden `blocks.md`)

**Files:**
- Create: `plugins/md-log/package.json`, `plugins/md-log/src/core/entries.ts`, `plugins/md-log/src/core/format.ts`
- Test: `plugins/md-log/test/entries.test.ts`, `plugins/md-log/test/format.test.ts`, `plugins/md-log/test/golden/blocks.md`

`plugins/md-log/package.json` (the catalogs list md-log from this commit; it does nothing until Task 7):

```json
{
  "name": "@learning-plugins/md-log",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Mirror the session (prompts, prose, quiz and question answers) into a markdown note."
}
```

**Step 1: Write the failing tests and the golden file**

`plugins/md-log/test/entries.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { displayOrder } from "../../../shared/quiz-contract.ts";
import { askQuestionEntries, assistantEntry, quizQuestionEntry, userEntry } from "../src/core/entries.ts";

describe("userEntry", () => {
  test("replaces each skill declaration with a one-line note", () => {
    expect(userEntry('  <skill name="teach">\nlong\n</skill>\nand <skill>x</skill> go  ')).toEqual({
      kind: "user",
      text: "> [!note] SKILL loaded: teach\nand > [!note] SKILL loaded: (unknown) go",
    });
  });

  test("skips a prompt with no readable text", () => {
    expect(userEntry(" \n\t ")).toBeUndefined();
  });
});

describe("assistantEntry", () => {
  test("joins the non-blank text parts with a blank line", () => {
    expect(assistantEntry([" First. ", "  ", "Second."])).toEqual({ kind: "assistant", text: "First.\n\nSecond." });
  });

  test("skips a message whose text parts are all blank", () => {
    expect(assistantEntry(["", " \n "])).toBeUndefined();
  });
});

describe("quizQuestionEntry", () => {
  const input = {
    question: "Which planet is closest to the Sun?",
    details: "  Think orbits. ",
    options: [{ label: "Venus" }, { label: "Mercury" }, { label: "Mars" }, { label: "Earth" }],
    correctAnswer: "Mercury",
    explanation: "e",
  };

  test("lists the options in the quiz contract's display order, never the answer", () => {
    expect(quizQuestionEntry(input)).toEqual({
      kind: "question",
      title: "Quiz",
      question: "Which planet is closest to the Sun?",
      context: "Think orbits.",
      options: displayOrder(input).map((o) => o.label),
    });
  });

  test("keeps the author's order when the call sets shuffle: false", () => {
    expect(quizQuestionEntry({ ...input, shuffle: false })).toMatchObject({
      options: ["Venus", "Mercury", "Mars", "Earth"],
    });
  });

  test("still logs the question, without options, when option values collide", () => {
    expect(quizQuestionEntry({ ...input, options: [{ label: "A" }, { label: "A" }] })).toMatchObject({
      question: "Which planet is closest to the Sun?",
      options: [],
    });
  });
});

describe("askQuestionEntries", () => {
  test("writes one question block per asked question, titled with its header when it has one", () => {
    expect(askQuestionEntries({
      questions: [
        { question: "Which runtime?", header: "Runtime", options: [{ label: "Node" }, { label: "Bun" }] },
        { question: "Anything else?", options: [] },
      ],
    })).toEqual([
      { kind: "question", title: "Question — Runtime", question: "Which runtime?", options: ["Node", "Bun"] },
      { kind: "question", title: "Question", question: "Anything else?", options: [] },
    ]);
  });
});
```

`plugins/md-log/test/format.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import type { Entry } from "../src/core/entries.ts";
import { appendBlocks, formatEntry, formatLog } from "../src/core/format.ts";

const SHOWN = [{ index: 1, label: "A" }, { index: 2, label: "B" }];

/** One entry of every kind and outcome. */
const EVERY_BLOCK: Entry[] = [
  { kind: "user", text: "Plain prompt." },
  { kind: "assistant", text: "Prose with $x^2$ math." },
  { kind: "question", title: "Quiz", question: "Line one\nLine two", context: "Some context.", options: ["A", "B"] },
  { kind: "question", title: "Question — Pace", question: "No options here?", options: [] },
  {
    kind: "quiz-answer",
    details: {
      status: "answered", question: "q", mode: "single-select", answers: [{ index: 1, label: "A", value: "a" }],
      correctIndices: [2], options: SHOWN, correct: false, explanation: "Because B.",
    },
  },
  {
    kind: "quiz-answer",
    details: {
      status: "answered", question: "q", mode: "single-select", answers: [], correctIndices: [2], options: SHOWN,
      dontKnow: true, note: "No idea\nat all", explanation: "B.",
    },
  },
  {
    kind: "quiz-answer",
    details: {
      status: "answered", question: "q", mode: "multi-select", answers: [], correctIndices: [1, 3], options: SHOWN,
      correct: false,
    },
  },
  { kind: "quiz-answer", details: { status: "cancelled", question: "q", mode: "single-select", answers: [], correctIndices: [] } },
  {
    kind: "quiz-answer",
    details: {
      status: "unavailable", question: "q", mode: "single-select", answers: [], correctIndices: [],
      message: "quiz requires interactive mode UI",
    },
  },
  {
    kind: "ask-answer",
    outcome: {
      status: "answered",
      items: [{ kind: "option", index: 2, label: "Fast" }, { kind: "other", text: "Line A\nLine B" }],
      note: "Felt rushed",
    },
  },
  { kind: "ask-answer", outcome: { status: "answered", items: [] } },
  { kind: "ask-answer", outcome: { status: "cancelled" } },
  { kind: "ask-answer", outcome: { status: "unavailable", message: "Ask tool was cancelled by the user" } },
];

test("every entry kind and outcome formats as golden/blocks.md", async () => {
  await expect(formatLog(EVERY_BLOCK)).toMatchFileSnapshot("golden/blocks.md");
});

describe("appendBlocks", () => {
  test("appending entries one at a time to an empty note equals backfilling them at once", () => {
    let note = "";
    for (const entry of EVERY_BLOCK) note = appendBlocks(note, [formatEntry(entry)]);
    expect(note).toBe(formatLog(EVERY_BLOCK));
  });

  test("keeps existing note content and separates the first block by one blank line", () => {
    expect(appendBlocks("# My notes", ["> [!quote] YOU\n\nHi"])).toBe("# My notes\n\n> [!quote] YOU\n\nHi\n");
    expect(appendBlocks("# My notes\n", ["B"])).toBe("# My notes\n\nB\n");
  });

  test("writes the block alone into a blank note", () => {
    expect(appendBlocks("", ["B"])).toBe("B\n");
  });
});
```

Create `plugins/md-log/test/golden/blocks.md` by hand with exactly this content (it ends with one newline after the last line). It is the spec ported from md-log.ts:84-202. Check it against the original before trusting it.

```markdown
> [!quote] YOU

Plain prompt.

> [!abstract] AGENT

Prose with $x^2$ math.

> [!question] Quiz
> Line one
> Line two
>
> Some context.
>
> 1. A
> 2. B

> [!question] Question — Pace
> No options here?

> [!failure] Quiz — incorrect ✗
> Your answer: 1. A
> Correct answer: 2. B
>
> Because B.

> [!question] Quiz — I don't know
> Your answer: I don't know
> Correct answer: 2. B
>
> Note: No idea
> at all
>
> B.

> [!failure] Quiz — incorrect ✗
> Your answer: (none)
> Correct answer: 1. A, 3

> [!warning] Quiz — cancelled
> (user skipped)

> [!warning] Quiz — unavailable
> quiz requires interactive mode UI

> [!example] Answer
> 2. Fast
> Other: Line A
> Line B
>
> Note: Felt rushed

> [!example] Answer
> (no answer)

> [!warning] Question — cancelled
> (user skipped)

> [!warning] Question — unavailable
> Ask tool was cancelled by the user
```

**Step 2: Run, expect failure**

Run: `npx vitest run plugins/md-log/test/entries.test.ts plugins/md-log/test/format.test.ts`
Expected: FAIL, modules `../src/core/entries.ts` / `../src/core/format.ts` not found.

**Step 3: Implement**

`plugins/md-log/src/core/entries.ts`:

```ts
import { displayOrder, type QuizResultDetails, type RawQuizOption } from "../../../../shared/quiz-contract.ts";

/** One answered line: a chosen option (1-based, as shown) or text the user typed instead. */
export type AskAnswerItem =
  | { kind: "option"; index: number; label: string }
  | { kind: "other"; text: string };

export type AskOutcome =
  | { status: "answered"; items: AskAnswerItem[]; note?: string }
  | { status: "cancelled" }
  | { status: "unavailable"; message: string };

/** What md-log writes, harness-neutral. The same entries format byte-identically in both harnesses. */
export type Entry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "question"; title: string; question: string; context?: string; options: string[] }
  | { kind: "quiz-answer"; details: QuizResultDetails }
  | { kind: "ask-answer"; outcome: AskOutcome };

export const NO_RESULT = "No answer was recorded.";

/**
 * Skill declarations (`<skill name="…">…</skill>`) are system-injected context, not prose:
 * each becomes a one-line note. Port of md-log.ts:100-108.
 */
function stripSkillBlocks(text: string): string {
  return text.replace(/<skill\b([^>]*)>[\s\S]*?<\/skill>/g, (_match, attrs: string) =>
    `> [!note] SKILL loaded: ${/name="([^"]+)"/.exec(attrs)?.[1] ?? "(unknown)"}`);
}

/** A user prompt, trimmed and skill-stripped; undefined when nothing readable is left. */
export function userEntry(raw: string): Entry | undefined {
  const text = stripSkillBlocks(raw.trim());
  return text ? { kind: "user", text } : undefined;
}

/** Assistant prose from its text parts; undefined when every part is blank. */
export function assistantEntry(parts: readonly string[]): Entry | undefined {
  const text = parts.map((p) => p.trim()).filter((p) => p.length > 0).join("\n\n");
  return text ? { kind: "assistant", text } : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The quiz question in the order the user sees it (quiz contract), from the tool input alone. */
export function quizQuestionEntry(input: unknown): Entry {
  const args = asRecord(input) ?? {};
  const question = asText(args.question);
  const context = asText(args.details).trim() || undefined;
  const raw: RawQuizOption[] = (Array.isArray(args.options) ? args.options : [])
    .map(asRecord)
    .filter((o): o is Record<string, unknown> => o !== undefined && typeof o.label === "string")
    .map((o) => ({
      label: o.label as string,
      value: typeof o.value === "string" ? o.value : undefined,
      description: typeof o.description === "string" ? o.description : undefined,
    }));
  let options: string[] = [];
  try {
    options = displayOrder({ question, options: raw, shuffle: args.shuffle === false ? false : undefined })
      .map((o) => o.label);
  } catch {
    // Duplicate option values: the quiz itself answers "unavailable"; log the question without options.
  }
  return { kind: "question", title: "Quiz", question, context, options };
}

/** The graded outcome; a result without usable details is logged as unavailable with `fallback` as the reason. */
export function quizAnswerEntry(details: QuizResultDetails | undefined, fallback: string): Entry {
  return {
    kind: "quiz-answer",
    details: details ?? {
      status: "unavailable",
      question: "",
      mode: "single-select",
      answers: [],
      correctIndices: [],
      message: fallback.trim() || NO_RESULT,
    },
  };
}

/** One native-ask question as both harnesses phrase it (omp `ask`, CC `AskUserQuestion`). */
export interface AskQuestion { question: string; header?: string; options: string[]; multi: boolean }

export function askQuestions(input: unknown): AskQuestion[] {
  const questions = asRecord(input)?.questions;
  return (Array.isArray(questions) ? questions : []).map(asRecord).filter((q) => q !== undefined).map((q) => ({
    question: asText(q.question),
    header: asText(q.header).trim() || undefined,
    options: (Array.isArray(q.options) ? q.options : []).map((o) => asText(asRecord(o)?.label)),
    multi: q.multi === true || q.multiSelect === true,
  }));
}

/** One question block per asked question, written before the user answers. */
export function askQuestionEntries(input: unknown): Entry[] {
  return askQuestions(input).map((q) => ({
    kind: "question",
    title: q.header ? `Question — ${q.header}` : "Question",
    question: q.question,
    options: q.options,
  }));
}

/** A chosen label as an answer line: its 1-based position among the offered options, else typed text. */
export function answerItem(label: string, options: readonly string[]): AskAnswerItem {
  const index = options.indexOf(label);
  return index >= 0 ? { kind: "option", index: index + 1, label } : { kind: "other", text: label };
}
```

`plugins/md-log/src/core/format.ts`:

```ts
import type { QuizResultDetails } from "../../../../shared/quiz-contract.ts";
import type { AskOutcome, Entry } from "./entries.ts";

/** An Obsidian callout. Every body line, including lines inside multi-line values, stays quoted. */
function callout(type: string, title: string, body: readonly string[]): string {
  const lines = [`> [!${type}] ${title}`];
  for (const line of body.flatMap((b) => b.split("\n"))) lines.push(line.length === 0 ? ">" : `> ${line}`);
  return lines.join("\n");
}

function quizAnswer(d: QuizResultDetails): string {
  if (d.status === "cancelled") return callout("warning", "Quiz — cancelled", ["(user skipped)"]);
  if (d.status === "unavailable") return callout("warning", "Quiz — unavailable", [d.message ?? ""]);
  // "I don't know" is a distinct signal, never a red ✗.
  const dontKnow = d.dontKnow === true;
  const correct = d.correct === true;
  const body = [
    dontKnow
      ? "Your answer: I don't know"
      : `Your answer: ${d.answers.map((a) => `${a.index}. ${a.label}`).join(", ") || "(none)"}`,
    `Correct answer: ${d.correctIndices.map((i) => {
      const label = d.options?.find((o) => o.index === i)?.label;
      return label ? `${i}. ${label}` : `${i}`;
    }).join(", ")}`,
  ];
  if (d.note) body.push("", `Note: ${d.note}`);
  if (d.explanation) body.push("", d.explanation);
  return callout(
    dontKnow ? "question" : correct ? "success" : "failure",
    dontKnow ? "Quiz — I don't know" : correct ? "Quiz — correct ✓" : "Quiz — incorrect ✗",
    body,
  );
}

function askAnswer(o: AskOutcome): string {
  if (o.status === "cancelled") return callout("warning", "Question — cancelled", ["(user skipped)"]);
  if (o.status === "unavailable") return callout("warning", "Question — unavailable", [o.message]);
  const body = o.items.map((i) => (i.kind === "option" ? `${i.index}. ${i.label}` : `Other: ${i.text}`));
  if (body.length === 0) body.push("(no answer)");
  if (o.note) body.push("", `Note: ${o.note}`);
  return callout("example", "Answer", body);
}

/** One entry as a markdown block (no trailing newline). Port of md-log.ts:84-202, heading AGENT instead of PI. */
export function formatEntry(e: Entry): string {
  switch (e.kind) {
    case "user":
      return `> [!quote] YOU\n\n${e.text}`;
    case "assistant":
      return `> [!abstract] AGENT\n\n${e.text}`;
    case "question": {
      const body = [e.question];
      if (e.context) body.push("", e.context);
      if (e.options.length > 0) body.push("", ...e.options.map((label, i) => `${i + 1}. ${label}`));
      return callout("question", e.title, body);
    }
    case "quiz-answer":
      return quizAnswer(e.details);
    case "ask-answer":
      return askAnswer(e.outcome);
  }
}

/** A whole note, as `/md-log` backfills it: blocks separated by one blank line, newline-terminated. */
export function formatLog(entries: readonly Entry[]): string {
  return entries.length === 0 ? "" : `${entries.map(formatEntry).join("\n\n")}\n`;
}

/**
 * `current` with `blocks` appended so that appending to a backfilled note yields the same text as
 * backfilling everything at once. Existing content is never rewritten. Port of md-log.ts:68-80.
 */
export function appendBlocks(current: string, blocks: readonly string[]): string {
  let out = current;
  for (const block of blocks) {
    const sep = out.trim().length === 0 || out.endsWith("\n\n") ? "" : out.endsWith("\n") ? "\n" : "\n\n";
    out = `${out}${sep}${block}\n`;
  }
  return out;
}
```

**Step 4: Run, expect pass**

Run the same command → all pass (entries 9, format 4). `npm run typecheck` → exit 0.

**Step 5: Build and commit**

```bash
npm run build && npm run check
git add plugins/md-log dist .claude-plugin .omp-plugin
git commit -m "feat(md-log): add entry model and markdown formatter"
```

---

### Task 3: Serial write queue

**Files:**
- Create: `plugins/md-log/src/core/queue.ts`
- Test: `plugins/md-log/test/queue.test.ts`

**Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { createSerialQueue } from "../src/core/queue.ts";

test("runs tasks one at a time in call order, even when an earlier task is slower", async () => {
  const queue = createSerialQueue();
  const log: string[] = [];
  const slow = queue.run(async () => {
    await new Promise((r) => setTimeout(r, 20));
    log.push("slow");
  });
  const fast = queue.run(async () => {
    log.push("fast");
  });
  await Promise.all([slow, fast]);
  expect(log).toEqual(["slow", "fast"]);
});

test("a failed task rejects its own run and does not stop later tasks", async () => {
  const queue = createSerialQueue();
  const failed = queue.run(async () => {
    throw new Error("disk full");
  });
  const later = queue.run(async () => "written");
  await expect(failed).rejects.toThrow("disk full");
  await expect(later).resolves.toBe("written");
});
```

**Step 2:** `npx vitest run plugins/md-log/test/queue.test.ts` → FAIL, module not found.

**Step 3: Implement**

```ts
/** Runs tasks one at a time in the order `run` was called. A failed task rejects only its own `run`. */
export interface SerialQueue { run<T>(task: () => Promise<T>): Promise<T> }

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
```

**Step 4:** Same command → 2 passed.

**Step 5:**

```bash
npm run build && npm run check
git add plugins/md-log dist
git commit -m "feat(md-log): add serial write queue"
```

---

### Task 4: omp mapping (messages, `quiz`, native `ask`)

**Files:**
- Create: `plugins/md-log/src/core/from-omp.ts`, `plugins/md-log/test/fixtures/session.ts`
- Test: `plugins/md-log/test/from-omp.test.ts`

The fixture is shared by Tasks 4-7. It records one session in both harnesses' shapes.

**Step 1: Write the fixture and the failing test**

`plugins/md-log/test/fixtures/session.ts`:

```ts
import { displayedOptions, displayOrder, encodeQuizResult, type QuizResultDetails } from "../../../../shared/quiz-contract.ts";
import type { ClaudeMessage } from "../../src/core/from-claude.ts";
import type { OmpMessage } from "../../src/core/from-omp.ts";

/** One teaching exchange, recorded once per harness. Both must log as golden/session.md. */
export const PROMPT =
  '<skill name="teach" location="/skills/teach/SKILL.md">\nWhole skill text.\n</skill>\n\nTeach me what makes a number prime.';
export const PROSE_1 = "A prime has exactly two divisors: 1 and itself.\n\nQuick check:";
export const PROSE_2 = "Right. Now a preference question.";
export const PROSE_3 = "Slow it is. Next lesson: factor trees.";

export const QUIZ_INPUT = {
  question: "Which of these is prime?",
  details: "Pick one.",
  options: [{ label: "21" }, { label: "29" }, { label: "33" }],
  correctAnswer: "29",
  explanation: "29 has no divisors other than 1 and 29.\n21 = 3 × 7 and 33 = 3 × 11.",
};
const ORDER = displayOrder(QUIZ_INPUT);
const PICKED = ORDER.findIndex((o) => o.value === "29") + 1;
export const QUIZ_DETAILS: QuizResultDetails = {
  status: "answered",
  question: QUIZ_INPUT.question,
  context: QUIZ_INPUT.details,
  mode: "single-select",
  answers: [{ label: "29", value: "29", index: PICKED }],
  correctIndices: [PICKED],
  options: displayedOptions(ORDER),
  correct: true,
  note: "Odd numbers fooled me once.",
  explanation: QUIZ_INPUT.explanation,
};

const QUESTION = "How fast should we go?";
export const OMP_ASK_INPUT = {
  questions: [{ id: "pace", question: QUESTION, header: "Pace", options: [{ label: "Slow" }, { label: "Fast" }] }],
};
export const OMP_ASK_DETAILS = { question: QUESTION, options: ["Slow", "Fast"], multi: false, selectedOptions: ["Slow"] };
export const CLAUDE_ASK_INPUT = {
  questions: [{
    question: QUESTION,
    header: "Pace",
    options: [{ label: "Slow", description: "One idea at a time" }, { label: "Fast", description: "Skim" }],
    multiSelect: false,
  }],
};
export const CLAUDE_ASK_RESULT = { questions: CLAUDE_ASK_INPUT.questions, answers: { [QUESTION]: "Slow" } };

/** omp's active branch, as `ctx.sessionManager.getBranch()` messages (pi-ai types.d.ts:760-903). */
export const OMP_MESSAGES: OmpMessage[] = [
  { role: "user", content: PROMPT },
  {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "Use a quiz." },
      { type: "text", text: PROSE_1 },
      { type: "toolCall", id: "call-quiz", name: "quiz", arguments: QUIZ_INPUT },
    ],
  },
  { role: "toolResult", toolCallId: "call-quiz", toolName: "quiz", content: [{ type: "text", text: "Correct ✓" }], details: QUIZ_DETAILS, isError: false },
  {
    role: "assistant",
    content: [{ type: "text", text: PROSE_2 }, { type: "toolCall", id: "call-ask", name: "ask", arguments: OMP_ASK_INPUT }],
  },
  { role: "toolResult", toolCallId: "call-ask", toolName: "ask", content: [{ type: "text", text: "User selected: Slow" }], details: OMP_ASK_DETAILS, isError: false },
  { role: "assistant", content: [{ type: "text", text: PROSE_3 }] },
];

/** CC's transcript, as `$.session.messages()` returns it (cc.d.ts:8964-8990, 10180-10211). */
export const CLAUDE_MESSAGES: ClaudeMessage[] = [
  { role: "user", text: PROMPT, toolUses: [] },
  {
    role: "assistant",
    text: PROSE_1,
    toolUses: [{
      tool_use_id: "toolu_quiz",
      tool: "mcp__quiz__quiz",
      input: QUIZ_INPUT,
      result: `Correct ✓\n\n${encodeQuizResult(QUIZ_DETAILS)}`,
      text: `Correct ✓\n\n${encodeQuizResult(QUIZ_DETAILS)}`,
    }],
  },
  { role: "user", text: "", toolUses: [] },
  {
    role: "assistant",
    text: PROSE_2,
    toolUses: [{
      tool_use_id: "toolu_ask",
      tool: "AskUserQuestion",
      input: CLAUDE_ASK_INPUT,
      result: CLAUDE_ASK_RESULT,
      text: 'User has answered your questions: "How fast should we go?"="Slow".',
    }],
  },
  { role: "user", text: "", toolUses: [] },
  { role: "assistant", text: PROSE_3, toolUses: [] },
];
```

`plugins/md-log/test/from-omp.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { ompToolCallEntries, ompToolResultEntries } from "../src/core/from-omp.ts";
import { QUIZ_DETAILS, QUIZ_INPUT } from "./fixtures/session.ts";

const ASK_INPUT = {
  questions: [
    { id: "lang", question: "Which language?", header: "Language", options: [{ label: "TS" }, { label: "Go" }] },
    { id: "extras", question: "Which extras?", multi: true, options: [{ label: "Lint" }, { label: "Docs" }] },
  ],
};
const ok = (details: unknown, text = "") => ({ details, isError: false, text });

describe("omp ask answers", () => {
  test("a single question's picked option is numbered as offered, typed text becomes Other, the note is kept", () => {
    const input = { questions: [ASK_INPUT.questions[0]] };
    expect(ompToolResultEntries("ask", input, ok({
      question: "Which language?", options: ["TS", "Go"], multi: false, selectedOptions: ["Go"], note: "for speed",
    }))).toEqual([{ kind: "ask-answer", outcome: { status: "answered", items: [{ kind: "option", index: 2, label: "Go" }], note: "for speed" } }]);
    expect(ompToolResultEntries("ask", input, ok({
      question: "Which language?", options: ["TS", "Go"], multi: false, selectedOptions: [], customInput: "Rust",
    }))).toEqual([{ kind: "ask-answer", outcome: { status: "answered", items: [{ kind: "other", text: "Rust" }] } }]);
  });

  test("several questions answer in question order from details.results", () => {
    expect(ompToolResultEntries("ask", ASK_INPUT, ok({
      results: [
        { id: "lang", question: "Which language?", options: ["TS", "Go"], multi: false, selectedOptions: ["TS"] },
        { id: "extras", question: "Which extras?", options: ["Lint", "Docs"], multi: true, selectedOptions: [] },
      ],
    }))).toEqual([
      { kind: "ask-answer", outcome: { status: "answered", items: [{ kind: "option", index: 1, label: "TS" }] } },
      { kind: "ask-answer", outcome: { status: "answered", items: [] } },
    ]);
  });

  test("'Chat about this' counts as cancelled for every question", () => {
    expect(ompToolResultEntries("ask", ASK_INPUT, ok({ chatRedirect: true, questions: ["Which language?", "Which extras?"] })))
      .toEqual([
        { kind: "ask-answer", outcome: { status: "cancelled" } },
        { kind: "ask-answer", outcome: { status: "cancelled" } },
      ]);
  });

  test("a cancelled or failed call is unavailable, with the tool's message", () => {
    const input = { questions: [ASK_INPUT.questions[0]] };
    expect(ompToolResultEntries("ask", input, { details: undefined, isError: true, text: "Ask tool was cancelled by the user" }))
      .toEqual([{ kind: "ask-answer", outcome: { status: "unavailable", message: "Ask tool was cancelled by the user" } }]);
    expect(ompToolResultEntries("ask", input, ok({}, "Error: questions must not be empty")))
      .toEqual([{ kind: "ask-answer", outcome: { status: "unavailable", message: "Error: questions must not be empty" } }]);
  });
});

describe("omp quiz answers", () => {
  test("use the result's details", () => {
    expect(ompToolResultEntries("quiz", QUIZ_INPUT, ok(QUIZ_DETAILS, "Correct ✓")))
      .toEqual([{ kind: "quiz-answer", details: QUIZ_DETAILS }]);
  });

  test("are unavailable, with the result text, when details are missing", () => {
    expect(ompToolResultEntries("quiz", QUIZ_INPUT, { details: undefined, isError: true, text: "boom" }))
      .toMatchObject([{ kind: "quiz-answer", details: { status: "unavailable", message: "boom" } }]);
  });
});

test("tools other than quiz and ask log nothing", () => {
  expect(ompToolCallEntries("bash", { command: "ls" })).toEqual([]);
  expect(ompToolResultEntries("bash", { command: "ls" }, ok(undefined, "out"))).toEqual([]);
});
```

**Step 2:** `npx vitest run plugins/md-log/test/from-omp.test.ts` → FAIL, `../src/core/from-omp.ts` not found. (The fixture's `import type` from `from-claude.ts` is erased by Vitest, so the missing file does not matter until Task 5.)

**Step 3: Implement** `plugins/md-log/src/core/from-omp.ts`:

```ts
import { isQuizResultDetails } from "../../../../shared/quiz-contract.ts";
import { toolName } from "../../../../shared/tool-map.ts";
import {
  answerItem, askQuestionEntries, askQuestions, asRecord, asText, assistantEntry, NO_RESULT,
  quizAnswerEntry, quizQuestionEntry, userEntry, type AskOutcome, type Entry,
} from "./entries.ts";

const QUIZ = toolName("quiz", "omp");
const ASK = toolName("ask", "omp");

/** The parts of an omp `AgentMessage` md-log reads (`@oh-my-pi/pi-ai` types.d.ts:760-903). */
export interface OmpMessage {
  readonly role: string;
  readonly content?: unknown;
  readonly toolCallId?: unknown;
  readonly toolName?: unknown;
  readonly details?: unknown;
  readonly isError?: unknown;
}

/** Text blocks of a message content (`string | (TextContent | …)[]`), joined with `sep`. */
export function contentText(content: unknown, sep = "\n"): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(asRecord).filter((c) => c?.type === "text").map((c) => asText(c?.text)).join(sep);
}

/** A user prompt or assistant prose; undefined for tool results and anything without readable text. */
export function ompTextEntry(message: OmpMessage): Entry | undefined {
  if (message.role === "user") return userEntry(contentText(message.content));
  if (message.role !== "assistant" || !Array.isArray(message.content)) return undefined;
  return assistantEntry(message.content.map(asRecord).filter((c) => c?.type === "text").map((c) => asText(c?.text)));
}

/** Question blocks for a `quiz` or native `ask` call, from its input; [] for every other tool. */
export function ompToolCallEntries(tool: string, input: unknown): Entry[] {
  if (tool === QUIZ) return [quizQuestionEntry(input)];
  if (tool === ASK) return askQuestionEntries(input);
  return [];
}

export interface OmpToolResult { details: unknown; isError: boolean; text: string }

/**
 * omp `ask` outcome per asked question. Shapes from `@oh-my-pi/pi-tui@18.2.10` tools/ask.d.ts:5-34
 * (`AskToolDetails`, `QuestionResult`) as filled by pi-coding-agent src/tools/ask.ts:980,1019-1031,1082-1100,1160:
 * one question → `{question, options, multi, selectedOptions, customInput?, note?, timedOut?}`;
 * several → `{results: QuestionResult[]}`; "Chat about this" → `{chatRedirect: true, questions}`;
 * cancel or headless → the tool throws, so `tool_result` has `isError: true`, `details: undefined`
 * (extensions/wrapper.ts:363-384); bad input → `details: {}` and an `Error: …` text.
 */
function ompAskOutcomes(input: unknown, result: OmpToolResult): AskOutcome[] {
  const questions = askQuestions(input);
  const details = asRecord(result.details);
  const unavailable: AskOutcome = { status: "unavailable", message: result.text.trim() || NO_RESULT };
  if (result.isError || !details) return questions.map(() => unavailable);
  if (details.chatRedirect === true) return questions.map(() => ({ status: "cancelled" }));
  const results = Array.isArray(details.results)
    ? details.results.map(asRecord)
    : Array.isArray(details.selectedOptions) ? [details] : undefined;
  if (!results) return questions.map(() => unavailable);
  return questions.map((q, i) => {
    const r = results[i];
    const items = (Array.isArray(r?.selectedOptions) ? r.selectedOptions : [])
      .map((label) => answerItem(asText(label), q.options));
    if (typeof r?.customInput === "string") items.push({ kind: "other", text: r.customInput });
    const note = asText(r?.note).trim() || undefined;
    return note ? { status: "answered", items, note } : { status: "answered", items };
  });
}

/** Answer blocks for a finished `quiz` or native `ask` call; [] for every other tool. */
export function ompToolResultEntries(tool: string, input: unknown, result: OmpToolResult): Entry[] {
  if (tool === QUIZ) {
    return [quizAnswerEntry(isQuizResultDetails(result.details) ? result.details : undefined, result.text)];
  }
  if (tool === ASK) return ompAskOutcomes(input, result).map((outcome) => ({ kind: "ask-answer", outcome }));
  return [];
}

/**
 * The active branch's messages as entries, in the order live logging writes them: prose, then the
 * questions of that message's quiz/ask calls, then each call's answer at its tool result.
 */
export function backfillFromOmp(messages: readonly OmpMessage[]): Entry[] {
  const inputs = new Map<string, unknown>();
  const out: Entry[] = [];
  for (const message of messages) {
    const prose = ompTextEntry(message);
    if (prose) out.push(prose);
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content.map(asRecord)) {
        if (block?.type !== "toolCall") continue;
        const name = asText(block.name);
        const calls = ompToolCallEntries(name, block.arguments);
        if (calls.length > 0) inputs.set(asText(block.id), block.arguments);
        out.push(...calls);
      }
    }
    if (message.role === "toolResult") {
      const id = asText(message.toolCallId);
      if (!inputs.has(id)) continue;
      out.push(...ompToolResultEntries(asText(message.toolName), inputs.get(id), {
        details: message.details,
        isError: message.isError === true,
        text: contentText(message.content),
      }));
    }
  }
  return out;
}
```

**Step 4:** Same command → 7 passed. `npm run typecheck` reports only the missing `../../src/core/from-claude.ts` (created in Task 5). Typecheck again at the end of Task 5. `npm run check` is the per-commit gate and passes.

**Step 5:**

```bash
npm run build && npm run check
git add plugins/md-log dist
git commit -m "feat(md-log): map omp messages and tool events to entries"
```

---

### Task 5: Claude Code mapping (`AskUserQuestion`, `mcp__quiz__quiz`, pending pairing, backfill)

**Files:**
- Create: `plugins/md-log/src/core/from-claude.ts`
- Test: `plugins/md-log/test/from-claude.test.ts`

Pairing rule (design: by tool name and input, in order). Scanning back from the newest record, each pending use takes the latest earlier record that has the same tool, the same canonical (key-sorted) JSON input, and an unconsumed `tool_use_id`. Only the answered prefix is returned, so answers are written in order. The scan covers every assistant message, not only the latest, because CC may store a response's blocks as separate messages.

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { encodeQuizResult } from "../../../shared/quiz-contract.ts";
import {
  claudeAnswerEntries, pairPending, type ClaudeMessage, type ClaudeToolUse,
} from "../src/core/from-claude.ts";
import { QUIZ_DETAILS, QUIZ_INPUT } from "./fixtures/session.ts";

const ASK = "AskUserQuestion";
const INPUT = {
  questions: [
    { question: "Which language?", header: "Language", options: [{ label: "TS", description: "" }, { label: "Go", description: "" }], multiSelect: false },
    { question: "Which extras?", header: "Extras", options: [{ label: "Lint", description: "" }, { label: "Docs", description: "" }], multiSelect: true },
  ],
};
const use = (result: unknown, extra: Partial<ClaudeToolUse> = {}): ClaudeToolUse =>
  ({ tool_use_id: "t1", tool: ASK, input: INPUT, result, ...extra });

describe("AskUserQuestion answers", () => {
  test("labels map to offered options, multi-select answers split on commas, notes come from annotations", () => {
    expect(claudeAnswerEntries({ name: ASK, input: INPUT }, use({
      questions: INPUT.questions,
      answers: { "Which language?": "Go", "Which extras?": "Lint, Docs" },
      annotations: { "Which language?": { notes: "for speed" } },
    }))).toEqual([
      { kind: "ask-answer", outcome: { status: "answered", items: [{ kind: "option", index: 2, label: "Go" }], note: "for speed" } },
      {
        kind: "ask-answer",
        outcome: { status: "answered", items: [{ kind: "option", index: 1, label: "Lint" }, { kind: "option", index: 2, label: "Docs" }] },
      },
    ]);
  });

  test("an answer that is not an offered label is text the user typed", () => {
    expect(claudeAnswerEntries({ name: ASK, input: INPUT }, use({
      answers: { "Which language?": "Rust, mostly", "Which extras?": "Lint, tests" },
    }))).toEqual([
      { kind: "ask-answer", outcome: { status: "answered", items: [{ kind: "other", text: "Rust, mostly" }] } },
      { kind: "ask-answer", outcome: { status: "answered", items: [{ kind: "other", text: "Lint, tests" }] } },
    ]);
  });

  test("an errored or missing result is unavailable, with the text the model read", () => {
    expect(claudeAnswerEntries({ name: ASK, input: { questions: [INPUT.questions[0]] } },
      use("User dismissed the question", { isError: true, text: "User dismissed the question" })))
      .toEqual([{ kind: "ask-answer", outcome: { status: "unavailable", message: "User dismissed the question" } }]);
    expect(claudeAnswerEntries({ name: ASK, input: { questions: [INPUT.questions[0]] } }, undefined))
      .toEqual([{ kind: "ask-answer", outcome: { status: "unavailable", message: "No answer was recorded." } }]);
  });
});

describe("quiz answers", () => {
  const quiz = { name: "mcp__quiz__quiz", input: QUIZ_INPUT };
  const block = encodeQuizResult(QUIZ_DETAILS);

  test("decode the <quiz-result> block whether the result is a string or text blocks", () => {
    const expected = [{ kind: "quiz-answer", details: QUIZ_DETAILS }];
    expect(claudeAnswerEntries(quiz, { tool_use_id: "q", tool: quiz.name, input: QUIZ_INPUT, result: `Correct ✓\n\n${block}` }))
      .toEqual(expected);
    expect(claudeAnswerEntries(quiz, {
      tool_use_id: "q", tool: quiz.name, input: QUIZ_INPUT,
      result: [{ type: "text", text: "Correct ✓" }, { type: "text", text: block }],
    })).toEqual(expected);
    expect(claudeAnswerEntries(quiz, { tool_use_id: "q", tool: quiz.name, input: QUIZ_INPUT, text: block })).toEqual(expected);
  });

  test("are unavailable, with the result text, when no block is present", () => {
    expect(claudeAnswerEntries(quiz, { tool_use_id: "q", tool: quiz.name, input: QUIZ_INPUT, result: "boom", isError: true }))
      .toMatchObject([{ kind: "quiz-answer", details: { status: "unavailable", message: "boom" } }]);
  });
});

describe("pairPending", () => {
  const q = (n: number) => ({ question: `Q${n}?`, header: "H", options: [], multiSelect: false });
  const asked = (id: string, n: number, answered = true): ClaudeToolUse => ({
    tool_use_id: id, tool: ASK, input: { questions: [q(n)] }, ...(answered ? { result: { answers: {} } } : {}),
  });
  const msgs = (...uses: ClaudeToolUse[]): ClaudeMessage[] => [
    { role: "user", text: "go", toolUses: [] },
    ...uses.map((u) => ({ role: "assistant" as const, text: "", toolUses: [u] })),
  ];
  const pending = (n: number) => ({ name: ASK, input: { questions: [q(n)] } });

  test("matches by tool and input regardless of key order, newest first", () => {
    const reordered = { questions: [{ multiSelect: false, options: [], header: "H", question: "Q1?" }] };
    expect(pairPending([{ name: ASK, input: reordered }], msgs(asked("old", 1), asked("new", 1)), new Set()))
      .toMatchObject([{ tool_use_id: "new" }]);
  });

  test("never reuses a consumed record, so a repeated question pairs with its own call", () => {
    expect(pairPending([pending(1), pending(1)], msgs(asked("a", 1), asked("b", 1)), new Set()))
      .toMatchObject([{ tool_use_id: "a" }, { tool_use_id: "b" }]);
    expect(pairPending([pending(1)], msgs(asked("a", 1)), new Set(["a"]))).toEqual([]);
  });

  test("returns only the answered prefix so answers stay in order", () => {
    expect(pairPending([pending(1), pending(2)], msgs(asked("a", 1, false), asked("b", 2)), new Set())).toEqual([]);
    expect(pairPending([pending(1), pending(2)], msgs(asked("a", 1), asked("b", 2, false)), new Set()))
      .toMatchObject([{ tool_use_id: "a" }]);
  });
});
```

**Step 2:** `npx vitest run plugins/md-log/test/from-claude.test.ts` → FAIL, exports missing.

**Step 3: Implement** `plugins/md-log/src/core/from-claude.ts`:

```ts
import { decodeQuizResult } from "../../../../shared/quiz-contract.ts";
import { toolName } from "../../../../shared/tool-map.ts";
import {
  answerItem, askQuestionEntries, askQuestions, asRecord, asText, assistantEntry, NO_RESULT,
  quizAnswerEntry, quizQuestionEntry, userEntry, type AskAnswerItem, type AskOutcome, type AskQuestion, type Entry,
} from "./entries.ts";

const QUIZ = toolName("quiz", "claude");
const ASK = toolName("ask", "claude");

/** The parts of CC's `ToolUseSummary` md-log reads (cc.d.ts:10180-10211). */
export interface ClaudeToolUse {
  readonly tool_use_id: string;
  readonly tool: string;
  readonly input: unknown;
  readonly result?: unknown;
  readonly text?: string;
  readonly isError?: true;
}

/** The parts of CC's `SessionMessage` (`$.session.messages()`, cc.d.ts:8964-8990) md-log reads. */
export interface ClaudeMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly toolUses: readonly ClaudeToolUse[];
}

/** A tool use md-log logged a question for and still owes an answer: a `TurnStepToolUse` (cc.d.ts:10581-10590). */
export interface PendingUse { readonly name: string; readonly input: unknown }

export function isQaTool(name: string): boolean {
  return name === QUIZ || name === ASK;
}

/** Question blocks for an `mcp__quiz__quiz` or `AskUserQuestion` use; [] for every other tool. */
export function claudeQuestionEntries(use: PendingUse): Entry[] {
  if (use.name === QUIZ) return [quizQuestionEntry(use.input)];
  if (use.name === ASK) return askQuestionEntries(use.input);
  return [];
}

/** The text a tool result carries: a string, or the `text` blocks of an Anthropic content array. */
function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!Array.isArray(result)) return "";
  return result.map(asRecord).filter((b) => b?.type === "text").map((b) => asText(b?.text)).join("\n");
}

/**
 * `AskUserQuestion`'s record: `{questions, answers: {[question]: label}, response?, annotations?}`,
 * multi-select labels comma-joined (`@anthropic-ai/claude-agent-sdk@0.3.296` sdk-tools.d.ts:3794-3980,
 * built for CC 2.1.296). A label that matches no offered option is text the user typed.
 */
function claudeAskOutcome(q: AskQuestion, record: Record<string, unknown>): AskOutcome {
  const answer = asRecord(record.answers)?.[q.question];
  const note = asText(asRecord(asRecord(record.annotations)?.[q.question])?.notes).trim() || undefined;
  let items: AskAnswerItem[] = [];
  if (typeof answer === "string") {
    const parts = q.multi ? answer.split(",").map((p) => p.trim()).filter((p) => p.length > 0) : [answer];
    items = parts.every((p) => q.options.includes(p))
      ? parts.map((p) => answerItem(p, q.options))
      : [{ kind: "other", text: answer }];
  } else if (typeof record.response === "string" && record.response.trim()) {
    items = [{ kind: "other", text: record.response }];
  }
  return note ? { status: "answered", items, note } : { status: "answered", items };
}

/** Answer blocks for a finished use (`summary` from `$.session.messages()`); [] for every other tool. */
export function claudeAnswerEntries(use: PendingUse, summary: ClaudeToolUse | undefined): Entry[] {
  const message = summary?.text?.trim() || resultText(summary?.result).trim() || NO_RESULT;
  if (use.name === QUIZ) {
    // The quiz appends its `<quiz-result>` block to every result, errors included (quiz contract).
    const details = summary
      ? decodeQuizResult(resultText(summary.result)) ?? decodeQuizResult(summary.text ?? "")
      : undefined;
    return [quizAnswerEntry(details, message)];
  }
  if (use.name !== ASK) return [];
  const record = summary && !summary.isError ? asRecord(summary.result) : undefined;
  return askQuestions(use.input).map((q) => ({
    kind: "ask-answer",
    outcome: record && asRecord(record.answers) ? claudeAskOutcome(q, record) : { status: "unavailable", message },
  }));
}

/** Two tool inputs are the same call's when their JSON matches with object keys sorted. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    const r = asRecord(v);
    return r ? Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]])) : v;
  });
}

function hasOutcome(use: ClaudeToolUse): boolean {
  return use.text !== undefined || use.result !== undefined || use.isError === true;
}

/**
 * Pairs pending uses (in the order the model made them) with their transcript records, anchored at the
 * newest: scanning back from the end, each pending use takes the latest earlier unconsumed record with the
 * same tool name and input. Returns the records for the longest prefix of pending uses that have an
 * outcome, so answers are always written in order; the caller keeps the rest pending.
 */
export function pairPending(
  pending: readonly PendingUse[],
  messages: readonly ClaudeMessage[],
  consumed: ReadonlySet<string>,
): ClaudeToolUse[] {
  const uses = messages.filter((m) => m.role === "assistant").flatMap((m) => m.toolUses);
  const matched: Array<ClaudeToolUse | undefined> = pending.map(() => undefined);
  let cursor = uses.length;
  for (let p = pending.length - 1; p >= 0; p--) {
    const want = pending[p]!;
    const key = canonical(want.input);
    for (let j = cursor - 1; j >= 0; j--) {
      const use = uses[j]!;
      if (use.tool === want.name && !consumed.has(use.tool_use_id) && canonical(use.input) === key) {
        matched[p] = use;
        cursor = j;
        break;
      }
    }
  }
  const done: ClaudeToolUse[] = [];
  for (const use of matched) {
    if (!use || !hasOutcome(use)) break;
    done.push(use);
  }
  return done;
}

export interface ClaudeBackfill { entries: Entry[]; consumed: string[] }

/**
 * The transcript as entries, Q&A paired from each assistant message's `toolUses` (a use with no outcome is
 * logged as unavailable, as live logging does at `turn.complete`); `consumed` lists every logged use's id.
 */
export function backfillFromClaude(messages: readonly ClaudeMessage[]): ClaudeBackfill {
  const entries: Entry[] = [];
  const consumed: string[] = [];
  for (const message of messages) {
    const prose = message.role === "user" ? userEntry(message.text) : assistantEntry([message.text]);
    if (prose) entries.push(prose);
    if (message.role !== "assistant") continue;
    for (const use of message.toolUses) {
      if (!isQaTool(use.tool)) continue;
      const pending = { name: use.tool, input: use.input };
      entries.push(...claudeQuestionEntries(pending), ...claudeAnswerEntries(pending, hasOutcome(use) ? use : undefined));
      consumed.push(use.tool_use_id);
    }
  }
  return { entries, consumed };
}
```

**Step 4:** Same command → 10 passed. `npm run typecheck` → exit 0.

**Step 5:**

```bash
npm run build && npm run check
git add plugins/md-log dist
git commit -m "feat(md-log): map Claude Code transcript and tool uses to entries"
```

---

### Task 6: Golden parity: one session, both harnesses, one file

**Files:**
- Test: `plugins/md-log/test/parity.test.ts`, `plugins/md-log/test/golden/session.md`

**Step 1: Write the test and the golden file**

```ts
import { expect, test } from "vitest";
import { formatLog } from "../src/core/format.ts";
import { backfillFromClaude } from "../src/core/from-claude.ts";
import { backfillFromOmp } from "../src/core/from-omp.ts";
import { CLAUDE_MESSAGES, OMP_MESSAGES } from "./fixtures/session.ts";

test("the omp branch of the scripted session logs as golden/session.md", async () => {
  await expect(formatLog(backfillFromOmp(OMP_MESSAGES))).toMatchFileSnapshot("golden/session.md");
});

test("the CC transcript of the same session logs byte-identically", async () => {
  await expect(formatLog(backfillFromClaude(CLAUDE_MESSAGES).entries)).toMatchFileSnapshot("golden/session.md");
});
```

Create `plugins/md-log/test/golden/session.md` by hand with exactly this content. The quiz options read `33, 29, 21`: `displayOrder` shuffled the author order `21, 29, 33` (prototype-verified for this question text).

```markdown
> [!quote] YOU

> [!note] SKILL loaded: teach

Teach me what makes a number prime.

> [!abstract] AGENT

A prime has exactly two divisors: 1 and itself.

Quick check:

> [!question] Quiz
> Which of these is prime?
>
> Pick one.
>
> 1. 33
> 2. 29
> 3. 21

> [!success] Quiz — correct ✓
> Your answer: 2. 29
> Correct answer: 2. 29
>
> Note: Odd numbers fooled me once.
>
> 29 has no divisors other than 1 and 29.
> 21 = 3 × 7 and 33 = 3 × 11.

> [!abstract] AGENT

Right. Now a preference question.

> [!question] Question — Pace
> How fast should we go?
>
> 1. Slow
> 2. Fast

> [!example] Answer
> 1. Slow

> [!abstract] AGENT

Slow it is. Next lesson: factor trees.
```

**Step 2: Run, expect a meaningful result**

Run: `npx vitest run plugins/md-log/test/parity.test.ts`
Expected: PASS. Tasks 2-5 already implement the behaviour, so this test locks in parity rather than driving new code. To prove it can fail, temporarily change `"Question — "` to `"Question: "` in entries.ts, see both tests FAIL with a snapshot mismatch, then revert. If the quiz lines differ from `33, 29, 21`, the contract implementation deviates from Task 1. Fix the contract, never the golden file.

**Step 3: Commit**

```bash
git add plugins/md-log/test
git commit -m "test(md-log): golden parity of omp and Claude Code backfill"
```

---

### Task 7: omp adapter (`src/omp.ts`)

**Files:**
- Modify: `test-support/fake-omp.ts` (additive)
- Create: `plugins/md-log/src/omp.ts`
- Test: `plugins/md-log/test/omp.test.ts`

Behaviour: `/md-log <file>` resolves against `ctx.cwd`. It refuses an empty argument, a busy agent (`ctx.isIdle()`, extensions/types.d.ts:290-291), a missing path and a non-file. It then backfills the active branch (`ctx.sessionManager.getBranch()`, session-manager.d.ts:410-414) by overwriting the note. An empty conversation leaves the note untouched, as the original does (md-log.ts:454-460). It persists the link with `pi.appendEntry("md-log", {file})` (types.d.ts:954-955) and restores it on `session_start` / `session_switch` from the newest such entry on the branch. Live events: `message_end` for user and assistant text (types.d.ts:536-544). `tool_call` writes the question for `quiz` (via the quiz contract) and for `ask`, before the tool runs. `tool_result` writes the answer. Every handler enqueues synchronously, so writes keep event order, and errors become `ctx.ui.notify(…, "error")` (types.d.ts:135; levels are `info|warning|error`, there is no `success`).

**Step 1: Extend the fake (additive) and write the failing test**

Add exactly this to `test-support/fake-omp.ts`. Phase 1's existing fields and behaviour stay unchanged.

```ts
// test-support/fake-omp.ts — ADD to the FakeOmp interface (Phase 2, md-log):
  /** What `ctx.isIdle()` returns; default true. */
  idle: boolean;
  /** What `ctx.sessionManager.getBranch()` returns; `appendEntry` also appends a CustomEntry here. */
  branch: SessionEntry[];
  /** Last text per key passed to `ctx.ui.setStatus`; undefined after a clear. */
  statuses: Map<string, string | undefined>;

// ADD the import:
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";

// In createFakeOmp: initialise `idle: true, branch: [], statuses: new Map()` on the fake object, and keep a
// counter `let nextId = 0;`. EXTEND appendEntry so that, after pushing onto `entries`, it also does:
      const parentId = fake.branch.at(-1)?.id ?? null;
      fake.branch.push({ type: "custom", id: `e${nextId++}`, parentId, timestamp: new Date(0).toISOString(), customType, data });

// EXTEND the ctx literal (keep cwd, hasUI, mode, ui.notify as Phase 1 has them):
    ui: {
      notify(message, type) { fake.notifications.push({ message, type }); }, // Phase 1, unchanged
      setStatus(key: string, text: string | undefined) { fake.statuses.set(key, text); }, // Phase 2
    },
    isIdle: () => fake.idle, // Phase 2
    sessionManager: { getBranch: () => [...fake.branch] }, // Phase 2
```

`plugins/md-log/test/omp.test.ts`:

```ts
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { createFakeOmp, type FakeOmp } from "../../../test-support/fake-omp.ts";
import mdLog from "../src/omp.ts";
import {
  OMP_ASK_DETAILS, OMP_ASK_INPUT, OMP_MESSAGES, PROMPT, PROSE_1, PROSE_2, PROSE_3, QUIZ_DETAILS, QUIZ_INPUT,
} from "./fixtures/session.ts";

let dir: string;
let note: string;
let omp: FakeOmp;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "md-log-"));
  note = join(dir, "notes.md");
  omp = createFakeOmp({ cwd: dir });
  mdLog(omp.api);
});

const run = (name: string, args = "") => omp.commands.get(name)!.handler(args, omp.ctx);
const say = (message: unknown) => omp.emit("message_end", { type: "message_end", message });
const read = () => readFileSync(note, "utf8");
const messageEntry = (message: unknown, i: number) =>
  ({ type: "message", id: `m${i}`, parentId: i ? `m${i - 1}` : null, timestamp: "", message }) as unknown as SessionEntry;

describe("/md-log", () => {
  test("logs a live session, prose and Q&A in order, exactly as golden/session.md", async () => {
    writeFileSync(note, "");
    await run("md-log", "notes.md");
    await say({ role: "user", content: [{ type: "text", text: PROMPT }] });
    await say({ role: "assistant", content: [{ type: "text", text: PROSE_1 }, { type: "toolCall", id: "q", name: "quiz", arguments: QUIZ_INPUT }] });
    await omp.emit("tool_call", { type: "tool_call", toolCallId: "q", toolName: "quiz", input: QUIZ_INPUT });
    await omp.emit("tool_result", {
      type: "tool_result", toolCallId: "q", toolName: "quiz", input: QUIZ_INPUT,
      content: [{ type: "text", text: "Correct ✓" }], details: QUIZ_DETAILS, isError: false,
    });
    await say({ role: "toolResult", toolCallId: "q", toolName: "quiz", content: [{ type: "text", text: "Correct ✓" }], isError: false });
    await say({ role: "assistant", content: [{ type: "text", text: PROSE_2 }] });
    await omp.emit("tool_call", { type: "tool_call", toolCallId: "a", toolName: "ask", input: OMP_ASK_INPUT });
    await omp.emit("tool_result", {
      type: "tool_result", toolCallId: "a", toolName: "ask", input: OMP_ASK_INPUT,
      content: [{ type: "text", text: "User selected: Slow" }], details: OMP_ASK_DETAILS, isError: false,
    });
    await say({ role: "assistant", content: [{ type: "text", text: PROSE_3 }] });
    await expect(read()).toMatchFileSnapshot("golden/session.md");
  });

  test("backfills the conversation so far by overwriting the note", async () => {
    writeFileSync(note, "old content\n");
    omp.branch.push(...OMP_MESSAGES.map(messageEntry));
    await run("md-log", note);
    await expect(read()).toMatchFileSnapshot("golden/session.md");
    expect(omp.notifications.at(-1)).toEqual({ message: `Linked: ${note} (8 entries backfilled)`, type: "info" });
    expect(omp.statuses.get("md-log")).toBe("🗒 notes.md");
  });

  test("with nothing to backfill, keeps the note's content and appends after it", async () => {
    writeFileSync(note, "# Primes\n");
    await run("md-log", "notes.md");
    await say({ role: "user", content: "Hi" });
    expect(read()).toBe("# Primes\n\n> [!quote] YOU\n\nHi\n");
  });

  test("refuses without a path, while the agent is busy, for a missing file, and for a directory", async () => {
    await run("md-log", "  ");
    omp.idle = false;
    writeFileSync(note, "");
    await run("md-log", "notes.md");
    omp.idle = true;
    await run("md-log", "missing.md");
    await run("md-log", dir);
    expect(omp.notifications).toEqual([
      { message: "Usage: /md-log <filepath>", type: "warning" },
      { message: "Wait for the agent to finish before linking.", type: "warning" },
      { message: `File does not exist: ${join(dir, "missing.md")}`, type: "error" },
      { message: `Not a file: ${dir}`, type: "error" },
    ]);
    await say({ role: "user", content: "Hi" });
    expect(read()).toBe("");
    expect(() => readFileSync(join(dir, "missing.md"))).toThrow();
  });
});

describe("/md-unlog", () => {
  test("stops logging and records the unlink for the next restart", async () => {
    writeFileSync(note, "");
    await run("md-log", "notes.md");
    await run("md-unlog");
    await say({ role: "user", content: "Hi" });
    expect(read()).toBe("");
    expect(omp.entries).toEqual([
      { customType: "md-log", data: { file: note } },
      { customType: "md-log", data: { file: null } },
    ]);
    expect(omp.notifications.at(-1)).toEqual({ message: "Unlinked: notes.md", type: "info" });
  });
});

describe("restoring the link", () => {
  test("session_start resumes logging to the newest linked note on the branch", async () => {
    writeFileSync(note, "");
    omp.branch.push({ type: "custom", id: "c1", parentId: null, timestamp: "", customType: "md-log", data: { file: note } });
    await omp.emit("session_start", { type: "session_start" });
    await say({ role: "user", content: "Hi" });
    expect(read()).toBe("> [!quote] YOU\n\nHi\n");
    expect(omp.statuses.get("md-log")).toBe("🗒 notes.md");
  });

  test("switching to a session that never linked a note stops logging", async () => {
    writeFileSync(note, "");
    await run("md-log", "notes.md");
    omp.branch.length = 0;
    await omp.emit("session_switch", { type: "session_switch", reason: "new", previousSessionFile: undefined });
    await say({ role: "user", content: "Hi" });
    expect(read()).toBe("");
    expect(omp.statuses.get("md-log")).toBeUndefined();
  });
});

describe("observers never break the session", () => {
  test("a failed write is reported and the event still completes", async () => {
    writeFileSync(note, "");
    await run("md-log", "notes.md");
    rmSync(note);
    mkdirSync(note);
    await expect(say({ role: "user", content: "Hi" })).resolves.toBeDefined();
    expect(omp.notifications.at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/^md-log: .*EISDIR/) });
  });

  test("a note deleted after linking is recreated by the next entry", async () => {
    writeFileSync(note, "");
    await run("md-log", "notes.md");
    rmSync(note);
    await say({ role: "user", content: "Hi" });
    expect(read()).toBe("> [!quote] YOU\n\nHi\n");
  });
});
```

**Step 2:** `npx vitest run plugins/md-log/test/omp.test.ts` → FAIL, `../src/omp.ts` not found.

**Step 3: Implement** `plugins/md-log/src/omp.ts`:

```ts
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import type { Entry } from "./core/entries.ts";
import { appendBlocks, formatEntry, formatLog } from "./core/format.ts";
import {
  backfillFromOmp, contentText, ompTextEntry, ompToolCallEntries, ompToolResultEntries, type OmpMessage,
} from "./core/from-omp.ts";
import { createSerialQueue } from "./core/queue.ts";

const ENTRY_TYPE = "md-log";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function mdLog(pi: ExtensionAPI): void {
  let link: string | null = null;
  const writes = createSerialQueue();

  /** Point `link` at the newest md-log entry on the active branch (null when none or after /md-unlog). */
  function restore(ctx: ExtensionContext): void {
    link = null;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
      const file = (entry.data as { file?: unknown } | undefined)?.file;
      link = typeof file === "string" ? file : null;
    }
    ctx.ui.setStatus(ENTRY_TYPE, link ? `🗒 ${basename(link)}` : undefined);
  }

  /**
   * Append the entries `compute` derives from an event. Runs synchronously up to the enqueue, so writes
   * keep event order; never throws (observers must not break the session).
   */
  function observe(ctx: ExtensionContext, compute: () => readonly Entry[]): Promise<void> {
    const file = link;
    if (!file) return Promise.resolve();
    let blocks: string[];
    try {
      blocks = compute().map(formatEntry);
    } catch (error) {
      ctx.ui.notify(`md-log: ${errorText(error)}`, "error");
      return Promise.resolve();
    }
    if (blocks.length === 0) return Promise.resolve();
    return writes.run(async () => {
      const current = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
      await writeFile(file, appendBlocks(current, blocks), "utf8");
    }).catch((error: unknown) => ctx.ui.notify(`md-log: ${errorText(error)}`, "error"));
  }

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_switch", (_event, ctx) => restore(ctx));

  pi.on("message_end", (event, ctx) => observe(ctx, () => {
    const entry = ompTextEntry(event.message as OmpMessage);
    return entry ? [entry] : [];
  }));

  pi.on("tool_call", (event, ctx) => observe(ctx, () => ompToolCallEntries(event.toolName, event.input)));

  pi.on("tool_result", (event, ctx) => observe(ctx, () => ompToolResultEntries(event.toolName, event.input, {
    details: event.details,
    isError: event.isError,
    text: contentText(event.content),
  })));

  pi.registerCommand("md-log", {
    description: "Mirror the session to a markdown file (backfills history)",
    handler: async (args, ctx) => {
      const arg = args.trim();
      if (!arg) {
        ctx.ui.notify("Usage: /md-log <filepath>", "warning");
        return;
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify("Wait for the agent to finish before linking.", "warning");
        return;
      }
      const file = isAbsolute(arg) ? arg : resolve(ctx.cwd, arg);
      // Link existing notes only: a typo must not scatter new files around the vault.
      const info = await stat(file).catch(() => undefined);
      if (!info) {
        ctx.ui.notify(`File does not exist: ${file}`, "error");
        return;
      }
      if (!info.isFile()) {
        ctx.ui.notify(`Not a file: ${file}`, "error");
        return;
      }
      const messages = ctx.sessionManager.getBranch().flatMap((e) => (e.type === "message" ? [e.message as OmpMessage] : []));
      const entries = backfillFromOmp(messages);
      try {
        // Overwrites the note with the conversation so far; an empty conversation leaves it untouched.
        await writes.run(async () => {
          if (entries.length > 0) await writeFile(file, formatLog(entries), "utf8");
        });
      } catch (error) {
        ctx.ui.notify(`md-log: ${errorText(error)}`, "error");
        return;
      }
      link = file;
      pi.appendEntry(ENTRY_TYPE, { file });
      ctx.ui.setStatus(ENTRY_TYPE, `🗒 ${basename(file)}`);
      ctx.ui.notify(`Linked: ${file} (${entries.length} entries backfilled)`, "info");
    },
  });

  pi.registerCommand("md-unlog", {
    description: "Stop mirroring the session to a markdown file",
    handler: async (_args, ctx) => {
      if (!link) {
        ctx.ui.notify("No file linked", "warning");
        return;
      }
      const name = basename(link);
      link = null;
      pi.appendEntry(ENTRY_TYPE, { file: null });
      ctx.ui.setStatus(ENTRY_TYPE, undefined);
      ctx.ui.notify(`Unlinked: ${name}`, "info");
    },
  });
}
```

**Step 4: Run, expect pass**

`npx vitest run plugins/md-log/test/omp.test.ts` → 9 passed. The first test proves that the live path writes `golden/session.md`. Then `npm test` and `npm run typecheck` → exit 0.

**Step 5: Build and commit**

```bash
npm run build && npm run check
git add test-support/fake-omp.ts plugins/md-log dist .claude-plugin .omp-plugin
git commit -m "feat(md-log): add omp adapter"
```

---

### Task 8: Claude Code adapter (`src/claude.ts`)

**Files:**
- Create: `plugins/md-log/src/claude.ts`
- Test: `plugins/md-log/test/claude/engine.ts` (kit stubs helper), `plugins/md-log/test/claude/md-log.test.ts`

Rules the code follows (design "Adapter contract"):
- Every `$` call is in `src/claude.ts`, and `$` is passed only to top-level functions of this file. Core receives closures, never `$`.
- Event names are literals.
- Every hook has a `.catch` that passes through: `next(e)`, or a `{text}` for our own commands.
- Observers wrap their work in try/catch → `$.ui.toast`.
- Writes go read → concat → write under one queue. A note that would pass 4 MiB is unlinked with a 10 s toast.
- `turn.step`: settle pending answers from `$.session.messages()` at the step's start, `const result = yield* next(e)`, then log `result.answer` and the questions of `AskUserQuestion` / `mcp__quiz__quiz` uses and keep those uses pending. Steps carrying `agentId` pass straight through.
- `turn.complete` (main loop only) settles what remains. A use with no result is logged as unavailable.
- `prompt.submit` logs `result.text` after `await next(e)`, skipping `{drop}`.

**Step 1: Write the failing kit tests**

`plugins/md-log/test/claude/engine.ts`:

```ts
import type { HookStream, On, SessionMessage, TurnStepToolUse } from "claude-code";

/** What the stubbed engine holds: files by absolute path, the transcript, toasts, and the next model response. */
export interface StubbedEngine {
  files: Map<string, string>;
  dirs: Set<string>;
  failWrites: Set<string>;
  messages: SessionMessage[];
  toasts: string[];
  response: { answer: string; toolUses: TurnStepToolUse[] };
}

/**
 * Stubs every engine call md-log makes except `prompt.submit` (tests choose its answer).
 * Register before the test's first call on `$` (kit rule).
 */
export function stubEngine(on: On): StubbedEngine {
  const engine: StubbedEngine = {
    files: new Map(), dirs: new Set(), failWrites: new Set(), messages: [], toasts: [],
    response: { answer: "", toolUses: [] },
  };
  on("fs.stat", ($, e) => {
    if (engine.dirs.has(e.path)) return { value: { kind: "dir", size: 0, mtimeMs: 0, isLink: false, realPath: e.path } };
    const text = engine.files.get(e.path);
    if (text === undefined) return { deny: `ENOENT: no such file, stat '${e.path}'` };
    return { value: { kind: "file", size: new TextEncoder().encode(text).length, mtimeMs: 0, isLink: false, realPath: e.path } };
  });
  on("fs.read", ($, e) => {
    const text = engine.files.get(e.path);
    return text === undefined ? { deny: `ENOENT: no such file, open '${e.path}'` } : { value: text };
  });
  on("fs.write", ($, e) => {
    if (engine.failWrites.has(e.path)) return { deny: `EACCES: permission denied, open '${e.path}'` };
    engine.files.set(e.path, e.text);
    return { value: undefined };
  });
  on("session.messages", () => ({ value: engine.messages }));
  on("ui.toast", ($, e) => {
    engine.toasts.push(e.text);
    return { value: undefined };
  });
  on("turn.complete", () => ({ text: "" }));
  on("session.end", ($, e) => ({ sessionId: e.sessionId }));
  on("turn.step", async function* ($, e) {
    const { answer, toolUses } = engine.response;
    if (answer) yield { kind: "text", index: 0, text: answer };
    return {
      turnId: e.turnId, index: e.index, answer, toolUses,
      stopReason: toolUses.length > 0 ? "tool_use" : "end_turn", usage: null,
    };
  });
  return engine;
}

/** Reads a `turn.step` stream to its end, as the engine does, and returns the step's result. */
export async function drain<C, R>(stream: HookStream<C, R>): Promise<R> {
  let step = await stream.next();
  while (step.done !== true) step = await stream.next();
  return step.value;
}

export const PRESENTATION = { origin: { kind: "composer" }, presentation: { isFullscreen: false, columns: 80 } } as const;
```

`plugins/md-log/test/claude/md-log.test.ts`:

```ts
import { expect, test } from "claude-code/testing";
import { drain, PRESENTATION, stubEngine } from "./engine.ts";

const NOTE = "/work/notes.md";
const ASK_INPUT = {
  questions: [{
    question: "How fast should we go?", header: "Pace",
    options: [{ label: "Slow", description: "One idea at a time" }, { label: "Fast", description: "Skim" }],
    multiSelect: false,
  }],
};
const ASK_QUESTION_BLOCK = "> [!question] Question — Pace\n> How fast should we go?\n>\n> 1. Slow\n> 2. Fast";
const QUIZ_INPUT = {
  question: "Is 29 prime?", options: [{ label: "Yes" }, { label: "No" }], correctAnswer: "Yes",
  explanation: "Only 1 and 29 divide it.", shuffle: false,
};
const QUIZ_RESULT = {
  status: "answered", question: "Is 29 prime?", mode: "single-select",
  answers: [{ label: "Yes", value: "Yes", index: 1 }], correctIndices: [1],
  options: [{ index: 1, label: "Yes" }, { index: 2, label: "No" }], correct: true, explanation: "Only 1 and 29 divide it.",
};

const step = (index: number, agentId?: string) =>
  ({ turnId: "t1", index, model: "claude-test", messageCount: 1, ...(agentId ? { agentId } : {}) });
const complete = { turnId: "t1", answer: "", durationMs: 1, isAborted: false, reason: "answer" } as const;
const prompt = (text: string) => ({ text, wait: false, origin: { kind: "composer" } }) as const;

test("/md-log refuses a missing file or a directory, and never creates one", async ($, on) => {
  const engine = stubEngine(on);
  engine.dirs.add("/work");
  expect((await $.command.run({ command: "md-log", args: "", ...PRESENTATION })).text).toBe("Usage: /md-log <filepath>");
  expect((await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION })).text).toBe(`File does not exist: ${NOTE}`);
  expect((await $.command.run({ command: "md-log", args: "/work", ...PRESENTATION })).text).toBe("Not a file: /work");
  expect(engine.files.size).toBe(0);
});

test("/md-log overwrites the note with the transcript so far, Q&A paired", async ($, on) => {
  const engine = stubEngine(on);
  engine.files.set(NOTE, "old content\n");
  engine.messages = [
    { role: "user", text: "Teach me primes.", toolUses: [] },
    {
      role: "assistant", text: "A prime has two divisors.",
      toolUses: [{
        tool_use_id: "toolu_1", tool: "AskUserQuestion", input: ASK_INPUT,
        result: { questions: ASK_INPUT.questions, answers: { "How fast should we go?": "Slow" } }, text: "answered",
      }],
    },
  ];
  const answer = await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  expect(answer.text).toBe(`Linked: ${NOTE} (4 entries backfilled)`);
  expect(engine.files.get(NOTE)).toBe(
    "> [!quote] YOU\n\nTeach me primes.\n\n> [!abstract] AGENT\n\nA prime has two divisors.\n\n"
      + `${ASK_QUESTION_BLOCK}\n\n> [!example] Answer\n> 1. Slow\n`,
  );
});

test("a prompt is logged as it entered the session; a dropped prompt is not logged", async ($, on) => {
  const engine = stubEngine(on);
  on("prompt.submit", ($, e) => (e.text === "drop me" ? { drop: "blocked" } : { text: `${e.text} (expanded)` }));
  engine.files.set(NOTE, "");
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  expect(await $.prompt.submit(prompt("Hi"))).toMatchObject({ text: "Hi (expanded)" });
  expect(await $.prompt.submit(prompt("drop me"))).toEqual({ drop: "blocked" });
  expect(engine.files.get(NOTE)).toBe("> [!quote] YOU\n\nHi (expanded)\n");
});

test("each request logs its prose and questions live; the answer lands when the next request starts", async ($, on) => {
  const engine = stubEngine(on);
  engine.files.set(NOTE, "");
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  engine.response = { answer: "Quick preference check.", toolUses: [{ name: "AskUserQuestion", input: ASK_INPUT }] };
  const first = await drain($.turn.step(step(0)));
  expect(first.answer).toBe("Quick preference check.");
  expect(engine.files.get(NOTE)).toBe(`> [!abstract] AGENT\n\nQuick preference check.\n\n${ASK_QUESTION_BLOCK}\n`);
  engine.messages = [{
    role: "assistant", text: "Quick preference check.",
    toolUses: [{
      tool_use_id: "toolu_2", tool: "AskUserQuestion", input: ASK_INPUT,
      result: { questions: ASK_INPUT.questions, answers: { "How fast should we go?": "Medium, with examples" } },
      text: "answered",
    }],
  }];
  engine.response = { answer: "Medium it is.", toolUses: [] };
  await drain($.turn.step(step(1)));
  expect(engine.files.get(NOTE)).toBe(
    `> [!abstract] AGENT\n\nQuick preference check.\n\n${ASK_QUESTION_BLOCK}\n\n`
      + "> [!example] Answer\n> Other: Medium, with examples\n\n> [!abstract] AGENT\n\nMedium it is.\n",
  );
});

test("at the end of a turn a pending quiz answer is logged from its <quiz-result> block, a missing one as unavailable", async ($, on) => {
  const engine = stubEngine(on);
  engine.files.set(NOTE, "");
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  engine.response = {
    answer: "",
    toolUses: [{ name: "mcp__quiz__quiz", input: QUIZ_INPUT }, { name: "AskUserQuestion", input: ASK_INPUT }],
  };
  await drain($.turn.step(step(0)));
  engine.messages = [{
    role: "assistant", text: "",
    toolUses: [
      {
        tool_use_id: "toolu_q", tool: "mcp__quiz__quiz", input: QUIZ_INPUT,
        result: `Correct ✓\n\n<quiz-result>${JSON.stringify(QUIZ_RESULT)}</quiz-result>`,
      },
      { tool_use_id: "toolu_a", tool: "AskUserQuestion", input: ASK_INPUT },
    ],
  }];
  await $.turn.complete(complete);
  expect(engine.files.get(NOTE)).toBe(
    "> [!question] Quiz\n> Is 29 prime?\n>\n> 1. Yes\n> 2. No\n\n"
      + `${ASK_QUESTION_BLOCK}\n\n`
      + "> [!success] Quiz — correct ✓\n> Your answer: 1. Yes\n> Correct answer: 1. Yes\n>\n> Only 1 and 29 divide it.\n\n"
      + "> [!warning] Question — unavailable\n> No answer was recorded.\n",
  );
});

test("subagent requests are not logged", async ($, on) => {
  const engine = stubEngine(on);
  engine.files.set(NOTE, "");
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  engine.response = { answer: "Subagent prose.", toolUses: [{ name: "AskUserQuestion", input: ASK_INPUT }] };
  await drain($.turn.step(step(0, "agent-1")));
  await $.turn.complete({ ...complete, agentId: "agent-1" });
  expect(engine.files.get(NOTE)).toBe("");
});

test("a note that would pass 4 MiB is unlinked with a toast, and later prompts write nothing", async ($, on) => {
  const engine = stubEngine(on);
  on("prompt.submit", ($, e) => ({ text: e.text }));
  const full = "x".repeat(4 * 1024 * 1024 - 8);
  engine.files.set(NOTE, full);
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  await $.prompt.submit(prompt("One more line"));
  await $.prompt.submit(prompt("And another"));
  expect(engine.files.get(NOTE)).toBe(full);
  expect(engine.toasts).toEqual(["md-log: unlinked notes.md: notes over 4 MiB cannot be written"]);
});

test("/md-unlog and the end of the session stop logging", async ($, on) => {
  const engine = stubEngine(on);
  on("prompt.submit", ($, e) => ({ text: e.text }));
  engine.files.set(NOTE, "");
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  expect((await $.command.run({ command: "md-unlog", args: "", ...PRESENTATION })).text).toBe("Unlinked: notes.md");
  expect((await $.command.run({ command: "md-unlog", args: "", ...PRESENTATION })).text).toBe("No file linked");
  await $.prompt.submit(prompt("not logged"));
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } });
  await $.prompt.submit(prompt("not logged either"));
  expect(engine.files.get(NOTE)).toBe("");
});

test("a failed write is reported with a toast and the prompt still goes through", async ($, on) => {
  const engine = stubEngine(on);
  on("prompt.submit", ($, e) => ({ text: e.text }));
  engine.files.set(NOTE, "");
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  engine.failWrites.add(NOTE);
  expect(await $.prompt.submit(prompt("Hi"))).toMatchObject({ text: "Hi" });
  expect(engine.toasts.length).toBe(1);
  expect(engine.toasts[0]).toMatch(/^md-log: .*EACCES/);
});
```

**Step 2: Run, expect failure**

Run: `npm run build && npm run test:claude -- md-log`
Expected: FAIL. With no `src/claude.ts` there is no `hooks/register.js`, so the kit reports the plugin has no hooks module, or every command test fails with the bottom stub's `no implementation for command.run`.

**Step 3: Implement** `plugins/md-log/src/claude.ts`:

```ts
import type { EngineInterface, On, PluginOptions } from "claude-code";
import { assistantEntry, userEntry, type Entry } from "./core/entries.ts";
import { appendBlocks, formatEntry, formatLog } from "./core/format.ts";
import {
  backfillFromClaude, claudeAnswerEntries, claudeQuestionEntries, isQaTool, pairPending, type PendingUse,
} from "./core/from-claude.ts";
import { createSerialQueue } from "./core/queue.ts";

/** `$.fs.read` and `$.fs.write` refuse files over 4 MiB (reference.md, Limits). */
const NOTE_LIMIT = 4 * 1024 * 1024;

let link: string | undefined;
/** Quiz/AskUserQuestion uses whose question is logged and whose answer is not, oldest first. */
let pending: PendingUse[] = [];
/** `tool_use_id`s whose answers are logged, so a repeated question never takes an old answer. */
const consumed = new Set<string>();
const writes = createSerialQueue();

function clearLink(): void {
  link = undefined;
  pending = [];
  consumed.clear();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function overLimit(text: string): boolean {
  return new TextEncoder().encode(text).length > NOTE_LIMIT;
}

/** Read, concatenate, write: `$.fs.write` has no append. Past 4 MiB the note is unlinked instead. */
async function appendToNote($: EngineInterface, file: string, blocks: readonly string[]): Promise<void> {
  if (link !== file) return; // unlinked or relinked since these blocks were queued
  const info = await $.fs.stat(file).catch(() => undefined);
  const current = info === undefined ? "" : info.size > NOTE_LIMIT ? undefined : await $.fs.read(file);
  const next = current === undefined ? undefined : appendBlocks(current, blocks);
  if (next === undefined || overLimit(next)) {
    clearLink();
    $.ui.toast(`md-log: unlinked ${fileName(file)}: notes over 4 MiB cannot be written`, { timeoutMs: 10_000 });
    return;
  }
  await $.fs.write(file, next);
}

/** Append what `compute` derives from an event. Never throws: failures become a toast. */
async function observe($: EngineInterface, compute: () => readonly Entry[]): Promise<void> {
  const file = link;
  if (!file) return;
  try {
    const blocks = compute().map(formatEntry);
    if (blocks.length > 0) await writes.run(() => appendToNote($, file, blocks));
  } catch (error) {
    $.ui.toast(`md-log: ${errorText(error)}`);
  }
}

/**
 * Log the answers of pending uses that the transcript now holds, in order. At the end of a turn
 * (`final`), uses that never got a result are logged as unavailable.
 */
async function settle($: EngineInterface, final: boolean): Promise<void> {
  const owed = pending;
  if (!link || owed.length === 0) return;
  try {
    const messages = await $.session.messages();
    if (pending !== owed) return; // unlinked meanwhile
    const done = pairPending(owed, messages, consumed);
    for (const use of done) consumed.add(use.tool_use_id);
    const rest = owed.slice(done.length);
    pending = final ? [] : rest;
    const answered = done.flatMap((summary, i) => claudeAnswerEntries(owed[i]!, summary));
    const missing = final ? rest.flatMap((use) => claudeAnswerEntries(use, undefined)) : [];
    await observe($, () => [...answered, ...missing]);
  } catch (error) {
    $.ui.toast(`md-log: ${errorText(error)}`);
  }
}

export function register(on: On, _options: PluginOptions): void {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "md-log",
      description: "Mirror the session to a markdown file (backfills history)",
      argumentHint: "<filepath>",
    });
    await $.command.register({
      name: "md-unlog",
      description: "Stop mirroring the session to a markdown file",
      immediate: true,
    });
    return next(e);
  }).catch(($, e, next) => next(e));

  // /clear, /resume and /branch end this conversation; the link belongs to it.
  on("session.end", async ($, e, next) => {
    clearLink();
    return next(e);
  }).catch(($, e, next) => next(e));

  // Not `immediate`: typed mid-turn, CC runs it once the turn ends, so the backfill never races a turn.
  on("command.run", { command: "md-log" }, async ($, e) => {
    const arg = e.args.trim();
    if (!arg) return { text: "Usage: /md-log <filepath>" };
    // Link existing notes only: a typo must not scatter new files around the vault.
    const info = await $.fs.stat(arg, { resolve: true }).catch(() => undefined);
    if (!info) return { text: `File does not exist: ${arg}` };
    if (info.kind !== "file") return { text: `Not a file: ${arg}` };
    const file = info.realPath ?? arg;
    const backfill = backfillFromClaude(await $.session.messages());
    const text = formatLog(backfill.entries);
    if (overLimit(text)) return { text: "Not linked: the conversation so far is over the 4 MiB note limit." };
    // Overwrites the note with the conversation so far; an empty conversation leaves it untouched.
    if (text) await writes.run(() => $.fs.write(file, text));
    clearLink();
    link = file;
    for (const id of backfill.consumed) consumed.add(id);
    return { text: `Linked: ${file} (${backfill.entries.length} entries backfilled)` };
  }).catch(($, e, next) => ({ text: `md-log failed: ${next.error.message ?? next.error.kind}` }));

  on("command.run", { command: "md-unlog" }, async () => {
    if (!link) return { text: "No file linked" };
    const name = fileName(link);
    clearLink();
    return { text: `Unlinked: ${name}` };
  }).catch(($, e, next) => ({ text: `md-unlog failed: ${next.error.message ?? next.error.kind}` }));

  // After next: a dropped prompt is skipped, a rewritten one is logged as sent.
  on("prompt.submit", async ($, e, next) => {
    const result = await next(e);
    if (result.drop === undefined) {
      await observe($, () => {
        const entry = userEntry(result.text);
        return entry ? [entry] : [];
      });
    }
    return result;
  }).catch(($, e, next) => next(e));

  // One model request: settle answers the transcript now holds, then log this response's prose and the
  // questions it asks (before the tools run, so they appear live). Subagent requests are not the conversation.
  on("turn.step", async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e);
    await settle($, false);
    const result = yield* next(e);
    await observe($, () => {
      const uses = result.toolUses.filter((u) => isQaTool(u.name)).map((u) => ({ name: u.name, input: u.input }));
      pending.push(...uses);
      const prose = assistantEntry([result.answer]);
      return [...(prose ? [prose] : []), ...uses.flatMap(claudeQuestionEntries)];
    });
    return result;
  }).catch(async function* ($, e, next) {
    return yield* next(e);
  });

  on("turn.complete", async ($, e, next) => {
    if (e.agentId === undefined) await settle($, true);
    return next(e);
  }).catch(($, e, next) => next(e));
}
```

**Step 4: Run, expect pass**

```bash
npm run typecheck                    # exit 0 against the vendored 2.1.296 types
npm run build
npm run test:claude -- md-log        # 9 pass, 0 fail
npm run validate                     # passes --strict; hooks line lists session.start, session.end,
                                     # command.run{command=md-log}, command.run{command=md-unlog},
                                     # prompt.submit, turn.step, turn.complete; "gating hook with .catch" ×3
npm test && npm run check
```

If `npm run typecheck` fails only on 2.1.296 type names (the code was checked against the 2.1.277 copy), adjust the type imports to the vendored names. Never change behaviour to fit the types.

**Step 5: Commit**

```bash
git add plugins/md-log dist .claude-plugin .omp-plugin
git commit -m "feat(md-log): add Claude Code adapter"
```

---

### Task 9: Smoke in both harnesses (real sessions)

**Files:** none (no commit unless a decision rule below calls for a fix).

The scripted prompt is the same in both harnesses:

> Use your built-in question tool to ask me "Pick a colour" with the header "Colour" and the options Red and Blue. After I answer, reply with one sentence about my pick.

**omp**

```bash
source ~/.nvm/nvm.sh && nvm use 24.15.0
cd /home/marcus/tmp/learn/learning-plugins && npm run build
mkdir -p /tmp/md-log-smoke && : > /tmp/md-log-smoke/notes.md && : > /tmp/md-log-smoke/backfill.md
omp plugin link dist/omp/md-log
cd /tmp/md-log-smoke && omp
```

1. `/md-log /tmp/md-log-smoke/notes.md` → notification `Linked: /tmp/md-log-smoke/notes.md (0 entries backfilled)`, footer `🗒 notes.md`.
2. Send the scripted prompt, answer **Red**. While the dialog is open, `cat /tmp/md-log-smoke/notes.md` in another terminal shows the `> [!question] Question — Colour` block already, before you answer.
3. `/md-log /tmp/md-log-smoke/backfill.md` (re-links to the fresh note, backfilling).
4. Quit omp, then `diff /tmp/md-log-smoke/notes.md /tmp/md-log-smoke/backfill.md` → no output. Then `cp /tmp/md-log-smoke/notes.md /tmp/md-log-smoke/omp.md`.
5. Restart check: `omp --resume` (or `/resume` in a new omp) the same session, send `ok`, quit. `tail -3 /tmp/md-log-smoke/backfill.md` shows `> [!quote] YOU` / `ok`, because the link was restored on start.
6. `/md-unlog` → `Unlinked: backfill.md`. Unlink the plugin with the omp CLI's unlink counterpart of `omp plugin link` (`omp plugin --help`).

**Claude Code**

```bash
: > /tmp/md-log-smoke/notes.md && : > /tmp/md-log-smoke/backfill.md
cd /tmp/md-log-smoke && claude --plugin-dir /home/marcus/tmp/learn/learning-plugins/dist/claude/md-log
```

1. `/md-log /tmp/md-log-smoke/notes.md` → output `Linked: /tmp/md-log-smoke/notes.md (0 entries backfilled)`. Typing `/md` lists `/md-log <filepath>` and `/md-unlog`, not namespaced.
2. Send the scripted prompt, answer **Red**. The question block is in the note before you answer.
3. `/md-log /tmp/md-log-smoke/backfill.md`, then `/md-unlog` → `Unlinked: backfill.md`, then `/exit`.
4. `diff /tmp/md-log-smoke/notes.md /tmp/md-log-smoke/backfill.md` → no output. `cp /tmp/md-log-smoke/notes.md /tmp/md-log-smoke/cc.md`.

**Parity across harnesses** (the prose differs by model, the Q&A must not):

```bash
qa() { awk '/^> \[!(question|example|warning)\] (Question|Answer)/{p=1} p&&/^$/{p=0} p' "$1"; }
diff <(qa /tmp/md-log-smoke/omp.md) <(qa /tmp/md-log-smoke/cc.md)    # expect no output
```

Expected blocks in both:

```markdown
> [!question] Question — Colour
> Pick a colour
>
> 1. Red
> 2. Blue

> [!example] Answer
> 1. Red
```

**Decision rules for what the smoke can reveal:**
- **[UNVERIFIED] omp `ask` events.** `ask` is a discoverable tool (`loadMode = "discoverable"`, tools/ask.d.ts:89), so it may run as an xd:// device. The wrapper still emits `tool_call`/`tool_result` named `ask` for nested dispatches (wrapper.ts:184-190, 208-219). If the omp note lacks the question or answer block, add a temporary `pi.on("tool_call", (e, ctx) => ctx.ui.notify(e.toolName))` to `src/omp.ts`, rebuild, repeat, and read the notified name. If the name is not `ask`, add the observed name to `shared/tool-map.ts`'s `ask.omp` and re-run Tasks 4 and 7's tests.
- **[UNVERIFIED] the question title in omp.** If the omp model omits `header`, the title reads `Question`. That is an omp prompt-compliance difference, not a bug. Re-run with a prompt that insists on the header, or compare with the title line stripped.
- **[UNVERIFIED] CC `prompt.submit` for slash commands.** If `notes.md` or `backfill.md` contains a `> [!quote] YOU` block whose text is `/md-log …` or `/md-unlog`, CC fires `prompt.submit` for commands. Fix: in `src/claude.ts`'s `prompt.submit` hook, skip texts matching `/^\/md-(un)?log(\s|$)/`. Add a kit test: firing `$.prompt.submit(prompt("/md-unlog"))` writes nothing.
- **[UNVERIFIED] CC transcript noise in backfill.** If the `diff notes.md backfill.md` in CC shows extra YOU blocks (for example `<command-name>`, `<local-command-stdout>` or `<system-reminder>` text), `$.session.messages()` exposes harness rows as user text. Fix: in `backfillFromClaude`, skip user messages whose trimmed text starts with `<command-name>`, `<command-message>`, `<local-command-stdout>`, `<local-command-caveat>` or `<system-reminder>`. Add a `from-claude.test.ts` case per observed prefix.
- **[UNVERIFIED] CC split assistant blocks.** If the CC backfill shows one AGENT block split in two where the live log has one, CC stores a response's text blocks as separate messages. Fix: in `backfillFromClaude`, merge consecutive assistant messages that have no tool uses between them before mapping. Add a test.
- **[UNVERIFIED] CC `ToolUseSummary.result` for `AskUserQuestion`** (open question 4, captured by Phase 1's `hello` spike). If Phase 1 recorded that `result` does not hold `{answers}` (for example only `text` carries the answer), change `claudeAnswerEntries` so that a non-error use without `answers` logs `{status: "answered", items: [{kind: "other", text: summary.text}]}` for each question instead of unavailable. Add a `from-claude.test.ts` case built from the recorded shape, and note the shape in this file.
- **[UNVERIFIED] Quiz parity (owned by Phase 3).** Once the quiz plugin exists, Phase 3 re-runs this smoke with a quiz question in both harnesses and diffs the `Quiz` blocks.

---

## Requested contract changes (master plan)

1. **Quiz contract: one additive export and two precisions.** Replace the quiz contract block's last two lines and add one line, so it reads:

```ts
/** Structural check of a quiz result (status, question, mode, answers[], correctIndices[]). md-log uses it on omp `details`. */
export function isQuizResultDetails(value: unknown): value is QuizResultDetails;
export function encodeQuizResult(d: QuizResultDetails): string;             // `<quiz-result>${JSON.stringify(d) with "<" written as \u003c}</quiz-result>`
export function decodeQuizResult(text: string): QuizResultDetails | undefined; // first block; undefined when absent, unterminated, malformed, or not isQuizResultDetails
```

and in the `displayOrder` doc comment: `FNV-1a-32 over the UTF-8 bytes of question + "\u0000" + values.join("\u0000")`.

2. **Test support.** Append to the `test-support/fake-omp.ts` bullet: "Phase 2 adds `idle` (backs `ctx.isIdle()`), `branch: SessionEntry[]` (backs `ctx.sessionManager.getBranch()`; `appendEntry` also pushes a `custom` entry), and `statuses` (records `ctx.ui.setStatus`)."

3. **Design, md-log CC adapter** (design.md line 159). Replace the Commands bullet with: "`$.command.register({name: 'md-log', argumentHint: '<filepath>'})` and `{name: 'md-unlog', immediate: true}`, handled by `command.run`. A registered command answered without `next` never starts a model turn. `/md-log` is deliberately not `immediate`: typed mid-turn, CC runs it once the turn ends, so the backfill never races a turn. That is CC's form of 'refuses while busy'." In the Writes bullet, replace "unlinks the note" with "unlinks the note (stops logging; `$.fs` has no delete)". Add: "The link is cleared on `session.end`."

4. **Design, md-log omp adapter** (design.md line 149). Replace "restored on `session_start`" with "restored on `session_start` and `session_switch` from the newest md-log entry on the active branch". Line 153 ("captured in md-log's first task") is now resolved; replace it with the shapes in this file's "Facts" section.
