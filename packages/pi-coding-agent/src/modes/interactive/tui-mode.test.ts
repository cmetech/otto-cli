// Project/App: LOOP24
// File Purpose: Tests for adaptive TUI mode selection and command-center layout rendering.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import stripAnsi from "strip-ansi";

import { AdaptiveLayoutComponent } from "./components/adaptive-layout.js";
import { initTheme } from "./theme/theme.js";
import { resolveTuiMode } from "./tui-mode.js";

initTheme("dark", false);

describe("resolveTuiMode", () => {
	test("explicit overrides beat auto selection", () => {
		assert.equal(
			resolveTuiMode({ terminalWidth: 60, override: "debug", workflowPhase: "validating-milestone" }),
			"debug",
		);
	});

	test("prioritizes compact layouts on narrow terminals", () => {
		assert.equal(
			resolveTuiMode({ terminalWidth: 60, override: "auto", hasBlockingError: true, workflowPhase: "validating-milestone" }),
			"compact",
		);
	});

	test("uses debug mode for blocking errors on roomy terminals", () => {
		assert.equal(resolveTuiMode({ terminalWidth: 100, hasBlockingError: true }), "debug");
	});

	test("uses validation mode for validation and completion phases", () => {
		assert.equal(resolveTuiMode({ terminalWidth: 100, workflowPhase: "validating-milestone" }), "validation");
		assert.equal(resolveTuiMode({ terminalWidth: 100, workflowPhase: "complete-milestone" }), "validation");
	});

	test("uses workflow mode when tools or non-validation phases are active", () => {
		assert.equal(resolveTuiMode({ terminalWidth: 100, activeToolCount: 1 }), "workflow");
		assert.equal(resolveTuiMode({ terminalWidth: 100, workflowPhase: "execute-phase" }), "workflow");
	});

	test("falls back to chat mode for plain conversation", () => {
		assert.equal(resolveTuiMode({ terminalWidth: 100 }), "chat");
	});
});

describe("AdaptiveLayoutComponent", () => {
	test("renders workflow layout as rounded command center without stale labels", () => {
		const layout = new AdaptiveLayoutComponent(() => ({
			override: "workflow",
			activeToolCount: 2,
			workflowPhase: "execute-task",
			sessionName: "main",
			cwd: "/Users/example/project",
		}));

		const plain = layout.render(120).map(stripAnsi);

		assert.match(plain[0], /^╭─+╮$/, "workflow layout should start with a rounded frame");
		assert.ok(plain.some((line) => line.includes("GSD Command Center")), "workflow title should render");
		assert.ok(plain.some((line) => line.includes("Status")), "status row should render");
		assert.ok(plain.some((line) => line.includes("Tools")), "tools row should render");
		assert.ok(!plain.some((line) => line.includes("signals")), "old signals title should not render");
		assert.ok(!plain.some((line) => line.includes("inspector")), "old inspector title should not render");
		assert.ok(!plain.some((line) => /\bAUTO\b/.test(line)), "command center should not imply auto-mode");
	});
});
