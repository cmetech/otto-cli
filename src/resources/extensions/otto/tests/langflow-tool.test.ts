import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { saveConfig } from "../../../../otto-config.js";
import { makeLangFlowTool } from "../tools/langflow.js";

let tmpHome: string;
let tmpProject: string;
const ORIGINAL_OTTO_HOME = process.env.OTTO_HOME;
const ORIGINAL_LANGFLOW_SERVER_URL = process.env.LANGFLOW_SERVER_URL;
const ORIGINAL_LANGFLOW_API_KEY = process.env.LANGFLOW_API_KEY;
const ORIGINAL_OTTO_LANGFLOW_DISABLED = process.env.OTTO_LANGFLOW_DISABLED;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "otto-langflow-tool-home-"));
  tmpProject = mkdtempSync(join(tmpdir(), "otto-langflow-tool-project-"));
  process.env.OTTO_HOME = tmpHome;
  delete process.env.LANGFLOW_SERVER_URL;
  delete process.env.LANGFLOW_API_KEY;
  delete process.env.OTTO_LANGFLOW_DISABLED;
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpProject, { recursive: true, force: true });
  if (ORIGINAL_OTTO_HOME !== undefined) process.env.OTTO_HOME = ORIGINAL_OTTO_HOME;
  else delete process.env.OTTO_HOME;
  if (ORIGINAL_LANGFLOW_SERVER_URL !== undefined) process.env.LANGFLOW_SERVER_URL = ORIGINAL_LANGFLOW_SERVER_URL;
  else delete process.env.LANGFLOW_SERVER_URL;
  if (ORIGINAL_LANGFLOW_API_KEY !== undefined) process.env.LANGFLOW_API_KEY = ORIGINAL_LANGFLOW_API_KEY;
  else delete process.env.LANGFLOW_API_KEY;
  if (ORIGINAL_OTTO_LANGFLOW_DISABLED !== undefined) process.env.OTTO_LANGFLOW_DISABLED = ORIGINAL_OTTO_LANGFLOW_DISABLED;
  else delete process.env.OTTO_LANGFLOW_DISABLED;
});

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

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((part) => part.text ?? "").join("\n");
}

test("otto__langflow lists flows with a prefix filter", async () => {
  await withMockServer(
    (req, res) => {
      assert.equal(req.url, "/api/v1/flows/");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([
        { id: "flow-1", name: "otto-hello-world", endpoint_name: "otto-hello-world" },
        { id: "flow-2", name: "sales-demo", endpoint_name: "sales-demo" },
      ]));
    },
    async (url) => {
      saveConfig({
        gateway: { url: null, token: null },
        langflow: { url, apiKey: null, enabled: true },
      });

      const tool = makeLangFlowTool({ sendMessage() {} } as never);
      const result = await tool.execute(
        "tool-1",
        { action: "list_flows", prefix: "otto" },
        undefined,
        undefined,
        { cwd: tmpProject } as never,
      );

      assert.equal((result as { isError?: boolean }).isError, undefined);
      assert.match(text(result), /otto-hello-world \(flow-1\)/);
      assert.doesNotMatch(text(result), /sales-demo/);
    },
  );
});
