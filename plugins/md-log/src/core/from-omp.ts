import { isQuizResultDetails } from "../../../../shared/quiz-contract.ts";
import { toolName } from "../../../../shared/tool-map.ts";
import {
  answerItem, askQuestionEntries, askQuestions, assistantEntry, NO_RESULT,
  quizAnswerEntry, quizQuestionEntry, userEntry, type AskOutcome, type Entry,
} from "./entries.ts";
import { asFlag, asRecord, asText, type Payload } from "./payload.ts";

const QUIZ = toolName("quiz", "omp");
const ASK = toolName("ask", "omp");

/** The parts of an omp `AgentMessage` md-log reads (`@oh-my-pi/pi-ai` types.d.ts:760-903). */
interface OmpMessage {
  readonly role: string;
  readonly content?: unknown;
  readonly toolCallId?: unknown;
  readonly toolName?: unknown;
  readonly details?: unknown;
  readonly isError?: unknown;
}

/** Text blocks of a message content (`string | (TextContent | …)[]`), joined with newlines. */
// eslint-disable-next-line llm-core/no-unknown-parameters -- decodes untrusted omp message content.
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(asRecord).filter((c) => c?.type === "text").map((c) => asText(c?.text)).join("\n");
}

/** Question blocks for a `quiz` or native `ask` call, from its input; [] for every other tool. */
// eslint-disable-next-line llm-core/no-unknown-parameters -- decodes the untrusted tool input.
export function ompToolCallEntries(tool: string, input: unknown): Entry[] {
  if (tool === QUIZ) return [quizQuestionEntry(input)];
  if (tool === ASK) return askQuestionEntries(input);
  return [];
}

interface OmpToolResult { details: unknown; isError: boolean; text: string }

/**
 * The per-question result records of an `ask` details object, or "chat" for "Chat about this".
 * Shapes from `@oh-my-pi/pi-tui@18.2.10` tools/ask.d.ts:5-34 (`AskToolDetails`, `QuestionResult`) as filled by
 * pi-coding-agent src/tools/ask.ts:980,1019-1031,1082-1100,1160: one question →
 * `{question, options, multi, selectedOptions, customInput?, note?, timedOut?}`; several → `{results: QuestionResult[]}`;
 * "Chat about this" → `{chatRedirect: true, questions}`; bad input → `details: {}` and an `Error: …` text.
 */
function askResults(details: Payload | undefined): (Payload | undefined)[] | "chat" {
  if (!details) return [];
  if (asFlag(details.chatRedirect)) return "chat";
  if (Array.isArray(details.results)) return details.results.map(asRecord);
  return Array.isArray(details.selectedOptions) ? [details] : [];
}

/** One question's answer from its result record; undefined when the record is missing or malformed. */
function askAnswer(options: readonly string[], record: Payload | undefined): AskOutcome | undefined {
  const selected = record?.selectedOptions;
  if (!Array.isArray(selected) || !selected.every((label) => typeof label === "string")) return undefined;
  const items = selected.map((label) => answerItem(label, options));
  if (typeof record?.customInput === "string") items.push({ kind: "other", text: record.customInput });
  const note = asText(record?.note).trim() || undefined;
  return note ? { status: "answered", items, note } : { status: "answered", items };
}

/**
 * omp `ask` outcome per asked question. Cancel or headless makes the tool throw, so `tool_result` has
 * `isError: true` and `details: undefined` (extensions/wrapper.ts:363-384): every question is unavailable.
 */
// eslint-disable-next-line llm-core/no-unknown-parameters -- decodes the untrusted tool input.
function ompAskOutcomes(input: unknown, result: OmpToolResult): AskOutcome[] {
  const questions = askQuestions(input);
  const results = result.isError ? [] : askResults(asRecord(result.details));
  if (results === "chat") return questions.map(() => ({ status: "cancelled" }));
  const unavailable: AskOutcome = { status: "unavailable", message: result.text.trim() || NO_RESULT };
  return questions.map((q, i) => askAnswer(q.options, results[i]) ?? unavailable);
}

/** Answer blocks for a finished `quiz` or native `ask` call; [] for every other tool. */
// eslint-disable-next-line llm-core/no-unknown-parameters -- decodes the untrusted tool input.
export function ompToolResultEntries(tool: string, input: unknown, result: OmpToolResult): Entry[] {
  if (tool === QUIZ) {
    return [quizAnswerEntry(isQuizResultDetails(result.details) ? result.details : undefined, result.text)];
  }
  if (tool === ASK) return ompAskOutcomes(input, result).map((outcome) => ({ kind: "ask-answer", outcome }));
  return [];
}

/** Walk assistant blocks in order, flushing contiguous prose around each question tool. */
function ompAssistantEntries(message: OmpMessage): Entry[] {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
  const out: Entry[] = [];
  let text: string[] = [];
  const flush = () => {
    const prose = assistantEntry(text);
    if (prose) out.push(prose);
    text = [];
  };
  for (const block of message.content.map(asRecord)) {
    if (block?.type === "text") text.push(asText(block.text));
    const calls = block?.type === "toolCall" ? ompToolCallEntries(asText(block.name), block.arguments) : [];
    if (calls.length === 0) continue;
    flush();
    out.push(...calls);
  }
  flush();
  return out;
}

/** The `quiz` and `ask` calls of an assistant message, by tool call id. */
function questionCalls(message: OmpMessage): { id: string; input: unknown }[] {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content.map(asRecord).flatMap((block) => {
    const tool = asText(block?.name);
    return block?.type === "toolCall" && (tool === QUIZ || tool === ASK) ? [{ id: asText(block.id), input: block.arguments }] : [];
  });
}

/** Active-branch entries retain content-block order, with each tool's answer at its result. */
export function backfillFromOmp(messages: readonly OmpMessage[]): Entry[] {
  const inputs = new Map<string, unknown>();
  return messages.flatMap((message): Entry[] => {
    if (message.role === "user") return [userEntry(contentText(message.content))].filter((entry) => entry !== undefined);
    if (message.role === "toolResult") {
      const id = asText(message.toolCallId);
      if (!inputs.has(id)) return [];
      return ompToolResultEntries(asText(message.toolName), inputs.get(id), {
        details: message.details,
        isError: asFlag(message.isError),
        text: contentText(message.content),
      });
    }
    for (const call of questionCalls(message)) inputs.set(call.id, call.input);
    return ompAssistantEntries(message);
  });
}
