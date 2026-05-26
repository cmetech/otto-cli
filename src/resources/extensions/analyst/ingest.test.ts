import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDbSession } from "./duckdb-session.ts";
import { secureConfig } from "./secure-config.ts";
import { ingestFile } from "./ingest.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/sales.csv", import.meta.url));

test("ingestFile loads a CSV into the LOCKED session and reports schema + sample", async () => {
	const dir = mkdtempSync(join(tmpdir(), "analyst-ingest-"));
	const db = await DuckDbSession.open(join(dir, "i.duckdb"), secureConfig());

	const result = await ingestFile(db, FIXTURE);
	assert.equal(result.table, "sales");
	assert.equal(result.rowCount, 4);
	assert.deepEqual(result.columns.map((c) => c.name).sort(), ["month", "region", "revenue"]);
	assert.equal(result.sample.length, 4);

	const totals = await db.query("SELECT region, SUM(revenue) AS total FROM sales GROUP BY region ORDER BY region");
	assert.equal(totals.length, 2);

	await db.close();
	rmSync(dir, { recursive: true, force: true });
});

test("ingestFile rejects an unsupported extension", async () => {
	const dir = mkdtempSync(join(tmpdir(), "analyst-ingest-"));
	const db = await DuckDbSession.open(join(dir, "i.duckdb"), secureConfig());
	await assert.rejects(() => ingestFile(db, "/tmp/notes.txt"), /unsupported file type/i);
	await db.close();
	rmSync(dir, { recursive: true, force: true });
});

test("ingestFile rejects remote paths (defense-in-depth)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "analyst-ingest-"));
	const db = await DuckDbSession.open(join(dir, "i.duckdb"), secureConfig());
	await assert.rejects(() => ingestFile(db, "https://evil/x.csv"), /remote/i);
	await db.close();
	rmSync(dir, { recursive: true, force: true });
});
