#!/usr/bin/env node
/**
 * build-issue-payload.mjs — per §11.2–11.3 of the spec.
 *
 * Inputs (all passed as a single object or via stdin as JSON):
 *   commit:         { sha, author, date, subject, body, touchedFiles, locByFile, refs }
 *   classification: { severity, matchedBy?, upgradeReason? }
 *   conflictRisk:   { risk, reason }
 *   upstream:       { name, ghRepo }
 *   prContext:      PR data from fetch-pr-context, or null
 *   issueContexts:  array of issue data (may be empty)
 *   ccUser:         string, e.g. "@claude"
 *   heavyFiles:     optional Set<string> (serialized as array when coming from stdin)
 *
 * Output: { title, body, labels }
 */

import { strategyToLabel, strategyToTypeLabel } from "../../_common/scripts/fix-strategy.mjs";
import { alignmentToLabel, isFeatureSeverity } from "../../_common/scripts/alignment.mjs";

// ---------------------------------------------------------------------------
// Emoji map
// ---------------------------------------------------------------------------

const EMOJI_MAP = {
  CRITICAL_SECURITY: "🛡️",
  CRITICAL_STABILITY: "🐛",
  NICE_TO_HAVE_FIX: "🩹",
  FEATURE: "✨",
  SKIP: "❓",
  UNCLASSIFIED: "❓",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert severity/risk to kebab-case label segment. */
function toKebab(str) {
  return str.toLowerCase().replace(/_/g, "-");
}

/** Truncate subject to max 80 visible chars (strips newlines first). */
function truncateSubject(subject, max = 80) {
  const s = (subject ?? "").replace(/[\r\n]+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "…";
}

/** Truncate body excerpt to 200 chars. */
function bodyExcerpt(text, max = 200) {
  if (!text) return null;
  const collapsed = text.replace(/[\r\n]+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max) + "…";
}

/** Return short (7-char) sha. */
function shortSha(sha) {
  return (sha ?? "").slice(0, 7);
}

// ---------------------------------------------------------------------------
// Title builder  §11.2
// ---------------------------------------------------------------------------

function buildTitle({ commit, classification, upstream }) {
  const emoji = EMOJI_MAP[classification.severity] ?? "❓";
  const subject = truncateSubject(commit.subject ?? "");
  const sha7 = shortSha(commit.sha);
  return `[upstream/${upstream.name}] ${emoji} ${subject} [sha=${sha7}]`;
}

// ---------------------------------------------------------------------------
// Labels builder  §11.1
// ---------------------------------------------------------------------------

/** Map a strategy to its type:* label (routing back-compat), or null. */
function typeLabelFor(strategy) {
  return strategyToTypeLabel(strategy);
}

function buildLabels({ classification, conflictRisk, upstream, strategy, alignment }) {
  const severityKebab = toKebab(classification.severity);
  const riskKebab = toKebab(conflictRisk.risk);

  // The analyzed strategy, when present, is authoritative over the deterministic
  // risk-based fallback (HIGH → port-required, else cherry-pick-candidate).
  const typeLabel =
    typeLabelFor(strategy) ??
    (conflictRisk.risk === "HIGH" ? "type:port-required" : "type:cherry-pick-candidate");

  const labels = [
    `upstream:${upstream.name}`,
    typeLabel,
    `severity:${severityKebab}`,
    `conflict-risk:${riskKebab}`,
    "status:triaged",
  ];

  // New audits set both type:* (routing) and fix-strategy:* (fork-divergence).
  const stratLabel = strategyToLabel(strategy);
  if (stratLabel) labels.push(stratLabel);

  // Alignment fit-check label — feature candidates only (Phase 6 §3).
  if (isFeatureSeverity(classification.severity)) {
    const alignLabel = alignmentToLabel(alignment);
    if (alignLabel) labels.push(alignLabel);
  }

  return labels;
}

// ---------------------------------------------------------------------------
// Upstream-context section builder
// ---------------------------------------------------------------------------

function renderUpstreamContext({ prContext, issueContexts, upstream }) {
  const parts = [];

  if (prContext) {
    const pr = prContext.data ?? prContext;
    const labelNames =
      Array.isArray(pr.labels) ? pr.labels.map((l) => (typeof l === "string" ? l : l.name)).join(", ") : "";
    const stateStr = pr.state ? pr.state.toLowerCase() : "unknown";
    const prNum = pr.number ? `#${pr.number}` : "";
    const title = pr.title ?? "(no title)";
    const prHeader = [
      `**PR**: ${upstream.ghRepo}${prNum ? `${prNum}` : ""}`,
      title !== "(no title)" ? `— ${title}` : "",
      stateStr ? `— ${stateStr}` : "",
      labelNames ? `— labels: \`${labelNames}\`` : "",
    ]
      .filter(Boolean)
      .join(" ");
    parts.push(prHeader);

    const excerpt = bodyExcerpt(pr.body);
    if (excerpt) {
      parts.push(`\n> ${excerpt}`);
    }
  }

  if (Array.isArray(issueContexts) && issueContexts.length > 0) {
    for (const ctx of issueContexts) {
      const iss = ctx.data ?? ctx;
      const labelNames =
        Array.isArray(iss.labels)
          ? iss.labels.map((l) => (typeof l === "string" ? l : l.name)).join(", ")
          : "";
      const stateStr = iss.state ? iss.state.toLowerCase() : "unknown";
      const issNum = iss.number ? `#${iss.number}` : "";
      const title = iss.title ?? "(no title)";
      const issHeader = [
        `**Issue**: ${upstream.ghRepo}${issNum}`,
        title !== "(no title)" ? `— ${title}` : "",
        stateStr ? `— ${stateStr}` : "",
        labelNames ? `— labels: \`${labelNames}\`` : "",
      ]
        .filter(Boolean)
        .join(" ");
      parts.push(issHeader);

      const excerpt = bodyExcerpt(iss.body);
      if (excerpt) {
        parts.push(`\n> ${excerpt}`);
      }
    }
  }

  if (parts.length === 0) {
    return "No upstream PR or issue context found.";
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Files touched section builder
// ---------------------------------------------------------------------------

function renderFilesTouched({ commit, heavyFiles }) {
  const files = commit.touchedFiles ?? [];
  if (files.length === 0) return "_(no files recorded)_";
  return files
    .map((f) => {
      const marker = heavyFiles && heavyFiles.has(f) ? " ⚠️ HeavyFile (see UPSTREAM-SYNC.md)" : "";
      return `- \`${f}\`${marker}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// otto-cli implementation guidance section builder
// ---------------------------------------------------------------------------
//
// otto-cli is NOT a 1:1 mirror of upstream — packages have been renamed
// (`packages/ai` → `packages/pi-ai`, `packages/coding-agent` →
// `packages/pi-coding-agent`, `packages/tui` → `packages/pi-tui`, etc.) and
// restructured. So the upstream "Files touched" list above is a starting
// pointer, not a target map. The agent driving the skill is expected to
// analyze the upstream change against the actual otto-cli tree and supply
// `implementationGuidance` prose (see SKILL.md → "Judgment calls"). When it is
// absent we render an explicit not-yet-analyzed banner so a thin issue is
// never mistaken for a ready-to-implement one.

function renderImplementationGuidance({ implementationGuidance }) {
  const text = (implementationGuidance ?? "").trim();
  if (!text) {
    return (
      "> ⚠️ **Not yet analyzed.** This issue carries upstream metadata only. " +
      "Before implementation, perform the per-commit otto-cli analysis " +
      "(see `.claude/skills/upstream-cherry-pick/SKILL.md` → *Judgment calls*) " +
      "and edit this section with: mapped otto-cli target file(s), whether the " +
      "code path still exists / has diverged, the concrete edits required, and " +
      "a cherry-pick-vs-manual-port call."
    );
  }
  return text;
}

function renderUpstreamDiff({ diff }) {
  const text = (diff ?? "").trim();
  if (!text) return "";
  return (
    "\n<details>\n<summary>Upstream diff (<code>git show</code>)</summary>\n\n" +
    "```diff\n" +
    text +
    "\n```\n</details>\n"
  );
}

// ---------------------------------------------------------------------------
// Fix strategy section builder
// ---------------------------------------------------------------------------

const STRATEGY_BLURB = {
  "direct-merge": "Cherry-pick / `git am -3` applies clean. Apply the upstream change; the reviewer checks fidelity to the upstream diff.",
  "adapted-port": "Same fix, transcribed to our renamed/restructured paths. The reviewer checks fidelity to the upstream diff against the mapped files.",
  "essence-reimplement": "otto-cli has diverged in **behavior** — the upstream patch will not apply. **Re-solve the upstream root cause in our code; do not transcribe the diff.** The reviewer gate checks *\"does this address the upstream root cause?\"*, and the fix must author a root-cause regression test.",
  "not-needed": "The problem does not exist in our fork (justified by `Fork relevance: no`). Close without porting.",
};

function renderFixStrategy({ strategy }) {
  if (!strategy || !STRATEGY_BLURB[strategy]) return "";
  const blurb = STRATEGY_BLURB[strategy] ?? "";
  let out = `\n## Fix strategy\n\n**\`fix-strategy:${strategy}\`** — ${blurb}\n`;
  if (strategy === "essence-reimplement") {
    out +=
      "\n> ⚠️ **Essence to preserve.** This is a re-solve, not a transcribe. The " +
      "upstream diff is a reference for *intent*, not a target to match. Read the " +
      "guidance above for the documented essence (root cause + the property that " +
      "must hold), implement it the otto-cli way, and pin it with a new regression " +
      "test against our code.\n";
  }
  return out;
}

// ---------------------------------------------------------------------------
// Alignment section builder (Phase 6 §3)
// ---------------------------------------------------------------------------

const ALIGNMENT_BLURB = {
  core: "advances the co-worker direction → port.",
  adjacent: "useful but off the critical path → defer.",
  "out-of-scope": "coding-assistant-only or ethos-conflicting → surface for a human to close.",
};

function renderAlignment({ classification, alignment }) {
  if (!isFeatureSeverity(classification.severity)) return "";
  const blurb = ALIGNMENT_BLURB[alignment];
  if (!blurb) return "";
  return (
    `\n## Alignment\n\n**\`alignment:${alignment}\`** — ${blurb} ` +
    "See `docs/OTTO-ALIGNMENT.md` §5. Advisory — a human makes the final call; nothing is auto-closed.\n"
  );
}

// ---------------------------------------------------------------------------
// Body builder  §11.3
// ---------------------------------------------------------------------------

function buildBody({ commit, classification, conflictRisk, upstream, prContext, issueContexts, ccUser, heavyFiles, implementationGuidance, diff, strategy, alignment }) {
  const today = new Date().toISOString().slice(0, 10);
  const sha7 = shortSha(commit.sha);
  const severityKebab = toKebab(classification.severity);
  const riskKebab = toKebab(conflictRisk.risk);
  const typeLabel =
    typeLabelFor(strategy) ??
    (conflictRisk.risk === "HIGH" ? "type:port-required" : "type:cherry-pick-candidate");

  const subjectDisplay = truncateSubject(commit.subject ?? "");
  const commitBody = (commit.body ?? "").trim() || "(none)";

  const upstreamContextSection = renderUpstreamContext({ prContext, issueContexts, upstream });
  const filesTouchedSection = renderFilesTouched({ commit, heavyFiles });
  const fileCount = (commit.touchedFiles ?? []).length;
  const guidanceSection = renderImplementationGuidance({ implementationGuidance });
  const diffSection = renderUpstreamDiff({ diff });
  const fixStrategySection = renderFixStrategy({ strategy });
  const alignmentSection = renderAlignment({ classification, alignment });
  const analyzed = Boolean((implementationGuidance ?? "").trim());

  const upgradeSection =
    classification.upgradeReason
      ? `\n### Why this was upgraded\n- ${classification.upgradeReason}\n`
      : "";

  return `> /cc ${ccUser} — auto-filed by \`/upstream-cherry-pick\`. Severity, labels,
> conflict-risk, and the otto-cli implementation guidance below are populated
> so the implementation phase can **confirm and apply** rather than start from
> scratch. Pick this up via \`/upstream-port-from-issue {{N}}\` when ready.

## otto-cli implementation guidance

${guidanceSection}
${diffSection}${fixStrategySection}${alignmentSection}
## Classification

| Field | Value |
|---|---|
| Severity | \`severity:${severityKebab}\` |
| Conflict risk | \`conflict-risk:${riskKebab}\` — ${conflictRisk.reason} |
| Action | \`${typeLabel}\` |
| Analyzed | ${analyzed ? "yes — guidance above is implementation-ready" : "no — guidance above is a placeholder"} |
| Upstream | ${upstream.ghRepo} |

## Upstream commit

- **SHA**: \`${commit.sha}\`
- **Date**: ${commit.date}
- **Author**: ${commit.author}
- **Subject**: \`${subjectDisplay}\`
- **Body**:

\`\`\`
${commitBody}
\`\`\`

## Upstream context

${upstreamContextSection}
${upgradeSection}
## Upstream files touched (${fileCount})

> ⚠️ These are **upstream** paths. otto-cli has renamed/restructured packages
> (e.g. \`packages/ai\` → \`packages/pi-ai\`). The otto-cli targets are in the
> implementation guidance section above, not here.

${filesTouchedSection}

## Suggested next steps

\`\`\`sh
# Inspect upstream change
git -C ${upstream.path ?? `../${upstream.name}`} show ${sha7}

# Attempt cherry-pick (only if guidance says paths align)
git -C ${upstream.path ?? `../${upstream.name}`} show ${sha7} | git -C . am -3

# Or hand off to the port workflow
/upstream-port-from-issue {{N}}
\`\`\`

---

Auto-filed on ${today} by the upstream-cherry-pick skill.
Dedup key: \`[sha=${sha7}]\`.`;
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export function buildIssuePayload({
  commit,
  classification,
  conflictRisk,
  upstream,
  prContext = null,
  issueContexts = [],
  ccUser = "@claude",
  heavyFiles = null,
  implementationGuidance = null,
  diff = null,
  strategy = null,
  alignment = null,
}) {
  const title = buildTitle({ commit, classification, upstream });
  const labels = buildLabels({ classification, conflictRisk, upstream, strategy, alignment });
  const body = buildBody({
    commit,
    classification,
    conflictRisk,
    upstream,
    prContext,
    issueContexts,
    ccUser,
    heavyFiles,
    implementationGuidance,
    diff,
    strategy,
    alignment,
  });

  return { title, body, labels };
}

// ---------------------------------------------------------------------------
// CLI mode: node build-issue-payload.mjs < input.json
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  let stdin = "";
  process.stdin.on("data", (c) => (stdin += c));
  process.stdin.on("end", () => {
    try {
      const input = JSON.parse(stdin);
      // Deserialize heavyFiles from array → Set if provided
      if (Array.isArray(input.heavyFiles)) {
        input.heavyFiles = new Set(input.heavyFiles);
      }
      const result = buildIssuePayload(input);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } catch (err) {
      process.stderr.write(JSON.stringify({ error: err.message, details: err.stack }) + "\n");
      process.exit(1);
    }
  });
}
