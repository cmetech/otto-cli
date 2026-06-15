import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "../event-bus.js";
import { createExtension, createExtensionAPI, createExtensionRuntime } from "./loader.js";

// Regression test for upstream e723617 — "fix: await extension sendMessage turns".
//
// Extension hosts wire `runtime.sendMessage` to an async delivery function
// (AgentSession.sendCustomMessage, which returns Promise<void>). The public
// `pi.sendMessage(...)` API must propagate that Promise so callers can `await`
// delivery of a triggerTurn message instead of fire-and-forgetting it and
// racing the agent. Before the fix the API dropped the runtime Promise on the
// floor and returned `void`, so `await pi.sendMessage(...)` resolved
// immediately — the await was a no-op and the race persisted.

describe("ExtensionAPI.sendMessage awaits runtime delivery (e723617)", () => {
	it("returns the Promise produced by the runtime delivery function", async () => {
		const runtime = createExtensionRuntime();
		const eventBus = createEventBus();
		const extension = createExtension("/tmp/test-ext", "/tmp/test-ext");

		// Simulate the host binding an async delivery implementation, as
		// AgentSession.bindCore does with sendCustomMessage.
		let delivered = false;
		runtime.sendMessage = (async () => {
			await Promise.resolve();
			delivered = true;
		}) as typeof runtime.sendMessage;

		const api = createExtensionAPI(extension, runtime, "/tmp", eventBus);

		const result = api.sendMessage({
			customType: "dispatch",
			content: "run",
			display: false,
		});

		// The API must hand back the runtime's Promise. Before the fix the
		// loader returned `void`, so there was nothing to await and delivery
		// had not yet happened when the caller resumed.
		assert.ok(
			result && typeof (result as Promise<void>).then === "function",
			"pi.sendMessage must return a Promise so callers can await delivery",
		);

		assert.equal(delivered, false, "delivery is asynchronous and not yet complete");
		await result;
		assert.equal(delivered, true, "awaiting the returned Promise resolves once delivery completes");
	});
});
