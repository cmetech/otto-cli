import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectCapabilities } from "../terminal-image.js";

const ENV_KEYS = [
	"TERM",
	"TERM_PROGRAM",
	"TERMINAL_EMULATOR",
	"COLORTERM",
	"TMUX",
	"KITTY_WINDOW_ID",
	"WEZTERM_PANE",
	"ITERM_SESSION_ID",
	"GHOSTTY_RESOURCES_DIR",
	"WT_SESSION",
	"CMUX_WORKSPACE_ID",
	"CMUX_SURFACE_ID",
] as const;

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
	const saved: Record<string, string | undefined> = {};
	for (const key of ENV_KEYS) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	try {
		fn();
	} finally {
		for (const key of ENV_KEYS) {
			const original = saved[key];
			if (original === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = original;
			}
		}
	}
}

describe("detectCapabilities", () => {
	it("enables truecolor without hyperlinks for JetBrains terminal", () => {
		withEnv({ TERMINAL_EMULATOR: "JetBrains-JediTerm", TERM: "xterm-256color" }, () => {
			const caps = detectCapabilities();
			assert.strictEqual(caps.trueColor, true);
			assert.strictEqual(caps.hyperlinks, false);
			assert.strictEqual(caps.images, null);
		});
	});
});
