import test from "node:test";
import assert from "node:assert/strict";
import { homedir, tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  loadProjectGSDPreferences,
  loadEffectiveGSDPreferences,
} from "./preferences.ts";

test("loadProjectGSDPreferences returns null in $HOME without throwing", () => {
  const result = loadProjectGSDPreferences(homedir());
  assert.equal(result, null);
});

test("loadProjectGSDPreferences returns null in a fresh tmpdir without throwing", () => {
  const dir = mkdtempSync(join(tmpdir(), "otto-prefs-safe-"));
  try {
    assert.equal(loadProjectGSDPreferences(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadEffectiveGSDPreferences returns null in $HOME without throwing", () => {
  const result = loadEffectiveGSDPreferences(homedir());
  assert.equal(result, null);
});
