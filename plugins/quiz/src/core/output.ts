import { decodeQuizResult, type QuizResultDetails } from "../../../../shared/quiz-contract.ts";

/** Decode the quiz block in a CC ToolResult's stored string or text blocks. */
// eslint-disable-next-line llm-core/no-unknown-parameters, llm-core/filename-match-export -- host boundary decoder in plan-pinned core/output.ts
export function quizDetailsFromOutput(output: unknown): QuizResultDetails | undefined {
  if (typeof output === "string") return decodeQuizResult(output);
  if (!Array.isArray(output)) return undefined;
  const text = output
    // eslint-disable-next-line llm-core/no-unknown-parameters -- each stored host block needs narrowing
    .map((block: unknown) =>
      typeof block === "object" && block !== null && "text" in block && typeof block.text === "string" ? block.text : "",
    )
    .join("\n");
  return decodeQuizResult(text);
}
