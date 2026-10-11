import { describe, expect, test } from "vitest";
import { applyEdit, EditError } from "../src/core/edit.ts";
import { SourceError, SourceStore } from "../src/core/sources.ts";


describe("applyEdit", () => {
  test("replaces the single occurrence and reports where it was", () => {
    expect(applyEdit("graph TD\n  A --> B\n", "A --> B", "A --> C")).toEqual({ updated: "graph TD\n  A --> C\n", index: 11 });
  });

  test("zero matches is an error that names the count", () => {
    expect(() => applyEdit("A --> B", "A --> X", "Y")).toThrow(new EditError(
      "`old_text` matches 0 times; it must match exactly once. Nothing changed: copy it exactly from the current source.",
    ));
  });

  test("several matches is an error that names the count", () => {
    expect(() => applyEdit("A --> B\nA --> C\nA --> D", "A -->", "Z -->")).toThrow(/matches 3 times/);
  });

  test("overlapping occurrences count as separate matches", () => {
    expect(() => applyEdit("aaa", "aa", "b")).toThrow(/matches 2 times/);
  });

  test("empty and no-op edits are rejected", () => {
    expect(() => applyEdit("abc", "", "x")).toThrow(/non-empty/);
    expect(() => applyEdit("abc", "b", "b")).toThrow(/identical/);
  });
});

describe("SourceStore", () => {
  test("keys and kinds are independent", () => {
    const store = new SourceStore("omp");
    store.write("main", "mermaid", "graph TD\nA-->B");
    store.write("agent-1", "mermaid", "graph LR\nX-->Y");
    store.write("main", "svg", "<svg></svg>");
    expect(store.read("main", "mermaid")).toBe("graph TD\nA-->B");
    expect(store.read("agent-1", "mermaid")).toBe("graph LR\nX-->Y");
    expect(store.read("main", "svg")).toBe("<svg></svg>");
    expect(() => store.read("agent-1", "svg")).toThrow(SourceError);
  });

  test("reading before writing names the write tool of the harness", () => {
    expect(() => new SourceStore("omp").read("main", "svg")).toThrow("No svg source yet: call write_svg first.");
    expect(() => new SourceStore("claude").read("main", "mermaid")).toThrow(
      "No mermaid source yet: call mcp__visual-tools__write_mermaid first.",
    );
  });

  test("write trims the source and returns its line count", () => {
    const store = new SourceStore("omp");
    expect(store.write("main", "mermaid", "\n  graph TD\nA-->B\n\n")).toBe(2);
    expect(store.read("main", "mermaid")).toBe("graph TD\nA-->B");
  });

  test("blank sources and SVG without an <svg> element are rejected", () => {
    const store = new SourceStore("omp");
    expect(() => store.write("main", "mermaid", "  \n ")).toThrow(/non-empty/);
    expect(() => store.write("main", "svg", "<rect/>")).toThrow(/complete <svg>/);
  });

  test("a failed edit leaves the source unchanged; a good one returns the numbered region", () => {
    const store = new SourceStore("omp");
    store.write("main", "mermaid", "graph TD\n  A --> B\n  B --> C");
    expect(() => store.edit("main", "mermaid", "-->", "==>")).toThrow(/matches 2 times/);
    expect(store.read("main", "mermaid")).toBe("graph TD\n  A --> B\n  B --> C");
    expect(store.edit("main", "mermaid", "B --> C", "B --> D")).toBe("1  graph TD\n2    A --> B\n3    B --> D");
    expect(store.read("main", "mermaid")).toBe("graph TD\n  A --> B\n  B --> D");
  });
});
