import { describe, expect, test } from "vitest";
import { encodeQuizResult } from "../../../shared/quiz-contract.ts";
import { formatEntry } from "../src/core/format.ts";
import {
  backfillFromClaude, claudeAnswerEntries, pairPending, type ClaudeMessage, type ClaudeToolUse,
} from "../src/core/from-claude.ts";
import { QUIZ_DETAILS, QUIZ_INPUT } from "./fixtures/session.ts";

const ASK = "AskUserQuestion";
const INPUT = {
  questions: [
    { question: "Which language?", header: "Language", options: [{ label: "TS", description: "" }, { label: "Go", description: "" }], multiSelect: false },
    { question: "Which extras?", header: "Extras", options: [{ label: "Lint", description: "" }, { label: "Docs", description: "" }], multiSelect: true },
  ],
};
// eslint-disable-next-line llm-core/no-unknown-parameters -- tool results arrive untyped from CC; tests feed arbitrary shapes.
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

  test("validation errors and malformed nested details log an unavailable callout", () => {
    for (const result of ["Invalid quiz input", `<quiz-result>${JSON.stringify({ ...QUIZ_DETAILS, answers: [null] })}</quiz-result>`]) {
      const entry = claudeAnswerEntries(quiz, { tool_use_id: "q", tool: quiz.name, input: QUIZ_INPUT, result })[0]!;
      expect(entry).toMatchObject({ kind: "quiz-answer", details: { status: "unavailable" } });
      expect(formatEntry(entry)).toMatch(/^> \[!warning\] Quiz — unavailable/);
    }
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

  test("matches by tool and canonical input without stealing a newer occurrence", () => {
    const reordered = { questions: [{ multiSelect: false, options: [], header: "H", question: "Q1?" }] };
    const old = asked("old", 1, false);
    const newer = asked("new", 1);
    expect(pairPending([{ name: ASK, input: reordered }], msgs(old, newer), new Set())).toEqual([]);
    expect(pairPending([{ name: ASK, input: reordered }], msgs(old, newer), new Set(["old"])))
      .toMatchObject([{ tool_use_id: "new" }]);
  });

  test("never reuses a consumed record, so a repeated question pairs with its own call", () => {
    expect(pairPending([pending(1), pending(1)], msgs(asked("a", 1), asked("b", 1)), new Set()))
      .toMatchObject([{ tool_use_id: "a" }, { tool_use_id: "b" }]);
    expect(pairPending([pending(1)], msgs(asked("a", 1)), new Set(["a"]))).toEqual([]);
  });

  test("an in-flight identical first call blocks the later answer until its own outcome arrives", () => {
    const earlier = asked("a", 1, false);
    const later = asked("b", 1);
    expect(pairPending([pending(1), pending(1)], msgs(earlier, later), new Set())).toEqual([]);
    expect(pairPending([pending(1), pending(1)], msgs(later), new Set())).toEqual([]);
    const answeredEarlier = asked("a", 1);
    const paired = pairPending([pending(1), pending(1)], msgs(answeredEarlier, later), new Set());
    expect(paired.map((record) => record.tool_use_id)).toEqual(["a", "b"]);
    expect(paired.flatMap((record, i) => claudeAnswerEntries(pending(1), {
      ...record, result: { answers: { "Q1?": i === 0 ? "first" : "second" } },
    })).map((entry) => entry.kind === "ask-answer" && entry.outcome.status === "answered"
      ? entry.outcome.items : [])).toEqual([
      [{ kind: "other", text: "first" }], [{ kind: "other", text: "second" }],
    ]);
  });

  test("returns only the answered prefix so answers stay in order", () => {
    expect(pairPending([pending(1), pending(2)], msgs(asked("a", 1, false), asked("b", 2)), new Set())).toEqual([]);
    expect(pairPending([pending(1), pending(2)], msgs(asked("a", 1), asked("b", 2, false)), new Set()))
      .toMatchObject([{ tool_use_id: "a" }]);
  });
});

test("separate CC assistant rows keep prose before and after a question in order", () => {
  const rows: ClaudeMessage[] = [
    { role: "assistant", text: "Before.", toolUses: [] },
    { role: "assistant", text: "", toolUses: [
      { tool_use_id: "q", tool: "mcp__quiz__quiz", input: QUIZ_INPUT, result: encodeQuizResult(QUIZ_DETAILS) },
    ] },
    { role: "assistant", text: "After.", toolUses: [] },
  ];
  expect(backfillFromClaude(rows).entries.map((entry) => entry.kind))
    .toEqual(["assistant", "question", "quiz-answer", "assistant"]);
});
