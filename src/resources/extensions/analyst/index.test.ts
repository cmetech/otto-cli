import test from "node:test";
import assert from "node:assert/strict";
import Analyst from "./index.ts";

test("default export registers the analyst tools and the /deliverables command", () => {
	const tools: string[] = [];
	const commands: string[] = [];
	const handlers: string[] = [];
	const fakePi = {
		registerTool: (tool: { name: string }) => tools.push(tool.name),
		registerCommand: (name: string) => commands.push(name),
		on: (event: string) => handlers.push(event),
		sendMessage: () => {},
	};

	Analyst(fakePi as never);

	for (const name of ["ingest", "scratchpad", "create_deliverable", "list_deliverables"]) {
		assert.ok(tools.includes(name), `missing tool ${name}`);
	}
	assert.ok(commands.includes("deliverables"));
	assert.ok(handlers.includes("session_start"));
	assert.ok(handlers.includes("session_shutdown"));
});
