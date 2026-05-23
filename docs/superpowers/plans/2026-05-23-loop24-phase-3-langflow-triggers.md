# LOOP24 Phase 3 — LangFlow Runtime Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `loop24` Pi extension and let users define LangFlow flow-trigger slash commands via YAML files. A YAML in `src/resources/extensions/loop24/commands/flow-triggers/` becomes `/loop24 <command-name>` at runtime, which POSTs to a local LangFlow server, streams the response, and renders it in the TUI.

**Architecture:** New Pi extension at `src/resources/extensions/loop24/`. Three internal pieces: (1) `clients/langflow.ts` — HTTP client with optional bearer auth, version probe, flow-run with SSE streaming; (2) `commands/flow-triggers/_loader.ts` — scans the directory at extension-load time, validates each YAML against a schema, registers a slash command per file; (3) connection-state probe wired into the loader banner so users see `langflow: connected|offline` on launch. No gateway routing yet — LangFlow is a separate service, not in the LLM dispatch path.

**Tech Stack:** TypeScript, Node ≥22 (built-in `fetch`, no axios), Node's built-in test runner (`node --test --experimental-strip-types`), pi-tui (custom TUI), `js-yaml` for YAML parsing (already a transitive dependency — verify), Pi extension API (`ExtensionAPI` from `@gsd/pi-coding-agent`), brand helpers from `src/brand.ts` and `workflow/strings.ts`.

**⚠️ TS strip-types constraint:** all files that run through `--experimental-strip-types` (tests via the resolver, dist-test bundles) must avoid non-erasable TS syntax: parameter-property constructors (`constructor(private readonly x: T) {}`), `enum`, `namespace`, `import =`. Use explicit field declarations + assignment in constructors. Hit during Task 3.

**Scope boundary:**

In scope:
- The `loop24` extension scaffold (manifest + entry point) — first time `src/resources/extensions/loop24/` becomes a registered Pi extension instead of just a directory holding the banner and theme files
- LangFlow HTTP client with version probe, list-flows, run-flow (streaming + non-streaming)
- Declarative YAML schema for flow-trigger commands
- YAML loader that scans the directory at extension load and registers slash commands
- One or two real example YAML files
- Banner connection-state probe (`langflow: connected|offline`)
- Env-var config: `LANGFLOW_SERVER_URL` (default `http://127.0.0.1:7860`), `LANGFLOW_API_KEY` (optional)

Out of scope (deferred to later phases):
- First-run wizard for LangFlow config (Phase 2's deferred wizard work — env var override is the only config surface in Phase 3)
- The `langflow-flow-builder` skill port (Phase 4)
- Gateway routing for LLM traffic (Phase 1)
- Imperative TS escape hatch for commands that need more than YAML (can add later when a real need arises)
- LangFlow flow CRUD (list/inspect/cancel) as separate slash commands — Phase 3 only does the trigger surface

**Dependencies:**
- Requires LangFlow running locally (or a mock for testing). Default URL `http://127.0.0.1:7860`. If LangFlow is unreachable, the extension still loads — the YAML commands register, they just error on invocation with a clean "langflow: offline" message.
- Requires Phase 0 + 0.5 complete (the `loop24` directory exists at `src/resources/extensions/loop24/` with the theme and branding files; brand helpers wired).

---

## File Structure

### New files

```
src/resources/extensions/loop24/
├── extension-manifest.json          # NEW — manifest identifies the extension to Pi
├── index.ts                         # NEW — entry point, registers everything
├── clients/
│   └── langflow.ts                  # NEW — HTTP client for LangFlow API
├── commands/
│   └── flow-triggers/
│       ├── _loader.ts               # NEW — scans *.yaml, validates, registers commands
│       ├── _schema.ts               # NEW — TypeBox/Zod-style YAML schema with validator
│       └── example-echo.yaml        # NEW — first example flow-trigger command
└── tests/
    ├── langflow-client.test.ts      # NEW — client tests against mock HTTP server
    ├── flow-trigger-loader.test.ts  # NEW — loader tests (valid/invalid YAML)
    └── flow-trigger-schema.test.ts  # NEW — schema validation edge cases
```

### Modified files

- `src/loader.ts` — add the LangFlow connection-state probe and surface result in the banner meta line. Probe is best-effort with short timeout (500ms) so it never blocks startup.

### File responsibilities (one-liners)

| File | Responsibility |
|---|---|
| `extension-manifest.json` | Identity + capability declaration so Pi knows what this extension provides |
| `index.ts` | Default export `Loop24(pi)`; calls the flow-trigger loader and registers a session_start hook for connection probing |
| `clients/langflow.ts` | Single HTTP client for LangFlow. Methods: `getVersion()`, `runFlow(flowId, inputs, opts)`. Optional bearer auth. Streams SSE when `opts.stream === true`. |
| `commands/flow-triggers/_loader.ts` | Read directory, parse each YAML, validate via schema, register slash command per file via `pi.registerCommand` |
| `commands/flow-triggers/_schema.ts` | Schema type + `validate(raw): { ok, value } \| { ok: false, errors }` function. No external dep (hand-rolled validator is fine for ~10 fields) |
| `commands/flow-triggers/*.yaml` | One declarative command per file |
| `tests/*.test.ts` | TDD coverage for client, loader, schema |

---

## Task 1: Bootstrap the `loop24` extension

**Files:**
- Create: `src/resources/extensions/loop24/extension-manifest.json`
- Create: `src/resources/extensions/loop24/index.ts`

- [ ] **Step 1: Inspect an existing extension for the pattern**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
cat src/resources/extensions/async-jobs/extension-manifest.json
sed -n '1,40p' src/resources/extensions/async-jobs/index.ts
```
Note: manifest fields are `id, name, version, description, tier, requires.platform, provides.{tools,commands,hooks}`. Entry point exports `default function Name(pi: ExtensionAPI) { … }`.

- [ ] **Step 2: Write the manifest**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/extension-manifest.json`:
```json
{
  "id": "loop24",
  "name": "LOOP24",
  "version": "0.1.0",
  "description": "LOOP24-specific commands and services — declarative LangFlow flow triggers, brand theming, connection probes",
  "tier": "core",
  "requires": { "platform": ">=2.29.0" },
  "provides": {
    "commands": [],
    "hooks": ["session_start"]
  }
}
```

Note: `commands` will be populated as flow-trigger YAML files are added (or in a later task — manifest enumeration is informational, not enforced).

- [ ] **Step 3: Write a minimal entry point**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/index.ts`:
```typescript
/**
 * LOOP24 Extension
 *
 * Owns:
 *   - Declarative LangFlow flow-trigger slash commands (loaded from
 *     commands/flow-triggers/*.yaml at extension load)
 *   - Brand banner and theme files (already in branding/ and theme/)
 *   - LangFlow connection-state probe surfaced to the loader banner
 */

import type { ExtensionAPI } from "@gsd/pi-coding-agent";

export default function Loop24(pi: ExtensionAPI): void {
  pi.on("session_start", async () => {
    // Connection probe stub — real implementation lands in Task 6.
    // Kept here so the hook is wired from the start; future tasks fill the body.
  });

  // Flow-trigger registration lands in Task 4 (loader) + Task 5 (example YAML).
}
```

- [ ] **Step 4: Build and confirm the extension loads**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | grep -E "(error|fail)" | head -5 || echo "build clean"
node dist/loader.js --version
```
Expected: build clean, version prints `1.0.1`.

The extension is discovered via the extension-registry path-walk. To confirm it actually loads (vs silently being skipped), grep the extension registry or check logs:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
ls ~/.loop24/agent/extension-registry.json 2>/dev/null && cat ~/.loop24/agent/extension-registry.json | grep -A 2 '"loop24"'
```

If the registry doesn't exist yet (no interactive launch since fresh install), the extension will be discovered on next interactive run. Verify the directory has `extension-manifest.json` and `index.ts` and trust the discovery process.

- [ ] **Step 5: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/extension-manifest.json src/resources/extensions/loop24/index.ts
git commit -m "feat(loop24): bootstrap extension scaffold

Creates extension-manifest.json and index.ts so the loop24 directory
becomes a registered Pi extension. Stub session_start hook in place
for the LangFlow connection probe coming in Task 6. Flow-trigger
loading wired in Task 4."
```

---

## Task 2: Investigate LangFlow's actual API shape

**Files:** none (research only — writes a reference doc)

**Why:** LangFlow's API shape (request bodies, response envelopes, streaming chunk format) varies between versions. Before implementing the client, verify the exact contract against the user's running LangFlow server. Writing the wrong shape into the client is the kind of bug that's a pain to debug later through layers of abstraction.

- [ ] **Step 1: Confirm LangFlow is reachable**

```bash
curl -sf http://127.0.0.1:7860/api/v1/version | head -5 || echo "LANGFLOW OFFLINE — see Step 1b"
```

If reachable, note the version printed. If offline:

- [ ] **Step 1b (only if LangFlow is offline)** — stop and report BLOCKED, asking the controller to start LangFlow or provide a mock. The rest of this task needs a live server to inspect.

- [ ] **Step 2: Capture the request/response shapes for the three endpoints the client needs**

```bash
# version
curl -s http://127.0.0.1:7860/api/v1/version | tee /tmp/lf-version.json

# list flows
curl -s http://127.0.0.1:7860/api/v1/flows/ | head -c 2000 | tee /tmp/lf-flows.json

# run a flow (need a real flow ID — list one from above)
# pick the first flow id from /tmp/lf-flows.json, e.g. with jq:
FLOW_ID=$(cat /tmp/lf-flows.json | python3 -c "import json, sys; d = json.load(sys.stdin); print(d[0]['id'])" 2>/dev/null || echo "MANUAL")
echo "Using FLOW_ID=$FLOW_ID"
curl -s -X POST "http://127.0.0.1:7860/api/v1/run/$FLOW_ID" \
  -H "Content-Type: application/json" \
  -d '{"input_value":"hello","output_type":"chat","input_type":"chat"}' | head -c 3000 | tee /tmp/lf-run.json
```

If `LANGFLOW_API_KEY` is set, add `-H "x-api-key: $LANGFLOW_API_KEY"` (LangFlow uses `x-api-key`, NOT `Authorization: Bearer …` — verify).

- [ ] **Step 3: Try the streaming variant**

```bash
curl -s -N -X POST "http://127.0.0.1:7860/api/v1/run/$FLOW_ID?stream=true" \
  -H "Content-Type: application/json" \
  -d '{"input_value":"hello","output_type":"chat","input_type":"chat"}' | head -c 2000
```

Observe: is it SSE (`data: {...}\n\n` framing)? NDJSON? Chunked transfer? Note for the client implementation.

- [ ] **Step 4: Write a small reference doc**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/clients/LANGFLOW-API.md` with the observed shapes. ~30-50 lines, code blocks for each endpoint. This becomes the contract the client implementation targets and the source-of-truth if the API shape ever drifts.

Include:
- LangFlow version observed
- Auth header name (almost certainly `x-api-key`)
- Request body for `POST /api/v1/run/<flow_id>` — exact field names
- Response envelope shape (where in the JSON does the actual output text live? `outputs[0].outputs[0].results.message.text`?)
- Streaming framing (SSE vs NDJSON, terminator marker)
- Error response shape

- [ ] **Step 5: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/clients/LANGFLOW-API.md
git commit -m "docs(loop24): LangFlow API reference captured from live server

Run-flow request/response shapes, version probe, streaming framing.
Locks in the contract before the client is built so we don't have to
debug shape mismatches through abstraction layers later."
```

---

## Task 3: LangFlow HTTP client

**Files:**
- Create: `src/resources/extensions/loop24/clients/langflow.ts`
- Create: `src/resources/extensions/loop24/tests/langflow-client.test.ts`

- [ ] **Step 1: Write failing tests against a mock server**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/tests/langflow-client.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { LangFlowClient } from "../clients/langflow.js";

async function withMockServer(
  handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void | Promise<void>,
  fn: (url: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer((req, res) => { Promise.resolve(handler(req, res)).catch(() => res.end()); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  try {
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("getVersion returns LangFlow version string", async () => {
  await withMockServer(
    (req, res) => {
      assert.equal(req.url, "/api/v1/version");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ version: "1.5.0", main_version: "1.5.0", package: "Langflow" }));
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url });
      const v = await client.getVersion();
      assert.equal(v.version, "1.5.0");
    },
  );
});

test("getVersion returns null when server is unreachable (short timeout)", async () => {
  // Port 1 is always closed.
  const client = new LangFlowClient({ baseUrl: "http://127.0.0.1:1", timeoutMs: 200 });
  const v = await client.getVersion();
  assert.equal(v, null);
});

test("runFlow POSTs to /api/v1/run/<flowId> with correct body shape", async () => {
  let receivedBody = "";
  let receivedAuthHeader: string | undefined;
  await withMockServer(
    (req, res) => {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/api/v1/run/flow-abc");
      receivedAuthHeader = req.headers["x-api-key"] as string | undefined;
      req.on("data", (c) => (receivedBody += c.toString()));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ outputs: [{ outputs: [{ results: { message: { text: "ok" } } }] }] }));
      });
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url, apiKey: "secret-key" });
      const result = await client.runFlow("flow-abc", { input_value: "hi" });
      assert.deepEqual(JSON.parse(receivedBody), { input_value: "hi" });
      assert.equal(receivedAuthHeader, "secret-key");
      assert.equal(result.text, "ok");
    },
  );
});

test("runFlow omits x-api-key header when no apiKey configured", async () => {
  let receivedAuthHeader: string | undefined;
  await withMockServer(
    (req, res) => {
      receivedAuthHeader = req.headers["x-api-key"] as string | undefined;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ outputs: [{ outputs: [{ results: { message: { text: "ok" } } }] }] }));
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url });
      await client.runFlow("flow-abc", { input_value: "hi" });
      assert.equal(receivedAuthHeader, undefined);
    },
  );
});

test("runFlow surfaces 4xx errors with status + body", async () => {
  await withMockServer(
    (_req, res) => {
      res.statusCode = 404;
      res.end(JSON.stringify({ detail: "Flow not found" }));
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url });
      await assert.rejects(
        () => client.runFlow("missing-flow", { input_value: "x" }),
        (err: Error) => err.message.includes("404") && err.message.includes("Flow not found"),
      );
    },
  );
});
```

(The expected response shape `outputs[0].outputs[0].results.message.text` should be verified against Task 2's LANGFLOW-API.md. Adjust if your captured shape is different.)

- [ ] **Step 2: Run tests, verify FAIL**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/loop24/tests/langflow-client.test.ts 2>&1 | tail -10
```
Expected: FAIL — module not found (`LangFlowClient` doesn't exist yet).

- [ ] **Step 3: Implement the minimal client**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/clients/langflow.ts`:
```typescript
/**
 * LangFlow HTTP client.
 *
 * Targets the API shape documented in clients/LANGFLOW-API.md.
 * Uses Node 22+ built-in fetch — no axios.
 *
 * Auth: optional. When apiKey is provided, sent as `x-api-key` header.
 * Timeout: configurable per-method; getVersion defaults to a short
 * 1500ms because it runs on the loader banner hot path.
 */

export interface LangFlowClientOptions {
  baseUrl: string;       // e.g. "http://127.0.0.1:7860"
  apiKey?: string;       // optional; omitted if absent
  timeoutMs?: number;    // default per-request fallback
}

export interface LangFlowVersion {
  version: string;
  main_version?: string;
  package?: string;
}

export interface RunFlowInput {
  input_value: string;
  output_type?: string;   // default "chat"
  input_type?: string;    // default "chat"
  tweaks?: Record<string, unknown>;
}

export interface RunFlowResult {
  text: string;
  raw: unknown;           // entire response envelope, for callers that need it
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class LangFlowClient {
  constructor(private readonly opts: LangFlowClientOptions) {}

  /**
   * Probe LangFlow version. Returns null on any failure (offline, timeout,
   * non-2xx, bad JSON). Used by the loader banner — should never throw.
   */
  async getVersion(timeoutMsOverride?: number): Promise<LangFlowVersion | null> {
    const timeoutMs = timeoutMsOverride ?? this.opts.timeoutMs ?? 1500;
    try {
      const res = await this._fetch(`${this.opts.baseUrl}/api/v1/version`, { method: "GET" }, timeoutMs);
      if (!res.ok) return null;
      return (await res.json()) as LangFlowVersion;
    } catch {
      return null;
    }
  }

  /**
   * Trigger a flow by ID. Throws on non-2xx with status + response body in
   * the error message. Returns parsed result with extracted text.
   */
  async runFlow(flowId: string, input: RunFlowInput, timeoutMsOverride?: number): Promise<RunFlowResult> {
    const timeoutMs = timeoutMsOverride ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const res = await this._fetch(
      `${this.opts.baseUrl}/api/v1/run/${encodeURIComponent(flowId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
      timeoutMs,
    );
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`langflow: ${res.status} ${res.statusText} — ${bodyText.slice(0, 500)}`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(bodyText);
    } catch {
      throw new Error(`langflow: response was not JSON — ${bodyText.slice(0, 200)}`);
    }
    return {
      text: this._extractText(raw),
      raw,
    };
  }

  private async _fetch(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.opts.apiKey) headers.set("x-api-key", this.opts.apiKey);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, headers, signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Extract the user-facing text from a LangFlow response envelope. Shape
   * may vary by flow definition; this best-effort walks the conventional
   * path documented in LANGFLOW-API.md.
   */
  private _extractText(raw: unknown): string {
    type Envelope = { outputs?: { outputs?: { results?: { message?: { text?: string } } }[] }[] };
    const env = raw as Envelope;
    return env.outputs?.[0]?.outputs?.[0]?.results?.message?.text ?? "";
  }
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/loop24/tests/langflow-client.test.ts 2>&1 | tail -6
```
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/clients/langflow.ts src/resources/extensions/loop24/tests/langflow-client.test.ts
git commit -m "feat(loop24): LangFlow HTTP client (getVersion + runFlow)

Minimal client targeting the API shape captured in clients/LANGFLOW-API.md.
Uses Node 22+ built-in fetch — no axios. Optional x-api-key auth via
LANGFLOW_API_KEY. getVersion is non-throwing (returns null on any
failure) so it's safe to call on the loader hot path.

Streaming support deferred — runtime-trigger commands ship non-streaming
in Phase 3 and gain streaming if/when the response volume warrants it."
```

---

## Task 4: YAML schema + validator

**Files:**
- Create: `src/resources/extensions/loop24/commands/flow-triggers/_schema.ts`
- Create: `src/resources/extensions/loop24/tests/flow-trigger-schema.test.ts`

- [ ] **Step 1: Write failing tests**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/tests/flow-trigger-schema.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFlowTrigger, type FlowTrigger } from "../commands/flow-triggers/_schema.js";

test("validates minimal valid YAML object", () => {
  const result = validateFlowTrigger({
    name: "analyze-logs",
    description: "Analyze a log file",
    flow: { id: "flow-abc" },
    inputs: [{ name: "file", type: "string", required: true, flowField: "input_file" }],
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.value.name, "analyze-logs");
    assert.equal(result.value.flow.id, "flow-abc");
  }
});

test("rejects missing name", () => {
  const result = validateFlowTrigger({
    description: "x",
    flow: { id: "flow-abc" },
    inputs: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes("name")));
});

test("rejects missing flow.id AND flow.name", () => {
  const result = validateFlowTrigger({
    name: "x",
    description: "x",
    flow: {},
    inputs: [],
  });
  assert.equal(result.ok, false);
});

test("accepts flow.name as alternative to flow.id", () => {
  const result = validateFlowTrigger({
    name: "x",
    description: "x",
    flow: { name: "My Flow" },
    inputs: [],
  });
  assert.ok(result.ok);
});

test("rejects invalid input type", () => {
  const result = validateFlowTrigger({
    name: "x",
    description: "x",
    flow: { id: "y" },
    inputs: [{ name: "f", type: "rocket", required: true, flowField: "input_file" }],
  });
  assert.equal(result.ok, false);
});

test("rejects non-string command name", () => {
  const result = validateFlowTrigger({
    name: 42,
    description: "x",
    flow: { id: "y" },
    inputs: [],
  });
  assert.equal(result.ok, false);
});

test("rejects command name containing whitespace", () => {
  const result = validateFlowTrigger({
    name: "bad name",
    description: "x",
    flow: { id: "y" },
    inputs: [],
  });
  assert.equal(result.ok, false);
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/loop24/tests/flow-trigger-schema.test.ts 2>&1 | tail -5
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the schema validator**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/commands/flow-triggers/_schema.ts`:
```typescript
/**
 * Declarative flow-trigger command schema.
 *
 * Hand-rolled validator — no external dep. The schema is small enough
 * to enumerate by hand and clearer than a zod/typebox declaration
 * for someone reading the file for the first time.
 */

export interface FlowTrigger {
  name: string;                            // slash-command name (no spaces; e.g. "analyze-logs")
  description: string;                     // shown in /loop24 autocomplete
  flow: { id?: string; name?: string };    // one or the other; id wins if both present
  server?: string;                         // optional override; falls back to LANGFLOW_SERVER_URL env
  inputs: FlowTriggerInput[];
  execution?: {
    mode?: "stream" | "poll" | "fire-and-forget"; // default: "poll"
    timeoutMs?: number;                            // default: 300000 (5 min)
  };
  output?: {
    format?: "markdown" | "json" | "raw";          // default: "markdown"
    render?: "inline" | "file" | "both";           // default: "inline"
  };
}

export interface FlowTriggerInput {
  name: string;                            // arg name in the slash command (--name value)
  type: "string" | "number" | "bool" | "file";
  required?: boolean;                      // default false
  default?: string | number | boolean;
  flowField: string;                       // field name in LangFlow flow's input shape
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const VALID_INPUT_TYPES = new Set(["string", "number", "bool", "file"]);
const VALID_MODES = new Set(["stream", "poll", "fire-and-forget"]);
const VALID_FORMATS = new Set(["markdown", "json", "raw"]);
const VALID_RENDERS = new Set(["inline", "file", "both"]);

export function validateFlowTrigger(raw: unknown): ValidationResult<FlowTrigger> {
  const errs: string[] = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["root must be an object"] };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.name !== "string") errs.push("name: missing or not a string");
  else if (!NAME_PATTERN.test(r.name)) errs.push(`name: must match ${NAME_PATTERN} (lowercase, digits, hyphens)`);

  if (typeof r.description !== "string") errs.push("description: missing or not a string");

  if (r.flow === null || typeof r.flow !== "object") errs.push("flow: missing or not an object");
  else {
    const f = r.flow as Record<string, unknown>;
    if (typeof f.id !== "string" && typeof f.name !== "string") {
      errs.push("flow: must have either .id or .name");
    }
  }

  if (r.server !== undefined && typeof r.server !== "string") errs.push("server: must be a string when present");

  if (!Array.isArray(r.inputs)) errs.push("inputs: missing or not an array");
  else {
    r.inputs.forEach((inp, i) => {
      if (inp === null || typeof inp !== "object") {
        errs.push(`inputs[${i}]: must be an object`);
        return;
      }
      const ip = inp as Record<string, unknown>;
      if (typeof ip.name !== "string") errs.push(`inputs[${i}].name: missing or not a string`);
      if (typeof ip.type !== "string" || !VALID_INPUT_TYPES.has(ip.type)) {
        errs.push(`inputs[${i}].type: must be one of ${[...VALID_INPUT_TYPES].join("|")}`);
      }
      if (typeof ip.flowField !== "string") errs.push(`inputs[${i}].flowField: missing or not a string`);
    });
  }

  if (r.execution !== undefined) {
    if (r.execution === null || typeof r.execution !== "object") errs.push("execution: must be an object when present");
    else {
      const ex = r.execution as Record<string, unknown>;
      if (ex.mode !== undefined && (typeof ex.mode !== "string" || !VALID_MODES.has(ex.mode))) {
        errs.push(`execution.mode: must be one of ${[...VALID_MODES].join("|")}`);
      }
      if (ex.timeoutMs !== undefined && (typeof ex.timeoutMs !== "number" || ex.timeoutMs <= 0)) {
        errs.push("execution.timeoutMs: must be a positive number");
      }
    }
  }

  if (r.output !== undefined) {
    if (r.output === null || typeof r.output !== "object") errs.push("output: must be an object when present");
    else {
      const o = r.output as Record<string, unknown>;
      if (o.format !== undefined && (typeof o.format !== "string" || !VALID_FORMATS.has(o.format))) {
        errs.push(`output.format: must be one of ${[...VALID_FORMATS].join("|")}`);
      }
      if (o.render !== undefined && (typeof o.render !== "string" || !VALID_RENDERS.has(o.render))) {
        errs.push(`output.render: must be one of ${[...VALID_RENDERS].join("|")}`);
      }
    }
  }

  if (errs.length > 0) return { ok: false, errors: errs };
  return { ok: true, value: r as unknown as FlowTrigger };
}
```

- [ ] **Step 4: Run, verify PASS**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/loop24/tests/flow-trigger-schema.test.ts 2>&1 | tail -5
```
Expected: 7/7 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/commands/flow-triggers/_schema.ts src/resources/extensions/loop24/tests/flow-trigger-schema.test.ts
git commit -m "feat(loop24): flow-trigger YAML schema + hand-rolled validator

Declarative schema for flow-trigger commands as per design spec §6.1.
Hand-rolled validator (no external dep) because the schema is small
enough that enumeration is clearer than a zod-style declaration."
```

---

## Task 5: YAML loader — discovers files and registers slash commands

**Files:**
- Create: `src/resources/extensions/loop24/commands/flow-triggers/_loader.ts`
- Create: `src/resources/extensions/loop24/tests/flow-trigger-loader.test.ts`

- [ ] **Step 1: Confirm `js-yaml` is available (or pick a parser)**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node -e "console.log(Object.keys(require('js-yaml')).length)" 2>&1 || echo "js-yaml not installed"
node -e "console.log(Object.keys(require('yaml')).length)" 2>&1 || echo "yaml not installed"
```

Pick the one that's already present. If neither is, install `yaml` (smaller, modern):
```bash
npm install --workspace=. yaml 2>&1 | tail -3
```

The plan assumes the `yaml` package below; adjust imports if you used `js-yaml` instead (`import yaml from "js-yaml"; yaml.load(text)` vs `import { parse } from "yaml"; parse(text)`).

- [ ] **Step 2: Write failing tests**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/tests/flow-trigger-loader.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFlowTriggers } from "../commands/flow-triggers/_loader.js";

function withTempDir(fn: (dir: string) => void | Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "loop24-flow-triggers-"));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("returns empty array when directory has no YAML files", async () => {
  await withTempDir(async (dir) => {
    const result = await loadFlowTriggers(dir);
    assert.deepEqual(result.commands, []);
    assert.deepEqual(result.errors, []);
  });
});

test("loads a valid YAML file", async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, "echo.yaml"), `
name: echo
description: Echo a message
flow:
  id: echo-flow
inputs:
  - name: msg
    type: string
    required: true
    flowField: input_value
`);
    const result = await loadFlowTriggers(dir);
    assert.equal(result.commands.length, 1);
    assert.equal(result.commands[0]?.name, "echo");
    assert.equal(result.errors.length, 0);
  });
});

test("skips files starting with underscore (loader-internal convention)", async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, "_skip-me.yaml"), `name: should-not-load
description: x
flow: { id: y }
inputs: []
`);
    const result = await loadFlowTriggers(dir);
    assert.equal(result.commands.length, 0);
  });
});

test("collects errors from invalid YAML without throwing", async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, "broken.yaml"), `name: 42
flow: not an object
`);
    const result = await loadFlowTriggers(dir);
    assert.equal(result.commands.length, 0);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0]?.file.endsWith("broken.yaml"));
    assert.ok(result.errors[0]?.message.length > 0);
  });
});

test("loads multiple files in deterministic alphabetical order", async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, "zebra.yaml"), `name: zebra\ndescription: z\nflow: { id: z }\ninputs: []\n`);
    writeFileSync(join(dir, "alpha.yaml"), `name: alpha\ndescription: a\nflow: { id: a }\ninputs: []\n`);
    const result = await loadFlowTriggers(dir);
    assert.deepEqual(result.commands.map((c) => c.name), ["alpha", "zebra"]);
  });
});
```

- [ ] **Step 3: Run, verify FAIL**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/loop24/tests/flow-trigger-loader.test.ts 2>&1 | tail -5
```
Expected: FAIL.

- [ ] **Step 4: Implement the loader**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/commands/flow-triggers/_loader.ts`:
```typescript
/**
 * Flow-trigger loader.
 *
 * Scans a directory for `*.yaml` files (skipping anything starting with
 * underscore — those are loader-internal helpers like _schema.ts), parses
 * each one, validates against the FlowTrigger schema, and returns:
 *   - commands: the valid FlowTrigger objects ready to register
 *   - errors:   per-file diagnostics for invalid files
 *
 * Never throws — bad YAML in one file should not block others.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { validateFlowTrigger, type FlowTrigger } from "./_schema.js";

export interface FlowTriggerLoadResult {
  commands: FlowTrigger[];
  errors: { file: string; message: string }[];
}

export async function loadFlowTriggers(dir: string): Promise<FlowTriggerLoadResult> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { commands: [], errors: [] };  // dir doesn't exist → no commands, no errors
  }

  const yamlFiles = entries
    .filter((f) => (f.endsWith(".yaml") || f.endsWith(".yml")) && !f.startsWith("_"))
    .sort();

  const commands: FlowTrigger[] = [];
  const errors: { file: string; message: string }[] = [];

  for (const file of yamlFiles) {
    const path = join(dir, file);
    let text: string;
    try {
      text = await readFile(path, "utf-8");
    } catch (err) {
      errors.push({ file: path, message: `cannot read: ${(err as Error).message}` });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = parseYaml(text);
    } catch (err) {
      errors.push({ file: path, message: `invalid YAML: ${(err as Error).message}` });
      continue;
    }
    const validated = validateFlowTrigger(parsed);
    if (!validated.ok) {
      errors.push({ file: path, message: validated.errors.join("; ") });
      continue;
    }
    commands.push(validated.value);
  }

  return { commands, errors };
}
```

- [ ] **Step 5: Run tests, verify PASS**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/loop24/tests/flow-trigger-loader.test.ts 2>&1 | tail -5
```
Expected: 5/5 pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/commands/flow-triggers/_loader.ts src/resources/extensions/loop24/tests/flow-trigger-loader.test.ts package.json package-lock.json
git commit -m "feat(loop24): flow-trigger YAML loader

Scans commands/flow-triggers/*.yaml at extension load. Validates each
against the FlowTrigger schema. Never throws — bad YAML in one file
does not block others. Returns { commands, errors } so the caller can
register valid commands and log diagnostics for invalid ones."
```

---

## Task 6: Wire loader into the extension entry point + register commands at session_start

**Files:**
- Modify: `src/resources/extensions/loop24/index.ts`

- [ ] **Step 1: Update the entry point to load and register commands**

Edit `src/resources/extensions/loop24/index.ts` (created in Task 1):
```typescript
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@gsd/pi-coding-agent";
import { LangFlowClient } from "./clients/langflow.js";
import { loadFlowTriggers } from "./commands/flow-triggers/_loader.js";
import type { FlowTrigger, FlowTriggerInput } from "./commands/flow-triggers/_schema.js";

const _here = dirname(fileURLToPath(import.meta.url));
const FLOW_TRIGGERS_DIR = join(_here, "commands", "flow-triggers");

function getLangFlowClient(): LangFlowClient {
  return new LangFlowClient({
    baseUrl: process.env.LANGFLOW_SERVER_URL || "http://127.0.0.1:7860",
    apiKey: process.env.LANGFLOW_API_KEY,
  });
}

/** Parse `--name value` style args from a single string. Minimal — caller handles edge cases. */
function parseArgs(argString: string, inputs: FlowTriggerInput[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const re = /--([a-zA-Z0-9_-]+)(?:=("[^"]*"|\S+)|\s+("[^"]*"|\S+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(argString))) {
    const key = m[1]!;
    let raw = (m[2] ?? m[3] ?? "true");
    if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
    const inputDef = inputs.find((i) => i.name === key);
    if (!inputDef) { out[key] = raw; continue; }
    switch (inputDef.type) {
      case "number": out[key] = Number(raw); break;
      case "bool":   out[key] = raw === "true"; break;
      default:       out[key] = raw;
    }
  }
  // Apply defaults for any missing inputs that declared one.
  for (const inp of inputs) {
    if (out[inp.name] === undefined && inp.default !== undefined) out[inp.name] = inp.default;
  }
  return out;
}

function buildHandler(trigger: FlowTrigger): (args: string, ctx: ExtensionCommandContext) => Promise<void> {
  return async (args: string, _ctx: ExtensionCommandContext) => {
    const client = new LangFlowClient({
      baseUrl: trigger.server || process.env.LANGFLOW_SERVER_URL || "http://127.0.0.1:7860",
      apiKey: process.env.LANGFLOW_API_KEY,
      timeoutMs: trigger.execution?.timeoutMs,
    });

    const parsed = parseArgs(args, trigger.inputs);

    // Validate required inputs are present
    const missing = trigger.inputs.filter((i) => i.required && parsed[i.name] === undefined).map((i) => i.name);
    if (missing.length > 0) {
      process.stderr.write(`Missing required argument(s): ${missing.join(", ")}\n`);
      return;
    }

    // Map argName → flowField
    const flowInputs: Record<string, unknown> = {};
    for (const inp of trigger.inputs) {
      if (parsed[inp.name] !== undefined) flowInputs[inp.flowField] = parsed[inp.name];
    }
    const inputValue = String(flowInputs.input_value ?? Object.values(flowInputs)[0] ?? "");

    try {
      const flowId = trigger.flow.id ?? trigger.flow.name!;
      const result = await client.runFlow(flowId, { input_value: inputValue, ...flowInputs });
      process.stdout.write(result.text + "\n");
    } catch (err) {
      process.stderr.write(`langflow error: ${(err as Error).message}\n`);
    }
  };
}

export default function Loop24(pi: ExtensionAPI): void {
  pi.on("session_start", async () => {
    // LangFlow connection probe (Task 7 wires this to the banner)
    const client = getLangFlowClient();
    const version = await client.getVersion();
    if (version) {
      process.env.LOOP24_LANGFLOW_STATUS = "connected";
    } else {
      process.env.LOOP24_LANGFLOW_STATUS = "offline";
    }
  });

  // Load and register all valid flow-trigger commands
  loadFlowTriggers(FLOW_TRIGGERS_DIR)
    .then(({ commands, errors }) => {
      for (const t of commands) {
        pi.registerCommand(t.name, {
          description: t.description,
          handler: buildHandler(t),
        });
      }
      if (errors.length > 0) {
        for (const e of errors) {
          process.stderr.write(`[loop24] flow-trigger ${e.file}: ${e.message}\n`);
        }
      }
    })
    .catch((err) => {
      process.stderr.write(`[loop24] flow-trigger loader failed: ${(err as Error).message}\n`);
    });
}
```

(Note: this fires-and-forgets the `loadFlowTriggers` promise. That's OK for Phase 3 because Pi's command registry is dynamic — late registrations work. If a future user complains they have to wait between `loop24` launch and their YAML command being available, we'd need to await it before returning from the factory. Document this as a known characteristic.)

- [ ] **Step 2: Build**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
```

- [ ] **Step 3: Run the existing regression suite**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  packages/pi-coding-agent/src/config.test.ts \
  src/resources/extensions/workflow/tests/update-command.test.ts \
  src/resources/extensions/workflow/tests/extension-bootstrap-isolation.test.ts \
  src/resources/extensions/loop24/tests/langflow-client.test.ts \
  src/resources/extensions/loop24/tests/flow-trigger-schema.test.ts \
  src/resources/extensions/loop24/tests/flow-trigger-loader.test.ts \
  2>&1 | tail -6
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/index.ts
git commit -m "feat(loop24): wire flow-trigger loader into entry point

Loop24() extension factory now:
- Loads commands/flow-triggers/*.yaml on initialization, registers
  each as a slash command via pi.registerCommand.
- Probes LangFlow /api/v1/version on session_start, stores result in
  LOOP24_LANGFLOW_STATUS env var for the banner (Task 7).
- Routes invocations through LangFlowClient.runFlow, parsing args via
  a minimal --name value parser, mapping argName → flowField per the
  YAML schema."
```

---

## Task 7: Banner connection-state surface

**Files:**
- Modify: `src/loader.ts`

The loader's banner block prints a meta line `compliant agent for developers v1.0.1`. Phase 3 extends it with connection-state info. The session_start hook from Task 6 sets `LOOP24_LANGFLOW_STATUS` — the banner reads it.

But there's a timing issue: the loader banner prints BEFORE the extension's `session_start` fires. We need a one-shot synchronous probe at loader time too, OR we accept that the FIRST launch shows `langflow: probing…` and subsequent ones show the real state from the env var written by session_start.

Cleanest approach: do a quick (1500ms) probe inline in the loader if there's no cached state from a recent session.

- [ ] **Step 1: Add the loader-side probe + meta-line extension**

Edit `src/loader.ts`. Find the banner block (around the line that writes `compliant agent for developers ...`). The current code looks like:
```typescript
process.stderr.write(
  `${yellow}${banner}${reset}\n` +
  `  compliant agent for developers ${dim}v${gsdVersion}${reset}\n` +
  `  ${green}Welcome.${reset} Setting up your environment...\n\n`
)
```

Extend with a connection probe. Because `loader.ts` runs synchronously and we can't await from top-level in this fast-path, do the probe in a `.then()` and update the screen on completion is heavy. Simpler: skip the inline probe for now and just emit a placeholder. Real connection status appears once the extension's `session_start` fires (which happens immediately after).

For Phase 3, write the banner as:
```typescript
process.stderr.write(
  `${yellow}${banner}${reset}\n` +
  `  compliant agent for developers ${dim}v${gsdVersion}${reset}\n` +
  `  ${green}Welcome.${reset} Setting up your environment...\n\n`
)
```
…and leave the connection-state surfacing to the extension. The extension can `process.stderr.write` its own status line once the probe completes inside `session_start`. Update the Task 6 handler to also emit:
```typescript
const yellow = '\x1b[38;2;250;210;45m';
const green  = '\x1b[38;2;63;206;142m';
const red    = '\x1b[38;2;255;91;91m';
const reset  = '\x1b[0m';
const statusColor = version ? green : red;
process.stderr.write(`  ${yellow}langflow:${reset} ${statusColor}${version ? "connected" : "offline"}${reset}\n`);
```

- [ ] **Step 2: Modify the Task 6 handler accordingly**

Edit the `session_start` hook in `src/resources/extensions/loop24/index.ts` to emit the status line per Step 1.

- [ ] **Step 3: Build + smoke-test**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
rm -rf ~/.loop24
perl -e 'alarm 10; exec @ARGV' loop24 --print "ping" 2>/tmp/p3.txt
echo "--- stderr ---"
cat /tmp/p3.txt
```
Expected: banner appears, then a `langflow: connected` or `langflow: offline` line (depending on whether LangFlow is running locally), then the model response.

- [ ] **Step 4: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/index.ts
git commit -m "feat(loop24): surface langflow connection state in banner

session_start probe now emits a 'langflow: connected | offline' status
line in brand colors after the loader banner. Probe is best-effort
(1500ms timeout) and never throws."
```

---

## Task 8: Ship one real example flow-trigger YAML

**Files:**
- Create: `src/resources/extensions/loop24/commands/flow-triggers/example-echo.yaml`

This proves the whole loop end-to-end. Pick a flow you actually have running in your local LangFlow (Task 2 should have surfaced at least one).

- [ ] **Step 1: Pick a flow ID**

From Task 2's `/tmp/lf-flows.json`, pick the simplest flow (ideally one that just echoes or summarizes its input). Note the flow ID.

- [ ] **Step 2: Write the YAML**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/commands/flow-triggers/example-echo.yaml`:
```yaml
# Example flow-trigger command. Edit the flow.id below to point at an
# actual flow on your local LangFlow server, then invoke with:
#   /loop24 example-echo --msg "hello world"
name: example-echo
description: Run the example LangFlow echo flow with a single message
flow:
  id: PUT-YOUR-FLOW-ID-HERE   # ← Task 8 implementer: replace with a real id from `curl http://127.0.0.1:7860/api/v1/flows/`
inputs:
  - name: msg
    type: string
    required: true
    flowField: input_value
execution:
  mode: poll
  timeoutMs: 30000
output:
  format: markdown
  render: inline
```

(The implementer should replace `PUT-YOUR-FLOW-ID-HERE` with a real ID. If no suitable flow exists in their LangFlow, document this YAML as a template and skip the live invocation in Step 4 — the registration and parsing path is still verified.)

- [ ] **Step 3: Build, launch loop24, look for the command in autocomplete**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
# Interactive verification: launch loop24 and confirm /loop24 example-echo appears.
# (Cannot fully automate from a non-TTY here — describe what to look for.)
```

In interactive mode, typing `/loop24 ` should show `example-echo` in the autocomplete list with its description.

- [ ] **Step 4 (optional, live LangFlow): Invoke the command end-to-end**

If a real flow ID is wired in Step 2:
```bash
perl -e 'alarm 30; exec @ARGV' loop24 --print "/loop24 example-echo --msg \"hello\"" 2>&1 | tail -10
```
Expected: LangFlow's echo response prints to stdout.

If no flow ID is wired, document this in Step 5's commit message.

- [ ] **Step 5: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/commands/flow-triggers/example-echo.yaml
git commit -m "feat(loop24): example-echo flow-trigger YAML

Smallest realistic flow-trigger config. Demonstrates the schema
end-to-end. Users wire their own flow.id to invoke."
```

---

## Task 9: End-to-end smoke + tag

**Files:** none (verification + tag)

- [ ] **Step 1: Clean build**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
rm -rf dist
npm run build 2>&1 | tail -3
```

- [ ] **Step 2: Run all Phase 0/0.5/3 tests**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  packages/pi-coding-agent/src/config.test.ts \
  src/resources/extensions/workflow/tests/update-command.test.ts \
  src/resources/extensions/workflow/tests/autocomplete-regressions-1675.test.ts \
  src/resources/extensions/workflow/tests/help-menu-coverage.test.ts \
  src/resources/extensions/workflow/tests/extension-bootstrap-isolation.test.ts \
  src/resources/extensions/loop24/tests/langflow-client.test.ts \
  src/resources/extensions/loop24/tests/flow-trigger-schema.test.ts \
  src/resources/extensions/loop24/tests/flow-trigger-loader.test.ts \
  2>&1 | tail -8
```
Expected: all pass (40+ tests).

- [ ] **Step 3: Interactive smoke**

```bash
loop24
```
Verify: LOOP24 banner, then `langflow: connected` (if LangFlow is running) or `langflow: offline`, then the prompt. Type `/loop24 ` and autocomplete shows `example-echo` (if the YAML's flow.id was wired). Exit with Ctrl-C.

- [ ] **Step 4: Update LOOP24-PATCHES.md**

Add a "Phase 3 — LangFlow runtime triggers" section noting the new extension structure, the YAML schema, the client, and the env var contract (`LANGFLOW_SERVER_URL`, `LANGFLOW_API_KEY`).

- [ ] **Step 5: Tag**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add LOOP24-PATCHES.md
git commit -m "docs: LOOP24-PATCHES.md — Phase 3 LangFlow runtime triggers"
git tag -a phase-3-langflow-triggers -m "Phase 3 complete: declarative YAML flow-trigger commands, LangFlow HTTP client, connection-state banner. Requires LangFlow at LANGFLOW_SERVER_URL (default http://127.0.0.1:7860)."
git tag -l
git log --oneline | head -12
```

---

## Definition of Done

Phase 3 is complete when ALL of these are true:

- `loop24` extension manifest + entry point exist; the extension is discovered by Pi's extension registry.
- `LangFlowClient` exists with `getVersion()` (non-throwing) and `runFlow(flowId, input)` (throws on non-2xx).
- The YAML schema validator accepts a valid flow-trigger and produces clear errors for invalid ones.
- The loader scans `commands/flow-triggers/*.yaml` at extension init and registers a command per valid file.
- One example YAML file exists demonstrating the schema (whether or not the flow.id is wired to a real flow).
- The banner emits a `langflow: connected | offline` status line after the loader banner on launch.
- All Phase 0 regression tests still pass, plus the new Phase 3 tests (langflow client, schema, loader).
- `phase-3-langflow-triggers` git tag exists.
- LOOP24-PATCHES.md updated with a Phase 3 section.

---

## Self-Review (for plan author)

**Spec coverage** (vs design spec §6.1):
- ✅ "One YAML file per slash command" — Task 5 loader implements this
- ✅ "Schema: command name, description, flow_id (or flow_name), input mapping, output rendering, optional auth override" — Task 4 schema covers all
- ✅ "POST to LangFlow's /api/v1/run/<flow_id>" — Task 3 client
- ✅ "results stream back via the same AssistantMessageEventStream pi-ai uses" — partial: Phase 3 uses simple stdout writes; AssistantMessageEventStream integration deferred (not required for basic value, requires more pi-coding-agent internals)
- ✅ "clients/langflow.ts — single HTTP client used by both surfaces" — Task 3
- ✅ "Configuration — env vars" — Tasks 6, 7
- ✅ "Connection state — banner reports `langflow: connected | offline`" — Task 7

**Placeholder scan:** the only PLACEHOLDER value is `PUT-YOUR-FLOW-ID-HERE` in Task 8 Step 2, which is intentional (the implementer wires their actual flow ID). All other code is concrete.

**Type consistency:** `FlowTrigger`, `FlowTriggerInput`, `LangFlowClient`, `RunFlowInput`, `RunFlowResult`, `loadFlowTriggers` — names used identically across tasks. `validateFlowTrigger` returns `ValidationResult<FlowTrigger>` consistently.

**Scope check:** 9 tasks, each producing testable progress. Largest task is #6 (extension wiring) which has multiple concerns (loader registration + session_start) — borderline but coherent. Could split into 6a (load + register) and 6b (probe) if the implementer prefers.

**Known limitation:** Task 8 requires a real LangFlow flow to invoke end-to-end. If the user's LangFlow doesn't have a suitable echo/test flow, the live invocation step is skipped — the registration + schema + client paths are still verified by unit tests.

---

*End of Phase 3 plan.*
