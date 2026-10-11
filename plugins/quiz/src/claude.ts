import type { On } from "claude-code";
import { encodeQuizResult, type QuizResultDetails } from "../../../shared/quiz-contract.ts";
import { dialogLabels, dialogQuestion, responseFromDialog } from "./core/dialog.ts";
import { cancelledDetails, gradeQuiz, quizResultText, unavailableDetails } from "./core/grade.ts";
import { CLAUDE_LIMITS, prepareQuiz, QuizInputError, type PreparedQuiz } from "./core/prepare.ts";
import { quizDescription, quizInputSchema } from "./core/schema.ts";

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
}
