#!/usr/bin/env node
/**
 * parse-config.mjs — load and validate .planning/upstream-sync-config.json.
 *
 * CLI:   node parse-config.mjs [path/to/config.json]
 *        defaults to .planning/upstream-sync-config.json relative to cwd.
 *        Emits the parsed config as JSON to stdout (regexes serialized as
 *        their source strings).
 *
 * As module: `import { parseConfig } from "./parse-config.mjs"`
 *        Returns the parsed config with regexes compiled to RegExp objects.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_CONFIG_PATH = ".planning/upstream-sync-config.json";

function compileRegex(source, fieldName) {
  if (typeof source !== "string") return undefined;
  // Handle Python/PCRE-style inline flag (?i) — convert to JS RegExp 'i' flag
  let flags = "";
  let pattern = source;
  const inlineFlagMatch = pattern.match(/^\(\?([a-z]+)\)/);
  if (inlineFlagMatch) {
    flags = inlineFlagMatch[1];
    pattern = pattern.slice(inlineFlagMatch[0].length);
  }
  try {
    return new RegExp(pattern, flags);
  } catch (err) {
    throw new Error(`invalid regex in ${fieldName}: ${err.message}`);
  }
}

export function parseConfig(path = DEFAULT_CONFIG_PATH) {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) {
    throw new Error(`config not found at ${fullPath}`);
  }
  const raw = JSON.parse(readFileSync(fullPath, "utf-8"));

  if (raw.version !== 1) {
    throw new Error(`unsupported config version ${raw.version} (expected 1)`);
  }
  if (typeof raw.targetRepo !== "string" || !raw.targetRepo.includes("/")) {
    throw new Error("targetRepo must be 'owner/name'");
  }

  if (raw.upstreams && typeof raw.upstreams === "object") {
    for (const [name, u] of Object.entries(raw.upstreams)) {
      if (typeof u.path !== "string") {
        throw new Error(`upstream ${name}: missing required field 'path'`);
      }
      if (typeof u.ghRepo !== "string") {
        throw new Error(`upstream ${name}: missing required field 'ghRepo'`);
      }
      u.branch ??= "main";
      u.label ??= u.ghRepo;
    }
  }

  if (raw.classifier) {
    raw.classifier.securityRegex = compileRegex(
      raw.classifier.securityRegex,
      "classifier.securityRegex",
    );
    raw.classifier.stabilityRegex = compileRegex(
      raw.classifier.stabilityRegex,
      "classifier.stabilityRegex",
    );
    raw.classifier.skipPrefixes ??= [];
  }

  if (raw.applicability?.notApplicable) {
    for (const rule of raw.applicability.notApplicable) {
      if (!rule.id) throw new Error("applicability rule missing id");
      if (!rule.reason) throw new Error(`applicability rule ${rule.id}: missing reason`);
      for (const group of [rule.matchAny, rule.matchAll]) {
        if (!group) continue;
        if (group.subjectRegex) {
          group.subjectRegex = compileRegex(group.subjectRegex, `${rule.id}.subjectRegex`);
        }
        if (group.filePathRegex) {
          group.filePathRegex = compileRegex(group.filePathRegex, `${rule.id}.filePathRegex`);
        }
      }
    }
  }

  raw.divergenceLedger ??= "docs/UPSTREAM-SYNC.md";
  raw.issueFiling ??= { ccUser: "@claude", defaultStatusLabel: "status:triaged" };

  return raw;
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ?? DEFAULT_CONFIG_PATH;
  try {
    const cfg = parseConfig(path);
    const out = JSON.parse(
      JSON.stringify(cfg, (_k, v) => (v instanceof RegExp ? v.source : v)),
    );
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(
      JSON.stringify({ error: err.message }) + "\n",
    );
    process.exit(1);
  }
}
