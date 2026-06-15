verdict: do-not-port

# de5ac79 — fix(issue): [Bug]: error on windows update from gsd-2

## Target file(s)
- scripts/install.js (already fixed)

## Divergence
Upstream replaces `extract-zip` for the RTK binary install on Windows with a PowerShell `Expand-Archive` call, and adds a `quotePowerShellLiteral` helper. Otto-cli already has the identical fix: `scripts/install.js` defines `extractZipArchive(archivePath, extractDir)` (line 330) using `powershell.exe Expand-Archive` with the same `-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass` flag set, and `installRtk` (line 372) calls `extractZipArchive` instead of `extract-zip` directly (line 415). The non-Windows path falls through to `extract-zip` exactly as upstream.

## Concrete edits
1. None — already in otto.

## Verdict
Skip. Otto-cli's `scripts/install.js` already implements this fix verbatim. No work to do.
