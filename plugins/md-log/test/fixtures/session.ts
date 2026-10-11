import { displayedOptions, displayOrder, encodeQuizResult, type QuizResultDetails } from "../../../../shared/quiz-contract.ts";
import type { ClaudeMessage } from "../../src/core/from-claude.ts";
import type { OmpMessage } from "../../src/core/from-omp.ts";

/** One teaching exchange, recorded once per harness. Both must log as golden/session.md. */
export const PROMPT =
  '<skill name="teach" location="/skills/teach/SKILL.md">\nWhole skill text.\n</skill>\n\nTeach me what makes a number prime.';
export const PROSE_1 = "A prime has exactly two divisors: 1 and itself.\n\nQuick check:";
export const PROSE_2 = "Right. Now a preference question.";
export const PROSE_3 = "Slow it is. Next lesson: factor trees.";

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

const QUESTION = "How fast should we go?";
export const OMP_ASK_INPUT = {
  questions: [{ id: "pace", question: QUESTION, header: "Pace", options: [{ label: "Slow" }, { label: "Fast" }] }],
};
export const OMP_ASK_DETAILS = { question: QUESTION, options: ["Slow", "Fast"], multi: false, selectedOptions: ["Slow"] };
const CLAUDE_ASK_INPUT = {
  questions: [{
    question: QUESTION,
    header: "Pace",
    options: [{ label: "Slow", description: "One idea at a time" }, { label: "Fast", description: "Skim" }],
    multiSelect: false,
  }],
};
/** Shape and text as the Phase 1 probe recorded them (`/tmp/hello-smoke/hello-probe.json`). */
const CLAUDE_ASK_RESULT = { questions: CLAUDE_ASK_INPUT.questions, answers: { [QUESTION]: "Slow" }, annotations: {} };

/** omp's active branch, as `ctx.sessionManager.getBranch()` messages (pi-ai types.d.ts:760-903). */
export const OMP_MESSAGES: OmpMessage[] = [
  { role: "user", content: PROMPT },
  {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "Use a quiz." },
      { type: "text", text: PROSE_1 },
      { type: "toolCall", id: "call-quiz", name: "quiz", arguments: QUIZ_INPUT },
    ],
  },
  { role: "toolResult", toolCallId: "call-quiz", toolName: "quiz", content: [{ type: "text", text: "Correct ✓" }], details: QUIZ_DETAILS, isError: false },
  {
    role: "assistant",
    content: [{ type: "text", text: PROSE_2 }, { type: "toolCall", id: "call-ask", name: "ask", arguments: OMP_ASK_INPUT }],
  },
  { role: "toolResult", toolCallId: "call-ask", toolName: "ask", content: [{ type: "text", text: "User selected: Slow" }], details: OMP_ASK_DETAILS, isError: false },
  { role: "assistant", content: [{ type: "text", text: PROSE_3 }] },
];

/**
 * CC's transcript, as `$.session.messages()` returns it (cc.d.ts:8964-8990, 10180-10211). As in the Phase 1 probe:
 * a deferred mod tool is first loaded with `ToolSearch`, each tool turn is followed by a harness-only user row
 * (empty text; its `toolResults` are not read), and a mod tool's `result` is the content array it returned.
 */
export const CLAUDE_MESSAGES: ClaudeMessage[] = [
  { role: "user", text: PROMPT, toolUses: [] },
  {
    role: "assistant",
    text: "",
    toolUses: [{
      tool_use_id: "toolu_search",
      tool: "ToolSearch",
      input: { query: "select:mcp__quiz__quiz" },
      result: { matches: ["mcp__quiz__quiz"], query: "select:mcp__quiz__quiz" },
      text: "",
    }],
  },
  { role: "user", text: "", toolUses: [] },
  {
    role: "assistant",
    text: PROSE_1,
    toolUses: [{
      tool_use_id: "toolu_quiz",
      tool: "mcp__quiz__quiz",
      input: QUIZ_INPUT,
      result: [{ type: "text", text: "Correct ✓" }, { type: "text", text: encodeQuizResult(QUIZ_DETAILS) }],
      text: `Correct ✓\n\n${encodeQuizResult(QUIZ_DETAILS)}`,
    }],
  },
  { role: "user", text: "", toolUses: [] },
  {
    role: "assistant",
    text: PROSE_2,
    toolUses: [{
      tool_use_id: "toolu_ask",
      tool: "AskUserQuestion",
      input: CLAUDE_ASK_INPUT,
      result: CLAUDE_ASK_RESULT,
      text: `Your questions have been answered: "${QUESTION}"="Slow". You can now continue with these answers in mind.`,
    }],
  },
  { role: "user", text: "", toolUses: [] },
  { role: "assistant", text: PROSE_3, toolUses: [] },
];
