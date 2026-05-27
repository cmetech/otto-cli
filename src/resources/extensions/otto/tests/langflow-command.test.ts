import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleLangFlowCommand } from "../commands/langflow/command.js";
import { configPath, loadConfig, saveConfig } from "../../../../otto-config.js";

let tmpHome: string;
let tmpProject: string;
const ORIGINAL_OTTO_HOME = process.env.OTTO_HOME;
const ORIGINAL_LANGFLOW_SERVER_URL = process.env.LANGFLOW_SERVER_URL;
const ORIGINAL_LANGFLOW_API_KEY = process.env.LANGFLOW_API_KEY;
const ORIGINAL_OTTO_LANGFLOW_DISABLED = process.env.OTTO_LANGFLOW_DISABLED;
const ORIGINAL_OTTO_GATEWAY_URL = process.env.OTTO_GATEWAY_URL;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "otto-langflow-home-"));
  tmpProject = mkdtempSync(join(tmpdir(), "otto-langflow-project-"));
  process.env.OTTO_HOME = tmpHome;
  delete process.env.LANGFLOW_SERVER_URL;
  delete process.env.LANGFLOW_API_KEY;
  delete process.env.OTTO_LANGFLOW_DISABLED;
  delete process.env.OTTO_GATEWAY_URL;
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
  if (ORIGINAL_OTTO_GATEWAY_URL !== undefined) process.env.OTTO_GATEWAY_URL = ORIGINAL_OTTO_GATEWAY_URL;
  else delete process.env.OTTO_GATEWAY_URL;
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

function mockContext() {
  const notifications: Array<{ message: string; type?: string }> = [];
  const statuses: Array<{ key: string; value: string | undefined }> = [];
  return {
    notifications,
    statuses,
    ctx: {
      cwd: tmpProject,
      ui: {
        notify(message: string, type?: string) { notifications.push({ message, type }); },
        setStatus(key: string, value: string | undefined) { statuses.push({ key, value }); },
      },
      async newSession() { return { cancelled: false }; },
    },
  };
}

function mockPi() {
  const messages: Array<{ content: string; display?: boolean }> = [];
  return {
    messages,
    pi: {
      sendMessage(message: { content: string; display?: boolean }) {
        messages.push(message);
      },
    },
  };
}

test("connect enables LangFlow and stores URL in secure config", async () => {
  await withMockServer(
    (req, res) => {
      assert.equal(req.url, "/api/v1/version");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ version: "1.9.3" }));
    },
    async (url) => {
      const { ctx, statuses } = mockContext();
      const { pi } = mockPi();
      await handleLangFlowCommand(`connect ${url}`, ctx as never, pi as never, tmpProject);

      const cfg = loadConfig();
      assert.equal(cfg.langflow.enabled, true);
      assert.equal(cfg.langflow.url, url);
      assert.equal(process.env.LANGFLOW_SERVER_URL, url);
      assert.ok(statuses.some((entry) => entry.key === "otto-langflow" && entry.value?.includes("LangFlow ok")));
      assert.ok(existsSync(configPath()));
    },
  );
});

test("samples copies bundled flows to .otto/langflow/samples", async () => {
  const { ctx } = mockContext();
  const { pi, messages } = mockPi();
  await handleLangFlowCommand("samples", ctx as never, pi as never, tmpProject);

  const samplePath = join(tmpProject, ".otto", "langflow", "samples", "echo-flow.json");
  assert.ok(existsSync(samplePath));
  assert.match(messages[0].content, /echo-flow\.json/);
});

test("run resolves flow name, sends input, and records output", async () => {
  await withMockServer(
    (req, res) => {
      if (req.url === "/api/v1/flows/") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify([{ id: "flow-1", name: "Echo Flow", endpoint_name: "echo" }]));
        return;
      }
      assert.equal(req.url, "/api/v1/run/flow-1");
      let body = "";
      req.on("data", (chunk) => (body += chunk.toString()));
      req.on("end", () => {
        assert.equal(JSON.parse(body).input_value, "hello");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ outputs: [{ outputs: [{ results: { message: { text: "hello" } } }] }] }));
      });
    },
    async (url) => {
      saveConfig({
        gateway: { url: null, token: null },
        langflow: { url, apiKey: null, enabled: true },
      });
      const { ctx } = mockContext();
      const { pi, messages } = mockPi();
      await handleLangFlowCommand('run "Echo Flow" hello', ctx as never, pi as never, tmpProject);

      assert.match(messages[0].content, /^hello/);
      const runsDir = join(tmpProject, ".otto", "langflow", "runs");
      assert.ok(existsSync(runsDir));
      assert.match(readFileSync(join(runsDir, readdirSync(runsDir)[0]), "utf-8"), /"flow": "flow-1"/);
    },
  );
});

test("show without a flow id emits visible usage", async () => {
  saveConfig({
    gateway: { url: null, token: null },
    langflow: { url: "http://127.0.0.1:7860", apiKey: null, enabled: true },
  });
  const { ctx } = mockContext();
  const { pi, messages } = mockPi();
  await handleLangFlowCommand("show", ctx as never, pi as never, tmpProject);

  assert.match(messages[0].content, /Usage: \/otto langflow show <flow-id-or-name>/);
  assert.match(messages[0].content, /\/otto langflow flows/);
});

test("import refuses to overwrite existing flow unless update, replace, or new is requested", async () => {
  await withMockServer(
    (req, res) => {
      assert.equal(req.url, "/api/v1/flows/");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([{ id: "flow-1", name: "Echo Flow", endpoint_name: "echo-flow" }]));
    },
    async (url) => {
      saveConfig({
        gateway: { url: null, token: null },
        langflow: { url, apiKey: null, enabled: true },
      });
      const flowPath = join(tmpProject, "echo.json");
      const payload = { name: "Echo Flow", endpoint_name: "echo-flow", data: { nodes: [], edges: [] } };
      await import("node:fs").then(({ writeFileSync }) => writeFileSync(flowPath, JSON.stringify(payload)));
      const { ctx, notifications } = mockContext();
      const { pi } = mockPi();
      await handleLangFlowCommand(`import ${flowPath}`, ctx as never, pi as never, tmpProject);

      assert.match(notifications.at(-1)?.message ?? "", /already exists/i);
      assert.match(notifications.at(-1)?.message ?? "", /--update|--replace|--new/);
    },
  );
});

test("import --update patches existing flow by name", async () => {
  const seen: string[] = [];
  await withMockServer(
    (req, res) => {
      seen.push(`${req.method} ${req.url}`);
      if (req.method === "GET" && req.url === "/api/v1/flows/") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify([{ id: "flow-1", name: "Echo Flow", endpoint_name: "echo-flow" }]));
        return;
      }
      assert.equal(req.method, "PATCH");
      assert.equal(req.url, "/api/v1/flows/flow-1");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "flow-1", name: "Echo Flow" }));
    },
    async (url) => {
      saveConfig({
        gateway: { url: null, token: null },
        langflow: { url, apiKey: null, enabled: true },
      });
      const flowPath = join(tmpProject, "echo.json");
      await import("node:fs").then(({ writeFileSync }) => writeFileSync(flowPath, JSON.stringify({
        name: "Echo Flow",
        endpoint_name: "echo-flow",
        data: { nodes: [], edges: [] },
      })));
      const { ctx, notifications } = mockContext();
      const { pi } = mockPi();
      await handleLangFlowCommand(`import ${flowPath} --update`, ctx as never, pi as never, tmpProject);

      assert.deepEqual(seen, ["GET /api/v1/flows/", "PATCH /api/v1/flows/flow-1"]);
      assert.match(notifications.at(-1)?.message ?? "", /Updated LangFlow flow flow-1/i);
    },
  );
});

test("delete requires --yes and then deletes resolved flow", async () => {
  const seen: string[] = [];
  await withMockServer(
    (req, res) => {
      seen.push(`${req.method} ${req.url}`);
      if (req.method === "GET") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify([{ id: "flow-1", name: "Echo Flow", endpoint_name: "echo" }]));
        return;
      }
      assert.equal(req.method, "DELETE");
      assert.equal(req.url, "/api/v1/flows/flow-1");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: "Flow deleted successfully" }));
    },
    async (url) => {
      saveConfig({
        gateway: { url: null, token: null },
        langflow: { url, apiKey: null, enabled: true },
      });
      const { ctx, notifications } = mockContext();
      const { pi } = mockPi();
      await handleLangFlowCommand("delete echo", ctx as never, pi as never, tmpProject);
      assert.match(notifications.at(-1)?.message ?? "", /--yes/);
      await handleLangFlowCommand("delete echo --yes", ctx as never, pi as never, tmpProject);

      assert.deepEqual(seen, ["GET /api/v1/flows/", "DELETE /api/v1/flows/flow-1"]);
      assert.match(notifications.at(-1)?.message ?? "", /Deleted LangFlow flow flow-1/);
    },
  );
});

test("export writes resolved server flow JSON to exported directory", async () => {
  await withMockServer(
    (req, res) => {
      if (req.url === "/api/v1/flows/") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify([{ id: "flow-1", name: "Echo Flow", endpoint_name: "echo" }]));
        return;
      }
      assert.equal(req.url, "/api/v1/flows/flow-1");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "flow-1", name: "Echo Flow", data: { nodes: [], edges: [] } }));
    },
    async (url) => {
      saveConfig({
        gateway: { url: null, token: null },
        langflow: { url, apiKey: null, enabled: true },
      });
      const { ctx, notifications } = mockContext();
      const { pi } = mockPi();
      await handleLangFlowCommand("export echo", ctx as never, pi as never, tmpProject);

      const exported = join(tmpProject, ".otto", "langflow", "exported", "echo-flow.json");
      assert.ok(existsSync(exported));
      assert.match(readFileSync(exported, "utf-8"), /"id": "flow-1"/);
      assert.match(notifications.at(-1)?.message ?? "", /Exported LangFlow flow flow-1/);
    },
  );
});

test("langflow build uses hardened build-flow prompt with OTTO gateway defaults", async () => {
  process.env.OTTO_GATEWAY_URL = "http://127.0.0.1:18080";
  const { ctx } = mockContext();
  const { pi, messages } = mockPi();
  await handleLangFlowCommand("build make a hello flow", ctx as never, pi as never, tmpProject);

  assert.match(messages[0].content, /OTTO GATEWAY DEFAULTS/);
  assert.match(messages[0].content, /\/v1\/messages/);
  assert.match(messages[0].content, /FLOW COMPLIANCE CHECKLIST/);
  assert.match(messages[0].content, /Chat Output must be connected/);
});
