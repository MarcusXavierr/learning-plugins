// Lives in build/test: it drives build/ (plugins never import build/, npm run structure). The goldens stay with the plugin.
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadPluginSource } from "../plugin-source.ts";
import { renderPrompts } from "../plugin-tree.ts";

const PLUGIN = join(import.meta.dirname, "../../plugins/visual-tools");

for (const h of ["omp", "claude"] as const) {
  test(`visual-tools ${h} prompts match golden files`, async () => {
    const tree = await renderPrompts(await loadPluginSource(PLUGIN), h);
    expect([...tree.keys()].sort()).toEqual(["agents/mermaid-maker.md", "agents/svg-maker.md", "skills/visualize/SKILL.md"]);
    for (const [path, text] of tree) {
      if (typeof text !== "string") throw new Error(`${path} is not text`);
      await expect(text).toMatchFileSnapshot(join(PLUGIN, "test/__golden__", h, path));
    }
  });
}
