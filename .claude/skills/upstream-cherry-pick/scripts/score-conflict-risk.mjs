#!/usr/bin/env node
/**
 * score-conflict-risk.mjs — per §10 of the spec.
 *
 * Inputs:
 *   commit: { touchedFiles: string[], locByFile: { [path]: number } }
 *   ledger: { heavyFiles: Set<string>, heavyPackages: Set<string> }
 *
 * Output: { risk: NONE|LOW|MEDIUM|HIGH, reason: string }
 */

const LOC_HIGH_THRESHOLD = 50;

export function scoreConflictRisk(commit, ledger) {
  const files = commit.touchedFiles ?? [];
  const loc = commit.locByFile ?? {};

  const inPiPackage = files.some((f) =>
    [...ledger.heavyPackages].some((pkg) => f.startsWith(pkg + "/")) ||
    f.startsWith("packages/pi-"),
  );
  if (!inPiPackage) {
    return { risk: "NONE", reason: "No touched file under any vendored packages/pi-* path." };
  }

  const heavyTouched = files.filter((f) => ledger.heavyFiles.has(f));
  if (heavyTouched.length === 0) {
    return {
      risk: "LOW",
      reason: "Touches packages/pi-* but no specific OTTO-edited (HeavyFile) entry.",
    };
  }

  const highLocFile = heavyTouched.find((f) => (loc[f] ?? 0) > LOC_HIGH_THRESHOLD);
  if (highLocFile) {
    return {
      risk: "HIGH",
      reason: `Touches HeavyFile ${highLocFile} with >${LOC_HIGH_THRESHOLD} LOC; manual port likely required.`,
    };
  }
  return {
    risk: "MEDIUM",
    reason: `Touches HeavyFile(s): ${heavyTouched.join(", ")}. Hand-review required.`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let stdin = "";
  process.stdin.on("data", (c) => (stdin += c));
  process.stdin.on("end", () => {
    try {
      const { commit, ledger } = JSON.parse(stdin);
      const compiled = {
        heavyFiles: new Set(ledger.heavyFiles ?? []),
        heavyPackages: new Set(ledger.heavyPackages ?? []),
      };
      process.stdout.write(JSON.stringify(scoreConflictRisk(commit, compiled)) + "\n");
    } catch (err) {
      process.stderr.write(JSON.stringify({ error: err.message }) + "\n");
      process.exit(1);
    }
  });
}
