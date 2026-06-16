#!/usr/bin/env node
/**
 * swarm-control.mjs — deterministic controller spine for the upstream-port
 * pipeline. Sole writer of the swarm ledger; every subcommand is JSON in / JSON
 * out so the orchestrator (and the future Workflow driver) never ingest heavy
 * output. This plan (Phase 1A) ships `verify-fix` and `gate`; later plans add
 * preflight/select/plan/tick/record/classify/merge/report/cleanup.
 */
import { verifyFixArtifacts } from "./control-verify.mjs";
import { gateForPr } from "./control-gate.mjs";
import { tick, plan, report, cleanup } from "./control-plan.mjs";
import { preflight, select } from "./control-phase-a.mjs";
import { record, retry, classify, abortCheck } from "./control-ledger.mjs";
import { poll, merge } from "./control-pr.mjs";
import { refuteBundle, refuteTally } from "./control-refute.mjs";

export const KNOWN_COMMANDS = ["verify-fix", "gate", "tick", "plan", "report", "cleanup", "preflight", "select", "record", "retry", "classify", "abort-check", "poll", "merge", "refute-bundle", "refute-tally"];

export function defaultHandlers() {
  return {
    "verify-fix": (args) => verifyFixArtifacts(parseFlags(args)),
    "gate": (args) => gateForPr(parseFlags(args)),
    "tick": (args) => tick(parseFlags(args)),
    "plan": (args) => plan(parseFlags(args)),
    "report": (args) => report(parseFlags(args)),
    "cleanup": (args) => cleanup(parseFlags(args)),
    "preflight": (args) => preflight(parseFlags(args)),
    "select": (args) => select(parseFlags(args)),
    "record": (args) => record(parseFlags(args)),
    "retry": (args) => retry(parseFlags(args)),
    "classify": (args) => classify(parseFlags(args)),
    "abort-check": (args) => abortCheck(parseFlags(args)),
    "poll": (args) => poll(parseFlags(args)),
    "merge": (args) => merge(parseFlags(args)),
    "refute-bundle": (args) => refuteBundle(parseFlags(args)),
    "refute-tally": (args) => refuteTally(parseFlags(args)),
  };
}

export function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) { out[key] = true; }
      else { out[key] = next; i++; }
    }
  }
  return out;
}

export async function dispatch(argv, handlers = defaultHandlers()) {
  const [command, ...rest] = argv;
  const handler = handlers[command];
  if (!handler) throw new Error(`unknown command: ${command}`);
  return handler(rest);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  dispatch(process.argv.slice(2))
    .then((result) => { process.stdout.write(JSON.stringify(result, null, 2) + "\n"); })
    .catch((err) => {
      process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
      process.exit(1);
    });
}
