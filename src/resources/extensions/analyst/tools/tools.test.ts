import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDbSession } from "../duckdb-session.ts";
import { secureConfig } from "../secure-config.ts";
import { LocalRuntime } from "../runtime.ts";
import { DeliverableStore } from "../deliverables/store.ts";
import { createIngestTool } from "./ingest-tool.ts";
import { createScratchpadTool } from "./scratchpad-tool.ts";
import { createDeliverableTools } from "./deliverable-tools.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/sales.csv", import.meta.url));
const sig = new AbortController().signal;
const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((c) => c.text ?? "").join("\n");
const ctxWith = (confirm: () => Promise<boolean>) => ({ ui: { confirm } }) as never;

async function ctx() {
	const dir = mkdtempSync(join(tmpdir(), "analyst-tools-"));
	const db = await DuckDbSession.open(join(dir, "t.duckdb"), secureConfig());
	const rt = new LocalRuntime(db);
	const store = new DeliverableStore(join(dir, "deliverables"));
	return { dir, db, rt, store };
}

test("ingest tool loads an in-root file without confirmation", async () => {
	const c = await ctx();
	const tool = createIngestTool(() => c.db, () => [dirname(FIXTURE)]);
	const res = await tool.execute("tc", { path: FIXTURE }, sig, () => {}, ctxWith(async () => true));
	assert.match(text(res), /sales/);
	assert.match(text(res), /revenue/);
	await c.db.close();
	rmSync(c.dir, { recursive: true, force: true });
});

test("ingest tool requires confirmation for an out-of-root file and aborts when declined", async () => {
	const c = await ctx();
	const tool = createIngestTool(() => c.db, () => ["/nonexistent-root"]);
	const res = await tool.execute("tc", { path: FIXTURE }, sig, () => {}, ctxWith(async () => false));
	assert.match(text(res), /declined|outside/i);
	await c.db.close();
	rmSync(c.dir, { recursive: true, force: true });
});

test("scratchpad tool runs an inline SQL cell and returns rows", async () => {
	const c = await ctx();
	await c.db.exec("CREATE TABLE t (n INTEGER)");
	await c.db.exec("INSERT INTO t VALUES (1),(2),(3)");
	const tool = createScratchpadTool(() => c.rt, () => null);
	const res = await tool.execute(
		"tc",
		{ code: "SELECT SUM(n) AS total FROM t", description: "sum", estimated_execution_time_seconds: 1 },
		sig,
		() => {},
		undefined as never,
	);
	assert.match(text(res), /6/);
	await c.db.close();
	rmSync(c.dir, { recursive: true, force: true });
});

test("create_deliverable tool claims a folder and returns its path", async () => {
	const c = await ctx();
	const { createDeliverable } = createDeliverableTools(() => c.store, () => ({ conversation: "conv", turn: 0 }));
	const res = await createDeliverable.execute(
		"tc",
		{ name: "My Dash", description: "d", type: "html-app" },
		sig,
		() => {},
		undefined as never,
	);
	const out = text(res);
	assert.match(out, /my-dash/);
	assert.ok(existsSync(join(c.store["root"] as unknown as string, "my-dash", "metadata.json")));
	await c.db.close();
	rmSync(c.dir, { recursive: true, force: true });
});
