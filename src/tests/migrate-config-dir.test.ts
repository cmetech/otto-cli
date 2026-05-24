import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { migrateLegacyConfigDir } from "../migrate-config-dir.js"

let tmpHome: string
const ORIGINAL_HOME = process.env.HOME
const ORIGINAL_LOOP24_HOME = process.env.LOOP24_HOME
const ORIGINAL_GSD_HOME = process.env.GSD_HOME

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "otto-migrate-"))
  // migrateLegacyConfigDir resolves the legacy dir from os.homedir(), which
  // follows $HOME on POSIX. Drive it via a temp home; clear the overrides that
  // would short-circuit the migration.
  process.env.HOME = tmpHome
  delete process.env.LOOP24_HOME
  delete process.env.GSD_HOME
})

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
  if (ORIGINAL_HOME !== undefined) process.env.HOME = ORIGINAL_HOME
  else delete process.env.HOME
  if (ORIGINAL_LOOP24_HOME !== undefined) process.env.LOOP24_HOME = ORIGINAL_LOOP24_HOME
  else delete process.env.LOOP24_HOME
  if (ORIGINAL_GSD_HOME !== undefined) process.env.GSD_HOME = ORIGINAL_GSD_HOME
  else delete process.env.GSD_HOME
})

test("copies legacy ~/.loop24 → appRoot when the target is absent", () => {
  const legacyAgent = join(tmpHome, ".loop24", "agent")
  mkdirSync(legacyAgent, { recursive: true })
  writeFileSync(join(legacyAgent, "auth.json"), '{"token":"x"}')

  const appRoot = join(tmpHome, ".otto")
  const migrated = migrateLegacyConfigDir(appRoot)

  assert.equal(migrated, true)
  assert.ok(existsSync(join(appRoot, "agent", "auth.json")), "auth.json copied")
  assert.equal(readFileSync(join(appRoot, "agent", "auth.json"), "utf-8"), '{"token":"x"}')
  // Legacy dir is left intact as a safety net.
  assert.ok(existsSync(legacyAgent), "legacy dir preserved")
})

test("no-op when appRoot already exists", () => {
  mkdirSync(join(tmpHome, ".loop24", "agent"), { recursive: true })
  const appRoot = join(tmpHome, ".otto")
  mkdirSync(join(appRoot, "agent"), { recursive: true })
  writeFileSync(join(appRoot, "agent", "marker"), "new")

  const migrated = migrateLegacyConfigDir(appRoot)

  assert.equal(migrated, false)
  // Existing target untouched (no overwrite from legacy).
  assert.equal(readFileSync(join(appRoot, "agent", "marker"), "utf-8"), "new")
})

test("no-op when there is no legacy dir to copy", () => {
  const appRoot = join(tmpHome, ".otto")
  assert.equal(migrateLegacyConfigDir(appRoot), false)
  assert.ok(!existsSync(appRoot))
})

test("skips when a home override is set", () => {
  mkdirSync(join(tmpHome, ".loop24", "agent"), { recursive: true })
  process.env.LOOP24_HOME = tmpHome
  const appRoot = join(tmpHome, ".otto")
  assert.equal(migrateLegacyConfigDir(appRoot), false)
  assert.ok(!existsSync(appRoot))
})
