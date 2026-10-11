import { expect, test } from "vitest";
import { formatLog } from "../src/core/format.ts";
import { backfillFromClaude } from "../src/core/from-claude.ts";
import { backfillFromOmp } from "../src/core/from-omp.ts";
import { CLAUDE_MESSAGES, OMP_MESSAGES, QUIZ_INPUT } from "./fixtures/session.ts";

test("the omp branch of the scripted session logs as golden/session.md", async () => {
  await expect(formatLog(backfillFromOmp(OMP_MESSAGES))).toMatchFileSnapshot("golden/session.md");
});

test("the CC transcript of the same session logs byte-identically", async () => {
  await expect(formatLog(backfillFromClaude(CLAUDE_MESSAGES).entries)).toMatchFileSnapshot("golden/session.md");
});

test("changing only omp's option ordering breaks cross-harness parity", () => {
  const ompOnly = OMP_MESSAGES.map((message) => message.role !== "assistant" || !Array.isArray(message.content)
    ? message
    // eslint-disable-next-line llm-core/no-unknown-parameters -- omp content blocks are untyped host data.
    : { ...message, content: message.content.map((block: unknown) => {
      const b = block as { type?: string; name?: string };
      return b.type === "toolCall" && b.name === "quiz"
        ? { ...b, arguments: { ...QUIZ_INPUT, shuffle: false } } : block;
    }) });
  expect(formatLog(backfillFromOmp(ompOnly))).not.toBe(formatLog(backfillFromClaude(CLAUDE_MESSAGES).entries));
});
