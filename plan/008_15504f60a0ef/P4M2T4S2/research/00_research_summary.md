# Research Summary — P4.M2.T4.S2: Auto-detect & resume interrupted bugfix breakdowns

## 1. The interrupted state (PRD §4.4 step 3)

A bugfix run killed **between committing the bug report and finishing task
breakdown** leaves the bugfix dir with a `TEST_RESULTS.md` but **no `tasks.json`**
(or an empty/corrupt one). The pipeline MUST auto-detect this and re-enter the
breakdown path, regenerating `tasks.json` via the standard full breakdown.

## 2. The bugfix pipeline path (where detection belongs)

`PRPPipeline.run()` → `runQACycle()` (`src/workflows/prp-pipeline.ts:1469`).
Inside `runQACycle`:

- **Phase 1 — fresh bug hunt** (`:1544`): `new BugHuntWorkflow(...).run(sessionPath)`.
- **Phase 2 — fix cycle** (`:1562-1640`): creates `bugfix/` dir, **copies the
  fresh `TEST_RESULTS.md` into it**, constructs `new FixCycleWorkflow(bugfixSessionPath, prdContent, taskOrchestrator, sessionManager, researchConfig)`, calls `.run()`.

`FixCycleWorkflow.run()` (`fix-cycle-workflow.ts:369`) → (after S1) **`runStandardBreakdown()`**
builds a mini-PRD from the loaded `TestResults`, runs the Architect agent which
**writes `tasks.json` into the bugfix dir**, reads it back, flattens to subtasks.

**Detection MUST sit at the start of `runQACycle`'s bug path — BEFORE the fresh
bug hunt** (otherwise the hunt overwrites `TEST_RESULTS.md` and re-creates
`bugfix/`, destroying the interrupted state).

## 3. Bugfix dir layout (current code)

`runQACycle:1571` → `const bugfixSessionPath = resolve(sessionPath, 'bugfix');`
→ single `plan/NNN_hash/bugfix/` dir containing `TEST_RESULTS.md` + `tasks.json`.
(FS shows older sessions used `bugfix/001_hash/` numbered dirs, but the CURRENT
code + S1 produce a single `bugfix/` dir. Detection targets `sessionPath/bugfix/`.)

## 4. Gating — "skip in validate / skip-bug-finding"

- `this.mode === 'validate'` → `runQACycle` returns EARLY (`:1485-1490`) before
  the bug path. So validate is handled structurally; include `mode !== 'validate'`
  defensively in the resume gate anyway.
- `--skip-bug-finding` → `process.env.SKIP_BUG_FINDING === 'true'`. It is **only
  READ** in `src/utils/validation/execution-guard.ts:68` + debug logging — it is
  NEVER set by our code (external flag / bug-fix-child signal). Resume gate must
  check `process.env.SKIP_BUG_FINDING !== 'true'`.

## 5. Suppression — "suppress re-entry inside bug-fix children"

A bug-fix child is identified by **`sessionPath.includes('bugfix')`**
(`session-validation.ts:73 validateBugfixSession` + `execution-guard.ts:68`).
The main session's `runQACycle` sessionPath does NOT contain `bugfix`, so the
resume gate `!sessionPath.toLowerCase().includes('bugfix')` suppresses re-detection
in any bugfix context. This is the belt-and-suspenders guard against infinite
detect→resume→detect loops.

## 6. "Corrupt tasks.json" detection (PRD: "fails JSON parse or BacklogSchema")

- `BacklogSchema` (`src/core/models.ts:797`) = `z.object({ backlog: z.array(PhaseSchema) })`.
- `prp-pipeline.ts:29` imports `Backlog` as a **type only** — must ADD `BacklogSchema`
  to a **value** import for `BacklogSchema.safeParse(...)`.
- Detection: `TEST_RESULTS.md` exists AND (`tasks.json` missing OR empty-after-trim
  OR `JSON.parse` throws OR `BacklogSchema.safeParse(...).success === false`).

## 7. "Re-enter the same path the bug-hunt stage uses"

Both the fresh-hunt Phase 2 and the resume branch construct
`new FixCycleWorkflow(bugfixDir, prdContent, taskOrchestrator, sessionManager,
researchConfig)` and call `.run()`. Extract a shared private helper
`#runBugFixCycle(bugfixDir, prdContent): Promise<TestResults>` used by BOTH so the
"same path" guarantee holds verbatim. The resume branch SKIPS `mkdir`+`copyFile`
(the dir + `TEST_RESULTS.md` already exist — that is the whole point).

## 8. Corrupt-file regeneration works

`runStandardBreakdown` (S1) calls the Architect, which **overwrites** `$TASKS_FILE`
(= `${bugfixDir}/tasks.json`) via atomic write. So a corrupt file is regenerated
cleanly on resume. The detection's only job is to DECIDE to resume; regeneration
happens inside `runStandardBreakdown`.

## 9. Test patterns (`tests/unit/workflows/prp-pipeline.test.ts`)

- Top-level `vi.mock('node:fs/promises', ...)` (`:18`) exports `readFile, writeFile,
  mkdir, copyFile`. **ADD `stat: vi.fn()`** for the detection's existence checks
  (no existing tested path calls `stat` → safe addition).
- `MockBugHuntWorkflow` / `MockFixCycleWorkflow` (`:173-174`) cast `vi.fn()`.
- `describe('runQACycle')` (`:570`) sets `pipeline.mode = 'bug-hunt'` to force QA,
  stubs BugHunt→bugs + FixCycle→clean, asserts `MockFixCycleWorkflow.toHaveBeenCalledWith(...)`.
- `mockReadFile` is per-path branched via `mockImplementation` (same as
  `decomposePRD` tests). Detection tests branch on `TEST_RESULTS.md` vs `tasks.json`.
- `vi.stubEnv('SKIP_BUG_FINDING', 'true')` + `vi.unstubAllEnvs()` for the skip test.
- Bug-fix-child suppression test: set the mock session's `metadata.path` to include
  `bugfix` (e.g. `plan/008_x/bugfix/001_y`).

## 10. Out of scope (explicitly)

- Interactive prompt "before resuming an incomplete bug fix cycle" (PRD §4.4 step 4)
  is NOT in this item's contract LOGIC → S2 implements **automatic** (non-interactive)
  resume. The prompt is a separate/future concern.
- Numbered `bugfix/NNN_hash/` session creation (PRD §4.4 step 3) is owned by the
  bug-hunt path, not S2. S2 detects the single `bugfix/` dir the current code creates.

## 11. Dependency on S1 (parallel item — treated as contract)

S1's `runStandardBreakdown()` (renamed from `createFixTasks`) + `#buildBugFixMiniPrd()`
is what WRITES `tasks.json` into the bugfix dir. S2's resume re-enters that exact
path. S2 does NOT touch `fix-cycle-workflow.ts` (S1 owns it).