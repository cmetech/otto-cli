import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeBrandEnv } from "../env-normalize.js"

// Use an injected env object so we never touch the real process.env.
function mk(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return env as NodeJS.ProcessEnv
}

test("OTTO_* takes precedence and is mirrored to LOOP24_/GSD_", () => {
  const env = mk({ OTTO_DEBUG: "1" })
  normalizeBrandEnv(env)
  assert.equal(env.OTTO_DEBUG, "1")
  assert.equal(env.LOOP24_DEBUG, "1")
  assert.equal(env.GSD_DEBUG, "1")
})

test("LOOP24_* is used and mirrored when OTTO_* is unset", () => {
  const env = mk({ LOOP24_DEBUG: "1" })
  normalizeBrandEnv(env)
  assert.equal(env.OTTO_DEBUG, "1")
  assert.equal(env.LOOP24_DEBUG, "1")
  assert.equal(env.GSD_DEBUG, "1")
})

test("GSD_* (legacy) is used and mirrored when OTTO_/LOOP24_ are unset", () => {
  const env = mk({ GSD_DEBUG: "1" })
  normalizeBrandEnv(env)
  assert.equal(env.OTTO_DEBUG, "1")
  assert.equal(env.LOOP24_DEBUG, "1")
  assert.equal(env.GSD_DEBUG, "1")
})

test("does not clobber an already-set lower-precedence name", () => {
  const env = mk({ OTTO_DEBUG: "a", LOOP24_DEBUG: "b" })
  normalizeBrandEnv(env)
  assert.equal(env.OTTO_DEBUG, "a")
  assert.equal(env.LOOP24_DEBUG, "b") // preserved, not overwritten by OTTO value
  assert.equal(env.GSD_DEBUG, "a") // only the unset one gets the resolved value
})

test("preserves falsy values like '0' (defined-ness, not truthiness)", () => {
  const env = mk({ OTTO_SHOW_TOKEN_COST: "0" })
  normalizeBrandEnv(env)
  assert.equal(env.LOOP24_SHOW_TOKEN_COST, "0")
  assert.equal(env.GSD_SHOW_TOKEN_COST, "0")
})

test("leaves a var untouched when no prefix is set", () => {
  const env = mk({})
  normalizeBrandEnv(env)
  assert.equal(env.OTTO_DEBUG, undefined)
  assert.equal(env.LOOP24_DEBUG, undefined)
  assert.equal(env.GSD_DEBUG, undefined)
})

test("is idempotent", () => {
  const env = mk({ LOOP24_GATEWAY_URL: "http://x" })
  normalizeBrandEnv(env)
  normalizeBrandEnv(env)
  assert.equal(env.OTTO_GATEWAY_URL, "http://x")
  assert.equal(env.LOOP24_GATEWAY_URL, "http://x")
  assert.equal(env.GSD_GATEWAY_URL, "http://x")
})
