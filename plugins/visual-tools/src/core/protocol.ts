/** The renderer CLI protocol: `node render.js --kind mermaid|svg --in <abs> --out <abs>`. Pure. */

export type Kind = "mermaid" | "svg";

/** @public Phase 4 renderer protocol contract. */
export interface RenderRequest {
  kind: Kind;
  /** Absolute path of the source file. */
  input: string;
  /** Absolute path of the PNG to create. Must not exist: the CLI creates it exclusively. */
  output: string;
}

/** Exit codes of render.js. Anything non-zero carries a human-readable stderr tail. */
const EXISTS_EXIT_CODE = 3;
const INSTALL_EXIT_CODE = 4;
/** @public Phase 4 renderer exit-code contract. */
export const EXIT = { ok: 0, render: 1, usage: 2, exists: EXISTS_EXIT_CODE, install: INSTALL_EXIT_CODE } as const;

/** @public Phase 4 renderer usage-error contract. */
export class UsageError extends Error {}

/** Full argv for the host's process runner: `[node, script, ...flags]`. */
/** @public Phase 4 renderer argv contract. */
export function renderArgv(node: string, script: string, req: RenderRequest): string[] {
  return [node, script, "--kind", req.kind, "--in", req.input, "--out", req.output];
}

const VALID_FLAGS: Record<string, true> = { "--kind": true, "--in": true, "--out": true };

function flagsFrom(args: readonly string[]): Map<string, string> {
  const seen = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === undefined || !Object.hasOwn(VALID_FLAGS, flag)) throw new UsageError(`unknown argument "${flag}"`);
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    if (seen.has(flag)) throw new UsageError(`${flag} given twice`);
    seen.set(flag, value);
  }
  return seen;
}

/** Inverse of the flag part of `renderArgv`. Throws UsageError naming the problem. */
/** @public Phase 4 renderer argument-parser contract. */
export function parseRenderArgs(args: readonly string[]): RenderRequest {
  const seen = flagsFrom(args);
  const kind = seen.get("--kind");
  const input = seen.get("--in");
  const output = seen.get("--out");
  if (kind === undefined || input === undefined || output === undefined) {
    throw new UsageError("usage: render.js --kind mermaid|svg --in <abs> --out <abs>");
  }
  if (kind !== "mermaid" && kind !== "svg") throw new UsageError(`--kind must be mermaid or svg, got "${kind}"`);
  for (const [flag, path] of [["--in", input], ["--out", output]] as const) {
    if (!path.startsWith("/")) throw new UsageError(`${flag} must be an absolute path, got "${path}"`);
  }
  if (!output.endsWith(".png")) throw new UsageError(`--out must end in .png, got "${output}"`);
  return { kind, input, output };
}

/** Last `lines` non-empty lines of a stderr stream: what the model sees on failure. */
/** @public Phase 4 renderer error-tail contract. */
export function stderrTail(stderr: string, lines = 30): string {
  const kept = stderr.split("\n").filter((l) => l.trim() !== "");
  return kept.length > 0 ? kept.slice(-lines).join("\n") : "unknown error (renderer wrote nothing to stderr)";
}
