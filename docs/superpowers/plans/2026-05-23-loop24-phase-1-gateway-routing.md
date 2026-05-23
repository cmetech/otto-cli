# LOOP24 Phase 1 — Gateway Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All LLM traffic exits LOOP24 through a configurable gateway URL with a Bearer auth header. End-to-end verified against a local dev mock gateway that transparently proxies to Anthropic. When the real `loop24-gateway` Anthropic surface (`SURF-V2-01`) ships, the only change is the URL.

**Architecture:** Add a single branch at the top of `packages/pi-ai/src/providers/anthropic.ts`'s `resolveAnthropicProviderOptions()` function. When `LOOP24_GATEWAY_URL` is set in the environment, the provider returns gateway-shaped options: `baseURL` points at the gateway, `authToken` is `LOOP24_GATEWAY_TOKEN` (or null if unset), `apiKey` is null (skips `x-api-key` header — gateway handles upstream Anthropic auth). The existing per-provider beta-header and headers-merge logic is preserved. A small dev mock gateway lives at `scripts/dev-gateway/` for local testing.

**Tech Stack:** TypeScript, Node ≥22 (built-in fetch + http), Node's built-in test runner (`node --test --experimental-strip-types`), `@anthropic-ai/sdk` (unchanged — we only configure it differently), `brand.ts` for env-var-driven config.

**Scope boundary:**

In scope:
- Env-var-driven gateway config: `LOOP24_GATEWAY_URL`, `LOOP24_GATEWAY_TOKEN` (both optional — absent = direct-to-Anthropic, present = routed)
- A new branch in `resolveAnthropicProviderOptions()` that produces gateway-shaped SDK options when `LOOP24_GATEWAY_URL` is set
- Unit tests for the new branch (verify baseURL override, auth shape, header passthrough)
- A dev mock gateway under `scripts/dev-gateway/` — transparent HTTP proxy for `POST /v1/messages` to api.anthropic.com
- An integration test that spins up the mock, sets env vars, sends a small message, asserts round-trip
- Connection probe + `gateway: routed → <host> | direct` status emitted from the `loop24` extension's `session_start` hook
- Update `LOOP24-PATCHES.md` to document the anthropic.ts patch

Out of scope (deferred):
- Persistent `~/.loop24/config.json` storage for gateway URL/token (env-var only in Phase 1; the Phase 2b wizard adds the file persistence)
- Per-request gateway selection (e.g., route some models to the gateway, others direct) — single global config in Phase 1
- LangFlow integration (Phase 3)
- gsd-pi-extension-managed gateway provider registration (the simpler env-var override is sufficient for Phase 1)
- Migration of pre-existing model definitions that hardcode baseUrl (none currently do in our fork)

**Dependencies:**
- Requires the dev mock gateway running during integration tests. Production use against the real `loop24-gateway` is deferred until that team lands `SURF-V2-01`. Until then, `LOOP24_GATEWAY_URL` points at the local mock (or stays unset for direct-to-Anthropic).
- Requires Phase 0 + 0.5 complete (the `brand.ts` helper exists; LOOP24 branding is wired).

---

## Where the work happens

### File summary

| File | Action | Purpose |
|---|---|---|
| `packages/pi-ai/src/providers/anthropic.ts` | Modify (one new branch at top of `resolveAnthropicProviderOptions`) | Gateway-shaped SDK options when `LOOP24_GATEWAY_URL` is set |
| `packages/pi-ai/src/providers/anthropic.gateway.test.ts` | Create | Unit tests for the new branch |
| `scripts/dev-gateway/server.js` | Create | Local transparent proxy to api.anthropic.com |
| `scripts/dev-gateway/README.md` | Create | How to run the mock gateway, why it exists |
| `src/resources/extensions/loop24/index.ts` | Modify | Emit `gateway: routed → <host> \| direct` status line at session_start |
| `tests/integration/loop24-gateway.test.ts` | Create | End-to-end: mock gateway + LOOP24_GATEWAY_URL → message round-trips |
| `LOOP24-PATCHES.md` | Modify | Document the anthropic.ts patch + dev mock gateway script |

### Why we patch `anthropic.ts` directly

We could have added "loop24-gateway" as a registered Anthropic-compatible provider (matching the `usesAnthropicBearerAuth(provider)` pattern). That would require also updating model definitions, provider capability registries, and the provider router — much larger blast radius. The env-var branch at the top of `resolveAnthropicProviderOptions()` is smaller, locally reasoned-about, and reversible. We can promote to a proper provider registration later if it becomes worth it.

---

## Task 1: Add gateway-config exports to `brand.ts`

**Files:**
- Modify: `src/brand.ts`

The brand helper already reads piConfig at load. Extend it to also surface gateway config from environment variables. This gives us a single import site for code that needs to know about the gateway.

- [ ] **Step 1: Read brand.ts**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
cat src/brand.ts
```

Confirm current exports: `BRAND_NAME`, `COMMAND_NAMESPACE`, `CONFIG_DIR_NAME`, `BRAND_TAGLINE`.

- [ ] **Step 2: Add the gateway exports**

Append to `src/brand.ts`:
```typescript
/**
 * Optional gateway routing for LLM traffic. When LOOP24_GATEWAY_URL is set,
 * all Anthropic-SDK traffic is redirected to that URL with optional Bearer
 * auth. Both vars are read from the environment so they can be set per-shell
 * without persisting to the user's config dir.
 *
 * In Phase 1 these are env-var only. Phase 2b's first-run wizard adds
 * persistent storage under ~/.loop24/config.json.
 */
export const LOOP24_GATEWAY_URL: string | undefined = process.env.LOOP24_GATEWAY_URL?.trim() || undefined;
export const LOOP24_GATEWAY_TOKEN: string | undefined = process.env.LOOP24_GATEWAY_TOKEN?.trim() || undefined;
```

- [ ] **Step 3: Build + smoke**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | grep -E "(error|fail)" | head -3 || echo "build clean"
node dist/loader.js --version
```
Expected: builds clean, prints `1.0.1`.

- [ ] **Step 4: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/brand.ts
git commit -m "feat(brand): expose LOOP24_GATEWAY_URL + LOOP24_GATEWAY_TOKEN

Env-var-driven gateway config. Absent = direct-to-Anthropic (Phase 0
behavior); present = route through the gateway with optional Bearer
auth. Persistent config.json storage lands in Phase 2b's first-run
wizard — Phase 1 ships env-var-only on purpose."
```

---

## Task 2: Patch the Anthropic provider to honor `LOOP24_GATEWAY_URL`

**Files:**
- Modify: `packages/pi-ai/src/providers/anthropic.ts`

- [ ] **Step 1: Inspect the current `resolveAnthropicProviderOptions` function**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -n "^function resolveAnthropicProviderOptions\|^export function resolveAnthropicProviderOptions" packages/pi-ai/src/providers/anthropic.ts
sed -n '70,140p' packages/pi-ai/src/providers/anthropic.ts
```

Note the existing structure: `mergeHeaders()` helper, the `github-copilot` branch (which returns early with bearer-auth options), then the default branch that returns options with `usesBearerAuth` ternaries.

- [ ] **Step 2: Add the LOOP24 gateway branch at the top of the function**

Right BEFORE the `github-copilot` branch, insert:
```typescript
	// LOOP24 gateway routing: when LOOP24_GATEWAY_URL is set, all Anthropic
	// traffic flows through our local/internal gateway with Bearer auth.
	// The gateway handles upstream Anthropic auth, so we send no x-api-key.
	// Per Phase 1 design — env-var only, no persistent config yet.
	const loop24GatewayUrl = process.env.LOOP24_GATEWAY_URL?.trim();
	if (loop24GatewayUrl) {
		const loop24GatewayToken = process.env.LOOP24_GATEWAY_TOKEN?.trim();
		const betaFeatures: string[] = [];
		if (needsInterleavedBeta) {
			betaFeatures.push("interleaved-thinking-2025-05-14");
		}
		return {
			apiKey: null,
			authToken: loop24GatewayToken ?? apiKey,
			baseURL: loop24GatewayUrl,
			dangerouslyAllowBrowser: true,
			defaultHeaders: mergeHeaders(
				{
					accept: "application/json",
					"anthropic-dangerous-direct-browser-access": "true",
					...(betaFeatures.length > 0 ? { "anthropic-beta": betaFeatures.join(",") } : {}),
				},
				model.headers,
				optionsHeaders,
			),
		};
	}

	// Copilot: Bearer auth, selective betas (no fine-grained-tool-streaming)
	if (model.provider === "github-copilot") {
		// ... existing code unchanged ...
```

The branch returns early so all subsequent provider-specific logic is bypassed when the gateway is configured. The merged headers still include the model's per-model headers (for any model-specific overrides users care about). `apiKey: null + authToken: ...` sends Authorization: Bearer instead of x-api-key — same pattern the github-copilot branch uses.

If `LOOP24_GATEWAY_TOKEN` is unset but `LOOP24_GATEWAY_URL` is set, we fall back to using whatever `apiKey` the caller provided as the bearer credential. That handles the local-dev "no auth" case where the gateway accepts any token.

**Note on `optionsHeaders` and `dynamicHeaders` parameters:** Verify these names match the actual function signature in the file. The grep above showed `optionsHeaders` is one of the merge sources; `dynamicHeaders` appeared in the github-copilot branch. If your branch's signature is different, mirror exactly what the existing branches use.

- [ ] **Step 3: Build + verify nothing regressed**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | grep -E "(error|fail)" | head -3 || echo "build clean"
# Run the existing anthropic auth tests — they should still pass (we didn't change existing branches)
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  packages/pi-ai/src/providers/anthropic-auth.test.ts \
  packages/pi-ai/src/providers/anthropic-bearer-auth.test.ts \
  packages/pi-ai/src/providers/anthropic-shared.test.ts \
  2>&1 | tail -8
```
Expected: build clean, all existing tests pass.

- [ ] **Step 4: Smoke test the binary still launches**

```bash
node dist/loader.js --version
```
Expected: `1.0.1`.

- [ ] **Step 5: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add packages/pi-ai/src/providers/anthropic.ts
git commit -m "feat(pi-ai): route Anthropic traffic via LOOP24_GATEWAY_URL when set

Adds an env-var branch at the top of resolveAnthropicProviderOptions.
When LOOP24_GATEWAY_URL is configured:
- baseURL points at the gateway
- Bearer auth via LOOP24_GATEWAY_TOKEN (or apiKey as fallback)
- apiKey null — gateway handles upstream Anthropic auth
- Existing per-provider beta and headers logic bypassed by early return

Same SDK auth pattern github-copilot uses. Existing direct-to-Anthropic
behavior unchanged when LOOP24_GATEWAY_URL is unset."
```

---

## Task 3: TDD — unit tests for the gateway branch

**Files:**
- Create: `packages/pi-ai/src/providers/anthropic.gateway.test.ts`

- [ ] **Step 1: Read an existing test for the pattern**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
head -50 packages/pi-ai/src/providers/anthropic-bearer-auth.test.ts
```

Note how the test imports `resolveAnthropicProviderOptions` (or whatever helper it uses), how it constructs a fake `model` object, and how assertions are structured. **Mirror this style exactly** — don't reinvent.

- [ ] **Step 2: Write the test file**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/packages/pi-ai/src/providers/anthropic.gateway.test.ts`:
```typescript
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resolveAnthropicProviderOptions } from "./anthropic.js";
// ^ If the function isn't exported, you have two choices:
//   1. Export it from anthropic.ts (add `export` keyword to its declaration)
//   2. Move the test to live next to the function and use the unexposed binding
// Prefer option 1 — making the function exportable for tests is a low-cost change.

// Minimal Model object — adjust shape to match the actual Model<"anthropic-messages"> type.
// Look at anthropic-bearer-auth.test.ts for the canonical shape.
function makeModel(overrides: Partial<unknown> = {}): unknown {
  return {
    id: "claude-test",
    provider: "anthropic",
    api: "anthropic-messages",
    contextWindow: 200_000,
    pricing: { input: 0, output: 0 },
    capabilities: { toolUse: true, vision: false, thinking: false },
    ...(overrides as Record<string, unknown>),
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.LOOP24_GATEWAY_URL;
  delete process.env.LOOP24_GATEWAY_TOKEN;
  delete process.env.ANTHROPIC_BASE_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

test("returns direct-to-Anthropic options when LOOP24_GATEWAY_URL is unset", () => {
  const opts = resolveAnthropicProviderOptions(makeModel() as never, "test-api-key", false);
  // No gateway URL means we get the default branch — apiKey is set, baseURL is the Anthropic default (or model.baseUrl).
  assert.equal((opts as { apiKey: string | null }).apiKey, "test-api-key");
});

test("routes through gateway URL when LOOP24_GATEWAY_URL is set", () => {
  process.env.LOOP24_GATEWAY_URL = "http://127.0.0.1:7250";
  const opts = resolveAnthropicProviderOptions(makeModel() as never, "test-api-key", false) as {
    baseURL: string;
    apiKey: string | null;
    authToken: string | undefined;
  };
  assert.equal(opts.baseURL, "http://127.0.0.1:7250");
  assert.equal(opts.apiKey, null, "x-api-key must be null when gateway-routed");
});

test("uses LOOP24_GATEWAY_TOKEN as bearer credential when set", () => {
  process.env.LOOP24_GATEWAY_URL = "http://127.0.0.1:7250";
  process.env.LOOP24_GATEWAY_TOKEN = "gateway-secret-abc";
  const opts = resolveAnthropicProviderOptions(makeModel() as never, "anthropic-api-key", false) as {
    authToken: string | undefined;
    apiKey: string | null;
  };
  assert.equal(opts.authToken, "gateway-secret-abc");
  assert.equal(opts.apiKey, null);
});

test("falls back to apiKey as bearer credential when LOOP24_GATEWAY_TOKEN is unset", () => {
  process.env.LOOP24_GATEWAY_URL = "http://127.0.0.1:7250";
  const opts = resolveAnthropicProviderOptions(makeModel() as never, "fallback-key", false) as {
    authToken: string | undefined;
  };
  assert.equal(opts.authToken, "fallback-key");
});

test("preserves model.headers when gateway-routed", () => {
  process.env.LOOP24_GATEWAY_URL = "http://127.0.0.1:7250";
  const model = makeModel({
    headers: { "x-custom-trace": "trace-id-123" },
  });
  const opts = resolveAnthropicProviderOptions(model as never, "key", false) as {
    defaultHeaders: Record<string, string>;
  };
  assert.equal(opts.defaultHeaders["x-custom-trace"], "trace-id-123");
});

test("LOOP24_GATEWAY_URL with only whitespace is treated as unset", () => {
  process.env.LOOP24_GATEWAY_URL = "   ";
  const opts = resolveAnthropicProviderOptions(makeModel() as never, "key", false) as { apiKey: string | null };
  // Whitespace-only should NOT route through gateway — apiKey should remain set.
  assert.equal(opts.apiKey, "key");
});
```

If the function signature in anthropic.ts uses additional positional args (e.g., `interleavedThinking`, `optionsHeaders`), pass appropriate defaults — look at the existing test files for the canonical call shape.

- [ ] **Step 3: Run the tests, verify the new ones pass**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | grep -E "(error|fail)" | head -3 || echo "build clean"
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/pi-ai/src/providers/anthropic.gateway.test.ts 2>&1 | tail -10
```
Expected: 6/6 pass.

If `resolveAnthropicProviderOptions` is NOT exported, you'll get a compile error. Export it:
```bash
# Find its declaration and add `export` if missing
grep -n "function resolveAnthropicProviderOptions" packages/pi-ai/src/providers/anthropic.ts
```
Edit to add `export` to the declaration. Re-run tests.

- [ ] **Step 4: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add packages/pi-ai/src/providers/anthropic.gateway.test.ts packages/pi-ai/src/providers/anthropic.ts
git commit -m "test(pi-ai): unit tests for LOOP24 gateway branch

Six tests covering: direct-to-Anthropic when unset, gateway URL routing,
LOOP24_GATEWAY_TOKEN bearer credential, apiKey fallback when token unset,
model.headers passthrough, whitespace-only URL treated as unset.

If resolveAnthropicProviderOptions wasn't already exported, this commit
also exports it so the test can import it directly."
```

---

## Task 4: Dev mock gateway

**Files:**
- Create: `scripts/dev-gateway/server.js`
- Create: `scripts/dev-gateway/README.md`

A tiny Node http server that transparently forwards `POST /v1/messages` to api.anthropic.com. Lets us validate the LOOP24 → gateway → Anthropic path on a single laptop without needing the real `loop24-gateway`. Strips its own `Authorization: Bearer ...` header (treats it as the gateway-side credential) and adds the real `x-api-key` from `ANTHROPIC_API_KEY` env var when forwarding.

- [ ] **Step 1: Write the server**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/scripts/dev-gateway/server.js`:
```javascript
#!/usr/bin/env node
/**
 * LOOP24 dev mock gateway.
 *
 * Transparent proxy: POST /v1/messages → https://api.anthropic.com/v1/messages
 *
 * Strips any incoming Authorization header (treats it as the gateway-side
 * credential — gateway accepts everything for local dev) and injects
 * x-api-key from ANTHROPIC_API_KEY when forwarding upstream.
 *
 * Stand-in for the real loop24-gateway's Anthropic surface (SURF-V2-01)
 * until the gateway team ships it. NOT for production use.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/dev-gateway/server.js
 *   # then in another shell:
 *   LOOP24_GATEWAY_URL=http://127.0.0.1:7250 loop24
 */

import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";

const PORT = Number(process.env.LOOP24_DEV_GATEWAY_PORT || 7250);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
	console.error("error: ANTHROPIC_API_KEY must be set so the mock gateway can forward upstream.");
	process.exit(1);
}

const UPSTREAM_HOST = "api.anthropic.com";

function logRequest(req, status) {
	const ts = new Date().toISOString();
	console.log(`[${ts}] ${req.method} ${req.url} → ${status}`);
}

const server = createServer((clientReq, clientRes) => {
	// Health probe for the LOOP24 connection-state check
	if (clientReq.method === "GET" && clientReq.url === "/health") {
		clientRes.statusCode = 200;
		clientRes.setHeader("content-type", "application/json");
		clientRes.end(JSON.stringify({ status: "ok", upstream: UPSTREAM_HOST }));
		logRequest(clientReq, 200);
		return;
	}

	if (clientReq.method !== "POST" || !clientReq.url?.startsWith("/v1/")) {
		clientRes.statusCode = 404;
		clientRes.end(JSON.stringify({ error: "not_found", path: clientReq.url }));
		logRequest(clientReq, 404);
		return;
	}

	// Build forward headers: strip Authorization, inject x-api-key + anthropic-version
	const forwardHeaders = { ...clientReq.headers };
	delete forwardHeaders.authorization;
	delete forwardHeaders.Authorization;
	delete forwardHeaders.host;
	forwardHeaders["x-api-key"] = ANTHROPIC_API_KEY;
	forwardHeaders["anthropic-version"] = forwardHeaders["anthropic-version"] || "2023-06-01";

	const upstreamReq = httpsRequest({
		hostname: UPSTREAM_HOST,
		port: 443,
		path: clientReq.url,
		method: clientReq.method,
		headers: forwardHeaders,
	}, (upstreamRes) => {
		clientRes.statusCode = upstreamRes.statusCode || 502;
		for (const [k, v] of Object.entries(upstreamRes.headers)) {
			if (v !== undefined) clientRes.setHeader(k, v);
		}
		upstreamRes.pipe(clientRes);
		logRequest(clientReq, upstreamRes.statusCode);
	});

	upstreamReq.on("error", (err) => {
		clientRes.statusCode = 502;
		clientRes.setHeader("content-type", "application/json");
		clientRes.end(JSON.stringify({ error: "upstream_error", message: String(err) }));
		logRequest(clientReq, 502);
	});

	clientReq.pipe(upstreamReq);
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`[loop24-dev-gateway] listening on http://127.0.0.1:${PORT}`);
	console.log(`[loop24-dev-gateway] forwarding to https://${UPSTREAM_HOST}`);
});
```

- [ ] **Step 2: Write the README**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/scripts/dev-gateway/README.md`:
```markdown
# LOOP24 dev mock gateway

A transparent HTTP proxy that forwards `POST /v1/messages` to
`https://api.anthropic.com/v1/messages`. Stand-in for the real
`loop24-gateway`'s Anthropic surface (`SURF-V2-01`) until that team
ships it.

## Why this exists

LOOP24's Phase 1 (gateway routing) needs SOMETHING to point at to
validate the end-to-end client-side wiring. The real `loop24-gateway`
is pre-implementation; this mock unblocks LOOP24 development without
waiting on it.

## Usage

```bash
# Terminal 1: start the mock gateway
export ANTHROPIC_API_KEY=sk-ant-...        # required — upstream auth
node scripts/dev-gateway/server.js
# → listens on http://127.0.0.1:7250 by default
# → port override via LOOP24_DEV_GATEWAY_PORT

# Terminal 2: run loop24 routed through the mock
export LOOP24_GATEWAY_URL=http://127.0.0.1:7250
export LOOP24_GATEWAY_TOKEN=anything       # optional; mock accepts any value
loop24
```

When you launch `loop24`, the banner status line should read
`gateway: routed → 127.0.0.1:7250`. Any messages you send route
through the mock, which forwards them to Anthropic with your real
`ANTHROPIC_API_KEY`.

## What it does NOT do

- No compliance logging / redaction — that's the real gateway's job
- No rate limiting / quota
- No request/response transformation beyond Authorization stripping
- No persistence — restarts are stateless

When the real gateway lands, swap `LOOP24_GATEWAY_URL` to point at it
and stop using this script.
```

- [ ] **Step 3: Verify the mock runs**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
chmod +x scripts/dev-gateway/server.js

# Start in background for a quick health check
ANTHROPIC_API_KEY="dummy-for-health-check" perl -e 'alarm 4; exec @ARGV' node scripts/dev-gateway/server.js &
sleep 1
curl -sf http://127.0.0.1:7250/health | head -3 && echo "OK: health responds"
wait 2>/dev/null
```
Expected: `OK: health responds` plus the `/health` JSON body.

- [ ] **Step 4: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add scripts/dev-gateway/
git commit -m "feat(dev-gateway): transparent HTTP proxy stand-in

Lets Phase 1 validate end-to-end gateway routing without waiting on
the real loop24-gateway's Anthropic surface (SURF-V2-01). Strips client
Authorization, injects x-api-key from ANTHROPIC_API_KEY, forwards
upstream. /health endpoint for the LOOP24 connection probe.

NOT for production. Replaced by the real gateway when SURF-V2-01
ships — change LOOP24_GATEWAY_URL and stop running this."
```

---

## Task 5: Integration test against the dev mock

**Files:**
- Create: `tests/integration/loop24-gateway.test.ts`

This validates the end-to-end path: env vars → patched anthropic.ts → SDK constructs gateway-shaped client → request hits the mock → mock forwards to Anthropic → response round-trips. Without a real Anthropic round-trip we'd be testing-via-mock-of-our-own-mock. Use a SECOND inline mock for the upstream so the test runs offline and deterministically.

- [ ] **Step 1: Write the test**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/tests/integration/loop24-gateway.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";

/**
 * End-to-end check: simulate the LOOP24 dev gateway in front of a fake
 * Anthropic upstream. Verify that when LOOP24_GATEWAY_URL is set, our
 * patched Anthropic provider produces SDK options whose baseURL targets
 * the gateway and whose auth header is bearer-style.
 *
 * We don't actually instantiate the @anthropic-ai/sdk client here — that
 * would require pulling in the real SDK and stubbing fetch. Instead we
 * verify the OPTIONS shape (the data contract between our provider and
 * the SDK) and separately verify the dev mock gateway forwards as expected.
 */

import { resolveAnthropicProviderOptions } from "../../packages/pi-ai/src/providers/anthropic.js";

function makeModel(): unknown {
  return {
    id: "claude-3-5-sonnet-test",
    provider: "anthropic",
    api: "anthropic-messages",
    contextWindow: 200_000,
    pricing: { input: 0, output: 0 },
    capabilities: { toolUse: true, vision: false, thinking: false },
  };
}

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  fn: (url: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => res.end());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  try {
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("gateway routing options round-trip end-to-end (mock gateway hit)", async () => {
  // Stand up a tiny mock gateway that captures the incoming auth header
  // and returns a canned Anthropic-shape response.
  let receivedAuth: string | undefined;
  let receivedApiKey: string | undefined;
  let receivedBody = "";

  await withServer(
    (req, res) => {
      receivedAuth = req.headers["authorization"] as string | undefined;
      receivedApiKey = req.headers["x-api-key"] as string | undefined;
      req.on("data", (c) => (receivedBody += c.toString()));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "pong" }],
          model: "claude-3-5-sonnet-test",
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }));
      });
    },
    async (gatewayUrl) => {
      process.env.LOOP24_GATEWAY_URL = gatewayUrl;
      process.env.LOOP24_GATEWAY_TOKEN = "test-bearer-token";
      try {
        const opts = resolveAnthropicProviderOptions(makeModel() as never, "ignored-apikey", false) as {
          baseURL: string;
          apiKey: string | null;
          authToken: string | undefined;
        };

        // Verify the provider produced gateway-shaped options
        assert.equal(opts.baseURL, gatewayUrl);
        assert.equal(opts.apiKey, null, "x-api-key must NOT be sent when gateway-routed");
        assert.equal(opts.authToken, "test-bearer-token");

        // Send a request using fetch directly, mirroring what the SDK would do
        const res = await fetch(`${gatewayUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${opts.authToken}`,
          },
          body: JSON.stringify({ model: "claude-3-5-sonnet-test", max_tokens: 10, messages: [{ role: "user", content: "ping" }] }),
        });
        const body = (await res.json()) as { content: { text: string }[] };

        assert.equal(receivedAuth, "Bearer test-bearer-token", "gateway received our bearer token");
        assert.equal(receivedApiKey, undefined, "gateway did NOT receive an x-api-key from us");
        assert.equal(body.content[0]?.text, "pong");
        assert.ok(receivedBody.includes("ping"), "request body forwarded with our message");
      } finally {
        delete process.env.LOOP24_GATEWAY_URL;
        delete process.env.LOOP24_GATEWAY_TOKEN;
      }
    },
  );
});

test("absence of LOOP24_GATEWAY_URL keeps the direct-to-Anthropic path", () => {
  delete process.env.LOOP24_GATEWAY_URL;
  delete process.env.LOOP24_GATEWAY_TOKEN;
  const opts = resolveAnthropicProviderOptions(makeModel() as never, "real-apikey", false) as { apiKey: string | null };
  assert.equal(opts.apiKey, "real-apikey", "apiKey is set when no gateway configured");
});
```

- [ ] **Step 2: Run the integration test**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test tests/integration/loop24-gateway.test.ts 2>&1 | tail -8
```
Expected: 2/2 pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add tests/integration/loop24-gateway.test.ts
git commit -m "test(integration): end-to-end gateway routing against in-process mock

Verifies: setting LOOP24_GATEWAY_URL + LOOP24_GATEWAY_TOKEN produces
SDK options whose baseURL targets the gateway, whose Authorization
header carries our bearer token, and whose x-api-key is absent.

Uses an in-process mock for both the gateway and Anthropic so the
test is offline-deterministic and doesn't require ANTHROPIC_API_KEY."
```

---

## Task 6: Connection probe + banner status

**Files:**
- Modify: `src/resources/extensions/loop24/index.ts`

The `loop24` extension was scaffolded in Phase 3 Task 1 (or will be — check sequencing). If Phase 3 hasn't started yet, the extension's `index.ts` doesn't exist. **Check first:** does `src/resources/extensions/loop24/index.ts` exist?

If yes: extend the existing `session_start` hook with a gateway probe.

If no: this task creates the minimal `index.ts` + manifest (a subset of Phase 3 Task 1). Phase 3 Task 1 will then extend it further when it runs.

- [ ] **Step 1: Check current state**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
[ -f src/resources/extensions/loop24/index.ts ] && echo "EXTENSION EXISTS — extend it" || echo "EXTENSION MISSING — create minimal scaffold"
ls src/resources/extensions/loop24/
```

- [ ] **Step 2a (if extension exists): extend session_start with gateway probe**

Add to the existing `session_start` hook:
```typescript
// Gateway connection probe — fires after the loader banner
const yellow = '\x1b[38;2;250;210;45m';
const green  = '\x1b[38;2;63;206;142m';
const dim    = '\x1b[2m';
const reset  = '\x1b[0m';

const gwUrl = process.env.LOOP24_GATEWAY_URL?.trim();
if (gwUrl) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`${gwUrl.replace(/\/$/, "")}/health`, { signal: ctl.signal });
    clearTimeout(timer);
    const ok = r.ok;
    const host = new URL(gwUrl).host;
    process.stderr.write(`  ${yellow}gateway:${reset} ${ok ? green : dim}routed → ${host}${reset}\n`);
  } catch {
    const host = new URL(gwUrl).host;
    process.stderr.write(`  ${yellow}gateway:${reset} ${dim}routed → ${host} (unreachable)${reset}\n`);
  }
} else {
  process.stderr.write(`  ${yellow}gateway:${reset} ${dim}direct (no LOOP24_GATEWAY_URL set)${reset}\n`);
}
```

- [ ] **Step 2b (if extension missing): create minimal scaffold**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/extension-manifest.json` (mirror Phase 3 Task 1's content — see that plan). Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/index.ts`:
```typescript
import type { ExtensionAPI } from "@gsd/pi-coding-agent";

export default function Loop24(pi: ExtensionAPI): void {
  pi.on("session_start", async () => {
    const yellow = '\x1b[38;2;250;210;45m';
    const green  = '\x1b[38;2;63;206;142m';
    const dim    = '\x1b[2m';
    const reset  = '\x1b[0m';

    const gwUrl = process.env.LOOP24_GATEWAY_URL?.trim();
    if (gwUrl) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 1500);
        const r = await fetch(`${gwUrl.replace(/\/$/, "")}/health`, { signal: ctl.signal });
        clearTimeout(timer);
        const ok = r.ok;
        const host = new URL(gwUrl).host;
        process.stderr.write(`  ${yellow}gateway:${reset} ${ok ? green : dim}routed → ${host}${reset}\n`);
      } catch {
        const host = new URL(gwUrl).host;
        process.stderr.write(`  ${yellow}gateway:${reset} ${dim}routed → ${host} (unreachable)${reset}\n`);
      }
    } else {
      process.stderr.write(`  ${yellow}gateway:${reset} ${dim}direct (no LOOP24_GATEWAY_URL set)${reset}\n`);
    }
  });
}
```

- [ ] **Step 3: Build + verify status line appears**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
rm -rf ~/.loop24
perl -e 'alarm 8; exec @ARGV' loop24 --print "hi" 2>&1 | grep -i "gateway:" | head -3
```
Expected: a line like `gateway: direct (no LOOP24_GATEWAY_URL set)` (or `routed → host` if you set the env var first).

- [ ] **Step 4: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/
git commit -m "feat(loop24): session_start probe surfaces gateway status

Emits 'gateway: routed → <host>' or 'gateway: direct' after the loader
banner. 1500ms probe timeout — never blocks startup. Reads
LOOP24_GATEWAY_URL from env; reports 'unreachable' if /health probe
fails but URL is set."
```

---

## Task 7: End-to-end smoke against the live dev mock + tag

**Files:** none (verification + tag + docs)

- [ ] **Step 1: Live smoke against the dev mock**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
# Terminal flow — run these in sequence
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" perl -e 'alarm 30; exec @ARGV' node scripts/dev-gateway/server.js &
GW_PID=$!
sleep 1
LOOP24_GATEWAY_URL=http://127.0.0.1:7250 LOOP24_GATEWAY_TOKEN=test perl -e 'alarm 15; exec @ARGV' loop24 --print "say one word, no more" 2>/tmp/gw-stderr.txt >/tmp/gw-stdout.txt
echo "--- stderr (banner + status) ---"
cat /tmp/gw-stderr.txt
echo "--- stdout (model response — should be a single word) ---"
cat /tmp/gw-stdout.txt
kill $GW_PID 2>/dev/null
wait 2>/dev/null
```
Expected:
- stderr shows the LOOP24 banner and `gateway: routed → 127.0.0.1:7250`
- stdout has a one-word model response (proving the round-trip worked through the mock to Anthropic and back)
- The mock gateway's own stdout (in the background terminal) logged a `POST /v1/messages → 200` line

If `ANTHROPIC_API_KEY` isn't set, the mock will refuse to start — that's expected and the test is skipped.

- [ ] **Step 2: Regression suite — all earlier tests still pass**

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
  tests/integration/loop24-gateway.test.ts \
  2>&1 | tail -8
```
Expected: all pass.

- [ ] **Step 3: Update LOOP24-PATCHES.md**

Add a "Phase 1 — Gateway routing" section documenting:
- `brand.ts` exports: `LOOP24_GATEWAY_URL`, `LOOP24_GATEWAY_TOKEN`
- `anthropic.ts` patch: new branch at top of `resolveAnthropicProviderOptions` for gateway routing
- `anthropic.gateway.test.ts`: 6 unit tests
- `tests/integration/loop24-gateway.test.ts`: 2 integration tests
- `scripts/dev-gateway/`: transparent proxy + README
- `loop24` extension's `session_start` hook surfaces gateway status

- [ ] **Step 4: Tag**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add LOOP24-PATCHES.md
git commit -m "docs: LOOP24-PATCHES.md — Phase 1 gateway routing"
git tag -a phase-1-gateway-routing -m "Phase 1 complete: LOOP24 routes Anthropic traffic via LOOP24_GATEWAY_URL with optional Bearer auth. Dev mock gateway under scripts/dev-gateway/. Real loop24-gateway Anthropic surface (SURF-V2-01) not required for the wiring to work — point LOOP24_GATEWAY_URL at it when ready."
git tag -l
git log --oneline | head -10
```

---

## Definition of Done

Phase 1 is complete when ALL of these are true:

- `brand.ts` exports `LOOP24_GATEWAY_URL` and `LOOP24_GATEWAY_TOKEN`.
- `packages/pi-ai/src/providers/anthropic.ts` has a new top-of-function branch that returns gateway-shaped options when `LOOP24_GATEWAY_URL` is set.
- 6 unit tests in `anthropic.gateway.test.ts` pass.
- 2 integration tests in `tests/integration/loop24-gateway.test.ts` pass.
- `scripts/dev-gateway/server.js` runs and forwards `/v1/messages` to `api.anthropic.com`, returns 200 on `/health`.
- The `loop24` extension's `session_start` hook emits `gateway: routed → <host>` or `gateway: direct` after the loader banner.
- Live smoke (when `ANTHROPIC_API_KEY` is set): with the dev mock running and `LOOP24_GATEWAY_URL` pointed at it, `loop24 --print "..."` round-trips successfully.
- All Phase 0 / 0.5 regression tests still pass.
- `phase-1-gateway-routing` git tag exists.
- `LOOP24-PATCHES.md` updated.

---

## Self-Review (for plan author)

**Spec coverage** (vs design spec §2 Architecture, §7 Auth):
- ✅ "All LLM traffic exits through `packages/pi-ai/src/stream.ts`" — patch is upstream of stream.ts via the provider options
- ✅ "Pointing it at the gateway = configuration" — Tasks 1+2 satisfy
- ✅ "Both token and apiKey are nullable" — Task 2's branch handles unset token by falling back to apiKey as bearer credential, and a present LOOP24_GATEWAY_URL with unset token still routes (no compile-time auth requirement)
- ✅ "Custom Authorization: Bearer header" — Task 2 sets authToken which SDK sends as Authorization: Bearer
- ⏳ "first-run wizard" — explicitly deferred to Phase 2b

**Placeholder scan:** no TBD / TODO. Step 2 of Task 2 has an explicit note about verifying parameter names match the actual function signature — that's a concrete instruction, not a placeholder.

**Type consistency:** `LOOP24_GATEWAY_URL`, `LOOP24_GATEWAY_TOKEN` used identically across all tasks. `resolveAnthropicProviderOptions` referenced consistently. Test names follow the same shape across the unit and integration suites.

**Scope check:** 7 tasks. Each lands a coherent commit. Largest is Task 2 (the actual provider patch) — touches one file, narrow surface.

**Known limitation:** Task 5's integration test verifies the wire shape via fetch (not via the actual @anthropic-ai/sdk client). A full SDK-in-the-loop test would require stubbing fetch at the SDK level — a meaningful step up in complexity. The provider-options assertion plus the live smoke in Task 7 give us enough confidence for Phase 1.

---

*End of Phase 1 plan.*
