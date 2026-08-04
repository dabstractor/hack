# BUG-004 — Drive the test suite green (PRD §4.4 validate gate)

**Severity:** Major · **Status:** confirmed red: `179 failed | 874 passed | 14 skipped` across
**20 failing files** (51 total) in `tests/integration` (run-to-run ±1). `npm test`/`validate`
(`package.json`: `test:run` = `vitest run`) exits 1, so any §4.4 `validate.sh` that runs
`npm test` aborts before cleanup/commit/bug-hunt.

**None of these are production-runtime defects** — the pipeline code is in-spec. The suite is
red from (a) environmental test-setup gaps, (b) test-rot, (c) genuine test-only bugs.

## Vitest config (`vitest.config.ts`)
- `include: ['tests/**/*.{test,spec}.ts']`; pool `forks` (1–4), 4096 MB; setup `./tests/setup.ts`.
- Alias `groundswell` → sibling repo `/home/dustin/projects/groundswell/dist/index.js` (NOT
  `node_modules/groundswell`, which is a real packed dir and resolves fine). **Groundswell link
  is NOT the problem.** The "PiHarness not initialized" errors are a missing
  `ensureHarnessInitialized()` (`src/config/harness.ts:190`) in test setup.

## Category (a) — Environmental: "PiHarness not initialized" (~9 files, ~81 failures)
Real `TaskOrchestrator`/`PRPGenerator` runs the **real Researcher agent** because the PRP-research
seam is unmocked. `executeSubtask` → `researchQueue.researchNow` → `PRPGenerator.generate`
(`src/agents/prp-generator.ts:688`) → real `.prompt()` → Groundswell returns
`{status:'error', error:'PiHarness not initialized'}` → throws BEFORE `smartCommit`.
Affected: `smart-commit.test.ts`(7), `core/task-orchestrator-e2e.test.ts`(11),
`core/task-orchestrator-runtime.test.ts`(8), `prp-generator-integration.test.ts`(8),
`prp-runtime-integration.test.ts`(7), `bug-hunt-workflow-integration.test.ts`(11),
`fix-cycle-workflow-integration.test.ts`(10), `prp-executor-integration.test.ts`(10),
`core/task-orchestrator.test.ts`(9, mixed).

**Fix:** add a shared `beforeAll(() => ensureHarnessInitialized())` helper to each affected
suite, OR (better isolation for unit-style suites) mock the research seam
(`research-queue.js` / `prp-generator.js` / `createResearcherAgent`) the same way
`prp-runtime.js` is mocked today. Prefer the mock for suites whose subject is NOT the research
path; prefer real harness for suites that explicitly test research integration.

## Category (b) — Test-rot: code evolved, expectations stale (~7 files, ~58 failures)
- `coder-agent.test.ts`(24): (i) a module-level `vi.mock('../../src/agents/agent-factory.js')`
  declared between suites is **hoisted** over the earlier real-factory config suite →
  `createCoderAgent()` returns `undefined` → `gs.createAgent` never called. Fix: scope the mock
  (`vi.hoisted`/`vi.doMock`) or split files. (ii) model rot: expects `model:'GLM-4.7'`; actual
  is `zai/glm-5-turbo` (P2.M2 roles refactor: `createCoderAgent`→`createBaseConfig('coder','implementation')`→
  `getModel('fast')`→`MODEL_NAMES.fast='glm-5-turbo'`→qualified `zai/glm-5-turbo`,
  `src/config/constants.ts:44-48`). `maxTokens:4096` is still correct.
- `pipeline-main-loop.test.ts`(21): `PRPPipeline` constructor was refactored to DEFER
  SessionManager/TaskOrchestrator creation into `run()`/`initializeSession()`
  (`prp-pipeline.ts:565-566,710,770`). Tests do only `new PRPPipeline(prdPath)` then assert
  `initialize` called / `currentPhase==='session_initialized'` → 0 calls. Injecting
  `(pipeline as any).taskOrchestrator` before `run()` gets overwritten. Fix: call
  `await pipeline.run()` (or `initializeSession()`) before asserting; inject orchestrator AFTER
  init or mock at class level.
- `qa-agent.test.ts`(4), `researcher-agent.test.ts`(2), `prd-task-command.test.ts`(5),
  `prp-blueprint-agent.test.ts`(1), `task-breakdown-prompt.test.ts`(1): likely model/prompt-text
  rot — **line-audit each before editing.**

## Category (c) — Genuine test bugs (~4 files, ~39 failures)
- `prp-pipeline-shutdown.test.ts`(20/20): `beforeEach` lines 110-117 spread a bare function:
  ```
  originalProcessListeners = { SIGINT: (process as any)._events?.SIGINT ? [...(process as any)._events.SIGINT] : [] }
  ```
  When a signal has ONE listener, Node stores it as a bare function (truthy) → `[...fn]` throws
  `process._events.SIGINT is not iterable`. Fix: guard with `Array.isArray(...)`. Secondary:
  `afterEach` calls `process.removeAllListeners('SIGINT'/'SIGTERM')` which WIPES vitest's own
  handlers → restore by name only (capture+re-add the specific listeners, not all).
- `progressive-validation.test.ts`(9), `prp-pipeline-integration.test.ts`(6),
  `prp-create-prompt.test.ts`(4): **counted, not line-audited** — diagnose (exit-code/assertion
  logic, prompt drift) before fixing.

**Order:** fix (c) first (deterministic) so failure counts stabilize, then (a), then (b). Run
`npx vitest run --reporter=dot` after each cluster.

## NOTE on interaction with BUG-001/002/003
BUG-001/002/003 add/change tests in `backlog-merger.test.ts`, `delta-breakdown-integration`,
`git-commit.test.ts`, `smart-commit.test.ts`, `change-classifier` tests, `prp-pipeline`
detection tests. The category-(a) fix for `smart-commit.test.ts` (ensureHarnessInitialized)
OVERLAPS with BUG-003's test updates there — coordinate: apply the harness-init/mock fix AND the
task-prefix assertions together. Run BUG-004's final "full green" verification AFTER
BUG-001/002/003 land so the baseline includes their tests.

## Files (representative — full list in the per-file table above)
- `tests/integration/prp-pipeline-shutdown.test.ts` (c)
- `tests/integration/coder-agent.test.ts`, `pipeline-main-loop.test.ts` (b)
- `tests/integration/smart-commit.test.ts`, `tests/integration/core/task-orchestrator-e2e.test.ts` (a)
- + remaining a/b/c files listed above.
- Shared helper: a `tests/helpers/` (or `tests/setup.ts`) `ensureHarnessInitialized()` helper, if chosen.