import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyApplicability } from "../classify-applicability.mjs";

const bunRule = {
  id: "bun-distribution",
  reason: "OTTO is npm-only.",
  matchAny: {
    subjectRegex: /\b(bun build|bun --compile)\b/i,
    filePathRegex: /(bun\.config|\.bunfig)/,
  },
};

const ciRule = {
  id: "upstream-ci-only",
  reason: "Upstream CI workflows.",
  matchAll: {
    subjectRegex: /\b(ci|workflow)\b/i,
    filePathRegex: /^\.github\/workflows\//,
  },
};

const rules = [bunRule, ciRule];

test("matches matchAny via subjectRegex", () => {
  const result = classifyApplicability(
    { subject: "feat: add bun build pipeline", body: "", touchedFiles: ["src/foo.ts"] },
    rules,
  );
  assert.equal(result.applicable, false);
  assert.equal(result.ruleId, "bun-distribution");
});

test("matches matchAny via filePathRegex (all files match)", () => {
  const result = classifyApplicability(
    { subject: "update config", body: "", touchedFiles: ["bun.config.ts", ".bunfig"] },
    rules,
  );
  assert.equal(result.applicable, false);
  assert.equal(result.ruleId, "bun-distribution");
});

test("matchAll requires both subject AND files", () => {
  const subjOnly = classifyApplicability(
    { subject: "ci: tweak", body: "", touchedFiles: ["src/foo.ts"] },
    rules,
  );
  assert.equal(subjOnly.applicable, true, "subject alone should not match matchAll");

  const both = classifyApplicability(
    { subject: "ci: tweak workflow", body: "", touchedFiles: [".github/workflows/release.yml"] },
    rules,
  );
  assert.equal(both.applicable, false);
  assert.equal(both.ruleId, "upstream-ci-only");
});

test("mixed-file commits stay APPLICABLE under matchAny filePath", () => {
  const result = classifyApplicability(
    { subject: "wip", body: "", touchedFiles: ["bun.config.ts", "src/real-otto-file.ts"] },
    rules,
  );
  assert.equal(result.applicable, true, "must remain APPLICABLE if any file is OTTO-owned");
});

test("no rules → always APPLICABLE", () => {
  const result = classifyApplicability(
    { subject: "feat: anything", body: "", touchedFiles: ["x.ts"] },
    [],
  );
  assert.equal(result.applicable, true);
  assert.equal(result.ruleId, undefined);
});
