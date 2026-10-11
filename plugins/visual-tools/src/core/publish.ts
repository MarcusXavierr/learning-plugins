/** File names and paths of one render. Pure: time and randomness are injected. */
import type { Kind } from "./protocol.ts";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const MAX_SLUG = 60;
const SUFFIX_LENGTH = 6;

/** `viz-<slug>-<nowMs>-<6 random base36 chars>.png`; slug = lowercase [a-z0-9-], at most 60 chars, "viz" when empty. */
export function publishName(slug: string, nowMs: number, random: () => number): string {
  const slugified = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG)
    .replace(/^-+|-+$/g, "");
  const clean = slugified === "" ? "viz" : slugified;
  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) suffix += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return `viz-${clean}-${nowMs}-${suffix}.png`;
}

export interface RenderPlan {
  /** Where the adapter writes the current source before rendering. */
  input: string;
  /** `--out` for render.js. */
  output: string;
  /** Set when the render publishes into `<cwd>/viz/`. */
  published?: { filename: string; path: string };
}

export interface PlanInput {
  kind: Kind;
  /** The tool's `save_as`; absent or blank means preview only. */
  saveAs?: string | undefined;
  cwd: string;
  /** Absolute, private to the harness process: previews and staged sources live here, never in cwd. */
  stagingDir: string;
  nowMs: number;
  random: () => number;
}

export function planRender(p: PlanInput): RenderPlan {
  const saveAs = p.saveAs?.trim() ? p.saveAs : undefined;
  const name = publishName(saveAs ?? "preview", p.nowMs, p.random);
  const input = `${p.stagingDir}/${name.slice(0, -".png".length)}.${p.kind === "mermaid" ? "mmd" : "svg"}`;
  if (saveAs === undefined) return { input, output: `${p.stagingDir}/${name}` };
  const path = `${p.cwd.replace(/\/+$/, "")}/viz/${name}`;
  return { input, output: path, published: { filename: name, path } };
}
