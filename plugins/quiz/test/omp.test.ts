import { describe, expect, test } from "vitest";
import { createFakeOmp } from "../../../test-support/fake-omp.ts";
import type { QuizResponse } from "../src/core/grade.ts";
import type { PreparedQuiz } from "../src/core/prepare.ts";
import { registerQuiz } from "../src/omp/tool.ts";

const planets = {
  question: "Which planet is closest to the Sun?",
  options: [
    { label: "Mercury", value: "mercury" },
    { label: "Venus", value: "venus" },
    { label: "Mars", value: "mars" },
  ],
  correctAnswer: "mercury",
  explanation: "Mercury orbits at about 0.39 AU.",
};

/** The dialog as the user drives it: each call answers with the next scripted reply. */
function setup(...replies: ((quiz: PreparedQuiz) => Promise<QuizResponse | null>)[]) {
  const fake = createFakeOmp();
  const shown: PreparedQuiz[] = [];
  registerQuiz(fake.api, {
    ask: (_ctx, quiz) => {
      shown.push(quiz);
      const reply = replies.shift();
      if (!reply) throw new Error("dialog opened more often than scripted");
      return reply(quiz);
    },
    text: (text) => ({ render: () => [text] }),
  });
  const run = (params: typeof planets, signal?: AbortSignal) =>
    fake.tools.get("quiz")!.execute("call-1", params, signal, undefined, fake.ctx);
  return { fake, shown, run };
}
const choose = (label: string) => (quiz: PreparedQuiz): Promise<QuizResponse> => {
  const index = quiz.options.findIndex((o) => o.label === label) + 1;
  return Promise.resolve({ dontKnow: false, answers: [{ label, value: quiz.options[index - 1]!.value, index }] });
};

describe("omp quiz tool", () => {
  test("grades the answer: details carry the structured result, the text is for the model", async () => {
    const { run } = setup(choose("Mercury"));
    const result = await run(planets);
    expect(result.details).toMatchObject({ status: "answered", correct: true, mode: "single-select" });
    const content = result.content[0];
    if (content?.type !== "text") throw new Error("expected model-facing text");
    expect(content.text).toMatch(/^User answered correctly\./);
    expect(JSON.stringify(result.content)).not.toContain("<quiz-result>");
  });

  test("bad input is an error the model can act on, and no dialog opens", async () => {
    const { run, shown } = setup();
    const result = await run({ ...planets, correctAnswer: "pluto" });
    expect(result.isError).toBe(true);
    const content = result.content[0];
    if (content?.type !== "text") throw new Error("expected model-facing error text");
    expect(content.text).toContain('quiz correctAnswer "pluto" does not match any option value');
    expect(shown).toEqual([]);
  });

  test("without a UI the quiz is unavailable and no dialog opens", async () => {
    const { fake, run, shown } = setup();
    fake.ctx.hasUI = false;
    const result = await run(planets);
    expect(result.details).toMatchObject({ status: "unavailable", message: "quiz requires interactive mode UI" });
    expect(shown).toEqual([]);
  });

  test("in RPC mode, where custom dialogs cannot be shown, the quiz is unavailable", async () => {
    const { fake, run, shown } = setup();
    Object.assign(fake.ctx, { mode: "rpc" });
    expect((await run(planets)).details).toMatchObject({ status: "unavailable" });
    expect(shown).toEqual([]);
  });

  test("Esc in the dialog returns a cancelled result", async () => {
    const { run } = setup(() => Promise.resolve(null));
    const result = await run(planets);
    expect(result.details).toMatchObject({ status: "cancelled" });
    expect(result.content).toEqual([{ type: "text", text: "User cancelled the quiz" }]);
  });

  test("aborting the turn while the dialog is open returns a cancelled result", async () => {
    const controller = new AbortController();
    const { run } = setup(() => {
      controller.abort();
      return Promise.reject(new Error("aborted"));
    });
    expect((await run(planets, controller.signal)).details).toMatchObject({ status: "cancelled" });
  });

  test("a quiz aborted before its dialog opened never shows it", async () => {
    const controller = new AbortController();
    controller.abort();
    const { run, shown } = setup();
    expect((await run(planets, controller.signal)).details).toMatchObject({ status: "cancelled" });
    expect(shown).toEqual([]);
  });

  test("concurrent quizzes take turns: the second dialog opens only after the first closes", async () => {
    const firstOpened = Promise.withResolvers<void>();
    const firstAnswer = Promise.withResolvers<QuizResponse | null>();
    const { run, shown } = setup(() => {
      firstOpened.resolve();
      return firstAnswer.promise;
    }, choose("Mercury"));
    const first = run(planets);
    const second = run({ ...planets, question: "Second?" });
    await firstOpened.promise;
    expect(shown.map((q) => q.question)).toEqual([planets.question]);
    firstAnswer.resolve({ dontKnow: true, answers: [] });
    expect((await first).details).toMatchObject({ dontKnow: true });
    expect((await second).details).toMatchObject({ question: "Second?", correct: true });
  });

  test("an aborted waiter settles while the first dialog is still unresolved", async () => {
    const firstOpened = Promise.withResolvers<void>();
    const firstAnswer = Promise.withResolvers<QuizResponse | null>();
    const { run, shown } = setup(() => {
      firstOpened.resolve();
      return firstAnswer.promise;
    }, choose("Mercury"));
    const first = run(planets);
    await firstOpened.promise;
    const controller = new AbortController();
    const second = run({ ...planets, question: "Queued?" }, controller.signal);
    controller.abort();
    // This await must finish before firstAnswer is resolved.
    expect((await second).details).toMatchObject({ status: "cancelled", question: "Queued?" });
    expect(shown.map((q) => q.question)).toEqual([planets.question]);
    firstAnswer.resolve({ dontKnow: true, answers: [] });
    await first;
  });
});
