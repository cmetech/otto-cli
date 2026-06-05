#!/usr/bin/env node
/**
 * select-prs.mjs — resolve an invocation to a queued list of PRs.
 * Modes: explicit numbers | current branch | filter (default head glob).
 * Writes <date>-selected-prs.json; prints { count, path }.
 * CLI: node select-prs.mjs [--issues 64,70 | --filter [glob] | --current] [--out <path>] [--repo <owner/name>]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_REPO = "cmetech/otto-cli";
const DEFAULT_GLOB = "integration/upstream-fix-*";

function defaultGhRunner(args) { return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 }); }

export function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function buildListArgs(repo = DEFAULT_REPO) {
  return ["pr", "list", "--repo", repo, "--base", "main", "--state", "open",
    "--limit", "100", "--json", "number,headRefName,isDraft"];
}

export function filterPrs(prs, glob) {
  const re = globToRegExp(glob);
  return prs.filter((p) => !p.isDraft && re.test(p.headRefName));
}

function normalize(p) { return { number: p.number, headRef: p.headRefName, isDraft: !!p.isDraft }; }

export function selectPrs({ mode, numbers = [], filterGlob = DEFAULT_GLOB, repo = DEFAULT_REPO, ghRunner = defaultGhRunner, outPath = null }) {
  let prs;
  if (mode === "explicit") {
    prs = [];
    for (const n of numbers) {
      const p = JSON.parse(ghRunner(["pr", "view", String(n), "--repo", repo, "--json", "number,headRefName,isDraft,state"]));
      if (!p.isDraft) prs.push(normalize(p));
    }
  } else if (mode === "current") {
    const p = JSON.parse(ghRunner(["pr", "view", "--repo", repo, "--json", "number,headRefName,isDraft,state"]));
    prs = p.isDraft ? [] : [normalize(p)];
  } else { // filter
    const all = JSON.parse(ghRunner(buildListArgs(repo)));
    prs = filterPrs(Array.isArray(all) ? all : [], filterGlob).map(normalize);
  }

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(prs, null, 2) + "\n");
  }
  return { count: prs.length, path: outPath, prs };
}

function parseArgv(argv) {
  let mode = "current", numbers = [], filterGlob = DEFAULT_GLOB, outPath = null, repo = DEFAULT_REPO;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--issues") { mode = "explicit"; numbers = argv[++i].split(",").map((s) => Number(s.trim())); }
    else if (a === "--filter") { mode = "filter"; if (argv[i + 1] && !argv[i + 1].startsWith("--")) filterGlob = argv[++i]; }
    else if (a === "--current") mode = "current";
    else if (a === "--out") outPath = argv[++i];
    else if (a === "--repo") repo = argv[++i];
  }
  return { mode, numbers, filterGlob, outPath, repo };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const { mode, numbers, filterGlob, outPath, repo } = parseArgv(process.argv.slice(2));
    const r = selectPrs({ mode, numbers, filterGlob, repo, outPath });
    process.stdout.write(JSON.stringify({ count: r.count, path: r.path }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
