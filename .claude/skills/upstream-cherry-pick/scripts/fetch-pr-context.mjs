#!/usr/bin/env node
/**
 * fetch-pr-context.mjs — fetch GitHub PR or issue metadata with caching.
 *
 * CLI:   node fetch-pr-context.mjs <ghRepo> <refNum> [--refresh-cache]
 *        Emits the result JSON to stdout.
 *
 * As module: `import { fetchPrContext } from "./fetch-pr-context.mjs"`
 *        Returns { kind: "pr"|"issue", data: object, fromCache: bool }
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Default ghRunner: invokes the real `gh` CLI via execFileSync.
 *
 * @param {string[]} args
 * @returns {string} stdout
 */
function defaultGhRunner(args) {
  return execFileSync("gh", args, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * Fetch PR or issue metadata from GitHub, with local JSON caching.
 *
 * @param {{
 *   ghRepo: string,
 *   refNum: number,
 *   cacheDir?: string,
 *   refreshCache?: boolean,
 *   ghRunner?: (args: string[]) => string,
 *   now?: number,
 *   cacheAgeWarningMs?: number|null,
 *   mtimeOf?: (path: string) => number
 * }} opts
 * @returns {Promise<{ kind: "pr"|"issue", data: object, fromCache: boolean, ageMs: number|null, stale: boolean, warning: string|null }>}
 */
export async function fetchPrContext({
  ghRepo,
  refNum,
  cacheDir = ".planning/upstream-audits/_cache",
  refreshCache = false,
  ghRunner = defaultGhRunner,
  now = Date.now(),
  cacheAgeWarningMs = null,
  mtimeOf = (p) => statSync(p).mtimeMs,
}) {
  const repoSlug = ghRepo.replace("/", "__");
  const repoDir = join(cacheDir, repoSlug);
  const prCachePath = join(repoDir, `pr-${refNum}.json`);
  const issueCachePath = join(repoDir, `issue-${refNum}.json`);

  const staleness = (path) => {
    if (!cacheAgeWarningMs) return { ageMs: null, stale: false, warning: null };
    const ageMs = now - mtimeOf(path);
    if (ageMs > cacheAgeWarningMs) {
      return { ageMs, stale: true, warning: `cached context for #${refNum} (${ghRepo}) is ${Math.round(ageMs / 86_400_000)}d old — pass --refresh-cache to refetch` };
    }
    return { ageMs, stale: false, warning: null };
  };

  // Cache hit: return cached file if refreshCache is false and either cache file exists
  if (!refreshCache) {
    if (existsSync(prCachePath)) {
      const data = JSON.parse(readFileSync(prCachePath, "utf-8"));
      return { kind: "pr", data, fromCache: true, ...staleness(prCachePath) };
    }
    if (existsSync(issueCachePath)) {
      const data = JSON.parse(readFileSync(issueCachePath, "utf-8"));
      return { kind: "issue", data, fromCache: true, ...staleness(issueCachePath) };
    }
  }

  // Try PR first
  let kind;
  let data;

  try {
    const stdout = ghRunner([
      "pr", "view", String(refNum),
      "--repo", ghRepo,
      "--json", "title,body,state,labels,reviews,reviewDecision,closingIssuesReferences,comments",
    ]);
    data = JSON.parse(stdout);
    kind = "pr";
  } catch (prErr) {
    // Fall back to issue
    try {
      const stdout = ghRunner([
        "issue", "view", String(refNum),
        "--repo", ghRepo,
        "--json", "title,body,state,labels,comments",
      ]);
      data = JSON.parse(stdout);
      kind = "issue";
    } catch (issueErr) {
      throw new Error(
        `Unable to fetch #${refNum} from ${ghRepo} — both PR and issue calls failed. ` +
        `PR error: ${prErr.message}; Issue error: ${issueErr.message}`,
      );
    }
  }

  // Write to cache
  mkdirSync(repoDir, { recursive: true });
  const cachePath = kind === "pr" ? prCachePath : issueCachePath;
  writeFileSync(cachePath, JSON.stringify(data, null, 2) + "\n", "utf-8");

  return { kind, data, fromCache: false, ageMs: 0, stale: false, warning: null };
}

// CLI mode
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const ghRepo = args[0];
  const refNum = parseInt(args[1], 10);
  const refreshCache = args.includes("--refresh-cache");
  const cawIdx = args.indexOf("--cache-age-warning");
  const cacheAgeWarningMs = cawIdx >= 0 ? Number(args[cawIdx + 1]) * 86_400_000 : null;

  if (!ghRepo || !refNum || isNaN(refNum)) {
    process.stderr.write(
      JSON.stringify({
        error: "Usage: node fetch-pr-context.mjs <ghRepo> <refNum> [--refresh-cache] [--cache-age-warning <days>]",
      }) + "\n",
    );
    process.exit(1);
  }

  try {
    const result = await fetchPrContext({ ghRepo, refNum, refreshCache, cacheAgeWarningMs });
    if (result.warning) process.stderr.write(result.warning + "\n");
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message }) + "\n");
    process.exit(1);
  }
}
