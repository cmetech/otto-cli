import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	AssistantMessageEventStream,
	createAssistantMessageEventStream,
} from "@loop24/pi-ai";

describe("@loop24/pi-ai event stream exports", () => {
	it("exports createAssistantMessageEventStream for package consumers", () => {
		assert.equal(typeof createAssistantMessageEventStream, "function");
		const stream = createAssistantMessageEventStream();
		assert.ok(stream instanceof AssistantMessageEventStream);
	});
});
