import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPreflight } from "../preflight.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides = {}) {
  return {
    targetRepo: "cmetech/otto-cli",
    divergenceLedger: "docs/UPSTREAM-SYNC.md",
    upstreams: {
      "pi-dev": { path: "../pi", ghRepo: "earendil-works/pi", branch: "main" },
    },
    issueFiling: { defaultStatusLabel: "status:triaged" },
    classifier: { skipPrefixes: [] },
    ...overrides,
  };
}

function passingGhRunner(args) {
  if (args[0] === "auth" && args[1] === "status") {
    return "Logged in to github.com\nToken scopes: 'repo', 'read:org', 'workflow'\n";
  }
  if (args[0] === "repo" && args[1] === "view") {
    return "https://github.com/foo/bar\n";
  }
  if (args[0] === "label" && args[1] === "list") return "";
  if (args[0] === "label" && args[1] === "create") return "";
  return "";
}

function passingCmdRunner(cmd, args) {
  if ((cmd === "which" || cmd === "where") && args[0] === "gh") return "/usr/bin/gh\n";
  if ((cmd === "which" || cmd === "where") && args[0] === "git") return "/usr/bin/git\n";
  if (cmd === "git" && args[0] === "rev-parse") return ".git\n";
  if (cmd === "git" && args[0] === "-C") return ".git\n";
  return "";
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("all checks pass with green environment", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ucp-preflight-"));
  try {
    // Create a fake upstream path that's a git repo
    const upstreamPath = join(tmp, "upstream");
    mkdirSync(upstreamPath, { recursive: true });
    mkdirSync(join(upstreamPath, ".git"));

    // Fake UPSTREAM-SYNC.md
    mkdirSync(join(tmp, "docs"));
    writeFileSync(join(tmp, "docs", "UPSTREAM-SYNC.md"), "# ledger\n");

    // Fake config file
    mkdirSync(join(tmp, ".planning"));
    writeFileSync(join(tmp, ".planning", "upstream-sync-config.json"), "{}");

    const origCwd = process.cwd();
    process.chdir(tmp);
    try {
      const config = makeConfig({
        divergenceLedger: "docs/UPSTREAM-SYNC.md",
        upstreams: { test: { path: upstreamPath, ghRepo: "x/y", branch: "main" } },
      });

      // cmdRunner handles git -C <upstreamPath> rev-parse case
      const cmdRunner = (cmd, args) => {
        if ((cmd === "which" || cmd === "where") && args[0] === "gh") return "/usr/bin/gh\n";
        if ((cmd === "which" || cmd === "where") && args[0] === "git") return "/usr/bin/git\n";
        if (cmd === "git" && args[0] === "rev-parse") return ".git\n";
        if (cmd === "git" && args[0] === "-C") return ".git\n";
        return "";
      };

      const result = await runPreflight({
        config,
        ghRunner: passingGhRunner,
        cmdRunner,
      });

      assert.equal(result.failed.length, 0, `expected no failures, got: ${JSON.stringify(result.failed)}`);
      assert.ok(result.passed.length >= 10, `expected >= 10 passed checks, got ${result.passed.length}`);
    } finally {
      process.chdir(origCwd);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("gh not on PATH triggers failure", async () => {
  const config = makeConfig();
  const cmdRunner = (cmd, args) => {
    if ((cmd === "which" || cmd === "where") && args[0] === "gh") throw new Error("not found");
    return passingCmdRunner(cmd, args);
  };
  const result = await runPreflight({ config, ghRunner: passingGhRunner, cmdRunner });
  assert.ok(result.failed.some((f) => f.name === "gh-on-path"), "expected gh-on-path in failed");
});

test("git not on PATH triggers failure", async () => {
  const config = makeConfig();
  const cmdRunner = (cmd, args) => {
    if ((cmd === "which" || cmd === "where") && args[0] === "git") throw new Error("not found");
    return passingCmdRunner(cmd, args);
  };
  const result = await runPreflight({ config, ghRunner: passingGhRunner, cmdRunner });
  assert.ok(result.failed.some((f) => f.name === "git-on-path"), "expected git-on-path in failed");
});

test("gh not authenticated triggers failure", async () => {
  const config = makeConfig();
  const ghRunner = (args) => {
    if (args[0] === "auth" && args[1] === "status") throw new Error("not logged in");
    return passingGhRunner(args);
  };
  const result = await runPreflight({ config, ghRunner, cmdRunner: passingCmdRunner });
  assert.ok(result.failed.some((f) => f.name === "gh-authenticated"), "expected gh-authenticated in failed");
});

test("missing repo scope triggers failure", async () => {
  const config = makeConfig();
  const ghRunner = (args) => {
    if (args[0] === "auth" && args[1] === "status") return "Token scopes: 'workflow'\n";
    return passingGhRunner(args);
  };
  const result = await runPreflight({ config, ghRunner, cmdRunner: passingCmdRunner });
  assert.ok(result.failed.some((f) => f.name === "gh-scopes"), "expected gh-scopes in failed");
});

test("missing read:org scope triggers failure", async () => {
  const config = makeConfig();
  const ghRunner = (args) => {
    if (args[0] === "auth" && args[1] === "status") return "Token scopes: 'repo', 'workflow'\n";
    return passingGhRunner(args);
  };
  const result = await runPreflight({ config, ghRunner, cmdRunner: passingCmdRunner });
  assert.ok(result.failed.some((f) => f.name === "gh-scopes"), "expected gh-scopes in failed for missing read:org");
});

test("not in git repo triggers failure", async () => {
  const config = makeConfig();
  const cmdRunner = (cmd, args) => {
    if (cmd === "git" && args[0] === "rev-parse") throw new Error("not a git repo");
    return passingCmdRunner(cmd, args);
  };
  const result = await runPreflight({ config, ghRunner: passingGhRunner, cmdRunner });
  assert.ok(result.failed.some((f) => f.name === "git-repo"), "expected git-repo in failed");
});

test("missing UPSTREAM-SYNC.md triggers failure", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ucp-preflight-"));
  try {
    const origCwd = process.cwd();
    process.chdir(tmp);
    try {
      // No docs/UPSTREAM-SYNC.md created
      const config = makeConfig({ divergenceLedger: "docs/UPSTREAM-SYNC.md" });
      const result = await runPreflight({ config, ghRunner: passingGhRunner, cmdRunner: passingCmdRunner });
      assert.ok(result.failed.some((f) => f.name === "upstream-sync-md"), "expected upstream-sync-md in failed");
    } finally {
      process.chdir(origCwd);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("missing config file triggers failure", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ucp-preflight-"));
  try {
    const origCwd = process.cwd();
    process.chdir(tmp);
    try {
      // Create the ledger but no config
      mkdirSync(join(tmp, "docs"));
      writeFileSync(join(tmp, "docs", "UPSTREAM-SYNC.md"), "# ledger\n");
      // No .planning/upstream-sync-config.json
      const config = makeConfig({ divergenceLedger: "docs/UPSTREAM-SYNC.md" });
      const result = await runPreflight({ config, ghRunner: passingGhRunner, cmdRunner: passingCmdRunner });
      assert.ok(result.failed.some((f) => f.name === "config-file-exists"), "expected config-file-exists in failed");
    } finally {
      process.chdir(origCwd);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("upstream path that is not a git repo triggers failure", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ucp-preflight-"));
  try {
    // upstream dir exists but no .git
    const upstreamPath = join(tmp, "not-a-repo");
    mkdirSync(upstreamPath, { recursive: true });

    const origCwd = process.cwd();
    process.chdir(tmp);
    try {
      mkdirSync(join(tmp, "docs"));
      writeFileSync(join(tmp, "docs", "UPSTREAM-SYNC.md"), "# ledger\n");
      mkdirSync(join(tmp, ".planning"));
      writeFileSync(join(tmp, ".planning", "upstream-sync-config.json"), "{}");

      const config = makeConfig({
        divergenceLedger: "docs/UPSTREAM-SYNC.md",
        upstreams: { "bad-upstream": { path: upstreamPath, ghRepo: "x/y", branch: "main" } },
      });

      const cmdRunner = (cmd, args) => {
        if ((cmd === "which" || cmd === "where")) return `/usr/bin/${args[0]}\n`;
        if (cmd === "git" && args[0] === "rev-parse") return ".git\n";
        if (cmd === "git" && args[0] === "-C") throw new Error("not a git repo");
        return "";
      };

      const result = await runPreflight({ config, ghRunner: passingGhRunner, cmdRunner });
      assert.ok(
        result.failed.some((f) => f.name === "upstream-paths-valid"),
        "expected upstream-paths-valid in failed",
      );
    } finally {
      process.chdir(origCwd);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("unreachable target repo triggers failure", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ucp-preflight-"));
  try {
    const upstreamPath = join(tmp, "upstream");
    mkdirSync(join(upstreamPath, ".git"), { recursive: true });
    mkdirSync(join(tmp, "docs"));
    writeFileSync(join(tmp, "docs", "UPSTREAM-SYNC.md"), "# ledger\n");
    mkdirSync(join(tmp, ".planning"));
    writeFileSync(join(tmp, ".planning", "upstream-sync-config.json"), "{}");

    const origCwd = process.cwd();
    process.chdir(tmp);
    try {
      const config = makeConfig({
        divergenceLedger: "docs/UPSTREAM-SYNC.md",
        upstreams: { test: { path: upstreamPath, ghRepo: "x/y", branch: "main" } },
      });

      const ghRunner = (args) => {
        if (args[0] === "auth" && args[1] === "status")
          return "Token scopes: 'repo', 'read:org'\n";
        if (args[0] === "repo" && args[1] === "view" && args[2] === config.targetRepo)
          throw new Error("repo not found");
        return passingGhRunner(args);
      };

      const result = await runPreflight({ config, ghRunner, cmdRunner: passingCmdRunner });
      assert.ok(
        result.failed.some((f) => f.name === "target-repo-reachable"),
        "expected target-repo-reachable in failed",
      );
    } finally {
      process.chdir(origCwd);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("unreachable upstream gh repo triggers failure", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ucp-preflight-"));
  try {
    const upstreamPath = join(tmp, "upstream");
    mkdirSync(join(upstreamPath, ".git"), { recursive: true });
    mkdirSync(join(tmp, "docs"));
    writeFileSync(join(tmp, "docs", "UPSTREAM-SYNC.md"), "# ledger\n");
    mkdirSync(join(tmp, ".planning"));
    writeFileSync(join(tmp, ".planning", "upstream-sync-config.json"), "{}");

    const origCwd = process.cwd();
    process.chdir(tmp);
    try {
      const config = makeConfig({
        divergenceLedger: "docs/UPSTREAM-SYNC.md",
        upstreams: { test: { path: upstreamPath, ghRepo: "x/y", branch: "main" } },
      });

      const ghRunner = (args) => {
        if (args[0] === "auth" && args[1] === "status")
          return "Token scopes: 'repo', 'read:org'\n";
        if (args[0] === "repo" && args[1] === "view" && args[2] === "x/y")
          throw new Error("repo not found");
        return passingGhRunner(args);
      };

      const result = await runPreflight({ config, ghRunner, cmdRunner: passingCmdRunner });
      assert.ok(
        result.failed.some((f) => f.name === "upstream-gh-repos-reachable"),
        "expected upstream-gh-repos-reachable in failed",
      );
    } finally {
      process.chdir(origCwd);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("soft checks create missing dirs and state file", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ucp-preflight-soft-"));
  try {
    const upstreamPath = join(tmp, "upstream");
    mkdirSync(join(upstreamPath, ".git"), { recursive: true });
    mkdirSync(join(tmp, "docs"));
    writeFileSync(join(tmp, "docs", "UPSTREAM-SYNC.md"), "# ledger\n");
    mkdirSync(join(tmp, ".planning"));
    writeFileSync(join(tmp, ".planning", "upstream-sync-config.json"), "{}");
    // Do NOT create .planning/upstream-audits or state file

    const origCwd = process.cwd();
    process.chdir(tmp);
    try {
      const config = makeConfig({
        divergenceLedger: "docs/UPSTREAM-SYNC.md",
        upstreams: { test: { path: upstreamPath, ghRepo: "x/y", branch: "main" } },
      });

      const result = await runPreflight({
        config,
        ghRunner: passingGhRunner,
        cmdRunner: passingCmdRunner,
      });

      assert.equal(result.failed.length, 0, `unexpected failures: ${JSON.stringify(result.failed)}`);
      // Should have auto-fixed: audits dir, cache dir, state file (labels may or may not fix)
      const fixedNames = result.autoFixed.map((f) => f.name);
      assert.ok(fixedNames.includes("ensure-audits-dir"), "expected ensure-audits-dir in autoFixed");
      assert.ok(fixedNames.includes("ensure-audits-cache-dir"), "expected ensure-audits-cache-dir in autoFixed");
      assert.ok(fixedNames.includes("ensure-state-file"), "expected ensure-state-file in autoFixed");
    } finally {
      process.chdir(origCwd);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("failed required check skips soft checks", async () => {
  const config = makeConfig();
  const cmdRunner = (cmd, args) => {
    if ((cmd === "which" || cmd === "where") && args[0] === "gh") throw new Error("not found");
    return passingCmdRunner(cmd, args);
  };
  const labelCreateCalls = [];
  const ghRunner = (args) => {
    if (args[0] === "label" && args[1] === "create") {
      labelCreateCalls.push(args);
    }
    return passingGhRunner(args);
  };

  const result = await runPreflight({ config, ghRunner, cmdRunner });
  assert.ok(result.failed.length > 0, "expected at least one failure");
  assert.equal(labelCreateCalls.length, 0, "soft checks should not run when required checks fail");
});

test("result has correct shape", async () => {
  const config = makeConfig();
  const cmdRunner = () => { throw new Error("not found"); };
  const result = await runPreflight({ config, ghRunner: passingGhRunner, cmdRunner });
  assert.ok(Array.isArray(result.passed), "passed must be array");
  assert.ok(Array.isArray(result.failed), "failed must be array");
  assert.ok(Array.isArray(result.autoFixed), "autoFixed must be array");
  // Each failed entry has name, message, remediation
  for (const f of result.failed) {
    assert.ok(typeof f.name === "string", "failed.name must be string");
    assert.ok(typeof f.message === "string", "failed.message must be string");
  }
});
