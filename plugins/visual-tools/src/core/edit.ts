/** Exact-match single replacement (pi/omp `edit` semantics) and a numbered window around it. Pure. */

export class EditError extends Error {}

/** Start offsets of every occurrence of `needle`, overlapping ones included ("aa" occurs twice in "aaa"). */
function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) found.push(i);
  return found;
}

/** Replace the one occurrence of `oldText`. Throws EditError naming the match count when it is not exactly one. */
export function applyEdit(current: string, oldText: string, newText: string): { updated: string; index: number } {
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

/** Lines around char offset `index`, numbered from 1. Port of _common.ts:124-134. */
export function snippetAround(content: string, index: number, contextLines = 3): string {
  const hitLine = content.slice(0, index).split("\n").length - 1;
  const lines = content.split("\n");
  const start = Math.max(0, hitLine - contextLines);
  const end = Math.min(lines.length - 1, hitLine + contextLines);
  const width = String(end + 1).length;
  const out: string[] = [];
  for (let i = start; i <= end; i++) out.push(`${String(i + 1).padStart(width)}  ${lines[i]}`);
  return out.join("\n");
}
