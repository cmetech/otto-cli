// Brand-aware app paths. Reads piConfig.configDir from package.json at module
// load (synchronous, same pattern as src/help-text.ts) so we don't import any
// compiled @gsd/pi-coding-agent module — this file is pulled in very early by
// src/loader.ts before heavy modules load.
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const _here = dirname(fileURLToPath(import.meta.url))
const _pkgRoot = resolve(_here, '..')

let _configDir = '.loop24'
try {
  const pkg = JSON.parse(readFileSync(join(_pkgRoot, 'package.json'), 'utf-8')) as {
    piConfig?: { configDir?: string }
  }
  if (typeof pkg.piConfig?.configDir === 'string' && pkg.piConfig.configDir.length > 0) {
    _configDir = pkg.piConfig.configDir.startsWith('.')
      ? pkg.piConfig.configDir
      : '.' + pkg.piConfig.configDir
  }
} catch {
  /* fall back to default above */
}

// LOOP24_HOME (preferred) and GSD_HOME (legacy) both accepted as overrides.
export const appRoot = process.env.LOOP24_HOME || (process.env.LOOP24_HOME ?? process.env.GSD_HOME) || join(homedir(), _configDir)
export const agentDir = join(appRoot, 'agent')
export const sessionsDir = join(appRoot, 'sessions')
export const authFilePath = join(agentDir, 'auth.json')
export const webPidFilePath = join(appRoot, 'web-server.pid')
export const webPreferencesPath = join(appRoot, 'web-preferences.json')
