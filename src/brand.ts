/**
 * Shared brand strings, re-exported from the single piConfig reader
 * (src/piconfig.ts). This module additionally wires the OTTO services-config
 * side effect and the optional gateway env reads. It avoids importing any
 * compiled @otto/pi-coding-agent module because it may be pulled in early by
 * the onboarding/welcome paths.
 */
// Load OTTO services config first — its module-load side effect populates
// process.env from ~/.otto/config.json for any env var that is unset.
// This ensures the OTTO_GATEWAY_URL read below picks up config-file values
// when no env override is in place.
import './otto-config.js'
// Brand strings come from the single piConfig reader (src/piconfig.ts).
import { BRAND_NAME, COMMAND_NAMESPACE, CONFIG_DIR_NAME, BRAND_TAGLINE } from './piconfig.js'

export { BRAND_NAME, COMMAND_NAMESPACE, CONFIG_DIR_NAME, BRAND_TAGLINE }

/**
 * Optional gateway routing for LLM traffic. When OTTO_GATEWAY_URL is set,
 * all Anthropic-SDK traffic is redirected to that URL with optional Bearer
 * auth. Both vars are read from the environment so they can be set per-shell
 * without persisting to the user's config dir.
 *
 * In Phase 1 these are env-var only. Phase 2b's first-run wizard adds
 * persistent storage under ~/.otto/config.json.
 */
export const OTTO_GATEWAY_URL: string | undefined = process.env.OTTO_GATEWAY_URL?.trim() || undefined
export const OTTO_GATEWAY_TOKEN: string | undefined = process.env.OTTO_GATEWAY_TOKEN?.trim() || undefined
