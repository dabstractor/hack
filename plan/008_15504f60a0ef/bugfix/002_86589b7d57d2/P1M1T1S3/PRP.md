# PRP — P1.M1.T1.S3: Realistic-collision integration test (architect numbers from P1 with a NEW title)

> Bugfix 002, **BUG-001 (CRITICAL)** regression test. S1 (LANDED) added the pure renumber helpers
> (`renumberPhase`/`renumberMilestone`/`renumberTask`/`maxPhaseNumber`/`maxChildNumber`). S2
> (CONTRACT — parallel) rewires the 3 skip-on-collision branches to **renumber-and-append** so no
> architect item is ever dropped. **S3 adds the realistic-collision integration test** — the
> EXACT production scenario the 001 fixture avoided (architect emits `P1 'Reporting'`, colliding
> with patched `P1 'Foundation'`) — proving ADDED requirements survive renumbered. Test-only; no
> production code or docs change.

---

## Goal

**Feature Goal**: Add a regression test that exercises `mergeBacklogs` (and, optionally, the full
`decomposePRD`→`merge` path) with the **realistic** architect output a real Architect agent
produces: IDs numbered fresh from `P1`/`P1.M1` with a **brand-new title** derived from the delta
content. This is the case the existing `makeArchitectBacklog()` fixture deliberately avoids
(it reuses title `'Foundation'` + a fresh id `P1.M2`), and the case the QA probe proved was broken
(`Reporting phase present? false`). After S3, the test asserts the ADDED `'Reporting'` phase
SURVIVES — renumbered to a fresh unique id (`P2`) alongside the intact patched `'Foundation'`
phase — with NO duplicate ids anywhere.

**Deliverable**:
1. **`tests/integration/core/delta-breakdown-integration.test.ts`** — EDIT (append-only): a new
   `makeCollidingArchitectBacklog()` fixture (architect `P1 'Reporting'` → `P1.M1 'Reports'` →
   `P1.M1.T1`, ALL colliding), a new pure-function `describe('mergeBacklogs — realistic architect
   collision (BUG-001 regression)')` block calling `mergeBacklogs(parent, architect)` directly
   (no mocks), and (recommended strengthening) one full-path `it` that drives `decomposePRD` with
   the colliding fixture and asserts the renumbered phase lands in `tasks.json`. The existing 4
   non-colliding `it`s stay UNCHANGED.

**Success Definition**:
- `mergeBacklogs(parent, makeCollidingArchitectBacklog())` returns a backlog containing BOTH the
  patched `'Foundation'` phase (id `P1`, intact) AND the ADDED `'Reporting'` phase (renumbered to
  id `P2`, NOT `P1`), with the `'Reports'` milestone (`P2.M1`) and new task (`P2.M1.T1`) present.
- The patched `'Foundation'` phase + its `P1.M1` milestone + its `P1.M1.T1`/`P1.M1.T2` tasks are
  FULLY INTACT (original ids/statuses preserved — the merge is additive).
- NO duplicate ids anywhere in the merged backlog (`new Set(ids).size === ids.length`).
- (Full-path case, if included) the final delta `tasks.json` contains a phase titled `'Reporting'`
  with a renumbered id (`P2`), proving the fix survives the real `decomposePRD`→`merge` wiring.
- The existing 4 `it`s (non-colliding fixture) stay GREEN.
- `npx vitest run tests/integration/core/delta-breakdown-integration.test.ts` GREEN;
  `npx vitest run tests/unit/core/backlog-merger.test.ts` (S1+S2) stays GREEN;
  `npm run typecheck && npm run lint && npm run format:check` clean.

---

## Why

- **Locks in BUG-001.** The 001 fix's own integration test (`makeArchitectBacklog`) is hand-crafted
  to AVOID the collision (reuses title `'Foundation'` + fresh id `P1.M2`) — a combination a real
  architect never produces. The architect (`TASK_BREAKDOWN_PROMPT`, `src/agents/prompts.ts:134`)
  numbers fresh from `P1` and invents its own titles from `delta_prd.md`. So pre-S2, every ADDED
  requirement collided and was DROPPED. S3 is the test that would have caught BUG-001 and now
  guards against its recurrence. PRD §4.3 step 6 ("Identifies new requirements → Adds new tasks")
  needs this concrete regression lock.
- **Exercises the renumber-and-append phase branch end-to-end.** The 001 fixture only ever hits
  the EXTEND-by-title path (same title). S3 is the ONLY integration test that drives the NEW-title
  → renumber-append path (S2's rewire). The S2 unit tests cover the helpers in isolation; S3 proves
  the production scenario (`Reporting` survives) — the exact input the QA probe used.
- **Fills the documented mask.** The architecture doc's "Why the existing tests mask it" calls out
  `makeArchitectBacklog()` by name. S3 supplies the realistic fixture the doc's Test Plan asks for.
- **Scope discipline.** S3 writes ONLY to the integration test file. It does NOT modify
  `backlog-merger.ts` (S1/S2), `prp-pipeline.ts` (call sites), or `backlog-merger.test.ts`
  (S2 is rewriting it in parallel — collision risk).

---

## What

### User-visible behavior
None (test-only). Indirectly: this is the regression gate for "editing PRD.md to ADD a requirement
now produces new tasks even when the architect's fresh IDs collide with the parent's."

### Technical requirements (exact contract)

**File — `tests/integration/core/delta-breakdown-integration.test.ts`** (EDIT, append-only).
Three additions (the first two are mandatory; the third is a recommended strengthening):

**(1) New import** (top of file, near the existing `Backlog` type import):
```ts
import { mergeBacklogs } from '../../../src/core/backlog-merger.js';
```

**(2) New fixture `makeCollidingArchitectBacklog()`** — the EXACT production scenario (architect
numbers from `P1` with a NEW title; every id collides with the patched `Foundation` backlog):
```ts
/**
 * REALISTIC architect output (the case makeArchitectBacklog AVOIDS): the architect numbers fresh
 * from P1 (TASK_BREAKDOWN_PROMPT, prompts.ts:134) and invents its OWN title from the delta content.
 * So a new 'Reporting' requirement emits Phase id 'P1' title 'Reporting' (NEW title, colliding id),
 * Milestone id 'P1.M1' title 'Reports' (colliding), Task id 'P1.M1.T1' (colliding). Pre-S2 this was
 * DROPPED by mergeBacklogs (skip-on-collision); post-S2 it is renumbered-and-appended (BUG-001 fix).
 */
function makeCollidingArchitectBacklog(): Backlog {
  return {
    backlog: [
      {
        id: 'P1', // COLLIDES with patched Foundation's P1 — but title 'Reporting' is NEW
        type: 'Phase',
        title: 'Reporting',
        status: 'Planned',
        description: 'Reporting phase (ADDED requirement)',
        milestones: [
          {
            id: 'P1.M1', // COLLIDES with patched Core's P1.M1 — but title 'Reports' is NEW
            type: 'Milestone',
            title: 'Reports',
            status: 'Planned',
            description: 'Reports milestone (ADDED requirement)',
            tasks: [
              {
                id: 'P1.M1.T1', // COLLIDES with patched T1
                type: 'Task',
                title: 'New Report Task',
                status: 'Planned',
                description: 'Task for the ADDED requirement',
                subtasks: [sub('P1.M1.T1.S1')], // also collides
              },
            ],
          },
        ],
      },
    ],
  };
}
```

**(3) New pure-function describe block** (the core BUG-001 regression guard — `mergeBacklogs` is
pure; the file's module-level `vi.mock`s are inert for a direct call). Append at the bottom of the
file:
```ts
describe('mergeBacklogs — realistic architect collision (BUG-001 regression)', () => {
  it('renumbers (not drops) a NEW-title architect phase whose id collides — the production case', () => {
    const patched = makeParentBacklog();                 // P1 'Foundation' → P1.M1 → [T1, T2]
    const architect = makeCollidingArchitectBacklog();   // P1 'Reporting' → P1.M1 'Reports' → P1.M1.T1 (ALL collide)
    const merged = mergeBacklogs(patched, architect);

    const byTitle = Object.fromEntries(merged.backlog.map(p => [p.title, p]));

    // ADDED 'Reporting' phase SURVIVES — renumbered to a fresh unique id (NOT the colliding 'P1').
    expect(byTitle['Reporting']).toBeDefined();
    expect(byTitle['Reporting'].id).toBe('P2');
    expect(byTitle['Reporting'].id).not.toBe('P1');
    // Its 'Reports' milestone + new task survived (remapped, hierarchy-consistent ids).
    const reports = byTitle['Reporting'].milestones.find(m => m.title === 'Reports');
    expect(reports).toBeDefined();
    expect(reports!.id).toBe('P2.M1');
    expect(reports!.tasks.map(t => t.id)).toContain('P2.M1.T1');

    // Original 'Foundation' phase + its P1.M1 milestone are FULLY INTACT (original ids preserved).
    expect(byTitle['Foundation']).toBeDefined();
    expect(byTitle['Foundation'].id).toBe('P1');
    expect(byTitle['Foundation'].milestones.map(m => m.id)).toContain('P1.M1');
    expect(byTitle['Foundation'].milestones[0].tasks.map(t => t.id)).toEqual(['P1.M1.T1', 'P1.M1.T2']);

    // NO duplicate ids anywhere in the merged backlog (renumber guarantees uniqueness).
    const ids = collectIds(merged);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

**(4) [RECOMMENDED strengthening] Full-path colliding case.** Parametrize the existing
`setupAndDrive` to accept an architect backlog (backward-compatible default = `makeArchitectBacklog()`,
so the existing 4 `it`s are untouched), then add one `it` to the EXISTING `describe` that drives the
full path with the colliding fixture:
```ts
// CHANGE the signature (the ONLY edit to an existing function — backward compatible):
async function setupAndDrive(architectBacklog: Backlog = makeArchitectBacklog()): Promise<{ parent: SessionState; deltaPath: string }> {
  // ... unchanged ...
  mockState.architectBacklog = architectBacklog;   // was: mockState.architectBacklog = makeArchitectBacklog();
  // ... unchanged ...
}

// ADD to the existing describe('delta breakdown — full ...'):
it('survives a realistic architect collision end-to-end (Reporting phase renumbered into tasks.json)', async () => {
  const { deltaPath } = await setupAndDrive(makeCollidingArchitectBacklog());
  const final = JSON.parse(readFileSync(join(deltaPath, 'tasks.json'), 'utf-8')) as Backlog;
  const titles = final.backlog.map(p => p.title);
  expect(titles).toContain('Foundation');   // patched phase intact
  expect(titles).toContain('Reporting');    // ADDED phase survived the merge (renumbered, not dropped)
  const reporting = final.backlog.find(p => p.title === 'Reporting')!;
  expect(reporting.id).toBe('P2');           // renumbered to a fresh unique id (NOT P1)
  expect(reporting.id).not.toBe('P1');
  const ids = collectIds(final);
  expect(new Set(ids).size).toBe(ids.length); // no duplicate ids end-to-end
});
```

### Success Criteria
- [ ] `makeCollidingArchitectBacklog()` added (architect `P1 'Reporting'` → `P1.M1 'Reports'` → `P1.M1.T1`).
- [ ] Pure-function `it` asserts: 'Reporting' present @`P2` (not `P1`); 'Reports' milestone @`P2.M1`;
      new task @`P2.M1.T1`; 'Foundation' intact @`P1` with `P1.M1` + `P1.M1.T1`/`P1.M1.T2`; no dup ids.
- [ ] (If included) Full-path `it` asserts the final `tasks.json` has 'Reporting' @`P2` + 'Foundation'.
- [ ] The existing 4 non-colliding `it`s are UNCHANGED and stay GREEN.
- [ ] `npx vitest run tests/integration/core/delta-breakdown-integration.test.ts` GREEN.
- [ ] `npx vitest run tests/unit/core/backlog-merger.test.ts` (S1+S2) stays GREEN.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the exact S1+S2 contracts (helpers LANDED + rewire CONTRACT), the
exact renumber trace (architect `P1 'Reporting'` → `P2`), the existing test file's full structure
(fixtures + helpers + `setupAndDrive`), the per-assertion recipes, the collision-avoidance rule
(do NOT touch the S2-parallel `backlog-merger.test.ts`), and the executable validation commands.

### Documentation & References

```yaml
# MUST READ — the S2 CONTRACT (renumber-and-append at the 3 append points)
- file: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M1T1S2/PRP.md
  why: Defines the post-S2 mergeBacklogs behavior: a new-title Phase/Milestone whose ID collides is
        RENUMBERED-and-appended (NOT skipped). S3's assertions depend on this. If S2 is NOT yet
        landed, the pure-function test FAILS (Reporting dropped) — flag sequencing, don't paper over.

# MUST READ — S1's helper signatures (so assertions match the renumbered IDs)
- file: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M1T1S1/PRP.md
  why: renumberPhase(phase, maxPhaseNumber(reserved), reserved) → P{max+1}; renumberMilestone →
        {parentPhaseId}.M{msNum}; renumberTask → {parentMsId}.T{taskNum}; subtasks renumbered
        sequentially in input order. The renumber trace (§1 of S3's research note) follows these.

# MUST READ — chosen fix + why the 001 fixture masks the bug + the realistic Test Plan
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-001-backlog-merge.md
  section: "Why the existing tests mask it" and "Chosen fix" and "Test plan"
  why: Names makeArchitectBacklog() as the mask; gives the EXACT realistic scenario S3 implements;
        confirms renumber-at-the-append-point (NOT a blanket pre-pass).

# MUST READ — test design + the exact renumber trace (authored with this PRP)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M1T1S3/research/realistic-collision-test-design.md
  section: "1. The exact renumber trace" and "3. Pure-function test is the core"
  why: Confirms architect P1 'Reporting' → renumbered to P2 (maxPhaseNumber=2); the pure call is
        inert w.r.t. the file's vi.mocks; the full-path case is a strengthening, not the core.

# MUST READ — the file S3 EDITS (the existing integration test; full structure verified in-repo)
- file: tests/integration/core/delta-breakdown-integration.test.ts
  why: S3 APPENDS to this file. Reuse: makeParentBacklog() (P1 'Foundation' → P1.M1 → T1,T2), sub()
        (subtask factory + CS context_scope), collectIds() + findTask() (local walkers — task-utils
        is MOCKED), the module-level vi.mock block (INERT for a direct mergeBacklogs call), and
        setupAndDrive() (parametrize for the full-path case). The existing 4 `it`s stay unchanged.
  pattern: "function makeParentBacklog(): Backlog { … P1 'Foundation' → P1.M1 → [P1.M1.T1, P1.M1.T2] … }"
  gotcha: Do NOT vi.restoreAllMocks() in afterEach (the file already notes this — it reverts the
        hoisted mockImplementation). The existing `vi.clearAllMocks()` is correct; keep it.

# SOURCE — the production code under test (READ-ONLY for S3)
- file: src/core/backlog-merger.ts
  why: mergeBacklogs (:~210, the export S3 calls directly) + S1's renumber helpers (LANDED, appended
        under the "ID-renumbering helpers (BUG-001 fix — P1.M1.T1.S1)" banner). S3 consumes
        mergeBacklogs as a pure function. After S2 the skip-branches become renumber-and-append.
  critical: TODAY (pre-S2) the realistic fixture is DROPPED (skip-on-collision). S3's test is GREEN
        only after S2 lands. If running S3 in isolation fails, confirm S2 first (flag, don't "fix").

# SOURCE — data shapes (read-only)
- file: src/core/models.ts
  why: Backlog/Phase/Milestone/Task/Subtask shapes. Subtask needs context_scope (use the file's CS
        constant via sub()). IDs follow ^P\d+(\.M\d+(\.T\d+(\.S\d+)?)?)?$.
```

### Current Codebase tree (relevant slice)

```bash
src/core/backlog-merger.ts                       # READ-ONLY (S1 helpers LANDED; S2 rewire = CONTRACT)
src/workflows/prp-pipeline.ts                    # READ-ONLY (call sites unchanged)
tests/unit/core/backlog-merger.test.ts           # UNCHANGED — S2 rewrites it in parallel (DO NOT TOUCH)
tests/integration/core/
└── delta-breakdown-integration.test.ts          # ← S3 EDITS (append-only: fixture + describe + optional full-path it)
```

### Desired Codebase tree with files to be edited

```bash
tests/integration/core/delta-breakdown-integration.test.ts   # MODIFIED (append: import, fixture, describe, optional parametrize+it)
# No other files. No production code. No docs (test-only — matches the item's "DOCS: none").
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — S3 writes ONLY to tests/integration/core/delta-breakdown-integration.test.ts. Do NOT
//   modify backlog-merger.ts (S1/S2), prp-pipeline.ts, or backlog-merger.test.ts (S2 parallel).

// CRITICAL — the pure-function test is GREEN ONLY AFTER S2 lands. TODAY (pre-S2) the realistic
//   fixture is DROPPED (skip-on-collision) → 'Reporting' absent → the test FAILS. The orchestrator
//   sequences S2 before S3. If the test fails in isolation, CONFIRM S2 first (the 3 rewire branches
//   must renumber-and-append) — flag the sequencing, do NOT weaken the assertion to paper over a
//   missing S2.

// CRITICAL — do NOT delete or alter the existing non-colliding case (makeArchitectBacklog + the 4
//   `it`s). The item explicitly says "do not delete the existing non-colliding case." It exercises
//   the EXTEND-by-title path; S3 adds the NEW-title→renumber-append path. Both are needed.

// CRITICAL — the realistic fixture's title MUST be NEW ('Reporting'), NOT reused ('Foundation').
//   Reusing 'Foundation' → EXTEND-by-title path (no collision, the 001 mask). A NEW title → the
//   renumber-append path S3 is meant to guard. The id MUST collide ('P1') to exercise the branch.

// GOTCHA — mergeBacklogs is PURE. The file's module-level vi.mocks (session-manager, agent-factory,
//   task-patcher, …) are INERT for a direct mergeBacklogs(patched, architect) call — it imports only
//   models.ts. So the pure-function describe block needs NO additional mocks. Just import + call.

// GOTCHA — the renumber trace is DETERMINISTIC: maxPhaseNumber({P1,…}) = 2 → 'Reporting' → P2;
//   milestone → P2.M1; task → P2.M1.T1; subtask → P2.M1.T1.S1. Assert these exact ids. (If S2's
//   renumber ever changes numbering, the unit tests + this test surface it — that's the point.)

// GOTCHA — the full-path case parametrizes setupAndDrive with a BACKWARD-COMPATIBLE default
//   (architectBacklog = makeArchitectBacklog()). The existing 4 `it`s pass no arg → unchanged.
//   Change ONLY the signature + the one `mockState.architectBacklog =` line inside it.

// GOTCHA — afterEach must stay `vi.clearAllMocks()` (NOT vi.restoreAllMocks()) — the file already
//   documents this: restoreAllMocks reverts the hoisted mockImplementation (the architect's
//   tasks.json write, saveBacklog's memory-sync), breaking every test after the first.

// GOTCHA — collectIds() + findTask() are LOCAL walkers in the file (src/utils/task-utils is MOCKED).
//   Reuse collectIds() for the no-dup-ids assertion. Do NOT import task-utils helpers.

// GOTCHA — prettier is ERROR-enforced (prettier/prettier: error). Run `npm run fix` before format:check.

// GOTCHA — do NOT run the full `npm run test:run` as the gate. 178 pre-existing failures (bugfix
//   Issue 3 — P1.M4 scope) are NOT S3's concern. S3's gate: the integration file + backlog-merger.test.ts
//   (S1+S2 regression) + typecheck/lint/format. Adding S3's cases INCREASES backlog-merger.ts coverage.
```

---

## Implementation Blueprint

### Data models and structure (test fixtures)

```ts
import type { Backlog } from '../../../src/core/models.js';
import { mergeBacklogs } from '../../../src/core/backlog-merger.js';
// Reuse the file's existing: sub(), CS, makeParentBacklog(), collectIds(), findTask().
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT tests/integration/core/delta-breakdown-integration.test.ts — add the import + fixture
  - ADD `import { mergeBacklogs } from '../../../src/core/backlog-merger.js';` near the existing
        `import type { Backlog, … }` line (top of file).
  - APPEND `makeCollidingArchitectBacklog()` (the exact code in "Technical requirements" (2)) near
        `makeArchitectBacklog()`. Reuse the file's `sub()` factory (context_scope/CS already correct).
  - DO NOT modify makeParentBacklog / makeArchitectBacklog / patchParentBacklog / sub / CS / the mocks.
  - PLACEMENT: alongside the other fixture builders (logical grouping).

Task 2: APPEND the pure-function describe block (the core BUG-001 regression guard)
  - APPEND `describe('mergeBacklogs — realistic architect collision (BUG-001 regression)', () => { … })`
        at the BOTTOM of the file (after the existing describe). One `it` (the code in "Technical
        requirements" (3)).
  - The `it` calls `mergeBacklogs(makeParentBacklog(), makeCollidingArchitectBacklog())` directly
        (NO mocks; pure) and asserts: 'Reporting' @P2 (not P1); 'Reports' milestone @P2.M1; new task
        @P2.M1.T1; 'Foundation' intact @P1 with P1.M1 + P1.M1.T1/P1.M1.T2; no dup ids
        (`new Set(collectIds(merged)).size === collectIds(merged).length`).
  - EXPECTED (post-S2): GREEN. (Pre-S2: FAILS with 'Reporting' undefined — flag S2 sequencing.)

Task 3 (RECOMMENDED strengthening): ADD the full-path colliding case
  - PARAMETRIZE `setupAndDrive(architectBacklog: Backlog = makeArchitectBacklog())` — change ONLY
        the signature + the one `mockState.architectBacklog = architectBacklog;` line inside it.
        (Backward compatible: the existing 4 `it`s pass no arg → default → unchanged.)
  - ADD one `it` to the EXISTING describe: `setupAndDrive(makeCollidingArchitectBacklog())` → read
        final tasks.json → assert titles include 'Foundation' + 'Reporting'; 'Reporting'.id === 'P2'
        (not 'P1'); no dup ids. (The code in "Technical requirements" (4).)
  - EXPECTED (post-S2): GREEN end-to-end (architect mock writes the colliding fixture → decomposePRD
        reads it → mergeBacklogs renumbers → saveBacklog(merged) writes P2 'Reporting' to disk).

Task 4: FORMAT + VERIFY
  - RUN: npm run fix (lint:fix + prettier --write) → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/integration/core/delta-breakdown-integration.test.ts   # S3 + the 4 existing `it`s.
  - RUN: npx vitest run tests/unit/core/backlog-merger.test.ts   # S1 helper tests + S2 rewired merge tests.
  - EXPECTED: all green. If the pure-function 'Reporting' test fails with 'Reporting' undefined,
        S2 hasn't landed (skip-on-collision still drops it) — CONFIRM S2 before debugging the test.
        If a full-path `it` fails, check mockState.architectBacklog is set to the colliding fixture.
```

### Implementation Patterns & Key Details

```ts
// ---- the realistic-collision fixture (architect numbers from P1 with a NEW title) ----
function makeCollidingArchitectBacklog(): Backlog {
  return { backlog: [{
    id: 'P1', type: 'Phase', title: 'Reporting', status: 'Planned', description: 'Reporting phase (ADDED)',
    milestones: [{ id: 'P1.M1', type: 'Milestone', title: 'Reports', status: 'Planned', description: 'Reports (ADDED)',
      tasks: [{ id: 'P1.M1.T1', type: 'Task', title: 'New Report Task', status: 'Planned', description: 'New task (ADDED)',
        subtasks: [sub('P1.M1.T1.S1')] }] }],
  }] };
}
// Trace (post-S2): maxPhaseNumber({P1,P1.M1,…}) = 2 → renumberPhase → P2 'Reporting' → P2.M1 'Reports'
//   → P2.M1.T1 'New Report Task' → P2.M1.T1.S1. Patched P1 'Foundation' (P1.M1, P1.M1.T1, P1.M1.T2) intact.

// ---- the core pure-function assertion (the BUG-001 regression guard) ----
it('renumbers (not drops) a NEW-title architect phase whose id collides — the production case', () => {
  const merged = mergeBacklogs(makeParentBacklog(), makeCollidingArchitectBacklog());
  const byTitle = Object.fromEntries(merged.backlog.map(p => [p.title, p]));
  expect(byTitle['Reporting']).toBeDefined();
  expect(byTitle['Reporting'].id).toBe('P2');                       // renumbered, NOT the colliding P1
  expect(byTitle['Reporting'].milestones.find(m => m.title === 'Reports')!.id).toBe('P2.M1');
  expect(byTitle['Foundation']).toBeDefined();
  expect(byTitle['Foundation'].id).toBe('P1');                      // patched phase intact
  expect(byTitle['Foundation'].milestones[0].tasks.map(t => t.id)).toEqual(['P1.M1.T1', 'P1.M1.T2']);
  const ids = collectIds(merged);
  expect(new Set(ids).size).toBe(ids.length);                       // no duplicate ids
});

// ---- the full-path parametrization (backward compatible) + end-to-end case ----
async function setupAndDrive(architectBacklog: Backlog = makeArchitectBacklog()) {
  // … unchanged body …
  mockState.architectBacklog = architectBacklog;   // was: = makeArchitectBacklog();
  // … unchanged body …
}
it('survives a realistic architect collision end-to-end (Reporting renumbered into tasks.json)', async () => {
  const { deltaPath } = await setupAndDrive(makeCollidingArchitectBacklog());
  const final = JSON.parse(readFileSync(join(deltaPath, 'tasks.json'), 'utf-8')) as Backlog;
  expect(final.backlog.map(p => p.title)).toEqual(expect.arrayContaining(['Foundation', 'Reporting']));
  expect(final.backlog.find(p => p.title === 'Reporting')!.id).toBe('P2');
  expect(new Set(collectIds(final)).size).toBe(collectIds(final).length);
});
```

### Integration Points

```yaml
DEPENDS ON (must be LANDED before S3 is GREEN):
  - P1.M1.T1.S1 (renumber helpers): LANDED — renumberPhase/Milestone/Task + maxPhaseNumber/maxChildNumber.
  - P1.M1.T1.S2 (rewire skip→renumber-append): CONTRACT (parallel) — the 3 merge loops renumber-and-append.
        S3's 'Reporting' assertion FAILS without S2 (the realistic fixture is DROPPED pre-S2). The
        orchestrator sequences S2 before S3; if S3 fails in isolation, confirm S2 first.

NO PRODUCTION/DOCS CHANGE: S3 writes ONLY to the integration test file. backlog-merger.ts,
  prp-pipeline.ts, backlog-merger.test.ts are UNTOUCHED. The existing 4 non-colliding `it`s are
  preserved (the item: "do not delete the existing non-colliding case").
NO OTHER INTEGRATION: the pure-function test calls mergeBacklogs directly (no pipeline). The full-path
  case reuses the existing mocked drive. No CLI/orchestrator/agent surface.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean
npm run format:check         # prettier --check — clean
# Expected: all clean. If typecheck fails, the mergeBacklogs import path is wrong (../../../src/core/backlog-merger.js).
```

### Level 2: The Test + Regression Suite

```bash
# S3's file (the new describe + the 4 existing `it`s + the optional full-path case) — MUST be GREEN:
npx vitest run tests/integration/core/delta-breakdown-integration.test.ts
# S1+S2 regression — MUST stay GREEN (do NOT edit this file):
npx vitest run tests/unit/core/backlog-merger.test.ts
# Expected: both green. If the pure-function 'Reporting' test fails with `byTitle['Reporting']` undefined,
#   S2 hasn't landed (skip-on-collision still drops it) — CONFIRM S2 (src/core/backlog-merger.ts: the 3
#   loops must renumber-and-append, not skip) before debugging the test. Do NOT weaken the assertion.
# Do NOT run the full `npm run test:run` — 178 pre-existing failures (Issue 3) are P1.M4 scope.
```

### Level 3: Integration Smoke (the test IS the integration)

```bash
# The pure-function case IS the BUG-001 reproduction: it calls mergeBacklogs with the exact production
# fixture. Running it is the proof. A targeted source smoke confirming S1's helpers + S2's rewire are
# present (useful if 'Reporting' is undefined and you suspect a sequencing gap):
npx tsx -e "
import { readFileSync } from 'node:fs';
const src = readFileSync('src/core/backlog-merger.ts','utf8');
console.log('renumberPhase exported?', /export function renumberPhase/.test(src));
console.log('merge renumber-and-append (no skip)?', !/merge de-dup skip: architect phase/.test(src));
"
# Expected: renumberPhase exported? true ; merge renumber-and-append (no skip)? true.
#   (If the second is false, S2 hasn't rewired — S3 cannot pass yet; flag sequencing.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface. Domain checks (record in commit message):
#   - The ADDED 'Reporting' requirement SURVIVES mergeBacklogs (renumbered to P2) — BUG-001 fixed.
#   - The patched 'Foundation' phase is INTACT (P1, P1.M1, P1.M1.T1, P1.M1.T2 — original ids/statuses).
#   - NO duplicate ids anywhere (renumber guarantees uniqueness; assertion locks it).
#   - The existing non-colliding case is preserved (EXTEND-by-title path still covered).
#   - The full-path case (if included) proves the renumber survives decomposePRD→merge end-to-end.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/integration/core/delta-breakdown-integration.test.ts` GREEN.
- [ ] `npx vitest run tests/unit/core/backlog-merger.test.ts` GREEN (S1+S2 regression).

### Feature Validation
- [ ] `makeCollidingArchitectBacklog()` added (architect `P1 'Reporting'` → `P1.M1 'Reports'` → `P1.M1.T1`).
- [ ] Pure-function `it`: 'Reporting' present @`P2` (not `P1`); 'Reports' @`P2.M1`; new task @`P2.M1.T1`;
      'Foundation' intact @`P1` with `P1.M1` + `P1.M1.T1`/`P1.M1.T2`; no duplicate ids.
- [ ] (If included) Full-path `it`: final `tasks.json` has 'Reporting' @`P2` + 'Foundation'.
- [ ] The existing 4 non-colliding `it`s UNCHANGED + GREEN.

### Code Quality Validation
- [ ] ONLY `tests/integration/core/delta-breakdown-integration.test.ts` is edited (append-only).
- [ ] `backlog-merger.ts` / `prp-pipeline.ts` / `backlog-merger.test.ts` UNTOUCHED.
- [ ] The realistic fixture uses a NEW title ('Reporting') + colliding id ('P1') — NOT the 001 mask.
- [ ] The pure-function test calls `mergeBacklogs` directly (no mocks needed — it's pure).
- [ ] `setupAndDrive` parametrization is backward-compatible (default = `makeArchitectBacklog()`).
- [ ] afterEach stays `vi.clearAllMocks()` (not `restoreAllMocks`).

### Documentation & Deployment
- [ ] No docs change (test-only — matches the item's "DOCS: none").
- [ ] Commit message notes: BUG-001 regression guard; the realistic-collision fixture (architect
      numbers from P1 with NEW title) the 001 fixture avoided; depends on S1 (helpers) LANDED +
      S2 (rewire) CONTRACT; assertion fails pre-S2 (flag sequencing, don't weaken).

---

## Anti-Patterns to Avoid

- ❌ Don't weaken the assertion to make it pass pre-S2 — if 'Reporting' is undefined, S2 hasn't
      landed (skip-on-collision still drops it). CONFIRM S2 first; flag the sequencing. A green test
      that doesn't assert survival is worse than no test (it re-masks BUG-001).
- ❌ Don't edit `backlog-merger.ts`, `prp-pipeline.ts`, or `backlog-merger.test.ts` — S3 is test-only
      and the unit test file is S2's parallel scope (collision risk).
- ❌ Don't delete or alter the existing non-colliding case (`makeArchitectBacklog` + the 4 `it`s) —
      the item explicitly forbids it; it covers the EXTEND-by-title path.
- ❌ Don't reuse the title `'Foundation'` in the colliding fixture — that EXTENDS by title (no
      collision, the 001 mask). The fixture MUST use a NEW title ('Reporting') + a colliding id ('P1').
- ❌ Don't add mocks for the pure-function test — `mergeBacklogs` is pure; the file's module-level
      vi.mocks are inert for a direct call. Just import + call + assert.
- ❌ Don't `vi.restoreAllMocks()` in afterEach — it reverts the hoisted mockImplementation (the
      architect's tasks.json write, saveBacklog's memory-sync), breaking every test after the first.
      Keep the existing `vi.clearAllMocks()`.
- ❌ Don't import `src/utils/task-utils` helpers — it's MOCKED in this file. Use the local
      `collectIds()`/`findTask()` walkers.
- ❌ Don't guess the renumbered id — it's deterministic: `maxPhaseNumber({P1,…})=2` → 'P2'. Assert
      `P2` exactly (not "some id ≠ P1"). The unit tests + this test surface any renumber change.
- ❌ Don't run the full `npm run test:run` as the gate — 178 pre-existing failures (Issue 3, P1.M4).
      Gate = the integration file + backlog-merger.test.ts + typecheck/lint/format.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a test-only, append-only edit to a file whose full structure is verified in-repo
(fixtures `makeParentBacklog`/`makeArchitectBacklog`/`sub`/`CS`, helpers `collectIds`/`findTask`,
the `setupAndDrive` drive, the module-level `vi.mock` block). The S1 helpers are LANDED (verified in
source) and S2's rewire is a precise CONTRACT (3 append-points → renumber-and-append), so the
renumber trace is deterministic and fully worked out (architect `P1 'Reporting'` → `P2`). The
pure-function test is the core regression guard (no mocks — `mergeBacklogs` is pure; the file's
vi.mocks are inert for a direct call), and the full-path case is a backward-compatible
parametrization. The one critical sequencing caveat (the test is GREEN only post-S2) is explicitly
flagged with a "flag, don't weaken" rule. Residual risks: (a) the test failing in isolation if S2
hasn't landed (flag sequencing — the assertion must NOT be weakened); (b) a prettier nit (auto-fixed);
(c) the full-path case's `setupAndDrive` parametrization needing the exact one-line edit (specified).
No external/runtime unknowns.