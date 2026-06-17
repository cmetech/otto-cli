// Project/App: the agent
// File Purpose: Regression test pinning the shell pack-validator's critical-file
// list to the canonical JS validator's list.
//
// Upstream gsd-pi commit 85a4cb0 ("fix: align shell pack validation daemon
// checks") aligned the shell validator's required-files list with the JS
// validator's. otto-cli has diverged file paths (no packages/daemon/bin/gsd-daemon.js;
// the daemon bin is packages/daemon/dist/cli.js), so the essence we port is the
// INVARIANT, not the upstream paths: scripts/validate-pack.sh must check every
// critical file that the canonical scripts/validate-pack.js checks, so the two
// validators cannot drift (a tarball that passes one but fails the other).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "../..");
const shPath = resolve(repoRoot, "scripts/validate-pack.sh");
const jsPath = resolve(repoRoot, "scripts/validate-pack.js");

/** Parse the `for required in <space-separated list>; do` line from the shell validator. */
function parseShellRequiredFiles(src) {
  const m = src.match(/for\s+required\s+in\s+([^\n;]+);\s*do/);
  assert.ok(m, "validate-pack.sh must contain a `for required in ...; do` loop");
  return m[1]
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Parse the `requiredFiles = [ ... ]` array literal from the JS validator. */
function parseJsRequiredFiles(src) {
  const m = src.match(/const\s+requiredFiles\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, "validate-pack.js must contain a `const requiredFiles = [...]` array");
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

test("shell validator's required-files list covers the JS validator's list", () => {
  const shList = parseShellRequiredFiles(readFileSync(shPath, "utf-8"));
  const jsList = parseJsRequiredFiles(readFileSync(jsPath, "utf-8"));

  const shSet = new Set(shList);
  const missing = jsList.filter((f) => !shSet.has(f));

  assert.deepEqual(
    missing,
    [],
    `scripts/validate-pack.sh is missing critical files that scripts/validate-pack.js checks: ${missing.join(", ")}`,
  );
});

test("shell validator does not require files absent from the published tarball", () => {
  // Guards against transcribing upstream-only paths (e.g. packages/daemon/bin/gsd-daemon.js)
  // that would make validate-pack.sh fail unconditionally on otto-cli.
  const shList = parseShellRequiredFiles(readFileSync(shPath, "utf-8"));
  const stray = shList.filter((f) => /packages\/daemon\/bin\/gsd-daemon\.js/.test(f));
  assert.deepEqual(stray, [], `validate-pack.sh references upstream-only path(s): ${stray.join(", ")}`);
});
