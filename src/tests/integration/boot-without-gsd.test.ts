import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

const projectRoot = process.cwd();
const loader = join(projectRoot, "dist", "loader.js");

if (!existsSync(loader)) {
  throw new Error("dist/loader.js not found — run: npm run build");
}

function spawnOtto(cwd: string) {
  return spawnSync(process.execPath, [loader, "--version"], {
    cwd,
    encoding: "utf-8",
    timeout: 30_000,
  });
}

test("otto --version exits 0 when run from $HOME", () => {
  const result = spawnOtto(homedir());
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}; stderr: ${result.stderr}`);
  assert.doesNotMatch(result.stderr ?? "", /Refusing to use|Run GSD from inside a project/);
});

test("otto --version exits 0 when run from a fresh tmpdir", () => {
  const dir = mkdtempSync(join(tmpdir(), "otto-boot-tmp-"));
  try {
    const result = spawnOtto(dir);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}; stderr: ${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("running otto from a fresh tmpdir does not create a .gsd directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "otto-boot-no-gsd-"));
  try {
    spawnOtto(dir);
    assert.equal(existsSync(join(dir, ".otto/workflow")), false, "must not have created .otto/workflow/ in cwd");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
