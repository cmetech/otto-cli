# OTTO Install Guide

This guide walks through installing OTTO on a fresh Windows machine, plus
the LangFlow service it talks to. macOS and Linux sections will be added
in later passes — most steps below apply directly with package-manager
substitutions.

## Windows

### Prerequisites

| Tool | Minimum version | Why |
|---|---|---|
| Node.js | 22.0.0 | Required by `@cmetech/otto`'s `engines` field |
| npm | 11.5.1 | Required for some publish flows; older npm versions still install OTTO but can't publish |

### 1. Install Node.js (includes npm)

Pick one path.

**Easiest — winget** (built into Windows 11 and Windows 10 with App Installer):

```powershell
winget install OpenJS.NodeJS.LTS
```

**Alternative — official installer**:

1. Download the Windows Installer (.msi) from <https://nodejs.org/en/download>.
2. Run it, accept defaults.

After install, **close and reopen PowerShell** so `PATH` picks up `node` and `npm`. Confirm:

```powershell
node --version    # v22.x.x or higher
npm --version     # 11.5.1 or higher
```

If npm is older than 11.5.1, upgrade it:

```powershell
npm install -g npm@latest
```

### 2. Install OTTO

```powershell
npm install -g @cmetech/otto
otto --version
```

The Windows-specific native engine (`@cmetech/otto-engine-win32-x64-msvc`) installs automatically because of platform-matched `optionalDependencies`.

If Windows Defender or SmartScreen flags the first launch, click **More info → Run anyway**. This is normal for an unsigned npm-installed CLI; you only see it once.

### 3. Install LangFlow

OTTO talks to LangFlow over HTTP. Pick one of the two paths below.

#### Path A — pip (lighter, no Docker)

Requires Python 3.10–3.12.

```powershell
winget install Python.Python.3.12
# Close and reopen PowerShell so PATH refreshes.

python -m pip install --upgrade pip
python -m pip install langflow

# Start LangFlow:
python -m langflow run
```

Default URL: <http://localhost:7860>. Open it in a browser to confirm the UI loads.

#### Path B — Docker (more isolated, recommended if Docker Desktop is already installed)

```powershell
docker run -it --rm -p 7860:7860 langflowai/langflow:latest
```

Same URL: <http://localhost:7860>.

### 4. Point OTTO at LangFlow

OTTO reads `OTTO_LANGFLOW_URL` (and an API key if LangFlow has auth enabled). Set them in PowerShell:

```powershell
# Per-session
$env:OTTO_LANGFLOW_URL = "http://localhost:7860"

# Persistent (user-level)
[System.Environment]::SetEnvironmentVariable("OTTO_LANGFLOW_URL", "http://localhost:7860", "User")
```

Open a **new** PowerShell, then run `otto`. The footer should show `LF ok` instead of `LF offline`.

### 5. Upgrade OTTO later

When a new version is published:

```powershell
npm update -g @cmetech/otto
```

Or to force the current `latest`:

```powershell
npm install -g @cmetech/otto@latest
```

Or to pin a specific version:

```powershell
npm install -g @cmetech/otto@1.0.5
```

After upgrade, confirm with `otto --version`.

### Troubleshooting

#### `npm warn deprecated …`

Deprecation warnings during `npm install` are expected at present and do not
affect functionality. They come from transitive polyfill packages (notably
`node-domexception` and `uuid@9.x`) that are scheduled to be replaced via npm
`overrides` in a future release.

#### `otto` not found after install

Close and reopen the PowerShell window so it picks up the global npm bin
directory in `PATH`. If that doesn't help:

```powershell
npm config get prefix
```

That directory's `node_modules\.bin` (or its parent on Windows) must be on
`PATH`. The Node.js installer normally handles this; if it didn't, add the
directory manually under **System Properties → Environment Variables**.

#### LangFlow shows `LF offline` in the footer

- Confirm `python -m langflow run` (or the Docker container) is still
  running.
- Confirm `$env:OTTO_LANGFLOW_URL` matches the LangFlow URL exactly
  (default `http://localhost:7860`).
- Open the URL in a browser from the same machine — if the browser can't
  reach it, OTTO can't either.

#### `npm install -g @cmetech/otto` fails with `EACCES` / permission errors

The Node.js installer should configure npm to install globally without
requiring elevation, but if it didn't:

```powershell
npm config set prefix "$env:APPDATA\npm"
```

Then re-open PowerShell and retry the install.

## macOS / Linux

To be expanded. Short version:

```bash
# macOS (Homebrew)
brew install node
npm install -g @cmetech/otto

# Linux (apt / similar)
# Use nodesource or your distro's Node 22+ package, then:
npm install -g @cmetech/otto
```

LangFlow setup is identical to the Windows pip path.
