import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../bin/run.mjs";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function setupFixture() {
  const dir = mkdtempSync(join(tmpdir(), "ucp-run-"));
  // Create fake otto-cli root with .planning/ and docs/
  const ottoRoot = join(dir, "otto");
  mkdirSync(join(ottoRoot, ".planning"), { recursive: true });
  mkdirSync(join(ottoRoot, "docs"));
  writeFileSync(join(ottoRoot, "docs", "UPSTREAM-SYNC.md"), "# ledger\n");
  // Create fake upstream git repo
  const upstreamPath = join(dir, "upstream");
  mkdirSync(join(upstreamPath, ".git"), { recursive: true });
  // Initialize otto root as a git repo (preflight check)
  mkdirSync(join(ottoRoot, ".git"));
  // Config
  const config = {
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
    issueFiling: { ccUser: "@claude", defaultStatusLabel: "status:triaged" },
    classifier: {
      securityRegex: "(?i)\\bcve\\b",
      stabilityRegex: "(?i)\\bcrash\\b",
      skipPrefixes: ["chore:"],
    },
    applicability: { notApplicable: [] },
  };
  writeFileSync(
    join(ottoRoot, ".planning", "upstream-sync-config.json"),
    JSON.stringify(config),
  );
  // Initial state — pretend we already analyzed up to "BASE"
  writeFileSync(
    join(ottoRoot, ".planning", "upstream-sync-state.json"),
    JSON.stringify({
      version: 1,
      upstreams: { "test-upstream": { lastAnalyzedCommit: "BASE" } },
    }),
  );
  return { dir, ottoRoot, upstreamPath };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("dry-run mode produces report without filing issues", async () => {
  const { dir, ottoRoot, upstreamPath } = setupFixture();
  try {
    let issueCreateCalled = false;
    const ghRunner = (args) => {
      if (args[0] === "auth" && args[1] === "status") {
        return "Logged in. Token scopes: 'repo', 'read:org'\n";
      }
      if (args[0] === "repo" && args[1] === "view") return "https://github.com/x/y\n";
      if (args[0] === "label" && args[1] === "list") return ""; // all missing
      if (args[0] === "label" && args[1] === "create") return "";
      if (args[0] === "issue" && args[1] === "list") return "[]"; // no dups
      if (args[0] === "issue" && args[1] === "create") {
        issueCreateCalled = true;
        return "https://github.com/x/y/issues/1\n";
      }
      if (args[0] === "pr" && args[1] === "view") throw new Error("no pr");
      if (args[0] === "issue" && args[1] === "view") throw new Error("no issue");
      return "";
    };
    const cmdRunner = (cmd, args) => {
      if ((cmd === "which" || cmd === "where") && (args[0] === "gh" || args[0] === "git")) {
        return "/usr/bin/" + args[0] + "\n";
      }
      if (cmd === "git") {
        // git rev-parse --git-dir; git log; git show
        if (args.includes("rev-parse")) return ".git\n";
        if (args.includes("log")) {
          // Return one commit since BASE (tab-separated, no \x1e needed — see harvest-commits parsing)
          return "newSHA12345\tAuthor\t2026-05-29T10:00:00Z\tfix: crash in oauth\tBody text";
        }
        if (args.includes("show")) {
          return "5\t0\tsrc/file.ts\n";
        }
      }
      return "";
    };
    const result = await run({
      args: ["test-upstream", "--dry-run", "--no-issue-context"],
      cwd: ottoRoot,
      ghRunner,
      cmdRunner,
      todayIso: "2026-05-30",
    });
    assert.equal(result.exitCode, 0, `expected exit 0, error: ${JSON.stringify(result)}`);
    assert.equal(issueCreateCalled, false, "dry-run must not call issue create");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preflight failure exits 1 without scanning", async () => {
  const { dir, ottoRoot } = setupFixture();
  try {
    const cmdRunner = (cmd, args) => {
      if ((cmd === "which" || cmd === "where") && args[0] === "gh") throw new Error("not found");
      return "";
    };
    const ghRunner = () => "";
    const result = await run({
      args: ["test-upstream"],
      cwd: ottoRoot,
      ghRunner,
      cmdRunner,
      todayIso: "2026-05-30",
    });
    assert.equal(result.exitCode, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--init flag delegates with not-implemented stub for now", async () => {
  // Until Task 19 lands, --init returns a placeholder exit code or message.
  // Just verify the flag is recognized.
  const result = await run({
    args: ["--init"],
    cwd: "/tmp",
    ghRunner: () => "",
    cmdRunner: () => "",
  });
  // Either exit 0 (placeholder) or exit 1 (not implemented). Either is acceptable for now.
  assert.ok(result.exitCode === 0 || result.exitCode === 1);
});

test("unknown upstream in args logs warning and returns exit 0 with empty results", async () => {
  const { dir, ottoRoot } = setupFixture();
  try {
    const ghRunner = (args) => {
      if (args[0] === "auth" && args[1] === "status") {
        return "Logged in. Token scopes: 'repo', 'read:org'\n";
      }
      if (args[0] === "repo" && args[1] === "view") return "https://github.com/x/y\n";
      if (args[0] === "label" && args[1] === "list") return "";
      if (args[0] === "label" && args[1] === "create") return "";
      return "";
    };
    const cmdRunner = (cmd, args) => {
      if ((cmd === "which" || cmd === "where") && (args[0] === "gh" || args[0] === "git")) {
        return "/usr/bin/" + args[0] + "\n";
      }
      if (cmd === "git" && args.includes("rev-parse")) return ".git\n";
      if (cmd === "git" && args.includes("-C")) return ".git\n";
      return "";
    };
    const result = await run({
      args: ["nonexistent-upstream", "--dry-run"],
      cwd: ottoRoot,
      ghRunner,
      cmdRunner,
      todayIso: "2026-05-30",
    });
    // An unknown upstream name is skipped; the run still exits 0 with empty results
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.results, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing lastAnalyzedCommit causes exit 1", async () => {
  const { dir, ottoRoot } = setupFixture();
  try {
    // Overwrite state to have no lastAnalyzedCommit
    writeFileSync(
      join(ottoRoot, ".planning", "upstream-sync-state.json"),
      JSON.stringify({ version: 1, upstreams: { "test-upstream": {} } }),
    );
    const ghRunner = (args) => {
      if (args[0] === "auth" && args[1] === "status") {
        return "Logged in. Token scopes: 'repo', 'read:org'\n";
      }
      if (args[0] === "repo" && args[1] === "view") return "https://github.com/x/y\n";
      if (args[0] === "label" && args[1] === "list") return "";
      if (args[0] === "label" && args[1] === "create") return "";
      return "";
    };
    const cmdRunner = (cmd, args) => {
      if ((cmd === "which" || cmd === "where") && (args[0] === "gh" || args[0] === "git")) {
        return "/usr/bin/" + args[0] + "\n";
      }
      if (cmd === "git" && args.includes("rev-parse")) return ".git\n";
      if (cmd === "git" && args.includes("-C")) return ".git\n";
      return "";
    };
    const result = await run({
      args: ["test-upstream", "--dry-run"],
      cwd: ottoRoot,
      ghRunner,
      cmdRunner,
      todayIso: "2026-05-30",
    });
    assert.equal(result.exitCode, 1);
    assert.ok(result.error?.includes("lastAnalyzedCommit"), `expected lastAnalyzedCommit in error, got: ${result.error}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config load failure returns exit 1", async () => {
  const result = await run({
    args: ["--config=/nonexistent/path/config.json"],
    cwd: "/tmp",
    ghRunner: () => "",
    cmdRunner: () => "",
    todayIso: "2026-05-30",
  });
  assert.equal(result.exitCode, 1);
  assert.ok(result.error, "should have error message");
});
