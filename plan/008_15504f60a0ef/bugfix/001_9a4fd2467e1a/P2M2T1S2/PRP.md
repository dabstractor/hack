# PRP — P2.M2.T1.S2: Wire readTasksJSON and loadSession to use BacklogReadSchema

---

## Goal

**Feature Goal**: Switch the **primary READ path** for `tasks.json` from the strict
`BacklogSchema` to the lenient `BacklogReadSchema` that S1 shipped, so that legacy /
hand-edited / externally-authored / test-fixture sessions with plain (non-`CONTRACT
DEFINITION:`) `context_scope` strings LOAD instead of being hard-rejected (PRD §5.1;
bugfix Issue 3B). The strict `BacklogSchema` remains the **write-time** validator for
architect OUTPUT, so the contract-format guarantee on PRODUCED files is preserved.
Concretely: (1) extend the import in `session-utils.ts` to include `BacklogReadSchema`;
(2) swap `BacklogSchema.parse` → `BacklogReadSchema.parse` at the single read site
inside `readTasksJSON`; (3) add an optional debug-level log when loaded subtasks lack
the `CONTRACT DEFINITION:` prefix (observable without rejecting); (4) tests proving
plain-scope sessions now load, strict-write still rejects, and the debug log fires.
`loadSession` is covered transitively (it delegates to `readTasksJSON`).

> **Scope boundary (read first).** S2 wires the **primary read path only**
> (`readTasksJSON` → `loadSession`). The four secondary `BacklogSchema.parse` READ sites
> (`state-validator.ts:190`, `tasks-json-recovery.ts:317`, `prp-pipeline.ts:2086`,
> `task-orchestrator.ts:1323`) are **out of scope** — they have different semantics and
> are not named by the contract (see §"Out of scope"). The strict WRITE validator
> (`writeTasksJSON` → `BacklogSchema.parse` at `session-utils.ts:777`) **must stay strict**.

**Deliverable**:
1. **`src/core/session-utils.ts`** — (a) extend the `models.js` import to add
   `BacklogReadSchema`; (b) swap `BacklogSchema.parse(parsed)` → `BacklogReadSchema.parse(parsed)`
   at the read site inside `readTasksJSON` (line ~870); (c) AFTER the successful lenient parse,
   scan the validated backlog for subtasks whose `context_scope` does NOT start with
   `'CONTRACT DEFINITION:'` and, if any are found, emit one `logger().debug(...)` listing the IDs.
   `writeTasksJSON` (line ~777) is UNCHANGED — it stays `BacklogSchema.parse` (strict write).
2. **`tests/unit/core/session-utils.read-lenient.test.ts`** (NEW) — a focused unit test that
   writes a real `tasks.json` (plain-scope subtask) to a temp dir, asserts `readTasksJSON` now
   LOADS it (previously threw), asserts a structural error still throws, and (via the canonical
   `vi.hoisted` + `vi.mock('.../logger.js')` pattern) asserts the debug log fires for plain-scope
   and does NOT fire for contract-format backlogs (covers the scan branch for 100% coverage).
   GATED (`*.test.ts` → runs under `npm run validate`).

**Success Definition**:
- `rg -n "BacklogReadSchema" src/core/session-utils.ts` → present in the import AND at the read
  site inside `readTasksJSON`.
- `rg -n "BacklogSchema.parse" src/core/session-utils.ts` → exactly ONE match, inside
  `writeTasksJSON` (the strict write validator, line ~777). The read site no longer uses it.
- A `tasks.json` whose subtask `context_scope` is a plain string (e.g. `'Implement feature X'`)
  — the exact PRD Issue 3 repro — LOADS via `readTasksJSON()` (no throw); the same file is still
  REJECTED by `writeTasksJSON` (strict write preserved).
- `BacklogReadSchema.parse` still THROWS on structural errors (bad ID, bad status, empty
  `context_scope`) — leniency is FORMAT-only.
- The debug log fires (with `nonContractIds`) for a plain-scope backlog and is SILENT for a
  contract-format backlog.
- `npx tsc --noEmit -p tsconfig.build.json` exit 0; `npm run lint` + `format:check` clean;
  `npx vitest run tests/unit/core/session-utils.read-lenient.test.ts` green; **100% coverage on
  `src/core/session-utils.ts`** preserved.
- `loadSession` (delegates to `readTasksJSON`) loads plain-scope sessions transitively — no edit
  to `session-manager.ts` required.

---

## User Persona (if applicable)

**Target User**: Pipeline maintainer / recovery-path contributor; any user resuming a legacy or
hand-edited session.
**Use Case**: Loading a `tasks.json` that wasn't produced by the current architect (legacy,
hand-edited, externally-authored, or a test fixture) without it being hard-rejected over a
documentation-format field.
**User Journey**: A session fails to load with `context_scope must start with "CONTRACT DEFINITION:"`;
S2's lenient read path lets it load (with an optional debug breadcrumb); the maintainer can resume.
**Pain Points Addressed**: Today the strict `ContextScopeSchema` is enforced on READ via
`readTasksJSON → BacklogSchema.parse`, locking out any legitimate session that lacks the contract
prefix (PRD §5.1 mandates survival of corruption/non-pipeline authorship). S2 fixes the whole
~90+-fixture test cluster at once and prevents real-world session lockout.

---

## Why

- **PRD §5.1 compliance**: "`tasks.json` Protection & Smart Recovery" mandates the state file
  SURVIVE corruption / non-pipeline authorship — a read-time hard reject on a documentation-format
  field (`context_scope`) is too strict for a recovery-oriented state file.
- **Unblocks the red suite (bugfix Issue 3B)**: ~90+ test fixtures use plain `context_scope`
  strings; relaxing the READ schema fixes the whole cluster at once (the remaining ~207 failures
  are Issue 3A mock drift → P2.M3, and Issue 4 bugfix numbering → P3 — NOT S2's gate).
- **Preserves the contract guarantee**: the pipeline still PRODUCES the `CONTRACT DEFINITION`
  format — the STRICT `BacklogSchema` stays as the architect-OUTPUT (write-time) validator
  (`writeTasksJSON:777`). Leniency is read-only and format-only.
- **Observable, not silent**: the optional debug log (contract item 3c) makes lenient acceptance
  visible to maintainers without rejecting the file — directly serving the PRD Issue 3
  "warn (not reject) on read" suggestion.

### Out of scope (hard fences)
- **The four secondary READ sites** (`state-validator.ts:190`, `tasks-json-recovery.ts:317`,
  `prp-pipeline.ts:2086` `#detectInterruptedBugfix`, `task-orchestrator.ts:1323`
  `#checkHeadComplete`) → **NOT named by the contract** and have different semantics (a
  validate-state CLI, a git-history restore, a corruption probe, a HEAD-blob read that already
  swallows parse failures). S2 switches ONLY `readTasksJSON`. See Context §"Known Gotchas".
- **The strict WRITE validator** (`writeTasksJSON:777`) → MUST stay `BacklogSchema.parse`. This is
  the single gate that enforces the contract format on architect OUTPUT.
- **The lenient schemas themselves** (`BacklogReadSchema` + 5 intermediate) → owned by **S1**
  (already landed in `src/core/models.ts:832-975`). Do NOT modify `models.ts`.
- **`loadSession` body** (`session-manager.ts:654`) → delegates to `readTasksJSON`; no edit needed.
- **The barrel re-export** (`src/core/index.ts`) → do NOT add `BacklogReadSchema`; `session-utils`
  imports directly from `./models.js` (as it already does for `BacklogSchema`).
- **Fixing the ~297 rotted tests / mock drift (Issue 3A)** → **P2.M3**. S2's gate is the targeted
  read-lenient test + tsc + coverage, NOT the full `npm run test:run`.
- **Bugfix session numbering (Issue 4)** → **P3**.

---

## What

### User-visible behavior
A `tasks.json` whose subtasks have plain (non-`CONTRACT DEFINITION:`) `context_scope` strings now
LOADS via `readTasksJSON` / `loadSession` (previously threw `context_scope must start with
"CONTRACT DEFINITION:"`). A debug-level log line is emitted listing the offending subtask IDs
(observable in debug logs; silent at default log levels). The architect's OUTPUT is still validated
strictly on write, so produced files keep the contract format.

### Technical requirements (exact contract — item 3a–d)

**(a) Import `BacklogReadSchema`** in the file that calls `BacklogSchema.parse` on read:
```ts
// src/core/session-utils.ts:42 — was:
import { BacklogSchema, PRPDocumentSchema } from './models.js';
// becomes:
import { BacklogSchema, BacklogReadSchema, PRPDocumentSchema } from './models.js';
```
(`BacklogSchema` is STILL imported — `writeTasksJSON:777` uses it. Both symbols coexist.)

**(b) Replace `BacklogSchema.parse` with `BacklogReadSchema.parse` in `readTasksJSON()`**
(`loadSession` delegates here, so this single swap covers both named functions):
```ts
// src/core/session-utils.ts:870 — was:
const validated = BacklogSchema.parse(parsed);
// becomes:
const validated = BacklogReadSchema.parse(parsed);
```
(`writeTasksJSON:777` KEEPS `BacklogSchema.parse` — do NOT change it. The two call sites are ~93
lines apart in the SAME file; verify you are inside `readTasksJSON` (line ~857), NOT
`writeTasksJSON` (line ~762), before editing.)

**(c) Optional: after the successful lenient parse, scan + debug-log non-contract scopes**
(contract item 3c — INCLUDED so the lenient acceptance is observable without rejecting):
```ts
// Insert AFTER `const validated = BacklogReadSchema.parse(parsed);` and BEFORE the
// existing success `logger().debug(...)` at :872.
// Scan for subtasks whose context_scope lacks the CONTRACT DEFINITION prefix.
const nonContractIds: string[] = [];
for (const phase of validated.backlog) {
  for (const milestone of phase.milestones) {
    for (const task of milestone.tasks) {
      for (const subtask of task.subtasks) {
        if (!subtask.context_scope.startsWith('CONTRACT DEFINITION:')) {
          nonContractIds.push(subtask.id);
        }
      }
    }
  }
}
if (nonContractIds.length > 0) {
  logger().debug(
    { sessionPath, nonContractIds, count: nonContractIds.length },
    'tasks.json loaded with subtask(s) missing CONTRACT DEFINITION prefix (lenient read)'
  );
}
```
Use `debug` (not `warn`/`error`): this is informational for maintainers, not a user-facing problem.
Keep the existing success `logger().debug({sessionPath, itemCount}, 'tasks.json read successfully')`
at :872 unchanged.

**(d) Ensure the architect OUTPUT validation path STILL uses strict `BacklogSchema`** — NO code
change needed: `writeTasksJSON:777` already uses `BacklogSchema.parse` and is the sole write gate.
The architect prompt uses `responseFormat: z.unknown()` (`architect-prompt.ts:93`), NOT
`BacklogSchema`, so there is no prompt-layer write validation to preserve — :777 is the only gate.
S2 must simply NOT touch :777. Verify post-edit: `rg -n "BacklogSchema.parse" src/core/session-utils.ts`
returns exactly ONE match (inside `writeTasksJSON`).

### Success Criteria
- [ ] `readTasksJSON` (session-utils.ts:870) uses `BacklogReadSchema.parse`; `loadSession`
      (delegates) loads plain-scope sessions transitively.
- [ ] `writeTasksJSON` (session-utils.ts:777) UNCHANGED — still `BacklogSchema.parse` (strict write).
- [ ] A plain-scope `tasks.json` (PRD Issue 3 repro: `context_scope: "Implement feature X in src/foo.ts"`)
      LOADS via `readTasksJSON()` (no throw); `writeTasksJSON(<same>)` still THROWS.
- [ ] `BacklogReadSchema.parse` still THROWS on structural errors (bad ID, bad status, empty scope).
- [ ] Debug log fires with `nonContractIds` for a plain-scope backlog; SILENT for contract-format.
- [ ] `tsc --noEmit -p tsconfig.build.json` exit 0; lint + format:check clean; targeted test green;
      100% coverage on `src/core/session-utils.ts` preserved.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The production change is two lines (import + swap) plus an optional scan loop, all anchored
to exact line numbers in `src/core/session-utils.ts` (verified current). The critical safety fact —
that `writeTasksJSON:777` is the SOLE strict write validator and must stay strict — is proven by a
full call-site classification (write-path scout): the architect output flows
`decomposePRD → saveBacklog → withLockedTasksJSON → writeTasksJSON → BacklogSchema.parse(:777)`, and
the architect prompt uses `responseFormat: z.unknown()` (no prompt-layer validation). The lenient
schema (`BacklogReadSchema`) is already landed by S1 at `models.ts:975`. The test patterns (real
temp dir; the `plainScopeBacklog` fixture at `models.test.ts:1308`; the `vi.hoisted` logger mock at
`change-classifier-resilient.test.ts:56-79`) are all verified. The scope decision (primary read path
only; 4 secondary sites out of scope) is documented with rationale.

### Documentation & References
```yaml
# MUST READ — the bug + the mandated fix strategy
- docfile: PRD.md  (bugfix PRD)
  section: "Issue 3: Test suite red; ContextScopeSchema over-strict on READ" (h3.2)
  why: Defines the bug (strict ContextScopeSchema enforced on READ via readTasksJSON →
       BacklogSchema.parse → session lockout) and the mandated fix: "enforce the CONTRACT
       DEFINITION contract on WRITE (architect output) but only warn (not reject) on READ ...
       A read-time hard reject on a documentation-format field is too strict for a recovery-
       oriented state file (PRD §5.1)."
  critical: S2 does the wiring (S1 shipped the schemas). The "warn (not reject)" suggestion maps
       to S2's optional debug log (contract item 3c).
- docfile: PRD.md (bugfix PRD)
  section: "Overview" (h2.0) + PRD §5.1 (tasks.json Protection & Smart Recovery)
  why: PRD §5.1 is the authority that read-time must SURVIVE non-pipeline authorship.

# MUST READ — the architecture research (proven facts)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/architecture/test_validation.md
  section: "### 3B: ContextScopeSchema Over-Strict on READ"
  why: Documents the read path (readTasksJSON → BacklogSchema.parse), the ~90+ plain-scope fixtures,
       and the fix strategy (lenient read twin; strict stays for architect output).
  critical: The doc SUGGESTS renaming the strict schema to ContextScopeWriteSchema — the CONTRACT
       OVERRIDES (S1 kept the strict names; S2 consumes both). Do not rename.

# MUST READ — the upstream CONTRACT (S1; assume implemented exactly as specified — and it IS in the tree)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P2M2T1S1/PRP.md
  section: "Goal / Integration Points / Out of scope"
  why: S1 defines BacklogReadSchema (lenient twin of BacklogSchema) at models.ts:975. S1's
       integration-points note explicitly says "session-utils.ts:870 BacklogSchema.parse →
       BacklogReadSchema.parse" — that is S2's exact swap. S1's out-of-scope says S2 owns wiring.
  critical: BacklogReadSchema is a DROP-IN (same output type Backlog); S2's swap is one line.
       S1 already added JSDoc to the schemas — S2 adds NO docs.

# MUST READ — this subtask's research (proven facts about the working tree)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P2M2T1S2/research/s2-codebase-analysis.md
  section: §1 (S1 already in tree), §2 (the swap target — 2 lines), §3 (write path must stay strict),
       §4 (4 secondary sites out of scope + rationale), §5 (optional debug log), §6 (test patterns),
       §7-8 (coverage), §9 (no docs), §10 (scope fences)
  why: Proven: the entire production change is import + swap (+ optional scan); writeTasksJSON:777
       is the sole strict write gate; loadSession delegates to readTasksJSON (no edit needed);
       the plainScopeBacklog fixture + vi.hoisted logger mock patterns are verified.

# THE FILE TO EDIT
- file: src/core/session-utils.ts
  why: EDIT — (1) extend import at :42 to add BacklogReadSchema; (2) swap BacklogSchema.parse →
       BacklogReadSchema.parse at :870 inside readTasksJSON; (3) insert the optional non-contract
       scan + debug log between :870 and the success log at :872.
  pattern: logger() is a lazy singleton accessor (session-utils.ts:47-48); existing debug/error
           calls use the `(contextObj, msg)` overload.
  gotcha: writeTasksJSON (:762) and readTasksJSON (:857) are ADJACENT functions in the SAME file.
          The swap target is :870 (readTasksJSON). DO NOT touch :777 (writeTasksJSON's
          BacklogSchema.parse) — that is the strict write gate. Verify the function name before
          editing.

# THE TEST FILE TO CREATE
- file: tests/unit/core/session-utils.read-lenient.test.ts  (NEW)
  why: Focused unit test for the lenient read path. Uses a REAL temp dir + REAL readTasksJSON
       (Pattern A) + the vi.hoisted logger mock (Pattern from change-classifier-resilient.test.ts).
  pattern: beforeEach mkdtempSync; writeFileSync a real tasks.json; await readTasksJSON(dir).
           Reuse the plainScopeBacklog shape from tests/unit/core/models.test.ts:1308-1350.
  gotcha: logger() is a module-cached singleton — the mock MUST return a STABLE shared object
          (vi.hoisted) or the cached _logger diverges from the spy after vi.clearAllMocks().

# CONTRACT INPUTS (read-only — owned by S1, already in the tree)
- symbol: BacklogReadSchema (src/core/models.ts:975)  — the lenient read schema (S2 consumes it)
- symbol: BacklogSchema (src/core/models.ts:797)       — the strict write schema (writeTasksJSON keeps it)

# DOWNSTREAM / TRANSITIVE (no edit needed)
- file: src/core/session-manager.ts:654  (loadSession → readTasksJSON at :656)
  why: loadSession delegates to readTasksJSON; swapping readTasksJSON's schema covers loadSession.
       No edit to session-manager.ts. (loadSessionAsCurrent at :724 also delegates.)

# WRITE PATH (read-only — MUST stay strict; do NOT edit)
- file: src/core/session-utils.ts:762  (writeTasksJSON → BacklogSchema.parse at :777)
  why: The SOLE strict write validator. Architect output flows through it. S2 must not touch it.
```

### Current Codebase tree (relevant slice)
```bash
src/core/
  models.ts           # UNTOUCHED (S1 landed BacklogReadSchema at :975) — INPUT only
  session-utils.ts    # EDIT — import (:42) + swap (:870) + optional scan log
  session-manager.ts  # UNTOUCHED (loadSession delegates to readTasksJSON)
tests/unit/core/
  models.test.ts                       # UNTOUCHED (S1 owns the schema tests) — has plainScopeBacklog fixture at :1308
  session-utils.read-lenient.test.ts   # NEW — lenient read-path unit tests
  tasks-json-recovery.test.ts          # READ-ONLY reference — Pattern A (real temp dir) + makeValidBacklog helper
vitest.config.ts                       # READ-ONLY — 100% coverage thresholds; include tests/**
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/core/session-utils.ts              # MODIFIED — readTasksJSON uses BacklogReadSchema (+ optional debug log);
                                       #   writeTasksJSON UNCHANGED (strict BacklogSchema.parse preserved)
tests/unit/core/session-utils.read-lenient.test.ts  # NEW — proves lenient read + strict write + debug log
# (no docs changes, no models.ts changes, no new source files)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL: writeTasksJSON (:762→:777 BacklogSchema.parse) and readTasksJSON (:857→:870) are
// ADJACENT functions in the SAME file. The swap target is :870 (readTasksJSON). DO NOT touch :777
// (writeTasksJSON's BacklogSchema.parse) — that is the SOLE strict write validator. The architect
// output flows decomposePRD → saveBacklog → withLockedTasksJSON → writeTasksJSON → BacklogSchema.parse(:777).
// The architect prompt uses responseFormat: z.unknown() (architect-prompt.ts:93), NOT BacklogSchema,
// so :777 is the ONLY gate enforcing the contract format on produced files. Touching it loses the
// contract guarantee. VERIFY the function name before editing.

// CRITICAL: keep BOTH BacklogSchema and BacklogReadSchema imported in session-utils.ts. writeTasksJSON
// (:777) still uses BacklogSchema; readTasksJSON (:870) uses BacklogReadSchema. Do NOT remove the
// BacklogSchema import.

// CRITICAL: loadSession (session-manager.ts:654) delegates to readTasksJSON (:656). The single swap
// at readTasksJSON:870 covers BOTH named functions in the contract. Do NOT edit session-manager.ts.
// (loadSessionAsCurrent at :724 also delegates through loadSession.)

// CRITICAL (100% coverage): the optional scan adds an `if (nonContractIds.length > 0)` branch. The
// test MUST exercise BOTH: (a) a plain-scope backlog → branch TRUE → debug log emitted; (b) a
// contract-format backlog → branch FALSE → no debug log. Both are trivially covered by two
// readTasksJSON tests. The startsWith('CONTRACT DEFINITION:') check is covered by both cases.

// CRITICAL (logger singleton): logger() in session-utils is a lazy module-cached singleton
// (`_logger ??= getLogger('session-utils')` at :47-48). When mocking logger.js, getLogger MUST
// return a STABLE shared object (vi.hoisted), or the cached _logger diverges from the spy after
// vi.clearAllMocks(). Use the exact pattern from change-classifier-resilient.test.ts:56-79.

// CRITICAL (test pattern): use a REAL temp dir + REAL readTasksJSON (Pattern A — write a real
// tasks.json via writeFileSync, then await readTasksJSON(dir)). Do NOT vi.mock('node:fs/promises')
// for the leniency test — that would skip the real readFile→JSON.parse→schema.parse path. Pattern B
// (module-level mock of readTasksJSON) is for CALLER tests, not parse-behavior tests.

// CRITICAL: the four secondary BacklogSchema.parse READ sites are OUT OF SCOPE:
//   state-validator.ts:190 (validateSchema → validate-state CLI),
//   tasks-json-recovery.ts:317 (git-history restore PATH B),
//   prp-pipeline.ts:2086 (#detectInterruptedBugfix — a CORRUPTION PROBE where strict is arguably correct),
//   task-orchestrator.ts:1323 (#checkHeadComplete — already swallows parse failures, returns false).
// The contract names ONLY readTasksJSON() and loadSession(). Switching the secondary sites changes
// their semantics and is a judgment call for a future task. S2 switches ONLY readTasksJSON:870.

// GOTCHA: BacklogReadSchema is FORMAT-lenient ONLY. It still THROWS on structural errors (bad subtask
// ID like 'P1.M1.T1.X', bad status like 'planned' lowercase, wrong type discriminator, EMPTY
// context_scope ''). Leniency = drops the 'CONTRACT DEFINITION:' prefix + 4-section check; keeps
// .min(1). A readTasksJSON test MUST assert at least one structural reject still throws
// (SessionFileError) — proves leniency is format-only.

// GOTCHA: lenient-read / strict-write interaction is INTENDED, not a bug. withLockedTasksJSON
// (file-lock.ts:491) calls readTasksJSON (lenient after S2) THEN writeTasksJSON (strict). A legacy
// file with a non-contract scope will LOAD but, if it flows into a status-update write-back branch,
// writeTasksJSON RE-validates strictly and THROWS. S2's read-relaxation only lets lenient data LOAD;
// it does not silently persist it. (For the common RMW path the mutator returns the caller's already-
// strict backlog, so the lenient load is only used to detect staleness — no regression.)

// GOTCHA: the architect-prompt.ts JSDoc (:26-28) is STALE — it claims responseFormat: BacklogSchema
// but the code (:93) uses z.unknown(). This is cosmetic and NOT in S2's scope to fix. Just don't be
// misled into thinking the prompt layer is the write validator — :777 (writeTasksJSON) is.

// GOTCHA: do NOT add BacklogReadSchema to the barrel re-export at src/core/index.ts. session-utils
// imports directly from ./models.js (as it already does for BacklogSchema). The barrel is for the
// public API; the read schema is an internal wiring detail.
```

---

## Implementation Blueprint

### Data models and structure
None. S2 adds NO new types or schemas. It consumes S1's `BacklogReadSchema` as-is (a drop-in: same
output type `Backlog`). The only "structure" is the local `nonContractIds: string[]` accumulator in
the optional scan loop.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/core/session-utils.ts — extend the import
  - FIND: line 42 `import { BacklogSchema, PRPDocumentSchema } from './models.js';`
  - CHANGE to: `import { BacklogSchema, BacklogReadSchema, PRPDocumentSchema } from './models.js';`
  - NOTE: BacklogSchema STAYS imported (writeTasksJSON:777 uses it). Both symbols coexist.
  - DO NOT touch any other import.

Task 2: MODIFY src/core/session-utils.ts — swap the read site + add the optional scan log
  - FIND: readTasksJSON (line ~857). Inside it, line ~870 `const validated = BacklogSchema.parse(parsed);`
  - CHANGE :870 to: `const validated = BacklogReadSchema.parse(parsed);`
  - INSERT (between :870 and the existing success debug log at :872) the optional non-contract scan:
      const nonContractIds: string[] = [];
      for (const phase of validated.backlog) {
        for (const milestone of phase.milestones) {
          for (const task of milestone.tasks) {
            for (const subtask of task.subtasks) {
              if (!subtask.context_scope.startsWith('CONTRACT DEFINITION:')) {
                nonContractIds.push(subtask.id);
              }
            }
          }
        }
      }
      if (nonContractIds.length > 0) {
        logger().debug(
          { sessionPath, nonContractIds, count: nonContractIds.length },
          'tasks.json loaded with subtask(s) missing CONTRACT DEFINITION prefix (lenient read)'
        );
      }
  - PRESERVE: the entry debug log (:862), the success debug log (:872), the catch + error log (:881)
    + SessionFileError throw (:889). The function's try/catch shape and return are unchanged.
  - VERIFY post-edit: `rg -n "BacklogSchema.parse" src/core/session-utils.ts` → exactly ONE match,
    inside writeTasksJSON (:777). `rg -n "BacklogReadSchema.parse" src/core/session-utils.ts` →
    exactly ONE match, inside readTasksJSON (:870).
  - DO NOT touch writeTasksJSON (:762/:777), session-manager.ts, models.ts, or any other file.

Task 3: CREATE tests/unit/core/session-utils.read-lenient.test.ts — lenient read-path tests
  - STRUCTURE: top-level describe('readTasksJSON — lenient read path (P2.M2.T1.S2)', () => {...}).
  - LOGGER MOCK (canonical vi.hoisted pattern — copy from change-classifier-resilient.test.ts:56-79):
      const { mockLogger, mockLoggerDebug } = vi.hoisted(() => {
        const debug = vi.fn();
        return { mockLogger: { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() }, mockLoggerDebug: debug };
      });
      vi.mock('../../../src/utils/logger.js', () => ({ getLogger: vi.fn(() => mockLogger) }));
      (CRITICAL: getLogger MUST return the stable mockLogger; logger() caches it at first call.)
      Add `beforeEach(() => { mockLoggerDebug.mockClear(); })` so each test's log assertions are isolated.
  - FIXTURE: a plain-scope backlog — clone the shape of `plainScopeBacklog` from
      tests/unit/core/models.test.ts:1308-1350 (a Backlog with ONE subtask whose context_scope is a
      PLAIN string like 'Implement feature X in src/foo.ts'). Also build a contract-format backlog
      (clone makeValidBacklog from tasks-json-recovery.test.ts:43-103, OR put a 'CONTRACT DEFINITION:\n...'
      scope on the same fixture) for the negative-log case.
  - HELPER: `writeTasksFile(dir, backlog)` → writeFileSync(join(dir,'tasks.json'), JSON.stringify(backlog)).
  - TESTS (cover 100% of the scan branch + the lenient/strict asymmetry):
      * it('loads a tasks.json with a plain (non-contract) context_scope (lenient read)'):
          write plain-scope backlog to a temp dir; `const result = await readTasksJSON(dir);` — assert
          it RESOLVES (no throw) and result.backlog is the parsed backlog. (This is the PRD Issue 3
          repro — previously threw 'context_scope must start with "CONTRACT DEFINITION:"'.)
      * it('emits a debug log listing subtask IDs missing the CONTRACT DEFINITION prefix'):
          same plain-scope setup; assert `expect(mockLoggerDebug).toHaveBeenCalledWith(
          expect.objectContaining({ nonContractIds: expect.arrayContaining([...]) }), expect.any(String))`.
          (Covers the scan loop's TRUE branch.)
      * it('does NOT emit the non-contract debug log for a contract-format backlog'):
          write a contract-format backlog; `await readTasksJSON(dir);` then assert mockLoggerDebug was
          NOT called with a payload containing `nonContractIds` (e.g. no call whose first arg has that
          key). (Covers the scan loop's FALSE branch → 100% branch coverage.)
      * it('still throws SessionFileError on STRUCTURAL errors (leniency is FORMAT-only)'):
          write a backlog with a bad subtask ID ('P1.M1.T1.X') or empty context_scope (''); assert
          `await expect(readTasksJSON(dir)).rejects.toThrow()` (SessionFileError). (Proves leniency is
          format-only — structural validation preserved.)
      * it('strict write still rejects a plain-scope backlog (writeTasksJSON unchanged)'):
          import writeTasksJSON; `await expect(writeTasksJSON(dir, plainScopeBacklog)).rejects.toThrow()`
          — proves the WRITE path (BacklogSchema.parse at :777) is STILL strict. (The core
          write-strict / read-lenient invariant.)
  - FOLLOW pattern: real temp dir (mkdtempSync in beforeEach), writeFileSync real tasks.json, no
      vi.mock('node:fs/promises'). SETUP/EXECUTE/VERIFY comment blocks (house style).
  - NAMING: test_{scenario} prose in it() titles; describe('readTasksJSON — lenient read path ...').
  - COVERAGE: the scan loop's both branches + the schema swap. No other branch added.
  - PLACEMENT: tests/unit/core/ (alongside tasks-json-recovery.test.ts).

Task 4: VERIFY — typecheck, lint, format, targeted tests, coverage
  - RUN `npx tsc --noEmit -p tsconfig.build.json` → exit 0 (BacklogReadSchema is a drop-in).
  - RUN `npm run lint && npm run format:check` → clean (run `npm run format` if it complains).
  - RUN `npx vitest run tests/unit/core/session-utils.read-lenient.test.ts` → green.
  - RUN `npx vitest run tests/unit/core/session-utils.read-lenient.test.ts --coverage` → 100% on
      src/core/session-utils.ts (the scan branch is covered both ways).
  - VERIFY `rg -n "BacklogSchema.parse" src/core/session-utils.ts` → ONE match (writeTasksJSON:777).
  - VERIFY `rg -n "BacklogReadSchema" src/core/session-utils.ts` → import + readTasksJSON:870.
  - VERIFY writeTasksJSON is byte-unchanged (git diff scoped to the writeTasksJSON function = empty).
  - VERIFY no edits to models.ts, session-manager.ts, or the four secondary READ sites.
  - NOTE: the FULL `npm run test:run` / `npm run validate` is NOT green yet (Issue 3A mock drift +
      Issue 4 bugfix numbering) and is NOT S2's gate — owned by P2.M3 / P3. S2's gate is the targeted
      read-lenient test + tsc + 100% session-utils coverage.
```

### Implementation Patterns & Key Details

```ts
// PATTERN: the read site swap (the entire production change, minus the optional scan).
// src/core/session-utils.ts readTasksJSON (line ~857):
export async function readTasksJSON(sessionPath: string): Promise<Backlog> {
  try {
    logger().debug({ sessionPath, operation: 'readTasksJSON' }, 'Reading tasks.json');
    const tasksPath = resolve(sessionPath, 'tasks.json');
    const content = await readFile(tasksPath, 'utf-8');
    const parsed = JSON.parse(content);
    const validated = BacklogReadSchema.parse(parsed);   // ← WAS BacklogSchema.parse (S2 swap)

    // OPTIONAL scan (contract item 3c): observable lenient acceptance, no rejection.
    const nonContractIds: string[] = [];
    for (const phase of validated.backlog)
      for (const milestone of phase.milestones)
        for (const task of milestone.tasks)
          for (const subtask of task.subtasks)
            if (!subtask.context_scope.startsWith('CONTRACT DEFINITION:'))
              nonContractIds.push(subtask.id);
    if (nonContractIds.length > 0) {
      logger().debug(
        { sessionPath, nonContractIds, count: nonContractIds.length },
        'tasks.json loaded with subtask(s) missing CONTRACT DEFINITION prefix (lenient read)'
      );
    }

    logger().debug({ sessionPath, itemCount: validated.backlog.length }, 'tasks.json read successfully');
    return validated;
  } catch (error) {
    // ... unchanged: logger().error + throw new SessionFileError(...)
  }
}

// CRITICAL: writeTasksJSON (line ~762) is UNCHANGED — stays strict:
export async function writeTasksJSON(sessionPath: string, backlog: Backlog): Promise<void> {
  // ...
  const validated = BacklogSchema.parse(backlog);   // ← STAYS BacklogSchema (strict write gate)
  // ...
}

// PATTERN: the vi.hoisted logger mock (stable shared object — logger() caches it).
const { mockLogger, mockLoggerDebug } = vi.hoisted(() => {
  const debug = vi.fn();
  return { mockLogger: { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() }, mockLoggerDebug: debug };
});
vi.mock('../../../src/utils/logger.js', () => ({ getLogger: vi.fn(() => mockLogger) }));
```

### Integration Points

```yaml
SOURCE (src/core/session-utils.ts):
  - import (MODIFY :42): add BacklogReadSchema (keep BacklogSchema)
  - readTasksJSON (MODIFY :870): BacklogSchema.parse → BacklogReadSchema.parse (+ optional scan log)
  - writeTasksJSON (UNCHANGED :777): BacklogSchema.parse (strict write — the architect-output gate)

TRANSITIVE (no edit needed):
  - src/core/session-manager.ts:654 loadSession → readTasksJSON (:656) — covered by the swap
  - src/core/session-manager.ts:724 loadSessionAsCurrent → loadSession — covered

TESTS (tests/unit/core/session-utils.read-lenient.test.ts — NEW):
  - lenient read accepts plain-scope; debug log fires; structural errors still throw; strict write
    still rejects plain-scope; no-log for contract-format (100% scan-branch coverage)

OUT OF SCOPE (do NOT touch):
  - src/core/models.ts (S1's schemas)
  - src/core/state-validator.ts:190, tasks-json-recovery.ts:317, prp-pipeline.ts:2086,
    task-orchestrator.ts:1323 (secondary READ sites — different semantics)
  - src/core/index.ts barrel (BacklogReadSchema is an internal wiring detail)

NO DATABASE / NO ROUTES / NO ENV VARS / NO CLI / NO DOCS — pure internal read-path wiring.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing src/core/session-utils.ts:
npx tsc --noEmit -p tsconfig.build.json   # MUST be exit 0 (BacklogReadSchema is a drop-in)
npm run lint -- --ext .ts                  # eslint: no unused-import / typing issues
npm run format:check                        # prettier; run `npm run format` if it complains

# Expected: Zero errors. The tsc check proves BacklogReadSchema is a type-compatible drop-in
# (same output type Backlog) for the swap.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new lenient read-path suite (GATED — runs under npm run validate):
npx vitest run tests/unit/core/session-utils.read-lenient.test.ts

# Coverage on session-utils.ts (100% thresholds enforced by vitest.config.ts):
npx vitest run tests/unit/core/session-utils.read-lenient.test.ts --coverage

# Re-run S1's schema suite to confirm no regression (the schemas themselves are unchanged):
npx vitest run tests/unit/core/models.test.ts

# Expected: ALL green. Specifically verify the read-lenient suite:
#   - plain-scope tasks.json LOADS (no throw) — the PRD Issue 3 repro.
#   - debug log fires with nonContractIds for plain-scope; SILENT for contract-format (100% branch).
#   - structural errors (bad ID / empty scope) still throw SessionFileError.
#   - writeTasksJSON STILL rejects a plain-scope backlog (strict write preserved).
# 100% coverage on src/core/session-utils.ts preserved (the scan branch is covered both ways).
# If coverage < 100%: the scan loop's FALSE branch (contract-format → no log) is untested — add the
# negative-log test (Task 3, 3rd it()).
```

### Level 3: Integration Testing (System Validation)

```bash
# NOTE: the FULL `npm run test:run` / `npm run validate` is NOT green yet and is NOT S2's gate —
# the suite has ~297 pre-existing failures (bugfix Issue 3A mock drift + Issue 4 bugfix numbering),
# owned by P2.M3 / P3. S2's gate is: targeted read-lenient test green + tsc exit 0 + 100%
# session-utils coverage + S1's models.test.ts still green.

# Build (compiles dist — confirms no transitive breakage from the import/swap):
npm run build

# Confirm the swap landed and writeTasksJSON is untouched:
rg -n "BacklogSchema.parse" src/core/session-utils.ts      # EXPECT: ONE match (writeTasksJSON:777)
rg -n "BacklogReadSchema" src/core/session-utils.ts        # EXPECT: import + readTasksJSON:870
git diff src/core/session-utils.ts | rg -n "writeTasksJSON" # EXPECT: no diff inside writeTasksJSON

# Confirm no edits to out-of-scope files:
git diff --stat src/core/models.ts src/core/session-manager.ts src/core/index.ts src/core/state-validator.ts src/core/tasks-json-recovery.ts src/workflows/prp-pipeline.ts src/core/task-orchestrator.ts
# EXPECT: empty (all out-of-scope files untouched)

# Expected: `npm run build` succeeds; swap landed at readTasksJSON; writeTasksJSON + all out-of-scope
# files untouched.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the lenient/strict asymmetry end-to-end (the core invariant):
#   readTasksJSON ACCEPTS a plain-scope file that writeTasksJSON REJECTS.
# (Covered by Task 3's last test, but re-state the proof here.)

# Confirm the optional debug log is observable (run the read-lenient suite with debug logging):
npx vitest run tests/unit/core/session-utils.read-lenient.test.ts -t "missing CONTRACT DEFINITION prefix"

# Confirm the four secondary READ sites STILL use strict BacklogSchema (out-of-scope, unchanged):
rg -n "BacklogSchema\.(parse|safeParse)" src/core/state-validator.ts src/core/tasks-json-recovery.ts src/workflows/prp-pipeline.ts src/core/task-orchestrator.ts
# EXPECT: all four sites still reference BacklogSchema (NOT BacklogReadSchema).

# Confirm BacklogReadSchema is NOT added to the barrel (internal wiring detail):
rg -n "BacklogReadSchema" src/core/index.ts   # EXPECT: empty

# Expected: read-lenient/strict-write asymmetry proven; secondary sites unchanged; barrel untouched.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit -p tsconfig.build.json` exit 0.
- [ ] `npm run lint` + `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/session-utils.read-lenient.test.ts` green.
- [ ] `npx vitest run tests/unit/core/models.test.ts` green (S1's schema tests — no regression).
- [ ] 100% coverage on `src/core/session-utils.ts` preserved.
- [ ] `npm run build` succeeds.

### Feature Validation
- [ ] `readTasksJSON` (:870) uses `BacklogReadSchema.parse`; `loadSession` (delegates) covered.
- [ ] `writeTasksJSON` (:777) UNCHANGED — still `BacklogSchema.parse` (strict write).
- [ ] Plain-scope `tasks.json` LOADS via readTasksJSON; `writeTasksJSON(<same>)` still THROWS.
- [ ] Structural errors (bad ID/status/empty scope) still throw SessionFileError (format-only leniency).
- [ ] Debug log fires with `nonContractIds` for plain-scope; SILENT for contract-format.
- [ ] No edits to models.ts / session-manager.ts / the four secondary READ sites / the barrel.

### Code Quality Validation
- [ ] Both `BacklogSchema` and `BacklogReadSchema` imported (write + read coexist).
- [ ] Optional scan loop uses the `(contextObj, msg)` logger overload (house style).
- [ ] Test uses the canonical `vi.hoisted` logger mock (stable shared object for the singleton).
- [ ] Test uses a REAL temp dir + REAL readTasksJSON (Pattern A — no fs mock).

### Documentation & Deployment
- [ ] No docs edits (work item says DOCS: none; S1 added the schema JSDoc).
- [ ] No new env vars / CLI / routes (pure internal read-path wiring).

---

## Anti-Patterns to Avoid

- ❌ Don't touch `writeTasksJSON` (:777) — it is the SOLE strict write validator for architect output.
- ❌ Don't swap any of the four secondary READ sites (state-validator:190, tasks-json-recovery:317,
     prp-pipeline:2086, task-orchestrator:1323) — they have different semantics and aren't named by
     the contract. S2 switches ONLY readTasksJSON:870.
- ❌ Don't edit `loadSession` in session-manager.ts — it delegates to readTasksJSON; the swap covers it.
- ❌ Don't modify `src/core/models.ts` (S1's schemas) or add BacklogReadSchema to the barrel.
- ❌ Don't remove the `BacklogSchema` import — writeTasksJSON:777 still uses it.
- ❌ Don't use `vi.mock('node:fs/promises')` for the leniency test — use a REAL temp dir (Pattern A)
     so the real readFile→JSON.parse→schema.parse path is exercised.
- ❌ Don't forget the `vi.hoisted` stable-object pattern for the logger mock — logger() caches the
     singleton; a fresh mock per call diverges from the spy.
- ❌ Don't skip the FALSE-branch test (contract-format → no debug log) — the scan's `if` needs both
     branches for 100% coverage.
- ❌ Don't gate S2 on the full `npm run test:run`/`validate` — the suite has ~297 pre-existing
     failures (Issue 3A/4, P2.M3/P3 scope); S2's gate is the targeted read-lenient test + tsc + coverage.
- ❌ Don't fix the stale architect-prompt.ts JSDoc (:26-28) — cosmetic, out of scope.
- ❌ Don't add docs (work item: DOCS none).

---

## Confidence Score

**9/10** — One-pass success likelihood is high. The production change is two lines (import + swap)
plus a self-contained optional scan loop, all anchored to verified line numbers. The two real risks
are both pre-solved: (1) **accidentally relaxing the write path** — the write-path scout PROVED
`writeTasksJSON:777` is the sole strict write gate (the architect prompt uses
`responseFormat: z.unknown()`, so there's no prompt-layer gate to lose), and the swap target (:870)
is explicitly distinguished from :777 with a verify-step (`rg` confirms exactly one `BacklogSchema.parse`
remains); (2) **100%-coverage branch trap** — the scan's `if` is covered both ways by two tests
(plain-scope → log; contract-format → no log). The lenient schema is a verified drop-in (S1 landed
it at models.ts:975; same output type `Backlog`). The scope decision (primary read path only; 4
secondary sites out of scope with rationale) matches the contract and the S1 PRP's integration-points
note. The remaining 1/10 is the inherent risk of two adjacent functions in the same file
(writeTasksJSON vs readTasksJSON) — mitigated by the verify step.