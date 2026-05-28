import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = process.cwd();
const loader = join(projectRoot, "dist", "loader.js");

if (!existsSync(loader)) {
  throw new Error("dist/loader.js not found — run: npm run build");
}

test("otto --version ignores project marker side effects", () => {
  const dir = mkdtempSync(join(tmpdir(), "otto-boot-in-project-"));
  mkdirSync(join(dir, ".otto/workflow"), { recursive: true });
  writeFileSync(
    join(dir, ".otto/workflow", "manifest.json"),
    JSON.stringify({ version: 1, createdAt: new Date().toISOString(), otto: "test" }),
    "utf-8",
  );
  try {
    const result = spawnSync(process.execPath, [loader, "--version"], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 30_000,
    });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}; stderr: ${result.stderr}`);
    assert.equal(existsSync(join(dir, ".otto", "workflow")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("otto --version exits 0 when run inside an .otto/workflow/ project", () => {
  const dir = mkdtempSync(join(tmpdir(), "otto-boot-in-otto-project-"));
  mkdirSync(join(dir, ".otto", "workflow"), { recursive: true });
  writeFileSync(
    join(dir, ".otto", "workflow", "manifest.json"),
    JSON.stringify({ version: 1, createdAt: new Date().toISOString(), otto: "test" }),
    "utf-8",
  );
  try {
    const result = spawnSync(process.execPath, [loader, "--version"], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 30_000,
    });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}; stderr: ${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
