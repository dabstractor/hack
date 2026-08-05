# P1.M4.T4.S1 — Straggler triage + fixes (Task 1→4)

Baseline: 5 failed files, 36 failures, vitest exit 1.
Final (per-file green): all 5 files green. See Task 5 for the whole-suite re-run.

## Per-file root cause + category + fix

### 1. tests/unit/core/task-orchestrator.test.ts — 16 fails → 0  [category (c) + (b)]
ROOT CAUSE (category c): the `vi.mock('../../../src/utils/git-commit.js', ...)` factory
did NOT use `importOriginal`, so it stubbed the WHOLE module. `executeSubtask` imports
BOTH `smartCommit` AND `parseItemPosition` from that module; the stub left `parseItemPosition`
undefined. The survival-commit's `{ position: parseItemPosition(subtask.id) }` threw
`TypeError: parseItemPosition is not a function`, swallowed by executeSubtask's commit
try/catch → smartCommit never reached → "called 0 times". Born red (failed even at the
commit that introduced the two-phase-commit tests).
FIX (test-only): `async importOriginal => ({ ...actual, smartCommit, filterProtectedFiles,
formatCommitMessage })` to preserve `parseItemPosition` (mirrors the sibling mocks in this
same file: agent-factory, research-queue, git-mcp all use importOriginal).
RESIDUAL (category b): 5 assertions expected the pre-BUG-003 2-arg smartCommit shape
`{ generateMessage: true }`; BUG-003 added a `position` field to the survival/skip-recovery
commits. Re-pointed each to `{ generateMessage: true, position: {phase:1,milestone:1,task:1,subtask:1} }`
(the cleanup commit has no position — left as-is). NOT weakened: still asserts the exact options object.

### 2. tests/unit/core/delta-prd.test.ts — 1 fail → 0  [category (b)]
ROOT CAUSE: BUG-002 Part B (commit 241dffe "secure delta prd ingestion") wired
`classifyArtifactWithRetry(prdContent)` into decomposePRD's delta branch. The test mocks
the architect/agent-factory but NOT the classifier → the REAL classifier runs under a mocked
agent graph (no LLM) → exhausts retries → fails to protective default 'DIRTY' → aborts the
breakdown BEFORE the architect → createArchitectPrompt never called.
FIX: added `vi.mock('../../../src/core/change-classifier.js', () => ({ classifyChangeWithRetry,
classifyArtifactWithRetry }))` (bare vi.fn() returns undefined !== 'DIRTY' → proceeds). Mirrors
the sibling `tests/unit/workflows/prp-pipeline.test.ts:64`.

### 3. tests/integration/core/delta-breakdown-integration.test.ts — 4 fails → 0  [category (b)]
ROOT CAUSE: same as #2 — the classifier-guard in decomposePRD aborts the delta breakdown before
the architect runs (so "architect invoked 0 times" + no new tasks produced).
FIX: identical `change-classifier.js` mock (returns CLEAN-ish).

### 4. tests/unit/agent-context-injection.test.ts — 2 fails → 0  [category (b)]
ROOT CAUSE: the PRP blueprint prompt grew via selective-PRD-extraction (2ae30c6) + issue-feedback
injection (6dc0b6d); a generated prompt now lands at ~10.5k tokens vs the test-local
`MAX_CONTEXT_TOKENS = 10000` heuristic. NOT a hard model limit (GLM-5.x = 128k context); 10000
is an arbitrary test threshold that went stale.
FIX: raised the test-local heuristic to 15000 (≈40% headroom over the real prompt). NOT weakened:
the assertion still meaningfully guards prompt size (catches runaway/linear growth); the token-
estimation tests (`MAX_CONTEXT_TOKENS * 3/5/4`) still hold under the new constant.

### 5. tests/integration/prp-pipeline-shutdown.test.ts — 13 fails → 0  [category (b) + (c)]
MULTIPLE root causes (all test-side; production shutdown code is in-spec per architecture doc):
  (b1) WIRING ROT: PRPPipeline defers SessionManager/TaskOrchestrator construction into
       run()/initializeSession(). The test injected mocks at the INSTANCE level AFTER the
       constructor (`(pipeline as any).taskOrchestrator/sessionManager = mockX`) — run()
       OVERWRITES them. Fixed: 19 taskOrchestrator + 9 sessionManager injections converted to
       CLASS-LEVEL `Mock*Class.mockImplementation(() => mockX)` (mirrors pipeline-main-loop.test.ts).
  (b2) MOCK INCOMPLETENESS: initializeSession() calls hasSessionChanged/hasAnySessions;
       run()/cleanup() call flushUpdates/updateItemStatus/loadBacklog; run() calls
       taskOrchestrator.rebuildQueue(). The mocks were missing these → "X is not a function".
       Fixed: enriched setupMockSessionManager + beforeEach defaults + all 9 inline
       mockSessionManager blocks with the full method set; added rebuildQueue to all 22
       orchestrator mocks.
  (b3) ENV: run() calls validateNestedExecution() which throws if PRP_PIPELINE_RUNNING is set
       (leaked from the ambient env when the suite runs inside a pipeline). Fixed:
       `delete process.env.PRP_PIPELINE_RUNNING` in beforeEach (mirrors pipeline-main-loop.test.ts).
  (b4) EMPTY BACKLOG: 7 tests used `{ backlog: [] }` but emitted SIGINT/SIGTERM from INSIDE the
       mock's processNextItem; executeBacklog early-returns when #countTasks()===0, so
       processNextItem never ran and the signal never fired. Fixed: a createSingleSubtaskBacklog()
       helper gives those tests 1 subtask so processNextItem runs and emits the signal.
  (c1) RESULT-CONTRACT ROT: a shutdown-requested run reports success=false,
       shutdownInterrupted=true, shutdownReason=<reason> (run()'s catch path surfaces
       shutdownRequested via result.shutdownInterrupted). The tests expected the OLD "shutdown=
       success" shape (success=true, inter=false). Re-aligned 6 assertions to the real contract.
       NOT weakened: still asserts exact values.
  (c2) PHASE ROT: cleanup() (run()'s finally) always sets the terminal currentPhase to
       'shutdown_complete'; the interrupt is on result.shutdownInterrupted, not currentPhase.
       Re-pointed `toBe('shutdown_interrupted')` → `toBe('shutdown_complete')`.
  (c3) PRIVATE-FIELD ACCESS BUG: "multiple signals" test accessed the #sigintHandler PRIVATE
       field via bracket notation (`(pipeline as any)['#sigintHandler']`) — always undefined for
       true #private fields. Fixed: emit real `process.emit('SIGINT')` twice (exercises the real
       duplicate-detection path).
  (c4) SIGNAL-TIMING BUG: "not interrupt in-flight" test scheduled the SIGINT emit AFTER the
       task's 100ms wait (so it never fired during execution). Fixed: emit 50ms INTO the 100ms task.

## STOP case: NONE triggered.
Every straggler was test-rot (a/b/c). No assertion was weakened to force green (all re-alignments
assert the real current contract with exact values). No src/ defect flagged. git diff --stat -- src/
is empty.