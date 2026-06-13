import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveStrategy } from "../run-audit.mjs";

const FULL = `strategy: adapted-port

## Upstream intent / root cause
x
## Fork relevance
yes
## Divergence
y
## Concrete approach
z
`;

test("real run: valid guidance resolves the strategy", () => {
  const r = resolveStrategy({ guidanceText: FULL, guidancePath: "g/a.md", flags: {} });
  assert.equal(r.strategy, "adapted-port");
});

test("real run: missing guidance throws fail-fast naming the path", () => {
  assert.throws(
    () => resolveStrategy({ guidanceText: null, guidancePath: "g/abc1234.md", flags: {} }),
    /abc1234\.md/,
  );
});

test("real run: malformed new-format guidance throws fail-fast", () => {
  const bad = "strategy: adapted-port\n\n## Upstream intent\nx"; // missing relevance/divergence/approach
  assert.throws(() => resolveStrategy({ guidanceText: bad, guidancePath: "g/x.md", flags: {} }), /Divergence|Fork relevance|Concrete approach/);
});

test("--dry-run skips validation and never throws on missing guidance", () => {
  const r = resolveStrategy({ guidanceText: null, guidancePath: "g/x.md", flags: { dryRun: true } });
  assert.equal(r.strategy, null);
});

test("--skip-guidance-check bypasses fail-fast but still parses a present strategy", () => {
  const r1 = resolveStrategy({ guidanceText: null, guidancePath: "g/x.md", flags: { skipGuidanceCheck: true } });
  assert.equal(r1.strategy, null);
  const r2 = resolveStrategy({ guidanceText: FULL, guidancePath: "g/x.md", flags: { skipGuidanceCheck: true } });
  assert.equal(r2.strategy, "adapted-port");
});

test("legacy verdict-only guidance is grandfathered on a real run", () => {
  const r = resolveStrategy({ guidanceText: "verdict: do-not-port\n\nsuperseded", guidancePath: "g/x.md", flags: {} });
  assert.equal(r.strategy, "not-needed");
});
