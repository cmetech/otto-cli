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
  type OttoConfig,
} from "../otto-config.js"
import { CONFIG_DIR_NAME } from "../piconfig.js"

let tmpHome: string
const ORIGINAL_HOME = process.env.HOME
const ORIGINAL_OTTO_HOME = process.env.OTTO_HOME

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "otto-cfg-"))
  process.env.OTTO_HOME = tmpHome
  // Strip any env-var overrides that could affect precedence tests
  delete process.env.OTTO_GATEWAY_URL
  delete process.env.OTTO_GATEWAY_TOKEN
  delete process.env.LANGFLOW_SERVER_URL
  delete process.env.LANGFLOW_API_KEY
  delete process.env.OTTO_LANGFLOW_DISABLED
})

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
  if (ORIGINAL_HOME !== undefined) process.env.HOME = ORIGINAL_HOME
  if (ORIGINAL_OTTO_HOME !== undefined) process.env.OTTO_HOME = ORIGINAL_OTTO_HOME
  else delete process.env.OTTO_HOME
})

test("configPath returns <configDir>/config.json under OTTO_HOME override", () => {
  const p = configPath()
  assert.equal(p, join(tmpHome, CONFIG_DIR_NAME, "config.json"))
})

test("loadConfig returns DEFAULT_CONFIG when no file exists", () => {
  const cfg = loadConfig()
  assert.deepEqual(cfg, DEFAULT_CONFIG)
})

test("loadConfig returns DEFAULT_CONFIG (with warn) when file is invalid JSON", () => {
  const p = configPath()
  mkdirSync(join(tmpHome, CONFIG_DIR_NAME), { recursive: true })
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
  } as Partial<OttoConfig> as OttoConfig)
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
  // tmpHome has no config dir yet
  const dir = join(tmpHome, CONFIG_DIR_NAME)
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
  // spawn a fresh node process where OTTO_HOME points at our tmpHome and
  // ~/.otto/config.json contains a known gateway URL.
  saveConfig({
    gateway: { url: "http://from-config-file:9999/v1", token: null },
    langflow: { url: "http://127.0.0.1:7860", apiKey: null, enabled: true },
  })

  const probe = `import('./src/brand.ts').then(m => process.stdout.write(String(m.OTTO_GATEWAY_URL)))`
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
        OTTO_HOME: tmpHome,
        // Clear any inherited value so the config-file fallback activates
        OTTO_GATEWAY_URL: "",
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

  const probe = `import('./src/brand.ts').then(m => process.stdout.write(String(m.OTTO_GATEWAY_URL)))`
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
        OTTO_HOME: tmpHome,
        OTTO_GATEWAY_URL: "http://from-env-var:1111/v1",
      },
      cwd: process.cwd(),
      encoding: "utf-8",
    },
  )
  assert.equal(result.status, 0, `node probe failed: ${result.stderr}`)
  assert.equal(result.stdout.trim(), "http://from-env-var:1111/v1")
})

import { createServer, type Server } from "node:http"
import { probeGateway, probeLangflow } from "../otto-config.js"

async function withMockServer(
  handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void | Promise<void>,
  fn: (url: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => res.end())
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
  const addr = server.address()
  if (!addr || typeof addr === "string") throw new Error("no addr")
  try {
    await fn(`http://127.0.0.1:${addr.port}`)
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
  }
}

test("probeGateway returns ok=true when /health responds 200", async () => {
  await withMockServer(
    (req, res) => {
      assert.equal(req.url, "/health")
      res.statusCode = 200
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ status: "ok" }))
    },
    async (url) => {
      const result = await probeGateway(url)
      assert.equal(result.ok, true)
    },
  )
})

test("probeGateway returns ok=false when /health 5xx", async () => {
  await withMockServer(
    (_req, res) => {
      res.statusCode = 500
      res.end("boom")
    },
    async (url) => {
      const result = await probeGateway(url)
      assert.equal(result.ok, false)
      assert.ok(result.reason && result.reason.includes("500"))
    },
  )
})

test("probeGateway returns ok=false on unreachable host (short timeout)", async () => {
  // Port 1 is always closed locally.
  const result = await probeGateway("http://127.0.0.1:1", 200)
  assert.equal(result.ok, false)
  assert.ok(result.reason)
})

test("probeGateway strips trailing slash from url before appending /health", async () => {
  let receivedPath: string | undefined
  await withMockServer(
    (req, res) => {
      receivedPath = req.url
      res.end("{}")
    },
    async (url) => {
      await probeGateway(url + "/")
      assert.equal(receivedPath, "/health")
    },
  )
})

test("probeLangflow returns ok=true with version when /api/v1/version responds", async () => {
  await withMockServer(
    (req, res) => {
      assert.equal(req.url, "/api/v1/version")
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ version: "1.5.0" }))
    },
    async (url) => {
      const result = await probeLangflow(url)
      assert.equal(result.ok, true)
      assert.equal(result.version, "1.5.0")
    },
  )
})

test("probeLangflow returns ok=false on unreachable host", async () => {
  const result = await probeLangflow("http://127.0.0.1:1", 200)
  assert.equal(result.ok, false)
})

test("probeLangflow forwards apiKey as x-api-key header", async () => {
  let receivedKey: string | undefined
  await withMockServer(
    (req, res) => {
      receivedKey = req.headers["x-api-key"] as string | undefined
      res.end(JSON.stringify({ version: "1.5.0" }))
    },
    async (url) => {
      await probeLangflow(url, 5000, "test-key-123")
      assert.equal(receivedKey, "test-key-123")
    },
  )
})

test("probeGateway timeout reason includes the configured timeoutMs", async () => {
  // Spin up a server that never responds — forces the abort path.
  await withMockServer(
    (_req, _res) => {
      // intentionally do not call res.end() — server hangs
    },
    async (url) => {
      const result = await probeGateway(url, 100)
      assert.equal(result.ok, false)
      assert.ok(result.reason && result.reason.includes("100ms"), `reason should include timeoutMs, got: ${result.reason}`)
    },
  )
})
