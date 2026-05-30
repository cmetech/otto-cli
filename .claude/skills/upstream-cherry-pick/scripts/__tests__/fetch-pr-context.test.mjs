import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchPrContext } from "../fetch-pr-context.mjs";

function makeTmp() {
  return mkdtempSync(join(tmpdir(), "ucp-fetch-"));
}

test("returns PR data and caches it on first fetch", async () => {
  const dir = makeTmp();
  try {
    const calls = [];
    const ghRunner = (args) => {
      calls.push(args);
      return JSON.stringify({ title: "fix: foo", body: "fixes bug", state: "MERGED", labels: [], reviews: [], comments: [] });
    };
    const result = await fetchPrContext({
      ghRepo: "foo/bar",
      refNum: 42,
      cacheDir: dir,
      ghRunner,
    });
    assert.equal(result.kind, "pr");
    assert.equal(result.fromCache, false);
    assert.equal(result.data.title, "fix: foo");
    // Cache file written
    const cachePath = join(dir, "foo__bar", "pr-42.json");
    assert.ok(existsSync(cachePath));
    assert.equal(calls.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns from cache on second fetch", async () => {
  const dir = makeTmp();
  try {
    mkdirSync(join(dir, "foo__bar"), { recursive: true });
    writeFileSync(join(dir, "foo__bar", "pr-42.json"), JSON.stringify({ title: "cached" }));
    let called = false;
    const ghRunner = () => { called = true; return "{}"; };
    const result = await fetchPrContext({
      ghRepo: "foo/bar",
      refNum: 42,
      cacheDir: dir,
      ghRunner,
    });
    assert.equal(result.fromCache, true);
    assert.equal(result.data.title, "cached");
    assert.equal(called, false, "ghRunner should not be called on cache hit");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refreshCache bypasses cache", async () => {
  const dir = makeTmp();
  try {
    mkdirSync(join(dir, "foo__bar"), { recursive: true });
    writeFileSync(join(dir, "foo__bar", "pr-42.json"), JSON.stringify({ title: "stale" }));
    const ghRunner = () => JSON.stringify({ title: "fresh", state: "MERGED" });
    const result = await fetchPrContext({
      ghRepo: "foo/bar",
      refNum: 42,
      cacheDir: dir,
      refreshCache: true,
      ghRunner,
    });
    assert.equal(result.fromCache, false);
    assert.equal(result.data.title, "fresh");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("falls back to issue when PR call fails", async () => {
  const dir = makeTmp();
  try {
    let callIdx = 0;
    const ghRunner = (args) => {
      callIdx++;
      if (args[0] === "pr") throw new Error("not a pull request");
      return JSON.stringify({ title: "bug report", state: "CLOSED", labels: [{ name: "bug" }] });
    };
    const result = await fetchPrContext({
      ghRepo: "foo/bar",
      refNum: 99,
      cacheDir: dir,
      ghRunner,
    });
    assert.equal(result.kind, "issue");
    assert.equal(result.data.title, "bug report");
    const cachePath = join(dir, "foo__bar", "issue-99.json");
    assert.ok(existsSync(cachePath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("throws when both PR and issue calls fail", async () => {
  const dir = makeTmp();
  try {
    const ghRunner = () => { throw new Error("not found"); };
    await assert.rejects(
      fetchPrContext({ ghRepo: "foo/bar", refNum: 1, cacheDir: dir, ghRunner }),
      /not found|both.*failed|unable/i,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
