#!/usr/bin/env node
/**
 * issue-state.mjs — shared upstream-issue close-state predicate.
 *
 * Single source of truth for "this upstream issue was closed as unwanted"
 * (not-planned / wontfix / duplicate). Used by the cherry-pick severity
 * classifier (apply-context-upgrades Rule 5 → SKIP) and the Phase 6 supersession
 * sweep (supersession-check `upstream-closed` → status:superseded). Keeping one
 * copy means the two paths can never drift on what counts as a "don't port" close.
 *
 * Requires the issue context to carry `stateReason` — fetch it via
 * `gh issue view --json ...,stateReason` (see fetch-pr-context.mjs).
 */

/** Close reasons that signal "do not port" (GitHub stateReason values). */
export const UNWANTED_CLOSE_REASON_RE = /^(not.planned|wontfix|duplicate)/i;

/**
 * True if an issue context represents an issue CLOSED as not-planned/wontfix/
 * duplicate. Accepts either a fetch-pr-context wrapper (`{ data }`) or a raw
 * issue object, and tolerates nullish input (→ false).
 *
 * @param {{data?: object}|object|null|undefined} ctx
 * @returns {boolean}
 */
export function isClosedAsUnwanted(ctx) {
  const d = ctx?.data ?? ctx ?? {};
  return (d.state ?? "").toUpperCase() === "CLOSED" && UNWANTED_CLOSE_REASON_RE.test(d.stateReason ?? "");
}
