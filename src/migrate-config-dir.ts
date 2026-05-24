// One-time copy migration of the user config dir from the legacy ~/.loop24
// location to the current configDir (~/.otto), introduced with the OTTO
// config-dir rebrand (branding step 3).
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, cpSync } from 'node:fs'

/**
 * Copy ~/.loop24 → the resolved appRoot (~/.otto) on first launch after the
 * rebrand. Best-effort and idempotent:
 *
 * - Skips when LOOP24_HOME/GSD_HOME is set — an explicit home override makes the
 *   resolved appRoot identical before and after the rebrand, so there is nothing
 *   to migrate.
 * - Skips when appRoot already exists (already migrated, or a fresh post-rebrand
 *   install) or when the legacy dir is absent (brand-new user).
 * - Leaves ~/.loop24 intact as a safety net; the user deletes it manually.
 * - Never throws — config migration must not be able to crash the loader.
 *
 * Returns true only when a copy was actually performed (useful for tests/logs).
 */
export function migrateLegacyConfigDir(appRoot: string): boolean {
  try {
    if (process.env.LOOP24_HOME || process.env.GSD_HOME) return false
    const legacy = join(homedir(), '.loop24')
    if (appRoot === legacy) return false
    if (existsSync(appRoot)) return false
    if (!existsSync(legacy)) return false
    cpSync(legacy, appRoot, { recursive: true })
    return true
  } catch {
    return false
  }
}
