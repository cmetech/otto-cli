#!/usr/bin/env node
/**
 * classify-severity.mjs — first-pass severity rubric (§8.1).
 *
 * Priority order (first match wins):
 *   1. SKIP for merge / PatchDeck / skip-prefix subjects
 *   2. CRITICAL_SECURITY  via securityRegex match on subject+body
 *   3. CRITICAL_STABILITY via stabilityRegex match
 *   4. FEATURE            for `feat:` / `feat(...)`
 *   5. NICE_TO_HAVE_FIX   for `fix:` / `fix(...)`
 *   6. UNCLASSIFIED       otherwise
 *
 * Input:  { subject, body }, rubric
 *           rubric: { securityRegex, stabilityRegex, skipPrefixes }
 * Output: { severity: string, matchedBy?: string }
 */

const MERGE_PATTERNS = [
  /^Merge pull request #\d+/i,
  /^Merge branch /i,
  /^Apply PatchDeck/i,
];

const FEAT_RE = /^feat(\([^)]*\))?:/i;
const FIX_RE = /^fix(\([^)]*\))?:/i;

/** Escape regex metacharacters in a literal string. */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a scope-aware matcher for a conventional-commit skip prefix.
 * "docs:" → matches "docs:" and "docs(vision):" but not "docstring:".
 */
function skipPrefixRegex(prefix) {
  const base = prefix.replace(/:\s*$/, "");
  return new RegExp(`^${escapeRegex(base)}(\\([^)]*\\))?:`, "i");
}

export function classifySeverity(commit, rubric) {
  const subject = commit.subject ?? "";
  const body = commit.body ?? "";
  const text = `${subject}\n${body}`;

  // 1. SKIP — merge commits
  if (MERGE_PATTERNS.some((re) => re.test(subject))) {
    return { severity: "SKIP", matchedBy: "merge-commit" };
  }
  // 1b. SKIP — configured prefixes (scope-aware: docs: and docs(scope): both match)
  for (const prefix of rubric.skipPrefixes ?? []) {
    if (skipPrefixRegex(prefix).test(subject)) {
      return { severity: "SKIP", matchedBy: `prefix:${prefix}` };
    }
  }

  // 2. CRITICAL_SECURITY
  if (rubric.securityRegex && rubric.securityRegex.test(text)) {
    return { severity: "CRITICAL_SECURITY", matchedBy: "securityRegex" };
  }

  // 3. CRITICAL_STABILITY
  if (rubric.stabilityRegex && rubric.stabilityRegex.test(text)) {
    return { severity: "CRITICAL_STABILITY", matchedBy: "stabilityRegex" };
  }

  // 4. FEATURE
  if (FEAT_RE.test(subject)) {
    return { severity: "FEATURE", matchedBy: "feat-prefix" };
  }

  // 5. NICE_TO_HAVE_FIX
  if (FIX_RE.test(subject)) {
    return { severity: "NICE_TO_HAVE_FIX", matchedBy: "fix-prefix" };
  }

  // 6. UNCLASSIFIED
  return { severity: "UNCLASSIFIED" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let stdin = "";
  process.stdin.on("data", (c) => (stdin += c));
  process.stdin.on("end", () => {
    try {
      const { commit, rubric } = JSON.parse(stdin);
      const compiled = {
        securityRegex: rubric.securityRegex ? new RegExp(rubric.securityRegex, "i") : undefined,
        stabilityRegex: rubric.stabilityRegex ? new RegExp(rubric.stabilityRegex, "i") : undefined,
        skipPrefixes: rubric.skipPrefixes ?? [],
      };
      process.stdout.write(JSON.stringify(classifySeverity(commit, compiled)) + "\n");
    } catch (err) {
      process.stderr.write(JSON.stringify({ error: err.message }) + "\n");
      process.exit(1);
    }
  });
}
