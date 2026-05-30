import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { harvestCommits } from "../harvest-commits.mjs";

/**
 * Create a bare-minimum git repo fixture with a forced "main" branch name.
 */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ucp-harvest-"));
  const run = (...args) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf-8" });
  run("init", "-q");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test");
  // Force branch to "main" regardless of git default (may be "master")
  run("checkout", "-q", "-b", "main");
  return { dir, run };
}

/**
 * Create a text file with `lines` lines of content and commit it.
 */
function addFileAndCommit(run, dir, filePath, lines, message) {
  const fullDir = join(dir, ...filePath.split("/").slice(0, -1));
  mkdirSync(fullDir, { recursive: true });
  const content = Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
  writeFileSync(join(dir, filePath), content);
  run("add", filePath);
  run("commit", "-m", message);
}

// ─── Fixture setup ──────────────────────────────────────────────────────────
//
// Commit order (oldest → newest):
//   C1  feat: add file A               touches src/a.txt (+5 lines)
//   C2  fix(issue): patch B (#42)      touches src/b.txt (+10 lines)
//   C3  chore: update docs             touches docs/c.md (+1 line)
//
// harvestCommits is called with lastAnalyzedCommit = C1, so it should
// return [C3, C2] — newest-first, excluding the boundary commit.

test("returns commits since lastAnalyzedCommit (newest-first)", () => {
  const { dir, run } = makeRepo();
  try {
    addFileAndCommit(run, dir, "src/a.txt", 5, "feat: add file A");
    const c1 = run("rev-parse", "HEAD").trim();

    addFileAndCommit(run, dir, "src/b.txt", 10, "fix(issue): patch B (#42)");
    addFileAndCommit(run, dir, "docs/c.md", 1, "chore: update docs");

    const commits = harvestCommits({
      path: dir,
      branch: "main",
      lastAnalyzedCommit: c1,
    });

    // Should return exactly 2 commits (C2 and C3)
    assert.equal(commits.length, 2);

    // Newest-first: C3 comes before C2
    assert.match(commits[0].subject, /chore: update docs/);
    assert.match(commits[1].subject, /fix\(issue\): patch B/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refs are extracted from subject", () => {
  const { dir, run } = makeRepo();
  try {
    addFileAndCommit(run, dir, "src/a.txt", 5, "feat: initial");
    const c1 = run("rev-parse", "HEAD").trim();

    addFileAndCommit(run, dir, "src/b.txt", 10, "fix(issue): patch B (#42)");

    const commits = harvestCommits({
      path: dir,
      branch: "main",
      lastAnalyzedCommit: c1,
    });

    assert.equal(commits.length, 1);
    assert.deepEqual(commits[0].refs, ["42"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("locByFile is correct for touched files", () => {
  const { dir, run } = makeRepo();
  try {
    addFileAndCommit(run, dir, "src/a.txt", 5, "feat: initial");
    const c1 = run("rev-parse", "HEAD").trim();

    addFileAndCommit(run, dir, "src/b.txt", 10, "fix(issue): patch B (#42)");

    const commits = harvestCommits({
      path: dir,
      branch: "main",
      lastAnalyzedCommit: c1,
    });

    assert.equal(commits.length, 1);
    assert.deepEqual(commits[0].touchedFiles, ["src/b.txt"]);
    // 10 added lines + 0 deleted = 10
    assert.equal(commits[0].locByFile["src/b.txt"], 10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns empty array when lastAnalyzedCommit is HEAD", () => {
  const { dir, run } = makeRepo();
  try {
    addFileAndCommit(run, dir, "src/a.txt", 5, "feat: initial");
    const head = run("rev-parse", "HEAD").trim();

    const commits = harvestCommits({
      path: dir,
      branch: "main",
      lastAnalyzedCommit: head,
    });

    assert.equal(commits.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extracts refs from both subject and body", () => {
  const { dir, run } = makeRepo();
  try {
    addFileAndCommit(run, dir, "src/a.txt", 3, "feat: baseline");
    const c1 = run("rev-parse", "HEAD").trim();

    // Commit with refs in subject AND body
    const fullDir = join(dir, "src");
    mkdirSync(fullDir, { recursive: true });
    writeFileSync(join(dir, "src/c.txt"), "content\n");
    run("add", "src/c.txt");
    run("commit", "-m", "fix: multi-ref (#100)\n\nResolves #200\nSee also #300");

    const commits = harvestCommits({
      path: dir,
      branch: "main",
      lastAnalyzedCommit: c1,
    });

    assert.equal(commits.length, 1);
    const { refs } = commits[0];
    assert.ok(refs.includes("100"), "should include ref from subject");
    assert.ok(refs.includes("200"), "should include ref from body line 1");
    assert.ok(refs.includes("300"), "should include ref from body line 2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commit record has all required fields", () => {
  const { dir, run } = makeRepo();
  try {
    addFileAndCommit(run, dir, "src/a.txt", 2, "feat: setup");
    const c1 = run("rev-parse", "HEAD").trim();

    addFileAndCommit(run, dir, "src/d.txt", 4, "fix: add d");

    const commits = harvestCommits({
      path: dir,
      branch: "main",
      lastAnalyzedCommit: c1,
    });

    assert.equal(commits.length, 1);
    const commit = commits[0];

    assert.ok(typeof commit.sha === "string" && commit.sha.length === 40, "sha is 40-char hex");
    assert.ok(typeof commit.author === "string" && commit.author.length > 0, "author present");
    assert.ok(typeof commit.date === "string" && commit.date.includes("T"), "date is ISO-8601");
    assert.ok(typeof commit.subject === "string" && commit.subject.length > 0, "subject present");
    assert.ok(typeof commit.body === "string", "body is a string");
    assert.ok(Array.isArray(commit.touchedFiles), "touchedFiles is array");
    assert.ok(typeof commit.locByFile === "object", "locByFile is object");
    assert.ok(Array.isArray(commit.refs), "refs is array");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
