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
