import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { buildSystemPrompt } from "./system-prompt.js";

const ORIGINAL_OTTO_GATEWAY_URL = process.env.OTTO_GATEWAY_URL;

afterEach(() => {
	if (ORIGINAL_OTTO_GATEWAY_URL === undefined) delete process.env.OTTO_GATEWAY_URL;
	else process.env.OTTO_GATEWAY_URL = ORIGINAL_OTTO_GATEWAY_URL;
});

test("gateway-routed system prompt instructs model to use only supplied OTTO tools", () => {
	process.env.OTTO_GATEWAY_URL = "http://127.0.0.1:18080";

	const prompt = buildSystemPrompt({
		selectedTools: ["read", "otto__langflow"],
		toolSnippets: { otto__langflow: "Manage LangFlow flows" },
		cwd: "/repo",
	});

	assert.match(prompt, /This request is routed through the OTTO gateway/);
	assert.match(prompt, /Use only the OTTO tool names and schemas supplied for this request: read, otto__langflow/);
	assert.match(prompt, /Do not call Kiro\/ACP\/internal gateway tools/);
	assert.match(prompt, /Do not use Kiro internal argument shapes such as `operations`, `rawInput`, or `__tool_use_purpose`/);
});

test("direct system prompt omits gateway tool boundary", () => {
	delete process.env.OTTO_GATEWAY_URL;

	const prompt = buildSystemPrompt({
		selectedTools: ["read", "otto__langflow"],
		toolSnippets: { otto__langflow: "Manage LangFlow flows" },
		cwd: "/repo",
	});

	assert.doesNotMatch(prompt, /This request is routed through the OTTO gateway/);
	assert.doesNotMatch(prompt, /Do not call Kiro\/ACP\/internal gateway tools/);
});

test("custom gateway-routed prompt still gets OTTO tool boundary", () => {
	process.env.OTTO_GATEWAY_URL = "http://127.0.0.1:18080";

	const prompt = buildSystemPrompt({
		customPrompt: "Custom instructions",
		selectedTools: ["read"],
		cwd: "/repo",
	});

	assert.match(prompt, /Custom instructions/);
	assert.match(prompt, /Gateway tool boundary:/);
	assert.match(prompt, /Use only the OTTO tool names and schemas supplied for this request: read/);
});
