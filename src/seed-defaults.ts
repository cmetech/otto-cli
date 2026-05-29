// Seeds OTTO's "out of the box" packages into ~/.otto/agent/settings.json so
// the normal package-resolve loop installs and updates them on launch.
//
// On/off precedence (highest first):
//   1. --no-seed-defaults flag             → OFF
//   2. --with-defaults flag                → ON
//   3. OTTO_NO_SEED_DEFAULTS env (1/true)  → OFF
//   4. OTTO_SEED_DEFAULTS env (1/true)     → ON
//   5. settings.json seedDefaultsOnLaunch  → honor stored value
//   6. (built-in default)                  → OFF
//
// Which-packages filter: settings.enabledDefaultPackages
//   - undefined → seed every source listed in OTTO_DEFAULT_PACKAGES (the
//                 back-compat path used by --with-defaults / env-var users who
//                 haven't run onboarding's categorical picker)
//   - [...]     → seed only those sources (the persona-driven path; populated
//                 by the onboarding "Recommended packages" step)
//   - []        → seed nothing (explicit "I picked none")
//
// Zombie-resurrection guard: every source we attempt to seed is recorded in
// settings.seededDefaults. A subsequent `otto remove npm:foo` clears the entry
// from settings.packages but leaves the seededDefaults marker, so we will NOT
// re-add it on the next launch.

import { mkdirSync } from 'node:fs'
import type { PackageSource } from '@otto/pi-coding-agent'

// ─── Categorical package catalog ──────────────────────────────────────────────

export interface DefaultPackage {
  /** Install source as parsed by package-manager (npm:..., git:..., ./...). */
  source: string
  /** Short display name shown in onboarding (without the npm: prefix). */
  name: string
  /** One-line blurb shown as a hint in onboarding's checkbox UI. */
  description: string
  /**
   * When set, this substring is appended to settings.quietExtensions on first
   * seed so the package's session_start banner is silenced by default. Tracked
   * in settings.seededQuietPatterns so a user who removes the pattern from
   * quietExtensions is not overridden on subsequent launches.
   *
   * Use for packages whose maintainers emit unactionable startup chatter
   * (e.g. pi-notion's `[notion] MCP config found …`).
   */
  quietPattern?: string
}

export interface DefaultPackageCategory {
  /** Stable id stored in settings.json:enabledDefaultCategories (future). */
  id: string
  /** Display label shown in the category multiselect. */
  label: string
  /** One-line description shown as a hint on the category multiselect. */
  description: string
  /** Packages included in this category. May be empty for placeholder personas. */
  packages: DefaultPackage[]
}

// Add new personas here. Empty `packages: []` is allowed (the onboarding UI
// will skip categories with no packages so users aren't shown empty lists).
export const OTTO_DEFAULT_PACKAGE_CATEGORIES: readonly DefaultPackageCategory[] = [
  {
    id: 'developer',
    label: 'Developer',
    description: 'MCP adapters and dev-loop helpers for coding work.',
    packages: [
      {
        source: 'npm:pi-mcp-adapter',
        name: 'pi-mcp-adapter',
        description: 'Connect Model Context Protocol servers as OTTO tools.',
      },
      {
        source: 'npm:@juicesharp/rpiv-ask-user-question',
        name: 'rpiv-ask-user-question',
        description: 'Structured mid-task clarifying questions to the user.',
      },
      {
        source: 'npm:@juicesharp/rpiv-todo',
        name: 'rpiv-todo',
        description: 'Lightweight TODO/task tracking inside conversations.',
      },
    ],
  },
  {
    id: 'productivity',
    label: 'Productivity',
    description: 'Notes, knowledge capture, and content-generation helpers.',
    packages: [
      {
        source: 'npm:@feniix/pi-notion',
        name: 'pi-notion',
        description: 'Notion integration — read and write pages, databases, and blocks.',
        // Silences `[notion] MCP config found …` / `[notion] Not authenticated …`
        // session_start banners (pi-notion uses console.log; the AsyncLocalStorage
        // patch in the extension runner catches and drops these for quiet exts).
        quietPattern: 'pi-notion',
      },
      {
        source: 'npm:pi-codex-image-gen',
        name: 'pi-codex-image-gen',
        description: 'On-demand image generation via Codex models.',
      },
    ],
  },
  // Example placeholders for future personas — leave commented or define with
  // real packages when curated:
  // {
  //   id: 'operations',
  //   label: 'Operations',
  //   description: 'Infra, monitoring, and on-call workflows.',
  //   packages: [],
  // },
  // {
  //   id: 'manager',
  //   label: 'Manager',
  //   description: 'Reporting, status, and meeting summaries.',
  //   packages: [],
  // },
]

/**
 * Flat, deduplicated list of every default source across all categories. Used
 * as the back-compat seeding set when no `enabledDefaultPackages` filter is
 * stored (the flag/env users who never went through the categorical
 * onboarding). The `Set` dedupes when the same source legitimately appears in
 * multiple categories (e.g. a productivity tool that's also useful for devs).
 */
export const OTTO_DEFAULT_PACKAGES: readonly string[] = Array.from(
  new Set(OTTO_DEFAULT_PACKAGE_CATEGORIES.flatMap(c => c.packages.map(p => p.source))),
)

/** Categories with at least one package — the only ones worth showing in UI. */
export function getOnboardableCategories(): DefaultPackageCategory[] {
  return OTTO_DEFAULT_PACKAGE_CATEGORIES.filter(c => c.packages.length > 0)
}

// ─── Precedence / seeder ──────────────────────────────────────────────────────

export interface SeedFlags {
  withDefaults?: boolean
  noSeedDefaults?: boolean
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  const v = value.toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function shouldSeedDefaults(
  flags: SeedFlags,
  settingValue: boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (flags.noSeedDefaults) return false
  if (flags.withDefaults) return true
  if (isTruthyEnv(env.OTTO_NO_SEED_DEFAULTS)) return false
  if (isTruthyEnv(env.OTTO_SEED_DEFAULTS)) return true
  if (typeof settingValue === 'boolean') return settingValue
  return false
}

/**
 * Resolves the effective set of sources to seed given the user's enabledDefaultPackages
 * preference. See the file header for semantics of undefined / [] / [...].
 */
export function resolveEnabledDefaults(
  enabled: string[] | undefined,
  all: readonly string[] = OTTO_DEFAULT_PACKAGES,
): string[] {
  if (enabled === undefined) return [...all]
  if (enabled.length === 0) return []
  const allowed = new Set(enabled)
  return all.filter(s => allowed.has(s))
}

function packageSourceKey(pkg: PackageSource): string {
  return typeof pkg === 'string' ? pkg : pkg.source
}

export async function maybeSeedDefaultPackages(
  flags: SeedFlags,
  agentDirPath: string,
): Promise<void> {
  const { SettingsManager } = await import('@otto/pi-coding-agent')

  // First launch may run before any other code has created the agent dir.
  // SettingsManager's file storage joins agentDir + "settings.json", and the
  // underlying lockfile/write will fail if the directory is absent.
  try {
    mkdirSync(agentDirPath, { recursive: true })
  } catch {
    // If we cannot create it, downstream code will surface a clearer error.
  }

  const settingsManager = SettingsManager.create(process.cwd(), agentDirPath)
  const settingValue = settingsManager.getSeedDefaultsOnLaunch()
  if (!shouldSeedDefaults(flags, settingValue)) return

  const targetSources = resolveEnabledDefaults(settingsManager.getEnabledDefaultPackages())
  if (targetSources.length === 0) return

  const existingPackages = settingsManager.getPackages()
  const existingSources = new Set(existingPackages.map(packageSourceKey))
  const seededBefore = new Set(settingsManager.getSeededDefaults())

  // Defensive in-loop dedup: even though OTTO_DEFAULT_PACKAGES is deduplicated
  // at module-load time, settings.enabledDefaultPackages can be hand-edited.
  // Don't push the same source twice in a single seeding pass.
  const justAdded = new Set<string>()
  let mutatedPackages = false
  const newPackages: PackageSource[] = [...existingPackages]
  for (const source of targetSources) {
    // Zombie guard: a previously-seeded source that the user removed must not
    // be re-added on subsequent launches.
    if (seededBefore.has(source)) continue
    if (existingSources.has(source) || justAdded.has(source)) continue
    newPackages.push(source)
    justAdded.add(source)
    mutatedPackages = true
  }

  // Reconcile seededDefaults to the union of what we've seen — every target we
  // attempted in this run has been "seen," whether or not it needed to be added
  // to packages.
  const newSeeded = Array.from(new Set([...seededBefore, ...targetSources]))
  const seededChanged = newSeeded.length !== seededBefore.size

  if (mutatedPackages) {
    settingsManager.setPackages(newPackages)
  }
  if (seededChanged) {
    settingsManager.setSeededDefaults(newSeeded)
  }

  // ── Reconcile quietExtensions ──────────────────────────────────────────────
  // Packages can declare a `quietPattern` (e.g. pi-notion). When we seed such a
  // package for the first time, also append its pattern to settings.quietExtensions.
  // Tracked via settings.seededQuietPatterns so a user who removes the pattern
  // from quietExtensions is not overridden on subsequent launches (same zombie
  // guard as seededDefaults).
  const desiredQuietPatterns = collectQuietPatternsForSources(targetSources)
  if (desiredQuietPatterns.length > 0) {
    const seededPatternsBefore = new Set(settingsManager.getSeededQuietPatterns())
    const existingQuiet = new Set(settingsManager.getQuietExtensions())
    const newQuiet = [...settingsManager.getQuietExtensions()]
    let quietChanged = false
    for (const pattern of desiredQuietPatterns) {
      if (seededPatternsBefore.has(pattern)) continue
      if (!existingQuiet.has(pattern)) {
        newQuiet.push(pattern)
        existingQuiet.add(pattern)
        quietChanged = true
      }
    }
    const newSeededPatterns = Array.from(new Set([...seededPatternsBefore, ...desiredQuietPatterns]))
    const seededPatternsChanged = newSeededPatterns.length !== seededPatternsBefore.size
    if (quietChanged) settingsManager.setQuietExtensions(newQuiet)
    if (seededPatternsChanged) settingsManager.setSeededQuietPatterns(newSeededPatterns)
  }
}

/**
 * Walk the categorical catalog and return the `quietPattern` value for every
 * default package whose source is in `targetSources`. Used by the seeder to
 * decide which quiet patterns to add to `settings.quietExtensions`.
 */
function collectQuietPatternsForSources(targetSources: readonly string[]): string[] {
  const targets = new Set(targetSources)
  const patterns = new Set<string>()
  for (const category of OTTO_DEFAULT_PACKAGE_CATEGORIES) {
    for (const pkg of category.packages) {
      if (pkg.quietPattern && targets.has(pkg.source)) {
        patterns.add(pkg.quietPattern)
      }
    }
  }
  return Array.from(patterns)
}
