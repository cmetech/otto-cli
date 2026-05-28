import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { isGatewayRoutedModel } from "../footer.js";

const originalUrl = process.env.OTTO_GATEWAY_URL;
const originalDisabled = process.env.OTTO_GATEWAY_DISABLED;

afterEach(() => {
	if (originalUrl === undefined) delete process.env.OTTO_GATEWAY_URL;
	else process.env.OTTO_GATEWAY_URL = originalUrl;
	if (originalDisabled === undefined) delete process.env.OTTO_GATEWAY_DISABLED;
	else process.env.OTTO_GATEWAY_DISABLED = originalDisabled;
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
