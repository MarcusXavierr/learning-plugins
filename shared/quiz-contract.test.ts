import { describe, expect, test } from "vitest";
import {
  decodeQuizResult, displayedOptions, displayOrder, encodeQuizResult, normalizeOptions, type QuizResultDetails,
} from "./quiz-contract.ts";

const PLANETS = ["Mercury", "Venus", "Earth", "Mars", "Jupiter"].map((label) => ({ label }));

const DETAILS: QuizResultDetails = {
  status: "answered",
  question: "Which planet is closest to the Sun?",
  mode: "single-select",
  answers: [{ label: "Mercury", value: "Mercury", index: 2 }],
  correctIndices: [2],
  options: [{ index: 1, label: "Venus" }, { index: 2, label: "Mercury" }],
  correct: true,
  explanation: "Mercury orbits at 0.39 AU.",
};

describe("normalizeOptions", () => {
  test("trims labels, values and descriptions, defaults the value to the label, and drops blank labels", () => {
    expect(normalizeOptions([
      { label: "  Mercury ", description: "  closest " },
      { label: "   " },
      { label: "Venus", value: " v " },
      { label: "Earth", value: "   ", description: "  " },
    ])).toEqual([
      { label: "Mercury", value: "Mercury", description: "closest" },
      { label: "Venus", value: "v" },
      { label: "Earth", value: "Earth" },
    ]);
  });

  test("rejects two options with the same value, naming it", () => {
    expect(() => normalizeOptions([{ label: "A", value: "x" }, { label: "B", value: " x " }]))
      .toThrow('duplicate option value "x"');
  });
});

describe("displayOrder", () => {
  test("gives the same order on every call for the same question and options", () => {
    const input = { question: "Which planet is closest to the Sun?", options: PLANETS };
    const first = displayOrder(input).map((o) => o.label);
    for (let i = 0; i < 5; i++) expect(displayOrder(input).map((o) => o.label)).toEqual(first);
  });

  test("shows every normalized option exactly once", () => {
    const order = displayOrder({ question: "Pick a planet", options: [...PLANETS, { label: "  " }] });
    expect(order.map((o) => o.label).sort()).toEqual(["Earth", "Jupiter", "Mars", "Mercury", "Venus"]);
  });

  test("keeps the author's order when shuffle is false", () => {
    expect(displayOrder({ question: "Pick a planet", options: PLANETS, shuffle: false }).map((o) => o.label))
      .toEqual(["Mercury", "Venus", "Earth", "Mars", "Jupiter"]);
  });

  test("varies the order with the question text", () => {
    const orders = new Set<string>();
    for (let i = 0; i < 20; i++) {
      orders.add(displayOrder({ question: `Question ${i}`, options: PLANETS }).map((o) => o.label).join("|"));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  test("rejects duplicate option values like normalizeOptions", () => {
    expect(() => displayOrder({ question: "q", options: [{ label: "A" }, { label: "A" }] }))
      .toThrow('duplicate option value "A"');
  });
});

describe("displayedOptions", () => {
  test("numbers the options from 1 in display order", () => {
    const order = displayOrder({ question: "Pick a planet", options: PLANETS });
    expect(displayedOptions(order)).toEqual(order.map((o, i) => ({ index: i + 1, label: o.label })));
  });
});

describe("encodeQuizResult / decodeQuizResult", () => {
  test("round-trips details, even when a string contains the closing tag", () => {
    const tricky = { ...DETAILS, explanation: "Literal </quiz-result> and <b>tags</b> survive." };
    expect(decodeQuizResult(encodeQuizResult(tricky))).toEqual(tricky);
  });

  test("finds the first block inside surrounding model text", () => {
    const text = `Correct ✓\n\n${encodeQuizResult(DETAILS)}\n\n${encodeQuizResult({ ...DETAILS, correct: false })}`;
    expect(decodeQuizResult(text)).toEqual(DETAILS);
  });

  test("returns undefined when the block is absent, unterminated, or not JSON", () => {
    expect(decodeQuizResult("Correct ✓")).toBeUndefined();
    expect(decodeQuizResult(`<quiz-result>${JSON.stringify(DETAILS)}`)).toBeUndefined();
    expect(decodeQuizResult("<quiz-result>{status: answered}</quiz-result>")).toBeUndefined();
  });

  test.each([
    { answers: "none" },
    { answers: [null] },
    { answers: [{ label: "A", value: "A", index: 0 }] },
    { correctIndices: [null] },
    { options: [null] },
    { options: [{ index: 1, label: 42 }] },
    { note: 12 },
    { status: "graded" },
  ])("rejects a malformed quiz result field: %j", (change) => {
    expect(decodeQuizResult(`<quiz-result>${JSON.stringify({ ...DETAILS, ...change })}</quiz-result>`))
      .toBeUndefined();
  });
});
