import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { createFakeOmp } from "../../test-support/fake-omp.ts";
import { loadPluginSource } from "../plugin-source.ts";
import { buildTree, renderPrompts, type Tree } from "../plugin-tree.ts";

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); });

const FIXTURES = join(import.meta.dirname, "fixtures/repo/plugins");
const text = (tree: Tree, path: string): string => {
  const content = tree.get(path);
  if (content === undefined) throw new Error(`no ${path} in tree`);
  return typeof content === "string" ? content : Buffer.from(content).toString("utf8");
};

const alpha = await loadPluginSource(join(FIXTURES, "alpha"));
const beta = await loadPluginSource(join(FIXTURES, "beta"));

describe("a plugin with both adapters", () => {
  test("CC tree: manifest and hooks module list", async () => {
    const tree = await buildTree(alpha, "claude");
    expect([...tree.keys()].sort()).toEqual([".claude-plugin/plugin.json", "hooks/hooks.json", "hooks/register.js", "tool/cli.js", "tool/data.txt"]);
    expect(JSON.parse(text(tree, ".claude-plugin/plugin.json"))).toEqual({
      name: "alpha",
      version: "1.2.3",
      description: "Alpha fixture: both adapters, an extra bundle and a copied file.",
      author: { name: "Marcus Xavier" },
    });
    expect(JSON.parse(text(tree, "hooks/hooks.json"))).toEqual({ modules: ["./register.js"] });
  });

  test("omp tree: the extension bundle loads in Node and registers the plugin's command", async () => {
    const tree = await buildTree(alpha, "omp");
    expect(JSON.parse(text(tree, "package.json"))).toEqual({
      name: "@learning-plugins/alpha",
      version: "1.2.3",
      description: "Alpha fixture: both adapters, an extra bundle and a copied file.",
      type: "module",
      omp: { extensions: ["./extension.js"] },
    });
    const root = await mkdtemp(join(tmpdir(), "lp-ext-"));
    roots.push(root);
    const file = join(root, "extension.mjs");
    await writeFile(file, text(tree, "extension.js"));
    // The generated bundle has no static module specifier; this exercises its actual runtime load.
    const loaded: unknown = await import(pathToFileURL(file).href);
    if (loaded === null || typeof loaded !== "object" || !("default" in loaded) || typeof loaded.default !== "function") {
      throw new Error("generated extension has no factory");
    }
    const factory: (api: ExtensionAPI) => void | Promise<void> = loaded.default as (api: ExtensionAPI) => void | Promise<void>;
    const fake = createFakeOmp();
    await factory(fake.api);
    await fake.commands.get("alpha")?.handler("Ada", fake.ctx);
    expect(fake.notifications).toEqual([{ message: "hello, Ada", type: undefined }]);
  });

  test("extra bundles and copied files land at the same path, byte-identical, in both trees", async () => {
    const [claude, omp] = await Promise.all([buildTree(alpha, "claude"), buildTree(alpha, "omp")]);
    expect(text(omp, "tool/data.txt")).toBe("fixture data\n");
    expect(text(claude, "tool/data.txt")).toBe(text(omp, "tool/data.txt"));
    expect(text(claude, "tool/cli.js")).toBe(text(omp, "tool/cli.js"));
    expect(text(omp, "tool/cli.js")).toContain("hello, ");
  });
});

describe("a prompts-only plugin", () => {
  test("CC tree has the manifest with dependencies and the rendered prompts, and no hooks", async () => {
    const tree = await buildTree(beta, "claude");
    expect([...tree.keys()].sort()).toEqual([
      ".claude-plugin/plugin.json",
      "agents/helper.md",
      "skills/greeting/SKILL.md",
      "skills/greeting/template.txt",
    ]);
    expect(JSON.parse(text(tree, ".claude-plugin/plugin.json"))).toHaveProperty("dependencies", ["alpha"]);
    expect(text(tree, "agents/helper.md")).toContain("Read files with Read.");
  });

  test("omp tree has a package.json without an omp key, and no extension", async () => {
    const tree = await buildTree(beta, "omp");
    expect([...tree.keys()].sort()).toEqual(["agents/helper.md", "package.json", "skills/greeting/SKILL.md", "skills/greeting/template.txt"]);
    expect(JSON.parse(text(tree, "package.json"))).not.toHaveProperty("omp");
    expect(text(tree, "skills/greeting/template.txt")).toBe("Hi {name}\n");
  });
});

test("a skill directory without SKILL.md fails instead of shipping the files unrendered", async () => {
  const root = await mkdtemp(join(tmpdir(), "lp-skill-"));
  roots.push(root);
  const dir = join(root, "demo");
  await mkdir(join(dir, "prompts/skills/oops"), { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "@learning-plugins/demo", version: "0.1.0", description: "d" }));
  await writeFile(join(dir, "prompts/skills/oops/skill.md"), "---\nname: oops\ndescription: d\n---\n");
  await expect(renderPrompts(await loadPluginSource(dir), "omp")).rejects.toThrow("demo/prompts/skills/oops: missing SKILL.md");
});
