import {
  displayOrder,
  type QuizInput,
  type QuizMode,
  type QuizOption,
  type RawQuizOption,
} from "../../../../shared/quiz-contract.ts";

/** The always-added choice that signals a genuine gap instead of a guess. Never a real option. */
export const DONT_KNOW_LABEL = "I don't know";

/** Bad tool input. The message is written for the model: it names the problem and the fix. */
class QuizInputError extends Error {}

/** Extra rules for a host whose dialog returns the chosen option *labels* (Claude Code's `$.ui.ask`). */
export interface QuizLimits {
  /** Most real options the host's dialog can show next to "I don't know". */
  maxOptions?: number;
  /** Answers come back as labels: labels must be unique, never "I don't know", and comma-free in multi-select. */
  answersByLabel?: boolean;
}

const MAX_CLAUDE_OPTIONS = 3;

/** `$.ui.ask` shows 2-4 options (cc.d.ts AskOptions.options); one row is "I don't know". */
export const CLAUDE_LIMITS: QuizLimits = { maxOptions: MAX_CLAUDE_OPTIONS, answersByLabel: true };

/** A validated quiz, options already in the order the user will see them. */
export interface PreparedQuiz {
  /** As the model wrote it: it seeds the shuffle, and md-log recomputes the order from it. */
  question: string;
  /** `details`, trimmed; absent when blank. md-log uses the same rule. */
  context?: string;
  mode: QuizMode;
  /** `displayOrder(input)` from the quiz contract. */
  options: QuizOption[];
  /** 1-based positions in `options`, ascending. */
  correctIndices: number[];
  explanation: string;
}

// eslint-disable-next-line llm-core/no-unknown-parameters -- decode untrusted tool arguments at this boundary
function parseQuizInput(raw: unknown): QuizInput {
  if (typeof raw !== "object" || raw === null) throw new QuizInputError("quiz input must be an object");
  // Tool arguments arrive unvalidated in CC; each field is checked below before use.
  // eslint-disable-next-line llm-core/no-unsafe-dictionary-type -- tool arguments need field-by-field decoding
  const { question, details, options, multiSelect, correctAnswer, explanation, shuffle } = raw as Record<string, unknown>;
  if (details !== undefined && typeof details !== "string") throw new QuizInputError("quiz details must be a string");
  if (multiSelect !== undefined && typeof multiSelect !== "boolean") throw new QuizInputError("quiz multiSelect must be a boolean");
  if (shuffle !== undefined && typeof shuffle !== "boolean") throw new QuizInputError("quiz shuffle must be a boolean");
  if (typeof question !== "string" || question.trim() === "") {
    throw new QuizInputError("quiz question is required: one question per call");
  }
  if (!Array.isArray(options)) {
    throw new QuizInputError("quiz options must be an array of { label, value?, description? }");
  }
  const parsedOptions = options.map((
    // eslint-disable-next-line llm-core/no-unknown-parameters -- each untrusted option is decoded here
    option: unknown, i): RawQuizOption => {
    // eslint-disable-next-line llm-core/no-unsafe-dictionary-type -- decode option properties independently
    const { label, value, description } = (typeof option === "object" && option !== null ? option : {}) as Record<string, unknown>;
    if (typeof label !== "string") throw new QuizInputError(`quiz option ${i + 1} needs a string label`);
    if (value !== undefined && typeof value !== "string") throw new QuizInputError(`quiz option ${i + 1} value must be a string`);
    if (description !== undefined && typeof description !== "string") throw new QuizInputError(`quiz option ${i + 1} description must be a string`);
    return {
      label,
      ...(typeof value === "string" ? { value } : {}),
      ...(typeof description === "string" ? { description } : {}),
    };
  });
  if (
    !(
      typeof correctAnswer === "string" ||
      (Array.isArray(correctAnswer) && correctAnswer.every((v): v is string => typeof v === "string"))
    )
  ) {
    throw new QuizInputError(
      "quiz correctAnswer is required: the option value, or an array of values for multi-select",
    );
  }
  if (typeof explanation !== "string" || explanation.trim() === "") {
    throw new QuizInputError("quiz explanation is required: say why the correct answer is correct");
  }
  return {
    question,
    ...(typeof details === "string" ? { details } : {}),
    options: parsedOptions,
    ...(multiSelect ? { multiSelect: true } : {}),
    correctAnswer,
    explanation,
    ...(shuffle !== undefined && !shuffle ? { shuffle: false } : {}),
  };
}

// The model sometimes sends a multi-select array as a JSON string ('["a", "b"]'),
// because the schema's union lists the string form first. Parse that back into
// an array; anything else, including a bracketed value that is not JSON, is one
// literal value. Port of quiz.ts:158-175.
function correctValues(correctAnswer: string | string[]): string[] {
  if (Array.isArray(correctAnswer)) return correctAnswer.map((v) => v.trim());
  const trimmed = correctAnswer.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim());
    } catch {
      return [trimmed]; // Not JSON: a literal bracketed value.
    }
  }
  return [trimmed];
}

function checkLimits(options: readonly QuizOption[], mode: QuizMode, limits: QuizLimits): void {
  if (limits.maxOptions !== undefined && options.length > limits.maxOptions) {
    throw new QuizInputError(
      `quiz takes at most ${limits.maxOptions} options here (the dialog adds "${DONT_KNOW_LABEL}" as one more row); got ${options.length}`,
    );
  }
  if (!limits.answersByLabel) return;
  const seen = new Set<string>();
  for (const { label } of options) {
    if (label === DONT_KNOW_LABEL) {
      throw new QuizInputError(`quiz option label "${DONT_KNOW_LABEL}" is reserved: that choice is added automatically`);
    }
    if (seen.has(label)) {
      throw new QuizInputError(`quiz option labels must be unique here, because the answer comes back as a label: "${label}" appears twice`);
    }
    seen.add(label);
    if (mode === "multi-select" && label.includes(",")) {
      throw new QuizInputError(
        `quiz multi-select option labels must not contain "," here, because the answer comes back comma-joined: "${label}"`,
      );
    }
  }
}

/**
 * Validate raw tool arguments and resolve everything the dialog and the grader need.
 * Throws QuizInputError for any input the quiz cannot grade honestly.
 */
// eslint-disable-next-line llm-core/no-unknown-parameters -- public parser accepts untrusted tool arguments
export function prepareQuiz(raw: unknown, limits: QuizLimits = {}): PreparedQuiz {
  const input = parseQuizInput(raw);
  const mode: QuizMode = input.multiSelect ? "multi-select" : "single-select";
  let options: QuizOption[];
  try {
    options = displayOrder(input);
  } catch (error) {
    throw new QuizInputError(`quiz ${error instanceof Error ? error.message : String(error)}`);
  }
  if (options.length < 2) throw new QuizInputError("quiz requires at least two options");
  checkLimits(options, mode, limits);

  const values = correctValues(input.correctAnswer);
  if (values.length === 0) throw new QuizInputError("quiz correctAnswer is required");
  const indices = new Set<number>();
  for (const value of values) {
    const position = options.findIndex((o) => o.value === value);
    if (position === -1) {
      const known = options.map((o) => `"${o.value}"`).join(", ");
      throw new QuizInputError(`quiz correctAnswer "${value}" does not match any option value (${known})`);
    }
    indices.add(position + 1);
  }
  const correctIndices = [...indices].sort((a, b) => a - b);
  if (mode === "single-select" && correctIndices.length > 1) {
    throw new QuizInputError(
      `quiz single-select needs exactly one correctAnswer; got ${correctIndices.length}. Set multiSelect: true when several options are correct.`,
    );
  }

  const context = input.details?.trim() || undefined;
  return {
    question: input.question,
    ...(context ? { context } : {}),
    mode,
    options,
    correctIndices,
    explanation: input.explanation.trim(),
  };
}
