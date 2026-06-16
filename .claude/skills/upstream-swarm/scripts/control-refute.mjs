#!/usr/bin/env node
/**
 * control-refute.mjs — refute-panel controller subcommands for the sandboxed
 * Workflow driver. `refute-bundle` materializes the shared input bundle to disk
 * and hands back the four lens prompts; `refute-tally` folds the lens verdicts
 * into a single panel verdict. Both are thin shells over refute-panel.mjs so the
 * driver only needs `ctl` (shell-out) + `agent(prompt)` to run the panel.
 */
import { writeFileSync } from "node:fs";
import { buildInputBundle, tallyVerdicts } from "../../upstream-merge/scripts/refute-panel.mjs";
import { lensPrompts } from "./driver-core.mjs";

export function refuteBundle({ pr, issue, sha, out, repo, ghRunner, gitRunner, upstreamRoot }) {
  if (!out) throw new Error("refute-bundle requires --out <path>");
  if (pr == null) throw new Error("refute-bundle requires --pr <n>");
  if (issue == null) throw new Error("refute-bundle requires --issue <n>");
  const bundle = buildInputBundle({
    prNumber: Number(pr),
    issueNumber: Number(issue),
    upstreamSha: sha,
    ...(repo ? { repo } : {}),
    ...(ghRunner ? { ghRunner } : {}),
    ...(gitRunner ? { gitRunner } : {}),
    ...(upstreamRoot ? { upstreamRoot } : {}),
  });
  writeFileSync(out, JSON.stringify(bundle, null, 2));
  return {
    bundlePath: out,
    lensPrompts: lensPrompts(out, { prNumber: Number(pr), issueNumber: Number(issue) }),
  };
}

export function refuteTally({ verdicts }) {
  if (verdicts == null) throw new Error("refute-tally requires --verdicts <json>");
  const v = typeof verdicts === "string" ? JSON.parse(verdicts) : verdicts;
  return tallyVerdicts(v);
}
