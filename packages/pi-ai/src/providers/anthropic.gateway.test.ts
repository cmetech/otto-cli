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

type GatewayOptions = {
	baseURL: string;
	apiKey: string | null;
	authToken: string | undefined;
	defaultHeaders: Record<string, string>;
};

const ORIGINAL_ENV = { ...process.env };

describe("LOOP24 gateway routing branch in buildAnthropicClientOptions", () => {
	beforeEach(() => {
		delete process.env.LOOP24_GATEWAY_URL;
		delete process.env.LOOP24_GATEWAY_TOKEN;
		delete process.env.ANTHROPIC_BASE_URL;
	});

	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
	});

	it("returns direct-to-Anthropic options when LOOP24_GATEWAY_URL is unset", () => {
		const opts = buildAnthropicClientOptions(anthropicModel(), "test-api-key", false) as GatewayOptions;

		assert.equal(opts.apiKey, "test-api-key", "apiKey should pass through when gateway is not configured");
		assert.equal(opts.baseURL, "https://api.anthropic.com", "baseURL should match the model's baseUrl");
	});

	it("routes through gateway URL when LOOP24_GATEWAY_URL is set", () => {
		process.env.LOOP24_GATEWAY_URL = "https://gateway.loop24.local";

		const opts = buildAnthropicClientOptions(anthropicModel(), "test-api-key", false) as GatewayOptions;

		assert.equal(opts.baseURL, "https://gateway.loop24.local", "baseURL should match LOOP24_GATEWAY_URL");
		assert.equal(opts.apiKey, null, "apiKey should be null when routing through the gateway");
	});

	it("uses LOOP24_GATEWAY_TOKEN as bearer credential when set", () => {
		process.env.LOOP24_GATEWAY_URL = "https://gateway.loop24.local";
		process.env.LOOP24_GATEWAY_TOKEN = "gateway-secret-token";

		const opts = buildAnthropicClientOptions(anthropicModel(), "test-api-key", false) as GatewayOptions;

		assert.equal(opts.authToken, "gateway-secret-token", "authToken should be the LOOP24_GATEWAY_TOKEN value");
		assert.notEqual(opts.authToken, "test-api-key", "authToken should not fall back to apiKey when token is set");
	});

	it("falls back to apiKey as bearer credential when LOOP24_GATEWAY_TOKEN is unset", () => {
		process.env.LOOP24_GATEWAY_URL = "https://gateway.loop24.local";

		const opts = buildAnthropicClientOptions(anthropicModel(), "test-api-key", false) as GatewayOptions;

		assert.equal(opts.authToken, "test-api-key", "authToken should fall back to apiKey arg when LOOP24_GATEWAY_TOKEN is unset");
	});

	it("preserves model.headers when gateway-routed", () => {
		process.env.LOOP24_GATEWAY_URL = "https://gateway.loop24.local";

		const opts = buildAnthropicClientOptions(
			anthropicModel({
				headers: { "X-Custom-Header": "custom-value", "X-Trace-Id": "abc-123" },
			}),
			"test-api-key",
			false,
		) as GatewayOptions;

		assert.equal(opts.defaultHeaders["X-Custom-Header"], "custom-value", "custom model headers should flow into defaultHeaders");
		assert.equal(opts.defaultHeaders["X-Trace-Id"], "abc-123", "all custom model headers should be preserved");
	});

	it("LOOP24_GATEWAY_URL with only whitespace is treated as unset", () => {
		process.env.LOOP24_GATEWAY_URL = "   \t  ";

		const opts = buildAnthropicClientOptions(anthropicModel(), "test-api-key", false) as GatewayOptions;

		assert.equal(opts.apiKey, "test-api-key", "whitespace-only gateway URL should not trigger gateway branch");
		assert.equal(opts.baseURL, "https://api.anthropic.com", "baseURL should fall back to model.baseUrl when gateway URL is whitespace");
	});
});
