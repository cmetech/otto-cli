#!/usr/bin/env node
/**
 * run-skill-tests.mjs — canonical test runner for the upstream-port skills.
 *
 * Recursively discovers EVERY `*.test.mjs` under any `__tests__/` directory in
 * the five upstream-port skills (incl. `__tests__/integration/`). The historical
 * regression command globbed `scripts/__tests__/*.test.mjs`, which does NOT
 * recurse into `__tests__/integration/` — that blind spot let a Phase-4 action
 * rename (`poll-ci` → `poll-ci-batch`) silently break the swarm integration tests
 * unnoticed. Use this runner as THE suite command so renames can't skip coverage.
 *
 *   node .claude/skills/_common/scripts/run-skill-tests.mjs
 *
 * Exits with the test runner's status (0 = all green).
 */
import { readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// _common/scripts → _common → skills
const SKILLS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILL_DIRS = [
  "_common",
  "upstream-cherry-pick",
  "upstream-fix",
  "upstream-merge",
  "upstream-swarm",
];

/** Recursively collect every `*.test.mjs` living under a `__tests__/` segment. */
function findTests(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // skill dir absent — skip
  }
  const out = [];
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTests(p));
    else if (entry.isFile() && entry.name.endsWith(".test.mjs") && p.includes("__tests__")) out.push(p);
  }
  return out;
}

const files = SKILL_DIRS.flatMap((d) => findTests(join(SKILLS_ROOT, d))).sort();
if (!files.length) {
  process.stderr.write("run-skill-tests: no skill tests found\n");
  process.exit(1);
}
process.stderr.write(`run-skill-tests: ${files.length} test files (incl. integration)\n`);
const res = spawnSync("node", ["--test", ...files], { stdio: "inherit" });
process.exit(res.status ?? 1);
