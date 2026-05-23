/**
 * LOOP24 services config — gateway + langflow.
 *
 * Synchronous read/write of ~/.loop24/config.json. Mirrors src/brand.ts's
 * loader-safe pattern: no compiled-module imports, no top-level await, no
 * parameter-property constructors. This module is transitively imported by
 * brand.ts so it runs on the --version / --help fast path.
 *
 * Precedence (canonical, used by the env-propagation side effect below):
 *   env var > config.json field > built-in default
 *
 * The side effect at module load time populates process.env from config.json
 * ONLY when the env var is unset. Downstream consumers (pi-ai's anthropic.ts,
 * the loop24 extension's session_start probe) keep reading process.env so
 * nothing else has to change.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

// ─── Schema ───────────────────────────────────────────────────────────────────

export interface Loop24Config {
  gateway: {
    url: string | null
    token: string | null
  }
  langflow: {
    url: string
    apiKey: string | null
    enabled: boolean
  }
}

export const DEFAULT_CONFIG: Loop24Config = {
  gateway: {
    // Placeholder — real loop24-gateway port confirmed when SURF-V2-01 ships.
    url: null,
    token: null,
  },
  langflow: {
    url: "http://127.0.0.1:7860",
    apiKey: null,
    enabled: true,
  },
}

// ─── Paths ────────────────────────────────────────────────────────────────────

/**
 * Resolve ~/.loop24/config.json. Honors LOOP24_HOME (test override) and
 * falls back to homedir(). Matches the convention used by src/app-paths.ts.
 */
export function configPath(): string {
  const root = process.env.LOOP24_HOME || homedir()
  return join(root, ".loop24", "config.json")
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Load config from disk. Returns DEFAULT_CONFIG when the file is missing,
 * unreadable, or invalid JSON. Never throws — this runs on the loader hot path.
 *
 * Missing nested fields are filled from defaults so callers can rely on every
 * field being present.
 */
export function loadConfig(): Loop24Config {
  const p = configPath()
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(p, "utf-8"))
  } catch {
    return cloneDefault()
  }
  if (raw === null || typeof raw !== "object") return cloneDefault()
  const r = raw as Partial<Loop24Config>

  const gw = (r.gateway as Partial<Loop24Config["gateway"]>) ?? {}
  const lf = (r.langflow as Partial<Loop24Config["langflow"]>) ?? {}

  return {
    gateway: {
      url: typeof gw.url === "string" && gw.url.trim() ? gw.url.trim() : DEFAULT_CONFIG.gateway.url,
      token: typeof gw.token === "string" && gw.token.trim() ? gw.token.trim() : DEFAULT_CONFIG.gateway.token,
    },
    langflow: {
      url: typeof lf.url === "string" && lf.url.trim() ? lf.url.trim() : DEFAULT_CONFIG.langflow.url,
      apiKey: typeof lf.apiKey === "string" && lf.apiKey.trim() ? lf.apiKey.trim() : DEFAULT_CONFIG.langflow.apiKey,
      enabled: typeof lf.enabled === "boolean" ? lf.enabled : DEFAULT_CONFIG.langflow.enabled,
    },
  }
}

function cloneDefault(): Loop24Config {
  return {
    gateway: { url: DEFAULT_CONFIG.gateway.url, token: DEFAULT_CONFIG.gateway.token },
    langflow: {
      url: DEFAULT_CONFIG.langflow.url,
      apiKey: DEFAULT_CONFIG.langflow.apiKey,
      enabled: DEFAULT_CONFIG.langflow.enabled,
    },
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Persist config atomically with mode 0600. Writes to <path>.tmp first then
 * renames, so a crash mid-write never leaves a half-written file in place of
 * the previous good config.
 */
export function saveConfig(cfg: Loop24Config): void {
  const p = configPath()
  const dir = dirname(p)
  mkdirSync(dir, { recursive: true, mode: 0o700 })

  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 })
  renameSync(tmp, p)
}

// ─── Env propagation (module side effect) ─────────────────────────────────────

/**
 * Populate process.env from a Loop24Config for any env var that is currently
 * unset. Env always wins — never overwrites an existing process.env entry.
 *
 * Called at module load (with loadConfig() result) and also by the wizard
 * after saveConfig() so the CURRENT process picks up freshly-written values.
 */
export function applyConfigToEnv(cfg: Loop24Config): void {
  if (!process.env.LOOP24_GATEWAY_URL?.trim() && cfg.gateway.url) {
    process.env.LOOP24_GATEWAY_URL = cfg.gateway.url
  }
  if (!process.env.LOOP24_GATEWAY_TOKEN?.trim() && cfg.gateway.token) {
    process.env.LOOP24_GATEWAY_TOKEN = cfg.gateway.token
  }
  if (!process.env.LANGFLOW_SERVER_URL?.trim() && cfg.langflow.url) {
    process.env.LANGFLOW_SERVER_URL = cfg.langflow.url
  }
  if (!process.env.LANGFLOW_API_KEY?.trim() && cfg.langflow.apiKey) {
    process.env.LANGFLOW_API_KEY = cfg.langflow.apiKey
  }
  if (!process.env.LOOP24_LANGFLOW_DISABLED?.trim() && cfg.langflow.enabled === false) {
    process.env.LOOP24_LANGFLOW_DISABLED = "1"
  }
}

// Module-load side effect: run once at import time so downstream env reads
// see config.json values. Wrapped in try/catch — must never break the loader.
try {
  applyConfigToEnv(loadConfig())
} catch {
  /* defensive — should never throw, but absolutely must not break boot */
}

// ─── Probes ───────────────────────────────────────────────────────────────────

export interface ProbeResult {
  ok: boolean
  reason?: string  // populated when ok=false
}

export interface LangflowProbeResult extends ProbeResult {
  version?: string
}

/**
 * Probe gateway /health. Returns ok=true on 2xx, ok=false with a reason on
 * any other outcome (non-2xx, network error, timeout). Never throws.
 *
 * Default 2000ms timeout — runs interactively in the wizard, so a short
 * budget is OK. Used by both the wizard (post-prompt validation) and the
 * loop24 extension's session_start probe (which has its own 1500ms timeout).
 */
export async function probeGateway(url: string, timeoutMs = 2000): Promise<ProbeResult> {
  const target = `${url.replace(/\/+$/, "")}/health`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(target, { signal: ctl.signal })
    if (res.ok) return { ok: true }
    return { ok: false, reason: `${res.status} ${res.statusText}` }
  } catch (err) {
    const e = err as Error & { name?: string }
    const reason = e.name === "AbortError"
      ? `timed out after ${timeoutMs}ms`
      : e.message
    return { ok: false, reason }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Probe LangFlow /api/v1/version. Returns ok=true + version string on success.
 * Optional apiKey is sent as x-api-key header (LangFlow's auth shape; verified
 * in LANGFLOW-API.md from Phase 3).
 */
export async function probeLangflow(url: string, timeoutMs = 2000, apiKey?: string): Promise<LangflowProbeResult> {
  const target = `${url.replace(/\/+$/, "")}/api/v1/version`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = {}
    if (apiKey) headers["x-api-key"] = apiKey
    const res = await fetch(target, { signal: ctl.signal, headers })
    if (!res.ok) return { ok: false, reason: `${res.status} ${res.statusText}` }
    const body = (await res.json()) as { version?: string }
    return { ok: true, version: body.version }
  } catch (err) {
    const e = err as Error & { name?: string }
    const reason = e.name === "AbortError"
      ? `timed out after ${timeoutMs}ms`
      : e.message
    return { ok: false, reason }
  } finally {
    clearTimeout(timer)
  }
}
