import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDbSession } from "./duckdb-session.ts";
import { secureConfig } from "./secure-config.ts";
import { ingestFile } from "./ingest.ts";
import { LocalRuntime } from "./runtime.ts";
import { DeliverableStore } from "./deliverables/store.ts";
import { renderDashboard } from "./deliverables/renderer.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/sales.csv", import.meta.url));

test("end-to-end: ingest -> analyze -> deliver, and data survives resume", async () => {
	const sessionDir = mkdtempSync(join(tmpdir(), "analyst-e2e-session-"));
	const deliverDir = mkdtempSync(join(tmpdir(), "analyst-e2e-deliver-"));
	const dbPath = join(sessionDir, "analysis.duckdb");

	const db = await DuckDbSession.open(dbPath, secureConfig());
	const ingest = await ingestFile(db, FIXTURE);
	assert.equal(ingest.table, "sales");

	const rt = new LocalRuntime(db);
	const res = await rt.exec(
		{
			code: "SELECT region, SUM(revenue) AS total FROM sales GROUP BY region ORDER BY region",
			lang: "sql",
			description: "totals",
			estMs: 100,
		},
		new AbortController().signal,
	);
	assert.equal(res.error, undefined);
	const regions = res.tables![0].rows.map((row) => row[0]);
	assert.deepEqual(regions, ["North", "South"]);

	const store = new DeliverableStore(deliverDir);
	const deliverable = await store.create(
		{ name: "Revenue by Region", description: "Q sales", type: "html-app", primary: "dashboard.html" },
		"conv-1",
		0,
	);
	const html = renderDashboard({
		title: "Revenue by Region",
		echartsJs: "/* echarts */",
		option: {
			xAxis: { data: regions },
			series: [{ type: "bar", data: res.tables![0].rows.map((row) => row[1]) }],
		},
	});
	writeFileSync(join(deliverable.path, "dashboard.html"), html);
	await store.recordTouch(deliverable.slug, "conv-1", 1, ["dashboard.html"]);
	assert.ok(existsSync(join(deliverable.path, "dashboard.html")));
	await db.close();

	const db2 = await DuckDbSession.open(dbPath, secureConfig());
	const rows = await db2.query("SELECT COUNT(*)::INTEGER AS n FROM sales");
	assert.equal(Number((rows[0] as { n: number }).n), 4);
	await db2.close();

	rmSync(sessionDir, { recursive: true, force: true });
	rmSync(deliverDir, { recursive: true, force: true });
});
