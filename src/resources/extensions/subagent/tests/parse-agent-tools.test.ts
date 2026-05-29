import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAgentTools } from "../agents.js";

describe("parseAgentTools", () => {
	it("lowercases standard Claude tool names", () => {
		const result = parseAgentTools("Bash, Read, Write, Edit, Glob, Grep");
		assert.deepEqual(result, ["bash", "read", "write", "edit", "glob", "grep"]);
	});

	it("maps Claude-specific tool names to OTTO equivalents (with dedup)", () => {
		const result = parseAgentTools("AskUserQuestion, Agent, Task, WebSearch, WebFetch, Skill");
		assert.deepEqual(result, [
			"ask_user_questions",
			"subagent",
			"web_search",
			"fetch_page",
			"skill",
		]);
	});

	it("keeps unknown tools as lowercase (runtime silently drops them)", () => {
		const result = parseAgentTools("Bash, TodoWrite, SlashCommand, NotebookEdit");
		assert.deepEqual(result, ["bash", "todowrite", "slashcommand", "notebookedit"]);
	});

	it("preserves MCP tool names verbatim (already lowercase, server-scoped)", () => {
		const result = parseAgentTools("Bash, mcp__context7__*, mcp__exa__*");
		assert.deepEqual(result, ["bash", "mcp__context7__*", "mcp__exa__*"]);
	});

	it("accepts an array as well as a comma-string", () => {
		const result = parseAgentTools(["Bash", "Read", "Glob"]);
		assert.deepEqual(result, ["bash", "read", "glob"]);
	});

	it("returns undefined for empty input", () => {
		assert.equal(parseAgentTools(undefined), undefined);
		assert.equal(parseAgentTools(""), undefined);
		assert.equal(parseAgentTools([]), undefined);
	});

	it("trims whitespace and filters blank entries", () => {
		const result = parseAgentTools("  Bash , , Read  ,  ");
		assert.deepEqual(result, ["bash", "read"]);
	});

	it("dedupes after normalization (Task and Agent both map to subagent)", () => {
		const result = parseAgentTools("Task, Agent, subagent");
		assert.deepEqual(result, ["subagent"]);
	});
});
