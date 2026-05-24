// Brand-aware app paths. The config-dir name comes from the single piConfig
// reader (src/piconfig.ts), which uses only Node builtins — no compiled
// @loop24/pi-coding-agent import — so this file stays safe on the very early
// loader path.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_DIR_NAME } from './piconfig.js'

// LOOP24_HOME (preferred) and GSD_HOME (legacy) both accepted as overrides.
export const appRoot = process.env.LOOP24_HOME || process.env.GSD_HOME || join(homedir(), CONFIG_DIR_NAME)
export const agentDir = join(appRoot, 'agent')
export const sessionsDir = join(appRoot, 'sessions')
export const authFilePath = join(agentDir, 'auth.json')
export const webPidFilePath = join(appRoot, 'web-server.pid')
export const webPreferencesPath = join(appRoot, 'web-preferences.json')
