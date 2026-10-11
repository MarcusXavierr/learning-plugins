import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AGENTS, HARNESSES } from "../../shared/tool-map.ts";
import { PromptError, renderAgent, renderSkill } from "../prompts.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures/prompts", name), "utf8");

// The generator reads the shared agent map; Phase 1 seeds no agents, so this file adds one for its own run.
beforeAll(() => {
  AGENTS["fixture/maker"] = { omp: "maker", claude: "fixture:maker" };
});
afterAll(() => {
  delete AGENTS["fixture/maker"];
});

const AGENT_OK = "---\nname: a\ndescription: d\nmodel: { omp: m, claude: sonnet }\n---\n";

describe.each(HARNESSES)("%s", (harness) => {
  test("renders an agent: mapped tools, per-harness model and extras, expanded placeholders", async () => {
    await expect(renderAgent("fixture/researcher.md", fixture("researcher.md"), harness)).toMatchFileSnapshot(
      `./__golden__/prompts/${harness}/researcher.md`,
    );
  });

  test("renders a skill with a dispatch example", async () => {
    await expect(renderSkill("fixture/visualize/SKILL.md", fixture("visualize-skill.md"), harness)).toMatchFileSnapshot(
      `./__golden__/prompts/${harness}/visualize-SKILL.md`,
    );
  });
});

function expectPromptError(render: () => string, message: string): void {
  expect(render).toThrow(PromptError);
  expect(render).toThrow(message);
}

test("an unknown placeholder kind fails, naming the file", () => {
  expectPromptError(() => renderAgent("p/a.md", `${AGENT_OK}Use {{tol:quiz}}.\n`, "omp"), 'p/a.md: unknown placeholder "{{tol:quiz}}"');
});

test("an unknown tool id in the body fails", () => {
  expectPromptError(() => renderAgent("p/a.md", `${AGENT_OK}Use {{tool:quizz}}.\n`, "claude"), 'p/a.md: unknown tool id "quizz"');
});

test("an unknown tool id in frontmatter tools fails", () => {
  const text = "---\nname: a\ndescription: d\ntools: [web_search, grep]\nmodel: { omp: m, claude: sonnet }\n---\nBody\n";
  expectPromptError(() => renderAgent("p/a.md", text, "omp"), 'unknown tool id "grep"');
});

test("an unknown agent id in a dispatch fails", () => {
  expectPromptError(() => renderSkill("p/S.md", "---\nname: s\ndescription: d\n---\n{{dispatch:x/nobody|brief}}\n", "omp"), 'unknown agent id "x/nobody"');
});

test("an agent without a model for every harness fails, even when rendering the other harness", () => {
  const text = "---\nname: a\ndescription: d\nmodel: { claude: sonnet }\n---\nBody\n";
  expectPromptError(() => renderAgent("p/a.md", text, "claude"), '"model" needs a string entry for omp');
});

test.each(["ask_user_question", "subagent(", "web_fetch"])("legacy literal %s outside a placeholder fails", (literal) => {
  expectPromptError(() => renderAgent("p/a.md", `${AGENT_OK}Call ${literal} here.\n`, "omp"), `legacy literal "${literal}"`);
});

test("tools and model are not allowed in a skill", () => {
  const text = "---\nname: s\ndescription: d\ntools: [read]\n---\nBody\n";
  expectPromptError(() => renderSkill("p/S.md", text, "claude"), 'frontmatter key "tools" is not allowed in a skill');
});

test("an unknown top-level frontmatter key fails instead of being dropped", () => {
  const text = "---\nname: a\ndescription: d\nthinking: medium\nmodel: { omp: m, claude: sonnet }\n---\nBody\n";
  expectPromptError(() => renderAgent("p/a.md", text, "omp"), 'frontmatter key "thinking" is not allowed in an agent');
});

test("a per-harness extra cannot override a generated key", () => {
  const text = "---\nname: a\ndescription: d\nmodel: { omp: m, claude: sonnet }\nharness:\n  omp: { model: other }\n---\nBody\n";
  expectPromptError(() => renderAgent("p/a.md", text, "omp"), '"harness.omp.model" would override a generated key');
});

test("a dispatch that shares its line with other text fails", () => {
  const text = "---\nname: s\ndescription: d\n---\nThen {{dispatch:fixture/maker|brief}} now.\n";
  expectPromptError(() => renderSkill("p/S.md", text, "omp"), "{{dispatch:…}} must be alone on its line");
});

test("a file without frontmatter fails", () => {
  expectPromptError(() => renderSkill("p/S.md", "# Just markdown\n", "omp"), "p/S.md: missing frontmatter");
});
