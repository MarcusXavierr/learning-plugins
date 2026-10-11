/**
 * visual-tools for omp: write_/edit_/render_ × mermaid/svg.
 *
 * Registered with plain `pi.registerTool` and `hidden: true`: hidden tools are left out of a session unless
 * its `--tools` list or its agent's `tools:` frontmatter names them (ToolDefinition.hidden,
 * extensibility/extensions/types.d.ts:429-430; sdk.ts:4051), which reproduces the original's
 * "maker subagents only" exposure without the interactive-subagents bridge. `loadMode: "essential"` keeps
 * them top-level tools instead of `xd://` devices (types.d.ts:434) wherever they are enabled.
 *
 * omp binds this factory once per session, subagents included, inside ONE process
 * (sdk.ts:2203-2205 "re-bind their factories to THIS session's ExtensionAPI"), so all state lives in the
 * factory closure, never at module level.
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installPaths, renderTimeoutMs } from "./core/install.ts";
import { EXIT, renderArgv, stderrTail, type Kind } from "./core/protocol.ts";
import { planRender } from "./core/publish.ts";
import { SourceStore } from "./core/sources.ts";
import { editedText, inputSchema, renderedText, renderFailedText, toolSpecs, wroteText } from "./core/tools.ts";

export interface RendererRun {
  /** null when the process could not start or was killed. */
  exitCode: number | null;
  stderr: string;
}

export interface OmpDeps {
  /** Absolute path of renderer/render.js; renderer/package-lock.json sits beside it. */
  rendererScript: string;
  /** Runs argv (argv[0] = "node") and resolves once it exits; the test seam for the OS process boundary. */
  runRenderer: (argv: string[], timeoutMs: number, signal: AbortSignal | undefined) => Promise<RendererRun>;
  now: () => number;
  random: () => number;
}

const KEY = "main"; // one store per session (see header), so one key

export function registerVisualTools(pi: ExtensionAPI, deps: OmpDeps): void {
  const store = new SourceStore("omp");

  async function render(kind: Kind, saveAs: string | undefined, signal: AbortSignal | undefined, ctx: ExtensionContext) {
    const source = store.read(KEY, kind);
    const stagingDir = mkdtempSync(join(tmpdir(), "visual-tools-"));
    try {
      const plan = planRender({ kind, saveAs, cwd: ctx.cwd, stagingDir, nowMs: deps.now(), random: deps.random });
      writeFileSync(plan.input, source, "utf8");
      const lock = readFileSync(join(dirname(deps.rendererScript), "package-lock.json"), "utf8");
      const { marker } = installPaths(lock, process.env);
      const argv = renderArgv("node", deps.rendererScript, { kind, input: plan.input, output: plan.output });
      const run = await deps.runRenderer(argv, renderTimeoutMs(existsSync(marker)), signal);
      if (run.exitCode !== EXIT.ok || !existsSync(plan.output)) {
        return { content: [{ type: "text" as const, text: renderFailedText(kind, stderrTail(run.stderr), "omp") }], details: undefined, isError: true };
      }
      const data = readFileSync(plan.output).toString("base64");
      return {
        content: [
          { type: "text" as const, text: renderedText(kind, "omp", plan.published) },
          { type: "image" as const, data, mimeType: "image/png" },
        ],
        details: { path: plan.published?.path, filename: plan.published?.filename },
      };
    } finally {
      rmSync(stagingDir, { recursive: true, force: true }); // source and preview, even on render failure/abort
    }
  }

  for (const spec of toolSpecs("omp")) {
    pi.registerTool({
      name: spec.id,
      label: spec.label,
      description: spec.description,
      // A plain JSON Schema is a valid TSchema (pi-ai types.d.ts:1089-1100); params arrive untyped.
      parameters: inputSchema(spec),
      hidden: true,
      loadMode: "essential",
      // write_/edit_ only change in-memory state; render_ creates files and runs the fixed renderer.
      approval: spec.op === "render" ? "write" : "read",
      async execute(_id, params, signal, _onUpdate, ctx) {
        const p = params as Partial<Record<"source" | "old_text" | "new_text" | "save_as", string>>;
        if (spec.op === "write") {
          const lines = store.write(KEY, spec.kind, String(p.source ?? ""));
          return { content: [{ type: "text", text: wroteText(spec.kind, lines, "omp") }], details: undefined };
        }
        if (spec.op === "edit") {
          const snippet = store.edit(KEY, spec.kind, String(p.old_text ?? ""), String(p.new_text ?? ""));
          return { content: [{ type: "text", text: editedText(spec.kind, snippet, "omp") }], details: undefined };
        }
        return render(spec.kind, p.save_as, signal, ctx);
      },
    });
  }
}

/** Output buffer for render.js, which reports errors on stderr and never uses stdout. */
const MAX_STDERR_BYTES = 16 * 1024 * 1024;
const MS_PER_SECOND = 1000;

function runNode(argv: string[], timeoutMs: number, signal: AbortSignal | undefined): Promise<RendererRun> {
  const { promise, resolve } = Promise.withResolvers<RendererRun>();
  const [command = "node", ...args] = argv;
  execFile(command, args, { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: MAX_STDERR_BYTES, signal }, (failure, _stdout, stderr) => {
    if (!failure) return resolve({ exitCode: 0, stderr });
    const exitCode = typeof failure.code === "number" ? failure.code : null;
    let why = "";
    if (failure.killed) why = `renderer stopped after ${timeoutMs / MS_PER_SECOND}s (timeout or abort)`;
    else if (exitCode === null) why = failure.message;
    resolve({ exitCode, stderr: [stderr, why].filter(Boolean).join("\n") });
  });
  return promise;
}

export default function visualTools(pi: ExtensionAPI): void {
  registerVisualTools(pi, {
    // extension.js sits at the plugin root, next to renderer/ (dist/omp/visual-tools/{extension.js,renderer/}).
    rendererScript: join(dirname(fileURLToPath(import.meta.url)), "renderer", "render.js"),
    runRenderer: runNode,
    now: Date.now,
    random: Math.random,
  });
}
