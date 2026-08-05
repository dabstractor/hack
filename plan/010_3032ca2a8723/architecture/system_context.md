# System Context: Session 010

## Project Overview

**hacky-hack** is a TypeScript/Node.js implementation of the Autonomous PRP Development
Pipeline — an agentic software development system that converts a PRD into implemented,
tested code through structured, phase-based architecture.

- **Runtime**: Node.js 20+ / TypeScript 5.2+
- **Core Framework**: Groundswell (local library at `~/projects/groundswell`)
- **Agent Harness**: `pi` (pi.dev, default) / `claude-code` (optional)
- **LLM Provider**: z.ai (Anthropic-compatible API)
- **Test Framework**: Vitest 1.6
- **Build**: `tsc -p tsconfig.build.json`
- **Entry point**: `src/index.ts` → `dist/index.js` (bin: `hack`)

## Session History (Implementation Chain)

| Session | Delta From | Focus | Status |
|---------|-----------|-------|--------|
| 001 | — | Foundation, Core Agent System, Pipeline, QA, Polish (82 subtasks) | Complete |
| 002 | 001 | Bootstrap Core Infrastructure (33 subtasks) | Complete |
| 003 | 002 | System Validation, Documentation, Performance (71 subtasks) | Complete |
| 004 | 003 | Pluggable Agent Harness System (10 subtasks) | Complete |
| 005 | 004 | Pipeline Resilience & Self-Healing (14 subtasks) | Complete |
| 006 | — | Test Phase (adopt/baseline) | Complete |
| 007 | 006 | Auth & Logging Hardening (10 subtasks) | Complete |
| 008 | 007 | Distributed PRD, Model Roles, Execution Resilience, Delta, Adopt, Docs (55 subtasks) | Complete |
| 009 | 008 | Repo Root Resolution, .hack Config, Tasks-Not-Generated Window (11 subtasks) | Complete |
| **010** | **009** | **Cosmetic delta (markdown table formatting)** | **This session** |

## Codebase Health (Verified at Analysis Time)

| Check | Result |
|-------|--------|
| TypeScript typecheck (`tsc --noEmit`) | ✅ PASS (exit 0) |
| Unit tests (`vitest run tests/unit/`) | ✅ 145 test files, all passing |
| ESLint | ✅ 0 errors (6 pre-existing `any` type warnings) |
| Build (`tsc -p tsconfig.build.json`) | ✅ PASS |

## Key Source Directories

```
src/
├── index.ts                  # CLI entry point + bootstrap ordering
├── cli/                      # Commander CLI commands
│   ├── index.ts              # parseCLIArgs(), flags, subcommand routing
│   └── commands/             # artifacts, cache, config, inspect, validate-state
├── config/                   # Configuration layer
│   ├── constants.ts          # All env var names, defaults, getters (1335 lines)
│   ├── environment.ts        # configureEnvironment() — canonical/legacy resolution
│   ├── hack-config.ts        # .hack TOML loader (3-tier layering, 983 lines)
│   ├── harness.ts            # Harness selection + provider-aware auth resolution
│   ├── endpoint-guard.ts     §9.2.4 z.ai endpoint safeguard
│   └── types.ts              # Config type definitions
├── core/                     # Core pipeline logic
│   ├── session-manager.ts    # Session creation, hashing, lifecycle (1751 lines)
│   ├── task-orchestrator.ts  # Execution loop, dependency resolution (1479 lines)
│   ├── models.ts             # Zod schemas for tasks.json (2171 lines)
│   ├── file-lock.ts          # O_EXCL lockfile concurrency (641 lines)
│   ├── change-classifier.ts  # COSMETIC/SUBSTANTIVE LLM classifier (285 lines)
│   ├── prd-differ.ts         # PRD diffing for delta detection
│   ├── session-utils.ts      # resolvePRD() include expansion, atomic writes
│   ├── tasks-json-recovery.ts# Git-history recovery for corrupted tasks.json
│   ├── research-queue.ts     # Background PRP research supervisor
│   └── ...                   # cleanup-runner, task-patcher, scope-resolver, etc.
├── agents/                   # Agent personas + prompts
│   ├── agent-factory.ts      # createArchitectAgent, createResearcherAgent, etc.
│   ├── prp-generator.ts      # PRP (Product Requirement Prompt) creation
│   ├── prp-executor.ts       # PRP execution (Coder agent)
│   ├── prp-runtime.ts        # Agent runtime abstraction
│   ├── prompts/              # Prompt templates (architect, bug-hunt, delta, etc.)
│   └── prompts.ts            # System prompt constants (ported from PROMPTS.md)
├── workflows/                # Groundswell Workflow classes
│   ├── prp-pipeline.ts       # Main pipeline controller
│   ├── delta-analysis-workflow.ts
│   ├── validation-workflow.ts
│   ├── bug-hunt-workflow.ts
│   └── fix-cycle-workflow.ts
└── utils/                    # Utilities
    ├── git-commit.ts         # Smart Commit, stagecoach, task-prefix format
    ├── repo-root.ts          # §9.8 upward .git traversal + chdir
    ├── logger.ts             # §9.6 lazy loggers, sync destinations
    ├── retry.ts              # Retry with backoff (watchdog-kill-aware)
    └── ...                   # progress, cache, errors, validation, etc.
```

## External Dependencies

- **Groundswell** (`~/projects/groundswell`): Workflow/Agent orchestration framework.
  - `Workflow`, `Step`, `Task`, `ObservedState` decorators
  - `createAgent`, `createPrompt` factories
  - `PiHarness`, `ClaudeCodeHarness` harnesses
  - `MCPHandler` for tool registration
- **pi SDK** (`@earendil-works/pi-coding-agent`): Vendor-neutral agent runtime
- **zod**: Schema validation for tasks.json and agent responses
- **commander**: CLI argument parsing
- **simple-git**: Git operations for Smart Commit/recovery
- **smol-toml**: TOML parsing for `.hack` config files
- **pino/pino-pretty**: Structured logging (lazy, sync destinations)