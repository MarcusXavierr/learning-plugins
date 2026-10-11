// The omp quiz dialog, drawn as a pure function of state. No runtime pi-tui import:
// pi-tui needs Bun (Bun.stringWidth) and native addons, so Vitest could not load it.
// The adapter passes pi-tui's own width functions in as `TextKit`.
import { feedbackRows, gradeQuiz } from "../core/grade.ts";
import { DONT_KNOW_LABEL, type PreparedQuiz } from "../core/prepare.ts";
import { quizResponse, type QuizState } from "../core/reducer.ts";

/** The theme colors the dialog uses; omp's Theme (pi-tui theme/theme-class.d.ts:55) satisfies this. */
type QuizColor = "accent" | "text" | "muted" | "dim" | "success" | "error" | "warning";
export interface QuizTheme {
  fg(color: QuizColor, text: string): string;
}

/** pi-tui's `truncateToWidth` and `wrapTextWithAnsi` (pi-tui dist/types/utils.d.ts:29-30). */
export interface TextKit {
  truncateToWidth(text: string, width: number): string;
  wrapTextWithAnsi(text: string, width: number): string[];
}

export interface QuizView {
  quiz: PreparedQuiz;
  state: QuizState;
  /** The note Editor's own rendering at this width (it draws the cursor). */
  noteLines: readonly string[];
}

const NOTE_HINT = " Type note • Ctrl+J newline • Enter back to options • Tab options • Esc back";

/** Every returned line fits `width`: omp's TUI aborts on an over-wide line. */
export function renderQuiz(view: QuizView, theme: QuizTheme, kit: TextKit, width: number): string[] {
  const { quiz, state } = view;
  const lines: string[] = [];
  const add = (text: string) => lines.push(kit.truncateToWidth(text, width));
  const addWrapped = (text: string, indent: string) => {
    for (const line of kit.wrapTextWithAnsi(text, Math.max(1, width - indent.length))) add(`${indent}${line}`);
  };
  const rule = theme.fg("accent", "─".repeat(width));

  add(rule);
  addWrapped(theme.fg("text", quiz.question), " ");
  if (quiz.context) {
    lines.push("");
    addWrapped(theme.fg("muted", quiz.context), " ");
  }

  if (state.phase === "feedback") {
    const d = gradeQuiz(quiz, quizResponse(state, quiz.options));
    lines.push("");
    for (const row of feedbackRows(d)) add(theme.fg(row.tone, ` ${row.mark} ${row.index}. ${row.label}`));
    lines.push("");
    const correctStr = d.correctIndices.map((i) => `${i}. ${quiz.options[i - 1]?.label ?? "(unknown)"}`).join(", ");
    if (d.dontKnow) {
      add(theme.fg("warning", ` · You said: ${DONT_KNOW_LABEL}`));
      addWrapped(theme.fg("muted", `Correct answer: ${correctStr}`), " ");
    } else if (d.correct) {
      add(theme.fg("success", " ✓ Correct!"));
    } else {
      add(theme.fg("error", " ✗ Incorrect."));
      addWrapped(theme.fg("muted", `Correct answer: ${correctStr}`), " ");
    }
    if (d.note) addWrapped(theme.fg("muted", `Your note: ${d.note}`), " ");
    if (d.explanation) {
      lines.push("");
      addWrapped(theme.fg("text", d.explanation), " ");
    }
    lines.push("");
    add(theme.fg("dim", " Enter/Esc to continue"));
    add(rule);
    return lines;
  }

  const multi = state.mode === "multi-select";
  const focused = (row: number) => state.focus === "options" && state.cursor === row;
  const prefix = (row: number) => (focused(row) ? theme.fg("accent", "> ") : "  ");
  lines.push("");
  quiz.options.forEach((option, i) => {
    const checked = state.picked.includes(i + 1);
    const label = `${multi ? (checked ? "[x] " : "[ ] ") : ""}${i + 1}. ${option.label}`;
    add(`${prefix(i)}${theme.fg(focused(i) ? "accent" : checked ? "success" : "text", label)}`);
    if (option.description) addWrapped(theme.fg("muted", option.description), "     ");
  });

  const dk = state.optionCount;
  lines.push("");
  const dkLabel = multi ? `${state.dontKnow ? "[x]" : "[ ]"} ${DONT_KNOW_LABEL}` : DONT_KNOW_LABEL;
  add(`${prefix(dk)}${theme.fg(focused(dk) ? "accent" : state.dontKnow ? "warning" : "dim", dkLabel)}`);

  const count = state.picked.length + (state.dontKnow ? 1 : 0);
  if (multi) {
    const submit = count > 0 ? `✓ Submit (${count} selected)` : "○ Submit";
    add(`${prefix(dk + 1)}${theme.fg(focused(dk + 1) ? "accent" : count > 0 ? "success" : "dim", submit)}`);
  }

  lines.push("");
  addWrapped(theme.fg(state.focus === "note" ? "accent" : "muted", "Note (optional):"), " ");
  lines.push(...view.noteLines);

  lines.push("");
  if (multi && count === 0) add(theme.fg("warning", " Select at least one answer before submitting."));
  if (state.focus === "note") add(theme.fg("dim", NOTE_HINT));
  else if (multi) add(theme.fg("dim", " ↑↓ navigate • Space toggle • Enter submit • type or Tab for note • Esc cancel"));
  else add(theme.fg("dim", " ↑↓ navigate • Enter answer • type or Tab for note • Esc cancel"));
  add(rule);
  return lines;
}
