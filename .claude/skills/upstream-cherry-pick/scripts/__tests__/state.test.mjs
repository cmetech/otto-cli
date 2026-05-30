import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readState } from "../state-read.mjs";
import { writeState } from "../state-write.mjs";

function makeTmp() {
  return mkdtempSync(join(tmpdir(), "ucp-state-"));
}

test("readState returns empty entry for missing file", () => {
  const dir = makeTmp();
  try {
    const state = readState(join(dir, "state.json"), "pi-dev");
    assert.equal(state.lastAnalyzedCommit, undefined);
    assert.equal(state.lastAnalyzedAt, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeState then readState round-trips", () => {
  const dir = makeTmp();
  try {
    const path = join(dir, "state.json");
    writeState(path, "pi-dev", {
      lastAnalyzedCommit: "abc1234",
      lastAnalyzedAt: "2026-05-29T15:00:00Z",
      lastReportPath: ".planning/upstream-audits/2026-05-29-pi-dev-audit.md",
    });
    const back = readState(path, "pi-dev");
    assert.equal(back.lastAnalyzedCommit, "abc1234");
    assert.equal(back.lastAnalyzedAt, "2026-05-29T15:00:00Z");
    assert.match(back.lastReportPath, /pi-dev-audit\.md$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeState preserves other upstream entries", () => {
  const dir = makeTmp();
  try {
    const path = join(dir, "state.json");
    writeState(path, "pi-dev", { lastAnalyzedCommit: "aaa1111" });
    writeState(path, "gsd-pi", { lastAnalyzedCommit: "bbb2222" });
    const both = JSON.parse(readFileSync(path, "utf-8"));
    assert.equal(both.upstreams["pi-dev"].lastAnalyzedCommit, "aaa1111");
    assert.equal(both.upstreams["gsd-pi"].lastAnalyzedCommit, "bbb2222");
    assert.equal(both.version, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
