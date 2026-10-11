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
