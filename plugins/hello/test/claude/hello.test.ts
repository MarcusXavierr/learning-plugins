import { expect, test } from "claude-code/testing";

test("/hello answers with a greeting for the typed name", async ($) => {
  const answer = await $.command.run({
    command: "hello",
    args: "Ada",
    origin: { kind: "composer" },
    presentation: { isFullscreen: false, columns: 80 },
  });
  expect(answer.text).toBe("Hello, Ada!");
});

test("hello_image answers with Anthropic text and base64 image blocks", async ($) => {
  const answer = await $.tool.call({ tool: "mcp__hello__hello_image" });
  expect(answer.result).toEqual([
    { type: "text", text: "A solid-colour square:" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: expect.any(String) } },
  ]);
});
