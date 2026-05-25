import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDeliverablesDir } from "./config.js";

test("getDeliverablesDir resolves under the agent dir, sibling to sessions", () => {
	const dir = getDeliverablesDir();
	assert.ok(dir.endsWith(join("agent", "deliverables")), `got ${dir}`);
	assert.ok(dir.startsWith(homedir()), `expected under home, got ${dir}`);
});
