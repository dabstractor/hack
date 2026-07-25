# Research — `patchBacklog` 'added' case: silent-drop → documented delegation

Findings anchoring P1.M2.T1.S1 (bugfix 001, Issue 2). All line numbers verified
against the working tree.

## 1. The current 'added' case (the thing being changed)

`src/core/task-patcher.ts:97-106`:
```ts
case 'added':
  // Generate new tasks via Architect agent
  // NOTE: New PRD section content not available in current scope
  // Placeholder: Log warning and continue
  // TODO: Future enhancement - pass new PRD content to Architect
  logger().warn(
    { changeType: change.type, taskId },
    'Feature not implemented'
  );
  break;
```
- `patchBacklog` is `export function patchBacklog(backlog: Backlog, delta: DeltaAnalysis): Backlog`
  (line 65) — a **synchronous pure function**. It has no architect access, no new
  PRD section text (the `RequirementChange` for 'added' carries only `itemId`,
  `description`, `impact`), and no async capability. It CANNOT generate tasks.
- The `break` makes 'added' a **no-op** (the task is left unchanged). The
  `warn('Feature not implemented')` is misleading — it implies a bug rather than
  an intentional delegation.

## 2. Why a debug-log no-op is now CORRECT (the dependency)

`architecture/delta_workflow.md` §Issue 2 "Decision: Both Paths" + "Dependency:
Issue 2 depends on Issue 1": with **Issue 1 fixed** (P1.M1.T1.S1 reorder LANDED +
P1.M1.T1.S2 merge CONTRACT), the **default delta path** handles added
requirements:
`handleDelta` → `spawnDeltaSession` → `decomposePRD` runs the Architect over
`delta_prd.md` and `mergeBacklogs` merges the new tasks in. So in the delta path
`patchBacklog` only needs to patch **modified/removed**; 'added' is correctly a
no-op delegated to the breakdown. The misleading warn → an accurate debug log.

- **Integrate path** (`integrateIntoCurrentSessionResponse`, prp-pipeline.ts:907)
  does NOT create a delta session, so it STILL drops adds — but fixing that is
  **P1.M2.T1.S2's** scope ("Implement added-requirement handling in
  integrateIntoCurrentSessionResponse() path"). S1 only makes `patchBacklog`'s
  'added' case a documented no-op; it does NOT touch the integrate path.

## 3. Logger API — `.debug` is available and idiomatic

`src/utils/logger.ts:80-88`:
```ts
export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  debug(obj: unknown, msg?: string, ...args: unknown[]): void;   // ← this overload
  ...
}
```
`logger()` (task-patcher.ts:27) is `(): Logger => (_logger ??= getLogger('TaskPatcher'))`.
The `logger().debug({ … }, 'msg')` shape is an **established convention**:
`concurrent-executor.ts:321`, `state-validator.ts:459/493`, `file-lock.ts:500`,
`change-classifier.ts:132`. So changing `logger().warn({ changeType, taskId }, '…')`
→ `logger().debug({ changeType, taskId }, '…')` is a drop-in, same arg shape.

## 4. The test breakage (the one real risk) — `tests/unit/core/task-patcher.test.ts`

`grep -rn "Feature not implemented" src/ tests/` → ONLY `task-patcher.ts:104`
(source) + `task-patcher.test.ts` lines **480, 515, 519, 921**. No other file
asserts on it. The added-case `warn` is spied in 3 `it()` blocks:

| Lines | Test | What it asserts |
| --- | --- | --- |
| 456-482 | `it('should log warning for added change (placeholder implementation)')` | `mockLogger.warn.mockClear()` (458); `expect(mockLogger.warn).toHaveBeenCalledWith({ changeType:'added', taskId:'P1.M1.T1.S1' }, 'Feature not implemented')` (478-481) |
| 484-520 | `it('should handle multiple added changes with warnings')` | `mockLogger.warn.mockClear()` (486); `expect(mockLogger.warn).toHaveBeenCalledTimes(2)` (512); two `toHaveBeenCalledWith` (513-519) |
| 885-922 | combined modified+removed+added test | `mockLogger.warn.mockClear()` (886); `expect(mockLogger.warn).toHaveBeenCalledWith({ changeType:'added', taskId:'P1.M1.T1.S3' }, 'Feature not implemented')` (919-922) |

The mock already defines `debug: vi.fn()` (test line 34) — so swapping
`warn`→`debug` is supported. Each of the 3 blocks needs:
- `mockLogger.warn.mockClear()` → `mockLogger.debug.mockClear()`
- `expect(mockLogger.warn)` → `expect(mockLogger.debug)`
- `'Feature not implemented'` → the new debug message (verbatim)
- test `it()` names: drop "warning"/"placeholder"; say "debug"/"delegated".

**Behavior preserved (no-op):** test line 918
`expect(findItem(patched, 'P1.M1.T1.S3')?.status).toBe('Complete')` (added task
unchanged) STAYS VALID — only the log changed, not the `break`/no-op. Update only
its trailing comment ("placeholder" → "delegated to delta breakdown").

## 5. JSDoc to update (Mode A — rides with the work)

**Function `@remarks` (task-patcher.ts ~60-66)** — currently INACCURATE:
```
 * Processes three change types:
 * - 'added': Generate new tasks via Architect agent and insert into backlog
 * - 'modified': Reset task status to 'Planned' for re-implementation
 * - 'removed': Set task status to 'Obsolete'
```
The 'added' bullet must become: "Delegated to the delta-session breakdown
(decomposePRD over delta_prd.md); patchBacklog is a no-op for added changes
(sync pure fn, no architect access)."

**Module `@remarks` (~9-13)** — for consistency, soften "added (new tasks)" →
"added (delegated to delta-session breakdown)". Both live in the same file.

## 6. Callers — unchanged, continue to work

`patchBacklog` is called at:
- `src/workflows/prp-pipeline.ts:943` (`integrateIntoCurrentSessionResponse`).
- `src/workflows/prp-pipeline.ts:1028` (`spawnDeltaSession` step 5).
Both call `patchBacklog(backlog, delta)` and consume the returned `Backlog`.
**Signature and return type are unchanged**; only the log level/message inside
the 'added' branch changes. No caller observes the log. ⇒ callers unaffected.

## 7. Scope boundaries (what NOT to touch)

- **`src/workflows/prp-pipeline.ts:902-903`** — the `GOTCHA: patchBacklog's
  'added' case is unimplemented … silently dropped` comment lives inside
  `integrateIntoCurrentSessionResponse`. After S1 it is stale ABOUT patchBacklog,
  but it remains ACCURATE for the integrate path (which still drops adds until
  S2). It is **S2's** file/scope (integrate-path added handling). S1 leaves it
  alone to avoid a merge conflict; flag it for S2.
- **P1.M2.T1.S2** (integrate-path added handling) + **P1.M2.T1.S3** (unit tests
  for both paths) — separate subtasks. S1 does not implement integrate-path
  handling or write those tests.
- **P1.M1.T1.S3** (parallel, running now) — MOCKS `patchBacklog`
  (`vi.mock('.../task-patcher.js', …)`) and does not import the real function's
  internals. S1's edit to the real 'added' case is **invisible** to S3's mock ⇒
  zero overlap, no merge conflict.
- **`delta-prd.test.ts` / `backlog-merger.test.ts` / `delta-session.test.ts`** —
  untouched (S1/S2/S3 regression-locked).

## 8. Coverage & validation

- `task-patcher.ts` is in `src/` ⇒ 100% coverage globally enforced
  (`vitest.config.ts`). The new `logger().debug(...)` line + `break` are
  exercised by the 3 updated tests ⇒ coverage preserved (no new branch).
- **Bugfix Issue 3 caveat:** the FULL `npm run test:run` is PRE-EXISTING-RED
  (297 failures — P2/P3 scope, not S1's concern). The S1 gate is:
  `npm run typecheck && npm run lint && npm run format:check` clean +
  `npx vitest run tests/unit/core/task-patcher.test.ts` GREEN. Do NOT use the
  full suite as the gate (it is red for unrelated reasons).
- Commands (verified in package.json): `npm run fix` (lint:fix + format),
  `npm run validate` (lint + format:check + typecheck), `npm run typecheck`
  (tsc -p tsconfig.build.json, src/ only).