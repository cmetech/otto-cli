// the agent + packages/pi-tui/src/components/__tests__/editor.test.ts - Editor component regression tests.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Editor, type EditorTheme } from "../editor.js";
import { CURSOR_MARKER, TUI } from "../../tui.js";
import type { AutocompleteItem } from "../../autocomplete.js";
import type { Terminal } from "../../terminal.js";

function makeTerminal(): Terminal {
	return {
		isTTY: true,
		columns: 80,
		rows: 24,
		kittyProtocolActive: false,
		start() {},
		stop() {},
		drainInput: async () => {},
		write() {},
		moveBy() {},
		hideCursor() {},
		showCursor() {},
		clearLine() {},
		clearFromCursor() {},
		clearScreen() {},
		setTitle() {},
	};
}

const theme: EditorTheme = {
	borderColor: (text) => text,
	background: (text) => `[bg]${text}[/bg]`,
	selectList: {
		selectedPrefix: (text) => text,
		selectedText: (text) => text,
		description: (text) => text,
		scrollInfo: (text) => text,
		noMatch: (text) => text,
	},
};

describe("Editor", () => {
	it("clears bracketed paste state when focus is lost", () => {
		const editor = new Editor(new TUI(makeTerminal()), theme);
		editor.focused = true;

		editor.handleInput("\x1b[200~partial");
		editor.focused = false;
		editor.focused = true;
		editor.handleInput("hello");

		assert.equal(editor.getText(), "hello");
	});

	it("keeps the hardware cursor marker visible while autocomplete is open", () => {
		const editor = new Editor(new TUI(makeTerminal()), theme);
		editor.focused = true;
		editor.setText("/se");

		(editor as any).autocompleteState = "regular";
		(editor as any).autocompleteList = { render: () => [] };

		const rendered = editor.render(40).join("\n");

		assert.ok(rendered.includes(CURSOR_MARKER));
	});

	it("renders the editable body on a distinguishable input surface", () => {
		const editor = new Editor(new TUI(makeTerminal()), theme);
		editor.focused = true;

		const rendered = editor.render(24);

		assert.equal(rendered[1]?.startsWith("[bg]"), true);
		assert.equal(rendered[1]?.endsWith("[/bg]"), true);
		assert.ok(rendered[1]?.includes(CURSOR_MARKER));
	});

	it("keeps autocomplete height stable while suggestions shrink", () => {
		const editor = new Editor(new TUI(makeTerminal()), theme);
		editor.focused = true;
		editor.setText("/");

		let autocompleteRows = [
			"/otto",
			"/git",
			"/grep",
			"/go",
			"/group",
			"(1/6)",
		];
		(editor as any).autocompleteState = "regular";
		(editor as any).autocompleteList = { render: () => autocompleteRows };

		const openLength = editor.render(40).length;

		autocompleteRows = ["/otto"];
		const filteredLength = editor.render(40).length;

		assert.equal(
			filteredLength,
			openLength,
			"autocomplete should reserve rows during a completion session so filtering does not resize the TUI",
		);

		(editor as any).cancelAutocomplete();
		const closedLength = editor.render(40).length;
		assert.ok(
			closedLength < openLength,
			"autocomplete row reservation should clear when the completion session closes",
		);
	});

	it("maps kitty keypad digits to plain editor text", () => {
		const editor = new Editor(new TUI(makeTerminal()), theme);
		editor.focused = true;

		editor.handleInput("\x1b[57404;129u");

		assert.equal(editor.getText(), "5");
	});

	it("does not insert kitty keypad navigation private-use glyphs into the editor", () => {
		const editor = new Editor(new TUI(makeTerminal()), theme);
		editor.focused = true;

		editor.handleInput("\x1b[57419u");

		assert.equal(editor.getText(), "");
	});

	it("uses slash argument completions on Tab instead of forced file completion", () => {
		const editor = new Editor(new TUI(makeTerminal()), theme);
		editor.focused = true;
		editor.setText("/otto langflow ");

		let slashCalls = 0;
		let fileCalls = 0;
		const slashItems: AutocompleteItem[] = [
			{ value: "langflow status", label: "langflow status", description: "Show LangFlow connection status" },
		];

		const provider = {
			getSuggestions: () => {
				slashCalls += 1;
				return { items: slashItems, prefix: "langflow " };
			},
			getForceFileSuggestions: () => {
				fileCalls += 1;
				return { items: [{ value: "package.json", label: "package.json" }], prefix: "" };
			},
			shouldTriggerFileCompletion: () => true,
			applyCompletion: (lines: string[], cursorLine: number, cursorCol: number) => ({ lines, cursorLine, cursorCol }),
		};
		editor.setAutocompleteProvider(provider as any);

		editor.handleInput("\t");

		assert.equal(slashCalls, 1);
		assert.equal(fileCalls, 0);
		assert.equal((editor as any).autocompleteState, "regular");
		assert.equal((editor as any).autocompletePrefix, "langflow ");
	});
});
