import { displayedOptions, displayOrder, type QuizResultDetails } from "../../../../shared/quiz-contract.ts";

/** One teaching exchange, recorded once per harness. Both must log as golden/session.md. */
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
