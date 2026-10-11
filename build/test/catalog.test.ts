import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { HARNESSES } from "../../shared/tool-map.ts";
import { catalog } from "../catalog.ts";
import { loadPluginSource } from "../plugin-source.ts";

const FIXTURES = join(import.meta.dirname, "fixtures/repo/plugins");

const plugins = await Promise.all(["beta", "alpha"].map((name) => loadPluginSource(join(FIXTURES, name))));

describe.each(HARNESSES)("%s catalog", (harness) => {
  test("lists plugins in directory-name order with sources in the harness's tree", async () => {
    await expect(catalog(harness, plugins)).toMatchFileSnapshot(`./__golden__/catalog/${harness}.json`);
  });
});
