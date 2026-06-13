#!/usr/bin/env node
/**
 * refute-panel.mjs — 4-lens panel that runs after the two-signal gate.
 * Pure: tallyVerdicts + formatRefuteComment. The subagent runner is wired
 * by callers (SKILL.md orchestration or merge-pr.mjs).
 * I/O: buildInputBundle (materializes diff+show+issue once) + runPanel (parallel lenses).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { strategyFromLabels } from "../../_common/scripts/fix-strategy.mjs";

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

// ---------------------------------------------------------------------------
// I/O layer: buildInputBundle + runPanel
// ---------------------------------------------------------------------------

function defaultGhRunner(args) { return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }); }
function defaultGitRunner(args) { return execFileSync("git", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }); }

function severityFromLabels(labels = []) {
  const l = labels.find((x) => (x.name ?? "").startsWith("severity:"));
  return l ? l.name.slice("severity:".length) : null;
}
function riskFromLabels(labels = []) {
  const l = labels.find((x) => (x.name ?? "").startsWith("conflict-risk:"));
  return l ? l.name.slice("conflict-risk:".length) : null;
}
function upstreamKeyFromLabels(labels = []) {
  const l = labels.find((x) => (x.name ?? "").startsWith("upstream:"));
  return l ? l.name.slice("upstream:".length) : null;
}

/**
 * Resolve the local filesystem path to the upstream repo for an issue.
 * The upstream SHA in `git show <sha>` only exists in the sibling upstream
 * repo (e.g. `../pi`), not in otto-cli — so refute panels that try to
 * fetch it from cwd will silently get empty context. This helper:
 *
 *   1. Reads the live upstream-sync config (default
 *      `.planning/upstream-sync-config.json`).
 *   2. Picks the upstream key from the issue's `upstream:<key>` label
 *      (e.g. `upstream:pi-dev` → `pi-dev`).
 *   3. Returns `config.upstreams[key].path` resolved against `repoRoot`.
 *
 * Throws if any step fails — silent fallback is what got us here.
 *
 * @returns {string} absolute path to the upstream repo
 */
export function resolveUpstreamRoot({ labels, configPath, repoRoot = process.cwd() }) {
  if (!configPath) configPath = resolve(repoRoot, ".planning", "upstream-sync-config.json");
  if (!existsSync(configPath)) throw new Error(`upstream-sync config missing at ${configPath}`);
  const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
  const key = upstreamKeyFromLabels(labels);
  if (!key) throw new Error(`issue has no upstream:<key> label; cannot resolve upstream root`);
  const entry = cfg.upstreams?.[key];
  if (!entry?.path) throw new Error(`upstream-sync config has no upstreams.${key}.path`);
  const path = isAbsolute(entry.path) ? entry.path : resolve(repoRoot, entry.path);
  if (!existsSync(path)) throw new Error(`upstream root not found on disk: ${path} (config key: ${key})`);
  return path;
}

/** Materialize the input bundle shared across all four lenses. One I/O round. */
export function buildInputBundle({
  prNumber,
  issueNumber,
  upstreamSha,
  repo = "cmetech/otto-cli",
  ghRunner = defaultGhRunner,
  gitRunner = defaultGitRunner,
  upstreamRoot,
  configPath,
  repoRoot = process.cwd(),
}) {
  const prView = JSON.parse(ghRunner(["pr", "view", String(prNumber), "--repo", repo, "--json", "number,title,body,headRefOid"]));
  const prDiff = ghRunner(["pr", "diff", String(prNumber), "--repo", repo]);
  const issueView = JSON.parse(ghRunner(["issue", "view", String(issueNumber), "--repo", repo, "--json", "number,body,labels"]));
  // Resolve the upstream repo path automatically from the issue's
  // `upstream:<key>` label + .planning/upstream-sync-config.json, unless
  // the caller explicitly overrides `upstreamRoot`. The default gitRunner
  // would otherwise run `git show <upstreamSha>` in the otto-cli repo,
  // where the SHA does not exist — yielding silent failure for the panel.
  const resolvedRoot = upstreamRoot ?? resolveUpstreamRoot({ labels: issueView.labels, configPath, repoRoot });
  const upstreamShow = gitRunner(["-C", resolvedRoot, "show", upstreamSha]);
  if (!upstreamShow || !upstreamShow.trim()) {
    throw new Error(`empty git show output for ${upstreamSha} in ${resolvedRoot} — refute panel cannot evaluate without upstream context`);
  }
  return {
    prNumber,
    prTitle: prView.title,
    prBody: prView.body,
    prHeadSha: prView.headRefOid,
    prDiff,
    issueNumber,
    issueBody: issueView.body,
    upstreamSha,
    upstreamRoot: resolvedRoot,
    upstreamShow,
    severity: severityFromLabels(issueView.labels),
    conflictRisk: riskFromLabels(issueView.labels),
    fixStrategy: strategyFromLabels(issueView.labels),
  };
}

/** Run 4 lenses in parallel; lens errors become abstains. Returns { verdicts, tally }. */
export async function runPanel({ bundle, agentRunner }) {
  const tasks = LENS_NAMES.map(async (lens) => {
    try {
      const v = await agentRunner({ lens, bundle });
      // Normalize and trust the agent's structured output.
      return { lens, verdict: v.verdict, confidence: v.confidence ?? null, reason: v.reason ?? "", blocking: !!v.blocking };
    } catch (err) {
      return { lens, verdict: "abstain", confidence: 0, reason: `lens error: ${err.message ?? String(err)}`, blocking: false };
    }
  });
  const verdicts = await Promise.all(tasks);
  const tally = tallyVerdicts(verdicts);
  return { verdicts, tally };
}
