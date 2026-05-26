// Brand-aware app paths. The config-dir name comes from the single piConfig
// reader (src/piconfig.ts), which uses only Node builtins — no compiled
// @otto/pi-coding-agent import — so this file stays safe on the very early
// loader path.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_DIR_NAME } from './piconfig.js'

// OTTO_HOME is canonical; OTTO_HOME is still accepted during the fork transition.
export const appRoot = process.env.OTTO_HOME || process.env.OTTO_HOME || join(homedir(), CONFIG_DIR_NAME)
export const agentDir = join(appRoot, 'agent')
export const sessionsDir = join(appRoot, 'sessions')
export const authFilePath = join(agentDir, 'auth.json')
