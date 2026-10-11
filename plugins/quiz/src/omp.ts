import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import {
  Editor,
  extractPrintableText,
  getEditorTheme,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";
import type { QuizResponse } from "./core/grade.ts";
import type { PreparedQuiz } from "./core/prepare.ts";
import { initialQuizState, quizResponse, stepQuiz, type QuizEvent } from "./core/reducer.ts";
import { registerQuiz } from "./omp/tool.ts";
import { renderQuiz } from "./omp/tui.ts";

const kit = { truncateToWidth, wrapTextWithAnsi };

function toEvent(data: string): QuizEvent {
  if (matchesKey(data, Key.up)) return { type: "up" };
  if (matchesKey(data, Key.down)) return { type: "down" };
  // Bare LF is Ctrl+J in tmux; the Editor interprets it as a newline, not submit.
  if (data === "\n" || matchesKey(data, Key.ctrl("j"))) return { type: "other" };
  if (matchesKey(data, Key.enter)) return { type: "enter" };
  if (matchesKey(data, Key.space)) return { type: "space" };
  if (matchesKey(data, Key.tab)) return { type: "tab" };
  if (matchesKey(data, Key.escape)) return { type: "escape" };
  // Plain and Kitty CSI-u text alike (pi-tui keys.d.ts:171-176).
  return extractPrintableText(data) !== undefined ? { type: "text" } : { type: "other" };
}

function askInTui(ctx: ExtensionContext, quiz: PreparedQuiz, signal: AbortSignal | undefined): Promise<QuizResponse | null> {
  return ctx.ui.custom<QuizResponse | null>(
    (tui, theme, _keybindings, done) => {
      let state = initialQuizState(quiz.mode, quiz.options.length);
      // omp's Editor takes one EditorTheme argument and needs `symbols`; getEditorTheme supplies it
      // (pi-tui components/editor.d.ts:8-21,108; theme/tui-adapters.d.ts:29).
      const editor = new Editor({ ...getEditorTheme(), borderColor: (s: string) => theme.fg("accent", s) });
      // Enter must not submit: the Editor's submit clears its buffer. Ctrl+J still inserts a newline.
      editor.disableSubmit = true;
      editor.focused = false;
      let cache: { width: number; lines: string[] } | undefined;

      return {
        render(width: number): readonly string[] {
          // Keyed on width: a resize re-renders without invalidate().
          if (cache?.width === width) return cache.lines;
          const lines = renderQuiz({ quiz, state, noteLines: editor.render(width) }, theme, kit, width);
          // Not cached while the note is focused: the Editor draws a live cursor.
          if (state.focus !== "note") cache = { width, lines };
          return lines;
        },
        invalidate() {
          cache = undefined;
          editor.invalidate();
        },
        handleInput(data: string) {
          const step = stepQuiz(state, toEvent(data));
          state = step.state;
          editor.focused = state.focus === "note";
          if (step.effect === "cancel") return done(null);
          if (step.effect === "finish") return done(quizResponse(state, quiz.options));
          if (step.effect === "editNote") {
            editor.handleInput(data);
            state = stepQuiz(state, { type: "noteChanged", text: editor.getText() }).state;
          }
          cache = undefined;
          tui.requestRender();
        },
      };
    },
    { signal },
  );
}

export default function quiz(pi: ExtensionAPI): void {
  registerQuiz(pi, { ask: askInTui, text: (text) => new Text(text, 0, 0) });
}
