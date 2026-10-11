import { expect, test } from "vitest";
import { agentName, toolName } from "./tool-map.ts";

test("an unknown tool id throws an error naming the id", () => {
  expect(() => toolName("web_fetcher", "claude")).toThrow('unknown tool id "web_fetcher"');
});

test("an unknown agent id throws an error naming the id", () => {
  expect(() => agentName("visual-tools/nobody", "omp")).toThrow('unknown agent id "visual-tools/nobody"');
});

test("inherited object keys are not tool or agent ids", () => {
  expect(() => toolName("constructor", "omp")).toThrow('unknown tool id "constructor"');
  expect(() => agentName("toString", "claude")).toThrow('unknown agent id "toString"');
});
