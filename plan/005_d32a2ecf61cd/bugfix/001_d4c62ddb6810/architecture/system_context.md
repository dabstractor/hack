# System Context — Bugfix 001_d4c62ddb6810

## Git Topology (CRITICAL)

The working directory is on a **detached HEAD** at `93be68d` ("Add bug report: 001_d4c62ddb6810"),
which is a direct child of `b03ed87`. The `main` branch is at `4e6d2ef` ("Add task CLI subcommand and
delta execution mode") and contains the entire Session 005 resilience work (commits `d9a4d9a` through
`84520db`) plus the regression-introducing commit `4e6d2ef`.

```
b03ed87 ── 93be68d (HEAD, detached — bug report only)
    │
    └── (main) d9a4d9a → 182d8da → 8b9bab3 → 0a6d55a → 7f455ef → 00a0a05 → 3593148 → 84520db → 4e6d2ef
```

**All PRD issues are against the `main` branch state (`4e6d2ef`).** Implementation agents MUST work
against code that matches `main` at `4e6d2ef`. The bug report (`93be68d`) only added the PRD document;
it does not contain the resilience code or the regression.

### Key commits on main:
| Commit | Description | Relevance |
|--------|-------------|-----------|
| `d9a4d9a` | Issue-bounded re-planning loop (R2) | `ISSUE_RETRY_MAX`, tri-state routing |
| `182d8da` | Two-mode doc-sync rule (R3) | Prompt changes |
| `8b9bab3` | Doc-impact declarations in prompts (R3) | Prompt changes |
| `0a6d55a` | Git file-history and restore utilities (R4 S1) | `gitFileHistory`, `gitReadFileAtCommit` |
| `7f455ef` | `recoverTasksJson` (R4 S2) | Smart-recovery routine |
| `00a0a05` | Wire smart-recovery into orchestrator (R4 S3) | Per-agent-run wiring |
| `3593148` | README resilience blurb (Mode B doc) | `README.md` |
| `84520db` | Architecture doc reconciliation (Mode B doc) | `docs/ARCHITECTURE.md` |
| `4e6d2ef` | Task CLI + delta mode + **regression** | `src/utils/logger.ts:448` |

## Project Overview

**hacky-hack** is an Autonomous PRP Development Pipeline — an agentic software development system
that reads a PRD, generates a task hierarchy, researches context, and executes tasks via AI agents.

### Tech Stack
- **Language**: TypeScript (ESM, Node >= 20)
- **Build**: `tsc` with `tsconfig.build.json`
- **Test**: Vitest (`vitest.config.ts`) — 100% coverage thresholds enforced
- **Lint**: ESLint (`eslint . --ext .ts`)
- **Format**: Prettier
- **Logging**: pino (with pino-pretty for dev)
- **Git**: simple-git
- **CLI**: commander

### Key Directories (on `main` at `4e6d2ef`)
```
src/
  config/        # constants.ts (RESEARCH_TIMEOUT, ISSUE_RETRY_MAX), environment.ts, types.ts
  core/          # task-orchestrator.ts, research-queue.ts, session-manager.ts, models.ts,
                 # tasks-json-recovery.ts (R4), scope-resolver.ts, etc.
  agents/        # prp-executor.ts (ExecutionResult), prp-generator.ts, prp-runtime.ts,
                 # agent-factory.ts, prompts/
  utils/         # logger.ts (getLogger — REGRESSION HERE), git-commit.ts (smartCommit),
                 # progress-display.ts (ProgressDisplay — calls getLogger in constructor)
  tools/         # git-mcp.ts (gitFileHistory, gitReadFileAtCommit — R4 primitives)
  cli/           # CLI entry (commander)
  index.ts       # Main entry — process.setMaxListeners(20) at module load
tests/
  setup.ts       # Global vitest setup (provider endpoint validation)
  unit/          # Unit tests (mocked)
    logger.test.ts           # Logger tests (REGRESSION TEST GOES HERE)
    core/                    # task-orchestrator, research-queue, tasks-json-recovery tests
    utils/                   # progress-display.test.ts (14 FAILING TESTS)
    config/                  # research-timeout, issue-retry-max tests
  integration/   # Integration tests (real filesystem + partial mocks)
    core/                    # task-orchestrator-e2e, research-queue, session-manager, etc.
```

## The Three Issues

### Issue 1 (Major): `process.setMaxListeners(30)` regression
- **File**: `src/utils/logger.ts` line 448 (inside `getLogger`)
- **Code**: `process.setMaxListeners(30);` — no null-guard
- **Root cause**: `setMaxListeners` is inherited from `EventEmitter.prototype`, not an own property
  of `process`. Tests that stub `process` via `vi.stubGlobal('process', { ...originalProcess, ... })`
  lose the inherited method because object spread only copies enumerable own properties.
- **Fix**: `process.setMaxListeners?.(30);` (optional chaining — one character change)
- **Affected tests**: 14 of 44 in `tests/unit/utils/progress-display.test.ts`
- **Note**: There is ALSO a `process.setMaxListeners(20)` in `src/index.ts:47` — this does NOT cause
  the same issue because unit tests import modules directly (logger.ts, progress-display.ts) without
  going through the `src/index.ts` entry point.

### Issue 2 (Minor): `validate` script missing `test:run`
- **File**: `package.json` — `"validate": "npm run lint && npm run format:check && npm run typecheck"`
- **Fix**: Add `&& npm run test:run` to make the gate self-contained
- **Related docs**: `docs/TESTING.md` documents the test strategy; should note that `validate`
  now includes test execution. `README.md` line 631 lists `npm run validate` as "Run all validation
  checks".

### Issue 3 (Minor): No integration tests for R1–R4
- **Gap**: All R1–R4 coverage is unit-level with heavy mocking
- **Fix**: Add 2–3 integration tests under `tests/integration/core/`
- **Existing patterns**: `tests/integration/core/task-orchestrator-e2e.test.ts` and
  `tests/integration/core/research-queue.test.ts` provide excellent templates
