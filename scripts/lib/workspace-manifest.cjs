// scripts/lib/workspace-manifest.cjs — single source of truth for linkable @otto/* packages
'use strict'

const { readdirSync, readFileSync, existsSync, statSync } = require('fs')
const { join, resolve } = require('path')

const REPO_ROOT = resolve(__dirname, '..', '..')
const PACKAGES_DIR = join(REPO_ROOT, 'packages')

/**
 * Returns the canonical list of linkable workspace packages.
 *
 * A package is "linkable" if its `package.json` contains:
 *   { "otto": { "linkable": true, "scope": "@otto" | "@otto-build", "name": "<pkgname>" } }
 *
 * Each returned entry has:
 *   - dir: directory name under packages/ (e.g. "pi-agent-core")
 *   - scope: "@otto" or "@otto-build"
 *   - name: unscoped package name (e.g. "pi-agent-core")
 *   - packageName: scoped name (e.g. "@otto/pi-agent-core")
 *   - path: absolute path to package directory
 *   - packageJsonPath: absolute path to its package.json
 *
 * Used by:
 *   - scripts/link-workspace-packages.cjs (node_modules linkage)
 *   - src/loader.ts (via scripts/generate-ws-packages.cjs)
 *   - scripts/validate-pack.js (pack-install smoke checks)
 *   - scripts/verify-workspace-coverage.cjs (CI coverage gate)
 */
function getLinkablePackages() {
	if (!existsSync(PACKAGES_DIR)) return []
	const entries = readdirSync(PACKAGES_DIR)
	const out = []
	for (const dir of entries) {
		const pkgPath = join(PACKAGES_DIR, dir)
		if (!statSync(pkgPath).isDirectory()) continue
		const pkgJsonPath = join(pkgPath, 'package.json')
		if (!existsSync(pkgJsonPath)) continue
		let pkg
		try {
			pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
		} catch (err) {
			throw new Error(`Invalid package.json at ${pkgJsonPath}: ${err.message}`)
		}
		const otto = pkg.otto ?? pkg.gsd
		if (!otto || otto.linkable !== true) continue
		if (!otto.scope || !otto.name) {
			throw new Error(
				`${pkgJsonPath}: "otto.linkable" is true but "otto.scope" or "otto.name" is missing.`
			)
		}
		if (otto.scope !== '@otto' && otto.scope !== '@otto-build') {
			throw new Error(
				`${pkgJsonPath}: "otto.scope" must be "@otto" or "@otto-build" (got "${otto.scope}").`
			)
		}
		const expectedName = `${otto.scope}/${otto.name}`
		if (pkg.name !== expectedName) {
			throw new Error(
				`${pkgJsonPath}: package.json "name" (${pkg.name}) does not match otto.scope/otto.name (${expectedName}).`
			)
		}
		out.push({
			dir,
			scope: otto.scope,
			name: otto.name,
			packageName: pkg.name,
			path: pkgPath,
			packageJsonPath: pkgJsonPath,
		})
	}
	out.sort((a, b) => a.packageName.localeCompare(b.packageName))
	return out
}

/** Returns only packages in the `@otto` scope (excludes `@otto-build`). */
function getCorePackages() {
	return getLinkablePackages().filter((p) => p.scope === '@otto')
}

module.exports = {
	REPO_ROOT,
	PACKAGES_DIR,
	getLinkablePackages,
	getCorePackages,
}
