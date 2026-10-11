// plugins/visual-tools/src/omp.ts
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// plugins/visual-tools/src/core/install.ts
var INSTALL_TIMEOUT_MS = 6e5;
var RENDER_TIMEOUT_MS = 12e4;
var FNV64_OFFSET = 0xcbf29ce484222325n;
var FNV64_PRIME = 0x100000001b3n;
var MASK64 = 0xffffffffffffffffn;
var HASH_HEX_LENGTH = 16;
function lockHash(lockText) {
  let h = FNV64_OFFSET;
  for (let i = 0; i < lockText.length; i++) {
    h ^= BigInt(lockText.charCodeAt(i));
    h = h * FNV64_PRIME & MASK64;
  }
  return h.toString(HASH_HEX_LENGTH).padStart(HASH_HEX_LENGTH, "0");
}
function cacheRoot(env) {
  const xdg = env.XDG_CACHE_HOME;
  if (xdg !== void 0 && xdg.startsWith("/")) return `${xdg.replace(/\/+$/, "")}/learning-plugins/visual-tools`;
  const home = env.HOME;
  if (home === void 0 || !home.startsWith("/")) {
    throw new Error("Cannot locate a cache directory: set HOME or an absolute XDG_CACHE_HOME.");
  }
  return `${home.replace(/\/+$/, "")}/.cache/learning-plugins/visual-tools`;
}
function installPaths(lockText, env) {
  const hash = lockHash(lockText);
  const dir = `${cacheRoot(env)}/${hash}`;
  return { hash, dir, marker: `${dir}/.installed` };
}
function renderTimeoutMs(installed) {
  return installed ? RENDER_TIMEOUT_MS : INSTALL_TIMEOUT_MS;
}

// plugins/visual-tools/src/core/protocol.ts
var EXISTS_EXIT_CODE = 3;
var INSTALL_EXIT_CODE = 4;
var EXIT = { ok: 0, render: 1, usage: 2, exists: EXISTS_EXIT_CODE, install: INSTALL_EXIT_CODE };
function renderArgv(node, script, req) {
  return [node, script, "--kind", req.kind, "--in", req.input, "--out", req.output];
}
function stderrTail(stderr, lines = 30) {
  const kept = stderr.split("\n").filter((l) => l.trim() !== "");
  return kept.length > 0 ? kept.slice(-lines).join("\n") : "unknown error (renderer wrote nothing to stderr)";
}

// plugins/visual-tools/src/core/publish.ts
var ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
var MAX_SLUG = 60;
var SUFFIX_LENGTH = 6;
function publishName(slug, nowMs, random) {
  const slugified = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, MAX_SLUG).replace(/^-+|-+$/g, "");
  const clean = slugified === "" ? "viz" : slugified;
  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) suffix += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return `viz-${clean}-${nowMs}-${suffix}.png`;
}
function planRender(p) {
  const saveAs = p.saveAs?.trim() ? p.saveAs : void 0;
  const name = publishName(saveAs ?? "preview", p.nowMs, p.random);
  const input = `${p.stagingDir}/${name.slice(0, -".png".length)}.${p.kind === "mermaid" ? "mmd" : "svg"}`;
  if (saveAs === void 0) return { input, output: `${p.stagingDir}/${name}` };
  const path = `${p.cwd.replace(/\/+$/, "")}/viz/${name}`;
  return { input, output: path, published: { filename: name, path } };
}

// shared/tool-map.ts
var TOOLS = {
  quiz: { omp: "quiz", claude: "mcp__quiz__quiz" },
  ask: { omp: "ask", claude: "AskUserQuestion" },
  read: { omp: "read", claude: "Read" },
  web_search: { omp: "web_search", claude: "WebSearch" },
  web_fetch: { omp: "read", claude: "WebFetch" },
  write_mermaid: { omp: "write_mermaid", claude: "mcp__visual-tools__write_mermaid" },
  edit_mermaid: { omp: "edit_mermaid", claude: "mcp__visual-tools__edit_mermaid" },
  render_mermaid: { omp: "render_mermaid", claude: "mcp__visual-tools__render_mermaid" },
  write_svg: { omp: "write_svg", claude: "mcp__visual-tools__write_svg" },
  edit_svg: { omp: "edit_svg", claude: "mcp__visual-tools__edit_svg" },
  render_svg: { omp: "render_svg", claude: "mcp__visual-tools__render_svg" }
};
function lookup(map, kind, id, h) {
  const entry = Object.hasOwn(map, id) ? map[id] : void 0;
  if (entry === void 0) throw new Error(`unknown ${kind} id "${id}"`);
  return entry[h];
}
function toolName(id, h) {
  return lookup(TOOLS, "tool", id, h);
}

// plugins/visual-tools/src/core/edit.ts
var EditError = class extends Error {
};
function occurrences(haystack, needle) {
  const found = [];
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) found.push(i);
  return found;
}
function applyEdit(current, oldText, newText) {
  if (oldText === "") throw new EditError("`old_text` must be non-empty.");
  if (oldText === newText) throw new EditError("`old_text` and `new_text` are identical.");
  const hits = occurrences(current, oldText);
  if (hits.length !== 1) {
    const fix = hits.length === 0 ? "copy it exactly from the current source" : "add surrounding context to make it unique";
    throw new EditError(`\`old_text\` matches ${hits.length} times; it must match exactly once. Nothing changed: ${fix}.`);
  }
  const [index = -1] = hits;
  return { updated: current.slice(0, index) + newText + current.slice(index + oldText.length), index };
}
function snippetAround(content, index, contextLines = 3) {
  const hitLine = content.slice(0, index).split("\n").length - 1;
  const lines = content.split("\n");
  const start = Math.max(0, hitLine - contextLines);
  const end = Math.min(lines.length - 1, hitLine + contextLines);
  const width = String(end + 1).length;
  const out = [];
  for (let i = start; i <= end; i++) out.push(`${String(i + 1).padStart(width)}  ${lines[i]}`);
  return out.join("\n");
}

// plugins/visual-tools/src/core/sources.ts
var SourceError = class extends Error {
};
var SourceStore = class {
  #sources = /* @__PURE__ */ new Map();
  harness;
  constructor(harness) {
    this.harness = harness;
  }
  /** Replace the source; returns its line count. Leading/trailing whitespace is trimmed (as the original). */
  write(key, kind, source) {
    const text = source.trim();
    const tool = toolName(`write_${kind}`, this.harness);
    if (text === "") throw new SourceError(`${tool} requires a non-empty \`source\`.`);
    if (kind === "svg" && !text.includes("<svg")) throw new SourceError(`${tool}: source must be a complete <svg>…</svg> document.`);
    this.#sources.set(`${key}\0${kind}`, text);
    return text.split("\n").length;
  }
  read(key, kind) {
    const text = this.#sources.get(`${key}\0${kind}`);
    if (text === void 0) throw new SourceError(`No ${kind} source yet: call ${toolName(`write_${kind}`, this.harness)} first.`);
    return text;
  }
  /** Exact-once replacement; on any error the stored source is unchanged. Returns a numbered snippet of the edited region. */
  edit(key, kind, oldText, newText) {
    const { updated, index } = applyEdit(this.read(key, kind), oldText, newText);
    this.#sources.set(`${key}\0${kind}`, updated);
    return snippetAround(updated, index);
  }
};

// plugins/visual-tools/src/core/tools.ts
var NOUN = { mermaid: "Mermaid", svg: "SVG" };
var LOOK = {
  mermaid: "are arrows/relationships correct, labels right, nothing cramped?",
  svg: "are coordinates, angles, directions, and proportions correct? Labels clear and unclipped?"
};
var SLUG_EXAMPLE = { mermaid: "internet-packets", svg: "number-line" };
var SOURCE_SHAPE = {
  mermaid: "`source` is a complete Mermaid diagram, e.g. a `graph TD` / `graph LR` flow, `sequenceDiagram`, `stateDiagram-v2`, `erDiagram`, `classDiagram`, `mindmap`, or `timeline`.",
  svg: "`source` is a complete `<svg ...>…</svg>` document with an explicit width/height (or viewBox), readable font sizes, and a light or transparent background."
};
var SOURCE_PARAM = {
  mermaid: "The complete Mermaid diagram source (starts with the diagram type, e.g. `graph TD`).",
  svg: "The complete SVG document, from `<svg` to `</svg>`."
};
function writeSpec(kind, t) {
  return {
    id: `write_${kind}`,
    kind,
    op: "write",
    label: `Write ${t.noun}`,
    description: `Write the FULL ${t.noun} source to this session's managed file (your first draft or a complete rewrite). You do NOT name the file — ${t.edit} and ${t.render} act on the same one.

${SOURCE_SHAPE[kind]} Writing does NOT render — call ${t.render} when ready. For a small fix, prefer ${t.edit} over rewriting.`,
    params: [{ name: "source", optional: false, description: SOURCE_PARAM[kind] }]
  };
}
function editSpec(kind, t) {
  return {
    id: `edit_${kind}`,
    kind,
    op: "edit",
    label: `Edit ${t.noun}`,
    description: `Make a single exact-match replacement in this session's ${t.noun} source. \`old_text\` must appear EXACTLY ONCE (include surrounding context for uniqueness); on 0 or >1 matches the call fails and nothing changes. Call ${t.write} first. Editing does NOT render.`,
    params: [
      { name: "old_text", optional: false, description: "Exact substring of the current source to replace (must match once)." },
      { name: "new_text", optional: false, description: "Replacement text for `old_text`." }
    ]
  };
}
function renderSpec(kind, t) {
  return {
    id: `render_${kind}`,
    kind,
    op: "render",
    label: `Render ${t.noun}`,
    description: `Render the CURRENT session ${t.noun} source to a PNG and return it inline so you can SEE it and iterate. You do NOT pass the source here — it comes from the managed file; call ${t.write} first.

Iterate freely with no \`save_as\` (preview only). When the picture is correct and clean, call once more with \`save_as\` set to a short kebab-case topic slug: that publishes the PNG into <cwd>/viz with a unique filename and returns the filename to embed. On a render error this returns the error text instead of an image — fix with ${t.edit} and re-render. The first render on a machine installs the renderer (about a minute).`,
    params: [
      {
        name: "save_as",
        optional: true,
        description: `Short kebab-case topic slug (e.g. '${SLUG_EXAMPLE[kind]}'). When set, the rendered PNG is published to <cwd>/viz as viz-<slug>-<timestamp>-<suffix>.png and the filename is returned. Omit for a preview-only render.`
      }
    ]
  };
}
function toolSpecs(h) {
  return ["mermaid", "svg"].flatMap((kind) => {
    const t = {
      noun: NOUN[kind],
      write: toolName(`write_${kind}`, h),
      edit: toolName(`edit_${kind}`, h),
      render: toolName(`render_${kind}`, h)
    };
    return [writeSpec(kind, t), editSpec(kind, t), renderSpec(kind, t)];
  });
}
function inputSchema(spec) {
  return {
    type: "object",
    properties: Object.fromEntries(spec.params.map((p) => [p.name, { type: "string", description: p.description }])),
    required: spec.params.filter((p) => !p.optional).map((p) => p.name),
    additionalProperties: false
  };
}
function wroteText(kind, lines, h) {
  return `Wrote ${lines}-line ${NOUN[kind]} source.
Call ${toolName(`render_${kind}`, h)} to render it, or ${toolName(`edit_${kind}`, h)} to tweak it.`;
}
function editedText(kind, snippet, h) {
  return `Applied edit. Updated region:
\`\`\`
${snippet}
\`\`\`
Call ${toolName(`render_${kind}`, h)} to see it.`;
}
function renderedText(kind, h, published) {
  if (published) {
    return `Published to viz/.
filename: ${published.filename}
path: ${published.path}

LOOK at the image below to confirm it is correct before returning it.`;
  }
  return `Preview render (not yet saved). LOOK: ${LOOK[kind]} Fix with ${toolName(`edit_${kind}`, h)}, or re-render with \`save_as\` to publish.`;
}
function renderFailedText(kind, detail, h) {
  return `${NOUN[kind]} render FAILED — no image produced. If the error is in your source, fix it with ${toolName(`edit_${kind}`, h)} and call ${toolName(`render_${kind}`, h)} again.

Error:
${detail}`;
}

// plugins/visual-tools/src/omp.ts
var KEY = "main";
function registerVisualTools(pi, deps) {
  const store = new SourceStore("omp");
  async function render(kind, saveAs, signal, ctx) {
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
        return { content: [{ type: "text", text: renderFailedText(kind, stderrTail(run.stderr), "omp") }], details: void 0, isError: true };
      }
      const data = readFileSync(plan.output).toString("base64");
      return {
        content: [
          { type: "text", text: renderedText(kind, "omp", plan.published) },
          { type: "image", data, mimeType: "image/png" }
        ],
        details: { path: plan.published?.path, filename: plan.published?.filename }
      };
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
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
        const p = params;
        if (spec.op === "write") {
          const lines = store.write(KEY, spec.kind, String(p.source ?? ""));
          return { content: [{ type: "text", text: wroteText(spec.kind, lines, "omp") }], details: void 0 };
        }
        if (spec.op === "edit") {
          const snippet = store.edit(KEY, spec.kind, String(p.old_text ?? ""), String(p.new_text ?? ""));
          return { content: [{ type: "text", text: editedText(spec.kind, snippet, "omp") }], details: void 0 };
        }
        return render(spec.kind, p.save_as, signal, ctx);
      }
    });
  }
}
var MAX_STDERR_BYTES = 16 * 1024 * 1024;
var MS_PER_SECOND = 1e3;
function runNode(argv, timeoutMs, signal) {
  const { promise, resolve } = Promise.withResolvers();
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
function visualTools(pi) {
  registerVisualTools(pi, {
    // extension.js sits at the plugin root, next to renderer/ (dist/omp/visual-tools/{extension.js,renderer/}).
    rendererScript: join(dirname(fileURLToPath(import.meta.url)), "renderer", "render.js"),
    runRenderer: runNode,
    now: Date.now,
    random: Math.random
  });
}
export {
  visualTools as default,
  registerVisualTools
};
