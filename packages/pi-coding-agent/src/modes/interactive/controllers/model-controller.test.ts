import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getModelCandidates } from "./model-controller.js";

function model(provider: string, id: string) {
	return {
		id,
		name: id,
		provider,
		api: "anthropic-messages",
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	};
}

describe("model-controller gateway discovery candidates", () => {
	it("includes discovered gateway models only while the provider is request-ready", async () => {
		const direct = model("anthropic", "claude-sonnet-4");
		const gateway = model("otto-gateway", "gpt-5.4");
		let gatewayReady = true;
		const host = {
			session: {
				scopedModels: [],
				modelRegistry: {
					refresh() {},
					getAvailable() {
						return [direct];
					},
					getAllWithDiscovered() {
						return [direct, gateway];
					},
					isProviderRequestReady(provider: string) {
						return provider === "otto-gateway" ? gatewayReady : true;
					},
				},
			},
		};

		assert.deepEqual((await getModelCandidates(host)).map((m) => `${m.provider}/${m.id}`), [
			"anthropic/claude-sonnet-4",
			"otto-gateway/gpt-5.4",
		]);

		gatewayReady = false;
		assert.deepEqual((await getModelCandidates(host)).map((m) => `${m.provider}/${m.id}`), [
			"anthropic/claude-sonnet-4",
		]);
	});
});
