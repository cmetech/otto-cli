// Workflow Extension — Write Intercept for Agent State File Blocks
// Detects agent attempts to write authoritative state files and returns
// an error directing the agent to use the engine tool API instead.

import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Patterns matching authoritative .otto/workflow/ state files that agents must NOT write directly.
 *
 * Only STATE.md is blocked — it is purely engine-rendered from DB state.
 * All other .otto/workflow/ files are agent-authored content that agents create and
 * update during discuss, plan, and execute phases:
 * - REQUIREMENTS.md — agents create during discuss, read during planning
 * - PROJECT.md — agents create during discuss, update at milestone close
 * - ROADMAP.md / PLAN.md — agents create during planning, engine renders checkboxes
 * - SUMMARY.md, KNOWLEDGE.md, CONTEXT.md — non-authoritative content
 */
const BLOCKED_PATTERNS: RegExp[] = [
  // STATE.md is the only purely engine-rendered file.
  // Case-insensitive to prevent bypass on macOS (case-insensitive APFS).
  // (^|[/\\]) matches both absolute paths (/project/.otto/workflow/…) and bare relative
  // paths (.otto/workflow/STATE.md) so a path without a leading separator is also blocked.
  /(^|[/\\])\.otto[/\\]workflow[/\\]STATE\.md$/i,
  // Also match resolved symlink paths under ~/.otto/projects/ (Pitfall #6)
  /(^|[/\\])\.otto[/\\]workflow[/\\]projects[/\\][^/\\]+[/\\]STATE\.md$/i,
  // otto.db and WAL/SHM files — single-writer WAL connection managed by engine (#3625)
  /(^|[/\\])\.otto[/\\]workflow[/\\]otto\.db(-wal|-shm)?$/i,
  /(^|[/\\])\.otto[/\\]workflow[/\\]projects[/\\][^/\\]+[/\\]otto\.db(-wal|-shm)?$/i,
];

/**
 * Bash command patterns that target STATE.md.
 * Covers common shell write patterns: redirect, tee, cp, mv, sed -i, etc.
 */
const BASH_STATE_PATTERNS: RegExp[] = [
  // Redirect/pipe writes: > STATE.md, >> STATE.md, >| STATE.md
  /[>|]+\s*\S*STATE\.md/i,
  // tee to STATE.md
  /\btee\b.*STATE\.md/i,
  // cp/mv targeting STATE.md
  /\b(cp|mv)\b.*STATE\.md/i,
  // sed -i editing STATE.md
  /\bsed\b.*-i.*STATE\.md/i,
  // dd output to STATE.md
  /\bdd\b.*of=\S*STATE\.md/i,
  // Direct DB access via sqlite3/sql.js/better-sqlite3 targeting otto.db (#3625)
  /\b(sqlite3|sql\.js|better-sqlite3|node:sqlite)\b.*otto\.db/i,
  /\botto\.db\b.*\b(sqlite3|sql\.js|better-sqlite3)\b/i,
  // Shell writes targeting otto.db files
  /[>|]+\s*\S*otto\.db/i,
  /\b(cp|mv|dd)\b.*otto\.db/i,
];

/**
 * Tests whether the given file path matches a blocked authoritative .otto/workflow/ state file.
 * Resolves `..` segments via path.resolve() and attempts realpathSync for symlinks.
 */
export function isBlockedStateFile(filePath: string): boolean {
  // Check raw path first
  if (matchesBlockedPattern(filePath)) return true;

  // Resolve ".." segments (works even for non-existing files)
  const resolved = resolve(filePath);
  if (resolved !== filePath && matchesBlockedPattern(resolved)) return true;

  // Also try symlink resolution — file may not exist yet, so wrap in try/catch
  try {
    const realpath = realpathSync(filePath);
    if (realpath !== filePath && realpath !== resolved && matchesBlockedPattern(realpath)) return true;
  } catch {
    // File doesn't exist yet — path matching above is sufficient
  }

  return false;
}

/**
 * Tests whether a bash command appears to target STATE.md for writing.
 */
export function isBashWriteToStateFile(command: string): boolean {
  return BASH_STATE_PATTERNS.some((pattern) => pattern.test(command));
}

function matchesBlockedPattern(path: string): boolean {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * Error message returned when an agent attempts to directly write an authoritative .otto/workflow/ state file.
 * Directs the agent to use engine tool calls instead.
 */
export const BLOCKED_WRITE_ERROR = `Direct writes to .otto/workflow/STATE.md and .otto/workflow/otto.db are blocked. Use engine tool calls instead:
- To complete a task: call otto_task_complete(milestone_id, slice_id, task_id, summary)
- To complete a slice: call otto_slice_complete(milestone_id, slice_id, summary, uat_result)
- To save a decision: call otto_decision_save(scope, decision, choice, rationale)
- To start a task: call otto_start_task(milestone_id, slice_id, task_id)
- To record verification: call otto_record_verification(milestone_id, slice_id, task_id, evidence)
- To report a blocker: call otto_report_blocker(milestone_id, slice_id, task_id, description)`;
