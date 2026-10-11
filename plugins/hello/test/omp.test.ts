import { expect, test } from "vitest";
import { createFakeOmp } from "../../../test-support/fake-omp.ts";
import { HELLO_PNG_BASE64 } from "../src/core/hello.ts";
import hello from "../src/omp.ts";

test("/hello notifies a greeting for the typed name", async () => {
  const fake = createFakeOmp();
  hello(fake.api);
  await fake.commands.get("hello")?.handler("Ada", fake.ctx);
  expect(fake.notifications).toEqual([{ message: "Hello, Ada!", type: "info" }]);
});

test("hello_image returns the PNG as omp image content", async () => {
  const fake = createFakeOmp();
  hello(fake.api);
  const result = await fake.tools.get("hello_image")?.execute("call-1", {}, undefined, undefined, fake.ctx);
  expect(result?.content).toContainEqual({ type: "image", data: HELLO_PNG_BASE64, mimeType: "image/png" });
});
