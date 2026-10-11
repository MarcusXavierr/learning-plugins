/** The two harnesses every plugin ships to. The one definition; build/ imports it from here. */
export type Harness = "omp" | "claude";

/** @public Shared harness list for build and prompt generation. */
export const HARNESSES: readonly Harness[] = ["omp", "claude"];

/** Abstract tool id → per-harness tool name. A CC mod tool is `mcp__<plugin>__<tool>`. */
/** @public Shared abstract tool mapping for plugin prompts. */
export const TOOLS: Record<string, Record<Harness, string>> = {
  quiz: { omp: "quiz", claude: "mcp__quiz__quiz" },
  ask: { omp: "ask", claude: "AskUserQuestion" },
  read: { omp: "read", claude: "Read" },
  web_search: { omp: "web_search", claude: "WebSearch" },
  web_fetch: { omp: "read", claude: "WebFetch" },
  write_mermaid: { omp: "write_mermaid", claude: "mcp__visual-tools__write_mermaid" },
  edit_mermaid: { omp: "edit_mermaid", claude: "mcp__visual-tools__edit_mermaid" },
  render_mermaid: { omp: "render_mermaid", claude: "mcp__visual-tools__render_mermaid" },
  write_svg: { omp: "write_svg", claude: "mcp__visual-tools__write_svg" },
  edit_svg: { omp: "edit_svg", claude: "mcp__visual-tools__edit_svg" },
  render_svg: { omp: "render_svg", claude: "mcp__visual-tools__render_svg" },
};

/** "<plugin>/<agent>" → per-harness agent name: `<agent>` in omp, `<plugin>:<agent>` in CC. */
/** @public Shared agent mapping extended by plugin phases. */
export const AGENTS: Record<string, Record<Harness, string>> = {
  "visual-tools/mermaid-maker": { omp: "mermaid-maker", claude: "visual-tools:mermaid-maker" },
  "visual-tools/svg-maker": { omp: "svg-maker", claude: "visual-tools:svg-maker" },
};

function lookup(map: Record<string, Record<Harness, string>>, kind: string, id: string, h: Harness): string {
  const entry = Object.hasOwn(map, id) ? map[id] : undefined;
  if (entry === undefined) throw new Error(`unknown ${kind} id "${id}"`);
  return entry[h];
}

export function toolName(id: string, h: Harness): string {
  return lookup(TOOLS, "tool", id, h);
}

export function agentName(id: string, h: Harness): string {
  return lookup(AGENTS, "agent", id, h);
}
