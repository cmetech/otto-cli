# OTTO Install Guide

This guide covers installing OTTO on macOS, Linux, Windows PowerShell, and WSL.
For the short overview, see the [README](../README.md).

## Prerequisites

Required on every platform:

- **Node.js 22 or newer**. Verify with `node -v`.
- **npm 10 or newer**. Verify with `npm -v`.
- **git**. Verify with `git --version`.
- A terminal that supports interactive TUI apps.

Optional by feature:

| Feature | Requirement |
|---|---|
| Direct model fallback without OTTO Gateway | A configured provider credential, such as `ANTHROPIC_API_KEY`, or login through OTTO where supported. |
| OTTO Gateway routing | Local or remote OTTO Gateway. Default health check: `http://127.0.0.1:18080/health`. |
| LangFlow integration | Local or remote LangFlow. Default URL: `http://127.0.0.1:7860`. API key via `LANGFLOW_API_KEY` when required. |
| `/otto build-flow` Python helpers | Python 3 on PATH, plus `requests` if the helper script needs HTTP calls. Override with `OTTO_PYTHON_BIN`. |
| Full LangFlow schema validation | Optional `lfx` CLI. Without it, OTTO falls back to JSON validation. |

## Install From npm

This is the normal install path for laptops and servers after `@cmetech/otto`
is published:

```bash
npm install -g @cmetech/otto
otto --version
otto
```

To run without permanently installing:

```bash
npx @cmetech/otto@latest --version
npx @cmetech/otto@latest
```

The npm package installs the `otto` command on your PATH. It also installs
platform-specific optional native packages when they are available for your OS
and CPU. If a native package is unavailable, OTTO falls back to JavaScript for
that path, but the publish gate should prevent missing native packages for
supported platforms.

## macOS

Recommended prerequisites:

```bash
brew install node@22 git
```

If Homebrew does not put Node on PATH automatically, follow its shell output or
use a version manager such as `nvm`, `fnm`, or `asdf`.

Install OTTO:

```bash
npm install -g @cmetech/otto
otto --version
otto
```

Useful checks:

```bash
which node
which npm
which otto
node -v
```

## Linux

Install Node 22 using your distro packages, NodeSource, or a version manager.
For Ubuntu/Debian with NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v
npm -v
```

Install OTTO:

```bash
npm install -g @cmetech/otto
otto --version
otto
```

If global npm installs require `sudo`, prefer configuring an npm user prefix
instead of running OTTO with elevated privileges:

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
npm install -g @cmetech/otto
```

## Windows PowerShell

Windows PowerShell and Windows Terminal are supported. Use 64-bit Node.js.

Install prerequisites:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Close and reopen PowerShell, then verify:

```powershell
node -v
npm -v
git --version
```

Install OTTO:

```powershell
npm install -g @cmetech/otto
otto --version
otto
```

If `otto` is not found after install, check npm's global bin directory:

```powershell
npm config get prefix
$env:Path -split ';'
```

Add npm's global bin directory to your user PATH if it is missing. Common
locations include:

```text
%AppData%\npm
C:\Users\<you>\AppData\Roaming\npm
```

Notes for Windows:

- Prefer Windows Terminal or the built-in PowerShell host.
- Git Bash can work, but PowerShell is the primary supported Windows shell.
- Keep your project paths out of protected system directories.
- If your security tooling blocks npm postinstall scripts, install may complete
  without optional helpers. Re-run from a normal user shell after allowlisting
  the package.

## WSL

WSL behaves like Linux, but it has its own Node/npm installation separate from
Windows. Install OTTO inside WSL if you want to run it from a WSL shell.

Inside Ubuntu WSL:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
npm install -g @cmetech/otto
otto --version
otto
```

WSL notes:

- Keep Linux projects under the WSL filesystem, for example `~/code/...`, not
  under `/mnt/c/...`, for better filesystem performance.
- Use the Windows install separately if you want `otto` available from
  PowerShell.

## Install From Source

Use this for contributor/dev machines:

```bash
git clone git@github.com:cmetech/otto-cli.git
cd otto-cli
npm install
npm run build:core
npm install -g .
otto --version
```

On macOS/Linux you can also use the source install script:

```bash
./scripts/install.sh
```

That script verifies Node/git, installs dependencies, builds OTTO, creates a
local `otto` command, and offers to launch the config wizard.

## Configuration

Start OTTO:

```bash
otto
```

Provider and gateway configuration can be supplied through environment variables
or the OTTO config commands.

Common environment variables:

```bash
export OTTO_GATEWAY_URL=http://127.0.0.1:18080
export ANTHROPIC_API_KEY=sk-ant-...
export LANGFLOW_SERVER_URL=http://127.0.0.1:7860
export LANGFLOW_API_KEY=...
```

PowerShell equivalents:

```powershell
$env:OTTO_GATEWAY_URL = "http://127.0.0.1:18080"
$env:ANTHROPIC_API_KEY = "sk-ant-..."
$env:LANGFLOW_SERVER_URL = "http://127.0.0.1:7860"
$env:LANGFLOW_API_KEY = "..."
```

User config and runtime state are stored under `~/.otto` on macOS/Linux/WSL and
under your Windows user profile equivalent when running native Windows.

## Update

For npm installs:

```bash
npm install -g @cmetech/otto@latest
otto --version
```

For source installs:

```bash
cd otto-cli
git pull
npm install
npm run build:core
npm install -g .
```

## Uninstall

For npm installs:

```bash
npm uninstall -g @cmetech/otto
```

To also remove local OTTO state:

```bash
rm -rf ~/.otto
```

PowerShell:

```powershell
npm uninstall -g @cmetech/otto
Remove-Item -Recurse -Force "$HOME\.otto"
```

## Troubleshooting

### `node` or `npm` is not found

Install Node.js 22 or newer, then open a new terminal. On Windows, reopening the
terminal after `winget install` is often required so PATH updates apply.

### Node is too old

OTTO requires Node 22 or newer:

```bash
node -v
```

With `nvm`:

```bash
nvm install 22
nvm use 22
nvm alias default 22
```

### `otto` is not found after npm install

Check npm's global bin path:

```bash
npm config get prefix
```

On macOS/Linux/WSL, npm's global binaries normally live in the `bin` directory
under that prefix. On Windows, they normally live directly under the prefix.
Make sure the relevant directory is on PATH.

### Model calls fail with missing API key

Either start/configure OTTO Gateway or configure the selected provider directly.
For Anthropic direct fallback:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

If the footer shows gateway fallback, OTTO is bypassing the gateway because the
gateway is unavailable or returned an error and a direct credential is present.

### Gateway shows healthy but requests do not appear in gateway logs

Confirm OTTO is using gateway routing in the footer and that `OTTO_GATEWAY_URL`
points to the gateway base URL, usually:

```bash
export OTTO_GATEWAY_URL=http://127.0.0.1:18080
curl http://127.0.0.1:18080/health
```

### LangFlow shows offline

Start LangFlow or configure the URL:

```bash
export LANGFLOW_SERVER_URL=http://127.0.0.1:7860
```

LangFlow is disabled by default until connected/configured.
