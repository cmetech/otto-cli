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

test("importFlow POSTs JSON to /api/v1/flows/ and returns parsed body", async () => {
  let receivedBody = "";
  let receivedMethod = "";
  let receivedUrl = "";
  let receivedContentType: string | undefined;
  await withMockServer(
    (req, res) => {
      receivedMethod = req.method ?? "";
      receivedUrl = req.url ?? "";
      receivedContentType = req.headers["content-type"] as string | undefined;
      req.on("data", (c) => (receivedBody += c.toString()));
      req.on("end", () => {
        res.statusCode = 201;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ id: "new-flow-uuid", name: "imported" }));
      });
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url });
      const payload = { name: "imported", description: "x", data: { nodes: [], edges: [] } };
      const result = await client.importFlow(payload);
      assert.equal(receivedMethod, "POST");
      assert.equal(receivedUrl, "/api/v1/flows/");
      assert.match(receivedContentType ?? "", /application\/json/);
      assert.deepEqual(JSON.parse(receivedBody), payload);
      assert.equal((result as { id: string }).id, "new-flow-uuid");
    },
  );
});

test("importFlow sends x-api-key when apiKey is configured", async () => {
  let receivedAuthHeader: string | undefined;
  await withMockServer(
    (req, res) => {
      receivedAuthHeader = req.headers["x-api-key"] as string | undefined;
      res.statusCode = 201;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "x" }));
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url, apiKey: "secret-key" });
      await client.importFlow({ name: "x", data: {} });
      assert.equal(receivedAuthHeader, "secret-key");
    },
  );
});

test("importFlow throws on 4xx with status and body in error message", async () => {
  await withMockServer(
    (_req, res) => {
      res.statusCode = 422;
      res.end(JSON.stringify({ detail: "validation error: nodes is required" }));
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url });
      await assert.rejects(
        () => client.importFlow({ bad: "payload" }),
        (err: Error) => err.message.includes("422") && err.message.includes("nodes is required"),
      );
    },
  );
});
