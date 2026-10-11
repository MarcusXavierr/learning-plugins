import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { buildRepo, diffRepo, writeRepo } from "../repo.ts";

const fixtureRoots: string[] = [];
afterAll(async () => { await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true }))); });

async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lp-repo-"));
  fixtureRoots.push(root);
  await cp(join(import.meta.dirname, "fixtures/repo"), root, { recursive: true });
  return root;
}

test("builds every plugin into both trees plus both catalogs", async () => {
  const files = await buildRepo(await fixtureRepo());
  expect([...files.keys()].sort()).toEqual([
    ".claude-plugin/marketplace.json",
    ".omp-plugin/marketplace.json",
    "dist/claude/alpha/.claude-plugin/plugin.json",
    "dist/claude/alpha/hooks/hooks.json",
    "dist/claude/alpha/hooks/register.js",
    "dist/claude/alpha/tool/cli.js",
    "dist/claude/alpha/tool/data.txt",
    "dist/claude/beta/.claude-plugin/plugin.json",
    "dist/claude/beta/agents/helper.md",
    "dist/claude/beta/skills/greeting/SKILL.md",
    "dist/claude/beta/skills/greeting/template.txt",
    "dist/omp/alpha/extension.js",
    "dist/omp/alpha/package.json",
    "dist/omp/alpha/tool/cli.js",
    "dist/omp/alpha/tool/data.txt",
    "dist/omp/beta/agents/helper.md",
    "dist/omp/beta/package.json",
    "dist/omp/beta/skills/greeting/SKILL.md",
    "dist/omp/beta/skills/greeting/template.txt",
  ]);
});

test("two builds of the same sources are byte-identical, even from different checkouts", async () => {
  const [a, b] = await Promise.all([buildRepo(await fixtureRepo()), buildRepo(await fixtureRepo())]);
  expect(b).toEqual(a);
});

test("a fresh write leaves nothing to report", async () => {
  const root = await fixtureRepo();
  const files = await buildRepo(root);
  await writeRepo(root, files);
  expect(await diffRepo(root, files)).toEqual([]);
});

test("reports stale, missing and extra generated files", async () => {
  const root = await fixtureRepo();
  const files = await buildRepo(root);
  await writeRepo(root, files);
  await writeFile(join(root, "dist/omp/beta/agents/helper.md"), "hand edit\n");
  await rm(join(root, ".omp-plugin/marketplace.json"));
  await writeFile(join(root, "dist/claude/alpha/leftover.js"), "");
  expect(await diffRepo(root, files)).toEqual([
    "extra: dist/claude/alpha/leftover.js",
    "missing: .omp-plugin/marketplace.json",
    "stale: dist/omp/beta/agents/helper.md",
  ]);
});

test("ignores the types and tsconfig Claude Code writes into a plugin dir it loads", async () => {
  const root = await fixtureRepo();
  const files = await buildRepo(root);
  await writeRepo(root, files);
  await mkdir(join(root, "dist/claude/alpha/.claude-plugin/types/claude-code"), { recursive: true });
  await writeFile(join(root, "dist/claude/alpha/.claude-plugin/types/claude-code/index.d.ts"), "");
  await writeFile(join(root, "dist/claude/alpha/tsconfig.json"), "{}");
  expect(await diffRepo(root, files)).toEqual([]);
});

test("writing replaces dist wholesale: files of a removed plugin disappear", async () => {
  const root = await fixtureRepo();
  await writeRepo(root, await buildRepo(root));
  await rm(join(root, "plugins/beta"), { recursive: true });
  const files = await buildRepo(root);
  await writeRepo(root, files);
  await expect(readFile(join(root, "dist/omp/beta/package.json"))).rejects.toThrow("ENOENT");
  expect(await diffRepo(root, files)).toEqual([]);
});

test("a dependency on a plugin that does not exist fails the build", async () => {
  const root = await fixtureRepo();
  const manifest = join(root, "plugins/beta/package.json");
  const pkg: unknown = JSON.parse(await readFile(manifest, "utf8"));
  if (pkg === null || typeof pkg !== "object") throw new Error("fixture manifest is not an object");
  await writeFile(manifest, JSON.stringify({ ...pkg, plugin: { dependencies: ["alpah"] } }));
  await expect(buildRepo(root)).rejects.toThrow('plugins/beta: unknown dependency "alpah"');
});

test.each([
  ["bundle overwrites CC metadata", { extraBundles: [{ entry: "src/tool/cli.ts", out: ".claude-plugin/plugin.json", platform: "node" }] }, 'duplicate output path ".claude-plugin/plugin.json"'],
  ["copy overwrites a generated hook", { copy: ["hooks/hooks.json"] }, 'duplicate output path "hooks/hooks.json"'],
  ["two bundles share an output", { extraBundles: [
    { entry: "src/tool/cli.ts", out: "tool/cli.js", platform: "node" },
    { entry: "src/tool/cli.ts", out: "tool/cli.js", platform: "node" },
  ] }, 'duplicate output path "tool/cli.js"'],
  ["copy overwrites a rendered prompt", { copy: ["skills/greeting/SKILL.md"] }, 'duplicate output path "skills/greeting/SKILL.md"'],
])("rejects %s before writing dist", async (_case, plugin, error) => {
  const root = await fixtureRepo();
  const manifest = join(root, "plugins/alpha/package.json");
  const pkg: unknown = JSON.parse(await readFile(manifest, "utf8"));
  if (pkg === null || typeof pkg !== "object") throw new Error("fixture manifest is not an object");
  await writeFile(manifest, JSON.stringify({ ...pkg, plugin }));
  if (_case === "copy overwrites a generated hook") {
    await mkdir(join(root, "plugins/alpha/hooks"), { recursive: true });
    await writeFile(join(root, "plugins/alpha/hooks/hooks.json"), "{}");
  }
  if (_case === "copy overwrites a rendered prompt") {
    const prompt = join(root, "plugins/alpha/prompts/skills/greeting");
    await mkdir(prompt, { recursive: true });
    await writeFile(join(prompt, "SKILL.md"), "---\nname: greeting\ndescription: d\n---\n");
    await mkdir(join(root, "plugins/alpha/skills/greeting"), { recursive: true });
    await writeFile(join(root, "plugins/alpha/skills/greeting/SKILL.md"), "copy");
  }
  await expect(buildRepo(root)).rejects.toThrow(error);
  await expect(readFile(join(root, "dist/claude/alpha/.claude-plugin/plugin.json"))).rejects.toThrow("ENOENT");
});

test.each([
  ["bundle entry", { extraBundles: [{ entry: "../escape.ts", out: "tool/cli.js", platform: "node" }] }, '"plugin.extraBundles[0].entry"'],
  ["bundle output", { extraBundles: [{ entry: "src/tool/cli.ts", out: "../escape.js", platform: "node" }] }, '"plugin.extraBundles[0].out"'],
  ["copied file", { copy: ["../escape.txt"] }, '"plugin.copy[0]"'],
  ["Windows drive path", { copy: ["C:/escape.txt"] }, '"plugin.copy[0]"'],
  ["non-string copy", { copy: [42] }, '"plugin.copy[0]"'],
  ["invalid platform", { extraBundles: [{ entry: "src/tool/cli.ts", out: "tool/cli.js", platform: "browser" }] }, '"plugin.extraBundles[0].platform"'],
])("rejects invalid %s through buildRepo", async (_case, plugin, field) => {
  const root = await fixtureRepo();
  const manifest = join(root, "plugins/alpha/package.json");
  const pkg: unknown = JSON.parse(await readFile(manifest, "utf8"));
  if (pkg === null || typeof pkg !== "object") throw new Error("fixture manifest is not an object");
  await writeFile(manifest, JSON.stringify({ ...pkg, plugin }));
  await expect(buildRepo(root)).rejects.toThrow(field);
});
