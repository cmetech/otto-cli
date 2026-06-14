#!/usr/bin/env node
/**
 * alignment.mjs — canonical OTTO-ALIGNMENT fit-check taxonomy.
 *
 * Phase 6 of the upstream pipeline. A NEW FEATURE candidate from a lineage repo
 * is classified against docs/OTTO-ALIGNMENT.md §5 as one of three verdicts. The
 * verdict itself is AGENT-JUDGED (genuine reading of the alignment doc, like
 * guidance authoring) — this module is the single source of truth for the
 * taxonomy, its label mapping, the guidance-line parser, and the feature gate.
 * Imported by cherry-pick (parse-guidance, build-issue-payload, run-audit) and,
 * later, the swarm — never re-declare these constants elsewhere.
 *
 * Bug/stability/security/perf/correctness/dependency fixes are ALWAYS ported —
 * alignment is N/A for them (see isFeatureSeverity gate).
 */

/** The three alignment verdicts, in canonical order. */
export const ALIGNMENT_VERDICTS = ["core", "adjacent", "out-of-scope"];

/** Namespaced GitHub labels, one per verdict. */
export const ALIGNMENT_LABELS = ALIGNMENT_VERDICTS.map((v) => `alignment:${v}`);

/** @returns {boolean} whether `v` is one of the three canonical verdicts. */
export function isAlignmentVerdict(v) {
  return ALIGNMENT_VERDICTS.includes(v);
}

/** @returns {string|null} `alignment:<v>` label, or null if `v` is invalid. */
export function alignmentToLabel(v) {
  return isAlignmentVerdict(v) ? `alignment:${v}` : null;
}

/**
 * Extract the verdict from an issue's labels.
 * @param {Array<string|{name:string}>} labels
 * @returns {string|null}
 */
export function alignmentFromLabels(labels = []) {
  for (const l of labels) {
    const name = typeof l === "string" ? l : l?.name;
    if (name && name.startsWith("alignment:")) {
      const v = name.slice("alignment:".length);
      if (isAlignmentVerdict(v)) return v;
    }
  }
  return null;
}

/**
 * Parse the machine-readable alignment verdict from a guidance file's optional
 * Alignment section. Matches an `alignment: <core|adjacent|out-of-scope>` line
 * anywhere (backticks ok), case-insensitive.
 * @param {string|null} text
 * @returns {{alignment: string|null}}
 */
export function parseAlignment(text) {
  if (!text) return { alignment: null };
  const m = text.match(/^\s*alignment:\s*`?(core|adjacent|out-of-scope)`?/im);
  if (m && isAlignmentVerdict(m[1].toLowerCase())) {
    return { alignment: m[1].toLowerCase() };
  }
  return { alignment: null };
}

/**
 * The feature gate: alignment applies ONLY to feature-severity candidates.
 * @param {string} severity - the classifier severity (e.g. "FEATURE")
 * @returns {boolean}
 */
export function isFeatureSeverity(severity) {
  return typeof severity === "string" && severity.toUpperCase() === "FEATURE";
}
