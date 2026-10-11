import { expect, test } from "claude-code/testing";
import { drain, PRESENTATION, stubEngine } from "./engine.ts";

const NOTE = "/work/notes.md";
const ASK_INPUT = {
  questions: [{
    question: "How fast should we go?", header: "Pace",
    options: [{ label: "Slow", description: "One idea at a time" }, { label: "Fast", description: "Skim" }],
    multiSelect: false,
  }],
};
const ASK_QUESTION_BLOCK = "> [!question] Question — Pace\n> How fast should we go?\n>\n> 1. Slow\n> 2. Fast";
const QUIZ_INPUT = {
  question: "Is 29 prime?", options: [{ label: "Yes" }, { label: "No" }], correctAnswer: "Yes",
  explanation: "Only 1 and 29 divide it.", shuffle: false,
};
const QUIZ_RESULT = {
  status: "answered", question: "Is 29 prime?", mode: "single-select",
  answers: [{ label: "Yes", value: "Yes", index: 1 }], correctIndices: [1],
  options: [{ index: 1, label: "Yes" }, { index: 2, label: "No" }], correct: true, explanation: "Only 1 and 29 divide it.",
};

const step = (index: number, agentId?: string) =>
  ({ turnId: "t1", index, model: "claude-test", messageCount: 1, ...(agentId ? { agentId } : {}) });
const complete = { turnId: "t1", answer: "", durationMs: 1, isAborted: false, reason: "answer" } as const;
const prompt = (text: string) => ({ text, wait: false, origin: { kind: "composer" } }) as const;

test("/md-log refuses a missing file or a directory, and never creates one", async ($, on) => {
  const engine = stubEngine(on);
  engine.dirs.add("/work");
  expect((await $.command.run({ command: "md-log", args: "", ...PRESENTATION })).text).toBe("Usage: /md-log <filepath>");
  expect((await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION })).text).toBe(`File does not exist: ${NOTE}`);
  expect((await $.command.run({ command: "md-log", args: "/work", ...PRESENTATION })).text).toBe("Not a file: /work");
  expect(engine.files.size).toBe(0);
});

test("/md-log overwrites the note with the transcript so far, Q&A paired", async ($, on) => {
  const engine = stubEngine(on);
  engine.files.set(NOTE, "old content\n");
  engine.messages = [
    { role: "user", text: "Teach me primes.", toolUses: [] },
    {
      role: "assistant", text: "A prime has two divisors.",
      toolUses: [{
        tool_use_id: "toolu_1", tool: "AskUserQuestion", input: ASK_INPUT,
        result: { questions: ASK_INPUT.questions, answers: { "How fast should we go?": "Slow" } }, text: "answered",
      }],
    },
  ];
  const answer = await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  expect(answer.text).toBe(`Linked: ${NOTE} (4 entries backfilled)`);
  expect(engine.files.get(NOTE)).toBe(
    "> [!quote] YOU\n\nTeach me primes.\n\n> [!abstract] AGENT\n\nA prime has two divisors.\n\n"
      + `${ASK_QUESTION_BLOCK}\n\n> [!example] Answer\n> 1. Slow\n`,
  );
});

test("a prompt is logged as it entered the session; a dropped prompt is not logged", async ($, on) => {
  const engine = stubEngine(on);
  on("prompt.submit", ($, e) => (e.text === "drop me" ? { drop: "blocked" } : { text: `${e.text} (expanded)` }));
  engine.files.set(NOTE, "");
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  expect(await $.prompt.submit(prompt("Hi"))).toMatchObject({ text: "Hi (expanded)" });
  expect(await $.prompt.submit(prompt("drop me"))).toEqual({ drop: "blocked" });
  expect(engine.files.get(NOTE)).toBe("> [!quote] YOU\n\nHi (expanded)\n");
});

test("each request logs its prose and questions live; the answer lands when the next request starts", async ($, on) => {
  const engine = stubEngine(on);
  engine.files.set(NOTE, "");
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  engine.response = { answer: "Quick preference check.", toolUses: [{ name: "AskUserQuestion", input: ASK_INPUT }] };
  const first = await drain($.turn.step(step(0)));
  expect(first.answer).toBe("Quick preference check.");
  expect(engine.files.get(NOTE)).toBe(`> [!abstract] AGENT\n\nQuick preference check.\n\n${ASK_QUESTION_BLOCK}\n`);
  engine.messages = [{
    role: "assistant", text: "Quick preference check.",
    toolUses: [{
      tool_use_id: "toolu_2", tool: "AskUserQuestion", input: ASK_INPUT,
      result: { questions: ASK_INPUT.questions, answers: { "How fast should we go?": "Medium, with examples" } },
      text: "answered",
    }],
  }];
  engine.response = { answer: "Medium it is.", toolUses: [] };
  await drain($.turn.step(step(1)));
  expect(engine.files.get(NOTE)).toBe(
    `> [!abstract] AGENT\n\nQuick preference check.\n\n${ASK_QUESTION_BLOCK}\n\n`
      + "> [!example] Answer\n> Other: Medium, with examples\n\n> [!abstract] AGENT\n\nMedium it is.\n",
  );
});

test("at the end of a turn a pending quiz answer is logged from its <quiz-result> block, a missing one as unavailable", async ($, on) => {
  const engine = stubEngine(on);
  engine.files.set(NOTE, "");
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  engine.response = {
    answer: "",
    toolUses: [{ name: "mcp__quiz__quiz", input: QUIZ_INPUT }, { name: "AskUserQuestion", input: ASK_INPUT }],
  };
  await drain($.turn.step(step(0)));
  engine.messages = [{
    role: "assistant", text: "",
    toolUses: [
      {
        tool_use_id: "toolu_q", tool: "mcp__quiz__quiz", input: QUIZ_INPUT,
        result: `Correct ✓\n\n<quiz-result>${JSON.stringify(QUIZ_RESULT)}</quiz-result>`,
      },
      { tool_use_id: "toolu_a", tool: "AskUserQuestion", input: ASK_INPUT },
    ],
  }];
  await $.turn.complete(complete);
  expect(engine.files.get(NOTE)).toBe(
    "> [!question] Quiz\n> Is 29 prime?\n>\n> 1. Yes\n> 2. No\n\n"
      + `${ASK_QUESTION_BLOCK}\n\n`
      + "> [!success] Quiz — correct ✓\n> Your answer: 1. Yes\n> Correct answer: 1. Yes\n>\n> Only 1 and 29 divide it.\n\n"
      + "> [!warning] Question — unavailable\n> No answer was recorded.\n",
  );
});

test("a dead unanswered occurrence from an earlier turn never blocks a later identical question", async ($, on) => {
  const engine = stubEngine(on);
  engine.files.set(NOTE, "");
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  engine.response = { answer: "", toolUses: [{ name: "AskUserQuestion", input: ASK_INPUT }] };
  await drain($.turn.step(step(0)));   // asked, then the turn is aborted: the record keeps no outcome
  engine.messages = [{
    role: "assistant", text: "",
    toolUses: [{ tool_use_id: "dead", tool: "AskUserQuestion", input: ASK_INPUT }],
  }];
  await $.turn.complete(complete);     // logged unavailable; the dead record is retired
  engine.response = { answer: "", toolUses: [{ name: "AskUserQuestion", input: ASK_INPUT }] };
  await drain($.turn.step(step(1)));   // the same question again
  engine.messages = [
    ...engine.messages,
    {
      role: "assistant", text: "",
      toolUses: [{
        tool_use_id: "live", tool: "AskUserQuestion", input: ASK_INPUT,
        result: { questions: ASK_INPUT.questions, answers: { "How fast should we go?": "Slow" } }, text: "answered",
      }],
    },
  ];
  await $.turn.complete(complete);
  expect(engine.files.get(NOTE)).toBe(
    `${ASK_QUESTION_BLOCK}\n\n> [!warning] Question — unavailable\n> No answer was recorded.\n\n`
      + `${ASK_QUESTION_BLOCK}\n\n> [!example] Answer\n> 1. Slow\n`,
  );
});

test("subagent requests are not logged", async ($, on) => {
  const engine = stubEngine(on);
  engine.files.set(NOTE, "");
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  engine.response = { answer: "Subagent prose.", toolUses: [{ name: "AskUserQuestion", input: ASK_INPUT }] };
  await drain($.turn.step(step(0, "agent-1")));
  await $.turn.complete({ ...complete, agentId: "agent-1" });
  expect(engine.files.get(NOTE)).toBe("");
});

test("a note that would pass 4 MiB is unlinked with a toast, and later prompts write nothing", async ($, on) => {
  const engine = stubEngine(on);
  on("prompt.submit", ($, e) => ({ text: e.text }));
  const full = "x".repeat(4 * 1024 * 1024 - 8);
  engine.files.set(NOTE, full);
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  await $.prompt.submit(prompt("One more line"));
  await $.prompt.submit(prompt("And another"));
  expect(engine.files.get(NOTE)).toBe(full);
  expect(engine.toasts).toEqual(["md-log: unlinked notes.md: notes over 4 MiB cannot be written"]);
});

test("/md-unlog and the end of the session stop logging", async ($, on) => {
  const engine = stubEngine(on);
  on("prompt.submit", ($, e) => ({ text: e.text }));
  engine.files.set(NOTE, "");
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  expect((await $.command.run({ command: "md-unlog", args: "", ...PRESENTATION })).text).toBe("Unlinked: notes.md");
  expect((await $.command.run({ command: "md-unlog", args: "", ...PRESENTATION })).text).toBe("No file linked");
  await $.prompt.submit(prompt("not logged"));
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } });
  await $.prompt.submit(prompt("not logged either"));
  expect(engine.files.get(NOTE)).toBe("");
});

test("an in-flight append cannot write after unlink, session end, or same-path relink", async ($, on) => {
  const engine = stubEngine(on);
  on("prompt.submit", ($, e) => ({ text: e.text }));
  for (const action of ["md-unlog", "session.end", "unlink and relink"] as const) {
    engine.files.set(NOTE, "");
    await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
    let entered!: () => void;
    let release!: () => void;
    const readStarted = new Promise<void>((resolve) => { entered = resolve; });
    const readReleased = new Promise<void>((resolve) => { release = resolve; });
    engine.readGate = { entered, release: readReleased };
    const append = $.prompt.submit(prompt("Must not be logged"));
    await readStarted;
    engine.readGate = undefined;
    if (action === "session.end") await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } });
    else await $.command.run({ command: "md-unlog", args: "", ...PRESENTATION });
    if (action === "unlink and relink") await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
    release();
    await append;
    expect(engine.files.get(NOTE)).toBe("");
  }
});

test("a failed write is reported with a toast and the prompt still goes through", async ($, on) => {
  const engine = stubEngine(on);
  on("prompt.submit", ($, e) => ({ text: e.text }));
  engine.files.set(NOTE, "");
  await $.command.run({ command: "md-log", args: NOTE, ...PRESENTATION });
  engine.failWrites.add(NOTE);
  expect(await $.prompt.submit(prompt("Hi"))).toMatchObject({ text: "Hi" });
  expect(engine.toasts.length).toBe(1);
  expect(engine.toasts[0]).toMatch(/^md-log: .*EACCES/);
});
