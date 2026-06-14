#!/usr/bin/env node
/**
 * apply-context-upgrades.mjs — third-pass context-driven severity classifier (§8.3).
 *
 * Priority order (first match wins):
 *   1. CRITICAL_SECURITY  — any label in PR or issueContexts matches security/cve/vulnerab
 *   2. CRITICAL_STABILITY — any label matches regression/p0/p1/crash/hotfix/backport/etc.
 *   3. CRITICAL_STABILITY — any issue body matches production/users affected/etc.
 *   4. CRITICAL_STABILITY — any PR review or comment body mentions "backport to|backport this"
 *   5. SKIP               — all issueContexts are closed with stateReason not-planned/wontfix/duplicate
 *   6. NICE_TO_HAVE_FIX   — UNCLASSIFIED only: PR has bug label + ≥2 APPROVED reviews
 *   7. FEATURE            — UNCLASSIFIED only: any label matches enhancement
 *
 * Input:  { firstPass, prContext, issueContexts }
 * Output: { severity, upgradeReason? }
 */

import { isClosedAsUnwanted } from "../../_common/scripts/issue-state.mjs";

const SECURITY_LABEL_RE = /^(security|cve|vulnerab)/i;
const STABILITY_LABEL_RE = /^(regression|priority\/critical|p0|p1|severity:high|crash|data.loss|hotfix|backport)/i;
const STABILITY_BODY_RE = /(production|users affected|blocks startup|unrecoverable|all users)/i;
const BACKPORT_COMMENT_RE = /(backport to|backport this)/i;
const BUG_LABEL_RE = /^bug/i;
const ENHANCEMENT_LABEL_RE = /^enhancement/i;

/**
 * Collect all labels from a prContext and an array of issueContexts.
 * Returns an array of label name strings.
 */
function collectAllLabels(prContext, issueContexts) {
  const labels = [];
  if (prContext?.data?.labels) {
    for (const l of prContext.data.labels) {
      labels.push(l.name ?? "");
    }
  }
  for (const issue of issueContexts ?? []) {
    for (const l of issue.data?.labels ?? []) {
      labels.push(l.name ?? "");
    }
  }
  return labels;
}

/**
 * Main upgrade function.
 *
 * @param {{ firstPass: { severity: string, matchedBy?: string }, prContext: object|null, issueContexts: object[] }} opts
 * @returns {{ severity: string, upgradeReason?: string }}
 */
export function applyContextUpgrades({ firstPass, prContext, issueContexts }) {
  const allLabels = collectAllLabels(prContext, issueContexts);
  const issues = issueContexts ?? [];

  // Rule 1 — CRITICAL_SECURITY via label
  const securityLabel = allLabels.find((name) => SECURITY_LABEL_RE.test(name));
  if (securityLabel) {
    return {
      severity: "CRITICAL_SECURITY",
      upgradeReason: `security-label: label "${securityLabel}" matches security/cve/vulnerab`,
    };
  }

  // Rule 2 — CRITICAL_STABILITY via stability label
  const stabilityLabel = allLabels.find((name) => STABILITY_LABEL_RE.test(name));
  if (stabilityLabel) {
    return {
      severity: "CRITICAL_STABILITY",
      upgradeReason: `stability-label: label "${stabilityLabel}" matches stability pattern`,
    };
  }

  // Rule 3 — CRITICAL_STABILITY via issue body keyword
  for (const issue of issues) {
    const body = issue.data?.body ?? "";
    const match = body.match(STABILITY_BODY_RE);
    if (match) {
      return {
        severity: "CRITICAL_STABILITY",
        upgradeReason: `issue-body-keyword: found "${match[0]}" in issue body`,
      };
    }
  }

  // Rule 4 — CRITICAL_STABILITY via backport mention in PR review/comment body
  if (prContext) {
    const reviews = prContext.data?.reviews ?? [];
    const comments = prContext.data?.comments ?? [];
    for (const review of reviews) {
      const body = review.body ?? "";
      const match = body.match(BACKPORT_COMMENT_RE);
      if (match) {
        return {
          severity: "CRITICAL_STABILITY",
          upgradeReason: `backport-review-comment: found "${match[0]}" in review body`,
        };
      }
    }
    for (const comment of comments) {
      const body = comment.body ?? "";
      const match = body.match(BACKPORT_COMMENT_RE);
      if (match) {
        return {
          severity: "CRITICAL_STABILITY",
          upgradeReason: `backport-review-comment: found "${match[0]}" in comment body`,
        };
      }
    }
  }

  // Rule 5 — SKIP when all linked issues are closed with not-planned/wontfix/duplicate
  if (issues.length > 0) {
    const allSkippable = issues.every(isClosedAsUnwanted);
    if (allSkippable) {
      const reason = issues[0].data?.stateReason ?? "CLOSED";
      return {
        severity: "SKIP",
        upgradeReason: `closed-issue: all linked issues closed with stateReason "${reason}"`,
      };
    }
  }

  // Rules 6 & 7 only fire for UNCLASSIFIED
  if (firstPass.severity === "UNCLASSIFIED") {
    // Rule 6 — NICE_TO_HAVE_FIX: PR + bug label + ≥2 APPROVED reviews
    if (prContext) {
      const prLabels = (prContext.data?.labels ?? []).map((l) => l.name ?? "");
      const hasBugLabel = prLabels.some((name) => BUG_LABEL_RE.test(name));
      if (hasBugLabel) {
        const reviews = prContext.data?.reviews ?? [];
        const approvalCount = reviews.filter((r) => r.state === "APPROVED").length;
        if (approvalCount >= 2) {
          return {
            severity: "NICE_TO_HAVE_FIX",
            upgradeReason: `unclassified-bug-approved: PR has "bug" label and ${approvalCount} approvals`,
          };
        }
      }
    }

    // Rule 7 — FEATURE: any label matches enhancement
    const enhancementLabel = allLabels.find((name) => ENHANCEMENT_LABEL_RE.test(name));
    if (enhancementLabel) {
      return {
        severity: "FEATURE",
        upgradeReason: `unclassified-enhancement: label "${enhancementLabel}" matches enhancement`,
      };
    }
  }

  // No upgrade — return firstPass unchanged
  return { severity: firstPass.severity };
}

// CLI mode: node apply-context-upgrades.mjs < input.json
if (import.meta.url === `file://${process.argv[1]}`) {
  let stdin = "";
  process.stdin.on("data", (c) => (stdin += c));
  process.stdin.on("end", () => {
    try {
      const { firstPass, prContext, issueContexts } = JSON.parse(stdin);
      process.stdout.write(
        JSON.stringify(applyContextUpgrades({ firstPass, prContext, issueContexts })) + "\n",
      );
    } catch (err) {
      process.stderr.write(JSON.stringify({ error: err.message }) + "\n");
      process.exit(1);
    }
  });
}
