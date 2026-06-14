#!/usr/bin/env node
/**
 * supersession-check.mjs — Class-A (deterministic, upstream-history) staleness
 * detectors for the Phase 6 backlog sweep.
 *
 * Three rules, in priority order:
 *   1. reverted        — a later commit reverts the sha → AUTO-TAG (superseded:true)
 *   2. upstream-closed — all linked upstream issues closed not-planned/wontfix/
 *                        duplicate (mirrors apply-context-upgrades Rule 5) → AUTO-TAG
 *   3. rewritten       — later commits touched the same files → ADVISORY ONLY
 *                        (superseded:false; reported, NEVER auto-tags — the least
 *                        precise signal, per the Phase 6 design risk note)
 *
 * Pure decision logic over an injected `gitRunner(args)` (full git arg list,
 * including `-C <repoPath>`) and already-fetched `issueContexts`. The orchestrator
 * (sweep-backlog.mjs) supplies the real git/gh I/O. `superseded === true` is the
 * single signal the orchestrator uses to decide whether to apply status:superseded.
 *
 * The decision is "never close" — the sweep only LABELS and COMMENTS; a human
 * always makes the final call.
 */
import { execFileSync } from "node:child_process";
import { isClosedAsUnwanted } from "../../_common/scripts/issue-state.mjs";

function defaultGitRunner(args) {
  return execFileSync("git", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
}

/**
 * Rule 1 — a later commit reverts the sha.
 * @returns {{hit: boolean, revertingSha?: string, revertingSubject?: string}}
 */
export function detectReverted({ repoPath, sha, subject, gitRunner = defaultGitRunner }) {
  const range = `${sha}..HEAD`;
  const greps = [`This reverts commit ${sha}`];
  if (subject) greps.push(`Revert "${subject}"`);
  for (const grep of greps) {
    let out = "";
    try {
      out = gitRunner(["-C", repoPath, "log", range, "--no-merges", "--format=%h%x09%s", `--grep=${grep}`, "--fixed-strings"]);
    } catch {
      continue; // sha not in repo / bad range — treat as no hit
    }
    const line = out.split("\n").map((s) => s.trim()).filter(Boolean)[0];
    if (line && line.includes("\t")) {
      const [revertingSha, revertingSubject = ""] = line.split("\t");
      return { hit: true, revertingSha, revertingSubject };
    }
  }
  return { hit: false };
}

/**
 * Rule 3 — later commits materially touched the same files (ADVISORY ONLY).
 * @returns {{hit: boolean, laterCommits?: string[], fileCount?: number}}
 */
export function detectRewritten({ repoPath, sha, files = [], gitRunner = defaultGitRunner }) {
  if (!files.length) return { hit: false };
  let out = "";
  try {
    out = gitRunner(["-C", repoPath, "log", `${sha}..HEAD`, "--no-merges", "--oneline", "--", ...files]);
  } catch {
    return { hit: false };
  }
  const commits = out.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!commits.length) return { hit: false };
  return { hit: true, laterCommits: commits.slice(0, 10), fileCount: files.length };
}

/**
 * Rule 2 — all linked upstream issues are closed as not-planned/wontfix/duplicate.
 * Mirrors apply-context-upgrades.mjs Rule 5, run against the backlog now.
 * @returns {{hit: boolean, stateReason?: string}}
 */
export function detectUpstreamClosed({ issueContexts = [] }) {
  if (!issueContexts.length) return { hit: false };
  if (!issueContexts.every(isClosedAsUnwanted)) return { hit: false };
  const d0 = issueContexts[0].data ?? issueContexts[0];
  return { hit: true, stateReason: d0.stateReason ?? "CLOSED" };
}

/**
 * Combine the three rules. Priority: reverted > upstream-closed > rewritten.
 * `superseded` is true ONLY for the two auto-taggable rules; rewritten is advisory.
 * @returns {{superseded: boolean, rule: "reverted"|"upstream-closed"|"rewritten"|null, evidence: object|null}}
 */
export function checkSupersession({ repoPath, sha, subject, files = [], issueContexts = [], gitRunner = defaultGitRunner }) {
  const reverted = detectReverted({ repoPath, sha, subject, gitRunner });
  if (reverted.hit) {
    return { superseded: true, rule: "reverted", evidence: { revertingSha: reverted.revertingSha, revertingSubject: reverted.revertingSubject } };
  }
  const closed = detectUpstreamClosed({ issueContexts });
  if (closed.hit) {
    return { superseded: true, rule: "upstream-closed", evidence: { stateReason: closed.stateReason } };
  }
  const rewritten = detectRewritten({ repoPath, sha, files, gitRunner });
  if (rewritten.hit) {
    return { superseded: false, rule: "rewritten", evidence: { laterCommits: rewritten.laterCommits, fileCount: rewritten.fileCount } };
  }
  return { superseded: false, rule: null, evidence: null };
}
