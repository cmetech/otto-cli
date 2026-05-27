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

test("listFlows GETs /api/v1/flows/ and normalizes id, name, and endpoint", async () => {
  let receivedApiKeyHeader: string | undefined;
  await withMockServer(
    (req, res) => {
      assert.equal(req.method, "GET");
      assert.equal(req.url, "/api/v1/flows/");
      receivedApiKeyHeader = req.headers["x-api-key"] as string | undefined;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([
        { id: "flow-1", name: "Echo", endpoint_name: "echo" },
        { id: "flow-2", name: "Summarize" },
      ]));
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url, apiKey: "secret-key" });
      const flows = await client.listFlows();
      assert.equal(receivedApiKeyHeader, "secret-key");
      assert.deepEqual(flows, [
        { id: "flow-1", name: "Echo", endpointName: "echo" },
        { id: "flow-2", name: "Summarize", endpointName: undefined },
      ]);
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

test("getFlow GETs /api/v1/flows/<id> and returns parsed flow JSON", async () => {
  await withMockServer(
    (req, res) => {
      assert.equal(req.method, "GET");
      assert.equal(req.url, "/api/v1/flows/flow-1");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "flow-1", name: "Echo", data: { nodes: [], edges: [] } }));
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url });
      const flow = await client.getFlow("flow-1");
      assert.equal((flow as { id: string }).id, "flow-1");
    },
  );
});

test("updateFlow PATCHes /api/v1/flows/<id> with JSON payload", async () => {
  let receivedBody = "";
  await withMockServer(
    (req, res) => {
      assert.equal(req.method, "PATCH");
      assert.equal(req.url, "/api/v1/flows/flow-1");
      req.on("data", (chunk) => (receivedBody += chunk.toString()));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ id: "flow-1", name: "Updated" }));
      });
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url });
      const result = await client.updateFlow("flow-1", { name: "Updated" });
      assert.deepEqual(JSON.parse(receivedBody), { name: "Updated" });
      assert.equal((result as { id: string }).id, "flow-1");
    },
  );
});

test("deleteFlow DELETEs /api/v1/flows/<id>", async () => {
  await withMockServer(
    (req, res) => {
      assert.equal(req.method, "DELETE");
      assert.equal(req.url, "/api/v1/flows/flow-1");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: "Flow deleted successfully" }));
    },
    async (url) => {
      const client = new LangFlowClient({ baseUrl: url });
      const result = await client.deleteFlow("flow-1");
      assert.match(JSON.stringify(result), /deleted/i);
    },
  );
});
