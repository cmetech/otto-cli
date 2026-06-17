import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getRemoteUrl } from "./repo-identity.js";
import { peekLogs, _resetLogs } from "./workflow-logger.js";

// Regression for upstream issue #96 (sha 9b7f522):
// repo-identity.getRemoteUrl must distinguish "no remote configured" /
// "not a git repo" (stay silent) from a genuine transient git failure, which
// must be surfaced via logWarning("state", ...) rather than swallowed.

test("getRemoteUrl stays silent when the dir is not a git repo", () => {
  _resetLogs();
  const dir = mkdtempSync(join(tmpdir(), "repo-identity-nonrepo-"));
  try {
    const url = getRemoteUrl(dir);
    assert.equal(url, "");
    assert.equal(
      peekLogs().length,
      0,
      "a non-git directory must not produce a warning",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getRemoteUrl stays silent in a git repo with no origin remote", () => {
  _resetLogs();
  const dir = mkdtempSync(join(tmpdir(), "repo-identity-noremote-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const url = getRemoteUrl(dir);
    assert.equal(url, "");
    assert.equal(
      peekLogs().length,
      0,
      "a configured-but-no-remote repo must not produce a warning",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getRemoteUrl logs a warning on a genuine git failure", () => {
  _resetLogs();
  // Point at a path that is not a directory at all: git emits an error that is
  // neither "no remote" (exit 1, empty) nor a recognized not-a-repo message.
  // Force the transient-failure branch by making the cwd nonexistent.
  const missing = join(tmpdir(), `repo-identity-missing-${process.pid}-${Date.now()}`);
  const url = getRemoteUrl(missing);
  assert.equal(url, "");
  const logs = peekLogs();
  assert.equal(logs.length, 1, "a transient git failure must log exactly one warning");
  assert.equal(logs[0].severity, "warn");
  assert.equal(logs[0].component, "state");
  assert.match(logs[0].message, /remote\.origin\.url/);
  _resetLogs();
});
