#!/usr/bin/env node
/**
 * LOOP24 dev mock gateway.
 *
 * Transparent proxy: POST /v1/messages → https://api.anthropic.com/v1/messages
 *
 * Strips any incoming Authorization header (treats it as the gateway-side
 * credential — gateway accepts everything for local dev) and injects
 * x-api-key from ANTHROPIC_API_KEY when forwarding upstream.
 *
 * Stand-in for the real loop24-gateway's Anthropic surface (SURF-V2-01)
 * until the gateway team ships it. NOT for production use.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/dev-gateway/server.js
 *   # then in another shell:
 *   LOOP24_GATEWAY_URL=http://127.0.0.1:7250 loop24
 */

import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";

const PORT = Number(process.env.LOOP24_DEV_GATEWAY_PORT || 7250);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
	console.error("error: ANTHROPIC_API_KEY must be set so the mock gateway can forward upstream.");
	process.exit(1);
}

const UPSTREAM_HOST = "api.anthropic.com";

function logRequest(req, status) {
	const ts = new Date().toISOString();
	console.log(`[${ts}] ${req.method} ${req.url} → ${status}`);
}

const server = createServer((clientReq, clientRes) => {
	// Health probe for the LOOP24 connection-state check
	if (clientReq.method === "GET" && clientReq.url === "/health") {
		clientRes.statusCode = 200;
		clientRes.setHeader("content-type", "application/json");
		clientRes.end(JSON.stringify({ status: "ok", upstream: UPSTREAM_HOST }));
		logRequest(clientReq, 200);
		return;
	}

	if (clientReq.method !== "POST" || !clientReq.url?.startsWith("/v1/")) {
		clientRes.statusCode = 404;
		clientRes.end(JSON.stringify({ error: "not_found", path: clientReq.url }));
		logRequest(clientReq, 404);
		return;
	}

	// Build forward headers: strip Authorization, inject x-api-key + anthropic-version
	const forwardHeaders = { ...clientReq.headers };
	delete forwardHeaders.authorization;
	delete forwardHeaders.Authorization;
	delete forwardHeaders.host;
	forwardHeaders["x-api-key"] = ANTHROPIC_API_KEY;
	forwardHeaders["anthropic-version"] = forwardHeaders["anthropic-version"] || "2023-06-01";

	const upstreamReq = httpsRequest({
		hostname: UPSTREAM_HOST,
		port: 443,
		path: clientReq.url,
		method: clientReq.method,
		headers: forwardHeaders,
	}, (upstreamRes) => {
		clientRes.statusCode = upstreamRes.statusCode || 502;
		for (const [k, v] of Object.entries(upstreamRes.headers)) {
			if (v !== undefined) clientRes.setHeader(k, v);
		}
		upstreamRes.pipe(clientRes);
		logRequest(clientReq, upstreamRes.statusCode);
	});

	upstreamReq.on("error", (err) => {
		clientRes.statusCode = 502;
		clientRes.setHeader("content-type", "application/json");
		clientRes.end(JSON.stringify({ error: "upstream_error", message: String(err) }));
		logRequest(clientReq, 502);
	});

	clientReq.pipe(upstreamReq);
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`[loop24-dev-gateway] listening on http://127.0.0.1:${PORT}`);
	console.log(`[loop24-dev-gateway] forwarding to https://${UPSTREAM_HOST}`);
});
