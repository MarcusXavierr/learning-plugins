import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import type { Component } from "@oh-my-pi/pi-tui";
import type { QuizResultDetails } from "../../../../shared/quiz-contract.ts";
import { cancelledDetails, gradeQuiz, quizResultText, resultLines, unavailableDetails, type QuizResponse } from "../core/grade.ts";
import { prepareQuiz, QuizInputError, type PreparedQuiz } from "../core/prepare.ts";
import { quizDescription, quizInputSchema } from "../core/schema.ts";

/** The omp UI the tool needs. `src/omp.ts` implements it with pi-tui; tests script it. */
export interface QuizUi {
  /** Show the dialog. Resolves to the answer, or null when the user cancels; rejects when `signal` aborts it. */
  ask(ctx: ExtensionContext, quiz: PreparedQuiz, signal: AbortSignal | undefined): Promise<QuizResponse | null>;
  /** A plain text component for the transcript (pi-tui `Text`). */
  text(text: string): Component;
}

// ctx.ui.custom shows one component at a time. An aborted waiter must settle
// without waiting for the active dialog; its slot still preserves FIFO.
let queue: Promise<void> = Promise.resolve();
async function serialized<T>(run: () => Promise<T>, signal: AbortSignal | undefined, onAbort: () => T): Promise<T> {
  const previous = queue;
  const slot = Promise.withResolvers<void>();
  queue = previous.then(() => slot.promise);
  const aborted = Promise.withResolvers<void>();
  signal?.addEventListener("abort", aborted.resolve, { once: true });
  try {
    if (signal?.aborted) return onAbort();
    await Promise.race([previous, aborted.promise]);
    if (signal?.aborted) return onAbort();
    return await run();
  } finally {
    signal?.removeEventListener("abort", aborted.resolve);
    slot.resolve();
  }
}

function answer(details: QuizResultDetails) {
  return { content: [{ type: "text" as const, text: quizResultText(details) }], details };
}

export function registerQuiz(pi: ExtensionAPI, ui: QuizUi): void {
  // eslint-disable-next-line llm-core/no-unsafe-dictionary-type -- host tool arguments are untrusted JSON decoded by prepareQuiz
  pi.registerTool<Record<string, unknown>, QuizResultDetails>({
    name: "quiz",
    label: "quiz",
    // Extension tools default to "discoverable" (xd:// devices); prompts call quiz by name.
    loadMode: "essential",
    description: quizDescription("omp"),
    parameters: quizInputSchema("omp"),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      let quiz: PreparedQuiz;
      try {
        quiz = prepareQuiz(params);
      } catch (error) {
        if (!(error instanceof QuizInputError)) throw error;
        return { content: [{ type: "text", text: error.message }], isError: true };
      }
      // RPC mode reports hasUI but its ui.custom resolves undefined at once (pi-coding-agent src/modes/rpc/rpc-mode.ts:995-998).
      if (!ctx.hasUI || ctx.mode !== "tui") return answer(unavailableDetails(quiz, "quiz requires interactive mode UI"));

      return serialized(async () => {
        if (signal?.aborted) return answer(cancelledDetails(quiz));
        let response: QuizResponse | null;
        try {
          response = await ui.ask(ctx, quiz, signal);
        } catch (error) {
          if (signal?.aborted) return answer(cancelledDetails(quiz));
          throw error;
        }
        return answer(response ? gradeQuiz(quiz, response) : cancelledDetails(quiz));
      }, signal, () => answer(cancelledDetails(quiz)));
    },

    // Never shows options, correctAnswer, or explanation: the call row is drawn before the user answers.
    renderCall(args, _options, theme) {
      // eslint-disable-next-line llm-core/no-unsafe-dictionary-type -- transcript input from an untrusted host call
      const { question, multiSelect, options } = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
      let text = theme.fg("toolTitle", theme.bold("quiz ")) + theme.fg("muted", typeof question === "string" ? question : "");
      if (typeof multiSelect === "boolean" && multiSelect) text += theme.fg("dim", " [multi-select]");
      if (Array.isArray(options) && options.length > 0) text += theme.fg("dim", ` (${options.length} options)`);
      return ui.text(text);
    },

    renderResult(result, _options, theme) {
      const details = result.details;
      if (!details) {
        const first = result.content[0];
        return ui.text(first?.type === "text" ? first.text : "");
      }
      return ui.text(resultLines(details).map((line) => theme.fg(line.tone, line.text)).join("\n"));
    },
  });
}
