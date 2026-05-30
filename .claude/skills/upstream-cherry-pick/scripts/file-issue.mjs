#!/usr/bin/env node
/**
 * file-issue.mjs — create a GitHub issue from a build-issue-payload result.
 *
 * CLI:   node file-issue.mjs <targetRepo> < payload.json
 *        Emits result JSON to stdout.
 *        Exits 0 on success, 1 on error.
 *
 * As module: `import { fileIssue } from "./file-issue.mjs"`
 *        Returns { number, url } on success.
 *        Returns { error, payload } on failure (does not throw).
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// ─── Default gh runner ───────────────────────────────────────────────────────

function defaultGhRunner(args) {
  return execFileSync("gh", args, { encoding: "utf-8" });
}

// ─── Core implementation ─────────────────────────────────────────────────────

/**
 * Create a GitHub issue from a payload object.
 *
 * @param {object} options
 * @param {{ title: string, body: string, labels: string[] }} options.payload
 * @param {string} options.targetRepo   - e.g. "cmetech/otto-cli"
 * @param {Function} [options.ghRunner] - optional DI; defaults to execFileSync("gh", ...)
 * @returns {Promise<{ number: number, url: string } | { error: string, payload: object }>}
 */
export async function fileIssue({ payload, targetRepo, ghRunner = defaultGhRunner }) {
  const tmpfile = path.join(
    os.tmpdir(),
    `ucp-issue-body-${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
  );

  try {
    writeFileSync(tmpfile, payload.body, "utf-8");

    let raw;
    try {
      raw = ghRunner([
        "issue", "create",
        "--repo", targetRepo,
        "--title", payload.title,
        "--body-file", tmpfile,
        "--label", payload.labels.join(","),
      ]);
    } catch (err) {
      return {
        error: err.message ?? String(err),
        payload,
      };
    }

    // gh issue create prints the URL of the new issue on stdout
    const url = (raw ?? "").trim();
    const match = url.match(/\/issues\/(\d+)$/);
    if (!match) {
      return {
        error: `fileIssue: could not parse issue number from gh output: ${JSON.stringify(url)}`,
        payload,
      };
    }

    return {
      number: parseInt(match[1], 10),
      url,
    };
  } finally {
    try {
      unlinkSync(tmpfile);
    } catch {
      // best-effort cleanup; ignore errors
    }
  }
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const targetRepo = process.argv[2];

  if (!targetRepo) {
    process.stderr.write(
      JSON.stringify({ error: "Usage: node file-issue.mjs <targetRepo> < payload.json" }) + "\n",
    );
    process.exit(1);
  }

  let stdin = "";
  process.stdin.on("data", (c) => (stdin += c));
  process.stdin.on("end", async () => {
    let payload;
    try {
      payload = JSON.parse(stdin);
    } catch (err) {
      process.stderr.write(
        JSON.stringify({ error: `Failed to parse stdin as JSON: ${err.message}` }) + "\n",
      );
      process.exit(1);
    }

    const result = await fileIssue({ payload, targetRepo });

    if (result.error) {
      process.stderr.write(JSON.stringify(result) + "\n");
      process.exit(1);
    }

    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(0);
  });
}
