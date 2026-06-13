#!/usr/bin/env node
/**
 * revalidate-do-not-port.mjs — re-surface mechanically-classified do-not-port
 * issues for a fresh Fork-relevance check (Phase-2 §2 / open question).
 *
 * The pre-Phase-2 do-not-port issues were classified by path-alignment alone.
 * The intent-first model may reclassify some as essence-reimplement (the patch
 * was inapplicable, but the underlying bug still affects our fork). This pass
 * lists those issues as a manifest; it does NOT mass-relabel.
 *
 * CLI:  node revalidate-do-not-port.mjs [targetRepo]
 *       Prints a JSON manifest to stdout.
 */
import { execFileSync } from "node:child_process";

const SHA_RE = /sha=([0-9a-f]{7,40})/i;

function labelNames(labels = []) {
  return labels.map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean);
}

function extractSha(issue) {
  const fromBody = (issue.body ?? "").match(SHA_RE);
  if (fromBody) return fromBody[1].slice(0, 7);
  const fromTitle = (issue.title ?? "").match(SHA_RE);
  return fromTitle ? fromTitle[1].slice(0, 7) : null;
}

/**
 * Build the revalidation manifest from a list of fetched issues.
 * @param {Array<{number:number, title:string, body:string, labels:Array}>} issues
 * @returns {Array<{number:number, sha:string|null, title:string, hasNewGuidance:boolean}>}
 */
export function buildRevalidationManifest(issues) {
  return issues
    .filter((i) => labelNames(i.labels).includes("type:do-not-port"))
    .map((i) => ({ number: i.number, sha: extractSha(i), title: i.title, hasNewGuidance: false }));
}

function defaultGhRunner(args) {
  return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
}

/** Fetch all type:do-not-port issues and build the manifest. */
export function revalidateDoNotPort({ targetRepo, ghRunner = defaultGhRunner }) {
  const raw = ghRunner([
    "issue", "list",
    "--repo", targetRepo,
    "--label", "type:do-not-port",
    "--state", "all",
    "--limit", "1000",
    "--json", "number,title,body,labels",
  ]);
  const issues = JSON.parse(raw || "[]");
  return buildRevalidationManifest(issues);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const targetRepo = process.argv[2] ?? "cmetech/otto-cli";
  try {
    const manifest = revalidateDoNotPort({ targetRepo });
    process.stdout.write(JSON.stringify({ count: manifest.length, manifest }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
