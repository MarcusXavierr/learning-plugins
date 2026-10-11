import type { QuizMode, QuizOption } from "../../../../shared/quiz-contract.ts";
import type { QuizResponse } from "./grade.ts";

/**
 * The omp quiz dialog as data. Rows, top to bottom: the real options (cursor
 * 0..n-1), "I don't know" (cursor n), and in multi-select a Submit row (n+1).
 * The note's text lives in a pi-tui Editor owned by the adapter; `note` mirrors it.
 */
export interface QuizState {
  mode: QuizMode;
  optionCount: number;
  cursor: number;
  focus: "options" | "note";
  phase: "select" | "feedback";
  /** 1-based picks, ascending. Single-select holds at most one, set by Enter. */
  picked: number[];
  dontKnow: boolean;
  note: string;
}

/** Keys after the adapter decoded raw terminal input; `text` is any printable input except a bare space. */
export type QuizEvent =
  | { type: "up" | "down" | "enter" | "space" | "tab" | "escape" | "text" | "other" }
  | { type: "noteChanged"; text: string };

/**
 * What the adapter must do after a step:
 * `editNote` → feed the same raw input to the note Editor, then send `noteChanged`;
 * `cancel` → close the dialog with no answer; `finish` → close it with `quizResponse(state)`.
 */
type QuizEffect = "none" | "editNote" | "cancel" | "finish";

export interface QuizStep {
  state: QuizState;
  effect: QuizEffect;
}

export function initialQuizState(mode: QuizMode, optionCount: number): QuizState {
  return { mode, optionCount, cursor: 0, focus: "options", phase: "select", picked: [], dontKnow: false, note: "" };
}

// Multi-select toggles. "I don't know" is exclusive: choosing it clears the
// picks, and picking an option clears it.
function toggle(state: QuizState): QuizState {
  if (state.cursor === state.optionCount) {
    return state.dontKnow ? { ...state, dontKnow: false } : { ...state, dontKnow: true, picked: [] };
  }
  const index = state.cursor + 1;
  const picked = state.picked.includes(index)
    ? state.picked.filter((i) => i !== index)
    : [...state.picked, index].sort((a, b) => a - b);
  return { ...state, dontKnow: false, picked };
}

export function stepQuiz(state: QuizState, event: QuizEvent): QuizStep {
  const stay = (next: QuizState): QuizStep => ({ state: next, effect: "none" });

  if (state.phase === "feedback") {
    return event.type === "enter" || event.type === "escape" ? { state, effect: "finish" } : stay(state);
  }
  if (event.type === "noteChanged") return stay({ ...state, note: event.text });
  if (event.type === "tab") return stay({ ...state, focus: state.focus === "options" ? "note" : "options" });

  if (state.focus === "note") {
    // Enter and Esc leave the note and keep its text; every other key edits it.
    if (event.type === "enter" || event.type === "escape") return stay({ ...state, focus: "options" });
    return { state, effect: "editNote" };
  }

  // Typing while the options are focused starts the note instead of being dropped.
  if (event.type === "text") return { state: { ...state, focus: "note" }, effect: "editNote" };
  if (event.type === "escape") return { state, effect: "cancel" };

  const lastRow = state.mode === "multi-select" ? state.optionCount + 1 : state.optionCount;
  if (event.type === "up") return stay({ ...state, cursor: Math.max(0, state.cursor - 1) });
  if (event.type === "down") return stay({ ...state, cursor: Math.min(lastRow, state.cursor + 1) });

  if (state.mode === "single-select") {
    if (event.type !== "enter") return stay(state);
    return state.cursor === state.optionCount
      ? stay({ ...state, dontKnow: true, picked: [], phase: "feedback" })
      : stay({ ...state, dontKnow: false, picked: [state.cursor + 1], phase: "feedback" });
  }

  const onSubmit = state.cursor === state.optionCount + 1;
  if (event.type === "space") return onSubmit ? stay(state) : stay(toggle(state));
  if (event.type === "enter") {
    if (!onSubmit) return stay(toggle(state));
    return state.dontKnow || state.picked.length > 0 ? stay({ ...state, phase: "feedback" }) : stay(state);
  }
  return stay(state);
}

/** The user's answer as the grader takes it. `options` are the displayed options, in display order. */
export function quizResponse(state: QuizState, options: readonly QuizOption[]): QuizResponse {
  const note = state.note.trim() || undefined;
  const answers = state.dontKnow
    ? []
    : state.picked.flatMap((index) => {
        const option = options[index - 1];
        return option ? [{ label: option.label, value: option.value, index }] : [];
      });
  return { dontKnow: state.dontKnow, ...(note ? { note } : {}), answers };
}
