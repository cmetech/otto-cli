/**
 * crash-log.ts — Write crash diagnostics to ~/.otto/crash/<timestamp>.log
 *
 * Zero cross-dependencies: only uses Node.js built-ins so it can be imported
 * safely from uncaughtException / unhandledRejection handlers and from tests
 * without pulling in the full extension dependency tree.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Write a crash log to ~/.otto/crash/<timestamp>.log (or $OTTO_HOME/crash/).
 * Never throws — must be safe to call from any error handler.
 */
export function writeCrashLog(err: Error, source: string): void {
  try {
    const crashDir = join((process.env.OTTO_HOME ?? process.env.OTTO_HOME) ?? join(homedir(), ".otto"), "crash");
    mkdirSync(crashDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = join(crashDir, `${ts}.log`);
    const lines = [
      `[otto] ${source}: ${err.message}`,
      `timestamp: ${new Date().toISOString()}`,
      `pid: ${process.pid}`,
      err.stack ?? "(no stack trace available)",
      "",
    ];
    appendFileSync(logPath, lines.join("\n"));
  } catch { /* never throw from crash handler */ }
}
