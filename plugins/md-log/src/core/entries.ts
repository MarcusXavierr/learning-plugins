import { displayOrder, type QuizResultDetails, type RawQuizOption } from "../../../../shared/quiz-contract.ts";
import { asFlag, asRecord, asText } from "./payload.ts";

/** One answered line: a chosen option (1-based, as shown) or text the user typed instead. */
type AskAnswerItem =
  | { kind: "option"; index: number; label: string }
  | { kind: "other"; text: string };

export type AskOutcome =
  | { status: "answered"; items: AskAnswerItem[]; note?: string }
  | { status: "cancelled" }
  | { status: "unavailable"; message: string };

/** What md-log writes, harness-neutral. The same entries format byte-identically in both harnesses. */
export type Entry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "question"; title: string; question: string; context?: string; options: string[] }
  | { kind: "quiz-answer"; details: QuizResultDetails }
  | { kind: "ask-answer"; outcome: AskOutcome };

export const NO_RESULT = "No answer was recorded.";

/**
 * Skill declarations (`<skill name="…">…</skill>`) are system-injected context, not prose:
 * each becomes a one-line note. Port of md-log.ts:100-108.
 */
function stripSkillBlocks(text: string): string {
  return text.replace(/<skill\b([^>]*)>[\s\S]*?<\/skill>/g, (_match, attrs: string) =>
    `> [!note] SKILL loaded: ${/name="([^"]+)"/.exec(attrs)?.[1] ?? "(unknown)"}`);
}

/** A user prompt, trimmed and skill-stripped; undefined when nothing readable is left. */
export function userEntry(raw: string): Entry | undefined {
  const text = stripSkillBlocks(raw.trim());
  return text ? { kind: "user", text } : undefined;
}

/** Assistant prose from its text parts; undefined when every part is blank. */
export function assistantEntry(parts: readonly string[]): Entry | undefined {
  const text = parts.map((p) => p.trim()).filter((p) => p.length > 0).join("\n\n");
  return text ? { kind: "assistant", text } : undefined;
}

/** The quiz question in the order the user sees it (quiz contract), from the tool input alone. */
// eslint-disable-next-line llm-core/no-unknown-parameters -- decodes the untrusted quiz tool input.
export function quizQuestionEntry(input: unknown): Entry {
  const args = asRecord(input) ?? {};
  const question = asText(args.question);
  const context = asText(args.details).trim() || undefined;
  const raw: RawQuizOption[] = (Array.isArray(args.options) ? args.options : []).map(asRecord).flatMap((o) =>
    typeof o?.label === "string"
      ? [{
        label: o.label,
        value: typeof o.value === "string" ? o.value : undefined,
        description: typeof o.description === "string" ? o.description : undefined,
      }]
      : []);
  const shuffle = typeof args.shuffle === "boolean" ? args.shuffle : undefined;
  let options: string[];
  try {
    options = displayOrder({ question, options: raw, shuffle }).map((o) => o.label);
  } catch {
    // Duplicate option values: the quiz itself answers "unavailable"; log the question without options.
    options = [];
  }
  return { kind: "question", title: "Quiz", question, context, options };
}

/** The graded outcome; a result without usable details is logged as unavailable with `fallback` as the reason. */
export function quizAnswerEntry(details: QuizResultDetails | undefined, fallback: string): Entry {
  return {
    kind: "quiz-answer",
    details: details ?? {
      status: "unavailable",
      question: "",
      mode: "single-select",
      answers: [],
      correctIndices: [],
      message: fallback.trim() || NO_RESULT,
    },
  };
}

/** One native-ask question as both harnesses phrase it (omp `ask`, CC `AskUserQuestion`). */
interface AskQuestion { question: string; header?: string; options: string[]; multi: boolean }

// eslint-disable-next-line llm-core/no-unknown-parameters -- decodes the untrusted native-ask tool input.
export function askQuestions(input: unknown): AskQuestion[] {
  const questions = asRecord(input)?.questions;
  return (Array.isArray(questions) ? questions : []).map(asRecord).filter((q) => q !== undefined).map((q) => ({
    question: asText(q.question),
    header: asText(q.header).trim() || undefined,
    options: (Array.isArray(q.options) ? q.options : []).map((o) => asText(asRecord(o)?.label)),
    // omp's `ask` says `multi`, CC's `AskUserQuestion` says `multiSelect`.
    multi: [q.multi, q.multiSelect].some(asFlag),
  }));
}

/** One question block per asked question, written before the user answers. */
// eslint-disable-next-line llm-core/no-unknown-parameters -- decodes the untrusted native-ask tool input.
export function askQuestionEntries(input: unknown): Entry[] {
  return askQuestions(input).map((q) => ({
    kind: "question",
    title: q.header ? `Question — ${q.header}` : "Question",
    question: q.question,
    options: q.options,
  }));
}

/** A chosen label as an answer line: its 1-based position among the offered options, else typed text. */
export function answerItem(label: string, options: readonly string[]): AskAnswerItem {
  const index = options.indexOf(label);
  return index >= 0 ? { kind: "option", index: index + 1, label } : { kind: "other", text: label };
}
