/**
 * Tests for the Windows update bootstrap script.
 *
 * The detached PowerShell script handles the EPERM cleanup warnings that
 * surface when otto.exe's locked DLLs (duckdb.dll, sharp.dll,
 * otto_engine.win32-x64.node) prevent npm from unlinking the old
 * .otto-* staging dir during a global update.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildWindowsBootstrapScript } from "../update-cmd.ts";

const baseArgs = {
	parentPid: 12345,
	installCmd: "npm install -g @cmetech/otto@latest",
	statusPath: "C:\\Users\\splunk\\.otto\\agent\\update-status.json",
	current: "1.0.7",
	latest: "1.1.1",
	startedAt: "2026-05-29T14:30:00.000Z",
};

test("bootstrap script contains the parent PID wait loop", () => {
	const script = buildWindowsBootstrapScript(baseArgs);
	assert.match(script, /Get-Process -Id 12345/);
	assert.match(script, /AddSeconds\(30\)/);
});

test("bootstrap script writes initial + final status to the given path", () => {
	const script = buildWindowsBootstrapScript(baseArgs);
	assert.match(script, /Set-Content -Path \$statusPath/);
	// Path appears literally (single-quoted PS string)
	assert.ok(script.includes("'C:\\Users\\splunk\\.otto\\agent\\update-status.json'"));
	// Both versions land in the status payload
	assert.match(script, /fromVersion\s*=\s*'1\.0\.7'/);
	assert.match(script, /toVersion\s*=\s*'1\.1\.1'/);
});

test("bootstrap script runs the supplied install command verbatim", () => {
	const script = buildWindowsBootstrapScript(baseArgs);
	// Install command appears as a bare PS statement so $LASTEXITCODE captures
	// npm's exit status.
	assert.match(script, /\nnpm install -g @cmetech\/otto@latest\n/);
	assert.match(script, /\$exitCode = \$LASTEXITCODE/);
});

test("bootstrap script sweeps orphan .otto-* staging dirs after install", () => {
	const script = buildWindowsBootstrapScript(baseArgs);
	assert.match(script, /Filter '\.otto-\*'/);
	assert.match(script, /Remove-Item -Recurse -Force/);
});

test("bootstrap script supports the bun install path", () => {
	const script = buildWindowsBootstrapScript({
		...baseArgs,
		installCmd: "bun add -g @cmetech/otto@latest",
	});
	assert.match(script, /\nbun add -g @cmetech\/otto@latest\n/);
});

test("bootstrap script escapes single quotes in path inputs", () => {
	const script = buildWindowsBootstrapScript({
		...baseArgs,
		statusPath: "C:\\Users\\o'malley\\.otto\\agent\\update-status.json",
	});
	// PowerShell single-quoted strings escape single quotes by doubling them.
	assert.ok(script.includes("'C:\\Users\\o''malley\\.otto\\agent\\update-status.json'"));
});

test("bootstrap script waits for a keypress before closing the window", () => {
	const script = buildWindowsBootstrapScript(baseArgs);
	assert.match(script, /Press any key to close/);
	assert.match(script, /\$Host\.UI\.RawUI\.ReadKey/);
});

test("bootstrap script reports a clear Done message on success", () => {
	const script = buildWindowsBootstrapScript(baseArgs);
	// User instruction must explicitly say what to do next.
	assert.match(script, /Done\. OTTO v/);
	assert.match(script, /Open any terminal and run otto/);
});
