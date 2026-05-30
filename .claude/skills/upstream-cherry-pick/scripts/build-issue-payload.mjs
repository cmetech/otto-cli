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

/** Map a machine-readable verdict to its type:* label, or null if absent/unknown. */
function verdictToTypeLabel(verdict) {
  switch ((verdict ?? "").toLowerCase().trim()) {
    case "cherry-pick":
      return "type:cherry-pick-candidate";
    case "manual-port":
      return "type:port-required";
    case "do-not-port":
      return "type:do-not-port";
    default:
      return null;
  }
}

function buildLabels({ classification, conflictRisk, upstream, verdict }) {
  const severityKebab = toKebab(classification.severity);
  const riskKebab = toKebab(conflictRisk.risk);

  // The analyzed verdict, when present, is authoritative over the deterministic
  // risk-based fallback (HIGH → port-required, else cherry-pick-candidate).
  const typeLabel =
    verdictToTypeLabel(verdict) ??
    (conflictRisk.risk === "HIGH" ? "type:port-required" : "type:cherry-pick-candidate");

  return [
    `upstream:${upstream.name}`,
    typeLabel,
    `severity:${severityKebab}`,
    `conflict-risk:${riskKebab}`,
    "status:triaged",
  ];
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
// Body builder  §11.3
// ---------------------------------------------------------------------------

function buildBody({ commit, classification, conflictRisk, upstream, prContext, issueContexts, ccUser, heavyFiles, implementationGuidance, diff, verdict }) {
  const today = new Date().toISOString().slice(0, 10);
  const sha7 = shortSha(commit.sha);
  const severityKebab = toKebab(classification.severity);
  const riskKebab = toKebab(conflictRisk.risk);
  const typeLabel =
    verdictToTypeLabel(verdict) ??
    (conflictRisk.risk === "HIGH" ? "type:port-required" : "type:cherry-pick-candidate");

  const subjectDisplay = truncateSubject(commit.subject ?? "");
  const commitBody = (commit.body ?? "").trim() || "(none)";

  const upstreamContextSection = renderUpstreamContext({ prContext, issueContexts, upstream });
  const filesTouchedSection = renderFilesTouched({ commit, heavyFiles });
  const fileCount = (commit.touchedFiles ?? []).length;
  const guidanceSection = renderImplementationGuidance({ implementationGuidance });
  const diffSection = renderUpstreamDiff({ diff });
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
${diffSection}
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
  verdict = null,
}) {
  const title = buildTitle({ commit, classification, upstream });
  const labels = buildLabels({ classification, conflictRisk, upstream, verdict });
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
    verdict,
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
