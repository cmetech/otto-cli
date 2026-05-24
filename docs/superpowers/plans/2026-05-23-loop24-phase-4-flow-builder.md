# LOOP24 Phase 4 — LangFlow Flow Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/loop24 build-flow <description>` — a natural-language → LangFlow JSON flow generator. The agent loads turn-zero system context from four bundled reference docs, gets seven typed Pi tools (JSON-schema validated wrappers around bundled Python scripts) for catalog inspection, validation, import, and smoke testing, and writes the result to `flows/generated/`. This is LOOP24's flagship value-prop on top of Phase 3's flow triggers — Phase 3 invokes existing flows; Phase 4 authors new ones.

**Architecture:** Six pieces inside `src/resources/extensions/loop24/`. (1) `tools/scripts/` — verbatim copies of the seven Python helpers from the source skill, plus the `validate_flow.sh` shim. (2) `reference/` — verbatim copies of the four `*.md` rule docs. (3) `tools/python-runtime.ts` — small helper that resolves `python3` (or `PYTHON_BIN` override), spawns the bundled script, and returns `{stdout, stderr, exitCode}`. Fails cleanly when Python is unavailable. (4) `tools/_loader.ts` — registers all seven tools via `pi.registerTool` with TypeBox schemas, each calling the python-runtime helper. (5) `clients/langflow.ts` — extended (NOT forked) with an `importFlow(payload)` method that POSTs JSON to `/api/v1/flows/`. (6) `commands/build-flow/` — `/loop24 build-flow` slash command. Handler ensures repo scaffolding (`flows/generated/`, `flows/templates/`, `flows/imported/`, `catalog/`, `.gitignore`), reads the four reference docs from disk, and drives an agent turn via `ctx.newSession()` + `pi.sendMessage({content, display:false}, {triggerTurn:true})` with the reference docs as the leading system context and the user's flow description as the seed message.

**Tech Stack:** TypeScript (`--experimental-strip-types`), Node ≥22, Python 3 on PATH (not bundled — required at script-execution time), `@sinclair/typebox` for tool parameter schemas (already a transitive dep — `ToolDefinition<TParams extends TSchema>`), `node:child_process` for spawning Python, Node's built-in test runner. Bundled Python scripts depend on `requests` (verified by import-time error in the wrapper); `validate_flow.sh` optionally uses `lfx` and degrades to JSON-syntax-only validation when absent.

**⚠️ TS strip-types constraint:** all `.ts` files run through `--experimental-strip-types`. Avoid `enum`, `namespace`, parameter-property constructors (`constructor(private readonly x: T) {}`), and `import =`. Use explicit field declarations + assignment in constructors (the existing `LangFlowClient` already follows this).

**⚠️ piConfig triplication:** This phase does not touch `piConfig`. If anything in the implementation requires a piConfig change, update all three: root `package.json`, `packages/pi-coding-agent/package.json`, AND `pkg/package.json`. The load-bearing one is `pkg/package.json` because `src/loader.ts` sets `PI_PACKAGE_DIR=pkg/`.

**⚠️ brand.ts is loader-fast:** Do not add anything that requires async I/O, JSON.parse of large blobs, or non-fs imports to `src/brand.ts`. The reference docs are loaded inside the build-flow command handler, not at module load.

**Scope boundary:**

In scope:
- Verbatim copy of the seven Python scripts to `src/resources/extensions/loop24/tools/scripts/`
- Verbatim copy of the four reference docs to `src/resources/extensions/loop24/reference/`
- `python-runtime.ts` — generic helper, used by all seven tool wrappers
- Seven `pi.registerTool` wrappers (one TS file per tool) with TypeBox parameter schemas
- Extending `clients/langflow.ts` with `importFlow(payload)` — POST `/api/v1/flows/` with JSON body
- `/loop24 build-flow <description>` slash command — repo scaffolding, system-context loading, agent turn dispatch
- One real end-to-end live test against the user's running LangFlow at `http://localhost:7860`
- LOOP24-PATCHES.md Phase 4 section + git tag `phase-4-flow-builder`

Out of scope (deferred):
- Bundling Python itself (Python 3 must be on PATH; tool fails clearly if missing)
- A native TS rewrite of the Python scripts (verbatim port keeps parity with the upstream skill)
- A `/loop24 catalog` umbrella command (the seven tools cover catalog lifecycle; if the user wants a friendlier UX later, Q3 in the design spec covers it)
- Streaming tool output back to the model (each tool returns full stdout on completion — Python scripts are short-running)
- Multi-language flow generation (English only, matches source skill)

**Dependencies:**
- Python 3 on PATH (verified inline in the python-runtime helper; failure is a clear tool-result error pointing at install docs).
- `requests` Python package — required by `refresh_component_catalog.py`, `import_flow.py`, `smoke_test_flow.py`. The Python scripts already raise `ImportError` if missing; the wrapper surfaces this.
- LangFlow running locally — required for live end-to-end test only. Tools degrade clearly on connection error.
- Phase 3 complete (LangFlowClient exists; reference doc `clients/LANGFLOW-API.md` documents API shapes).

---

## File Structure

### New files

```
src/resources/extensions/loop24/
├── tools/
│   ├── scripts/                                # VERBATIM from source skill
│   │   ├── refresh_component_catalog.py
│   │   ├── normalize_component_catalog.py
│   │   ├── inspect_component.py
│   │   ├── validate_flow.sh                    # bash, marked executable
│   │   ├── import_flow.py
│   │   ├── smoke_test_flow.py
│   │   └── check_catalog_health.py
│   ├── python-runtime.ts                       # NEW — script runner helper
│   ├── _loader.ts                              # NEW — registers all 7 tools
│   ├── refresh-catalog.ts                      # NEW — refresh_catalog tool
│   ├── normalize-catalog.ts                    # NEW — normalize_catalog tool
│   ├── check-catalog-health.ts                 # NEW — check_catalog_health tool
│   ├── inspect-component.ts                    # NEW — inspect_component tool
│   ├── validate-flow.ts                        # NEW — validate_flow tool
│   ├── import-flow.ts                          # NEW — import_flow tool
│   └── smoke-test-flow.ts                      # NEW — smoke_test_flow tool
├── reference/                                  # VERBATIM from source skill
│   ├── workflow.md
│   ├── component-catalog-rules.md
│   ├── edge-handle-rules.md
│   └── flow-json-rules.md
├── commands/
│   └── build-flow/
│       ├── _scaffold.ts                        # NEW — ensures repo dirs + .gitignore
│       ├── _system-context.ts                  # NEW — loads + concats reference docs
│       └── command.ts                          # NEW — slash command handler
└── tests/
    ├── python-runtime.test.ts                  # NEW
    ├── tools-loader.test.ts                    # NEW — verifies all 7 tools register
    ├── langflow-import-flow.test.ts            # NEW — TDD for importFlow()
    ├── build-flow-scaffold.test.ts             # NEW — TDD for repo scaffolding
    └── build-flow-system-context.test.ts       # NEW — TDD for reference doc loader
```

### Modified files

- `src/resources/extensions/loop24/clients/langflow.ts` — add `importFlow(payload)` method. Keep existing `getVersion` + `runFlow` untouched.
- `src/resources/extensions/loop24/index.ts` — call `registerLoop24Tools(pi)` from the new tools/_loader.ts and register `/loop24 build-flow` from the new commands/build-flow/command.ts. Phase 3 flow-trigger loading must keep working.
- `src/resources/extensions/loop24/extension-manifest.json` — bump version (0.1.0 → 0.2.0), update `description`, add `"tools"` declarations.

### File responsibilities (one-liners)

| File | Responsibility |
|---|---|
| `tools/scripts/*` | Bundled Python scripts (verbatim) — the actual work happens here |
| `tools/python-runtime.ts` | One generic `runPython(scriptPath, args, opts)` helper. Resolves `python3`, spawns, captures stdout+stderr, returns `{exitCode, stdout, stderr}`. Friendly error if python missing. |
| `tools/_loader.ts` | Exports `registerLoop24Tools(pi)` — registers all seven `ToolDefinition`s |
| `tools/<tool>.ts` (×7) | One file per tool. Exports a `ToolDefinition` object with name, label, description, TypeBox `parameters` schema, and an `execute()` that shells out via `python-runtime.ts` |
| `reference/*.md` | Reference docs (verbatim) — read at slash-command time and injected as system context |
| `clients/langflow.ts` (modified) | Add `importFlow(payload)` — POST JSON to `/api/v1/flows/`. Reuses existing `_fetch` for auth + timeout. |
| `commands/build-flow/_scaffold.ts` | `ensureRepoConventions(cwd)` — creates `flows/{generated,templates,imported}`, `catalog/`, appends `catalog/components.raw.json` etc. to `.gitignore` if not already present. Idempotent. |
| `commands/build-flow/_system-context.ts` | `loadReferenceDocs()` — reads the four `reference/*.md` files at the extension dir and returns one concatenated string with file-header banners |
| `commands/build-flow/command.ts` | `registerBuildFlowCommand(pi)` — registers the slash command. Handler: scaffold → load context → `ctx.newSession()` → `pi.sendMessage({content: prompt, display:false}, {triggerTurn:true})` |

---

## Task 1: Bundle Python scripts + reference docs (verbatim copy)

**Files:**
- Copy: 7 scripts from source to `src/resources/extensions/loop24/tools/scripts/`
- Copy: 4 reference docs from source to `src/resources/extensions/loop24/reference/`

Pure mechanical step. No code changes. Verbatim copies keep parity with the upstream skill.

- [ ] **Step 1: Create destination dirs**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
mkdir -p src/resources/extensions/loop24/tools/scripts
mkdir -p src/resources/extensions/loop24/reference
```

- [ ] **Step 2: Copy the seven scripts verbatim**

```bash
SRC=~/Projects/repos/gitlab.rosetta.ericssondevops.com/loop_24/.claude/skills/langflow-flow-builder/scripts
DST=/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/tools/scripts
cp "$SRC/refresh_component_catalog.py" "$DST/"
cp "$SRC/normalize_component_catalog.py" "$DST/"
cp "$SRC/inspect_component.py" "$DST/"
cp "$SRC/validate_flow.sh" "$DST/"
cp "$SRC/import_flow.py" "$DST/"
cp "$SRC/smoke_test_flow.py" "$DST/"
cp "$SRC/check_catalog_health.py" "$DST/"
chmod +x "$DST"/*.py "$DST/validate_flow.sh"
ls -la "$DST"
```

Expected: 7 files, all executable.

- [ ] **Step 3: Copy the four reference docs verbatim**

```bash
SRC=~/Projects/repos/gitlab.rosetta.ericssondevops.com/loop_24/.claude/skills/langflow-flow-builder/reference
DST=/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/reference
cp "$SRC/workflow.md" "$DST/"
cp "$SRC/component-catalog-rules.md" "$DST/"
cp "$SRC/edge-handle-rules.md" "$DST/"
cp "$SRC/flow-json-rules.md" "$DST/"
ls -la "$DST"
```

Expected: 4 markdown files.

- [ ] **Step 4: Verify scripts run standalone (smoke test)**

```bash
python3 --version
# Should print 3.x. If missing, document and STOP — Phase 4 requires python3.
python3 /Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/tools/scripts/inspect_component.py 2>&1 | head -2
# Expected: "Usage: inspect_component.py <search-term>" (exits 1 — that's fine, proves the script parses & runs)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/tools/scripts/ src/resources/extensions/loop24/reference/
git commit -m "feat(loop24): bundle flow-builder Python scripts + reference docs

Verbatim copy from langflow-flow-builder source skill:
  - 7 Python scripts (catalog refresh/normalize/inspect/health,
    flow validate/import/smoke-test)
  - 4 markdown reference docs (workflow, component catalog rules,
    edge handle rules, flow JSON rules)

Scripts shell out via python3 on PATH — Python is NOT bundled.
The tool wrappers in Task 3 surface a clear error if python3 is missing.

Reference docs are loaded as system context by the /loop24 build-flow
slash command in Task 5."
```

---

## Task 2: Python runtime helper (TDD)

**Files:**
- Create: `src/resources/extensions/loop24/tools/python-runtime.ts`
- Create: `src/resources/extensions/loop24/tests/python-runtime.test.ts`

The helper that all seven tool wrappers call. One responsibility: locate `python3` (or `bash` for the .sh script), spawn the bundled script with args, capture stdout/stderr/exit, return a structured result. Surface a clear, actionable error if the interpreter is missing.

- [ ] **Step 1: Write the failing tests**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/tests/python-runtime.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPython, runBash, ensurePython3 } from "../tools/python-runtime.js";

function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "loop24-python-runtime-"));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("ensurePython3 returns interpreter info when python3 is on PATH", async () => {
  const info = await ensurePython3();
  assert.ok(info.ok, `expected python3 available; got: ${info.ok ? "ok" : info.error}`);
  if (info.ok) {
    assert.ok(info.binary.length > 0);
    assert.ok(info.version.startsWith("Python 3"), `expected Python 3.x, got: ${info.version}`);
  }
});

test("runPython executes a script and captures stdout + exit code", async () => {
  await withTempDir(async (dir) => {
    const script = join(dir, "hello.py");
    writeFileSync(script, `import sys\nprint("hi", "there")\nsys.exit(0)\n`);
    const result = await runPython(script, []);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /hi there/);
    assert.equal(result.stderr, "");
  });
});

test("runPython captures stderr and non-zero exit", async () => {
  await withTempDir(async (dir) => {
    const script = join(dir, "fail.py");
    writeFileSync(script, `import sys\nprint("boom", file=sys.stderr)\nsys.exit(2)\n`);
    const result = await runPython(script, []);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /boom/);
  });
});

test("runPython forwards positional args to the script", async () => {
  await withTempDir(async (dir) => {
    const script = join(dir, "args.py");
    writeFileSync(script, `import sys\nprint(" ".join(sys.argv[1:]))\n`);
    const result = await runPython(script, ["foo", "bar baz"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /foo bar baz/);
  });
});

test("runPython forwards env vars (override) on top of process.env", async () => {
  await withTempDir(async (dir) => {
    const script = join(dir, "env.py");
    writeFileSync(script, `import os\nprint(os.environ.get("LANGFLOW_SERVER_URL", "UNSET"))\n`);
    const result = await runPython(script, [], { env: { LANGFLOW_SERVER_URL: "http://test:7860" } });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /http:\/\/test:7860/);
  });
});

test("runBash executes a .sh script and captures stdout + exit code", async () => {
  await withTempDir(async (dir) => {
    const script = join(dir, "say.sh");
    writeFileSync(script, "#!/usr/bin/env bash\necho \"hello from bash\"\nexit 0\n");
    chmodSync(script, 0o755);
    const result = await runBash(script, []);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /hello from bash/);
  });
});

test("runPython times out and returns exitCode 124 when script exceeds timeout", async () => {
  await withTempDir(async (dir) => {
    const script = join(dir, "slow.py");
    writeFileSync(script, "import time\ntime.sleep(5)\n");
    const result = await runPython(script, [], { timeoutMs: 200 });
    assert.equal(result.exitCode, 124, `expected 124 (timeout), got ${result.exitCode}`);
    assert.match(result.stderr, /timed out/i);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/loop24/tests/python-runtime.test.ts 2>&1 | tail -10
```

Expected: module-not-found error.

- [ ] **Step 3: Implement python-runtime.ts**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/tools/python-runtime.ts`:

```typescript
/**
 * Python runtime helper.
 *
 * One responsibility: spawn a bundled Python (or bash) script, capture stdout
 * and stderr, and return a structured result. All seven flow-builder tool
 * wrappers go through here so error surfaces (missing python3, timeouts,
 * non-zero exit) are consistent.
 *
 * Python is NOT bundled. We require python3 on PATH. If missing, every tool
 * call returns a clear, actionable error pointing the user at install docs.
 */

import { spawn } from "node:child_process";

export interface RunResult {
  exitCode: number;        // 124 if timed out (matches GNU coreutils convention)
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Extra env vars layered on top of process.env. */
  env?: Record<string, string | undefined>;
  /** Working directory for the spawned process. Defaults to process.cwd(). */
  cwd?: string;
  /** Hard timeout in milliseconds. Defaults to 120_000 (2 min). */
  timeoutMs?: number;
}

export type Python3Info =
  | { ok: true; binary: string; version: string }
  | { ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 120_000;
const PYTHON_BIN_ENV = "LOOP24_PYTHON_BIN";

/**
 * Resolve a usable python3 binary. Honors LOOP24_PYTHON_BIN override; falls
 * back to "python3" on PATH. Probes by running `--version`. Never throws.
 */
export async function ensurePython3(): Promise<Python3Info> {
  const binary = process.env[PYTHON_BIN_ENV]?.trim() || "python3";
  const probe = await spawnCapture(binary, ["--version"], {}, 5_000);
  if (probe.exitCode !== 0) {
    return {
      ok: false,
      error: `Could not run '${binary} --version' (exit ${probe.exitCode}). LOOP24 build-flow tools require Python 3. ` +
        `Install Python 3 (https://www.python.org/downloads/) and ensure 'python3' is on PATH, ` +
        `or set ${PYTHON_BIN_ENV} to a specific interpreter path.`,
    };
  }
  // Some Python builds print "Python 3.x.y" to stderr, others to stdout. Combine.
  const version = (probe.stdout + probe.stderr).trim();
  if (!/^Python 3\./.test(version)) {
    return { ok: false, error: `${binary} reported '${version}', expected Python 3.x` };
  }
  return { ok: true, binary, version };
}

/**
 * Run a Python script and capture its output. Resolves python3 each call —
 * the resolution is cheap and keeps tool calls stateless.
 */
export async function runPython(
  scriptPath: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const info = await ensurePython3();
  if (!info.ok) {
    return { exitCode: 127, stdout: "", stderr: info.error };
  }
  return spawnCapture(info.binary, [scriptPath, ...args], opts.env ?? {}, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.cwd);
}

/**
 * Run a bash script and capture its output. Used by validate_flow.sh.
 */
export async function runBash(
  scriptPath: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  return spawnCapture("bash", [scriptPath, ...args], opts.env ?? {}, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.cwd);
}

async function spawnCapture(
  cmd: string,
  args: string[],
  extraEnv: Record<string, string | undefined>,
  timeoutMs: number,
  cwd?: string,
): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") env[k] = v;
    }
    for (const [k, v] of Object.entries(extraEnv)) {
      if (typeof v === "string") env[k] = v;
    }
    let child;
    try {
      child = spawn(cmd, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({ exitCode: 127, stdout: "", stderr: `spawn failed: ${(err as Error).message}` });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, stdout, stderr: stderr + `\nspawn error: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ exitCode: 124, stdout, stderr: stderr + `\n[loop24] script timed out after ${timeoutMs}ms` });
      } else {
        resolve({ exitCode: code ?? 0, stdout, stderr });
      }
    });
  });
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/loop24/tests/python-runtime.test.ts 2>&1 | tail -10
```

Expected: 7/7 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/tools/python-runtime.ts \
        src/resources/extensions/loop24/tests/python-runtime.test.ts
git commit -m "feat(loop24): python-runtime helper for bundled flow-builder scripts

runPython(scriptPath, args, opts) and runBash(scriptPath, args, opts).
Honors LOOP24_PYTHON_BIN override, falls back to 'python3' on PATH.
ensurePython3() returns a clean error if python3 is missing — every
tool call surfaces this as exitCode 127 with an install-docs hint.
2-minute default timeout; exitCode 124 on timeout per coreutils convention.
TDD: 7 passing tests."
```

---

## Task 3: Extend langflow.ts with importFlow(payload) (TDD)

**Files:**
- Modify: `src/resources/extensions/loop24/clients/langflow.ts`
- Create: `src/resources/extensions/loop24/tests/langflow-import-flow.test.ts`

The user's design spec calls for a TS-side `importFlow(payload)` method that POSTs JSON to `/api/v1/flows/`. This is separate from the Python `import_flow.py` script (which uses `/api/v1/flows/upload/` multipart). Both ship — Python script via the typed tool wrapper, TS method as a programmable surface for future imperative commands.

- [ ] **Step 1: Write failing tests**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/tests/langflow-import-flow.test.ts`:

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

test("importFlow POSTs JSON to /api/v1/flows/ and returns parsed body", async () => {
  let receivedBody = "";
  let receivedMethod = "";
  let receivedUrl = "";
  let receivedContentType: string | undefined;
  await withMockServer(
    (req, res) => {
      receivedMethod = req.method ?? "";
      receivedUrl = req.url ?? "";
      receivedContentType = req.headers["content-type"] as string | undefined;
      req.on("data", (c) => (receivedBody += c.toString()));
      req.on("end", () => {
        res.statusCode = 201;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ id: "new-flow-uuid", name: "imported" }));
      });
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url });
      const payload = { name: "imported", description: "x", data: { nodes: [], edges: [] } };
      const result = await client.importFlow(payload);
      assert.equal(receivedMethod, "POST");
      assert.equal(receivedUrl, "/api/v1/flows/");
      assert.match(receivedContentType ?? "", /application\/json/);
      assert.deepEqual(JSON.parse(receivedBody), payload);
      assert.equal((result as { id: string }).id, "new-flow-uuid");
    },
  );
});

test("importFlow sends x-api-key when apiKey is configured", async () => {
  let receivedAuthHeader: string | undefined;
  await withMockServer(
    (req, res) => {
      receivedAuthHeader = req.headers["x-api-key"] as string | undefined;
      res.statusCode = 201;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "x" }));
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url, apiKey: "secret-key" });
      await client.importFlow({ name: "x", data: {} });
      assert.equal(receivedAuthHeader, "secret-key");
    },
  );
});

test("importFlow throws on 4xx with status and body in error message", async () => {
  await withMockServer(
    (_req, res) => {
      res.statusCode = 422;
      res.end(JSON.stringify({ detail: "validation error: nodes is required" }));
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url });
      await assert.rejects(
        () => client.importFlow({ bad: "payload" }),
        (err: Error) => err.message.includes("422") && err.message.includes("nodes is required"),
      );
    },
  );
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/loop24/tests/langflow-import-flow.test.ts 2>&1 | tail -8
```

Expected: FAIL — `client.importFlow is not a function`.

- [ ] **Step 3: Add importFlow to langflow.ts**

Edit `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/clients/langflow.ts`. After the existing `runFlow` method and BEFORE the `_fetch` private method, add:

```typescript
  /**
   * Import a flow into LangFlow by POSTing its JSON definition.
   * Endpoint: POST /api/v1/flows/  (JSON body — distinct from the
   * /api/v1/flows/upload/ multipart endpoint used by the bundled
   * import_flow.py script).
   *
   * Throws on non-2xx with status + response body in the error message.
   * Returns the parsed JSON response (typically the created flow record
   * with its newly-assigned id).
   */
  async importFlow(payload: unknown, timeoutMsOverride?: number): Promise<unknown> {
    const timeoutMs = timeoutMsOverride ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const res = await this._fetch(
      `${this.opts.baseUrl}/api/v1/flows/`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      timeoutMs,
    );
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`langflow import: ${res.status} ${res.statusText} — ${bodyText.slice(0, 500)}`);
    }
    try {
      return JSON.parse(bodyText);
    } catch {
      throw new Error(`langflow import: response was not JSON — ${bodyText.slice(0, 200)}`);
    }
  }
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/loop24/tests/langflow-client.test.ts \
  src/resources/extensions/loop24/tests/langflow-import-flow.test.ts 2>&1 | tail -10
```

Expected: 5 (existing) + 3 (new) = 8/8 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/clients/langflow.ts \
        src/resources/extensions/loop24/tests/langflow-import-flow.test.ts
git commit -m "feat(loop24): LangFlowClient.importFlow — POST JSON to /api/v1/flows/

Programmable TS surface for flow imports. Distinct from the bundled
import_flow.py script (which uses /api/v1/flows/upload/ multipart);
both ship — Python wrapper for the build-flow agent's tool use, TS
method for future imperative commands.

TDD: 3 passing tests against mock server."
```

---

## Task 4: Tool wrapper for refresh_catalog (template for the other six)

**Files:**
- Create: `src/resources/extensions/loop24/tools/refresh-catalog.ts`

This task establishes the wrapper pattern. Subsequent tools follow the same shape. Each tool gets its own file (consistency, easy to grep, easy to add params later).

- [ ] **Step 1: Inspect the existing TypeBox/ToolDefinition shape**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -n "ToolDefinition\b\|@sinclair/typebox" packages/pi-coding-agent/src/core/extensions/types.ts | head -5
sed -n '365,402p' packages/pi-coding-agent/src/core/extensions/types.ts
```

Note: `ToolDefinition.parameters` is a TypeBox `TSchema`. `execute()` receives `(toolCallId, params, signal, onUpdate, ctx)` and returns a `Promise<AgentToolResult<TDetails>>`. Look up `AgentToolResult` shape:

```bash
grep -A 20 "^export interface AgentToolResult\b\|^export type AgentToolResult\b" packages/pi-coding-agent/src/core/extensions/types.ts | head -40
```

(If the result type is complex, the simplest valid shape is usually `{ content: string }` or similar text. Match what other tools in the codebase return — grep for `registerTool\(` to find examples.)

- [ ] **Step 2: Create the refresh_catalog tool wrapper**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/tools/refresh-catalog.ts`:

```typescript
/**
 * loop24__refresh_catalog tool.
 *
 * Wraps the bundled refresh_component_catalog.py script. Pulls the current
 * LangFlow component catalog from a running LangFlow server and writes it
 * to catalog/components.raw.json in the workspace.
 *
 * Tool takes no arguments — the script reads LANGFLOW_SERVER_URL and
 * LANGFLOW_API_KEY from the environment, which loop24-config.ts has
 * already populated from ~/.loop24/config.json.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@gsd/pi-coding-agent";
import { runPython } from "./python-runtime.js";

const _here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(_here, "scripts", "refresh_component_catalog.py");

export const refreshCatalogTool: ToolDefinition = {
  name: "loop24__refresh_catalog",
  label: "Refresh LangFlow component catalog",
  description:
    "Pull the current LangFlow component catalog from the running LangFlow server " +
    "and cache it locally at catalog/components.raw.json. Run this before generating " +
    "any new flow when the catalog is missing or stale. Requires LangFlow to be reachable.",
  parameters: Type.Object({}),
  async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
    const result = await runPython(SCRIPT, [], { cwd: ctx.cwd });
    const ok = result.exitCode === 0;
    const text = ok
      ? `Catalog refreshed.\n\n${result.stdout}`
      : `Catalog refresh failed (exit ${result.exitCode}).\n\nSTDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}`;
    return { content: [{ type: "text", text }], isError: !ok };
  },
};
```

(If `AgentToolResult` differs from `{ content, isError }`, adjust to whatever shape matches existing tools in the codebase. Look at `packages/pi-coding-agent/src/core/tools/*` for examples.)

- [ ] **Step 3: Build to catch type errors**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | grep -E "(error|loop24)" | head -10 || echo "build clean"
```

Fix any type errors. The most likely issue is the `AgentToolResult` shape — adjust to match the codebase's existing return shape.

- [ ] **Step 4: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/tools/refresh-catalog.ts
git commit -m "feat(loop24): refresh_catalog tool wrapper

First of seven typed Pi tools that wrap bundled flow-builder Python
scripts. TypeBox parameter schema (empty here — script takes no args),
delegates execution to python-runtime.ts, returns combined stdout+stderr
in tool-result text.

Establishes the wrapper pattern; Task 5 ports the remaining six tools."
```

---

## Task 5: Port the remaining six tool wrappers

**Files:**
- Create: `src/resources/extensions/loop24/tools/normalize-catalog.ts`
- Create: `src/resources/extensions/loop24/tools/check-catalog-health.ts`
- Create: `src/resources/extensions/loop24/tools/inspect-component.ts`
- Create: `src/resources/extensions/loop24/tools/validate-flow.ts`
- Create: `src/resources/extensions/loop24/tools/import-flow.ts`
- Create: `src/resources/extensions/loop24/tools/smoke-test-flow.ts`

Each follows the Task 4 pattern. Differences: schemas vary by what positional args the script accepts.

- [ ] **Step 1: normalize-catalog.ts (no args)**

```typescript
/**
 * loop24__normalize_catalog tool.
 * Wraps normalize_component_catalog.py.
 * Normalizes catalog/components.raw.json into catalog/components.normalized.json.
 * Run after refresh_catalog.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@gsd/pi-coding-agent";
import { runPython } from "./python-runtime.js";

const _here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(_here, "scripts", "normalize_component_catalog.py");

export const normalizeCatalogTool: ToolDefinition = {
  name: "loop24__normalize_catalog",
  label: "Normalize LangFlow component catalog",
  description:
    "Normalize catalog/components.raw.json into a searchable catalog/components.normalized.json " +
    "plus a markdown index. Run after loop24__refresh_catalog. No arguments.",
  parameters: Type.Object({}),
  async execute(_id, _params, _signal, _onUpdate, ctx) {
    const r = await runPython(SCRIPT, [], { cwd: ctx.cwd });
    const ok = r.exitCode === 0;
    const text = ok
      ? `Catalog normalized.\n\n${r.stdout}`
      : `Normalize failed (exit ${r.exitCode}).\n\nSTDOUT:\n${r.stdout}\n\nSTDERR:\n${r.stderr}`;
    return { content: [{ type: "text", text }], isError: !ok };
  },
};
```

- [ ] **Step 2: check-catalog-health.ts (no args)**

```typescript
/**
 * loop24__check_catalog_health tool.
 * Wraps check_catalog_health.py.
 * Diagnoses missing/stale catalog and reports component coverage by category.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@gsd/pi-coding-agent";
import { runPython } from "./python-runtime.js";

const _here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(_here, "scripts", "check_catalog_health.py");

export const checkCatalogHealthTool: ToolDefinition = {
  name: "loop24__check_catalog_health",
  label: "Check LangFlow catalog health",
  description:
    "Report coverage of common LangFlow component categories (chat input, models, " +
    "embeddings, retrievers, vector stores, agents, tools, guardrails). " +
    "Use to diagnose whether the local catalog has what a planned flow needs.",
  parameters: Type.Object({}),
  async execute(_id, _params, _signal, _onUpdate, ctx) {
    const r = await runPython(SCRIPT, [], { cwd: ctx.cwd });
    const ok = r.exitCode === 0;
    const text = ok ? r.stdout : `Health check failed (exit ${r.exitCode}).\n\nSTDERR:\n${r.stderr}`;
    return { content: [{ type: "text", text }], isError: !ok };
  },
};
```

- [ ] **Step 3: inspect-component.ts (one arg: searchTerm)**

```typescript
/**
 * loop24__inspect_component tool.
 * Wraps inspect_component.py <search-term>.
 * Returns component details (fields, outputs, types) matching the search term.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@gsd/pi-coding-agent";
import { runPython } from "./python-runtime.js";

const _here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(_here, "scripts", "inspect_component.py");

const Params = Type.Object({
  searchTerm: Type.String({
    description: "Substring to match against component type, display name, category, fields, outputs (case-insensitive). e.g. 'chat', 'openai', 'qdrant'.",
    minLength: 1,
  }),
});

export const inspectComponentTool: ToolDefinition<typeof Params> = {
  name: "loop24__inspect_component",
  label: "Inspect LangFlow component",
  description:
    "Search the normalized component catalog and dump fields/outputs/types for matching " +
    "components. Use to discover exact field names and edge handle types before writing flow JSON.",
  parameters: Params,
  async execute(_id, params: Static<typeof Params>, _signal, _onUpdate, ctx) {
    const r = await runPython(SCRIPT, [params.searchTerm], { cwd: ctx.cwd });
    const ok = r.exitCode === 0;
    const text = ok
      ? r.stdout
      : r.exitCode === 2
        ? `No matches for "${params.searchTerm}".`
        : `Inspect failed (exit ${r.exitCode}).\n\nSTDERR:\n${r.stderr}`;
    return { content: [{ type: "text", text }], isError: !ok && r.exitCode !== 2 };
  },
};
```

- [ ] **Step 4: validate-flow.ts (one arg: flowFile, uses bash)**

```typescript
/**
 * loop24__validate_flow tool.
 * Wraps validate_flow.sh <flow-file>.
 * JSON syntax + Langflow schema validation (the latter requires lfx; degrades to JSON-only if absent).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@gsd/pi-coding-agent";
import { runBash } from "./python-runtime.js";

const _here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(_here, "scripts", "validate_flow.sh");

const Params = Type.Object({
  flowFile: Type.String({
    description: "Path to the flow JSON file to validate (typically flows/generated/<slug>.json). Relative to the workspace.",
    minLength: 1,
  }),
});

export const validateFlowTool: ToolDefinition<typeof Params> = {
  name: "loop24__validate_flow",
  label: "Validate LangFlow flow JSON",
  description:
    "Validate a flow JSON file. Always checks JSON syntax; if the lfx CLI is installed, " +
    "also runs LangFlow schema validation. Run after writing any flow JSON.",
  parameters: Params,
  async execute(_id, params: Static<typeof Params>, _signal, _onUpdate, ctx) {
    const r = await runBash(SCRIPT, [params.flowFile], { cwd: ctx.cwd });
    const ok = r.exitCode === 0;
    const text = ok
      ? `Validation OK.\n\n${r.stdout}${r.stderr ? `\n\nNotes:\n${r.stderr}` : ""}`
      : `Validation FAILED (exit ${r.exitCode}).\n\nSTDOUT:\n${r.stdout}\n\nSTDERR:\n${r.stderr}`;
    return { content: [{ type: "text", text }], isError: !ok };
  },
};
```

- [ ] **Step 5: import-flow.ts (one arg: flowFile)**

```typescript
/**
 * loop24__import_flow tool.
 * Wraps import_flow.py <flow-file>.
 * POSTs the flow file to the local LangFlow server (multipart, /api/v1/flows/upload/).
 * Should only be invoked when the user explicitly asks to import.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@gsd/pi-coding-agent";
import { runPython } from "./python-runtime.js";

const _here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(_here, "scripts", "import_flow.py");

const Params = Type.Object({
  flowFile: Type.String({
    description: "Path to the flow JSON file to import into LangFlow.",
    minLength: 1,
  }),
});

export const importFlowTool: ToolDefinition<typeof Params> = {
  name: "loop24__import_flow",
  label: "Import flow into LangFlow",
  description:
    "Upload a validated flow JSON file to the running LangFlow server. " +
    "Only invoke when the user explicitly asks to import. Requires LangFlow reachable.",
  parameters: Params,
  async execute(_id, params: Static<typeof Params>, _signal, _onUpdate, ctx) {
    const r = await runPython(SCRIPT, [params.flowFile], { cwd: ctx.cwd });
    const ok = r.exitCode === 0;
    const text = ok
      ? `Flow imported.\n\n${r.stdout}`
      : `Import failed (exit ${r.exitCode}).\n\nSTDOUT:\n${r.stdout}\n\nSTDERR:\n${r.stderr}`;
    return { content: [{ type: "text", text }], isError: !ok };
  },
};
```

- [ ] **Step 6: smoke-test-flow.ts (two args: flowId, message)**

```typescript
/**
 * loop24__smoke_test_flow tool.
 * Wraps smoke_test_flow.py <flow-id-or-name> <message>.
 * Runs a flow against a test input and returns the response.
 * Should only be invoked when the user explicitly asks to test.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@gsd/pi-coding-agent";
import { runPython } from "./python-runtime.js";

const _here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(_here, "scripts", "smoke_test_flow.py");

const Params = Type.Object({
  flowId: Type.String({
    description: "Flow id or endpoint name on the LangFlow server.",
    minLength: 1,
  }),
  message: Type.String({
    description: "Test input message to send through the flow.",
    minLength: 1,
  }),
});

export const smokeTestFlowTool: ToolDefinition<typeof Params> = {
  name: "loop24__smoke_test_flow",
  label: "Smoke test LangFlow flow",
  description:
    "Run a flow against a test message and return the response. " +
    "Only invoke when the user explicitly asks to test a flow.",
  parameters: Params,
  async execute(_id, params: Static<typeof Params>, _signal, _onUpdate, ctx) {
    const r = await runPython(SCRIPT, [params.flowId, params.message], { cwd: ctx.cwd, timeoutMs: 180_000 });
    const ok = r.exitCode === 0;
    const text = ok
      ? `Smoke test response:\n\n${r.stdout}`
      : `Smoke test failed (exit ${r.exitCode}).\n\nSTDOUT:\n${r.stdout}\n\nSTDERR:\n${r.stderr}`;
    return { content: [{ type: "text", text }], isError: !ok };
  },
};
```

- [ ] **Step 7: Build to catch type errors**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | grep -E "(error|loop24)" | head -20 || echo "build clean"
```

Fix any type errors. The wrappers are mechanical — most errors will be `AgentToolResult` shape mismatches; adjust to whatever the codebase expects.

- [ ] **Step 8: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/tools/normalize-catalog.ts \
        src/resources/extensions/loop24/tools/check-catalog-health.ts \
        src/resources/extensions/loop24/tools/inspect-component.ts \
        src/resources/extensions/loop24/tools/validate-flow.ts \
        src/resources/extensions/loop24/tools/import-flow.ts \
        src/resources/extensions/loop24/tools/smoke-test-flow.ts
git commit -m "feat(loop24): six remaining flow-builder tool wrappers

Same pattern as Task 4: TypeBox parameter schemas, shell out via
python-runtime.ts, combined stdout/stderr in tool-result text.

  - normalize_catalog (no args)
  - check_catalog_health (no args)
  - inspect_component (search term)
  - validate_flow (flow file path, bash)
  - import_flow (flow file path)
  - smoke_test_flow (flow id + message, 3-min timeout)"
```

---

## Task 6: Tools loader + register all 7 tools at extension load

**Files:**
- Create: `src/resources/extensions/loop24/tools/_loader.ts`
- Create: `src/resources/extensions/loop24/tests/tools-loader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/tests/tools-loader.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerLoop24Tools, LOOP24_TOOL_NAMES } from "../tools/_loader.js";

test("LOOP24_TOOL_NAMES enumerates all seven flow-builder tools", () => {
  assert.deepEqual([...LOOP24_TOOL_NAMES].sort(), [
    "loop24__check_catalog_health",
    "loop24__import_flow",
    "loop24__inspect_component",
    "loop24__normalize_catalog",
    "loop24__refresh_catalog",
    "loop24__smoke_test_flow",
    "loop24__validate_flow",
  ]);
});

test("registerLoop24Tools calls pi.registerTool seven times with the right names", () => {
  const registered: string[] = [];
  const fakePi = {
    registerTool: (tool: { name: string }) => { registered.push(tool.name); },
  };
  registerLoop24Tools(fakePi as unknown as Parameters<typeof registerLoop24Tools>[0]);
  assert.deepEqual(registered.sort(), [...LOOP24_TOOL_NAMES].sort());
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/loop24/tests/tools-loader.test.ts 2>&1 | tail -6
```

Expected: FAIL.

- [ ] **Step 3: Implement the loader**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/tools/_loader.ts`:

```typescript
/**
 * Tools loader.
 *
 * Registers the seven flow-builder tools with the Pi extension API. Called
 * from the loop24 extension's index.ts at extension load.
 *
 * Tools are always registered (not lazy), so the model can call them from any
 * conversation — not only inside /loop24 build-flow. This is intentional:
 * users may want to refresh the catalog from a normal chat, or have the
 * agent inspect a component while debugging an existing flow.
 */

import type { ExtensionAPI } from "@gsd/pi-coding-agent";
import { refreshCatalogTool } from "./refresh-catalog.js";
import { normalizeCatalogTool } from "./normalize-catalog.js";
import { checkCatalogHealthTool } from "./check-catalog-health.js";
import { inspectComponentTool } from "./inspect-component.js";
import { validateFlowTool } from "./validate-flow.js";
import { importFlowTool } from "./import-flow.js";
import { smokeTestFlowTool } from "./smoke-test-flow.js";

export const LOOP24_TOOL_NAMES = [
  "loop24__refresh_catalog",
  "loop24__normalize_catalog",
  "loop24__check_catalog_health",
  "loop24__inspect_component",
  "loop24__validate_flow",
  "loop24__import_flow",
  "loop24__smoke_test_flow",
] as const;

export function registerLoop24Tools(pi: ExtensionAPI): void {
  pi.registerTool(refreshCatalogTool);
  pi.registerTool(normalizeCatalogTool);
  pi.registerTool(checkCatalogHealthTool);
  pi.registerTool(inspectComponentTool);
  pi.registerTool(validateFlowTool);
  pi.registerTool(importFlowTool);
  pi.registerTool(smokeTestFlowTool);
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/loop24/tests/tools-loader.test.ts 2>&1 | tail -6
```

Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/tools/_loader.ts \
        src/resources/extensions/loop24/tests/tools-loader.test.ts
git commit -m "feat(loop24): tools loader — registers all 7 flow-builder tools

Exports LOOP24_TOOL_NAMES enumerating the registered names and
registerLoop24Tools(pi) for index.ts to call at extension load.
Tools are eagerly registered — available from any conversation,
not only inside /loop24 build-flow."
```

---

## Task 7: Repo scaffolding helper (TDD)

**Files:**
- Create: `src/resources/extensions/loop24/commands/build-flow/_scaffold.ts`
- Create: `src/resources/extensions/loop24/tests/build-flow-scaffold.test.ts`

`ensureRepoConventions(cwd)` creates the four directories the flow builder needs and patches `.gitignore`. Idempotent — safe to call every time `/loop24 build-flow` runs.

- [ ] **Step 1: Write failing tests**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/tests/build-flow-scaffold.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureRepoConventions } from "../commands/build-flow/_scaffold.js";

function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "loop24-scaffold-"));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("creates flows/{generated,templates,imported} and catalog/", async () => {
  await withTempDir(async (dir) => {
    const result = await ensureRepoConventions(dir);
    assert.ok(existsSync(join(dir, "flows/generated")));
    assert.ok(existsSync(join(dir, "flows/templates")));
    assert.ok(existsSync(join(dir, "flows/imported")));
    assert.ok(existsSync(join(dir, "catalog")));
    assert.ok(result.created.includes("flows/generated"));
  });
});

test("appends catalog cache entries to a fresh .gitignore", async () => {
  await withTempDir(async (dir) => {
    await ensureRepoConventions(dir);
    const gi = readFileSync(join(dir, ".gitignore"), "utf-8");
    assert.match(gi, /catalog\/components\.raw\.json/);
    assert.match(gi, /catalog\/components\.normalized\.json/);
    assert.match(gi, /catalog\/component-index\.md/);
  });
});

test("does not duplicate entries when .gitignore already contains them", async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\ncatalog/components.raw.json\n");
    await ensureRepoConventions(dir);
    const gi = readFileSync(join(dir, ".gitignore"), "utf-8");
    const occurrences = gi.split("catalog/components.raw.json").length - 1;
    assert.equal(occurrences, 1, "should keep just one entry");
  });
});

test("is idempotent — second call reports nothing newly created", async () => {
  await withTempDir(async (dir) => {
    await ensureRepoConventions(dir);
    const result2 = await ensureRepoConventions(dir);
    assert.deepEqual(result2.created, []);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/loop24/tests/build-flow-scaffold.test.ts 2>&1 | tail -5
```

- [ ] **Step 3: Implement the scaffold helper**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/commands/build-flow/_scaffold.ts`:

```typescript
/**
 * Repo conventions for /loop24 build-flow.
 *
 * Idempotent. Creates four directories under the workspace and patches
 * .gitignore to keep the (regenerable) catalog cache out of source control.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIRS = [
  "flows/generated",
  "flows/templates",
  "flows/imported",
  "catalog",
] as const;

const GITIGNORE_ENTRIES = [
  "# LOOP24 flow-builder catalog cache (regenerable)",
  "catalog/components.raw.json",
  "catalog/components.normalized.json",
  "catalog/component-index.md",
] as const;

export interface ScaffoldResult {
  created: string[];        // dirs newly created this call (relative to cwd)
  gitignoreUpdated: boolean;
}

export async function ensureRepoConventions(cwd: string): Promise<ScaffoldResult> {
  const created: string[] = [];
  for (const rel of DIRS) {
    const abs = join(cwd, rel);
    if (!existsSync(abs)) {
      mkdirSync(abs, { recursive: true });
      created.push(rel);
    }
  }

  const giPath = join(cwd, ".gitignore");
  const existing = existsSync(giPath) ? readFileSync(giPath, "utf-8") : "";
  const linesToAdd = GITIGNORE_ENTRIES.filter((line) => !existing.includes(line));
  let gitignoreUpdated = false;
  if (linesToAdd.length > 0) {
    const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    const block = (existing.length > 0 ? "\n" : "") + linesToAdd.join("\n") + "\n";
    writeFileSync(giPath, existing + sep + block);
    gitignoreUpdated = true;
  }

  return { created, gitignoreUpdated };
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/loop24/tests/build-flow-scaffold.test.ts 2>&1 | tail -6
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/commands/build-flow/_scaffold.ts \
        src/resources/extensions/loop24/tests/build-flow-scaffold.test.ts
git commit -m "feat(loop24): build-flow repo scaffolding helper

ensureRepoConventions(cwd) creates flows/{generated,templates,imported}
and catalog/ in the workspace; patches .gitignore to keep the catalog
cache (raw.json, normalized.json, component-index.md) out of source
control. Idempotent — safe to call every /loop24 build-flow invocation."
```

---

## Task 8: Reference-doc system context loader (TDD)

**Files:**
- Create: `src/resources/extensions/loop24/commands/build-flow/_system-context.ts`
- Create: `src/resources/extensions/loop24/tests/build-flow-system-context.test.ts`

`loadReferenceDocs()` reads the four bundled `reference/*.md` files and returns one concatenated string with file-header banners. Used by the build-flow command handler to prime the agent's turn.

- [ ] **Step 1: Write failing tests**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/tests/build-flow-system-context.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadReferenceDocs, REFERENCE_DOC_NAMES } from "../commands/build-flow/_system-context.js";

test("REFERENCE_DOC_NAMES lists the four expected files in load order", () => {
  assert.deepEqual([...REFERENCE_DOC_NAMES], [
    "workflow.md",
    "component-catalog-rules.md",
    "edge-handle-rules.md",
    "flow-json-rules.md",
  ]);
});

test("loadReferenceDocs concatenates all four docs with file-header banners", async () => {
  const text = await loadReferenceDocs();
  // Each doc should contribute a header banner naming the file.
  for (const name of REFERENCE_DOC_NAMES) {
    assert.ok(text.includes(name), `expected concatenated text to reference ${name}`);
  }
  // The full text is non-trivial in length (every doc is ~5-10KB).
  assert.ok(text.length > 10_000, `expected >10KB of context, got ${text.length} bytes`);
});

test("loadReferenceDocs throws a clear error when a doc is missing (path override)", async () => {
  await assert.rejects(
    () => loadReferenceDocs("/nonexistent/path/to/reference"),
    (err: Error) => /reference.*not found|ENOENT/i.test(err.message),
  );
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/loop24/tests/build-flow-system-context.test.ts 2>&1 | tail -5
```

- [ ] **Step 3: Implement the system-context loader**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/commands/build-flow/_system-context.ts`:

```typescript
/**
 * Reference-doc system-context loader.
 *
 * Reads the four bundled reference/*.md files and concatenates them into a
 * single string the build-flow command injects as the leading context for
 * the agent turn.
 *
 * The reference docs are verbatim copies from the upstream langflow-flow-builder
 * skill. Order matters: workflow.md first (establishes process), then the
 * rules docs (catalog → edges → JSON).
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const _here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REFERENCE_DIR = join(_here, "..", "..", "reference");

export const REFERENCE_DOC_NAMES = [
  "workflow.md",
  "component-catalog-rules.md",
  "edge-handle-rules.md",
  "flow-json-rules.md",
] as const;

export async function loadReferenceDocs(referenceDir: string = DEFAULT_REFERENCE_DIR): Promise<string> {
  const parts: string[] = [];
  for (const name of REFERENCE_DOC_NAMES) {
    const path = join(referenceDir, name);
    let body: string;
    try {
      body = await readFile(path, "utf-8");
    } catch (err) {
      throw new Error(`reference doc not found: ${path} (${(err as Error).message})`);
    }
    parts.push(`<!-- ──────── ${name} ──────── -->\n\n${body}`);
  }
  return parts.join("\n\n");
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/loop24/tests/build-flow-system-context.test.ts 2>&1 | tail -5
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/commands/build-flow/_system-context.ts \
        src/resources/extensions/loop24/tests/build-flow-system-context.test.ts
git commit -m "feat(loop24): build-flow reference-doc system context loader

loadReferenceDocs() reads workflow.md, component-catalog-rules.md,
edge-handle-rules.md, flow-json-rules.md from the bundled reference/
dir and returns one concatenated string with file-header banners.
Order matters: workflow first (establishes the process), then rules
(catalog → edges → JSON). Used by /loop24 build-flow to prime the
agent turn."
```

---

## Task 9: /loop24 build-flow slash command + wire everything into index.ts

**Files:**
- Create: `src/resources/extensions/loop24/commands/build-flow/command.ts`
- Modify: `src/resources/extensions/loop24/index.ts` — call `registerLoop24Tools(pi)` and `registerBuildFlowCommand(pi)`
- Modify: `src/resources/extensions/loop24/extension-manifest.json` — bump version + declare tools/commands

This is the user-facing surface. Handler flow:
1. If `args` is empty → emit usage hint, return.
2. `ensureRepoConventions(cwd)` — create dirs + patch .gitignore.
3. `loadReferenceDocs()` — get the system context.
4. `ctx.newSession({ workspaceRoot: cwd })` — fresh session for this task.
5. `pi.sendMessage({ customType: "loop24-build-flow", content: prompt, display: false }, { triggerTurn: true })` — drive an agent turn. `prompt` = system context + user description framed as the task.

- [ ] **Step 1: Inspect how workflow's commands assemble + dispatch prompts**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -n "sendMessage\b" src/resources/extensions/workflow/auto-direct-dispatch.ts | head -5
sed -n '290,315p' src/resources/extensions/workflow/auto-direct-dispatch.ts
```

Note the `customType` string and the `display: false` convention.

- [ ] **Step 2: Create the slash command**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/commands/build-flow/command.ts`:

```typescript
/**
 * /loop24 build-flow <description>
 *
 * Drives an agent turn that generates a LangFlow flow from natural language.
 * The agent gets:
 *   - Four reference docs as system context (workflow + 3 rule docs)
 *   - Seven typed tools (registered globally; see tools/_loader.ts) for
 *     catalog inspection, validation, import, smoke testing
 *   - Repo scaffolding (flows/{generated,templates,imported}, catalog/)
 *     so the agent has somewhere to write the result
 *
 * The handler does NOT run the LLM itself — it primes a fresh session and
 * dispatches via pi.sendMessage({triggerTurn:true}), the same seam
 * auto-direct-dispatch.ts uses.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@gsd/pi-coding-agent";
import { ensureRepoConventions } from "./_scaffold.js";
import { loadReferenceDocs } from "./_system-context.js";

const USAGE = `Usage: /loop24 build-flow <natural-language description of the flow>

Example:
  /loop24 build-flow "summarize a chunk of text using ollama"

The agent will inspect the LangFlow component catalog, design a flow,
validate the JSON, and write it under flows/generated/. Imports and
smoke tests only run when you explicitly ask.`;

export function registerBuildFlowCommand(pi: ExtensionAPI): void {
  pi.registerCommand("build-flow", {
    description: "Generate a LangFlow flow JSON from a natural-language description",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const description = args.trim();
      if (!description) {
        process.stderr.write(USAGE + "\n");
        return;
      }

      // Ensure repo conventions before anything else.
      let scaffoldNote = "";
      try {
        const result = await ensureRepoConventions(ctx.cwd);
        if (result.created.length > 0 || result.gitignoreUpdated) {
          const bits: string[] = [];
          if (result.created.length > 0) bits.push(`created ${result.created.join(", ")}`);
          if (result.gitignoreUpdated) bits.push("updated .gitignore");
          scaffoldNote = `[loop24 build-flow] ${bits.join("; ")}\n`;
          process.stderr.write(scaffoldNote);
        }
      } catch (err) {
        process.stderr.write(`[loop24 build-flow] scaffold failed: ${(err as Error).message}\n`);
        return;
      }

      // Load reference docs as system context.
      let referenceContext: string;
      try {
        referenceContext = await loadReferenceDocs();
      } catch (err) {
        process.stderr.write(`[loop24 build-flow] could not load reference docs: ${(err as Error).message}\n`);
        return;
      }

      // Compose the prompt: reference docs + repo conventions reminder + user task.
      const prompt = [
        "You are building a LangFlow flow JSON file from a natural-language description.",
        "Follow the rules in the reference material below verbatim.",
        "",
        "AVAILABLE TOOLS (use them — do NOT invent component names):",
        "  - loop24__refresh_catalog        (pull current LangFlow catalog)",
        "  - loop24__normalize_catalog      (normalize into searchable form)",
        "  - loop24__check_catalog_health   (diagnose missing categories)",
        "  - loop24__inspect_component      (look up fields/outputs for a component)",
        "  - loop24__validate_flow          (validate flow JSON before declaring success)",
        "  - loop24__import_flow            (ONLY on explicit user request)",
        "  - loop24__smoke_test_flow        (ONLY on explicit user request)",
        "",
        "REPO CONVENTIONS:",
        "  - Save generated flows under flows/generated/<slug>.json",
        "  - The component catalog lives in catalog/ (raw + normalized + index.md)",
        "  - Never put real secrets in flow JSON — use ${ENV_VAR} placeholders",
        "",
        "═══════════════════════════════════════════════════════════════════",
        "REFERENCE MATERIAL (read carefully before generating any JSON):",
        "═══════════════════════════════════════════════════════════════════",
        "",
        referenceContext,
        "",
        "═══════════════════════════════════════════════════════════════════",
        "USER REQUEST:",
        "═══════════════════════════════════════════════════════════════════",
        "",
        description,
      ].join("\n");

      // Fresh session for the build-flow task, then dispatch.
      const sessionResult = await ctx.newSession({ workspaceRoot: ctx.cwd });
      if (sessionResult.cancelled) {
        process.stderr.write(`[loop24 build-flow] session creation cancelled\n`);
        return;
      }
      pi.sendMessage(
        { customType: "loop24-build-flow", content: prompt, display: false },
        { triggerTurn: true },
      );
    },
  });
}
```

(If `ctx.cwd` is not the property name — check `ExtensionContext` in `packages/pi-coding-agent/src/core/extensions/types.ts:~280`. Most likely `ctx.workspaceRoot` or `ctx.cwd`. Adjust accordingly.)

- [ ] **Step 3: Wire registration into index.ts**

Edit `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/index.ts`. Add imports at the top:

```typescript
import { registerLoop24Tools } from "./tools/_loader.js";
import { registerBuildFlowCommand } from "./commands/build-flow/command.js";
```

In the default-exported `Loop24(pi)` function, AFTER the existing `session_start` handler registration and BEFORE the `loadFlowTriggers(...)` block, add:

```typescript
  // ── Register flow-builder tools (Phase 4) ──
  registerLoop24Tools(pi);

  // ── Register /loop24 build-flow slash command (Phase 4) ──
  registerBuildFlowCommand(pi);
```

- [ ] **Step 4: Update the extension manifest**

Edit `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/extension-manifest.json` to:

```json
{
  "id": "loop24",
  "name": "LOOP24",
  "version": "0.2.0",
  "description": "LOOP24-specific services — gateway probe, LangFlow flow triggers (Phase 3), LangFlow flow builder (Phase 4)",
  "tier": "core",
  "requires": { "platform": ">=2.29.0" },
  "provides": {
    "hooks": ["session_start"],
    "tools": [
      "loop24__refresh_catalog",
      "loop24__normalize_catalog",
      "loop24__check_catalog_health",
      "loop24__inspect_component",
      "loop24__validate_flow",
      "loop24__import_flow",
      "loop24__smoke_test_flow"
    ],
    "commands": ["build-flow"]
  }
}
```

- [ ] **Step 5: Build and run regression suite**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  packages/pi-coding-agent/src/config.test.ts \
  src/resources/extensions/workflow/tests/update-command.test.ts \
  src/resources/extensions/workflow/tests/extension-bootstrap-isolation.test.ts \
  src/resources/extensions/loop24/tests/langflow-client.test.ts \
  src/resources/extensions/loop24/tests/langflow-import-flow.test.ts \
  src/resources/extensions/loop24/tests/flow-trigger-schema.test.ts \
  src/resources/extensions/loop24/tests/flow-trigger-loader.test.ts \
  src/resources/extensions/loop24/tests/python-runtime.test.ts \
  src/resources/extensions/loop24/tests/tools-loader.test.ts \
  src/resources/extensions/loop24/tests/build-flow-scaffold.test.ts \
  src/resources/extensions/loop24/tests/build-flow-system-context.test.ts \
  2>&1 | tail -8
```

Expected: all pass.

- [ ] **Step 6: Smoke — verify build-flow is registered**

```bash
rm -rf ~/.loop24/agent
LOOP24_DEBUG_EXTENSIONS=1 loop24 --print "hi" 2>&1 | grep "loop24-debug" | grep -i "build-flow"
# Expected: a line confirming 'build-flow' command was registered.
```

If no line appears, check that `pkg/package.json`'s `piConfig` is up to date and that `rm -rf ~/.loop24/agent` actually cleared the stale extension cache.

- [ ] **Step 7: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/commands/build-flow/command.ts \
        src/resources/extensions/loop24/index.ts \
        src/resources/extensions/loop24/extension-manifest.json
git commit -m "feat(loop24): /loop24 build-flow slash command + tools registration

Wires the Phase 4 surface end-to-end:
  - registerLoop24Tools(pi) at extension load — all 7 tools available
  - registerBuildFlowCommand(pi) — /loop24 build-flow <description>
  - Handler scaffolds repo conventions, loads 4 reference docs as
    system context, opens a fresh session, dispatches an agent turn
    via pi.sendMessage({customType, triggerTurn:true}) — same seam
    auto-direct-dispatch.ts uses.

extension-manifest.json bumped to 0.2.0 and declares the seven tools
+ build-flow command in provides.tools and provides.commands."
```

---

## Task 10: Live end-to-end test against running LangFlow

**Files:** none (verification only)

The acceptance test from the user's brief:
> A real /loop24 build-flow "summarize a chunk of text" invocation generates a valid flow JSON in flows/generated/ (live test against the user's running LangFlow at http://localhost:7860)

- [ ] **Step 1: Confirm LangFlow is reachable**

```bash
curl -sf http://127.0.0.1:7860/api/v1/version | head -1
# Expected: {"version":"1.9.3", ...}
```

If LangFlow is offline, START IT before continuing. Phase 4's live test cannot proceed without it.

- [ ] **Step 2: Pick a clean test workspace**

```bash
TEST_WS=$(mktemp -d -t loop24-build-flow-test-XXXX)
cd "$TEST_WS"
echo "Testing in: $TEST_WS"
```

(A separate workspace keeps the loop24-client repo clean of generated flows/catalog files.)

- [ ] **Step 3: Run /loop24 build-flow against a real description**

```bash
cd "$TEST_WS"
loop24 --print "/loop24 build-flow summarize a chunk of text using ollama" 2>&1 | tee /tmp/loop24-build-flow-test.log
```

This is a multi-minute operation — the agent calls `refresh_catalog`, `normalize_catalog`, `inspect_component` (multiple times), then writes JSON, then `validate_flow`.

- [ ] **Step 4: Verify the artifact**

```bash
ls -la "$TEST_WS/flows/generated/" "$TEST_WS/catalog/"
# Expect: at least one *.json file under flows/generated/ and the catalog cache files under catalog/.

# Validate the JSON syntactically just to be sure:
python3 -m json.tool "$TEST_WS/flows/generated/"*.json | head -5
```

If a flow file exists and is valid JSON, the live test passes. If something failed mid-run, capture the failure in the commit message for Task 11 and decide whether to file follow-ups.

- [ ] **Step 5: Capture observations**

Note in scratchpad (for Task 11's LOOP24-PATCHES.md write-up):
- What flow was generated (filename + components used)?
- How long did it take end-to-end?
- Any unexpected error messages?
- Did all 7 tools get called as expected?
- Did the LLM provider behave OK with the long reference-doc context?

This task has no commit on its own — Task 11 captures the outcome.

---

## Task 11: LOOP24-PATCHES.md + tag phase-4-flow-builder

**Files:**
- Modify: `LOOP24-PATCHES.md`

- [ ] **Step 1: Append the Phase 4 section to LOOP24-PATCHES.md**

Add a new section between the existing Phase 3 section and the "Known Deferred Cleanups" section:

```markdown
## Phase 4 — LangFlow flow builder (tagged: phase-4-flow-builder)

### src/resources/extensions/loop24/tools/scripts/ (NEW — 7 files)
Verbatim copy from `~/Projects/repos/gitlab.rosetta.ericssondevops.com/loop_24/.claude/skills/langflow-flow-builder/scripts/`:
refresh_component_catalog.py, normalize_component_catalog.py,
check_catalog_health.py, inspect_component.py, validate_flow.sh,
import_flow.py, smoke_test_flow.py. Marked executable.

### src/resources/extensions/loop24/reference/ (NEW — 4 files)
Verbatim copy of workflow.md, component-catalog-rules.md,
edge-handle-rules.md, flow-json-rules.md from the same source skill.
Loaded as system context by /loop24 build-flow.

### src/resources/extensions/loop24/tools/python-runtime.ts (NEW)
runPython/runBash helpers. Resolves python3 (LOOP24_PYTHON_BIN
override → PATH). ensurePython3() returns a structured error if
missing. exitCode 124 on timeout (default 2 min). 7 TDD tests.

### src/resources/extensions/loop24/tools/{refresh,normalize,check}-*.ts + {inspect,validate,import,smoke}-*.ts (NEW — 7 files)
One TS file per tool. Each exports a ToolDefinition with TypeBox
parameter schema. Execute() shells out via python-runtime.ts and
returns combined stdout/stderr as tool-result text. No-arg tools use
Type.Object({}); arg tools declare typed params (search term, file
path, flow id+message).

### src/resources/extensions/loop24/tools/_loader.ts (NEW)
Exports LOOP24_TOOL_NAMES and registerLoop24Tools(pi). All 7 tools
registered eagerly at extension load — available from any conversation,
not only inside /loop24 build-flow. 2 TDD tests.

### src/resources/extensions/loop24/clients/langflow.ts (MODIFIED)
Added importFlow(payload, timeoutMsOverride?). POSTs JSON to
/api/v1/flows/. Reuses existing _fetch for auth + timeout. Distinct
from the bundled import_flow.py script which uses /api/v1/flows/upload/
multipart; both ship. 3 TDD tests against mock server.

### src/resources/extensions/loop24/commands/build-flow/_scaffold.ts (NEW)
ensureRepoConventions(cwd) creates flows/{generated,templates,imported}
and catalog/. Patches .gitignore to skip the regenerable catalog cache.
Idempotent. 4 TDD tests.

### src/resources/extensions/loop24/commands/build-flow/_system-context.ts (NEW)
loadReferenceDocs() reads the four bundled reference/*.md files and
concatenates them with file-header banners. Load order matters:
workflow first, then the rules docs. 3 TDD tests.

### src/resources/extensions/loop24/commands/build-flow/command.ts (NEW)
registerBuildFlowCommand(pi) — /loop24 build-flow <description>.
Handler: scaffold → load context → ctx.newSession() → pi.sendMessage(
{customType:"loop24-build-flow", display:false}, {triggerTurn:true}).
Same dispatch seam auto-direct-dispatch.ts uses.

### src/resources/extensions/loop24/index.ts (MODIFIED)
After Phase 1's session_start hook and BEFORE Phase 3's loadFlowTriggers,
added:
  - registerLoop24Tools(pi)
  - registerBuildFlowCommand(pi)

### src/resources/extensions/loop24/extension-manifest.json (MODIFIED)
Version bumped 0.1.0 → 0.2.0. provides.tools enumerates the seven
flow-builder tools; provides.commands declares ["build-flow"].

### Tests added
python-runtime (7), langflow-import-flow (3), tools-loader (2),
build-flow-scaffold (4), build-flow-system-context (3) = 19 new tests.

### Hard dependency: Python 3
The seven tool wrappers shell out to python3. If python3 is not on PATH,
each tool returns exitCode 127 with an install-docs hint. Override with
LOOP24_PYTHON_BIN if your interpreter is at a non-standard path.
Python is NOT bundled.

### New env var: LOOP24_PYTHON_BIN
Optional override for the python3 interpreter resolution.
```

(After running Task 10's live test, append a "Live verification" subsection capturing what flow was generated, how long it took, and any observations worth carrying forward.)

- [ ] **Step 2: Commit the patches doc**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add LOOP24-PATCHES.md
git commit -m "docs: LOOP24-PATCHES.md — Phase 4 flow builder"
```

- [ ] **Step 3: Tag the milestone**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git tag -a phase-4-flow-builder -m "Phase 4 complete: /loop24 build-flow ports the langflow-flow-builder skill. Seven typed Pi tools wrap bundled Python scripts (catalog refresh/normalize/inspect/health, flow validate/import/smoke). LangFlowClient.importFlow added. Reference docs bundled and loaded as system context. Repo scaffolding (flows/, catalog/, .gitignore). Requires python3 on PATH (LOOP24_PYTHON_BIN to override)."
git tag -l | tail -5
git log --oneline | head -16
```

---

## Definition of Done

Phase 4 is complete when ALL of these are true:

- `src/resources/extensions/loop24/tools/scripts/` contains the seven Python scripts verbatim from the source skill.
- `src/resources/extensions/loop24/reference/` contains the four reference docs verbatim.
- `python-runtime.ts` (TDD) resolves python3 and runs scripts; surfaces clean errors when python3 is missing or scripts time out.
- Seven `ToolDefinition`s registered via `pi.registerTool` with TypeBox parameter schemas. All shell out via python-runtime.ts.
- `LangFlowClient.importFlow(payload)` exists, POSTs JSON to `/api/v1/flows/`, throws on non-2xx with status + body.
- `/loop24 build-flow <description>` registered. Handler creates repo scaffolding, loads reference docs, dispatches an agent turn via `pi.sendMessage({triggerTurn:true})`.
- `extension-manifest.json` bumped to 0.2.0 and declares the seven tools + build-flow command.
- All Phase 0–3 regression tests still pass, plus Phase 4's 19 new tests.
- `LOOP24_DEBUG_EXTENSIONS=1 loop24 --print "hi" 2>&1 | grep "loop24-debug" | grep "build-flow"` confirms the new command is registered.
- A real `/loop24 build-flow "summarize a chunk of text"` invocation in a clean workspace generates a valid flow JSON under `flows/generated/`.
- `phase-4-flow-builder` git tag exists.
- LOOP24-PATCHES.md has a Phase 4 section.

---

## Self-Review

**Spec coverage (vs §6.2 of the design spec):**
- ✅ Slash command `/loop24 build-flow <description>` — Task 9
- ✅ Loads `reference/workflow.md` + the three rules docs as turn-zero system context — Task 8 + Task 9
- ✅ Seven typed Pi tools wrapping bundled Python scripts — Tasks 4–6
- ✅ JSON-schema parameter validation via TypeBox — Tasks 4 + 5
- ✅ Scripts bundled to `tools/scripts/` — Task 1
- ✅ Python 3 required, NOT bundled, fails clear when missing — Task 2 (`ensurePython3` + 127 exit)
- ✅ Repo conventions: `flows/{generated,templates,imported}`, `catalog/`, `.gitignore` patch — Task 7 + Task 9
- ✅ `importFlow` added to existing LangFlow client (NOT forked) — Task 3
- ✅ LOOP24-PATCHES.md Phase 4 section — Task 11
- ✅ `phase-4-flow-builder` tag — Task 11

**Placeholder scan:** No "TBD"/"TODO"/"implement later" inside step bodies. The reference-doc and Python-script copy steps reference exact source paths; the tool wrappers use the verified `ToolDefinition` shape from `packages/pi-coding-agent/src/core/extensions/types.ts:368`.

**Type consistency:**
- `RunResult`, `RunOptions`, `Python3Info` — defined Task 2, used in Tasks 4 + 5
- `ScaffoldResult.created` (array of relative dir paths) — defined Task 7, consumed Task 9
- `REFERENCE_DOC_NAMES` + `loadReferenceDocs()` signatures — defined Task 8, called Task 9
- `LOOP24_TOOL_NAMES` + `registerLoop24Tools(pi)` — defined Task 6, called Task 9
- `LangFlowClient.importFlow(payload, timeoutMsOverride?)` — added Task 3; this phase has no other caller, but it's available for future imperative commands

**Known risks the implementer should expect:**

1. **`AgentToolResult` shape** — Tasks 4 + 5 guess `{ content: [{type:"text", text}], isError }`. If the codebase's shape is different (probably `{ content: string }` or richer), adjust all seven tool wrappers to match. The build will catch this.

2. **`ExtensionCommandContext.cwd` vs `.workspaceRoot`** — Task 9 references `ctx.cwd`. Confirm the actual property name by reading `packages/pi-coding-agent/src/core/extensions/types.ts:~270` for `ExtensionContext`. If it's `ctx.workspaceRoot`, swap.

3. **Eager tool registration vs per-command registration** — the plan registers tools globally. If a regression test asserts that tool counts are exactly N, registering 7 new tools will break it. Run the full suite at Task 9 Step 5; expect to discover this if it bites.

4. **`pkg/package.json` piConfig drift** — if `loop24 build-flow` doesn't appear in autocomplete after a clean reinstall, the first thing to check is whether `pkg/package.json`'s piConfig is still aligned to `commandNamespace: "loop24"`. See LOOP24-PATCHES.md Known Deferred Cleanups item 3.

5. **Long context window for build-flow** — the four reference docs are ~30KB combined. Plus tool descriptions and the user's request. Most providers handle this fine, but if the user has a small model selected, the first turn may exceed limits. If observed, document in Task 11 and consider trimming workflow.md to its essentials in a follow-up.

---

*End of Phase 4 plan.*
