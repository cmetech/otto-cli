// Project/App: OTTO
// File Purpose: Regression test for upstream #61 (sha 088987b) — the theme
// picker must list custom themes by their *content* `name`, not by their JSON
// file stem. Ported/adapted from upstream packages/coding-agent test, with
// otto's conventions: node:test, OTTO_CODING_AGENT_DIR env var, and built-in
// themes that carry `path: undefined`.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENV_AGENT_DIR } from "../../../config.js";
import { builtinThemes } from "./themes.js";
import {
	getAvailableThemes,
	getAvailableThemesWithPaths,
	setRegisteredThemes,
} from "./theme.js";

let tempRoot: string;
let prevAgentDir: string | undefined;

beforeEach(() => {
	tempRoot = mkdtempSync(join(tmpdir(), "otto-theme-picker-"));
	const agentDir = join(tempRoot, "agent");
	prevAgentDir = process.env[ENV_AGENT_DIR];
	process.env[ENV_AGENT_DIR] = agentDir;
	mkdirSync(join(agentDir, "themes"), { recursive: true });
	setRegisteredThemes([]);
});

afterEach(() => {
	setRegisteredThemes([]);
	rmSync(tempRoot, { recursive: true, force: true });
	if (prevAgentDir === undefined) {
		delete process.env[ENV_AGENT_DIR];
	} else {
		process.env[ENV_AGENT_DIR] = prevAgentDir;
	}
});

test("theme picker uses custom theme content names instead of file names", () => {
	// A valid custom theme reusing the built-in dark palette, but with a
	// content name ("bar") that differs from its file stem ("foo").
	const customTheme = { ...builtinThemes.dark, name: "bar" };
	const themePath = join(process.env[ENV_AGENT_DIR]!, "themes", "foo.json");
	writeFileSync(themePath, JSON.stringify(customTheme, null, 2));

	const names = getAvailableThemes();
	assert.ok(names.includes("bar"), "expected content name 'bar' to be listed");
	assert.ok(!names.includes("foo"), "expected file stem 'foo' NOT to be listed");

	const withPaths = getAvailableThemesWithPaths();
	assert.ok(
		withPaths.some((t) => t.name === "bar" && t.path === themePath),
		"expected { name: 'bar', path: <foo.json> } in getAvailableThemesWithPaths()",
	);
	assert.ok(
		!withPaths.some((t) => t.name === "foo"),
		"expected no theme named after the file stem 'foo'",
	);
});

test("theme picker keeps built-in themes with undefined path", () => {
	const withPaths = getAvailableThemesWithPaths();
	const dark = withPaths.find((t) => t.name === "dark");
	assert.ok(dark, "expected built-in 'dark' theme to be listed");
	assert.equal(dark!.path, undefined, "built-in themes must keep path: undefined");
});
