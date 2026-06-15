// the agent + Repository registry seam tests.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepositoryRegistryFromPreferences, defaultRepositoryTargets } from "../repository-registry.ts";

test("repository registry includes implicit project root and declared child repos", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-repo-registry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, ".otto/workflow"), { recursive: true });
  mkdirSync(join(base, "frontend"), { recursive: true });
  mkdirSync(join(base, "backend"), { recursive: true });

  const registry = createRepositoryRegistryFromPreferences(base, {
    workspace: {
      mode: "parent",
      repositories: {
        frontend: { path: "frontend", role: "web UI", verification: ["npm test"] },
        backend: { path: "./backend", role: "API", commit_policy: "skip" },
      },
    },
  });

  assert.equal(registry.mode, "parent");
  assert.equal(registry.projectRoot, base);
  assert.equal(registry.byId.size, 3);
  assert.equal(registry.byId.get("project")?.root, base);
  assert.equal(registry.byId.get("frontend")?.root, join(base, "frontend"));
  assert.equal(registry.byId.get("backend")?.root, join(base, "backend"));
  assert.deepEqual(registry.byId.get("frontend")?.verification, ["npm test"]);
  assert.equal(registry.byId.get("frontend")?.role, "web UI");
  assert.equal(registry.byId.get("backend")?.commitPolicy, "skip");
  assert.equal(registry.byId.get("backend")?.role, "API");
});

test("repository registry rejects repositories outside project root", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-repo-registry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, ".otto/workflow"), { recursive: true });

  assert.throws(
    () => createRepositoryRegistryFromPreferences(base, {
      workspace: {
        mode: "parent",
        repositories: {
          unsafe: { path: "../outside" },
        },
      },
    }),
    /outside project root/,
  );
});

test('repository registry rejects explicit "project" repository id', (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-repo-registry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, ".otto/workflow"), { recursive: true });

  assert.throws(
    () => createRepositoryRegistryFromPreferences(base, {
      workspace: {
        mode: "parent",
        repositories: {
          project: { path: "." },
        },
      },
    }),
    /reserved/,
  );
});

test("defaultRepositoryTargets returns [project] for a single-repo project registry", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-repo-registry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, ".otto/workflow"), { recursive: true });

  const registry = createRepositoryRegistryFromPreferences(base, undefined);

  assert.deepEqual(defaultRepositoryTargets(registry), ["project"]);
});

test("repository registry keeps a non-worktree bootstrapped root anchored, ignoring an enclosing git toplevel", (t) => {
  // outer git repo with the actual project bootstrapped in a nested subdirectory.
  const outer = realpathSync(mkdtempSync(join(tmpdir(), "gsd-repo-registry-nonwt-")));
  t.after(() => rmSync(outer, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: outer, stdio: "ignore" });

  // The project root is a nested subdir that carries its own workflow bootstrap
  // artifacts, so the path contract resolves projectRoot to this nested dir —
  // NOT the enclosing git working-tree root.
  const projectRoot = join(outer, "nested", "project");
  const workflowDir = join(projectRoot, ".otto", "workflow");
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(join(workflowDir, "PREFERENCES.md"), "# prefs\n");

  const registry = createRepositoryRegistryFromPreferences(projectRoot, undefined);

  // A non-worktree base must NOT be redirected by an enclosing
  // `git rev-parse --show-toplevel` lookup. It must stay at the bootstrapped root.
  assert.equal(registry.projectRoot, projectRoot);
  assert.equal(registry.byId.get("project")?.root, projectRoot);
});

test("defaultRepositoryTargets returns [project] for a parent-mode registry", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-repo-registry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, ".otto/workflow"), { recursive: true });
  mkdirSync(join(base, "frontend"), { recursive: true });

  const registry = createRepositoryRegistryFromPreferences(base, {
    workspace: {
      mode: "parent",
      repositories: {
        frontend: { path: "frontend" },
      },
    },
  });

  assert.deepEqual(defaultRepositoryTargets(registry), ["project"]);
});
