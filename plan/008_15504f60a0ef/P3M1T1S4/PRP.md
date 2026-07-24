# PRP — P3.M1.T1.S4: Forward PARALLEL_RESEARCH and RESEARCH_DEPTH to bugfix child

---

## Goal

**Feature Goal**: When bug hunting finds bugs and spawns a bugfix sub-pipeline
(`FixCycleWorkflow`), **explicitly forward** the parent's parallel-research
settings — `PARALLEL_RESEARCH` and `RESEARCH_DEPTH` — to the bugfix child so
the child's research queue uses the same depth-chained prefetch model as the
main session (PRD §4.2 "Propagation to Bugfix Sub-Pipeline"; §4.4). Per PRD
§4.2, "The main session's items are already Complete by then, so all real item
execution — and therefore all prefetching — happens inside the bugfix child;
without forwarding, prefetch is silently disabled for the entire phase that
needs it." This task **completes P3.M1.T1** (Depth-Chained Parallel Research).

**Deliverable** (3 files; additive, backward-compatible — no behavior change
when `PARALLEL_RESEARCH` is off):
1. **`src/workflows/fix-cycle-workflow.ts`** — MODIFY:
   - **ADD** an optional 5th constructor parameter
     `researchConfig?: { parallelResearch: boolean; researchDepth: number }`.
   - **STORE** it on a new public readonly field
     `researchConfig: { parallelResearch: boolean; researchDepth: number } | null`
     (default `null` when omitted — preserves every existing 4-arg caller).
   - **DEFENSIVELY RE-APPLY** the values to `process.env` inside the
     constructor (set `process.env.PARALLEL_RESEARCH` /
     `process.env.RESEARCH_DEPTH`) **only when `researchConfig` is provided**.
     This makes the shared `TaskOrchestrator`'s live env reads
     (`isParallelResearch()` / `getResearchDepth()`, S1/S2) correct inside the
     bugfix child, and survives a future refactor that isolates the bugfix
     child into its own process.
   - **IMPORT** `PARALLEL_RESEARCH`, `RESEARCH_DEPTH` name-constants from
     `../config/constants.js` (S1, already landed) for the env writes — do NOT
     hardcode the string literals.
2. **`src/workflows/prp-pipeline.ts`** — MODIFY the bugfix spawn block
   (`runQACycle`, ≈lines 1245-1251): pass an explicit 5th arg to
   `new FixCycleWorkflow(...)` built from the parent's current settings via
   `isParallelResearch()` + `getResearchDepth()` (import both from
   `../config/constants.js`).
3. **`tests/unit/workflows/prp-pipeline.test.ts`** + **`tests/unit/workflows/fix-cycle-workflow.test.ts`**
   — ADD: tests asserting (a) the bugfix spawn forwards the parent's settings
   (constructor mock receives the 5th arg with the right values, env-dependent
   via `vi.stubEnv`); (b) the `FixCycleWorkflow` constructor stores the config
   and re-applies it to `process.env` when provided, and leaves `process.env`
   untouched when omitted.

**Success Definition**:
- When the parent has `PARALLEL_RESEARCH=true` / `RESEARCH_DEPTH=3`, the
  `FixCycleWorkflow` constructed by `runQACycle` receives
  `{ parallelResearch: true, researchDepth: 3 }` and, after construction,
  `process.env.PARALLEL_RESEARCH === 'true'` and `process.env.RESEARCH_DEPTH === '3'`
  inside the bugfix child.
- When `PARALLEL_RESEARCH` is unset/false, the forwarded config is
  `{ parallelResearch: false, researchDepth: <getResearchDepth()> }` and the
  bugfix child behaves exactly as today (no regression).
- All existing 4-arg `new FixCycleWorkflow(...)` call sites (≈30 in tests + 1
  in `prp-pipeline.ts`) remain GREEN unchanged (5th param is optional).
- `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.

---

## User Persona (if applicable)

**Target User**: Pipeline operator who enabled background parallel research
(`-r` / `PARALLEL_RESEARCH=true`) on a main session and expects the SAME
prefetch behavior to apply when the session enters its bug-fix phase.
**Use Case**: `prd -r --research-depth 3` → main backlog completes → bug hunt
finds bugs → bugfix sub-pipeline starts → operator expects the bugfix child's
research queue to also prefetch 3 items ahead, not silently fall back to
synchronous/flat research.
**User Journey**: main run (parallel on) → QA finds bugs → `runQACycle` spawns
`FixCycleWorkflow` with forwarded settings → bugfix child's shared orchestrator
reads the forwarded env → depth-chain prefetch active during fix execution.
**Pain Points Addressed**: PRD §4.2 — "without forwarding, prefetch is silently
disabled for the entire phase that needs it." The bugfix phase is precisely
where real item execution happens after the main items are Complete.

---

## Why

- **PRD compliance**: PRD §4.2 (h3.4) step 1 "Propagation to Bugfix
  Sub-Pipeline" mandates: "the parallel-research settings
  (`PARALLEL_RESEARCH` and `RESEARCH_DEPTH`) MUST be forwarded to the child."
  §4.4 (h3.6) describes the bugfix sub-pipeline as a self-contained session
  that runs the standard full task breakdown — i.e. it does real research.
- **Contract item 3 (LOGIC) / item 4 (OUTPUT)**: "When bug hunting spawns a
  bugfix sub-pipeline … forward PARALLEL_RESEARCH and RESEARCH_DEPTH settings
  to the child pipeline/orchestrator. … Bugfix child receives and uses
  PARALLEL_RESEARCH + RESEARCH_DEPTH. Completes P3.M1.T1."
- **Architectural alignment**: `architecture/phase_findings.md` §PHASE 4
  documents the bugfix sub-pipeline creation at `prp-pipeline.ts:1207-1245`
  (mkdir bugfix dir, copy TEST_RESULTS.md, create `FixCycleWorkflow`).
- **Why explicit (not silent env-share)**: today the bugfix child is in-process
  and shares the parent's `TaskOrchestrator`, so `process.env` is technically
  already visible. But the PRD mandates an *observable* forward, the
  architecture is trending toward self-contained/process-isolated bugfix
  sessions (§4.4 item 3 "Resume interrupted breakdowns"), and an explicit
  forward is unit-testable while a silent env-share is not. See research
  FACT 1 + FACT 4.

### Out of scope (hard fences)
- **The constants/helpers themselves** → S1 (DONE; `PARALLEL_RESEARCH`,
  `RESEARCH_DEPTH`, `isParallelResearch()`, `getResearchDepth()` all exist at
  `src/config/constants.ts:290-361`). S4 IMPORTS them only.
- **Orchestrator depth-chain logic / ResearchQueue** → S2 (parallel, in-flight).
  S4 does NOT touch `src/core/task-orchestrator.ts` or
  `src/core/research-queue.ts`; it only ensures the values those files read
  are present in the bugfix child.
- **RESEARCH_TIMEOUT docs** → S3 (parallel, in-flight). Disjoint (timeout, not
  parallel/depth).
- **`executeFixes()` / fix-subtask creation / `#createFixSubtask`** → UNCHANGED.
  S4 forwards config only; it does not alter fix-task semantics.
- **`PRD.md` / `tasks.json` / `prd_snapshot.md` / `vitest.config.ts`** →
  READ-ONLY.
- **Subprocess spawning of the bugfix child** → does NOT exist today (research
  FACT 4: the only `node dist/index.js` hits are inert strings in the
  RESOURCE_LIMIT_REPORT template). S4 does NOT add a subprocess; it
  future-proofs via constructor param + env re-set.

---

## What

### User-visible behavior
None at the CLI/config surface (contract item 5 DOCS: none — no user-facing,
config, or API surface change). Operators who run with `PARALLEL_RESEARCH=true`
will observe (in logs) the bugfix child's research queue using the same
depth-chain prefetch as the main session, instead of silently falling back.

### Technical requirements (exact contract — item 3)

**(a) Optional 5th constructor param on `FixCycleWorkflow`
(`src/workflows/fix-cycle-workflow.ts`).** Add a typed options param and a
public readonly field, and defensively re-apply to `process.env`:

```ts
// NEW import at top (extend existing constants import if one exists; otherwise add):
import {
  PARALLEL_RESEARCH,
  RESEARCH_DEPTH,
} from '../config/constants.js';

/**
 * Forwarded parallel-research settings for the bugfix child (PRD §4.2
 * "Propagation to Bugfix Sub-Pipeline"). When provided, the bugfix child's
 * shared TaskOrchestrator reads these via isParallelResearch() /
 * getResearchDepth() (live env reads), so the depth-chain prefetch model
 * stays active during fix execution. Null when omitted (legacy callers).
 */
researchConfig: { parallelResearch: boolean; researchDepth: number } | null = null;

constructor(
  sessionPath: string,
  prdContent: string,
  taskOrchestrator: TaskOrchestrator,
  sessionManager: SessionManager,
  researchConfig?: { parallelResearch: boolean; researchDepth: number }
) {
  super('FixCycleWorkflow');
  // ... existing validation (sessionPath, validateBugfixSession) UNCHANGED ...

  this.sessionPath = sessionPath;
  this.prdContent = prdContent;
  this.taskOrchestrator = taskOrchestrator;
  this.sessionManager = sessionManager;
  this.researchConfig = researchConfig ?? null;

  // PRD §4.2: defensively re-apply forwarded settings to process.env so the
  // shared orchestrator's live reads (isParallelResearch / getResearchDepth)
  // are correct inside the bugfix child. Idempotent: a no-op when the env was
  // already set to these values; a hardening for a future process-isolated
  // bugfix child. Only runs when the caller explicitly forwarded settings.
  if (researchConfig) {
    process.env[PARALLEL_RESEARCH] = researchConfig.parallelResearch ? 'true' : 'false';
    process.env[RESEARCH_DEPTH] = String(researchConfig.researchDepth);
    this.logger.debug(
      {
        parallelResearch: researchConfig.parallelResearch,
        researchDepth: researchConfig.researchDepth,
      },
      '[FixCycleWorkflow] Forwarded parallel-research settings applied to env'
    );
  }

  // ... existing correlation logger init UNCHANGED ...
}
```

**GOTCHA (placement):** the env re-apply MUST happen BEFORE the existing
correlation-logger init log so the debug line is correlated; place it
immediately after `this.researchConfig = researchConfig ?? null;` and before
the `correlationId` block. Do NOT move or reorder the existing
`validateBugfixSession` call (it can throw — keep it first, as today).

**(b) Forward at the bugfix spawn site (`src/workflows/prp-pipeline.ts`,
`runQACycle`, ≈lines 1245-1251).** Build the config from the parent's current
settings and pass it as the 5th arg:

```ts
// NEW import near the other config imports at the top of prp-pipeline.ts:
import {
  isParallelResearch,
  getResearchDepth,
} from '../config/constants.js';

// ... inside runQACycle, replacing the existing new FixCycleWorkflow(...) call:
const fixCycleWorkflow = new FixCycleWorkflow(
  bugfixSessionPath,
  prdContent,
  this.taskOrchestrator,
  this.sessionManager,
  // PRD §4.2: forward parallel-research settings to the bugfix child so its
  // shared orchestrator's depth-chain prefetch stays active during fix
  // execution (the main items are already Complete by now).
  {
    parallelResearch: isParallelResearch(),
    researchDepth: getResearchDepth(),
  }
);
```

**(c) No other source change.** The shared `TaskOrchestrator` already reads
`isParallelResearch()` / `getResearchDepth()` (after S2); S4 only guarantees
those reads return the parent's values inside the bugfix child.

### Success Criteria
- [ ] After `runQACycle` constructs `FixCycleWorkflow` with
      `PARALLEL_RESEARCH=true`/`RESEARCH_DEPTH=3` in the parent env, the
      constructor mock (unit test) is called with a 5th arg equal to
      `{ parallelResearch: true, researchDepth: 3 }`.
- [ ] After constructing a `FixCycleWorkflow` with `researchConfig` provided,
      `process.env.PARALLEL_RESEARCH` and `process.env.RESEARCH_DEPTH` reflect
      the forwarded values; `workflow.researchConfig` deep-equals the arg.
- [ ] After constructing a `FixCycleWorkflow` with NO 5th arg (legacy),
      `workflow.researchConfig === null` and `process.env.PARALLEL_RESEARCH` /
      `RESEARCH_DEPTH` are UNCHANGED (no env mutation).
- [ ] All ~30 existing 4-arg `new FixCycleWorkflow(...)` call sites in tests
      compile and pass GREEN (5th param optional).
- [ ] `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The change spans 3 files (2 source, both additive; the spawn-site edit
is a single constructor-call argument). Correctness rests on seven pre-proven
facts, all pinned below: (1) the bugfix child is **in-process** and shares the
parent's `TaskOrchestrator` (`prp-pipeline.ts:1245-1251` passes
`this.taskOrchestrator`); (2) `FixCycleWorkflow`'s constructor is currently
**4-arg** (`fix-cycle-workflow.ts:120-128`) with no options object — S4 adds an
**optional** 5th, so every existing caller stays GREEN; (3) the shared
orchestrator reads `PARALLEL_RESEARCH`/`RESEARCH_DEPTH` **live from env** via
S1's `isParallelResearch()`/`getResearchDepth()` (`constants.ts:320-361`) once
S2 wires them — so re-applying to `process.env` is the mechanism that makes the
forward observable; (4) **no subprocess** bugfix spawn exists today (research
FACT 4: the only `node dist/index.js` hits are inert template strings) — S4
future-proofs via constructor param + env re-set, not by adding a spawn; (5)
the env re-apply is **idempotent** and **gated on `researchConfig` provided**
(legacy callers get zero env mutation); (6) **100% branch coverage** is
enforced — the `if (researchConfig)` true/false branches and the
`parallelResearch ? 'true' : 'false'` ternary both need tests; (7) S1's
constants are **already landed** (`constants.ts:290-361`) — S4 imports them, it
does NOT redefine.

### Documentation & References
```yaml
# MUST READ — the PRD spec (provided in selected_prd_content)
- docfile: PRD.md
  section: "4.2 The Execution Loop — Parallel Research, 'Propagation to Bugfix
       Sub-Pipeline'" (h3.4) + "4.4 The QA & Bug Hunt Loop, The Fix Cycle" (h3.6)
  why: §4.2 mandates forwarding PARALLEL_RESEARCH + RESEARCH_DEPTH to the bugfix
       child ("all real item execution — and therefore all prefetching — happens
       inside the bugfix child; without forwarding, prefetch is silently
       disabled"); §4.4 says the bugfix child runs the standard full task
       breakdown (i.e. it does real research).
  critical: PRD says "MUST be forwarded" — an observable, testable forward, not a
            silent env-share. S4 implements it as a constructor param + explicit
            env re-apply.

# MUST READ — this subtask's research (proven facts about the working tree)
- docfile: plan/008_15504f60a0ef/P3M1T1S4/research/s4-codebase-analysis.md
  section: FACT 1 (in-process shared orchestrator), FACT 2 (4-arg constructor is
       the forward seam), FACT 3 (live env reads via S1 helpers), FACT 4 (no
       subprocess spawn today), FACT 5 (test patterns to mirror), FACT 6
       (validation gate), FACT 7 (scope fences)
  why: Proves the minimal-risk design (optional 5th param + idempotent env
       re-apply), the exact edit site (prp-pipeline.ts:1245-1251), and that no
       subprocess wiring is needed or exists.

# MUST READ — S1 contract (the config layer S4 imports)
- docfile: plan/008_15504f60a0ef/P3M1T1S1/PRP.md
  section: "Goal" (PARALLEL_RESEARCH, RESEARCH_DEPTH, isParallelResearch,
       getResearchDepth — all at constants.ts:290-361, ALREADY LANDED)
  why: S4 imports PARALLEL_RESEARCH + RESEARCH_DEPTH name-constants (for env
       writes) and isParallelResearch + getResearchDepth (to read the parent's
       current values at the spawn site). Must NOT redefine any of them.

# MUST READ — S2 contract (the consumer of the helpers in the shared orchestrator)
- docfile: plan/008_15504f60a0ef/P3M1T1S2/PRP.md
  section: "What (a)/(c)" (orchestrator imports isParallelResearch/getResearchDepth
       and calls them in #prefetchResearchAhead + executeSubtask)
  why: Confirms the shared orchestrator reads env LIVE — so S4's env re-apply
       inside the bugfix child is what makes S2's prefetch logic active during
       fix execution. S4 does NOT touch task-orchestrator.ts.

# MUST READ — architecture reference (cited by the contract's RESEARCH NOTE)
- docfile: plan/008_15504f60a0ef/architecture/phase_findings.md
  section: "## PHASE 4" → bugfix sub-pipeline creation at prp-pipeline.ts:1207-1245
  why: Confirms the exact spawn site S4 edits and that the bugfix child reuses
       the parent orchestrator + sessionManager.

# THE FILE TO EDIT — FixCycleWorkflow (add optional 5th param + env re-apply)
- file: src/workflows/fix-cycle-workflow.ts
  section: (1) imports (≈line 25-33) — ADD PARALLEL_RESEARCH, RESEARCH_DEPTH from
       ../config/constants.js; (2) public state fields (≈line 48-72) — ADD
       `researchConfig` field; (3) constructor (≈line 120-200) — ADD optional 5th
       param, assign field, ADD the gated `if (researchConfig) { process.env[...] }`
       block immediately after the field assignment and BEFORE the correlationId
       block.
  why: This is the bugfix child entry point; the constructor is the natural
       place to capture + apply forwarded settings before any fix execution.
  pattern: existing field declarations (sessionPath/prdContent/etc.); existing
       constructor validation + assignment block.
  gotcha: the env re-apply is GATED on `researchConfig` (omit → no env mutation,
       preserving legacy callers). Keep validateBugfixSession FIRST (it throws).
       Use the imported name-constants, not string literals.

# THE FILE TO EDIT — bugfix spawn site (pass the 5th arg)
- file: src/workflows/prp-pipeline.ts
  section: runQACycle bugfix spawn block (≈lines 1245-1251). ADD the import of
       isParallelResearch + getResearchDepth near the other config imports; ADD
       the 5th arg object literal to new FixCycleWorkflow(...).
  why: This is the ONLY production call site that must forward; it has access to
       the parent's env via the S1 helpers.
  pattern: the existing new FixCycleWorkflow(...) call (just add one arg).
  gotcha: read the parent's values via isParallelResearch()/getResearchDepth()
       (NOT raw process.env) so the same parsing/fallback rules as the main
       session apply. Do NOT change the 4 existing args.

# THE FILES TO EDIT — tests (100% coverage gate)
- file: tests/unit/workflows/prp-pipeline.test.ts
  section: the existing `vi.mock('.../fix-cycle-workflow.js', …)` (≈line 87-92)
       captures constructor calls; ADD a test under `describe('runQACycle', …)`
       (≈line 529) that stubs PARALLEL_RESEARCH=true + RESEARCH_DEPTH=3, runs
       runQACycle with a bug-found scenario, and asserts the FixCycleWorkflow
       mock was called with the 5th arg {parallelResearch:true, researchDepth:3}.
       Also a false/unset case asserting {parallelResearch:false, researchDepth:2}.
  why: Covers the spawn-site forward for both parallel-on and parallel-off.
  pattern: existing runQACycle tests (inject mockSessionManager, call runQACycle,
       assert). Use vi.stubEnv + afterEach(vi.unstubAllEnvs).
  gotcha: the existing FixCycleWorkflow mock returns {hasBugs:false}; to exercise
       the spawn path the test needs the BugHuntWorkflow mock to return hasBugs:true
       FIRST (so the `if (testResults.hasBugs)` block runs). Check how the existing
       mock is wired and ensure the bug-found branch is entered.

- file: tests/unit/workflows/fix-cycle-workflow.test.ts
  section: ADD a describe('FixCycleWorkflow: research config forwarding', …).
       Cases: (a) 5th arg provided → researchConfig stored AND process.env set
       (stub env, construct, assert env + field, unstub); (b) 5th arg omitted →
       researchConfig === null AND process.env UNCHANGED (capture env before,
       assert equal after); (c) parallelResearch:false forwarded → env becomes
       'false' (covers the ternary false-branch).
  why: Covers the constructor's new branches (if-researchConfig true/false;
       ternary true/false) for 100% coverage.
  pattern: existing constructor tests in the file (≈line 133-177) construct with
       mock orchestrator + sessionManager; mirror their setup. Use
       vi.stubEnv/vi.unstubAllEnvs for env isolation.
  gotcha: capture process.env values BEFORE construction in the omitted-arg case
       and assert equality AFTER (mutation would be a bug). The constructor calls
       validateBugfixSession — existing tests already pass a valid bugfix path
       (or mock the validator); mirror that.

# CONTRACT INPUTS (read-only)
- file: src/config/constants.ts
  why: S1's helpers live here (lines 290-361). S4 imports PARALLEL_RESEARCH,
       RESEARCH_DEPTH, isParallelResearch, getResearchDepth. READ-ONLY — do NOT
       edit.
- file: vitest.config.ts
  why: 100/100/100/100 thresholds on src/**/*.ts — the new constructor branches
       must be covered.
- file: package.json
  why: npm run validate = lint + format:check + typecheck + test:run (green gate).
```

### Current Codebase tree (relevant slice)
```bash
src/
  workflows/
    fix-cycle-workflow.ts   # EDIT — +optional 5th ctor param `researchConfig`, +public field, +gated env re-apply
    prp-pipeline.ts         # EDIT — +import isParallelResearch/getResearchDepth, +5th arg at bugfix spawn (≈1245)
  config/
    constants.ts            # READ-ONLY (S1) — PARALLEL_RESEARCH, RESEARCH_DEPTH, isParallelResearch, getResearchDepth
  core/
    task-orchestrator.ts    # READ-ONLY (S2) — reads isParallelResearch/getResearchDepth live from env
    research-queue.ts       # READ-ONLY (S2) — get depth() reads getResearchDepth live
tests/
  unit/
    workflows/
      prp-pipeline.test.ts        # EDIT — +forwarding assertions in runQACycle (parallel on/off)
      fix-cycle-workflow.test.ts  # EDIT — +researchConfig forwarding describe block
vitest.config.ts           # READ-ONLY — 100% coverage thresholds
package.json               # READ-ONLY — npm run validate gate
PRD.md                     # READ-ONLY — §4.2 (h3.4), §4.4 (h3.6)
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/workflows/fix-cycle-workflow.ts   # MODIFIED — accepts forwarded researchConfig, re-applies to env (idempotent, gated)
src/workflows/prp-pipeline.ts         # MODIFIED — forwards parent's isParallelResearch()/getResearchDepth() to bugfix child
tests/unit/workflows/prp-pipeline.test.ts       # MODIFIED — asserts spawn-site forward (parallel on/off)
tests/unit/workflows/fix-cycle-workflow.test.ts # MODIFIED — asserts constructor stores config + re-applies env (provided/omitted)
# (no NEW files)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (optional 5th param, NOT a breaking change): every existing caller
//   of new FixCycleWorkflow(...) uses 4 args (prp-pipeline.ts:1245 + ~30 test
//   sites in tests/integration/qa-agent.test.ts, fix-cycle-workflow-integration.test.ts,
//   tests/unit/workflows/fix-cycle-workflow.test.ts). The 5th param MUST be
//   optional (researchConfig?: ...) so all of them stay GREEN unchanged.

// CRITICAL (env re-apply is GATED + IDEMPOTENT): only write process.env when
//   researchConfig is provided. Legacy callers (omitted) MUST see zero env
//   mutation — otherwise you'd clobber a parent's settings with null. The write
//   is idempotent (setting env to the value it already has is a no-op).

// CRITICAL (use imported name-constants, not string literals): write
//   process.env[PARALLEL_RESEARCH] and process.env[RESEARCH_DEPTH] using the
//   S1 constants (constants.ts:290,345), NOT process.env['PARALLEL_RESEARCH'].
//   This keeps the env-var names DRY and survives a future rename.

// CRITICAL (read parent values via helpers, not raw env): at the spawn site,
//   build the config from isParallelResearch() and getResearchDepth() — NOT
//   process.env.PARALLEL_RESEARCH. The helpers apply the same parsing/fallback
//   rules (exact 'true' match; NaN/<=0 → default) as the main session.

// CRITICAL (keep validateBugfixSession FIRST): the existing constructor calls
//   validateBugfixSession(this.sessionPath) early and can throw
//   BugfixSessionValidationError. Do NOT move the env re-apply above it — place
//   the env block AFTER the field assignments, BEFORE the correlationId init.

// GOTCHA (100% branch coverage): the new constructor adds branches that ALL
//   need tests:
//   - `if (researchConfig)` TRUE branch → provide the arg, assert env set.
//   - `if (researchConfig)` FALSE branch → omit the arg, assert env unchanged.
//   - `parallelResearch ? 'true' : 'false'` TRUE → forward {parallelResearch:true}.
//   - `parallelResearch ? 'true' : 'false'` FALSE → forward {parallelResearch:false}.
//   Missing any → npm run validate fails on coverage.

// GOTCHA (test env isolation): use vi.stubEnv('PARALLEL_RESEARCH','true') /
//   vi.stubEnv('RESEARCH_DEPTH','3') and afterEach(() => vi.unstubAllEnvs()).
//   For the omitted-arg "env unchanged" case, capture process.env[key] BEFORE
//   construction and assert equality AFTER.

// GOTCHA (the spawn-path test needs hasBugs:true): the existing
//   FixCycleWorkflow mock in prp-pipeline.test.ts returns {hasBugs:false}; but
//   to enter the `if (testResults.hasBugs)` block where the spawn happens, the
//   BugHuntWorkflow mock must return hasBugs:true. Inspect the existing mock
//   wiring and override BugHuntWorkflow for this test so the bug-found branch
//   executes and the FixCycleWorkflow constructor mock is actually called.

// GOTCHA (do NOT touch the shared orchestrator): S4 adds NO branches to
//   task-orchestrator.ts or research-queue.ts. Coverage there is S2's
//   responsibility. S4 only guarantees the env values those files read are
//   present in the bugfix child.

// GOTCHA (no subprocess exists today): research FACT 4 confirms the only
//   `node dist/index.js` hits (prp-pipeline.ts:1680,1690) are inert strings in
//   the RESOURCE_LIMIT_REPORT template. Do NOT add a child_process spawn; the
//   forward is constructor-param + env re-set, which future-proofs for a
//   process-isolated bugfix child without adding one now.
```

---

## Implementation Blueprint

### Data models and structure
No new data models. The only type-level addition is an inline object type
`{ parallelResearch: boolean; researchDepth: number }` used as the optional 5th
constructor param and stored on the new `researchConfig` public field. Both
`boolean` and `number` are primitives already in use. No schema/Zod change
(the forwarded config is internal plumbing, not persisted state).

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: MODIFY src/workflows/fix-cycle-workflow.ts — optional 5th param + env re-apply
  - ADD to the imports (≈line 25-33, near the existing constants/logger imports):
      import { PARALLEL_RESEARCH, RESEARCH_DEPTH } from '../config/constants.js';
  - ADD a public readonly field (in the "Public State Fields" block ≈line 48-72):
      /** Forwarded parallel-research settings (PRD §4.2). Null when omitted (legacy). */
      researchConfig: { parallelResearch: boolean; researchDepth: number } | null = null;
  - MODIFY the constructor signature (≈line 120-128) to add the optional 5th param:
      constructor(
        sessionPath: string,
        prdContent: string,
        taskOrchestrator: TaskOrchestrator,
        sessionManager: SessionManager,
        researchConfig?: { parallelResearch: boolean; researchDepth: number }
      )
  - INSIDE the constructor, AFTER the existing field assignments
    (this.sessionPath/prdContent/taskOrchestrator/sessionManager) and AFTER the
    existing validateBugfixSession block, ADD:
      this.researchConfig = researchConfig ?? null;
      if (researchConfig) {
        process.env[PARALLEL_RESEARCH] = researchConfig.parallelResearch ? 'true' : 'false';
        process.env[RESEARCH_DEPTH] = String(researchConfig.researchDepth);
        this.logger.debug(
          { parallelResearch: researchConfig.parallelResearch, researchDepth: researchConfig.researchDepth },
          '[FixCycleWorkflow] Forwarded parallel-research settings applied to env'
        );
      }
    Place this block BEFORE the existing correlationId init log.
  - PRESERVE: validateBugfixSession call + its error handling (keep FIRST among
    the new logic), the correlationId block, all phase methods, all test-only
    getters, the maxIterations=3 constant, the @Step methods.
  - FOLLOW pattern: existing field declarations; existing constructor assignment
    block; existing this.logger.debug calls.
  - GOTCHA: keep the 5th param OPTIONAL. Use imported name-constants for env
    writes. Do NOT reorder validateBugfixSession. See Known Gotchas.

Task 2: MODIFY src/workflows/prp-pipeline.ts — forward at bugfix spawn site
  - ADD to the config imports near the top of the file (find the existing
    constants import line; if none, add a new import):
      import { isParallelResearch, getResearchDepth } from '../config/constants.js';
  - MODIFY the new FixCycleWorkflow(...) call in runQACycle (≈line 1245-1251) to
    pass a 5th arg:
      const fixCycleWorkflow = new FixCycleWorkflow(
        bugfixSessionPath,
        prdContent,
        this.taskOrchestrator,
        this.sessionManager,
        { parallelResearch: isParallelResearch(), researchDepth: getResearchDepth() }
      );
  - PRESERVE: the 4 existing args (bugfixSessionPath, prdContent,
    this.taskOrchestrator, this.sessionManager), the bugfix dir creation +
    TEST_RESULTS.md copy block above it, the fixResults handling below it.
  - FOLLOW pattern: the existing new FixCycleWorkflow(...) call (just append arg).
  - GOTCHA: read via isParallelResearch()/getResearchDepth() (not raw env).
    Do NOT change the mkdir/copyFile logic or the catch block.

Task 3: MODIFY tests/unit/workflows/fix-cycle-workflow.test.ts — forwarding coverage
  - ADD import of PARALLEL_RESEARCH, RESEARCH_DEPTH from '../../src/config/constants.js'
    (to reference env keys in assertions) if not already imported.
  - ADD describe('FixCycleWorkflow: research config forwarding', …) with cases:
      a. "stores forwarded researchConfig and applies it to env":
         vi.stubEnv('PARALLEL_RESEARCH',''); vi.stubEnv('RESEARCH_DEPTH','');
         const w = new FixCycleWorkflow(validBugfixPath, 'PRD', orch, sm,
           { parallelResearch: true, researchDepth: 3 });
         expect(w.researchConfig).toEqual({ parallelResearch: true, researchDepth: 3 });
         expect(process.env.PARALLEL_RESEARCH).toBe('true');
         expect(process.env.RESEARCH_DEPTH).toBe('3');
         vi.unstubAllEnvs();
      b. "parallelResearch:false writes 'false' to env (ternary false-branch)":
         forward { parallelResearch: false, researchDepth: 2 };
         expect(process.env.PARALLEL_RESEARCH).toBe('false');
      c. "omitted 5th arg leaves researchConfig null and env UNCHANGED":
         capture process.env.PARALLEL_RESEARCH + RESEARCH_DEPTH before;
         const w = new FixCycleWorkflow(validBugfixPath, 'PRD', orch, sm);
         expect(w.researchConfig).toBeNull();
         expect(process.env.PARALLEL_RESEARCH).toBe(capturedBefore); // unchanged
         expect(process.env.RESEARCH_DEPTH).toBe(capturedBeforeDepth);
  - Reuse the existing test factories (mock orchestrator + sessionManager +
    valid bugfix sessionPath) already used at ≈line 133-177.
  - afterEach(() => vi.unstubAllEnvs()) in the describe.
  - FOLLOW pattern: existing constructor tests in the file.
  - GOTCHA: must cover BOTH ternary branches and BOTH if-branches for 100%. For
    case (c), assert env equality (not just null field) to prove no mutation.

Task 4: MODIFY tests/unit/workflows/prp-pipeline.test.ts — spawn-site forward
  - The file already mocks FixCycleWorkflow (≈line 87-92) and BugHuntWorkflow.
    INSPECT how BugHuntWorkflow is mocked; for this test, ensure the bug-found
    branch executes (BugHuntWorkflow.run returns {hasBugs:true, bugs:[...]}).
  - ADD under describe('runQACycle', …) (≈line 529):
      it('forwards PARALLEL_RESEARCH + RESEARCH_DEPTH to FixCycleWorkflow (parallel on)', async () => {
        vi.stubEnv('PARALLEL_RESEARCH','true');
        vi.stubEnv('RESEARCH_DEPTH','3');
        // ... existing setup: all-Complete backlog, mockSessionManager, pipeline ...
        await pipeline.runQACycle();
        expect(FixCycleWorkflow).toHaveBeenCalledWith(
          expect.any(String), expect.any(String), expect.anything(), expect.anything(),
          { parallelResearch: true, researchDepth: 3 }
        );
        vi.unstubAllEnvs();
      });
      it('forwards parallel-off config when PARALLEL_RESEARCH unset', async () => {
        vi.stubEnv('PARALLEL_RESEARCH',''); vi.stubEnv('RESEARCH_DEPTH','');
        // ... same setup ...
        await pipeline.runQACycle();
        expect(FixCycleWorkflow).toHaveBeenCalledWith(
          expect.any(String), expect.any(String), expect.anything(), expect.anything(),
          { parallelResearch: false, researchDepth: 2 }
        );
        vi.unstubAllEnvs();
      });
  - FOLLOW pattern: the existing runQACycle tests (inject mockSessionManager,
    set totalTasks/all-Complete, call runQACycle, assert phase). Mirror how they
    make the bug-found branch reachable.
  - GOTCHA: the FixCycleWorkflow mock MUST be called (bug-found branch). If the
    existing mock returns hasBugs:false at the BugHuntWorkflow layer, override it
    for these tests so the spawn path executes. Import FixCycleWorkflow from the
    mocked module to use the constructor spy.

Task 5: VERIFY — no regressions
  - RUN npm run typecheck → exit 0 (optional param + new arg compile).
  - RUN npx vitest run tests/unit/workflows/fix-cycle-workflow.test.ts → ALL green
    (incl. new forwarding describe block; existing ~30 tests GREEN unchanged).
  - RUN npx vitest run tests/unit/workflows/prp-pipeline.test.ts → ALL green
    (incl. new forwarding assertions).
  - RUN npx vitest run tests/integration/fix-cycle-workflow-integration.test.ts
    + tests/integration/qa-agent.test.ts → GREEN unchanged (4-arg calls still work).
  - RUN npx vitest run --coverage → 100/100/100/100 on src/**/*.ts (new branches
    in fix-cycle-workflow.ts covered; prp-pipeline.ts adds no new branch).
  - RUN npm run validate → GREEN.
  - RUN npm run build → succeeds.
  - VERIFY only the 4 intended files changed: git diff --name-only →
    src/workflows/fix-cycle-workflow.ts, src/workflows/prp-pipeline.ts,
    tests/unit/workflows/fix-cycle-workflow.test.ts,
    tests/unit/workflows/prp-pipeline.test.ts.
```

### Implementation Patterns & Key Details
```ts
// PATTERN: optional 5th constructor param + gated idempotent env re-apply
//   (src/workflows/fix-cycle-workflow.ts):
constructor(
  sessionPath: string,
  prdContent: string,
  taskOrchestrator: TaskOrchestrator,
  sessionManager: SessionManager,
  researchConfig?: { parallelResearch: boolean; researchDepth: number }   // ← NEW, optional
) {
  super('FixCycleWorkflow');
  // ... existing validation + field assignments UNCHANGED ...
  this.researchConfig = researchConfig ?? null;
  if (researchConfig) {                                                  // ← cover BOTH branches
    process.env[PARALLEL_RESEARCH] = researchConfig.parallelResearch ? 'true' : 'false';  // ← cover BOTH
    process.env[RESEARCH_DEPTH] = String(researchConfig.researchDepth);
    this.logger.debug({ /* … */ }, '[FixCycleWorkflow] Forwarded … applied to env');
  }
  // ... existing correlationId init UNCHANGED ...
}

// PATTERN: forward at the spawn site via helpers (src/workflows/prp-pipeline.ts):
const fixCycleWorkflow = new FixCycleWorkflow(
  bugfixSessionPath,
  prdContent,
  this.taskOrchestrator,
  this.sessionManager,
  { parallelResearch: isParallelResearch(), researchDepth: getResearchDepth() }  // ← NEW 5th arg
);

// PATTERN: env-isolated forwarding test (fix-cycle-workflow.test.ts):
it('stores forwarded researchConfig and applies it to env', () => {
  vi.stubEnv('PARALLEL_RESEARCH', '');
  vi.stubEnv('RESEARCH_DEPTH', '');
  const w = new FixCycleWorkflow(validBugfixPath, 'PRD', orch, sm,
    { parallelResearch: true, researchDepth: 3 });
  expect(w.researchConfig).toEqual({ parallelResearch: true, researchDepth: 3 });
  expect(process.env.PARALLEL_RESEARCH).toBe('true');
  expect(process.env.RESEARCH_DEPTH).toBe('3');
  vi.unstubAllEnvs();
});

// CRITICAL: the 5th param is OPTIONAL — every existing 4-arg caller stays GREEN.
// CRITICAL: env re-apply is GATED on researchConfig provided (legacy = no mutation).
// CRITICAL: use imported name-constants (PARALLEL_RESEARCH/RESEARCH_DEPTH), not literals.
// CRITICAL: read parent values via isParallelResearch()/getResearchDepth(), not raw env.
// CRITICAL: keep validateBugfixSession FIRST in the constructor (it throws).
```

### Integration Points
```yaml
FIX-CYCLE-WORKFLOW (src/workflows/fix-cycle-workflow.ts):
  - add import: PARALLEL_RESEARCH, RESEARCH_DEPTH (from ../config/constants.js).
  - add field: researchConfig: {parallelResearch, researchDepth} | null (default null).
  - add ctor param: researchConfig?: {parallelResearch, researchDepth} (5th, optional).
  - add ctor logic: gated idempotent process.env re-apply + debug log.

PRP-PIPELINE (src/workflows/prp-pipeline.ts):
  - add import: isParallelResearch, getResearchDepth (from ../config/constants.js).
  - add arg: 5th arg to new FixCycleWorkflow(...) in runQACycle (≈line 1245).

NO CONFIG CHANGE (src/config/constants.ts): S1's helpers/constants already exist;
  S4 imports only. READ-ONLY.
NO ORCHESTRATOR/QUEUE CHANGE: S4 touches neither task-orchestrator.ts nor
  research-queue.ts (S2 owns those; S4 only ensures their env reads are correct
  in the bugfix child).
NO DOCS CHANGE: contract item 5 DOCS = none (internal forwarding plumbing).
NO DATABASE / NO ROUTES / NO MODELS / NO PRD.md / NO tasks.json / NO vitest.config.ts.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit → exit 0 (optional param + new arg compile)
npm run lint             # eslint . --ext .ts → no new violations
npm run format:check     # prettier --check; run `npm run format` if it complains
# Expected: Zero errors. Edits are additive + mirror existing patterns.
```

### Level 2: Unit Tests (Component Validation)
```bash
npx vitest run tests/unit/workflows/fix-cycle-workflow.test.ts   # incl. new forwarding describe block
npx vitest run tests/unit/workflows/prp-pipeline.test.ts         # incl. new spawn-site forward assertions
npx vitest run --coverage                                        # 100/100/100/100 on src/**/*.ts
npm run test:run                                                 # full suite green
# Expected: ALL green. New constructor branches (if-researchConfig true/false,
# ternary true/false) are exercised (else coverage fails).
```

### Level 3: Integration Testing (System Validation)
```bash
npm run validate      # lint + format:check + typecheck + test:run → GREEN
npm run build         # tsc -p tsconfig.build.json → succeeds

# Existing 4-arg callers stay GREEN (optional param):
npx vitest run tests/integration/fix-cycle-workflow-integration.test.ts   # GREEN unchanged
npx vitest run tests/integration/qa-agent.test.ts                          # GREEN unchanged
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Confirm S4 IMPORTS S1's helpers (does not redefine them):
rg -n "isParallelResearch|getResearchDepth|PARALLEL_RESEARCH|RESEARCH_DEPTH" src/workflows/prp-pipeline.ts
# EXPECT: import line + 1 usage (the 5th arg object literal).

rg -n "PARALLEL_RESEARCH|RESEARCH_DEPTH" src/workflows/fix-cycle-workflow.ts
# EXPECT: import line + env-write usages in the constructor.

# Confirm NO config constant was redefined by S4:
rg -n "export const RESEARCH_DEPTH|export function getResearchDepth|export function isParallelResearch|export const PARALLEL_RESEARCH" src/config/constants.ts
# EXPECT: all defined ONCE (S1's territory; S4 only imports).

# Confirm the 5th param is OPTIONAL (no breaking change to existing callers):
rg -n "new FixCycleWorkflow\(" src/ tests/ | wc -l   # EXPECT: ~33 call sites, all still compile (4-arg OK)

# Confirm the orchestrator/research-queue were NOT touched by S4:
git diff --name-only src/core/task-orchestrator.ts src/core/research-queue.ts   # EXPECT: no changes from S4

# Confirm only the 4 intended files changed:
git diff --name-only
# EXPECT: src/workflows/fix-cycle-workflow.ts, src/workflows/prp-pipeline.ts,
#         tests/unit/workflows/fix-cycle-workflow.test.ts,
#         tests/unit/workflows/prp-pipeline.test.ts
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0.
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] `npm run build` succeeds.
- [ ] 100% coverage on `src/**/*.ts` preserved (all new constructor branches covered).

### Feature Validation
- [ ] `runQACycle` constructs `FixCycleWorkflow` with a 5th arg built from
      `isParallelResearch()` + `getResearchDepth()` (verified by constructor
      mock assertion in both parallel-on and parallel-off env states).
- [ ] `FixCycleWorkflow` stores `researchConfig` and re-applies it to
      `process.env` when the 5th arg is provided.
- [ ] `FixCycleWorkflow` leaves `process.env` UNCHANGED and sets
      `researchConfig === null` when the 5th arg is omitted.
- [ ] All ~30 existing 4-arg `new FixCycleWorkflow(...)` call sites pass GREEN.

### Code Quality Validation
- [ ] 5th constructor param is OPTIONAL (no breaking change).
- [ ] Env re-apply is GATED (legacy callers = zero env mutation) + idempotent.
- [ ] Uses imported S1 name-constants (PARALLEL_RESEARCH/RESEARCH_DEPTH), not literals.
- [ ] Reads parent values via isParallelResearch()/getResearchDepth(), not raw env.
- [ ] `validateBugfixSession` remains FIRST in the constructor (error-ordering preserved).
- [ ] Does NOT touch task-orchestrator.ts, research-queue.ts, or constants.ts.

### Documentation & Deployment
- [ ] No docs/.env changes (contract item 5 DOCS = none).
- [ ] No new env vars introduced (S4 forwards S1's existing knobs only).
- [ ] Code is self-documenting (JSDoc on `researchConfig` field + debug log).

---

## Anti-Patterns to Avoid
- ❌ Don't make the 5th constructor param REQUIRED — it breaks ~30 existing
  4-arg callers (tests + the one production site before S4 edits it). It MUST
  be `researchConfig?: ...`.
- ❌ Don't write `process.env` UNCONDITIONALLY — legacy callers (omitted arg)
  must see zero env mutation, or you'll clobber a parent's settings. Gate the
  write on `if (researchConfig)`.
- ❌ Don't use string literals (`process.env['PARALLEL_RESEARCH']`) — use the
  imported S1 name-constants so the env-var names stay DRY and rename-safe.
- ❌ Don't read the parent's values from raw `process.env` at the spawn site —
  use `isParallelResearch()` / `getResearchDepth()` so the same parsing/fallback
  rules (exact 'true' match; NaN/<=0 → default) apply as the main session.
- ❌ Don't reorder the constructor's `validateBugfixSession` call — it can throw
  `BugfixSessionValidationError` and must run before the new env logic.
- ❌ Don't touch `task-orchestrator.ts`, `research-queue.ts`, or
  `constants.ts` — S2 owns the orchestrator/queue wiring; S1 owns the constants.
  S4 only guarantees the env values they read are present in the bugfix child.
- ❌ Don't add a `child_process`/subprocess spawn — none exists today (research
  FACT 4); the forward is constructor-param + env re-set, which future-proofs
  for a process-isolated bugfix child without adding one now.
- ❌ Don't mutate `process.env` in tests without restoration — use
  `vi.stubEnv`/`vi.unstubAllEnvs` (the 100%-coverage gate needs determinism).
- ❌ Don't forget to cover BOTH the `if (researchConfig)` branches AND the
  `parallelResearch ? 'true' : 'false'` ternary branches, or
  `npm run validate` fails on 100% coverage.
- ❌ Don't touch PRD.md, tasks.json, prd_snapshot.md, or vitest.config.ts.

---

## Confidence Score

**9/10** — One-pass success likelihood is very high. S4 is a small, additive,
backward-compatible change across 2 source files + 2 test files. Every edit
site is pinned with file:line anchors (the bugfix spawn at
`prp-pipeline.ts:1245-1251`; the 4-arg constructor at
`fix-cycle-workflow.ts:120-128`), every pattern mirrored from a named exemplar
(the existing `new FixCycleWorkflow(...)` call; existing constructor field
assignments; existing `runQACycle` tests; existing `vi.stubEnv` env-isolation
tests), and every new branch has a designated test (if-researchConfig
true/false; ternary true/false; spawn-site forward parallel-on/off). The S1
config contract is stable and imported only; S2's orchestrator wiring is
disjoint (S4 doesn't touch `task-orchestrator.ts`/`research-queue.ts`).

The design is deliberately minimal-risk: because the bugfix child is in-process
and shares the parent orchestrator today, S4 does NOT add a subprocess — it
adds an **observable, testable** forward (optional constructor param + gated
idempotent env re-apply) that satisfies the PRD "MUST be forwarded" mandate and
survives a future process-isolated bugfix refactor. The two residual risks,
both trivial and mitigated: (1) **the spawn-path test must enter the
bug-found branch** — the PRP explicitly calls out that the BugHuntWorkflow mock
may need to return `hasBugs:true` for the `FixCycleWorkflow` constructor spy to
be called (Task 4 GOTCHA); (2) **the omitted-arg "env unchanged" case** must
assert env equality (not just `researchConfig === null`) to prove no mutation —
the PRP specifies this. Zero file overlap with the in-flight S2 (orchestrator/
queue) and S3 (docs) — S4 edits `fix-cycle-workflow.ts` + `prp-pipeline.ts` +
their unit tests, all disjoint from siblings' files.