import { describe, expect, test } from "vitest";
import { applyEdit, EditError } from "../src/core/edit.ts";
import { planRender, publishName } from "../src/core/publish.ts";
import { SourceError, SourceStore } from "../src/core/sources.ts";


/** Deterministic stand-in for Math.random: yields the given values in a cycle. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

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

describe("publishName", () => {
  test("slugifies, stamps the time, and appends six random base36 chars", () => {
    expect(publishName("Internet Packets!", 1760000000000, seq(0, 0.5, 0.999999))).toBe(
      "viz-internet-packets-1760000000000-0iz0iz.png",
    );
  });

  test("an empty slug falls back to viz and a long one is cut to 60 chars without a trailing dash", () => {
    expect(publishName("!!!", 1, seq(0))).toBe("viz-viz-1-000000.png");
    const long = publishName(`${"a".repeat(59)} b`, 1, seq(0));
    expect(long).toBe(`viz-${"a".repeat(59)}-1-000000.png`);
  });

  test("different random draws give different names for the same slug and time", () => {
    expect(publishName("x", 1, seq(0.1))).not.toBe(publishName("x", 1, seq(0.2)));
  });
});

describe("planRender", () => {
  const base = { cwd: "/work/notes", stagingDir: "/tmp/vt-1", nowMs: 5, random: seq(0) };

  test("a preview renders into the staging dir and publishes nothing", () => {
    expect(planRender({ ...base, kind: "mermaid" })).toEqual({
      input: "/tmp/vt-1/viz-preview-5-000000.mmd",
      output: "/tmp/vt-1/viz-preview-5-000000.png",
    });
  });

  test("save_as renders straight into <cwd>/viz under the unique name", () => {
    expect(planRender({ ...base, kind: "svg", saveAs: "number-line" })).toEqual({
      input: "/tmp/vt-1/viz-number-line-5-000000.svg",
      output: "/work/notes/viz/viz-number-line-5-000000.png",
      published: { filename: "viz-number-line-5-000000.png", path: "/work/notes/viz/viz-number-line-5-000000.png" },
    });
  });

  test("a blank save_as is a preview", () => {
    expect(planRender({ ...base, kind: "svg", saveAs: "  " }).published).toBeUndefined();
  });
});

