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
    JSON.stringify([{ number: 42, state: "OPEN", body: "tracks [sha=abc1234]" }]);
  const result = await dedupCheck({
    targetRepo: "cmetech/otto-cli",
    shaShort: "abc1234",
    ghRunner,
  });
  assert.deepEqual(result, { existing: 42, state: "OPEN" });
});

test("returns existing number and CLOSED state for a closed issue", async () => {
  const ghRunner = (_args) =>
    JSON.stringify([{ number: 99, state: "CLOSED", body: "tracks [sha=def5678]" }]);
  const result = await dedupCheck({
    targetRepo: "cmetech/otto-cli",
    shaShort: "def5678",
    ghRunner,
  });
  assert.deepEqual(result, { existing: 99, state: "CLOSED" });
});

test("ignores issues that only mention the sha in prose (not the trailer)", async () => {
  // GitHub's tokenizing search returns an issue whose body says "superseded by
  // ce0e801" even though it tracks a *different* sha. That is not a dup.
  const ghRunner = (_args) =>
    JSON.stringify([
      { number: 2, state: "OPEN", body: "tracks [sha=d0d1d8e]; superseded by ce0e801" },
    ]);
  const result = await dedupCheck({
    targetRepo: "cmetech/otto-cli",
    shaShort: "ce0e801",
    ghRunner,
  });
  assert.deepEqual(result, { existing: null, state: null });
});

test("picks the issue whose trailer matches when search returns several", async () => {
  const ghRunner = (_args) =>
    JSON.stringify([
      { number: 11, state: "OPEN", body: "tracks [sha=17e9e87]; see also 4b4641c" },
      { number: 30, state: "OPEN", body: "tracks [sha=4b4641c]" },
    ]);
  const result = await dedupCheck({
    targetRepo: "cmetech/otto-cli",
    shaShort: "4b4641c",
    ghRunner,
  });
  assert.deepEqual(result, { existing: 30, state: "OPEN" });
});
