#!/usr/bin/env node
/**
 * refute-panel.mjs — 4-lens panel that runs after the two-signal gate.
 * Pure: tallyVerdicts + formatRefuteComment. The subagent runner is wired
 * by callers (SKILL.md orchestration or merge-pr.mjs).
 */

export const LENS_NAMES = [
  "upstream-alignment",
  "scope-discipline",
  "test-quality",
  "blast-radius",
];

/**
 * Apply the voting rule: panel approves iff ≥2 non-abstain verdicts are
 * `approve` AND zero are `refute`. Otherwise refute (fail-safe).
 */
export function tallyVerdicts(verdicts) {
  const refutes = verdicts.filter((v) => v.verdict === "refute").length;
  const approves = verdicts.filter((v) => v.verdict === "approve").length;
  const abstains = verdicts.filter((v) => v.verdict === "abstain").length;
  const nonAbstain = approves + refutes;

  if (refutes > 0) {
    return { panelVerdict: "refute", approves, refutes, abstains, reason: `${refutes} lens(es) refuted` };
  }
  if (nonAbstain === 0) {
    return { panelVerdict: "refute", approves, refutes, abstains, reason: "no non-abstain verdicts (all errored or abstained)" };
  }
  if (approves < 2) {
    return { panelVerdict: "refute", approves, refutes, abstains, reason: `need ≥2 approve, got ${approves}` };
  }
  return { panelVerdict: "approve", approves, refutes, abstains, reason: `${approves} approve / ${abstains} abstain / 0 refute` };
}

/** Render the consolidated PR comment markdown when the panel refutes. */
export function formatRefuteComment(verdicts, { runId } = {}) {
  const lines = [];
  lines.push("🤖 Refute panel blocked auto-merge");
  lines.push("");
  lines.push("| Lens | Verdict | Reason |");
  lines.push("| --- | --- | --- |");
  for (const v of verdicts) {
    const reason = (v.reason ?? "").replace(/\|/g, "\\|");
    lines.push(`| ${v.lens} | ${v.verdict} | ${reason} |`);
  }
  lines.push("");
  lines.push("Labeling `status:needs-human`.");
  if (runId) lines.push(`Run id: ${runId}.`);
  return lines.join("\n");
}
