import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseLedger } from "../parse-ledger.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fix = join(__dirname, "..", "__fixtures__", "ledger.sample.md");

test("parseLedger extracts heavy packages from the divergence table", () => {
  const { heavyPackages } = parseLedger(fix);
  assert.ok(heavyPackages.has("packages/pi-coding-agent"));
  assert.ok(heavyPackages.has("packages/pi-tui"));
  assert.ok(!heavyPackages.has("packages/pi-ai"));
});

test("parseLedger extracts heavy files from per-file headings", () => {
  const { heavyFiles } = parseLedger(fix);
  assert.ok(heavyFiles.has("packages/pi-coding-agent/src/index.ts"));
  assert.ok(heavyFiles.has("packages/pi-coding-agent/src/core/skills.ts"));
  assert.ok(heavyFiles.has("packages/pi-coding-agent/src/core/settings-manager.ts"));
  assert.ok(heavyFiles.has("packages/pi-tui/src/components/select-list.ts"));
});

test("parseLedger returns empty sets for missing ledger", () => {
  const result = parseLedger("/nonexistent-ledger.md");
  assert.equal(result.heavyFiles.size, 0);
  assert.equal(result.heavyPackages.size, 0);
  assert.equal(result.degraded, true);
});
