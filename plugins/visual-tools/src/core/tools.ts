/** The six tools as both harnesses expose them, and the text of their results. Pure. */
import { toolName, type Harness } from "../../../../shared/tool-map.ts";
import type { Kind } from "./protocol.ts";

type Op = "write" | "edit" | "render";

interface ParamSpec {
  name: "source" | "old_text" | "new_text" | "save_as";
  description: string;
  optional: boolean;
}

export interface VisualToolSpec {
  /** Abstract id in shared/tool-map.ts, e.g. "render_svg"; also the omp tool name and the CC short name. */
  id: `${Op}_${Kind}`;
  kind: Kind;
  op: Op;
  label: string;
  description: string;
  params: ParamSpec[];
}

const NOUN: Record<Kind, string> = { mermaid: "Mermaid", svg: "SVG" };
const LOOK: Record<Kind, string> = {
  mermaid: "are arrows/relationships correct, labels right, nothing cramped?",
  svg: "are coordinates, angles, directions, and proportions correct? Labels clear and unclipped?",
};
const SLUG_EXAMPLE: Record<Kind, string> = { mermaid: "internet-packets", svg: "number-line" };
const SOURCE_SHAPE: Record<Kind, string> = {
  mermaid:
    "`source` is a complete Mermaid diagram, e.g. a `graph TD` / `graph LR` flow, `sequenceDiagram`, `stateDiagram-v2`, `erDiagram`, `classDiagram`, `mindmap`, or `timeline`.",
  svg: "`source` is a complete `<svg ...>…</svg>` document with an explicit width/height (or viewBox), readable font sizes, and a light or transparent background.",
};
const SOURCE_PARAM: Record<Kind, string> = {
  mermaid: "The complete Mermaid diagram source (starts with the diagram type, e.g. `graph TD`).",
  svg: "The complete SVG document, from `<svg` to `</svg>`.",
};

/** One kind's display noun and its three tool names in one harness. */
interface Names {
  noun: string;
  write: string;
  edit: string;
  render: string;
}

function writeSpec(kind: Kind, t: Names): VisualToolSpec {
  return {
    id: `write_${kind}`,
    kind,
    op: "write",
    label: `Write ${t.noun}`,
    description:
      `Write the FULL ${t.noun} source to this session's managed file (your first draft or a complete rewrite). ` +
      `You do NOT name the file — ${t.edit} and ${t.render} act on the same one.\n\n${SOURCE_SHAPE[kind]} ` +
      `Writing does NOT render — call ${t.render} when ready. For a small fix, prefer ${t.edit} over rewriting.`,
    params: [{ name: "source", optional: false, description: SOURCE_PARAM[kind] }],
  };
}

function editSpec(kind: Kind, t: Names): VisualToolSpec {
  return {
    id: `edit_${kind}`,
    kind,
    op: "edit",
    label: `Edit ${t.noun}`,
    description:
      `Make a single exact-match replacement in this session's ${t.noun} source. ` +
      "`old_text` must appear EXACTLY ONCE (include surrounding context for uniqueness); on 0 or >1 matches the call fails and nothing changes. " +
      `Call ${t.write} first. Editing does NOT render.`,
    params: [
      { name: "old_text", optional: false, description: "Exact substring of the current source to replace (must match once)." },
      { name: "new_text", optional: false, description: "Replacement text for `old_text`." },
    ],
  };
}

function renderSpec(kind: Kind, t: Names): VisualToolSpec {
  return {
    id: `render_${kind}`,
    kind,
    op: "render",
    label: `Render ${t.noun}`,
    description:
      `Render the CURRENT session ${t.noun} source to a PNG and return it inline so you can SEE it and iterate. ` +
      `You do NOT pass the source here — it comes from the managed file; call ${t.write} first.\n\n` +
      "Iterate freely with no `save_as` (preview only). When the picture is correct and clean, call once more with `save_as` " +
      "set to a short kebab-case topic slug: that publishes the PNG into <cwd>/viz with a unique filename and returns the filename to embed. " +
      `On a render error this returns the error text instead of an image — fix with ${t.edit} and re-render. ` +
      "The first render on a machine installs the renderer (about a minute).",
    params: [
      {
        name: "save_as",
        optional: true,
        description:
          `Short kebab-case topic slug (e.g. '${SLUG_EXAMPLE[kind]}'). When set, the rendered PNG is published to ` +
          "<cwd>/viz as viz-<slug>-<timestamp>-<suffix>.png and the filename is returned. Omit for a preview-only render.",
      },
    ],
  };
}

/** Ported from mermaid_tools.ts:52-160 and svg_tools.ts:63-150, with tool names resolved per harness. */
export function toolSpecs(h: Harness): VisualToolSpec[] {
  return (["mermaid", "svg"] as const).flatMap((kind) => {
    const t: Names = {
      noun: NOUN[kind],
      write: toolName(`write_${kind}`, h),
      edit: toolName(`edit_${kind}`, h),
      render: toolName(`render_${kind}`, h),
    };
    return [writeSpec(kind, t), editSpec(kind, t), renderSpec(kind, t)];
  });
}

/** JSON Schema for omp's `parameters` and CC's `inputSchema`: every parameter is a string. */
// eslint-disable-next-line llm-core/no-unsafe-dictionary-type -- JSON Schema is a heterogeneous dictionary consumed by both host SDKs
export function inputSchema(spec: VisualToolSpec): Record<string, unknown> {
  return {
    type: "object",
    properties: Object.fromEntries(spec.params.map((p) => [p.name, { type: "string", description: p.description }])),
    required: spec.params.filter((p) => !p.optional).map((p) => p.name),
    additionalProperties: false,
  };
}

export function wroteText(kind: Kind, lines: number, h: Harness): string {
  return `Wrote ${lines}-line ${NOUN[kind]} source.\nCall ${toolName(`render_${kind}`, h)} to render it, or ${toolName(`edit_${kind}`, h)} to tweak it.`;
}

export function editedText(kind: Kind, snippet: string, h: Harness): string {
  return `Applied edit. Updated region:\n\`\`\`\n${snippet}\n\`\`\`\nCall ${toolName(`render_${kind}`, h)} to see it.`;
}

export function renderedText(kind: Kind, h: Harness, published?: { filename: string; path: string }): string {
  if (published) {
    return `Published to viz/.\nfilename: ${published.filename}\npath: ${published.path}\n\nLOOK at the image below to confirm it is correct before returning it.`;
  }
  return `Preview render (not yet saved). LOOK: ${LOOK[kind]} Fix with ${toolName(`edit_${kind}`, h)}, or re-render with \`save_as\` to publish.`;
}

export function renderFailedText(kind: Kind, detail: string, h: Harness): string {
  return `${NOUN[kind]} render FAILED — no image produced. If the error is in your source, fix it with ${toolName(`edit_${kind}`, h)} and call ${toolName(`render_${kind}`, h)} again.\n\nError:\n${detail}`;
}
