#!/usr/bin/env node
/**
 * abort-streak.mjs — structured swarm abort detector.
 *
 * Replaces the prose-only "5 consecutive quarantines share the same failTail
 * prefix" rule with a real, normalized signature (stage + error-class +
 * first-failing-line) and a counter of CONSECUTIVE identical signatures
 * persisted on the ledger (`ledger.abortStreak = { signature, count }`). When
 * the streak reaches the threshold the swarm should stop — the same root cause
 * is recurring and burning lanes. A different signature resets the streak.
 */
import { readLedger, writeLedger } from "../../_common/scripts/base-ledger.mjs";

const INFRA_TOKENS = ["EACCES", "ENOSPC", "ETIMEDOUT", "ECONNRESET", "OOMKilled", "Killed"];

/** First non-empty line, normalized so volatile tokens don't defeat dedup. */
function firstSignificantLine(tail = "") {
  const line = String(tail).split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? "";
  return line
    .replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?\b/g, "<ts>") // ISO timestamps
    .replace(/:\d+:\d+/g, ":<n>:<n>")                        // line:col
    .replace(/\/\S+\//g, "/<path>/")                         // absolute/relative paths
    .replace(/\b0x[0-9a-f]+\b/gi, "<addr>")                  // hex addresses
    .slice(0, 200);
}

/** Coarse error class: a NamedError/Exception token, an infra token, or "generic". */
function errorClass(tail = "") {
  const named = String(tail).match(/\b([A-Z][A-Za-z]*(?:Error|Exception))\b/);
  if (named) return named[1];
  const infra = INFRA_TOKENS.find((t) => String(tail).includes(t));
  return infra ?? "generic";
}

/** Stable signature for a failure. @param {{stage, failTail?}} f */
export function computeSignature(f) {
  const stage = f?.stage ?? "unknown";
  return `${stage}|${errorClass(f?.failTail)}|${firstSignificantLine(f?.failTail)}`;
}

/**
 * Record a quarantine signature on the ledger and report whether to abort.
 * Consecutive identical signatures increment; a new one resets to 1.
 * @returns {{ abort: boolean, count: number, signature: string }}
 */
export function recordQuarantineSignature(ledger, signature, { threshold = 5 } = {}) {
  const prev = ledger.abortStreak ?? { signature: null, count: 0 };
  const count = prev.signature === signature ? prev.count + 1 : 1;
  ledger.abortStreak = { signature, count };
  return { abort: count >= threshold, count, signature };
}

/** Clear the streak (backs `--reset-abort-counter`). */
export function resetAbortStreak(ledger) {
  ledger.abortStreak = { signature: null, count: 0 };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const [cmd, path] = process.argv.slice(2);
  try {
    if (cmd === "reset") {
      if (!path) throw new Error("Usage: node abort-streak.mjs reset <ledger-path>");
      const ledger = readLedger(path);
      if (!ledger) throw new Error(`ledger not found at ${path}`);
      resetAbortStreak(ledger);
      writeLedger(path, ledger);
      process.stdout.write(JSON.stringify({ ok: true, abortStreak: ledger.abortStreak }, null, 2) + "\n");
    } else if (cmd === "signature") {
      const ctx = JSON.parse(path ?? "{}");
      process.stdout.write(computeSignature(ctx) + "\n");
    } else {
      throw new Error("Usage: node abort-streak.mjs <reset <ledger>|signature '<json>'>");
    }
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
