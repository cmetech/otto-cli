# OTTO Gateway Remote Tool Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Kiro/ACP remote tool events from being validated or executed as OTTO local tools while preserving visible TUI tool-call reporting.

**Architecture:** Add explicit remote execution metadata to `ToolCall`, classify gateway/Kiro-shaped calls as remote, and teach the agent loop to render remote tool events without local schema validation. Keep local OTTO tools unchanged and reserve schema adapters for explicit future fallback behavior.

**Tech Stack:** TypeScript, `@otto/pi-ai` shared types, `@otto/pi-agent-core` agent loop, `node:test`, existing OTTO event stream/tool execution events.

---

## File Structure

- Modify `packages/pi-ai/src/types.ts`: add optional remote execution metadata to `ToolCall`.
- Create `packages/pi-ai/src/utils/remote-tool.ts`: classify and format remote tool calls.
- Modify `packages/pi-ai/src/index.ts`: export remote-tool helpers.
- Modify `packages/pi-agent-core/src/agent-loop.ts`: short-circuit remote tool calls before local tool lookup/validation.
- Add `packages/pi-agent-core/src/remote-tool-events.test.ts`: regression tests for remote Kiro read calls and local read preservation.
- Add `packages/pi-ai/src/utils/remote-tool.test.ts`: focused tests for Kiro-shape classification and `__tool_use_purpose`.

## Task 1: Shared Remote Tool Metadata And Classifier

**Files:**
- Modify: `packages/pi-ai/src/types.ts`
- Create: `packages/pi-ai/src/utils/remote-tool.ts`
- Modify: `packages/pi-ai/src/index.ts`
- Test: `packages/pi-ai/src/utils/remote-tool.test.ts`

- [ ] **Step 1: Write the failing classifier tests**

Create `packages/pi-ai/src/utils/remote-tool.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/pi-ai/src/utils/remote-tool.test.ts
```

Expected: FAIL with module-not-found for `./remote-tool.js` or missing exports.

- [ ] **Step 3: Add remote fields to `ToolCall`**

Modify `packages/pi-ai/src/types.ts` so `ToolCall` becomes:

```ts
export interface ToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, any>;
	thoughtSignature?: string; // Google-specific: opaque signature for reusing thought context
	executionDomain?: "local" | "remote";
	remote?: {
		source: "kiro-acp";
		kind?: string;
		title?: string;
		locations?: Array<{ path?: string; line?: number; column?: number }>;
		rawInput?: Record<string, unknown>;
		purpose?: string;
	};
}
```

- [ ] **Step 4: Implement the classifier**

Create `packages/pi-ai/src/utils/remote-tool.ts`:

```ts
import type { ToolCall } from "../types.js";

export interface RemoteToolClassificationContext {
	gatewayRouted?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractLocations(args: Record<string, unknown>): Array<{ path?: string; line?: number; column?: number }> | undefined {
	const direct = args.locations;
	if (Array.isArray(direct)) {
		const locations = direct
			.filter(isRecord)
			.map((entry) => ({
				path: typeof entry.path === "string" ? entry.path : undefined,
				line: typeof entry.line === "number" ? entry.line : undefined,
				column: typeof entry.column === "number" ? entry.column : undefined,
			}))
			.filter((entry) => entry.path || entry.line !== undefined || entry.column !== undefined);
		if (locations.length > 0) return locations;
	}

	const operations = args.operations;
	if (!Array.isArray(operations)) return undefined;
	const locations = operations
		.filter(isRecord)
		.map((entry) => ({
			path: typeof entry.path === "string" ? entry.path : undefined,
		}))
		.filter((entry) => entry.path);
	return locations.length > 0 ? locations : undefined;
}

function looksLikeKiroRawInput(args: Record<string, unknown>): boolean {
	return Array.isArray(args.operations) ||
		Array.isArray(args.locations) ||
		typeof args.__tool_use_purpose === "string" ||
		isRecord(args.rawInput);
}

export function classifyRemoteToolCall(
	toolCall: ToolCall,
	context: RemoteToolClassificationContext = {},
): ToolCall {
	if (toolCall.executionDomain === "remote") return toolCall;
	if (!context.gatewayRouted) return toolCall;
	if (!looksLikeKiroRawInput(toolCall.arguments)) return toolCall;

	const purpose = typeof toolCall.arguments.__tool_use_purpose === "string"
		? toolCall.arguments.__tool_use_purpose
		: undefined;

	return {
		...toolCall,
		executionDomain: "remote",
		remote: {
			source: "kiro-acp",
			kind: toolCall.name,
			locations: extractLocations(toolCall.arguments),
			rawInput: toolCall.arguments,
			purpose,
		},
	};
}

export function formatRemoteToolResultText(toolCall: ToolCall): string {
	const remote = toolCall.remote;
	const source = remote?.source ?? "remote-agent";
	const label = remote?.title ?? `${remote?.kind ?? toolCall.name} (${toolCall.id})`;
	const lines = [`Remote tool reported by ${source}: ${label}`];
	if (remote?.purpose) lines.push(`agent stated purpose: ${remote.purpose}`);
	if (remote?.locations?.length) {
		lines.push("locations:");
		for (const location of remote.locations) {
			const suffix = [
				location.line !== undefined ? `:${location.line}` : "",
				location.column !== undefined ? `:${location.column}` : "",
			].join("");
			lines.push(`- ${location.path ?? "(unknown)"}${suffix}`);
		}
	}
	return lines.join("\n");
}
```

- [ ] **Step 5: Export the classifier**

Modify `packages/pi-ai/src/index.ts`:

```ts
export {
	classifyRemoteToolCall,
	formatRemoteToolResultText,
	type RemoteToolClassificationContext,
} from "./utils/remote-tool.js";
```

- [ ] **Step 6: Run the classifier tests**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/pi-ai/src/utils/remote-tool.test.ts
```

Expected: PASS.

## Task 2: Agent Loop Remote Tool Short-Circuit

**Files:**
- Modify: `packages/pi-agent-core/src/agent-loop.ts`
- Test: `packages/pi-agent-core/src/remote-tool-events.test.ts`

- [ ] **Step 1: Write the failing agent-loop regression tests**

Create `packages/pi-agent-core/src/remote-tool-events.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AssistantMessage, Model, Tool } from "@otto/pi-ai";
import { agentLoop } from "./agent-loop.js";
import type { AgentContext, AgentLoopConfig, AgentMessage } from "./types.js";

function model(): Model<any> {
	return { id: "gateway-model", provider: "anthropic", api: "anthropic-messages" } as Model<any>;
}

function config(message: AssistantMessage, tools: Tool[] = []): AgentLoopConfig {
	return {
		model: model(),
		getApiKey: async () => "test",
		tools,
		systemPrompt: "test",
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
	const stream = agentLoop(
		[{ role: "user", content: "read file", timestamp: Date.now() } as AgentMessage],
		context(tools),
		config(message, tools),
		undefined,
		async () => message,
	);
	return await stream.result;
}

test("remote Kiro read tool call is not validated against local read schema", async () => {
	const assistant: AssistantMessage = {
		role: "assistant",
		content: [{
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
			throw new Error("local read must not run for remote tool events");
		},
	} as unknown as Tool;

	const messages = await collect(assistant, [localReadTool]);
	const toolResult = messages.find((msg) => msg.role === "toolResult");

	assert.equal(toolResult?.role, "toolResult");
	assert.equal(toolResult?.toolName, "read");
	assert.equal(toolResult?.isError, false);
	assert.match(JSON.stringify(toolResult?.content), /Remote tool reported by kiro-acp/);
	assert.doesNotMatch(JSON.stringify(toolResult?.content), /missingProperty|path: must have required property/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/pi-agent-core/src/remote-tool-events.test.ts
```

Expected: FAIL because the remote call still goes through local tool validation/execution.

- [ ] **Step 3: Import the remote formatter**

Modify the import block in `packages/pi-agent-core/src/agent-loop.ts`:

```ts
import {
	type AssistantMessage,
	type Context,
	EventStream,
	formatRemoteToolResultText,
	streamSimple,
	type ToolResultMessage,
	validateToolArguments,
} from "@otto/pi-ai";
```

- [ ] **Step 4: Add remote preparation short-circuit**

In `prepareToolCall`, before local tool lookup:

```ts
	if (toolCall.executionDomain === "remote") {
		return {
			kind: "immediate",
			result: {
				content: [{ type: "text", text: formatRemoteToolResultText(toolCall) }],
				details: {
					executionDomain: "remote",
					remote: toolCall.remote ?? {},
				},
			},
			isError: false,
		};
	}
```

Place it before:

```ts
	const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
```

- [ ] **Step 5: Run the agent-loop regression test**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/pi-agent-core/src/remote-tool-events.test.ts
```

Expected: PASS.

## Task 3: Classify Gateway/Kiro Calls Before Execution

**Files:**
- Modify: `packages/pi-agent-core/src/agent-loop.ts`
- Test: `packages/pi-agent-core/src/remote-tool-events.test.ts`

- [ ] **Step 1: Add a failing test for unmarked Kiro-shaped gateway calls**

Append to `packages/pi-agent-core/src/remote-tool-events.test.ts`:

```ts
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
		const messages = await collect(assistant, [localReadTool]);
		const toolResult = messages.find((msg) => msg.role === "toolResult");
		assert.equal(toolResult?.isError, false);
		assert.match(JSON.stringify(toolResult?.content), /Remote tool reported by kiro-acp/);
	} finally {
		if (previous === undefined) delete process.env.OTTO_GATEWAY_URL;
		else process.env.OTTO_GATEWAY_URL = previous;
	}
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/pi-agent-core/src/remote-tool-events.test.ts
```

Expected: FAIL on schema validation for missing `path`.

- [ ] **Step 3: Import and use classifier in the agent loop**

Modify the import block in `packages/pi-agent-core/src/agent-loop.ts`:

```ts
import {
	type AssistantMessage,
	classifyRemoteToolCall,
	type Context,
	EventStream,
	formatRemoteToolResultText,
	streamSimple,
	type ToolResultMessage,
	validateToolArguments,
} from "@otto/pi-ai";
```

In `executeToolCalls`, normalize assistant content before dispatch:

```ts
	const gatewayRouted = Boolean(process.env.OTTO_GATEWAY_URL?.trim());
	const toolCalls = assistantMessage.content
		.filter((c) => c.type === "toolCall")
		.map((c) => classifyRemoteToolCall(c as AgentToolCall, { gatewayRouted })) as AgentToolCall[];
```

Use this `toolCalls` array instead of reading from `assistantMessage.content` directly.

- [ ] **Step 4: Run the remote event tests**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/pi-agent-core/src/remote-tool-events.test.ts
```

Expected: PASS.

## Task 4: Preserve Local Tool Behavior

**Files:**
- Modify: `packages/pi-agent-core/src/remote-tool-events.test.ts`

- [ ] **Step 1: Add a local tool preservation test**

Append to `packages/pi-agent-core/src/remote-tool-events.test.ts`:

```ts
test("ordinary local read call still validates and executes local tool", async () => {
	let executed = false;
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

	const localReadTool = {
		name: "read",
		description: "local read",
		parameters: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
		execute: async (_id: string, args: { path: string }) => {
			executed = true;
			assert.equal(args.path, "/repo/CLAUDE.md");
			return { content: [{ type: "text", text: "local file contents" }], details: {} };
		},
	} as unknown as Tool;

	const messages = await collect(assistant, [localReadTool]);
	const toolResult = messages.find((msg) => msg.role === "toolResult");

	assert.equal(executed, true);
	assert.equal(toolResult?.isError, false);
	assert.match(JSON.stringify(toolResult?.content), /local file contents/);
});
```

- [ ] **Step 2: Run the remote event tests**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/pi-agent-core/src/remote-tool-events.test.ts
```

Expected: PASS.

## Task 5: Verification And Build

**Files:**
- No new source files unless earlier tasks require fixes.

- [ ] **Step 1: Run focused pi-ai tests**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/pi-ai/src/utils/remote-tool.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused agent-core tests**

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/pi-agent-core/src/remote-tool-events.test.ts packages/pi-agent-core/src/agent-loop.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck for affected workspaces**

Run:

```bash
npm run build -w @otto/pi-ai
npm run build -w @otto/pi-agent-core
```

Expected: both commands exit 0.

- [ ] **Step 4: Run full build**

Run:

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 5: Manual gateway smoke test**

With `otto-gateway` and Kiro running, run the original prompt:

```text
Read the file CLAUDE.md in the current directory and tell me, verbatim, what the first line of the # Project section says.
```

Expected:

- TUI shows a tool card for the remote Kiro read event.
- No local OTTO read schema error appears.
- No `missing required property 'path'` error appears.
- The assistant receives enough remote result content to answer.

## Self-Review

- Spec coverage: Tasks cover remote metadata, classification, agent-loop execution bypass, metadata preservation, local tool preservation, and verification.
- Placeholder scan: No unfinished marker steps remain.
- Type consistency: `executionDomain`, `remote`, `classifyRemoteToolCall`, and `formatRemoteToolResultText` are named consistently across tasks.
