import { test } from "node:test";
import assert from "node:assert/strict";
import { AssistantMessageEventStream, type AssistantMessage, type Model, type Tool } from "@otto/pi-ai";
import { agentLoop } from "./agent-loop.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage } from "./types.js";

function model(): Model<any> {
	return { id: "gateway-model", provider: "anthropic", api: "anthropic-messages" } as Model<any>;
}

function config(message: AssistantMessage, tools: Tool[] = []): AgentLoopConfig {
	return {
		model: model(),
		getApiKey: async () => "test",
		tools,
		systemPrompt: "test",
		convertToLlm: (messages: AgentMessage[]) => messages.filter((msg): msg is any => msg.role !== "custom"),
		externalToolExecution: false,
	} as unknown as AgentLoopConfig;
}

function context(tools: Tool[] = []): AgentContext {
	return {
		messages: [],
		tools,
		systemPrompt: "test",
		model: model(),
	} as unknown as AgentContext;
}

async function collect(message: AssistantMessage, tools: Tool[] = []): Promise<AgentMessage[]> {
	const finalMessage: AssistantMessage = {
		...message,
		content: [{ type: "text", text: "done" }],
		stopReason: "stop",
	};
	let callIndex = 0;
	const stream = agentLoop(
		[{ role: "user", content: "read file", timestamp: Date.now() } as AgentMessage],
		context(tools),
		config(message, tools),
		undefined,
		() => {
			const response = callIndex === 0 ? message : finalMessage;
			callIndex++;
			const responseStream = new AssistantMessageEventStream();
			queueMicrotask(() => {
				responseStream.push({ type: "start", partial: response });
				responseStream.push({ type: "done", message: response });
				responseStream.end(response);
			});
			return responseStream;
		},
	);
	return await stream.result();
}

async function collectWithStats(
	message: AssistantMessage,
	tools: Tool[] = [],
): Promise<{ messages: AgentMessage[]; events: AgentEvent[]; modelCalls: number }> {
	let callIndex = 0;
	const finalMessage: AssistantMessage = {
		...message,
		content: [{ type: "text", text: "done" }],
		stopReason: "stop",
	};
	const stream = agentLoop(
		[{ role: "user", content: "read file", timestamp: Date.now() } as AgentMessage],
		context(tools),
		config(message, tools),
		undefined,
		() => {
			const response = callIndex === 0 ? message : finalMessage;
			callIndex++;
			const responseStream = new AssistantMessageEventStream();
			queueMicrotask(() => {
				responseStream.push({ type: "start", partial: response });
				responseStream.push({ type: "done", message: response });
				responseStream.end(response);
			});
			return responseStream;
		},
	);
	const events: AgentEvent[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return { messages: await stream.result(), events, modelCalls: callIndex };
}

test("remote Kiro read tool call is not validated against local read schema", async () => {
	const assistant: AssistantMessage = {
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: "tooluse_1",
				name: "read",
				arguments: {
					operations: [{ mode: "Line", path: "/repo/CLAUDE.md" }],
					__tool_use_purpose: "Read CLAUDE.md",
				},
				executionDomain: "remote",
				remote: {
					source: "kiro-acp",
					kind: "read",
					purpose: "Read CLAUDE.md",
					locations: [{ path: "/repo/CLAUDE.md" }],
				},
			},
		],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "gateway-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "tool_use",
		timestamp: Date.now(),
	};

	const localReadTool = {
		name: "read",
		description: "local read",
		parameters: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
		execute: async () => {
			throw new Error("local read must not run for remote tool events");
		},
	} as unknown as Tool;

	const { messages, events } = await collectWithStats(assistant, [localReadTool]);

	assert.equal(messages.some((msg) => msg.role === "toolResult"), false);
	assert.equal(events.some((event) => event.type === "tool_execution_end" && event.toolName === "read"), true);
	assert.match(JSON.stringify(events), /Remote tool reported by kiro-acp/);
	assert.doesNotMatch(JSON.stringify(events), /missingProperty|path: must have required property/);
});

test("remote-only Kiro tool events are displayed without re-entering the model loop", async () => {
	const assistant: AssistantMessage = {
		role: "assistant",
		content: [
			{
				type: "text",
				text: "The first line is: # Project",
			},
			{
				type: "toolCall",
				id: "tooluse_loop",
				name: "read",
				arguments: {
					operations: [{ mode: "Line", path: "/repo/CLAUDE.md" }],
					__tool_use_purpose: "Reading CLAUDE.md to find the first line of the # Project section",
				},
				executionDomain: "remote",
				remote: {
					source: "kiro-acp",
					kind: "read",
					purpose: "Reading CLAUDE.md to find the first line of the # Project section",
					locations: [{ path: "/repo/CLAUDE.md" }],
				},
			},
		],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "gateway-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "tool_use",
		timestamp: Date.now(),
	};

	const { messages, events, modelCalls } = await collectWithStats(assistant);

	assert.equal(modelCalls, 1);
	assert.equal(messages.some((msg) => msg.role === "toolResult"), false);
	assert.equal(events.some((event) => event.type === "tool_execution_start" && event.toolName === "read"), true);
	assert.equal(events.some((event) => event.type === "tool_execution_end" && event.toolName === "read"), true);
	assert.match(JSON.stringify(events), /Remote tool reported by kiro-acp/);
});

test("duplicate same-id Kiro remote tool chunks render once", async () => {
	const assistant: AssistantMessage = {
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: "tooluse_duplicate",
				name: "read",
				arguments: {},
				executionDomain: "remote",
				remote: { source: "kiro-acp", kind: "read" },
			},
			{
				type: "toolCall",
				id: "tooluse_duplicate",
				name: "read",
				arguments: {
					operations: [{ mode: "Line", path: "/repo/CLAUDE.md" }],
					__tool_use_purpose: "Reading CLAUDE.md",
				},
				executionDomain: "remote",
				remote: {
					source: "kiro-acp",
					kind: "read",
					purpose: "Reading CLAUDE.md",
					locations: [{ path: "/repo/CLAUDE.md" }],
				},
			},
			{ type: "text", text: "The first line is: # Project" },
		],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "gateway-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "tool_use",
		timestamp: Date.now(),
	};

	const { events, modelCalls } = await collectWithStats(assistant);
	const starts = events.filter((event) => event.type === "tool_execution_start" && event.toolCallId === "tooluse_duplicate");
	const ends = events.filter((event) => event.type === "tool_execution_end" && event.toolCallId === "tooluse_duplicate");

	assert.equal(modelCalls, 1);
	assert.equal(starts.length, 1);
	assert.equal(ends.length, 1);
	assert.match(JSON.stringify(ends[0]), /Reading CLAUDE\.md/);
});

test("gateway-routed Kiro-shaped call is classified remote before validation", async () => {
	const assistant: AssistantMessage = {
		role: "assistant",
		content: [{
			type: "toolCall",
			id: "tooluse_2",
			name: "read",
			arguments: {
				operations: [{ mode: "Line", path: "/repo/CLAUDE.md" }],
				__tool_use_purpose: "Read CLAUDE.md",
			},
		}],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "gateway-model",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "tool_use",
		timestamp: Date.now(),
	};

	const localReadTool = {
		name: "read",
		description: "local read",
		parameters: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
		execute: async () => {
			throw new Error("local read must not run for gateway Kiro rawInput");
		},
	} as unknown as Tool;

	const previous = process.env.OTTO_GATEWAY_URL;
	process.env.OTTO_GATEWAY_URL = "http://127.0.0.1:18080";
	try {
		const { messages, events } = await collectWithStats(assistant, [localReadTool]);
		assert.equal(messages.some((msg) => msg.role === "toolResult"), false);
		assert.equal(events.some((event) => event.type === "tool_execution_end" && event.toolName === "read"), true);
		assert.match(JSON.stringify(events), /Remote tool reported by kiro-acp/);
	} finally {
		if (previous === undefined) delete process.env.OTTO_GATEWAY_URL;
		else process.env.OTTO_GATEWAY_URL = previous;
	}
});

test("unmarked local read still executes locally when gateway URL is set", async () => {
	const assistant: AssistantMessage = {
		role: "assistant",
		content: [{
			type: "toolCall",
			id: "tooluse_3",
			name: "read",
			arguments: { path: "/repo/CLAUDE.md" },
		}],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "gateway-model",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "tool_use",
		timestamp: Date.now(),
	};

	let executed = false;
	const localReadTool = {
		name: "read",
		description: "local read",
		parameters: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
		execute: async (_toolCallId: string, args: { path: string }) => {
			executed = true;
			assert.equal(args.path, "/repo/CLAUDE.md");
			return {
				content: [{ type: "text", text: "local file contents" }],
				details: {},
			};
		},
	} as unknown as Tool;

	const previous = process.env.OTTO_GATEWAY_URL;
	process.env.OTTO_GATEWAY_URL = "http://127.0.0.1:18080";
	try {
		const messages = await collect(assistant, [localReadTool]);
		const toolResult = messages.find((msg) => msg.role === "toolResult");
		assert.equal(executed, true);
		assert.equal(toolResult?.isError, false);
		assert.match(JSON.stringify(toolResult?.content), /local file contents/);
	} finally {
		if (previous === undefined) delete process.env.OTTO_GATEWAY_URL;
		else process.env.OTTO_GATEWAY_URL = previous;
	}
});

test("gateway stream idle timeout ends the turn with a clear error", async () => {
	const previous = process.env.OTTO_STREAM_IDLE_TIMEOUT_MS;
	process.env.OTTO_STREAM_IDLE_TIMEOUT_MS = "5";
	try {
		const stream = agentLoop(
			[{ role: "user", content: "hang", timestamp: Date.now() } as AgentMessage],
			context(),
			config({
				role: "assistant",
				content: [],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "gateway-model",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: Date.now(),
			}),
			undefined,
			() => {
				const responseStream = new AssistantMessageEventStream();
				queueMicrotask(() => {
					responseStream.push({
						type: "start",
						partial: {
							role: "assistant",
							content: [],
							api: "anthropic-messages",
							provider: "anthropic",
							model: "gateway-model",
							usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
							stopReason: "stop",
							timestamp: Date.now(),
						},
					});
				});
				return responseStream;
			},
		);

		const messages = await stream.result();
		const last = messages.at(-1) as AssistantMessage;
		assert.equal(last.stopReason, "error");
		assert.match(last.errorMessage ?? "", /Provider stream timed out after 5ms without an event/);
	} finally {
		if (previous === undefined) delete process.env.OTTO_STREAM_IDLE_TIMEOUT_MS;
		else process.env.OTTO_STREAM_IDLE_TIMEOUT_MS = previous;
	}
});

test("gateway-routed unknown tool is rejected as outside active OTTO tool list", async () => {
	const assistant: AssistantMessage = {
		role: "assistant",
		content: [{
			type: "toolCall",
			id: "tooluse_unknown",
			name: "kiro_internal_read",
			arguments: { path: "/repo/CLAUDE.md" },
		}],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "gateway-model",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "tool_use",
		timestamp: Date.now(),
	};

	const previous = process.env.OTTO_GATEWAY_URL;
	process.env.OTTO_GATEWAY_URL = "http://127.0.0.1:18080";
	try {
		const { messages, events } = await collectWithStats(assistant, []);
		const toolResult = messages.find((msg) => msg.role === "toolResult");
		assert.equal(toolResult?.isError, true);
		assert.match(JSON.stringify(toolResult?.content), /not in the active OTTO tool list/);
		assert.match(JSON.stringify(toolResult?.details), /activeTools/);
		assert.equal(events.some((event) => event.type === "tool_execution_end" && event.isError), true);
	} finally {
		if (previous === undefined) delete process.env.OTTO_GATEWAY_URL;
		else process.env.OTTO_GATEWAY_URL = previous;
	}
});
