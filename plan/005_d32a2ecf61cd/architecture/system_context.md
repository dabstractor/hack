# System Context — Session 005 (Pipeline Resilience & Self-Healing)

## Project Facts

- **Project:** `hacky-hack` — the Autonomous PRP Development Pipeline itself (self-hosted).
- **Stack:** Node.js 20+ / TypeScript 5.2+ / ESM (`.js` import extensions in TS source).
- **Framework:** Groundswell (local, yalc-linked at `file:.yalc/groundswell`). **Read-only** — never edit `~/projects/groundswell/src`.
- **Test runner:** Vitest. Env var stubs via `vi.stubEnv` / `vi.unstubAllEnvs()`. Setup at `tests/setup.ts` (auto-loads `.env`).
- **Validation gate:** `npm run validate` = `eslint . --ext .ts` + `prettier --check` + `tsc --noEmit`.
- **Test gate:** `npm run test:run` (vitest run).
- **Doc lint gate:** `npm run docs:lint` (markdownlint on `docs/**/*.md`).

## Session Model

This is a **Delta Session** (`plan/005_d32a2ecf61cd/`), linked to session 004 via
`delta_from.txt` (contains `4`). The driver is `delta_prd.md` — a **purely additive**
diff of session 004's `prd_snapshot.md` → current `PRD.md` (37 lines added, 0 removed).

## Prior Sessions (completed work — DO NOT re-implement)

| Session | Scope | Status |
|---------|-------|--------|
| 001 | Session/task/delta/bug-hunt/fix-cycle logic, protected-file rules, nested-exec guard, MCP tools | Complete |
| 002 | Bug fix / harness parity verification | Complete |
| 003 | System validation & verification of phases 1–3 | Complete |
| 004 | **Agent Harness System** (Phase P1): `PRP_AGENT_HARNESS`, `configureHarness()`, `qualifyModel()`/`getModel()`, `HarnessProviderMismatchError`, parity tests, `docs/{CONFIGURATION,GROUNDSWELL_GUIDE}.md` harness sections | Complete |

**Session 004's harness/provider/parity code is STABLE and untouched by this delta.**
New env vars (`RESEARCH_TIMEOUT`, `ISSUE_RETRY_MAX`) must follow the **same config pattern**
Session 004 established (see `implementation_notes.md` §1).

## Key Source Files (the ONLY targets this session)

| File | Role | Touched by |
|------|------|------------|
| `src/config/constants.ts` | env-var name + default constants | R1, R2 |
| `src/core/research-queue.ts` | `ResearchQueue` — background PRP generation queue | R1 |
| `src/core/task-orchestrator.ts` | `TaskOrchestrator` — DFS execution loop; agent runs happen in `executeSubtask` | R1, R2, R4 |
| `src/agents/prp-executor.ts` | `PRPExecutor` — runs coder agent + validation gates; reports `ExecutionResult` | R2 |
| `src/agents/prp-runtime.ts` | `PRPRuntime` — wraps executor; `executeSubtask()` returns `ExecutionResult` | R2 |
| `src/agents/prp-generator.ts` | `PRPGenerator` — builds PRP via Researcher agent | R2 |
| `src/agents/prompts/prp-blueprint-prompt.ts` | `createPRPBlueprintPrompt(task, backlog, codebasePath?)` | R2 (feedback injection), R3 |
| `src/agents/prompts.ts` | `PRP_BLUEPRINT_PROMPT`, `TASK_BREAKDOWN_PROMPT`, `DELTA_PRD_PROMPT` constant HEREDOCs | R3 |
| `src/core/task-retry-manager.ts` | `TaskRetryManager` — transient-error retries (NOT re-planning) | R2 (awareness only) |
| `src/core/state-validator.ts` | validation/repair of `tasks.json`; `createBackup()` | R4 |
| `src/utils/git-commit.ts` | `smartCommit`, `filterProtectedFiles` | R4 (consumer) |
| `src/tools/git-mcp.ts` | `gitStatus`/`gitDiff`/`gitAdd`/`gitCommit` — **NO log/show/restore** | R4 (new functions) |
| `src/core/session-utils.ts` | `readTasksJSON`, `writeTasksJSON`, `atomicWrite` | R4 |

## Status Enum (ground truth — `src/core/models.ts`)

```ts
export type Status = 'Planned' | 'Researching' | 'Implementing' | 'Retrying'
  | 'Complete' | 'Failed' | 'Obsolete';
```

> ⚠️ **There is NO `Ready` status.** The PRD §5.1 text says "items marked `Researching`
> or `Ready`" but the enum has no `Ready`. The research queue tracks readiness via its
> internal `results` Map (PRP artifact present = ready), NOT via a status value. The smart
> recovery must preserve items in `Researching` (and `Retrying`) status across a git restore
> — these must not be dropped back to `Planned`.

## Config Pattern (how Session 004 added `PRP_AGENT_HARNESS`)

1. Declare the env-var **name** as a plain `const` string in `src/config/constants.ts`
   (e.g. `export const PRP_AGENT_HARNESS = 'PRP_AGENT_HARNESS';`).
2. Declare a **default value** `const` alongside it
   (e.g. `export const DEFAULT_HARNESS = 'pi' as const;`).
3. Read it at the **consuming module** via `process.env[NAME] ?? DEFAULT`.

> ⚠️ **There is NO `ConfigService` class** anywhere in the codebase. `src/config/environment.ts`
> is a set of **standalone functions** (`configureEnvironment`, `validateEnvironment`,
> `getModel`, `qualifyModel`) that only normalize `ANTHROPIC_AUTH_TOKEN → ANTHROPIC_API_KEY`
> and set a default `ANTHROPIC_BASE_URL`. Do NOT extend a non-existent central registry.
> New env vars follow constants-declare + consumer-read, exactly like `PRP_AGENT_HARNESS`
> (whose only consumer is `src/config/harness.ts` line ~58).
