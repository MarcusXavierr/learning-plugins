import { describe, expect, test } from "vitest";
import { backfillFromOmp, ompToolCallEntries, ompToolResultEntries } from "../src/core/from-omp.ts";
import { formatEntry } from "../src/core/format.ts";
import { QUIZ_DETAILS, QUIZ_INPUT } from "./fixtures/session.ts";

const ASK_INPUT = {
  questions: [
    { id: "lang", question: "Which language?", header: "Language", options: [{ label: "TS" }, { label: "Go" }] },
    { id: "extras", question: "Which extras?", multi: true, options: [{ label: "Lint" }, { label: "Docs" }] },
  ],
};
// eslint-disable-next-line llm-core/no-unknown-parameters -- tool details arrive untyped from the host; tests feed arbitrary shapes.
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
  test("a partial or malformed multi-question result never invents an empty answer", () => {
    const entries = ompToolResultEntries("ask", ASK_INPUT, ok({
      results: [{ id: "lang", selectedOptions: ["Go"] }],
    }, "Only one question returned"));
    expect(entries).toEqual([
      { kind: "ask-answer", outcome: { status: "answered", items: [{ kind: "option", index: 2, label: "Go" }] } },
      { kind: "ask-answer", outcome: { status: "unavailable", message: "Only one question returned" } },
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
  test("malformed nested quiz details become an unavailable callout, not a formatter crash", () => {
    const entry = ompToolResultEntries("quiz", QUIZ_INPUT, ok({ ...QUIZ_DETAILS, answers: [null] }, "bad result"))[0]!;
    expect(entry).toMatchObject({ kind: "quiz-answer", details: { status: "unavailable", message: "bad result" } });
    expect(formatEntry(entry)).toBe("> [!warning] Quiz — unavailable\n> bad result");
  });
});

test("backfill preserves prose around an interleaved tool call", () => {
  const entries = backfillFromOmp([
    { role: "assistant", content: [
      { type: "text", text: "Before." },
      { type: "toolCall", id: "q", name: "quiz", arguments: QUIZ_INPUT },
      { type: "text", text: "After." },
    ] },
  ]);
  expect(entries.map((entry) => entry.kind)).toEqual(["assistant", "question", "assistant"]);
  expect(entries[2]).toEqual({ kind: "assistant", text: "After." });
});

test("tools other than quiz and ask log nothing", () => {
  expect(ompToolCallEntries("bash", { command: "ls" })).toEqual([]);
  expect(ompToolResultEntries("bash", { command: "ls" }, ok(undefined, "out"))).toEqual([]);
});
