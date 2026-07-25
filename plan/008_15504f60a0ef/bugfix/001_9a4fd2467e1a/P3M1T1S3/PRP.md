# PRP — P3.M1.T1.S3: Update #detectInterruptedBugfix() to scan numbered bugfix/ children

---

## Goal

**Feature Goal**: Rewrite the **detection** side of the bugfix-interruption
recovery path to mirror the **creation** side that S2 (Implementing) lands.
`#detectInterruptedBugfix()` (prp-pipeline.ts:2045) currently checks the FLAT
`resolve(sessionPath, 'bugfix')` dir for an interrupted state. With S2 now
creating **numbered** `bugfix/NNN_hash/` children (PRD §4.4 step 3, §5.1), S3
must scan ALL numbered children of `sessionPath/bugfix/`, apply the existing
interrupted-state checks to each, and return the **most recent** interrupted
child (or `null`). Healthy/completed children are SKIPPED so resume works across
multiple iterations. The Backlog validation swaps from strict `BacklogSchema`
to lenient `BacklogReadSchema` (read-time semantics, per contract item 3 + PRD
§5.1 survival requirement).

**Deliverable** (2 files):
1. **`src/workflows/prp-pipeline.ts`** — MODIFY:
   - **Import** (line ≈36): swap `BacklogSchema` → `BacklogReadSchema` (grep
     confirms `BacklogSchema` is used ONLY at line 2086 + the JSDoc text at
     2037; safe to replace both). `BacklogReadSchema` is exported at
     `src/core/models.ts:975` (added by P2.M2.T1.S1).
   - **Rewrite `#detectInterruptedBugfix()`** (lines 2045-2095): scan numbered
     `bugfix/NNN_hash/` children, apply the existing 6-step interrupted check
     per child (now using `BacklogReadSchema`), return the most-recent
     interrupted child or `null`. Update the JSDoc (Mode A, contract item 5) to
     document numbered-child scanning.
2. **`tests/unit/workflows/prp-pipeline.test.ts`** — MODIFY:
   - **Ensure `readdir` is in the `vi.mock('node:fs/promises', …)` block**
     (lines 17-23). S2 (Implementing) adds `readdir` to this mock for its own
     `runQACycle` test; S3 depends on it. If S2 hasn't landed it, S3 adds it
     (`readdir: vi.fn()`). **Treat S2's mock addition as a contract.**
   - **UPDATE the existing `describe('resume interrupted bugfix breakdowns')`
     suite** (lines 809-989): each test now stubs `readdir` to return a numbered
     child (e.g. `[{name:'001_aaaaaaaaaaaa', isDirectory:()=>true}]`) so the
     scan reaches the per-child checks. The existing `mockStat`/`mockReadFile`
     suffix-matching (`s.endsWith('TEST_RESULTS.md')`) still works because the
     paths become `…/bugfix/001_aaaaaaaaaaaa/TEST_RESULTS.md`.
   - **ADD new tests** for the multi-child scan: most-recent-interrupted wins;
     healthy-most-recent → older-interrupted returned; all healthy → `null`;
     ENOENT on `bugfix/` → `null`; non-`NNN_` entries ignored; child without
     TEST_RESULTS.md skipped.

**Success Definition**:
- `#detectInterruptedBugfix(sessionPath)` returns the path to the **most recent
  interrupted** numbered `bugfix/NNN_hash/` child, or `null` if none interrupted.
- A `bugfix/` dir with `001` (healthy) + `002` (interrupted) → returns `002`.
- A `bugfix/` dir with `001` (interrupted) + `002` (healthy) → returns `001`
  (the most recent INTERRUPTED one; `002` is skipped as healthy). Per contract
  item 3e/f.
- A `bugfix/` dir with all-healthy children → `null` (fresh hunt runs).
- No `bugfix/` dir (ENOENT) → `null` (never hunted).
- The Backlog validation uses `BacklogReadSchema` (lenient read-time), so legacy/
  hand-edited sessions with doc-format fields are NOT falsely flagged as corrupt.
- Resume-interrupted-breakdown works across multiple iterations (contract item 4
  OUTPUT); prior completed iterations are skipped, not re-run.
- `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.

---

## User Persona (if applicable)

**Target User**: The pipeline's QA resume path — internal caller, not a human.
**Use Case**: The orchestrator re-enters `runQACycle` after a crash; before
running a fresh bug hunt, it calls `#detectInterruptedBugfix(sessionPath)` to
find any numbered `bugfix/NNN_hash/` child left mid-breakdown and resume it
instead of hunting again.
**User Journey**: crash mid-fix in `bugfix/002_hash/` → restart →
`#detectInterruptedBugfix` scans `bugfix/`, finds `002_hash/` has TEST_RESULTS.md
but a corrupt tasks.json → returns `…/bugfix/002_hash/` →
`#runBugFixCycle(…/002_hash/)` resumes the breakdown (001_hash/ is healthy and
skipped).
**Pain Points Addressed**: Today detection only sees the FLAT `bugfix/` dir; once
S2 creates numbered dirs, a session interrupted in `bugfix/002_hash/` is INVISIBLE
to detection → the resume path is silently dead → every restart re-runs a fresh
bug hunt, losing the interrupted iteration's work. S3 restores mutual
consistency (architecture doc: creation + detection must both use numbered dirs).

---

## Why

- **PRD compliance**: PRD §4.4 step 3 — *"Each bug hunt iteration creates a new
  numbered session: `bugfix/001_hash/`, `bugfix/002_hash/`, etc."*; §5.1 —
  *"Session structure: `plan/NNN_hash/bugfix/NNN_hash/`"*. The bugfix doc Issue 4
  (h3.3) mandates scanning numbered children.
- **Mutual consistency**: the architecture doc (`bugfix_numbering.md`) explicitly
  states *"if creation uses `bugfix/NNN_hash/`, detection must scan
  `bugfix/NNN_hash/` children."* S2 lands numbered CREATION; S3 lands numbered
  DETECTION. They land together as P3.M1.T1.
- **Read-time leniency (contract item 3)**: `BacklogReadSchema` (P2.M2.T1.S1)
  exists precisely for recovery-oriented reads — a strict `BacklogSchema` reject
  on a doc-format field would falsely flag a hand-edited/legacy session as
  "interrupted/corrupt," triggering needless re-research. PRD §5.1 mandates the
  pipeline SURVIVE such sessions.
- **Resume across iterations**: the flat layout allowed only one iteration;
  numbered layout + scan-and-skip-healthy lets resume find the LATEST interrupted
  iteration while preserving completed ones (audit trail).

### Out of scope (hard fences)
- **`nextBugfixDir` / `generateBugfixHash`** → S1 (DONE). S3 may reuse the
  `/^\d{3}_/` regex shape but does NOT import S1's private `BUGFIX_DIR_PATTERN`
  (it's not exported; S1 is Complete — don't re-open). Define a LOCAL regex.
- **`runQACycle` creation path** → S2 (Implementing). Do NOT touch.
- **Lifecycle test suite** → S4 (Planned). S3 adds detection-scan unit tests for
  coverage; S4 owns the broader end-to-end numbered-iteration suite.
- **`FixCycleWorkflow`** → READ-ONLY (numbered path still contains `'bugfix'`;
  architecture doc confirms).
- **External docs** (`README.md`, `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`)
  → P3.M1.T2.S1. S3's contract item 5 (DOCS, Mode A) is the JSDoc on
  `#detectInterruptedBugfix` ONLY.
- **`PRD.md` / `tasks.json` / `prd_snapshot.md` / `vitest.config.ts`** → READ-ONLY.
- **`src/core/models.ts`** (`BacklogReadSchema` definition) → READ-ONLY (P2.M2.T1.S1).

---

## What

### User-visible behavior
None at the CLI surface (internal recovery-path change). Operators who restart
after a crash during a numbered bugfix iteration will see (in logs) the resume
path find and resume the specific `bugfix/NNN_hash/` child instead of re-running
a fresh bug hunt.

### Technical requirements (exact contract — items 3, 4, 5)

**(a) Import swap (prp-pipeline.ts ≈line 36).** Replace
`import { BacklogSchema } from '../core/models.js';` with
`import { BacklogReadSchema } from '../core/models.js';`. Grep confirms
`BacklogSchema` is used ONLY at line 2086 (the `safeParse` check) + the JSDoc
text at line 2037 — both are updated in steps (b)/(c). No other symbol from the
models import block changes.

**(b) Rewrite `#detectInterruptedBugfix()` (lines 2045-2095).** New body per
contract item 3 (a-f):

```ts
/**
 * Detect the most recent numbered bugfix child left in an interrupted state
 * (PRD §4.4 step 3, §5.1).
 *
 * @remarks
 * Scans ALL numbered children (`NNN_hash/`) of `sessionPath/bugfix/` and returns
 * the MOST RECENT one whose breakdown did not finish. "Interrupted" = the child
 * has a bug report (`TEST_RESULTS.md`) but its `tasks.json` is missing, empty,
 * unreadable, fails JSON parse, or fails `BacklogReadSchema` (lenient read-time)
 * validation. Children with a valid `tasks.json` (healthy/completed) are SKIPPED,
 * so resume works across multiple iterations (prior completed iterations are
 * preserved, not re-run). Children without `TEST_RESULTS.md` are skipped (never
 * properly hunted). Returns `null` when there is nothing to resume (no `bugfix/`
 * dir, no numbered children, or all children healthy).
 *
 * Mutual consistency with S2: `runQACycle` CREATES numbered `bugfix/NNN_hash/`
 * children; this method DETECTS them. The returned path still contains `'bugfix'`,
 * so `FixCycleWorkflow`'s path validation passes unchanged.
 *
 * @param sessionPath - The MAIN session dir (plan/NNN_hash).
 * @returns The most recent interrupted numbered bugfix child dir, or null.
 * @private
 */
async #detectInterruptedBugfix(sessionPath: string): Promise<string | null> {
  const { resolve } = await import('node:path');
  const { readdir, stat, readFile } = await import('node:fs/promises');

  const BUGFIX_CHILD_PATTERN = /^\d{3}_/;
  const bugfixDir = resolve(sessionPath, 'bugfix');

  // (a) Read sessionPath/bugfix/ — ENOENT means never hunted.
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(bugfixDir, { withFileTypes: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return null; // no bugfix/ dir → never hunted
    }
    throw error; // non-ENOENT → propagate (unexpected)
  }

  // (b)+(c) Filter to numbered NNN_* child DIRS, sort by sequence DESC (most recent first).
  const numberedChildren = entries
    .filter((e) => e.isDirectory() && BUGFIX_CHILD_PATTERN.test(e.name))
    .map((e) => {
      const seq = parseInt(e.name.slice(0, 3), 10);
      return { dir: resolve(bugfixDir, e.name), seq: Number.isNaN(seq) ? -1 : seq };
    })
    .filter((c) => c.seq >= 0)
    .sort((a, b) => b.seq - a.seq);

  // (d)+(e)+(f) Find the first (most recent) interrupted child.
  for (const child of numberedChildren) {
    const interrupted = await this.#isBugfixChildInterrupted(child.dir);
    if (interrupted) {
      return child.dir; // most recent interrupted
    }
    // healthy (or never-hunted) → skip, continue to older children
  }
  return null; // no interrupted child
}
```

**(c) Extract the per-child interrupted check into a private helper.** Pull the
existing 6-step logic (FACT 1) into `#isBugfixChildInterrupted(childDir)` so the
per-child check is testable and the scan loop reads cleanly:

```ts
/**
 * Check a single numbered bugfix child dir for an interrupted-breakdown state.
 *
 * @remarks
 * "Interrupted" = `TEST_RESULTS.md` exists (a bug report was committed) but
 * `tasks.json` is missing, empty, unreadable, fails JSON parse, or fails
 * `BacklogReadSchema` (lenient read-time) validation. A child WITHOUT
 * `TEST_RESULTS.md` returns `false` (never properly hunted → skip).
 *
 * @param childDir - A numbered bugfix/NNN_hash/ child dir.
 * @returns true if this child is interrupted (should be resumed).
 * @private
 */
async #isBugfixChildInterrupted(childDir: string): Promise<boolean> {
  const { resolve } = await import('node:path');
  const { stat, readFile } = await import('node:fs/promises');
  const testResultsPath = resolve(childDir, 'TEST_RESULTS.md');
  const tasksPath = resolve(childDir, 'tasks.json');

  // No bug report → never hunted in this child → not interrupted (skip).
  try {
    await stat(testResultsPath);
  } catch {
    return false;
  }

  // Bug report present → tasks.json must be valid; anything else = interrupted.
  try {
    await stat(tasksPath);
  } catch {
    return true; // missing
  }
  let content: string;
  try {
    content = await readFile(tasksPath, 'utf-8');
  } catch {
    return true; // unreadable
  }
  if (content.trim() === '') {
    return true; // empty
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return true; // corrupt JSON
  }
  if (!BacklogReadSchema.safeParse(parsed).success) {
    return true; // invalid Backlog (lenient read-time schema)
  }
  return false; // healthy
}
```

**(d) Mode-A JSDoc.** The `#detectInterruptedBugfix` JSDoc (in (b) above)
documents the numbered-child scanning. The `#isBugfixChildInterrupted` JSDoc
(in (c)) documents the per-child contract + the `BacklogReadSchema` swap.

### Success Criteria
- [ ] `#detectInterruptedBugfix` scans numbered `bugfix/NNN_hash/` children
      (filters `/^\d{3}_/`, sorts by NNN desc), applies the interrupted check
      per child, returns the **most recent interrupted** child or `null`.
- [ ] Healthy children are SKIPPED (continue to older); all-healthy → `null`.
- [ ] ENOENT on `bugfix/` → `null`; non-ENOENT rethrow (propagate).
- [ ] Non-`NNN_` entries (e.g. `architecture/`, stray files) are ignored.
- [ ] A child without `TEST_RESULTS.md` is skipped (returns false from
      `#isBugfixChildInterrupted`).
- [ ] Backlog validation uses `BacklogReadSchema` (lenient), NOT `BacklogSchema`.
- [ ] The caller (`runQACycle` line 1807) is UNCHANGED — it still does
      `const interruptedDir = await this.#detectInterruptedBugfix(sessionPath)`
      and passes the result to `#runBugFixCycle`.
- [ ] `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** This is a 2-file change (one source rewrite of ~50 lines split into two
private methods + one import swap; one test update + additions). Correctness
rests on ten pre-proven facts (all pinned in the gap analysis + below): (1) the
**exact current implementation** (lines 2045-2095, 6-step flat-dir check); (2)
the **caller** at line 1807 (`runQACycle` resume gate, unchanged contract); (3)
the **`BacklogSchema`→`BacklogReadSchema` swap** sites (import line 36, use line
2086, JSDoc text line 2037 — all three updated; no other `BacklogSchema` use in
the file); (4) the **scan algorithm** (readdir + filter `/^\d{3}_/` + sort desc +
per-child check); (5) **`BacklogReadSchema` is exported** at models.ts:975
(P2.M2.T1.S1) with the read-time-lenient semantics the swap needs; (6) the
**fs mock gap** — `readdir` is NOT in the test's `vi.mock('node:fs/promises')`
(lines 17-23); S2 adds it, S3 depends on it (treat as contract); (7) the
**existing resume suite** (lines 809-989) uses `mockStat`/`mockReadFile` suffix
matching that still works on numbered child paths (`endsWith('TEST_RESULTS.md')`);
(8) **per-child "no TEST_RESULTS.md" semantics** — skip (never-hunted child),
per FACT 9; (9) **100% branch coverage** — every new branch (ENOENT-on-bugfixdir,
empty-after-filter, healthy-skip, each per-child state, all-healthy→null) needs a
test; (10) **scope fences** — S1 Complete (don't re-open), S2 Implementing
(don't touch runQACycle), S4 owns lifecycle, the local regex avoids importing
S1's private const.

### Documentation & References
```yaml
# MUST READ — the PRD spec (provided in selected_prd_content)
- docfile: PRD.md (bugfix doc)
  section: "Issue 4: Bugfix sessions use a flat bugfix/ directory" (h3.3) +
       "Overview" (h2.0) + PRD §4.4 step 3 / §5.1 (cited inside Issue 4)
  why: Issue 4 mandates numbered `bugfix/NNN_hash/` + scanning numbered children.
  critical: PRD §5.1 "plan/NNN_hash/bugfix/NNN_hash/" + the lenient-read survival
            requirement (drives the BacklogReadSchema swap).

# MUST READ — this subtask's research (proven facts about the live tree)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P3M1T1S3/research/s3-gap-analysis.md
  section: FACT 1 (current impl), FACT 2 (caller), FACT 3 (BacklogReadSchema swap),
       FACT 4 (scan algo + local-regex decision), FACT 5 (sort+seq), FACT 6 (fs mock
       gap — S2 contract), FACT 7 (existing test stub updates), FACT 8 (coverage
       branch list), FACT 9 (per-child no-TEST_RESULTS.md semantics), FACT 10 (scope)
  why: Proves every edit site, the import-swap safety, the scan algorithm, the
       BacklogReadSchema rationale, the fs-mock dependency on S2, the per-child
       semantics, and the exact test additions needed for 100% coverage.

# MUST READ — S2 contract (creation side; S3 is the detection counterpart)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P3M1T1S2/PRP.md
  section: "Goal" (runQACycle creates numbered bugfix/NNN_hash/) + "Known Gotchas"
       (the readdir fs-mock gap — S2 ADDS readdir to the test mock; S3 depends on it)
  why: S2 lands numbered CREATION; S3 lands numbered DETECTION. They must be mutually
       consistent (architecture doc). S2's fs-mock `readdir` addition is a CONTRACT
       S3 relies on (if absent, S3 adds it). S3 must NOT touch runQACycle.

# MUST READ — S1 contract (the numbering primitive; confirms the regex shape)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P3M1T1S1/PRP.md
  section: "What §a" (BUGFIX_DIR_PATTERN = /^(\d{3})_/ at session-utils.ts:782)
  why: S1's regex confirms the NNN_ shape S3 mirrors LOCALLY (S1's const is NOT
       exported; S1 is Complete — don't re-open. Define a local
       BUGFIX_CHILD_PATTERN = /^\d{3}_/ in #detectInterruptedBugfix).

# MUST READ — architecture reference (cited by the contract RESEARCH NOTE)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/architecture/bugfix_numbering.md
  section: "### Fix Strategy" step 2 ("Update #detectInterruptedBugfix() to scan
       ALL numbered children") + "### Mutual Consistency Note" +
       "### FixCycleWorkflow Path Validation"
  why: Confirms the scan semantics (return most-recent interrupted, skip healthy,
       archive prior iterations), the mutual-consistency requirement with S2, and
       that FixCycleWorkflow's includes('bugfix') check passes on numbered paths.

# MUST READ — P2.M2.T1.S1 (the lenient read schema S3 must use)
- docfile: src/core/models.ts
  section: BacklogReadSchema (line 975) + its JSDoc (967-973)
  why: BacklogReadSchema is the lenient read-time validator S3 swaps IN (replacing
       strict BacklogSchema). Its JSDoc mandates: "the pipeline must SURVIVE legacy,
       hand-edited, externally-authored, and test-fixture sessions that don't carry
       the contract prefix." READ-ONLY for S3 (P2.M2.T1.S1 owns it).

# THE FILE TO EDIT — source (the detection rewrite)
- file: src/workflows/prp-pipeline.ts
  section: (1) import line ≈36 — swap BacklogSchema → BacklogReadSchema;
       (2) #detectInterruptedBugfix (lines 2045-2095) — REWRITE to scan numbered
       children + extract #isBugfixChildInterrupted helper; (3) the JSDoc above
       #detectInterruptedBugfix (lines 2030-2044) — update for numbered scanning +
       BacklogReadSchema.
  why: This is the SOLE detection site. The caller (runQACycle line 1807) is
       path-agnostic — it passes the returned dir to #runBugFixCycle, which works
       on any bugfix/NNN_hash/ path.
  pattern: the existing 6-step interrupted check (now extracted into
       #isBugfixChildInterrupted); the existing dynamic-import local style
       (`await import('node:fs/promises')`).
  gotcha: define BUGFIX_CHILD_PATTERN LOCALLY (S1's BUGFIX_DIR_PATTERN is not
       exported; don't re-open S1). Use readdir({withFileTypes:true}) + filter
       isDirectory(). Sort DESC by parseInt(name.slice(0,3)). Non-ENOENT readdir
       errors PROPAGATE (rethrow) — only ENOENT → null.

# THE FILE TO EDIT — tests (fs mock + resume suite updates + new scan tests)
- file: tests/unit/workflows/prp-pipeline.test.ts
  section: (1) vi.mock('node:fs/promises') (lines 17-23) — ensure `readdir` is
       present (S2 adds it; if missing, add `readdir: vi.fn()`); (2) existing
       describe('resume interrupted bugfix breakdowns') (809-989) — update each
       test to stub readdir to return a numbered child; (3) ADD new describe
       (or it() cases) for multi-child scan semantics.
  why: Without readdir in the fs mock, #detectInterruptedBugfix's readdir(...)
       is undefined → TypeError → all resume tests break. The existing tests
       assume the flat dir; they must stub a numbered child to reach the per-child
       checks. New tests cover the scan-control branches for 100% coverage.
  pattern: existing mockStat/mockReadFile suffix matching (s.endsWith(
       'TEST_RESULTS.md')); existing stubMissingTasks helper; Dirent mocks as
       { name: '002_aaaaaaaaaaaa', isDirectory: () => true }.
  gotcha: the paths inside #isBugfixChildInterrupted are child-scoped
       (…/bugfix/002_…/TEST_RESULTS.md), so the existing endsWith matching STILL
       works — just stub readdir to return the numbered child. For "multiple
       children" tests, mockStat must distinguish children by the NNN in the path
       (e.g. s.includes('002_') → interrupted; s.includes('001_') → healthy).

# CONTRACT INPUTS (read-only)
- file: src/core/session-utils.ts
  section: BUGFIX_DIR_PATTERN (line 782, NOT exported), nextBugfixDir (847),
       generateBugfixHash (808).
  why: Confirms the NNN_ regex shape S3 mirrors locally. S3 does NOT import from
       S1's helper (it's not exported + S1 is Complete). READ-ONLY.
- file: vitest.config.ts
  why: 100/100/100/100 thresholds on src/**/*.ts — every new branch in the
       rewritten #detectInterruptedBugfix + #isBugfixChildInterrupted must be
       covered.
- file: package.json
  why: npm run validate = lint + format:check + typecheck + test:run (the green gate).
```

### Current Codebase tree (relevant slice)
```bash
src/
  workflows/
    prp-pipeline.ts            # EDIT — swap BacklogSchema→BacklogReadSchema; rewrite #detectInterruptedBugfix (scan) + extract #isBugfixChildInterrupted
  core/
    models.ts                  # READ-ONLY — BacklogReadSchema (975), BacklogSchema (797)
    session-utils.ts           # READ-ONLY (S1) — BUGFIX_DIR_PATTERN (782, not exported), nextBugfixDir
tests/
  unit/
    workflows/
      prp-pipeline.test.ts     # EDIT — ensure readdir in fs mock; update resume suite to stub numbered children; +multi-child scan tests
vitest.config.ts               # READ-ONLY — 100% coverage thresholds
package.json                   # READ-ONLY — npm run validate gate
PRD.md (bugfix doc)            # READ-ONLY — Issue 4 (h3.3) + §4.4/§5.1
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/workflows/prp-pipeline.ts            # MODIFIED — numbered-child scan in #detectInterruptedBugfix + #isBugfixChildInterrupted helper + BacklogReadSchema
tests/unit/workflows/prp-pipeline.test.ts # MODIFIED — readdir in fs mock; resume suite stubs numbered children; +multi-child scan tests
# (no NEW files)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (readdir fs-mock gap — S2 contract): tests/unit/workflows/prp-pipeline.test.ts:17-23
//   mocks node:fs/promises WITHOUT readdir. S2 (Implementing) ADDS readdir to this
//   mock for runQACycle's nextBugfixDir call. S3's #detectInterruptedBugfix ALSO
//   calls readdir(sessionPath/bugfix/). If S2 has NOT landed the readdir mock
//   addition, S3 must add `readdir: vi.fn()` itself. Either way, by the time S3
//   lands, the fs mock MUST include readdir or every resume test throws TypeError.
//   TREAT S2's readdir mock addition AS A CONTRACT.

// CRITICAL (swap ALL three BacklogSchema sites): import (line 36), usage (2086),
//   and JSDoc text (2037). grep confirms BacklogSchema is used ONLY at these 3
//   sites in prp-pipeline.ts. Leaving any one unchanged makes the doc lie or the
//   import unused (lint error).

// CRITICAL (local regex, NOT S1's const): S1's BUGFIX_DIR_PATTERN
//   (session-utils.ts:782) is a MODULE-LEVEL const that is NOT exported. S1 is
//   Complete — do NOT re-open session-utils.ts to export it. Define a LOCAL
//   BUGFIX_CHILD_PATTERN = /^\d{3}_/ inside #detectInterruptedBugfix. The regex
//   is a 1-liner; no DRY benefit justifies touching S1.

// CRITICAL (per-child "no TEST_RESULTS.md" = SKIP, not interrupted): with the
//   flat dir, "no TEST_RESULTS.md" → null (never hunted). With numbered children,
//   a child WITHOUT TEST_RESULTS.md is an anomaly (S2's runQACycle ALWAYS copies
//   TEST_RESULTS.md into the numbered child it creates). Per contract item 3d,
//   #isBugfixChildInterrupted returns FALSE for such a child (skip → continue to
//   older children). Do NOT return it as interrupted.

// CRITICAL (sort DESC, return FIRST interrupted): the contract mandates "Return
//   the FIRST interrupted child found (most recent)" (item 3f). Sort numbered
//   children by NNN DESCENDING so the highest NNN is checked first. A common bug
//   is sorting ascending (oldest first) — that would resume an OLD interrupted
//   iteration instead of the latest. Verify with a test: 001 interrupted + 002
//   interrupted → expect 002.

// CRITICAL (healthy-most-recent → return OLDER interrupted): contract item 3e
//   ("If a child has a valid tasks.json, SKIP it and continue to older children").
//   So 001 interrupted + 002 healthy → return 001 (002 skipped). Test this
//   explicitly — it's the headline multi-iteration-resume behavior.

// CRITICAL (non-ENOENT readdir errors PROPAGATE): ENOENT on bugfix/ → null
//   (never hunted). ANY other readdir error (EACCES, EIO) → rethrow (unexpected,
//   surface it). Do NOT swallow non-ENOENT errors. Cover both branches.

// CRITICAL (100% branch coverage): every new branch needs a test:
//   - readdir ENOENT → null.
//   - readdir non-ENOENT → rethrow (rejects).
//   - readdir success, no numbered children (empty / all non-NNN_) → null.
//   - one child, interrupted (TEST_RESULTS.md present + tasks.json missing) → return it.
//   - one child, healthy (valid tasks.json) → null.
//   - one child, no TEST_RESULTS.md → null (skipped).
//   - two children, most-recent interrupted → return most-recent.
//   - two children, most-recent healthy, older interrupted → return older.
//   - two children, both healthy → null.
//   - per-child states: empty tasks.json, corrupt JSON, invalid BacklogReadSchema,
//     unreadable tasks.json (readFile throws) → each returns the child as interrupted.
//   Missing ANY → npm run validate fails on coverage.

// GOTCHA (Dirent mock shape): readdir({withFileTypes:true}) returns Dirent[]; each
//   needs .name (string) + .isDirectory() (fn→bool). Build mocks as
//   { name: '002_aaaaaaaaaaaa', isDirectory: () => true }. For non-dir entries
//   (to test the isDirectory filter), use isDirectory: () => false.

// GOTCHA (multi-child mockStat disambiguation): when stubbing stat for multiple
//   children, distinguish by the NNN in the path. E.g.:
//     mockStat.mockImplementation(async (p) => {
//       const s = String(p);
//       if (s.includes('002_') && s.endsWith('TEST_RESULTS.md')) return {};
//       if (s.includes('002_') && s.endsWith('tasks.json')) return {}; // 002 healthy
//       if (s.includes('001_') && s.endsWith('TEST_RESULTS.md')) return {}; // 001 has report
//       // 001 tasks.json → ENOENT (interrupted)
//       throw enoent();
//     });

// GOTCHA (existing resume tests must stub readdir): the existing 7 tests in
//   describe('resume interrupted bugfix breakdowns') (809-989) currently rely on
//   the FLAT dir. After S3, #detectInterruptedBugfix calls readdir FIRST. Each
//   test must mockReaddir.mockResolvedValue([{name:'001_aaaaaaaaaaaa',
//   isDirectory:()=>true}]) (or a per-test override) or detection returns null
//   (ENOENT/default) and the test's expected resume doesn't fire. Add a shared
//   helper (e.g. stubNumberedChild('001')) mirroring stubMissingTasks.

// GOTCHA (BacklogReadSchema is LENIENT): a tasks.json that BacklogSchema REJECTS
//   (e.g. missing prd_selectors on a subtask) may PASS BacklogReadSchema. So the
//   "invalid Backlog → interrupted" test must use a payload that fails EVEN the
//   lenient schema (e.g. { foo: 1 } — no backlog array). Don't use a payload that
//   only fails the strict schema or the test wrongly passes.

// GOTCHA (caller unchanged): do NOT modify line 1807
//   (`const interruptedDir = await this.#detectInterruptedBugfix(sessionPath)`).
//   The return contract (string path | null) is preserved; only the PATH is now a
//   numbered child. runQACycle + #runBugFixCycle are path-agnostic.

// GOTCHA (S4 owns lifecycle): S3 adds detection-scan UNIT tests for coverage.
//   The broader end-to-end numbered-iteration lifecycle suite (create 001 →
//   interrupt → resume → create 002 → …) is S4. Don't over-build S3's tests.
```

---

## Implementation Blueprint

### Data models and structure
No new data models. S3 uses existing types: `import('node:fs').Dirent` (inline,
mirrors S1's `nextBugfixDir`), `BacklogReadSchema` (imported), `Backlog`. The two
new private methods return `Promise<string | null>`
(`#detectInterruptedBugfix`) and `Promise<boolean>`
(`#isBugfixChildInterrupted`). No exported symbols.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: MODIFY src/workflows/prp-pipeline.ts — import swap
  - EDIT line ≈36: REPLACE `import { BacklogSchema } from '../core/models.js';`
    WITH `import { BacklogReadSchema } from '../core/models.js';`.
  - PRESERVE: all other imports (lines 1-68), the rest of the models import block
    if BacklogSchema was part of a multi-line destructure (grep shows line 36 is
    a standalone import — simple swap).
  - GOTCHA: grep confirms BacklogSchema is used ONLY at line 2086 + JSDoc 2037.
    Both are updated in Task 2/3. If you leave the import as BacklogSchema AND
    add BacklogReadSchema, the BacklogSchema import becomes unused (lint error).

Task 2: MODIFY src/workflows/prp-pipeline.ts — extract #isBugfixChildInterrupted
  - ADD a new private async method #isBugfixChildInterrupted(childDir: string):
    Promise<boolean> near #detectInterruptedBugfix (place it AFTER
    #detectInterruptedBugfix, or before — keep them adjacent). Body per "What" §(c):
    stat TEST_RESULTS.md → missing returns false; stat tasks.json → missing true;
    readFile → throw true; empty true; JSON.parse throw true; !BacklogReadSchema
    true; else false.
  - USE BacklogReadSchema.safeParse (NOT BacklogSchema).
  - ADD JSDoc (Mode A, "What" §c text) documenting the per-child contract + the
    lenient schema rationale.
  - FOLLOW pattern: the existing 6-step check (FACT 1) — just relocated + returns
    boolean instead of the dir string + skip-on-no-TEST_RESULTS semantics.
  - GOTCHA: "no TEST_RESULTS.md" → return FALSE (skip child), NOT true. This is
    the key semantic change from the flat-dir version.

Task 3: MODIFY src/workflows/prp-pipeline.ts — rewrite #detectInterruptedBugfix
  - REPLACE the body of #detectInterruptedBugfix (lines 2050-2095) with the scan
    per "What" §(b): readdir(bugfixDir, {withFileTypes:true}); catch ENOENT →
    null, else rethrow; filter isDirectory + /^\d{3}_/; map to {dir, seq};
    filter seq>=0; sort desc; loop → call #isBugfixChildInterrupted(child.dir);
    return first true child.dir; else null.
  - DEFINE `const BUGFIX_CHILD_PATTERN = /^\d{3}_/` LOCALLY inside the method.
  - UPDATE the JSDoc above #detectInterruptedBugfix (lines 2030-2044) per
    "What" §(b) text (document numbered scanning, mutual consistency with S2,
    BacklogReadSchema). Update the "BacklogSchema validation" mention at line
    2037 → "BacklogReadSchema validation".
  - PRESERVE: the method signature `async #detectInterruptedBugfix(sessionPath:
    string): Promise<string | null>`, the caller at line 1807 (UNCHANGED).
  - FOLLOW pattern: S1's nextBugfixDir scan (readdir + filter + regex + sort) —
    mirrored locally. The dynamic-import local style (`await import('node:fs/promises')`).
  - GOTCHA: sort DESC (b.seq - a.seq). Non-ENOENT readdir errors rethrow. Use
    parseInt(e.name.slice(0,3), 10) (the NNN prefix). Do NOT import S1's regex.

Task 4: MODIFY tests/unit/workflows/prp-pipeline.test.ts — fs mock + resume suite
  - VERIFY/ADD `readdir` in the vi.mock('node:fs/promises') block (lines 17-23):
    if S2 has added `readdir: vi.fn().mockRejectedValue(<ENOENT>)`, keep it; if
    not, ADD `readdir: vi.fn()`. Cast: ensure `mockReaddir` is accessible (mirror
    mockStat/mockReadFile casts). S3 tests override per-test.
  - UPDATE the existing describe('resume interrupted bugfix breakdowns') (809-989):
    add a shared helper `stubNumberedChild(seq='001')` that does
    mockReaddir.mockResolvedValue([{name:`${seq}_aaaaaaaaaaaa`, isDirectory:()=>true}]).
    Call it (or a per-test override) in EACH of the 7 existing tests so the scan
    reaches the per-child checks. The existing mockStat/mockReadFile suffix
    matching still works (paths become …/bugfix/001_…/TEST_RESULTS.md).
  - ADD new it() cases for the scan-control branches (see Known Gotchas coverage
    list): most-recent-interrupted wins; healthy-most-recent→older-interrupted;
    both healthy→null; ENOENT on bugfix/→null; non-ENOENT readdir→rethrow; no
    numbered children (empty / non-NNN_ entries)→null; child without
    TEST_RESULTS.md→skipped.
  - For multi-child tests, mockReaddir returns 2 Dirents AND mockStat
    disambiguates by the NNN in the path (see Known Gotchas disambiguation snippet).
  - FOLLOW pattern: existing stubMissingTasks + mockStat path-suffix matching;
    existing Dirent-free → now Dirent mocks {name, isDirectory:vi.fn(()=>true)}.
  - GOTCHA: every new branch needs a test or coverage fails. The "invalid
    Backlog" test must use a payload that fails BacklogReadSchema too ({foo:1}),
    not just BacklogSchema.

Task 5: VERIFY — no regressions
  - RUN npm run typecheck → exit 0 (BacklogReadSchema import resolves; new
    methods typecheck; Dirent inline type compiles).
  - RUN npx vitest run tests/unit/workflows/prp-pipeline.test.ts → ALL green
    (existing resume suite updated + new scan tests).
  - RUN npx vitest run --coverage → 100/100/100/100 on src/**/*.ts (every new
    branch in #detectInterruptedBugfix + #isBugfixChildInterrupted covered).
  - RUN npm run validate → GREEN.
  - RUN npm run build → succeeds.
  - VERIFY only the two intended files changed: git diff --name-only →
    src/workflows/prp-pipeline.ts, tests/unit/workflows/prp-pipeline.test.ts.
```

### Implementation Patterns & Key Details
```ts
// PATTERN: the numbered-child scan (prp-pipeline.ts #detectInterruptedBugfix):
const BUGFIX_CHILD_PATTERN = /^\d{3}_/;   // LOCAL — S1's is not exported
let entries: import('node:fs').Dirent[];
try {
  entries = await readdir(bugfixDir, { withFileTypes: true });
} catch (error) {
  const err = error as NodeJS.ErrnoException;
  if (err.code === 'ENOENT') return null;   // ← ENOENT branch (cover)
  throw error;                               // ← non-ENOENT rethrow (cover)
}
const numberedChildren = entries
  .filter((e) => e.isDirectory() && BUGFIX_CHILD_PATTERN.test(e.name))
  .map((e) => ({ dir: resolve(bugfixDir, e.name), seq: parseInt(e.name.slice(0, 3), 10) }))
  .filter((c) => !Number.isNaN(c.seq))
  .sort((a, b) => b.seq - a.seq);            // ← DESC: most recent first
for (const child of numberedChildren) {
  if (await this.#isBugfixChildInterrupted(child.dir)) return child.dir;
}
return null;

// PATTERN: per-child check (prp-pipeline.ts #isBugfixChildInterrupted):
async #isBugfixChildInterrupted(childDir: string): Promise<boolean> {
  const { resolve } = await import('node:path');
  const { stat, readFile } = await import('node:fs/promises');
  try { await stat(resolve(childDir, 'TEST_RESULTS.md')); }
  catch { return false; }                    // ← no report → skip (cover)
  try { await stat(resolve(childDir, 'tasks.json')); }
  catch { return true; }                     // ← missing (cover)
  let content: string;
  try { content = await readFile(resolve(childDir, 'tasks.json'), 'utf-8'); }
  catch { return true; }                     // ← unreadable (cover)
  if (content.trim() === '') return true;    // ← empty (cover)
  let parsed: unknown;
  try { parsed = JSON.parse(content); }
  catch { return true; }                     // ← corrupt JSON (cover)
  return !BacklogReadSchema.safeParse(parsed).success;  // ← invalid Backlog (cover)
}

// PATTERN: multi-child mockStat disambiguation (test):
mockStat.mockImplementation(async (p) => {
  const s = String(p);
  if (s.includes('002_') && s.endsWith('tasks.json')) return {}; // 002 healthy
  if (s.endsWith('TEST_RESULTS.md')) return {};                  // both have reports
  throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });  // 001 tasks.json missing
});
mockReadFile.mockImplementation(async (p) => {
  const s = String(p);
  if (s.includes('002_')) return VALID_BACKLOG_JSON;             // 002 valid
  return '{not json';                                             // 001 corrupt (not reached — stat ENOENT first)
});
mockReaddir.mockResolvedValue([
  { name: '001_aaaaaaaaaaaa', isDirectory: () => true },
  { name: '002_bbbbbbbbbbbb', isDirectory: () => true },
]);
// EXPECT: #detectInterruptedBugfix returns '…/bugfix/001_aaaaaaaaaaaa' (002 healthy → skipped, 001 interrupted)

// CRITICAL: swap BacklogSchema → BacklogReadSchema at import (36), use (2086), JSDoc (2037).
// CRITICAL: readdir MUST be in the test fs mock (S2 contract; add if missing).
// CRITICAL: define BUGFIX_CHILD_PATTERN LOCALLY (S1's const not exported; don't re-open S1).
// CRITICAL: "no TEST_RESULTS.md" → skip child (return false), NOT interrupted.
// CRITICAL: sort DESC; return FIRST interrupted (most recent).
// CRITICAL: non-ENOENT readdir errors rethrow (propagate).
// CRITICAL: caller line 1807 UNCHANGED — return contract preserved (string|null).
```

### Integration Points
```yaml
PRP-PIPELINE (src/workflows/prp-pipeline.ts):
  - swap import: BacklogSchema → BacklogReadSchema (line 36).
  - rewrite: #detectInterruptedBugfix (2045-2095) → numbered-child scan.
  - add: #isBugfixChildInterrupted(childDir): Promise<boolean> (extracted per-child check).
  - update JSDoc: #detectInterruptedBugfix (2030-2044) for numbered scanning + BacklogReadSchema.
  - unchanged: runQACycle caller (1807), #runBugFixCycle, FixCycleWorkflow.

TESTS (tests/unit/workflows/prp-pipeline.test.ts):
  - ensure readdir in vi.mock('node:fs/promises') (S2 contract; add if missing).
  - update describe('resume interrupted bugfix breakdowns'): stub readdir per test.
  - add: multi-child scan tests (most-recent-interrupted, healthy-skip, both-healthy, ENOENT, non-ENOENT rethrow, no-numbered, no-TEST_RESULTS skip).

NO SESSION-UTILS EDIT (S1's BUGFIX_DIR_PATTERN not exported — define local regex; S1 Complete).
NO RUNQACYCLE EDIT (S2 owns creation; S3 owns detection only).
NO MODELS EDIT (BacklogReadSchema is P2.M2.T1.S1's; READ-ONLY).
NO FIXCYCLEWORKFLOW (numbered path still contains 'bugfix').
NO EXTERNAL DOCS (S3's Mode-A docs = the JSDoc only; README/ARCHITECTURE/CONFIGURATION = P3.M1.T2.S1).
NO PRD.md / NO tasks.json / NO prd_snapshot.md / NO vitest.config.ts.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit → exit 0 (BacklogReadSchema import + new methods + Dirent inline type)
npm run lint             # eslint . --ext .ts → no new violations (no unused BacklogSchema import)
npm run format:check     # prettier --check; run `npm run format` if it complains
# Expected: Zero errors. The change is additive (1 helper) + a rewrite (scan) + an import swap.
```

### Level 2: Unit Tests (Component Validation)
```bash
npx vitest run tests/unit/workflows/prp-pipeline.test.ts   # existing resume suite (updated) + new scan tests
npx vitest run --coverage                                  # 100/100/100/100 on src/**/*.ts
npm run test:run                                           # full suite green
# Expected: ALL green. Every new branch (ENOENT, non-ENOENT rethrow, empty, no-match,
# per-child states, healthy-skip, most-recent-interrupted) is exercised.
```

### Level 3: Integration Testing (System Validation)
```bash
npm run validate      # lint + format:check + typecheck + test:run → GREEN
npm run build         # tsc -p tsconfig.build.json → succeeds

# Behavioral smoke (real FS, temp tree — confirms end-to-end scan + resume-target selection):
node --input-type=module -e "
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
// This smoke confirms the SCAN logic in isolation; full runQACycle requires the
// pipeline harness (covered by unit tests with mocked workflows). Build a temp
// bugfix/ tree with two children: 001 healthy, 002 interrupted.
const tmp = '/tmp/detect-smoke-' + Date.now();
mkdirSync(tmp + '/bugfix/001_aaaaaaaaaaaa', { recursive: true });
mkdirSync(tmp + '/bugfix/002_bbbbbbbbbbbb', { recursive: true });
writeFileSync(tmp + '/bugfix/001_aaaaaaaaaaaa/TEST_RESULTS.md', 'report');
writeFileSync(tmp + '/bugfix/001_aaaaaaaaaaaa/tasks.json', JSON.stringify({backlog:[]})); // healthy
writeFileSync(tmp + '/bugfix/002_bbbbbbbbbbbb/TEST_RESULTS.md', 'report');
// 002 has NO tasks.json → interrupted
console.log('tree built; detection logic is unit-tested in prp-pipeline.test.ts');
rmSync(tmp, { recursive: true, force: true });
"
# (The authoritative behavioral check is the unit test suite — the smoke just
#  confirms the temp-tree shape the tests mock.)
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Confirm BacklogSchema is GONE from prp-pipeline.ts (swap complete):
rg -n "BacklogSchema\b" src/workflows/prp-pipeline.ts   # EXPECT: zero matches (all → BacklogReadSchema)
rg -n "BacklogReadSchema" src/workflows/prp-pipeline.ts # EXPECT: 1 import + 1 use (+ JSDoc mention)

# Confirm the scan + per-child helper exist:
rg -n "#detectInterruptedBugfix|#isBugfixChildInterrupted" src/workflows/prp-pipeline.ts  # 2+ matches each
rg -n "BUGFIX_CHILD_PATTERN|readdir\(bugfixDir" src/workflows/prp-pipeline.ts             # scan present
rg -n "/^\\\\d\{3\}_/" src/workflows/prp-pipeline.ts                                      # local regex present

# Confirm the caller is UNCHANGED:
rg -n "#detectInterruptedBugfix\(sessionPath\)" src/workflows/prp-pipeline.ts  # EXPECT: 1 call (line ~1807)

# Confirm readdir is in the test fs mock:
rg -n "readdir" tests/unit/workflows/prp-pipeline.test.ts   # EXPECT: ≥1 (mock + per-test overrides)

# Confirm S1's session-utils.ts was NOT re-edited (BUGFIX_DIR_PATTERN stays private):
git diff --name-only src/core/session-utils.ts              # EXPECT: no changes (S1 Complete)

# Confirm only the two intended files changed:
git diff --name-only
# EXPECT: src/workflows/prp-pipeline.ts, tests/unit/workflows/prp-pipeline.test.ts
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0.
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] `npm run build` succeeds.
- [ ] 100% coverage on `src/**/*.ts` preserved (all new branches covered).

### Feature Validation
- [ ] `#detectInterruptedBugfix` scans numbered `bugfix/NNN_hash/` children, returns
      the most-recent interrupted child or `null`.
- [ ] Healthy children skipped; all-healthy → `null`.
- [ ] ENOENT on `bugfix/` → `null`; non-ENOENT rethrow.
- [ ] Non-`NNN_` entries + non-dir entries ignored.
- [ ] Child without `TEST_RESULTS.md` skipped (not interrupted).
- [ ] Backlog validation uses `BacklogReadSchema` (lenient read-time).
- [ ] Most-recent-interrupted wins; healthy-most-recent → older interrupted returned.
- [ ] Caller (runQACycle line 1807) UNCHANGED; resume path works across iterations.

### Code Quality Validation
- [ ] `BacklogSchema` fully swapped → `BacklogReadSchema` (import + use + JSDoc).
- [ ] `BUGFIX_CHILD_PATTERN` defined LOCALLY (S1's const not re-exported; S1 untouched).
- [ ] Per-child check extracted to `#isBugfixChildInterrupted` (testable, clean scan loop).
- [ ] `readdir` present in the test fs mock (S2 contract honored).
- [ ] Existing resume suite updated to stub numbered children.
- [ ] Multi-child scan tests cover every branch for 100% coverage.
- [ ] S1's `session-utils.ts` NOT re-edited (S1 Complete).

### Documentation & Deployment
- [ ] JSDoc on `#detectInterruptedBugfix` documents numbered-child scanning (Mode A, item 5).
- [ ] JSDoc on `#isBugfixChildInterrupted` documents per-child contract + BacklogReadSchema.
- [ ] No external doc edits (README/ARCHITECTURE/CONFIGURATION = P3.M1.T2.S1).

---

## Anti-Patterns to Avoid
- ❌ Don't **import S1's `BUGFIX_DIR_PATTERN`** — it's a non-exported module-level
  const in session-utils.ts (line 782), and S1 is Complete. Re-opening S1 to
  export it risks re-testing a landed helper for zero DRY benefit. Define a LOCAL
  `/^\d{3}_/` regex inside `#detectInterruptedBugfix`.
- ❌ Don't **leave `BacklogSchema` half-swapped** — grep confirms it's used at
  import (36), the `safeParse` (2086), AND the JSDoc text (2037). All three must
  become `BacklogReadSchema` or the import goes unused (lint) / the doc lies.
- ❌ Don't **return a child without `TEST_RESULTS.md` as interrupted** — that's
  the flat-dir semantic. With numbered children, a child without a bug report was
  never properly hunted → SKIP it (`#isBugfixChildInterrupted` returns false),
  continue to older children.
- ❌ Don't **sort ascending** — the contract mandates the MOST RECENT interrupted
  child. Sort NNN DESCENDING. A test with 001+002 both interrupted MUST expect 002.
- ❌ Don't **forget the healthy-skip-then-older-interrupted case** — contract item
  3e. 001 interrupted + 002 healthy → return 001. This is the headline
  multi-iteration-resume behavior; test it explicitly.
- ❌ Don't **swallow non-ENOENT readdir errors** — ENOENT → null (never hunted);
  EACCES/EIO → rethrow (unexpected, surface it). Cover both branches.
- ❌ Don't **modify the caller** (runQACycle line 1807) — the return contract
  (`string | null`) is preserved; only the path is now a numbered child.
  `#runBugFixCycle` + `FixCycleWorkflow` are path-agnostic.
- ❌ Don't **forget `readdir` in the test fs mock** — S2 adds it for runQACycle;
  S3 depends on it. If S2 hasn't landed it, S3 adds `readdir: vi.fn()`. Without
  it, `#detectInterruptedBugfix`'s `readdir(...)` is undefined → TypeError → all
  resume tests break.
- ❌ Don't **use a payload that only fails strict `BacklogSchema`** for the
  "invalid Backlog → interrupted" test — `BacklogReadSchema` is lenient (it
  accepts subtasks missing `prd_selectors`). Use `{foo:1}` (no backlog array) so
  it fails BOTH schemas, or the test wrongly passes.
- ❌ Don't **touch runQACycle** (S2 owns creation) or **session-utils.ts** (S1
  Complete) or **models.ts** (P2.M2.T1.S1) or **FixCycleWorkflow** (numbered path
  still contains 'bugfix').
- ❌ Don't **over-build the test suite** — S3 adds detection-scan UNIT tests for
  coverage; the end-to-end numbered-iteration lifecycle suite is S4.
- ❌ Don't touch PRD.md, tasks.json, prd_snapshot.md, or vitest.config.ts.

---

## Confidence Score

**9/10** — One-pass success likelihood is very high. S3 is a focused 2-file
change: one source rewrite (split a 50-line method into a scan + an extracted
per-child helper) + one import swap, plus a test update (ensure `readdir` mock +
stub numbered children in the existing suite) and new scan-branch tests. Every
edit site is pinned: the current 6-step implementation (2045-2095), the caller
(1807, unchanged), the three `BacklogSchema` sites (36/2086/2037), the
`BacklogReadSchema` export (models.ts:975), and S1's regex shape (782, mirrored
locally). The correctness rests on ten pre-proven facts (gap analysis FACT 1-10):
the exact current impl, the caller contract, the swap safety, the scan algorithm,
the lenient-schema rationale, the fs-mock dependency on S2, the existing test
stub patterns, the per-child no-TEST_RESULTS semantics, the coverage branch list,
and the scope fences. The design deliberately extracts `#isBugfixChildInterrupted`
so the per-child states remain individually testable and the scan loop reads
cleanly. The scope fences are airtight: S3 edits ONLY prp-pipeline.ts
(detection) + its test; S1 (helper) is Complete/untouched, S2 (creation) is
Implementing/disjoint-region, S4 (lifecycle) is separate, models.ts is read-only.
The single coordination point with S2 is the `readdir` fs-mock addition —
explicitly treated as a contract (S3 verifies/adds it). The two residual risks,
both mitigated: (1) **the existing 7 resume tests break without a `readdir`
stub** — mitigated by the shared `stubNumberedChild` helper pattern + explicit
Task 4 guidance; (2) **a coverage branch missed** — mitigated by the exhaustive
branch list in Known Gotchas + Task 4. Zero file overlap with S1 (session-utils),
S2 (runQACycle region), or S4 (separate lifecycle suite).