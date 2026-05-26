import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";

/**
 * End-to-end check: simulate the OTTO dev gateway in front of a fake
 * Anthropic upstream. Verify that when OTTO_GATEWAY_URL is set, our
 * patched Anthropic provider produces SDK options whose baseURL targets
 * the gateway and whose auth header is bearer-style.
 *
 * We don't actually instantiate the @anthropic-ai/sdk client here — that
 * would require pulling in the real SDK and stubbing fetch. Instead we
 * verify the OPTIONS shape (the data contract between our provider and
 * the SDK) and separately verify a fetch request through the mock
 * succeeds with our bearer header.
 */

import { buildAnthropicClientOptions } from "../../../packages/pi-ai/src/providers/anthropic.js";

function makeModel(): unknown {
  return {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  };
}

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  fn: (url: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => res.end());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  try {
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("gateway routing options round-trip end-to-end (mock gateway hit)", async () => {
  // Stand up a tiny mock gateway that captures the incoming auth header
  // and returns a canned Anthropic-shape response.
  let receivedAuth: string | undefined;
  let receivedApiKey: string | undefined;
  let receivedBody = "";

  await withServer(
    (req, res) => {
      receivedAuth = req.headers["authorization"] as string | undefined;
      receivedApiKey = req.headers["x-api-key"] as string | undefined;
      req.on("data", (c) => (receivedBody += c.toString()));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "pong" }],
          model: "claude-sonnet-4",
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }));
      });
    },
    async (gatewayUrl) => {
      process.env.OTTO_GATEWAY_URL = gatewayUrl;
      process.env.OTTO_GATEWAY_TOKEN = "test-bearer-token";
      try {
        const opts = buildAnthropicClientOptions(makeModel() as never, "ignored-apikey", false) as {
          baseURL: string;
          apiKey: string | null;
          authToken: string | undefined;
        };

        // Verify the provider produced gateway-shaped options
        assert.equal(opts.baseURL, gatewayUrl);
        assert.equal(opts.apiKey, null, "x-api-key must NOT be sent when gateway-routed");
        assert.equal(opts.authToken, "test-bearer-token");

        // Send a request using fetch directly, mirroring what the SDK would do
        const res = await fetch(`${gatewayUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${opts.authToken}`,
          },
          body: JSON.stringify({ model: "claude-sonnet-4", max_tokens: 10, messages: [{ role: "user", content: "ping" }] }),
        });
        const body = (await res.json()) as { content: { text: string }[] };

        assert.equal(receivedAuth, "Bearer test-bearer-token", "gateway received our bearer token");
        assert.equal(receivedApiKey, undefined, "gateway did NOT receive an x-api-key from us");
        assert.equal(body.content[0]?.text, "pong");
        assert.ok(receivedBody.includes("ping"), "request body forwarded with our message");
      } finally {
        delete process.env.OTTO_GATEWAY_URL;
        delete process.env.OTTO_GATEWAY_TOKEN;
      }
    },
  );
});

test("absence of OTTO_GATEWAY_URL keeps the direct-to-Anthropic path", () => {
  delete process.env.OTTO_GATEWAY_URL;
  delete process.env.OTTO_GATEWAY_TOKEN;
  const opts = buildAnthropicClientOptions(makeModel() as never, "real-apikey", false) as { apiKey: string | null };
  assert.equal(opts.apiKey, "real-apikey", "apiKey is set when no gateway configured");
});
