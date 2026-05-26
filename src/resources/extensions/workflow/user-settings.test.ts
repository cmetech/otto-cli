import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readUserSetting } from "./user-settings.ts";

function makeFakeHome(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "otto-user-settings-"));
  mkdirSync(join(dir, ".otto"), { recursive: true });
  if (contents !== undefined) {
    writeFileSync(join(dir, ".otto", "settings.json"), contents, "utf-8");
  }
  return dir;
}

test("returns null when ~/.otto/settings.json is missing", () => {
  const home = makeFakeHome();
  try {
    assert.equal(readUserSetting<boolean>("experimental.rtk", { homeOverride: home }), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("returns the value when key is present", () => {
  const home = makeFakeHome(JSON.stringify({ experimental: { rtk: true } }));
  try {
    assert.equal(readUserSetting<boolean>("experimental.rtk", { homeOverride: home }), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("returns null when key path is not present", () => {
  const home = makeFakeHome(JSON.stringify({ defaultProvider: "claude-code" }));
  try {
    assert.equal(readUserSetting<boolean>("experimental.rtk", { homeOverride: home }), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("returns null on malformed JSON (does not throw)", () => {
  const home = makeFakeHome("not json {{");
  try {
    assert.equal(readUserSetting<boolean>("experimental.rtk", { homeOverride: home }), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
