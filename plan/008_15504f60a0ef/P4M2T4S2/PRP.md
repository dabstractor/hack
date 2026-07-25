# PRP — P4.M2.T4.S2: Auto-detect and resume interrupted bugfix breakdowns

---

## Goal

**Feature Goal**: Implement PRD §4.4 step 3 "Resume interrupted breakdowns." When
a bug-fix run is killed **between committing the QA bug report (`TEST_RESULTS.md`)
and finishing task breakdown**, the bugfix directory is left with a `TEST_RESULTS.md`
but **no `tasks.json`** (or an empty / corrupt one). The pipeline MUST
**auto-detect** this interrupted state at the start of the bugfix pipeline path and
**re-enter the breakdown path** — skipping the fresh bug hunt, reusing the existing
`TEST_RESULTS.md` as the mini-PRD, and letting the standard full breakdown
(`runStandardBreakdown`, produced by the parallel item **P4.M2.T4.S1**) regenerate
the missing `tasks.json` into the existing bugfix dir. Detection is **skipped** in
`--validate` / `--skip-bug-finding` modes and **suppressed** inside bug-fix
children (no detect→resume→detect re-entry loop).

**Deliverable** (1 source file MODIFY + 1 test file MODIFY; **no** edit to
`fix-cycle-workflow.ts` — owned by parallel S1; **no** config/constant change,
**no** CLI flag, **no** new dependency, **no** doc change):

1. **`src/workflows/prp-pipeline.ts`** (MODIFY) —
   (a) ADD a value import of `BacklogSchema` from `../core/models.js` (currently
       only `type Backlog` is imported at `:29`);
   (b) ADD a private **`#detectInterruptedBugfix(sessionPath): Promise<string | null>`**
       that returns the bugfix dir path when interrupted (`TEST_RESULTS.md` present
       AND `tasks.json` missing / empty-after-trim / fails `JSON.parse` / fails
       `BacklogSchema.safeParse`), else `null`;
   (c) ADD a private **`#runBugFixCycle(bugfixDir, prdContent): Promise<TestResults>`**
       extracted from the existing Phase-2 bugfix block (construct
       `new FixCycleWorkflow(bugfixDir, prdContent, this.taskOrchestrator,
       this.sessionManager, { parallelResearch: isParallelResearch(),
       researchDepth: getResearchDepth() })` + `.run()` + the
       bugsFixed/bugsRemaining logging);
   (d) REFACTOR the existing Phase-2 bugfix block in `runQACycle` to **call**
       `#runBugFixCycle` (behavior byte-identical — preserves the `try/catch`
       "continue with original results" semantics);
   (e) ADD a **resume branch** at the top of `runQACycle`'s bug path (after the
       `shouldRunQA === true` decision + `sessionPath` validation, **before** the
       fresh `BugHuntWorkflow`): if `canAutoResume` (gated by `mode !== 'validate'`
       && `SKIP_BUG_FINDING !== 'true'` && `!sessionPath.toLowerCase().includes('bugfix')`)
       and `#detectInterruptedBugfix` returns a dir, resume via `#runBugFixCycle`
       on the EXISTING dir (NO `mkdir`, NO `copyFile`), set `finalResults`, skip
       the fresh hunt; on resume throw, log a warning and fall through to the
       fresh hunt.
2. **`tests/unit/workflows/prp-pipeline.test.ts`** (MODIFY) — add `stat: vi.fn()`
   to the `node:fs/promises` mock; ADD a `describe('resume interrupted bugfix
   breakdowns')` block with full branch coverage (missing/empty/corrupt-parse/
   corrupt-schema tasks.json → resume; healthy dir → fresh hunt; no
   TEST_RESULTS.md → fresh hunt; validate mode skip; SKIP_BUG_FINDING skip;
   bug-fix-child path suppression; resume-failure fallthrough; resume reuses
   existing dir — mkdir/copyFile NOT called).

**Success Definition**:
- Re-running the pipeline on a session whose `plan/NNN_hash/bugfix/` dir has a
  `TEST_RESULTS.md` but no/empty/corrupt `tasks.json` → the pipeline **detects
  the interrupted state**, **reuses** the existing `bugfix/` dir + `TEST_RESULTS.md`
  (does NOT run a fresh `BugHuntWorkflow`, does NOT `mkdir`/`copyFile`), and runs
  `FixCycleWorkflow` whose `runStandardBreakdown` (S1) regenerates `tasks.json`
  from the existing bug report.
- A healthy bugfix dir (TEST_RESULTS.md + valid tasks.json), or no `TEST_RESULTS.md`,
  → fresh bug hunt runs normally (no behavior change).
- `--validate` mode and `SKIP_BUG_FINDING='true'` → auto-detection is skipped.
- A bug-fix child session (`sessionPath` contains `bugfix`) → detection suppressed.
- `npm run validate` GREEN; `npm run test:coverage` stays 100% (all new branches
  covered); `git diff --name-only` shows EXACTLY the 2 files above.

---

## User Persona (if applicable)

**Target User**: A pipeline operator whose recursive bug-fix run was killed
mid-breakdown (OOM, Ctrl-C, watchdog). They re-run the pipeline (`prd -c` or a
fresh run) and expect the **interrupted bugfix to resume automatically** — not
silently re-run the entire bug hunt from scratch (discarding the committed bug
report) nor crash on the missing `tasks.json`.

**Use Case**: "I came back to a session where the bug hunt committed
`TEST_RESULTS.md` but the architect was killed before writing `tasks.json`.
Re-running should pick up exactly there: regenerate the breakdown from the same
bug report and keep fixing — without an infinite resume loop."

**User Journey**: main `run()` → `runQACycle()` → `shouldRunQA===true` → **resume
gate** detects interrupted `bugfix/` → constructs `FixCycleWorkflow(existingBugfixDir,
…)` → `.run()` → `#loadBugReport` (existing `TEST_RESULTS.md`) →
`runStandardBreakdown` (S1: architect writes `tasks.json` into the existing dir) →
`executeFixes` → `retest` → loop → `finalResults` → QA summary.

**Pain Points Addressed**: today a killed-mid-breakdown bugfix leaves an orphaned
`TEST_RESULTS.md`; the next run ignores it, re-runs the full bug hunt, and either
re-creates the dir or races on it. The committed bug report (audit trail) is lost
and the operator has no way to resume.

---

## Why

- **PRD compliance (§4.4 step 3, "Resume interrupted breakdowns")**: verbatim —
  *"If a recursive bug-fix run is killed between committing the bug report and
  finishing task breakdown, the bugfix session is left with a `TEST_RESULTS.md`
  but no `tasks.json`. The pipeline MUST auto-detect this (report present,
  `tasks.json` missing/empty/corrupt) and re-enter on the same path the bug-hunt
  stage uses when it first finds bugs … This check is skipped in
  `--validate`/`--skip-bug-finding` and suppressed inside bug-fix children (no
  re-entry loop)."*
- **Work-item CONTRACT mapping**:
  - **(1) RESEARCH NOTE** — `architecture/phase_findings.md` §PHASE 4 lists
    "Standard full breakdown for bugfix + **resume interrupted breakdowns**" as a
    required change. S1 delivers the breakdown half; THIS item delivers the
    resume half.
  - **(2) INPUT** — *"Standard full breakdown for bugfix from P4.M2.T4.S1."* →
    S2 consumes S1's `runStandardBreakdown()` (which writes `tasks.json` into the
    bugfix dir). S2 does NOT modify `fix-cycle-workflow.ts`.
  - **(3) LOGIC**:
    - (a) auto-detect at start of bugfix path → **`#detectInterruptedBugfix`**;
    - (b) if detected, re-enter bug-hunt→breakdown path using existing
          `TEST_RESULTS.md` as mini-PRD, regenerate `tasks.json` via standard full
          breakdown → **resume branch calls `#runBugFixCycle` → `FixCycleWorkflow.run`
          → `runStandardBreakdown` (S1)**;
    - (c) skip in `--validate`/`--skip-bug-finding` → **resume gate**;
    - (d) suppress re-entry inside bug-fix children → **`!sessionPath.includes('bugfix')`**.
  - **(4) OUTPUT** — *"Auto-detection + resume of interrupted bugfix breakdowns.
    Completes P4.M2.T4 and P4.M2."* → ✓ this is the final subtask of the milestone.
  - **(5) DOCS** — *"none — no user-facing/config/API surface change."* → no doc edits.
- **Closes the milestone**: P4.M2.T4.S2 is the last subtask of P4.M2.T4 and of
  P4.M2 ("Validation & QA Hardening"). A clean resume path is what makes the
  bug-fix loop production-safe (kill-tolerant).

---

## What

`runQACycle` gains an **interrupted-breakdown resume gate** at the very top of its
bug path. Before running a fresh `BugHuntWorkflow`, it checks whether the session's
`bugfix/` dir is in an interrupted state. If so (and gating passes), it **reuses**
that dir + its `TEST_RESULTS.md` and runs `FixCycleWorkflow` on it — the same path
the fresh-hunt Phase 2 uses (refactored into `#runBugFixCycle`, now shared by both).
The fresh bug hunt, `mkdir`, and `copyFile` are all skipped on resume.

**No** change to `fix-cycle-workflow.ts` (S1 owns it), **no** change to
`bug-hunt-workflow.ts` (P4.M2.T3.S1 owns it), **no** new CLI flag / config /
constant / dependency / doc.

### Success Criteria

- [ ] **`#detectInterruptedBugfix(sessionPath)`** returns the `sessionPath/bugfix`
      path iff `bugfix/TEST_RESULTS.md` exists AND `bugfix/tasks.json` is missing /
      empty-after-trim / `JSON.parse`-failing / `BacklogSchema.safeParse`-failing;
      returns `null` otherwise (no TEST_RESULTS.md, or a healthy dir).
- [ ] **`#runBugFixCycle(bugfixDir, prdContent)`** constructs `FixCycleWorkflow`
      with the 5-arg signature (incl. `{ parallelResearch, researchDepth }`) and
      returns its `run()` result. Both the fresh-hunt Phase 2 and the resume
      branch call it (single code path = "re-enter the same path").
- [ ] The **resume branch** sits AFTER `shouldRunQA===true` + `sessionPath`
      validation and BEFORE `new BugHuntWorkflow`. On resume it does NOT call
      `BugHuntWorkflow`, `mkdir`, or `copyFile`.
- [ ] **Resume gate**: `this.mode !== 'validate' && process.env.SKIP_BUG_FINDING !==
      'true' && !sessionPath.toLowerCase().includes('bugfix')`.
- [ ] **Resume failure** (FixCycleWorkflow throws) → logs a warning and **falls
      through** to the fresh bug hunt (pipeline is never blocked by a flaky resume).
- [ ] The existing fresh-hunt Phase 2 behavior is **byte-identical** (same
      `MockFixCycleWorkflow` 5-arg call, same try/catch "continue with original
      results" semantics) — existing `describe('runQACycle')` tests stay GREEN.
- [ ] `BacklogSchema` is imported as a **value** (added to the models import) so
      `BacklogSchema.safeParse(...)` typechecks.
- [ ] `tests/unit/workflows/prp-pipeline.test.ts` adds `stat: vi.fn()` to the
      `node:fs/promises` mock and a `describe('resume interrupted bugfix
      breakdowns')` block covering ALL branches.
- [ ] `npm run validate` GREEN; `npm run test:coverage` 100%; `git diff --name-only`
      shows EXACTLY the 2 intended files.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed?"
— YES. This PRP names: the EXACT file + method to add (`#detectInterruptedBugfix`,
`#runBugFixCycle`); the EXACT seam in `runQACycle` (after `shouldRunQA===true`, before
`new BugHuntWorkflow`); the EXACT interrupted-state predicate; the EXACT gating
predicate; the EXACT refactor (extract Phase-2 construction into `#runBugFixCycle`);
the exact import addition (`BacklogSchema` value import); the exact mock addition
(`stat: vi.fn()`); and the precise test matrix. It treats S1's `runStandardBreakdown`
as a black-box contract (it writes `tasks.json` into the bugfix dir).

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: plan/008_15504f60a0ef/P4M2T4S2/research/00_research_summary.md
  why: THIS PRP's own research summary. The interrupted-state predicate, the
        runQACycle control-flow placement, the gating/suppression rationale, the
        BacklogSchema value-import requirement, the shared-helper decision, and
        the test patterns. READ FIRST.

- file: plan/008_15504f60a0ef/P4M2T4S1/PRP.md
  why: S1 is the PARALLEL item that produces `runStandardBreakdown()` (renamed from
        `createFixTasks`) + `#buildBugFixMiniPrd()`. S1's contract is that the
        architect WRITES `tasks.json` into the bugfix dir via
        `createArchitectPrompt(miniPrd, this.sessionPath)`. S2's resume re-enters
        that exact path. S2 MUST NOT edit fix-cycle-workflow.ts (S1 owns it).
        Treat S1's Success Definition as a hard contract.

- file: src/workflows/prp-pipeline.ts
  section: runQACycle() (:1469-1700 — the method THIS PRP modifies):
           - mode gating (:1477-1521): `mode==='validate'` returns EARLY (:1485)
             BEFORE the bug path → validate is structurally skipped;
           - `shouldRunQA===true` decision (:1514) → resume branch goes RIGHT AFTER;
           - sessionPath validation (:1538-1542) → resume branch goes AFTER this;
           - Phase 1 fresh BugHuntWorkflow (:1544) → resume branch goes BEFORE this;
           - Phase 2 bugfix block (:1562-1640): mkdir(:1572) + copyFile(:1577) +
             new FixCycleWorkflow(:1593-1601) + run(:1605) + bugsFixed logging
             (:1608-1627) + try/catch (:1632-1641) → EXTRACT the construction+run
             into #runBugFixCycle; keep mkdir/copyFile in the fresh path ONLY;
           - Phase 3 state update (:1645-1648) + Phase 4 console summary (:1652+):
             BOTH fresh and resume set finalResults then fall through here.
  why: THE FILE THIS PRP MODIFIES. The resume branch + 2 new private methods live
        here. Phase 2 is refactored (not removed).
  pattern: copy the `@`-less private-method style + this.logger.info/warn style for
        #detectInterruptedBugfix / #runBugFixCycle. Mirror the existing
        `const { resolve } = await import('node:path'); const { mkdir, copyFile }
        = await import('node:fs/promises');` dynamic-import idiom for the detection's
        stat/readFile, OR import at top — check existing style (runQACycle uses
        dynamic imports inside the method).
  gotcha: runQACycle's try/catch wraps EVERYTHING (:1471-1704) and on error calls
        #trackFailure (:1703). A thrown resume that is NOT caught internally would
        surface there — wrap the resume attempt in its own try/catch so a flaky
        resume falls through to the fresh hunt instead of failing the whole QA cycle.

- file: src/core/models.ts
  section: BacklogSchema (:797) = `z.object({ backlog: z.array(PhaseSchema) })`;
           Backlog interface (:753); TestResults/TestResultsSchema (:~1746/1971).
  why: BacklogSchema.safeParse drives the "corrupt tasks.json" check. TestResults is
        the type FixCycleWorkflow.run() returns (so #runBugFixCycle returns it).
  gotcha: prp-pipeline.ts:29 imports `Backlog` as a TYPE only — ADD `BacklogSchema`
        to a VALUE import line (it is a runtime const, not a type).

- file: src/workflows/fix-cycle-workflow.ts   # READ-ONLY (S1 owns it)
  section: run() (:369 — calls runStandardBreakdown→executeFixes→retest→checkComplete
           in a loop); constructor (:170 — validates sessionPath includes 'bugfix'
           via validateBugfixSession, applies researchConfig to env); #loadBugReport
           (:505 — reads the EXISTING TEST_RESULTS.md — this is what resume reuses).
  why: #runBugFixCycle constructs this. On resume, the existing dir already passes
        validateBugfixSession (path includes 'bugfix') and #loadBugReport reads the
        existing TEST_RESULTS.md. runStandardBreakdown (S1) then regenerates tasks.json.
  gotcha: DO NOT edit this file. S1 owns it. If you find createFixTasks still exists,
        S1 hasn't landed yet — assume S1's runStandardBreakdown WILL exist (treat as
        contract) and do not work around it.

- file: src/utils/validation/session-validation.ts
  section: validateBugfixSession (:73) — `sessionPath.includes('bugfix')`.
  why: Defines the bug-fix-child identity used by the suppression gate. The resumed
        dir `plan/NNN_hash/bugfix` includes 'bugfix' → passes FixCycleWorkflow
        validation; the MAIN session path does NOT → suppression gate is false at
        top level (correct).

- file: src/utils/validation/execution-guard.ts
  section: validateNestedExecution (:60) — `SKIP_BUG_FINDING === 'true' &&
           sessionPath.toLowerCase().includes('bugfix')` = legitimate bugfix recursion.
  why: Confirms SKIP_BUG_FINDING is the bug-fix-child signal and is NEVER set by our
        own code (external/env). The resume gate reads it with an exact-string match.

- file: tests/unit/workflows/prp-pipeline.test.ts
  section: top-level vi.mock('node:fs/promises',…) (:18 — ADD stat: vi.fn());
           MockBugHuntWorkflow / MockFixCycleWorkflow (:173-174);
           describe('runQACycle') (:570 — the pattern to extend: set mode='bug-hunt',
           stub BugHunt→bugs + FixCycle→clean, assert MockFixCycleWorkflow 5-arg call).
  why: THE TEST FILE THIS PRP MODIFIES. Detection tests branch mockReadFile/mockStat
        per path (TEST_RESULTS.md vs tasks.json). The skip/child tests use
        vi.stubEnv('SKIP_BUG_FINDING',…) and a mock session path containing 'bugfix'.

- file: PRD.md   # §4.4 step 3 "Resume interrupted breakdowns" (verbatim in
                 # selected_prd_content) — the requirement. Cite it in the
                 # detectInterruptedBugfix + resume-branch JSDoc.

- file: plan/008_15504f60a0ef/architecture/phase_findings.md
  section: §PHASE 4 "Required Changes → resume interrupted breakdowns."
  why: THE RESEARCH NOTE the contract cites.
```

### Current Codebase tree (relevant slice)

```bash
src/workflows/
  prp-pipeline.ts          # MODIFY — + #detectInterruptedBugfix, + #runBugFixCycle
                           #   (extracted from Phase 2), + resume branch in runQACycle,
                           #   + BacklogSchema value import.
  fix-cycle-workflow.ts    # READ-ONLY (parallel P4.M2.T4.S1 owns it).
  bug-hunt-workflow.ts     # READ-ONLY (parallel P4.M2.T3.S1 owns it).
src/core/
  models.ts                # READ-ONLY — BacklogSchema, Backlog, TestResults.
  session-manager.ts       # READ-ONLY — currentSession.metadata.path.
src/utils/validation/
  session-validation.ts    # READ-ONLY — validateBugfixSession ('bugfix' substring).
  execution-guard.ts       # READ-ONLY — SKIP_BUG_FINDING semantics.
tests/unit/workflows/
  prp-pipeline.test.ts     # MODIFY — + stat mock; + 'resume interrupted bugfix
                           #   breakdowns' describe block; (existing runQACycle tests
                           #   stay GREEN after the #runBugFixCycle extraction).
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/workflows/prp-pipeline.ts
  # - ADD value import: `BacklogSchema` from '../core/models.js' (alongside type Backlog).
  # - ADD private async #detectInterruptedBugfix(sessionPath: string): Promise<string | null>:
  #     bugfixDir = resolve(sessionPath, 'bugfix')
  #     testResultsPath = resolve(bugfixDir, 'TEST_RESULTS.md')
  #     tasksPath = resolve(bugfixDir, 'tasks.json')
  #     1. stat(testResultsPath) — throw/ENOENT → return null (never hunted / nothing to resume)
  #     2. stat(tasksPath) — ENOENT → return bugfixDir (missing → interrupted)
  #     3. content = readFile(tasksPath,'utf-8'); if (content.trim()==='') return bugfixDir (empty)
  #     4. try JSON.parse(content) catch → return bugfixDir (corrupt-parse)
  #     5. if (!BacklogSchema.safeParse(parsed).success) return bugfixDir (corrupt-schema)
  #     6. return null (healthy)
  # - ADD private async #runBugFixCycle(bugfixDir, prdContent): Promise<TestResults>:
  #     construct new FixCycleWorkflow(bugfixDir, prdContent, this.taskOrchestrator,
  #       this.sessionManager, { parallelResearch: isParallelResearch(),
  #       researchDepth: getResearchDepth() }); return await it.run()
  #     (extracted verbatim from Phase 2 — same 5-arg construction + .run())
  # - runQACycle(): after shouldRunQA===true + sessionPath validated, BEFORE Phase 1:
  #     const canAutoResume = this.mode !== 'validate'
  #       && process.env.SKIP_BUG_FINDING !== 'true'
  #       && !sessionPath.toLowerCase().includes('bugfix');
  #     if (canAutoResume) {
  #       const interruptedDir = await this.#detectInterruptedBugfix(sessionPath);
  #       if (interruptedDir) {
  #         log info 'Resuming interrupted bugfix breakdown at <dir>'
  #         try { finalResults = await this.#runBugFixCycle(interruptedDir, prdContent);
  #               resumed = true; }
  #         catch (e) { log warn 'Resume failed, falling back to fresh bug hunt: …' }
  #       }
  #     }
  #     if (!resumed) { …existing fresh-hunt Phase 1 + Phase 2 (Phase 2 now calls
  #       #runBugFixCycle instead of inline construction)… }
  #     …Phase 3 state update + Phase 4 console summary unchanged (both paths fall through)…
  # - NOTHING else in the file changes.
tests/unit/workflows/prp-pipeline.test.ts
  # + stat: vi.fn() added to the vi.mock('node:fs/promises', …) factory (:18).
  # + const stat = (await import('node:fs/promises')).stat as any;  (or import at top)
  # + describe('resume interrupted bugfix breakdowns') with cases:
  #     (1) missing tasks.json + TEST_RESULTS.md present → resume (BugHuntWorkflow
  #         NOT called; mkdir/copyFile NOT called; FixCycleWorkflow called with the
  #         existing bugfix dir path).
  #     (2) empty tasks.json → resume.
  #     (3) corrupt tasks.json (JSON.parse throws) → resume.
  #     (4) corrupt tasks.json (valid JSON, BacklogSchema fails) → resume.
  #     (5) healthy dir (TEST_RESULTS.md + valid tasks.json) → NOT interrupted →
  #         fresh BugHuntWorkflow called; FixCycleWorkflow fresh-path construction.
  #     (6) no TEST_RESULTS.md → not interrupted → fresh hunt.
  #     (7) mode==='validate' → runQACycle returns early; detection NOT reached.
  #     (8) SKIP_BUG_FINDING='true' (vi.stubEnv) → detection skipped even with an
  #         interrupted dir present → fresh hunt.
  #     (9) sessionPath contains 'bugfix' (mock session metadata.path) → suppression
  #         gate false → fresh hunt (no re-entry).
  #    (10) resume throws (MockFixCycleWorkflow.run rejects) → falls through to
  #         fresh BugHuntWorkflow hunt (pipeline not blocked).
  # ~ existing describe('runQACycle') tests stay GREEN: assert MockFixCycleWorkflow
  #   is STILL called with the same 5 args after the #runBugFixCycle extraction.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (detection MUST run BEFORE the fresh bug hunt): runQACycle's Phase 1
//   (BugHuntWorkflow) writes a NEW TEST_RESULTS.md and Phase 2 mkdir+copyFile
//   re-creates bugfix/. If detection ran AFTER, the interrupted TEST_RESULTS.md
//   would already be overwritten and the resume would be pointless. Place the
//   resume branch right after the sessionPath validation (:1538-1542), before
//   `new BugHuntWorkflow` (:1544).

// CRITICAL (BacklogSchema is a VALUE import, not a type): prp-pipeline.ts:29 has
//   `import type { Backlog, Status, DeltaAnalysis, Task } from '../core/models.js';`.
//   Add a SEPARATE value import line: `import { BacklogSchema } from '../core/models.js';`
//   (or merge into a value import). `BacklogSchema.safeParse(...)` needs the runtime
//   binding; a type-only import will not emit it and tsc will error.

// CRITICAL (resumed dir MUST already pass validateBugfixSession): FixCycleWorkflow's
//   constructor calls validateBugfixSession(sessionPath) which requires the path to
//   include 'bugfix'. The detected dir is `plan/NNN_hash/bugfix` → includes 'bugfix' ✓.
//   Do NOT pass the MAIN sessionPath to FixCycleWorkflow.

// CRITICAL (resume is NON-interactive per this item's contract): PRD §4.4 step 4
//   "User is prompted before resuming" is NOT in S2's LOGIC contract. S2 implements
//   AUTOMATIC resume. Do NOT add a prompt/confirm mechanism (no such helper exists;
//   it is out of scope and would block headless runs).

// GOTCHA (the fresh-hunt Phase 2 try/catch must be preserved): today Phase 2 wraps
//   the fix cycle in try/catch and on failure "continues with original testResults"
//   (:1632-1641). When you extract #runBugFixCycle, KEEP that try/catch around the
//   fresh-path CALL site so fresh-path behavior is byte-identical. The RESUME branch
//   has its OWN try/catch (fall-through to fresh hunt on failure) — do not merge them.

// GOTCHA (stat vs readFile for existence): use `stat` (node:fs/promises) for the
//   existence check and catch its ENOENT. Add `stat: vi.fn()` to the existing
//   vi.mock('node:fs/promises', …) — no currently-tested path calls stat, so this
//   is a safe addition. Do NOT use existsSync (sync, different module 'node:fs').

// GOTCHA (corrupt = JSON.parse fail OR BacklogSchema fail): a tasks.json that is
//   valid JSON but not a valid Backlog (e.g. `{}` or `{"foo":1}`) MUST count as
//   corrupt → use `BacklogSchema.safeParse(parsed).success === false`, NOT a
//   throw (safeParse never throws).

// GOTCHA (empty file): check `content.trim() === ''` AFTER reading — a 0-byte or
//   whitespace-only tasks.json is "empty" → interrupted. JSON.parse('') throws,
//   which would ALSO be caught as corrupt, but check emptiness explicitly first
//   for a clear log message.

// GOTCHA (SKIP_BUG_FINDING exact-string match): match `execution-guard.ts:68` —
//   use `process.env.SKIP_BUG_FINDING === 'true'` (case-sensitive exact). Anything
//   else (unset, 'false', 'TRUE', '1') = NOT skipping.

// GOTCHA (bug-fix-child suppression is path-based): the gate uses
//   `!sessionPath.toLowerCase().includes('bugfix')`. The MAIN runQACycle sessionPath
//   is `plan/NNN_hash` (no 'bugfix') → gate allows detection. A future runQACycle
//   inside a bugfix context would be suppressed. This is the contract's "no re-entry
//   loop" guard.

// GOTCHA (corrupt tasks.json is regenerated by the architect's OVERWRITE): the
//   resume calls FixCycleWorkflow.run() → runStandardBreakdown (S1) → architect
//   writes $TASKS_FILE via atomic writeFile, which OVERWRITES the corrupt file.
//   So a corrupt tasks.json is cleanly regenerated. The detection only DECIDES to
//   resume; it does not need to delete the corrupt file first.

// GOTCHA (100% coverage gate): vitest.config.ts enforces 100% globally. New
//   branches in #detectInterruptedBugfix (4 return-bugfixDir paths + the healthy
//   return-null) and the resume gate (canAutoResume true/false × detected/not ×
//   resume ok/fail) MUST all be covered by the new describe block.

// GOTCHA (dynamic vs static imports for node builtins): runQACycle already uses
//   `const { resolve } = await import('node:path'); const { mkdir, copyFile } =
//   await import('node:fs/promises');` INSIDE the method. Match that style for the
//   detection's stat/readFile (dynamic import inside #detectInterruptedBugfix) so
//   the vi.mock('node:fs/promises') intercepts it. node builtins use the `node:`
//   prefix, NO `.js`.
```

---

## Implementation Blueprint

### Data models and structure

No new data models. `BacklogSchema` / `Backlog` / `TestResults` already exist
(`src/core/models.ts`). `#detectInterruptedBugfix` returns `string | null`;
`#runBugFixCycle` returns `Promise<TestResults>`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/workflows/prp-pipeline.ts — ADD BacklogSchema value import + TestResults type import
  - FIND the type-only import at :29:
      import type { Backlog, Status, DeltaAnalysis, Task } from '../core/models.js';
    CONFIRMED (via grep): `TestResults` is NOT currently in this line and is NOT
    imported anywhere else in prp-pipeline.ts. ADD it (needed by #runBugFixCycle in
    Task 2, which returns Promise<TestResults>):
      import type { Backlog, Status, DeltaAnalysis, Task, TestResults } from '../core/models.js';
  - ADD (immediately after it) a value import for BacklogSchema (it is a runtime const
    at models.ts:797; `BacklogSchema.safeParse` in Task 3 needs the runtime binding):
      import { BacklogSchema } from '../core/models.js';
  - GOTCHA: do NOT merge BacklogSchema into the `import type {…}` line — it is a
    runtime const. A separate value import is correct. Verify `tsc --noEmit` is happy
    and BacklogSchema is referenced (Task 3) so the value import is not flagged unused.
  - SCOPE: imports only. No behavior yet.

Task 2: MODIFY src/workflows/prp-pipeline.ts — ADD #runBugFixCycle (extract from Phase 2)
  - Place as a new private method near the other runQACycle helpers.
  - IMPLEMENT:
      /**
       * Construct + run the bug-fix cycle on a bugfix session dir (PRD §4.4).
       * Shared by the fresh-hunt Phase 2 and the interrupted-breakdown resume branch
       * so both "re-enter the same path the bug-hunt stage uses when it first finds
       * bugs." runStandardBreakdown (P4.M2.T4.S1) writes tasks.json into bugfixDir.
       *
       * @param bugfixDir - Existing bugfix session dir (must contain 'bugfix').
       * @param prdContent - PRD snapshot for QA context.
       * @returns Final TestResults from the fix cycle.
       * @private
       */
      async #runBugFixCycle(
        bugfixDir: string,
        prdContent: string
      ): Promise<TestResults> {
        const fixCycleWorkflow = new FixCycleWorkflow(
          bugfixDir,
          prdContent,
          this.taskOrchestrator,
          this.sessionManager,
          // PRD §4.2: forward parallel-research settings to the bugfix child.
          {
            parallelResearch: isParallelResearch(),
            researchDepth: getResearchDepth(),
          }
        );
        return await fixCycleWorkflow.run();
      }
  - NOTE: `TestResults` must be imported as a TYPE (check the existing import line —
    add `TestResults` to the type import if not present). `FixCycleWorkflow`,
    `isParallelResearch`, `getResearchDepth` are already imported (used by current Phase 2).
  - SCOPE: helper only. Not wired yet.

Task 3: MODIFY src/workflows/prp-pipeline.ts — ADD #detectInterruptedBugfix
  - Place as a new private method adjacent to #runBugFixCycle.
  - IMPLEMENT:
      /**
       * Detect a bugfix dir left in an interrupted state (PRD §4.4 step 3).
       *
       * "Interrupted" = the QA bug report (TEST_RESULTS.md) was committed but task
       * breakdown (tasks.json) did not finish — the file is missing, empty, or
       * fails JSON parse / BacklogSchema validation. Returns the bugfix dir path so
       * the caller can resume the breakdown; returns null when there is nothing to
       * resume (never hunted, or a healthy completed breakdown).
       *
       * @param sessionPath - The MAIN session dir (plan/NNN_hash).
       * @returns The interrupted bugfix dir path, or null.
       * @private
       */
      async #detectInterruptedBugfix(sessionPath: string): Promise<string | null> {
        const { resolve } = await import('node:path');
        const { stat, readFile } = await import('node:fs/promises');
        const bugfixDir = resolve(sessionPath, 'bugfix');
        const testResultsPath = resolve(bugfixDir, 'TEST_RESULTS.md');
        const tasksPath = resolve(bugfixDir, 'tasks.json');

        // 1. No bug report → never hunted (or not interrupted) → nothing to resume.
        try {
          await stat(testResultsPath);
        } catch {
          return null;
        }

        // 2. tasks.json missing → interrupted.
        try {
          await stat(tasksPath);
        } catch {
          return bugfixDir;
        }

        // 3. tasks.json empty → interrupted.
        let content: string;
        try {
          content = await readFile(tasksPath, 'utf-8');
        } catch {
          return bugfixDir; // unreadable → treat as interrupted
        }
        if (content.trim() === '') {
          return bugfixDir;
        }

        // 4. tasks.json corrupt (invalid JSON) → interrupted.
        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          return bugfixDir;
        }

        // 5. tasks.json corrupt (valid JSON, invalid Backlog) → interrupted.
        if (!BacklogSchema.safeParse(parsed).success) {
          return bugfixDir;
        }

        // 6. Healthy → not interrupted.
        return null;
      }
  - GOTCHA: `BacklogSchema` is the value import added in Task 1. `safeParse` never throws.
  - SCOPE: helper only. Not wired yet.

Task 4: MODIFY src/workflows/prp-pipeline.ts — REFACTOR Phase 2 to use #runBugFixCycle
  - In runQACycle's Phase 2 bugfix block (:1562-1641), FIND the inline construction:
        const fixCycleWorkflow = new FixCycleWorkflow(
          bugfixSessionPath,
          prdContent,
          this.taskOrchestrator,
          this.sessionManager,
          { parallelResearch: isParallelResearch(), researchDepth: getResearchDepth() }
        );
        const fixResults = await fixCycleWorkflow.run();
        …bugsFixed/bugsRemaining logging…
  - REPLACE the construction + run with a call to the helper:
        const fixResults = await this.#runBugFixCycle(bugfixSessionPath, prdContent);
        …KEEP the bugsFixed/bugsRemaining logging verbatim…
  - PRESERVE: the mkdir (:1572) + copyFile (:1577) (fresh path still creates the dir
    + copies the fresh TEST_RESULTS.md) AND the surrounding try/catch
    (:1632-1641 "continue with original results").
  - GOTCHA: behavior MUST be byte-identical. The existing describe('runQACycle')
    tests assert `MockFixCycleWorkflow.toHaveBeenCalledWith(string, string, anything,
    anything, {parallelResearch, researchDepth})` — that still holds because
    #runBugFixCycle constructs FixCycleWorkflow the same way.
  - SCOPE: refactor only (no behavior change). Existing runQACycle tests must stay GREEN.

Task 5: MODIFY src/workflows/prp-pipeline.ts — ADD resume branch in runQACycle
  - FIND the seam: AFTER the `sessionPath` validation block (:1538-1542) and BEFORE
    the Phase 1 comment `// Phase 1: Bug Hunt` / `const bugHuntWorkflow = new BugHuntWorkflow(…)` (:1544).
  - ALSO note `let finalResults = testResults;` is declared at :1556 (AFTER Phase 1).
    The resume branch needs `finalResults` BEFORE Phase 1. So: declare
    `let finalResults: TestResults | null = null;` + `let resumed = false;` at the seam,
    and change the later `let finalResults = testResults;` to assign into the
    pre-declared variable: `finalResults = testResults;` (drop its `let`).
  - INSERT at the seam:
      // ============================================================
      // PRD §4.4 step 3: Resume interrupted bugfix breakdowns.
      // If a previous bug-fix run was killed between committing TEST_RESULTS.md and
      // finishing breakdown, the bugfix dir has TEST_RESULTS.md but no (valid)
      // tasks.json. Re-enter the SAME path the bug-hunt stage uses when it first
      // finds bugs (runStandardBreakdown regenerates tasks.json). Skipped in
      // --validate / --skip-bug-finding and suppressed inside bug-fix children.
      // ============================================================
      const canAutoResume =
        this.mode !== 'validate' &&
        process.env.SKIP_BUG_FINDING !== 'true' &&
        !sessionPath.toLowerCase().includes('bugfix');

      if (canAutoResume) {
        const interruptedDir = await this.#detectInterruptedBugfix(sessionPath);
        if (interruptedDir) {
          this.logger.info(
            `[PRPPipeline] Interrupted bugfix breakdown detected at ${interruptedDir}; resuming (skipping fresh bug hunt)`
          );
          try {
            finalResults = await this.#runBugFixCycle(interruptedDir, prdContent);
            resumed = true;
          } catch (resumeError) {
            const msg = resumeError instanceof Error ? resumeError.message : String(resumeError);
            this.logger.warn(
              `[PRPPipeline] Resume of interrupted bugfix failed, falling back to fresh bug hunt: ${msg}`
            );
            // resumed stays false → fresh hunt runs below
          }
        }
      }

      // ============================================================
      // Phase 1: Bug Hunt (fresh) — only when not resuming
      // ============================================================
      if (!resumed) {
        …existing Phase 1 (BugHuntWorkflow) + Phase 2 (mkdir/copyFile/#runBugFixCycle)…
        // Phase 2 sets finalResults = fixResults (or keeps testResults on fix failure)
      }

      // Phase 3 + Phase 4 operate on finalResults (now guaranteed non-null because
      // either the resume or the fresh path assigned it). Add a defensive guard:
      const resolvedResults = finalResults!;
  - THEN update Phase 3/4 to use `resolvedResults` instead of `finalResults` where it
    currently reads `finalResults.bugs.length` etc. (search for `finalResults.` and
    rebind once). KEEP all logging/console output identical.
  - GOTCHA: `finalResults` is `TestResults | null` between declaration and assignment;
    after the `if (!resumed){…}` block it is guaranteed assigned (resume sets it on
    success; the fresh path sets it; on resume-FAILURE resumed stays false so the fresh
    path runs and sets it). Use `finalResults!` (non-null assertion) at Phase 3, with a
    one-line comment justifying it.
  - GOTCHA: validate mode returns EARLY at :1485 (before this seam) — so
    `this.mode !== 'validate'` in the gate is belt-and-suspenders (validate never
    reaches here). Keep it for explicit contract compliance.
  - SCOPE: this is the core feature. Verify the full control flow: resume-success →
    skip fresh hunt → Phase 3/4; resume-failure → fresh hunt → Phase 3/4; no-interrupt
    → fresh hunt → Phase 3/4.

Task 6: MODIFY tests/unit/workflows/prp-pipeline.test.ts — ADD stat to fs mock
  - In the top-level `vi.mock('node:fs/promises', () => ({ … }))` (:18), ADD:
      stat: vi.fn(),
  - Import + cast near the other mock handles:
      import { stat } from 'node:fs/promises';
      const mockStat = stat as any;
  - (If the file already imports `readFile` and casts `mockReadFile` at :169, mirror
    that exact style for `stat`/`mockStat`.)
  - GOTCHA: adding `stat` to the factory is safe — no currently-tested path calls
    `stat` (the mock previously omitted it and tests passed), so adding it only
    enables the new detection code.

Task 7: MODIFY tests/unit/workflows/prp-pipeline.test.ts — ADD 'resume interrupted bugfix breakdowns'
  - ADD a new `describe('resume interrupted bugfix breakdowns')` block. Shared setup:
    all-Complete backlog (so shouldRunQA===true), `pipeline.mode = 'bug-hunt'` to force
    QA regardless of task status, mock session with `metadata.path` set to a temp
    main-session path (e.g. '/tmp/plan/008_test' — must NOT contain 'bugfix' except case 9).
  - Provide a fixture builder for a valid Backlog JSON string (reuse createTestBacklog
    → JSON.stringify, or a minimal `{ backlog: [{ id:'P1', type:'Phase', title:'p',
    status:'Planned', milestones: [] }] }`).
  - Cases (each sets mockStat + mockReadFile per path, then `await pipeline.runQACycle()`):
      (1) MISSING tasks.json:
            mockStat.mockImplementation(async (p) => {
              const s = String(p);
              if (s.endsWith('TEST_RESULTS.md')) return {};        // present
              if (s.endsWith('tasks.json')) throw ENOENT;          // missing
              throw ENOENT;
            });
            MockBugHuntWorkflow.mockImplementation(()=>({run:vi.fn()})); // should NOT run
            MockFixCycleWorkflow.mockClear();
            MockFixCycleWorkflow.mockImplementation(()=>({run:vi.fn().mockResolvedValue(CLEAN)}));
            await pipeline.runQACycle();
            expect(MockBugHuntWorkflow).not.toHaveBeenCalled();          // no fresh hunt
            expect(MockFixCycleWorkflow).toHaveBeenCalledTimes(1);
            expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
              expect.stringContaining('bugfix'), expect.any(String),
              expect.anything(), expect.anything(), expect.anything());
            // mkdir/copyFile NOT called on resume:
            // (they ARE mocked fns — assert the fresh-path setup didn't run. Since the
            //  vi.mock factory returns shared vi.fn()s, capture call counts in beforeEach.)
      (2) EMPTY tasks.json: mockStat returns {} for both files; mockReadFile returns '' for
            tasks.json → resume (same assertions as case 1).
      (3) CORRUPT-PARSE: mockReadFile returns '{not json' for tasks.json → resume.
      (4) CORRUPT-SCHEMA: mockReadFile returns JSON.stringify({foo:1}) for tasks.json
            (valid JSON, invalid Backlog) → resume.
      (5) HEALTHY: mockReadFile returns JSON.stringify(validBacklog) for tasks.json →
            NOT interrupted → fresh BugHuntWorkflow IS called; resume FixCycleWorkflow
            not triggered pre-hunt (MockFixCycleWorkflow may still be called by the fresh
            Phase 2 if bugs found — distinguish by asserting MockBugHuntWorkflow called).
      (6) NO TEST_RESULTS.md: mockStat throws ENOENT for TEST_RESULTS.md → not interrupted
            → fresh hunt (MockBugHuntWorkflow called).
      (7) VALIDATE: pipeline.mode = 'validate' → runQACycle returns early; assert
            currentPhase==='qa_skipped' AND MockBugHuntWorkflow not called AND no detection
            (MockFixCycleWorkflow not called).
      (8) SKIP_BUG_FINDING:
            vi.stubEnv('SKIP_BUG_FINDING','true'); try { …interrupted dir present… await
            pipeline.runQACycle(); } finally { vi.unstubAllEnvs(); }
            assert MockBugHuntWorkflow IS called (detection skipped → fresh hunt).
      (9) BUG-FIX CHILD suppression: set mock session metadata.path to
            '/tmp/plan/008_test/bugfix/001_child' (contains 'bugfix'); interrupted dir
            present → gate suppressed → fresh hunt (MockBugHuntWorkflow called).
      (10) RESUME FAILURE: MockFixCycleWorkflow.run rejects → warn logged → falls through
            to fresh BugHuntWorkflow hunt (assert MockBugHuntWorkflow called AFTER the
            failed resume; pipeline did not throw).
  - FOLLOW pattern: the existing describe('runQACycle') (:570) — set mode='bug-hunt',
    stub BugHunt→bugs/Clean, MockFixCycleWorkflow.mockClear(), assert toHaveBeenCalledWith.
  - GOTCHA: because mkdir/copyFile/BugHuntWorkflow/FixCycleWorkflow are module-level
    mocks shared across tests, call `MockBugHuntWorkflow.mockClear()` and
    `MockFixCycleWorkflow.mockClear()` in each test's setup (the existing tests already do
    this pattern). For mockStat/mockReadFile, set fresh mockImplementation per test.
  - GOTCHA: case 5 (healthy) — the fresh hunt may THEN find bugs and call FixCycleWorkflow
    via Phase 2. That's expected; the ASSERTION for case 5 is "MockBugHuntWorkflow was
    called" (fresh hunt ran), NOT "FixCycleWorkflow was not called." Distinguish resume
    (FixCycle called with the EXISTING dir, BEFORE any BugHunt call) from fresh (BugHunt
    called first).

Task 8: VERIFY existing runQACycle tests stay GREEN
  - Run `npx vitest run tests/unit/workflows/prp-pipeline.test.ts`.
  - The 4 existing `describe('runQACycle')` tests (skip-if-incomplete, qa_complete,
    forwards-PARALLEL_RESEARCH-on, forwards-parallel-off) must still pass after the
    #runBugFixCycle extraction (Task 4) and the resume-branch insertion (Task 5).
  - If a test fails because mockStat is unset (detection runs in fresh-hunt tests that
    use mode='bug-hunt'): set mockStat to throw ENOENT for the bugfix paths in the shared
    beforeEach (so detection returns null → fresh hunt proceeds as before). This keeps
    existing tests GREEN without changing their assertions.
  - GOTCHA: the existing 'forwards PARALLEL_RESEARCH' tests use mode='bug-hunt' which now
    ALSO hits the resume gate. They set a mock session whose path does NOT contain 'bugfix'
    and SKIP_BUG_FINDING is unset → canAutoResume is true → #detectInterruptedBugfix runs.
    Configure mockStat (in their setup or a shared beforeEach) so it returns null (no
    TEST_RESULTS.md → not interrupted) → fresh hunt proceeds exactly as before.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (interrupted-state predicate — 4 interrupted return-paths + 1 healthy):
async #detectInterruptedBugfix(sessionPath: string): Promise<string | null> {
  const { resolve } = await import('node:path');
  const { stat, readFile } = await import('node:fs/promises');
  const bugfixDir = resolve(sessionPath, 'bugfix');
  const testResultsPath = resolve(bugfixDir, 'TEST_RESULTS.md');
  const tasksPath = resolve(bugfixDir, 'tasks.json');
  try { await stat(testResultsPath); } catch { return null; }      // never hunted
  try { await stat(tasksPath); } catch { return bugfixDir; }       // missing
  let content: string;
  try { content = await readFile(tasksPath, 'utf-8'); }
  catch { return bugfixDir; }                                       // unreadable
  if (content.trim() === '') return bugfixDir;                     // empty
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return bugfixDir; } // corrupt JSON
  if (!BacklogSchema.safeParse(parsed).success) return bugfixDir;   // corrupt schema
  return null;                                                       // healthy
}

// PATTERN (shared fix-cycle path — fresh + resume both call it):
async #runBugFixCycle(bugfixDir: string, prdContent: string): Promise<TestResults> {
  const fixCycleWorkflow = new FixCycleWorkflow(
    bugfixDir, prdContent, this.taskOrchestrator, this.sessionManager,
    { parallelResearch: isParallelResearch(), researchDepth: getResearchDepth() }
  );
  return await fixCycleWorkflow.run();
}

// PATTERN (resume gate + branch at the top of the bug path):
const canAutoResume =
  this.mode !== 'validate' &&
  process.env.SKIP_BUG_FINDING !== 'true' &&
  !sessionPath.toLowerCase().includes('bugfix');
let finalResults: TestResults | null = null;
let resumed = false;
if (canAutoResume) {
  const interruptedDir = await this.#detectInterruptedBugfix(sessionPath);
  if (interruptedDir) {
    this.logger.info(`…resuming at ${interruptedDir}…`);
    try { finalResults = await this.#runBugFixCycle(interruptedDir, prdContent); resumed = true; }
    catch (e) { this.logger.warn(`…resume failed, fresh hunt: ${msg(e)}…`); }
  }
}
if (!resumed) {
  // …existing fresh Phase 1 (BugHuntWorkflow) + Phase 2 (mkdir/copyFile/#runBugFixCycle)…
  finalResults = …; // fresh path assigns
}
const resolvedResults = finalResults!; // guaranteed assigned by resume XOR fresh path

// ANTI-PATTERN (forbidden): running detection AFTER the fresh BugHuntWorkflow — it
//   overwrites TEST_RESULTS.md and re-creates bugfix/, destroying the interrupted state.
// ANTI-PATTERN (forbidden): calling mkdir/copyFile in the resume branch — the dir +
//   TEST_RESULTS.md already exist (that is the resume precondition).
// ANTI-PATTERN (forbidden): merging the resume try/catch with the fresh-path try/catch —
//   they have different fallback semantics (resume→fresh hunt; fresh→original results).
// ANTI-PATTERN (forbidden): adding an interactive prompt — S2's contract is automatic resume.
```

### Integration Points

```yaml
PIPELINE (prp-pipeline.ts runQACycle):
  - ADD: #detectInterruptedBugfix, #runBugFixCycle (extracted from Phase 2).
  - ADD: resume branch at top of bug path (after shouldRunQA===true + sessionPath
         validation, before fresh BugHuntWorkflow).
  - REFACTOR: Phase 2 inline construction → #runBugFixCycle call (byte-identical).
  - ADD: BacklogSchema value import.

FIX-CYCLE-WORKFLOW (fix-cycle-workflow.ts): NONE — owned by parallel P4.M2.T4.S1.
  S2 treats runStandardBreakdown (which writes tasks.json into the bugfix dir) as a
  black-box contract. The resume simply re-enters FixCycleWorkflow.run().

BUG-HUNT-WORKFLOW (bug-hunt-workflow.ts): NONE — owned by parallel P4.M2.T3.S1.

CONFIG (constants.ts): NONE (no env-var / no new constant). SKIP_BUG_FINDING is
  read via process.env directly (matches execution-guard.ts convention).

NO DATABASE / NO ROUTES / NO CLI FLAG / NO NEW DEPENDENCY / NO DOC EDITS (CONTRACT 5).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing prp-pipeline.ts — fix before proceeding
npm run lint            # eslint . --ext .ts  (expected: zero errors)
npm run format:check    # prettier --check    (run `npm run format` to fix)
npm run typecheck       # tsc --noEmit -p tsconfig.build.json (expected: zero errors)

# Canonical CI gate
npm run validate        # = lint && format:check && typecheck && test:run

# Expected: Zero errors. READ the output and fix before proceeding.
# Watch for: BacklogSchema unused-import error if Task 1 landed before Task 3
# (land Task 3 before validating, or temporarily reference it).
```

### Level 2: Unit Tests (Component Validation)

```bash
# The modified pipeline test (resume + regression)
npx vitest run tests/unit/workflows/prp-pipeline.test.ts

# Full workflows suite (nothing else regressed)
npx vitest run tests/unit/workflows/

# Expected: All pass. If an existing runQACycle test fails, you forgot to stub mockStat
# (Task 8) so #detectInterruptedBugfix ran unexpectedly in a fresh-hunt test.
```

### Level 3: Integration Testing (System Validation)

```bash
# Coverage gate — MUST stay 100% globally (vitest.config.ts)
npm run test:coverage
# Confirm the new branches are ALL covered:
#   #detectInterruptedBugfix: 4 interrupted returns + healthy null + no-TEST_RESULTS null
#   resume gate: canAutoResume true/false × detected/not × resume ok/fail
#   validate early-return, SKIP_BUG_FINDING skip, bugfix-child suppression

# Grep guards — resume path present, no forbidden edits
grep -n "#detectInterruptedBugfix\|#runBugFixCycle\|canAutoResume\|BacklogSchema" \
  src/workflows/prp-pipeline.ts   # Expected: all present
grep -n "BacklogSchema" src/workflows/prp-pipeline.ts   # Expected: 1 value import + 1 safeParse use

# Scope guard — fix-cycle-workflow.ts untouched (S1 owns it)
git diff --name-only
# Expected: src/workflows/prp-pipeline.ts + tests/unit/workflows/prp-pipeline.test.ts ONLY
git diff --name-only | grep -E "fix-cycle-workflow|bug-hunt-workflow"   # Expected: NO matches

# Expected: coverage 100%; grep guards clean; exactly 2 files changed.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral smoke (via the new vitest cases, since runQACycle has no direct CLI runner):
#   1. An interrupted bugfix dir (TEST_RESULTS.md + missing tasks.json) → runQACycle
#      resumes WITHOUT calling BugHuntWorkflow and WITHOUT mkdir/copyFile, and calls
#      FixCycleWorkflow on the EXISTING bugfix dir.
#   2. A healthy dir (TEST_RESULTS.md + valid tasks.json) → fresh BugHuntWorkflow runs.
#   3. SKIP_BUG_FINDING='true' with an interrupted dir → detection skipped → fresh hunt.
#   4. A bugfix-child sessionPath → suppression gate → fresh hunt (no re-entry).
#   5. Resume throws → fresh hunt fallthrough (pipeline not blocked).

# "Same path" guard: both fresh and resume construct FixCycleWorkflow via the SAME
# #runBugFixCycle helper (grep confirms a single construction site):
grep -n "new FixCycleWorkflow" src/workflows/prp-pipeline.ts   # Expected: exactly 1 match
# (inside #runBugFixCycle — NOT duplicated in runQACycle's Phase 2)

# Expected: all 5 behaviors pass; exactly one FixCycleWorkflow construction site.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed successfully
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run)
- [ ] `npm run test:coverage` 100% (global gate — all new branches covered)
- [ ] No linting errors: `npm run lint`
- [ ] No type errors: `npm run typecheck`
- [ ] No formatting issues: `npm run format:check`

### Feature Validation

- [ ] `#detectInterruptedBugfix` returns the bugfix dir when TEST_RESULTS.md present AND
      tasks.json missing/empty/corrupt-parse/corrupt-schema; returns null otherwise
- [ ] Resume branch sits after `shouldRunQA===true` + sessionPath validation, BEFORE the
      fresh `BugHuntWorkflow`
- [ ] Resume reuses the EXISTING bugfix dir + TEST_RESULTS.md (no mkdir/copyFile) and
      calls `#runBugFixCycle` → `FixCycleWorkflow.run()` → `runStandardBreakdown` (S1)
      regenerates tasks.json
- [ ] Resume gate: `mode !== 'validate' && SKIP_BUG_FINDING !== 'true' &&
      !sessionPath.includes('bugfix')`
- [ ] Resume failure falls through to the fresh bug hunt (pipeline not blocked)
- [ ] `#runBugFixCycle` is shared by fresh Phase 2 AND resume (single construction site)
- [ ] Existing fresh-hunt Phase 2 behavior byte-identical (mkdir/copyFile + try/catch kept)
- [ ] `--validate` and `SKIP_BUG_FINDING='true'` skip auto-detection
- [ ] Bug-fix-child sessionPath suppresses auto-detection (no re-entry loop)

### Code Quality Validation

- [ ] Follows existing patterns (private `#` methods, dynamic node: imports,
      this.logger.info/warn, vi.mock per-path branching)
- [ ] File placement matches the desired codebase tree (2 files only)
- [ ] Anti-patterns avoided (no detection after fresh hunt; no mkdir/copyFile on resume;
      no merged try/catch; no interactive prompt; no edit to fix-cycle-workflow.ts)
- [ ] BacklogSchema imported as a VALUE (runtime const), not type-only
- [ ] JSDoc cites PRD §4.4 step 3 on `#detectInterruptedBugfix` + the resume branch

### Documentation & Deployment

- [ ] CONTRACT (5): no doc edits (no user-facing/config/API surface change)
- [ ] No new environment variables (SKIP_BUG_FINDING is pre-existing, read-only)
- [ ] Code is self-documenting (method names + JSDoc explain the resume semantics)

---

## Anti-Patterns to Avoid

- ❌ Don't run detection AFTER the fresh `BugHuntWorkflow` — it overwrites
      `TEST_RESULTS.md` and re-creates `bugfix/`, destroying the interrupted state.
      Detection MUST be the first thing in the bug path.
- ❌ Don't `mkdir`/`copyFile` in the resume branch — the bugfix dir + TEST_RESULTS.md
      already exist (that is the resume precondition). Re-copying would overwrite the
      preserved bug report.
- ❌ Don't edit `fix-cycle-workflow.ts` — S1 (parallel item) owns it. Treat S1's
      `runStandardBreakdown` as a black-box contract that writes tasks.json into the
      bugfix dir. If `createFixTasks` still exists when you start, S1 hasn't landed —
      implement against the contract anyway (don't work around the old method).
- ❌ Don't merge the resume try/catch with the fresh-path try/catch — they have
      different fallback semantics (resume failure → fresh hunt; fresh-path fix failure
      → continue with original testResults). Keep them separate.
- ❌ Don't add an interactive "resume?" prompt — S2's LOGIC contract is **automatic**
      resume. The PRD §4.4 step 4 prompt is out of scope for this item.
- ❌ Don't use `existsSync` (sync, different module) — use async `stat` from
      `node:fs/promises` and catch ENOENT (consistent with the codebase's async fs style).
- ❌ Don't import `BacklogSchema` as a type — it is a runtime const; `safeParse` needs a
      value import. A type-only import makes `tsc` emit no binding and breaks at runtime.
- ❌ Don't forget to stub `mockStat` in the EXISTING `describe('runQACycle')` tests —
      after Task 5, those tests (mode='bug-hunt') also hit the resume gate; without a
      mockStat that returns "not interrupted," detection may run unexpectedly (Task 8).
- ❌ Don't assert "FixCycleWorkflow not called" in the HEALTHY-dir test (case 5) — the
      fresh hunt may then find bugs and call FixCycleWorkflow via Phase 2. Assert
      "BugHuntWorkflow called" instead to prove the fresh path ran.