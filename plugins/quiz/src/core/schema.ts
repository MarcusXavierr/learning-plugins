import { toolName, type Harness } from "../../../../shared/tool-map.ts";
import { CLAUDE_LIMITS, DONT_KNOW_LABEL } from "./prepare.ts";

// omp 18.2.10 ignores `promptGuidelines` on extension tools (the field exists only on
// ToolInfo, pi-coding-agent dist/types/extensibility/extensions/types.d.ts:485-491) and
// CC has only `description`, so the original guidelines (quiz.ts:927-942) live here.

/** What the model reads about the quiz tool, per harness. */
export function quizDescription(harness: Harness): string {
  const ask = toolName("ask", harness);
  const note =
    harness === "omp"
      ? "An always-present optional note field (Tab to focus it) lets the user attach a free-text note to ANY answer; it reaches you only when non-empty."
      : `If the user types their own words under "Other" instead of choosing, the result is "${DONT_KNOW_LABEL}" with their words as the note; a note reaches you only when non-empty.`;
  const guidelines = [
    `quiz is GRADED; ${ask} is not. If the question has a correct answer, use quiz. If you just need a preference, decision, or open-ended input, use ${ask}.`,
    'correctAnswer is REQUIRED and is the option value, not a position number. Single-select: one string (e.g. "mercury"). Multi-select: an array of strings (e.g. ["belize", "niue"]).',
    "Always pass the option's `value` string as correctAnswer — it is self-checking and prevents miscounting positions. A value that matches no option is a hard error.",
    "explanation is REQUIRED — always say why the correct answer is correct.",
    "Multi-select is graded as an exact-set match: the user is correct only if they select every correct option and no incorrect ones.",
    `There is no free-text mode. An '${DONT_KNOW_LABEL}' choice is ALWAYS added automatically — provide ONLY the real, gradable options (at least two). Never add your own uncertainty/opt-out option like 'I don't know', 'I'm not sure', or 'Not sure'; that is handled for you and a manual one would be redundant or gradable-as-wrong.`,
    "If a result comes back as dontKnow, the user honestly did not know and did NOT guess — treat it as a genuine knowledge gap to teach into, not as a wrong answer.",
    "Any answer (right, wrong, or 'I don't know') may carry an optional free-text `note`. When present it reflects what they were thinking or unsure about — read it and let it steer your follow-up. It is omitted entirely when empty.",
    "Treat each wrong answer (distractor) as a diagnostic probe, not just filler: make it a specific, believable mistake the user might actually hold — a common misconception, or an adjacent/easily-confused concept — so that WHICH wrong answer they pick reveals WHICH nuance of their understanding is off.",
    "Guardrail: every distractor must be unambiguously wrong on the intended reading — tempting, but a real error, not a defensible alternative. Don't drift into trick questions.",
    "Anti-guessing hygiene: don't let the correct answer stand out by form (longest, most precise, most hedged, or the only one in the right format). Keep options similar in length, specificity, and phrasing so it can't be picked from shape alone.",
    "Set multiSelect: true only when more than one option is correct.",
    "Options are shuffled before display by default, so don't worry about which position you list the correct answer in. Set shuffle: false only when option order is meaningful (ordered values, or an 'All/None of the above' option that must stay last).",
    "To probe nuance, ask several quick quiz questions and adapt each one based on the previous answers, rather than writing one giant question.",
    "Don't leak the answer through formatting: keep option phrasing/length even and don't hint which is correct.",
  ];
  const limits =
    harness === "claude"
      ? `\n\nLimits in this harness: at most ${CLAUDE_LIMITS.maxOptions} options (the dialog shows at most four rows, one of them "${DONT_KNOW_LABEL}"). Option labels must be unique and must not be "${DONT_KNOW_LABEL}"; in multi-select they must not contain a comma, because the answer comes back comma-joined. Option descriptions are not shown, so put everything the user needs in the label.`
      : "";
  return (
    "Ask the user a GRADED question with a known correct answer, then instantly grade and give feedback. " +
    `Unlike ${ask} (which collects preferences/decisions with no right answer), quiz always has a correct answer supplied by you, marks the user's selection right/wrong (✓/✗), reveals the correct answer, and can show an explanation. ` +
    "Use it to (1) assess what the learner already understands before teaching, and (2) run tight practice/retrieval loops after explaining, or probe understanding whenever you're unsure they've got it. " +
    `Options-only: single-select or multi-select, plus an automatic '${DONT_KNOW_LABEL}' choice so the user can signal a genuine gap instead of guessing. ${note} ` +
    `No free-text answers — for non-graded questions use ${ask} instead.` +
    `\n\nGuidelines:\n${guidelines.map((g) => `- ${g}`).join("\n")}` +
    limits
  );
}

/** The input JSON Schema. omp takes a plain JSON Schema for `parameters`; CC takes it as `inputSchema`. */
// eslint-disable-next-line llm-core/no-unsafe-dictionary-type -- JSON Schema is a heterogeneous dictionary consumed by both host SDKs
export function quizInputSchema(harness: Harness): Record<string, unknown> {
  const max = harness === "claude" ? CLAUDE_LIMITS.maxOptions : undefined;
  return {
    type: "object",
    properties: {
      question: { type: "string", description: "The single quiz question to ask. Ask exactly one question per tool call." },
      details: { type: "string", description: "Optional extra context or instructions shown under the question." },
      options: {
        type: "array",
        minItems: 2,
        ...(max ? { maxItems: max } : {}),
        description: `The answer options (2${max ? `-${max}` : " or more"}). Options only — there is no free-text mode. Give each option a stable \`value\`; you reference the correct one by that value in correctAnswer.`,
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Display label for the answer option." },
            value: { type: "string", description: "Optional machine-readable value returned for the option. Defaults to the label." },
            description: { type: "string", description: "Optional extra detail shown below the option." },
          },
          required: ["label"],
        },
      },
      multiSelect: {
        type: "boolean",
        description: "Set to true when more than one option is correct and the user must select all of them.",
      },
      correctAnswer: {
        anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        description:
          'REQUIRED. The correct answer as the option value(s) — the `value` field of the option you intend. Single-select: a single string (e.g. "mercury"). Multi-select: an array of strings (e.g. ["belize", "niue"]); the user is only correct if their selection matches this set exactly. Always pass the value, not a position number — this is self-checking and prevents miscounting.',
      },
      explanation: {
        type: "string",
        description:
          "REQUIRED. Explanation revealed AFTER the user answers (shown whether they got it right or wrong). Use it to reinforce why the correct answer is correct.",
      },
      shuffle: {
        type: "boolean",
        description:
          "Defaults to true: options are reordered before display so the correct answer isn't always in the same position. Set to false only when option order is meaningful (e.g. ordered numeric values, or an 'All/None of the above' option that must stay last).",
      },
    },
    required: ["question", "options", "correctAnswer", "explanation"],
  };
}
