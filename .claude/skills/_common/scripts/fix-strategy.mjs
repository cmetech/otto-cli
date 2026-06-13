#!/usr/bin/env node
/**
 * fix-strategy.mjs — canonical fork-divergence-aware fix-strategy taxonomy.
 *
 * otto-cli is a HARD FORK, not a mirror. An upstream fix is ported in one of
 * four modes; this module is the single source of truth for the taxonomy, its
 * label/type mappings, and the guidance-line parser. Imported by cherry-pick
 * (parse-guidance, build-issue-payload, ensure-labels), and by merge/swarm
 * (refute panel) — never re-declare these constants elsewhere.
 */

/** The four fork-divergence-aware port strategies, in canonical order. */
export const FIX_STRATEGIES = [
  "direct-merge",        // cherry-pick / git am -3 applies clean
  "adapted-port",        // same fix, transcribed to our renamed/restructured paths
  "essence-reimplement", // diverged in behavior; re-solve the upstream root cause
  "not-needed",          // problem does not exist in our fork
];

/** Namespaced GitHub labels, one per strategy. */
export const STRATEGY_LABELS = FIX_STRATEGIES.map((s) => `fix-strategy:${s}`);

/** Legacy 3-way verdict → strategy (back-compat for pre-Phase-2 guidance). */
export const VERDICT_TO_STRATEGY = {
  "cherry-pick": "direct-merge",
  "manual-port": "adapted-port",
  "do-not-port": "not-needed",
};

/** Strategy → existing type:* label, preserving routing back-compat. */
const STRATEGY_TO_TYPE_LABEL = {
  "direct-merge": "type:cherry-pick-candidate",
  "adapted-port": "type:port-required",
  "essence-reimplement": "type:port-required",
  "not-needed": "type:do-not-port",
};

/** @returns {boolean} whether `v` is one of the four canonical strategies. */
export function isFixStrategy(v) {
  return FIX_STRATEGIES.includes(v);
}

/** @returns {string|null} `fix-strategy:<v>` label, or null if `v` is invalid. */
export function strategyToLabel(v) {
  return isFixStrategy(v) ? `fix-strategy:${v}` : null;
}

/** @returns {string|null} the type:* label for routing back-compat, or null. */
export function strategyToTypeLabel(v) {
  return STRATEGY_TO_TYPE_LABEL[v] ?? null;
}

/**
 * Extract the strategy from an issue's labels.
 * @param {Array<string|{name:string}>} labels
 * @returns {string|null}
 */
export function strategyFromLabels(labels = []) {
  for (const l of labels) {
    const name = typeof l === "string" ? l : l?.name;
    if (name && name.startsWith("fix-strategy:")) {
      const v = name.slice("fix-strategy:".length);
      if (isFixStrategy(v)) return v;
    }
  }
  return null;
}

/**
 * Parse the machine-readable strategy from a guidance file.
 * New format: the first non-empty line is `strategy: <value>` (backticks ok).
 * Legacy (grandfathered): a `verdict: <cherry-pick|manual-port|do-not-port>`
 * token anywhere → mapped via VERDICT_TO_STRATEGY.
 *
 * @returns {{strategy: string|null, source: "strategy"|"verdict"|null}}
 */
export function parseStrategy(text) {
  if (!text) return { strategy: null, source: null };
  const firstLine = text.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? "";
  const sm = firstLine.match(/^strategy:\s*`?([a-z-]+)`?/i);
  if (sm && isFixStrategy(sm[1].toLowerCase())) {
    return { strategy: sm[1].toLowerCase(), source: "strategy" };
  }
  const vm = text.match(/verdict:\s*`?(cherry-pick|manual-port|do-not-port)`?/i);
  if (vm) return { strategy: VERDICT_TO_STRATEGY[vm[1].toLowerCase()], source: "verdict" };
  return { strategy: null, source: null };
}
