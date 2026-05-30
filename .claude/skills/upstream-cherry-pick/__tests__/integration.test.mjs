import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { run } from "../bin/run.mjs";

// ─── Git helpers ──────────────────────────────────────────────────────────────

function gitInRepo(dir, ...args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf-8" });
}

// ─── Fixture builders ─────────────────────────────────────────────────────────

function setupOttoRoot(tmpRoot) {
  const ottoRoot = join(tmpRoot, "otto-cli");
  mkdirSync(join(ottoRoot, ".planning"), { recursive: true });
  mkdirSync(join(ottoRoot, "docs"), { recursive: true });

  // Real git repo so the preflight git-repo check passes with real cmdRunner
  execFileSync("git", ["-C", ottoRoot, "init", "-q", "-b", "main"], { encoding: "utf-8" });
  execFileSync("git", ["-C", ottoRoot, "config", "user.email", "test@example.com"], { encoding: "utf-8" });
  execFileSync("git", ["-C", ottoRoot, "config", "user.name", "Test"], { encoding: "utf-8" });

  writeFileSync(
    join(ottoRoot, "docs", "UPSTREAM-SYNC.md"),
    [
      "# Upstream Sync Ledger",
      "",
      "## Vendored package divergence status",
      "",
      "| Package | Diverged? | ... |",
      "| --- | --- | --- |",
      "| `packages/pi-coding-agent` | **Heavy** | High |",
      "",
      "## File-level patch log",
      "",
      "### `packages/pi-coding-agent/src/index.ts`",
      "",
      "- entry",
      "",
    ].join("\n"),
  );
  return ottoRoot;
}

/**
 * Seed an upstream git repo with 6 commits covering all classification buckets:
 *   1. CRITICAL_SECURITY  — CVE in subject
 *   2. CRITICAL_STABILITY — crash in subject
 *   3. FEATURE            — feat: prefix
 *   4. NICE_TO_HAVE_FIX   — fix: prefix with #42 reference
 *   5. SKIP               — chore: prefix
 *   6. NOT_APPLICABLE     — bun.config.ts only (bun-distribution rule)
 *
 * Returns { dir, baseSha } where baseSha is the initial commit SHA
 * (used as lastAnalyzedCommit to seed state).
 */
function setupUpstreamRepo(tmpRoot, name) {
  const dir = join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["-C", dir, "init", "-q", "-b", "main"], { encoding: "utf-8" });
  execFileSync("git", ["-C", dir, "config", "user.email", "test@example.com"], { encoding: "utf-8" });
  execFileSync("git", ["-C", dir, "config", "user.name", "Test"], { encoding: "utf-8" });

  // Initial commit — this becomes the baseline lastAnalyzedCommit
  writeFileSync(join(dir, "README.md"), "initial\n");
  gitInRepo(dir, "add", "README.md");
  gitInRepo(dir, "commit", "-q", "-m", "initial commit");
  const baseSha = gitInRepo(dir, "rev-parse", "HEAD").trim();

  // 1. CRITICAL_SECURITY — CVE keyword in subject
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "auth.ts"), "// auth fix\n");
  gitInRepo(dir, "add", "src/auth.ts");
  gitInRepo(dir, "commit", "-q", "-m", "fix: patch CVE-2026-12345 in oauth flow");

  // 2. CRITICAL_STABILITY — crash keyword in subject
  writeFileSync(join(dir, "src", "parser.ts"), "// parser\n");
  gitInRepo(dir, "add", "src/parser.ts");
  gitInRepo(dir, "commit", "-q", "-m", "fix: prevent crash on empty input");

  // 3. FEATURE
  writeFileSync(join(dir, "src", "feature.ts"), "// feat\n");
  gitInRepo(dir, "add", "src/feature.ts");
  gitInRepo(dir, "commit", "-q", "-m", "feat(api): add new endpoint");

  // 4. NICE_TO_HAVE_FIX with issue reference
  writeFileSync(join(dir, "src", "ui.ts"), "// ui\n");
  gitInRepo(dir, "add", "src/ui.ts");
  gitInRepo(dir, "commit", "-q", "-m", "fix(ui): truncate long labels (#42)");

  // 5. SKIP — chore: prefix matches skipPrefixes
  writeFileSync(join(dir, "package.json"), '{"name":"x"}\n');
  gitInRepo(dir, "add", "package.json");
  gitInRepo(dir, "commit", "-q", "-m", "chore: bump deps");

  // 6. NOT_APPLICABLE — bun.config.ts only (filePathRegex matches bun-distribution rule)
  writeFileSync(join(dir, "bun.config.ts"), "// bun\n");
  gitInRepo(dir, "add", "bun.config.ts");
  gitInRepo(dir, "commit", "-q", "-m", "build: add bun config for compile target");

  return { dir, baseSha };
}

function makeConfig(upstreamPath) {
  return {
    version: 1,
    targetRepo: "test/target",
    divergenceLedger: "docs/UPSTREAM-SYNC.md",
    upstreams: {
      "test-upstream": {
        path: upstreamPath,
        ghRepo: "fake/upstream",
        branch: "main",
        label: "test",
      },
    },
    issueFiling: {
      ccUser: "@claude",
      defaultStatusLabel: "status:triaged",
      filePolicy: {
        CRITICAL_SECURITY: "always",
        CRITICAL_STABILITY: "always",
        NICE_TO_HAVE_FIX: "always",
        FEATURE: "always",
        SKIP: "never",
      },
    },
    classifier: {
      securityRegex:
        "(?i)\\b(cve|vulnerab|auth\\s*bypass|sandbox\\s*escape|secret\\s*leak|exfiltr|rce|injection|xss|csrf)\\b",
      stabilityRegex:
        "(?i)\\b(crash|hang|oom|infinite\\s*loop|data\\s*loss|corrupt|lockup|deadlock|panic|unrecover)\\b",
      skipPrefixes: ["chore:", "docs:", "test:", "ci:", "style:", "refactor:", "build:"],
    },
    applicability: {
      notApplicable: [
        {
          id: "bun-distribution",
          reason: "OTTO is npm-only.",
          matchAny: {
            subjectRegex:
              "(?i)\\b(bun build|bun --compile|bun upgrade|bun install|bun config)\\b",
            filePathRegex: "(bun\\.config|\\.bunfig|bun-build|/bun/)",
          },
        },
      ],
    },
  };
}

/**
 * Build a stub ghRunner and cmdRunner that intercept all gh/cmd calls without
 * hitting any real network or host CLIs, except for real `git` calls which are
 * forwarded to the actual git binary (so harvestCommits works on fixture repos).
 */
function buildGhStub() {
  const calls = [];

  const ghRunner = (args) => {
    calls.push([...args]);

    // Preflight: auth check
    if (args[0] === "auth" && args[1] === "status") {
      return "Logged in to github.com\nToken scopes: 'repo', 'read:org'\n";
    }
    // Preflight: repo reachability
    if (args[0] === "repo" && args[1] === "view") {
      return "https://github.com/fake/repo\n";
    }
    // Label management
    if (args[0] === "label" && args[1] === "list") return "";
    if (args[0] === "label" && args[1] === "create") return "";
    // Dedup check — return empty array (no existing issues)
    if (args[0] === "issue" && args[1] === "list") return "[]";
    // Issue creation — return a predictable URL (should not be called in dry-run)
    if (args[0] === "issue" && args[1] === "create") {
      const n = 100 + calls.filter((a) => a[0] === "issue" && a[1] === "create").length;
      return `https://github.com/test/target/issues/${n}\n`;
    }
    // Context fetch stubs — throw so fetchPrContext treats it as "no context"
    if (args[0] === "pr" && args[1] === "view") throw new Error("no PR");
    if (args[0] === "issue" && args[1] === "view") throw new Error("no issue");
    return "";
  };

  const cmdRunner = (cmd, args) => {
    // Tool existence checks (preflight: gh-on-path, git-on-path)
    if ((cmd === "which" || cmd === "where") && (args[0] === "gh" || args[0] === "git")) {
      return "/usr/bin/" + args[0] + "\n";
    }
    // All git commands are forwarded to the real git binary so that
    // harvestCommits and preflight git-repo/upstream-paths checks work on real
    // fixture repos.
    if (cmd === "git") {
      return execFileSync("git", args, { encoding: "utf-8" });
    }
    return "";
  };

  return { ghRunner, cmdRunner, calls };
}

// ─── Integration test ─────────────────────────────────────────────────────────

test("full pipeline classifies 6 commits into correct buckets (dry-run)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ucp-int-"));
  try {
    const ottoRoot = setupOttoRoot(tmp);
    const { dir: upstreamDir, baseSha } = setupUpstreamRepo(tmp, "upstream");

    // Write config referencing the fixture upstream repo
    writeFileSync(
      join(ottoRoot, ".planning", "upstream-sync-config.json"),
      JSON.stringify(makeConfig(upstreamDir)),
    );

    // Seed state: lastAnalyzedCommit = initial commit SHA
    writeFileSync(
      join(ottoRoot, ".planning", "upstream-sync-state.json"),
      JSON.stringify({
        version: 1,
        upstreams: { "test-upstream": { lastAnalyzedCommit: baseSha } },
      }),
    );

    const { ghRunner, cmdRunner, calls } = buildGhStub();

    const result = await run({
      args: ["test-upstream", "--dry-run", "--no-issue-context"],
      cwd: ottoRoot,
      ghRunner,
      cmdRunner,
      todayIso: "2026-05-30",
    });

    assert.equal(
      result.exitCode,
      0,
      `expected exit 0, got ${result.exitCode}: ${result.error ?? JSON.stringify(result)}`,
    );

    // ── Dry-run must not file any issues ────────────────────────────────────────
    const issueCreates = calls.filter((a) => a[0] === "issue" && a[1] === "create");
    assert.equal(issueCreates.length, 0, "dry-run must not invoke gh issue create");

    // ── Results object reflects correct classification breakdown ───────────────
    const r = result.results?.["test-upstream"];
    assert.ok(r, "results should contain test-upstream entry");
    assert.equal(r.filed, 4, `expected 4 filed (security+stability+feature+fix), got ${r.filed}`);
    assert.equal(r.skipped, 1, `expected 1 skipped (chore), got ${r.skipped}`);
    assert.equal(r.notApplicable, 1, `expected 1 notApplicable (bun config), got ${r.notApplicable}`);
    assert.equal(r.unclassified, 0, `expected 0 unclassified, got ${r.unclassified}`);

    // ── Report file written at expected path ───────────────────────────────────
    const expectedReportPath = join(
      ottoRoot,
      ".planning",
      "upstream-audits",
      "2026-05-30-test-upstream-audit.md",
    );
    assert.ok(existsSync(expectedReportPath), `report file should exist at ${expectedReportPath}`);

    const reportMd = readFileSync(expectedReportPath, "utf-8");

    // Header
    assert.match(reportMd, /# Upstream audit — test-upstream — 2026-05-30/);

    // Summary counts
    assert.match(reportMd, /\*\*Issues filed\*\*: 4/);
    assert.match(reportMd, /\*\*Not applicable to OTTO\*\*: 1/);
    assert.match(reportMd, /\*\*Skipped \(mechanical\)\*\*: 1/);

    // Section headings with correct counts
    assert.match(reportMd, /## Critical — security \(1\)/);
    assert.match(reportMd, /## Critical — stability \(1\)/);
    assert.match(reportMd, /## Features \(1\)/);
    assert.match(reportMd, /## Nice-to-have fixes \(1\)/);
    assert.match(reportMd, /## Not applicable to OTTO \(1\)/);
    assert.match(reportMd, /## Skipped \(1\)/);

    // CVE commit should appear in the security section
    assert.match(reportMd, /CVE-2026-12345/);

    // bun-distribution rule should appear in the not-applicable table
    assert.match(reportMd, /bun-distribution/);

    // ── State file is NOT advanced in dry-run ──────────────────────────────────
    const stateRaw = JSON.parse(
      readFileSync(join(ottoRoot, ".planning", "upstream-sync-state.json"), "utf-8"),
    );
    assert.equal(
      stateRaw.upstreams?.["test-upstream"]?.lastAnalyzedCommit,
      baseSha,
      "dry-run must not advance lastAnalyzedCommit in state",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
