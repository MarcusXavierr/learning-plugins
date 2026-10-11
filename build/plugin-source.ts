import { access, readFile } from "node:fs/promises";
import { basename, join, posix } from "node:path";

/** @public Manifest extra-bundle contract. */
export interface ExtraBundle { entry: string; out: string; platform: "node" | "neutral" }
interface PluginManifest { dependencies?: string[]; copy?: string[]; extraBundles?: ExtraBundle[] }

export interface PluginSource {
  dir: string; name: string; version: string; description: string;
  dependencies: string[]; extraBundles: ExtraBundle[]; copy: string[];
  hasClaude: boolean; hasOmp: boolean;
}

/** Manifest paths must stay inside one plugin in both distribution trees. */
// eslint-disable-next-line llm-core/no-unknown-parameters -- Manifest paths are decoded at the JSON trust boundary.
function pluginPath(value: unknown, field: string, fail: (problem: string) => never): string {
  if (
    typeof value !== "string" || value === "" || value.includes("\\") || value.includes("\0") ||
    value.startsWith("/") || /^[A-Za-z]:/.test(value) ||
    value.split("/").some((part) => part === "" || part === "." || part === "..") ||
    posix.normalize(value) !== value
  ) fail(`"${field}" must be a normalized plugin-root-relative path`);
  return value;
}

/** Reads `plugins/<name>/package.json`. The plugin name is the directory name. */
export async function loadPluginSource(dir: string): Promise<PluginSource> {
  const name = basename(dir);
  const file = join(dir, "package.json");
  const pkg = JSON.parse(await readFile(file, "utf8")) as { name?: string; version?: string; description?: string; plugin?: PluginManifest };
  const fail = (problem: string): never => {
    throw new Error(`${file}: ${problem}`);
  };

  if (pkg.name !== `@learning-plugins/${name}`) fail(`"name" must be "@learning-plugins/${name}"`);
  for (const key of ["version", "description"] as const) {
    if (typeof pkg[key] !== "string" || pkg[key] === "") fail(`"${key}" must be a non-empty string`);
  }
  if (pkg.plugin !== undefined && (pkg.plugin === null || typeof pkg.plugin !== "object" || Array.isArray(pkg.plugin))) {
    fail('"plugin" must be an object');
  }
  const plugin = pkg.plugin ?? {};
  if (plugin.dependencies !== undefined && (!Array.isArray(plugin.dependencies) || !plugin.dependencies.every((v) => typeof v === "string" && v !== ""))) {
    fail('"plugin.dependencies" must be an array of non-empty strings');
  }
  if (plugin.copy !== undefined && !Array.isArray(plugin.copy)) fail('"plugin.copy" must be an array');
  if (plugin.extraBundles !== undefined && !Array.isArray(plugin.extraBundles)) fail('"plugin.extraBundles" must be an array');
  const copy = (plugin.copy ?? []) as unknown[];
  const bundles = (plugin.extraBundles ?? []) as unknown[];
  const extraBundles = bundles.map((item, index): ExtraBundle => {
    const field = `plugin.extraBundles[${index}]`;
    if (item === null || typeof item !== "object" || Array.isArray(item)) fail(`"${field}" must be an object`);
    const bundle = item as ExtraBundle;
    if (bundle.platform !== "node" && bundle.platform !== "neutral") fail(`"${field}.platform" must be "node" or "neutral"`);
    return {
      entry: pluginPath(bundle.entry, `${field}.entry`, fail),
      out: pluginPath(bundle.out, `${field}.out`, fail),
      platform: bundle.platform,
    };
  });
  const [hasClaude = false, hasOmp = false] = await Promise.all(
    ["src/claude.ts", "src/omp.ts"].map((entry) => access(join(dir, entry)).then(() => true, () => false)),
  );

  return {
    dir,
    name,
    version: pkg.version as string,
    description: pkg.description as string,
    dependencies: plugin.dependencies ?? [],
    extraBundles,
    copy: copy.map((path, index) => pluginPath(path, `plugin.copy[${index}]`, fail)),
    hasClaude,
    hasOmp,
  };
}
