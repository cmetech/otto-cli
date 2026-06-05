#!/usr/bin/env node
/**
 * run-gates.mjs — run a confidence gate; write full log to disk; return
 * { pass, failTail } so the controller never ingests heavy test output.
 * CLI: node run-gates.mjs <gate> --cwd <dir> --log <path> [--files a,b] [--test-file f]
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const STRIP_TYPES_IMPORT = "./src/resources/extensions/workflow/tests/resolve-ts.mjs";

export function tailLines(text, n = 30) {
  const lines = (text ?? "").split("\n");
  return lines.slice(Math.max(0, lines.length - n)).join("\n");
}

export function resolveGateCommands(targetFiles = []) {
  const touchesPackages = targetFiles.some((f) => f.startsWith("packages/"));
  return {
    build: ["npm", "run", "build"],
    targeted: touchesPackages ? ["npm", "run", "test:packages"] : ["npm", "run", "test:unit"],
  };
}

function defaultRunner(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
}

// The `full` gate chains two heavy commands; all others are single commands.
// Order matters: `verify:pr` runs `build:core` first, which populates the
// gitignored `packages/*/dist/` artifacts that several unit tests load via
// dynamic import (e.g. extension-load-perf.test.ts). Running `npm test`
// before the build leaves those dist files missing and the suite red.
const FULL_STEPS = [["npm", "run", "verify:pr"], ["npm", "test"]];

export function runGate({ gate, cwd, logPath, targetFiles = [], testFile = null, runner = defaultRunner }) {
  // Build the ordered list of [cmd, ...args] steps this gate runs.
  let steps;
  if (gate === "regression") {
    if (!testFile) throw new Error("regression gate requires testFile");
    steps = [["node", "--import", STRIP_TYPES_IMPORT, "--experimental-strip-types", "--test", testFile]];
  } else if (gate === "full") {
    steps = FULL_STEPS;
  } else {
    const cmds = resolveGateCommands(targetFiles);
    const resolved = cmds[gate];
    if (!resolved) throw new Error(`unknown gate: ${gate}`);
    steps = [resolved];
  }

  let log = "";
  let pass = true;
  let lastOut = "";
  for (const [cmd, ...args] of steps) {
    const res = runner(cmd, args, cwd);
    lastOut = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    log += `$ ${cmd} ${args.join(" ")}\n--- stdout ---\n${res.stdout ?? ""}\n--- stderr ---\n${res.stderr ?? ""}\n`;
    if (res.status !== 0) { pass = false; break; } // stop at first failing step
  }

  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, log);
  return { pass, failTail: pass ? "" : tailLines(lastOut, 30) };
}

function parseArgv(argv) {
  const gate = argv[0];
  let cwd = process.cwd(), logPath = null, targetFiles = [], testFile = null;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cwd") cwd = argv[++i];
    else if (a === "--log") logPath = argv[++i];
    else if (a === "--files") targetFiles = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--test-file") testFile = argv[++i];
  }
  return { gate, cwd, logPath, targetFiles, testFile };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const { gate, cwd, logPath, targetFiles, testFile } = parseArgv(process.argv.slice(2));
    if (!gate || !logPath) throw new Error("Usage: node run-gates.mjs <gate> --cwd <dir> --log <path> [--files a,b] [--test-file f]");
    const r = runGate({ gate, cwd, logPath, targetFiles, testFile });
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    if (!r.pass) process.exit(2); // distinct from usage error (1)
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
