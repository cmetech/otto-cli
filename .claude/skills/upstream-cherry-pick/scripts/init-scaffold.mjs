#!/usr/bin/env node
/**
 * init-scaffold.mjs — first-run scaffold for upstream-cherry-pick.
 *
 * Writes:
 *   .planning/upstream-sync-config.json
 *   .planning/upstream-sync-state.json
 * Then calls ensureLabels() to provision the 18-label taxonomy on the target repo.
 *
 * CLI:
 *   node init-scaffold.mjs [--non-interactive] [--overwrite]
 *
 * As module:
 *   import { initScaffold } from "./init-scaffold.mjs"
 *   const { configPath, statePath, labelsResult } = await initScaffold({ ... })
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { ensureLabels } from "./ensure-labels.mjs";

// ─── Canonical defaults ───────────────────────────────────────────────────────

const DEFAULT_TARGET_REPO = "cmetech/otto-cli";
const DEFAULT_DIVERGENCE_LEDGER = "docs/UPSTREAM-SYNC.md";

const DEFAULT_UPSTREAMS = {
  "pi-dev": {
    path: "../pi",
    ghRepo: "earendil-works/pi",
    branch: "main",
    label: "earendil-works/pi (pi-dev)",
    role: "lineage",
  },
  "gsd-pi": {
    path: "../gsd-pi",
    ghRepo: "open-gsd/gsd-pi",
    branch: "main",
    label: "open-gsd/gsd-pi",
    role: "lineage",
  },
};

// Reference-only sibling repos (OTTO-ALIGNMENT.md §4): cloned locally so
// subagents can read their source while DESIGNING a co-worker feature, but
// NEVER audited and NEVER cherry-picked. ghRepo is registration-only (these are
// never gh-queried). Anton is AGPL-3.0 — reimplement the concept, don't vendor.
const DEFAULT_INSPIRATION = {
  "hermes-agent": {
    path: "../hermes-agent",
    ghRepo: "inspiration/hermes-agent",
    branch: "main",
    label: "Nous Research / hermes-agent (inspiration)",
    role: "inspiration",
  },
  "anton": {
    path: "../anton",
    ghRepo: "mindsdb/anton",
    branch: "main",
    label: "MindsDB / anton (inspiration — AGPL-3.0, reimplement)",
    role: "inspiration",
  },
  "mempalace": {
    path: "../mempalace",
    ghRepo: "inspiration/mempalace",
    branch: "main",
    label: "mempalace (inspiration)",
    role: "inspiration",
  },
};

const DEFAULT_ISSUE_FILING = {
  ccUser: "@claude",
  defaultStatusLabel: "status:triaged",
  filePolicy: {
    CRITICAL_SECURITY: "always",
    CRITICAL_STABILITY: "always",
    NICE_TO_HAVE_FIX: "always",
    FEATURE: "always",
    SKIP: "never",
  },
};

const DEFAULT_CLASSIFIER = {
  securityRegex:
    "(?i)\\b(cve|vulnerab|auth\\s*bypass|sandbox\\s*escape|secret\\s*leak|exfiltr|rce|injection|xss|csrf)\\b",
  stabilityRegex:
    "(?i)\\b(crash|hang|oom|infinite\\s*loop|data\\s*loss|corrupt|lockup|deadlock|panic|unrecover)\\b",
  skipPrefixes: ["chore:", "docs:", "test:", "ci:", "style:", "refactor:", "build:"],
};

const DEFAULT_NOT_APPLICABLE = [
  {
    id: "bun-distribution",
    reason:
      "OTTO decided 2026-05-29 to stay npm-only (CHANGELOG v1.1.0 era discussion). Bun support already exists for install-via-bun users; we don't build or distribute bun binaries.",
    matchAny: {
      subjectRegex: "(?i)\\b(bun build|bun --compile|bun upgrade|bun install)\\b",
      filePathRegex: "(bun\\.config|\\.bunfig|bun-build|/bun/)",
      labels: ["bun", "distribution:bun"],
    },
  },
  {
    id: "upstream-ci-only",
    reason:
      "Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise.",
    matchAll: {
      filePathRegex: "^\\.github/workflows/",
      subjectRegex: "(?i)\\b(ci|workflow|gha|github\\s*action)\\b",
    },
  },
  {
    id: "upstream-docs-site",
    reason:
      "Changes to upstream's docs site (Astro/Starlight setup, deployment hooks). OTTO doesn't host a docs site; user-facing docs live in CHANGELOG.md and HARNESS-COMPAT.md.",
    matchAll: {
      filePathRegex: "^(docs-site|website|astro\\.config|starlight\\.config)/",
    },
  },
  {
    id: "upstream-release-tooling",
    reason:
      "Changes to upstream's release/publish/changelog-generator tooling. OTTO has its own scripts/bump-version.mjs, scripts/sync-release-notes.mjs, etc.",
    matchAll: {
      filePathRegex: "^scripts/(release|publish|changelog|bump-)",
      subjectRegex: "(?i)\\b(release|publish|changelog|version\\s*bump)\\b",
    },
  },
  {
    id: "upstream-rebrand",
    reason:
      "Changes to pi-dev's branding (logo, package names, etc.) that OTTO has already overridden with its own brand pipeline (scripts/sync-brand-colors.mjs).",
    matchAny: {
      subjectRegex: "(?i)\\b(rebrand|logo|brand color|package name)\\b",
      filePathRegex: "(brand-colors|brand\\.config|assets/logo)",
    },
  },
];

const DEFAULT_STARTING_COMMITS = {
  "pi-dev": "v0.75.4",
  "gsd-pi": "v1.0.1",
};

// ─── Default promptUser using readline/promises ───────────────────────────────

function makeDefaultPrompter() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return {
    prompt: async ({ message, default: def }) => {
      const display = def !== undefined ? `${message} [${def}]: ` : `${message}: `;
      const answer = await rl.question(display);
      if (!answer.trim()) return def ?? "";
      return answer.trim();
    },
    close: () => rl.close(),
  };
}

// ─── Core implementation ──────────────────────────────────────────────────────

/**
 * Scaffold the upstream-cherry-pick config and state files, then provision labels.
 *
 * @param {object} opts
 * @param {string}   [opts.cwd]            - working directory (defaults to process.cwd())
 * @param {boolean}  [opts.nonInteractive] - skip all prompts; use defaults
 * @param {boolean}  [opts.overwrite]      - overwrite existing config (default false)
 * @param {Function} [opts.ghRunner]       - injectable gh CLI runner
 * @param {Function} [opts.cmdRunner]      - injectable cmd runner (unused; reserved for future use)
 * @param {Function} [opts.promptUser]     - injectable prompt: ({ message, default }) => Promise<string>
 * @returns {Promise<{ configPath: string, statePath: string, labelsResult: object }>}
 */
export async function initScaffold({
  cwd = process.cwd(),
  nonInteractive = false,
  overwrite = false,
  ghRunner,
  cmdRunner, // eslint-disable-line no-unused-vars
  promptUser,
} = {}) {
  const planningDir = join(cwd, ".planning");
  const configPath = join(planningDir, "upstream-sync-config.json");
  const statePath = join(planningDir, "upstream-sync-state.json");

  // ── Guard: refuse to overwrite unless --overwrite ──────────────────────────
  if (existsSync(configPath) && !overwrite) {
    throw new Error(
      `Config already exists at ${configPath}. Pass overwrite: true (or --overwrite) to replace it.`,
    );
  }

  let config;
  let stateUpstreams;

  if (nonInteractive) {
    // ── Non-interactive: use all defaults ──────────────────────────────────
    config = {
      version: 1,
      targetRepo: DEFAULT_TARGET_REPO,
      divergenceLedger: DEFAULT_DIVERGENCE_LEDGER,
      upstreams: { ...DEFAULT_UPSTREAMS, ...DEFAULT_INSPIRATION },
      issueFiling: DEFAULT_ISSUE_FILING,
      classifier: DEFAULT_CLASSIFIER,
      applicability: {
        notApplicable: DEFAULT_NOT_APPLICABLE,
      },
    };

    stateUpstreams = {};
    for (const [name, startCommit] of Object.entries(DEFAULT_STARTING_COMMITS)) {
      stateUpstreams[name] = { lastAnalyzedCommit: startCommit };
    }
  } else {
    // ── Interactive: prompt the user ───────────────────────────────────────
    let prompter;
    let closePrompter = () => {};

    if (promptUser) {
      // Injected prompter (testing / custom integration)
      prompter = { prompt: promptUser, close: () => {} };
    } else {
      // Default readline prompter
      const p = makeDefaultPrompter();
      prompter = p;
      closePrompter = () => p.close();
    }

    try {
      const targetRepo = await prompter.prompt({
        message: "Target repo",
        default: DEFAULT_TARGET_REPO,
      });

      const divergenceLedger = await prompter.prompt({
        message: "Divergence ledger path",
        default: DEFAULT_DIVERGENCE_LEDGER,
      });

      const upstreams = {};
      stateUpstreams = {};

      // Ask about each default upstream
      for (const [name, defaults] of Object.entries(DEFAULT_UPSTREAMS)) {
        const trackAnswer = await prompter.prompt({
          message: `Track ${name} at ${defaults.path}? [Y/n]`,
          default: "y",
        });
        const shouldTrack = !trackAnswer || /^y/i.test(trackAnswer);

        if (shouldTrack) {
          const path = await prompter.prompt({
            message: `  Path to ${name} local clone`,
            default: defaults.path,
          });
          const ghRepo = await prompter.prompt({
            message: `  GitHub repo for ${name}`,
            default: defaults.ghRepo,
          });
          const branch = await prompter.prompt({
            message: `  Default branch for ${name}`,
            default: defaults.branch,
          });
          const startCommit = await prompter.prompt({
            message: `  Starting commit (lastAnalyzedCommit) for ${name}`,
            default: DEFAULT_STARTING_COMMITS[name] ?? "",
          });

          upstreams[name] = {
            path,
            ghRepo,
            branch,
            label: defaults.label,
          };
          stateUpstreams[name] = { lastAnalyzedCommit: startCommit };
        }
      }

      // Always register the reference-only inspiration repos (not prompted —
      // they are never audited; the user can delete entries from the config).
      for (const [name, defaults] of Object.entries(DEFAULT_INSPIRATION)) {
        upstreams[name] = { ...defaults };
      }

      // Ask whether to add more upstreams
      let addMore = true;
      while (addMore) {
        const moreAnswer = await prompter.prompt({
          message: "Add another upstream? [y/N]",
          default: "n",
        });
        addMore = /^y/i.test(moreAnswer);

        if (addMore) {
          const newName = await prompter.prompt({
            message: "  Upstream name (key)",
            default: "",
          });
          if (!newName) {
            addMore = false;
            continue;
          }
          const path = await prompter.prompt({
            message: `  Path to ${newName} local clone`,
            default: "",
          });
          const ghRepo = await prompter.prompt({
            message: `  GitHub repo for ${newName}`,
            default: "",
          });
          const branch = await prompter.prompt({
            message: `  Default branch for ${newName}`,
            default: "main",
          });
          const startCommit = await prompter.prompt({
            message: `  Starting commit (lastAnalyzedCommit) for ${newName}`,
            default: "",
          });
          const label = await prompter.prompt({
            message: `  Display label for ${newName}`,
            default: newName,
          });

          upstreams[newName] = { path, ghRepo, branch, label };
          stateUpstreams[newName] = { lastAnalyzedCommit: startCommit };
        }
      }

      config = {
        version: 1,
        targetRepo,
        divergenceLedger,
        upstreams,
        issueFiling: DEFAULT_ISSUE_FILING,
        classifier: DEFAULT_CLASSIFIER,
        applicability: {
          notApplicable: DEFAULT_NOT_APPLICABLE,
        },
      };
    } finally {
      closePrompter();
    }
  }

  // ── Write files ────────────────────────────────────────────────────────────
  mkdirSync(planningDir, { recursive: true });

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

  const stateObj = {
    version: 1,
    upstreams: stateUpstreams,
  };
  writeFileSync(statePath, JSON.stringify(stateObj, null, 2) + "\n", "utf-8");

  // ── Ensure labels on the target repo ──────────────────────────────────────
  const labelsResult = await ensureLabels({
    targetRepo: config.targetRepo,
    ghRunner,
  });

  return { configPath, statePath, labelsResult };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const nonInteractive = args.includes("--non-interactive");
  const overwrite = args.includes("--overwrite");

  try {
    const result = await initScaffold({
      nonInteractive,
      overwrite,
    });
    process.stdout.write(`Config written: ${result.configPath}\n`);
    process.stdout.write(`State written:  ${result.statePath}\n`);
    process.stdout.write(
      `Labels: ${result.labelsResult.created.length} created, ` +
        `${result.labelsResult.existing.length} existing\n`,
    );
  } catch (err) {
    process.stderr.write(`init-scaffold: ${err.message}\n`);
    process.exit(1);
  }
}
