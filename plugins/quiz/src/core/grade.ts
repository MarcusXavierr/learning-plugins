import { displayedOptions, type OptionAnswer, type QuizResultDetails } from "../../../../shared/quiz-contract.ts";
import type { PreparedQuiz } from "./prepare.ts";

/** What the user did, in either harness: real picks (empty when dontKnow) plus an optional note. */
export interface QuizResponse {
  dontKnow: boolean;
  note?: string;
  answers: OptionAnswer[];
}

/** Grade a response. Multi-select is an exact-set match; "I don't know" is never correct. */
export function gradeQuiz(quiz: PreparedQuiz, response: QuizResponse): QuizResultDetails {
  const answers = response.dontKnow ? [] : [...response.answers].sort((a, b) => a.index - b.index);
  const picked = answers.map((a) => a.index);
  const correct =
    !response.dontKnow &&
    picked.length === quiz.correctIndices.length &&
    picked.every((index, i) => index === quiz.correctIndices[i]);
  const note = response.note?.trim() || undefined;
  return {
    status: "answered",
    question: quiz.question,
    ...(quiz.context ? { context: quiz.context } : {}),
    mode: quiz.mode,
    answers,
    correctIndices: quiz.correctIndices,
    options: displayedOptions(quiz.options),
    correct,
    dontKnow: response.dontKnow,
    ...(note ? { note } : {}),
    ...(quiz.explanation ? { explanation: quiz.explanation } : {}),
  };
}

export function cancelledDetails(quiz: PreparedQuiz): QuizResultDetails {
  return {
    status: "cancelled",
    question: quiz.question,
    ...(quiz.context ? { context: quiz.context } : {}),
    mode: quiz.mode,
    answers: [],
    correctIndices: quiz.correctIndices,
    message: "User cancelled the quiz",
  };
}


/** The text the model reads. Wording ported from quiz.ts:264-313. */
export function quizResultText(d: QuizResultDetails): string {
  if (d.status !== "answered") return d.message ?? `quiz ${d.status}`;
  const labelOf = (index: number) => d.options?.find((o) => o.index === index)?.label ?? "(unknown)";
  const correctStr = d.correctIndices.map((i) => `${i}. ${labelOf(i)}`).join(", ");
  let text = d.dontKnow
    ? `User selected "I don't know" — they did not attempt an answer (a genuine knowledge gap, not a wrong guess).\nCorrect: ${correctStr}`
    : `User answered ${d.correct ? "correctly" : "incorrectly"}.\nSelected: ${d.answers.map((a) => `${a.index}. ${a.label}`).join(", ")}\nCorrect: ${correctStr}`;
  if (d.note) text += `\nUser's note: ${d.note}`;
  if (d.explanation) text += `\nExplanation: ${d.explanation}`;
  return text;
}

type FeedbackTone = "success" | "error" | "dim";
export interface FeedbackRow {
  index: number;
  label: string;
  mark: "✓" | "✗" | " ";
  tone: FeedbackTone;
}

/**
 * One row per displayed option, marked for the user: ✓ on every correct option,
 * ✗ on a wrong pick. After "I don't know" there are no picks, so nothing is ✗.
 */
export function feedbackRows(d: QuizResultDetails): FeedbackRow[] {
  const picked = new Set(d.answers.map((a) => a.index));
  const key = new Set(d.correctIndices);
  const shown = d.options ?? d.answers.map((a) => ({ index: a.index, label: a.label }));
  return shown.map(({ index, label }) => {
    if (key.has(index)) return { index, label, mark: "✓", tone: "success" };
    if (picked.has(index)) return { index, label, mark: "✗", tone: "error" };
    return { index, label, mark: " ", tone: "dim" };
  });
}

type LineTone = FeedbackTone | "warning" | "muted";
export interface StyledLine {
  text: string;
  tone: LineTone;
}

/** The transcript summary of a finished quiz: omp's renderResult and CC's ToolResult row both draw it. */
export function resultLines(d: QuizResultDetails): StyledLine[] {
  if (d.status !== "answered") return [{ text: d.message ?? `quiz ${d.status}`, tone: "warning" }];
  const lines: StyledLine[] = feedbackRows(d).map((r) => ({ text: `${r.mark} ${r.index}. ${r.label}`, tone: r.tone }));
  lines.push({ text: "", tone: "dim" });
  if (d.dontKnow) lines.push({ text: "I don't know", tone: "warning" });
  else if (d.correct) lines.push({ text: "Correct!", tone: "success" });
  else lines.push({ text: "Incorrect", tone: "error" });
  if (d.note) lines.push({ text: `Note: ${d.note}`, tone: "muted" });
  if (d.explanation) lines.push({ text: d.explanation, tone: "muted" });
  return lines;
}
