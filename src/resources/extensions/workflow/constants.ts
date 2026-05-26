/**
 * Workflow Extension — Shared Constants
 *
 * Centralized timeout and cache-size constants used across the workflow extension.
 */

// ─── Timeouts ─────────────────────────────────────────────────────────────────

/** Default timeout for verification-gate commands (ms). */
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;

/** Default timeout for the dynamic bash tool (seconds). */
export const DEFAULT_BASH_TIMEOUT_SECS = 120;

// ─── Cache Sizes ──────────────────────────────────────────────────────────────

/** Max directory-listing cache entries before eviction (#611). */
export const DIR_CACHE_MAX = 200;

/** Max parse-cache entries before eviction. */
export const CACHE_MAX = 50;

// ─── Tool Scoping ─────────────────────────────────────────────────────────────

/**
 * workflow tools allowed during discuss flows (#2949).
 *
 * xAI/Grok (and potentially other providers with grammar-based constrained
 * decoding) return "Grammar is too complex" (HTTP 400) when the combined
 * tool schemas exceed their internal grammar limit. The full workflow tool set
 * registers ~33 tools with deeply nested schemas; discuss flows only need
 * a small subset.
 *
 * By scoping tools to this allowlist during discuss dispatches, the grammar
 * sent to the provider stays well under provider limits.
 *
 * Included tools and why:
 *   - otto_summary_save: writes CONTEXT.md artifacts (all discuss prompts)
 *   - otto_save_summary: alias for above
 *   - otto_decision_save: records decisions (discuss.md output phase)
 *   - otto_save_decision: alias for above
 *   - otto_plan_milestone: writes roadmap (discuss.md single/multi milestone)
 *   - otto_milestone_plan: alias for above
 *   - otto_milestone_generate_id: generates milestone IDs (discuss.md multi-milestone)
 *   - otto_generate_milestone_id: alias for above
 *   - otto_requirement_save: creates requirements during discuss
 *   - otto_save_requirement: alias for above
 *   - otto_requirement_update: updates requirements during discuss
 *   - otto_update_requirement: alias for above
 */
export const DISCUSS_TOOLS_ALLOWLIST: readonly string[] = [
  // Context / summary writing
  "otto_summary_save",
  "otto_save_summary",
  // Decision recording
  "otto_decision_save",
  "otto_save_decision",
  // Milestone planning (needed for discuss.md output phase)
  "otto_plan_milestone",
  "otto_milestone_plan",
  // Milestone ID generation (multi-milestone flow)
  "otto_milestone_generate_id",
  "otto_generate_milestone_id",
  // Requirement updates
  "otto_requirement_save",
  "otto_save_requirement",
  "otto_requirement_update",
  "otto_update_requirement",
];
