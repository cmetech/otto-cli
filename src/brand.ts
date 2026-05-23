/**
 * Shared brand strings.
 *
 * Reads piConfig from package.json synchronously at module load — mirrors
 * src/help-text.ts and src/app-paths.ts so we don't import any compiled
 * @gsd/pi-coding-agent module (this file may be pulled in early by the
 * onboarding/welcome paths).
 */
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const _here = dirname(fileURLToPath(import.meta.url))
const _pkgRoot = resolve(_here, '..')

let _brand = 'LOOP24'
let _command = 'loop24'
let _configDir = '.loop24'
let _tagline = 'compliant agent for developers'

try {
  const pkg = JSON.parse(readFileSync(join(_pkgRoot, 'package.json'), 'utf-8')) as {
    piConfig?: {
      brandName?: string
      commandNamespace?: string
      configDir?: string
      tagline?: string
    }
  }
  if (pkg.piConfig?.brandName) _brand = pkg.piConfig.brandName
  if (pkg.piConfig?.commandNamespace) _command = pkg.piConfig.commandNamespace
  if (pkg.piConfig?.configDir) _configDir = pkg.piConfig.configDir
  if (pkg.piConfig?.tagline) _tagline = pkg.piConfig.tagline
} catch {
  /* fall back to defaults above */
}

export const BRAND_NAME = _brand
export const COMMAND_NAMESPACE = _command
export const CONFIG_DIR_NAME = _configDir
export const BRAND_TAGLINE = _tagline
