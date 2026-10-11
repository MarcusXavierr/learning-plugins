import type { QuizResultDetails } from "../../../../shared/quiz-contract.ts";
import type { AskOutcome, Entry } from "./entries.ts";

/** An Obsidian callout. Every body line, including lines inside multi-line values, stays quoted. */
function callout(type: string, title: string, body: readonly string[]): string {
  const lines = [`> [!${type}] ${title}`];
  for (const line of body.flatMap((b) => b.split("\n"))) lines.push(line.length === 0 ? ">" : `> ${line}`);
  return lines.join("\n");
}

/** Callout type and title per graded verdict. "I don't know" is a distinct signal, never a red ✗. */
const VERDICTS = {
  dontKnow: ["question", "Quiz — I don't know"],
  correct: ["success", "Quiz — correct ✓"],
  incorrect: ["failure", "Quiz — incorrect ✗"],
} as const;

/** A correct option as shown to the user (`2. B`), or its bare index when the shown options are unknown. */
function shownOption(d: QuizResultDetails, index: number): string {
  const label = d.options?.find((o) => o.index === index)?.label;
  return label ? `${index}. ${label}` : `${index}`;
}

function quizAnswer(d: QuizResultDetails): string {
  if (d.status === "cancelled") return callout("warning", "Quiz — cancelled", ["(user skipped)"]);
  if (d.status === "unavailable") return callout("warning", "Quiz — unavailable", [d.message ?? ""]);
  const chosen = d.answers.map((a) => `${a.index}. ${a.label}`);
  const body = [
    `Your answer: ${d.dontKnow ? "I don't know" : chosen.length > 0 ? chosen.join(", ") : "(none)"}`,
    `Correct answer: ${d.correctIndices.map((i) => shownOption(d, i)).join(", ")}`,
  ];
  if (d.note) body.push("", `Note: ${d.note}`);
  if (d.explanation) body.push("", d.explanation);
  const [type, title] = VERDICTS[d.dontKnow ? "dontKnow" : d.correct ? "correct" : "incorrect"];
  return callout(type, title, body);
}

function askAnswer(o: AskOutcome): string {
  if (o.status === "cancelled") return callout("warning", "Question — cancelled", ["(user skipped)"]);
  if (o.status === "unavailable") return callout("warning", "Question — unavailable", [o.message]);
  const body = o.items.map((i) => (i.kind === "option" ? `${i.index}. ${i.label}` : `Other: ${i.text}`));
  if (body.length === 0) body.push("(no answer)");
  if (o.note) body.push("", `Note: ${o.note}`);
  return callout("example", "Answer", body);
}

/** One entry as a markdown block (no trailing newline). Port of md-log.ts:84-202, heading AGENT instead of PI. */
export function formatEntry(e: Entry): string {
  switch (e.kind) {
    case "user":
      return `> [!quote] YOU\n\n${e.text}`;
    case "assistant":
      return `> [!abstract] AGENT\n\n${e.text}`;
    case "question": {
      const body = [e.question];
      if (e.context) body.push("", e.context);
      if (e.options.length > 0) body.push("", ...e.options.map((label, i) => `${i + 1}. ${label}`));
      return callout("question", e.title, body);
    }
    case "quiz-answer":
      return quizAnswer(e.details);
    case "ask-answer":
      return askAnswer(e.outcome);
  }
}

/** A whole note, as `/md-log` backfills it: blocks separated by one blank line, newline-terminated. */
export function formatLog(entries: readonly Entry[]): string {
  return entries.length === 0 ? "" : `${entries.map(formatEntry).join("\n\n")}\n`;
}

/**
 * `current` with `blocks` appended so that appending to a backfilled note yields the same text as
 * backfilling everything at once. Existing content is never rewritten. Port of md-log.ts:68-80.
 */
export function appendBlocks(current: string, blocks: readonly string[]): string {
  let out = current;
  for (const block of blocks) {
    const sep = out.trim().length === 0 || out.endsWith("\n\n") ? "" : out.endsWith("\n") ? "\n" : "\n\n";
    out = `${out}${sep}${block}\n`;
  }
  return out;
}
