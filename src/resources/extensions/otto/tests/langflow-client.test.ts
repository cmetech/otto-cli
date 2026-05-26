import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { LangFlowClient } from "../clients/langflow.js";

async function withMockServer(
  handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void | Promise<void>,
  fn: (url: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer((req, res) => { Promise.resolve(handler(req, res)).catch(() => res.end()); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  try {
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("getVersion returns LangFlow version string", async () => {
  await withMockServer(
    (req, res) => {
      assert.equal(req.url, "/api/v1/version");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ version: "1.9.3", main_version: "1.9.3", package: "Langflow" }));
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url });
      const v = await client.getVersion();
      assert.equal(v?.version, "1.9.3");
    },
  );
});

test("getVersion returns null when server is unreachable (short timeout)", async () => {
  // Port 1 is always closed.
  const client = new LangFlowClient({ baseUrl: "http://127.0.0.1:1", timeoutMs: 200 });
  const v = await client.getVersion();
  assert.equal(v, null);
});

test("runFlow POSTs to /api/v1/run/<flowId> with correct body shape", async () => {
  let receivedBody = "";
  let receivedApiKeyHeader: string | undefined;
  await withMockServer(
    (req, res) => {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/api/v1/run/flow-abc");
      receivedApiKeyHeader = req.headers["x-api-key"] as string | undefined;
      req.on("data", (c) => (receivedBody += c.toString()));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ outputs: [{ outputs: [{ results: { message: { text: "ok" } } }] }] }));
      });
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url, apiKey: "secret-key" });
      const result = await client.runFlow("flow-abc", { input_value: "hi" });
      assert.deepEqual(JSON.parse(receivedBody), { input_value: "hi" });
      assert.equal(receivedApiKeyHeader, "secret-key");
      assert.equal(result.text, "ok");
    },
  );
});

test("runFlow omits x-api-key header when no apiKey configured", async () => {
  let receivedApiKeyHeader: string | undefined;
  await withMockServer(
    (req, res) => {
      receivedApiKeyHeader = req.headers["x-api-key"] as string | undefined;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ outputs: [{ outputs: [{ results: { message: { text: "ok" } } }] }] }));
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url });
      await client.runFlow("flow-abc", { input_value: "hi" });
      assert.equal(receivedApiKeyHeader, undefined);
    },
  );
});

test("runFlow surfaces 4xx errors with status + body", async () => {
  await withMockServer(
    (_req, res) => {
      res.statusCode = 404;
      res.end(JSON.stringify({ detail: "Flow not found" }));
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url });
      await assert.rejects(
        () => client.runFlow("missing-flow", { input_value: "x" }),
        (err: Error) => err.message.includes("404") && err.message.includes("Flow not found"),
      );
    },
  );
});
