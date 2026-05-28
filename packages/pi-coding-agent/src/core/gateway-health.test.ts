import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
	GatewayHealthMonitor,
	formatGatewayFooterStatus,
	probeGatewayHealth,
} from "./gateway-health.js";

async function withHealthServer(
	statusCode: number,
	fn: (url: string) => Promise<void>,
): Promise<void> {
	const server: Server = createServer((req, res) => {
		if (req.url === "/health") {
			res.statusCode = statusCode;
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ status: statusCode === 200 ? "ok" : "down" }));
			return;
		}
		res.statusCode = 404;
		res.end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	try {
		await fn(`http://127.0.0.1:${port}`);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

describe("gateway health monitor", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("probes /health and reports healthy", async () => {
		await withHealthServer(200, async (url) => {
			const result = await probeGatewayHealth(url, 500);
			assert.equal(result.health, "healthy");
			assert.equal(result.mode, "gateway");
		});
	});

	it("sets fallback env when gateway is unhealthy and direct fallback is allowed", async () => {
		await withHealthServer(503, async (url) => {
			process.env.OTTO_GATEWAY_URL = url;
			const states: string[] = [];
			const monitor = new GatewayHealthMonitor({
				getActiveProviderReady: () => true,
				onStateChange: (state) => {
					if (state) states.push(`${state.mode}:${state.health}`);
				},
				intervalMs: 60_000,
				timeoutMs: 500,
			});

			await monitor.checkNow();
			monitor.stop();

			assert.equal(process.env.OTTO_GATEWAY_FORCE_DIRECT, "1");
			assert.equal(process.env.OTTO_GATEWAY_HEALTH, "unhealthy");
			assert.deepEqual(states.at(-1), "fallback:unhealthy");
		});
	});

	it("clears direct fallback env after gateway recovers", async () => {
		await withHealthServer(200, async (url) => {
			process.env.OTTO_GATEWAY_URL = url;
			process.env.OTTO_GATEWAY_FORCE_DIRECT = "1";
			const monitor = new GatewayHealthMonitor({
				getActiveProviderReady: () => true,
				intervalMs: 60_000,
				timeoutMs: 500,
			});

			await monitor.checkNow();
			monitor.stop();

			assert.equal(process.env.OTTO_GATEWAY_FORCE_DIRECT, undefined);
			assert.equal(process.env.OTTO_GATEWAY_HEALTH, "healthy");
			const state = monitor.getState();
			assert.ok(state);
			assert.equal(state.mode, "gateway");
			assert.equal(state.health, "healthy");
		});
	});

	it("formats compact footer labels with color driven by health and label by routing", () => {
		// healthy + routed: green "GW routed"
		assert.deepEqual(
			formatGatewayFooterStatus({ mode: "gateway", health: "healthy" }, { routed: true }),
			{ label: "GW routed", color: "success" },
		);
		// healthy + bypass: green "GW bypass" — GW is up, user chose to bypass
		assert.deepEqual(
			formatGatewayFooterStatus({ mode: "gateway", health: "healthy" }, { routed: false }),
			{ label: "GW bypass", color: "success" },
		);
		// unhealthy + not routing through GW: red "GW down" — config is broken even though user isn't using it
		assert.deepEqual(
			formatGatewayFooterStatus({ mode: "gateway", health: "unhealthy" }, { routed: false }),
			{ label: "GW down", color: "error" },
		);
		assert.deepEqual(
			formatGatewayFooterStatus({ mode: "gateway", health: "unhealthy" }),
			{ label: "GW down", color: "error" },
		);
		// unhealthy + forced direct: red "GW fallback" — was supposed to route, failed over
		assert.deepEqual(
			formatGatewayFooterStatus({ mode: "fallback", health: "unhealthy" }),
			{ label: "GW fallback", color: "error" },
		);
		// checking: dim "GW ..."
		assert.deepEqual(
			formatGatewayFooterStatus({ mode: "gateway", health: "checking" }),
			{ label: "GW ...", color: "dim" },
		);
	});
});
