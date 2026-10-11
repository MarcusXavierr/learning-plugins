import { parse, stringify } from "yaml";
import { agentName, HARNESSES, toolName, type Harness } from "../shared/tool-map.ts";

/** Every generator failure. The message starts with the source path. */
export class PromptError extends Error {}

type Kind = "agent" | "skill";
type YamlValue = string | number | boolean | null | YamlValue[] | YamlMap;
interface YamlMap { [key: string]: YamlValue }

const ALLOWED_KEYS: Record<Kind, readonly string[]> = {
  agent: ["name", "description", "tools", "model", "harness"],
  skill: ["name", "description", "harness"],
};
const RESERVED_KEYS = ["name", "description", "tools", "model"];
const LEGACY_LITERALS = ["ask_user_question", "subagent(", "web_fetch"];
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const DISPATCH_LINE = /^(\s*)\{\{dispatch:([^{}|]+)\|([^{}]*)\}\}\s*$/;

/** Dispatch examples. Field names follow the real tool schemas:
 *  omp `task` with task.batch on (default true, pi-coding-agent src/config/settings-schema.ts:5072):
 *  `{context, tasks: [{agent, task}]}` (src/task/types.ts:87-97);
 *  CC `Agent` (claude-code-tools BuiltinToolInputs.Agent): `{description, prompt, subagent_type}`. */
const DISPATCH: Record<Harness, (agent: string, brief: string) => { tool: string; args: object }> = {
  omp: (agent, brief) => ({
    tool: "task",
    args: { context: "<background the agent needs beyond the brief>", tasks: [{ agent, task: brief }] },
  }),
  claude: (agent, brief) => ({
    tool: "Agent",
    args: { description: "<3-5 word summary of the brief>", prompt: brief, subagent_type: agent },
  }),
};

export function renderAgent(path: string, text: string, harness: Harness): string {
  return render("agent", path, text, harness);
}

export function renderSkill(path: string, text: string, harness: Harness): string {
  return render("skill", path, text, harness);
}

function render(kind: Kind, path: string, text: string, harness: Harness): string {
  const fail = (problem: string): never => {
    throw new PromptError(`${path}: ${problem}`);
  };
  const resolve = (fn: (id: string, h: Harness) => string, id: string): string => {
    try {
      return fn(id, harness);
    } catch (error) {
      return fail((error as Error).message);
    }
  };

  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (match === null) return fail("missing frontmatter (--- … ---)");
  const source: unknown = parse(match[1] ?? "");
  if (source === null || typeof source !== "object" || Array.isArray(source)) return fail("frontmatter must be a mapping");
  const fm = source as YamlMap;
  const body = text.slice(match.at(0)?.length ?? 0);

  for (const key of Object.keys(fm)) {
    if (!ALLOWED_KEYS[kind].includes(key)) fail(`frontmatter key "${key}" is not allowed in ${kind === "agent" ? "an agent" : "a skill"}`);
  }
  for (const key of ["name", "description"]) {
    if (typeof fm[key] !== "string" || fm[key] === "") fail(`frontmatter "${key}" must be a non-empty string`);
  }

  const out: YamlMap = { name: fm.name ?? null, description: fm.description ?? null };
  if (fm.tools !== undefined) {
    if (!Array.isArray(fm.tools) || !fm.tools.every((t) => typeof t === "string")) fail(`"tools" must be a list of tool ids`);
    out.tools = [...new Set((fm.tools as string[]).map((id) => resolve(toolName, id)))].join(", ");
  }
  if (kind === "agent") {
    const model = fm.model as YamlMap | undefined;
    for (const h of HARNESSES) {
      if (typeof model?.[h] !== "string") fail(`"model" needs a string entry for ${h}`);
    }
    out.model = model?.[harness] ?? "";
  }
  const overrides = fm.harness as YamlMap | undefined;
  for (const h of Object.keys(overrides ?? {})) {
    if (!(HARNESSES as readonly string[]).includes(h)) fail(`unknown harness "${h}" under "harness"`);
  }
  const extra = overrides?.[harness];
  if (extra !== undefined) {
    if (extra === null || typeof extra !== "object" || Array.isArray(extra)) fail(`"harness.${harness}" must be a mapping`);
    for (const [key, value] of Object.entries(extra as YamlMap)) {
      if (RESERVED_KEYS.includes(key)) fail(`"harness.${harness}.${key}" would override a generated key`);
      out[key] = value;
    }
  }

  for (const literal of LEGACY_LITERALS) {
    if (body.replace(PLACEHOLDER, "").includes(literal)) fail(`legacy literal "${literal}" outside a placeholder`);
  }

  const lines = body.split("\n").flatMap((line) => {
    if (!line.includes("{{dispatch:")) return [line];
    const dispatch = DISPATCH_LINE.exec(line);
    if (dispatch === null) return fail("{{dispatch:…}} must be alone on its line");
    const [, indent = "", id = "", brief = ""] = dispatch;
    const { tool, args } = DISPATCH[harness](resolve(agentName, id.trim()), brief.trim());
    return [`Call the \`${tool}\` tool:`, "", "```json", ...JSON.stringify(args, null, 2).split("\n"), "```"].map(
      (l) => (l === "" ? l : indent + l),
    );
  });
  const expanded = lines.join("\n").replace(PLACEHOLDER, (whole, inner: string) => {
    const [, placeholderKind, id = ""] = /^(\w+):(.*)$/s.exec(inner) ?? [];
    if (placeholderKind === "tool") return resolve(toolName, id.trim());
    if (placeholderKind === "agent") return resolve(agentName, id.trim());
    return fail(`unknown placeholder "${whole}"`);
  });

  return `---\n${stringify(out, { lineWidth: 0 })}---\n${expanded.trimEnd()}\n`;
}
