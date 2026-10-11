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

// plugins/visual-tools/src/claude.ts
var SPECS = toolSpecs("claude");
var SPEC_BY_TOOL = new Map(SPECS.map((s) => [toolName(s.id, "claude"), s]));
var store = new SourceStore("claude");
var MAX_PNG_BYTES = 4 * 1024 * 1024;
var MS_PER_SECOND = 1e3;
function argText(e, name) {
  return String(Reflect.get(e, name) ?? "");
}
async function runRenderer($, job) {
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
  return run.exitCode === 0 ? void 0 : renderFailedText(spec.kind, stderrTail(run.stderr), "claude");
}
async function readPng($, job) {
  const { spec, plan } = job;
  const { size } = await $.fs.stat(plan.output);
  if (size > MAX_PNG_BYTES) {
    return { deny: `The PNG at ${plan.output} is ${size} bytes, over the 4 MiB Claude Code can read back. Make the canvas smaller (fewer nodes, or a smaller SVG width/height) and render again.` };
  }
  const { base64 } = await $.fs.read(plan.output, { as: "bytes" });
  return {
    result: [
      { type: "text", text: renderedText(spec.kind, "claude", plan.published) },
      { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } }
    ]
  };
}
async function runJob($, job) {
  await $.fs.write(job.plan.input, job.source);
  const failure = await runRenderer($, job);
  if (failure !== void 0) return { deny: failure };
  job.created = true;
  const answer = await readPng($, job);
  job.delivered = "result" in answer;
  return answer;
}
async function removeStaged($, job) {
  const { plan } = job;
  const paths = [plan.input, ...job.created && !(plan.published && job.delivered) ? [plan.output] : []];
  const cleanup = await $.process.run(["rm", "-f", "--", ...paths]);
  if (cleanup.exitCode !== 0) throw new Error(`Could not remove temporary visual source/preview: ${stderrTail(cleanup.stderr)}`);
}
async function render($, spec, key, saveAs) {
  const source = store.read(key, spec.kind);
  const lock = await $.fs.read(`${$.plugin.root}/renderer/package-lock.json`);
  const env = { XDG_CACHE_HOME: await $.env.get("XDG_CACHE_HOME"), HOME: await $.env.get("HOME") };
  const { marker } = installPaths(lock, env);
  const installed = await $.fs.exists(marker);
  const plan = planRender({
    kind: spec.kind,
    saveAs,
    cwd: await $.session.cwd(),
    stagingDir: `${cacheRoot(env)}/previews`,
    // per-user, never a shared /tmp path; emptied after every render
    nowMs: await $.clock.now(),
    random: Math.random
  });
  const job = { spec, plan, source, installed, created: false, delivered: false };
  let answer;
  try {
    answer = await runJob($, job);
  } catch (error) {
    await removeStaged($, job);
    throw error;
  }
  await removeStaged($, job);
  return answer;
}
async function handle($, e) {
  const spec = SPEC_BY_TOOL.get(e.tool);
  if (spec === void 0) return { deny: `visual-tools does not provide ${e.tool}.` };
  const key = e.agentId ?? "main";
  try {
    if (spec.op === "write") return { result: wroteText(spec.kind, store.write(key, spec.kind, argText(e, "source")), "claude") };
    if (spec.op === "edit") {
      return { result: editedText(spec.kind, store.edit(key, spec.kind, argText(e, "old_text"), argText(e, "new_text")), "claude") };
    }
    const saveAs = Reflect.get(e, "save_as");
    return await render($, spec, key, typeof saveAs === "string" ? saveAs : void 0);
  } catch (error) {
    return { deny: error instanceof Error ? error.message : String(error) };
  }
}
function register(on) {
  on("session.start", async ($, e, next) => {
    for (const spec of SPECS) await $.tool.register({ name: spec.id, description: spec.description, inputSchema: inputSchema(spec) });
    return next(e);
  });
  on("session.end", ($, e, next) => {
    store = new SourceStore("claude");
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
        "mcp__visual-tools__render_svg"
      ]
    },
    ($, e) => handle($, e)
  ).catch(($, e, next) => ({ deny: `visual-tools failed (${next.error.kind}): ${next.error.message ?? "no message"}` }));
}
export {
  register
};
