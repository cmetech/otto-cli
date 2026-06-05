import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionBySeverity } from "../../select-issues.mjs";

const CONFIG = {
  autoMergeSeverities: ["nice-to-have-fix"],
  humanReviewSeverities: ["feature", "critical-stability"],
};

test("auto-tier and human-tier are routed end-to-end", () => {
  const records = [
    { number: 1, severity: "nice-to-have-fix", needsTriage: false },
    { number: 2, severity: "feature", needsTriage: false },
    { number: 3, severity: "critical-stability", needsTriage: false },
  ];
  const p = partitionBySeverity(records, CONFIG);
  // Auto-tier goes to the swarm's Phase B; human-tier should be flagged
  // so that the SKILL.md routes them to "pending-human-review" after their
  // fix-stage PR opens. The unit asserts only the partition shape here;
  // the SKILL.md is the runtime contract.
  assert.deepEqual(p.autoTier.map((r) => r.number), [1]);
  assert.deepEqual(p.humanTier.map((r) => r.number).sort(), [2, 3]);
});
