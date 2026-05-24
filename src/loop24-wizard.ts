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
 * Re-entry: idempotent. Re-running just overwrites the existing config.
 * Available as `otto config [gateway|langflow|all]`.
 */

import { existsSync } from 'node:fs'
import { BRAND_NAME, COMMAND_NAMESPACE } from './brand.js'
import { ANSI_BRAND_YELLOW, ANSI_RESET } from './brand-colors.js'
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

export type WizardSection = "gateway" | "langflow" | "all"

export interface WizardOptions {
  section?: WizardSection  // default "all"
}

// ── Internal section helpers ──────────────────────────────────────────────────

async function promptGateway(
  p: ClackModule,
  existing: Loop24Config["gateway"],
  colors: { dim: (s: string) => string; green: (s: string) => string; red: (s: string) => string },
): Promise<{ url: string; token: string | null } | "cancelled"> {
  const { green, red } = colors

  const gatewayUrlDefault = existing.url ?? "http://127.0.0.1:8080/v1"
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
  if (p.isCancel(gatewayUrlAns)) { p.cancel('Setup cancelled.'); return "cancelled" }
  const gatewayUrl = (gatewayUrlAns as string).trim()

  const wantsToken = await p.confirm({
    message: 'Does the gateway require a bearer token?',
    initialValue: existing.token !== null,
  })
  if (p.isCancel(wantsToken)) { p.cancel('Setup cancelled.'); return "cancelled" }

  let gatewayToken: string | null = null
  if (wantsToken) {
    const tok = await p.password({ message: 'Paste the gateway bearer token:', mask: '●' })
    if (p.isCancel(tok)) { p.cancel('Setup cancelled.'); return "cancelled" }
    const t = (tok as string).trim()
    gatewayToken = t || null
  }

  // Probe gateway
  const s1 = p.spinner()
  s1.start(`Probing gateway at ${gatewayUrl}...`)
  const gwProbe = await probeGateway(gatewayUrl)
  if (gwProbe.ok) {
    s1.stop(green(`Gateway reachable at ${gatewayUrl}`))
  } else {
    s1.stop(red(`Gateway probe failed: ${gwProbe.reason}`))
    p.log.warn(`Saving anyway — the gateway may not be running yet.`)
  }

  return { url: gatewayUrl, token: gatewayToken }
}

async function promptLangflow(
  p: ClackModule,
  existing: Loop24Config["langflow"],
  colors: { dim: (s: string) => string; green: (s: string) => string; red: (s: string) => string },
): Promise<{ url: string; apiKey: string | null; enabled: boolean } | "cancelled"> {
  const { green, red } = colors

  const langflowEnabled = await p.confirm({
    message: 'Use LangFlow?',
    initialValue: existing.enabled,
  })
  if (p.isCancel(langflowEnabled)) { p.cancel('Setup cancelled.'); return "cancelled" }

  let langflowUrl = existing.url
  let langflowApiKey: string | null = existing.apiKey

  if (langflowEnabled) {
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
    if (p.isCancel(lfUrlAns)) { p.cancel('Setup cancelled.'); return "cancelled" }
    langflowUrl = (lfUrlAns as string).trim()

    const wantsKey = await p.confirm({
      message: 'Does LangFlow require an API key?',
      initialValue: existing.apiKey !== null,
    })
    if (p.isCancel(wantsKey)) { p.cancel('Setup cancelled.'); return "cancelled" }

    if (wantsKey) {
      const k = await p.password({ message: 'Paste the LangFlow API key:', mask: '●' })
      if (p.isCancel(k)) { p.cancel('Setup cancelled.'); return "cancelled" }
      const trimmed = (k as string).trim()
      langflowApiKey = trimmed || null
    } else {
      langflowApiKey = null
    }

    // Probe LangFlow
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

  return { url: langflowUrl, apiKey: langflowApiKey, enabled: !!langflowEnabled }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the wizard interactively. Returns the saved config on success, null on
 * user cancel. Never throws — any I/O failure during save is logged and the
 * function returns null.
 *
 * opts.section defaults to "all". Pass "gateway" or "langflow" to run only
 * that section's prompts and merge the result into the existing config.
 */
export async function runLoop24Wizard(opts?: WizardOptions): Promise<Loop24Config | null> {
  const section: WizardSection = opts?.section ?? "all"

  const p = await loadClack()
  const chalk = await loadChalk()

  if (!p) {
    process.stderr.write(
      `[${COMMAND_NAMESPACE}] @clack/prompts not found — cannot run wizard.\n` +
      `[${COMMAND_NAMESPACE}] Set LOOP24_GATEWAY_URL and LANGFLOW_SERVER_URL env vars instead.\n`,
    )
    return null
  }

  const brandYellow = (s: string) => `${ANSI_BRAND_YELLOW}${s}${ANSI_RESET}`
  const dim = chalk ? (s: string) => chalk.dim(s) : (s: string) => s
  const green = chalk ? (s: string) => chalk.green(s) : (s: string) => s
  const red = chalk ? (s: string) => chalk.red(s) : (s: string) => s
  const colors = { dim, green, red }

  const introLabel =
    section === "gateway" ? `${BRAND_NAME} — gateway config` :
    section === "langflow" ? `${BRAND_NAME} — LangFlow config` :
    `${BRAND_NAME} — services setup`

  p.intro(brandYellow(introLabel))
  p.log.info(dim(`Saves to ${configPath()} (mode 0600).`))
  p.log.info(dim(`Env vars (LOOP24_GATEWAY_URL etc.) always override this file.`))

  // Load existing config (or defaults) so re-running the wizard uses
  // current values as the prompt defaults.
  const existing = loadConfig()

  // Accumulated result — start with existing values and overwrite sections.
  let gatewayResult: { url: string; token: string | null } | null = null
  let langflowResult: { url: string; apiKey: string | null; enabled: boolean } | null = null

  if (section === "gateway" || section === "all") {
    const result = await promptGateway(p, existing.gateway, colors)
    if (result === "cancelled") return null
    gatewayResult = result
  }

  if (section === "langflow" || section === "all") {
    const result = await promptLangflow(p, existing.langflow, colors)
    if (result === "cancelled") return null
    langflowResult = result
  }

  // ── Merge & save ─────────────────────────────────────────────────────────
  const cfg: Loop24Config = {
    gateway: gatewayResult
      ? { url: gatewayResult.url, token: gatewayResult.token }
      : existing.gateway,
    langflow: langflowResult
      ? { url: langflowResult.url, apiKey: langflowResult.apiKey, enabled: langflowResult.enabled }
      : existing.langflow,
  }

  try {
    saveConfig(cfg)
  } catch (err) {
    p.log.error(`Failed to write ${configPath()}: ${(err as Error).message}`)
    return null
  }

  // ── Summary (only show lines for sections we actually ran) ──────────────
  const summaryLines: string[] = []

  if (gatewayResult) {
    summaryLines.push(
      `${green('✓')} Gateway: ${gatewayResult.url}${gatewayResult.token ? dim(' (with token)') : ''}`,
    )
  }

  if (langflowResult) {
    summaryLines.push(
      langflowResult.enabled
        ? `${green('✓')} LangFlow: ${langflowResult.url}${langflowResult.apiKey ? dim(' (with API key)') : ''}`
        : `${dim('↷')} LangFlow: disabled`,
    )
  }

  summaryLines.push('')
  summaryLines.push(`${dim('Saved to')} ${configPath()}`)
  summaryLines.push(`${dim('Re-run with')} ${COMMAND_NAMESPACE} config`)

  p.note(summaryLines.join('\n'), 'Setup complete')
  p.outro(dim(`Launching ${BRAND_NAME}...`))

  return cfg
}

/**
 * Interactive menu — asks the user which config section to run.
 * Returns the selected section, or null if the user cancelled.
 * The "llm" choice is returned to the caller to route to runOnboarding.
 */
export async function selectConfigSection(): Promise<"gateway" | "langflow" | "llm" | "all" | null> {
  const p = await loadClack()

  if (!p) {
    process.stderr.write(
      `[${COMMAND_NAMESPACE}] @clack/prompts not found — cannot show config menu.\n` +
      `[${COMMAND_NAMESPACE}] Use: ${COMMAND_NAMESPACE} config gateway|langflow|llm|all\n`,
    )
    return null
  }

  const brandYellow = (s: string) => `${ANSI_BRAND_YELLOW}${s}${ANSI_RESET}`
  p.intro(brandYellow(`${BRAND_NAME} — configure`))

  const choice = await p.select({
    message: 'What do you want to configure?',
    options: [
      { value: 'gateway', label: 'Gateway URL + token' },
      { value: 'langflow', label: 'LangFlow URL + key' },
      { value: 'llm', label: 'LLM provider (Anthropic, OpenAI, etc.)' },
      { value: 'all', label: 'Everything' },
    ],
  })

  if (p.isCancel(choice)) {
    p.cancel('Cancelled.')
    return null
  }

  return choice as "gateway" | "langflow" | "llm" | "all"
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
