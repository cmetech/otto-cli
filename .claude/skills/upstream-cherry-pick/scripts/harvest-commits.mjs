#!/usr/bin/env node
/**
 * harvest-commits.mjs — git log enrichment for one upstream.
 *
 * CLI:   node harvest-commits.mjs <upstream-path> <branch> <lastAnalyzedCommit>
 *        Emits a JSON array of commit records to stdout.
 *
 * As module: `import { harvestCommits } from "./harvest-commits.mjs"`
 *        Returns an array of commit records for new commits since lastAnalyzedCommit.
 */
import { execFileSync } from "node:child_process";

const REF_RE = /#(\d+)/g;

/**
 * Run git numstat for a single SHA. Returns an object mapping file path to
 * total lines changed (added + deleted). Binary files get LOC 0.
 *
 * @param {string} repoPath  - path to the git repo
 * @param {string} sha       - commit SHA
 * @returns {{ touchedFiles: string[], locByFile: Object<string, number> }}
 */
function getNumstat(repoPath, sha) {
  const raw = execFileSync(
    "git",
    ["-C", repoPath, "show", sha, "--numstat", "--format="],
    { encoding: "utf-8" },
  );

  const touchedFiles = [];
  const locByFile = {};

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("\t");
    if (parts.length < 3) continue;

    const [added, deleted, filePath] = parts;
    // Binary files show '-' for added and deleted counts
    const loc =
      added === "-" || deleted === "-"
        ? 0
        : (parseInt(added, 10) || 0) + (parseInt(deleted, 10) || 0);

    touchedFiles.push(filePath);
    locByFile[filePath] = loc;
  }

  return { touchedFiles, locByFile };
}

/**
 * Extract issue reference numbers (e.g. "#42") from text.
 *
 * @param {string} text
 * @returns {string[]} array of numeric strings (e.g. ["42", "137"])
 */
function extractRefs(text) {
  const refs = [];
  let match;
  REF_RE.lastIndex = 0;
  while ((match = REF_RE.exec(text)) !== null) {
    refs.push(match[1]);
  }
  return refs;
}

/**
 * Determine the log range rev. If origin/<branch> exists, use it;
 * otherwise fall back to plain <branch>.
 *
 * @param {string} repoPath
 * @param {string} branch
 * @returns {string}
 */
function resolveRef(repoPath, branch) {
  const originRef = `origin/${branch}`;
  try {
    execFileSync("git", ["-C", repoPath, "rev-parse", "--verify", originRef], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return originRef;
  } catch {
    // Fall back to local branch name
    return branch;
  }
}

/**
 * Harvest new commits from an upstream repo since lastAnalyzedCommit.
 *
 * @param {{ path: string, branch: string, lastAnalyzedCommit: string }} opts
 * @returns {Array<{
 *   sha: string,
 *   author: string,
 *   date: string,
 *   subject: string,
 *   body: string,
 *   touchedFiles: string[],
 *   locByFile: Object<string, number>,
 *   refs: string[]
 * }>}
 */
export function harvestCommits({ path, branch, lastAnalyzedCommit }) {
  const ref = resolveRef(path, branch);
  const range = `${lastAnalyzedCommit}..${ref}`;

  // Use RS (record separator, \x1e) as record terminator so multi-line bodies
  // don't break field parsing. Fields separated by \x09 (tab).
  // Format: %H \t %an \t %aI \t %s \t %b \x1e
  let raw;
  try {
    raw = execFileSync(
      "git",
      [
        "-C", path,
        "log", range,
        "--no-merges",
        "--format=%H%x09%an%x09%aI%x09%s%x09%b%x1e",
      ],
      { encoding: "utf-8" },
    );
  } catch (err) {
    throw new Error(`git log failed: ${err.message}`);
  }

  const records = raw.split("\x1e").filter((r) => r.trim().length > 0);
  const commits = [];

  for (const record of records) {
    // Strip leading newline that appears after the record separator
    const clean = record.startsWith("\n") ? record.slice(1) : record;
    const tabIdx1 = clean.indexOf("\t");
    const tabIdx2 = clean.indexOf("\t", tabIdx1 + 1);
    const tabIdx3 = clean.indexOf("\t", tabIdx2 + 1);
    const tabIdx4 = clean.indexOf("\t", tabIdx3 + 1);

    if (tabIdx1 === -1) continue;

    const sha = clean.slice(0, tabIdx1);
    const author = clean.slice(tabIdx1 + 1, tabIdx2);
    const date = clean.slice(tabIdx2 + 1, tabIdx3);
    const subject = clean.slice(tabIdx3 + 1, tabIdx4 === -1 ? undefined : tabIdx4);
    const body = tabIdx4 === -1 ? "" : clean.slice(tabIdx4 + 1).trimEnd();

    if (!sha || sha.length < 7) continue;

    const { touchedFiles, locByFile } = getNumstat(path, sha);
    const refs = extractRefs(subject + "\n" + body);

    commits.push({ sha, author, date, subject, body, touchedFiles, locByFile, refs });
  }

  return commits;
}

// CLI mode
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , repoPath, branch, lastAnalyzedCommit] = process.argv;
  if (!repoPath || !branch || !lastAnalyzedCommit) {
    process.stderr.write(
      JSON.stringify({
        error: "Usage: node harvest-commits.mjs <upstream-path> <branch> <lastAnalyzedCommit>",
      }) + "\n",
    );
    process.exit(1);
  }
  try {
    const commits = harvestCommits({ path: repoPath, branch, lastAnalyzedCommit });
    process.stdout.write(JSON.stringify(commits, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message }) + "\n");
    process.exit(1);
  }
}
