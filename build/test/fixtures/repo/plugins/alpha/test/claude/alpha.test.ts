import { expect, test } from "claude-code/testing";

test("/alpha executes the bundled command", async ($) => {
  const answer = await $.command.run({
    command: "alpha",
    args: "Ada",
    origin: { kind: "composer" },
    presentation: { isFullscreen: false, columns: 80 },
  });
  expect(answer.text).toBe("hello, Ada");
});
