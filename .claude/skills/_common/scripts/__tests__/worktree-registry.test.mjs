import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerWorktree, readRegistry, pruneWorktrees } from "../worktree.mjs";

test("registerWorktree records an entry and is idempotent per path", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  try {
    const reg = join(dir, "registry.json");
    registerWorktree(reg, { path: "/tmp/wt-a", owner: "lane-1", createdAt: 1000 });
    registerWorktree(reg, { path: "/tmp/wt-a", owner: "lane-1", createdAt: 2000 }); // updates, no dup
    const entries = readRegistry(reg);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].createdAt, 2000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("readRegistry returns [] for valid-but-non-array JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  try {
    const objReg = join(dir, "obj.json");
    writeFileSync(objReg, JSON.stringify({}));
    assert.deepEqual(readRegistry(objReg), []);

    const nullReg = join(dir, "null.json");
    writeFileSync(nullReg, "null");
    assert.deepEqual(readRegistry(nullReg), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("pruneWorktrees removes entries older than ttl and calls the remover", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  try {
    const reg = join(dir, "registry.json");
    const live = join(dir, "live"); mkdirSync(live);
    registerWorktree(reg, { path: live, owner: "lane-1", createdAt: 0 });   // stale
    registerWorktree(reg, { path: join(dir, "fresh"), owner: "lane-2", createdAt: 10_000 });
    const removed = [];
    const result = pruneWorktrees(reg, { ttlMs: 1000, now: 5000, remover: (p) => removed.push(p) });
    assert.deepEqual(removed, [live]);
    assert.equal(readRegistry(reg).length, 1); // only the fresh one remains
    assert.equal(result.pruned.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
