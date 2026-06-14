import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIssuePayload } from "../build-issue-payload.mjs";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const upstream = { name: "pi-dev", ghRepo: "earendil-works/pi" };

function makeCommit(overrides = {}) {
  return {
    sha: "a3f9c12deadbeef",
    author: "@jeremymcs",
    date: "2026-05-25",
    subject: "fix(auth): redact tokens in error envelopes",
    body: "Tokens were being logged in plain text.",
    touchedFiles: ["packages/pi-coding-agent/src/core/settings-manager.ts", "src/cli.ts"],
    locByFile: { "packages/pi-coding-agent/src/core/settings-manager.ts": 10, "src/cli.ts": 5 },
    refs: [],
    ...overrides,
  };
}

function makeClassification(severity = "NICE_TO_HAVE_FIX", extras = {}) {
  return { severity, ...extras };
}

function makeRisk(risk = "LOW", reason = "Touches packages/pi-* but no HeavyFile.") {
  return { risk, reason };
}

// ---------------------------------------------------------------------------
// Test 1: Title subject truncation (100-char subject → 80 chars + ellipsis)
// ---------------------------------------------------------------------------

test("title truncates long subject to 80 chars with ellipsis", () => {
  const longSubject = "x".repeat(100); // 100 chars, well over 80
  const commit = makeCommit({ subject: longSubject });
  const { title } = buildIssuePayload({
    commit,
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk("NONE", "no pi paths"),
    upstream,
    ccUser: "@claude",
  });

  // The subject portion of the title is what appears between the emoji and [sha=...]
  // Full format: [upstream/pi-dev] ✨ <subject-part> [sha=a3f9c12]
  // Subject portion must be at most 80 chars (77 + "…" = 80 when truncated)
  const sha7 = "a3f9c12";
  const prefix = `[upstream/${upstream.name}] ✨ `;
  const suffix = ` [sha=${sha7}]`;
  assert.ok(title.startsWith(prefix), `Title should start with prefix. Got: ${title}`);
  assert.ok(title.endsWith(suffix), `Title should end with sha. Got: ${title}`);

  const subjectPart = title.slice(prefix.length, title.length - suffix.length);
  // Truncation: 77 chars + "…" = 78 visible chars — must be ≤ 80 and must end with ellipsis
  assert.ok(
    subjectPart.length <= 80,
    `Subject part should be at most 80 chars, got ${subjectPart.length}`,
  );
  assert.ok(subjectPart.endsWith("…"), "Truncated subject should end with ellipsis");
  // Confirm the original 100-char subject was actually truncated
  assert.ok(
    subjectPart.length < 100,
    `Subject (${subjectPart.length} chars) should be shorter than the 100-char input`,
  );
});

// ---------------------------------------------------------------------------
// Test 2: Severity emoji — all 5 severities
// ---------------------------------------------------------------------------

test("emoji: CRITICAL_SECURITY → 🛡️", () => {
  const { title } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("CRITICAL_SECURITY"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(title.includes("🛡️"), `Expected 🛡️ in title, got: ${title}`);
});

test("emoji: CRITICAL_STABILITY → 🐛", () => {
  const { title } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("CRITICAL_STABILITY"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(title.includes("🐛"), `Expected 🐛 in title, got: ${title}`);
});

test("emoji: NICE_TO_HAVE_FIX → 🩹", () => {
  const { title } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("NICE_TO_HAVE_FIX"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(title.includes("🩹"), `Expected 🩹 in title, got: ${title}`);
});

test("emoji: FEATURE → ✨", () => {
  const { title } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(title.includes("✨"), `Expected ✨ in title, got: ${title}`);
});

test("emoji: SKIP → ❓", () => {
  const { title } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("SKIP"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(title.includes("❓"), `Expected ❓ in title, got: ${title}`);
});

test("emoji: UNCLASSIFIED → ❓", () => {
  const { title } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("UNCLASSIFIED"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(title.includes("❓"), `Expected ❓ in title, got: ${title}`);
});

// ---------------------------------------------------------------------------
// Test 3: Labels for CRITICAL_SECURITY + RISK=NONE
// ---------------------------------------------------------------------------

test("labels include all expected values for CRITICAL_SECURITY + risk:none", () => {
  const { labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("CRITICAL_SECURITY"),
    conflictRisk: makeRisk("NONE", "no pi paths"),
    upstream: { name: "pi-dev", ghRepo: "earendil-works/pi" },
    ccUser: "@claude",
  });

  assert.ok(labels.includes("severity:critical-security"), `Missing severity label. Got: ${labels}`);
  assert.ok(labels.includes("type:cherry-pick-candidate"), `Missing type label. Got: ${labels}`);
  assert.ok(labels.includes("conflict-risk:none"), `Missing conflict-risk label. Got: ${labels}`);
  assert.ok(labels.includes("status:triaged"), `Missing status label. Got: ${labels}`);
  assert.ok(labels.includes("upstream:pi-dev"), `Missing upstream label. Got: ${labels}`);
});

// ---------------------------------------------------------------------------
// Test 4: HIGH conflict risk → type:port-required instead of cherry-pick-candidate
// ---------------------------------------------------------------------------

test("labels use type:port-required for HIGH conflict risk", () => {
  const { labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("CRITICAL_STABILITY"),
    conflictRisk: makeRisk("HIGH", "Touches HeavyFile with >50 LOC."),
    upstream,
    ccUser: "@claude",
  });

  assert.ok(labels.includes("type:port-required"), `Expected type:port-required. Got: ${labels}`);
  assert.ok(!labels.includes("type:cherry-pick-candidate"), `Should NOT have cherry-pick label. Got: ${labels}`);
  assert.ok(labels.includes("conflict-risk:high"), `Expected conflict-risk:high. Got: ${labels}`);
});

// ---------------------------------------------------------------------------
// Test 5: Body contains key content — @cc, dedup key, SHA, subject, cherry-pick cmd
// ---------------------------------------------------------------------------

test("body contains cc, dedup key, SHA, subject, and cherry-pick command", () => {
  const commit = makeCommit({
    sha: "03e229d4b1c9c9a4",
    subject: "fix(auth): redact tokens in error envelopes",
  });
  const { body } = buildIssuePayload({
    commit,
    classification: makeClassification("NICE_TO_HAVE_FIX"),
    conflictRisk: makeRisk("LOW", "touches pi-*"),
    upstream,
    ccUser: "@claude",
  });

  assert.ok(body.includes("@claude"), "Body must contain cc user @claude");
  assert.ok(body.includes("[sha=03e229d]"), "Body must contain the dedup key with 7-char sha");
  assert.ok(body.includes("03e229d4b1c9c9a4"), "Body must contain the full SHA");
  assert.ok(body.includes("fix(auth): redact tokens in error envelopes"), "Body must contain the subject");
  // Cherry-pick command uses git show <sha7> | git -C . am -3
  assert.ok(body.includes("git -C ../pi-dev show 03e229d"), "Body must contain cherry-pick inspect command");
  assert.ok(body.includes("| git -C . am -3"), "Body must contain cherry-pick apply command");
  // Port workflow line (literal {{N}})
  assert.ok(body.includes("/upstream-port-from-issue {{N}}"), "Body must contain the port-from-issue command with literal {{N}}");
});

// ---------------------------------------------------------------------------
// Test 6: PR context is rendered when present
// ---------------------------------------------------------------------------

test("PR context is rendered when prContext is provided", () => {
  const prContext = {
    data: {
      number: 138,
      title: "fix: redact tokens in envelopes",
      state: "MERGED",
      labels: [{ name: "bug" }, { name: "regression" }],
      body: "This PR fixes the token redaction issue reported in #137.",
      reviews: [],
      comments: [],
    },
  };
  const { body } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("NICE_TO_HAVE_FIX"),
    conflictRisk: makeRisk(),
    upstream,
    prContext,
    issueContexts: [],
    ccUser: "@claude",
  });

  assert.ok(body.includes("fix: redact tokens in envelopes"), "Body must include PR title");
  assert.ok(body.includes("merged"), "Body must include PR state (lowercased)");
  assert.ok(body.includes("bug"), "Body must include PR label: bug");
  assert.ok(body.includes("regression"), "Body must include PR label: regression");
});

// ---------------------------------------------------------------------------
// Test 7: HeavyFile marker appears next to matched files
// ---------------------------------------------------------------------------

test("heavyFiles Set causes ⚠️ HeavyFile marker on matching files", () => {
  const heavyFiles = new Set(["foo.ts"]);
  const commit = makeCommit({
    touchedFiles: ["foo.ts", "bar.ts"],
  });
  const { body } = buildIssuePayload({
    commit,
    classification: makeClassification("NICE_TO_HAVE_FIX"),
    conflictRisk: makeRisk("MEDIUM", "touches HeavyFile"),
    upstream,
    ccUser: "@claude",
    heavyFiles,
  });

  // foo.ts must have the warning; bar.ts must NOT
  assert.ok(body.includes("`foo.ts` ⚠️ HeavyFile"), `Expected ⚠️ next to foo.ts. Snippet:\n${body}`);
  const barLine = body.split("\n").find((l) => l.includes("bar.ts")) ?? "";
  assert.ok(!barLine.includes("⚠️"), `bar.ts should NOT have ⚠️ marker. Line: ${barLine}`);
});

// ---------------------------------------------------------------------------
// Additional tests for completeness
// ---------------------------------------------------------------------------

test("title uses 7-char SHA", () => {
  const commit = makeCommit({ sha: "abcdef1234567890" });
  const { title } = buildIssuePayload({
    commit,
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(title.includes("[sha=abcdef1]"), `Title must contain 7-char sha. Got: ${title}`);
});

test("short subject (under 80 chars) is not truncated", () => {
  const subject = "fix: short subject";
  const commit = makeCommit({ subject });
  const { title } = buildIssuePayload({
    commit,
    classification: makeClassification("NICE_TO_HAVE_FIX"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(title.includes(subject), "Short subject should appear verbatim in title");
  assert.ok(!title.includes("…"), "Short subject should not be truncated");
});

test("newlines in subject are stripped before truncation", () => {
  const subject = "fix: line1\nline2\nline3";
  const commit = makeCommit({ subject });
  const { title } = buildIssuePayload({
    commit,
    classification: makeClassification("NICE_TO_HAVE_FIX"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(!title.includes("\n"), "Title must not contain newlines");
  assert.ok(title.includes("fix: line1 line2 line3"), "Newlines in subject replaced with spaces");
});

test("body shows '(none)' when commit body is empty", () => {
  const commit = makeCommit({ body: "" });
  const { body } = buildIssuePayload({
    commit,
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(body.includes("(none)"), "Empty commit body should render as '(none)'");
});

test("issueContexts are rendered when provided and no prContext", () => {
  const issueContexts = [
    {
      data: {
        number: 137,
        title: "Tokens logged in plaintext",
        state: "CLOSED",
        labels: [{ name: "bug" }],
        body: "Steps to reproduce: run the CLI with --verbose.",
      },
    },
  ];
  const { body } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("NICE_TO_HAVE_FIX"),
    conflictRisk: makeRisk(),
    upstream,
    prContext: null,
    issueContexts,
    ccUser: "@claude",
  });

  assert.ok(body.includes("Tokens logged in plaintext"), "Issue title must appear in body");
  assert.ok(body.includes("closed"), "Issue state must appear lowercased");
  assert.ok(body.includes("bug"), "Issue label must appear");
});

test("no PR or issue context renders fallback message", () => {
  const { body } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk(),
    upstream,
    prContext: null,
    issueContexts: [],
    ccUser: "@claude",
  });
  assert.ok(body.includes("No upstream PR or issue context found."), "Fallback message should appear when no context");
});

test("upgradeReason appears in body when provided", () => {
  const { body } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("CRITICAL_STABILITY", { upgradeReason: "Labeled 'regression' → §8.3 upgrade" }),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(body.includes("regression"), "upgradeReason content should appear in body");
  assert.ok(body.includes("Why this was upgraded"), "Upgrade section heading should appear");
});

test("NICE_TO_HAVE_FIX and LOW risk → type:cherry-pick-candidate and conflict-risk:low", () => {
  const { labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("NICE_TO_HAVE_FIX"),
    conflictRisk: makeRisk("LOW", "touches pi-*"),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(labels.includes("type:cherry-pick-candidate"));
  assert.ok(labels.includes("conflict-risk:low"));
  assert.ok(labels.includes("severity:nice-to-have-fix"));
});

test("labels length is exactly 5", () => {
  const { labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk("MEDIUM", "reason"),
    upstream,
    ccUser: "@claude",
  });
  assert.equal(labels.length, 5, `Expected 5 labels, got ${labels.length}: ${labels}`);
});

test("body excerpt truncates long PR body to 200 chars + ellipsis", () => {
  const longBody = "A".repeat(250);
  const prContext = {
    data: {
      number: 1,
      title: "PR with very long body",
      state: "MERGED",
      labels: [],
      body: longBody,
      reviews: [],
      comments: [],
    },
  };
  const { body } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk(),
    upstream,
    prContext,
    ccUser: "@claude",
  });

  // The excerpt in the body should be 200 "A"s + "…"
  const excerpt = "A".repeat(200) + "…";
  assert.ok(body.includes(excerpt), "PR body excerpt should be truncated to 200 chars with ellipsis");
});

test("files touched section shows count", () => {
  const commit = makeCommit({
    touchedFiles: ["a.ts", "b.ts", "c.ts"],
  });
  const { body } = buildIssuePayload({
    commit,
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(body.includes("## Upstream files touched (3)"), "File count must match touchedFiles array length");
});

test("no heavyFiles arg → no ⚠️ markers in file list", () => {
  const commit = makeCommit({
    touchedFiles: ["packages/pi-coding-agent/src/core/settings-manager.ts"],
  });
  const { body } = buildIssuePayload({
    commit,
    classification: makeClassification("NICE_TO_HAVE_FIX"),
    conflictRisk: makeRisk("MEDIUM", "touches HeavyFile"),
    upstream,
    ccUser: "@claude",
    // no heavyFiles provided
  });
  assert.ok(!body.includes("⚠️ HeavyFile"), "Without heavyFiles param, no HeavyFile markers should appear in the file list");
});

test("implementationGuidance renders and marks the issue analyzed", () => {
  const { body } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("CRITICAL_STABILITY"),
    conflictRisk: makeRisk("NONE", "isolated"),
    upstream,
    ccUser: "@claude",
    implementationGuidance: "**Target:** `packages/pi-ai/src/foo.ts` — apply the same guard.",
  });
  assert.ok(body.includes("## otto-cli implementation guidance"), "guidance heading present");
  assert.ok(body.includes("**Target:** `packages/pi-ai/src/foo.ts`"), "guidance prose rendered");
  assert.ok(body.includes("| Analyzed | yes"), "Analyzed row reflects supplied guidance");
  assert.ok(!body.includes("Not yet analyzed"), "no placeholder when guidance supplied");
});

test("absent implementationGuidance renders the not-yet-analyzed banner", () => {
  const { body } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("NICE_TO_HAVE_FIX"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(body.includes("## otto-cli implementation guidance"), "guidance heading always present");
  assert.ok(body.includes("Not yet analyzed"), "placeholder banner shown when no guidance");
  assert.ok(body.includes("| Analyzed | no"), "Analyzed row reflects missing guidance");
});

test("diff is embedded in a collapsible details block when provided", () => {
  const { body } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("CRITICAL_STABILITY"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
    diff: "diff --git a/x b/x\n+added line",
  });
  assert.ok(body.includes("<summary>Upstream diff"), "diff details summary present");
  assert.ok(body.includes("+added line"), "diff content rendered");
});

// ---------------------------------------------------------------------------
// Phase 2: fix-strategy label + body section
// ---------------------------------------------------------------------------

test("strategy adds the fix-strategy:* label (labels become 6) and drives type", () => {
  const { labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("CRITICAL_STABILITY"),
    conflictRisk: makeRisk("LOW", "touches pi-*"),
    upstream,
    ccUser: "@claude",
    strategy: "essence-reimplement",
  });
  assert.ok(labels.includes("fix-strategy:essence-reimplement"), `Got: ${labels}`);
  assert.ok(labels.includes("type:port-required"), `Got: ${labels}`);
  assert.equal(labels.length, 6, `Expected 6 labels, got ${labels.length}: ${labels}`);
});

test("strategy not-needed routes type:do-not-port", () => {
  const { labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("NICE_TO_HAVE_FIX"),
    conflictRisk: makeRisk("HIGH", "heavy"),
    upstream,
    ccUser: "@claude",
    strategy: "not-needed",
  });
  assert.ok(labels.includes("fix-strategy:not-needed"), `Got: ${labels}`);
  assert.ok(labels.includes("type:do-not-port"), `Got: ${labels}`);
  assert.ok(!labels.includes("type:port-required"), `Got: ${labels}`);
});

test("no strategy → 5 labels, risk-based type (back-compat unchanged)", () => {
  const { labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk("MEDIUM", "reason"),
    upstream,
    ccUser: "@claude",
  });
  assert.equal(labels.length, 5, `Got: ${labels}`);
  assert.ok(!labels.some((l) => l.startsWith("fix-strategy:")), `Got: ${labels}`);
});

test("body renders a Fix strategy heading when strategy present", () => {
  const { body } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("CRITICAL_STABILITY"),
    conflictRisk: makeRisk("LOW", "touches pi-*"),
    upstream,
    ccUser: "@claude",
    strategy: "adapted-port",
    implementationGuidance: "strategy: adapted-port\n\nTranscribe the guard.",
  });
  assert.ok(body.includes("## Fix strategy"), "Fix strategy heading present");
  assert.ok(body.includes("fix-strategy:adapted-port"), "strategy value shown");
});

test("essence-reimplement renders an 'Essence to preserve' callout", () => {
  const { body } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("CRITICAL_STABILITY"),
    conflictRisk: makeRisk("LOW", "x"),
    upstream,
    ccUser: "@claude",
    strategy: "essence-reimplement",
    implementationGuidance: "strategy: essence-reimplement\n\n**Essence to preserve:** atomic write.",
  });
  assert.ok(body.includes("## Fix strategy"), "heading present");
  assert.ok(/Essence to preserve/i.test(body), "essence callout present");
  assert.ok(/re-solve|root cause/i.test(body), "callout signals re-solve, not transcribe");
});

test("no strategy → no Fix strategy heading (back-compat)", () => {
  const { body } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(!body.includes("## Fix strategy"), "no strategy section when strategy absent");
});

test("invalid-but-truthy strategy renders no Fix strategy heading and no fix-strategy label", () => {
  const { body, labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk("LOW", "x"),
    upstream,
    ccUser: "@claude",
    strategy: "garbage-not-a-real-strategy",
  });
  assert.ok(!body.includes("## Fix strategy"), "no heading for invalid strategy");
  assert.ok(!labels.some((l) => l.startsWith("fix-strategy:")), `Got: ${labels}`);
  assert.equal(labels.length, 5, `Got: ${labels}`);
});

// ---------------------------------------------------------------------------
// Alignment fit-check (Phase 6 §3) — feature-gated
// ---------------------------------------------------------------------------

test("feature candidate with alignment gets the alignment:* label + Alignment heading", () => {
  const { body, labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk("NONE", "no pi paths"),
    upstream,
    ccUser: "@claude",
    alignment: "adjacent",
  });
  assert.ok(labels.includes("alignment:adjacent"), `labels: ${labels}`);
  assert.match(body, /## Alignment/);
  assert.match(body, /alignment:adjacent/);
  assert.match(body, /OTTO-ALIGNMENT\.md/);
});

test("non-feature candidate never gets an alignment label even if one is passed", () => {
  const { body, labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("NICE_TO_HAVE_FIX"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
    alignment: "out-of-scope", // must be ignored — alignment is N/A for fixes
  });
  assert.ok(!labels.some((l) => l.startsWith("alignment:")), `labels: ${labels}`);
  assert.doesNotMatch(body, /## Alignment/);
});

test("feature candidate without an alignment verdict renders no alignment label", () => {
  const { labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(!labels.some((l) => l.startsWith("alignment:")), `labels: ${labels}`);
});
