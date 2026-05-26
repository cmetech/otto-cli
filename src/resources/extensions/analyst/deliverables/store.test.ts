import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliverableStore } from "./store.ts";

function makeStore() {
	const root = mkdtempSync(join(tmpdir(), "analyst-deliv-"));
	return { root, store: new DeliverableStore(root) };
}

test("create() claims a folder, writes metadata + README, returns the path", async () => {
	const { root, store } = makeStore();
	const d = await store.create({ name: "Q3 Sales", description: "dashboard", type: "html-app" }, "conv-1", 0);
	assert.equal(d.slug, "q3-sales");
	assert.ok(existsSync(join(d.path, "metadata.json")));
	assert.ok(existsSync(join(d.path, "README.md")));
	const meta = JSON.parse(readFileSync(join(d.path, "metadata.json"), "utf-8"));
	assert.equal(meta.name, "Q3 Sales");
	assert.equal(meta.provenance[0].conversation, "conv-1");
	rmSync(root, { recursive: true, force: true });
});

test("slug collisions get a numeric suffix", async () => {
	const { root, store } = makeStore();
	const a = await store.create({ name: "Report", description: "x", type: "document" }, "c", 0);
	const b = await store.create({ name: "Report", description: "y", type: "document" }, "c", 0);
	assert.notEqual(a.slug, b.slug);
	rmSync(root, { recursive: true, force: true });
});

test("recordTouch() appends provenance for files written this turn", async () => {
	const { root, store } = makeStore();
	const d = await store.create({ name: "Dash", description: "x", type: "html-app" }, "c", 0);
	writeFileSync(join(d.path, "dashboard.html"), "<html></html>");
	await store.recordTouch(d.slug, "c", 1, ["dashboard.html"]);
	const meta = JSON.parse(readFileSync(join(d.path, "metadata.json"), "utf-8"));
	assert.ok(meta.files.some((f: { path: string }) => f.path === "dashboard.html"));
	assert.equal(meta.provenance[0].turns.length, 2);
	rmSync(root, { recursive: true, force: true });
});

test("list() returns deliverables newest-first", async () => {
	const { root, store } = makeStore();
	await store.create({ name: "Old", description: "x", type: "document" }, "c", 0);
	await store.create({ name: "New", description: "x", type: "document" }, "c", 0);
	const all = await store.list();
	assert.equal(all[0].name, "New");
	rmSync(root, { recursive: true, force: true });
});
