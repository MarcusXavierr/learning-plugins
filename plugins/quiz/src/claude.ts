import type { On } from "claude-code";
import { encodeQuizResult, type QuizResultDetails } from "../../../shared/quiz-contract.ts";
import { dialogLabels, dialogQuestion, responseFromDialog } from "./core/dialog.ts";
import { cancelledDetails, gradeQuiz, quizResultText, resultLines, unavailableDetails, type StyledLine } from "./core/grade.ts";
import { quizDetailsFromOutput } from "./core/output.ts";
import { CLAUDE_LIMITS, prepareQuiz, QuizInputError, type PreparedQuiz } from "./core/prepare.ts";
import { quizDescription, quizInputSchema } from "./core/schema.ts";

const INK: Record<StyledLine["tone"], { color?: string; dimColor?: boolean }> = {
  success: { color: "green" },
  error: { color: "red" },
  warning: { color: "yellow" },
  muted: { dimColor: true },
  dim: { dimColor: true },
};

// session.start runs before the first prompt and after reloads.
let interactive = false;

/** The model reads the text; md-log reads the structured block. */
function withBlock(details: QuizResultDetails): string {
  return `${quizResultText(details)}\n\n${encodeQuizResult(details)}`;
}

export function register(on: On): void {
  on("session.start", async ($, e, next) => {
    interactive = e.isInteractive;
    await $.tool.register({
      name: "quiz",
      description: quizDescription("claude"),
      inputSchema: quizInputSchema("claude"),
      isDeferred: false,
    });
    return next(e);
  });

  on("tool.call", { tool: "mcp__quiz__quiz" }, async ($, e) => {
    let quiz: PreparedQuiz;
    try {
      quiz = prepareQuiz(e, CLAUDE_LIMITS);
    } catch (error) {
      if (!(error instanceof QuizInputError)) throw error;
      return { result: error.message, isError: true as const };
    }
    if (!interactive) return { result: withBlock(unavailableDetails(quiz, "quiz requires an interactive Claude Code session")) };

    let answer: string;
    try {
      // Waiting inside the mods API call does not count against the hook's 10 s budget.
      answer = await $.ui.ask(dialogQuestion(quiz), {
        options: dialogLabels(quiz),
        header: "Quiz",
        ...(quiz.mode === "multi-select" ? { multiSelect: true as const } : {}),
      });
    } catch {
      return { result: withBlock(cancelledDetails(quiz)) };
    }
    return { result: withBlock(gradeQuiz(quiz, responseFromDialog(quiz, answer))) };
  }).catch(($, e, next) => ({ result: `quiz failed: ${next.error.message ?? next.error.kind}`, isError: true as const }));
  // Draw feedback at the result row, without exposing the structured block to the user.
  on("ui.render", { component: "ToolResult" }, async ($, e, next) => {
    if (e.props.tool !== "mcp__quiz__quiz" || e.props.isErrored) return next(e);
    const details = quizDetailsFromOutput(e.props.output);
    if (!details) return next(e);
    const { Box, Text } = $.ui.resolve(e);
    return Box({
      flexDirection: "column",
      children: resultLines(details).map((line) => Text({ ...INK[line.tone], children: [line.text === "" ? " " : line.text] })),
    });
  });
}
