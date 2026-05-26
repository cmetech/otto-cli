/**
 * Home directory resolution.
 *
 * Exports workflowHome() which returns the agent configuration directory,
 * defaulting to ~/.otto with a OTTO_HOME env var override.
 *
 * For the user's home directory, use os.homedir() directly — it handles
 * platform-specific env lookup (USERPROFILE on Windows, HOME on POSIX)
 * with appropriate fallbacks.
 *
 * @see upstream #5015
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Resolve the agent home directory (typically ~/.otto).
 *
 * `OTTO_HOME` env var overrides the default location.
 * Falls back to `homedir()/.otto`.
 *
 * Always returns an absolute, normalized path — `resolve()` canonicalizes
 * any relative or non-canonical `OTTO_HOME` value so downstream comparison
 * and redaction sites don't have to.
 */
export function workflowHome(): string {
  const envHome = process.env.OTTO_HOME ?? process.env.OTTO_HOME;
  return envHome ? resolve(envHome) : join(homedir(), ".otto");
}
