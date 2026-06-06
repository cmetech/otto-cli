import { test } from "node:test";
import assert from "node:assert/strict";
import { provisionWorktreeNodeModules } from "../worktree-node-modules.mjs";

function fakeFs({ srcExists = true, destExists = false } = {}) {
  const symlinkCalls = [];
  const checkExists = (p) => {
    if (p.endsWith("/repo/node_modules")) return srcExists;
    if (p.endsWith("/wt/node_modules")) return destExists;
    return false;
  };
  const symlinker = (src, dest, kind) => { symlinkCalls.push({ src, dest, kind }); };
  return { checkExists, symlinker, symlinkCalls };
}

test("symlinks repo-root node_modules into worktree when missing", () => {
  const { checkExists, symlinker, symlinkCalls } = fakeFs();
  const r = provisionWorktreeNodeModules("/wt", "/repo", { symlinker, checkExists });
  assert.equal(r.linked, true);
  assert.equal(symlinkCalls.length, 1);
  assert.equal(symlinkCalls[0].src, "/repo/node_modules");
  assert.equal(symlinkCalls[0].dest, "/wt/node_modules");
  assert.equal(symlinkCalls[0].kind, "dir");
});

test("idempotent — no-op when destination node_modules already exists", () => {
  const { checkExists, symlinker, symlinkCalls } = fakeFs({ destExists: true });
  const r = provisionWorktreeNodeModules("/wt", "/repo", { symlinker, checkExists });
  assert.equal(r.linked, false);
  assert.equal(symlinkCalls.length, 0);
});

test("throws a clear actionable error when repo-root node_modules is missing", () => {
  const { checkExists, symlinker } = fakeFs({ srcExists: false });
  assert.throws(
    () => provisionWorktreeNodeModules("/wt", "/repo", { symlinker, checkExists }),
    /node_modules missing.*npm ci/,
  );
});
