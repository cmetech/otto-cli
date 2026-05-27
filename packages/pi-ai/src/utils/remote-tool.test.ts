import { test } from "node:test";
import assert from "node:assert/strict";

import type { ToolCall } from "../types.js";
import { classifyRemoteToolCall, formatRemoteToolResultText } from "./remote-tool.js";

test("classifyRemoteToolCall recognizes Kiro ACP read rawInput shape", () => {
	const call: ToolCall = {
		type: "toolCall",
		id: "tooluse_1",
		name: "read",
		arguments: {
			operations: [{ mode: "Line", path: "/repo/CLAUDE.md" }],
			__tool_use_purpose: "Read CLAUDE.md to find the # Project section",
		},
	};

	const classified = classifyRemoteToolCall(call, { gatewayRouted: true });

	assert.equal(classified.executionDomain, "remote");
	assert.equal(classified.remote?.source, "kiro-acp");
	assert.equal(classified.remote?.kind, "read");
	assert.equal(classified.remote?.purpose, "Read CLAUDE.md to find the # Project section");
	assert.deepEqual(classified.remote?.locations, [{ path: "/repo/CLAUDE.md" }]);
});

test("classifyRemoteToolCall leaves ordinary local calls unchanged", () => {
	const call: ToolCall = {
		type: "toolCall",
		id: "tooluse_2",
		name: "read",
		arguments: { path: "/repo/CLAUDE.md" },
	};

	const classified = classifyRemoteToolCall(call, { gatewayRouted: true });

	assert.equal(classified.executionDomain, undefined);
	assert.equal(classified.remote, undefined);
});

test("formatRemoteToolResultText labels remote execution without claiming local execution", () => {
	const call: ToolCall = {
		type: "toolCall",
		id: "tooluse_3",
		name: "read",
		arguments: {},
		executionDomain: "remote",
		remote: {
			source: "kiro-acp",
			kind: "read",
			title: "Reading CLAUDE.md:1",
			purpose: "Read CLAUDE.md",
			locations: [{ path: "/repo/CLAUDE.md" }],
		},
	};

	assert.match(formatRemoteToolResultText(call), /Remote tool reported by kiro-acp/);
	assert.match(formatRemoteToolResultText(call), /Reading CLAUDE\.md:1/);
	assert.match(formatRemoteToolResultText(call), /agent stated purpose: Read CLAUDE\.md/);
});
