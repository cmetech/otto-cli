#!/usr/bin/env node
/**
 * classify-applicability.mjs — decide whether a commit is relevant to OTTO's
 * product surface. Runs BEFORE severity classification per §8.0 of the spec.
 *
 * Inputs:
 *   commit:    { subject: string, body: string, touchedFiles: string[] }
 *   rules:     [{ id, reason, matchAny?, matchAll? }, ...]
 *              where matchAny/matchAll = { subjectRegex?, filePathRegex? }
 *
 * Output: { applicable: bool, ruleId?: string, reason?: string }
 *
 * Semantics:
 *   - matchAny: at least one listed condition matches → NOT_APPLICABLE
 *   - matchAll: every listed condition must match → NOT_APPLICABLE
 *   - filePathRegex matches only if EVERY touched file path matches the
 *     regex (defensive — mixed-file commits stay APPLICABLE).
 *   - subjectRegex matches if subject OR body contains a match.
 */

function subjectMatches(regex, commit) {
  if (!regex) return null; // no condition specified
  return regex.test(commit.subject) || regex.test(commit.body ?? "");
}

function filesMatch(regex, commit) {
  if (!regex) return null;
  if (!commit.touchedFiles?.length) return false;
  return commit.touchedFiles.every((f) => regex.test(f));
}

function evaluateGroup(group, commit, mode) {
  const subjResult = subjectMatches(group.subjectRegex, commit);
  const fileResult = filesMatch(group.filePathRegex, commit);
  const results = [subjResult, fileResult].filter((r) => r !== null);
  if (results.length === 0) return false; // empty group never matches
  return mode === "any" ? results.some(Boolean) : results.every(Boolean);
}

export function classifyApplicability(commit, rules) {
  for (const rule of rules ?? []) {
    if (rule.matchAny && evaluateGroup(rule.matchAny, commit, "any")) {
      return { applicable: false, ruleId: rule.id, reason: rule.reason };
    }
    if (rule.matchAll && evaluateGroup(rule.matchAll, commit, "all")) {
      return { applicable: false, ruleId: rule.id, reason: rule.reason };
    }
  }
  return { applicable: true };
}

function compileGroup(g) {
  return {
    // Subjects are prose — match case-insensitively ("Bun build" == "bun build").
    subjectRegex: g.subjectRegex ? new RegExp(g.subjectRegex, "i") : undefined,
    // File paths are case-sensitive on Linux; keep them exact.
    filePathRegex: g.filePathRegex ? new RegExp(g.filePathRegex) : undefined,
  };
}

// CLI: stdin = { commit, rules } (rules use string regexes)
if (import.meta.url === `file://${process.argv[1]}`) {
  let stdin = "";
  process.stdin.on("data", (c) => (stdin += c));
  process.stdin.on("end", () => {
    try {
      const input = JSON.parse(stdin);
      const rules = (input.rules ?? []).map((rule) => ({
        ...rule,
        matchAny: rule.matchAny && compileGroup(rule.matchAny),
        matchAll: rule.matchAll && compileGroup(rule.matchAll),
      }));
      process.stdout.write(
        JSON.stringify(classifyApplicability(input.commit, rules)) + "\n",
      );
    } catch (err) {
      process.stderr.write(JSON.stringify({ error: err.message }) + "\n");
      process.exit(1);
    }
  });
}
