/** @public Quiz contract (master plan, Shared contracts). */
export type QuizStatus = "answered" | "cancelled" | "unavailable";
/** @public Quiz contract (master plan, Shared contracts). */
export type QuizMode = "single-select" | "multi-select";
export interface RawQuizOption { label: string; value?: string; description?: string }
export interface QuizOption { label: string; value: string; description?: string }
/** @public Quiz contract (master plan, Shared contracts). */
export interface OptionAnswer { label: string; value: string; index: number }   // 1-based display index
export interface DisplayedOption { index: number; label: string }                // 1-based display index
export interface QuizInput {
  question: string; details?: string; options: RawQuizOption[];
  multiSelect?: boolean; correctAnswer: string | string[]; explanation: string; shuffle?: boolean;
}
export interface QuizResultDetails {
  status: QuizStatus; question: string; context?: string; mode: QuizMode;
  answers: OptionAnswer[]; correctIndices: number[]; options?: DisplayedOption[];
  correct?: boolean; dontKnow?: boolean; note?: string; explanation?: string; message?: string;
}

/** Trim; value defaults to label; drop empty labels; throw `duplicate option value "<v>"`. Port of quiz.ts:124-140. */
export function normalizeOptions(raw: readonly RawQuizOption[]): QuizOption[] {
  const seen = new Set<string>();
  const out: QuizOption[] = [];
  for (const option of raw) {
    const label = option.label.trim();
    if (label.length === 0) continue;
    const value = option.value?.trim() || label;
    if (seen.has(value)) throw new Error(`duplicate option value "${value}"`);
    seen.add(value);
    const description = option.description?.trim();
    out.push(description ? { label, value, description } : { label, value });
  }
  return out;
}

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const MULBERRY_INCREMENT = 0x6d2b79f5;
const UINT32_RANGE = 2 ** 32;

/** FNV-1a, 32-bit, over the UTF-8 bytes of `text`. */
function fnv1a32(text: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** mulberry32: a tiny seeded PRNG returning floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let t = state;
    /* eslint-disable llm-core/no-magic-numbers -- mulberry32's published mixing shifts; names would add nothing. */
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
    /* eslint-enable llm-core/no-magic-numbers -- end of mulberry32's mixing constants. */
  };
}

/** Normalized options in display order. shuffle !== false → Fisher–Yates driven by mulberry32 seeded with
 *  FNV-1a-32 over the UTF-8 bytes of `question + "\u0000" + values.join("\u0000")`. Same input → same order, in every harness. */
export function displayOrder(input: Pick<QuizInput, "question" | "options" | "shuffle">): QuizOption[] {
  const { question, shuffle = true } = input;
  const options = normalizeOptions(input.options);
  if (!shuffle) return options;
  const random = mulberry32(fnv1a32([question, ...options.map((o) => o.value)].join("\u0000")));
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    // eslint-disable-next-line llm-core/no-type-system-bypass -- i and j are both in [0, options.length).
    [options[i], options[j]] = [options[j]!, options[i]!];
  }
  return options;
}

export function displayedOptions(order: readonly QuizOption[]): DisplayedOption[] {
  return order.map((option, i) => ({ index: i + 1, label: option.label }));
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json | undefined };
type FieldCheck = (field: Json | undefined) => boolean;

// eslint-disable-next-line llm-core/no-unknown-parameters -- type guard over untrusted tool details and embedded JSON.
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isIndex: FieldCheck = (n) => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const isString: FieldCheck = (s) => typeof s === "string";
const optionalString: FieldCheck = (s) => s === undefined || typeof s === "string";
const optionalBoolean: FieldCheck = (b) => b === undefined || typeof b === "boolean";
const listOf = (item: FieldCheck): FieldCheck => (list) => Array.isArray(list) && list.every(item);
const oneOf = (allowed: readonly string[]): FieldCheck => (s) => typeof s === "string" && allowed.includes(s);
const isAnswer: FieldCheck = (a) => isJsonObject(a) && isIndex(a.index) && isString(a.label) && isString(a.value);
const isDisplayed: FieldCheck = (o) => isJsonObject(o) && isIndex(o.index) && isString(o.label);

/** One check per field the formatter reads; keyed by the interface so a new field cannot go unchecked. */
const FIELD_CHECKS: Record<keyof QuizResultDetails, FieldCheck> = {
  status: oneOf(["answered", "cancelled", "unavailable"] satisfies QuizStatus[]),
  question: isString,
  context: optionalString,
  mode: oneOf(["single-select", "multi-select"] satisfies QuizMode[]),
  answers: listOf(isAnswer),
  correctIndices: listOf(isIndex),
  options: (o) => o === undefined || listOf(isDisplayed)(o),
  correct: optionalBoolean,
  dontKnow: optionalBoolean,
  note: optionalString,
  explanation: optionalString,
  message: optionalString,
};

/** Validate formatter fields: status/question/mode; answers with positive 1-based integer index,
 * string label/value; positive integer correctIndices; optional displayed options with positive index/string
 * label; optional context/note/explanation/message strings and correct/dontKnow booleans.
 * @public Quiz contract (master plan, Shared contracts). */
// eslint-disable-next-line llm-core/no-unknown-parameters -- type guard over untrusted tool details and embedded JSON.
export function isQuizResultDetails(value: unknown): value is QuizResultDetails {
  return isJsonObject(value) && Object.entries(FIELD_CHECKS).every(([field, check]) => check(value[field]));
}

const OPEN = "<quiz-result>";
const CLOSE = "</quiz-result>";

/** `<quiz-result>${JSON.stringify(d) with "<" written as \u003c}</quiz-result>`, so a payload cannot close the block early. */
export function encodeQuizResult(d: QuizResultDetails): string {
  return `${OPEN}${JSON.stringify(d).replace(/</g, "\\u003c")}${CLOSE}`;
}

/** First block; undefined when absent, unterminated, malformed, or not isQuizResultDetails. */
export function decodeQuizResult(text: string): QuizResultDetails | undefined {
  const start = text.indexOf(OPEN);
  if (start < 0) return undefined;
  const end = text.indexOf(CLOSE, start + OPEN.length);
  if (end < 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start + OPEN.length, end));
  } catch {
    return undefined;
  }
  return isQuizResultDetails(parsed) ? parsed : undefined;
}
