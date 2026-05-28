import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Model } from "../types.js";
import { buildAnthropicClientOptions } from "./anthropic.js";

function anthropicModel(overrides: Partial<Model<"anthropic-messages">> = {}): Model<"anthropic-messages"> {
	return {
		id: "claude-sonnet-4",
		name: "Claude Sonnet 4",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 8192,
		...overrides,
	};
}

function ottoGatewayModel(overrides: Partial<Model<"anthropic-messages">> = {}): Model<"anthropic-messages"> {
	return anthropicModel({
		id: "gpt-5.4",
		name: "GPT-5.4 via OTTO Gateway",
		provider: "otto-gateway",
		baseUrl: "http://127.0.0.1:18080",
		...overrides,
	});
}

type GatewayOptions = {
	baseURL: string;
	apiKey: string | null;
	authToken: string | undefined;
	defaultHeaders: Record<string, string>;
};

const ORIGINAL_ENV = { ...process.env };

describe("OTTO gateway routing branch in buildAnthropicClientOptions", () => {
	beforeEach(() => {
		delete process.env.OTTO_GATEWAY_URL;
		delete process.env.OTTO_GATEWAY_TOKEN;
		delete process.env.OTTO_GATEWAY_FORCE_DIRECT;
		delete process.env.ANTHROPIC_BASE_URL;
	});

	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
	});

	it("returns direct-to-Anthropic options when OTTO_GATEWAY_URL is unset", () => {
		const opts = buildAnthropicClientOptions(anthropicModel(), "test-api-key", false) as GatewayOptions;

		assert.equal(opts.apiKey, "test-api-key", "apiKey should pass through when gateway is not configured");
		assert.equal(opts.baseURL, "https://api.anthropic.com", "baseURL should match the model's baseUrl");
	});

	it("keeps direct Anthropic options direct when OTTO_GATEWAY_URL is set", () => {
		process.env.OTTO_GATEWAY_URL = "https://gateway.otto.local";

		const opts = buildAnthropicClientOptions(anthropicModel(), "test-api-key", false) as GatewayOptions;

		assert.equal(opts.baseURL, "https://api.anthropic.com", "direct Anthropic should use its configured baseURL");
		assert.equal(opts.apiKey, "test-api-key", "direct Anthropic should keep x-api-key auth");
		assert.equal(opts.authToken, undefined, "direct Anthropic should not use gateway bearer auth");
	});

	it("routes otto-gateway models through gateway URL when OTTO_GATEWAY_URL is set", () => {
		process.env.OTTO_GATEWAY_URL = "https://gateway.otto.local";

		const opts = buildAnthropicClientOptions(ottoGatewayModel(), "test-api-key", false) as GatewayOptions;

		assert.equal(opts.baseURL, "https://gateway.otto.local", "baseURL should match OTTO_GATEWAY_URL");
		assert.equal(opts.apiKey, null, "apiKey should be null when routing through the gateway");
	});

	it("uses OTTO_GATEWAY_TOKEN as bearer credential when set", () => {
		process.env.OTTO_GATEWAY_URL = "https://gateway.otto.local";
		process.env.OTTO_GATEWAY_TOKEN = "gateway-secret-token";

		const opts = buildAnthropicClientOptions(ottoGatewayModel(), "test-api-key", false) as GatewayOptions;

		assert.equal(opts.authToken, "gateway-secret-token", "authToken should be the OTTO_GATEWAY_TOKEN value");
		assert.notEqual(opts.authToken, "test-api-key", "authToken should not fall back to apiKey when token is set");
	});

	it("falls back to apiKey as bearer credential when OTTO_GATEWAY_TOKEN is unset", () => {
		process.env.OTTO_GATEWAY_URL = "https://gateway.otto.local";

		const opts = buildAnthropicClientOptions(ottoGatewayModel(), "test-api-key", false) as GatewayOptions;

		assert.equal(opts.authToken, "test-api-key", "authToken should fall back to apiKey arg when OTTO_GATEWAY_TOKEN is unset");
	});

	it("preserves model.headers when gateway-routed", () => {
		process.env.OTTO_GATEWAY_URL = "https://gateway.otto.local";

		const opts = buildAnthropicClientOptions(
			ottoGatewayModel({
				headers: { "X-Custom-Header": "custom-value", "X-Trace-Id": "abc-123" },
			}),
			"test-api-key",
			false,
		) as GatewayOptions;

		assert.equal(opts.defaultHeaders["X-Custom-Header"], "custom-value", "custom model headers should flow into defaultHeaders");
		assert.equal(opts.defaultHeaders["X-Trace-Id"], "abc-123", "all custom model headers should be preserved");
	});

	it("OTTO_GATEWAY_URL with only whitespace is treated as unset", () => {
		process.env.OTTO_GATEWAY_URL = "   \t  ";

		const opts = buildAnthropicClientOptions(ottoGatewayModel(), "test-api-key", false) as GatewayOptions;

		assert.equal(opts.apiKey, "test-api-key", "whitespace-only gateway URL should not trigger gateway branch");
		assert.equal(opts.baseURL, "http://127.0.0.1:18080", "baseURL should fall back to model.baseUrl when gateway URL is whitespace");
	});

	it("normalizes gateway root URL before passing it to the SDK", () => {
		process.env.OTTO_GATEWAY_URL = " https://gateway.otto.local/v1/ ";

		const opts = buildAnthropicClientOptions(ottoGatewayModel(), "test-api-key", false) as GatewayOptions;

		assert.equal(opts.baseURL, "https://gateway.otto.local", "Anthropic SDK baseURL must be gateway root, not /v1");
	});

	it("uses a placeholder bearer token in gateway mode when no direct key is available", () => {
		process.env.OTTO_GATEWAY_URL = "https://gateway.otto.local";

		const opts = buildAnthropicClientOptions(ottoGatewayModel(), "", false) as GatewayOptions;

		assert.equal(opts.apiKey, null);
		assert.equal(opts.authToken, "otto-gateway", "SDK should initialize even when gateway auth is disabled and no direct key exists");
	});

	it("bypasses gateway when direct fallback is active and a direct key is available", () => {
		process.env.OTTO_GATEWAY_URL = "https://gateway.otto.local";
		process.env.OTTO_GATEWAY_FORCE_DIRECT = "1";

		const opts = buildAnthropicClientOptions(anthropicModel(), "direct-api-key", false) as GatewayOptions;

		assert.equal(opts.apiKey, "direct-api-key");
		assert.equal(opts.baseURL, "https://api.anthropic.com");
	});

	it("keeps gateway routing during fallback mode when no direct key is available", () => {
		process.env.OTTO_GATEWAY_URL = "https://gateway.otto.local";
		process.env.OTTO_GATEWAY_FORCE_DIRECT = "1";

		const opts = buildAnthropicClientOptions(ottoGatewayModel(), "", false) as GatewayOptions;

		assert.equal(opts.apiKey, null);
		assert.equal(opts.baseURL, "https://gateway.otto.local");
		assert.equal(opts.authToken, "otto-gateway");
	});
});
