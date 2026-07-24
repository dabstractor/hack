# Phase-by-Phase Architecture Findings

## PHASE 1 — Distributed PRD Resolution & Selective Section Extraction

### Current State
- `hashPRD(prdPath)` at `session-utils.ts:235-261` reads the RAW file and SHA-256 hashes it.
- `initialize()` at `session-manager.ts:294` calls `hashPRD`, then at line 460 does a separate `readFile(prdPath)` for the snapshot — these can diverge.
- `createDeltaSession()` at `session-manager.ts:620-670` hashes + reads RAW.
- Static `findSessionByHash` at `session-manager.ts:1383` hashes RAW.
- `prd_index.txt` files exist in `plan/*/*/` but are written by the Architect AGENT (during decomposition git commits), NOT by TS code.
- `parsePRDSections()` at `prd-differ.ts:179` is a section parser but diff-oriented.

### Insertion Points for Include-Expansion Resolver
1. **Primary:** New `resolvePRD(prdPath, opts?): Promise<string>` in `src/core/session-utils.ts`. Thread the resolved string through hash + snapshot + diff + prompt injection.
2. **hashPRD** (session-utils.ts:235): Resolve, then hash resolved string. OR: add `hashPRDContent(resolved: string)` and have callers resolve once.
3. **initialize()** (session-manager.ts:460,473,493): Replace raw `readFile` with resolved content for snapshot.
4. **createDeltaSession()** (session-manager.ts:624,630,634): Resolve newPRD before hash + diff.
5. **findSessionByHash** (session-manager.ts:1383): Route through resolver.
6. **handleDelta()** (prp-pipeline.ts:638,645): Both old + new must be resolved.

### Section Index / prd_selectors
- `Subtask` interface (`models.ts:273`) needs `prd_selectors: string[]` field added.
- `SubtaskSchema` (`models.ts:360`) needs corresponding Zod array.
- Section index must run over the RESOLVED document (materialized copy).
- Extraction at PRP-generation time: `createPRPBlueprintPrompt` (prp-blueprint-prompt.ts:288) currently receives NO PRD content — must inject selected sections.
- Fallback: full PRD when selectors absent/extraction fails.
- Reuse `parsePRDSections()` (prd-differ.ts:179) as a base for selector extraction.

---

## PHASE 2 — Model Roles, Reasoning Budget & Provider-Neutral Config

### Current State
```ts
// constants.ts:43-55
MODEL_NAMES = { opus: 'glm-5.2', sonnet: 'glm-5.2', haiku: 'glm-5-turbo' }
MODEL_ENV_VARS = { opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL', sonnet: '...', haiku: '...' }

// types.ts:24
type ModelTier = 'opus' | 'sonnet' | 'haiku'

// environment.ts
getModel(tier) = qualifyModel(process.env[MODEL_ENV_VARS[tier]] ?? MODEL_NAMES[tier])

// agent-factory.ts:171-323
createBaseConfig(persona) → all use getModel('sonnet')
createCoderAgent() → overrides to getModel('haiku')
```

### Required Changes
1. **Tier rename:** `opus`→`high`, `sonnet`→`balanced`, `haiku`→`fast` in `MODEL_NAMES`, `MODEL_ENV_VARS`, `ModelTier`, `getModel()`.
2. **Canonical env vars:** `PRP_MODEL_HIGH`, `PRP_MODEL_BALANCED`, `PRP_MODEL_FAST`, `PRP_API_BASE_URL`.
3. **Legacy fallback:** loader reads canonical-first, falls back to `ANTHROPIC_*` alias, emits one-time deprecation warning.
4. **Three roles:** Research (balanced), Reasoning (balanced @ xhigh), Implementation (fast).
5. **xhigh reasoning:** Wire `--thinking xhigh` into agent configs for architect/bug-finder/validation.

### Agent Persona → Role Mapping
| Persona | Current tier | New role | Model | Budget |
|---------|-------------|-----------|-------|--------|
| architect | sonnet | Reasoning | balanced | xhigh |
| researcher | sonnet | Research | balanced | normal |
| coder | haiku | Implementation | fast | normal |
| qa (bug-hunt) | sonnet | Reasoning | balanced | xhigh |
| (new) validation | — | Reasoning | balanced | xhigh |

---

## PHASE 3 — Execution-Loop Resilience & State Integrity

### ResearchQueue (research-queue.ts)
- Current: flat `maxSize=3` simultaneous generations. `enqueue()` → `processNext()` shifts items if `researching.size < maxSize`.
- Required: depth-chained supervisor — prefetch chain of `RESEARCH_DEPTH` (default 2) items ahead.
- `RESEARCH_TIMEOUT` default at `constants.ts:198` = 300s → must change to 1800s.

### smartCommit (git-commit.ts:131)
- Current: single-phase. `gitAdd(modified+untracked)` → `gitCommit(message)` with pre-formatted `[PRP Auto]` prefix.
- `PROTECTED_FILES` includes `PRD.md`, `prd_snapshot.md`, `delta_prd.md`, `TEST_RESULTS.md` — but NOT `PRP.md` or `plan/` dirs.
- Required: `stagecoach` LLM commit-message generation, bounded retry, fallback, two call sites (pre/post cleanup).

### tasks.json Concurrency
- `writeTasksJSON` (session-utils.ts:404) → `atomicWrite` (temp+rename). No lock.
- `SessionManager.flushUpdates()` (session-manager.ts:754) batches then writes.
- `ConcurrentTaskExecutor.executeParallel` → concurrent `executeSubtask` → concurrent `flushUpdates`.
- Required: `flock`-based process-level mutex on tasks.json RMW.

### Recovery (tasks-json-recovery.ts)
- PATH A (clean disk), PATH B (corrupt → git history walk), PATH C (total failure).
- Preserves `Researching`/`Retrying` by only mutating target item. Comment says "There is NO Ready status" but the TYPE includes it.
- Required: snapshot live `Researching`/`Ready` IDs before revert, re-apply gated on FS evidence (PRP.md exists → Ready; research/ exists → Researching).

### Retry (retry.ts)
- `retry<T>(fn, opts)` — generic exponential backoff. `isTransientError()` decides retryability.
- `withAgentDeadline(promise)` — races against `RESEARCH_TIMEOUT`.
- No exit-code-based logic. No stdin variant.
- Required: treat exit 124 (watchdog kill) as PERMANENT (not transient). Distinct from LLM-generation timeout (should be retried).

### Execution Loop (task-orchestrator.ts)
- `executeSubtask`: setStatus → waitForPRP → issue-replan loop → flushUpdates → single smartCommit.
- `#recoverAfterAgentRun`: calls `recoverTasksJson` after EVERY run.
- Required: two-phase commit (pre-cleanup survival commit + post-cleanup commit), orphaned-plan/ recovery.

---

## PHASE 4 — Delta Workflow & QA Hardening

### Current Delta Flow
- `handleDelta()` (prp-pipeline.ts:627) → `DeltaAnalysisWorkflow` → structured JSON `DeltaAnalysis`.
- `DELTA_PRD_PROMPT` (prompts.ts:710) is DEAD CODE — `delta_prd.md` is NOT generated by any workflow.
- `hasSignificantChanges()` is exported but never called.
- `patchBacklog()` `added` case is unimplemented (TODO).

### Current Bug Hunt Flow
- `BugHuntWorkflow` (bug-hunt-workflow.ts) → `generateReport()` → QA agent → `bug_hunt_results.json` → writes `TEST_RESULTS.md` (JSON content, misleading name) on critical/major bugs.
- Bugfix sub-pipeline: `FixCycleWorkflow` (fix-cycle-workflow.ts) → `createFixTasks` (bugs→PFIX subtasks) → `executeFixes` → `retest` → `checkComplete` (max 3 iterations).

### Required Changes
- LLM COSMETIC/SUBSTANTIVE + CLEAN/DIRTY classifiers with transient-API retry + protective default.
- Response selection: `--accept-prd-changes`, integrate-into-current, validate/bug-hunt reuse.
- Breakdown input bound to `delta_prd.md` after generation.
- `VALIDATION_AGENT` (default `pizr`) + `VALIDATION_TIMEOUT` (default 7200s) + abort-on-failure.
- `BUG_FINDER_AGENT` default `glp` → `pizr`.
- `NO_ISSUES_FOUND.md` marker on clean hunt.
- Standard full breakdown for bugfix + resume interrupted breakdowns.

---

## PHASE 5 — Adopt Mode

### Current State
- No adopt code exists in `src/` — completely greenfield.
- CLI at `cli/index.ts` has 5 subcommands + default pipeline execution.
- `PRPPipeline` constructor takes 23 positional args.
- `SessionManager.initialize()` creates session dir, hashes PRD, writes snapshot.

### Required Changes
- New `--adopt-prd` CLI flag.
- Guard rails: require PRD exists, no-op if sessions exist, reject empty SESSION_DIR, mkdir -p PLAN_DIR first.
- Seed completed baseline tasks.json (one Phase → Milestone → Task → Subtask, all Complete).
- `.adopted` marker file.
- `SKIP_EXECUTION_LOOP=true` — skip implementation but run validation + bug hunt.