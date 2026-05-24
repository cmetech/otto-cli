// Single source of truth for brand strings read from package.json `piConfig`.
//
// Read once here, at module load, using only Node builtins — deliberately NO
// import of the compiled @loop24/pi-coding-agent barrel. That keeps this module
// safe to pull in on the loader's earliest paths (the --version/--help
// fast-path runs before heavy imports) and lets the brand-sensitive wrapper
// files (brand.ts, app-paths.ts, help-text.ts, loop24-config.ts) share ONE
// reader instead of each re-reading package.json with its own fallback literal.
//
// To rebrand: edit the `piConfig` block in the root package.json and run
// `npm run sync-piconfig`. Every value below follows automatically — the string
// literals here are only last-resort fallbacks for when package.json cannot be
// read. The pi framework layer reads the same (synced) piConfig in
// packages/pi-coding-agent/src/config.ts.
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const _pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let _brand = 'LOOP24'
let _command = 'loop24'
let _configDir = '.otto'
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
  if (typeof pkg.piConfig?.configDir === 'string' && pkg.piConfig.configDir.length > 0) {
    _configDir = pkg.piConfig.configDir.startsWith('.') ? pkg.piConfig.configDir : '.' + pkg.piConfig.configDir
  }
  if (pkg.piConfig?.tagline) _tagline = pkg.piConfig.tagline
} catch {
  /* keep fallbacks above */
}

export const BRAND_NAME = _brand
export const COMMAND_NAMESPACE = _command
export const CONFIG_DIR_NAME = _configDir
export const BRAND_TAGLINE = _tagline
