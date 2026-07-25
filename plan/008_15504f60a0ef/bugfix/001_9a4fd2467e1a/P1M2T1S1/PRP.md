# PRP — P1.M2.T1.S1: Refactor `patchBacklog` 'added' case from silent-drop to documented delegation

> Bugfix 001, **Issue 2 (MAJOR)** — delta-path slice. With Issue 1 fixed
> (P1.M1.T1.S1 reorder LANDED + P1.M1.T1.S2 merge CONTRACT), the default delta
> path (`spawnDeltaSession → decomposePRD` over `delta_prd.md`) generates tasks for
> ADDED requirements. `patchBacklog` is a sync pure fn with no architect access,
> so its 'added' case is correctly a **no-op** — but it currently logs a misleading
> `warn('Feature not implemented')` that reads like a bug. This subtask replaces
> that warn with an accurate **debug** log documenting the delegation, removes the
> stale TODO comments, and updates the JSDoc. Behavior (no-op `break`) and the
> function signature/return type are **unchanged**.

---

## Goal

**Feature Goal**: Make `patchBacklog()`'s `case 'added'` an **accurately
documented no-op** instead of a misleading silent-drop. Replace
`logger().warn('Feature not implemented')` with a `logger().debug(...)` message
stating that added requirements are handled by the delta-session breakdown
(`decomposePRD` over `delta_prd.md`). Remove the TODO/placeholder comments. Update
the function + module JSDoc `@remarks` to reflect the delegation. The `break`
(no-op) and the signature `(backlog, delta) => Backlog` are preserved.

**Deliverable**:
1. **`src/core/task-patcher.ts`** — EDIT: (a) rewrite the `case 'added':` block
   (lines 97-106): delete the 4 stale comments + the TODO, change
   `logger().warn(...,'Feature not implemented')` → `logger().debug(...,<new msg>)`,
   keep `break;`; (b) update the **function** `@remarks` 'added' bullet; (c) update
   the **module** `@remarks` 'added' phrase for consistency.
2. **`tests/unit/core/task-patcher.test.ts`** — EDIT: update the 3 `it()` blocks
   that spy the added-case log (lines ~456-482, ~484-520, ~885-922):
   `mockLogger.warn` → `mockLogger.debug`, `'Feature not implemented'` → the new
   debug message, and refresh the test names/comments.

**Success Definition**:
- `patchBacklog(backlog, deltaWithAdded)` still returns the backlog **unchanged**
  for the added item (no-op) — only the log changes (warn → debug).
- No `warn('Feature not implemented')` is emitted for an 'added' change; a
  `debug(<context>, <new message>)` is emitted instead.
- The 3 updated tests assert `mockLogger.debug` (not `warn`) with the new message.
- `patchBacklog` signature + return type unchanged; callers
  (`spawnDeltaSession:1028`, `integrateIntoCurrentSessionResponse:943`) unaffected.
- `npm run typecheck && npm run lint && npm run format:check` clean;
  `npx vitest run tests/unit/core/task-patcher.test.ts` GREEN; `task-patcher.ts`
  stays at 100% coverage.

---

## Why

- **Removes a misleading signal.** `warn('Feature not implemented')` reads as an
  unfinished feature / bug. After Issue 1, the delta path DOES handle adds (via
  `decomposePRD`), so the no-op is intentional and correct — the log should say so
  (debug, accurate), not cry wolf (warn, misleading). Operators triaging logs
  shouldn't see a "Feature not implemented" warning for working behavior.
- **Aligns the code with the architecture decision.** `architecture/delta_workflow.md`
  §Issue 2 "Decision: Both Paths" explicitly prescribes: delta path → patchBacklog
  handles modified/removed, decomposePRD handles added; patchBacklog's 'added' case
  = debug log (no-op, delegated). This subtask implements exactly that.
- **Deletes stale TODO/comment cruft.** The 4 comments (`// Generate new tasks via
  Architect agent`, `// NOTE: …`, `// Placeholder: …`, `// TODO: Future
  enhancement …`) describe an approach (generate tasks inside patchBacklog) that
  the architecture rejected (patchBacklog can't — no architect/PRD-text/async).
- **Docs accuracy (Mode A).** The function `@remarks` currently claims 'added'
  "Generate new tasks via Architect agent and insert into backlog" — false. The
  JSDoc must document the delegation so future readers don't reimplement the
  rejected approach.
- **Scope discipline.** S1 touches ONLY `task-patcher.ts` (prod) + its unit test.
  It does NOT implement integrate-path added handling (S2), does NOT touch
  `prp-pipeline.ts` (the integrate-path GOTCHA comment is S2's file), and is
  file-disjoint from the parallel P1.M1.T1.S3 (which *mocks* patchBacklog).
- **Out of scope (hard boundary):** `integrateIntoCurrentSessionResponse()`
  added-requirement handling (S2), unit tests for both paths (S3), the
  `prp-pipeline.ts:902-903` GOTCHA comment (S2's file/scope), any change to
  `patchBacklog`'s signature/return/no-op behavior, and any `docs/*.md`.

---

## What

### User-visible behavior
None at the CLI/runtime surface for normal operation. The only observable change
is **log output**: an 'added' change during delta patching now produces a
`debug`-level line (visible only with `--verbose`) instead of a `warn`-level
"Feature not implemented" line. The patched backlog is byte-for-byte identical to
before (the `break` no-op is preserved).

### Technical requirements (exact contract)

**Verbatim new debug message** (stable test anchor — use exactly):
> `Added requirement delegated to delta-session breakdown (decomposePRD over delta_prd.md); patchBacklog is a no-op for added changes`

**`src/core/task-patcher.ts`** — `case 'added':` (lines 97-106) becomes:
```ts
      case 'added':
        // Added requirements are handled by the delta-session breakdown
        // (decomposePRD over delta_prd.md), not here: patchBacklog is a sync
        // pure fn with no architect/PRD-text access. No-op (break).
        logger().debug(
          { changeType: change.type, taskId },
          'Added requirement delegated to delta-session breakdown (decomposePRD over delta_prd.md); patchBacklog is a no-op for added changes'
        );
        break;
```
(Delete the 4 original comments — `// Generate new tasks via Architect agent`,
`// NOTE: …`, `// Placeholder: …`, `// TODO: Future enhancement …`. Keep `break;`.)

**`src/core/task-patcher.ts`** — function `@remarks` 'added' bullet (≈ lines 60-66):
```diff
- * - 'added': Generate new tasks via Architect agent and insert into backlog
+ * - 'added': No-op here — added requirements are delegated to the delta-session
+ *   breakdown (decomposePRD over delta_prd.md). patchBacklog is a synchronous pure
+ *   function with no Architect/PRD-section access, so it cannot generate tasks.
```

**`src/core/task-patcher.ts`** — module `@remarks` (≈ lines 9-13), for consistency:
```diff
- * Handles three change types: added (new tasks), modified (reset to Planned),
- * and removed (mark Obsolete). Completed work is preserved unless explicitly
- * affected by changes.
+ * Handles three change types: added (delegated to the delta-session breakdown —
+ * no-op here), modified (reset to Planned), and removed (mark Obsolete). Completed
+ * work is preserved unless explicitly affected by changes.
```

**`tests/unit/core/task-patcher.test.ts`** — 3 `it()` blocks (lines ≈456-482,
484-520, 885-922): replace every `mockLogger.warn` reference with
`mockLogger.debug`, every `'Feature not implemented'` literal with the verbatim
new debug message, and refresh `it()` titles + trailing comments. (See
Implementation Tasks for the exact per-block edits.) The behavior assertion at
line 918 (`findItem(...,'P1.M1.T1.S3')?.status === 'Complete'` — added task
unchanged) STAYS; only its trailing comment changes.

### Success Criteria
- [ ] `case 'added':` calls `logger().debug({ changeType: change.type, taskId }, <new msg>)`.
- [ ] No `logger().warn(...,'Feature not implemented')` remains in `task-patcher.ts`.
- [ ] The 4 stale comments / TODO in the 'added' case are deleted.
- [ ] Function `@remarks` 'added' bullet documents the delta-breakdown delegation.
- [ ] Module `@remarks` 'added' phrase updated for consistency.
- [ ] `patchBacklog` signature + return type unchanged; 'added' still `break` (no-op).
- [ ] The 3 updated tests assert `mockLogger.debug` with the new message (not `warn`).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean;
      `npx vitest run tests/unit/core/task-patcher.test.ts` GREEN.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes** — the verbatim replacement for the 'added' case (with the verbatim debug
message), the exact `@remarks` diffs, the 3 test blocks with line numbers and
exact `warn→debug` / message swaps, the proof that the no-op behavior is
preserved (line 918 stays valid), the Logger-API confirmation (`.debug(obj, msg?)`
exists + is idiomatic), the caller-unchanged proof, the scope boundaries (don't
touch `prp-pipeline.ts` / S2 / S3 files), and the pre-existing-red-suite caveat.
See `research/patchbacklog-added-delegation.md` for the grep evidence.

### Documentation & References
```yaml
# MUST READ — the Issue-2 architecture decision (what S1 implements)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/architecture/delta_workflow.md
  section: "Issue 2 → 'Decision: Both Paths' + 'Dependency: Issue 2 depends on Issue 1'"
  why: Prescribes the delta-path fix: patchBacklog handles modified/removed;
        decomposePRD handles added; patchBacklog's 'added' case = debug log (no-op).
  critical: The no-op is CORRECT only because Issue 1 is fixed (decomposePRD runs).
        S1 must NOT try to generate tasks inside patchBacklog (rejected: no architect/async).

# MUST READ — this subtask's research (the traps + exact edit map)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P1M2T1S1/research/patchbacklog-added-delegation.md
  section: "1. current 'added' case", "4. test breakage", "5. JSDoc", "7. scope boundaries", "8. coverage"
  why: The verbatim source block, the 3 test breakage sites (480/515/519/921), the Logger API
        confirmation, and the disjointness proof vs S2/S3.

# CONTEXT — Issue 1 (the dependency that makes the no-op correct) — read, do NOT edit
- file: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P1M1T1S1/PRP.md
  why: decomposePRD() now checks isDelta BEFORE hasBacklog → the delta breakdown is REACHABLE.
        This is why patchBacklog's 'added' no-op is safe (decomposePRD handles adds).
- file: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P1M1T1S2/PRP.md
  why: mergeBacklogs(...) at the saveBacklog seam → architect-decomposed added tasks land in
        the delta tasks.json ALONGSIDE patched statuses. (S1 doesn't depend on the merge
        mechanically, but the "added is handled by breakdown" claim relies on Issue 1 overall.)

# PATTERN FILES — the exact edit sites
- file: src/core/task-patcher.ts
  why: EDIT — case 'added' (97-106) warn→debug + delete comments; function @remarks (60-66);
        module @remarks (9-13). logger() is the module-level getter (line 27).
  pattern: "logger().warn({ changeType: change.type, taskId }, 'Feature not implemented');"
  gotcha: Keep `break;` (no-op). Logger().debug(obj, msg?) overload matches the warn arg shape exactly.

- file: tests/unit/core/task-patcher.test.ts
  why: EDIT — 3 it() blocks spy the added-case log. mockLogger (vi.hoisted, lines 29-36) already
        has `debug: vi.fn()` (line 34) → swap warn→debug is supported. Lines: 456-482, 484-520, 885-922.
  pattern: "expect(mockLogger.warn).toHaveBeenCalledWith({ changeType: 'added', taskId: '...' }, 'Feature not implemented')"
  gotcha: Line 918 (status 'Complete' — added task unchanged) STAYS VALID (no-op preserved); only its
          trailing comment + the warn→debug spy (919-922) change. Do NOT alter the no-op behavior.

# CONSUMERS (read-only — proves non-breaking)
- file: src/workflows/prp-pipeline.ts
  why: patchBacklog callers at :943 (integrateIntoCurrentSessionResponse) + :1028 (spawnDeltaSession
        step 5). Both consume the returned Backlog; neither observes the log. Signature/return
        unchanged ⇒ callers unaffected.
  gotcha: The GOTCHA comment at :902-903 ("patchBacklog's 'added' case is unimplemented — silently
          dropped") is in the INTEGRATE path. It is S2's file/scope. S1 leaves it; flag for S2.

# LOGGER API (read-only — confirms .debug is available + idiomatic)
- file: src/utils/logger.ts
  why: Logger interface (80-88): debug(obj, msg?, ...args) overload exists. Same shape as warn.
        Precedent: concurrent-executor.ts:321, state-validator.ts:459/493, change-classifier.ts:132
        all use logger().debug({ … }, 'msg').
```

### Current Codebase tree (relevant slice)
```bash
src/core/task-patcher.ts                 # EDIT — case 'added' (warn→debug) + function/module @remarks
tests/unit/core/task-patcher.test.ts     # EDIT — 3 it() blocks (warn→debug, message, names/comments)
# (src/workflows/prp-pipeline.ts — UNCHANGED; callers unaffected; GOTCHA comment = S2 scope)
```

### Desired Codebase tree with files to be added/edited
```bash
src/core/task-patcher.ts                 # MODIFIED (added-case log + JSDoc @remarks ×2)
tests/unit/core/task-patcher.test.ts     # MODIFIED (3 added-case spy blocks: warn→debug + message)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — KEEP the `break;` (no-op). This subtask changes ONLY the log (warn→debug) + message +
//   comments + JSDoc. It does NOT change patchBacklog's behavior, signature, or return type. The
//   added item is still left unchanged in the backlog. (Test line 918 asserts this — keep it green.)

// CRITICAL — use the VERBATIM debug message (see "Technical requirements"). The 3 tests assert on
//   the full string (matching the existing 'Feature not implemented' style). If you paraphrase, the
//   tests fail. Anchor substring if you want robustness, but the full string is the contract here.

// CRITICAL — Logger().debug(obj, msg?) is the SAME arg shape as warn(obj, msg?). The swap is literal:
//   `logger().warn({ changeType: change.type, taskId }, 'X')` → `logger().debug({ changeType: change.type, taskId }, 'Y')`.
//   Confirmed: logger.ts:86-87; precedent: concurrent-executor.ts:321, change-classifier.ts:132.

// CRITICAL — there are exactly THREE test blocks to update (not 1). `grep "Feature not implemented"`
//   returns task-patcher.test.ts lines 480, 515, 519, 921 (4 assertion lines across 3 it() blocks at
//   ~456, ~484, ~885). ALL mockLogger.warn.mockClear() calls in those blocks (458, 486, 886) → debug.
//   Missing one = a stale warn assertion fails (warn is never called now).

// CRITICAL — DO NOT touch src/workflows/prp-pipeline.ts. The GOTCHA comment at :902-903 is in the
//   integrate path (integrateIntoCurrentSessionResponse), which is P1.M2.T1.S2's scope. S1 leaves it
//   to avoid a merge conflict; flag it for S2. (It remains accurate for the integrate path until S2.)

// CRITICAL — DO NOT implement added-requirement handling in patchBacklog. patchBacklog is sync/pure
//   with no architect/PRD-text/async — it CANNOT generate tasks. The architecture REJECTED that
//   approach (delta_workflow.md §Issue 2). The fix is documentation + log-level, not new logic.

// GOTCHA — bugfix Issue 3: the FULL `npm run test:run` is PRE-EXISTING-RED (297 failures, P2/P3
//   scope). Do NOT use it as the gate. Gate = typecheck + lint + format:check + the TARGETED
//   task-patcher.test.ts. (Adding this change cannot increase the red count; it only flips 3
//   assertions from warn→debug within an already-green file.)

// GOTCHA — 100% coverage is globally enforced (vitest.config.ts). The new `logger().debug(...)` line
//   + `break` are exercised by the 3 updated tests ⇒ task-patcher.ts stays at 100%. No new branch.

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` before validate. The
//   multi-line debug() call + @remarks diffs may reflow — let `npm run fix` handle it.

// CRITICAL — Parallel execution: P1.M1.T1.S3 (running now) MOCKS patchBacklog
//   (vi.mock('.../task-patcher.js', …)) and does not import the real 'added' internals. S1's edit to
//   the real function is INVISIBLE to S3's mock ⇒ zero file overlap, no merge conflict.
```

---

## Implementation Blueprint

### Data models and structure
No data-model change. No signature change. The only structural change is the
body of one `case` clause + two JSDoc `@remarks` strings:

```ts
// src/core/task-patcher.ts — case 'added' (was warn('Feature not implemented'); break;)
case 'added':
  // Added requirements are handled by the delta-session breakdown
  // (decomposePRD over delta_prd.md), not here: patchBacklog is a sync pure fn
  // with no architect/PRD-text access. No-op (break).
  logger().debug(
    { changeType: change.type, taskId },
    'Added requirement delegated to delta-session breakdown (decomposePRD over delta_prd.md); patchBacklog is a no-op for added changes'
  );
  break;
```

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)
```yaml
Task 1: EDIT tests/unit/core/task-patcher.test.ts  (RED — flip the spies to debug + new message FIRST)
  - Block A — it('should log warning for added change (placeholder implementation)') (~456-482):
      * RENAME to: it('should log debug delegation for added change (no-op)')
      * mockLogger.warn.mockClear()  →  mockLogger.debug.mockClear()
      * expect(mockLogger.warn).toHaveBeenCalledWith({ changeType:'added', taskId:'P1.M1.T1.S1' }, 'Feature not implemented')
        → expect(mockLogger.debug).toHaveBeenCalledWith({ changeType:'added', taskId:'P1.M1.T1.S1' }, <NEW MSG>)
  - Block B — it('should handle multiple added changes with warnings') (~484-520):
      * RENAME to: it('should log debug delegation for multiple added changes')
      * mockLogger.warn.mockClear()  →  mockLogger.debug.mockClear()
      * expect(mockLogger.warn).toHaveBeenCalledTimes(2)  →  expect(mockLogger.debug).toHaveBeenCalledTimes(2)
      * both expect(mockLogger.warn).toHaveBeenCalledWith({ changeType:'added', taskId:'…' }, 'Feature not implemented')
        → expect(mockLogger.debug).toHaveBeenCalledWith({ changeType:'added', taskId:'…' }, <NEW MSG>)
  - Block C — combined modified+removed+added test (~885-922):
      * mockLogger.warn.mockClear() (886)  →  mockLogger.debug.mockClear()
      * line 918 KEEP: expect(findItem(patched,'P1.M1.T1.S3')?.status).toBe('Complete');
        (only update its trailing comment → "// added - unchanged (delegated to delta breakdown)")
      * expect(mockLogger.warn).toHaveBeenCalledWith({ changeType:'added', taskId:'P1.M1.T1.S3' }, 'Feature not implemented')
        → expect(mockLogger.debug).toHaveBeenCalledWith({ changeType:'added', taskId:'P1.M1.T1.S3' }, <NEW MSG>)
        (update the trailing "// Warning for 'added'" comment → "// debug delegation for 'added'")
  - <NEW MSG> = the verbatim string from "Technical requirements".
  - EXPECTED NOW: the 3 blocks FAIL (warn is never called; debug msg mismatch) → RED. (Block C's status
    assertion at 918 still passes — behavior unchanged.)

Task 2: EDIT src/core/task-patcher.ts  (GREEN — the 'added' case)
  - Replace the case 'added' body (97-106) with the verbatim block from "Data models and structure":
    delete the 4 stale comments + TODO; warn→debug with <NEW MSG>; KEEP break;.
  - EXPECTED: the 3 test blocks turn GREEN (debug now called with <NEW MSG>); block C line 918 stays green.

Task 3: EDIT src/core/task-patcher.ts  (JSDoc — Mode A)
  - Function @remarks 'added' bullet (~60-66): apply the diff in "Technical requirements" (documents
    the delta-breakdown delegation; notes patchBacklog is sync/pure with no architect access).
  - Module @remarks (~9-13): apply the diff (added → "delegated to the delta-session breakdown — no-op here").
  - DO NOT change any other JSDoc, the function signature, the @param/@returns, or the @example.
  - EXPECTED: no behavior change; typecheck/format pass.

Task 4: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/task-patcher.test.ts   # the affected suite — GREEN.
  - DO NOT run the full `npm run test:run` (pre-existing red — bugfix Issue 3, P2/P3 scope).
  - EXPECTED: typecheck/lint/format clean; task-patcher.test.ts green; task-patcher.ts 100% covered.
```

### Implementation Patterns & Key Details
```ts
// ---- src/core/task-patcher.ts: the 'added' case (verbatim replacement) ----
      case 'added':
        // Added requirements are handled by the delta-session breakdown
        // (decomposePRD over delta_prd.md), not here: patchBacklog is a sync
        // pure fn with no architect/PRD-text access. No-op (break).
        logger().debug(
          { changeType: change.type, taskId },
          'Added requirement delegated to delta-session breakdown (decomposePRD over delta_prd.md); patchBacklog is a no-op for added changes'
        );
        break;

// ---- src/core/task-patcher.ts: function @remarks 'added' bullet ----
 * - 'added': No-op here — added requirements are delegated to the delta-session
 *   breakdown (decomposePRD over delta_prd.md). patchBacklog is a synchronous pure
 *   function with no Architect/PRD-section access, so it cannot generate tasks.

// ---- src/core/task-patcher.ts: module @remarks ----
 * Handles three change types: added (delegated to the delta-session breakdown —
 * no-op here), modified (reset to Planned), and removed (mark Obsolete). Completed
 * work is preserved unless explicitly affected by changes.

// ---- tests/unit/core/task-patcher.test.ts: the spy swap (Block A) ----
    it('should log debug delegation for added change (no-op)', () => {
      mockLogger.debug.mockClear();          // was: mockLogger.warn.mockClear();
      // …backlog + delta (unchanged)…
      patchBacklog(backlog, delta);
      expect(mockLogger.debug).toHaveBeenCalledWith(   // was: mockLogger.warn
        { changeType: 'added', taskId: 'P1.M1.T1.S1' },
        'Added requirement delegated to delta-session breakdown (decomposePRD over delta_prd.md); patchBacklog is a no-op for added changes'
      );
    });
// (Blocks B + C follow the same warn→debug + message swap; Block C also keeps the line-918 status assertion.)
```

### Integration Points
```yaml
TASK-PATCHER.TS (src/core/task-patcher.ts):
  - case 'added' body: warn('Feature not implemented') → debug(<NEW MSG>); delete 4 stale comments; KEEP break.
  - function @remarks: 'added' bullet → delegation wording.
  - module @remarks: 'added' phrase → delegation wording.
  - PRESERVE: signature (backlog, delta) => Backlog; return value; no-op behavior; modified/removed cases.

TASK-PATCHER.TEST.TS (tests/unit/core/task-patcher.test.ts):
  - 3 it() blocks: mockLogger.warn → mockLogger.debug; 'Feature not implemented' → <NEW MSG>; refresh names/comments.
  - PRESERVE: line-918 status assertion (added task unchanged); all modified/removed/edge-case tests.

CALLERS (read-only — UNCHANGED):
  - src/workflows/prp-pipeline.ts:943 (integrateIntoCurrentSessionResponse) + :1028 (spawnDeltaSession step 5).
  - Neither observes the log; both consume the returned Backlog. Signature/return unchanged ⇒ unaffected.

DOCS (Mode A — JSDoc rides with the work):
  - The function + module @remarks edits are the ONLY doc artifacts. NO docs/*.md, README, or
    .env.example changes. The prp-pipeline.ts:902-903 GOTCHA comment is S2's scope (leave it).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — the debug() call + @remarks may reflow)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean (src/; the debug overload matches)
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. Likely failure: a stale `mockLogger.warn` reference left in a test block
#   (lint no-unused-vars won't catch it, but the targeted vitest run will — see Level 2).
```

### Level 2: Unit Tests (Component Validation)
```bash
# The directly-affected suite — MUST be GREEN:
npx vitest run tests/unit/core/task-patcher.test.ts
# Coverage on the touched source file (confirm 100% retained):
npx vitest run tests/unit/core/task-patcher.test.ts --coverage
# Expected: green. If a 'should … added …' test fails with "expected warn to be called" → a Block
#   warn→debug swap was missed (lines 458/478-481, 486/512-519, 886/919-922). If it fails with a
#   message mismatch → the <NEW MSG> literal differs between source and test (copy verbatim).
# Do NOT run the full `npm run test:run` — pre-existing red (bugfix Issue 3, P2/P3 scope).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm no OTHER test asserted on the old warn/message (should be none):
grep -rn "Feature not implemented" src/ tests/   # Expect: ZERO hits after the edit.
# Confirm callers still compile + the signature is intact:
npx tsc -p tsconfig.build.json
# Targeted regression on a sibling that exercises patchBacklog (uses it, doesn't spy the warn):
npx vitest run tests/unit/core/delta-prd.test.ts   # uses patchBacklog via the pipeline mock path
# Expected: grep returns nothing; build clean; delta-prd.test.ts green (it mocks patchBacklog, so the
#   real 'added' change is invisible to it — unaffected).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. Behavior unchanged: an 'added' change leaves the backlog item untouched (no-op). Proof:
#      task-patcher.test.ts Block C line 918 still asserts status 'Complete' for the added item.
#   2. Log level + message: warn→debug with the delegation wording. Proof: the 3 spy blocks assert
#      mockLogger.debug with <NEW MSG>; `grep "Feature not implemented" src/ tests/` returns nothing.
#   3. Signature/return intact: patchBacklog(backlog, delta): Backlog — callers at prp-pipeline.ts
#      :943 and :1028 are unchanged and consume the returned Backlog.
#   4. Docs: function + module @remarks now document the delta-breakdown delegation (Mode A).
#   5. Scope: prp-pipeline.ts UNTOUCHED (the :902-903 GOTCHA comment is S2's integrate-path scope).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/task-patcher.test.ts` GREEN.
- [ ] `grep -rn "Feature not implemented" src/ tests/` returns ZERO hits.
- [ ] `src/core/task-patcher.ts` remains at 100% coverage.

### Feature Validation
- [ ] `case 'added':` calls `logger().debug(...)` with the verbatim delegation message.
- [ ] No `logger().warn(...,'Feature not implemented')` remains.
- [ ] The 4 stale comments / TODO in the 'added' case are deleted.
- [ ] `break;` (no-op) preserved — added item left unchanged (Block C line 918 still passes).
- [ ] The 3 test blocks assert `mockLogger.debug` (not `warn`) with the new message.

### Code Quality Validation
- [ ] `patchBacklog` signature `(backlog, delta) => Backlog` and return type unchanged.
- [ ] Function `@remarks` 'added' bullet documents the delta-breakdown delegation.
- [ ] Module `@remarks` 'added' phrase updated for consistency.
- [ ] Only `src/core/task-patcher.ts` + `tests/unit/core/task-patcher.test.ts` are modified.
- [ ] `src/workflows/prp-pipeline.ts` UNTOUCHED (GOTCHA comment = S2 scope).

### Documentation & Deployment
- [ ] JSDoc @remarks edits are the only doc artifacts (Mode A — rides with the code).
- [ ] No `docs/*.md`, README, or `.env.example` changes.
- [ ] Commit message notes: warn→debug delegation, the Issue-1 dependency (decomposePRD handles adds),
      the no-op-is-correct rationale, the 3 test-spy updates, and the S2 cross-reference (integrate path).

---

## Anti-Patterns to Avoid

- ❌ Don't change `patchBacklog`'s behavior, signature, or return type. This is a log-level +
      message + JSDoc change. The `break` (no-op) stays; the added item is left unchanged.
- ❌ Don't implement added-requirement handling inside `patchBacklog` (no architect/PRD-text/async).
      The architecture REJECTED that (delta_workflow.md §Issue 2). Added tasks come from
      `decomposePRD` over `delta_prd.md` (Issue 1). S1 only documents the delegation.
- ❌ Don't paraphrase the debug message — use the verbatim string. The 3 tests assert the full
      message (matching the prior 'Feature not implemented' style); a paraphrase fails them.
- ❌ Don't forget the `mockLogger.warn.mockClear()` → `mockLogger.debug.mockClear()` swap in EACH of
      the 3 blocks (lines 458, 486, 886). A leftover `warn` clear is harmless, but a leftover
      `expect(mockLogger.warn)` FAILS (warn is never called now).
- ❌ Don't touch `src/workflows/prp-pipeline.ts`. The `:902-903` GOTCHA comment lives in
      `integrateIntoCurrentSessionResponse` = P1.M2.T1.S2's scope. Leave it for S2 (it stays accurate
      for the integrate path until S2 fixes that path).
- ❌ Don't drop the Block-C line-918 status assertion (`'Complete'` for the added item) — it proves the
      no-op behavior is preserved. Only its trailing comment + the warn→debug spy change.
- ❌ Don't run the full `npm run test:run` as the gate — it's pre-existing red (bugfix Issue 3,
      297 failures, P2/P3 scope). Gate = typecheck + lint + format:check + targeted task-patcher.test.ts.
- ❌ Don't edit the function `@example`, `@param`, or `@returns`; don't touch the modified/removed
      cases; don't change the logger getter (`logger()`).
- ❌ Don't touch `delta-prd.test.ts`, `backlog-merger.test.ts`, `delta-session.test.ts`, or any
      P1.M1.T1.S3 file — S1/S2/S3 regression-locked / parallel-disjoint. (S3 mocks patchBacklog, so
      S1's edit to the real function is invisible to it — no conflict.)

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a tiny, surgical change — one `case` clause's log call (warn→debug + message), 4
deleted comment lines, and two JSDoc `@remarks` strings — with the test impact fully enumerated by
grep (`'Feature not implemented'` appears only at `task-patcher.ts:104` + `task-patcher.test.ts`
lines 480/515/519/921 across exactly 3 `it()` blocks). The Logger `.debug(obj, msg?)` overload is
confirmed identical in shape to `warn` and is an established in-repo pattern
(`concurrent-executor.ts:321`, `change-classifier.ts:132`), so the swap is literal. The no-op
behavior is preserved (Block-C line 918 stays valid), and the function signature/return are
untouched, so both callers (`prp-pipeline.ts:943/1028`) are unaffected. Scope is airtight: S1 edits
only `task-patcher.ts` + its unit test; it is file-disjoint from the parallel P1.M1.T1.S3 (which
mocks patchBacklog) and from S2 (integrate path / `prp-pipeline.ts`). The one caveat — the full
suite is pre-existing red (bugfix Issue 3) — is handled by using the targeted task-patcher.test.ts
as the gate. Residual risks: a stale `mockLogger.warn` reference left in one of the 3 blocks (the
targeted vitest run pinpoints it) or a prettier reflow of the multi-line debug() call (auto-fixed
via `npm run fix`). No runtime/network/LLM unknowns — `patchBacklog` is a pure function.