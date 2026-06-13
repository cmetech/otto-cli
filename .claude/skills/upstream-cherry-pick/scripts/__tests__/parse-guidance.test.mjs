import { test } from "node:test";
import assert from "node:assert/strict";
import { validateGuidance, REQUIRED_SECTIONS } from "../parse-guidance.mjs";

const FULL = `strategy: essence-reimplement

## Upstream intent / root cause
Upstream fixed a TOCTOU race in the settings writer.

## Fork relevance
yes — our pi-coding-agent settings manager has the same window.

## Divergence
We renamed the module and use an async lock; the patch won't apply.

## Concrete approach
**Essence to preserve:** the write must be atomic under concurrent saves.
Wrap our async lock around the read-modify-write.
`;

test("REQUIRED_SECTIONS lists the four human sections", () => {
  assert.deepEqual(
    REQUIRED_SECTIONS.map((s) => s.key),
    ["intent", "relevance", "divergence", "approach"],
  );
});

test("a complete new-format guidance file validates", () => {
  const r = validateGuidance(FULL, { path: "g/abc1234.md" });
  assert.equal(r.valid, true);
  assert.equal(r.strategy, "essence-reimplement");
  assert.equal(r.source, "strategy");
  assert.deepEqual(r.errors, []);
});

test("missing guidance (null/empty) is invalid", () => {
  for (const text of [null, "", "   \n  "]) {
    const r = validateGuidance(text, { path: "g/abc1234.md" });
    assert.equal(r.valid, false);
    assert.equal(r.strategy, null);
    assert.ok(r.errors.some((e) => /missing or empty/i.test(e)));
    assert.ok(r.errors.some((e) => /g\/abc1234\.md/.test(e)), "error names the path");
  }
});

test("new-format file missing a required section is invalid and names the section", () => {
  const noDivergence = FULL.replace(/## Divergence[\s\S]*?(?=## Concrete approach)/, "");
  const r = validateGuidance(noDivergence, { path: "g/x.md" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /Divergence/i.test(e)), `errors: ${r.errors}`);
});

test("essence-reimplement without an 'Essence to preserve' statement is invalid", () => {
  const noEssence = FULL.replace(/\*\*Essence to preserve:\*\* .*/i, "Just do the thing.");
  const r = validateGuidance(noEssence, { path: "g/x.md" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /essence to preserve/i.test(e)), `errors: ${r.errors}`);
});

test("non-essence new-format file does NOT require an essence statement", () => {
  const direct = FULL
    .replace("strategy: essence-reimplement", "strategy: adapted-port")
    .replace(/\*\*Essence to preserve:\*\* .*/i, "Transcribe the guard to pi-coding-agent.");
  const r = validateGuidance(direct, { path: "g/x.md" });
  assert.equal(r.valid, true, `errors: ${r.errors}`);
  assert.equal(r.strategy, "adapted-port");
});

test("legacy verdict-only file is grandfathered (valid, no section enforcement)", () => {
  const legacy = "verdict: manual-port\n\nTarget: packages/pi-ai/src/foo.ts. Apply the same guard.";
  const r = validateGuidance(legacy, { path: "g/legacy.md" });
  assert.equal(r.valid, true, `errors: ${r.errors}`);
  assert.equal(r.strategy, "adapted-port");
  assert.equal(r.source, "verdict");
  assert.deepEqual(r.errors, []);
});

test("a file with neither strategy nor verdict line is invalid", () => {
  const r = validateGuidance("## Some heading\nprose only", { path: "g/x.md" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /strategy:.*verdict:|machine-readable/i.test(e)));
});
