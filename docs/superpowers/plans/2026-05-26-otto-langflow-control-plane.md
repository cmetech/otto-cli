# OTTO LangFlow Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an opt-in LangFlow control plane for OTTO with `/otto langflow ...` commands, footer health, sample flows, project-local artifacts, and full live e2e coverage.

**Architecture:** Extend the existing `src/resources/extensions/otto` LangFlow foundation instead of creating a second integration. Keep global service config in `~/.otto/config.json`, project LangFlow artifacts in `.otto/langflow/`, and route the user-facing command surface through the existing workflow command dispatcher as `/otto langflow ...`.

**Tech Stack:** TypeScript, Node 22 built-in `fetch`, existing OTTO extension APIs, existing footer data provider pattern, Node test runner, live e2e tests against local LangFlow at `http://127.0.0.1:7860`.

---

## File Structure

### Create

- `src/resources/extensions/otto/langflow/artifacts.ts`  
  Resolves and creates `.otto/langflow/{generated,imported,samples,catalog,runs}`.

- `src/resources/extensions/otto/langflow/health.ts`  
  LangFlow probe, status formatter, and retry/backoff monitor.

- `src/resources/extensions/otto/commands/langflow/command.ts`  
  Implements the shared command handler for `status`, `connect`, `disconnect`, `flows`, `import`, `run`, `samples`, and `build`.

- `src/resources/extensions/otto/commands/langflow/parser.ts`  
  Parses `/otto langflow ...` arguments into typed command objects.

- `src/resources/extensions/otto/samples/langflow/echo-basic.json`  
  Minimal import/run sample.

- `src/resources/extensions/otto/samples/langflow/uppercase-basic.json`  
  Optional transform sample.

- `src/resources/extensions/otto/samples/langflow/summarize-text.json`  
  Import-only LLM-backed sample with placeholder secrets.

- `src/resources/extensions/otto/tests/langflow-command-parser.test.ts`

- `src/resources/extensions/otto/tests/langflow-command-handler.test.ts`

- `src/resources/extensions/otto/tests/langflow-health.test.ts`

- `src/resources/extensions/otto/tests/langflow-artifacts.test.ts`

- `tests/e2e/langflow-local.e2e.test.ts`

### Modify

- `src/otto-config.ts`  
  Change default `langflow.enabled` to `false`; add explicit enabled/disabled helpers if needed.

- `src/otto-wizard.ts`  
  Keep default prompt value disabled unless existing config says enabled.

- `src/resources/extensions/otto/clients/langflow.ts`  
  Add `listFlows()` and richer flow metadata types.

- `src/resources/extensions/otto/index.ts`  
  Honor disabled state and register/bridge LangFlow health.

- `src/resources/extensions/workflow/commands/catalog.ts`  
  Add `langflow` and nested completions.

- `src/resources/extensions/workflow/commands/dispatcher.ts` or handler layer  
  Dispatch `/otto langflow ...` to the OTTO LangFlow command handler.

- `packages/pi-coding-agent/src/modes/interactive/components/footer.ts` and footer data provider files  
  Add LangFlow footer status beside gateway status.

- `package.json`  
  Add `test:e2e:langflow`.

- `README.md` and `docs/INSTALL.md`  
  Document disabled-by-default LangFlow and the new command set.

---

## Task 1: Make LangFlow Disabled By Default

**Files:**
- Modify: `src/otto-config.ts`
- Modify: `src/otto-wizard.ts`
- Test: `src/tests/otto-config.test.ts`

- [ ] **Step 1: Write failing tests**

Add these tests to `src/tests/otto-config.test.ts`:

```ts
test("default config keeps LangFlow disabled until user connects", () => {
  const cfg = loadConfig()
  assert.equal(cfg.langflow.url, "http://127.0.0.1:7860")
  assert.equal(cfg.langflow.apiKey, null)
  assert.equal(cfg.langflow.enabled, false)
})

test("applyConfigToEnv sets OTTO_LANGFLOW_DISABLED when LangFlow is disabled", async () => {
  const mod = await import("../otto-config.js")
  mod.applyConfigToEnv({
    gateway: { url: null, token: null },
    langflow: { url: "http://127.0.0.1:7860", apiKey: null, enabled: false },
  })
  assert.equal(process.env.OTTO_LANGFLOW_DISABLED, "1")
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/otto-config.test.ts
```

Expected: the default-enabled assertion fails because current default is `true`.

- [ ] **Step 3: Implement default-disabled config**

In `src/otto-config.ts`, change:

```ts
langflow: {
  url: "http://127.0.0.1:7860",
  apiKey: null,
  enabled: true,
},
```

to:

```ts
langflow: {
  url: "http://127.0.0.1:7860",
  apiKey: null,
  enabled: false,
},
```

Update any tests that expected missing `enabled` to default to `true`; they should now expect `false`.

- [ ] **Step 4: Verify**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/otto-config.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/otto-config.ts src/otto-wizard.ts src/tests/otto-config.test.ts
git commit -m "feat(langflow): default LangFlow service to disabled"
```

---

## Task 2: Add LangFlow Artifact Root

**Files:**
- Create: `src/resources/extensions/otto/langflow/artifacts.ts`
- Test: `src/resources/extensions/otto/tests/langflow-artifacts.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/resources/extensions/otto/tests/langflow-artifacts.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureLangFlowArtifactDirs, langFlowArtifactPaths } from "../langflow/artifacts.js"

test("langFlowArtifactPaths resolves under .otto/langflow, not .otto/workflow", () => {
  const root = "/tmp/project"
  const paths = langFlowArtifactPaths(root)
  assert.equal(paths.root, "/tmp/project/.otto/langflow")
  assert.equal(paths.generated, "/tmp/project/.otto/langflow/generated")
  assert.equal(paths.imported, "/tmp/project/.otto/langflow/imported")
  assert.equal(paths.catalog, "/tmp/project/.otto/langflow/catalog")
  assert.equal(paths.runs, "/tmp/project/.otto/langflow/runs")
})

test("ensureLangFlowArtifactDirs creates all project-local LangFlow directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "otto-langflow-artifacts-"))
  try {
    const paths = ensureLangFlowArtifactDirs(dir)
    assert.ok(existsSync(paths.generated))
    assert.ok(existsSync(paths.imported))
    assert.ok(existsSync(paths.samples))
    assert.ok(existsSync(paths.catalog))
    assert.ok(existsSync(paths.runs))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/otto/tests/langflow-artifacts.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement artifact helper**

Create `src/resources/extensions/otto/langflow/artifacts.ts`:

```ts
import { mkdirSync } from "node:fs"
import { join } from "node:path"

export interface LangFlowArtifactPaths {
  root: string
  generated: string
  imported: string
  samples: string
  catalog: string
  runs: string
}

export function langFlowArtifactPaths(projectRoot: string): LangFlowArtifactPaths {
  const root = join(projectRoot, ".otto", "langflow")
  return {
    root,
    generated: join(root, "generated"),
    imported: join(root, "imported"),
    samples: join(root, "samples"),
    catalog: join(root, "catalog"),
    runs: join(root, "runs"),
  }
}

export function ensureLangFlowArtifactDirs(projectRoot: string): LangFlowArtifactPaths {
  const paths = langFlowArtifactPaths(projectRoot)
  for (const dir of [paths.generated, paths.imported, paths.samples, paths.catalog, paths.runs]) {
    mkdirSync(dir, { recursive: true })
  }
  return paths
}
```

- [ ] **Step 4: Verify**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/otto/tests/langflow-artifacts.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/otto/langflow/artifacts.ts src/resources/extensions/otto/tests/langflow-artifacts.test.ts
git commit -m "feat(langflow): add project-local artifact root"
```

---

## Task 3: Add List Flows To LangFlow Client

**Files:**
- Modify: `src/resources/extensions/otto/clients/langflow.ts`
- Test: `src/resources/extensions/otto/tests/langflow-client.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/resources/extensions/otto/tests/langflow-client.test.ts`:

```ts
test("listFlows GETs /api/v1/flows/ and returns flow summaries", async () => {
  let receivedApiKeyHeader: string | undefined
  await withMockServer(
    (req, res) => {
      assert.equal(req.method, "GET")
      assert.equal(req.url, "/api/v1/flows/")
      receivedApiKeyHeader = req.headers["x-api-key"] as string | undefined
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify([
        { id: "flow-1", name: "Echo Basic", endpoint_name: "echo-basic", updated_at: "2026-05-26T12:00:00Z" },
      ]))
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url, apiKey: "secret-key" })
      const flows = await client.listFlows()
      assert.equal(receivedApiKeyHeader, "secret-key")
      assert.equal(flows[0]?.id, "flow-1")
      assert.equal(flows[0]?.name, "Echo Basic")
      assert.equal(flows[0]?.endpointName, "echo-basic")
    },
  )
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/otto/tests/langflow-client.test.ts
```

Expected: `client.listFlows is not a function`.

- [ ] **Step 3: Implement listFlows**

In `src/resources/extensions/otto/clients/langflow.ts`, add:

```ts
export interface LangFlowSummary {
  id: string
  name?: string
  endpointName?: string
  updatedAt?: string
  raw: unknown
}
```

Add method:

```ts
async listFlows(timeoutMsOverride?: number): Promise<LangFlowSummary[]> {
  const timeoutMs = timeoutMsOverride ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const res = await this._fetch(`${this.opts.baseUrl}/api/v1/flows/`, { method: "GET" }, timeoutMs)
  const bodyText = await res.text()
  if (!res.ok) {
    throw new Error(`langflow flows: ${res.status} ${res.statusText} — ${bodyText.slice(0, 500)}`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(bodyText)
  } catch {
    throw new Error(`langflow flows: response was not JSON — ${bodyText.slice(0, 200)}`)
  }
  const rows = Array.isArray(raw) ? raw : []
  return rows
    .filter((row): row is Record<string, unknown> => row !== null && typeof row === "object" && typeof row.id === "string")
    .map((row) => ({
      id: row.id as string,
      name: typeof row.name === "string" ? row.name : undefined,
      endpointName: typeof row.endpoint_name === "string" ? row.endpoint_name : undefined,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined,
      raw: row,
    }))
}
```

- [ ] **Step 4: Verify**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/otto/tests/langflow-client.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/otto/clients/langflow.ts src/resources/extensions/otto/tests/langflow-client.test.ts
git commit -m "feat(langflow): list flows from server"
```

---

## Task 4: Add LangFlow Health Monitor

**Files:**
- Create: `src/resources/extensions/otto/langflow/health.ts`
- Test: `src/resources/extensions/otto/tests/langflow-health.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/resources/extensions/otto/tests/langflow-health.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { formatLangFlowFooterStatus, type LangFlowHealthState } from "../langflow/health.js"

test("formatLangFlowFooterStatus renders disabled state", () => {
  const state: LangFlowHealthState = { status: "disabled", url: "http://127.0.0.1:7860" }
  assert.equal(formatLangFlowFooterStatus(state), "LF disabled")
})

test("formatLangFlowFooterStatus renders connected state with version", () => {
  const state: LangFlowHealthState = { status: "connected", url: "http://127.0.0.1:7860", version: "1.9.3" }
  assert.equal(formatLangFlowFooterStatus(state), "LF connected v1.9.3")
})

test("formatLangFlowFooterStatus renders offline host", () => {
  const state: LangFlowHealthState = { status: "offline", url: "http://127.0.0.1:7860", reason: "ECONNREFUSED" }
  assert.equal(formatLangFlowFooterStatus(state), "LF offline 127.0.0.1:7860")
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/otto/tests/langflow-health.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement health formatter and monitor shell**

Create `src/resources/extensions/otto/langflow/health.ts`:

```ts
import { probeLangflow } from "../../../../otto-config.js"

export type LangFlowHealthStatus = "disabled" | "checking" | "connected" | "offline" | "degraded"

export interface LangFlowHealthState {
  status: LangFlowHealthStatus
  url: string
  version?: string
  reason?: string
}

export function formatLangFlowFooterStatus(state: LangFlowHealthState): string {
  if (state.status === "disabled") return "LF disabled"
  if (state.status === "checking") return "LF checking"
  if (state.status === "connected") return state.version ? `LF connected v${state.version}` : "LF connected"
  if (state.status === "degraded") return "LF degraded retrying"
  let host = state.url
  try { host = new URL(state.url).host } catch {}
  return `LF offline ${host}`
}

export async function probeLangFlowHealth(url: string, apiKey?: string): Promise<LangFlowHealthState> {
  const result = await probeLangflow(url, 1500, apiKey)
  if (result.ok) return { status: "connected", url, version: result.version }
  return { status: "offline", url, reason: result.reason }
}
```

The interval/backoff monitor can be added in the footer task when wiring to interactive mode.

- [ ] **Step 4: Verify**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/otto/tests/langflow-health.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/otto/langflow/health.ts src/resources/extensions/otto/tests/langflow-health.test.ts
git commit -m "feat(langflow): add health status formatter"
```

---

## Task 5: Add `/otto langflow` Parser

**Files:**
- Create: `src/resources/extensions/otto/commands/langflow/parser.ts`
- Test: `src/resources/extensions/otto/tests/langflow-command-parser.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `src/resources/extensions/otto/tests/langflow-command-parser.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { parseLangFlowCommand } from "../commands/langflow/parser.js"

test("parses status", () => {
  assert.deepEqual(parseLangFlowCommand("status"), { kind: "status" })
})

test("parses connect with optional url", () => {
  assert.deepEqual(parseLangFlowCommand("connect http://127.0.0.1:7860"), {
    kind: "connect",
    url: "http://127.0.0.1:7860",
  })
})

test("parses import sample name", () => {
  assert.deepEqual(parseLangFlowCommand("import echo-basic"), { kind: "import", target: "echo-basic" })
})

test("parses run flow with quoted input", () => {
  assert.deepEqual(parseLangFlowCommand('run echo-basic "hello world"'), {
    kind: "run",
    flow: "echo-basic",
    input: "hello world",
  })
})

test("parses build description", () => {
  assert.deepEqual(parseLangFlowCommand("build summarize text with local llm"), {
    kind: "build",
    description: "summarize text with local llm",
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/otto/tests/langflow-command-parser.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement parser**

Create `src/resources/extensions/otto/commands/langflow/parser.ts`:

```ts
export type ParsedLangFlowCommand =
  | { kind: "status" }
  | { kind: "connect"; url?: string }
  | { kind: "disconnect" }
  | { kind: "flows" }
  | { kind: "samples" }
  | { kind: "import"; target: string }
  | { kind: "run"; flow: string; input: string }
  | { kind: "build"; description: string }
  | { kind: "help" }

function splitArgs(input: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) out.push(m[1] ?? m[2] ?? m[3] ?? "")
  return out
}

export function parseLangFlowCommand(input: string): ParsedLangFlowCommand {
  const trimmed = input.trim()
  if (!trimmed || trimmed === "help" || trimmed === "--help") return { kind: "help" }
  const [head, ...rest] = splitArgs(trimmed)
  switch (head) {
    case "status": return { kind: "status" }
    case "connect": return { kind: "connect", url: rest[0] }
    case "disconnect": return { kind: "disconnect" }
    case "flows":
    case "list": return { kind: "flows" }
    case "samples": return { kind: "samples" }
    case "import": return rest[0] ? { kind: "import", target: rest[0] } : { kind: "help" }
    case "run": return rest[0] ? { kind: "run", flow: rest[0], input: rest.slice(1).join(" ") || "hello from OTTO" } : { kind: "help" }
    case "build": return rest.length > 0 ? { kind: "build", description: rest.join(" ") } : { kind: "help" }
    default: return { kind: "help" }
  }
}
```

- [ ] **Step 4: Verify**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/otto/tests/langflow-command-parser.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/otto/commands/langflow/parser.ts src/resources/extensions/otto/tests/langflow-command-parser.test.ts
git commit -m "feat(langflow): parse langflow subcommands"
```

---

## Task 6: Add Bundled Sample Flows

**Files:**
- Create: `src/resources/extensions/otto/samples/langflow/echo-basic.json`
- Create: `src/resources/extensions/otto/samples/langflow/uppercase-basic.json`
- Create: `src/resources/extensions/otto/samples/langflow/summarize-text.json`

- [ ] **Step 1: Add samples**

Create `src/resources/extensions/otto/samples/langflow/echo-basic.json`:

```json
{
  "name": "OTTO Echo Basic",
  "description": "Minimal OTTO sample flow for import/list/run smoke testing. Echoes the input text.",
  "data": {
    "nodes": [],
    "edges": []
  },
  "is_component": false,
  "endpoint_name": "otto-echo-basic"
}
```

Create `src/resources/extensions/otto/samples/langflow/uppercase-basic.json`:

```json
{
  "name": "OTTO Uppercase Basic",
  "description": "OTTO sample flow intended for simple transform testing. May require adjustment for specific LangFlow component catalog versions.",
  "data": {
    "nodes": [],
    "edges": []
  },
  "is_component": false,
  "endpoint_name": "otto-uppercase-basic"
}
```

Create `src/resources/extensions/otto/samples/langflow/summarize-text.json`:

```json
{
  "name": "OTTO Summarize Text",
  "description": "OTTO import-only sample for an LLM-backed summary flow. Configure model credentials or gateway placeholders after import before running.",
  "data": {
    "nodes": [],
    "edges": []
  },
  "is_component": false,
  "endpoint_name": "otto-summarize-text",
  "notes": {
    "gateway": "${OTTO_GATEWAY_URL}",
    "api_key": "${ANTHROPIC_API_KEY}"
  }
}
```

These are intentionally minimal placeholders for the first implementation pass. During e2e execution, if the active LangFlow version rejects the minimal JSON, update the sample to the concrete v1.9.x shape captured by `clients/LANGFLOW-API.md` and keep the test as the contract.

- [ ] **Step 2: Verify JSON parses**

Run:

```bash
node -e 'for (const f of process.argv.slice(1)) JSON.parse(require("fs").readFileSync(f,"utf8"))' src/resources/extensions/otto/samples/langflow/*.json
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/resources/extensions/otto/samples/langflow
git commit -m "feat(langflow): add bundled sample flows"
```

---

## Task 7: Implement `/otto langflow` Command Handler

**Files:**
- Create: `src/resources/extensions/otto/commands/langflow/command.ts`
- Modify: `src/resources/extensions/workflow/commands/handlers/workflow.ts`
- Modify: `src/resources/extensions/workflow/commands/catalog.ts`
- Test: `src/resources/extensions/otto/tests/langflow-command-handler.test.ts`

- [ ] **Step 1: Write handler tests with mock client**

Create `src/resources/extensions/otto/tests/langflow-command-handler.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { handleLangFlowCommand } from "../commands/langflow/command.js"

function makeCtx(cwd: string) {
  const notifications: string[] = []
  return {
    ctx: {
      cwd,
      ui: { notify: (message: string) => notifications.push(message) },
    } as any,
    notifications,
  }
}

test("status reports disabled by default", async () => {
  const dir = mkdtempSync(join(tmpdir(), "otto-langflow-cmd-"))
  try {
    const { ctx, notifications } = makeCtx(dir)
    await handleLangFlowCommand("status", ctx)
    assert.match(notifications.join("\n"), /disabled/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/otto/tests/langflow-command-handler.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement initial handler**

Create `src/resources/extensions/otto/commands/langflow/command.ts` with at least `help`, `status`, `samples`, and placeholders for networked commands:

```ts
import { existsSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ExtensionCommandContext } from "@otto/pi-coding-agent"
import { loadConfig, saveConfig, applyConfigToEnv, probeLangflow } from "../../../../otto-config.js"
import { ensureLangFlowArtifactDirs } from "../../langflow/artifacts.js"
import { parseLangFlowCommand } from "./parser.js"

const here = dirname(fileURLToPath(import.meta.url))
const samplesDir = join(here, "..", "..", "samples", "langflow")

const HELP = [
  "Usage: /otto langflow <command>",
  "",
  "Commands:",
  "  status",
  "  connect [url]",
  "  disconnect",
  "  flows",
  "  samples",
  "  import <file|sample-name>",
  "  run <flow-id-or-name> [input text]",
  "  build <natural-language description>",
].join("\\n")

export async function handleLangFlowCommand(args: string, ctx: ExtensionCommandContext): Promise<boolean> {
  const parsed = parseLangFlowCommand(args)
  const cfg = loadConfig()
  const paths = ensureLangFlowArtifactDirs(ctx.cwd)

  if (parsed.kind === "help") {
    ctx.ui.notify(HELP, "info")
    return true
  }

  if (parsed.kind === "status") {
    if (!cfg.langflow.enabled || process.env.OTTO_LANGFLOW_DISABLED === "1") {
      ctx.ui.notify(`LangFlow disabled\\nURL: ${cfg.langflow.url}\\nArtifacts: ${paths.root}`, "info")
      return true
    }
    const probe = await probeLangflow(cfg.langflow.url, 1500, cfg.langflow.apiKey ?? undefined)
    ctx.ui.notify(
      probe.ok
        ? `LangFlow connected${probe.version ? ` v${probe.version}` : ""}\\nURL: ${cfg.langflow.url}\\nArtifacts: ${paths.root}`
        : `LangFlow offline: ${probe.reason}\\nURL: ${cfg.langflow.url}\\nArtifacts: ${paths.root}`,
      probe.ok ? "success" : "warning",
    )
    return true
  }

  if (parsed.kind === "connect") {
    const next = { ...cfg, langflow: { ...cfg.langflow, enabled: true, url: parsed.url ?? cfg.langflow.url } }
    saveConfig(next)
    delete process.env.OTTO_LANGFLOW_DISABLED
    applyConfigToEnv(next)
    const probe = await probeLangflow(next.langflow.url, 1500, next.langflow.apiKey ?? undefined)
    ctx.ui.notify(probe.ok ? `LangFlow connected at ${next.langflow.url}` : `LangFlow configured but offline: ${probe.reason}`, probe.ok ? "success" : "warning")
    return true
  }

  if (parsed.kind === "disconnect") {
    const next = { ...cfg, langflow: { ...cfg.langflow, enabled: false } }
    saveConfig(next)
    process.env.OTTO_LANGFLOW_DISABLED = "1"
    ctx.ui.notify("LangFlow disabled.", "info")
    return true
  }

  if (parsed.kind === "samples") {
    const names = existsSync(samplesDir)
      ? readdirSync(samplesDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\\.json$/, ""))
      : []
    ctx.ui.notify(names.length ? `LangFlow samples:\\n${names.map((n) => `- ${n}`).join("\\n")}` : "No LangFlow samples bundled.", "info")
    return true
  }

  ctx.ui.notify("This LangFlow command is planned but not wired in this task yet. Run /otto langflow help.", "warning")
  return true
}
```

- [ ] **Step 4: Wire dispatcher**

In `src/resources/extensions/workflow/commands/handlers/workflow.ts`, in `handleWorkflowCommand`, before the default unknown branch, add:

```ts
if (trimmed === "langflow" || trimmed.startsWith("langflow ")) {
  const { handleLangFlowCommand } = await import("../../../../otto/commands/langflow/command.js")
  const sub = trimmed.slice("langflow".length).trim()
  return handleLangFlowCommand(sub, ctx)
}
```

Update `src/resources/extensions/workflow/commands/catalog.ts` top-level completions to include:

```ts
{ cmd: "langflow", desc: "LangFlow service status, connect/disconnect, samples, import, run, and build" }
```

and nested completions:

```ts
langflow: [
  { cmd: "status", desc: "Show LangFlow connection and artifact status" },
  { cmd: "connect", desc: "Enable LangFlow and probe the server" },
  { cmd: "disconnect", desc: "Disable LangFlow probes and commands" },
  { cmd: "flows", desc: "List flows from the LangFlow server" },
  { cmd: "samples", desc: "List bundled OTTO sample flows" },
  { cmd: "import", desc: "Import a sample or JSON file" },
  { cmd: "run", desc: "Run a flow by id, endpoint, or name" },
  { cmd: "build", desc: "Generate LangFlow JSON from natural language" },
],
```

- [ ] **Step 5: Verify**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/otto/tests/langflow-command-handler.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/resources/extensions/otto/commands/langflow src/resources/extensions/otto/tests/langflow-command-handler.test.ts src/resources/extensions/workflow/commands/handlers/workflow.ts src/resources/extensions/workflow/commands/catalog.ts
git commit -m "feat(langflow): add /otto langflow command surface"
```

---

## Task 8: Implement `flows`, `import`, and `run`

**Files:**
- Modify: `src/resources/extensions/otto/commands/langflow/command.ts`
- Modify: `src/resources/extensions/otto/clients/langflow.ts`
- Test: `src/resources/extensions/otto/tests/langflow-command-handler.test.ts`

- [ ] **Step 1: Add mock-server tests**

Extend `langflow-command-handler.test.ts` with tests for:

```ts
test("flows lists server flow names", async () => {
  // Use a local HTTP server returning [{ id: "flow-1", name: "Echo Basic", endpoint_name: "otto-echo-basic" }]
  // Set LANGFLOW_SERVER_URL to the server URL and save config enabled=true.
  // Assert notification includes Echo Basic and flow-1.
})

test("run resolves endpoint name and returns output text", async () => {
  // Mock /api/v1/flows/ and /api/v1/run/flow-1.
  // Assert notification includes response text.
})
```

Use the existing `withMockServer` helper shape from `langflow-client.test.ts`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/otto/tests/langflow-command-handler.test.ts
```

Expected: networked command tests fail because handler still has placeholders.

- [ ] **Step 3: Implement networked command paths**

In the command handler:

- construct `new LangFlowClient({ baseUrl: cfg.langflow.url, apiKey: cfg.langflow.apiKey ?? undefined })`
- `flows`: call `client.listFlows()`, render `id`, `name`, `endpointName`
- `run`: call `listFlows()` when the supplied flow is not an exact id, resolve against `id`, `endpointName`, or `name`, then call `runFlow()`
- `import`: resolve sample names from bundled samples or file path, parse JSON, call `client.importFlow()`, copy JSON into `.otto/langflow/imported/`

Run records should be JSON files under `.otto/langflow/runs/`:

```json
{
  "ts": "2026-05-26T00:00:00.000Z",
  "command": "run",
  "flow": "otto-echo-basic",
  "input": "hello",
  "ok": true
}
```

- [ ] **Step 4: Verify**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/otto/tests/langflow-command-handler.test.ts src/resources/extensions/otto/tests/langflow-client.test.ts src/resources/extensions/otto/tests/langflow-import-flow.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/otto/commands/langflow/command.ts src/resources/extensions/otto/tests/langflow-command-handler.test.ts
git commit -m "feat(langflow): list import and run flows"
```

---

## Task 9: Move Build Output To `.otto/langflow/generated`

**Files:**
- Modify: `src/resources/extensions/otto/commands/build-flow/_scaffold.ts`
- Modify: `src/resources/extensions/otto/commands/build-flow/command.ts`
- Test: `src/resources/extensions/otto/tests/build-flow-scaffold.test.ts`

- [ ] **Step 1: Update scaffold tests**

Change expectations from:

```ts
flows/generated
flows/templates
flows/imported
catalog
```

to:

```ts
.otto/langflow/generated
.otto/langflow/imported
.otto/langflow/samples
.otto/langflow/catalog
.otto/langflow/runs
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/otto/tests/build-flow-scaffold.test.ts
```

Expected: old scaffold creates `flows/` paths.

- [ ] **Step 3: Implement new scaffold path**

Refactor `_scaffold.ts` to call `ensureLangFlowArtifactDirs(cwd)` and stop creating root-level `flows/` by default.

Update prompt text in `command.ts`:

```text
Save generated flows under .otto/langflow/generated/<slug>.json
The component catalog lives in .otto/langflow/catalog/
```

- [ ] **Step 4: Verify**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/otto/tests/build-flow-scaffold.test.ts src/resources/extensions/otto/tests/build-flow-system-context.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/otto/commands/build-flow src/resources/extensions/otto/tests/build-flow-scaffold.test.ts
git commit -m "feat(langflow): store generated flows under .otto/langflow"
```

---

## Task 10: Add Footer Health Indicator

**Files:**
- Modify: `packages/pi-coding-agent/src/modes/interactive/components/footer.ts`
- Modify: footer data provider files under `packages/pi-coding-agent/src/modes/interactive/`
- Modify: `packages/pi-coding-agent/src/modes/interactive/interactive-mode.ts`
- Test: `src/tests/footer-component.test.ts`
- Test: `src/resources/extensions/otto/tests/langflow-health.test.ts`

- [ ] **Step 1: Add footer test**

In `src/tests/footer-component.test.ts`, add a case that sets a LangFlow status provider and expects:

```text
LF disabled
```

and another that expects:

```text
LF connected v1.9.3
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/footer-component.test.ts
```

Expected: no LangFlow footer support.

- [ ] **Step 3: Implement footer data**

Follow the gateway footer pattern:

- add a `getLangFlowStatus` callback to the footer data provider
- render formatted status near the gateway status
- start monitor only when LangFlow is enabled
- stop monitor on interactive mode cleanup

- [ ] **Step 4: Verify**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/footer-component.test.ts src/resources/extensions/otto/tests/langflow-health.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-coding-agent/src/modes/interactive src/tests/footer-component.test.ts src/resources/extensions/otto/langflow/health.ts src/resources/extensions/otto/tests/langflow-health.test.ts
git commit -m "feat(langflow): show LangFlow health in footer"
```

---

## Task 11: Add Live LangFlow E2E Test

**Files:**
- Create: `tests/e2e/langflow-local.e2e.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add npm script**

In `package.json`, add:

```json
"test:e2e:langflow": "node --experimental-strip-types --test --test-concurrency=1 tests/e2e/langflow-local.e2e.test.ts"
```

- [ ] **Step 2: Create e2e test**

Create `tests/e2e/langflow-local.e2e.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"

const url = process.env.LANGFLOW_SERVER_URL || "http://127.0.0.1:7860"

async function assertLangFlowRunning(): Promise<void> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/v1/version`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  } catch (err) {
    throw new Error(`LangFlow is not running at ${url}; start it with "langflow run" or set LANGFLOW_SERVER_URL. Cause: ${(err as Error).message}`)
  }
}

function runOtto(args: string[]): string {
  const result = spawnSync("node", ["scripts/dev-cli.js", "headless", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LANGFLOW_SERVER_URL: url,
      OTTO_LANGFLOW_ENABLED: "1",
    },
    encoding: "utf-8",
    timeout: 60_000,
  })
  assert.equal(result.status, 0, `otto failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`)
  return `${result.stdout}\n${result.stderr}`
}

test("local LangFlow import list run smoke", async () => {
  await assertLangFlowRunning()
  runOtto(["langflow", "connect", url])
  const imported = runOtto(["langflow", "import", "echo-basic"])
  assert.match(imported, /import/i)
  const flows = runOtto(["langflow", "flows"])
  assert.match(flows, /echo/i)
  const output = runOtto(["langflow", "run", "otto-echo-basic", "hello from e2e"])
  assert.match(output, /hello from e2e/i)
})
```

If `headless langflow ...` does not dispatch to `/otto langflow`, update the e2e to invoke the supported headless workflow command path used elsewhere in `tests/e2e/`.

- [ ] **Step 3: Run e2e without LangFlow and verify clear failure**

Run with LangFlow stopped:

```bash
npm run test:e2e:langflow
```

Expected: fails with `LangFlow is not running at ...`.

- [ ] **Step 4: Run e2e with LangFlow**

Start LangFlow:

```bash
langflow run
```

Then:

```bash
npm run test:e2e:langflow
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/langflow-local.e2e.test.ts package.json
git commit -m "test(langflow): add local LangFlow e2e smoke"
```

---

## Task 12: Documentation And Final Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/INSTALL.md`

- [ ] **Step 1: Document command surface**

Add a LangFlow section documenting:

```text
otto config langflow
/otto langflow status
/otto langflow connect [url]
/otto langflow disconnect
/otto langflow samples
/otto langflow import echo-basic
/otto langflow flows
/otto langflow run otto-echo-basic "hello"
/otto langflow build "..."
```

State that LangFlow is disabled by default and artifacts are written to `.otto/langflow/`.

- [ ] **Step 2: Run focused tests**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/otto/tests/langflow-client.test.ts \
  src/resources/extensions/otto/tests/langflow-import-flow.test.ts \
  src/resources/extensions/otto/tests/langflow-artifacts.test.ts \
  src/resources/extensions/otto/tests/langflow-health.test.ts \
  src/resources/extensions/otto/tests/langflow-command-parser.test.ts \
  src/resources/extensions/otto/tests/langflow-command-handler.test.ts \
  src/resources/extensions/otto/tests/build-flow-scaffold.test.ts \
  src/tests/footer-component.test.ts \
  src/tests/otto-config.test.ts
```

Expected: pass.

- [ ] **Step 3: Run build and branding check**

Run:

```bash
npm run build:core
npm run branding:check
```

Expected: both pass.

- [ ] **Step 4: Run live e2e when LangFlow is running**

Run:

```bash
npm run test:e2e:langflow
```

Expected with local LangFlow running: pass. Expected without LangFlow: explicit failure telling user to start LangFlow.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/INSTALL.md
git commit -m "docs(langflow): document opt-in LangFlow control plane"
```

