import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALIGNMENT_VERDICTS,
  ALIGNMENT_LABELS,
  isAlignmentVerdict,
  alignmentToLabel,
  alignmentFromLabels,
  parseAlignment,
  isFeatureSeverity,
} from "../alignment.mjs";

test("the three verdicts and their labels are canonical", () => {
  assert.deepEqual(ALIGNMENT_VERDICTS, ["core", "adjacent", "out-of-scope"]);
  assert.deepEqual(ALIGNMENT_LABELS, [
    "alignment:core",
    "alignment:adjacent",
    "alignment:out-of-scope",
  ]);
});

test("isAlignmentVerdict / alignmentToLabel reject junk", () => {
  assert.equal(isAlignmentVerdict("core"), true);
  assert.equal(isAlignmentVerdict("nope"), false);
  assert.equal(alignmentToLabel("adjacent"), "alignment:adjacent");
  assert.equal(alignmentToLabel("nope"), null);
});

test("alignmentFromLabels extracts the verdict from string or object labels", () => {
  assert.equal(alignmentFromLabels(["upstream:pi-dev", "alignment:out-of-scope"]), "out-of-scope");
  assert.equal(alignmentFromLabels([{ name: "alignment:core" }]), "core");
  assert.equal(alignmentFromLabels(["severity:feature"]), null);
  assert.equal(alignmentFromLabels([{ name: "alignment:bogus" }]), null);
});

test("parseAlignment reads an `alignment:` line anywhere, case-insensitively", () => {
  assert.equal(parseAlignment("alignment: core").alignment, "core");
  assert.equal(
    parseAlignment("## Alignment\n\nAlignment: `adjacent`\n\nReason: ...").alignment,
    "adjacent",
  );
  assert.equal(parseAlignment("strategy: adapted-port\n\nno alignment here").alignment, null);
  assert.equal(parseAlignment(null).alignment, null);
  assert.equal(parseAlignment("alignment: maybe").alignment, null);
});

test("isFeatureSeverity matches FEATURE case-insensitively only", () => {
  assert.equal(isFeatureSeverity("FEATURE"), true);
  assert.equal(isFeatureSeverity("feature"), true);
  assert.equal(isFeatureSeverity("NICE_TO_HAVE_FIX"), false);
  assert.equal(isFeatureSeverity(null), false);
});
