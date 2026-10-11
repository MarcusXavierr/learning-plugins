import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { loadPluginSource } from "../plugin-source.ts";

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); });

async function pluginDir(name: string, manifest: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lp-src-"));
  roots.push(root);
  const dir = join(root, name);
  await mkdir(dir);
  await writeFile(join(dir, "package.json"), JSON.stringify(manifest));
  return dir;
}

test("a manifest without a description fails, naming the file and the field", async () => {
  const dir = await pluginDir("demo", { name: "@learning-plugins/demo", version: "0.1.0" });
  await expect(loadPluginSource(dir)).rejects.toThrow(`${join(dir, "package.json")}: "description" must be a non-empty string`);
});

test("a manifest without a version fails", async () => {
  const dir = await pluginDir("demo", { name: "@learning-plugins/demo", description: "d" });
  await expect(loadPluginSource(dir)).rejects.toThrow('"version" must be a non-empty string');
});

test("a package name that does not match the directory fails", async () => {
  const dir = await pluginDir("demo", { name: "@learning-plugins/other", version: "0.1.0", description: "d" });
  await expect(loadPluginSource(dir)).rejects.toThrow('"name" must be "@learning-plugins/demo"');
});
