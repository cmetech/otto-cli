import { test } from "node:test";
import assert from "node:assert/strict";
import { tallyVerdicts, formatRefuteComment, LENS_NAMES } from "../refute-panel.mjs";

const A = (lens, verdict, reason = "ok") => ({ lens, verdict, reason, confidence: 0.9, blocking: verdict === "refute" });

test("LENS_NAMES has the four lenses in expected order", () => {
  assert.deepEqual(LENS_NAMES, ["upstream-alignment", "scope-discipline", "test-quality", "blast-radius"]);
});

test("panel approves when ≥2 approve and 0 refute", () => {
  const r = tallyVerdicts([
    A("upstream-alignment", "approve"),
    A("scope-discipline", "approve"),
    A("test-quality", "abstain"),
    A("blast-radius", "abstain"),
  ]);
  assert.equal(r.panelVerdict, "approve");
  assert.equal(r.approves, 2);
  assert.equal(r.refutes, 0);
});

test("panel refutes when any refute present", () => {
  const r = tallyVerdicts([
    A("upstream-alignment", "approve"),
    A("scope-discipline", "refute", "touches unrelated file"),
    A("test-quality", "approve"),
    A("blast-radius", "approve"),
  ]);
  assert.equal(r.panelVerdict, "refute");
  assert.equal(r.refutes, 1);
});

test("panel refutes (fail-safe) when all four abstain", () => {
  const r = tallyVerdicts([
    A("upstream-alignment", "abstain"),
    A("scope-discipline", "abstain"),
    A("test-quality", "abstain"),
    A("blast-radius", "abstain"),
  ]);
  assert.equal(r.panelVerdict, "refute");
  assert.match(r.reason, /no non-abstain verdicts/);
});

test("panel refutes (fail-safe) when fewer than 2 approves", () => {
  const r = tallyVerdicts([
    A("upstream-alignment", "approve"),
    A("scope-discipline", "abstain"),
    A("test-quality", "abstain"),
    A("blast-radius", "abstain"),
  ]);
  assert.equal(r.panelVerdict, "refute");
  assert.match(r.reason, /need.*2 approve/i);
});

test("panel refutes when a lens errored (treated as abstain) and condition not met", () => {
  const r = tallyVerdicts([
    A("upstream-alignment", "approve"),
    { lens: "scope-discipline", verdict: "abstain", reason: "lens errored", confidence: 0, blocking: false },
    A("test-quality", "abstain"),
    A("blast-radius", "abstain"),
  ]);
  assert.equal(r.panelVerdict, "refute");
});

test("formatRefuteComment renders a markdown table with lens verdicts", () => {
  const verdicts = [
    A("upstream-alignment", "approve"),
    A("scope-discipline", "refute", "PR touches packages/x/y.ts which is not in upstream baf4028"),
    A("test-quality", "approve"),
    A("blast-radius", "abstain"),
  ];
  const md = formatRefuteComment(verdicts, { runId: "swarm-run-3" });
  assert.match(md, /Refute panel blocked/);
  assert.match(md, /upstream-alignment.*approve/);
  assert.match(md, /scope-discipline.*refute/);
  assert.match(md, /PR touches packages\/x\/y\.ts/);
  assert.match(md, /Run id: swarm-run-3/);
});
