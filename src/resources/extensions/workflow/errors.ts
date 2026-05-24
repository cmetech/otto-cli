/**
 * Error Types — Typed error hierarchy for diagnostics and crash recovery.
 *
 * All workflow-specific errors extend WorkflowError, which carries a stable `code`
 * string suitable for programmatic matching. Error codes are defined as
 * constants so callers can switch on them without string-matching.
 */

// ─── Error Codes ──────────────────────────────────────────────────────────────

export const STALE_STATE = "STALE_STATE";
export const LOCK_HELD = "LOCK_HELD";
export const ARTIFACT_MISSING = "ARTIFACT_MISSING";
export const GIT_ERROR = "GIT_ERROR";
export const MERGE_CONFLICT = "MERGE_CONFLICT";
export const PARSE_ERROR = "PARSE_ERROR";
export const IO_ERROR = "IO_ERROR";

// ─── Base Error ───────────────────────────────────────────────────────────────

export class WorkflowError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkflowError";
    this.code = code;
  }
}
