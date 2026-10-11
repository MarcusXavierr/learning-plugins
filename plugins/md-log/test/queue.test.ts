import { expect, test } from "vitest";
import { createSerialQueue } from "../src/core/queue.ts";

test("runs tasks one at a time in call order, even when an earlier task is slower", async () => {
  const queue = createSerialQueue();
  const log: string[] = [];
  const slow = queue.run(async () => {
    await new Promise((r) => setTimeout(r, 20));
    log.push("slow");
  });
  const fast = queue.run(() => {
    log.push("fast");
    return Promise.resolve();
  });
  await Promise.all([slow, fast]);
  expect(log).toEqual(["slow", "fast"]);
});

test("a failed task rejects its own run and does not stop later tasks", async () => {
  const queue = createSerialQueue();
  const failed = queue.run(() => Promise.reject(new Error("disk full")));
  const later = queue.run(() => Promise.resolve("written"));
  await expect(failed).rejects.toThrow("disk full");
  await expect(later).resolves.toBe("written");
});
