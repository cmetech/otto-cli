import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureRepoConventions } from "../commands/build-flow/_scaffold.js";

function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "otto-scaffold-"));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("creates flows/{generated,templates,imported} and catalog/", async () => {
  await withTempDir(async (dir) => {
    const result = await ensureRepoConventions(dir);
    assert.ok(existsSync(join(dir, "flows/generated")));
    assert.ok(existsSync(join(dir, "flows/templates")));
    assert.ok(existsSync(join(dir, "flows/imported")));
    assert.ok(existsSync(join(dir, "catalog")));
    assert.ok(result.created.includes("flows/generated"));
  });
});

test("appends catalog cache entries to a fresh .gitignore", async () => {
  await withTempDir(async (dir) => {
    await ensureRepoConventions(dir);
    const gi = readFileSync(join(dir, ".gitignore"), "utf-8");
    assert.match(gi, /catalog\/components\.raw\.json/);
    assert.match(gi, /catalog\/components\.normalized\.json/);
    assert.match(gi, /catalog\/component-index\.md/);
  });
});

test("does not duplicate entries when .gitignore already contains them", async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\ncatalog/components.raw.json\n");
    await ensureRepoConventions(dir);
    const gi = readFileSync(join(dir, ".gitignore"), "utf-8");
    const occurrences = gi.split("catalog/components.raw.json").length - 1;
    assert.equal(occurrences, 1, "should keep just one entry");
  });
});

test("is idempotent — second call reports nothing newly created", async () => {
  await withTempDir(async (dir) => {
    await ensureRepoConventions(dir);
    const result2 = await ensureRepoConventions(dir);
    assert.deepEqual(result2.created, []);
  });
});
