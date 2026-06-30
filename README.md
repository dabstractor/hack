# PRP Pipeline

<p align="center">
  <a href="https://github.com/dabstractor/hacky-hack/actions/workflows/ci.yml">
    <img alt="CI Status" src="https://github.com/dabstractor/hacky-hack/actions/workflows/ci.yml/badge.svg">
  </a>
  <a href="https://codecov.io/gh/YOUR_USERNAME/hacky-hack">
    <img alt="Coverage" src="https://codecov.io/gh/YOUR_USERNAME/hacky-hack/branch/main/graph/badge.svg">
  </a>
  <a href="https://badge.fury.io/js/hacky-hack">
    <img alt="npm version" src="https://badge.fury.io/js/hacky-hack.svg">
  </a>
  <a href="https://github.com/dabstractor/hacky-hack/blob/main/LICENSE">
    <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg">
  </a>
  <br/>
  <a href="https://github.com/dabstractor/hacky-hack">
    <img alt="node" src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen">
  </a>
  <a href="https://github.com/dabstractor/hacky-hack">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.2-blue">
  </a>
</p>

Autonomous AI-powered development pipeline that transforms Product Requirement
Documents (PRDs) into implemented code through multi-agent orchestration.

## What is PRP Pipeline?

PRP Pipeline is an autonomous software development system that transforms
Product Requirement Documents (PRDs) into working code through AI agent
orchestration.

At its core is the **Product Requirement Prompt (PRP)** - a structured prompt
that provides AI agents with complete context, clear objectives, and
validation criteria for implementing work units correctly in a single pass.

**Why PRP Pipeline?**

- **Autonomous Development**: Transform requirements into working code automatically
- **Context-Dense Prompts**: Every PRP contains everything needed for one-pass implementation
- **Progressive Validation**: 4-level quality gates catch defects early
- **Resumable Sessions**: Pause and resume with state persistence
- **Delta Sessions**: Only re-execute changed tasks when PRDs are updated

```mermaid
flowchart LR
    A[PRD.md] --> B[Architect Agent]
    B --> C[tasks.json<br/>Backlog]
    C --> D[Task Orchestrator]
    D --> E[Researcher Agent<br/>PRP Generator]
    E --> F[Coder Agent<br/>PRP Executor]
    F --> G[4-Level Validation]
    G --> H{All Complete?}
    H -->|No| D
    H -->|Yes| I[QA Agent<br/>Bug Hunt]
    I --> J[Bugs Found?]
    J -->|Yes| K[Fix Cycle]
    K --> D
    J -->|No| L[Success]

    subgraph Session Management
        M[Session Manager]
    end

    M -.->|State| D
    M -.->|Persist| F
```

See [PROMPTS.md](PROMPTS.md) for the complete PRP concept definition.

## Quick Start

Get running in under 2 minutes:

### Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0
- Git
- A z.ai credential — run `pi /login` (writes `~/.pi/agent/auth.json`) **or** `export ZAI_API_KEY=…`. (Anthropic credentials are optional; see [Configuration](#configuration).)

### Installation

```bash
# Clone the repository
git clone https://github.com/dabstractor/hacky-hack.git
cd hacky-hack

# Install dependencies
npm install
```

### Run Your First Pipeline

```bash
# Run with the example PRD
npm run dev -- --prd ./PRD.md

# See what would happen without executing
npm run dev -- --prd ./PRD.md --dry-run
```

That's it! The pipeline will analyze your PRD, generate tasks, and implement them through AI agents.

**Next Steps**: Check out [Usage Examples](#usage-examples) or [Configuration](#configuration).

## Features

- **4 AI Engines**: Specialized agents for Architecture, Research, Implementation, and QA
- **Hierarchical Task Decomposition**: Organize work into Phases → Milestones → Tasks → Subtasks
- **Delta Sessions**: Automatically detect PRD changes and only execute affected tasks
- **QA Bug Hunt**: 3-phase testing (syntax, unit, integration, creative)
- **Scoped Execution**: Run specific phases, milestones, or tasks
- **Resumable Sessions**: Pause and resume with Ctrl+C graceful shutdown
- **4-Level Validation**: Syntax, unit tests, integration tests, and manual validation gates
- **Smart Git Integration**: Automatic commits with generated messages
- **Performance Optimizations**: PRP caching, I/O batching, and parallel research
- **Self-Healing & Resilience**: Research deadlines with fallback, issue-driven re-planning,
  and automatic `tasks.json` recovery (see [Self-Healing & Resilience](#self-healing--resilience))

## Self-Healing & Resilience

The pipeline recovers from common agent failures without human intervention. Three mechanisms
keep a session running:

- **Research deadline & synchronous fallback** — background research is bounded by
  `RESEARCH_TIMEOUT` (default `300`s; PRD §4.2). If the deadline elapses, the in-flight research
  is abandoned and the item is re-researched synchronously inline, so a single hung agent cannot
  stall the pipeline.
- **Issue-driven re-planning** — when a coder reports an `issue` (a recoverable planning gap),
  the stale PRP is deleted, the item is reset, and research re-runs with the captured feedback.
  Re-plans are bounded by `ISSUE_RETRY_MAX` (default `3`; PRD §4.5) before the item hard-fails.
- **`tasks.json` corruption recovery** — after every agent run the orchestrator re-applies only
  the legitimate status delta (discarding unauthorized mutations) and restores a corrupted
  `tasks.json` from git history. This is automatic and non-fatal (PRD §5.1).

For details, see [Resilience Tuning](docs/CONFIGURATION.md#resilience-tuning) (env-var knobs),
[Issue-Driven Re-planning](docs/WORKFLOWS.md#issue-driven-re-planning) (re-planning flow), and
[tasks.json Protection & Smart Recovery](docs/ARCHITECTURE.md#tasksjson-protection--smart-recovery)
(recovery internals).

## Usage Examples

### Basic Pipeline Execution

```bash
# Run full pipeline with your PRD
npm run dev -- --prd ./PRD.md

# Run with verbose output
npm run dev -- --prd ./PRD.md --verbose
```

### Scoped Execution

Execute specific portions of your project:

```bash
# Run specific phase
npm run dev -- --prd ./PRD.md --scope P3

# Run specific milestone
npm run dev -- --prd ./PRD.md --scope P3.M4

# Run specific task
npm run dev -- --prd ./PRD.md --scope P3.M4.T2

# Run single subtask
npm run dev -- --prd ./PRD.md --scope P3.M4.T2.S1
```

### Delta Session (PRD Changes)

When you modify your PRD, run in delta mode to only execute changed tasks:

```bash
# Run in delta mode (only execute changed tasks)
npm run dev -- --prd ./PRD.md --mode delta
```

### Bug Hunt Mode

Run QA bug hunt even with incomplete tasks:

```bash
# Run QA bug hunt mode
npm run dev -- --prd ./PRD.md --mode bug-hunt
```

### Resume Interrupted Session

```bash
# Continue from previous session
npm run dev -- --prd ./PRD.md --continue
```

### Dry Run

```bash
# See what would happen without executing
npm run dev -- --prd ./PRD.md --dry-run
```

### Bypass Cache

```bash
# Bypass PRP cache and regenerate all PRPs
npm run dev -- --prd ./PRD.md --no-cache
```

## CLI Options

| Option               | Alias | Type    | Default    | Description                                               |
| -------------------- | ----- | ------- | ---------- | --------------------------------------------------------- |
| `--prd <path>`       | `-p`  | string  | `./PRD.md` | Path to PRD file                                          |
| `--scope <scope>`    | `-s`  | string  | -          | Execute specific scope (e.g., `P3.M4`)                    |
| `--mode <mode>`      | `-m`  | string  | `normal`   | Execution mode: `normal`, `delta`, `bug-hunt`, `validate` |
| `--continue`         | `-c`  | boolean | false      | Resume from previous session                              |
| `--dry-run`          | `-d`  | boolean | false      | Show plan without executing (no credential required)      |
| `--validate-prd`     | -     | boolean | false      | Validate the PRD and exit (no agent, no credential)       |
| `--verbose`          | `-v`  | boolean | false      | Enable debug logging                                      |
| `--machine-readable` | -     | boolean | false      | Enable machine-readable JSON output                       |
| `--no-cache`         | -     | boolean | false      | Bypass PRP cache and regenerate all PRPs                  |
| `--help`             | `-h`  | boolean | false      | Show help                                                 |

## Configuration

### Environment Variables

| Variable                         | Required | Default                          | Description                                                                    |
| -------------------------------- | -------- | -------------------------------- | ------------------------------------------------------------------------------ |
| `ZAI_API_KEY`                    | Yes\*    | None                             | z.ai API key (default-path credential for the `zai` provider).                 |
| `ANTHROPIC_BASE_URL`             | No       | `https://api.z.ai/api/anthropic` | API endpoint (auto-set to z.ai for the `zai` provider only).                   |
| `PRP_API_KEY`                    | No       | None                             | Explicit API-key override (highest precedence, any provider).                  |
| `PRP_AGENT_HARNESS`              | No       | `pi`                             | Agent runtime: `pi` (default) or `claude-code` (Anthropic-only).               |
| `ANTHROPIC_AUTH_TOKEN`           | No\*\*   | None                             | **Optional.** Anthropic provider only; mapped to `ANTHROPIC_API_KEY` if unset. |
| `ANTHROPIC_API_KEY`              | No\*\*   | None                             | **Optional.** Anthropic provider only.                                         |
| `ANTHROPIC_DEFAULT_OPUS_MODEL`   | No       | `glm-5.2`                        | Architect agent model (provider-qualified at runtime).                         |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | No       | `glm-5.2`                        | Researcher/Coder model (default).                                              |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL`  | No       | `glm-5-turbo`                    | Simple-operations model (fastest).                                             |

_\*Required for the default path: **`ZAI_API_KEY`**, `pi /login` (`~/.pi/agent/auth.json`, auto-detected), **or** `PRP_API_KEY`. **\*\*Optional:** Anthropic credentials are consulted only when the resolved provider is `anthropic` (via an `anthropic/*` model override); they are **ignored** for the default `zai` provider. A startup preflight (PRD §9.2.7) aborts with an actionable error if none is present **for runs that invoke an agent** (see [Troubleshooting](#troubleshooting)). The pure-local modes `--validate-prd` and `--dry-run` make no API calls and run **without any credential**._

For the full auth + preflight walkthrough, see [Installation](docs/INSTALLATION.md) and [Configuration](docs/CONFIGURATION.md).

### Setup

```bash
# Option 1: pi /login — recommended (writes ~/.pi/agent/auth.json, auto-detected by the harness)
pi /login

# Option 2: Set the z.ai provider env var directly
export ZAI_API_KEY="your-zai-key-here"

# --- Optional: Anthropic provider only (claude-code harness or anthropic/* models) ---
# export ANTHROPIC_API_KEY="your-anthropic-key-here"
# (ANTHROPIC_AUTH_TOKEN is accepted as a backward-compat alias for ANTHROPIC_API_KEY
#  when the resolved provider is 'anthropic'.)

# Or copy the template and edit:
# cp .env.example .env
```

### Model Tiers

- **Opus** (glm-5.2): Highest quality, used for Architect agent
- **Sonnet** (glm-5.2): Balanced quality/speed, default for most agents
- **Haiku** (glm-5-turbo): Fastest, used for simple operations

### How It Works

**Authentication is provider-aware** (PRD §9.2.6). For the resolved provider (default `zai`),
the credential is resolved in order; the first non-empty source wins:

1. **`PRP_API_KEY`** — explicit override (highest precedence, any provider).
2. **Provider-native env var** — `ZAI_API_KEY` for `zai`; `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY` for `anthropic`.
3. **`~/.pi/agent/auth.json`** — written by `pi /login`, auto-detected by the harness.

Empty/whitespace values are treated as 'not configured'.

_The `ANTHROPIC_BASE_URL` defaults to `https://api.z.ai/api/anthropic` only when the provider is `zai`._

_Backward-compat alias: when the provider is `anthropic`, `ANTHROPIC_AUTH_TOKEN` is mapped to `ANTHROPIC_API_KEY` if the latter is unset. This alias does **not** apply to the default `zai` path._

### API Safeguards

The pipeline includes safeguards to prevent accidental usage of Anthropic's official API, which could result in massive unexpected charges.

**Test Setup Safeguard** (`tests/setup.ts`):

- Blocks: `api.anthropic.com` (all variants)
- Allows: `localhost`, `127.0.0.1`, `mock`, `test` endpoints
- Warns: Non-z.ai endpoints with console warning
- Runs: On test file load and before each test

**Validation Script Safeguard** (`src/scripts/validate-api.ts`):

- Checks: `ANTHROPIC_BASE_URL` before any API calls
- Exits: With code 1 if Anthropic API detected
- Tests: z.ai endpoint with `/v1/messages`
- Validates: Response structure (id, type, role, content)

**What Gets Blocked:**

```
https://api.anthropic.com
http://api.anthropic.com
api.anthropic.com (any variant)
```

**What's Allowed:**

```
https://api.z.ai/api/anthropic (recommended)
http://localhost:3000 (local testing)
http://127.0.0.1:8080 (local testing)
http://mock-api (mock testing)
```

### z.ai Configuration

The PRP Pipeline uses **z.ai** as the API endpoint, not Anthropic's official API.

**Why z.ai?**

- Compatible with Anthropic API v1 specification
- Cost control and usage monitoring
- Prevents unexpected production API charges

**Model Tiers:**

| Tier   | Model       | Use Case                            |
| ------ | ----------- | ----------------------------------- |
| Opus   | glm-5.2     | Architect agent (complex reasoning) |
| Sonnet | glm-5.2     | Researcher/Coder agents (default)   |
| Haiku  | glm-5-turbo | Simple operations (fastest)         |

**Example .env File:**

```bash
# .env — API Configuration for the default zai provider
# Option A: pi /login (writes ~/.pi/agent/auth.json, auto-detected by the harness)
# Option B: set ZAI_API_KEY directly
ZAI_API_KEY=your-zai-key-here

# Optional: API endpoint (defaults to z.ai for the zai provider)
# ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
# Optional: Anthropic provider only (ignored for zai)
# ANTHROPIC_AUTH_TOKEN=…
# ANTHROPIC_API_KEY=…

# Optional: Model overrides
# ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.2
# ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.2
# ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5-turbo
```

### Troubleshooting

**"Tests fail with 'Anthropic API detected' error"**

The test setup safeguards prevent using Anthropic's official API.

```bash
# Fix: Set BASE_URL to z.ai endpoint
export ANTHROPIC_BASE_URL="https://api.z.ai/api/anthropic"

# Or add to .env file
echo "ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic" >> .env
```

**"Authentication preflight failed" startup abort**

The fail-fast preflight (PRD §9.2.7) found no credential for the selected provider before any
agent ran. The message names the harness, provider/model, every checked source, and the fix:

```
Authentication preflight failed: no credential configured for provider 'zai' (harness 'pi', model 'zai/glm-5.2').

Checked sources (all empty):
  • Override:     PRP_API_KEY
  • Environment:  ZAI_API_KEY
  • pi auth.json: ~/.pi/agent/auth.json

Remediation (pick one):
  • pi /login                       # writes ~/.pi/agent/auth.json
  • export ZAI_API_KEY=<your-key>   # provider-native env var
```

```bash
# Fix: run pi /login (recommended) or set the env var directly
pi /login
# or
export ZAI_API_KEY="your-zai-key-here"
# For the anthropic provider:
# export ANTHROPIC_API_KEY="your-anthropic-key-here"
```

**\`claude-code\` harness + default \`zai\` models" startup abort**

`claude-code` is Anthropic-only, so pairing it with the default `zai` models is an invalid
configuration. It fails at startup with a single actionable message and exit code 1 (not a raw
stack trace). Fix it one of two ways:

```bash
# Option A: use the default, vendor-neutral harness (runs any provider)
unset PRP_AGENT_HARNESS        # or: export PRP_AGENT_HARNESS=pi

# Option B: keep claude-code and switch to Anthropic models
export ANTHROPIC_DEFAULT_SONNET_MODEL="anthropic/claude-sonnet-4"
export ANTHROPIC_API_KEY="your-anthropic-key-here"
```

**"Model not found: glm-5.2" error**

The z.ai endpoint may not support the configured model.

```bash
# Fix: Verify model name or override with supported model
export ANTHROPIC_DEFAULT_SONNET_MODEL="supported-model-name"

# Check z.ai documentation for available models
```

**"Connection timeout" errors**

The API timeout may be too short for complex requests.

```bash
# Fix: Increase timeout (default is 60 seconds)
export API_TIMEOUT_MS=120000
```

## Architecture Overview

### System Flow

```mermaid
flowchart LR
    A[PRD.md] --> B[Architect Agent]
    B --> C[tasks.json<br/>Backlog]
    C --> D[Task Orchestrator]
    D --> E[PRP Generator<br/>Researcher Agent]
    E --> F[PRP Executor<br/>Coder Agent]
    F --> G[4-Level Validation]
    G --> H{All Complete?}
    H -->|No| D
    H -->|Yes| I[QA Agent<br/>Bug Hunt]
    I --> J[Bugs Found?]
    J -->|Yes| K[Fix Cycle]
    K --> D
    J -->|No| L[Success]

    subgraph Session Management
        M[Session Manager]
    end

    M -.->|State| D
    M -.->|Persist| F
```

### Core Components

#### Session Manager

Handles state persistence, session directories (`plan/{sequence}_{hash}/`), and PRD change detection. Creates delta sessions when PRDs are modified.

#### Task Orchestrator

Manages task hierarchy traversal (depth-first, pre-order), dependency resolution, and scope-based execution. Coordinates the flow from PRD to implemented code.

#### Agent Factory

Creates specialized AI agents:

- **Architect**: Decomposes PRDs into hierarchical task backlogs
- **Researcher**: Generates PRPs from subtasks through codebase research
- **Coder**: Implements PRPs with validation gates
- **QA**: Performs bug hunts and generates test reports

#### PRP Runtime

Executes Product Requirement Prompts with 4-level validation:

1. **Level 1**: Syntax & Style (linting, type check)
2. **Level 2**: Unit Tests (component validation)
3. **Level 3**: Integration Tests (system validation)
4. **Level 4**: Manual/E2E (creative validation)

See [PROMPTS.md](PROMPTS.md) for complete PRP concept definition.

**For comprehensive architecture documentation**, see:

- **[Architecture Documentation](docs/architecture.md)** - Detailed system architecture with Mermaid diagrams, component interactions, extensibility patterns, and API references
- **[TypeDoc API Reference](docs/api/index.html)** - Complete API documentation for all modules, classes, and types (run `npm run docs` to generate)

## AI Agent System

The PRP Pipeline uses specialized AI agents for each stage of development:

| Agent          | Purpose                  | Input           | Output          | Invoked When       |
| -------------- | ------------------------ | --------------- | --------------- | ------------------ |
| **Architect**  | Decompose PRD into tasks | PRD.md          | tasks.json      | New session        |
| **Researcher** | Generate PRPs            | Subtask context | PRP.md          | Subtask starts     |
| **Coder**      | Implement PRPs           | PRP.md          | Code changes    | PRP generated      |
| **QA**         | Find bugs                | Completed code  | TEST_RESULTS.md | All tasks complete |

### PRP Concept

A **Product Requirement Prompt (PRP)** is a structured prompt containing:

- **Goal**: What to build (feature goal, deliverable, success criteria)
- **Context**: Complete context (file paths, patterns, gotchas, docs)
- **How**: Step-by-step implementation tasks
- **Validation**: 4-level quality gate system

PRPs enable one-pass implementation by providing AI agents with everything
they need - no guessing, no missing context.

## Pipeline Workflow

### Phase 1: Session Initialization

Computes SHA-256 hash of PRD.md to detect new vs existing sessions:

- **New session**: Creates `plan/{sequence}_{hash}/` directory
- **Existing session**: Loads tasks.json and resumes execution
- **Delta session**: When PRD changes, creates linked session for incremental updates

### Phase 2: PRD Decomposition

Architect Agent analyzes PRD and generates task hierarchy:

- Phase → Milestone → Task → Subtask (4 levels)
- Each Subtask includes context_scope, dependencies, and story_points
- Persists to `tasks.json`

### Phase 3: Backlog Execution

Task Orchestrator traverses hierarchy (depth-first, pre-order):

1. Check dependencies (wait if blocking)
2. Generate PRP (Product Requirement Prompt) via Researcher agent
3. Execute PRP with Coder agent
4. Validate through 4-level gate system
5. Commit changes to Git

Supports graceful shutdown (Ctrl+C preserves state).

### Phase 4: QA Cycle

Runs when all tasks are Complete:

- QA Agent performs bug hunt (3-phase testing)
- Generates TEST_RESULTS.md
- If bugs found: triggers bug-fix sub-pipeline
- If no bugs: pipeline succeeds

## Project Structure

```
hacky-hack/
├── src/
│   ├── agents/              # AI agent implementations
│   │   ├── prompts/         # Agent prompt templates
│   │   ├── agent-factory.ts # Agent creation factory
│   │   ├── prp-generator.ts # PRP Generator agent
│   │   ├── prp-executor.ts  # PRP Executor agent
│   │   └── prp-runtime.ts   # PRP Runtime orchestrator
│   ├── cli/                 # Command-line interface
│   │   └── index.ts         # CLI argument parser
│   ├── config/              # Configuration modules
│   │   ├── constants.ts     # Constants
│   │   ├── environment.ts   # Environment setup
│   │   └── types.ts         # Type definitions
│   ├── core/                # Core business logic
│   │   ├── index.ts         # Core module exports
│   │   ├── models.ts        # Task hierarchy types
│   │   ├── prd-differ.ts    # PRD diffing utilities
│   │   ├── scope-resolver.ts # Scope parsing
│   │   ├── session-manager.ts # Session state management
│   │   ├── session-utils.ts # Session utilities
│   │   └── task-orchestrator.ts # Task execution orchestrator
│   ├── tools/               # MCP tool integrations
│   │   ├── bash-mcp.ts      # Bash MCP tool
│   │   ├── filesystem-mcp.ts # Filesystem MCP tool
│   │   └── git-mcp.ts       # Git MCP tool
│   ├── utils/               # Utility functions
│   │   ├── git-commit.ts    # Smart commit utility
│   │   ├── logger.ts        # Logging utilities
│   │   ├── progress.ts      # Progress tracking
│   │   └── task-utils.ts    # Task utilities
│   ├── workflows/           # Pipeline orchestration
│   │   ├── prp-pipeline.ts  # Main PRP Pipeline workflow
│   │   ├── delta-analysis-workflow.ts # Delta session workflow
│   │   ├── bug-hunt-workflow.ts # QA bug hunt workflow
│   │   └── fix-cycle-workflow.ts # Bug fix workflow
│   └── scripts/             # Standalone scripts
│       └── validate-api.ts  # API validation script
├── plan/                    # Session directories
│   └── 001_14b9dc2a33c7/    # Example session
│       ├── PRP/             # Generated PRPs
│       ├── research/        # Research findings
│       ├── architecture/    # Architectural research
│       ├── tasks.json       # Task hierarchy
│       └── prd_snapshot.md  # PRD snapshot
├── PRD.md                   # Master product requirements
├── PROMPTS.md               # System prompts
├── package.json             # npm configuration
├── tsconfig.json            # TypeScript configuration
├── vitest.config.ts         # Test configuration
├── .eslintrc.json           # ESLint configuration
└── .prettierrc              # Prettier configuration
```

## Development

### Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/dabstractor/hacky-hack.git
cd hacky-hack

# Install dependencies
npm install

# Verify installation
npm run typecheck
```

### Available Scripts

| Script                  | Description                     |
| ----------------------- | ------------------------------- |
| `npm run dev`           | Run pipeline with PRD           |
| `npm run dev:watch`     | Run with hot reload             |
| `npm run dev:debug`     | Run with debug inspector        |
| `npm run build`         | Build the project               |
| `npm run typecheck`     | Type check without compilation  |
| `npm test`              | Run tests in watch mode         |
| `npm run test:run`      | Run tests once                  |
| `npm run test:coverage` | Generate coverage report        |
| `npm run lint`          | Run ESLint                      |
| `npm run format`        | Format code with Prettier       |
| `npm run validate`      | Lint, format, typecheck & tests |
| `npm run fix`           | Auto-fix linting and formatting |

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- path/to/test.test.ts

# Run with coverage
npm run test:coverage

# Run tests in watch mode
npm test
```

### Building

```bash
# Type check
npm run typecheck

# Build for production
npm run build

# Build with watch mode
npm run build:watch
```

## Contributing

We welcome contributions! See [docs/contributing.md](docs/contributing.md) for complete contributor guidelines, including:

- Development setup instructions
- Code organization overview
- Testing guide (100% coverage requirement)
- Code style (ESLint, Prettier, TypeScript)
- Adding new agent personas
- Adding new MCP tools
- Pull request process
- Release process

## License

MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
