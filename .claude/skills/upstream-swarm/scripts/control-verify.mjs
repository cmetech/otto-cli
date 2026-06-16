#!/usr/bin/env node
/**
 * control-verify.mjs — verifyFixArtifacts (#4). Confirms a fix lane's durable
 * artifacts exist before the controller records `fix-ok`, closing the
 * premature-completion hole by construction (a subagent's "done" text is never
 * trusted). Extra (collateral) files do not fail; they become scopeNotes for
 * the refute scope-discipline lens.
 */
import { execFileSync } from "node:child_process";

function defaultGhRunner(args) { return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }); }
function defaultGitRunner(args) { return execFileSync("git", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }); }

function toList(targets) {
  if (Array.isArray(targets)) return targets.filter(Boolean);
  if (typeof targets === "string") return targets.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export function verifyFixArtifacts({
  pr, issue, branch, targets,
  repo = "cmetech/otto-cli",
  ghRunner = defaultGhRunner,
  gitRunner = defaultGitRunner,
}) {
  const prNumber = Number(pr);
  if (!Number.isInteger(prNumber)) throw new Error(`pr must be an integer: ${pr}`);
  if (!branch) throw new Error("branch is required");
  const targetList = toList(targets);
  const reasons = [];

  const prView = JSON.parse(ghRunner(["pr", "view", String(prNumber), "--repo", repo, "--json", "state"]));
  if (prView.state !== "OPEN") reasons.push(`PR #${prNumber} is not open (state=${prView.state})`);

  const lsRemote = gitRunner(["ls-remote", "--heads", "origin", branch]).trim();
  if (!lsRemote) reasons.push(`branch ${branch} is not pushed to origin`);

  const diffFiles = ghRunner(["pr", "diff", String(prNumber), "--repo", repo, "--name-only"])
    .split("\n").map((s) => s.trim()).filter(Boolean);
  const scopeNotes = [];
  if (diffFiles.length === 0) {
    reasons.push(`empty diff for PR #${prNumber}`);
  } else if (targetList.length > 0) {
    const targetSet = new Set(targetList);
    const hitsTarget = diffFiles.some((f) => targetSet.has(f));
    if (!hitsTarget) reasons.push(`diff touches none of the declared targets (${targetList.join(", ")})`);
    for (const f of diffFiles) if (!targetSet.has(f)) scopeNotes.push(f);
  }

  return { ok: reasons.length === 0, reasons, scopeNotes, issue: issue ?? null, pr: prNumber };
}
