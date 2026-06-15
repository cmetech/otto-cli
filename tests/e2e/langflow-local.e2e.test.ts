/**
 * Local LangFlow e2e.
 *
 * Meant for LangFlow integration runs (a local LangFlow server on
 * OTTO_E2E_LANGFLOW_URL). In a hermetic CI environment without LangFlow these
 * tests SKIP (via t.skip) rather than fail — the real assertions only run when
 * LangFlow answers 2xx. Mirrors the runtime-skip pattern in migration.e2e.test.ts.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { createTmpProject, ottoSync } from "./_shared/index.ts";

const LANGFLOW_URL = process.env.OTTO_E2E_LANGFLOW_URL ?? "http://127.0.0.1:7860";
const LANGFLOW_API_KEY = process.env.OTTO_E2E_LANGFLOW_API_KEY ?? process.env.LANGFLOW_API_KEY;
const LANGFLOW_FLOW = process.env.OTTO_E2E_LANGFLOW_FLOW;

function binaryAvailable(): { ok: boolean; reason?: string } {
	const bin = process.env.OTTO_SMOKE_BINARY;
	if (!bin) return { ok: false, reason: "OTTO_SMOKE_BINARY not set; build with `npm run build:core` and re-export." };
	if (!existsSync(bin)) return { ok: false, reason: `binary not found at ${bin}` };
	return { ok: true };
}

/**
 * Probe the local LangFlow server. Returns ok:false (with a reason) when it is
 * not running or not healthy, so the e2e tests skip rather than fail in CI
 * without LangFlow. Only a 2xx version response lets the real assertions run.
 */
async function probeLangFlow(): Promise<{ ok: boolean; reason?: string }> {
	let res: Response;
	try {
		res = await fetch(`${LANGFLOW_URL.replace(/\/+$/, "")}/api/v1/version`, { signal: AbortSignal.timeout(1500) });
	} catch (err) {
		return { ok: false, reason: `LangFlow not running at ${LANGFLOW_URL} (version probe failed: ${(err as Error).message})` };
	}
	if (!res.ok) {
		return { ok: false, reason: `LangFlow version endpoint at ${LANGFLOW_URL}/api/v1/version returned ${res.status}, expected 2xx` };
	}
	return { ok: true };
}

describe("local LangFlow e2e", () => {
	const avail = binaryAvailable();
	const skipReason = avail.ok ? null : avail.reason;

	test("headless OTTO connects and prepares local LangFlow artifacts", { skip: skipReason ?? false }, async (t) => {
		const lf = await probeLangFlow();
		if (!lf.ok) return t.skip(lf.reason);
		const project = createTmpProject({ ottoWorkflowSkeleton: true });
		t.after(project.cleanup);

		const env = {
			LANGFLOW_SERVER_URL: LANGFLOW_URL,
			...(LANGFLOW_API_KEY ? { LANGFLOW_API_KEY } : {}),
		};

		const connect = ottoSync(["headless", "langflow", "connect", LANGFLOW_URL], {
			cwd: project.dir,
			timeoutMs: 30_000,
			env,
		});
		assert.equal(connect.code, 0, `connect failed: ${connect.stderrClean.slice(0, 1200)}`);

		const status = ottoSync(["headless", "langflow", "status"], {
			cwd: project.dir,
			timeoutMs: 30_000,
			env,
		});
		assert.equal(status.code, 0, `status failed: ${status.stderrClean.slice(0, 1200)}`);

		const samples = ottoSync(["headless", "langflow", "samples"], {
			cwd: project.dir,
			timeoutMs: 30_000,
			env,
		});
		assert.equal(samples.code, 0, `samples failed: ${samples.stderrClean.slice(0, 1200)}`);
		assert.ok(existsSync(`${project.dir}/.otto/langflow/samples/echo-flow.json`));
	});

	test("headless OTTO lists and runs a configured LangFlow flow", { skip: skipReason ?? false }, async (t) => {
		const lf = await probeLangFlow();
		if (!lf.ok) return t.skip(lf.reason);
		assert.ok(
			LANGFLOW_FLOW,
			"set OTTO_E2E_LANGFLOW_FLOW to a runnable flow id/name/endpoint for the local LangFlow execution e2e",
		);
		const project = createTmpProject({ ottoWorkflowSkeleton: true });
		t.after(project.cleanup);

		const env = {
			LANGFLOW_SERVER_URL: LANGFLOW_URL,
			...(LANGFLOW_API_KEY ? { LANGFLOW_API_KEY } : {}),
		};

		const flows = ottoSync(["headless", "langflow", "flows"], {
			cwd: project.dir,
			timeoutMs: 30_000,
			env,
		});
		assert.equal(flows.code, 0, `flows failed: ${flows.stderrClean.slice(0, 1200)}`);

		const run = ottoSync(["headless", "langflow", "run", LANGFLOW_FLOW, "otto langflow e2e"], {
			cwd: project.dir,
			timeoutMs: 120_000,
			env,
		});
		assert.equal(run.code, 0, `run failed: ${run.stderrClean.slice(0, 1200)}`);
		assert.ok(existsSync(`${project.dir}/.otto/langflow/runs`), "run records should be written under .otto/langflow/runs");
	});
});
