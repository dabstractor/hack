# Installation Guide

> Comprehensive guide for setting up the PRP Pipeline development environment from scratch. This document covers all prerequisites, dependencies, environment configuration, and verification steps needed to get started with development.

**Status**: Published
**Last Updated**: 2026-01-23
**Version**: 1.0.0

## Table of Contents

- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
  - [Node.js](#nodejs)
  - [npm](#npm)
  - [Git](#git)
- [Installation](#installation)
  - [Clone the Repository](#clone-the-repository)
  - [Install Dependencies](#install-dependencies)
  - [Link Groundswell](#link-groundswell)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [Configuration File](#configuration-file)
- [Verification](#verification)
  - [Run Tests](#run-tests)
  - [Run Validation](#run-validation)
  - [Build Check](#build-check)
- [Troubleshooting](#troubleshooting)
  - ["npm link fails"](#npm-link-fails)
  - ["Cannot find module 'groundswell'"](#cannot-find-module-groundswell)
  - ["Wrong Node/npm version"](#wrong-nodenpm-version)
  - ["Tests fail with API error"](#tests-fail-with-api-error)
  - ["EACCES permission errors"](#eacces-permission-errors)
- [Platform-Specific Notes](#platform-specific-notes)
  - [Windows](#windows)
  - [macOS](#macos)
  - [Linux](#linux)
- [Next Steps](#next-steps)

---

## Quick Start

Get up and running in under 5 minutes:

1. **Clone the repository**

   ```bash
   git clone https://github.com/YOUR_USERNAME/hacky-hack.git
   cd hacky-hack
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Link Groundswell library**

   ```bash
   cd ~/projects/groundswell && npm link
   cd ~/projects/hacky-hack && npm link groundswell
   ```

4. **Configure environment variables**

   ```bash
   export ANTHROPIC_AUTH_TOKEN=zk-xxxxx
   export ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
   ```

5. **Verify installation**

   ```bash
   npm test
   ```

For detailed setup instructions and troubleshooting, see the sections below.

---

## Prerequisites

Before installing, ensure you have the following prerequisites installed on your system.

### Node.js

- **Version**: >=20.0.0
- **Check your version**:

  ```bash
  node --version
  ```

- **Install or upgrade**: [nodejs.org](https://nodejs.org/)

**Recommended: Use nvm (Node Version Manager)**

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc  # or restart terminal

# Install Node.js 20 LTS
nvm install 20
nvm use 20
```

### npm

- **Version**: >=10.0.0
- **Check your version**:

  ```bash
  npm --version
  ```

- **Install or upgrade**: [npm documentation](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)

**Note**: npm is included with Node.js. If you install Node.js via nvm, npm will be installed automatically.

### Git

- **Version**: >=2.0.0
- **Check your version**:

  ```bash
  git --version
  ```

- **Install or upgrade**:
  - **Windows**: [git-scm.com](https://git-scm.com/download/win)
  - **macOS**: `brew install git` or `xcode-select --install`
  - **Linux**: `sudo apt-get install git` (Debian/Ubuntu)

---

## Installation

### Clone the Repository

Clone the repository to your local machine:

```bash
git clone https://github.com/YOUR_USERNAME/hacky-hack.git
cd hacky-hack
```

**Alternative: SSH (if you have SSH keys configured)**

```bash
git clone git@github.com:YOUR_USERNAME/hacky-hack.git
cd hacky-hack
```

### Install Dependencies

Install all project dependencies:

```bash
npm install
```

This installs:

- Core dependencies (Anthropic SDK, Commander, Zod, etc.)
- Development dependencies (TypeScript, Vitest, ESLint, etc.)
- Build tools and linters

**Expected Output**:

```text
added 123 packages, and audited 124 packages in 5s
found 0 vulnerabilities
```

### Link Groundswell

The project uses **Groundswell** as a local dependency. Groundswell must be linked via `npm link` (not installed from npm registry).

**Step 1: Build and link Groundswell**

```bash
# Navigate to the Groundswell project directory
cd ~/projects/groundswell

# Build Groundswell (if dist/ directory doesn't exist)
npm run build

# Create global symlink
npm link
```

**Expected Output**:

```text
/Users/yourname/.nvm/versions/v20.0.0/lib/node_modules/groundswell -> ~/projects/groundswell
```

**Step 2: Link Groundswell in hacky-hack**

```bash
# Navigate to the hacky-hack project directory
cd ~/projects/hacky-hack

# Link Groundswell to the project
npm link groundswell
```

**Expected Output**:

```text
/home/dustin/projects/hacky-hack/node_modules/groundswell -> /Users/yourname/.nvm/versions/v20.0.0/lib/node_modules/groundswell -> ~/projects/groundswell
```

**Verify the link**:

```bash
ls -la node_modules/groundswell
npm list groundswell
```

**Critical Notes**:

- Order matters: You must link from Groundswell first, then link in hacky-hack
- Groundswell must be built (`npm run build`) before linking
- The Vitest path alias is configured in `vitest.config.ts`

---

## Configuration

### Environment Variables

The project requires certain environment variables to function. These can be set via shell exports or a `.env` file.

**Required Variables**:

| Variable               | Required | Default                          | Description                                                              |
| ---------------------- | -------- | -------------------------------- | ------------------------------------------------------------------------ |
| `ANTHROPIC_AUTH_TOKEN` | Yes      | None                             | z.ai API authentication token (mapped to `ANTHROPIC_API_KEY` internally) |
| `ANTHROPIC_BASE_URL`   | Yes      | `https://api.z.ai/api/anthropic` | z.ai API endpoint                                                        |

**Optional Variables**:

| Variable                         | Required | Default       | Description                            |
| -------------------------------- | -------- | ------------- | -------------------------------------- |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | No       | `GLM-4.7`     | Model for Sonnet tier (default agents) |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL`  | No       | `GLM-4.5-Air` | Model for Haiku tier (fast operations) |
| `ANTHROPIC_DEFAULT_OPUS_MODEL`   | No       | `GLM-4.7`     | Model for Opus tier (architect agent)  |

**Setting Environment Variables (Shell)**:

```bash
# Set required variables
export ANTHROPIC_AUTH_TOKEN=zk-xxxxx
export ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic

# Verify
echo $ANTHROPIC_AUTH_TOKEN
```

**Using a .env file**:

Create a `.env` file in the project root:

```bash
# .env - Environment Configuration

# Required: z.ai API authentication
ANTHROPIC_AUTH_TOKEN=zk-xxxxx
ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic

# Optional: Model overrides
ANTHROPIC_DEFAULT_SONNET_MODEL=GLM-4.7
ANTHROPIC_DEFAULT_HAIKU_MODEL=GLM-4.5-Air
ANTHROPIC_DEFAULT_OPUS_MODEL=GLM-4.7
```

**Security Note**: Never commit `.env` to version control. The project `.gitignore` excludes `.env` files by default.

**Important: Environment Variable Mapping**

The shell uses `ANTHROPIC_AUTH_TOKEN`, but the SDK expects `ANTHROPIC_API_KEY`. The system automatically maps `AUTH_TOKEN` to `API_KEY` at startup via `configureEnvironment()` in `src/config/environment.ts`.

### Configuration File

The project supports optional configuration via environment variables only. No separate configuration file is required.

---

## Verification

After installation and configuration, verify everything is working correctly.

### Run Tests

Run the test suite to verify installation:

```bash
npm test
```

This runs Vitest in watch mode. All tests should pass.

**Expected Output**:

```text
✓ src/core/session-manager.test.ts (5)
✓ src/agents/coder-agent.test.ts (10)
✓ src/agents/researcher-agent.test.ts (8)

Test Files  23 passed (23)
Tests  142 passed (142)
Start at 12:34:56
Duration  5.23s (transform 234ms, setup 0ms, collect 123ms, tests 5.23s)
```

### Run Validation

Run the full validation suite:

```bash
npm run validate
```

This runs:

1. Groundswell validation
2. ESLint (code linting)
3. Prettier (formatting check)
4. TypeScript type checking

**Expected Output**:

```text
> validate
> npm run validate:groundswell && npm run lint && npm run format:check && npm run typecheck

> validate:groundswell
> tsx src/scripts/validate-groundswell.ts
Groundswell linked and validated successfully.

> lint
> eslint . --ext .ts

> format:check
> prettier --check "**/*.{ts,js,json,md,yml,yaml}"
Checking formatting...

> typecheck
> tsc --noEmit
```

### Build Check

Verify the build works:

```bash
npm run build
```

**Expected Output**:

```text
> build
> tsc
```

This compiles TypeScript to JavaScript in the `dist/` directory with no errors.

---

## Troubleshooting

This section covers common installation issues organized by **symptom** (what you see), not internal cause.

### "npm link fails"

**What you see**:

```bash
$ npm link groundswell
npm ERR! code EEXIST
npm ERR! path /usr/local/lib/node_modules/groundswell
```

**Why it happens**:
The groundswell package isn't built or a symlink already exists.

**How to fix**:

1. Build groundswell first:

   ```bash
   cd ~/projects/groundswell
   npm run build
   npm link
   ```

2. In hacky-hack, unlink and try again:

   ```bash
   cd ~/projects/hacky-hack
   npm unlink groundswell
   npm link groundswell
   ```

---

### "Cannot find module 'groundswell'"

**What you see**:

```bash
Error: Cannot find module 'groundswell'
```

**Why it happens**:
Groundswell isn't linked or the link is broken.

**How to fix**:

1. Verify groundswell is built:

   ```bash
   cd ~/projects/groundswell
   ls dist/  # Should exist
   npm run build  # If dist/ doesn't exist
   ```

2. Re-link groundswell:

   ```bash
   cd ~/projects/groundswell
   npm link

   cd ~/projects/hacky-hack
   npm link groundswell
   ```

3. Verify the link:

   ```bash
   ls -la node_modules/groundswell
   ```

---

### "Wrong Node/npm version"

**What you see**:

```bash
Error: The engine "node" is incompatible with this module. Expected version ">=20.0.0"
```

**Why it happens**:
Your Node.js or npm version is below the minimum requirement.

**How to fix**:

1. Check your versions:

   ```bash
   node --version  # Should be v20.0.0 or higher
   npm --version   # Should be 10.0.0 or higher
   ```

2. Upgrade Node.js using nvm:

   ```bash
   nvm install 20
   nvm use 20
   ```

3. Verify after upgrade:

   ```bash
   node --version
   npm --version
   ```

---

### "Tests fail with API error"

**What you see**:

```bash
Error: Tests must use z.ai API, not Anthropic production API
```

**Why it happens**:
The `ANTHROPIC_BASE_URL` is pointing to the wrong endpoint. Tests enforce z.ai usage.

**How to fix**:

1. Verify your environment variables:

   ```bash
   echo $ANTHROPIC_BASE_URL
   # Should be: https://api.z.ai/api/anthropic
   ```

2. Set the correct base URL:

   ```bash
   export ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
   ```

3. Run tests again:

   ```bash
   npm test
   ```

---

### "EACCES permission errors"

**What you see**:

```bash
npm ERR! Error: EACCES: permission denied
```

**Why it happens**:
Attempting global operations without proper permissions.

**How to fix**:

**Option 1: Fix npm permissions (Recommended)**:

```bash
sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}
```

**Option 2: Use nvm (Recommended)**:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20
```

**Option 3: Use sudo (Not Recommended)**:

```bash
sudo npm link
```

---

## Platform-Specific Notes

### Windows

**PowerShell Users**:

- Run PowerShell as Administrator for global operations
- Use Windows Terminal for best experience

**Git Bash / WSL Users**:

- Follow Unix-style commands
- Ensure Git Bash is configured for line endings (should be automatic)

**Symlink Permissions**:

If you encounter symlink errors:

1. Enable Developer Mode in Settings → Update & Security → For developers
2. Or run terminal as Administrator

**Path Differences**:

Windows uses backslashes for paths:

```powershell
cd projects\groundswell
npm link
```

### macOS

**Install Xcode Command Line Tools**:

```bash
xcode-select --install
```

**Homebrew Users**:

```bash
brew install node@20
brew link node@20
```

**Permission Issues**:

If you encounter permission errors, fix npm permissions:

```bash
sudo chown -R $(whoami) /usr/local/lib/node_modules
```

**Or use nvm (Recommended)**:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20
```

**Apple Silicon Users**:

Some x86 packages may require Rosetta 2:

```bash
softwareupdate --install-rosetta
```

### Linux

**Debian/Ubuntu**:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Fedora/RHEL**:

```bash
sudo dnf install nodejs npm
```

**Arch Linux**:

```bash
sudo pacman -S nodejs npm
```

**File Watcher Limit**:

If you encounter "ENOSPC: system limit for number of file watchers reached":

```bash
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

---

## Next Steps

Now that you have the environment set up:

- **[README.md](../README.md)** - Project overview and Quick Start
- **[User Guide](./user-guide.md)** - Comprehensive usage documentation for PRD writing, session management, delta workflow, and more
- **[PRD.md](../PRD.md)** - Product requirements document for understanding the project

**Common Next Steps**:

1. Read the [User Guide](./user-guide.md) to understand how to write PRDs
2. Run `npm run dev -- --prd ./PRD.md` to start your first session
3. Explore the [Troubleshooting](#troubleshooting) section in the User Guide for common issues

**Need Help?**

- Check the [GitHub Issues](https://github.com/YOUR_USERNAME/hacky-hack/issues)
- Review the [Troubleshooting](#troubleshooting) section above
- See the User Guide's [Troubleshooting section](./user-guide.md#6-troubleshooting) for runtime issues

---

**Installation Guide Version**: 1.0.0
**Last Updated**: 2026-01-23
**For PRP Pipeline Version**: 0.1.0
