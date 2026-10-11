import type { Harness } from "../shared/tool-map.ts";
import type { PluginSource } from "./plugin-source.ts";

/** One marketplace catalog. omp reads `.omp-plugin/marketplace.json`, CC reads `.claude-plugin/marketplace.json`. */
export function catalog(harness: Harness, plugins: PluginSource[]): string {
  const sorted = [...plugins].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const value = {
    name: "learning-plugins",
    description: "Learning workflow plugins for Oh My Pi and Claude Code, built from one source tree.",
    owner: { name: "Marcus Xavier" },
    plugins: sorted.map((p) => ({
      name: p.name,
      source: `./dist/${harness}/${p.name}`,
      description: p.description,
      version: p.version,
    })),
  };
  return JSON.stringify(value, null, 2) + "\n";
}
