# S2 Codebase Analysis — Wire readTasksJSON/loadSession to BacklogReadSchema

Research for **P2.M2.T1.S2** ("Wire readTasksJSON and loadSession to use BacklogReadSchema").
Two scout runs + targeted reads. **S1 has ALREADY landed** the lenient schema hierarchy.

## 1. S1 is ALREADY in the tree (verified)

The lenient Read schema hierarchy is defined and exported in `src/core/models.ts`:
- `:832` `ContextScopeReadSchema` (accepts any non-empty string; `.min(1)`)
- `:844` `SubtaskReadSchema` (uses ContextScopeReadSchema)
- `:877` `TaskReadSchema`
- `:908` `MilestoneReadSchema` (z.lazy pattern preserved)
- between :908 and :975 `PhaseReadSchema` (z.lazy pattern preserved)
- `:975` `BacklogReadSchema` (root: `z.object({ backlog: z.array(PhaseReadSchema) })`)
- `:810` JSDoc states the wiring target is "readTasksJSON/loadSession — wired in P2.M2.T1.S2".

S1's unit tests already pass: `tests/unit/core/models.test.ts:21-26` (imports), `:1300+`
`describe('Read schemas (lenient)')`, asymmetry proof at `:1349` (lenient accepts / strict rejects
a plain-scope backlog), structural-rejection at `:1417-1490`.

**Gap (the S2 work):** the schemas exist & are unit-tested, but they are NOT yet wired into the
read path. `session-utils.ts:42` does NOT import `BacklogReadSchema`; `:870` still calls
`BacklogSchema.parse`.

## 2. The PRIMARY read path — S2's swap target (the entire production change)

`src/core/session-utils.ts`:
- **:42** import: `import { BacklogSchema, PRPDocumentSchema } from './models.js';`
  → S2 extends to `import { BacklogSchema, BacklogReadSchema, PRPDocumentSchema } from './models.js';`
- **:857** `export async function readTasksJSON(sessionPath: string): Promise<Backlog>`
- **:870** `const validated = BacklogSchema.parse(parsed);` ← **S2 swaps to `BacklogReadSchema.parse(parsed);`**
- :862 entry `logger().debug(...)`, :872 success `logger().debug(...)`, :881 catch `logger().error(...)`

`src/core/session-manager.ts`:
- **:654** `async loadSession(sessionPath): Promise<SessionState>` → calls `readTasksJSON(sessionPath)` at **:656**.
  loadSession is an INDIRECT caller — swapping readTasksJSON's schema satisfies the contract's
  "loadSession()" requirement. **No edit to loadSession itself is needed** (it delegates).

→ **The entire S2 production change is: (1) add `BacklogReadSchema` to the import at :42; (2) swap
`BacklogSchema` → `BacklogReadSchema` at :870. Two lines in one file.** loadSession is covered
transitively.

## 3. The WRITE path — MUST stay STRICT (do NOT touch)

`src/core/session-utils.ts:762` `writeTasksJSON` → `:777` `const validated = BacklogSchema.parse(backlog);`
This is the SINGLE strict write validator. The architect output flows through it:
`decomposePRD` (prp-pipeline.ts:1303-1316) reads the agent-written file with a PLAIN `JSON.parse` +
`as Backlog` cast (NO schema), then `saveBacklog(mergedBacklog)` → `withLockedTasksJSON`
(file-lock.ts:491) → `writeTasksJSON` (session-utils.ts:762) → **`BacklogSchema.parse` (:777, STRICT)**.

- The architect prompt does NOT use `BacklogSchema` as responseFormat — `architect-prompt.ts:93`
  uses `responseFormat: z.unknown()` (the file is the contract). So there is NO prompt-layer write
  validation to preserve; :777 is the sole gate.
- **S2 MUST NOT touch :777.** It is ~93 lines below the swap target (:870) in the SAME file —
  high blast-radius if confused. The two functions (`writeTasksJSON` at :762, `readTasksJSON` at :857)
  are adjacent; double-check the function name before editing.

### Lenient-read / strict-write interaction (intended, not a bug)
`withLockedTasksJSON` (file-lock.ts:491) calls BOTH read (`readTasksJSON` at :508/:544 — becomes
lenient under S2) AND write (`writeTasksJSON` at :551 — stays strict). A legacy/hand-edited file
with a non-contract `context_scope` will now LOAD leniently, but if it later flows into a status-
update write-back branch, `writeTasksJSON` RE-validates strictly and THROWS. This is the INTENDED
strict-write behavior — S2's read-relaxation only lets lenient data LOAD, it does not silently
persist it. (For the common RMW path the mutator returns the caller's already-strict backlog, so
the lenient load is only used to detect staleness — no regression.)

## 4. The FOUR secondary READ sites — OUT OF SCOPE for S2 (rationale)

The contract names ONLY `readTasksJSON()` and `loadSession()`. Four other `BacklogSchema.parse`/
`safeParse` sites are READ-path but have different semantics and are NOT named by the contract:

| Site | Function | Why out-of-scope for S2 |
|------|----------|-------------------------|
| `state-validator.ts:190` | `validateSchema` (→ `validate-state` CLI) | Feeds an explicit "validate the backlog" CLI; the user running `validate-state` arguably WANTS strict-format reporting, not silent acceptance. |
| `tasks-json-recovery.ts:317` | git-history restore loop (PATH B) | Walks OLD git blobs to find the last valid version. Switching to lenient would accept legacy blobs — defensible, but it's a recovery path with its own semantics; the contract doesn't name it. |
| `prp-pipeline.ts:2086` | `#detectInterruptedBugfix` | A CORRUPTION PROBE. Strict is arguably correct: a tasks.json whose scope lacks the contract prefix may indicate it was written by a different/older pipeline (i.e. "interrupted"). Relaxing it changes the probe's semantics. |
| `task-orchestrator.ts:1323` | `#checkHeadComplete` (reads HEAD blob) | Already wrapped in try/catch returning `false` (non-fatal) on any parse/schema failure. Historical HEAD data. |

**Decision: S2 switches ONLY the primary read path (readTasksJSON:870).** This is the minimal,
lowest-risk change that satisfies the contract ("Replace BacklogSchema.parse with
BacklogReadSchema.parse in readTasksJSON() and loadSession()"). loadSession is covered transitively.
The four secondary sites remain strict; if a future task wants them lenient, it can do so explicitly.
The S1 PRP's integration-points note confirms this scope: "session-utils.ts:870 BacklogSchema.parse →
BacklogReadSchema.parse".

## 5. The optional warning log (contract item 3c)

The contract says (3c): "Optionally: after successful lenient parse, scan for subtasks whose
context_scope doesn't start with 'CONTRACT DEFINITION:' and log a debug-level warning listing the IDs."

**Decision: INCLUDE the optional debug log.** It makes the lenient acceptance OBSERVABLE without
rejecting the file — directly serving the PRD Issue 3 "warn (not reject) on read" suggestion and
the PRD §5.1 recovery-orientation. Implementation:
- After `BacklogReadSchema.parse` succeeds (between :870 and the success debug at :872), scan the
  validated backlog for subtasks whose `context_scope` does NOT start with `'CONTRACT DEFINITION:'`.
- If any are found, emit ONE `logger().debug({ sessionPath, nonContractIds: [...] }, 'tasks.json
  loaded with N subtask(s) missing CONTRACT DEFINITION prefix (lenient read)')`.
- Use `debug` (not `warn`): this is informational for maintainers, not a user-facing problem. The
  contract explicitly says "debug-level warning". Keeping it at `debug` avoids log spam in normal
  operation where many legitimate sessions may lack the prefix.

### Scan helper
The backlog is `Backlog` = `{ backlog: Phase[] }`, Phase → milestones → tasks → subtasks. A small
nested loop collects subtask IDs whose `context_scope` lacks the prefix. No new import needed.

## 6. Test patterns (verified)

### Pattern A — REAL temp dir + REAL readTasksJSON (S2's leniency test belongs here)
Canonical: `tests/unit/core/tasks-json-recovery.test.ts` — `beforeEach` does
`dir = mkdtempSync(join(tmpdir(), '...'))`, writes a real `tasks.json` via
`writeFileSync(join(dir,'tasks.json'), JSON.stringify(...))`, then `await readTasksJSON(dir)`.
Helpers: `makeValidBacklog({s1Status,...})` at :43-103 (full 4-level Backlog, CONTRACT-format scope).
**No `vi.mock('node:fs/promises')`** — Pattern A writes real files.

### The existing asymmetry fixture (reuse it)
`tests/unit/core/models.test.ts:1308-1350` defines `plainScopeBacklog` — a Backlog with ONE subtask
whose `context_scope` is a PLAIN string. This is the EXACT input the strict schema rejects and the
lenient schema accepts (proven at :1349-1357). S2 can reuse this shape as the JSON payload for a
temp-dir `tasks.json` to prove `readTasksJSON` now loads it.

### Pattern B — module-level mock of readTasksJSON (NOT for S2's leniency test)
`vi.mock('...session-utils.js', () => ({ readTasksJSON: vi.fn() }))` — used by caller tests
(session-state-batching, flush-retry, task-orchestrator). S2 does NOT use this; it must exercise
the REAL parse path.

### Logger-assertion pattern (canonical, S1/S2-acknowledged)
`tests/unit/core/change-classifier-resilient.test.ts:56-79`:
```ts
const { mockLogger, mockLoggerDebug } = vi.hoisted(() => {
  const debug = vi.fn();
  return { mockLogger: { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() }, mockLoggerDebug: debug };
});
vi.mock('../../../src/utils/logger.js', () => ({ getLogger: vi.fn(() => mockLogger) }));
```
**CRITICAL:** `logger()` in session-utils is a lazy module-cached singleton (`_logger ??= getLogger(...)`
at :47-48). The mock MUST return a STABLE shared object (vi.hoisted) or the cached `_logger` diverges
from the spy after `vi.clearAllMocks()`. Assert:
`expect(mockLoggerDebug).toHaveBeenCalledWith(expect.objectContaining({ nonContractIds: [...] }), expect.any(String))`.

### loadSession integration tests (indirect coverage)
`tests/integration/core/session-manager.test.ts:569` `describe('SessionManager.loadSession()')` —
exercises the real loadSession against temp sessions. S2 can add a plain-scope case here for
end-to-end coverage, OR keep it focused at the readTasksJSON unit level. The contract emphasis is
readTasksJSON; a focused unit test is sufficient.

## 7. vitest.config.ts (unchanged)
- include `['tests/**/*.{test,spec}.ts']`; coverage include `['src/**/*.ts']`.
- thresholds: statements/branches/functions/lines = **100** global.
- S2's production change is a one-line schema swap + an optional scan loop. The scan loop IS a
  branch (the `if (nonContract.length > 0)` + the filter), so the test MUST exercise BOTH the
  "non-contract scopes present → debug log emitted" path AND the "all-contract → no debug log"
  path to preserve 100% branch coverage. (See §8.)

## 8. Coverage considerations (100% gate)
The schema swap itself (`BacklogReadSchema.parse` replacing `BacklogSchema.parse`) adds no branch.
The optional scan adds:
- A filter/map over subtasks (always runs — covered by any readTasksJSON test).
- An `if (nonContractIds.length > 0)` branch — MUST be covered BOTH ways:
  * TRUE branch: a plain-scope backlog → scan finds ≥1 → debug log emitted.
  * FALSE branch: a contract-format backlog → scan finds 0 → no debug log.
- Both are trivially covered by the two readTasksJSON tests (lenient-accept + strict-still-works).
The `startsWith('CONTRACT DEFINITION:')` check itself is covered by both.

## 9. Docs — S2 has NO doc deliverable
Work item item_description §5: "DOCS: none — no user-facing/config surface change (internal schema
refactor). JSDoc covered by P2.M2.T1.S1." S1 already added JSDoc to the lenient schemas. S2 touches
ONLY src/core/session-utils.ts (+ tests). Do NOT edit models.ts JSDoc, docs/, README.

## 10. Scope fences (do NOT touch)
- `src/core/models.ts` (the schemas) → owned by S1 (landed). Do not modify.
- `writeTasksJSON` (session-utils.ts:777) → STRICT WRITE path; must stay `BacklogSchema.parse`.
- The four secondary READ sites (state-validator:190, tasks-json-recovery:317,
  prp-pipeline:2086, task-orchestrator:1323) → out of scope (§4 rationale).
- `src/core/index.ts` barrel re-export → do NOT add `BacklogReadSchema` there; session-utils imports
  directly from `./models.js` (as it already does for `BacklogSchema`).
- The ~297 rotted tests / mock drift (Issue 3A) → P2.M3. S2's gate is the targeted
  readTasksJSON/loadSession tests + tsc + the schemas' own coverage, NOT the full `npm run test:run`.
- Bugfix session numbering (Issue 4) → P3.