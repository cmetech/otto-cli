import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyIngestPath } from "./path-policy.ts";

test("rejects remote-looking paths", () => {
	assert.equal(classifyIngestPath("https://evil/x.csv", ["/tmp"]).decision, "reject");
	assert.equal(classifyIngestPath("s3://b/x.parquet", ["/tmp"]).decision, "reject");
});

test("rejects non-existent / non-file paths", () => {
	assert.equal(classifyIngestPath("/definitely/not/here.csv", ["/"]).decision, "reject");
});

test("allows a file inside an allowed root", () => {
	const root = mkdtempSync(join(tmpdir(), "root-"));
	const f = join(root, "a.csv");
	writeFileSync(f, "x\n1");
	assert.equal(classifyIngestPath(f, [root]).decision, "allow");
	rmSync(root, { recursive: true, force: true });
});

test("requires confirmation for a file outside allowed roots", () => {
	const root = mkdtempSync(join(tmpdir(), "root-"));
	const other = mkdtempSync(join(tmpdir(), "other-"));
	const f = join(other, "b.csv");
	writeFileSync(f, "x\n1");
	assert.equal(classifyIngestPath(f, [root]).decision, "confirm");
	rmSync(root, { recursive: true, force: true });
	rmSync(other, { recursive: true, force: true });
});
