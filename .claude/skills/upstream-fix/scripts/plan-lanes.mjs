#!/usr/bin/env node
/**
 * plan-lanes.mjs — union-find on target files → file-disjoint lanes.
 * Pure: input selected records, output { lanes: [{ id, issues, files }] }.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SEV_ORDER = { "critical-stability": 0, "critical-security": 1, feature: 2, "nice-to-have-fix": 3 };

export function planLanes(records) {
  const recs = records.filter((r) => !r.needsTriage && (r.targetFiles ?? []).length > 0);

  // Union-find keyed by issue number string.
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  for (const r of recs) parent.set(String(r.number), String(r.number));

  // First issue seen per file; union subsequent issues touching that file.
  const fileOwner = new Map();
  for (const r of recs) {
    const num = String(r.number);
    for (const f of r.targetFiles) {
      if (fileOwner.has(f)) union(num, fileOwner.get(f));
      else fileOwner.set(f, num);
    }
  }

  // Group by root.
  const byRoot = new Map();
  for (const r of recs) {
    const root = find(String(r.number));
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(r);
  }

  // Stable lane ordering: by the smallest issue number in each component.
  const components = [...byRoot.values()].sort(
    (a, b) => Math.min(...a.map((r) => Number(r.number))) - Math.min(...b.map((r) => Number(r.number))),
  );

  const lanes = components.map((comp, idx) => {
    const issues = [...comp]
      .sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) || Number(a.number) - Number(b.number))
      .map((r) => String(r.number));
    const files = [...new Set(comp.flatMap((r) => r.targetFiles))];
    return { id: idx + 1, issues, files };
  });

  return { lanes };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const inPath = process.argv[2];
    const outPath = process.argv[3];
    if (!inPath) throw new Error("Usage: node plan-lanes.mjs <selected-issues.json> [lanes.json]");
    const records = JSON.parse(readFileSync(inPath, "utf-8"));
    const result = planLanes(records);
    if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n"); }
    process.stdout.write(JSON.stringify({ lanes: result.lanes.length, path: outPath ?? null }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
