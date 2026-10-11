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
