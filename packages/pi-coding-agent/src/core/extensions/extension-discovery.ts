import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readManifest, readManifestFromEntryPath } from './extension-registry.js'

function isExtensionFile(name: string): boolean {
  return name.endsWith('.ts') || name.endsWith('.js')
}

function isPackageManifest(value: unknown): value is { extensions?: unknown } {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return ['extensions', 'skills', 'prompts', 'themes'].some((key) => Array.isArray(obj[key]))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

/**
 * Resolves the entry-point file(s) for a single extension directory.
 *
 * 1. If the directory contains a package.json with an `otto` or legacy `pi` manifest object,
 *    the manifest is authoritative:
 *    - `otto.extensions` / `pi.extensions` array → resolve each entry relative to the directory.
 *    - empty manifest → return empty (library opt-out, e.g. cmux).
 * 2. Only when no package manifest exists does it fall back to `index.ts` → `index.js`.
 */
export function resolveExtensionEntries(dir: string): string[] {
  const packageJsonPath = join(dir, 'package.json')
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      const manifest = isPackageManifest(pkg?.otto)
        ? pkg.otto
        : isObject(pkg?.pi)
          ? pkg.pi
          : undefined
      if (manifest) {
        // When a package manifest exists, it is authoritative — don't fall through
        // to index.ts/index.js auto-detection. This allows library directories
        // (like cmux) to opt out by declaring no extensions.
        const declared = (manifest as Record<string, unknown>).extensions
        if (!Array.isArray(declared) || declared.length === 0) {
          return []
        }
        return declared
          .filter((entry: unknown): entry is string => typeof entry === 'string')
          .map((entry: string) => resolve(dir, entry))
          .filter((entry: string) => existsSync(entry))
      }
    } catch {
      // Ignore malformed manifests and fall back to index.ts/index.js discovery.
    }
  }

  const indexTs = join(dir, 'index.ts')
  if (existsSync(indexTs)) {
    return [indexTs]
  }

  const indexJs = join(dir, 'index.js')
  if (existsSync(indexJs)) {
    return [indexJs]
  }

  return []
}

/**
 * Discovers all extension entry-point paths under an extensions directory.
 *
 * - Top-level .ts/.js files are treated as standalone extension entry points.
 * - Subdirectories are resolved via `resolveExtensionEntries()` (package.json →
 *   otto.extensions/pi.extensions, then index.ts/index.js fallback).
 */
export function discoverExtensionEntryPaths(extensionsDir: string): string[] {
  if (!existsSync(extensionsDir)) {
    return []
  }

  const discovered: string[] = []
  for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
    const entryPath = join(extensionsDir, entry.name)

    if ((entry.isFile() || entry.isSymbolicLink()) && isExtensionFile(entry.name)) {
      discovered.push(entryPath)
      continue
    }

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      discovered.push(...resolveExtensionEntries(entryPath))
    }
  }

  return discovered
}

/**
 * Merge bundled and installed extension entry paths.
 * Installed extensions with the same manifest ID as a bundled extension take precedence (D-14).
 * Loader stays dumb — receives a pre-merged path list (D-15).
 */
export function mergeExtensionEntryPaths(bundledPaths: string[], installedExtDir: string): string[] {
  if (!existsSync(installedExtDir)) return bundledPaths

  // Build map: manifest ID → entry paths for installed extensions
  const installedById = new Map<string, string[]>()
  for (const entry of readdirSync(installedExtDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(installedExtDir, entry.name)
    const manifest = readManifest(dir)
    const entries = resolveExtensionEntries(dir)
    if (manifest && entries.length > 0) {
      installedById.set(manifest.id, entries)
    }
  }

  if (installedById.size === 0) return bundledPaths

  // Filter bundled paths: skip any whose manifest id is shadowed by installed
  const merged: string[] = []
  for (const entryPath of bundledPaths) {
    const manifest = readManifestFromEntryPath(entryPath)
    if (manifest && installedById.has(manifest.id)) continue // shadowed by installed
    merged.push(entryPath)
  }

  // Append all installed entries
  for (const entries of installedById.values()) {
    merged.push(...entries)
  }

  return merged
}
