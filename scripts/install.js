#!/usr/bin/env node

/**
 * Interactive Installer
 *
 * Entry point for `npx @cmetech/otto` or `npx @cmetech/otto@latest`.
 * When invoked directly (not as a postinstall hook), runs the visual
 * installer with full terminal access — banner, spinners, progress.
 *
 * If otto is already installed and the user runs `otto`, this script
 * is NOT invoked — the normal loader.js handles that via the "otto" bin.
 * This script only fires for `npx @cmetech/otto` (the package name bin).
 */

import { execSync, spawnSync, exec as execCb } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import { chmodSync, copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { arch, homedir, platform } from 'os'
import { dirname, resolve, join } from 'path'
import { Readable } from 'stream'
import { finished } from 'stream/promises'
import { fileURLToPath } from 'url'
import { createInterface } from 'readline'

const __dirname = dirname(fileURLToPath(import.meta.url))

// packageRoot is always relative to this script — it's the installed npm package directory.
// This is correct whether running as postinstall (inside node_modules/<pkg>) or
// via npx (inside a transient cache), since __dirname resolves to the script's location.
const IS_POSTINSTALL = !!process.env.npm_lifecycle_event
const packageRoot = resolve(__dirname, '..')

// ── Feature flags ──────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const HAS_HELP = args.includes('--help') || args.includes('-h')
const HAS_VERSION = args.includes('--version') || args.includes('-v')

// ── Colors ─────────────────────────────────────────────────────────────────

const supportsColor = process.stdout.isTTY && !process.env.NO_COLOR
const c = supportsColor
  ? { cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m' }
  : { cyan: '', green: '', yellow: '', red: '', dim: '', bold: '', reset: '' }

// ── Version ────────────────────────────────────────────────────────────────

let workflowVersion = '0.0.0'
try {
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'))
  workflowVersion = pkg.version || '0.0.0'
} catch { /* ignore */ }

// ── Brand strings (templated from package.json so the published @cmetech/otto
// ── package self-describes correctly without hard-coding upstream names) ────────
let PKG_NAME = '@cmetech/otto'
let BRAND = 'OTTO'
let CMD = 'otto'
try {
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'))
  PKG_NAME = pkg.name || PKG_NAME
  BRAND = pkg.piConfig?.brandName || BRAND
  CMD = pkg.piConfig?.commandNamespace || CMD
} catch { /* ignore — defaults are reasonable */ }

if (HAS_VERSION) {
  process.stdout.write(workflowVersion + '\n')
  process.exit(0)
}

if (HAS_HELP) {
  process.stdout.write(`
  ${c.bold}${BRAND} Installer${c.reset} ${c.dim}v${workflowVersion}${c.reset}

  ${c.yellow}Usage:${c.reset}
    npx ${PKG_NAME}@latest          Install ${BRAND} globally (recommended)
    npx ${PKG_NAME}@latest --local  Install ${BRAND} to current project

  ${c.yellow}Options:${c.reset}
    ${c.cyan}--local${c.reset}     Install to current directory instead of globally
    ${c.cyan}--skip-chromium${c.reset}  Skip Chromium browser download
    ${c.cyan}--skip-rtk${c.reset}      Skip RTK shell compression binary
    ${c.cyan}-h, --help${c.reset}      Show this help
    ${c.cyan}-v, --version${c.reset}   Show version

  ${c.yellow}Environment:${c.reset}
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1  Skip Chromium
    OTTO_SKIP_RTK_INSTALL=1             Skip RTK
    OTTO_RTK_DISABLED=1                  Disable RTK integration

`)
  process.exit(0)
}

// ── Spinner ────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['◐', '◓', '◑', '◒']
let spinnerInterval = null
let spinnerFrame = 0

function startSpinner(label) {
  if (!process.stdout.isTTY) {
    process.stdout.write(`  … ${label}\n`)
    return
  }
  spinnerFrame = 0
  process.stdout.write(`  ${c.cyan}${SPINNER_FRAMES[0]}${c.reset} ${label}`)
  spinnerInterval = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length
    process.stdout.write(`\r  ${c.cyan}${SPINNER_FRAMES[spinnerFrame]}${c.reset} ${label}`)
  }, 100)
}

function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval)
    spinnerInterval = null
  }
  if (process.stdout.isTTY) {
    process.stdout.write('\r\x1b[2K')
  }
}

// ── Output helpers ─────────────────────────────────────────────────────────

function printBanner() {
  process.stdout.write(`\n  ${c.bold}${BRAND}${c.reset} ${c.dim}v${workflowVersion}${c.reset}\n  ${c.dim}compliant agent for developers${c.reset}\n\n`)
}

function printStep(label, detail) {
  const detailStr = detail ? ` ${c.dim}${detail}${c.reset}` : ''
  process.stdout.write(`  ${c.green}✓${c.reset} ${label}${detailStr}\n`)
}

function printSkip(label, reason) {
  process.stdout.write(`  ${c.dim}–${c.reset} ${label} ${c.dim}(${reason})${c.reset}\n`)
}

function printWarn(label, detail) {
  const detailStr = detail ? `: ${detail}` : ''
  process.stdout.write(`  ${c.yellow}⚠${c.reset} ${label}${detailStr}\n`)
}

function printFail(label, detail) {
  const detailStr = detail ? `: ${detail}` : ''
  process.stdout.write(`  ${c.red}✗${c.reset} ${label}${detailStr}\n`)
}

// ── Install logic ──────────────────────────────────────────────────────────

const PLAYWRIGHT_SKIP =
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1' ||
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === 'true' ||
  args.includes('--skip-chromium')

const RTK_SKIP =
  process.env.OTTO_SKIP_RTK_INSTALL === '1' ||
  process.env.OTTO_SKIP_RTK_INSTALL === 'true' ||
  process.env.OTTO_RTK_DISABLED === '1' ||
  process.env.OTTO_RTK_DISABLED === 'true' ||
  args.includes('--skip-rtk')

const RTK_VERSION = '0.33.1'
const RTK_REPO = 'rtk-ai/rtk'
const RTK_ENV = { ...process.env, RTK_TELEMETRY_DISABLED: '1' }
const managedBinDir = join(process.env.OTTO_HOME || join(homedir(), '.otto'), 'agent', 'bin')
const managedBinaryPath = join(managedBinDir, platform() === 'win32' ? 'rtk.exe' : 'rtk')

// ── Step: npm install -g ───────────────────────────────────────────────────

async function installGlobally() {
  startSpinner(`Installing ${PKG_NAME} globally...             `)
  try {
    const result = await new Promise((res) => {
      execCb(
        `npm install -g ${PKG_NAME}@${workflowVersion}`,
        { timeout: 300_000 },
        (error, stdout, stderr) => {
          res({ ok: !error, stdout: stdout || '', stderr: stderr || '', error })
        }
      )
    })
    stopSpinner()

    if (!result.ok) {
      const meaningful = (result.stderr || '')
        .split('\n')
        .filter(l => !l.includes('npm warn') && !l.includes('npm WARN') && l.trim())
        .slice(-3)
        .join('; ')
      printFail('Global install failed', meaningful || `run npm install -g ${PKG_NAME} manually`)
      return false
    }

    printStep('Installed globally', `npm install -g ${PKG_NAME}`)
    return true
  } catch (err) {
    stopSpinner()
    printFail('Global install failed', err.message)
    return false
  }
}

async function installLocally() {
  startSpinner(`Installing ${PKG_NAME} locally...              `)
  try {
    const result = await new Promise((res) => {
      execCb(
        `npm install ${PKG_NAME}@${workflowVersion}`,
        { cwd: process.cwd(), timeout: 300_000 },
        (error, stdout, stderr) => {
          res({ ok: !error, stdout: stdout || '', stderr: stderr || '', error })
        }
      )
    })
    stopSpinner()

    if (!result.ok) {
      const meaningful = (result.stderr || '')
        .split('\n')
        .filter(l => !l.includes('npm warn') && !l.includes('npm WARN') && l.trim())
        .slice(-3)
        .join('; ')
      printFail('Local install failed', meaningful || `run npm install ${PKG_NAME} manually`)
      return false
    }

    printStep('Installed locally', `npm install ${PKG_NAME}`)
    return true
  } catch (err) {
    stopSpinner()
    printFail('Local install failed', err.message)
    return false
  }
}

// ── Step: Playwright Chromium ──────────────────────────────────────────────

async function installChromium() {
  if (PLAYWRIGHT_SKIP) {
    printSkip('Chromium', 'skipped')
    return
  }

  startSpinner('Installing Chromium...                    ')
  try {
    const result = await new Promise((res) => {
      execCb('npx playwright install chromium', { timeout: 300_000 }, (error, stdout, stderr) => {
        res({ ok: !error, stdout: stdout || '', stderr: stderr || '', error })
      })
    })
    stopSpinner()

    if (!result.ok) {
      const output = (result.stderr + '\n' + result.stdout).trim()
      const meaningful = output.split('\n')
        .filter(l => !l.includes('npm warn') && !l.includes('npm WARN') && l.trim())
        .slice(-3)
        .join('; ')
      printWarn('Chromium', meaningful || 'install failed — run npx playwright install chromium')
      return
    }

    printStep('Chromium installed', 'Playwright')
  } catch (err) {
    stopSpinner()
    printWarn('Chromium', err.message)
  }
}

// ── Step: RTK ──────────────────────────────────────────────────────────────

function resolveAssetName() {
  const p = platform()
  const a = arch()
  if (p === 'darwin' && a === 'arm64') return 'rtk-aarch64-apple-darwin.tar.gz'
  if (p === 'darwin' && a === 'x64') return 'rtk-x86_64-apple-darwin.tar.gz'
  if (p === 'linux' && a === 'arm64') return 'rtk-aarch64-unknown-linux-gnu.tar.gz'
  if (p === 'linux' && a === 'x64') return 'rtk-x86_64-unknown-linux-musl.tar.gz'
  if (p === 'win32' && a === 'x64') return 'rtk-x86_64-pc-windows-msvc.zip'
  return null
}

function parseChecksums(text) {
  const checksums = new Map()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i)
    if (!match) continue
    checksums.set(match[2], match[1].toLowerCase())
  }
  return checksums
}

function sha256File(filePath) {
  const hash = createHash('sha256')
  hash.update(readFileSync(filePath))
  return hash.digest('hex')
}

async function downloadToFile(url, destination) {
  const response = await fetch(url, { headers: { 'User-Agent': `${CMD}-installer` } })
  if (!response.ok) throw new Error(`download failed (${response.status})`)
  if (!response.body) throw new Error('no response body')
  const output = createWriteStream(destination)
  await finished(Readable.fromWeb(response.body).pipe(output))
}

function findBinaryRecursively(rootDir, binaryName) {
  const stack = [rootDir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isFile() && entry.name === binaryName) return fullPath
      if (entry.isDirectory()) stack.push(fullPath)
    }
  }
  return null
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

async function extractZipArchive(archivePath, extractDir) {
  mkdirSync(extractDir, { recursive: true })

  if (platform() === 'win32') {
    const command = [
      'Expand-Archive',
      '-LiteralPath', quotePowerShellLiteral(archivePath),
      '-DestinationPath', quotePowerShellLiteral(extractDir),
      '-Force',
    ].join(' ')
    const result = spawnSync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command,
    ], {
      encoding: 'utf-8',
      timeout: 30_000,
    })
    if (result.error || result.status !== 0) {
      throw new Error(result.error?.message || result.stderr?.trim() || 'zip extraction failed')
    }
    return
  }

  const extractZip = (await import('extract-zip')).default
  await extractZip(archivePath, { dir: extractDir })
}

function validateRtkBinary(binaryPath) {
  const result = spawnSync(binaryPath, ['rewrite', 'git status'], {
    encoding: 'utf-8',
    env: RTK_ENV,
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
  })
  return !result.error && result.status === 0 && (result.stdout || '').trim() === 'rtk git status'
}

async function installRtk() {
  if (RTK_SKIP) {
    printSkip('RTK', 'disabled')
    return
  }

  const assetName = resolveAssetName()
  if (!assetName) {
    printSkip('RTK', `unsupported platform ${platform()}-${arch()}`)
    return
  }

  if (existsSync(managedBinaryPath) && validateRtkBinary(managedBinaryPath)) {
    printStep('RTK', `v${RTK_VERSION} up to date`)
    return
  }

  startSpinner('Installing RTK...                         ')

  const tempRoot = join(managedBinDir, `.rtk-install-${randomUUID().slice(0, 8)}`)
  const archivePath = join(tempRoot, assetName)
  const extractDir = join(tempRoot, 'extract')
  const releaseBase = `https://github.com/${RTK_REPO}/releases/download/v${RTK_VERSION}`

  mkdirSync(tempRoot, { recursive: true })
  mkdirSync(managedBinDir, { recursive: true })

  try {
    const checksumsResponse = await fetch(`${releaseBase}/checksums.txt`, {
      headers: { 'User-Agent': `${CMD}-installer` },
    })
    if (!checksumsResponse.ok) throw new Error(`checksums fetch failed (${checksumsResponse.status})`)

    const checksums = parseChecksums(await checksumsResponse.text())
    const expectedSha = checksums.get(assetName)
    if (!expectedSha) throw new Error(`missing checksum for ${assetName}`)

    await downloadToFile(`${releaseBase}/${assetName}`, archivePath)
    const actualSha = sha256File(archivePath)
    if (actualSha !== expectedSha) throw new Error('checksum mismatch')

    mkdirSync(extractDir, { recursive: true })
    if (assetName.endsWith('.zip')) {
      await extractZipArchive(archivePath, extractDir)
    } else {
      const extractResult = spawnSync('tar', ['xzf', archivePath, '-C', extractDir], {
        encoding: 'utf-8',
        timeout: 30000,
      })
      if (extractResult.error || extractResult.status !== 0) {
        throw new Error(extractResult.error?.message || 'tar extraction failed')
      }
    }

    const extractedBinary = findBinaryRecursively(extractDir, platform() === 'win32' ? 'rtk.exe' : 'rtk')
    if (!extractedBinary) throw new Error('binary not found in archive')

    copyFileSync(extractedBinary, managedBinaryPath)
    if (platform() !== 'win32') chmodSync(managedBinaryPath, 0o755)

    if (!validateRtkBinary(managedBinaryPath)) {
      rmSync(managedBinaryPath, { force: true })
      throw new Error('binary validation failed')
    }

    stopSpinner()
    printStep('RTK installed', `v${RTK_VERSION}`)
  } catch (err) {
    stopSpinner()
    printWarn('RTK', describeFetchError(err))
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

// Surface the underlying cause when Node's native fetch throws a generic
// "fetch failed" for pre-response network errors (DNS, connect, TLS,
// socket). Without this, CI logs show only the bare message and every
// network-failure class collapses to a single indistinguishable line.
function describeFetchError(err) {
  const base = err?.message || String(err)
  const cause = err?.cause
  if (!cause) return base
  const code = cause.code || cause.errno
  const causeMsg = cause.message || ''
  const detail = code ? `${code}${causeMsg && causeMsg !== code ? ` — ${causeMsg}` : ''}` : causeMsg
  return detail ? `${base} (${detail})` : base
}

// ── Step: Link workspace packages (postinstall from tarball) ───────────────

function linkWorkspacePackages() {
  const scriptPath = join(packageRoot, 'scripts', 'link-workspace-packages.cjs')
  if (!existsSync(scriptPath)) return

  try {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: packageRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    })

    if (result.status === 0) {
      const stderr = (result.stderr || '').toString()
      const linked = stderr.match(/Linked (\d+)/)?.[1]
      const copied = stderr.match(/Copied (\d+)/)?.[1]
      if (linked || copied) {
        const parts = []
        if (linked) parts.push(`${linked} linked`)
        if (copied) parts.push(`${copied} copied`)
        printStep('Workspace packages', parts.join(', '))
      } else {
        printStep('Workspace packages', 'up to date')
      }
    }
  } catch { /* non-fatal */ }
}

// ── Step: Copy bundled tools (ripgrep, fd) into ~/.otto/bin/ ───────────────

function copyBundledTools() {
  // The @cmetech/otto-engine-* package matching this platform contains rg/fd
  // alongside otto_engine.node. Copy them into ~/.otto/bin/ so the runtime
  // tools-manager finds them at the expected location with no GitHub download.
  const platMap = {
    'darwin-arm64': 'darwin-arm64',
    'darwin-x64': 'darwin-x64',
    'linux-x64': 'linux-x64-gnu',
    'linux-arm64': 'linux-arm64-gnu',
    'win32-x64': 'win32-x64-msvc',
  }
  const key = `${platform()}-${arch()}`
  const suffix = platMap[key]
  if (!suffix) return // unsupported platform — nothing to bundle

  const nativePkgName = `@cmetech/otto-engine-${suffix}`
  let nativePkgDir
  try {
    const req = createRequire(import.meta.url)
    const pkgJsonPath = req.resolve(`${nativePkgName}/package.json`, { paths: [packageRoot] })
    nativePkgDir = dirname(pkgJsonPath)
  } catch {
    // Native package not installed — optionalDep didn't match (unsupported platform)
    return
  }

  const binExt = platform() === 'win32' ? '.exe' : ''
  // Must match the managed bin dir the runtime reads from (src/rtk-shared.ts
  // getManagedBinDir and managedBinDir above): join(OTTO_HOME, 'agent', 'bin'),
  // defaulting to ~/.otto/agent/bin. Honoring OTTO_HOME keeps relocated installs
  // (and hermetic tests) writing where the agent actually looks.
  const dest = join(process.env.OTTO_HOME || join(homedir(), '.otto'), 'agent', 'bin')
  mkdirSync(dest, { recursive: true })

  const tools = ['rg', 'fd']
  const copied = []
  for (const tool of tools) {
    const src = join(nativePkgDir, `${tool}${binExt}`)
    const dst = join(dest, `${tool}${binExt}`)
    if (existsSync(src)) {
      // If dst is a pre-existing symlink (e.g. user points it at a Homebrew
      // install), copyFileSync follows the link and tries to write the target,
      // which EACCES on system-owned paths like /opt/homebrew/bin. Unlink the
      // symlink so we replace it with a fresh regular file in the bin dir.
      try {
        if (lstatSync(dst).isSymbolicLink()) unlinkSync(dst)
      } catch { /* dst doesn't exist — fine */ }
      copyFileSync(src, dst)
      if (platform() !== 'win32') {
        chmodSync(dst, 0o755)
      }
      copied.push(tool)
    }
  }

  if (copied.length > 0) {
    printStep('Bundled tools', `${copied.join(' + ')} copied to ${dest}`)
  }
}

// ── Step: Verify installation ──────────────────────────────────────────────

function verifyInstall(local) {
  let bin = CMD
  if (local) {
    const localBin = resolve(process.cwd(), 'node_modules', '.bin', CMD)
    if (existsSync(localBin)) {
      bin = localBin
    } else if (platform() === 'win32' && existsSync(localBin + '.cmd')) {
      bin = localBin + '.cmd'
    }
  }

  const result = spawnSync(bin, ['--version'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  })

  if (!result.error && result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim()
  }
  return null
}

// ── Prompt helper ──────────────────────────────────────────────────────────

function prompt(question, defaultValue) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(defaultValue)
      return
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim() || defaultValue)
    })
  })
}

// ── Main ───────────────────────────────────────────────────────────────────

printBanner()

const isLocal = args.includes('--local') || args.includes('-l')

if (IS_POSTINSTALL) {
  // Running as npm postinstall hook — just do workspace linking + deps
  linkWorkspacePackages()
  copyBundledTools()
  await installChromium()
  await installRtk()
} else {
  // Running via npx — full interactive install
  if (isLocal) {
    const ok = await installLocally()
    if (!ok) process.exit(1)
  } else {
    const ok = await installGlobally()
    if (!ok) process.exit(1)
  }

  // Run postinstall steps that npm skipped
  linkWorkspacePackages()
  copyBundledTools()
  await installChromium()
  await installRtk()

  // Verify
  const version = verifyInstall(isLocal)
  if (version) {
    printStep('Verified', `${CMD} v${version}`)
  }
}

process.stdout.write(`\n  ${c.green}Ready.${c.reset} Run: ${c.bold}${CMD}${c.reset}\n\n`)
