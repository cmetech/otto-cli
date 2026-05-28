import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { AuthStorage } from "./auth-storage.js";
import { ModelDiscoveryCache } from "./discovery-cache.js";
import { getDefaultTTL, getDiscoverableProviders, getDiscoveryAdapter } from "./model-discovery.js";
import { ModelRegistry } from "./model-registry.js";

let testDir: string;

beforeEach(() => {
	testDir = join(tmpdir(), `model-registry-discovery-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(testDir, { recursive: true, force: true });
	} catch {
		// Cleanup best-effort
	}
});

// ─── discovery cache integration ─────────────────────────────────────────────

describe("ModelDiscoveryCache — integration with discovery", () => {
	it("cache respects provider-specific TTLs", () => {
		const cachePath = join(testDir, "cache.json");
		const cache = new ModelDiscoveryCache(cachePath);

		cache.set("ollama", [{ id: "llama2" }]);
		const entry = cache.get("ollama");
		assert.ok(entry);
		assert.equal(entry.ttlMs, getDefaultTTL("ollama"));
	});

	it("cache uses custom TTL when provided", () => {
		const cachePath = join(testDir, "cache.json");
		const cache = new ModelDiscoveryCache(cachePath);

		cache.set("openai", [{ id: "gpt-4o" }], 999);
		const entry = cache.get("openai");
		assert.ok(entry);
		assert.equal(entry.ttlMs, 999);
	});
});

// ─── adapter resolution ─────────────────────────────────────────────────────

describe("Discovery adapter resolution", () => {
	it("all discoverable providers have adapters", () => {
		const providers = getDiscoverableProviders();
		for (const provider of providers) {
			const adapter = getDiscoveryAdapter(provider);
			assert.equal(adapter.supportsDiscovery, true, `${provider} should support discovery`);
		}
	});

	it("static adapters return empty model lists", async () => {
		const staticProviders = ["anthropic", "bedrock", "azure-openai", "groq", "cerebras"];
		for (const provider of staticProviders) {
			const adapter = getDiscoveryAdapter(provider);
			assert.equal(adapter.supportsDiscovery, false, `${provider} should not support discovery`);
			const models = await adapter.fetchModels("dummy-key");
			assert.deepEqual(models, [], `${provider} should return empty models`);
		}
	});
});

// ─── AuthStorage hasAuth for discovery ───────────────────────────────────────

describe("AuthStorage — hasAuth for discovery providers", () => {
	it("returns false for providers without auth", () => {
		const storage = AuthStorage.inMemory({});
		assert.equal(storage.hasAuth("openai"), false);
		assert.equal(storage.hasAuth("ollama"), false);
	});

	it("returns true for providers with stored keys", () => {
		const storage = AuthStorage.inMemory({
			openai: { type: "api_key" as const, key: "sk-test" },
		});
		assert.equal(storage.hasAuth("openai"), true);
		assert.equal(storage.hasAuth("ollama"), false);
	});
});

// ─── cache persistence across instances ──────────────────────────────────────

describe("ModelDiscoveryCache — persistence", () => {
	it("data survives across cache instances", () => {
		const cachePath = join(testDir, "persist.json");

		const cache1 = new ModelDiscoveryCache(cachePath);
		cache1.set("openai", [
			{ id: "gpt-4o", name: "GPT-4o", contextWindow: 128000 },
			{ id: "gpt-4o-mini", name: "GPT-4o Mini" },
		]);

		const cache2 = new ModelDiscoveryCache(cachePath);
		const entry = cache2.get("openai");
		assert.ok(entry);
		assert.equal(entry.models.length, 2);
		assert.equal(entry.models[0].contextWindow, 128000);
	});

	it("clear persists across instances", () => {
		const cachePath = join(testDir, "clear.json");

		const cache1 = new ModelDiscoveryCache(cachePath);
		cache1.set("openai", [{ id: "gpt-4o" }]);
		cache1.clear("openai");

		const cache2 = new ModelDiscoveryCache(cachePath);
		assert.equal(cache2.get("openai"), undefined);
	});
});

// ─── discovery TTL values ────────────────────────────────────────────────────

describe("Discovery TTL configuration", () => {
	it("ollama has shortest TTL (local models change often)", () => {
		const ollamaTTL = getDefaultTTL("ollama");
		const openaiTTL = getDefaultTTL("openai");
		assert.ok(ollamaTTL < openaiTTL, "ollama TTL should be shorter than openai");
	});

	it("unknown providers get default TTL", () => {
		const customTTL = getDefaultTTL("my-custom-provider");
		const defaultTTL = getDefaultTTL("default");
		// Unknown providers should get the same TTL as the explicit "default" key
		assert.equal(customTTL, defaultTTL);
	});
});

describe("ModelRegistry discovery — OpenAI-compatible custom providers", () => {
	it("discovers custom OpenAI-compatible providers and maps capability metadata", async () => {
		const providerName = `minimax-openai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const modelsPath = join(testDir, "models.json");
		writeFileSync(
			modelsPath,
			JSON.stringify(
				{
					providers: {
						[providerName]: {
							baseUrl: "https://api.minimax.example",
							apiKey: "minimax-test-key",
							api: "openai-completions",
							models: [{ id: "bootstrap-model" }],
						},
					},
				},
				null,
				2,
			),
			"utf-8",
		);

		const prevFetch = globalThis.fetch;
		let requestedUrl = "";
		globalThis.fetch = (async (input: string | URL | Request) => {
			requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			return new Response(
				JSON.stringify({
					data: [
						{
							id: "MiniMax-M2.7-highspeed",
							name: "MiniMax M2.7 Highspeed",
							context_window: 165000,
							max_output_tokens: 32768,
							supports_reasoning: true,
							input_modalities: ["text", "image"],
						},
					],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		}) as typeof globalThis.fetch;

		try {
			const registry = new ModelRegistry(AuthStorage.inMemory({}), modelsPath);
			// Guard against global cache leakage from prior test runs.
			registry.getDiscoveryCache().clear(providerName);
			const results = await registry.discoverModels([providerName]);

			const discovery = results.find((r) => r.provider === providerName);
			assert.ok(discovery, "discovery result should include custom provider");
			assert.equal(discovery?.error, undefined, "custom provider discovery should succeed");
			assert.equal(requestedUrl, "https://api.minimax.example/v1/models");

			const discovered = registry
				.getAllWithDiscovered()
				.find((m) => m.provider === providerName && m.id === "MiniMax-M2.7-highspeed");
			assert.ok(discovered, "discovered model should be merged into model list");
			assert.equal(discovered?.api, "openai-completions");
			assert.equal(discovered?.baseUrl, "https://api.minimax.example");
			assert.equal(discovered?.contextWindow, 165000);
			assert.equal(discovered?.maxTokens, 32768);
			assert.equal(discovered?.reasoning, true);
			assert.deepEqual(discovered?.input, ["text", "image"]);
		} finally {
			globalThis.fetch = prevFetch;
		}
	});
});

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

	it("does not surface cached gateway models when the gateway is unreachable", async () => {
		const previousUrl = process.env.OTTO_GATEWAY_URL;
		const previousToken = process.env.OTTO_GATEWAY_TOKEN;
		const previousDisabled = process.env.OTTO_GATEWAY_DISABLED;
		process.env.OTTO_GATEWAY_URL = "http://127.0.0.1:18080";
		process.env.OTTO_GATEWAY_TOKEN = "gw-token";
		delete process.env.OTTO_GATEWAY_DISABLED;

		const prevFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			throw new Error("connect ECONNREFUSED 127.0.0.1:18080");
		}) as typeof globalThis.fetch;

		try {
			const registry = new ModelRegistry(AuthStorage.inMemory({}), join(testDir, "models.json"));
			registry.getDiscoveryCache().set("otto-gateway", [{ id: "gpt-stale", name: "Stale Gateway Model" }], 60_000);

			const results = await registry.discoverModels(["otto-gateway"]);

			assert.match(results[0]?.error ?? "", /ECONNREFUSED/);
			assert.equal(registry.getAllWithDiscovered().some((m) => m.provider === "otto-gateway"), false);
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
