#!/usr/bin/env node
/**
 * driver-core.mjs — PURE decision logic for the unattended Workflow driver.
 * No fs/shell/agent calls: it maps a scheduler tick's actions into a dispatch
 * plan, builds fix-lane / refute-lens prompts, and builds the exact
 * `swarm-control.mjs` argv arrays for each controller call. The Phase 2b
 * Workflow shell wires agent()/parallel() + shelled-out controller calls to
 * these. Unit-tested by feeding the argv builders into swarm-control dispatch().
 */
import { LENS_NAMES } from "../../upstream-merge/scripts/refute-panel.mjs";

export function isDone(actions) {
  return Array.isArray(actions) && actions.length === 0;
}

export function bucketActions(actions) {
  const b = { startFix: [], quarantineTimeout: [], pollBatch: [], localGate: [], refute: [], merge: [] };
  for (const a of actions ?? []) {
    switch (a.kind) {
      case "start-fix": b.startFix.push(a.issueNumber); break;
      case "quarantine-timeout": b.quarantineTimeout.push({ issueNumber: a.issueNumber, reason: a.reason }); break;
      case "poll-ci-batch": b.pollBatch.push(...(a.issueNumbers ?? [])); break;
      case "run-local-gate": b.localGate.push(a.issueNumber); break;
      case "run-refute": b.refute.push(a.issueNumber); break;
      case "merge-pr": b.merge.push(a.issueNumber); break;
      default: break; // unknown kinds ignored here (the shell logs them)
    }
  }
  return b;
}

const s = (v) => String(v);

export function tickArgv({ ledger, caps, now }) {
  const a = ["tick", "--ledger", ledger, "--caps", caps];
  if (now != null) a.push("--now", s(now));
  return a;
}
export function pollArgv(pr) { return ["poll", "--pr", s(pr)]; }
export function gateArgv({ pr, headRef, targets, logDir }) {
  return ["gate", "--pr", s(pr), "--head-ref", headRef, "--targets", targets, "--log-dir", logDir];
}
export function verifyFixArgv({ pr, issue, branch, targets }) {
  return ["verify-fix", "--pr", s(pr), "--issue", s(issue), "--branch", branch, "--targets", targets];
}
export function recordArgv({ ledger, issue, state, payload }) {
  const a = ["record", "--ledger", ledger, "--issue", s(issue), "--state", state];
  if (payload) a.push("--payload", payload);
  return a;
}
export function mergeArgv({ pr, issue, ledger, refuteReason }) {
  return ["merge", "--pr", s(pr), "--issue", s(issue), "--ledger", ledger, "--refute-reason", refuteReason];
}
export function classifyArgv({ stage, failTail }) {
  return ["classify", "--stage", stage, "--fail-tail", failTail];
}
export function retryArgv({ ledger, issue, reason }) {
  return ["retry", "--ledger", ledger, "--issue", s(issue), "--reason", reason];
}

/**
 * driverPlan — PURE aggregator: turn enriched scheduler actions (from `tick`)
 * into a ready-to-execute dispatch plan for the Workflow shell. Iterates once,
 * switching on kind, and bins each action into the right bucket with its
 * prompt / argv already built. No fs/shell.
 */
export function driverPlan(enrichedActions, { gateLogDir, ledger }) {
  const plan = { fixes: [], quarantineTimeouts: [], polls: [], gates: [], refutes: [], merges: [] };
  for (const a of enrichedActions ?? []) {
    switch (a.kind) {
      case "start-fix":
        plan.fixes.push({
          issueNumber: a.issueNumber,
          prompt: fixLanePrompt({ number: a.issueNumber, sha: a.sha, targetFiles: a.targetFiles }),
        });
        break;
      case "quarantine-timeout":
        plan.quarantineTimeouts.push({ issueNumber: a.issueNumber, reason: a.reason });
        break;
      case "poll-ci-batch":
        for (const i of a.issues ?? []) plan.polls.push({ issueNumber: i.issueNumber, prNumber: i.prNumber });
        break;
      case "run-local-gate":
        plan.gates.push({
          issueNumber: a.issueNumber,
          prNumber: a.prNumber,
          argv: gateArgv({ pr: a.prNumber, headRef: a.branch, targets: (a.targetFiles ?? []).join(","), logDir: gateLogDir }),
        });
        break;
      case "run-refute":
        plan.refutes.push({ issueNumber: a.issueNumber, prNumber: a.prNumber, sha: a.sha });
        break;
      case "merge-pr":
        plan.merges.push({
          issueNumber: a.issueNumber,
          prNumber: a.prNumber,
          argv: mergeArgv({ pr: a.prNumber, issue: a.issueNumber, ledger, refuteReason: "panel approve" }),
        });
        break;
      default:
        break; // unknown kinds ignored (the shell logs them)
    }
  }
  return plan;
}

export function fixLanePrompt(issue) {
  const targets = (issue.targetFiles ?? []).join(", ");
  return [
    `You are a fix-lane subagent for the upstream-swarm pipeline. Execute the upstream-fix skill in single-issue mode for GitHub issue #${issue.number} on cmetech/otto-cli.`,
    ``,
    `Invoke the skill via the Skill tool: upstream-fix with args "--single-issue ${issue.number}". It creates a file-disjoint git-worktree lane, implements the fix (sha ${issue.sha ?? "see issue"}, target files: ${targets || "see guidance"}), runs its IN-LANE gates — regression (fails-before/passes-after), build, targeted suite, and an independent reviewer — to completion in-process, pushes the branch, and opens ONE PR that closes the issue.`,
    ``,
    `CRITICAL constraints:`,
    `- Do NOT run the full suite in the lane — the swarm controller runs the full test suite once via swarm-control gate. Running it here is what caused mid-gate subagent deaths.`,
    `- Do NOT merge. Stop at PR-open.`,
    `- Work ONLY in the issue-${issue.number} worktree lane; run builds/tests inside it only.`,
    `- If blocked on an unported prerequisite or low confidence, do NOT touch code — report outcome "blocked" with the reason and post a blocker comment.`,
    ``,
    `Return ONLY this compact JSON as your entire final message:`,
    `{ "issue": ${issue.number}, "outcome": "pr-opened"|"fix-failed"|"blocked", "prNumber": <n|null>, "prUrl": <url|null>, "branch": <name|null>, "gatesPassed": <bool>, "notes": "<one line>" }`,
  ].join("\n");
}

const LENS_QUESTION = {
  "upstream-alignment":
    `Does the PR deliver the upstream change's intent? If fixStrategy is "essence-reimplement", judge alignment to the upstream INTENT / root cause (NOT diff-fidelity) — otto has diverged; refute only if it fails to resolve the documented root cause. For "direct-merge"/"adapted-port", judge fidelity to the upstream change. ABSTAIN if you genuinely cannot tell.`,
  "scope-discipline":
    `Is the diff scoped strictly to resolving this issue — no unrelated changes, scope creep, or out-of-target-file edits? Justified collateral is acceptable; refute meaningful out-of-scope modifications.`,
  "test-quality":
    `Do the tests genuinely pin the behavior the fix addresses (fail-before/pass-after), rather than being tautological, over-mocked, or asserting nothing? Refute if testing is inadequate to catch a regression.`,
  "blast-radius":
    `Could this change break unrelated behavior? Is the risk surface proportionate to the issue's severity? Refute if the change risks regressions disproportionate to its value.`,
};

export function lensPrompts(bundlePath, { prNumber, issueNumber }) {
  return LENS_NAMES.map((lens) => ({
    lens,
    prompt: [
      `You are the \`${lens}\` lens of a 4-lens refute panel reviewing PR #${prNumber} (closes issue #${issueNumber}).`,
      `Read the input bundle at \`${bundlePath}\` (fields: prTitle, prBody, prDiff, issueBody, upstreamSha, upstreamShow, fixStrategy, severity).`,
      ``,
      `Your question: ${LENS_QUESTION[lens]}`,
      ``,
      `Be adversarial but fair. Return ONLY this JSON as your entire final message (no prose, no fence):`,
      `{"lens":"${lens}","verdict":"approve"|"refute"|"abstain","confidence":0.0-1.0,"reason":"<=200 chars","blocking":true|false}`,
    ].join("\n"),
  }));
}

export function assertUnattendedAuthorized({ unattended } = {}) {
  if (unattended !== true) {
    throw new Error("unattended merge requires explicit --unattended pre-authorization");
  }
  return { authorized: true, note: "unattended run pre-authorized; gates (two signals + refute approve + severity routing) remain the authorization" };
}
