import { describe, expect, test } from "vitest";
import type { QuizOption } from "../../../shared/quiz-contract.ts";
import { initialQuizState, quizResponse, stepQuiz, type QuizEvent, type QuizState, type QuizStep } from "../src/core/reducer.ts";

const options: QuizOption[] = [
  { label: "Mercury", value: "mercury" },
  { label: "Venus", value: "venus" },
  { label: "Mars", value: "mars" },
];
type Key = "up" | "down" | "enter" | "space" | "tab" | "escape" | "text" | "other";

/** Press keys in order; return the last step. */
function press(state: QuizState, ...keys: (Key | QuizEvent)[]): QuizStep {
  let step: QuizStep = { state, effect: "none" };
  for (const key of keys) step = stepQuiz(step.state, typeof key === "string" ? { type: key } : key);
  return step;
}
const single = () => initialQuizState("single-select", options.length);
const multi = () => initialQuizState("multi-select", options.length);
const picks = (step: QuizStep) => quizResponse(step.state, options).answers.map((a) => a.label);

describe("single-select dialog", () => {
  test("Enter answers with the focused option and shows feedback", () => {
    const step = press(single(), "down", "enter");
    expect(step.state.phase).toBe("feedback");
    expect(quizResponse(step.state, options)).toEqual({
      dontKnow: false,
      answers: [{ label: "Venus", value: "venus", index: 2 }],
    });
  });

  test("the cursor stops at the first option and at the I don't know row", () => {
    expect(press(single(), "up").state.cursor).toBe(0);
    expect(press(single(), "down", "down", "down", "down", "down").state.cursor).toBe(3);
  });

  test("Enter on I don't know answers with dontKnow and no picks", () => {
    const step = press(single(), "down", "down", "down", "enter");
    expect(quizResponse(step.state, options)).toEqual({ dontKnow: true, answers: [] });
  });

  test("Esc while choosing cancels", () => {
    expect(press(single(), "down", "escape").effect).toBe("cancel");
  });

  test("on the feedback screen Enter or Esc closes with the answer, other keys do nothing", () => {
    const feedback = press(single(), "enter").state;
    expect(press(feedback, "down").effect).toBe("none");
    expect(press(feedback, "enter").effect).toBe("finish");
    expect(press(feedback, "escape").effect).toBe("finish");
  });

  test("Space does not answer", () => {
    expect(press(single(), "space").state.phase).toBe("select");
  });
});

describe("note field", () => {
  test("typing on the options moves focus to the note and hands the key to the editor", () => {
    const step = press(single(), "text");
    expect(step).toMatchObject({ effect: "editNote", state: { focus: "note" } });
  });

  test("in the note every key but Tab, Enter, and Esc edits the note", () => {
    const inNote = press(single(), "tab").state;
    for (const key of ["up", "down", "space", "text", "other"] as const) {
      expect(press(inNote, key)).toMatchObject({ effect: "editNote", state: { focus: "note", cursor: 0 } });
    }
  });

  test("Enter and Esc leave the note without answering or cancelling, keeping its text", () => {
    const typed = press(single(), "text", { type: "noteChanged", text: "orbits?" }).state;
    for (const key of ["enter", "escape"] as const) {
      const step = press(typed, key);
      expect(step).toMatchObject({ effect: "none", state: { focus: "options", phase: "select", note: "orbits?" } });
    }
  });

  test("the answer carries the note trimmed, and none when it is blank", () => {
    const noted = press(single(), "text", { type: "noteChanged", text: "  orbits?  " }, "escape", "enter");
    expect(quizResponse(noted.state, options).note).toBe("orbits?");
    const blank = press(single(), "text", { type: "noteChanged", text: "   " }, "escape", "enter");
    expect(quizResponse(blank.state, options)).not.toHaveProperty("note");
  });
});

describe("multi-select dialog", () => {
  test("Space and Enter toggle the focused option", () => {
    expect(picks(press(multi(), "space", "down", "enter"))).toEqual(["Mercury", "Venus"]);
    expect(picks(press(multi(), "space", "space"))).toEqual([]);
  });

  test("picks are reported in display order whatever order they were made in", () => {
    expect(picks(press(multi(), "down", "down", "space", "up", "up", "space"))).toEqual(["Mercury", "Mars"]);
  });

  test("I don't know is exclusive with real picks", () => {
    const dk = press(multi(), "space", "down", "down", "down", "space").state;
    expect(quizResponse(dk, options)).toEqual({ dontKnow: true, answers: [] });
    const repicked = press(dk, "up", "space").state;
    expect(quizResponse(repicked, options)).toMatchObject({ dontKnow: false });
    expect(picks({ state: repicked, effect: "none" })).toEqual(["Mars"]);
  });

  test("Submit needs at least one choice", () => {
    const toSubmit = ["down", "down", "down", "down"] as const;
    expect(press(multi(), ...toSubmit, "enter").state.phase).toBe("select");
    expect(press(multi(), "space", ...toSubmit, "enter").state.phase).toBe("feedback");
  });

  test("Space on Submit neither submits nor toggles", () => {
    const step = press(multi(), "space", "down", "down", "down", "down", "space");
    expect(step.state).toMatchObject({ phase: "select", picked: [1], dontKnow: false });
  });
});
