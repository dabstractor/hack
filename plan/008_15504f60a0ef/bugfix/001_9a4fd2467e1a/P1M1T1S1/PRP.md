# PRP — P1.M1.T1.S1: Reorder `decomposePRD()` to check `isDelta` before `hasBacklog` early-return

> Bugfix 001, **Issue 1 (CRITICAL)** of
> `plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/TEST_RESULTS.md`.
> The delta-session breakdown is unreachable: `decomposePRD()` checks `hasBacklog`
> before `isDelta`, and `spawnDeltaSession()` step 7 always saves a non-empty
> patched backlog, so the `isDelta`/`loadDeltaPRD` branch is dead code in
> production — `delta_prd.md` is written but never consumed, and ADDED
> requirements are silently dropped.

---

## Goal

**Feature Goal**: In `src/workflows/prp-pipeline.ts` `decomposePRD()`, move the
`isDelta` computation and the `loadDeltaPRD`-vs-`prdSnapshot` decision ABOVE the
`hasBacklog` early-return, and gate the ORIGINAL `hasBacklog` block behind
`if (!isDelta)`. After this change, a delta session ALWAYS runs the Architect
breakdown over `delta_prd.md` (PRD §4.3 step 5), regardless of the pre-existing
patched backlog — making the delta branch reachable for the first time in
production.

**Deliverable**: A reordered `decomposePRD()` whose control flow is:
1. Compute `sessionPath` + `isDelta` FIRST.
2. `if (!isDelta)` → run the ORIGINAL `hasBacklog` early-return (byte-for-byte
   unchanged); non-delta sessions with existing backlogs still skip.
3. Shared tail (unchanged): create Architect → load `delta_prd.md` (delta) or
   `prdSnapshot` (non-delta) → prompt → run → read `tasks.json` → save.
…plus an updated JSDoc `@remarks` on `decomposePRD()` (Mode A). The merge of the
architect's output with the patched backlog is **P1.M1.T1.S2** (deliberately out
of scope); S1 leaves a clean, commented seam at the `saveBacklog` call.

**Success Definition**:
- For a delta session, `decomposePRD()` reaches `loadDeltaPRD(sessionPath)` and
  invokes the Architect over `delta_prd.md` content, then reads `tasks.json`
  (previously dead code in production).
- For a non-delta session, the `hasBacklog` early-return behaves EXACTLY as
  today (no behavior change).
- The missing-`delta_prd.md` try/catch error handling is preserved.
- The method signature is unchanged: `async decomposePRD(): Promise<void>`.
- `tests/unit/core/delta-prd.test.ts` (incl. CASE A) still passes.
- `npm run typecheck && npm run lint && npm run format:check` are clean.

---

## Why

- **Fixes a Critical correctness defect (TEST_RESULTS.md Issue 1).** Any newly
  ADDED requirement in an edited `PRD.md` is silently dropped — no task is ever
  created — because the delta breakdown never runs. PRD §4.3 step 5 ("Breakdown
  MUST consume the delta PRD") and step 6 ("Identifies new requirements → Adds
  new tasks") are violated.
- **Root cause is ordering, not logic.** The `isDelta` branch and the
  `loadDeltaPRD` call already EXIST and are correct in isolation; they are simply
  placed BELOW a guard that always short-circuits them. The fix is a pure
  control-flow reorder — low risk, high impact.
- **Unblocks P1.M1.T1.S2 (merge) and P1.M1.T1.S3 (integration test).** S2 adds
  the backlog merge (patched ⊕ architect-output); S3 adds the non-empty-parent-
  backlog acceptance test. Both depend on the delta branch being reachable,
  which only S1 establishes.
- **Scope discipline.** S1 is the reorder ONLY. The merge (S2), the real
  integration test (S3), and `patchBacklog` `'added'` handling (P1.M2) are
  separate subtasks. Implementing them here would collide.

---

## What

### User-visible behavior
None directly (internal pipeline control flow). Indirectly, once S2/S3 land: when
a user edits `PRD.md` to add a requirement, the delta session's Architect runs
over `delta_prd.md` and new tasks are produced (the merge + test land in S2/S3).

### Technical requirements (exact contract)

**File:** `src/workflows/prp-pipeline.ts`, method `decomposePRD()` (lines 1107–1213).

**The reorder (move + wrap; the shared tail is unchanged):**

Current order (BUGGY):
```
backlog / hasBacklog ─► if (hasBacklog) RETURN ─► dynamic imports ─► architect ─► sessionPath / isDelta ─► prdContent ─► prompt ─► run ─► read tasks.json ─► save
```

Target order (FIXED):
```
sessionPath / isDelta ─► if (!isDelta) { backlog/hasBacklog; if (hasBacklog) RETURN } ─► dynamic imports ─► architect ─► prdContent (delta→loadDeltaPRD | non-delta→prdSnapshot) ─► prompt ─► run ─► read tasks.json ─► save [S2 SEAM]
```

Concretely:
1. **Move** the `sessionPath` and `isDelta` computation (currently lines ~1149–1156) to the TOP of the `try` block, before the `backlog`/`hasBacklog` lines.
2. **Wrap** the entire ORIGINAL `hasBacklog` block (the `backlog`/`hasBacklog` computation, the `if (hasBacklog) { … return; }` early-return, and the "New session, generating backlog from PRD" log) inside `if (!isDelta) { … }`. Do NOT change a token inside that block.
3. **Add** an `else` log for the delta case (e.g. `'Delta session — breakdown over delta_prd.md (PRD §4.3 step 5)'`).
4. The shared tail (dynamic imports → `createArchitectAgent` → `loadDeltaPRD`/`prdSnapshot` → `createArchitectPrompt` → `retryAgentPrompt` → `result.status` check → `readFile(tasks.json)` → `saveBacklog` → counts/logs) is **unchanged**, except:
5. **Annotate the S2 seam**: at the `saveBacklog(parsedBacklog)` call, add a comment stating that for delta sessions this is the P1.M1.T1.S2 merge point (merge `parsedBacklog` with the in-memory patched backlog `currentSession.taskRegistry` before saving). See the data-flow gotcha below.
6. **Preserve** the `loadDeltaPRD` try/catch that throws the clear "Delta session has no delta_prd.md …" error — do NOT remove or weaken it.

**JSDoc (Mode A):** update the `decomposePRD()` `@remarks` (lines 1098–1106) to
state that delta sessions ALWAYS run the breakdown over `delta_prd.md`
(PRD §4.3 step 5) regardless of a pre-existing patched backlog, and that
non-delta sessions retain the `hasBacklog` early-return. Cite bugfix Issue 1.

### Success Criteria
- [ ] `sessionPath` and `isDelta` computed before the `hasBacklog` block.
- [ ] The original `hasBacklog` early-return is wrapped in `if (!isDelta)` and is byte-for-byte unchanged.
- [ ] Delta sessions reach `loadDeltaPRD(sessionPath)` and the Architect `.prompt()` call.
- [ ] The `loadDeltaPRD` try/catch (missing `delta_prd.md` → clear error) is preserved.
- [ ] `decomposePRD()` still reads `tasks.json` and reaches `saveBacklog` (the S2 seam).
- [ ] Non-delta sessions behave exactly as before (existing `hasBacklog` skip intact).
- [ ] Method signature unchanged: `async decomposePRD(): Promise<void>`.
- [ ] `decomposePRD()` JSDoc documents the delta-always-breaks-down behavior.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/delta-prd.test.ts` green (CASE A + render/write/load cases).

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the exact current control flow (with line numbers), the exact
target order, the byte-for-byte-preserved block, the data-flow gotcha that informs the S2 seam,
the existing test's mocking surface (so the reorder won't break it), and the executable
validation commands are all specified below.

### Documentation & References

```yaml
# MUST READ — root cause + fix strategy
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/architecture/delta_workflow.md
  section: "Issue 1: Delta-Session Breakdown Unreachable (CRITICAL)" and "Fix Strategy: Approach A"
  why: Confirms patchedBacklog is ALWAYS non-empty (so hasBacklog always true for delta) and gives
        the reorder approach this PRP implements.
  critical: The merge of architect-output with patched backlog is Approach A's second half — that
        is S2, NOT S1. S1 only does the reorder (makes the branch reachable).

# MUST READ — the verbatim bug report
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/TEST_RESULTS.md
  section: "Issue 1" (h3.0)
  why: The authoritative defect statement + repro + "Why the existing test missed it".

# MUST READ — reorder line-plan + S2 seam data-flow (authored with this PRP)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P1M1T1S1/research/decomposeprd-reorder.md
  section: "3. The reorder (S1 scope = CONTROL FLOW ONLY)" and "4. The S2 seam"
  why: Step-by-step reorder with the before/after control-flow diagrams and the critical
        in-memory-vs-disk data-flow fact S2 depends on.

# PATTERN FILE — the only file being edited
- file: src/workflows/prp-pipeline.ts
  why: decomposePRD() at lines 1107-1213. loadDeltaPRD is imported at line 61. The reorder moves
        lines ~1149-1156 above ~1110-1124 and wraps ~1110-1124 in `if (!isDelta)`.
  pattern: "sessionPath = currentSession!.metadata.path ; isDelta = currentSession?.metadata.parentSession != null ; loadDeltaPRD(sessionPath) in try/catch"
  gotcha: createArchitectAgent is created ONCE before the retry closure (§6.1 xhigh-budget
        invariant — see the comment at lines ~1134-1143). The reorder must keep a single
        createArchitectAgent() call in the shared tail; do NOT duplicate it per branch.

# TEST FILE — verify, do NOT rewrite (S3 owns the new integration test)
- file: tests/unit/core/delta-prd.test.ts
  why: Already mocks the architect surface: vi.mock architect-prompt.js (L28), agent-factory.js
        (L33), session-manager.js (L40), task-patcher.js (L57), task-utils.js (L60),
        execution-guard.js (L63). CASE A (L383) uses makeDeltaSession() with EMPTY backlog
        ({ backlog: [] }, L101). After S1's reorder CASE A still passes (isDelta→skip hasBacklog).
  pattern: "vi.mock('../../../src/agents/agent-factory.js', () => ({ createArchitectAgent: vi.fn(...) }))"
  gotcha: CASE A's empty-backlog precondition is what MASKED the bug (it never hits the non-empty
        case). S1 must keep CASE A green; S3 replaces it with a non-empty-parent-backlog test.
        Do NOT add the non-empty test in S1.

# VERIFIED API SURFACE (do not re-discover)
- symbol: loadDeltaPRD(sessionPath): Promise<string>   # session-utils.ts:1480 — reads delta_prd.md
- symbol: this.sessionManager.currentSession!.metadata.path            # session dir (non-null asserted today)
- symbol: this.sessionManager.currentSession?.metadata.parentSession   # null ⇒ non-delta; set ⇒ delta
- symbol: this.sessionManager.currentSession?.taskRegistry            # in-memory patched backlog (NOT clobbered by architect disk write)
- symbol: this.sessionManager.currentSession?.prdSnapshot             # full resolved PRD (non-delta breakdown input)
```

### Current Codebase tree (relevant slice)

```bash
src/workflows/prp-pipeline.ts   # EDIT — decomposePRD() reorder + JSDoc @remarks
tests/unit/core/delta-prd.test.ts   # UNCHANGED (verify it stays green; S3 owns the new test)
src/core/session-utils.ts       # READ-ONLY (loadDeltaPRD at :1480 — consumed, not modified)
```

### Desired Codebase tree with files to be added/edited

```bash
src/workflows/prp-pipeline.ts   # MODIFIED (decomposePRD control-flow reorder + JSDoc — the ONLY edit)
# No new files. No test changes (S3 owns the integration test). No docs files (Mode A: JSDoc is the doc).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — S1 is the REORDER ONLY. Do NOT implement the backlog merge (that is S2:
//   merge parsedBacklog with the in-memory patched backlog before saving). Do NOT add
//   the non-empty-parent-backlog integration test (S3). Do NOT touch patchBacklog
//   'added' (P1.M2). Leave a commented S2 seam at the saveBacklog call.

// CRITICAL (data flow for the S2 seam) — the Architect agent WRITES tasks.json itself
//   (to $TASKS_FILE). So after architectAgent.prompt(), the on-disk patched backlog
//   (saved by spawnDeltaSession step 7) is OVERWRITTEN by the architect's output. BUT
//   the IN-MEMORY currentSession.taskRegistry (the patched backlog) is NOT touched by
//   that disk write. S2 will merge parsedBacklog (disk, added tasks) with
//   currentSession.taskRegistry (in-memory, patched) then saveBacklog(merged). S1 must
//   preserve the currentSession.taskRegistry reference (it's the existing `backlog`
//   variable's source) and just annotate the seam — do NOT lose it.

// GOTCHA — keep a SINGLE createArchitectAgent() call in the shared tail. The §6.1
//   invariant (Architect created ONCE with xhigh budget; retry re-invokes the SAME
//   instance) is regression-locked by a unit test. Do NOT move/duplicate the call into
//   the delta vs non-delta branches.

// GOTCHA — byte-for-byte preserve the ORIGINAL hasBacklog block. Only its POSITION
//   changes (now nested under `if (!isDelta)`). A diff review should show a cut+paste
//   + one `if (!isDelta) {` wrapper + an `else { log }`, nothing inside the block edited.

// GOTCHA — sessionPath uses non-null assertion `currentSession!.metadata.path` (as today,
//   line ~1149). Moving it above the hasBacklog guard is safe: decomposePRD is only called
//   after session init, so currentSession is non-null (the existing code already assumes it).

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — do NOT run the full `npm run test:run` as the S1 gate. The wider suite has 297
//   pre-existing failures (bugfix Issue 3, unrelated to this delta — P2/P3 scope). S1's gate
//   is typecheck + lint + format + the targeted delta-prd.test.ts.
```

---

## Implementation Blueprint

### Data models and structure
None — pure control-flow reorder within one method; no types/constants/classes.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/workflows/prp-pipeline.ts — reorder decomposePRD() control flow
  - MOVE the `sessionPath` + `isDelta` computation (currently ~L1149-1156) to the TOP of the
        try block, immediately after `this.logger.info('[PRPPipeline] Decomposing PRD');`.
  - WRAP the ORIGINAL `hasBacklog` block (~L1110-1124: the backlog/hasBacklog computation,
        the `if (hasBacklog) { log; totalTasks=#countTasks(); phase='prd_decomposed'; return; }`,
        and the 'New session, generating backlog from PRD' log) inside `if (!isDelta) { ... }`.
  - ADD an `else { this.logger.info('[PRPPipeline] Delta session — breakdown over delta_prd.md (PRD §4.3 step 5)'); }`.
  - KEEP the shared tail UNCHANGED: dynamic imports → createArchitectAgent (single call) →
        loadDeltaPRD/prdSnapshot (with the missing-delta_prd.md try/catch PRESERVED) →
        createArchitectPrompt → retryAgentPrompt → result.status check → readFile(tasks.json) →
        saveBacklog → counts/logs/currentPhase.
  - ANNOTATE the saveBacklog(parsedBacklog) line with the S2-seam comment (see §4 of the research note).
  - DO NOT: add merge logic, add tests, touch patchBacklog, change the signature, or remove the
        loadDeltaPRD try/catch.

Task 2: EDIT src/workflows/prp-pipeline.ts — update decomposePRD() JSDoc (Mode A)
  - UPDATE the @remarks block (L1098-1106) to state: delta sessions ALWAYS run the breakdown
        over delta_prd.md (PRD §4.3 step 5) regardless of a pre-existing patched backlog;
        non-delta sessions retain the hasBacklog early-return. Cite bugfix Issue 1.

Task 3: FORMAT + VERIFY
  - RUN: npm run fix (lint:fix + prettier --write) → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/delta-prd.test.ts   # MUST stay green (CASE A + render/write/load).
  - EXPECTED: all clean; delta-prd.test.ts green. A pure reorder cannot introduce type errors.
        If CASE A fails, the reorder broke the non-empty-vs-empty precedence — re-check the wrapper.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the reordered decomposePRD() head (skeleton; shared tail unchanged, shown abbreviated).
async decomposePRD(): Promise<void> {
  this.logger.info('[PRPPipeline] Decomposing PRD');
  try {
    // MOVED UP: resolve session + delta-ness FIRST so the hasBacklog guard below
    // only applies to NON-delta sessions (PRD §4.3 step 5; bugfix Issue 1).
    const sessionPath = this.sessionManager.currentSession!.metadata.path;
    const isDelta =
      this.sessionManager.currentSession?.metadata.parentSession != null;

    if (!isDelta) {
      // ORIGINAL hasBacklog early-return — BYTE-FOR-BYTE UNCHANGED (non-delta only).
      const backlog = this.sessionManager.currentSession?.taskRegistry;
      const hasBacklog = backlog && backlog.backlog.length > 0;
      if (hasBacklog) {
        this.logger.info('[PRPPipeline] Existing backlog found, skipping generation');
        this.totalTasks = this.#countTasks();
        this.currentPhase = 'prd_decomposed';
        return;
      }
      this.logger.info('[PRPPipeline] New session, generating backlog from PRD');
    } else {
      this.logger.info('[PRPPipeline] Delta session — breakdown over delta_prd.md (PRD §4.3 step 5)');
    }

    // ── SHARED TAIL (unchanged) ──
    const { createArchitectAgent } = await import('../agents/agent-factory.js');
    const { createArchitectPrompt } = await import('../agents/prompts/architect-prompt.js');
    const architectAgent = createArchitectAgent();   // ONCE — §6.1 xhigh invariant

    let prdContent: string;
    if (isDelta) {
      try {
        prdContent = await loadDeltaPRD(sessionPath);   // delta_prd.md (the diffs)
      } catch {
        throw new Error(`Delta session has no delta_prd.md at ${sessionPath} — cannot break down the delta. Re-run to regenerate it via the delta spawn path.`);
      }
    } else {
      prdContent = this.sessionManager.currentSession?.prdSnapshot ?? '';
    }

    const architectPrompt = createArchitectPrompt(prdContent, sessionPath);
    const result = await retryAgentPrompt(() => architectAgent.prompt(architectPrompt), { agentType: 'Architect', operation: 'decomposePRD' });
    if (result.status === 'error') throw new Error(`Architect agent failed: ${result.error?.message ?? 'unknown agent error'}`);

    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const parsedBacklog = JSON.parse(await readFile(resolve(sessionPath, 'tasks.json'), 'utf-8')) as Backlog;

    // S2 SEAM (P1.M1.T1.S2): for delta sessions, MERGE parsedBacklog (added tasks from
    // delta_prd.md) with the in-memory patched backlog (currentSession.taskRegistry —
    // modified→Planned, removed→Obsolete) BEFORE saving. The architect's write above
    // clobbers tasks.json on disk, but currentSession.taskRegistry (in-memory) is intact
    // and available for the merge. S1 saves the architect output directly; S2 replaces
    // this line with: saveBacklog(mergeBacklogs(currentSession.taskRegistry, parsedBacklog)).
    await this.sessionManager.saveBacklog(parsedBacklog);

    this.totalTasks = this.#countTasks();
    this.logger.info(`[PRPPipeline] Generated ${parsedBacklog.backlog.length} phases`);
    this.logger.info(`[PRPPipeline] Total tasks: ${this.totalTasks}`);
    this.currentPhase = 'prd_decomposed';
    this.logger.info('[PRPPipeline] PRD decomposition complete');
  } catch (error) {
    // ... unchanged catch ...
  }
}
```

### Integration Points

```yaml
DOWNSTREAM (S1 ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T1.S2 (merge): replaces the saveBacklog(parsedBacklog) seam with a merge of the
        architect's added-tasks output and the in-memory patched backlog, then saves merged.
        Depends on the delta branch being reachable (this subtask).
  - P1.M1.T1.S3 (integration test): drives FULL handleDelta → spawnDeltaSession → decomposePRD
        with a NON-EMPTY parent backlog; asserts the architect is invoked over delta_prd.md and
        added requirements produce new tasks. Replaces CASE A's empty-backlog precondition.
  - P1.M2.T1 (patchBacklog 'added'): removes the silent-drop in task-patcher.ts ~L97. Depends on
        the delta breakdown running (this subtask) so added reqs are handled by the architect.

NO OTHER INTEGRATION: the reorder is internal to decomposePRD(). loadDeltaPRD, the architect
  factory/prompt, retryAgentPrompt, and saveBacklog are consumed unchanged.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean
npm run format:check         # prettier --check — clean
# Expected: all clean. A pure reorder cannot introduce type errors; if typecheck fails, the
# move orphaned a binding (e.g. sessionPath referenced before its new declaration site) — fix placement.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The S1 gate — the delta suite MUST stay green (CASE A + render/write/load):
npx vitest run tests/unit/core/delta-prd.test.ts
# Expected: all green. CASE A (delta session, empty backlog) still reaches the architect mock:
#   isDelta true → skip hasBacklog (would've been false anyway) → loadDeltaPRD → architect.prompt.
# If CASE A fails, the reorder changed the empty-vs-non-empty precedence — re-check the `if (!isDelta)` wrapper.
# Do NOT run the full `npm run test:run` — 297 pre-existing failures (bugfix Issue 3) are P2/P3 scope.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S1 — the real integration test (handleDelta → spawnDeltaSession → decomposePRD with a
# NON-EMPTY parent backlog) is P1.M1.T1.S3. S1's job is to make the delta branch REACHABLE; S3
# proves it end-to-end and S2 makes the output correct (merge). A targeted source-level smoke:
npx tsx -e "
import { readFileSync } from 'node:fs';
const src = readFileSync('src/workflows/prp-pipeline.ts','utf8');
const dIdx = src.indexOf('async decomposePRD()');
const head = src.slice(dIdx, dIdx+1200);
const isDeltaFirst = head.indexOf('isDelta') < head.indexOf('hasBacklog');
console.log('isDelta computed before hasBacklog?', isDeltaFirst);
console.log('hasBacklog wrapped in if(!isDelta)?', /if\s*\(!isDelta\)/.test(head));
"
# Expected: isDelta computed before hasBacklog? true ; hasBacklog wrapped in if(!isDelta)? true.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — a control-flow reorder with no creative surface. Domain checks (record in commit msg):
#   - Delta sessions now reach loadDeltaPRD + architect.prompt (previously dead code).
#   - Non-delta hasBacklog early-return byte-for-byte unchanged (diff = cut+paste + wrapper).
#   - loadDeltaPRD missing-file try/catch preserved.
#   - Single createArchitectAgent() call retained (§6.1 xhigh invariant).
#   - S2 seam annotated at saveBacklog; merge NOT implemented here.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/delta-prd.test.ts` green (no regression).

### Feature Validation
- [ ] `sessionPath` + `isDelta` computed before the `hasBacklog` block.
- [ ] Original `hasBacklog` early-return wrapped in `if (!isDelta)`; byte-for-byte unchanged.
- [ ] Delta sessions reach `loadDeltaPRD(sessionPath)` and `architectAgent.prompt(...)`.
- [ ] Missing-`delta_prd.md` try/catch preserved (clear error thrown).
- [ ] `decomposePRD()` reads `tasks.json` and reaches the `saveBacklog` S2 seam.
- [ ] Non-delta sessions behave exactly as before.
- [ ] Method signature unchanged: `async decomposePRD(): Promise<void>`.

### Code Quality Validation
- [ ] Only `src/workflows/prp-pipeline.ts` is modified (reorder + JSDoc) — no other file.
- [ ] Single `createArchitectAgent()` call in the shared tail (§6.1 invariant preserved).
- [ ] The `saveBacklog` call carries a clear S2-merge-seam comment.
- [ ] No merge logic added (S2); no new tests added (S3); patchBacklog untouched (P1.M2).
- [ ] Original `hasBacklog` block diff = cut+paste only (no token-level edits).

### Documentation & Deployment
- [ ] `decomposePRD()` JSDoc `@remarks` documents delta-always-breaks-down over delta_prd.md (Mode A).
- [ ] Commit message notes: delta branch now reachable; merge = S2; integration test = S3; non-delta unchanged.

---

## Anti-Patterns to Avoid

- ❌ Don't implement the backlog merge — that's S2. S1 only reorders (makes the branch reachable) and annotates the seam.
- ❌ Don't add the non-empty-parent-backlog integration test — that's S3. S1 keeps the existing CASE A green.
- ❌ Don't touch `patchBacklog` `'added'` (task-patcher.ts) — that's P1.M2.
- ❌ Don't edit tokens inside the original `hasBacklog` block — only its position/wrapper changes.
- ❌ Don't duplicate `createArchitectAgent()` per branch — keep the single shared call (§6.1 xhigh invariant is regression-locked).
- ❌ Don't remove or weaken the `loadDeltaPRD` missing-file try/catch — the contract explicitly requires keeping it.
- ❌ Don't change the method signature.
- ❌ Don't run the full `npm run test:run` as the S1 gate — 297 pre-existing unrelated failures (Issue 3, P2/P3 scope). Use the targeted `delta-prd.test.ts`.
- ❌ Don't "fix" CASE A's empty-backlog precondition in S1 — that's S3's job (and S3 is where the bug-masking test gets replaced).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a pure control-flow reorder within a single method — no logic change, no new
types, no signature change. The current order and the exact target order are documented with line
numbers, the byte-for-byte-preserved block is identified, the data-flow gotcha driving the S2 seam
is spelled out (architect clobbers disk tasks.json; in-memory patched backlog survives for S2's
merge), and the existing test surface (delta-prd.test.ts with its mocking) is confirmed compatible
with the reorder (CASE A still reaches the architect mock). The single residual risk is
accidentally editing a token inside the moved `hasBacklog` block or duplicating the
`createArchitectAgent()` call — both explicitly called out as anti-patterns. The validation is
concrete: typecheck + lint + format + the targeted delta suite. No external/runtime unknowns.