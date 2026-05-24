import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savePromptHistory, slugify } from "../commands/prompt-engineer/_storage.js";

function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "loop24-prompts-"));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("slugify produces kebab-cased ASCII safe for filenames", () => {
  assert.equal(slugify("Summarize a chunk of text"), "summarize-a-chunk-of-text");
  assert.equal(slugify("Build /loop24 build-flow handler"), "build-loop24-build-flow-handler");
  assert.equal(slugify("Fix bug #1234: race in cache"), "fix-bug-1234-race-in-cache");
  assert.equal(slugify("   weird    whitespace\t\nstuff   "), "weird-whitespace-stuff");
  assert.equal(slugify("résumé café naïve"), "resume-cafe-naive");
});

test("slugify truncates to ~50 chars at word boundaries", () => {
  const long = "implement a really long feature description that goes on and on and on";
  const slug = slugify(long);
  assert.ok(slug.length <= 50, `expected slug ≤50 chars, got ${slug.length}`);
  assert.ok(!slug.endsWith("-"), "expected no trailing hyphen");
});

test("slugify falls back to 'prompt' for input with no slug-able chars", () => {
  assert.equal(slugify("!!!"), "prompt");
  assert.equal(slugify(""), "prompt");
});

test("savePromptHistory writes a markdown file with description + polished + metadata", async () => {
  await withTempDir(async (dir) => {
    const path = await savePromptHistory({
      description: "Refactor the auth module",
      polished: "## Goal\nRefactor the auth module...",
      modelId: "claude-haiku-4-5-20251001",
      baseDir: dir,
    });
    assert.ok(path.startsWith(dir), `path should be inside baseDir; got ${path}`);
    assert.ok(path.endsWith(".md"));
    assert.ok(existsSync(path));
    const body = readFileSync(path, "utf-8");
    assert.match(body, /Refactor the auth module/);
    assert.match(body, /## Goal\nRefactor the auth module/);
    assert.match(body, /claude-haiku-4-5-20251001/);
    assert.match(body, /\/otto prompt-engineer/);
  });
});

test("savePromptHistory uses today's date in the filename", async () => {
  await withTempDir(async (dir) => {
    const today = new Date().toISOString().slice(0, 10);
    const path = await savePromptHistory({
      description: "Test request",
      polished: "polished body",
      modelId: "haiku",
      baseDir: dir,
    });
    assert.match(path, new RegExp(`/${today}-test-request\\.md$`));
  });
});

test("savePromptHistory disambiguates same-day same-slug collisions", async () => {
  await withTempDir(async (dir) => {
    const args = { description: "Same input", polished: "p1", modelId: "m", baseDir: dir };
    const path1 = await savePromptHistory(args);
    const path2 = await savePromptHistory({ ...args, polished: "p2" });
    assert.notEqual(path1, path2, "expected disambiguated paths on collision");
    assert.ok(existsSync(path1));
    assert.ok(existsSync(path2));
    assert.equal(readFileSync(path1, "utf-8").includes("p1"), true);
    assert.equal(readFileSync(path2, "utf-8").includes("p2"), true);
  });
});

test("savePromptHistory creates the baseDir if missing", async () => {
  await withTempDir(async (outer) => {
    const baseDir = join(outer, "does", "not", "exist", "yet");
    assert.equal(existsSync(baseDir), false);
    const path = await savePromptHistory({
      description: "Create dir",
      polished: "x",
      modelId: "m",
      baseDir,
    });
    assert.ok(existsSync(path));
  });
});
