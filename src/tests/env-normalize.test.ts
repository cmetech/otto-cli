import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeBrandEnv } from "../env-normalize.js"

// Use an injected env object so we never touch the real process.env.
function mk(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return env as NodeJS.ProcessEnv
}

const legacyPrefix = "LOOP" + "24_"

test("OTTO_* values are preserved", () => {
  const env = mk({ OTTO_DEBUG: "1" })
  normalizeBrandEnv(env)
  assert.equal(env.OTTO_DEBUG, "1")
})

test("legacy brand values are ignored and not mirrored", () => {
  const env = mk({ [legacyPrefix + "DEBUG"]: "1" })
  normalizeBrandEnv(env)
  assert.equal(env.OTTO_DEBUG, undefined)
  assert.equal(env[legacyPrefix + "DEBUG"], "1")
})

test("env normalization does not mirror legacy aliases", () => {
  const env = mk({
    [legacyPrefix + "DEBUG"]: "1",
    [legacyPrefix + "HOME"]: "/tmp/legacy-otto",
    OTTO_HOME: "/tmp/otto",
  })
  normalizeBrandEnv(env)
  assert.equal(env.OTTO_HOME, "/tmp/otto")
  assert.equal(env[legacyPrefix + "DEBUG"], "1")
  assert.equal(env.OTTO_DEBUG, undefined)
})

test("does not clobber any existing values", () => {
  const env = mk({ OTTO_DEBUG: "a", [legacyPrefix + "DEBUG"]: "b" })
  normalizeBrandEnv(env)
  assert.equal(env.OTTO_DEBUG, "a")
  assert.equal(env[legacyPrefix + "DEBUG"], "b")
})

test("preserves falsy OTTO values like '0'", () => {
  const env = mk({ OTTO_SHOW_TOKEN_COST: "0" })
  normalizeBrandEnv(env)
  assert.equal(env.OTTO_SHOW_TOKEN_COST, "0")
})

test("leaves a var untouched when no prefix is set", () => {
  const env = mk({})
  normalizeBrandEnv(env)
  assert.equal(env.OTTO_DEBUG, undefined)
  assert.equal(env[legacyPrefix + "DEBUG"], undefined)
})

test("is idempotent", () => {
  const env = mk({ OTTO_GATEWAY_URL: "http://x" })
  normalizeBrandEnv(env)
  normalizeBrandEnv(env)
  assert.equal(env.OTTO_GATEWAY_URL, "http://x")
})
