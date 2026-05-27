import { spawnSync } from "node:child_process";

const paths = [
  "src",
  "tests",
  "packages",
  "scripts",
  "docs/dev",
  "docs/user-docs",
  "docs/extension-sdk",
  "docker",
  "Dockerfile",
  "native",
  "README.md",
  "package.json",
  "package-lock.json",
];

const globArgs = [
  "--glob", "!docs/superpowers/plans/**",
  "--glob", "!docs/superpowers/specs/**",
  "--glob", "!docs/superpowers/notes/**",
  "--glob", "!**/dist/**",
  "--glob", "!**/dist-test/**",
  "--glob", "!**/*.map",
  "--glob", "!LOOP24-PATCHES.md",
  "--glob", "!scripts/branding-residue-check.mjs",
  "--glob", "!native/crates/**",
];

const legacyPrefix = "LOOP" + "24";
const oldWorkflowPrefix = "G" + "SD";
const oldWorkflowLower = "g" + "sd";

const checks = [
  {
    name: "legacy active residue",
    pattern: `${legacyPrefix}|Loop${legacyPrefix.slice(4)}|${legacyPrefix.toLowerCase()}|@${legacyPrefix.toLowerCase()}|@${legacyPrefix.toLowerCase()}-build`,
  },
  {
    name: "old workflow runtime/user-facing residue",
    pattern: `${oldWorkflowPrefix}_[A-Z0-9_]*|${oldWorkflowPrefix}_SMOKE_BINARY|\\bprocess\\.env\\.${oldWorkflowPrefix}|\\bimport\\.meta\\.env\\.${oldWorkflowPrefix}|${oldWorkflowLower}\\.db|${oldWorkflowLower}-fake|${oldWorkflowLower}-workflow|mcp__otto-workflow__${oldWorkflowLower}_|\\b${oldWorkflowLower}_(plan_milestone|task_complete|task_reopen|replan_slice|slice_complete|complete_slice|exec_search|exec|summary_save|requirement_save|requirement_update|reassess_roadmap|plan_slice|decision_save)`,
  },
  {
    name: "old expanded brand phrase",
    pattern: "Get Shit Done",
  },
];

let failed = false;
for (const check of checks) {
  const result = spawnSync("rg", ["-n", check.pattern, ...paths, ...globArgs], {
    stdio: "inherit",
    shell: false,
  });
  if (result.status === 0) {
    console.error(`Branding residue check failed: ${check.name}`);
    failed = true;
  } else if (result.status !== 1) {
    process.exit(result.status ?? 2);
  }
}

if (failed) process.exit(1);
console.log("Branding residue check passed.");
