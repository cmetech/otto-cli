import { test } from "node:test";
import assert from "node:assert/strict";
import { buildListArgs, globToRegExp, filterPrs, selectPrs } from "../select-prs.mjs";

test("globToRegExp turns a head glob into an anchored matcher", () => {
  const re = globToRegExp("integration/upstream-fix-*");
  assert.ok(re.test("integration/upstream-fix-2026-05-30"));
  assert.ok(!re.test("feature/other"));
  assert.ok(!re.test("xintegration/upstream-fix-1")); // anchored
});

test("buildListArgs targets open PRs to main with the needed fields", () => {
  const args = buildListArgs("cmetech/otto-cli");
  assert.ok(args.includes("--base") && args.includes("main"));
  assert.ok(args.includes("--state") && args.includes("open"));
  assert.ok(args.join(" ").includes("number,headRefName,isDraft"));
});

test("filterPrs drops drafts and non-matching heads", () => {
  const prs = [
    { number: 64, headRefName: "integration/upstream-fix-2026-05-30", isDraft: false },
    { number: 70, headRefName: "integration/upstream-fix-2026-06-01", isDraft: true },
    { number: 71, headRefName: "feature/unrelated", isDraft: false },
  ];
  const out = filterPrs(prs, "integration/upstream-fix-*");
  assert.deepEqual(out.map((p) => p.number), [64]);
});

test("selectPrs filter mode queries list then filters", () => {
  const calls = [];
  const ghRunner = (args) => {
    calls.push(args);
    return JSON.stringify([
      { number: 64, headRefName: "integration/upstream-fix-2026-05-30", isDraft: false },
      { number: 71, headRefName: "feature/unrelated", isDraft: false },
    ]);
  };
  const r = selectPrs({ mode: "filter", filterGlob: "integration/upstream-fix-*", ghRunner });
  assert.equal(r.count, 1);
  assert.deepEqual(r.prs.map((p) => p.number), [64]);
  assert.ok(calls[0].includes("list"));
});

test("selectPrs explicit mode views each number and excludes drafts", () => {
  const ghRunner = (args) => {
    const n = Number(args[2]);
    return JSON.stringify({ number: n, headRefName: `integration/upstream-fix-${n}`, isDraft: n === 99, state: "OPEN" });
  };
  const r = selectPrs({ mode: "explicit", numbers: [64, 99], ghRunner });
  assert.deepEqual(r.prs.map((p) => p.number), [64]); // 99 is a draft, excluded
});
