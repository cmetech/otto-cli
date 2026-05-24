#!/usr/bin/env node
// LOOP24 Startup Loader
import { fileURLToPath } from 'url'
import { dirname, resolve, join, relative, delimiter } from 'path'
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, symlinkSync, cpSync } from 'fs'
import { ANSI_BRAND_YELLOW, ANSI_BRAND_GREEN, ANSI_DIM, ANSI_RESET } from './brand-colors.js'

// Fast-path: handle --version/-v and --help/-h before importing any heavy
// dependencies. This avoids loading the entire pi-coding-agent barrel import
// (~1s) just to print a version string.
const workflowRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const firstArg = args[0]

// Read package.json once — reused for version, banner, and GSD_VERSION below
let workflowVersion = '0.0.0'
try {
  const pkg = JSON.parse(readFileSync(join(workflowRoot, 'package.json'), 'utf-8'))
  workflowVersion = pkg.version || '0.0.0'
} catch { /* ignore */ }

if (firstArg === '--version' || firstArg === '-v') {
  process.stdout.write(workflowVersion + '\n')
  process.exit(0)
}

if (firstArg === '--help' || firstArg === '-h') {
  const { printHelp } = await import('./help-text.js')
  printHelp(workflowVersion)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Runtime dependency checks — fail fast with clear diagnostics before any
// heavy imports. Reads minimum Node version from the engines field in
// package.json (already parsed above) and verifies git is available.
// ---------------------------------------------------------------------------
{
  const { MIN_NODE_MAJOR, checkNodeVersion, requireGit } = await import('./runtime-checks.js')
  const red = '\x1b[31m'
  const bold = '\x1b[1m'
  const dim = '\x1b[2m'
  const reset = '\x1b[0m'

  // -- Node version --
  const nodeCheck = checkNodeVersion(process.versions.node, MIN_NODE_MAJOR)
  if (!nodeCheck.ok) {
    process.stderr.write(
      `\n${red}${bold}Error:${reset} LOOP24 requires Node.js >= ${MIN_NODE_MAJOR}.0.0\n` +
      `       You are running Node.js ${process.versions.node}\n\n` +
      `${dim}Install a supported version:${reset}\n` +
      `  nvm install ${MIN_NODE_MAJOR}   ${dim}# if using nvm${reset}\n` +
      `  fnm install ${MIN_NODE_MAJOR}   ${dim}# if using fnm${reset}\n` +
      `  brew install node@${MIN_NODE_MAJOR} ${dim}# macOS Homebrew${reset}\n\n`
    )
    process.exit(1)
  }

  // -- git --
  const { execFileSync } = await import('child_process')
  const gitOk = requireGit((cmd, args) => execFileSync(cmd, args as string[], { stdio: 'ignore' }))
  if (!gitOk) {
    process.stderr.write(
      `\n${red}${bold}Error:${reset} LOOP24 requires git but it was not found on PATH.\n\n` +
      `${dim}Install git:${reset}\n` +
      `  https://git-scm.com/downloads\n\n`
    )
    process.exit(1)
  }
}

import { agentDir, appRoot } from './app-paths.js'
import { migrateLegacyConfigDir } from './migrate-config-dir.js'
import { applyRtkProcessEnv } from './rtk-shared.js'
import { serializeBundledExtensionPaths } from './bundled-extension-paths.js'
import { resolveBundledResourcesDirFromPackageRoot } from './bundled-resource-path.js'
import { discoverExtensionEntryPaths } from './extension-discovery.js'
import { loadRegistry, readManifestFromEntryPath, isExtensionEnabled } from './extension-registry.js'
import { applyLoaderCliEntrypointEnv } from './loader-entrypoint.js'

// pkg/ is a shim directory: contains gsd's piConfig (package.json) and pi's
// theme assets (dist/modes/interactive/theme/) without a src/ directory.
// This allows config.js to:
//   1. Read piConfig.name → "gsd" (branding)
//   2. Resolve themes via dist/ (no src/ present → uses dist path)
const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'pkg')

// MUST be set before any dynamic import of pi SDK fires — this is what config.js
// reads to determine APP_NAME and CONFIG_DIR_NAME
process.env.PI_PACKAGE_DIR = pkgDir
process.env.PI_SKIP_VERSION_CHECK = '1'  // LOOP24 runs its own update check in cli.ts — suppress pi's
process.title = 'loop24'

// LOOP24_CLEAR_ON_START — opt-in pre-launch screen clear. pi-tui renders inline
// (no alternate screen buffer), which keeps shell history visible above the TUI
// but can look "squished" when previous terminal output is already on screen.
// Users who want a fresh-app feel set this in their shell config.
if (process.env.LOOP24_CLEAR_ON_START && process.env.LOOP24_CLEAR_ON_START !== '0') {
  process.stdout.write('\x1b[2J\x1b[H')  // Clear screen + home cursor
}

// PI_CLEAR_ON_SHRINK=1 — when content shrinks below the previous max-rendered
// height, force a full redraw so stale rows (e.g. a previous footer line) are
// cleared. pi-tui defaults this off for perf reasons, but without it the
// startup sequence can leave a duplicate footer row visible until the next
// resize. Defaulting to 1 here; users who want pi-tui's vanilla behavior can
// override with PI_CLEAR_ON_SHRINK=0 in their shell.
process.env.PI_CLEAR_ON_SHRINK ??= '1'

// One-time copy migration of the legacy ~/.loop24 config dir → ~/.otto (OTTO
// config-dir rebrand). Runs before the first-launch banner check so existing
// users who get migrated are not mistaken for first-run.
migrateLegacyConfigDir(appRoot)

// Print OTTO banner on first launch (before ~/.otto/ exists).
// Set LOOP24_FIRST_RUN_BANNER so cli.ts and tests skip the duplicate welcome screen.
if (!existsSync(appRoot)) {
  const yellow = ANSI_BRAND_YELLOW
  const dim    = ANSI_DIM
  const green  = ANSI_BRAND_GREEN
  const reset  = ANSI_RESET

  let banner = ''
  try {
    const bannerPath = join(workflowRoot, 'src/resources/extensions/loop24/branding/banner.txt')
    banner = readFileSync(bannerPath, 'utf-8')
  } catch { /* fall back to text-only */ }

  process.stderr.write(
    `${yellow}${banner}${reset}\n` +
    `  compliant agent for developers ${dim}v${workflowVersion}${reset}\n` +
    `  ${green}Welcome.${reset} Setting up your environment...\n\n`
  )
  process.env.LOOP24_FIRST_RUN_BANNER = '1'
}

// GSD_CODING_AGENT_DIR — tells pi's getAgentDir() to return ~/.otto/agent/ instead of ~/.pi/agent/
process.env.LOOP24_CODING_AGENT_DIR = process.env.GSD_CODING_AGENT_DIR = agentDir

// GSD_PKG_ROOT — absolute path to @ericsson/loop24 package root. Used by deployed extensions
// (e.g. auto.ts resume path) to import modules like resource-loader.js that live
// in the package tree, not in the deployed ~/.otto/agent/ tree.
process.env.LOOP24_PKG_ROOT = process.env.GSD_PKG_ROOT = workflowRoot

// RTK environment — make ~/.otto/agent/bin visible to all child-process paths,
// not just the bash tool, and force-disable RTK telemetry for managed use.
applyRtkProcessEnv(process.env)

// NODE_PATH — make the agent's own node_modules available to extensions loaded via jiti.
// Without this, extensions (e.g. browser-tools) can't resolve dependencies like
// `playwright` because jiti resolves modules from pi-coding-agent's location.
// Prepending the agent's node_modules to NODE_PATH fixes this for all extensions.
const workflowNodeModules = join(workflowRoot, 'node_modules')
process.env.NODE_PATH = [workflowNodeModules, process.env.NODE_PATH]
  .filter(Boolean)
  .join(delimiter)
// Force Node to re-evaluate module search paths with the updated NODE_PATH.
// Must happen synchronously before cli.js imports → extension loading.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Module } = await import('module');
(Module as any)._initPaths?.()

// GSD_VERSION — expose package version so extensions can display it (env var name kept for compatibility)
process.env.LOOP24_VERSION = process.env.GSD_VERSION = workflowVersion

// GSD_BIN_PATH — absolute path to the CLI entrypoint, used by patched
// subagent/parallel workers to spawn loop24 instead of pi when dispatching
// workflow tasks. In source-dev mode this must remain scripts/dev-cli.js, not
// src/loader.ts, because child processes need the --import resolve-ts wrapper.
applyLoaderCliEntrypointEnv(process.env, { workflowRoot, invokedBinPath: process.argv[1] })

// LOOP24_WORKFLOW_PATH — absolute path to bundled WORKFLOW.md, used by patched workflow extension
// when dispatching workflow prompts. Prefers dist/resources/ (stable, set at build time)
// over src/resources/ (live working tree) — see resource-loader.ts for rationale.
// GSD_WORKFLOW_PATH kept as fallback during identifier-erasure transition.
const resourcesDir = resolveBundledResourcesDirFromPackageRoot(workflowRoot)
const workflowPath = join(resourcesDir, 'WORKFLOW.md')
process.env.LOOP24_WORKFLOW_PATH = workflowPath
process.env.GSD_WORKFLOW_PATH = workflowPath

// GSD_BUNDLED_EXTENSION_PATHS — dynamically discovered bundled extension entry points.
// Uses the shared discoverExtensionEntryPaths() to scan the bundled resources
// directory, then remaps discovered paths to agentDir (~/.otto/agent/extensions/)
// where initResources() will sync them.
const bundledExtDir = join(resourcesDir, 'extensions')
const agentExtDir = join(agentDir, 'extensions')
const registry = loadRegistry()
const discoveredExtensionPaths = discoverExtensionEntryPaths(bundledExtDir)
  .map((entryPath) => join(agentExtDir, relative(bundledExtDir, entryPath)))
  .filter((entryPath) => {
    const manifest = readManifestFromEntryPath(entryPath)
    if (!manifest) return true  // no manifest = always load
    return isExtensionEnabled(registry, manifest.id)
  })

process.env.LOOP24_BUNDLED_EXTENSION_PATHS = process.env.GSD_BUNDLED_EXTENSION_PATHS = serializeBundledExtensionPaths(discoveredExtensionPaths)

// Respect HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars for all outbound requests.
// pi-coding-agent's cli.ts sets this, but the loader bypasses that entry point — so we
// must set it here before any SDK clients are created.
// Lazy-load undici (~200ms) only when proxy env vars are actually set.
if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy) {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import('undici')
  setGlobalDispatcher(new EnvHttpProxyAgent())
}

// Ensure workspace packages are linked (or copied on Windows) before importing
// cli.js (which imports @loop24/*).
// npm postinstall handles this normally, but npx --ignore-scripts skips postinstall.
// On Windows without Developer Mode or admin rights, symlinkSync will throw even for
// 'junction' type — so we fall back to cpSync (a full directory copy) which works
// everywhere without elevated permissions.
// Discover linkable workspace packages by scanning packages/*/package.json for
// `gsd.linkable === true`. This is the single source of truth — the same list
// read by scripts/link-workspace-packages.cjs and scripts/validate-pack.js.
// Adding a new linkable package requires only setting `gsd.linkable` in its
// package.json; there is no enumeration to keep in sync here.
const packagesDir = join(workflowRoot, 'packages')
type WsPkg = { dir: string; scope: string; name: string }
const wsPackages: WsPkg[] = []
try {
  if (existsSync(packagesDir)) {
    for (const dir of readdirSync(packagesDir)) {
      const pkgPath = join(packagesDir, dir)
      if (!statSync(pkgPath).isDirectory()) continue
      const pkgJsonPath = join(pkgPath, 'package.json')
      if (!existsSync(pkgJsonPath)) continue
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
        const gsd = pkg.gsd
        if (!gsd || gsd.linkable !== true) continue
        if (gsd.scope && gsd.name) wsPackages.push({ dir, scope: gsd.scope, name: gsd.name })
      } catch { /* ignore malformed package.json */ }
    }
  }
} catch { /* non-fatal — validation below catches missing critical packages */ }

try {
  for (const pkg of wsPackages) {
    const scopeDir = join(workflowNodeModules, pkg.scope)
    if (!existsSync(scopeDir)) mkdirSync(scopeDir, { recursive: true })
    const target = join(scopeDir, pkg.name)
    const source = join(packagesDir, pkg.dir)
    if (!existsSync(source) || existsSync(target)) continue
    try {
      symlinkSync(source, target, 'junction')
    } catch {
      // Symlink failed (common on Windows without Developer Mode / admin).
      // Fall back to a directory copy — slower on first run but universally works.
      try { cpSync(source, target, { recursive: true }) } catch { /* non-fatal */ }
    }
  }
} catch { /* non-fatal */ }

const workflowScopeDir = join(workflowNodeModules, '@loop24')

// Validate critical workspace packages are resolvable. If still missing after the
// symlink+copy attempts, emit a clear diagnostic instead of a cryptic
// ERR_MODULE_NOT_FOUND from deep inside cli.js.
const criticalPackages = ['pi-coding-agent']
const missingPackages = criticalPackages.filter(pkg => !existsSync(join(workflowScopeDir, pkg)))
if (missingPackages.length > 0) {
  const missing = missingPackages.map(p => `@loop24/${p}`).join(', ')
  process.stderr.write(
    `\nError: LOOP24 installation is broken — missing packages: ${missing}\n\n` +
    `This is usually caused by one of:\n` +
    `  • An outdated version installed from npm (run: npm install -g @ericsson/loop24@latest)\n` +
    `  • The packages/ directory was excluded from the installed tarball\n` +
    `  • A filesystem error prevented linking or copying the workspace packages\n\n` +
    `Fix it by reinstalling:\n\n` +
    `  npm install -g @ericsson/loop24@latest\n\n` +
    `If the issue persists, please open an issue with the project maintainers.\n`
  )
  process.exit(1)
}

// Dynamic import defers ESM evaluation — config.js will see PI_PACKAGE_DIR above
await import('./cli.js')
