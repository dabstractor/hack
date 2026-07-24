# P4.M1.T2.S1 Research Summary — `--accept-prd-changes` & Integrate-Into-Current Handlers

## VERDICT

This is **net-new infrastructure**, NOT wiring. The work-item CONTRACT names three
symbols/behaviors that **DO NOT EXIST** in `src/` today (confirmed by exhaustive grep):

| Symbol/Behavior named in CONTRACT | Status in `src/` today |
|---|---|
| `pending_delta_hash` / `pendingDeltaHash` | **0 matches** — never written, read, or cleared |
| `PRD_CHANGED_*` session states | **0 matches** — there is NO session-lifecycle state enum at all (only the per-item `Status` union `Planned|...|Obsolete`) |
| `--accept-prd-changes` CLI flag | **0 matches** in `src/` and `docs/` — net-new flag |
| "integrate into current session" code | **0 matches** — only `createDeltaSession` (NEW dir) + `handleDelta` exist |
| `delta_from.txt` linkage file | **PHANTOM** — listed in `git-commit.ts` PROTECTED_FILES but never written; real linkage file is `parent_session.txt` |
| PRD-change detection reachable in normal flow | **DEAD CODE** — see §The detection gap below |

Therefore this PRP must **build** the PRD_CHANGED_* session state machine, the
`pending_delta_hash` persistence marker, the `--accept-prd-changes` CLI flag, the
three response-selection branches in `handleDelta()`, the snapshot-refresh-until-
integration contract, and the Mode-B docs — all from scratch, on top of the existing
`handleDelta()`/`createDeltaSession()`/`hasSessionChanged()` scaffolding.

## SCOPE BOUNDARY (this PRP vs siblings)

- **P4.M1.T1.S1** (parallel, "Implementing") owns the LLM classifiers
  (`src/core/change-classifier.ts`: `classifyChange`/`classifyArtifact`). This PRP
  does NOT call them — classification is upstream of response selection. But the
  response-selection handler must be structured so a SUBSTANTIVE verdict (from
  P4.M1.T1.S2's `classifyChangeWithRetry`) routes into one of the three paths.
  This PRP treats the classifier output as an INPUT (CONTRACT (2)) but does not wire
  it; it leaves a single clearly-marked seam.
- **P4.M1.T1.S2** (parallel, "Implementing") owns the resilient wrappers. Same
  relationship — input, not consumed yet here.
- **P4.M1.T2.S2** ("Validate/bug-hunt reuse completed session with pending change")
  is the NEXT item and consumes the `PRD_CHANGED_*` state + `pending_delta_hash`
  this PRP introduces. So this PRP MUST define those primitives in a reusable way
  (a typed `SessionState.prdChangeState` field + a `pending_delta_hash` marker file
  helper) so S2 can build the reuse logic on top.
- **P4.M1.T3.S1** ("Breakdown MUST consume the delta PRD") is downstream of the
  delta-session path only — independent of accept/integrate.

## The detection gap (CRITICAL — read before implementing)

`SessionManager.initialize()` (`src/core/session-manager.ts:298+`) finds a session by
**exact hash match** (`#findSessionByHash(sessionHash)` at :266; called at :384). It
sets `#prdHash = sessionHash` (current PRD) AND loads (or creates) a session whose
`metadata.hash` **equals** `sessionHash`. Therefore `hasSessionChanged()`
(`:1483`, returns `#prdHash !== #currentSession.metadata.hash`) **ALWAYS returns
false** in the normal flow — there is no way for a mismatch to arise.

Per PRD §4.3 ("Detection: System detects hash mismatch (computed from
`prd_snapshot.md` content)") and the JSDoc at `:1461-1482`, the INTENDED design is:
load a session (by sequence / explicit path) and compare the **current** PRD hash
against the **session's stored snapshot hash**. For response-selection to be
reachable, this PRP introduces a `PRD_CHANGED_*` state and a `pending_delta_hash`
that persists across runs, AND wires detection so a mismatch is detected when an
existing session is resumed against a changed PRD.

This PRP implements the **minimal** detection plumbing needed for the three paths
to be reachable, scoped to: (a) a `PRD_CHANGED_PENDING` marker, (b) detection on
resume when `--continue` loads a prior session whose snapshot hash ≠ current PRD
hash, (c) the three response paths. Full multi-session state-machine completeness is
NOT required (S2 owns the validate/bug-hunt reuse path which is the 4th state
transition).

## Key file facts (with line numbers — verified)

### `src/workflows/prp-pipeline.ts`
- `:576-582` — the delta-routing call site in `initializeSession()`:
  `if (this.sessionManager.hasSessionChanged()) { ... await this.handleDelta(); }`
- `:619-736` — `handleDelta()` body (`@Step`-decorated). Today: single path
  (oldPRD ← `currentSession.prdSnapshot`; newPRD ← `resolvePRD(prdPath)`;
  completedTaskIds ← `filterByStatus('Complete')`; `DeltaAnalysisWorkflow.run()`;
  `patchBacklog`; `createDeltaSession`; `saveBacklog`). This is where the
  response-selection branches go.
- `:312-352` — `PRPPipeline` constructor takes **22 positional params**; `mode` is
  the 3rd. A new `acceptPrdChanges: boolean` flag MUST be threaded as a new
  positional param (or a new options-bag — see PRP for the chosen approach).

### `src/core/session-manager.ts`
- `:1483-1490` — `hasSessionChanged()` (the detection predicate; currently dead).
- `:298+` — `initialize()` (hash-match session load).
- `:631-720` — `createDeltaSession(newPRDPath)`: creates `{seq+1}_{hash}` dir,
  writes `parent_session.txt`, sets `#currentSession = deltaSession` IN PLACE.
  **Does NOT write `prd_snapshot.md` for the delta dir.**
- `:569-607` — `loadSession()`: reads `prd_snapshot.md` (`:573-575`) +
  `parent_session.txt` (`:581-586`) unconditionally.
- `:1365` — `static findLatestSession(planDir)` (returns highest-seq SessionMetadata).

### `src/core/session-utils.ts`
- `:1010-1130` — `snapshotPRD(sessionPath, prdPath, resolvedContent?)` — writes
  `prd_snapshot.md`. The ONLY writer. No "refresh to current PRD" path exists.
- `:1136-1175` — `loadSnapshot(sessionPath)` — strict UTF-8 reader.

### `src/core/task-patcher.ts`
- `:99-135` — `patchBacklog` switch: `modified`→`updateItemStatus('Planned')`;
  `removed`→`updateItemStatus('Obsolete')`; **`added` → NO-OP ("Feature not
  implemented" warn-log, TODO)**. This is the BLOCKER for correct delta patching
  but is OUT OF SCOPE for this PRP (the `added` case is a separate concern; the
  integrate path works on `modified`/`removed` which ARE implemented). NOTE this as
  a residual risk.

### `src/core/models.ts`
- `:893-952` — `interface SessionState` (metadata, prdSnapshot, taskRegistry,
  currentItemId). **No `prdChangeState` field** — this PRP ADDS it (or uses a
  marker file; see PRP). `SessionState` is `readonly`.
- `:1004-1056` — `DeltaSession extends SessionState`.
- `:175-183` — `Status` per-item union.

### `src/cli/index.ts` (Commander.js, NOT yargs)
- `:255-382` — global `.option(...)`/`.addOption(...)` chain.
- `:49-152` — `CLIArgs` interface. `:155-209` — `ValidatedCLIArgs`
  (`Omit<CLIArgs,...>` + redeclared fields).
- `:271-276` — `--mode` with `.choices(['normal','delta','bug-hunt','validate'])`.
  Note: `delta` is already a parseable choice but has NO behavioral effect (delta is
  driven solely by `hasSessionChanged()`).
- `:278-371` — boolean flags declared `.option('--flag', 'desc', false)`.
- `:998-1005` — `return { ...options, noRetry, ... } as ValidatedCLIArgs`.
- `:1006-1018` — `isCLIArgs()` type guard.

### `src/index.ts`
- `:110` — `async function main()`.
- `:156-180` — `--validate-prd` early-exit (credential-free; BEFORE auth preflight).
- `:233-261` — `new PRPPipeline(args.prd, scope, args.mode, ...22 positional...)`
  then `pipeline.run()`.

## Testing conventions (verified)
- **vitest.config.ts**: 100% statements/branches/functions/lines threshold
  (`:42-48`); `pool: 'forks'`; `include: ['tests/**/*.{test,spec}.ts']`.
  NOTE: `npm run validate` does NOT run coverage — only `npm run test:coverage` does.
- **tests/unit/cli/index.test.ts**: mutates `process.argv` via `setArgv([...])`;
  mocks `node:fs`, `node:fs/promises`, `logger.js`; `process.exit` mocked to throw;
  SETUP/EXECUTE/VERIFY comment banners.
- **tests/unit/workflows/prp-pipeline.test.ts**: factory-impl mocks for
  `SessionManager`, `DeltaAnalysisWorkflow`, `BugHuntWorkflow`, `FixCycleWorkflow`,
  `task-patcher.patchBacklog`, `task-utils.filterByStatus`, `session-utils.resolvePRD`.
  `handleDelta` is either spied (`vi.spyOn(pipeline,'handleDelta')`) or run-for-real
  with all collaborators mocked. `createMockSessionManager(session,
  hasSessionChanged)` helper rebinds the constructor. Assert
  `createDeltaSession` IS called (happy path); new tests must assert it is NOT
  called for accept/integrate paths.

## Docs structure (verified)
- **docs/CLI_REFERENCE.md**: headings — Quick Reference, Commands (Pipeline/Scoped/
  Special/Task Mgmt), Options (Required/Execution Control/Boolean Flags/Limit),
  Exit Codes, Examples (incl. tiny "Delta Iteration"), Error Handling. NO delta
  section. `--mode` table omits `delta` (drift). `--accept-prd-changes` absent.
- **docs/CONFIGURATION.md**: headings — Quick Reference, Env Vars (API/Model/Harness/
  Pipeline Control/Resilience/Distributed PRDs/Bug Hunt/Advanced), CLI Options,
  Model Selection, Priority, Security, Example, Gotchas. NO delta section. `--mode`
  drift same as above.
- **`npm run validate`** = `lint && format:check && typecheck && test:run`
  (sequential; prettier checks `.md`; no coverage).

## PRD §4.3 contract (verbatim, the source of truth)

Three response paths (PRD §4.3 step 2):
1. **Delta session (default, steps 3–7)** — spawn linked session scoped to diffs.
2. **Integrate into current session** — fold new requirements into running session's
   task hierarchy. *"The original `prd_snapshot.md` MUST be preserved until AFTER
   integration succeeds — the integration agent diffs the original snapshot against
   the current PRD... Refreshing the snapshot at integration time erases the very
   diff the agent needs (and silently swallows unapplied changes); the snapshot is
   refreshed only once integration has applied."*
3. **`--accept-prd-changes`** — accept PRD edits as new baseline *without* delta
   session. *"Across all `PRD_CHANGED_*` session states it cancels any queued
   `.pending_delta_hash`, refreshes `prd_snapshot.md` to the current PRD, and
   exits/resumes idempotently."*

## Implementation strategy chosen (see PRP for full detail)

- **CLI flag** (Task 1): add `--accept-prd-changes` boolean (default false) to
  `src/cli/index.ts`; thread onto `CLIArgs`/`ValidatedCLIArgs`. **Avoid the
  22-positional-param explosion** — add it as a NEW optional positional on
  `PRPPipeline` constructor (lowest disruption, matches existing pattern) rather
  than a new options-bag refactor (out of scope).
- **State primitive** (Task 2): introduce `PRD_CHANGED_PENDING` state via a
  **marker file** `prd_changed.marker` (contains the new pending hash) in the
  session dir, NOT a new `SessionState` field (avoids touching the readonly
  `SessionState` interface + its Zod schema + `loadSession` reconstruction —
  minimizes blast radius). `pending_delta_hash` = the marker file content. This is
  the lightest-touch design that satisfies the CONTRACT and is reusable by S2.
- **Response selection** (Task 3): refactor `handleDelta()` into a
  `selectDeltaResponse()` dispatcher that branches on the flag → {accept |
  integrate | delta-session-default}. Each path is a private method.
- **Snapshot contract** (Task 4): integrate path defers `snapshotPRD` refresh
  until AFTER integration applies; accept path refreshes immediately + clears the
  marker.
- **Tests** (Task 5): vitest unit tests for all 3 branches + the marker helper +
  the CLI flag parsing.
- **Docs** (Task 6): Mode-B updates to CLI_REFERENCE.md + CONFIGURATION.md.

## Residual risks
1. `patchBacklog` 'added' case is a no-op — PRD *additions* detected by
   `DeltaAnalysisWorkflow` are silently dropped. This PRP does NOT fix it (out of
   scope; separate concern). The integrate/delta paths will correctly handle
   modified/removed but added requirements won't generate new tasks. Document loudly.
2. PRD-change detection is dead in the normal `initialize()` flow (hash-match).
   This PRP wires detection on `--continue` resume (when a prior session's snapshot
   hash ≠ current PRD hash) — the minimal path to make response-selection reachable.
   A fuller "always detect" design is a larger refactor (out of scope).
3. `delta_from.txt` is a phantom name; this PRP uses `prd_changed.marker` (new file)
   and does NOT rename `parent_session.txt`. Add the new marker to
   `git-commit.ts` PROTECTED_FILES so it isn't stripped from per-task commits.
4. `createDeltaSession` does not write `prd_snapshot.md` for the delta dir — a
   pre-existing bug. Out of scope here but flag it (a future `loadSession()` of a
   delta dir will fail on the unconditional `readFile('prd_snapshot.md')` at :575).