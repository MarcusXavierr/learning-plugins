import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { build } from "esbuild";
import type { Harness } from "../shared/tool-map.ts";
import type { PluginSource } from "./plugin-source.ts";
import { PromptError, renderAgent, renderSkill } from "./prompts.ts";

/** Relative path → file content. Text that the build generates is a string; copied files are bytes. */
export type Tree = Map<string, string | Uint8Array>;

const AUTHOR = { name: "Marcus Xavier" };
type Metadata = { name?: string; version?: string; description?: string; author?: { name: string }; dependencies?: string[]; modules?: string[]; type?: string; omp?: { extensions: string[] } };
const json = (value: Metadata): string => JSON.stringify(value, null, 2) + "\n";

/** Bundles one entry into a single ESM file. Paths in esbuild's comments are relative to the repo root,
 *  which keeps the output byte-identical wherever the repo is checked out. */
async function bundle(src: PluginSource, entry: string, platform: "node" | "neutral", external: string[]): Promise<string> {
  const result = await build({
    absWorkingDir: resolve(src.dir, "../.."),
    entryPoints: [join(src.dir, entry)],
    bundle: true,
    write: false,
    format: "esm",
    platform,
    target: "es2023",
    external,
    charset: "utf8",
    legalComments: "none",
    logLevel: "silent",
  });
  const [output] = result.outputFiles;
  if (output === undefined) throw new Error(`${src.name}: esbuild produced no output for ${entry}`);
  return output.text;
}

/** Every file under `dir`, as sorted `/`-separated paths relative to it; none when `dir` is missing. */
/** @public Stable recursive listing for build and test staging. */
export async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split("\\").join("/"))
    .sort();
}

/** `prompts/agents/*.md` → `agents/*.md`; `prompts/skills/<s>/**` → `skills/<s>/**`, SKILL.md rendered, the rest copied. */
export async function renderPrompts(src: PluginSource, harness: Harness): Promise<Tree> {
  const tree: Tree = new Map();
  const agentsDir = join(src.dir, "prompts/agents");
  for (const file of await listFiles(agentsDir)) {
    if (file.includes("/") || !file.endsWith(".md")) continue;
    tree.set(`agents/${file}`, renderAgent(`${src.name}/prompts/agents/${file}`, await readFile(join(agentsDir, file), "utf8"), harness));
  }
  const skillsDir = join(src.dir, "prompts/skills");
  const skillFiles = await listFiles(skillsDir);
  for (const skill of new Set(skillFiles.map((f) => f.split("/")[0] ?? ""))) {
    if (!skillFiles.includes(`${skill}/SKILL.md`)) throw new PromptError(`${src.name}/prompts/skills/${skill}: missing SKILL.md`);
  }
  for (const file of skillFiles) {
    const content = await readFile(join(skillsDir, file));
    tree.set(
      `skills/${file}`,
      file.endsWith("/SKILL.md") ? renderSkill(`${src.name}/prompts/skills/${file}`, content.toString("utf8"), harness) : content,
    );
  }
  return tree;
}

export async function buildTree(src: PluginSource, harness: Harness): Promise<Tree> {
  const tree: Tree = new Map();
  const put = (path: string, content: string | Uint8Array): void => {
    for (const existing of tree.keys()) {
      if (existing === path || existing.startsWith(`${path}/`) || path.startsWith(`${existing}/`)) {
        throw new Error(`plugins/${src.name}: duplicate output path "${path}" in ${harness} tree`);
      }
    }
    tree.set(path, content);
  };
  if (harness === "claude") {
    put(".claude-plugin/plugin.json", json({
      name: src.name,
      version: src.version,
      description: src.description,
      author: AUTHOR,
      ...(src.dependencies.length > 0 ? { dependencies: src.dependencies } : {}),
    }));
    if (src.hasClaude) {
      put("hooks/hooks.json", json({ modules: ["./register.js"] }));
      put("hooks/register.js", await bundle(src, "src/claude.ts", "neutral", ["claude-code"]));
    }
  } else {
    put("package.json", json({
      name: `@learning-plugins/${src.name}`,
      version: src.version,
      description: src.description,
      type: "module",
      ...(src.hasOmp ? { omp: { extensions: ["./extension.js"] } } : {}),
    }));
    if (src.hasOmp) {
      put("extension.js", await bundle(src, "src/omp.ts", "node", ["@oh-my-pi/*", "@sinclair/typebox", "node:*"]));
    }
  }
  for (const extra of src.extraBundles) put(extra.out, await bundle(src, extra.entry, extra.platform, []));
  for (const path of src.copy) put(path, await readFile(join(src.dir, path)));
  for (const [path, content] of await renderPrompts(src, harness)) put(path, content);
  return tree;
}
