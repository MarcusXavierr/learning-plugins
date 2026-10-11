import type { On } from "claude-code";
import { expect, test } from "claude-code/testing";

const QUIZ = "mcp__quiz__quiz";
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
const primes = {
  question: "Which of these numbers are prime?",
  options: [
    { label: "2", value: "two" },
    { label: "3", value: "three" },
    { label: "4", value: "four" },
  ],
  multiSelect: true,
  correctAnswer: ["two", "three"],
  explanation: "4 = 2 × 2, so it is not prime.",
};

interface Dialog {
  question: string;
  header?: string;
  options: { label: string }[];
  multiSelect?: boolean;
}

interface QuizDetails {
  status: string;
  mode: string;
  correct: boolean;
  dontKnow?: boolean;
  note?: string;
  answers: { label: string; value: string; index: number }[];
  options: { index: number; label: string }[];
}

// eslint-disable-next-line llm-core/no-unknown-parameters -- decode the test kit's host event at the boundary
function dialogOf(e: unknown): Dialog {
  const questions = e && typeof e === "object" && "questions" in e ? e.questions : undefined;
  if (!Array.isArray(questions) || questions.length !== 1) throw new Error(`unexpected AskUserQuestion input: ${JSON.stringify(e)}`);
  return questions.at(0) as Dialog;
}

// eslint-disable-next-line llm-core/no-unknown-parameters -- decode the test kit's result at the boundary
function detailsOf(result: unknown): QuizDetails {
  const match = /<quiz-result>([\s\S]*?)<\/quiz-result>/.exec(String(result));
  if (!match?.[1]) throw new Error(`no quiz-result block in: ${String(result)}`);
  return JSON.parse(match[1]) as QuizDetails;
}

function stubSession(on: On): void {
  on("session.start", () => ({ cwd: "/work" }));
  on("tool.register", () => ({ value: { tool: QUIZ } }));
}

test("asks in the native dialog: display-ordered labels, then I don't know", async ($, on) => {
  stubSession(on);
  const asked: Dialog[] = [];
  on("tool.call", ($, e) => {
    const dialog = dialogOf(e);
    asked.push(dialog);
    return { result: { answers: { [dialog.question]: "Mercury" } } };
  });
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  const { result } = await $.tool.call({ tool: QUIZ, ...planets });
  const first = asked.at(0);
  const labels = first?.options.map((option) => option.label);
  expect(first).toMatchObject({ question: planets.question, header: "Quiz", multiSelect: false });
  expect(labels?.slice(3)).toEqual(["I don't know"]);
  expect([...(labels ?? []).slice(0, 3)].sort()).toEqual(["Mars", "Mercury", "Venus"]);
  expect(detailsOf(result).options).toEqual(labels?.slice(0, 3).map((label, index) => ({ index: index + 1, label })));
});

test("grades the chosen label against the correct answer", async ($, on) => {
  stubSession(on);
  on("tool.call", ($, e) => ({ result: { answers: { [dialogOf(e).question]: "Venus" } } }));
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  const { result, isError } = await $.tool.call({ tool: QUIZ, ...planets });
  expect(isError).toBeUndefined();
  expect(String(result)).toMatch(/^User answered incorrectly\.\nSelected: \d\. Venus\nCorrect: \d\. Mercury\n/);
  expect(detailsOf(result)).toMatchObject({ status: "answered", correct: false, answers: [{ label: "Venus", value: "venus" }] });
});

test("multi-select asks with multiSelect and grades the comma-joined answer as a set", async ($, on) => {
  stubSession(on);
  let multiSelect: boolean | undefined;
  on("tool.call", ($, e) => {
    const dialog = dialogOf(e);
    multiSelect = dialog.multiSelect;
    return { result: { answers: { [dialog.question]: "3, 2" } } };
  });
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  const { result } = await $.tool.call({ tool: QUIZ, ...primes });
  expect(multiSelect).toBe(true);
  expect(detailsOf(result)).toMatchObject({ status: "answered", mode: "multi-select", correct: true });
});

test("words typed under Other count as I don't know, kept as the note", async ($, on) => {
  stubSession(on);
  on("tool.call", ($, e) => ({ result: { answers: { [dialogOf(e).question]: "the one with no moons?" } } }));
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  const { result } = await $.tool.call({ tool: QUIZ, ...planets });
  expect(detailsOf(result)).toMatchObject({ dontKnow: true, correct: false, answers: [], note: "the one with no moons?" });
});

test("dismissing the dialog cancels the quiz", async ($, on) => {
  stubSession(on);
  on("tool.call", () => ({ deny: "dismissed" }));
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  const { result } = await $.tool.call({ tool: QUIZ, ...planets });
  expect(String(result)).toMatch(/^User cancelled the quiz\n\n<quiz-result>/);
  expect(detailsOf(result)).toMatchObject({ status: "cancelled" });
});

test("in a non-interactive session the quiz is unavailable and no dialog opens", async ($, on) => {
  stubSession(on);
  let asked = false;
  on("tool.call", () => {
    asked = true;
    return { deny: "no one to ask" };
  });
  await $.session.start({ surface: null, isInteractive: false, cwd: "/work" });
  const { result } = await $.tool.call({ tool: QUIZ, ...planets });
  expect(asked).toBe(false);
  expect(detailsOf(result)).toMatchObject({ status: "unavailable" });
});

for (const [name, input, message] of [
  ["four options", { ...planets, options: [...planets.options, { label: "Earth", value: "earth" }] }, "at most 3 options"],
  ["comma in multi-select label", { ...primes, options: [{ label: "2, the even prime", value: "two" }, ...primes.options.slice(1)] }, 'must not contain ","'],
  ["duplicate labels", { ...planets, options: [{ label: "Mercury", value: "mercury" }, { label: "Mercury", value: "venus" }] }, '"Mercury" appears twice'],
  ["reserved label", { ...planets, options: [{ label: "I don't know", value: "mercury" }, { label: "Venus", value: "venus" }] }, '"I don\'t know" is reserved'],
  ["duplicate values", { ...planets, options: [{ label: "Mercury", value: "mercury" }, { label: "Venus", value: "mercury" }] }, 'duplicate option value "mercury"'],
  ["wrongly typed option value", { ...planets, options: [{ label: "Mercury", value: 7 }, ...planets.options.slice(1)] }, "quiz option 1 value must be a string"],
] as const) {
  test(`${name} is an error the model can fix without opening a dialog`, async ($, on) => {
    stubSession(on);
    let asked = false;
    on("tool.call", () => { asked = true; return { deny: "dialog must not open" }; });
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const answer = await $.tool.call({ tool: QUIZ, ...input });
    expect(answer).toEqual({ result: expect.stringContaining(message), isError: true });
    expect(asked).toBe(false);
  });
}

const TOOL_RESULT = { plugin: "quiz", surface: "terminal", component: "ToolResult" } as const;

test("the transcript shows the graded options and verdict, not the raw result block", async ($, on) => {
  stubSession(on);
  on("tool.call", ($, e) => ({ result: { answers: { [dialogOf(e).question]: "Venus" } } }));
  on("ui.render", () => ({ type: "Text", props: {}, children: ["drawn by Claude Code"] }));
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
  const { result } = await $.tool.call({ tool: QUIZ, ...planets });
  const ui = await $.ui.mount({
    ...TOOL_RESULT,
    props: { tool_use_id: "toolu_1", tool: QUIZ, output: result, isErrored: false },
  });
  expect(await ui.find({ type: "Text", text: /^✗ \d\. Venus$/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /^✓ \d\. Mercury$/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "Incorrect" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /quiz-result/ })).toBeUndefined();
});

test("other tools' results are drawn as Claude Code draws them", async ($, on) => {
  on("ui.render", () => ({ type: "Text", props: {}, children: ["drawn by Claude Code"] }));
  const ui = await $.ui.mount({
    ...TOOL_RESULT,
    props: { tool_use_id: "toolu_2", tool: "Bash", output: "<quiz-result>{}</quiz-result>", isErrored: false },
  });
  expect(await ui.find({ type: "Text", text: "drawn by Claude Code" })).toBeDefined();
});
