#!/usr/bin/env node
/**
 * sweep-backlog.mjs — Phase 6 §2 supersession sweep orchestrator.
 *
 * Walks OPEN actionable issues (type:port-required + type:cherry-pick-candidate,
 * excluding status:applied/status:superseded), and for each runs the Class-A
 * supersession detectors in its LINEAGE repo. Auto-applies status:superseded +
 * an evidence comment for reverted/upstream-closed hits (via issue-update.mjs);
 * records rewritten as advisory (NOT tagged); and collects feature issues for
 * the agent's alignment re-check. NEVER closes an issue. Returns structured
 * runData for write-sweep-report.mjs.
 *
 * All I/O is injected (ghRunner / gitRunner / fetchContext / issueUpdater) so the
 * decision path is fully unit-testable with no network.
 */
import { execFileSync } from "node:child_process";
import { checkSupersession } from "./supersession-check.mjs";
import { updateIssue } from "../../_common/scripts/issue-update.mjs";
import { fetchPrContext } from "./fetch-pr-context.mjs";

const ACTIONABLE_LABELS = ["type:port-required", "type:cherry-pick-candidate"];
const EXCLUDE_LABELS = ["status:applied", "status:superseded"];
const SHA_RE = /sha=([0-9a-f]{7,40})/i;
const REF_RE = /#(\d+)/g;

function defaultGhRunner(args) {
  return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
}
function defaultGitRunner(args) {
  return execFileSync("git", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
}

function labelNames(labels = []) {
  return labels.map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean);
}

/** Filter fetched issues to the open actionable set (Phase 6 §2). */
export function selectActionableIssues(issues) {
  return issues.filter((i) => {
    const names = labelNames(i.labels);
    return names.some((n) => ACTIONABLE_LABELS.includes(n)) && !names.some((n) => EXCLUDE_LABELS.includes(n));
  });
}

/** Extract the 7-char sha from an issue's body trailer or title. */
export function extractSha(issue) {
  const fromBody = (issue.body ?? "").match(SHA_RE);
  if (fromBody) return fromBody[1].slice(0, 7);
  const fromTitle = (issue.title ?? "").match(SHA_RE);
  return fromTitle ? fromTitle[1].slice(0, 7) : null;
}

/** Read the upstream name from the `upstream:<name>` label. */
export function upstreamNameOf(issue) {
  for (const n of labelNames(issue.labels)) {
    if (n.startsWith("upstream:")) return n.slice("upstream:".length);
  }
  return null;
}

function renderSupersededComment(verdict, sha) {
  if (verdict.rule === "reverted") {
    return (
      `🧹 **Backlog sweep — \`status:superseded\` (reverted).** The upstream commit ` +
      `\`${sha}\` was reverted by \`${verdict.evidence.revertingSha}\` (${verdict.evidence.revertingSubject}). ` +
      `Porting it is likely wasted effort. Auto-tagged by \`/upstream-cherry-pick --sweep\` — **not closed**; a human decides.`
    );
  }
  // upstream-closed
  return (
    `🧹 **Backlog sweep — \`status:superseded\` (upstream-closed).** The linked upstream ` +
    `issue(s) for \`${sha}\` were closed as \`${verdict.evidence.stateReason}\`. Auto-tagged by ` +
    `\`/upstream-cherry-pick --sweep\` — **not closed**; a human decides.`
  );
}

/**
 * @param {{ cfg, ghRunner?, gitRunner?, fetchContext?, issueUpdater?, dryRun? }} opts
 * @returns {Promise<{scanned:number, superseded:[], advisory:[], features:[], skipped:[]}>}
 */
export async function sweepBacklog({
  cfg,
  ghRunner = defaultGhRunner,
  gitRunner = defaultGitRunner,
  fetchContext = fetchPrContext,
  issueUpdater = updateIssue,
  dryRun = false,
}) {
  const raw = ghRunner([
    "issue", "list",
    "--repo", cfg.targetRepo,
    "--state", "open",
    "--limit", "1000",
    "--json", "number,title,body,labels",
  ]);
  const all = JSON.parse(raw || "[]");
  const actionable = selectActionableIssues(all);

  const runData = { scanned: actionable.length, superseded: [], advisory: [], features: [], skipped: [] };

  for (const issue of actionable) {
    const sha = extractSha(issue);
    const upName = upstreamNameOf(issue);
    const up = upName ? cfg.upstreams[upName] : null;
    const role = up ? up.role ?? "lineage" : null;

    if (!sha || !up || role !== "lineage") {
      runData.skipped.push({ number: issue.number, reason: !sha ? "no-sha" : !up ? "unknown-upstream" : "non-lineage" });
      continue;
    }

    // Read commit metadata from the lineage repo (subject, touched files, refs).
    let subject = "";
    let files = [];
    let refs = [];
    try {
      const meta = gitRunner(["-C", up.path, "show", "-s", "--format=%s%n%b", sha]);
      subject = meta.split("\n")[0] ?? "";
      refs = [...meta.matchAll(REF_RE)].map((m) => m[1]);
    } catch { /* sha not in repo — detectors just won't hit */ }
    try {
      const numstat = gitRunner(["-C", up.path, "show", sha, "--numstat", "--format="]);
      files = numstat.split("\n").map((l) => l.trim().split("\t")[2]).filter(Boolean);
    } catch { /* no files — rewritten won't hit */ }

    // upstream-closed: fetch the linked upstream issue contexts.
    const issueContexts = [];
    for (const ref of refs) {
      try {
        const ctx = await fetchContext({ ghRepo: up.ghRepo, refNum: parseInt(ref, 10) });
        if (ctx?.kind === "issue") issueContexts.push(ctx);
      } catch { /* reduced signal — proceed */ }
    }

    const verdict = checkSupersession({ repoPath: up.path, sha, subject, files, issueContexts, gitRunner });

    if (verdict.superseded) {
      const comment = renderSupersededComment(verdict, sha);
      if (!dryRun) {
        issueUpdater({ number: issue.number, repo: cfg.targetRepo, addLabels: ["status:superseded"], comment });
      }
      runData.superseded.push({ number: issue.number, sha, rule: verdict.rule, evidence: verdict.evidence });
    } else if (verdict.rule === "rewritten") {
      runData.advisory.push({ number: issue.number, sha, rule: "rewritten", evidence: verdict.evidence });
    }

    if (labelNames(issue.labels).includes("severity:feature")) {
      runData.features.push({ number: issue.number, sha, title: issue.title });
    }
  }

  return runData;
}
