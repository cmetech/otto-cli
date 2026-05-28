# OTTO Gateway Model Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dynamic model discovery for `OTTO_GATEWAY_URL` so gateway-backed Kiro models appear under `otto-gateway/*` and only those models route through the existing Anthropic Messages gateway path.

**Architecture:** Add a synthetic `otto-gateway` provider that discovers models from the gateway's OpenAI-shaped `/v1/models` endpoint, converts them to `anthropic-messages` models, and keeps generation on the existing Anthropic provider implementation. Direct/static providers (`anthropic`, `openai`, `openai-codex`, etc.) remain direct; the gateway provider namespace is local to OTTO and the payload still sends the raw gateway model ID.

**Tech Stack:** TypeScript, Node test runner, OTTO `ModelRegistry`, existing discovery adapters, existing Anthropic Messages stream provider.

---

## File Structure

- Modify `packages/pi-coding-agent/src/core/model-discovery.ts`: add the `otto-gateway` discovery adapter and URL/header handling.
- Modify `packages/pi-coding-agent/src/core/model-registry.ts`: auto-enable `otto-gateway` discovery/readiness when gateway env is active and convert discovered models to Anthropic Messages defaults.
- Modify `packages/pi-ai/src/providers/anthropic.ts`: route Anthropic SDK traffic to the gateway only when the selected model provider is `otto-gateway`.
- Modify `packages/pi-coding-agent/src/modes/interactive/components/footer.ts`: treat gateway-routed status as active only for `otto-gateway` models when gateway env is active.
- Modify `packages/pi-coding-agent/src/core/model-discovery.test.ts`: add adapter and HTTP behavior tests.
- Modify `packages/pi-coding-agent/src/core/model-registry-discovery.test.ts`: add registry conversion/readiness tests.
- Modify `packages/pi-ai/src/providers/anthropic.gateway.test.ts`: update gateway routing tests so direct `anthropic` stays direct and `otto-gateway` routes.
- Modify or add a footer component test if one already exists near `packages/pi-coding-agent/src/modes/interactive/components/__tests__/`; otherwise keep footer verification covered by a small exported predicate.

## Task 1: Gateway Discovery Adapter

**Files:**
- Modify: `packages/pi-coding-agent/src/core/model-discovery.ts`
- Modify: `packages/pi-coding-agent/src/core/model-discovery.test.ts`

- [ ] **Step 1: Write failing adapter resolution tests**

Add tests to `packages/pi-coding-agent/src/core/model-discovery.test.ts`:

```ts
it("returns an adapter for otto-gateway", () => {
	const adapter = getDiscoveryAdapter("otto-gateway");
	assert.equal(adapter.provider, "otto-gateway");
	assert.equal(adapter.supportsDiscovery, true);
});

it("includes otto-gateway in discoverable providers", () => {
	const providers = getDiscoverableProviders();
	assert.ok(providers.includes("otto-gateway"));
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- packages/pi-coding-agent/src/core/model-discovery.test.ts
```

Expected: failure because `otto-gateway` currently resolves to a static adapter.

- [ ] **Step 3: Add the gateway adapter**

In `packages/pi-coding-agent/src/core/model-discovery.ts`, add a focused adapter:

```ts
class OttoGatewayDiscoveryAdapter extends OpenAIDiscoveryAdapter {
	constructor() {
		super("otto-gateway");
	}

	async fetchModels(apiKey: string, baseUrl?: string): Promise<DiscoveredModel[]> {
		const url = `${(baseUrl ?? "").replace(/\/+$/, "")}/v1/models`;
		const headers: Record<string, string> = {};
		if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
		const response = await fetchWithTimeout(url, { headers });
		if (!response.ok) {
			throw new Error(`Gateway model discovery failed: ${response.status} ${response.statusText}`);
		}
		const data = await response.json();
		const rawModels = Array.isArray(data?.data) ? data.data : [];
		return rawModels
			.map((raw: unknown) => parseOpenAICompatibleModel(raw as Record<string, unknown>))
			.filter((model: DiscoveredModel | undefined): model is DiscoveredModel => Boolean(model));
	}
}
```

Register it:

```ts
const adapters: Record<string, ProviderDiscoveryAdapter> = {
	openai: new OpenAIDiscoveryAdapter("openai"),
	ollama: new OllamaDiscoveryAdapter(),
	openrouter: new OpenRouterDiscoveryAdapter(),
	google: new GoogleDiscoveryAdapter(),
	"otto-gateway": new OttoGatewayDiscoveryAdapter(),
	anthropic: new StaticDiscoveryAdapter("anthropic"),
	// existing entries...
};
```

- [ ] **Step 4: Add URL and auth header tests**

Add:

```ts
it("discovers otto-gateway models from /v1/models with bearer auth", async () => {
	const adapter = getDiscoveryAdapter("otto-gateway");
	const prevFetch = globalThis.fetch;
	let requestedUrl = "";
	let authHeader: string | null = null;
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		authHeader = new Headers(init?.headers).get("authorization");
		return new Response(JSON.stringify({ data: [{ id: "gpt-5.4", context_window: 272000 }] }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as typeof globalThis.fetch;

	try {
		const models = await adapter.fetchModels("gw-token", "http://127.0.0.1:18080");
		assert.equal(requestedUrl, "http://127.0.0.1:18080/v1/models");
		assert.equal(authHeader, "Bearer gw-token");
		assert.equal(models[0]?.id, "gpt-5.4");
		assert.equal(models[0]?.contextWindow, 272000);
	} finally {
		globalThis.fetch = prevFetch;
	}
});
```

- [ ] **Step 5: Run adapter tests**

Run:

```bash
npm test -- packages/pi-coding-agent/src/core/model-discovery.test.ts
```

Expected: all tests pass.

## Task 2: Model Registry Gateway Integration

**Files:**
- Modify: `packages/pi-coding-agent/src/core/model-registry.ts`
- Modify: `packages/pi-coding-agent/src/core/model-registry-discovery.test.ts`

- [ ] **Step 1: Write failing registry discovery test**

Add to `packages/pi-coding-agent/src/core/model-registry-discovery.test.ts`:

```ts
describe("ModelRegistry discovery — OTTO Gateway", () => {
	it("discovers gateway models as anthropic-messages under otto-gateway", async () => {
		const previousUrl = process.env.OTTO_GATEWAY_URL;
		const previousToken = process.env.OTTO_GATEWAY_TOKEN;
		const previousDisabled = process.env.OTTO_GATEWAY_DISABLED;
		process.env.OTTO_GATEWAY_URL = "http://127.0.0.1:18080";
		process.env.OTTO_GATEWAY_TOKEN = "gw-token";
		delete process.env.OTTO_GATEWAY_DISABLED;

		const prevFetch = globalThis.fetch;
		globalThis.fetch = (async () => new Response(
			JSON.stringify({ data: [{ id: "gpt-5.4", name: "GPT-5.4", context_window: 272000 }] }),
			{ status: 200, headers: { "content-type": "application/json" } },
		)) as typeof globalThis.fetch;

		try {
			const registry = new ModelRegistry(AuthStorage.inMemory({}), join(testDir, "models.json"));
			registry.getDiscoveryCache().clear("otto-gateway");
			const results = await registry.discoverModels(["otto-gateway"]);
			assert.equal(results[0]?.error, undefined);

			const model = registry.getAllWithDiscovered().find((m) => m.provider === "otto-gateway" && m.id === "gpt-5.4");
			assert.ok(model);
			assert.equal(model.api, "anthropic-messages");
			assert.equal(model.baseUrl, "http://127.0.0.1:18080");
			assert.equal(model.contextWindow, 272000);
		} finally {
			globalThis.fetch = prevFetch;
			if (previousUrl === undefined) delete process.env.OTTO_GATEWAY_URL;
			else process.env.OTTO_GATEWAY_URL = previousUrl;
			if (previousToken === undefined) delete process.env.OTTO_GATEWAY_TOKEN;
			else process.env.OTTO_GATEWAY_TOKEN = previousToken;
			if (previousDisabled === undefined) delete process.env.OTTO_GATEWAY_DISABLED;
			else process.env.OTTO_GATEWAY_DISABLED = previousDisabled;
		}
	});
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- packages/pi-coding-agent/src/core/model-registry-discovery.test.ts
```

Expected: failure because `otto-gateway` has no base URL/default conversion yet.

- [ ] **Step 3: Add gateway env helpers in registry**

Add private helpers in `ModelRegistry`:

```ts
private getGatewayUrl(): string | undefined {
	const url = process.env.OTTO_GATEWAY_URL?.trim();
	if (!url || process.env.OTTO_GATEWAY_DISABLED?.trim() === "1") return undefined;
	return url.replace(/\/+$/, "");
}

private isGatewayProvider(provider: string): boolean {
	return provider === "otto-gateway";
}
```

Update readiness and key resolution:

```ts
if (provider === "otto-gateway" && this.getGatewayUrl()) return true;
```

```ts
private getGatewayApiKeyForProvider(provider: string): string | undefined {
	if (!this.isGatewayProvider(provider)) return undefined;
	if (!this.getGatewayUrl()) return undefined;
	return process.env.OTTO_GATEWAY_TOKEN?.trim() || "otto-gateway";
}
```

- [ ] **Step 4: Add gateway provider defaults**

Update `getProviderBaseUrl()`:

```ts
if (provider === "otto-gateway") return this.getGatewayUrl();
```

Update `getDiscoveryProviderDefaults()` before the generic fallback:

```ts
if (provider === "otto-gateway") {
	return {
		api: "anthropic-messages",
		baseUrl: this.getGatewayUrl() ?? "",
		input: ["text"],
		contextWindow: 128000,
		maxTokens: 16384,
	};
}
```

Update `getAutoDiscoverableProviders()`:

```ts
if (this.getGatewayUrl()) {
	discoverable.add("otto-gateway");
}
```

- [ ] **Step 5: Add readiness tests**

Add:

```ts
it("treats otto-gateway as request-ready only when gateway is enabled", () => {
	const previousUrl = process.env.OTTO_GATEWAY_URL;
	const previousDisabled = process.env.OTTO_GATEWAY_DISABLED;
	try {
		const registry = new ModelRegistry(AuthStorage.inMemory({}), join(testDir, "models.json"));
		delete process.env.OTTO_GATEWAY_URL;
		delete process.env.OTTO_GATEWAY_DISABLED;
		assert.equal(registry.isProviderRequestReady("otto-gateway"), false);

		process.env.OTTO_GATEWAY_URL = "http://127.0.0.1:18080";
		assert.equal(registry.isProviderRequestReady("otto-gateway"), true);

		process.env.OTTO_GATEWAY_DISABLED = "1";
		assert.equal(registry.isProviderRequestReady("otto-gateway"), false);
	} finally {
		if (previousUrl === undefined) delete process.env.OTTO_GATEWAY_URL;
		else process.env.OTTO_GATEWAY_URL = previousUrl;
		if (previousDisabled === undefined) delete process.env.OTTO_GATEWAY_DISABLED;
		else process.env.OTTO_GATEWAY_DISABLED = previousDisabled;
	}
});
```

Add a direct-provider guard test:

```ts
it("does not treat direct Anthropic as request-ready from gateway env alone", () => {
	const previousUrl = process.env.OTTO_GATEWAY_URL;
	const previousDisabled = process.env.OTTO_GATEWAY_DISABLED;
	try {
		process.env.OTTO_GATEWAY_URL = "http://127.0.0.1:18080";
		delete process.env.OTTO_GATEWAY_DISABLED;
		const registry = new ModelRegistry(AuthStorage.inMemory({}), join(testDir, "models.json"));
		assert.equal(registry.isProviderRequestReady("anthropic"), false);
	} finally {
		if (previousUrl === undefined) delete process.env.OTTO_GATEWAY_URL;
		else process.env.OTTO_GATEWAY_URL = previousUrl;
		if (previousDisabled === undefined) delete process.env.OTTO_GATEWAY_DISABLED;
		else process.env.OTTO_GATEWAY_DISABLED = previousDisabled;
	}
});
```

- [ ] **Step 6: Run registry tests**

Run:

```bash
npm test -- packages/pi-coding-agent/src/core/model-registry-discovery.test.ts packages/pi-coding-agent/src/core/model-registry-auth-mode.test.ts
```

Expected: all tests pass.

## Task 3: Provider-Gated Anthropic Gateway Routing

**Files:**
- Modify: `packages/pi-ai/src/providers/anthropic.ts`
- Modify: `packages/pi-ai/src/providers/anthropic.gateway.test.ts`

- [ ] **Step 1: Update failing gateway routing tests**

In `packages/pi-ai/src/providers/anthropic.gateway.test.ts`, change the existing gateway tests so the direct Anthropic model stays direct even when `OTTO_GATEWAY_URL` is set:

```ts
it("keeps direct Anthropic options direct when OTTO_GATEWAY_URL is set", () => {
	process.env.OTTO_GATEWAY_URL = "https://gateway.otto.local";

	const opts = buildAnthropicClientOptions(anthropicModel(), "test-api-key", false) as GatewayOptions;

	assert.equal(opts.baseURL, "https://api.anthropic.com");
	assert.equal(opts.apiKey, "test-api-key");
	assert.equal(opts.authToken, undefined);
});
```

Add a gateway-provider model helper:

```ts
function ottoGatewayModel(overrides: Partial<Model<"anthropic-messages">> = {}): Model<"anthropic-messages"> {
	return anthropicModel({
		provider: "otto-gateway",
		baseUrl: "http://127.0.0.1:18080",
		id: "gpt-5.4",
		name: "GPT-5.4 via OTTO Gateway",
		...overrides,
	});
}
```

Then update the gateway-positive tests to use `ottoGatewayModel()`:

```ts
it("routes otto-gateway models through gateway URL when OTTO_GATEWAY_URL is set", () => {
	process.env.OTTO_GATEWAY_URL = "https://gateway.otto.local";

	const opts = buildAnthropicClientOptions(ottoGatewayModel(), "test-api-key", false) as GatewayOptions;

	assert.equal(opts.baseURL, "https://gateway.otto.local");
	assert.equal(opts.apiKey, null);
	assert.equal(opts.authToken, "test-api-key");
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- packages/pi-ai/src/providers/anthropic.gateway.test.ts
```

Expected: direct Anthropic still routes through gateway until implementation is changed.

- [ ] **Step 3: Gate gateway routing by provider**

In `packages/pi-ai/src/providers/anthropic.ts`, change the gateway branch condition from env-only to provider-specific:

```ts
const shouldRouteViaOttoGateway =
	model.provider === "otto-gateway" &&
	ottoGatewayUrl &&
	!(directFallbackActive && apiKey.trim());

if (shouldRouteViaOttoGateway) {
	// existing gateway branch
}
```

In `streamSimpleAnthropic`, only synthesize the placeholder key for `otto-gateway`:

```ts
const gatewayUrl = process.env.OTTO_GATEWAY_URL?.trim();
const directFallbackActive = process.env.OTTO_GATEWAY_FORCE_DIRECT?.trim() === "1";
const gatewayPlaceholder =
	model.provider === "otto-gateway" && gatewayUrl && !directFallbackActive ? "otto-gateway" : undefined;
const apiKey = options?.apiKey || getEnvApiKey(model.provider) || gatewayPlaceholder;
```

- [ ] **Step 4: Run Anthropic gateway tests**

Run:

```bash
npm test -- packages/pi-ai/src/providers/anthropic.gateway.test.ts packages/pi-ai/src/providers/anthropic-auth.test.ts
```

Expected: all tests pass, with direct Anthropic remaining direct and `otto-gateway` routing through the gateway.

## Task 4: Footer Routing Status

**Files:**
- Modify: `packages/pi-coding-agent/src/modes/interactive/components/footer.ts`
- Test: nearest existing footer/component test, or add `packages/pi-coding-agent/src/modes/interactive/components/__tests__/gateway-routing-status.test.ts`

- [ ] **Step 1: Extract a testable predicate**

Add near footer helpers:

```ts
export function isGatewayRoutedModel(displayModel: { provider?: string; api?: string } | undefined): boolean {
	if (!displayModel) return false;
	if (displayModel.provider !== "otto-gateway") return false;
	if (displayModel.api !== "anthropic-messages") return false;
	if (!process.env.OTTO_GATEWAY_URL?.trim()) return false;
	if (process.env.OTTO_GATEWAY_DISABLED?.trim() === "1") return false;
	return true;
}
```

Update the footer call:

```ts
const gatewayStatus = formatGatewayFooterStatus(this.footerData.getGatewayStatus(), {
	routed: isGatewayRoutedModel(displayModel),
});
```

- [ ] **Step 2: Add predicate tests**

Create `packages/pi-coding-agent/src/modes/interactive/components/__tests__/gateway-routing-status.test.ts`:

```ts
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { isGatewayRoutedModel } from "../footer.js";

const previousUrl = process.env.OTTO_GATEWAY_URL;
const previousDisabled = process.env.OTTO_GATEWAY_DISABLED;

afterEach(() => {
	if (previousUrl === undefined) delete process.env.OTTO_GATEWAY_URL;
	else process.env.OTTO_GATEWAY_URL = previousUrl;
	if (previousDisabled === undefined) delete process.env.OTTO_GATEWAY_DISABLED;
	else process.env.OTTO_GATEWAY_DISABLED = previousDisabled;
});

describe("isGatewayRoutedModel", () => {
	it("returns true for otto-gateway anthropic-messages models when gateway is active", () => {
		process.env.OTTO_GATEWAY_URL = "http://127.0.0.1:18080";
		delete process.env.OTTO_GATEWAY_DISABLED;
		assert.equal(isGatewayRoutedModel({ provider: "otto-gateway", api: "anthropic-messages" }), true);
	});

	it("returns false when gateway is disabled", () => {
		process.env.OTTO_GATEWAY_URL = "http://127.0.0.1:18080";
		process.env.OTTO_GATEWAY_DISABLED = "1";
		assert.equal(isGatewayRoutedModel({ provider: "otto-gateway", api: "anthropic-messages" }), false);
	});

	it("returns false for non-Anthropic transports", () => {
		process.env.OTTO_GATEWAY_URL = "http://127.0.0.1:18080";
		assert.equal(isGatewayRoutedModel({ provider: "openai", api: "openai-responses" }), false);
	});

	it("returns false for direct Anthropic models even when gateway is active", () => {
		process.env.OTTO_GATEWAY_URL = "http://127.0.0.1:18080";
		assert.equal(isGatewayRoutedModel({ provider: "anthropic", api: "anthropic-messages" }), false);
	});
});
```

- [ ] **Step 3: Run footer test**

Run:

```bash
npm test -- packages/pi-coding-agent/src/modes/interactive/components/__tests__/gateway-routing-status.test.ts
```

Expected: all tests pass.

## Task 5: End-to-End Verification

**Files:**
- No source changes unless earlier tests reveal integration gaps.

- [ ] **Step 1: Run targeted test suite**

Run:

```bash
npm test -- packages/pi-coding-agent/src/core/model-discovery.test.ts packages/pi-coding-agent/src/core/model-registry-discovery.test.ts packages/pi-coding-agent/src/core/model-registry-auth-mode.test.ts packages/pi-ai/src/providers/anthropic.gateway.test.ts packages/pi-ai/src/providers/anthropic-auth.test.ts packages/pi-coding-agent/src/modes/interactive/components/__tests__/gateway-routing-status.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: full suite passes.

- [ ] **Step 3: Human verification**

Run:

```bash
export OTTO_GATEWAY_URL=http://127.0.0.1:18080
curl -s http://127.0.0.1:18080/v1/models | jq '.data[].id'
otto
```

Expected:

- Model picker includes `otto-gateway/*` entries matching `/v1/models`.
- Selecting `otto-gateway/*` sends that model ID to the gateway as Anthropic `model`.
- Footer shows `GW routed` only for `otto-gateway/*`.
- Selecting `anthropic/*` uses direct Anthropic configuration and does not route through gateway.
- A normal prompt succeeds through the selected provider.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/pi-coding-agent/src/core/model-discovery.ts packages/pi-coding-agent/src/core/model-registry.ts packages/pi-ai/src/providers/anthropic.ts packages/pi-coding-agent/src/modes/interactive/components/footer.ts packages/pi-coding-agent/src/core/model-discovery.test.ts packages/pi-coding-agent/src/core/model-registry-discovery.test.ts packages/pi-ai/src/providers/anthropic.gateway.test.ts packages/pi-coding-agent/src/modes/interactive/components/__tests__/gateway-routing-status.test.ts
git commit -m "feat: discover OTTO Gateway models"
```

## Self-Review

- Spec coverage: discovery, conversion, provider-gated routing, footer display, error behavior, and verification are all mapped to tasks.
- Placeholder scan: no placeholder tasks remain.
- Type consistency: provider name is consistently `otto-gateway`; generation API is consistently `anthropic-messages`; discovery endpoint is consistently `/v1/models`.
