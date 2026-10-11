// Runs knip and prints its report in the sensors "default" parser schema.
import { spawnSync } from "node:child_process";

const GUIDANCE = {
  "knip/exports": "Unused exports widen a module's interface. Remove the export (or the code). If it is a pinned contract in docs/plans (Shared contracts), keep it and mark it /** @public */ with the contract name.",
  "knip/types": "Unused exported types widen the interface the same way: un-export or delete them, unless a pinned contract needs them (then /** @public */).",
  "knip/files": "Nothing imports this file. Delete it, or wire it in if a later step needs it now.",
  "knip/duplicates": "The same value is exported under two names. Keep one.",
};
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const run = spawnSync(
  "npx",
  ["--no-install", "knip", "--config", ".sensors/maintainability/knip.json", "--include", "files,exports,nsExports,types,nsTypes,duplicates", "--reporter", "json"],
  { encoding: "utf8", maxBuffer: MAX_BUFFER_BYTES },
);
const text = (run.stdout ?? "").trim();
if (run.error || !text.startsWith("{")) {
  const reason = (run.stderr || String(run.error ?? "no JSON on stdout")).trim().split("\n")[0];
  process.stdout.write(JSON.stringify({ success: false, summary: `knip failed: ${reason}` }));
  process.exit(0);
}
const report = JSON.parse(text);
const RULES = { nsExports: "knip/exports", nsTypes: "knip/types" };
const findings = [];
for (const issue of report.issues ?? []) {
  for (const [kind, value] of Object.entries(issue)) {
    const items = Array.isArray(value) ? value.flat() : value && typeof value === "object" ? Object.values(value).flat(2) : [];
    for (const item of items) {
      if (!item || typeof item !== "object" || !("name" in item)) continue;
      const rule = RULES[kind] ?? `knip/${kind}`;
      const message = kind === "files" ? "Unused file" : `Unused ${kind}: ${item.name}`;
      findings.push({ file: issue.file, line: item.line ?? 0, column: item.col ?? 0, rule, severity: "error", message });
    }
  }
}
const rules = [...new Set(findings.map((f) => f.rule))];
process.stdout.write(JSON.stringify({ findings, guidance: rules.filter((r) => GUIDANCE[r]).map((rule) => ({ rule, body: GUIDANCE[rule] })) }));
