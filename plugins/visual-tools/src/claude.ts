/**
 * visual-tools for Claude Code: write_/edit_/render_ × mermaid/svg as mod tools (`mcp__visual-tools__<id>`).
 *
 * One module serves every agent loop, so sources are keyed by the call's `agentId` ("main" when absent).
 * Every `$` call lives in this file (validate's static analysis); core never sees `$`.
 * All awaits below are mods API calls, which the 10 s hook budget exempts (design: CC hook time budget).
 * Errors answer `{ deny }`: only a deny reaches the model as an error tool_result (Phase 3 smoke).
 */
import type { EngineInterface, On, ToolCallInput } from "claude-code";
import { toolName } from "../../../shared/tool-map.ts";
import { cacheRoot, installPaths, renderTimeoutMs } from "./core/install.ts";
import { renderArgv, stderrTail } from "./core/protocol.ts";
import { planRender, type RenderPlan } from "./core/publish.ts";
import { SourceStore } from "./core/sources.ts";
import { editedText, inputSchema, renderedText, renderFailedText, toolSpecs, wroteText, type VisualToolSpec } from "./core/tools.ts";

const SPECS = toolSpecs("claude");
const SPEC_BY_TOOL = new Map(SPECS.map((s) => [toolName(s.id, "claude"), s]));
let store = new SourceStore("claude"); // session.end resets it; session.start does not rerun after /clear or /resume
/** `$.fs.read` rejects anything larger (cc.d.ts:2743). */
const MAX_PNG_BYTES = 4 * 1024 * 1024;
const MS_PER_SECOND = 1000;

type Answer = { result: readonly unknown[] | string } | { deny: string };

/** One render: what it renders, and which of its files exist by now (for cleanup). */
interface RenderJob {
  spec: VisualToolSpec;
  plan: RenderPlan;
  source: string;
  installed: boolean;
  /** render.js exited 0, so it created `plan.output` exclusively. */
  created: boolean;
  /** The PNG reached the model. */
  delivered: boolean;
}

/** A tool argument (spread beside `tool` on the call) as text, coerced as the omp adapter does; "" when absent. */
function argText(e: ToolCallInput, name: "source" | "old_text" | "new_text"): string {
  return String(Reflect.get(e, name) ?? "");
}

/** Runs render.js on the staged source; returns the failure text, or undefined once --out exists (created exclusively). */
async function runRenderer($: EngineInterface, job: RenderJob): Promise<string | undefined> {
  const { spec, plan } = job;
  const script = `${$.plugin.root}/renderer/render.js`;
  const timeoutMs = renderTimeoutMs(job.installed);
  let run;
  try {
    run = await $.process.run(renderArgv("node", script, { kind: spec.kind, input: plan.input, output: plan.output }), { timeoutMs });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return renderFailedText(spec.kind, `Could not run \`node ${script}\` (needs Node.js >= 22.13 on PATH; timeout ${timeoutMs / MS_PER_SECOND}s): ${why}`, "claude");
  }
  return run.exitCode === 0 ? undefined : renderFailedText(spec.kind, stderrTail(run.stderr), "claude");
}

/** The rendered PNG as an Anthropic image block, or a deny when CC cannot read it back. */
async function readPng($: EngineInterface, job: RenderJob): Promise<Answer> {
  const { spec, plan } = job;
  const { size } = await $.fs.stat(plan.output);
  if (size > MAX_PNG_BYTES) {
    return { deny: `The PNG at ${plan.output} is ${size} bytes, over the 4 MiB Claude Code can read back. Make the canvas smaller (fewer nodes, or a smaller SVG width/height) and render again.` };
  }
  const { base64 } = await $.fs.read(plan.output, { as: "bytes" });
  return {
    result: [
      { type: "text", text: renderedText(spec.kind, "claude", plan.published) },
      { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
    ],
  };
}

async function runJob($: EngineInterface, job: RenderJob): Promise<Answer> {
  await $.fs.write(job.plan.input, job.source);
  const failure = await runRenderer($, job);
  if (failure !== undefined) return { deny: failure };
  job.created = true;
  const answer = await readPng($, job);
  job.delivered = "result" in answer;
  return answer;
}

/** CC has no fs.delete; remove only paths this call created. An EEXIST failure must not remove someone else's output. */
async function removeStaged($: EngineInterface, job: RenderJob): Promise<void> {
  const { plan } = job;
  const paths = [plan.input, ...(job.created && !(plan.published && job.delivered) ? [plan.output] : [])];
  const cleanup = await $.process.run(["rm", "-f", "--", ...paths]);
  if (cleanup.exitCode !== 0) throw new Error(`Could not remove temporary visual source/preview: ${stderrTail(cleanup.stderr)}`);
}

async function render($: EngineInterface, spec: VisualToolSpec, key: string, saveAs: string | undefined): Promise<Answer> {
  const source = store.read(key, spec.kind);
  const lock = await $.fs.read(`${$.plugin.root}/renderer/package-lock.json`);
  const env = { XDG_CACHE_HOME: await $.env.get("XDG_CACHE_HOME"), HOME: await $.env.get("HOME") };
  const { marker } = installPaths(lock, env);
  const installed = await $.fs.exists(marker);
  const plan = planRender({
    kind: spec.kind,
    saveAs,
    cwd: await $.session.cwd(),
    stagingDir: `${cacheRoot(env)}/previews`, // per-user, never a shared /tmp path; emptied after every render
    nowMs: await $.clock.now(),
    random: Math.random,
  });
  const job: RenderJob = { spec, plan, source, installed, created: false, delivered: false };
  let answer: Answer;
  try {
    answer = await runJob($, job);
  } catch (error) {
    await removeStaged($, job); // on success, failure and throw alike; a cleanup failure wins
    throw error;
  }
  await removeStaged($, job);
  return answer;
}

async function handle($: EngineInterface, e: ToolCallInput): Promise<Answer> {
  const spec = SPEC_BY_TOOL.get(e.tool);
  if (spec === undefined) return { deny: `visual-tools does not provide ${e.tool}.` };
  const key = e.agentId ?? "main";
  try {
    if (spec.op === "write") return { result: wroteText(spec.kind, store.write(key, spec.kind, argText(e, "source")), "claude") };
    if (spec.op === "edit") {
      return { result: editedText(spec.kind, store.edit(key, spec.kind, argText(e, "old_text"), argText(e, "new_text")), "claude") };
    }
    const saveAs: unknown = Reflect.get(e, "save_as");
    return await render($, spec, key, typeof saveAs === "string" ? saveAs : undefined);
  } catch (error) {
    return { deny: error instanceof Error ? error.message : String(error) };
  }
}

export function register(on: On): void {
  on("session.start", async ($, e, next) => {
    for (const spec of SPECS) await $.tool.register({ name: spec.id, description: spec.description, inputSchema: inputSchema(spec) });
    return next(e);
  });

  on("session.end", ($, e, next) => {
    store = new SourceStore("claude"); // clear, resume, branch (reason resume), and exit; no later session.start for transitions
    return next(e);
  });

  on(
    "tool.call",
    {
      tool: [
        "mcp__visual-tools__write_mermaid",
        "mcp__visual-tools__edit_mermaid",
        "mcp__visual-tools__render_mermaid",
        "mcp__visual-tools__write_svg",
        "mcp__visual-tools__edit_svg",
        "mcp__visual-tools__render_svg",
      ],
    },
    ($, e) => handle($, e),
  ).catch(($, e, next) => ({ deny: `visual-tools failed (${next.error.kind}): ${next.error.message ?? "no message"}` }));
}
