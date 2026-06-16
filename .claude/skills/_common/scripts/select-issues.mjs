#!/usr/bin/env node
/**
 * select-issues.mjs — query cmetech/otto-cli issues by filter, resolve each to
 * a compact fix record (number, severity, type, sha, guidancePath, targetFiles).
 * Writes <date>-selected-issues.json; prints { count, needsTriage, excludedApplied, path }.
 * Pass --exclude-applied to skip issues whose fix already merged out-of-band
 * (detected via GitHub GraphQL timeline — fail-open, never drops unmerged work).
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

/**
 * Parse a structured `depends-on:` directive (case-insensitive, `depends on`
 * also accepted) into prerequisite refs: `#N` issue numbers and 7-40 hex shas.
 * Parsing a directive stops at the first non-ref token, so trailing prose
 * ("(apply together)") is ignored. Free-form prose without the directive yields
 * nothing — this is deliberately a structured annotation, not NL inference.
 */
export function parseDependsOn(text) {
  const out = { issues: [], shas: [] };
  if (!text) return out;
  const re = /depends[\s-]?on:\s*([^\n\r]+)/gi;
  let m;
  while ((m = re.exec(text))) {
    for (const raw of m[1].split(/[,\s]+/)) {
      const t = raw.trim().replace(/[.;]+$/, "");
      if (!t) continue;
      if (/^#\d+$/.test(t)) out.issues.push(Number(t.slice(1)));
      else if (/^[0-9a-f]{7,40}$/i.test(t)) out.shas.push(t.toLowerCase());
      else break; // end of the ref list for this directive
    }
  }
  out.issues = [...new Set(out.issues)];
  out.shas = [...new Set(out.shas)];
  return out;
}

/** gh args for an issue's open/closed state. */
export function buildIssueStateArgs(number, repo = DEFAULT_REPO) {
  return ["issue", "view", String(number), "--repo", repo, "--json", "state"];
}

/** gh args searching open issues whose body references a given upstream sha. */
export function buildShaOpenSearchArgs(sha, repo = DEFAULT_REPO) {
  return ["issue", "list", "--repo", repo, "--state", "open", "--search", `sha=${sha} in:body`, "--json", "number"];
}

/**
 * Which of an issue's prerequisites are still OPEN (so the dependent should be
 * deferred this wave). Fail-OPEN: a gh error treats the prereq as resolved —
 * the fix lane's own "blocked on unported prerequisite" guard is the backstop,
 * and we never want a flaky check to wedge selection.
 */
export function openPrereqs({ dependsOn, repo = DEFAULT_REPO, ghRunner = defaultGhRunner }) {
  const open = [];
  for (const n of dependsOn.issues ?? []) {
    try {
      const state = JSON.parse(ghRunner(buildIssueStateArgs(n, repo)) || "{}").state;
      if (state === "OPEN") open.push(`#${n}`);
    } catch { /* fail-open: do not defer on a failed check */ }
  }
  for (const sha of dependsOn.shas ?? []) {
    try {
      const hits = JSON.parse(ghRunner(buildShaOpenSearchArgs(sha, repo)) || "[]");
      if (Array.isArray(hits) && hits.length > 0) open.push(sha);
    } catch { /* fail-open */ }
  }
  return open;
}

/** gh args for a GraphQL query over an issue's timeline → linked PR merge state. */
export function buildAppliedCheckArgs(number, repo = DEFAULT_REPO) {
  const [owner, name] = repo.split("/");
  const query =
    "query($owner:String!,$name:String!,$num:Int!){repository(owner:$owner,name:$name){issue(number:$num){" +
    "timelineItems(first:50,itemTypes:[CROSS_REFERENCED_EVENT,CONNECTED_EVENT,CLOSED_EVENT]){nodes{__typename " +
    "... on CrossReferencedEvent{source{__typename ... on PullRequest{merged}}} " +
    "... on ConnectedEvent{subject{__typename ... on PullRequest{merged}}} " +
    "... on ClosedEvent{closer{__typename ... on PullRequest{merged}}}}}}}}";
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `num=${number}`];
}

/** True iff any timeline node references a MERGED pull request. */
export function parseAppliedFromGraphql(jsonText) {
  let data;
  try { data = JSON.parse(jsonText || "{}"); } catch { return false; }
  const nodes = data?.data?.repository?.issue?.timelineItems?.nodes ?? [];
  for (const n of nodes) {
    const pr = n?.source ?? n?.subject ?? n?.closer ?? null;
    if (pr && pr.merged === true) return true;
  }
  return false;
}

/** Ask GitHub whether issue #number already has a linked merged PR (fail-open). */
export function isIssueApplied({ number, repo = DEFAULT_REPO, ghRunner = defaultGhRunner }) {
  try {
    return parseAppliedFromGraphql(ghRunner(buildAppliedCheckArgs(number, repo)));
  } catch {
    return false; // a failed check must NOT exclude — never skip genuinely unmerged work
  }
}

function severityFromLabels(labels) {
  const l = labels.find((x) => x.name.startsWith("severity:"));
  return l ? l.name.slice("severity:".length) : null;
}

function typeFromLabels(labels) {
  const l = labels.find((x) => x.name.startsWith("type:"));
  return l ? l.name.slice("type:".length) : null;
}

export function selectIssues({ filter, repo = DEFAULT_REPO, ghRunner = defaultGhRunner, guidanceDir = DEFAULT_GUIDANCE_DIR, outPath, excludeApplied = false }) {
  const raw = ghRunner(buildSearchArgs(filter, repo));
  let issues = JSON.parse(raw);
  if (!Array.isArray(issues)) issues = [];

  if (filter.issues) {
    const want = new Set(filter.issues.map(String));
    issues = issues.filter((i) => want.has(String(i.number)));
  }

  const records = [];
  let excludedApplied = 0;
  for (const i of issues) {
    const labels = (i.labels ?? []).map((l) => (typeof l === "string" ? { name: l } : l));
    const names = labels.map((l) => l.name);
    if (names.includes(EXCLUDE_TYPE) || names.includes(EXCLUDE_STATUS)) continue;
    if (excludeApplied && isIssueApplied({ number: i.number, repo, ghRunner })) {
      excludedApplied += 1;
      continue;
    }

    const sha = shaFromBody(i.body);
    // Resolve guidance: prefer the sha-derived path under guidanceDir (canonical),
    // then an explicit "Guidance | <path>" line; pick the first that exists.
    const gmatch = (i.body ?? "").match(/Guidance\s*\|\s*(\S+)/);
    const candidates = [sha ? join(guidanceDir, `${sha}.md`) : null, gmatch ? gmatch[1] : null].filter(Boolean);
    const guidancePath = candidates.find((p) => existsSync(p)) ?? candidates[0] ?? null;
    const targetFiles = guidancePath ? parseGuidanceTargets(guidancePath) : null;

    // Dependency-aware selection (#7): parse a structured `depends-on:` directive
    // from the issue body and its guidance; defer the candidate this wave if any
    // prerequisite is still open. Only hits GitHub when a directive is present.
    const guidanceText = guidancePath && existsSync(guidancePath) ? readFileSync(guidancePath, "utf-8") : "";
    const dependsOn = parseDependsOn(`${i.body ?? ""}\n${guidanceText}`);
    const rec = {
      number: i.number,
      severity: severityFromLabels(labels),
      type: typeFromLabels(labels),
      sha,
      guidancePath,
      targetFiles: targetFiles ?? [],
      dependsOn,
    };
    // No resolvable target files → cannot place in a lane.
    if (!targetFiles || targetFiles.length === 0) rec.needsTriage = true;
    if (dependsOn.issues.length || dependsOn.shas.length) {
      const open = openPrereqs({ dependsOn, repo, ghRunner });
      if (open.length) { rec.deferred = true; rec.deferredReason = `open prerequisite(s): ${open.join(", ")}`; }
    }
    records.push(rec);
  }

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(records, null, 2) + "\n");
  }
  return { count: records.filter((r) => !r.needsTriage).length, needsTriage: records.filter((r) => r.needsTriage).length, excludedApplied, path: outPath, records };
}

function parseArgv(argv) {
  const filter = {}; let outPath = null; let guidanceDir = DEFAULT_GUIDANCE_DIR; let excludeApplied = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") filter.all = true;
    else if (a === "--severity") filter.severity = argv[++i];
    else if (a === "--type") filter.type = argv[++i];
    else if (a === "--label") filter.label = argv[++i];
    else if (a === "--issues") filter.issues = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--out") outPath = argv[++i];
    else if (a === "--guidance-dir") guidanceDir = argv[++i];
    else if (a === "--exclude-applied") excludeApplied = true;
  }
  return { filter, outPath, guidanceDir, excludeApplied };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const { filter, outPath, guidanceDir, excludeApplied } = parseArgv(process.argv.slice(2));
    const r = selectIssues({ filter, guidanceDir, outPath, excludeApplied });
    process.stdout.write(JSON.stringify({ count: r.count, needsTriage: r.needsTriage, excludedApplied: r.excludedApplied, path: r.path }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
