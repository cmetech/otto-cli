import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDbSession, sqlLiteral, quoteIdent } from "./duckdb-session.ts";
import { secureConfig } from "./secure-config.ts";

test("query returns row objects", async () => {
	const dir = mkdtempSync(join(tmpdir(), "analyst-db-"));
	const db = await DuckDbSession.open(join(dir, "a.duckdb"), secureConfig());
	await db.exec("CREATE TABLE t (id INTEGER, name TEXT)");
	await db.exec("INSERT INTO t VALUES (1, 'a'), (2, 'b')");
	const rows = await db.query("SELECT name FROM t ORDER BY id");
	assert.deepEqual(rows, [{ name: "a" }, { name: "b" }]);
	await db.close();
	rmSync(dir, { recursive: true, force: true });
});

test("data persists to disk across reopen (resume)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "analyst-db-"));
	const path = join(dir, "b.duckdb");
	const db1 = await DuckDbSession.open(path, secureConfig());
	await db1.exec("CREATE TABLE t (n INTEGER)");
	await db1.exec("INSERT INTO t VALUES (42)");
	await db1.close();
	const db2 = await DuckDbSession.open(path, secureConfig());
	const rows = await db2.query("SELECT n FROM t");
	assert.equal(Number((rows[0] as { n: number | bigint }).n), 42);
	await db2.close();
	rmSync(dir, { recursive: true, force: true });
});

test("SECURITY: locked instance blocks file/network/extension SQL", async () => {
	const dir = mkdtempSync(join(tmpdir(), "analyst-sec-"));
	const db = await DuckDbSession.open(join(dir, "s.duckdb"), secureConfig());
	await assert.rejects(() => db.query("SELECT * FROM read_csv_auto('/etc/passwd')"), /external access|not allowed|disabled/i);
	await assert.rejects(() => db.exec("INSTALL httpfs"), /.+/);
	await assert.rejects(() => db.exec(`COPY (SELECT 1) TO '${join(dir, "out.csv")}'`), /.+/);
	await assert.rejects(() => db.exec("SET enable_external_access=true"), /.+/);
	await db.close();
	rmSync(dir, { recursive: true, force: true });
});

test("loadRows creates a table and inserts JS rows without filesystem access", async () => {
	const dir = mkdtempSync(join(tmpdir(), "analyst-load-"));
	const db = await DuckDbSession.open(join(dir, "l.duckdb"), secureConfig());
	await db.loadRows(
		"t",
		[{ name: "id", type: "INTEGER" }, { name: "label", type: "VARCHAR" }],
		[{ id: 1, label: "a'b" }, { id: 2, label: "c" }],
	);
	const rows = await db.query("SELECT label FROM t ORDER BY id");
	assert.deepEqual(rows, [{ label: "a'b" }, { label: "c" }]);
	await db.close();
	rmSync(dir, { recursive: true, force: true });
});

test("sqlLiteral escapes quotes and types values; quoteIdent quotes identifiers", () => {
	assert.equal(sqlLiteral("a'b"), "'a''b'");
	assert.equal(sqlLiteral(null), "NULL");
	assert.equal(sqlLiteral(3), "3");
	assert.equal(sqlLiteral(true), "TRUE");
	assert.equal(quoteIdent('we"ird'), '"we""ird"');
});
