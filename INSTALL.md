# OTTO Install Guide

This guide installs **OTTO** (the CLI) and **LangFlow** (the optional
visual flow service OTTO talks to over HTTP) on Windows, macOS, and Linux.

## What gets installed

| Component | Purpose | Source |
|---|---|---|
| Node.js 22+ | Required runtime for OTTO. Includes `npm`. | nodejs.org / package manager |
| npm 11.5.1+ | Package manager. Newer is required for OTTO's publish workflows; any 11.x installs OTTO fine. | bundled with Node.js |
| git | Required at OTTO startup. Used for branch detection, diff inspection, atomic commits, and worktree isolation. | git-scm.com / package manager |
| Python 3.10–3.12 | Required only if you install LangFlow via pip. Skip if using LangFlow's Docker image. | python.org / package manager |
| OTTO | The CLI. | npm: `@cmetech/otto` |
| LangFlow | Optional companion flow runtime. | pip: `langflow` or Docker: `langflowai/langflow` |

OTTO itself works with no LangFlow. The footer will just show `LF offline`. **git, on the other hand, is a hard requirement** — OTTO refuses to start without it on PATH.

## Quick start

If you already have the prereqs and just need the install commands:

```bash
# All platforms — install OTTO globally
npm install -g @cmetech/otto

# Install LangFlow (pick one)
pip install langflow                                        # Python path
docker run -it --rm -p 7860:7860 langflowai/langflow:latest # Docker path

# Tell OTTO where LangFlow is
export OTTO_LANGFLOW_URL=http://localhost:7860              # bash/zsh
# Windows PowerShell: $env:OTTO_LANGFLOW_URL = "http://localhost:7860"
```

Otherwise pick your platform below.

---

## Windows

### 1. Install Node.js (includes npm)

**Easiest — winget** (built into Windows 11 and Windows 10 with App Installer):

```powershell
winget install OpenJS.NodeJS.LTS
```

**Alternative — official installer**: download from <https://nodejs.org/en/download> and run the Windows `.msi`.

Close and reopen PowerShell so `PATH` refreshes. Then verify:

```powershell
node --version    # v22.x.x or higher
npm --version     # 11.5.1 or higher
```

If npm is older than 11.5.1:

```powershell
npm install -g npm@latest
```

### 2. Install git

```powershell
winget install Git.Git
# Close and reopen PowerShell
git --version
```

OTTO refuses to start without git on PATH and prints a clear error message; install git before running `otto` for the first time.

### 3. Install Python (only if you'll run LangFlow via pip)

```powershell
winget install Python.Python.3.12
# Close and reopen PowerShell
python --version    # 3.10–3.12
```

### 4. Install OTTO

```powershell
npm install -g @cmetech/otto
otto --version
```

If Windows Defender / SmartScreen flags the first launch, click **More info → Run anyway**. This is normal for an unsigned npm-installed CLI; you only see it once.

### 5. Install LangFlow

Pick one:

**Path A — pip (lighter, no Docker):**

```powershell
python -m pip install --upgrade pip
python -m pip install langflow
python -m langflow run
```

**Path B — Docker:**

```powershell
docker run -it --rm -p 7860:7860 langflowai/langflow:latest
```

Either way LangFlow lives at <http://localhost:7860>.

### 6. Configure OTTO to talk to LangFlow

```powershell
# Per-session
$env:OTTO_LANGFLOW_URL = "http://localhost:7860"

# Persistent (user-level)
[System.Environment]::SetEnvironmentVariable("OTTO_LANGFLOW_URL", "http://localhost:7860", "User")
```

Open a **new** PowerShell window so the env var takes effect, then run `otto`. Footer should show `LF ok`.

---

## macOS

### 1. Install Node.js (includes npm)

**Easiest — Homebrew** (install Homebrew from <https://brew.sh> if you don't have it):

```bash
brew install node
```

**Alternative — official installer**: download from <https://nodejs.org/en/download> and run the macOS `.pkg`.

**Alternative — nvm** (if you need to switch Node versions):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# restart shell
nvm install 22
nvm use 22
```

Verify:

```bash
node --version    # v22.x.x or higher
npm --version     # 11.5.1 or higher
```

If npm is older than 11.5.1:

```bash
npm install -g npm@latest
```

### 2. Install git

```bash
brew install git
git --version
```

macOS ships with an Apple-bundled git that's often outdated; Homebrew's version is current. OTTO refuses to start without git on PATH.

### 3. Install Python (only if you'll run LangFlow via pip)

```bash
brew install python@3.12
python3 --version    # 3.10–3.12
```

### 4. Install OTTO

```bash
npm install -g @cmetech/otto
otto --version
```

If `npm install -g` errors with `EACCES`, **don't `sudo`** — instead point npm at a user-writable prefix:

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc
source ~/.zshrc
npm install -g @cmetech/otto
```

### 5. Install LangFlow

**Path A — pip:**

```bash
python3 -m pip install --upgrade pip
python3 -m pip install langflow
python3 -m langflow run
```

If pip refuses with "externally-managed-environment" (PEP 668), use a virtual env:

```bash
python3 -m venv ~/.langflow-venv
source ~/.langflow-venv/bin/activate
pip install --upgrade pip
pip install langflow
langflow run
```

**Path B — Docker** (requires Docker Desktop):

```bash
docker run -it --rm -p 7860:7860 langflowai/langflow:latest
```

Either way LangFlow lives at <http://localhost:7860>.

### 6. Configure OTTO to talk to LangFlow

```bash
# Per-session
export OTTO_LANGFLOW_URL=http://localhost:7860

# Persistent (zsh — default on modern macOS)
echo 'export OTTO_LANGFLOW_URL=http://localhost:7860' >> ~/.zshrc
source ~/.zshrc
```

Run `otto`. Footer should show `LF ok`.

---

## Linux (Ubuntu / Debian)

For other distros, substitute the package manager (dnf/yum on RHEL family, pacman on Arch, etc.). Steps are otherwise the same.

### 1. Install Node.js (includes npm)

The Node.js version in distro repos is often too old. Use **NodeSource** for current Node 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Alternative — nvm** (no sudo, easier to switch versions):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# restart shell
nvm install 22
nvm use 22
```

Verify:

```bash
node --version    # v22.x.x or higher
npm --version     # 11.5.1 or higher
```

If npm is older than 11.5.1:

```bash
npm install -g npm@latest
```

### 2. Install git

```bash
sudo apt-get install -y git
git --version
```

OTTO refuses to start without git on PATH.

### 3. Install Python (only if you'll run LangFlow via pip)

Most modern Ubuntu/Debian releases include Python 3.10+. If not:

```bash
sudo apt-get update
sudo apt-get install -y python3.12 python3.12-venv python3-pip
python3 --version    # 3.10–3.12
```

### 4. Install OTTO

```bash
npm install -g @cmetech/otto
otto --version
```

If `npm install -g` errors with `EACCES`, **don't `sudo`** — use a user-writable prefix:

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g @cmetech/otto
```

### 5. Install LangFlow

**Path A — pip via virtual env** (recommended on modern Debian/Ubuntu because of PEP 668):

```bash
python3 -m venv ~/.langflow-venv
source ~/.langflow-venv/bin/activate
pip install --upgrade pip
pip install langflow
langflow run
```

**Path B — Docker**:

```bash
docker run -it --rm -p 7860:7860 langflowai/langflow:latest
```

Either way LangFlow lives at <http://localhost:7860>.

### 6. Configure OTTO to talk to LangFlow

```bash
# Per-session
export OTTO_LANGFLOW_URL=http://localhost:7860

# Persistent
echo 'export OTTO_LANGFLOW_URL=http://localhost:7860' >> ~/.bashrc
source ~/.bashrc
```

Run `otto`. Footer should show `LF ok`.

---

## Upgrading OTTO

When a new version is published, on any platform:

```bash
npm update -g @cmetech/otto                # picks up the newest latest-tagged version
npm install -g @cmetech/otto@latest        # forces install of current latest
npm install -g @cmetech/otto@1.0.5         # pin to a specific version
```

After upgrade, run `otto --version` to confirm.

## Troubleshooting

### `Error: OTTO requires git but it was not found on PATH`

OTTO checks for git at startup because it relies on git for branch detection, diff inspection, atomic commits, and worktree-based agent isolation. Install git for your platform (see the step-2 sections above) and restart your shell.

### `npm warn deprecated …` during install

These come from transitive polyfill packages (`node-domexception`, `uuid@9.x`) and do not affect OTTO's behavior on Node 22+. They are slated to be replaced via npm `overrides` in a future release.

### `otto: command not found` (macOS / Linux) or "not recognized" (Windows)

The global npm bin directory isn't on `PATH`. Find it:

```bash
npm config get prefix
```

That directory's `bin` (macOS/Linux) or root (Windows) needs to be on `PATH`. On macOS/Linux, restart the shell. On Windows, close and reopen PowerShell.

### LangFlow shows `LF offline` in OTTO's footer

- Confirm LangFlow is still running (the `langflow run` process or Docker container).
- Confirm `OTTO_LANGFLOW_URL` exactly matches the LangFlow URL (default `http://localhost:7860`).
- Open the URL in a browser from the same machine. If the browser can't reach it, OTTO can't either.

### `npm install -g` permission errors

Don't `sudo`. Set a user-writable prefix as shown in the platform sections above. `sudo` works but creates root-owned files in `~/.npm` that bite you later (especially during `npm pack`).

### LangFlow pip install fails with "externally-managed-environment"

You're on a Debian/Ubuntu/macOS that enforces PEP 668. Use a venv:

```bash
python3 -m venv ~/.langflow-venv
source ~/.langflow-venv/bin/activate
pip install langflow
```

Activate the venv each time before running `langflow run`.

### Different LangFlow port

If you can't free port 7860, run LangFlow on another port and update `OTTO_LANGFLOW_URL` accordingly:

```bash
# pip
langflow run --port 8765

# Docker
docker run -it --rm -p 8765:7860 langflowai/langflow:latest

# Then:
export OTTO_LANGFLOW_URL=http://localhost:8765
```
