import { test } from "node:test";
import assert from "node:assert/strict";
import { isClosedAsUnwanted, UNWANTED_CLOSE_REASON_RE } from "../issue-state.mjs";

test("isClosedAsUnwanted is true only for CLOSED + not-planned/wontfix/duplicate", () => {
  for (const reason of ["not-planned", "not planned", "wontfix", "duplicate", "DUPLICATE"]) {
    assert.equal(isClosedAsUnwanted({ data: { state: "CLOSED", stateReason: reason } }), true, reason);
  }
});

test("isClosedAsUnwanted is false for completed closes, open issues, or missing reason", () => {
  assert.equal(isClosedAsUnwanted({ data: { state: "CLOSED", stateReason: "completed" } }), false);
  assert.equal(isClosedAsUnwanted({ data: { state: "OPEN", stateReason: "" } }), false);
  assert.equal(isClosedAsUnwanted({ data: { state: "CLOSED", stateReason: "" } }), false);
  assert.equal(isClosedAsUnwanted({ data: { state: "CLOSED" } }), false); // stateReason absent
});

test("isClosedAsUnwanted accepts a raw issue object (no .data wrapper) and nullish input", () => {
  assert.equal(isClosedAsUnwanted({ state: "CLOSED", stateReason: "wontfix" }), true);
  assert.equal(isClosedAsUnwanted(null), false);
  assert.equal(isClosedAsUnwanted(undefined), false);
  assert.equal(isClosedAsUnwanted({}), false);
});

test("UNWANTED_CLOSE_REASON_RE is exported for callers that need the raw pattern", () => {
  assert.ok(UNWANTED_CLOSE_REASON_RE instanceof RegExp);
  assert.equal(UNWANTED_CLOSE_REASON_RE.test("not-planned"), true);
  assert.equal(UNWANTED_CLOSE_REASON_RE.test("completed"), false);
});
