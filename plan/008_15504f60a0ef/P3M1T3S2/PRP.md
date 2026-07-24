# PRP — P3.M1.T3.S2: Pre-cleanup survival commit and post-cleanup commit in executeSubtask

---

## Goal

**Feature Goal**: Implement the **two-phase commit stagecoach pattern** mandated
by PRD §4.2 step 4 inside `executeSubtask`. Replace the current single
`smartCommit` call (task-orchestrator.ts:1004) with a three-stage sequence on
the success path: **(a) pre-cleanup survival commit** of the item's substance
(source changes + its `plan/` work directory + its `Complete` status) via the
stagecoach `smartCommit`; **(b) cleanup** — invoke the cleanup agent through a
new injectable seam; **(c) post-cleanup commit** of the cleanup agent's
documentation reorganization in a second stagecoach `smartCommit`. The
pre-cleanup commit is the **survival commit**: because the cleanup agent is
forbidden from touching `plan/` (PRD §5.1), committing the substance *before*
the long/interruptible cleanup runs guarantees a force-interrupt during cleanup
can no longer strand an item "Complete on disk but uncommitted" — the orphaning
state that strands `plan/` directories forever.

**Deliverable** (1 new seam module + 1 modified orchestrator + 1 new seam unit-test file + patch to existing orchestrator tests):
1. **`src/core/cleanup-runner.ts`** — CREATE: the cleanup-agent invocation
   **seam**. Exports `CleanupContext`, `CleanupResult`, `CleanupRunner`
   (callable type), and `createCleanupRunner(): CleanupRunner` whose DEFAULT
   implementation is a **no-op** returning `{ success: true, summary:
   'cleanup disabled (no persona wired yet)' }`. This decouples S2 from S3
   (the cleanup agent persona in P3.M1.T3.S3, still Planned). S3 will later
   replace the default runner with one that invokes the real persona.
2. **`src/core/task-orchestrator.ts`** — MODIFY: (a) constructor gains an
   optional options bag `TaskOrchestratorOptions?: { cleanupRunner?:
   CleanupRunner }` stored on `#cleanupRunner` (default
   `createCleanupRunner()` — backward compatible; existing single-arg callers
   unchanged). (b) On the `if (succeeded)` success path (lines ~995-1031),
   replace the single `smartCommit` call with the three-stage two-phase
   sequence: flushUpdates → **pre-cleanup survival commit** (stagecoach
   `generateMessage:true`) → best-effort `#cleanupRunner(ctx)` → flushUpdates
   → **post-cleanup commit** (stagecoach `generateMessage:true`, only when
   cleanup succeeded). Cleanup failure is LOGGED and SWALLOWED — the subtask
   still succeeds (the survival commit already persisted substance + status).
3. **`tests/unit/core/cleanup-runner.test.ts`** — CREATE: unit tests for the
   seam — default `createCleanupRunner()` returns `{ success: true, ... }`
   without touching the filesystem; a custom `CleanupRunner` (injected via
   constructor) is invoked with the correct `CleanupContext`
   (`sessionPath`, `subtask`, `repoRoot`).
4. **`tests/unit/core/task-orchestrator.test.ts`** — MODIFY: (a) update the
   existing "smartCommit integration" block (line 834) to the new 3-arg
   `generateMessage:true` call shape and assert smartCommit is now called
   **twice** on success; (b) add a new describe block covering the two-phase
   path — cleanup runner invoked with correct context, post-cleanup commit
   skipped when cleanup fails, **subtask still succeeds** when cleanup throws.

**Scope note (critical):** This task is **ONLY the two-phase commit wiring in
`executeSubtask` + the cleanup invocation seam**. It does NOT create the
cleanup agent persona (P3.M1.T3.S3), the retry/backoff around stagecoach
generation (P3.M1.T4.S1), the fallback placeholder commit (P3.M1.T4.S2), the
orphaned-`plan/` skip-recovery (P3.M2.T5.S1), or critical-file deletion
protection (P3.M2.T4.S2). It CONSUMES S1's `smartCommit(..., { generateMessage:
true })` capability (treat S1's PRP as a contract) and PROVIDES the seam that
S3 fills. The `Failed` path (no commit) and the outer error catch are
unchanged.

**Success Definition**:
- On a successful subtask, `executeSubtask` performs exactly **two**
  `smartCommit` calls, both with `{ generateMessage: true }`: (1) the survival
  commit of substance + `plan/` + Complete status, **before** cleanup; (2) the
  post-cleanup commit of the cleanup agent's reorganization.
- The cleanup callable is invoked **exactly once**, between the two commits,
  with a `CleanupContext` carrying the correct `sessionPath`, `subtask`, and
  `repoRoot` (`process.cwd()`).
- If the cleanup callable **throws** or returns `{ success: false }`:
  `executeSubtask` logs a warning, the post-cleanup commit is **skipped**, and
  the subtask **still succeeds** (the survival commit already persisted the
  substance + `Complete` status — the orphaning state is already closed). No
  `TaskError` is thrown for cleanup failure.
- `smartCommit` returning `null` (nothing staged) at either phase is logged at
  `info` and does NOT abort the flow (matches today's "No files to commit"
  behavior) — the survival commit's `null` is acceptable because the cleanup
  may be the only change, and the post-cleanup commit's `null` is acceptable
  when cleanup changed nothing.
- Backward compatibility: `new TaskOrchestrator(sessionManager)` (no options)
  uses the default no-op cleanup runner and behaves as today EXCEPT it now
  makes the two stagecoach calls on success (the substantive change). Existing
  callers that don't pass `cleanupRunner` are not broken.
- `npm run validate` GREEN; `package.json` `dependencies` unchanged.

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline (no human in the loop). Immediate
consumer of the seam: P3.M1.T3.S3 (cleanup agent persona) wires its persona
into `createCleanupRunner` / the constructor option. Downstream consumers:
P3.M2.T5.S1 (orphaned-`plan/` skip-recovery) relies on the survival commit
having run so a force-interrupt during cleanup cannot orphan work.
**Use Case**: After a subtask passes validation, its deliverables + its
`plan/{seq}_{hash}/` work directory + its `Complete` status must be committed
*before* the long-running, interruptible cleanup agent reorganizes docs
(`plan/.../research/*` → `docs/`, removes temp artifacts). The cleanup's doc
moves then get their own commit.
**User Journey**: orchestrator success path → `flushUpdates` →
`smartCommit(path, fallback, {generateMessage:true})` (survival) →
`#cleanupRunner({sessionPath, subtask, repoRoot})` → `flushUpdates` →
`smartCommit(path, cleanupFallback, {generateMessage:true})` (post-cleanup).
**Pain Points Addressed**: PRD §5.1 "Orphaned-plan/ Recovery" — today a single
post-work `smartCommit` means an interrupt between completion and commit strands
the `plan/` directory and the `Complete` status forever. The survival commit
closes the window *before* the most-interruptible step (cleanup) begins.

---

## Why

- **PRD compliance**: PRD §4.2 (h3.4) step 4 explicitly mandates the two-phase
  stagecoach pattern ("Pre-cleanup commit (survival)" + "Post-cleanup commit"),
  and §5.1 (h3.9) "Orphaned-plan/ Recovery" names the pre-cleanup commit as one
  of two guards closing the orphaning window. `architecture/phase_findings.md`
  §PHASE 3 documents the current state: "executeSubtask … does ONE smartCommit
  after flushUpdates. No pre-cleanup survival commit, no cleanup-agent
  invocation, no post-cleanup commit." This task implements exactly that.
- **Contract item 3 (LOGIC) full coverage**:
  - (a) *"PRE-CLEANUP COMMIT: commit the item's substance — source changes, its
    plan/ work directory, and its Complete status — via stagecoach smartCommit.
    This is the survival commit."* → first `smartCommit(..., { generateMessage:
    true })` after `flushUpdates`, before cleanup.
  - (b) *"CLEANUP: invoke the cleanup agent (from P3.M1.T3.S3) to remove
    temporary artifacts, move docs to docs/, save tasks.json."* →
    `#cleanupRunner(ctx)` seam; S3 supplies the persona. `flushUpdates` after
    cleanup persists any `tasks.json` the cleanup wrote.
  - (c) *"POST-CLEANUP COMMIT: commit the cleanup agent's doc reorganization in
    a second stagecoach smartCommit call."* → second `smartCommit(..., {
    generateMessage: true })`.
- **Decoupling from S3**: S3 (cleanup persona) is Planned, not implemented. A
  direct `import { createCleanupAgent }` would break the build. The injectable
  `CleanupRunner` seam (DI-light) lets S2 ship + test now and lets S3 fill the
  seam later without touching `executeSubtask` again. This mirrors the
  established DI-light pattern (constructor option bag) and keeps the cleanup
  step **mockable** in unit tests.
- **Resilience invariant**: the survival commit MUST run *before* cleanup so an
  interrupt during cleanup can never reach the orphaning state. Cleanup failure
  MUST NOT fail the subtask — the substance is already safe.

---

## What

One new seam module, one modified orchestrator (constructor option + success-path
rewrite), one new seam unit-test file, a patch to existing orchestrator tests.

### Success Criteria

- [ ] **Two-phase commit on success**: a successful `executeSubtask` makes
      exactly two `smartCommit` calls, both with `{ generateMessage: true }`:
      the survival commit then the post-cleanup commit. Verified by
      `expect(mockSmartCommit).toHaveBeenCalledTimes(2)` and
      `expect.objectContaining({ generateMessage: true })` on each call.
- [ ] **Survival commit ordering**: the first `smartCommit` happens AFTER
      `flushUpdates` and BEFORE `#cleanupRunner`. Verified by a test using
      `vi.fn` call-order spies (`mockResolvedValue` chain or `expect.mock.calls`
      index assertions).
- [ ] **Cleanup seam invoked once with correct context**:
      `#cleanupRunner` is called exactly once with `CleanupContext = {
      sessionPath: <currentSession.metadata.path>, subtask, repoRoot:
      process.cwd() }`. Verified by a test injecting a spy cleanup runner.
- [ ] **Cleanup failure is non-fatal**: when the injected cleanup runner
      **throws**, `executeSubtask` logs a warning, makes the post-cleanup
      commit zero times (or one — see Implementation Note), and the subtask
      resolves (no throw, no `TaskError`). Same when it returns
      `{ success: false }`. Verified by `expect(result).resolves.toBeUndefined()`.
- [ ] **`smartCommit` null tolerated**: when either commit returns `null`,
      execution continues and is logged at `info` ("No files to commit" /
      "No cleanup changes to commit"). Verified by a test.
- [ ] **Backward compatibility**: `new TaskOrchestrator(sessionManager)` (no
      options) constructs without error and uses the default no-op
      `createCleanupRunner()`. Verified by existing constructor tests staying
      green.
- [ ] **No persona import**: `task-orchestrator.ts` imports `CleanupRunner` /
      `createCleanupRunner` from `./cleanup-runner.js` — it does NOT import any
      cleanup agent persona (none exists yet).
- [ ] **Failed path unchanged**: when `succeeded === false`, NO commit and NO
      cleanup occur (the existing `else` branch logs the skip). Verified by a
      test.
- [ ] `npm run validate` GREEN; `package.json` `dependencies` byte-identical.

**Implementation Note (post-cleanup commit on cleanup failure):** when the
cleanup runner fails, the post-cleanup commit is **skipped** (nothing was
reorganized). When cleanup succeeds but `smartCommit` returns `null` (cleanup
changed nothing committable), that is logged at `info` and is fine.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — YES. This PRP names the exact success-
path lines to rewrite (995-1031), the exact constructor signature to extend,
the exact seam module to create, the exact mock structure for the existing test
block, and the exact reasons naive approaches fail (importing a non-existent
persona / failing the subtask on cleanup error / single commit after cleanup).

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- url: https://www.conventionalcommits.org/en/v1.0.0/
  why: The stagecoach fallback messages ("${id}: ${title}" for substance,
       "cleanup: doc reorganization" for the second phase) are conventional-
       commit-shaped subjects the stagecoach agent (S1) may keep or reword
       from the staged diff. Keep subjects imperative, ≤72 chars.
  critical: S1's stagecoach agent reads the STAGED DIFF and emits the final
            message, wrapping it via formatCommitMessage. The fallback string
            here is ONLY used if generation fails (S1 swallows that). Do NOT
            double-format or pre-wrap.

- file: src/core/task-orchestrator.ts
  why: THE PRIMARY EDIT. executeSubtask success block (lines 995-1031). Today:
       flushUpdates → if(succeeded) single smartCommit(sessionPath, `${id}:
       ${title}`). Replace the single-call body with: (1) survival commit
       smartCommit(sessionPath, `${subtask.id}: ${subtask.title}`,
       {generateMessage:true}); (2) await #cleanupRunner({sessionPath,
       subtask, repoRoot: process.cwd()}) wrapped in try/catch → CleanupResult;
       (3) flushUpdates() again (cleanup may have written tasks.json); (4) if
       cleanup succeeded, post-cleanup smartCommit(sessionPath, 'cleanup: doc
       reorganization', {generateMessage:true}).
  pattern: READ the full success block (995-1054) + the Failed else branch
           (1039-1054) + the outer catch (1057-1077) BEFORE editing. The
           outer try/catch already swallows+logs commit errors (1019-1030) —
           PRESERVE that shape for BOTH new commits. Cleanup errors need their
           OWN try/catch (the outer catch rethrows → would fail the subtask,
           which violates the non-fatal-cleanup invariant).
  gotcha: (1) process.cwd() is the repo root — capture it ONCE into a const
          (the existing code already resolves sessionPath via
          currentSession.metadata.path; repoRoot = process.cwd() per
          git-commit.ts:159 comment). (2) `this.#cleanupRunner` must be set in
          the constructor BEFORE executeSubtask can run. (3) Do NOT move the
          Failed-path else branch or the halt-on-failure throw (1048-1054) —
          those stay exactly as-is.

- file: src/core/task-orchestrator.ts   # constructor region
  why: EXTEND the constructor. It currently takes only (sessionManager). Add
       an optional 2nd param: `options?: TaskOrchestratorOptions` where
       TaskOrchestratorOptions = { cleanupRunner?: CleanupRunner }. Store
       this.#cleanupRunner = options?.cleanupRunner ?? createCleanupRunner().
       Add the import at top: `import { createCleanupRunner, type CleanupRunner,
       type CleanupContext, type CleanupResult } from './cleanup-runner.js';`
  pattern: READ the constructor (search "constructor") + the private-field
           declarations (the `#logger`, `#executionQueue`, `#issueAttempts`
           block). Add `#cleanupRunner: CleanupRunner;` alongside them.
  gotcha: Some call sites may use `new TaskOrchestrator(manager, scope)` today
          — GREP for `new TaskOrchestrator(` across src/ FIRST. If a 2nd
          positional arg is already Scope, the new arg goes in a NEW options
          object as the LAST param (backward compatible because positional
          args before it are unchanged). Do not break existing call sites.

- file: src/core/cleanup-runner.ts   # NEW
  why: THE SEAM MODULE. Exports:
       - interface CleanupContext { sessionPath: string; subtask: Subtask;
         repoRoot: string; }   (import Subtask type from './models.js')
       - interface CleanupResult { success: boolean; summary?: string;
         error?: string; }
       - type CleanupRunner = (ctx: CleanupContext) => Promise<CleanupResult>;
       - function createCleanupRunner(): CleanupRunner — returns a no-op:
         `async (ctx) => ({ success: true, summary: 'cleanup disabled (no
         persona wired yet)' })`. Add a JSDoc explaining this is the DEFAULT
         and P3.M1.T3.S3 replaces it with the real persona invocation.
  pattern: small typed module — no agent imports, no git imports, no side
           effects. Pure types + a default factory.
  gotcha: Subtask is imported as a TYPE only (`import type { Subtask } from
          './models.js'`) to avoid a runtime cycle (models.ts is heavy).

- file: plan/008_15504f60a0ef/P3M1T3S1/PRP.md
  why: THE CONTRACT for smartCommit's new signature. S1 defines
       `smartCommit(sessionPath: string, message: string, options?:
       SmartCommitOptions): Promise<string | null>` where SmartCommitOptions =
       { generateMessage?: boolean }. When generateMessage:true, after gitAdd
       it reads the staged diff, generates a message via the LLM, wraps via
       formatCommitMessage, commits, returns the hash (or null on failure /
       nothing-staged). It NEVER throws.
  pattern: treat this EXACTLY as the calling convention. Both commits pass
           { generateMessage: true }. The 2nd positional arg is the FALLBACK
           message used only if generation fails.
  gotcha: S1 is being implemented in parallel — assume its PRP lands as
          written. Do NOT add retry/backoff around smartCommit (that's
          P3.M1.T4.S1). smartCommit's own try/catch already returns null on
          failure, so no extra error handling is needed at the call sites
          beyond the existing info-log.

- file: tests/unit/core/task-orchestrator.test.ts
  why: THE existing test file to PATCH. The "smartCommit integration" block
       (line 834) asserts smartCommit called with `(path, 'P1.M1.T1.S1: Test
       Subtask')` (2 args). UPDATE to the 3-arg form and assert TWO calls.
       The smartCommit mock at line 55 (`smartCommit: vi.fn()`) is reused.
       ADD: a way to inject a spy cleanup runner — either via the constructor
       options bag, or by mocking the cleanup-runner module
       (`vi.mock('../../../src/core/cleanup-runner.js', ...)`).
  pattern: READ lines 53-130 (mock setup) + 834-924 (smartCommit block). The
           existing tests construct the orchestrator via
           `new TaskOrchestrator(mockManager)` — to inject a cleanup spy, pass
           `new TaskOrchestrator(mockManager, { cleanupRunner: spyRunner })`.
  gotcha: the existing block has MULTIPLE tests (success, hash logged, null
          returned) — EACH needs the 2-call + generateMessage assertion update,
          not just the first. Add a SEPARATE describe block ("two-phase commit
          + cleanup seam") for the new behaviors so the legacy block stays
          focused on message/hash logging.

- file: tests/unit/core/cleanup-runner.test.ts   # NEW
  why: SEAM UNIT TESTS. (1) createCleanupRunner() returns a function; calling
       it resolves { success: true, summary: string }. (2) A custom
       CleanupRunner passed via constructor is invoked with a CleanupContext
       whose sessionPath/subtask match the current subtask and whose repoRoot
       === process.cwd(). (3) When the custom runner throws,
       executeSubtask still resolves (covered in task-orchestrator.test.ts;
       here just assert the seam types).
  pattern: mirror the file structure of other small unit tests in
           tests/unit/core/ (describe/it, vi.fn spies, no real fs).
  gotcha: do NOT spin up a real agent or real git here — the seam is pure.

- docfile: plan/008_15504f60a0ef/P3M1T3S2/research/two-phase-commit-design.md
  why: the exact phase ordering, failure-handling matrix, and DI rationale.
  section: "Design decisions" §1-4 + "Validation approach".
```

### Current Codebase tree (relevant slice)

```bash
src/
  core/
    task-orchestrator.ts     # MODIFY — constructor option + success-path two-phase rewrite
    cleanup-runner.ts        # CREATE — CleanupContext/Result/Runner + no-op default
    session-manager.ts       # READ — flushUpdates() (line ~754); unchanged
    models.ts                # READ — Subtask type import (type-only)
  agents/
    prp-runtime.ts           # READ — executeSubtask delegates here; unchanged
  utils/
    git-commit.ts            # CONTRACT from S1 — smartCommit 3rd arg {generateMessage}
tests/
  unit/
    core/
      task-orchestrator.test.ts   # MODIFY — 2-call + generateMessage + cleanup-seam block
      cleanup-runner.test.ts      # CREATE — seam defaults + injection
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/core/cleanup-runner.ts
  # RESPONSIBILITY: cleanup-agent invocation SEAM. Pure types (CleanupContext,
  # CleanupResult, CleanupRunner) + createCleanupRunner() no-op default.
  # S3 (P3.M1.T3.S3) replaces the default with the real persona call.
src/core/task-orchestrator.ts
  # MODIFIED: constructor takes {cleanupRunner?} → stored as #cleanupRunner.
  # executeSubtask success path: flushUpdates → survival smartCommit(generate)
  # → best-effort #cleanupRunner → flushUpdates → post-cleanup smartCommit(generate).
tests/unit/core/cleanup-runner.test.ts
  # NEW: seam defaults + context-shape assertions.
tests/unit/core/task-orchestrator.test.ts
  # MODIFIED: legacy smartCommit block → 2-call generateMessage form;
  # NEW describe block: two-phase ordering, cleanup seam invoked once,
  # cleanup-throw-is-non-fatal, smartCommit-null tolerated, failed-path unchanged.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: task-orchestrator.ts constructor may already take a positional
// `scope` arg. GREP `new TaskOrchestrator(` in src/ BEFORE editing the
// signature. If so, the cleanupRunner goes in a trailing options OBJECT,
// never as a new positional arg (would shift scope). Backward compat =
// existing callers compile unchanged.

// CRITICAL: smartCommit (S1) NEVER throws — it returns null on any failure
// (git-commit.ts:131 outer try/catch). So the survival + post-cleanup calls
// need NO try/catch of their own beyond the existing info-log shape.
// The CLEANUP callable, by contrast, is UNTRUSTED (S3's persona) and MUST be
// wrapped in its own try/catch that logs + swallows — otherwise a throw
// propagates to the outer catch (1057) which sets Failed + rethrows,
// VIOLATING the "cleanup failure is non-fatal" invariant.

// CRITICAL: repoRoot for both commits is process.cwd() (git-commit.ts:159
// already overrides any sessionPath to process.cwd() internally, but the
// CleanupContext needs the literal repoRoot for S3's persona).

// GOTCHA: flushUpdates() must run TWICE — once before the survival commit
// (persists Complete status so it rides in the survival commit) and once
// AFTER cleanup (cleanup may write tasks.json; PRD §4.2 "State is saved:
// tasks.json updated"). The second flush ensures the post-cleanup commit
// captures the saved state if any.

// GOTCHA: the Failed path (`if (!succeeded)`) and its halt-on-failure throw
// (task-orchestrator.ts:1048-1054) MUST remain exactly as-is. Only the
// `if (succeeded)` BODY changes.
```

---

## Implementation Blueprint

### Data models and structure

The seam module carries the only new types:

```typescript
// src/core/cleanup-runner.ts
import type { Subtask } from './models.js';

/** Context handed to a cleanup runner (P3.M1.T3.S2 seam → P3.M1.T3.S3 persona). */
export interface CleanupContext {
  /** Absolute path to the session dir: plan/{seq}_{hash}/ (or bugfix child). */
  sessionPath: string;
  /** The subtask whose artifacts are being cleaned up. */
  subtask: Subtask;
  /** Git repo root = process.cwd(). Cleanup operates at repo root. */
  repoRoot: string;
}

/** Result of a cleanup run. success:false MUST be non-fatal to executeSubtask. */
export interface CleanupResult {
  success: boolean;
  summary?: string;
  error?: string;
}

/** Injectable cleanup callable. Default is a no-op; S3 supplies the real one. */
export type CleanupRunner = (ctx: CleanupContext) => Promise<CleanupResult>;

/**
 * DEFAULT cleanup runner: no-op. P3.M1.T3.S3 replaces this with a runner that
 * invokes the cleanup agent persona to remove temp artifacts, move docs to
 * docs/, and save tasks.json (PRD §4.2 step 4 "Cleanup"). Until S3 lands, the
 * two-phase commit still works — the survival commit persists substance, and
 * the post-cleanup commit simply finds nothing to commit (returns null).
 */
export function createCleanupRunner(): CleanupRunner {
  return async (_ctx: CleanupContext): Promise<CleanupResult> => ({
    success: true,
    summary: 'cleanup disabled (no persona wired yet)',
  });
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: GREP audit — confirm constructor signature + call sites
  - RUN: rg -n "new TaskOrchestrator\(" src/ tests/
  - RUN: rg -n "constructor" src/core/task-orchestrator.ts
  - DETERMINE: does the constructor already take a positional `scope`? If yes,
    the cleanupRunner goes in a trailing options object (backward compatible).
    If no, add options?: TaskOrchestratorOptions as the new 2nd/last param.
  - OUTPUT: a one-line note in your implementation summary of the chosen shape.
  - BLOCKING: Tasks 2-4 depend on this decision.

Task 2: CREATE src/core/cleanup-runner.ts
  - IMPLEMENT: CleanupContext, CleanupResult, CleanupRunner, createCleanupRunner()
    exactly per the Data models block above.
  - IMPORT: `import type { Subtask } from './models.js';` (TYPE ONLY — avoid cycle).
  - NAMING: CleanupContext / CleanupResult / CleanupRunner (PascalCase types),
    createCleanupRunner (camelCase factory).
  - PLACEMENT: src/core/ (sibling of task-orchestrator.ts — it is a core seam).
  - GOTCHA: no fs/git/agent imports — pure typed module.

Task 3: MODIFY src/core/task-orchestrator.ts — constructor + import
  - IMPORT: add `import { createCleanupRunner, type CleanupRunner } from
    './cleanup-runner.js';` (and `type CleanupContext`/`CleanupResult` if needed
    at the call site — they are, for the ctx literal typing).
  - ADD type: `interface TaskOrchestratorOptions { cleanupRunner?: CleanupRunner; }`
    (place near the top of the class or in a types region).
  - MODIFY constructor: accept the options bag per Task 1's decision; store
    `this.#cleanupRunner = options?.cleanupRunner ?? createCleanupRunner();`.
  - ADD private field: `#cleanupRunner: CleanupRunner;` alongside the other
    `#`-prefixed fields (#logger, #executionQueue, etc.).
  - PRESERVE: every existing constructor behavior + all existing call sites
    compile unchanged (default no-op runner).
  - FOLLOW pattern: the class already uses `#`-private fields + a single
    constructor param today; mirror that style for the options bag.

Task 4: MODIFY src/core/task-orchestrator.ts — executeSubtask success path
  - LOCATE: the `if (succeeded) {` block (task-orchestrator.ts:1001) inside
    executeSubtask, after `await this.sessionManager.flushUpdates();` (995).
  - REPLACE: the single `smartCommit(sessionPath, commitMessage)` call (1004)
    with the three-stage sequence:
      // survival commit (substance + plan/ + Complete status)
      const preHash = await smartCommit(sessionPath,
        `${subtask.id}: ${subtask.title}`, { generateMessage: true });
      if (preHash) this.#logger.info({ commitHash: preHash }, 'Survival commit created');
      else this.#logger.info('No substance to commit (survival commit empty)');
      // cleanup (best-effort, isolated — NEVER fatal)
      const repoRoot = process.cwd();
      let cleanupOk = false;
      try {
        const res = await this.#cleanupRunner({ sessionPath, subtask, repoRoot });
        cleanupOk = res.success;
        if (!res.success) this.#logger.warn({ error: res.error }, 'Cleanup runner reported failure');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.#logger.warn({ error: msg }, 'Cleanup runner threw — continuing (survival commit already safe)');
        cleanupOk = false;
      }
      // cleanup may have written tasks.json — persist before post-cleanup commit
      await this.sessionManager.flushUpdates();
      // post-cleanup commit (doc reorganization) — only when cleanup succeeded
      if (cleanupOk) {
        const postHash = await smartCommit(sessionPath,
          'cleanup: doc reorganization', { generateMessage: true });
        if (postHash) this.#logger.info({ commitHash: postHash }, 'Post-cleanup commit created');
        else this.#logger.info('No cleanup changes to commit');
      }
  - PRESERVE: the outer try/catch around the WHOLE block (1000-1030) — keep
    smartCommit-call logging inside it. The CLEANUP try/catch is NESTED and
    does NOT rethrow.
  - PRESERVE: the `else { ... 'Subtask failed — skipping commit' }` branch
    (1027-1030) and the halt-on-failure throw (1048-1054) — UNCHANGED.
  - NAMING: preHash / postHash locals; 'Survival commit created' / 'Post-cleanup
    commit created' log messages (distinguishable in telemetry).
  - DEPENDENCIES: Tasks 1-3 (constructor + import + seam module).

Task 5: CREATE tests/unit/core/cleanup-runner.test.ts
  - IMPLEMENT: (a) createCleanupRunner() returns a function; awaiting it with a
    minimal CleanupContext resolves { success: true } with a summary string.
    (b) assert it does NOT throw and performs no fs access.
  - FOLLOW pattern: tests/unit/core/*.test.ts structure (describe/it, vitest).
  - NAMING: describe('cleanup-runner seam').
  - PLACEMENT: tests/unit/core/.

Task 6: MODIFY tests/unit/core/task-orchestrator.test.ts
  - UPDATE the "smartCommit integration" block (line 834): each test now asserts
    smartCommit called TWICE on success, each call with
    expect.objectContaining({ generateMessage: true }). The first call's 2nd
    arg is `'P1.M1.T1.S1: Test Subtask'`; the second's is
    `'cleanup: doc reorganization'`. (Tests that check the FIRST call's hash
    logging keep working — update the call-count + options assertion.)
  - ADD describe('two-phase commit + cleanup seam') with tests:
    1. cleanup runner invoked once with { sessionPath: <path>, subtask, repoRoot:
       process.cwd() } — inject a spy runner via
       new TaskOrchestrator(mockManager, { cleanupRunner: spy }).
    2. when cleanup runner throws → executeSubtask resolves (no throw), post-
       cleanup commit NOT called (smartCommit called once, for survival), warn
       logged.
    3. when cleanup runner returns { success: false } → same as #2.
    4. when survival smartCommit returns null → flow continues, cleanup still
       runs, post-cleanup commit still attempted if cleanupOk.
    5. when post-cleanup smartCommit returns null → logged at info, subtask
       succeeds.
    6. FAILED path: succeeded=false → smartCommit called ZERO times, cleanup
       runner called ZERO times.
  - FOLLOW pattern: existing mock setup (lines 53-130) — reuse mockSmartCommit.
  - MOCK: cleanup runner via injected spy (constructor option), NOT module mock
    (keeps cleanup-runner.test.ts independent).
  - GOTCHA: ensure the default no-op runner path (no options passed) still
    makes 2 smartCommit calls (cleanupOk=true by default) — the legacy
    smartCommit block tests this.

Task 7: VALIDATE
  - RUN: npm run validate (or the project's lint+typecheck+test gate).
  - RUN: npx vitest run tests/unit/core/task-orchestrator.test.ts
         tests/unit/core/cleanup-runner.test.ts
  - EXPECT: GREEN. If red, READ the failure — most likely a missed call site
    (Task 1 grep missed a positional-arg caller) or an un-updated assertion in
    the legacy smartCommit block.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: the success-path three-stage sequence (Task 4)
// Lives INSIDE the existing `try { ... }` that wraps the commit block.
// smartCommit never throws (S1 contract) → no guard needed on the two calls.
// #cleanupRunner is UNTRUSTED → own try/catch, swallowed.

await this.sessionManager.flushUpdates();          // persists Complete status (existing line 995)
if (succeeded) {
  try {
    const sessionPath = this.sessionManager.currentSession?.metadata.path;
    if (!sessionPath) { this.#logger.warn('Session path not available for smart commit'); }
    else {
      // (a) SURVIVAL COMMIT — substance + plan/ + Complete status, stagecoach
      const preHash = await smartCommit(sessionPath,
        `${subtask.id}: ${subtask.title}`, { generateMessage: true });
      if (preHash) this.#logger.info({ commitHash: preHash }, 'Survival commit created');
      else this.#logger.info('No substance to commit (survival commit empty)');

      // (b) CLEANUP — best-effort, isolated, NEVER fatal
      const repoRoot = process.cwd();
      let cleanupOk = false;
      try {
        const res = await this.#cleanupRunner({ sessionPath, subtask, repoRoot });
        cleanupOk = res.success;
        if (!res.success) this.#logger.warn({ error: res.error }, 'Cleanup runner reported failure');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.#logger.warn({ error: msg }, 'Cleanup runner threw — continuing (survival commit already safe)');
        cleanupOk = false;
      }

      // cleanup may have written tasks.json — persist before post-cleanup commit
      await this.sessionManager.flushUpdates();

      // (c) POST-CLEANUP COMMIT — doc reorganization, stagecoach
      if (cleanupOk) {
        const postHash = await smartCommit(sessionPath,
          'cleanup: doc reorganization', { generateMessage: true });
        if (postHash) this.#logger.info({ commitHash: postHash }, 'Post-cleanup commit created');
        else this.#logger.info('No cleanup changes to commit');
      }
    }
  } catch (error) {                                   // existing outer guard (1000-1030)
    const msg = error instanceof Error ? error.message : String(error);
    this.#logger.error({ error: msg }, 'Smart commit failed');
  }
} else {
  this.#logger.warn({ subtaskId: subtask.id, reason: failureReason },
    'Subtask failed — skipping commit (broken output left uncommitted)');
}

// PATTERN: constructor DI-light seam (Task 3)
export interface TaskOrchestratorOptions {
  /** Injected cleanup runner. Defaults to the no-op createCleanupRunner().
   *  P3.M1.T3.S3 wires the real cleanup-agent persona here. */
  cleanupRunner?: CleanupRunner;
}
// constructor(sessionManager, options?: TaskOrchestratorOptions) {
//   ...existing init...
//   this.#cleanupRunner = options?.cleanupRunner ?? createCleanupRunner();
// }

// CRITICAL INVARIANT: the outer catch (task-orchestrator.ts:1057) sets Failed +
// rethrows. A cleanup throw that ESCAPES to it would mark a successful subtask
// Failed — VIOLATING "cleanup is non-fatal". Hence the NESTED cleanup try/catch
// must NEVER rethrow. It sets cleanupOk=false and continues.
```

### Integration Points

```yaml
CONSTRUCTOR (src/core/task-orchestrator.ts):
  - add: `options?: TaskOrchestratorOptions` (trailing, per Task 1 grep result)
  - store: `this.#cleanupRunner = options?.cleanupRunner ?? createCleanupRunner();`
  - backward compat: existing single-arg / existing positional-scope callers UNCHANGED

EXECUTION LOOP (src/core/task-orchestrator.ts:executeSubtask success path):
  - replace single smartCommit (line 1004) with the three-stage sequence (Task 4)
  - add a SECOND flushUpdates() after cleanup (cleanup may write tasks.json)

SEAM (src/core/cleanup-runner.ts):
  - NEW module consumed by task-orchestrator.ts + tested independently
  - S3 (P3.M1.T3.S3) replaces createCleanupRunner default with persona invocation
  - S3's runner signature: (ctx: CleanupContext) => Promise<CleanupResult>

DOWNSTREAM CONSUMERS:
  - P3.M1.T3.S3: implements the real cleanup runner persona + wires into the seam
  - P3.M2.T5.S1: orphaned-plan/ skip-recovery relies on survival commit having run
  - P3.M1.T4.S1/S2: stagecoach retry/fallback wrap the INNER generateCommitMessage
    (already inside smartCommit from S1) — NOT the call sites here
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After creating cleanup-runner.ts and editing task-orchestrator.ts
npx eslint src/core/cleanup-runner.ts src/core/task-orchestrator.ts
npx tsc --noEmit -p tsconfig.json
# Expected: zero errors. Common fix: missing `import type { Subtask }` in
# cleanup-runner.ts, or a constructor call site that now needs no change
# (confirm via the Task 1 grep).

# Project-wide
npm run lint        # or: npx eslint src/
npx tsc --noEmit
# Expected: zero errors.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Seam module
npx vitest run tests/unit/core/cleanup-runner.test.ts

# Orchestrator two-phase + legacy smartCommit block
npx vitest run tests/unit/core/task-orchestrator.test.ts

# Full core suite (ensure no regressions in sibling tests)
npx vitest run tests/unit/core/

# Expected: all GREEN. If task-orchestrator.test.ts red on a "called once"
# assertion you missed updating (legacy block), update it to the 2-call form.
```

### Level 3: Integration Testing (System Validation)

```bash
# Project-wide gate (the canonical "did I break anything" check)
npm run validate
# Expected: GREEN. This runs lint + typecheck + the full unit suite.

# Smoke: confirm no other production caller of executeSubtask / constructor broke
rg -n "new TaskOrchestrator\(" src/
# Expected: every call site still compiles with the default no-op runner.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Two-phase-commit behavioral verification (manual reasoning, codified as tests):
# 1. ORDERING: inject a spy cleanup runner + spy smartCommit; assert call order
#    is [flushUpdates, smartCommit#1 (survival), cleanupRunner, flushUpdates,
#    smartCommit#2 (post-cleanup)]. (Covered in Task 6 test #1.)
# 2. SURVIVAL GUARANTEE: if cleanupRunner throws, assert smartCommit#1 STILL
#    ran and the subtask resolved (no Failed, no TaskError). (Test #2/#3.)
# 3. EMPTY-STAGE TOLERANCE: smartCommit#1 returns null (nothing staged) →
#    cleanup still runs; smartCommit#2 may still commit cleanup changes.
#    (Test #4.)

# No network / no real agent / no real git in unit tests — the stagecoach
# agent + git are mocked via S1's smartCommit mock. The cleanup seam is a spy.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 GREEN: `npx eslint src/core/cleanup-runner.ts src/core/task-orchestrator.ts` + `tsc --noEmit`
- [ ] Level 2 GREEN: `npx vitest run tests/unit/core/cleanup-runner.test.ts tests/unit/core/task-orchestrator.test.ts`
- [ ] Level 3 GREEN: `npm run validate`
- [ ] No new linting / type errors project-wide

### Feature Validation

- [ ] Successful subtask makes exactly TWO `smartCommit` calls, both with `{ generateMessage: true }`
- [ ] Survival commit runs BEFORE `#cleanupRunner`; post-cleanup commit runs AFTER
- [ ] `#cleanupRunner` invoked once with `{ sessionPath, subtask, repoRoot: process.cwd() }`
- [ ] Cleanup throw / `{ success:false }` is non-fatal: subtask resolves, post-cleanup commit skipped
- [ ] `smartCommit` null at either phase is tolerated + logged at info
- [ ] Failed path (`!succeeded`): zero commits, zero cleanup — UNCHANGED
- [ ] Default no-op runner (`new TaskOrchestrator(manager)`) still makes 2 commits (cleanupOk=true by default)
- [ ] No cleanup-persona import in task-orchestrator.ts (seam only)

### Code Quality Validation

- [ ] Seam module is pure types + no-op factory (no fs/git/agent imports)
- [ ] `Subtask` imported TYPE-ONLY in cleanup-runner.ts (no runtime cycle)
- [ ] Constructor change is backward compatible (all existing call sites compile)
- [ ] Nested cleanup try/catch does NOT rethrow (non-fatal invariant preserved)
- [ ] Existing outer catch + halt-on-failure throw preserved exactly
- [ ] Log messages distinguish the two phases ('Survival commit created' / 'Post-cleanup commit created')

### Documentation & Deployment

- [ ] JSDoc on `createCleanupRunner` explains it is the default that S3 replaces
- [ ] JSDoc on `TaskOrchestratorOptions.cleanupRunner` explains injection
- [ ] No new env vars / config (this task adds none — config is S3/S4)

---

## Anti-Patterns to Avoid

- ❌ Don't import a cleanup agent persona — none exists (S3 is Planned). Use the seam.
- ❌ Don't let a cleanup throw escape to the outer catch — it would mark a successful subtask Failed.
- ❌ Don't add retry/backoff around smartCommit here — that is P3.M1.T4.S1.
- ❌ Don't add critical-file deletion protection here — that is P3.M2.T4.S2.
- ❌ Don't change the `!succeeded` branch or the halt-on-failure throw — only the success body changes.
- ❌ Don't add the orphaned-`plan/` skip-recovery here — that is P3.M2.T5.S1 (it runs on the Complete-skip path, a different code location).
- ❌ Don't skip the second `flushUpdates()` — cleanup may have written tasks.json that must persist before the post-cleanup commit.
- ❌ Don't use a positional constructor arg that shifts an existing positional arg (Scope?) — use a trailing options object.
- ❌ Don't catch and rethrow inside the cleanup try/catch — swallow + log + set cleanupOk=false.