/**
 * Local otto-gateway e2e.
 *
 * Meant for gateway integration runs (a local otto-gateway on OTTO_E2E_GATEWAY_URL).
 * In a hermetic CI environment without the gateway these tests SKIP (via t.skip)
 * rather than fail — the real assertions only run when the gateway answers 2xx.
 * Mirrors the runtime-skip pattern in migration.e2e.test.ts.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

import { createTmpProject, ottoSync } from "./_shared/index.ts";

const GATEWAY_URL = process.env.OTTO_E2E_GATEWAY_URL ?? "http://127.0.0.1:18080";
const GATEWAY_MODEL = process.env.OTTO_E2E_GATEWAY_MODEL ?? "claude-sonnet-4";
const GATEWAY_TOKEN = process.env.OTTO_E2E_GATEWAY_TOKEN;
const GATEWAY_LOG = process.env.OTTO_E2E_GATEWAY_LOG ?? "/tmp/otto-gateway.log";

function binaryAvailable(): { ok: boolean; reason?: string } {
	const bin = process.env.OTTO_SMOKE_BINARY;
	if (!bin) return { ok: false, reason: "OTTO_SMOKE_BINARY not set; build with `npm run build:core` and re-export." };
	if (!existsSync(bin)) return { ok: false, reason: `binary not found at ${bin}` };
	return { ok: true };
}

/**
 * Probe the local otto-gateway. Returns ok:false (with a reason) when it is not
 * running or not healthy, so the e2e test skips rather than fails in CI without
 * the gateway. Only a 2xx /health response lets the real assertions run.
 */
async function probeGateway(): Promise<{ ok: boolean; reason?: string }> {
	let res: Response;
	try {
		res = await fetch(`${GATEWAY_URL.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(1500) });
	} catch (err) {
		return { ok: false, reason: `otto-gateway not running at ${GATEWAY_URL} (health probe failed: ${(err as Error).message})` };
	}
	if (!res.ok) {
		return { ok: false, reason: `otto-gateway health at ${GATEWAY_URL}/health returned ${res.status}, expected 2xx` };
	}
	return { ok: true };
}

function gatewayLogOffset(): number {
	if (!existsSync(GATEWAY_LOG)) return 0;
	return statSync(GATEWAY_LOG).size;
}

function gatewayLogSince(offset: number): string[] {
	if (!existsSync(GATEWAY_LOG)) return [];
	const raw = readFileSync(GATEWAY_LOG, "utf8").slice(offset);
	return raw.split("\n").filter((line) => line.trim().length > 0);
}

function assertSuccessfulGatewayMessagesRequest(lines: string[]): void {
	const messagePosts = lines.filter((line) => line.includes('"method":"POST"') && line.includes('"path":"/v1/messages"'));
	assert.ok(
		messagePosts.length > 0,
		`expected OTTO to send POST /v1/messages through gateway; saw new gateway log lines:\n${lines.join("\n")}`,
	);
	assert.ok(
		messagePosts.some((line) => line.includes('"status":200')),
		`expected at least one successful POST /v1/messages; saw:\n${messagePosts.join("\n")}`,
	);
}

describe("local otto-gateway e2e", () => {
	const avail = binaryAvailable();
	const skipReason = avail.ok ? null : avail.reason;

	test("headless OTTO routes chat through the local gateway", { skip: skipReason ?? false }, async (t) => {
		const gw = await probeGateway();
		if (!gw.ok) return t.skip(gw.reason);
		const logOffset = gatewayLogOffset();
		const project = createTmpProject();
		t.after(project.cleanup);

		const result = ottoSync(
			["--print", "Reply with exactly: otto-gateway-ok", "--model", GATEWAY_MODEL, "--mode", "json"],
			{
				cwd: project.dir,
				timeoutMs: 120_000,
				env: {
					OTTO_GATEWAY_URL: GATEWAY_URL,
					...(GATEWAY_TOKEN ? { OTTO_GATEWAY_TOKEN: GATEWAY_TOKEN } : {}),
					ANTHROPIC_API_KEY: GATEWAY_TOKEN ?? "otto-gateway",
				},
			},
		);

		assert.equal(result.code, 0, `expected exit 0, got ${result.code}. stderr=${result.stderrClean.slice(0, 1200)}`);
		assert.match(result.stdoutClean, /otto-gateway-ok/i, `expected gateway response in stdout, got: ${result.stdoutClean.slice(0, 1200)}`);
		assertSuccessfulGatewayMessagesRequest(gatewayLogSince(logOffset));
	});
});
