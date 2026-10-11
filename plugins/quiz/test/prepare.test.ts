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

  test.each([
    ["option value", { options: [{ label: "Mercury", value: 42 }, { label: "Venus", value: "venus" }] }, "quiz option 1 value must be a string"],
    ["option description", { options: [{ label: "Mercury", value: "mercury", description: false }, { label: "Venus", value: "venus" }] }, "quiz option 1 description must be a string"],
    ["details", { details: 7 }, "quiz details must be a string"],
    ["multiSelect", { multiSelect: "true" }, "quiz multiSelect must be a boolean"],
    ["shuffle", { shuffle: "false" }, "quiz shuffle must be a boolean"],
  ])("rejects a wrongly typed %s instead of changing the quiz semantics", (_field, change, message) => {
    expect(() => prepareQuiz({ ...inOrder, ...change })).toThrow(message);
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
