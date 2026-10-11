/** The managed Mermaid / SVG source of each agent loop. Pure, in memory. */
import { toolName, type Harness } from "../../../../shared/tool-map.ts";
import { applyEdit, snippetAround } from "./edit.ts";
import type { Kind } from "./protocol.ts";

export class SourceError extends Error {}

/**
 * One source per (key, kind). omp creates one store per session, key "main"; CC shares one store across
 * loops, key = `agentId ?? "main"`. Every method is synchronous, so a read-modify-write can never
 * interleave with another call on the same key: per-key serialization holds by construction.
 */
export class SourceStore {
  readonly #sources = new Map<string, string>();

  readonly harness: Harness;
  constructor(harness: Harness) {
    this.harness = harness;
  }

  /** Replace the source; returns its line count. Leading/trailing whitespace is trimmed (as the original). */
  write(key: string, kind: Kind, source: string): number {
    const text = source.trim();
    const tool = toolName(`write_${kind}`, this.harness);
    if (text === "") throw new SourceError(`${tool} requires a non-empty \`source\`.`);
    if (kind === "svg" && !text.includes("<svg")) throw new SourceError(`${tool}: source must be a complete <svg>…</svg> document.`);
    this.#sources.set(`${key}\u0000${kind}`, text);
    return text.split("\n").length;
  }

  read(key: string, kind: Kind): string {
    const text = this.#sources.get(`${key}\u0000${kind}`);
    if (text === undefined) throw new SourceError(`No ${kind} source yet: call ${toolName(`write_${kind}`, this.harness)} first.`);
    return text;
  }

  /** Exact-once replacement; on any error the stored source is unchanged. Returns a numbered snippet of the edited region. */
  edit(key: string, kind: Kind, oldText: string, newText: string): string {
    const { updated, index } = applyEdit(this.read(key, kind), oldText, newText);
    this.#sources.set(`${key}\u0000${kind}`, updated);
    return snippetAround(updated, index);
  }
}
