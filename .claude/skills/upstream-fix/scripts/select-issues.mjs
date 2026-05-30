#!/usr/bin/env node
/**
 * select-issues.mjs — query cmetech/otto-cli issues by filter, resolve each to
 * a compact fix record (number, severity, type, sha, guidancePath, targetFiles).
 * Writes <date>-selected-issues.json; prints { count, needsTriage, path }.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const DEFAULT_REPO = "cmetech/otto-cli";
const DEFAULT_GUIDANCE_DIR = ".planning/upstream-audits/guidance";
const EXCLUDE_TYPE = "type:do-not-port";
const EXCLUDE_STATUS = "status:applied";

function defaultGhRunner(args) { return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }); }

export function buildSearchArgs(filter, repo = DEFAULT_REPO) {
  const args = ["issue", "list", "--repo", repo, "--state", "open", "--limit", "500", "--json", "number,title,labels,body"];
  if (filter.severity) args.push("--label", `severity:${filter.severity}`);
  if (filter.type) args.push("--label", `type:${filter.type}`);
  if (filter.label) args.push("--label", filter.label);
  // --issues and --all need no label filter; numbers are filtered post-fetch.
  return args;
}

export function parseGuidanceTargets(guidancePath) {
  if (!existsSync(guidancePath)) return null;
  const text = readFileSync(guidancePath, "utf-8");
  const m = text.match(/##\s*Target file\(s\)\s*\n([\s\S]*?)(?:\n##\s|\n*$)/i);
  if (!m) return [];
  const block = m[1];
  if (/no equivalent exists/i.test(block)) return [];
  const files = [];
  for (const line of block.split("\n")) {
    const bullet = line.match(/^\s*[-*]\s*`?([^`\n]+?)`?\s*$/);
    if (bullet) files.push(bullet[1].trim());
  }
  return files;
}

function shaFromBody(body) {
  const m = (body ?? "").match(/sha=([0-9a-f]{7,40})/i);
  return m ? m[1].slice(0, 7) : null;
}

function severityFromLabels(labels) {
  const l = labels.find((x) => x.name.startsWith("severity:"));
  return l ? l.name.slice("severity:".length) : null;
}

function typeFromLabels(labels) {
  const l = labels.find((x) => x.name.startsWith("type:"));
  return l ? l.name.slice("type:".length) : null;
}

export function selectIssues({ filter, repo = DEFAULT_REPO, ghRunner = defaultGhRunner, guidanceDir = DEFAULT_GUIDANCE_DIR, outPath }) {
  const raw = ghRunner(buildSearchArgs(filter, repo));
  let issues = JSON.parse(raw);
  if (!Array.isArray(issues)) issues = [];

  if (filter.issues) {
    const want = new Set(filter.issues.map(String));
    issues = issues.filter((i) => want.has(String(i.number)));
  }

  const records = [];
  for (const i of issues) {
    const labels = (i.labels ?? []).map((l) => (typeof l === "string" ? { name: l } : l));
    const names = labels.map((l) => l.name);
    if (names.includes(EXCLUDE_TYPE) || names.includes(EXCLUDE_STATUS)) continue;

    const sha = shaFromBody(i.body);
    // Resolve guidance: prefer the sha-derived path under guidanceDir (canonical),
    // then an explicit "Guidance | <path>" line; pick the first that exists.
    const gmatch = (i.body ?? "").match(/Guidance\s*\|\s*(\S+)/);
    const candidates = [sha ? join(guidanceDir, `${sha}.md`) : null, gmatch ? gmatch[1] : null].filter(Boolean);
    const guidancePath = candidates.find((p) => existsSync(p)) ?? candidates[0] ?? null;
    const targetFiles = guidancePath ? parseGuidanceTargets(guidancePath) : null;

    const rec = {
      number: i.number,
      severity: severityFromLabels(labels),
      type: typeFromLabels(labels),
      sha,
      guidancePath,
      targetFiles: targetFiles ?? [],
    };
    // No resolvable target files → cannot place in a lane.
    if (!targetFiles || targetFiles.length === 0) rec.needsTriage = true;
    records.push(rec);
  }

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(records, null, 2) + "\n");
  }
  return { count: records.filter((r) => !r.needsTriage).length, needsTriage: records.filter((r) => r.needsTriage).length, path: outPath, records };
}

function parseArgv(argv) {
  const filter = {}; let outPath = null; let guidanceDir = DEFAULT_GUIDANCE_DIR;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") filter.all = true;
    else if (a === "--severity") filter.severity = argv[++i];
    else if (a === "--type") filter.type = argv[++i];
    else if (a === "--label") filter.label = argv[++i];
    else if (a === "--issues") filter.issues = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--out") outPath = argv[++i];
    else if (a === "--guidance-dir") guidanceDir = argv[++i];
  }
  return { filter, outPath, guidanceDir };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const { filter, outPath, guidanceDir } = parseArgv(process.argv.slice(2));
    const r = selectIssues({ filter, guidanceDir, outPath });
    process.stdout.write(JSON.stringify({ count: r.count, needsTriage: r.needsTriage, path: r.path }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
