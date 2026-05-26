/**
 * Python runtime helper.
 *
 * One responsibility: spawn a bundled Python (or bash) script, capture stdout
 * and stderr, and return a structured result. All seven flow-builder tool
 * wrappers go through here so error surfaces (missing python3, timeouts,
 * non-zero exit) are consistent.
 *
 * Python is NOT bundled. We require python3 on PATH. If missing, every tool
 * call returns a clear, actionable error pointing the user at install docs.
 */

import { spawn } from "node:child_process";

export interface RunResult {
  exitCode: number;        // 124 if timed out (matches GNU coreutils convention)
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Extra env vars layered on top of process.env. */
  env?: Record<string, string | undefined>;
  /** Working directory for the spawned process. Defaults to process.cwd(). */
  cwd?: string;
  /** Hard timeout in milliseconds. Defaults to 120_000 (2 min). */
  timeoutMs?: number;
}

export type Python3Info =
  | { ok: true; binary: string; version: string }
  | { ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 120_000;
const PYTHON_BIN_ENV = "OTTO_PYTHON_BIN";

/**
 * Resolve a usable python3 binary. Honors OTTO_PYTHON_BIN override; falls
 * back to "python3" on PATH. Probes by running `--version`. Never throws.
 */
export async function ensurePython3(): Promise<Python3Info> {
  const binary = process.env[PYTHON_BIN_ENV]?.trim() || "python3";
  const probe = await spawnCapture(binary, ["--version"], {}, 5_000);
  if (probe.exitCode !== 0) {
    return {
      ok: false,
      error: `Could not run '${binary} --version' (exit ${probe.exitCode}). OTTO build-flow tools require Python 3. ` +
        `Install Python 3 (https://www.python.org/downloads/) and ensure 'python3' is on PATH, ` +
        `or set ${PYTHON_BIN_ENV} to a specific interpreter path.`,
    };
  }
  // Some Python builds print "Python 3.x.y" to stderr, others to stdout. Combine.
  const version = (probe.stdout + probe.stderr).trim();
  if (!/^Python 3\./.test(version)) {
    return { ok: false, error: `${binary} reported '${version}', expected Python 3.x` };
  }
  return { ok: true, binary, version };
}

/**
 * Run a Python script and capture its output. Resolves python3 each call —
 * the resolution is cheap and keeps tool calls stateless.
 */
export async function runPython(
  scriptPath: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const info = await ensurePython3();
  if (!info.ok) {
    return { exitCode: 127, stdout: "", stderr: info.error };
  }
  return spawnCapture(info.binary, [scriptPath, ...args], opts.env ?? {}, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.cwd);
}

/**
 * Run a bash script and capture its output. Used by validate_flow.sh.
 */
export async function runBash(
  scriptPath: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  return spawnCapture("bash", [scriptPath, ...args], opts.env ?? {}, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.cwd);
}

async function spawnCapture(
  cmd: string,
  args: string[],
  extraEnv: Record<string, string | undefined>,
  timeoutMs: number,
  cwd?: string,
): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") env[k] = v;
    }
    for (const [k, v] of Object.entries(extraEnv)) {
      if (typeof v === "string") env[k] = v;
    }
    let child;
    try {
      child = spawn(cmd, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({ exitCode: 127, stdout: "", stderr: `spawn failed: ${(err as Error).message}` });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, stdout, stderr: stderr + `\nspawn error: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ exitCode: 124, stdout, stderr: stderr + `\n[otto] script timed out after ${timeoutMs}ms` });
      } else {
        resolve({ exitCode: code ?? 0, stdout, stderr });
      }
    });
  });
}
