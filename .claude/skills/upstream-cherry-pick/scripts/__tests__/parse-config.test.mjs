import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { parseConfig } from "../parse-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fix = (name) => join(__dirname, "..", "__fixtures__", name);

test("parseConfig loads a valid config", () => {
  const result = parseConfig(fix("config.valid.json"));
  assert.equal(result.version, 1);
  assert.equal(result.targetRepo, "cmetech/otto-cli");
  assert.ok(result.upstreams["pi-dev"]);
  assert.equal(result.upstreams["pi-dev"].path, "../pi");
  assert.ok(result.classifier.securityRegex instanceof RegExp);
  assert.ok(result.classifier.stabilityRegex instanceof RegExp);
  assert.deepEqual(result.classifier.skipPrefixes, [
    "chore:", "docs:", "test:", "ci:", "style:", "refactor:", "build:",
  ]);
  assert.equal(result.applicability.notApplicable.length, 1);
  assert.equal(result.applicability.notApplicable[0].id, "bun-distribution");
  assert.ok(result.applicability.notApplicable[0].matchAny.subjectRegex instanceof RegExp);
});

test("parseConfig rejects malformed regex", () => {
  assert.throws(
    () => parseConfig(fix("config.bad-regex.json")),
    /invalid regex|securityRegex/i,
  );
});

test("parseConfig rejects missing file", () => {
  assert.throws(
    () => parseConfig("/nonexistent-file.json"),
    /ENOENT|not found/i,
  );
});

test("parseConfig validates upstream entries", () => {
  const tmpPath = join(__dirname, "..", "__fixtures__", "_tmp-missing-path.json");
  writeFileSync(
    tmpPath,
    JSON.stringify({
      version: 1,
      targetRepo: "cmetech/otto-cli",
      upstreams: { broken: { ghRepo: "x/y", branch: "main" } },
      classifier: { securityRegex: ".", stabilityRegex: ".", skipPrefixes: [] },
    }),
  );
  try {
    assert.throws(
      () => parseConfig(tmpPath),
      /upstream.*path/i,
    );
  } finally {
    unlinkSync(tmpPath);
  }
});

test("parseConfig defaults absent role to lineage and preserves an explicit role", () => {
  const tmpPath = join(__dirname, "..", "__fixtures__", "_tmp-roles.json");
  writeFileSync(
    tmpPath,
    JSON.stringify({
      version: 1,
      targetRepo: "cmetech/otto-cli",
      upstreams: {
        "pi-dev": { path: "../pi", ghRepo: "earendil-works/pi", branch: "main" },
        "hermes-agent": { path: "../hermes-agent", ghRepo: "inspiration/hermes-agent", role: "inspiration" },
      },
      classifier: { securityRegex: ".", stabilityRegex: ".", skipPrefixes: [] },
    }),
  );
  try {
    const cfg = parseConfig(tmpPath);
    assert.equal(cfg.upstreams["pi-dev"].role, "lineage"); // back-compat default
    assert.equal(cfg.upstreams["hermes-agent"].role, "inspiration");
  } finally {
    unlinkSync(tmpPath);
  }
});

test("parseConfig rejects an unknown role value", () => {
  const tmpPath = join(__dirname, "..", "__fixtures__", "_tmp-bad-role.json");
  writeFileSync(
    tmpPath,
    JSON.stringify({
      version: 1,
      targetRepo: "cmetech/otto-cli",
      upstreams: { "x": { path: "../x", ghRepo: "a/b", role: "bogus" } },
      classifier: { securityRegex: ".", stabilityRegex: ".", skipPrefixes: [] },
    }),
  );
  try {
    assert.throws(() => parseConfig(tmpPath), /role.*lineage.*inspiration|invalid role/i);
  } finally {
    unlinkSync(tmpPath);
  }
});
