import type { OptionAnswer } from "../../../../shared/quiz-contract.ts";
import type { QuizResponse } from "./grade.ts";
import { DONT_KNOW_LABEL, type PreparedQuiz } from "./prepare.ts";

/** The quiz question, with its details as a second paragraph. */
export function dialogQuestion(quiz: PreparedQuiz): string {
  return quiz.context ? `${quiz.question}\n\n${quiz.context}` : quiz.question;
}

/** Real options in display order, followed by the always-available unknown answer. */
export function dialogLabels(quiz: PreparedQuiz): string[] {
  return [...quiz.options.map((option) => option.label), DONT_KNOW_LABEL];
}

/** Map native dialog labels (or typed Other text) back to a graded response. */
export function responseFromDialog(quiz: PreparedQuiz, answer: string): QuizResponse {
  const parts = quiz.mode === "multi-select" ? answer.split(",").map((part) => part.trim()) : [answer.trim()];
  const answers: OptionAnswer[] = [];
  let dontKnow = false;
  for (const part of parts) {
    if (part === DONT_KNOW_LABEL) {
      dontKnow = true;
      continue;
    }
    const index = quiz.options.findIndex((option) => option.label === part) + 1;
    const option = quiz.options[index - 1];
    if (!option) {
      const note = answer.trim();
      return { dontKnow: true, ...(note ? { note } : {}), answers: [] };
    }
    if (!answers.some((picked) => picked.index === index)) answers.push({ label: option.label, value: option.value, index });
  }
  return dontKnow ? { dontKnow: true, answers: [] } : { dontKnow: false, answers: answers.sort((a, b) => a.index - b.index) };
}
