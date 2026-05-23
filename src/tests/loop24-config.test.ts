import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  configPath,
  type Loop24Config,
} from "../loop24-config.js"

let tmpHome: string
const ORIGINAL_HOME = process.env.HOME
const ORIGINAL_LOOP24_HOME = process.env.LOOP24_HOME

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "loop24-cfg-"))
  process.env.LOOP24_HOME = tmpHome
  // Strip any env-var overrides that could affect precedence tests
  delete process.env.LOOP24_GATEWAY_URL
  delete process.env.LOOP24_GATEWAY_TOKEN
  delete process.env.LANGFLOW_SERVER_URL
  delete process.env.LANGFLOW_API_KEY
  delete process.env.LOOP24_LANGFLOW_DISABLED
})

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
  if (ORIGINAL_HOME !== undefined) process.env.HOME = ORIGINAL_HOME
  if (ORIGINAL_LOOP24_HOME !== undefined) process.env.LOOP24_HOME = ORIGINAL_LOOP24_HOME
  else delete process.env.LOOP24_HOME
})

test("configPath returns ~/.loop24/config.json under LOOP24_HOME override", () => {
  const p = configPath()
  assert.equal(p, join(tmpHome, ".loop24", "config.json"))
})

test("loadConfig returns DEFAULT_CONFIG when no file exists", () => {
  const cfg = loadConfig()
  assert.deepEqual(cfg, DEFAULT_CONFIG)
})

test("loadConfig returns DEFAULT_CONFIG (with warn) when file is invalid JSON", () => {
  const p = configPath()
  mkdirSync(join(tmpHome, ".loop24"), { recursive: true })
  writeFileSync(p, "{ not valid json", { mode: 0o600 })
  // No assertion on warn output here — non-throwing is the contract
  const cfg = loadConfig()
  assert.deepEqual(cfg, DEFAULT_CONFIG)
})

test("loadConfig merges file values over defaults", () => {
  const p = configPath()
  saveConfig({
    gateway: { url: "http://custom-gateway:9000/v1", token: "tok-abc" },
    langflow: { url: "http://lf:7860", apiKey: "lf-key", enabled: false },
  })
  const cfg = loadConfig()
  assert.equal(cfg.gateway.url, "http://custom-gateway:9000/v1")
  assert.equal(cfg.gateway.token, "tok-abc")
  assert.equal(cfg.langflow.url, "http://lf:7860")
  assert.equal(cfg.langflow.apiKey, "lf-key")
  assert.equal(cfg.langflow.enabled, false)
})

test("loadConfig fills missing fields from defaults (partial file)", () => {
  const p = configPath()
  // Write a partial config — only gateway.url set
  saveConfig({
    gateway: { url: "http://x:1/v1" },
    langflow: {},
  } as Partial<Loop24Config> as Loop24Config)
  const cfg = loadConfig()
  assert.equal(cfg.gateway.url, "http://x:1/v1")
  assert.equal(cfg.gateway.token, null, "missing token defaults to null")
  assert.equal(cfg.langflow.url, "http://127.0.0.1:7860", "missing langflow.url defaults to localhost")
  assert.equal(cfg.langflow.enabled, true, "missing enabled defaults to true")
})

test("saveConfig writes the file with mode 0600", () => {
  saveConfig({
    gateway: { url: "http://g:1/v1", token: null },
    langflow: { url: "http://l:7860", apiKey: null, enabled: true },
  })
  const p = configPath()
  assert.ok(existsSync(p), "config file exists")
  const mode = statSync(p).mode & 0o777
  assert.equal(mode, 0o600, `file mode should be 0600, got ${mode.toString(8)}`)
})

test("saveConfig creates the parent directory if missing", () => {
  // tmpHome has no .loop24 yet
  const dir = join(tmpHome, ".loop24")
  assert.ok(!existsSync(dir), "parent dir does not exist yet")
  saveConfig({
    gateway: { url: "http://x:1/v1", token: null },
    langflow: { url: "http://l:7860", apiKey: null, enabled: true },
  })
  assert.ok(existsSync(dir), "parent dir was created")
})

test("saveConfig is atomic — partial write does not corrupt existing file", () => {
  // Write a valid config first
  saveConfig({
    gateway: { url: "http://original:1/v1", token: "orig-tok" },
    langflow: { url: "http://lf:7860", apiKey: null, enabled: true },
  })
  // Now overwrite
  saveConfig({
    gateway: { url: "http://updated:2/v1", token: "new-tok" },
    langflow: { url: "http://lf:7860", apiKey: null, enabled: true },
  })
  const cfg = loadConfig()
  assert.equal(cfg.gateway.url, "http://updated:2/v1")
  assert.equal(cfg.gateway.token, "new-tok")
})

// Project-standard TS-strip-types resolver hook used by every spawn-based test.
// Redirects relative *.js imports to dist/ when running with --experimental-strip-types.
const RESOLVE_TS_HOOK = "./src/resources/extensions/workflow/tests/resolve-ts.mjs"

test("brand.ts picks up config.json values through env propagation", () => {
  // We can't directly test module-load side effects (modules are cached) —
  // spawn a fresh node process where LOOP24_HOME points at our tmpHome and
  // ~/.loop24/config.json contains a known gateway URL.
  saveConfig({
    gateway: { url: "http://from-config-file:9999/v1", token: null },
    langflow: { url: "http://127.0.0.1:7860", apiKey: null, enabled: true },
  })

  const probe = `import('./src/brand.ts').then(m => process.stdout.write(String(m.LOOP24_GATEWAY_URL)))`
  const result = spawnSync(
    "node",
    [
      "--import",
      RESOLVE_TS_HOOK,
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      probe,
    ],
    {
      env: {
        ...process.env,
        LOOP24_HOME: tmpHome,
        // Clear any inherited value so the config-file fallback activates
        LOOP24_GATEWAY_URL: "",
      },
      cwd: process.cwd(),
      encoding: "utf-8",
    },
  )
  assert.equal(result.status, 0, `node probe failed: ${result.stderr}`)
  assert.equal(result.stdout.trim(), "http://from-config-file:9999/v1")
})

test("env var wins over config.json when both are set", () => {
  saveConfig({
    gateway: { url: "http://from-config:9999/v1", token: null },
    langflow: { url: "http://127.0.0.1:7860", apiKey: null, enabled: true },
  })

  const probe = `import('./src/brand.ts').then(m => process.stdout.write(String(m.LOOP24_GATEWAY_URL)))`
  const result = spawnSync(
    "node",
    [
      "--import",
      RESOLVE_TS_HOOK,
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      probe,
    ],
    {
      env: {
        ...process.env,
        LOOP24_HOME: tmpHome,
        LOOP24_GATEWAY_URL: "http://from-env-var:1111/v1",
      },
      cwd: process.cwd(),
      encoding: "utf-8",
    },
  )
  assert.equal(result.status, 0, `node probe failed: ${result.stderr}`)
  assert.equal(result.stdout.trim(), "http://from-env-var:1111/v1")
})
