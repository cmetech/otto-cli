import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSkillToolStubResponse } from "../skill-tool-stub.js";

describe("skill tool stub", () => {
	it("returns a clear message when called with a skill name", () => {
		const response = buildSkillToolStubResponse({ name: "review-pr" });
		assert.match(response, /\/skill:review-pr/);
		assert.match(response, /chat input/i);
		assert.match(response, /not support/i);
	});

	it("handles missing name gracefully", () => {
		const response = buildSkillToolStubResponse({});
		assert.match(response, /skill/i);
		assert.match(response, /chat input/i);
	});

	it("handles a path-like skill name (gsd-*) the same way", () => {
		const response = buildSkillToolStubResponse({ name: "gsd-code-review" });
		assert.match(response, /\/skill:gsd-code-review/);
	});
});
