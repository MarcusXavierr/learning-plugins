import { describe, expect, test } from "vitest";
import { encodeQuizResult } from "../../../shared/quiz-contract.ts";
import { cancelledDetails } from "../src/core/grade.ts";
import { quizDetailsFromOutput } from "../src/core/output.ts";
import { prepareQuiz } from "../src/core/prepare.ts";

const single = prepareQuiz({
  question: "Which planet is closest to the Sun?",
  options: [{ label: "Mercury", value: "mercury" }, { label: "Venus", value: "venus" }],
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
