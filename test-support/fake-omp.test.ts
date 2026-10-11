import { expect, test } from "vitest";
import { createFakeOmp } from "./fake-omp.ts";

test("emit runs every handler for the event in registration order, awaiting each, and returns their results", async () => {
  const fake = createFakeOmp();
  const seen: string[] = [];
  fake.api.on("tool_call", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    seen.push("first");
  });
  fake.api.on("tool_call", () => {
    seen.push("second");
    return { block: true, reason: "second says no" };
  });
  fake.api.on("tool_result", () => {
    seen.push("other event");
  });
  expect(await fake.emit("tool_call", {})).toEqual([undefined, { block: true, reason: "second says no" }]);
  expect(seen).toEqual(["first", "second"]);
});
