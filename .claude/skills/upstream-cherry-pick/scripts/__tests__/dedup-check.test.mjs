import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupCheck } from "../dedup-check.mjs";

test("returns {existing: null, state: null} when gh returns empty array", async () => {
  const ghRunner = (_args) => "[]";
  const result = await dedupCheck({
    targetRepo: "cmetech/otto-cli",
    shaShort: "abc1234",
    ghRunner,
  });
  assert.deepEqual(result, { existing: null, state: null });
});

test("returns existing number and OPEN state for an open issue", async () => {
  const ghRunner = (_args) =>
    JSON.stringify([{ number: 42, state: "OPEN" }]);
  const result = await dedupCheck({
    targetRepo: "cmetech/otto-cli",
    shaShort: "abc1234",
    ghRunner,
  });
  assert.deepEqual(result, { existing: 42, state: "OPEN" });
});

test("returns existing number and CLOSED state for a closed issue", async () => {
  const ghRunner = (_args) =>
    JSON.stringify([{ number: 99, state: "CLOSED" }]);
  const result = await dedupCheck({
    targetRepo: "cmetech/otto-cli",
    shaShort: "def5678",
    ghRunner,
  });
  assert.deepEqual(result, { existing: 99, state: "CLOSED" });
});
