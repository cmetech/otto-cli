/**
 * Models.json resolution with fallback to ~/.pi/agent/models.json
 *
 * The agent uses ~/.otto/agent/models.json, but for a smooth migration/development
 * experience, this module provides resolution logic that:
 *
 * 1. Reads ~/.otto/agent/models.json if it exists
 * 2. Falls back to ~/.pi/agent/models.json if the agent file doesn't exist
 * 3. Merges both files if both exist (agent file takes precedence)
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { agentDir } from './app-paths.js'

const OTTO_MODELS_PATH = join(agentDir, 'models.json')
const PI_MODELS_PATH = join(homedir(), '.pi', 'agent', 'models.json')

/**
 * Resolve the path to models.json with fallback logic.
 *
 * Priority:
 * 1. ~/.otto/agent/models.json (exists) → return this path
 * 2. ~/.pi/agent/models.json (exists) → return this path (fallback)
 * 3. Neither exists → return agent path (will be created)
 *
 * @returns The path to use for models.json
 */
export function resolveModelsJsonPath(): string {
  if (existsSync(OTTO_MODELS_PATH)) {
    return OTTO_MODELS_PATH
  }
  if (existsSync(PI_MODELS_PATH)) {
    return PI_MODELS_PATH
  }
  return OTTO_MODELS_PATH
}


