import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreConflictRisk } from "../score-conflict-risk.mjs";

const ledger = {
  heavyFiles: new Set([
    "packages/pi-coding-agent/src/core/settings-manager.ts",
    "packages/pi-tui/src/components/select-list.ts",
  ]),
  heavyPackages: new Set(["packages/pi-coding-agent", "packages/pi-tui"]),
};

test("NONE when no file lives under packages/pi-*", () => {
  const result = scoreConflictRisk(
    { touchedFiles: ["src/cli.ts", "docs/foo.md"], locByFile: {} },
    ledger,
  );
  assert.equal(result.risk, "NONE");
});

test("LOW when touches pi-* but not a HeavyFile", () => {
  const result = scoreConflictRisk(
    { touchedFiles: ["packages/pi-ai/src/foo.ts"], locByFile: { "packages/pi-ai/src/foo.ts": 5 } },
    ledger,
  );
  assert.equal(result.risk, "LOW");
});

test("MEDIUM when touches a HeavyFile with small LOC", () => {
  const result = scoreConflictRisk(
    {
      touchedFiles: ["packages/pi-coding-agent/src/core/settings-manager.ts"],
      locByFile: { "packages/pi-coding-agent/src/core/settings-manager.ts": 20 },
    },
    ledger,
  );
  assert.equal(result.risk, "MEDIUM");
});

test("HIGH when touches a HeavyFile with >50 LOC", () => {
  const result = scoreConflictRisk(
    {
      touchedFiles: ["packages/pi-tui/src/components/select-list.ts"],
      locByFile: { "packages/pi-tui/src/components/select-list.ts": 120 },
    },
    ledger,
  );
  assert.equal(result.risk, "HIGH");
});

test("reason explains the score", () => {
  const r = scoreConflictRisk(
    { touchedFiles: ["packages/pi-coding-agent/src/core/settings-manager.ts"], locByFile: { "packages/pi-coding-agent/src/core/settings-manager.ts": 200 } },
    ledger,
  );
  assert.match(r.reason, /settings-manager\.ts|>50 LOC|HeavyFile/i);
});
