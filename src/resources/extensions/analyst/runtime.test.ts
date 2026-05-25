import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDbSession } from "./duckdb-session.ts";
import { secureConfig } from "./secure-config.ts";
import { LocalRuntime } from "./runtime.ts";

async function makeRuntime(timeoutMs?: number) {
	const dir = mkdtempSync(join(tmpdir(), "analyst-rt-"));
	const db = await DuckDbSession.open(join(dir, "r.duckdb"), secureConfig());
	await db.exec("CREATE TABLE t (k TEXT, v INTEGER)");
	await db.exec("INSERT INTO t VALUES ('a', 10), ('b', 20)");
	return { dir, db, rt: new LocalRuntime(db, timeoutMs) };
}

test("LocalRuntime runs a SQL cell and returns a table preview", async () => {
	const { dir, db, rt } = await makeRuntime();
	const res = await rt.exec(
		{ code: "SELECT k, v FROM t ORDER BY k", lang: "sql", description: "read t", estMs: 100 },
		new AbortController().signal,
	);
	assert.equal(res.error, undefined);
	assert.ok(res.tables && res.tables.length === 1);
	assert.deepEqual(res.tables[0].columns, ["k", "v"]);
	assert.equal(res.tables[0].rows.length, 2);
	assert.ok(rt.view().length === 1, "cell recorded in transcript");
	await db.close();
	rmSync(dir, { recursive: true, force: true });
});

test("LocalRuntime captures a SQL error as CellResult.error (does not throw)", async () => {
	const { dir, db, rt } = await makeRuntime();
	const res = await rt.exec(
		{ code: "SELECT * FROM does_not_exist", lang: "sql", description: "bad", estMs: 100 },
		new AbortController().signal,
	);
	assert.ok(res.error && /does_not_exist/i.test(res.error));
	await db.close();
	rmSync(dir, { recursive: true, force: true });
});

test("LocalRuntime rejects non-sql cells in the MVP", async () => {
	const { dir, db, rt } = await makeRuntime();
	const res = await rt.exec(
		{ code: "1+1", lang: "ts", description: "ts", estMs: 100 },
		new AbortController().signal,
	);
	assert.ok(res.error && /only sql/i.test(res.error));
	await db.close();
	rmSync(dir, { recursive: true, force: true });
});

test("LocalRuntime returns an error when the signal is already aborted", async () => {
	const { dir, db, rt } = await makeRuntime();
	const ac = new AbortController();
	ac.abort();
	const res = await rt.exec({ code: "SELECT 1", lang: "sql", description: "x", estMs: 10 }, ac.signal);
	assert.ok(res.error && /abort/i.test(res.error));
	await db.close();
	rmSync(dir, { recursive: true, force: true });
});

test("LocalRuntime times out a runaway query (interrupt + error, returns promptly)", async () => {
	const { dir, db, rt } = await makeRuntime(200);
	const start = Date.now();
	const res = await rt.exec(
		{
			code: "WITH RECURSIVE r(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM r WHERE i < 100000000) SELECT count(*) AS n FROM r",
			lang: "sql",
			description: "runaway",
			estMs: 100,
		},
		new AbortController().signal,
	);
	assert.ok(res.error && /timed out/i.test(res.error), `expected timeout, got ${JSON.stringify(res)}`);
	assert.ok(Date.now() - start < 5000, "must return promptly, not wait for the full query");
	await db.close();
	rmSync(dir, { recursive: true, force: true });
});
