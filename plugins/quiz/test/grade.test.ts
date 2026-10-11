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
