# P1.M4.T2.S2 Research — Apply harness-init / research-seam fix to the ~9 suites

Ground-truth source = actually RUNNING each of the 9 files (`npx vitest run <file>`) +
targeted `src/` reads + a `scout` deep-dive on the 3 "diagnose" files. All failure
strings below are from real runs (not the architecture doc's estimates).

**INPUT dependency:** `tests/helpers/research-seam.ts` from **P1.M4.T2.S1** (the contract PRP
defines its exact exports: `createMockPRPDocument`, `MOCK_PRP_DOCUMENT`,
`MINIMAL_PRP_JSON_STRING`, `createSuccessAgentResponse`, `prpJsonPath`,
`wireMockResearcherAgent`, `wireMockPRPGenerator`, `wireMockResearchQueue`, `initRealHarness`).

---

## 1. SCOPE CORRECTION (the single most important finding)

The architecture doc + item contract list all 9 files under BUG-004 "Category (a)".
**Running them proves only 6 are category-(a)/file-contract; the other 3 fail for
completely different (category b/c) reasons.** Verifying the plan shows P1.M4.T3
owns {coder-agent, pipeline-main-loop, qa-agent, researcher-agent, prd-task-command,
prp-blueprint-agent, task-breakdown-prompt} — **it does NOT own bug-hunt / fix-cycle /
prp-executor**, so those 3 ARE this item's responsibility (just fixed differently).

| # | File | Real error (from run) | True category | Owned here? |
|---|------|-----------------------|---------------|-------------|
| 1 | smart-commit | "PiHarness not initialized" | a | ✅ seam fix |
| 2 | core/task-orchestrator-e2e | "PiHarness not initialized" | a | ✅ seam fix |
| 3 | core/task-orchestrator-runtime | "PiHarness not initialized" | a | ✅ seam fix |
| 4 | prp-generator-integration | "Researcher did not write PRP file" | a (file-contract) | ✅ leaf+readFile |
| 5 | prp-runtime-integration | "Researcher did not write PRP file" | a (file-contract) | ✅ leaf+readFile |
| 6 | core/task-orchestrator | "PiHarness not initialized" + context_scope schema + queue-count | a MIXED | ✅ seam + fixtures + line-audit |
| 7 | bug-hunt-workflow-integration | "QA agent failed: Unknown error" | **b** (stale mock shape) | ✅ (not harness) |
| 8 | fix-cycle-workflow-integration | "FixCycleWorkflow requires valid sessionPath" | **c** (ctor sig rot) | ✅ (not harness) |
| 9 | prp-executor-integration | "No 'withAgentDeadline' export" + assert rot | **b** (stale mock factory) | ✅ (not harness) |

⇒ The harness/seam fix is correct for #1–6. For #7–9 the harness fix is NOT the root
cause and would be wasted; the verified minimal test-only fixes are in §4 below.

---

## 2. GROUP A — the 6 harness/file-contract files (seam fix)

### 2.1 The chain (identical for #1,2,3,6)
`TaskOrchestrator.processNextItem` (`src/core/task-orchestrator.ts:1394`)
→ `executeSubtask` (`:913`) → `researchQueue.researchNow`
(`src/core/research-queue.ts:350`) → `PRPGenerator.generate`
(`src/agents/prp-generator.ts:688`) → real `createResearcherAgent().prompt()`
(`src/agents/agent-factory.ts:386`) → Groundswell →
`{status:'error', error:'PiHarness not initialized'}` → `AgentError` thrown.

### 2.2 Per-suite seam choice (depth matrix from S1 findings §6)
For non-research-subject suites (#1,2,3,6) the **PRPGenerator CLASS mock**
(`wireMockPRPGenerator`) is the cleanest primary seam:
- one method to stub (`generate → MOCK_PRP_DOCUMENT`);
- keeps ResearchQueue real (so researchNow/waitForPRP/getStats behave realistically);
- **no `.json` file contract** (the trap that bit the 2 file-contract suites);
- low surface risk vs. the ResearchQueue class mock (which must stub every method/field
  TaskOrchestrator touches).

**Alternative** (deeper isolation): `wireMockResearchQueue` (ResearchQueue class mock) —
acceptable if a suite wants zero ResearchQueue behavior; the S1 helper stubs the full
surface (enqueue/processNext/getStats/getPRP/waitForPRP/researchNow/deletePRP + readonly
queue/researching/results/abandoned/maxSize/sessionManager/depth).

`vi.mock` is hoisted → each file keeps its OWN top-level self-contained
`vi.mock('../../src/agents/prp-generator.js', () => ({ PRPGenerator: vi.fn() }))`; the
helper is only used for the fixture + `wireMockPRPGenerator` in `beforeEach`.

### 2.3 The 2 file-contract suites (#4, #5) — the fs-mock gotcha
Both mock `node:fs/promises` with a **prps short-circuit** that NO-OPs `writeFile`/`mkdir`
for paths containing `'prps'` (prp-generator-integration:29-49; prp-runtime-integration
~28 same shape). They do NOT override `readFile` (so it stays the real `...actualFs.readFile`).
⇒ Their existing leaf `createResearcherAgent` mock returns a **bare `PRPDocument`** (never
writes the `.json`) → `generate()`'s real `readFile(prpOutputPath)` → ENOENT →
`"Researcher did not write PRP file"`.

**⚠️ `wireMockResearcherAgent`'s real-file write is INTERCEPTED by this fs mock** (the mock
replaces `node:fs/promises` module-wide, so the helper's `writeFile` is no-op'd for prps).
So do NOT rely on the helper's file write here. Instead, the surgical fix is:
- keep the leaf `createResearcherAgent` mock + keep `generate()` REAL (these suites' SUBJECT
  IS the research path);
- **extend the existing fs mock to also stub `readFile`** for prps paths to return
  `MINIMAL_PRP_JSON_STRING` (imported from the helper); AND
- make the leaf mock return a **success `AgentResponse`** via `createSuccessAgentResponse`
  (NOT a bare `PRPDocument` — `generate()` reads `result.status`).

```ts
// inside the existing vi.mock('node:fs/promises', ...) factory, ADD:
readFile: vi.fn(async (path: string, ...rest: unknown[]) => {
  if (typeof path === 'string' && path.includes('prps')) {
    return MINIMAL_PRP_JSON_STRING;            // helper export
  }
  return actualFs.readFile(path, ...(rest as [unknown]));
}),
// in beforeEach, replace the bare-doc mock with:
(createResearcherAgent as any).mockReturnValue({
  prompt: vi.fn().mockResolvedValue(createSuccessAgentResponse(createMockPRPDocument('P3.M3.T1.S1'))),
});
```
(Alternative: remove the prps short-circuit from writeFile/mkdir so writes persist + use
`wireMockResearcherAgent` for a real file. Higher blast radius — only if readFile stubbing
is undesirable.)

---

## 3. FILE #6 — task-orchestrator.test.ts is MIXED (3 distinct failure modes)

Running it verbose shows THREE independent causes (the contract's "mixed" = exactly these):

**(a) PiHarness** — DFS traversal / processNextItem tests (test sites: lines 273, 349, 387,
810) → the research chain in §2.1. **Fix:** PRPGenerator class mock (`wireMockPRPGenerator`).
This file currently has **ZERO `vi.mock`** — add the top-level `vi.mock('...prp-generator.js')`
+ `wireMockPRPGenerator` in the top-level `beforeEach` (line 228).

**(c) context_scope schema** — backlog fixtures use short values like `'Test scope'` /
`'Test'` (lines 76, 86, 96, 124, 161, 313, 430, 439, 547, 556, 774). The schema
(`src/core/models.ts:116`) requires `context_scope` to **start with "CONTRACT DEFINITION:"
+ newline** (a `.superRefine` custom check; error string `"context_scope must start with
"CONTRACT DEFINITION:" followed by a newline"`). SessionManager rejects the fixture when
persisting tasks.json → `"Failed to write tasks.json ..."`. **Fix:** replace the short
values with a valid minimal contract string, e.g.
`'CONTRACT DEFINITION:\n1. INPUT: none\n2. LOGIC: none\n3. OUTPUT: none'`.
(See `smart-commit.test.ts:79-84` `createMockSubtask` for the proven shape.)

**(b) queue-count** — 3 tests (lines ~673, 705, 740) assert `queue.length` and get MORE
items than expected (`expected 5 to be 4`, `expected 5 to be 3`, `expected 3 to be 1`).
This is stale expectation vs. the current `buildExecutionQueue`/scope logic — **NOT** caused
by context_scope (separate tests). **Fix:** LINE-AUDIT `src/core/task-orchestrator.ts`
`buildExecutionQueue` + `setScope` to see what is now enqueued (e.g. subtasks included /
scope filtering changed) and update the 3 expectations to match current (correct) behavior.
Do NOT change production code to match the stale counts.

These three are INDEPENDENT — fix in the order (c)→(a)→(b) so failure counts stabilize.

---

## 4. GROUP B — the 3 NON-harness files (category b/c, verified root causes)

### 4.1 bug-hunt-workflow-integration.test.ts — stale mock RETURN SHAPE
- Mocks `createQAAgent` (line 17) + `createBugHuntPrompt` (line 22). Real Groundswell QA
  agent is NEVER constructed → **not harness**.
- `src/workflows/bug-hunt-workflow.ts:310` legacy branch (run with no `outputPath`) does
  `if (agentResponse.status !== 'success' || agentResponse.data === null) throw ... 'QA
  agent failed: Unknown error'` (caught+rewrapped at `:353` → ground-truth string).
- The test mock resolves `prompt()` to a **raw `TestResults`** object (no `.status`) at
  ~10 sites (87-88, 119-120, 145-146, 197-198, 219-220, 246-247, 294-295, 357-358, 386-387,
  419-420, 447-448) + the beforeEach default (~line 68).
- **Fix:** wrap every success-path mock return in `createSuccessAgentResponse(data)`
  (helper export): `{ status:'success', data: expectedResults, error:null }`. The helper's
  `createSuccessAgentResponse` is exactly this envelope. (Error-path tests already reject —
  leave them.)

### 4.2 fix-cycle-workflow-integration.test.ts — constructor-signature rot (HIGHER EFFORT)
- `src/workflows/fix-cycle-workflow.ts:130-131` ctor guard: first param is now
  `sessionPath: string`; throws `'FixCycleWorkflow requires valid sessionPath'` if not a
  non-empty string.
- Test passes `initialResults` (a `TestResults` OBJECT) as the first arg at 10 sites
  (167, 222, 289, 353, 414, 459, 512, 562, 604, 639) → `typeof !== 'string'` → throws.
  The ctor was refactored: bug report moved from a ctor arg to **on-disk
  `TEST_RESULTS.md`** read in `#loadBugReport()` at run time.
- **Fix (incremental — known 2nd-order rot):**
  1. Pass a valid `sessionPath` string as first arg, e.g.
     `'plan/001_test/bugfix/001_test'` (must contain `bugfix` for `validateBugfixSession`).
  2. Create a real bugfix session dir on disk with `TEST_RESULTS.md` (the bug report) +
     `tasks.json`, OR refactor the test to inject the report — `#loadBugReport()` reads it
     from `sessionPath` (`fix-cycle-workflow.ts:~575`).
  3. If `runStandardBreakdown` (`fix-cycle-workflow.ts:~233-240`) invokes the **real
     architect** (`createArchitectAgent`) → THAT is a latent harness seam; mock
     `createArchitectAgent` via the agent-factory leaf pattern (top-level
     `vi.mock('...agent-factory.js', ...)` + wire an architect mock) if reached.
- This file is the most rotted; fix step-by-step, re-running after each. If it requires
  production changes to pass, STOP — that's out of scope (rule 5 is test-only corrective).

### 4.3 prp-executor-integration.test.ts — stale mock factory missing an export
- `withAgentDeadline` STILL EXISTS at `src/utils/retry.ts:713` (NOT removed); imported by
  `src/agents/prp-executor.ts:30`.
- The test's `vi.mock('.../retry.js')` factory (lines 32-47) **omits `withAgentDeadline`**,
  so the binding is undefined → vitest emits `"No 'withAgentDeadline' export found"`.
  `prp-executor.ts:333` calls `withAgentDeadline(this.#coderAgent.prompt(...))` inside the
  mocked `retryAgentPrompt` wrapper → the inner `fn()` throws → captured into
  `ExecutionResult.error` → success-path asserts fail (`expected false to be true`, etc.).
- Real Coder agent is mocked (`createCoderAgent`, lines 17-22) → **not harness**.
- **Fix:** add `withAgentDeadline: vi.fn(async (p: Promise<unknown>) => p)` (identity
  pass-through; the real fn is `Promise.race` vs a deadline) to the retry.js mock factory.
  No source change.

---

## 5. Per-file `vi.mock`/beforeEach insertion points (verified line numbers)

| File | Existing top-level mocks | beforeAll/beforeEach | Seam to ADD |
|------|--------------------------|----------------------|-------------|
| smart-commit | git-commit(38), git-mcp(53), prp-runtime(62), logger(90) | beforeEach(225) | `vi.mock('...prp-generator.js')` + `wireMockPRPGenerator` in 225 |
| core/task-orchestrator-e2e | prp-runtime(53), git-commit(72) | beforeEach(261) | `vi.mock('...prp-generator.js')` + `wireMockPRPGenerator` in 261 |
| core/task-orchestrator-runtime | prp-runtime(51), git-commit(70) | beforeEach(205) | `vi.mock('...prp-generator.js')` + `wireMockPRPGenerator` in 205 (keeps ResearchQueue real — borderline subject) |
| prp-generator-integration | node:fs/promises(29), agent-factory(123) | beforeEach(133) | extend fs mock `readFile`(29) + `createSuccessAgentResponse` at 148-150 |
| prp-runtime-integration | node:fs/promises(28), agent-factory(153), prp-executor(164) | beforeEach(177) | extend fs mock `readFile`(28) + `createSuccessAgentResponse` on researcher mock |
| core/task-orchestrator | (NONE) | beforeEach(228) | ADD `vi.mock('...prp-generator.js')` + `wireMockPRPGenerator` in 228; ALSO fix context_scope fixtures + queue-count line-audit |
| bug-hunt-workflow-integration | agent-factory(17), bug-hunt-prompt(22) | beforeEach(76) | wrap QA mock returns in `createSuccessAgentResponse` (NOT a seam mock) |
| fix-cycle-workflow-integration | bug-hunt-workflow(19) | beforeEach(119) | ctor sig + disk fixtures + maybe architect leaf mock |
| prp-executor-integration | agent-factory(17), prompts(26), retry(32), checkpoint-manager(54) | beforeEach(114) | add `withAgentDeadline` to retry.js mock factory (32) |

---

## 6. Validation strategy

- Per-file: `npx vitest run <file>` → green.
- After each cluster (Group A, then the mixed file, then Group B): whole-suite delta:
  `npx vitest run --reporter=dot` → failure count MUST decrease, never increase.
- Static gates after edits: `npm run typecheck && npm run lint && npm run format:check`.
- **Scope guard:** `git diff --stat -- src/` must be EMPTY (rule 5 test-only; no production
  changes to make tests pass). The only acceptable `src/`-adjacent read is READ-ONLY.
- **Coordination:** `smart-commit.test.ts` is touched by BOTH this item (seam fix) and
  BUG-003/P1.M3.T2.S1 (task-prefix assertions). The contract mandates SERIALIZE edits to
  that file — apply the seam fix and re-run; do not clobber the [PRP Auto] removal work.

---

## 7. Confidence

High. Every failure string is from a real run; every `src/:line` ref is verified; the
3-file non-harness verdict comes from a scout deep-dive with exact source citations. The
residual risk is fix-cycle (substantially rotted ctor + disk-read + possible architect
seam) — flagged higher-effort with a fallback (document + flag) if it needs production
changes.