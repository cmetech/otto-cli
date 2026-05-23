/**
 * LOOP24 services first-run wizard.
 *
 * Captures gateway + langflow config from the user and persists to
 * ~/.loop24/config.json (mode 0600). Soft-warns on probe failure rather
 * than refusing to save — users frequently configure LOOP24 before the
 * services are running.
 *
 * Mirrors src/onboarding.ts's @clack/prompts + chalk pattern. Dynamic
 * imports so a missing @clack/prompts dependency degrades to a single
 * warn line instead of crashing boot.
 *
 * Re-entry: idempotent. Re-running just overwrites the existing config
 * (Task 5 wires this into the `loop24 setup` subcommand).
 */

import { existsSync } from 'node:fs'
import { BRAND_NAME, COMMAND_NAMESPACE } from './brand.js'
import {
  loadConfig,
  saveConfig,
  configPath,
  probeGateway,
  probeLangflow,
  type Loop24Config,
} from './loop24-config.js'

type ClackModule = typeof import('@clack/prompts')
type ChalkModule = typeof import('chalk').default

async function loadClack(): Promise<ClackModule | null> {
  try { return await import('@clack/prompts') } catch { return null }
}

async function loadChalk(): Promise<ChalkModule | null> {
  try { return (await import('chalk')).default } catch { return null }
}

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch { return false }
}

/**
 * Run the wizard interactively. Returns the saved config on success, null on
 * user cancel. Never throws — any I/O failure during save is logged and the
 * function returns null.
 */
export async function runLoop24Wizard(): Promise<Loop24Config | null> {
  const p = await loadClack()
  const chalk = await loadChalk()

  if (!p) {
    process.stderr.write(
      `[${COMMAND_NAMESPACE}] @clack/prompts not found — cannot run wizard.\n` +
      `[${COMMAND_NAMESPACE}] Set LOOP24_GATEWAY_URL and LANGFLOW_SERVER_URL env vars instead.\n`,
    )
    return null
  }

  const brandYellow = (s: string) => `\x1b[38;2;250;210;45m${s}\x1b[0m`
  const dim = chalk ? (s: string) => chalk.dim(s) : (s: string) => s
  const green = chalk ? (s: string) => chalk.green(s) : (s: string) => s
  const red = chalk ? (s: string) => chalk.red(s) : (s: string) => s

  p.intro(brandYellow(`${BRAND_NAME} — services setup`))
  p.log.info(dim(`Saves to ${configPath()} (mode 0600).`))
  p.log.info(dim(`Env vars (LOOP24_GATEWAY_URL etc.) always override this file.`))

  // Load existing config (or defaults) so re-running the wizard uses
  // current values as the prompt defaults.
  const existing = loadConfig()

  // ── Gateway URL ───────────────────────────────────────────────────────────
  // Port 8080 is a placeholder until the real loop24-gateway lands (design spec Q1).
  const gatewayUrlDefault = existing.gateway.url ?? "http://127.0.0.1:8080/v1"
  const gatewayUrlAns = await p.text({
    message: 'Gateway URL?',
    placeholder: gatewayUrlDefault,
    initialValue: gatewayUrlDefault,
    validate: (val) => {
      const v = val?.trim()
      if (!v) return 'Gateway URL is required'
      if (!isValidHttpUrl(v)) return 'Must be a valid http(s) URL'
      return
    },
  })
  if (p.isCancel(gatewayUrlAns)) { p.cancel('Setup cancelled.'); return null }
  const gatewayUrl = (gatewayUrlAns as string).trim()

  // ── Gateway token (optional) ──────────────────────────────────────────────
  const wantsToken = await p.confirm({
    message: 'Does the gateway require a bearer token?',
    initialValue: existing.gateway.token !== null,
  })
  if (p.isCancel(wantsToken)) { p.cancel('Setup cancelled.'); return null }

  let gatewayToken: string | null = null
  if (wantsToken) {
    const tok = await p.password({ message: 'Paste the gateway bearer token:', mask: '●' })
    if (p.isCancel(tok)) { p.cancel('Setup cancelled.'); return null }
    const t = (tok as string).trim()
    gatewayToken = t || null
  }

  // ── Probe gateway ─────────────────────────────────────────────────────────
  const s1 = p.spinner()
  s1.start(`Probing gateway at ${gatewayUrl}...`)
  const gwProbe = await probeGateway(gatewayUrl)
  if (gwProbe.ok) {
    s1.stop(green(`Gateway reachable at ${gatewayUrl}`))
  } else {
    s1.stop(red(`Gateway probe failed: ${gwProbe.reason}`))
    p.log.warn(`Saving anyway — the gateway may not be running yet.`)
  }

  // ── LangFlow enabled? ─────────────────────────────────────────────────────
  const langflowEnabled = await p.confirm({
    message: 'Use LangFlow?',
    initialValue: existing.langflow.enabled,
  })
  if (p.isCancel(langflowEnabled)) { p.cancel('Setup cancelled.'); return null }

  let langflowUrl = existing.langflow.url
  let langflowApiKey: string | null = existing.langflow.apiKey

  if (langflowEnabled) {
    // ── LangFlow URL ────────────────────────────────────────────────────────
    const lfUrlAns = await p.text({
      message: 'LangFlow URL?',
      placeholder: langflowUrl,
      initialValue: langflowUrl,
      validate: (val) => {
        const v = val?.trim()
        if (!v) return 'LangFlow URL is required'
        if (!isValidHttpUrl(v)) return 'Must be a valid http(s) URL'
        return
      },
    })
    if (p.isCancel(lfUrlAns)) { p.cancel('Setup cancelled.'); return null }
    langflowUrl = (lfUrlAns as string).trim()

    // ── LangFlow API key (optional) ─────────────────────────────────────────
    const wantsKey = await p.confirm({
      message: 'Does LangFlow require an API key?',
      initialValue: existing.langflow.apiKey !== null,
    })
    if (p.isCancel(wantsKey)) { p.cancel('Setup cancelled.'); return null }

    if (wantsKey) {
      const k = await p.password({ message: 'Paste the LangFlow API key:', mask: '●' })
      if (p.isCancel(k)) { p.cancel('Setup cancelled.'); return null }
      const trimmed = (k as string).trim()
      langflowApiKey = trimmed || null
    } else {
      langflowApiKey = null
    }

    // ── Probe LangFlow ──────────────────────────────────────────────────────
    const s2 = p.spinner()
    s2.start(`Probing LangFlow at ${langflowUrl}...`)
    const lfProbe = await probeLangflow(langflowUrl, 2000, langflowApiKey ?? undefined)
    if (lfProbe.ok) {
      s2.stop(green(`LangFlow reachable${lfProbe.version ? ` (v${lfProbe.version})` : ""}`))
    } else {
      s2.stop(red(`LangFlow probe failed: ${lfProbe.reason}`))
      p.log.warn(`Saving anyway — LangFlow may not be running yet.`)
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const cfg: Loop24Config = {
    gateway: { url: gatewayUrl, token: gatewayToken },
    langflow: { url: langflowUrl, apiKey: langflowApiKey, enabled: !!langflowEnabled },
  }

  try {
    saveConfig(cfg)
  } catch (err) {
    p.log.error(`Failed to write ${configPath()}: ${(err as Error).message}`)
    return null
  }

  const summary: string[] = [
    `${green('✓')} Gateway: ${gatewayUrl}${gatewayToken ? dim(' (with token)') : ''}`,
    langflowEnabled
      ? `${green('✓')} LangFlow: ${langflowUrl}${langflowApiKey ? dim(' (with API key)') : ''}`
      : `${dim('↷')} LangFlow: disabled`,
    '',
    `${dim('Saved to')} ${configPath()}`,
    `${dim('Re-run with')} ${COMMAND_NAMESPACE} setup`,
  ]
  p.note(summary.join('\n'), 'Setup complete')
  p.outro(dim(`Launching ${BRAND_NAME}...`))

  return cfg
}

/**
 * Return true if the LOOP24 services wizard should run on first launch.
 * Mirrors src/onboarding.ts:shouldRunOnboarding shape.
 */
export function shouldRunLoop24Wizard(opts: { isPrint: boolean; isTTY: boolean }): boolean {
  if (opts.isPrint) return false
  if (!opts.isTTY) return false
  return !existsSync(configPath())
}
