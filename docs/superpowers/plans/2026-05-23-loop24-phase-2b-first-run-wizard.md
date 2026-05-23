# LOOP24 Phase 2b — First-Run Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace today's env-var-only LOOP24-services configuration with a first-run clack wizard that captures gateway + LangFlow values and persists them to `~/.loop24/config.json` (mode `0600`). Env vars still win over the config file so CI / scripted use keeps working. Wizard triggers on missing config OR via a new `loop24 setup` subcommand.

**Architecture:** A new synchronous config-loader module (`src/loop24-config.ts`) reads `~/.loop24/config.json` at process start, applies env-var overrides, and *populates `process.env`* with the merged values. Downstream code — `packages/pi-ai/src/providers/anthropic.ts`, `src/resources/extensions/loop24/index.ts`, `src/brand.ts` — keeps reading the same `LOOP24_GATEWAY_URL` / `LOOP24_GATEWAY_TOKEN` / `LANGFLOW_SERVER_URL` / `LANGFLOW_API_KEY` env vars, so nothing else has to change. A separate wizard module (`src/loop24-wizard.ts`) mirrors `src/onboarding.ts`'s clack pattern: prompt → probe → soft-warn → save. The wizard runs on first launch when `~/.loop24/config.json` is missing and on demand via `loop24 setup`.

**Tech Stack:** TypeScript, Node ≥22 (built-in `fs.readFileSync`, `fs.writeFileSync` w/ mode 0600), `@clack/prompts` (already a dependency, used by `src/onboarding.ts`), `chalk` (color helpers, already in `src/onboarding.ts`), Node's built-in test runner (`node --test --experimental-strip-types`).

**⚠️ TS strip-types constraint:** `src/loop24-config.ts` lives on the loader fast path (transitively imported via `src/brand.ts`). Use synchronous file I/O only, no compiled-module imports, no parameter-property constructors, no `enum` / `namespace` / `import =`. Same constraint that already governs `src/brand.ts`, `src/app-paths.ts`, and `src/help-text.ts`.

**Scope boundary:**

In scope:
- Persistent `~/.loop24/config.json` schema (gateway URL/token, langflow URL/apiKey/enabled)
- Synchronous config reader (graceful on missing file / bad JSON)
- Atomic writer (`tmp + rename`, file mode `0600`)
- Env-var precedence: env > config.json > defaults
- Process.env propagation (so existing `process.env.LOOP24_GATEWAY_URL` reads in `packages/pi-ai/src/providers/anthropic.ts` and `src/resources/extensions/loop24/index.ts` automatically honor config.json)
- Clack-based interactive wizard that prompts for all five values, probes services, soft-warns on failure, and writes the config file
- First-run trigger in `src/cli.ts` (TTY + missing config.json + not `--print` mode)
- `loop24 setup` subcommand to re-run the wizard on demand
- Headless / `--print` fallback: skip the wizard, emit one warn line if neither config.json nor env vars are present
- Update LOOP24-PATCHES.md with the Phase 2b section
- Regression: existing 89+ tests still pass

Out of scope (deferred):
- Migration of pre-existing env-var-only installs (the LOOP24 install base is "us" — no migration needed; first launch after Phase 2b just runs the wizard once)
- Modifying the existing `loop24 config` subcommand (it stays as the LLM-auth wizard via `runOnboarding`; new wizard gets `loop24 setup` to avoid colliding)
- A `loop24 setup --reset` / non-interactive flags (just re-run interactively for now)
- Separate gateway/langflow-only sub-flows (`loop24 setup gateway`, `loop24 setup langflow`) — single combined wizard for v1, can split later
- A schema-versioning field in config.json — YAGNI; we'd add it the day we need it

**Dependencies:**
- Requires Phase 1 (env-var gateway routing) and Phase 3 (LangFlow client + extension) complete. This phase only adds the persistence + UX layer on top; the env-var reads from those phases stay the canonical seam.
- `@clack/prompts` already installed (used by `src/onboarding.ts`).

**Naming decision — `loop24 setup` (not `loop24 config`):**

`loop24 config` is already wired in `src/cli.ts:366-372` to re-launch the LLM-auth wizard via `runOnboarding`. Two wizards under one subcommand would either chain them (annoying re-run UX) or require an extra "which one?" prompt. Cleanest is a distinct subcommand: `loop24 setup` for LOOP24 services (gateway + langflow), `loop24 config` continues to run the LLM-auth wizard. Document the rationale in `LOOP24-PATCHES.md`.

---

## File Structure

### New files

```
src/
├── loop24-config.ts         # NEW — schema, reader, writer, env propagation
├── loop24-wizard.ts         # NEW — clack-based interactive wizard
└── tests/
    └── loop24-config.test.ts   # NEW — config I/O + precedence tests
```

### Modified files

```
src/
├── brand.ts                 # import loop24-config.ts at top so its side-effect
│                            # env propagation happens before brand.ts reads
│                            # process.env.LOOP24_GATEWAY_URL
├── cli.ts                   # add `loop24 setup` subcommand; add first-run
│                            # wizard trigger (config.json missing && TTY && !--print)
└── resources/extensions/loop24/index.ts  # (optional) tighten langflow URL default
                             # to read from loop24-config — purely cosmetic since
                             # env-var read already works. Skip if too disruptive.

LOOP24-PATCHES.md            # add Phase 2b section
```

### File responsibilities (one-liners)

| File | Responsibility |
|---|---|
| `src/loop24-config.ts` | Sync read of `~/.loop24/config.json`, apply env overrides, populate `process.env` for downstream consumers, expose `loadConfig()` / `saveConfig()` / `configPath()` helpers |
| `src/loop24-wizard.ts` | `runWizard()` — clack prompts → probes (`/health`, `/api/v1/version`) → soft-warns → `saveConfig()` |
| `src/tests/loop24-config.test.ts` | TDD for reader, writer (incl. mode 0600), env precedence, defaults |
| `src/brand.ts` (modified) | Imports `loop24-config.js` at top so module-load side-effect runs before `process.env.LOOP24_GATEWAY_URL?.trim()` is read |
| `src/cli.ts` (modified) | `loop24 setup` subcommand + first-run trigger + headless warn |

### Config schema (canonical)

```json
{
  "gateway": {
    "url": "http://127.0.0.1:8080/v1",
    "token": null
  },
  "langflow": {
    "url": "http://127.0.0.1:7860",
    "apiKey": null,
    "enabled": true
  }
}
```

- All fields are present after a successful wizard run (no missing keys).
- `gateway.token` and `langflow.apiKey` are `null` for unauthenticated local services.
- `langflow.enabled: false` means "user opted out of LangFlow"; the loop24 extension's session_start probe should treat this the same as offline (no probe attempt).

### Env-var precedence (canonical)

Order: **env var > config.json field > built-in default.**

| Config field | Env var | Built-in default |
|---|---|---|
| `gateway.url` | `LOOP24_GATEWAY_URL` | `undefined` (direct-to-Anthropic) |
| `gateway.token` | `LOOP24_GATEWAY_TOKEN` | `undefined` |
| `langflow.url` | `LANGFLOW_SERVER_URL` | `"http://127.0.0.1:7860"` |
| `langflow.apiKey` | `LANGFLOW_API_KEY` | `undefined` |
| `langflow.enabled` | `LOOP24_LANGFLOW_DISABLED` (truthy → false) | `true` |

After Phase 2b, downstream code keeps reading `process.env.*`. The new `loop24-config.ts` populates `process.env` from the config file ONLY when the env var is unset, so env always wins.

---

## Task 1: Config schema + sync reader/writer with 0600 mode (TDD)

**Files:**
- Create: `src/loop24-config.ts`
- Create: `src/tests/loop24-config.test.ts`

This task lands the data layer (schema, defaults, file I/O) without touching the rest of the codebase yet. Pure functions, easy to test.

- [ ] **Step 1: Inspect `src/brand.ts` for the synchronous-file-I/O pattern this module must mirror**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
cat src/brand.ts
```

Note: `readFileSync` + `JSON.parse` inside a try/catch; no top-level await; no compiled-module imports. Mirror that style exactly.

- [ ] **Step 2: Write the failing tests**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/tests/loop24-config.test.ts`:

```typescript
import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync, chmodSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { join } from "node:path"
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
```

- [ ] **Step 3: Run tests — verify FAIL**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/loop24-config.test.ts 2>&1 | tail -10
```
Expected: FAIL — module `../loop24-config.js` does not exist.

- [ ] **Step 4: Implement `src/loop24-config.ts`**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/loop24-config.ts`:

```typescript
/**
 * LOOP24 services config — gateway + langflow.
 *
 * Synchronous read/write of ~/.loop24/config.json. Mirrors src/brand.ts's
 * loader-safe pattern: no compiled-module imports, no top-level await, no
 * parameter-property constructors. This module is transitively imported by
 * brand.ts so it runs on the --version / --help fast path.
 *
 * Precedence (canonical, used by the env-propagation side effect below):
 *   env var > config.json field > built-in default
 *
 * The side effect at module load time populates process.env from config.json
 * ONLY when the env var is unset. Downstream consumers (pi-ai's anthropic.ts,
 * the loop24 extension's session_start probe) keep reading process.env so
 * nothing else has to change.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

// ─── Schema ───────────────────────────────────────────────────────────────────

export interface Loop24Config {
  gateway: {
    url: string | null
    token: string | null
  }
  langflow: {
    url: string
    apiKey: string | null
    enabled: boolean
  }
}

export const DEFAULT_CONFIG: Loop24Config = {
  gateway: {
    // Placeholder — real loop24-gateway port confirmed when SURF-V2-01 ships.
    url: null,
    token: null,
  },
  langflow: {
    url: "http://127.0.0.1:7860",
    apiKey: null,
    enabled: true,
  },
}

// ─── Paths ────────────────────────────────────────────────────────────────────

/**
 * Resolve ~/.loop24/config.json. Honors LOOP24_HOME (test override) and
 * falls back to homedir(). Matches the convention used by src/app-paths.ts.
 */
export function configPath(): string {
  const root = process.env.LOOP24_HOME || homedir()
  return join(root, ".loop24", "config.json")
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Load config from disk. Returns DEFAULT_CONFIG when the file is missing,
 * unreadable, or invalid JSON. Never throws — this runs on the loader hot path.
 *
 * Missing nested fields are filled from defaults so callers can rely on every
 * field being present.
 */
export function loadConfig(): Loop24Config {
  const p = configPath()
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(p, "utf-8"))
  } catch {
    return cloneDefault()
  }
  if (raw === null || typeof raw !== "object") return cloneDefault()
  const r = raw as Partial<Loop24Config>

  const gw = (r.gateway as Partial<Loop24Config["gateway"]>) ?? {}
  const lf = (r.langflow as Partial<Loop24Config["langflow"]>) ?? {}

  return {
    gateway: {
      url: typeof gw.url === "string" && gw.url.trim() ? gw.url.trim() : DEFAULT_CONFIG.gateway.url,
      token: typeof gw.token === "string" && gw.token.trim() ? gw.token.trim() : DEFAULT_CONFIG.gateway.token,
    },
    langflow: {
      url: typeof lf.url === "string" && lf.url.trim() ? lf.url.trim() : DEFAULT_CONFIG.langflow.url,
      apiKey: typeof lf.apiKey === "string" && lf.apiKey.trim() ? lf.apiKey.trim() : DEFAULT_CONFIG.langflow.apiKey,
      enabled: typeof lf.enabled === "boolean" ? lf.enabled : DEFAULT_CONFIG.langflow.enabled,
    },
  }
}

function cloneDefault(): Loop24Config {
  return {
    gateway: { url: DEFAULT_CONFIG.gateway.url, token: DEFAULT_CONFIG.gateway.token },
    langflow: {
      url: DEFAULT_CONFIG.langflow.url,
      apiKey: DEFAULT_CONFIG.langflow.apiKey,
      enabled: DEFAULT_CONFIG.langflow.enabled,
    },
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Persist config atomically with mode 0600. Writes to <path>.tmp first then
 * renames, so a crash mid-write never leaves a half-written file in place of
 * the previous good config.
 */
export function saveConfig(cfg: Loop24Config): void {
  const p = configPath()
  const dir = dirname(p)
  mkdirSync(dir, { recursive: true, mode: 0o700 })

  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 })
  renameSync(tmp, p)
}

// ─── Env propagation (module side effect) ─────────────────────────────────────

/**
 * Populate process.env from config.json for any env var that is unset.
 * Env always wins — we never overwrite an existing process.env entry.
 *
 * This is the seam that lets the rest of the codebase keep using env-var
 * reads while gaining config-file fallback "for free".
 */
function applyConfigToEnv(cfg: Loop24Config): void {
  if (!process.env.LOOP24_GATEWAY_URL?.trim() && cfg.gateway.url) {
    process.env.LOOP24_GATEWAY_URL = cfg.gateway.url
  }
  if (!process.env.LOOP24_GATEWAY_TOKEN?.trim() && cfg.gateway.token) {
    process.env.LOOP24_GATEWAY_TOKEN = cfg.gateway.token
  }
  if (!process.env.LANGFLOW_SERVER_URL?.trim() && cfg.langflow.url) {
    process.env.LANGFLOW_SERVER_URL = cfg.langflow.url
  }
  if (!process.env.LANGFLOW_API_KEY?.trim() && cfg.langflow.apiKey) {
    process.env.LANGFLOW_API_KEY = cfg.langflow.apiKey
  }
  if (!process.env.LOOP24_LANGFLOW_DISABLED?.trim() && cfg.langflow.enabled === false) {
    process.env.LOOP24_LANGFLOW_DISABLED = "1"
  }
}

// Module-load side effect: run once at import time so downstream env reads
// see config.json values. Wrapped in try/catch — must never break the loader.
try {
  applyConfigToEnv(loadConfig())
} catch {
  /* defensive — should never throw, but absolutely must not break boot */
}
```

- [ ] **Step 5: Run tests — verify PASS**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | grep -E "(error|fail)" | head -3 || echo "build clean"
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/loop24-config.test.ts 2>&1 | tail -10
```
Expected: 8/8 pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/loop24-config.ts src/tests/loop24-config.test.ts
git commit -m "feat(config): add loop24-config module — schema, reader, atomic writer

Adds src/loop24-config.ts with:
- Loop24Config TypeScript schema (gateway + langflow)
- loadConfig() — sync, non-throwing, returns DEFAULT_CONFIG on missing/bad file
- saveConfig() — atomic tmp+rename write with mode 0600
- configPath() — honors LOOP24_HOME override (test seam)
- Module-load side effect: applies config.json values to process.env for any
  unset env var, so downstream code keeps reading process.env unchanged.

8 TDD tests cover defaults, file precedence, partial merges, mode 0600,
parent-dir creation, and atomic overwrite. Module sits on the loader fast
path — mirrors src/brand.ts's synchronous-IO pattern."
```

---

## Task 2: Wire config-loader into brand.ts so env propagation runs on the loader path (TDD)

**Files:**
- Modify: `src/brand.ts`

The Task 1 module already has a load-time side effect that populates `process.env`. But that side effect only runs when something imports `loop24-config.js`. Today, nothing does. We need at least one early-loaded module to import it.

`src/brand.ts` is the right hook because:
- It's already loader-fast (synchronous, no compiled-module imports).
- It already reads `process.env.LOOP24_GATEWAY_URL` at module load — and we want the config-file fallback to apply BEFORE that read.
- Other modules (`src/onboarding.ts`, `src/welcome-screen.ts`, etc.) already import `brand.js`, so adding it here propagates the side effect everywhere brand strings are used.

- [ ] **Step 1: Inspect current `src/brand.ts`**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
cat src/brand.ts
```

Confirm: it reads `process.env.LOOP24_GATEWAY_URL` at module top level (after the piConfig block). The config-loader import must come BEFORE that read.

- [ ] **Step 2: Add the import at the top of `src/brand.ts`**

Edit `src/brand.ts`. The current top of the file:
```typescript
/**
 * Shared brand strings.
 * ...
 */
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
```

Add an import for the config-loader at the very top of the import block (before the other imports). The import is purely for its load-time side effect — we don't use any named export here:

```typescript
/**
 * Shared brand strings.
 * ...
 */
// Load LOOP24 services config first — its module-load side effect populates
// process.env from ~/.loop24/config.json for any env var that is unset.
// This ensures the LOOP24_GATEWAY_URL read below picks up config-file values
// when no env override is in place.
import './loop24-config.js'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
```

The `LOOP24_GATEWAY_URL` / `LOOP24_GATEWAY_TOKEN` exports later in the file stay as-is. They were already reading `process.env`, and now `process.env` is pre-populated from config.json (when no env override is in place) — so they pick up the file value automatically.

- [ ] **Step 3: Add a test verifying the env-fallback chain**

Append to `/Users/coreyellis/Projects/repos/local/loop24-client/src/tests/loop24-config.test.ts`:

```typescript
import { spawnSync } from "node:child_process"

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
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      probe,
    ],
    {
      env: {
        ...process.env,
        LOOP24_HOME: tmpHome,
        // Explicitly unset any inherited env override
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
```

These spawn fresh `node` processes so the module-load side effect actually runs (vs. importing `brand.ts` in the current test process where module caching makes the side effect a one-shot).

- [ ] **Step 4: Run tests + build**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/loop24-config.test.ts 2>&1 | tail -10
```
Expected: 10/10 pass (8 from Task 1 + 2 new).

Also verify the loader fast path is unaffected:
```bash
node dist/loader.js --version
```
Expected: `1.0.1`. If this hangs or throws, the side-effect import broke the fast path.

- [ ] **Step 5: Verify pi-ai's gateway tests still pass (regression)**

`packages/pi-ai/src/providers/anthropic.ts` reads `process.env.LOOP24_GATEWAY_URL` at function call time. Those tests delete the env var in `beforeEach`. Our module-load side effect runs ONCE per process; if a test process happens to import `brand.ts` (directly or transitively) before the test runs, `LOOP24_HOME` would resolve to the real `~/` and any config there would leak in.

Mitigate by confirming the existing tests still pass (they set/unset env vars per test, which dominates):
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  packages/pi-ai/src/providers/anthropic.gateway.test.ts \
  packages/pi-ai/src/providers/anthropic-auth.test.ts \
  packages/pi-ai/src/providers/anthropic-bearer-auth.test.ts \
  packages/pi-ai/src/providers/anthropic-shared.test.ts \
  2>&1 | tail -8
```
Expected: all pass. If something fails, the implementer must point `LOOP24_HOME` at a tmpdir for the affected test suite (or check whether brand.ts is imported transitively — it should not be, since pi-ai is a separate workspace).

- [ ] **Step 6: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/brand.ts src/tests/loop24-config.test.ts
git commit -m "feat(brand): wire loop24-config into the loader path

Adds a side-effect import of './loop24-config.js' at the top of src/brand.ts.
That module's load-time side effect populates process.env from
~/.loop24/config.json (only for unset env vars), so brand.ts's existing
LOOP24_GATEWAY_URL / LOOP24_GATEWAY_TOKEN reads now transparently honor
the config file when no env override is in place.

Two new spawn-based tests verify the full chain: brand.ts picks up
config.json values, and env vars still win when both are set."
```

---

## Task 3: Service probes — extract pure functions usable by both wizard and tests (TDD)

**Files:**
- Modify: `src/loop24-config.ts` (add `probeGateway()` / `probeLangflow()` exports)
- Modify: `src/tests/loop24-config.test.ts` (add probe tests)

The wizard needs to validate user input by calling `GET <gateway>/health` and `GET <langflow>/api/v1/version`. Extract those probes as pure async functions in `loop24-config.ts` (next to the rest of the LOOP24-services plumbing) so they can be unit-tested against in-process mock servers.

- [ ] **Step 1: Add the probe tests (failing)**

Append to `/Users/coreyellis/Projects/repos/local/loop24-client/src/tests/loop24-config.test.ts`:

```typescript
import { createServer, type Server } from "node:http"
import { probeGateway, probeLangflow } from "../loop24-config.js"

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
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/loop24-config.test.ts 2>&1 | tail -10
```
Expected: import error — `probeGateway` / `probeLangflow` not exported yet.

- [ ] **Step 3: Implement the probes in `src/loop24-config.ts`**

Append to `/Users/coreyellis/Projects/repos/local/loop24-client/src/loop24-config.ts`:

```typescript
// ─── Probes ───────────────────────────────────────────────────────────────────

export interface ProbeResult {
  ok: boolean
  reason?: string  // populated when ok=false
}

export interface LangflowProbeResult extends ProbeResult {
  version?: string
}

/**
 * Probe gateway /health. Returns ok=true on 2xx, ok=false with a reason on
 * any other outcome (non-2xx, network error, timeout). Never throws.
 *
 * Default 2000ms timeout — runs interactively in the wizard, so a short
 * budget is OK. Used by both the wizard (post-prompt validation) and the
 * loop24 extension's session_start probe (which has its own 1500ms timeout).
 */
export async function probeGateway(url: string, timeoutMs = 2000): Promise<ProbeResult> {
  const target = `${url.replace(/\/+$/, "")}/health`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(target, { signal: ctl.signal })
    if (res.ok) return { ok: true }
    return { ok: false, reason: `${res.status} ${res.statusText}` }
  } catch (err) {
    return { ok: false, reason: (err as Error).message }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Probe LangFlow /api/v1/version. Returns ok=true + version string on success.
 * Optional apiKey is sent as x-api-key header (LangFlow's auth shape; verified
 * in LANGFLOW-API.md from Phase 3).
 */
export async function probeLangflow(url: string, timeoutMs = 2000, apiKey?: string): Promise<LangflowProbeResult> {
  const target = `${url.replace(/\/+$/, "")}/api/v1/version`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = {}
    if (apiKey) headers["x-api-key"] = apiKey
    const res = await fetch(target, { signal: ctl.signal, headers })
    if (!res.ok) return { ok: false, reason: `${res.status} ${res.statusText}` }
    const body = (await res.json()) as { version?: string }
    return { ok: true, version: body.version }
  } catch (err) {
    return { ok: false, reason: (err as Error).message }
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/loop24-config.test.ts 2>&1 | tail -10
```
Expected: 17/17 pass (10 prior + 7 new).

- [ ] **Step 5: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/loop24-config.ts src/tests/loop24-config.test.ts
git commit -m "feat(config): add probeGateway + probeLangflow

Pure async helpers used by both the upcoming Phase 2b wizard and (later)
any caller that wants to validate the configured gateway/langflow services.

probeGateway: GET <url>/health, 2s default timeout, returns { ok, reason? }.
probeLangflow: GET <url>/api/v1/version, optional x-api-key header from the
caller-supplied apiKey, returns { ok, reason?, version? }.

Both never throw. Seven TDD tests against in-process mock HTTP servers
cover happy path, 5xx, unreachable host, trailing-slash normalization,
and apiKey header forwarding."
```

---

## Task 4: Wizard module — clack-based interactive UX

**Files:**
- Create: `src/loop24-wizard.ts`

Mirrors `src/onboarding.ts`'s clack-based UX style: dynamic-import `@clack/prompts` (so missing-dep errors degrade gracefully), brand-yellow intro, sequential `text`/`password`/`confirm` prompts, spinner during probes, soft-warn on probe failure, persist via `saveConfig`. No TDD here — interactive UX is hard to test in isolation. Unit-testable pieces (probes, persistence) already covered in Tasks 1 and 3.

- [ ] **Step 1: Inspect `src/onboarding.ts`'s clack patterns to mirror**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
sed -n '120,170p' src/onboarding.ts    # loadClack, loadPico
sed -n '290,320p' src/onboarding.ts    # intro pattern
```

Note: `loadClack()`/`loadPico()` use dynamic imports + try/catch fallback. `p.text()`, `p.password()`, `p.confirm()` for prompts. `p.isCancel(result)` checks for Ctrl-C. `p.note()` + `p.outro()` for the summary.

- [ ] **Step 2: Write `src/loop24-wizard.ts`**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/loop24-wizard.ts`:

```typescript
/**
 * LOOP24 services first-run wizard.
 *
 * Captures gateway + langflow config from the user and persists to
 * ~/.loop24/config.json (mode 0600). Soft-warns on probe failure rather
 * than refusing to save — users frequently configure LOOP24 before the
 * services are running.
 *
 * Mirrors src/onboarding.ts's @clack/prompts + chalk pattern. Dynamic
 * imports so a missing @clack/prompts dependency degrades to a single
 * warn line instead of crashing boot.
 *
 * Re-entry: idempotent. Re-running just overwrites the existing config
 * (Task 5 wires this into the `loop24 setup` subcommand).
 */

import { BRAND_NAME, COMMAND_NAMESPACE } from './brand.js'
import {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  configPath,
  probeGateway,
  probeLangflow,
  type Loop24Config,
} from './loop24-config.js'

type ClackModule = typeof import('@clack/prompts')
type ChalkModule = typeof import('chalk').default

async function loadClack(): Promise<ClackModule | null> {
  try { return await import('@clack/prompts') } catch { return null }
}

async function loadChalk(): Promise<ChalkModule | null> {
  try { return (await import('chalk')).default } catch { return null }
}

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch { return false }
}

/**
 * Run the wizard interactively. Returns the saved config on success, null on
 * user cancel. Never throws — any I/O failure during save is logged and the
 * function returns null.
 */
export async function runLoop24Wizard(): Promise<Loop24Config | null> {
  const p = await loadClack()
  const chalk = await loadChalk()

  if (!p) {
    process.stderr.write(
      `[${COMMAND_NAMESPACE}] @clack/prompts not found — cannot run wizard.\n` +
      `[${COMMAND_NAMESPACE}] Set LOOP24_GATEWAY_URL and LANGFLOW_SERVER_URL env vars instead.\n`,
    )
    return null
  }

  const brandYellow = (s: string) => `\x1b[38;2;250;210;45m${s}\x1b[0m`
  const dim = chalk ? (s: string) => chalk.dim(s) : (s: string) => s
  const green = chalk ? (s: string) => chalk.green(s) : (s: string) => s
  const red = chalk ? (s: string) => chalk.red(s) : (s: string) => s

  p.intro(brandYellow(`${BRAND_NAME} — services setup`))
  p.log.info(dim(`Saves to ${configPath()} (mode 0600).`))
  p.log.info(dim(`Env vars (LOOP24_GATEWAY_URL etc.) always override this file.`))

  // Load existing config (or defaults) so re-running the wizard uses
  // current values as the prompt defaults.
  const existing = loadConfig()

  // ── Gateway URL ───────────────────────────────────────────────────────────
  const gatewayUrlDefault = existing.gateway.url ?? "http://127.0.0.1:8080/v1"
  const gatewayUrlAns = await p.text({
    message: 'Gateway URL?',
    placeholder: gatewayUrlDefault,
    initialValue: gatewayUrlDefault,
    validate: (val) => {
      const v = val?.trim()
      if (!v) return 'Gateway URL is required'
      if (!isValidHttpUrl(v)) return 'Must be a valid http(s) URL'
    },
  })
  if (p.isCancel(gatewayUrlAns)) { p.cancel('Setup cancelled.'); return null }
  const gatewayUrl = (gatewayUrlAns as string).trim()

  // ── Gateway token (optional) ──────────────────────────────────────────────
  const wantsToken = await p.confirm({
    message: 'Does the gateway require a bearer token?',
    initialValue: existing.gateway.token !== null,
  })
  if (p.isCancel(wantsToken)) { p.cancel('Setup cancelled.'); return null }

  let gatewayToken: string | null = null
  if (wantsToken) {
    const tok = await p.password({ message: 'Paste the gateway bearer token:', mask: '●' })
    if (p.isCancel(tok)) { p.cancel('Setup cancelled.'); return null }
    const t = (tok as string).trim()
    gatewayToken = t || null
  }

  // ── Probe gateway ─────────────────────────────────────────────────────────
  const s1 = p.spinner()
  s1.start(`Probing gateway at ${gatewayUrl}...`)
  const gwProbe = await probeGateway(gatewayUrl)
  if (gwProbe.ok) {
    s1.stop(green(`Gateway reachable at ${gatewayUrl}`))
  } else {
    s1.stop(red(`Gateway probe failed: ${gwProbe.reason}`))
    p.log.warn(`Saving anyway — the gateway may not be running yet.`)
  }

  // ── LangFlow enabled? ─────────────────────────────────────────────────────
  const langflowEnabled = await p.confirm({
    message: 'Use LangFlow?',
    initialValue: existing.langflow.enabled,
  })
  if (p.isCancel(langflowEnabled)) { p.cancel('Setup cancelled.'); return null }

  let langflowUrl = existing.langflow.url
  let langflowApiKey: string | null = existing.langflow.apiKey

  if (langflowEnabled) {
    // ── LangFlow URL ────────────────────────────────────────────────────────
    const lfUrlAns = await p.text({
      message: 'LangFlow URL?',
      placeholder: langflowUrl,
      initialValue: langflowUrl,
      validate: (val) => {
        const v = val?.trim()
        if (!v) return 'LangFlow URL is required'
        if (!isValidHttpUrl(v)) return 'Must be a valid http(s) URL'
      },
    })
    if (p.isCancel(lfUrlAns)) { p.cancel('Setup cancelled.'); return null }
    langflowUrl = (lfUrlAns as string).trim()

    // ── LangFlow API key (optional) ─────────────────────────────────────────
    const wantsKey = await p.confirm({
      message: 'Does LangFlow require an API key?',
      initialValue: existing.langflow.apiKey !== null,
    })
    if (p.isCancel(wantsKey)) { p.cancel('Setup cancelled.'); return null }

    if (wantsKey) {
      const k = await p.password({ message: 'Paste the LangFlow API key:', mask: '●' })
      if (p.isCancel(k)) { p.cancel('Setup cancelled.'); return null }
      const trimmed = (k as string).trim()
      langflowApiKey = trimmed || null
    } else {
      langflowApiKey = null
    }

    // ── Probe LangFlow ──────────────────────────────────────────────────────
    const s2 = p.spinner()
    s2.start(`Probing LangFlow at ${langflowUrl}...`)
    const lfProbe = await probeLangflow(langflowUrl, 2000, langflowApiKey ?? undefined)
    if (lfProbe.ok) {
      s2.stop(green(`LangFlow reachable${lfProbe.version ? ` (v${lfProbe.version})` : ""}`))
    } else {
      s2.stop(red(`LangFlow probe failed: ${lfProbe.reason}`))
      p.log.warn(`Saving anyway — LangFlow may not be running yet.`)
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const cfg: Loop24Config = {
    gateway: { url: gatewayUrl, token: gatewayToken },
    langflow: { url: langflowUrl, apiKey: langflowApiKey, enabled: !!langflowEnabled },
  }

  try {
    saveConfig(cfg)
  } catch (err) {
    p.log.error(`Failed to write ${configPath()}: ${(err as Error).message}`)
    return null
  }

  const summary: string[] = [
    `${green('✓')} Gateway: ${gatewayUrl}${gatewayToken ? dim(' (with token)') : ''}`,
    langflowEnabled
      ? `${green('✓')} LangFlow: ${langflowUrl}${langflowApiKey ? dim(' (with API key)') : ''}`
      : `${dim('↷')} LangFlow: disabled`,
    '',
    `${dim('Saved to')} ${configPath()}`,
    `${dim('Re-run with')} loop24 setup`,
  ]
  p.note(summary.join('\n'), 'Setup complete')
  p.outro(dim(`Launching ${BRAND_NAME}...`))

  return cfg
}

/**
 * Return true if the LOOP24 services wizard should run on first launch.
 * Mirrors src/onboarding.ts:shouldRunOnboarding shape.
 */
export function shouldRunLoop24Wizard(opts: { isPrint: boolean; isTTY: boolean }): boolean {
  if (opts.isPrint) return false
  if (!opts.isTTY) return false
  // Only auto-trigger when config file is genuinely missing. If the user has
  // a config file (even with default values), they have run setup before.
  try {
    // Reuse loadConfig's behavior — but we need to distinguish "missing file"
    // from "file present but values are defaults". Check the path directly.
    // (Synchronous fs check is cheap and we're already on the cli.ts startup
    // path, so the loader fast path is past us.)
    import('node:fs').then  // dummy reference, real check below
  } catch { /* unused */ }
  return !configFileExists()
}

function configFileExists(): boolean {
  try {
    const fs = require('node:fs') as typeof import('node:fs')
    return fs.existsSync(configPath())
  } catch { return false }
}
```

Note: the `configFileExists()` helper uses `require('node:fs')` because TS strip-types allows it in ES modules via `module.createRequire(import.meta.url)`. If strip-types complains, replace with:
```typescript
import { existsSync } from 'node:fs'
// ...
function configFileExists(): boolean { return existsSync(configPath()) }
```
(The import lands at the top of the file alongside the other imports.)

- [ ] **Step 3: Simplify — use direct `existsSync` import**

Replace the `configFileExists` block in `src/loop24-wizard.ts` with the cleaner import:

Edit `src/loop24-wizard.ts`. Top of file — change the imports block to add `existsSync`:

```typescript
import { existsSync } from 'node:fs'
import { BRAND_NAME, COMMAND_NAMESPACE } from './brand.js'
// ...
```

Replace the bottom of the file (the broken `shouldRunLoop24Wizard` + `configFileExists` block) with:

```typescript
/**
 * Return true if the LOOP24 services wizard should run on first launch.
 * Mirrors src/onboarding.ts:shouldRunOnboarding shape.
 */
export function shouldRunLoop24Wizard(opts: { isPrint: boolean; isTTY: boolean }): boolean {
  if (opts.isPrint) return false
  if (!opts.isTTY) return false
  return !existsSync(configPath())
}
```

- [ ] **Step 4: Smoke-build (no tests yet — UI is interactive)**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | grep -E "(error|fail)" | head -5 || echo "build clean"
```
Expected: build clean.

- [ ] **Step 5: Sanity-import test**

Quick non-interactive check that the module loads and exposes the right names:

```bash
node --experimental-strip-types --input-type=module -e \
  "import('./src/loop24-wizard.ts').then(m => process.stdout.write([typeof m.runLoop24Wizard, typeof m.shouldRunLoop24Wizard].join(' ')))" \
  2>&1
```
Expected: `function function`.

- [ ] **Step 6: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/loop24-wizard.ts
git commit -m "feat(wizard): add LOOP24 services first-run wizard

src/loop24-wizard.ts:
- runLoop24Wizard(): clack-based interactive flow that captures gateway URL,
  optional token, langflow enabled+URL+optional apiKey. Probes each service
  after capture (soft-warn on failure). Persists via saveConfig() with mode
  0600. Returns the saved config or null on cancel/failure.
- shouldRunLoop24Wizard({isPrint, isTTY}): true when config.json is missing
  AND on TTY AND not in --print mode.

Mirrors src/onboarding.ts's clack pattern. No TDD here — UI flow is
interactive; the unit-testable pieces (probes, save) are covered in
src/tests/loop24-config.test.ts."
```

---

## Task 5: Wire wizard into cli.ts (first-run trigger + `loop24 setup` subcommand)

**Files:**
- Modify: `src/cli.ts`

Two integration points:
1. **`loop24 setup` subcommand** — runs the wizard and exits. Mirrors the existing `loop24 config` branch at `src/cli.ts:366-372`.
2. **First-run trigger** — when config.json is missing AND on TTY AND not `--print`, run the wizard before any LLM-auth work. Sits ahead of the existing `shouldRunOnboarding` block at `src/cli.ts:572-584`.

- [ ] **Step 1: Add the import at the top of `src/cli.ts`**

Edit `src/cli.ts`. Find the existing onboarding import (around line 14):
```typescript
import { shouldRunOnboarding, runOnboarding } from './onboarding.js'
```

Add the wizard import right after it:
```typescript
import { shouldRunOnboarding, runOnboarding } from './onboarding.js'
import { runLoop24Wizard, shouldRunLoop24Wizard } from './loop24-wizard.js'
```

- [ ] **Step 2: Add the `loop24 setup` subcommand branch**

Edit `src/cli.ts`. Find the existing `loop24 config` branch (around line 366):
```typescript
// `gsd config` — replay the setup wizard and exit
if (cliFlags.messages[0] === 'config') {
  ...
  await runOnboarding(authStorage)
  process.exit(0)
}
```

Add a parallel `setup` branch immediately after that block (so both branches sit together):
```typescript
// `loop24 setup` — re-run the LOOP24 services wizard (gateway + langflow)
// and exit. Distinct from `loop24 config` (LLM auth wizard) — both subcommands
// re-trigger the corresponding first-run flow.
if (cliFlags.messages[0] === 'setup') {
  await runLoop24Wizard()
  process.exit(0)
}
```

- [ ] **Step 3: Add the first-run wizard trigger**

Edit `src/cli.ts`. Find the existing first-run-onboarding block (around line 572):
```typescript
// Run onboarding wizard on first launch (no LLM provider configured)
if (!isPrintMode && shouldRunOnboarding(authStorage, settingsManager.getDefaultProvider())) {
  await runOnboarding(authStorage)
  ...
}
```

Insert the LOOP24-services wizard trigger IMMEDIATELY BEFORE that block (LOOP24 services come first — gateway routing needs to be configured before any LLM call gets made):
```typescript
// LOOP24 services first-run wizard (gateway + langflow). Runs once when
// ~/.loop24/config.json is missing — populates the file via clack prompts
// and persists with mode 0600. Env vars still win at runtime, so CI is
// unaffected.
if (shouldRunLoop24Wizard({ isPrint: isPrintMode, isTTY: !!process.stdin.isTTY })) {
  await runLoop24Wizard()

  // Same stdin cleanup pattern runOnboarding uses — clack leaves listeners
  // and may leave stdin paused.
  process.stdin.removeAllListeners('data')
  process.stdin.removeAllListeners('keypress')
  if (process.stdin.setRawMode) process.stdin.setRawMode(false)
  process.stdin.pause()
}

// Run onboarding wizard on first launch (no LLM provider configured)
if (!isPrintMode && shouldRunOnboarding(authStorage, settingsManager.getDefaultProvider())) {
  ...
```

- [ ] **Step 4: Build + verify `loop24 setup` is wired**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | grep -E "(error|fail)" | head -5 || echo "build clean"
```
Expected: build clean.

Verify the subcommand is registered (without actually entering the interactive wizard — confirm it gets recognized vs. treated as a chat message). The simplest non-interactive proof is to confirm the subcommand branch exists in the built output:
```bash
grep -c "cliFlags.messages\[0\] === 'setup'" dist/cli.js
```
Expected: at least `1`.

- [ ] **Step 5: First-run smoke (manual; the wizard is interactive)**

```bash
# Stash any existing config so we genuinely test the first-run path
mv ~/.loop24/config.json ~/.loop24/config.json.bak 2>/dev/null || true

# Launch loop24 interactively. The wizard should appear before the TUI.
# (Skip this step in an automated run — it requires a real TTY.)
echo "Manual step: run 'loop24' interactively, confirm wizard appears and saves config.json."

# Restore for subsequent steps
mv ~/.loop24/config.json.bak ~/.loop24/config.json 2>/dev/null || true
```

For an automated proof, verify the gating logic returns true under the right conditions:
```bash
LOOP24_HOME=/tmp/loop24-wizard-test-$$ node --experimental-strip-types --input-type=module -e \
  "import('./src/loop24-wizard.ts').then(m => process.stdout.write(String(m.shouldRunLoop24Wizard({ isPrint: false, isTTY: true }))))" \
  2>&1
```
Expected: `true` (the random tmpdir has no config).

```bash
LOOP24_HOME=/tmp/loop24-wizard-test-$$ node --experimental-strip-types --input-type=module -e \
  "import('./src/loop24-wizard.ts').then(m => process.stdout.write(String(m.shouldRunLoop24Wizard({ isPrint: true, isTTY: true }))))" \
  2>&1
```
Expected: `false` (--print mode).

- [ ] **Step 6: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/cli.ts
git commit -m "feat(cli): wire LOOP24 services wizard into launch path

Two integrations in src/cli.ts:

1. New 'loop24 setup' subcommand — runs the wizard and exits. Distinct from
   the existing 'loop24 config' subcommand (which runs the LLM-auth wizard).

2. First-run trigger — when ~/.loop24/config.json is missing AND on TTY AND
   not --print, runs the wizard before the LLM-auth wizard. Gateway routing
   gets configured before any LLM call goes out.

Includes the same stdin cleanup pattern runOnboarding uses, so the TUI
starts with a clean slate after clack exits."
```

---

## Task 6: Headless / `--print` fallback warning + full regression

**Files:**
- Modify: `src/cli.ts` (add a single warn line)

When running non-interactively (`--print`, piped stdin, CI), the wizard can't run. If the config file is also missing AND no env vars are set, we want a single clear warning that points the user at the wizard — but we don't refuse to run. Defaults should still produce a working "direct to Anthropic, no LangFlow" launch.

- [ ] **Step 1: Add the headless warn block in `src/cli.ts`**

Edit `src/cli.ts`. The trigger block from Task 5 looks like:
```typescript
if (shouldRunLoop24Wizard({ isPrint: isPrintMode, isTTY: !!process.stdin.isTTY })) {
  await runLoop24Wizard()
  ...
}
```

Add a sibling block immediately after it for the headless case:
```typescript
} else if (!existsSync(configPath()) && !process.env.LOOP24_GATEWAY_URL && !isPrintMode) {
  // Config file missing AND no env override — headless / piped stdin / CI.
  // Emit a single warn line so the user knows the wizard is available.
  process.stderr.write(
    `[${COMMAND_NAMESPACE}] No ~/.loop24/config.json yet. ` +
    `Run "${COMMAND_NAMESPACE} setup" to configure, or set LOOP24_GATEWAY_URL / LANGFLOW_SERVER_URL.\n`,
  )
}
```

For this, you'll also need imports at the top:
```typescript
import { existsSync } from 'node:fs'
import { configPath } from './loop24-config.js'
import { COMMAND_NAMESPACE } from './brand.js'
```

Check the existing imports in cli.ts before adding — `existsSync` may already be imported transitively, and `COMMAND_NAMESPACE` may not be needed if the file already pulls from `brand.js`. Inspect first:

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -n "from 'node:fs'\|from './brand\|from './loop24-config" src/cli.ts
```

If `node:fs` is already imported, just add `existsSync` to the destructured names. If `brand.js` isn't imported, add the import. If `loop24-config.js` isn't imported (likely — Task 5 only imported the wizard), add it now.

- [ ] **Step 2: Build + verify the warn appears in headless mode**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
# Run in --print mode with config absent. The warn should appear on stderr.
LOOP24_HOME=/tmp/loop24-headless-warn-$$ perl -e 'alarm 8; exec @ARGV' loop24 --print "hi" 2>/tmp/loop24-warn-stderr.txt >/tmp/loop24-warn-stdout.txt
grep "Run \"loop24 setup\"" /tmp/loop24-warn-stderr.txt && echo "OK: warn fired"
```
Expected: `OK: warn fired`. (If LOOP24 needs auth to actually reach a model, the --print itself may fail with an auth error — that's fine; we're only verifying the wizard-suggestion warn fired.)

Verify the warn does NOT appear when the env var is set:
```bash
LOOP24_HOME=/tmp/loop24-headless-warn-$$ LOOP24_GATEWAY_URL=http://x perl -e 'alarm 8; exec @ARGV' loop24 --print "hi" 2>/tmp/loop24-warn-stderr.txt >/tmp/loop24-warn-stdout.txt
grep "Run \"loop24 setup\"" /tmp/loop24-warn-stderr.txt && echo "REGRESSION: warn fired despite env var" || echo "OK: env-var case stays silent"
```
Expected: `OK: env-var case stays silent`.

- [ ] **Step 3: Run the FULL regression suite — make sure nothing else broke**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  packages/pi-coding-agent/src/config.test.ts \
  packages/pi-ai/src/providers/anthropic-auth.test.ts \
  packages/pi-ai/src/providers/anthropic-bearer-auth.test.ts \
  packages/pi-ai/src/providers/anthropic-shared.test.ts \
  packages/pi-ai/src/providers/anthropic.gateway.test.ts \
  src/resources/extensions/workflow/tests/update-command.test.ts \
  src/resources/extensions/workflow/tests/autocomplete-regressions-1675.test.ts \
  src/resources/extensions/workflow/tests/help-menu-coverage.test.ts \
  src/resources/extensions/workflow/tests/extension-bootstrap-isolation.test.ts \
  src/resources/extensions/workflow/tests/auto-blocked-remediation-message.test.ts \
  src/resources/extensions/loop24/tests/langflow-client.test.ts \
  src/resources/extensions/loop24/tests/flow-trigger-schema.test.ts \
  src/resources/extensions/loop24/tests/flow-trigger-loader.test.ts \
  src/tests/integration/loop24-gateway.test.ts \
  src/tests/loop24-config.test.ts \
  2>&1 | tail -8
```
Expected: ALL pass. The Phase 1 anthropic gateway tests are the most critical regression — Task 2's brand.ts side-effect import could affect their precedence if any of them transitively import brand.ts. If anything fails, inspect the import graph before patching tests.

If any test fails for "config-file leakage" reasons (i.e., the running user's `~/.loop24/config.json` polluting a test), point `LOOP24_HOME` at a tmpdir in the affected suite — or, cleaner, have the suite `beforeEach` delete the relevant env vars (most do this already, per Phase 1 patterns).

- [ ] **Step 4: Build smoke**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node dist/loader.js --version
node dist/loader.js --help 2>&1 | head -5
```
Expected: version `1.0.1`, help banner shows LOOP24 brand line.

- [ ] **Step 5: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/cli.ts
git commit -m "feat(cli): warn in headless mode when config + env both missing

When LOOP24 launches non-interactively (--print, no TTY, piped stdin) and
neither ~/.loop24/config.json nor LOOP24_GATEWAY_URL is in place, emit a
single stderr line pointing at 'loop24 setup'. Defaults still work — this
is informational, not a refusal."
```

---

## Task 7: Update LOOP24-PATCHES.md + tag

**Files:**
- Modify: `LOOP24-PATCHES.md`

- [ ] **Step 1: Append a Phase 2b section to `LOOP24-PATCHES.md`**

After the Phase 3 section in `LOOP24-PATCHES.md`, add:

```markdown
## Phase 2b — First-run wizard (tagged: phase-2b-first-run-wizard)

### src/loop24-config.ts (NEW)
- Synchronous reader/writer for `~/.loop24/config.json` (schema:
  `{ gateway: { url, token }, langflow: { url, apiKey, enabled } }`).
- Atomic save: tmp+rename, mode `0600`, parent dir created with `0700`.
- Honors `LOOP24_HOME` env override (test seam).
- Module-load side effect: applies config.json values to `process.env`
  for any env var that is currently unset. Env always wins. This is the
  seam that lets `packages/pi-ai/src/providers/anthropic.ts` and the
  loop24 extension's `session_start` probe keep reading
  `process.env.LOOP24_GATEWAY_URL` / `LANGFLOW_SERVER_URL` without
  any code change — they automatically pick up config.json values.
- `probeGateway(url, timeoutMs?)` and `probeLangflow(url, timeoutMs?, apiKey?)`
  helpers for service validation (used by the wizard; could be reused
  by the loop24 extension's session_start probe in a future cleanup).

### src/loop24-wizard.ts (NEW)
- `runLoop24Wizard()`: clack-based interactive wizard. Prompts for gateway
  URL, optional bearer token, LangFlow enabled, LangFlow URL, optional API
  key. Probes each service after capture; soft-warns on probe failure
  (saves anyway — users frequently configure before services are running).
- `shouldRunLoop24Wizard({ isPrint, isTTY })`: true when config.json is
  missing AND on TTY AND not in `--print` mode.
- Mirrors `src/onboarding.ts`'s clack pattern. No TDD on the interactive
  shell — pure pieces (probes, save) are covered in
  `src/tests/loop24-config.test.ts`.

### src/brand.ts (MODIFIED)
- Added `import './loop24-config.js'` at the top of the imports block.
  Side-effect-only import: triggers loop24-config's load-time
  env-propagation so `process.env.LOOP24_GATEWAY_URL` is populated from
  config.json BEFORE brand.ts reads it a few lines later.

### src/cli.ts (MODIFIED)
- Added `loop24 setup` subcommand (parallel to `loop24 config`). Re-runs
  `runLoop24Wizard()` and exits.
- Added first-run trigger immediately before the existing
  `shouldRunOnboarding` block: if `shouldRunLoop24Wizard(...)` returns
  true, the LOOP24 services wizard runs before the LLM-auth wizard.
- Added headless fallback: when config.json is missing AND
  `LOOP24_GATEWAY_URL` is unset AND not `--print` mode, emit a single
  stderr line pointing at `loop24 setup`.

### src/tests/loop24-config.test.ts (NEW)
- 17 tests: defaults, partial-merge, mode `0600`, atomic overwrite,
  env-precedence (via spawn-based brand.ts probe), and probe helpers
  against in-process mock HTTP servers.

### Naming decision: `loop24 setup` (not `loop24 config`)
`loop24 config` was already wired in Phase 0 to launch the LLM-auth wizard
via `runOnboarding`. Two wizards under one subcommand would either chain
them (annoying for re-runs) or require an extra prompt. Adding a separate
subcommand is the simplest non-breaking change. If we ever consolidate,
the cleanup is mechanical.

### Env-var precedence (canonical, post-Phase 2b)
Env var > config.json field > built-in default. The env-var override is
applied by loop24-config.ts's load-time side effect (it only populates
`process.env` when the env var is unset, so any value the user sets in
their shell wins).
```

- [ ] **Step 2: Commit the docs update**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add LOOP24-PATCHES.md
git commit -m "docs: LOOP24-PATCHES.md — Phase 2b first-run wizard"
```

- [ ] **Step 3: Tag**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git tag -a phase-2b-first-run-wizard -m "Phase 2b complete: first-run wizard captures gateway + langflow config to ~/.loop24/config.json (mode 0600). Env vars still override the file (CI / scripted use unaffected). New 'loop24 setup' subcommand re-runs the wizard. Existing pi-ai gateway reads and loop24 extension langflow reads see config.json values transparently via load-time process.env propagation."
git tag -l
git log --oneline | head -15
```

---

## Definition of Done

Phase 2b is complete when ALL of these are true:

- `src/loop24-config.ts` exists with `loadConfig()`, `saveConfig()`, `configPath()`, `probeGateway()`, `probeLangflow()` exports and DEFAULT_CONFIG constant. Module-load side effect populates `process.env` for unset env vars.
- `src/loop24-wizard.ts` exists with `runLoop24Wizard()` and `shouldRunLoop24Wizard()` exports.
- `src/brand.ts` has `import './loop24-config.js'` at the top of its imports.
- `src/cli.ts` recognizes `loop24 setup` and triggers the wizard on first run when config.json is missing.
- `src/cli.ts` emits the headless-mode warn when config + env are both absent and stays silent when env var is set.
- 17+ tests pass in `src/tests/loop24-config.test.ts`.
- All Phase 0/1/3 regression tests still pass.
- `phase-2b-first-run-wizard` git tag exists.
- `LOOP24-PATCHES.md` has a Phase 2b section.
- `~/.loop24/config.json` after a wizard run has mode `0600` and contains the full schema.
- Env vars still override the config file (verified by Task 2's spawn-based test).

---

## Self-Review (for plan author)

**Spec coverage** (vs design spec §7 Configuration + §9 Phase 2):

- ✅ "`~/.loop24/config.json` (mode `0600`)" — Task 1 implements with chmod-equivalent mode in writeFileSync
- ✅ Schema fields gateway.{url,token} + langflow.{url,apiKey,enabled} — Task 1 Loop24Config interface
- ✅ "Both `token` and `apiKey` are nullable" — Task 1 DEFAULT_CONFIG, validated by tests
- ✅ Env vars LOOP24_GATEWAY_URL, LOOP24_GATEWAY_TOKEN, LANGFLOW_SERVER_URL, LANGFLOW_API_KEY override — Task 1 env-propagation + Task 2 brand.ts wiring
- ✅ "For CI / scripted use, env vars always win over config file" — Task 1 applyConfigToEnv only writes when env is unset; Task 2 test verifies
- ✅ "First-run wizard … extends gsd-pi's existing onboarding flow" — Task 4 mirrors src/onboarding.ts patterns
- ✅ All five prompts from spec §7: gateway URL, gateway token, langflow used, langflow URL, langflow API key — Task 4 flow
- ✅ "Validate via `GET /health` on the gateway" + "GET /api/v1/version" + "Soft-warn on failure" — Task 3 probes + Task 4 wizard wiring
- ✅ "If cwd is a git repo, offer to initialize `.planning/`" — INTENTIONALLY DEFERRED. The spec mentions this but the existing gsd-pi onboarding already handles `.planning/` separately (via `runOnboarding`); duplicating it in the LOOP24-services wizard would mean two prompts for the same thing. Logged here as an explicit cut.

**Placeholder scan:**
- No "TBD", "TODO", "implement later" anywhere.
- The `_pkgRoot` variable from brand.ts is referenced once in the body but not in the plan — that's existing code, untouched.
- Step 2 of Task 4 ships a draft that uses `require('node:fs')` then Step 3 immediately rewrites it to `existsSync` import. This is intentional — the draft documents the strip-types pitfall so the implementer doesn't rediscover it. Not a placeholder.

**Type consistency:**
- `Loop24Config`, `ProbeResult`, `LangflowProbeResult`, `runLoop24Wizard`, `shouldRunLoop24Wizard`, `loadConfig`, `saveConfig`, `configPath`, `probeGateway`, `probeLangflow` — all used identically across tasks.
- `LOOP24_HOME` env var name used identically in Tasks 1, 2, 5.
- `configPath()` is the single source of truth for the file location — every task that touches the file path goes through it.

**Scope check:**
- 7 tasks, mirroring Phase 1's compactness.
- Largest task is Task 4 (wizard module — ~150 LOC of interactive code with no TDD). The pure pieces (Tasks 1 and 3) carry the test coverage.
- Risk concentrated in Task 2 (brand.ts side-effect import) and Task 5 (cli.ts wiring) — both are small surface-area edits. The two-test spawn-based regression in Task 2 catches the highest-risk regression (existing pi-ai tests).

**Known limitations / things the reviewer might call out:**

- The wizard has no `--reset` / `--non-interactive` flags. Spec §7 doesn't require them. Add later if needed.
- `loop24 setup` doesn't have a sub-shape (e.g., `loop24 setup gateway-only`). Single combined wizard for v1.
- `.planning/` init prompt deferred (rationale above).
- The wizard doesn't validate `langflow.enabled: false` against existing flow-trigger YAML files. If a user has YAML triggers but disables LangFlow, those commands will register but error on invocation — that's already the behavior when LangFlow is offline, so no new edge case.
- Phase 2a's "extension scaffold" was completed in Phase 3 Task 1 (the loop24 extension scaffold landed there). Phase 2b is just the wizard piece. No work duplicated.

---

*End of Phase 2b plan.*
