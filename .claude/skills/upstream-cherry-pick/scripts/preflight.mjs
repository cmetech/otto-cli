#!/usr/bin/env node
/**
 * preflight.mjs — §7 environment checks for upstream-cherry-pick.
 *
 * CLI:   node preflight.mjs
 *        Reads config from .planning/upstream-sync-config.json.
 *        Emits JSON result to stdout.
 *        Exits 0 on all-pass, 1 on any failure.
 *
 * As module: `import { runPreflight } from "./preflight.mjs"`
 *        Returns { passed, failed, autoFixed }
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureLabels } from "./ensure-labels.mjs";

// ─── Default runners ──────────────────────────────────────────────────────────

function defaultCmdRunner(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf-8" });
}

function defaultGhRunner(args) {
  // gh auth status writes to stderr; capture both
  const result = spawnSync("gh", args, { encoding: "utf-8" });
  if (result.status !== 0) {
    const err = new Error(result.stderr || result.stdout || `gh exited ${result.status}`);
    err.stdout = result.stdout;
    err.stderr = result.stderr;
    throw err;
  }
  // Return combined output (auth status uses stderr for its output)
  return (result.stdout || "") + (result.stderr || "");
}

// ─── Required checks (abort on failure) ──────────────────────────────────────

const REQUIRED_CHECKS = [
  {
    name: "gh-on-path",
    run: ({ cmdRunner }) => {
      try {
        cmdRunner(process.platform === "win32" ? "where" : "which", ["gh"]);
        return { passed: true };
      } catch {
        return {
          passed: false,
          message: "gh CLI not found. Install: https://cli.github.com/",
          remediation: "Install: https://cli.github.com/",
        };
      }
    },
  },

  {
    name: "git-on-path",
    run: ({ cmdRunner }) => {
      try {
        cmdRunner(process.platform === "win32" ? "where" : "which", ["git"]);
        return { passed: true };
      } catch {
        return {
          passed: false,
          message: "git not found on PATH.",
          remediation: "Install git: https://git-scm.com/",
        };
      }
    },
  },

  {
    name: "gh-authenticated",
    run: ({ ghRunner }) => {
      try {
        ghRunner(["auth", "status", "--hostname", "github.com"]);
        return { passed: true };
      } catch {
        return {
          passed: false,
          message: "gh is not authenticated. Run: `gh auth login`",
          remediation: "gh auth login",
        };
      }
    },
  },

  {
    name: "gh-scopes",
    run: ({ ghRunner }) => {
      let output = "";
      try {
        output = ghRunner(["auth", "status", "--hostname", "github.com"]);
      } catch (err) {
        // If auth check failed, output may be on the error
        output = (err.stdout || "") + (err.stderr || "") + (err.message || "");
      }
      const hasRepo = output.includes("'repo'") || output.includes('"repo"') || /\brepo\b/.test(output);
      const hasReadOrg =
        output.includes("'read:org'") ||
        output.includes('"read:org"') ||
        output.includes("read:org");
      if (hasRepo && hasReadOrg) {
        return { passed: true };
      }
      return {
        passed: false,
        message: "gh token missing scopes. Run: `gh auth refresh -s repo,read:org`",
        remediation: "gh auth refresh -s repo,read:org",
      };
    },
  },

  {
    name: "git-repo",
    run: ({ cmdRunner, cwd }) => {
      try {
        const args = cwd
          ? ["-C", cwd, "rev-parse", "--git-dir"]
          : ["rev-parse", "--git-dir"];
        cmdRunner("git", args);
        return { passed: true };
      } catch {
        return {
          passed: false,
          message: "Not inside a git repo.",
          remediation: "Run from inside a git repository.",
        };
      }
    },
  },

  {
    name: "upstream-sync-md",
    run: ({ config, cwd }) => {
      const base = cwd ?? process.cwd();
      const ledgerPath = resolve(base, config.divergenceLedger ?? "docs/UPSTREAM-SYNC.md");
      if (existsSync(ledgerPath)) {
        return { passed: true };
      }
      return {
        passed: false,
        message: `UPSTREAM-SYNC.md not found at ${ledgerPath}. Conflict-risk scoring requires it.`,
        remediation: `Create the file at ${ledgerPath} or update divergenceLedger in config.`,
      };
    },
  },

  {
    name: "config-file-exists",
    run: ({ cwd }) => {
      const base = cwd ?? process.cwd();
      const configPath = resolve(base, ".planning/upstream-sync-config.json");
      if (existsSync(configPath)) {
        return { passed: true };
      }
      return {
        passed: false,
        message: "Config not initialized. Run `/upstream-cherry-pick --init`.",
        remediation: "Run `/upstream-cherry-pick --init` to create the config.",
      };
    },
  },

  {
    name: "upstream-paths-valid",
    run: ({ config, cmdRunner, cwd }) => {
      if (!config.upstreams) return { passed: true };
      const base = cwd ?? process.cwd();
      for (const [name, upstream] of Object.entries(config.upstreams)) {
        const upstreamPath = resolve(base, upstream.path);
        if (!existsSync(upstreamPath)) {
          return {
            passed: false,
            message: `Upstream \`${name}\` at \`${upstream.path}\` is not a git repo.`,
            remediation: `Ensure the upstream path exists and is a git repository.`,
          };
        }
        try {
          cmdRunner("git", ["-C", upstreamPath, "rev-parse", "--git-dir"]);
        } catch {
          return {
            passed: false,
            message: `Upstream \`${name}\` at \`${upstream.path}\` is not a git repo.`,
            remediation: `Ensure ${upstream.path} is a git repository.`,
          };
        }
      }
      return { passed: true };
    },
  },

  {
    name: "target-repo-reachable",
    run: ({ config, ghRunner }) => {
      try {
        ghRunner(["repo", "view", config.targetRepo, "--json", "url", "--jq", ".url"]);
        return { passed: true };
      } catch {
        return {
          passed: false,
          message: `Cannot reach \`${config.targetRepo}\`.`,
          remediation: `Verify the targetRepo value and your gh authentication.`,
        };
      }
    },
  },

  {
    name: "upstream-gh-repos-reachable",
    run: ({ config, ghRunner }) => {
      if (!config.upstreams) return { passed: true };
      for (const [name, upstream] of Object.entries(config.upstreams)) {
        try {
          ghRunner(["repo", "view", upstream.ghRepo, "--json", "url", "--jq", ".url"]);
        } catch {
          return {
            passed: false,
            message: `Cannot reach upstream gh repo \`${upstream.ghRepo}\`.`,
            remediation: `Verify ghRepo for upstream '${name}' and your gh authentication.`,
          };
        }
      }
      return { passed: true };
    },
  },
];

// ─── Soft checks (auto-fix; log but don't abort) ──────────────────────────────

const SOFT_CHECKS = [
  {
    name: "ensure-labels",
    run: async ({ config, ghRunner }) => {
      try {
        const result = await ensureLabels({ targetRepo: config.targetRepo, ghRunner });
        if (result.created.length > 0) {
          return {
            fixed: true,
            message: `Created ${result.created.length} missing label(s): ${result.created.join(", ")}`,
          };
        }
        return { fixed: false };
      } catch (err) {
        // Soft check — don't fail, just report
        return {
          fixed: false,
          message: `Warning: ensure-labels failed: ${err.message}`,
        };
      }
    },
  },

  {
    name: "ensure-audits-dir",
    run: ({ cwd }) => {
      const base = cwd ?? process.cwd();
      const dir = resolve(base, ".planning/upstream-audits");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        return { fixed: true, message: `Created directory ${dir}` };
      }
      return { fixed: false };
    },
  },

  {
    name: "ensure-audits-cache-dir",
    run: ({ cwd }) => {
      const base = cwd ?? process.cwd();
      const dir = resolve(base, ".planning/upstream-audits/_cache");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        return { fixed: true, message: `Created directory ${dir}` };
      }
      return { fixed: false };
    },
  },

  {
    name: "ensure-state-file",
    run: ({ cwd }) => {
      const base = cwd ?? process.cwd();
      const statePath = resolve(base, ".planning/upstream-sync-state.json");
      if (!existsSync(statePath)) {
        writeFileSync(statePath, JSON.stringify({ version: 1, upstreams: {} }, null, 2) + "\n");
        return { fixed: true, message: `Created state file at ${statePath}` };
      }
      return { fixed: false };
    },
  },
];

// ─── Core export ──────────────────────────────────────────────────────────────

/**
 * Run all preflight checks.
 *
 * @param {object} options
 * @param {object} options.config    - parsed config object (output of parse-config.mjs)
 * @param {Function} [options.ghRunner]  - injectable gh runner
 * @param {Function} [options.cmdRunner] - injectable cmd runner
 * @param {string}   [options.cwd]       - working directory for path resolution (defaults to process.cwd())
 * @returns {Promise<{ passed: Array, failed: Array, autoFixed: Array }>}
 */
export async function runPreflight({ config, ghRunner, cmdRunner, cwd }) {
  const ctx = {
    config,
    ghRunner: ghRunner ?? defaultGhRunner,
    cmdRunner: cmdRunner ?? defaultCmdRunner,
    cwd,
  };

  const passed = [];
  const failed = [];
  const autoFixed = [];

  for (const check of REQUIRED_CHECKS) {
    const result = await check.run(ctx);
    if (result.passed) {
      passed.push({ name: check.name });
    } else {
      failed.push({
        name: check.name,
        message: result.message,
        remediation: result.remediation,
      });
    }
  }

  // Only run soft checks if all required checks passed
  if (failed.length === 0) {
    for (const check of SOFT_CHECKS) {
      const result = await check.run(ctx);
      if (result.fixed) {
        autoFixed.push({ name: check.name, message: result.message });
      } else {
        passed.push({ name: check.name });
      }
    }
  }

  return { passed, failed, autoFixed };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const { parseConfig } = await import("./parse-config.mjs");
    const config = parseConfig();
    const result = await runPreflight({ config });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (result.failed.length > 0) {
      process.exit(1);
    }
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
