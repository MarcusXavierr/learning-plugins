import { describe, expect, test } from "vitest";
import { prepareQuiz } from "../src/core/prepare.ts";
import { initialQuizState, stepQuiz, type QuizEvent, type QuizState } from "../src/core/reducer.ts";
import { renderQuiz, type QuizTheme, type TextKit } from "../src/omp/tui.ts";

// pi-tui's width functions need Bun; for plain text these do the same job.
const kit: TextKit = {
  truncateToWidth: (text, width) => text.slice(0, width),
  wrapTextWithAnsi: (text, width) => {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (next.length <= width) line = next;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    return [...lines, line];
  },
};
const plain: QuizTheme = { fg: (_color, text) => text };
const tagged: QuizTheme = { fg: (color, text) => `<${color}>${text}</${color}>` };

const planets = {
  question: "Which planet is closest to the Sun?",
  options: [
    { label: "Mercury", value: "mercury" },
    { label: "Venus", value: "venus", description: "Hottest planet" },
    { label: "Mars", value: "mars" },
  ],
  correctAnswer: "mercury",
  explanation: "Mercury orbits at about 0.39 AU.",
  shuffle: false,
};
const quiz = prepareQuiz(planets);
const multiQuiz = prepareQuiz({ ...planets, multiSelect: true, correctAnswer: ["mercury", "venus"] });

function after(state: QuizState, ...types: Exclude<QuizEvent["type"], "noteChanged">[]): QuizState {
  return types.reduce((s, type) => stepQuiz(s, { type }).state, state);
}
const render = (state: QuizState, theme = plain, width = 80, q = state.mode === "multi-select" ? multiQuiz : quiz) =>
  renderQuiz({ quiz: q, state, noteLines: ["[note editor]"] }, theme, kit, width);

describe("omp quiz dialog", () => {
  test("lists the options numbered in display order, cursor on the first, I don't know below", () => {
    const lines = render(initialQuizState("single-select", 3));
    expect(lines).toContain("> 1. Mercury");
    expect(lines).toContain("  2. Venus");
    expect(lines).toContain("     Hottest planet");
    expect(lines).toContain("  I don't know");
    expect(lines).toContain(" ↑↓ navigate • Enter answer • type or Tab for note • Esc cancel");
  });

  test("hides the cursor and switches the hint while the note is focused", () => {
    const lines = render(after(initialQuizState("single-select", 3), "tab"));
    expect(lines.some((l) => l.startsWith("> "))).toBe(false);
    expect(lines).toContain("[note editor]");
    expect(lines).toContain(" Type note • Ctrl+J newline • Enter back to options • Tab options • Esc back");
  });

  test("multi-select warns until something is chosen, then counts the choices on Submit", () => {
    const empty = render(initialQuizState("multi-select", 3));
    expect(empty).toContain("  ○ Submit");
    expect(empty).toContain(" Select at least one answer before submitting.");
    const one = render(after(initialQuizState("multi-select", 3), "space"));
    expect(one).toContain("> [x] 1. Mercury");
    expect(one).toContain("  ✓ Submit (1 selected)");
    expect(one).not.toContain(" Select at least one answer before submitting.");
  });

  test("feedback for a wrong pick marks it ✗ in red, the answer ✓ in green, and explains", () => {
    const lines = render(after(initialQuizState("single-select", 3), "down", "enter"), tagged);
    expect(lines).toContain("<success> ✓ 1. Mercury</success>");
    expect(lines).toContain("<error> ✗ 2. Venus</error>");
    expect(lines).toContain("<error> ✗ Incorrect.</error>");
    expect(lines).toContain(" <muted>Correct answer: 1. Mercury</muted>");
    expect(lines).toContain(" <text>Mercury orbits at about 0.39 AU.</text>");
  });

  test("feedback after I don't know shows the answer and no ✗", () => {
    const lines = render(after(initialQuizState("single-select", 3), "up", "down", "down", "down", "enter"));
    expect(lines).toContain(" · You said: I don't know");
    expect(lines.some((l) => l.includes("✗"))).toBe(false);
    expect(lines).toContain(" ✓ 1. Mercury");
  });

  test("a long question wraps onto more lines without losing a word", () => {
    const question = "alpha beta gamma delta epsilon zeta eta theta";
    const lines = render(initialQuizState("single-select", 3), plain, 12, prepareQuiz({ ...planets, question }));
    expect(lines.join(" ").split(/\s+/)).toEqual(expect.arrayContaining(question.split(" ")));
  });

  test("no line is wider than the terminal, which omp would refuse to draw", () => {
    const long = prepareQuiz({ ...planets, question: "Which planet ".repeat(20), details: "context ".repeat(30) });
    const states = [
      initialQuizState("single-select", 3),
      after(initialQuizState("single-select", 3), "down", "enter"),
    ];
    for (const state of states) {
      for (const line of render(state, plain, 24, long)) expect(line.length).toBeLessThanOrEqual(24);
    }
  });
});
