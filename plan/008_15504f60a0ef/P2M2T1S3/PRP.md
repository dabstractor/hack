# PRP — P2.M2.T1.S3: Wire xhigh reasoning budget into decomposition demand-write retry

---

## Goal

**Feature Goal**: **Verify and lock in** that the PRD §6.1 "demand-write retry"
(when breakdown output is missing/invalid and the Architect is re-invoked) runs
at the **same `xhigh` reasoning budget** as the initial decomposition call — and
**cannot silently regress** to a lower budget. Runtime behavior is **already
correct** once S2 lands (`createArchitectAgent()` → `createBaseConfig('architect',
'reasoning')` → `thinking: 'xhigh'`), because `decomposePRD()` creates the agent
**once** and the retry loop re-invokes the **same instance**. S3's deliverable is
therefore **defense-in-depth**: a regression-locking test that proves the retry
reuses a single xhigh-configured Architect instance, plus a clarifying code
comment at the retry site that forbids moving agent creation inside the retry
closure.

**Deliverable**:
1. **`tests/unit/workflows/prp-pipeline.test.ts`** — ADD one `it(...)` test inside
   the existing `describe('decomposePRD', ...)` block. The test forces the
   Architect's `prompt()` to reject twice (transient `AgentError`) then resolve on
   the third attempt — exercising `retryAgentPrompt`'s actual retry loop — and
   asserts: (a) `createArchitectAgent` was called **exactly once** (the agent is
   NOT re-created on retry), and (b) the **same** mock agent's `prompt` was called
   **3 times** (initial + 2 retries). This encodes the §6.1 invariant: the retry
   path inherits the same xhigh-configured agent. Optionally add a second test
   that asserts the success-path `currentPhase === 'prd_decomposed'` survives a
   retry storm.
2. **`src/workflows/prp-pipeline.ts`** — ADD a short `// INVARIANT (PRD §6.1)`
   comment immediately above `const architectAgent = createArchitectAgent();`
   (in `decomposePRD()`, ~line 774) documenting that the agent is created once
   with the Reasoning role (xhigh) and that the retry re-invokes this same
   instance — and explicitly forbidding moving the factory call inside the retry
   closure.

**Success Definition**:
- `rg -n "INVARIANT \(PRD §6.1\)" src/workflows/prp-pipeline.ts` → exactly one
  match, directly above the `createArchitectAgent()` call in `decomposePRD()`.
- The new test `uses the same single Architect agent instance ...` exists and
  PASSES; it asserts `mockCreateArchitectAgent` was called **once** and the mock
  `prompt` was called **3 times** after 2 transient rejections.
- `npm run validate` GREEN (lint + format:check + typecheck + `vitest run`) with
  **100% coverage on `src/**/*.ts`** preserved.
- `decomposePRD()` body is otherwise **byte-identical** (the only src/ change is
  the added comment — no logic, no signature, no config mutation).

---

## User Persona (if applicable)

**Target User**: Pipeline maintainer / orchestrator contributor.
**Use Case**: Ensuring the most reasoning-intensive pipeline step
(decomposition) — and its failure-retry — both run at the maximum reasoning
budget, and that a future refactor cannot accidentally downgrade the retry to a
cheaper/faster agent.
**User Journey**: A maintainer reads the `// INVARIANT` comment, sees *why* the
agent is created before the retry loop, and understands the §6.1 budget rule
without hunting through PRD + S1/S2 PRPs. A failing CI test stops any PR that
re-creates the agent on retry.
**Pain Points Addressed**: Today the retry path has **no test** locking its
agent-reuse invariant. A well-meaning "move agent creation into the retry
closure" refactor would silently work (decomposition succeeds) but could rebind
the agent to a default/downgraded config if the factory call is ever changed —
violating §6.1's "same budget" rule with zero test coverage catching it.

---

## Why

- **PRD compliance**: PRD §6.1 (h3.12) states *"The 'demand write' retry (when
  breakdown output is missing/invalid) uses the same budget"* as the initial
  xhigh decomposition. S2 makes the **initial** call xhigh; S3 guarantees the
  **retry** stays xhigh by locking the structural invariant that delivers it.
- **Item contract (item 3 LOGIC)**: *"primarily verifying that the architect
  agent's config already includes thinking='xhigh' ... and that the retry path
  in decomposePRD() does not downgrade the agent config."* Verification without
  a test is ephemeral; S3 makes the verification **executable and permanent**.
- **Closes P2.M2**: This is the final subtask of Milestone P2.M2. After S3, the
  three-role + maximum-reasoning-budget model (S1 data model → S2 persona
  routing → S3 retry invariant) is complete and regression-protected.
- **Cheap insurance**: S3 is ~1 comment + ~1 test for 1 story point. The
  runtime is already correct; S3 converts "correct by happenstance" into
  "correct by contract."

### Out of scope (hard fences)
- **`createArchitectAgent()` / `createBaseConfig` / `ROLE_CONFIG` / `AgentConfig`
  / `ThinkingLevel` / `ModelRole`** → S1/S2 own them. S3 CONSUMES the post-S2
  architect; it does NOT modify the factory or data model.
- **End-to-end harness wiring of `thinking` → pi `thinkingLevel`** → a later,
  separate task (all of P2.M2.T1 ships the budget as a *write-only* config
  marker; harness *enforcement* is explicitly deferred — see S1/S2 "Out of
  scope"). S3 does not make xhigh actually take effect at the harness; it
  guarantees the *request* is uniform across initial + retry.
- **`retry.ts` / `retryAgentPrompt` behavior** → already correct (re-invokes the
  same closure → same instance). S3 does NOT edit retry.ts. The new test uses
  the **real** `retryAgentPrompt` (not mocked) to prove this.
- **`delta-analysis-workflow.ts:131`** (a different `retryAgentPrompt` call for
  the Delta classifier agent) → out of scope. Item 3 scopes S3 to
  "decomposition demand-write retry" only.
- **Docs** → item 5: *"DOCS: none — no user-facing/config/API surface change."*
  Do NOT edit `docs/CONFIGURATION.md` (S1 already added `### Model Roles`) or
  any other doc.
- **Verifying the agent's resolved `thinking` value in the pipeline test** →
  that is S2's unit test's job (`tests/unit/agents/agent-factory.test.ts`). S3
  verifies the **structural reuse invariant** (single instance across retries),
  which is correct regardless of S2's exact value and keeps the two PRPs from
  overlapping assertions.

---

## What

### User-visible behavior
None. No CLI, env, config, API, or runtime behavior change. The only src/
change is a documentation comment. The only test change is an added (not
modified) test case.

### Technical requirements (exact contract — item 3)

**(a) Regression-locking unit test** — ADD to
`tests/unit/workflows/prp-pipeline.test.ts`, inside the existing
`describe('decomposePRD', () => { ... })` block (which starts at line ~298):

```ts
it('reuses the same single Architect agent instance for the initial call and every demand-write retry (PRD §6.1 xhigh-budget invariant)', async () => {
  // SETUP: force retryAgentPrompt to re-invoke the SAME mock instance.
  //   AgentError has code PIPELINE_AGENT_LLM_FAILED → isTransientError = true → retried.
  const promptFn = vi.fn()
    .mockRejectedValueOnce(new AgentError('transient breakdown failure (attempt 1)'))
    .mockRejectedValueOnce(new AgentError('transient breakdown failure (attempt 2)'))
    .mockResolvedValueOnce({ status: 'success', output: '' });
  mockCreateArchitectAgent.mockReturnValue({ prompt: promptFn } as never);

  // Session with an EMPTY backlog so decomposePRD() enters the generation path.
  const backlog = createTestBacklog([]);
  const mockSession = createTestSession(backlog);
  const mockManager = createMockSessionManager(mockSession);
  const pipeline = new PRPPipeline('./test.md');
  (pipeline as any).sessionManager = mockManager;

  // decomposePRD() reads tasks.json after the agent "writes" it; stub readFile
  // to return a valid (empty-phases) Backlog JSON so the success path completes.
  mockReadFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(backlog), 'utf-8'));

  // EXECUTE
  await pipeline.decomposePRD();

  // VERIFY — the §6.1 invariant S3 protects:
  // 1. The Architect agent is created EXACTLY ONCE (never re-created on retry).
  expect(mockCreateArchitectAgent).toHaveBeenCalledTimes(1);
  // 2. The SAME agent instance's prompt() is invoked on EVERY attempt (3 total:
  //    initial + 2 retries). This is what makes every retry inherit the xhigh
  //    budget baked into the single createArchitectAgent() config.
  expect(promptFn).toHaveBeenCalledTimes(3);
});
```

Notes for the implementer:
- `AgentError` is exported from `src/utils/errors.ts` (line 422; `readonly code =
  ErrorCodes.PIPELINE_AGENT_LLM_FAILED`). Add the import if not already present:
  `import { AgentError } from '../../../src/utils/errors.js';`
- `mockCreateArchitectAgent` is already defined at line ~127
  (`const mockCreateArchitectAgent = createArchitectAgent as any;`).
- `mockReadFile` is already defined at line ~125 (`const mockReadFile = readFile
  as any;`). The mock for `node:fs/promises` (line 18) provides `readFile`.
- `createTestBacklog([])`, `createTestSession`, `createMockSessionManager` are
  the existing helpers used by every other `decomposePRD` test in the same
  describe block — mirror their usage exactly.
- `retryAgentPrompt`'s default `AGENT_RETRY_CONFIG.maxAttempts = 3`
  (retry.ts:~625), so **2 rejections + 1 resolution = 3 `prompt()` calls** —
  matches the assertion. Do not exceed 2 rejections (3rd rejection would throw
  out of `decomposePRD` into its non-fatal catch and the `toHaveBeenCalledTimes`
  on `promptFn` would still be 3, but the test would no longer exercise the
  *success-after-retry* path; keep 2 rejections + 1 success).
- **If the existing happy-path `decomposePRD` tests reveal a different
  readFile-stubbing requirement** (e.g., they reset `mockReadFile` in a
  `beforeEach`, or `readFile` must return a `Buffer` vs a string), mirror
  whatever pattern makes the existing "should update currentPhase to
  prd_decomposed" test pass. See Context §"Known Gotchas" #3.

**(b) Clarifying code comment** — ADD to `src/workflows/prp-pipeline.ts`,
immediately above `const architectAgent = createArchitectAgent();` inside
`decomposePRD()` (~line 774):

```ts
      // INVARIANT (PRD §6.1): the Architect is created ONCE here with the
      // Reasoning role (xhigh budget — wired by createArchitectAgent via S2).
      // The "demand-write" retry below (retryAgentPrompt) re-invokes THIS SAME
      // instance on every attempt, so every retry inherits the xhigh budget.
      // Do NOT move createArchitectAgent() inside the retry closure — a fresh
      // agent could rebind to a downgraded config and break §6.1's "same budget"
      // rule for the retry. Regression-locked by the
      // "reuses the same single Architect agent instance ..." unit test.
      const architectAgent = createArchitectAgent();
```

Keep the rest of `decomposePRD()` untouched.

### Success Criteria
- [ ] New test `reuses the same single Architect agent instance ...` exists in
      `describe('decomposePRD')`, imports `AgentError`, forces 2 transient
      rejections + 1 success, and asserts `mockCreateArchitectAgent` called once
      + `prompt` called 3×.
- [ ] `// INVARIANT (PRD §6.1)` comment present directly above the
      `createArchitectAgent()` call in `decomposePRD()` (and ONLY there).
- [ ] `decomposePRD()` body otherwise unchanged (no logic/signature/config edits).
- [ ] `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.
- [ ] No edits to `agent-factory.ts`, `retry.ts`, `ROLE_CONFIG`, `createBaseConfig`,
      or any `docs/` file.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** S3 is a 1-comment + 1-test change, but its correctness hinges on four
non-obvious facts, all documented below with exact file:line anchors: (1) the
agent is created **once** at prp-pipeline.ts:774 and the retry re-invokes the
**same** instance (proven by reading `retryAgentPrompt` → `retry` → closure
re-call); (2) `AgentError`'s code is `PIPELINE_AGENT_LLM_FAILED` →
`isTransientError` returns true → it IS retried (proven from retry.ts +
errors.ts:422); (3) the existing test mocks (`mockCreateArchitectAgent`,
`mockReadFile`, `createTestSession`) and helpers are pre-located; (4) the
strict scope fences (no factory/retry.ts/docs edits, no harness wiring). The
"primarily verifying" framing of the item is honored: S3 locks the invariant
rather than changing behavior.

### Documentation & References
```yaml
# MUST READ — the PRD spec (source of truth for the demand-write-retry budget rule)
- docfile: PRD.md
  section: "6.1 Task Breakdown System Prompt" (h3.12)
  why: "Decomposition runs at the MAXIMUM reasoning budget (xhigh). The 'demand
       write' retry (when breakdown output is missing/invalid) uses the SAME
       budget." This single sentence is the ENTIRE justification for S3.
  critical: "uses the SAME budget" is the invariant S3 locks. The retry is NOT a
       separate, lower-budget call.
- docfile: PRD.md
  section: "9.2.3 Model Selection" (h4.2)
  why: Defines the Reasoning role = balanced model @ xhigh. Confirms WHY the
       Architect (decomposition) is reasoning-tier.

# MUST READ — upstream CONTRACT (S1 + S2; assume implemented exactly as specified)
- docfile: plan/008_15504f60a0ef/P2M2T1S1/PRP.md
  section: "Goal / What (ThinkingLevel, ModelRole, ROLE_CONFIG, AgentConfig.thinking)"
  why: S1 ships the data model. S3 consumes `AgentConfig.thinking` and
       `ROLE_CONFIG.reasoning.thinking === 'xhigh'` as finished inputs.
  critical: `thinking` is a WRITE-ONLY marker until harness wiring lands. S3 does
       NOT make xhigh take effect at the harness — it only guarantees the request
       is uniform across initial + retry.
- docfile: plan/008_15504f60a0ef/P2M2T1S2/PRP.md
  section: "Goal / What (createArchitectAgent → createBaseConfig('architect','reasoning'))"
  why: S2 routes the Architect persona to the Reasoning role so its config carries
       thinking:'xhigh'. S3 ASSUMES this is in place; S3's invariant test is
       budget-agnostic (it checks structural reuse, not the thinking value) so it
       is correct regardless of S2's exact landing.
  critical: S2 and S3 are implemented IN PARALLEL. S3 must NOT re-assert the
       resolved thinking value (that is S2's unit test's job). S3 asserts the
       single-instance-reuse invariant.

# MUST READ — this subtask's research (proven facts about the working tree)
- docfile: plan/008_15504f60a0ef/P2M2T1S3/research/s3-codebase-analysis.md
  section: §1 (retry site at prp-pipeline.ts:774/787), §2 (retryAgentPrompt re-invokes
       the same closure), §3 (S2 already satisfies runtime req), §4 (what S3 delivers),
       §5 (test mock setup), §6 (AgentError transient mechanics), §7 (scope fences)
  why: Proves the agent is created ONCE and reused on retry; proves AgentError is
       retryable; locates every test helper/mock the new test needs.

# THE FILES TO EDIT
- file: src/workflows/prp-pipeline.ts
  section: decomposePRD(), ~line 768-790
  why: ADD the `// INVARIANT (PRD §6.1)` comment above `const architectAgent =
       createArchitectAgent();` (~line 774). NOTHING else in this file changes.
  pattern: existing inline `// COMMENT` style in decomposePRD (e.g., the
       "Surface agent-level failures" comment at ~line 782, the "Create Architect
       agent" line). Match that prose density.
  gotcha: Do NOT move, rename, or refactor the createArchitectAgent() call. Do NOT
       add a config override. The comment is the ONLY change.

- file: tests/unit/workflows/prp-pipeline.test.ts
  section: describe('decomposePRD', () => { ... }) (~line 298-355)
  why: ADD the new `it(...)` test (see "What" §a for the verbatim body). ADD the
       AgentError import if missing. No other test changes.
  pattern: mirror the existing decomposePRD tests — `createTestBacklog([])` +
       `createTestSession(backlog)` + `createMockSessionManager(mockSession)` +
       `new PRPPipeline('./test.md')` + `(pipeline as any).sessionManager =
       mockManager` + `await pipeline.decomposePRD()`.
  gotcha: see Known Gotchas #2/#3 for the readFile stub and the
       retry-count math. Use the REAL retryAgentPrompt (it is NOT mocked in this
       test file — only agent-factory, session-manager, task-orchestrator,
       node:fs/promises, and a few workflows are mocked). The retry loop will
       actually run.

# CONTRACT INPUTS (read-only — owned by S1/S2 / retry layer)
- file: src/agents/agent-factory.ts
  section: createArchitectAgent() (~line 290), createBaseConfig, ROLE_CONFIG
  why: S3 consumes createArchitectAgent() as a black box. Post-S2 it produces a
       config with thinking:'xhigh'. S3 does NOT modify it.
  gotcha: READ-ONLY for S3. If the working tree still shows the pre-S2 one-arg
       createBaseConfig('architect') call, that is EXPECTED (S2 is in flight);
       S3 does not fix it.
- file: src/utils/retry.ts
  section: retryAgentPrompt (line 651), retry (line ~470), isTransientError
  why: S3's test relies on retryAgentPrompt re-invoking the same closure and on
       AgentError being classified transient. Both are proven true. READ-ONLY.
- file: src/utils/errors.ts
  section: class AgentError (line 422), ErrorCodes.PIPELINE_AGENT_LLM_FAILED (line 71)
  why: S3's test throws `new AgentError(...)` to trigger a retry. Export proven.
  gotcha: AgentError's constructor signature — confirm during implementation
       (likely `new AgentError(message, context?)`). The test only needs the
       message arg.
```

### Current Codebase tree (relevant slice)
```bash
src/
  workflows/
    prp-pipeline.ts            # EDIT — add INVARIANT comment in decomposePRD() only
  agents/
    agent-factory.ts           # untouched (S1/S2) — INPUT only
  utils/
    retry.ts                   # untouched — INPUT only (retryAgentPrompt real)
    errors.ts                  # untouched — INPUT only (AgentError export)
tests/
  unit/
    workflows/
      prp-pipeline.test.ts     # EDIT — add 1 test in describe('decomposePRD')
vitest.config.ts               # READ-ONLY — 100% coverage thresholds; include src/**
package.json                   # READ-ONLY — `npm run validate` = lint+format:check+typecheck+test:run
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/workflows/prp-pipeline.ts          # MODIFIED — +1 comment block (INVARIANT §6.1)
                                       #   above createArchitectAgent() in decomposePRD()
tests/unit/workflows/prp-pipeline.test.ts  # MODIFIED — +1 it() test (retry-reuses-instance
                                       #   invariant) + AgentError import
# (no NEW files, no docs changes, no factory/retry.ts changes)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL: the agent is created ONCE at prp-pipeline.ts:774. retryAgentPrompt
// (retry.ts:651) wraps retry() (retry.ts:~470) which loops `await fn()` — calling
// the SAME closure `() => architectAgent.prompt(architectPrompt)` on every attempt.
// The agent instance + its frozen config are captured by the closure. There is NO
// config-mutation or re-creation vector in the retry path. This is WHY S3 is a
// verify+test task, not a behavior change. (Proven: read both functions in full.)

// CRITICAL (retry math): retryAgentPrompt's AGENT_RETRY_CONFIG.maxAttempts = 3
// (retry.ts:~625). So 2 rejections + 1 resolution = 3 total prompt() calls. The test
// asserts promptFn called 3×. If you accidentally use 3 rejections, the 3rd throws
// out to decomposePRD's non-fatal catch (currentPhase → 'prd_decomposition_failed')
// and the test's toHaveBeenCalledTimes(3) still holds but you're no longer testing
// success-after-retry. KEEP 2 rejections + 1 success.

// CRITICAL (transient classification): isTransientError (retry.ts) treats an
// AgentError (code PIPELINE_AGENT_LLM_FAILED) as RETRYABLE — UNLESS its message
// contains 'parse'/'parsing'. So the test's AgentError messages must NOT contain
// the word "parse" (use "transient breakdown failure" etc.), or retry will NOT
// happen and the test will fail with promptFn called only 1×.

// GOTCHA (readFile stub): decomposePRD() calls readFile(tasksPath, 'utf-8') AFTER
// the agent resolves, then JSON.parse + saveBacklog. The existing "should update
// currentPhase to prd_decomposed" test (line ~348) must currently reach the success
// branch — inspect HOW it stubs readFile (mockReadFile) and mirror it. The new S3
// test stubs mockReadFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(backlog),
// 'utf-8')) — but if the existing tests use a string (not Buffer) or reset mocks in
// a beforeEach, match that. If the stub is wrong, decomposePRD throws inside
// JSON.parse → non-fatal catch → currentPhase='prd_decomposition_failed' and the
// structural assertions (factory called 1×, prompt 3×) STILL pass, but the test
// wouldn't be exercising the clean success path. Prefer the clean path.

// GOTCHA (test isolation): vi.clearAllMocks() may run in a beforeEach. The new
// test sets up its own mockCreateArchitectAgent.mockReturnValue and its own
// mockReadFile.mockResolvedValueOnce inside the test body (not in beforeEach), so
// it is self-contained. Confirm no shared `mockAgent` fixture at file scope
// overrides per-test mockReturnValue (the e2e file has one; the UNIT file uses
// per-test setup — verify before finalizing).

// GOTCHA (100% coverage): prp-pipeline.ts is in the 100%-coverage include glob.
// The new test exercises the retry branch of decomposePRD (prompt rejecting then
// resolving) which is currently NOT covered by the unit suite (existing tests
// resolve on first call). So the new test ADDS coverage — it cannot dent the 100%
// threshold. retry.ts is already 100% covered; using the real retryAgentPrompt
// (un-mocked) is safe.

// CRITICAL (scope): S3 does NOT wire `thinking` into the pi harness. Across all of
// P2.M2.T1 (S1+S2+S3), `thinking:'xhigh'` is a WRITE-ONLY config marker — it is
// stored on AgentConfig and not yet read by the harness. S3 guarantees the REQUEST
// is uniform (same agent, same xhigh config, across initial + retry); harness
// ENFORCEMENT of xhigh is a later, separate task. Do not attempt harness wiring.

// GOTCHA (parallel seam with S2): S2 is being implemented concurrently and edits
// src/agents/agent-factory.ts (createArchitectAgent → reasoning role) and
// tests/integration/agents.test.ts. S3 edits src/workflows/prp-pipeline.ts and
// tests/unit/workflows/prp-pipeline.test.ts — ZERO file overlap with S2. The two
// PRPs cannot conflict at the filesystem level. S3's test is budget-agnostic
// (asserts reuse, not the thinking value) so it is correct whether or not S2 has
// landed when S3 runs.
```

---

## Implementation Blueprint

### Data models and structure
None. S3 adds NO types, constants, fields, or logic. It consumes S1's
`AgentConfig.thinking`, S2's `createArchitectAgent()` (reasoning role), and the
existing `retryAgentPrompt` / `AgentError` as-is.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/workflows/prp-pipeline.ts — add the INVARIANT comment
  - LOCATE decomposePRD() (~line 746). Find the line `const architectAgent =
    createArchitectAgent();` (~line 774).
  - INSERT immediately ABOVE it the `// INVARIANT (PRD §6.1): ...` comment block
    (see "What" §b for the exact text — ~7 lines).
  - PRESERVE: everything else in decomposePRD() and the file. No logic, signature,
    import, or config changes.
  - FOLLOW pattern: existing inline comment density in decomposePRD() (e.g. the
    "Surface agent-level failures instead of masking them" block at ~line 782).
  - GOTCHA: the comment must reference PRD §6.1 and the regression test name so a
    future maintainer finds both. Do NOT mention S1/S2 PRP paths in the comment
    (those are plan-artifact-internal; the code comment should stand alone).

Task 2: MODIFY tests/unit/workflows/prp-pipeline.test.ts — add the invariant test
  - ADD import (if not already present, near the existing errors imports):
      `import { AgentError } from '../../../src/utils/errors.js';`
    (Confirm the exact path/export: `rg -n "export class AgentError" src/utils/errors.ts`
    → line 422.)
  - LOCATE `describe('decomposePRD', () => { ... })` (~line 298). ADD a new `it(...)`
    as the LAST test in that block (after "should update currentPhase to
    prd_decomposed", ~line 355), using the verbatim body in "What" §a.
  - SELF-CONTAINMENT: set up `promptFn`, `mockCreateArchitectAgent.mockReturnValue`,
    session, manager, pipeline, and `mockReadFile.mockResolvedValueOnce` INSIDE the
    test body (mirror the other decomposePRD tests' per-test setup).
  - ASSERTIONS (the §6.1 invariant):
      * expect(mockCreateArchitectAgent).toHaveBeenCalledTimes(1);
      * expect(promptFn).toHaveBeenCalledTimes(3);
  - FOLLOW pattern: existing decomposePRD tests (createTestBacklog([]) +
    createTestSession + createMockSessionManager + new PRPPipeline('./test.md') +
    (pipeline as any).sessionManager = mockManager + await pipeline.decomposePRD()).
  - GOTCHA 1: AgentError messages must NOT contain "parse"/"parsing" or
    isTransientError returns false and no retry occurs (promptFn called 1×, test fails).
  - GOTCHA 2: keep exactly 2 rejections + 1 resolution (maxAttempts=3 → 3 calls).
  - GOTCHA 3: inspect how the existing happy-path decomposePRD test stubs readFile
    (Buffer vs string; per-test vs beforeEach) and mirror it so the success branch
    completes cleanly.
  - DO NOT assert on the resolved `thinking` value — that is S2's unit test's
    responsibility (keeps S2/S3 assertions disjoint).

Task 3: VERIFY — no functional regressions (read-only checks before declaring done)
  - RUN `npm run typecheck` (tsc --noEmit) → exit 0 (confirms AgentError import +
    the test compiles; the comment-only src/ change typechecks trivially).
  - RUN `npx vitest run tests/unit/workflows/prp-pipeline.test.ts` → the new test
    PASSES and existing decomposePRD tests stay GREEN.
  - RUN `npm run validate` → GREEN (lint + format:check + typecheck + vitest run)
    with 100% coverage on src/**/*.ts preserved.
  - VERIFY (rg) the INVARIANT comment landed exactly once and the new test exists
    (see Validation §Level 4).
  - VERIFY decomposePRD() is otherwise unchanged:
      `git diff src/workflows/prp-pipeline.ts` → ONLY added comment lines, no logic.
```

### Implementation Patterns & Key Details

```ts
// PATTERN: the retry reuses the SAME agent instance (the §6.1 invariant).
// decomposePRD() — current structure (S3 adds ONLY the comment):
const { createArchitectAgent } = await import('../agents/agent-factory.js');
// ... createArchitectPrompt ...
// INVARIANT (PRD §6.1): the Architect is created ONCE here with the Reasoning
// role (xhigh budget — wired by createArchitectAgent via S2). The "demand-write"
// retry below (retryAgentPrompt) re-invokes THIS SAME instance on every attempt,
// so every retry inherits the xhigh budget. Do NOT move createArchitectAgent()
// inside the retry closure — a fresh agent could rebind to a downgraded config
// and break §6.1's "same budget" rule for the retry. Regression-locked by the
// "reuses the same single Architect agent instance ..." unit test.
const architectAgent = createArchitectAgent();   // ← config frozen (xhigh) here
// ...
const result = await retryAgentPrompt(
  () => architectAgent.prompt(architectPrompt),  // ← SAME instance on every retry
  { agentType: 'Architect', operation: 'decomposePRD' }
);

// PATTERN: the regression test forces the retry loop and checks reuse.
const promptFn = vi.fn()
  .mockRejectedValueOnce(new AgentError('transient failure 1'))  // retryable
  .mockRejectedValueOnce(new AgentError('transient failure 2'))  // retryable
  .mockResolvedValueOnce({ status: 'success', output: '' });     // 3rd attempt ok
mockCreateArchitectAgent.mockReturnValue({ prompt: promptFn } as never);
// ... session/readFile setup ...
await pipeline.decomposePRD();
expect(mockCreateArchitectAgent).toHaveBeenCalledTimes(1);  // NOT re-created
expect(promptFn).toHaveBeenCalledTimes(3);                   // initial + 2 retries

// CRITICAL: AgentError → isTransientError === true (code PIPELINE_AGENT_LLM_FAILED),
//   UNLESS the message contains 'parse'. Keep messages parse-free.
// CRITICAL: maxAttempts=3 → 2 rejections + 1 resolution = exactly 3 prompt() calls.
```

### Integration Points

```yaml
PIPELINE (src/workflows/prp-pipeline.ts):
  - add: `// INVARIANT (PRD §6.1)` comment above createArchitectAgent() in decomposePRD().
  - no logic change.

TESTS (tests/unit/workflows/prp-pipeline.test.ts):
  - add: 1 `it(...)` in describe('decomposePRD') — retry-reuses-instance invariant.
  - add: AgentError import (if missing).

NO DATABASE / NO ROUTES / NO ENV VARS / NO CLI / NO DOCS / NO FACTORY / NO RETRY.TS
  — pure verify+lock: 1 comment + 1 test.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing src/workflows/prp-pipeline.ts (comment only) + the test file:
npm run typecheck          # tsc --noEmit → MUST be exit 0 (AgentError import + test compiles)
npm run lint -- --ext .ts  # eslint: the comment should not trip any rule
npm run format:check        # prettier; run `npm run format` if it complains

# Expected: Zero errors. The src/ change is a comment (cannot break compilation).
# The test change adds an import + a test — typecheck confirms AgentError resolves.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the pipeline unit suite (gated — included by vitest):
npx vitest run tests/unit/workflows/prp-pipeline.test.ts

# Full suite + 100% coverage enforcement:
npm run test:run
npx vitest run --coverage   # thresholds: statements/branches/functions/lines = 100

# Expected: ALL green. Specifically the NEW test:
#   'reuses the same single Architect agent instance ... (PRD §6.1 ... invariant)'
#   - mockCreateArchitectAgent called 1×
#   - promptFn called 3× (2 transient rejections + 1 success)
# AND the EXISTING decomposePRD tests stay green (skip-if-backlog, factory-called,
#   currentPhase=prd_decomposed).
# If the new test fails with promptFn called 1×: the AgentError was NOT retried —
#   either its message contains 'parse' (remove that word) OR retryAgentPrompt is
#   somehow mocked (it is NOT in this file's vi.mock list — confirm).
# If the new test fails with promptFn called 2×: only 1 rejection was configured
#   (add the 2nd mockRejectedValueOnce).
# Coverage on src/**/*.ts stays 100% (the new test only ADDS a covered branch).
```

### Level 3: Integration Testing (System Validation)

```bash
# Full project validation gate (lint + format:check + typecheck + tests):
npm run validate

# Build (compiles dist — confirms no transitive breakage from the comment/import):
npm run build

# Expected: `npm run validate` GREEN; `npm run build` succeeds. No runtime behavior
# change (the only src/ edit is a comment; the test edit is additive).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the INVARIANT comment landed exactly once, at the right site:
rg -n "INVARIANT \(PRD §6.1\)" src/workflows/prp-pipeline.ts
# EXPECT: exactly one match, immediately above `const architectAgent = createArchitectAgent();`
# in decomposePRD().

# Confirm decomposePRD() logic is UNCHANGED (only a comment was added):
git diff src/workflows/prp-pipeline.ts
# EXPECT: only green `+` comment lines inside decomposePRD(); no `-` lines, no logic edits.

# Confirm the new test exists and asserts the invariant:
rg -n "reuses the same single Architect agent instance|toHaveBeenCalledTimes\(1\)|toHaveBeenCalledTimes\(3\)" tests/unit/workflows/prp-pipeline.test.ts
# EXPECT: the test title + the two assertions present in the decomposePRD describe block.

# Confirm AgentError is imported in the test file:
rg -n "import.*AgentError.*errors" tests/unit/workflows/prp-pipeline.test.ts
# EXPECT: one import line (added by S3 if not already present).

# Confirm NO edits leaked into out-of-scope files:
git diff --name-only
# EXPECT: only src/workflows/prp-pipeline.ts and tests/unit/workflows/prp-pipeline.test.ts.
#   (NO agent-factory.ts, retry.ts, errors.ts, ROLE_CONFIG, docs/, etc.)

# Expected: comment present once; decomposePRD logic unchanged; new test + import
# present; no out-of-scope file touched.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0 (AgentError import resolves; test compiles).
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + `vitest run`).
- [ ] `npm run build` succeeds.
- [ ] 100% coverage on `src/**/*.ts` preserved (`vitest run --coverage`).

### Feature Validation
- [ ] `// INVARIANT (PRD §6.1)` comment present once, above `createArchitectAgent()`
      in `decomposePRD()`.
- [ ] New test `reuses the same single Architect agent instance ...` exists in
      `describe('decomposePRD')`, forces 2 transient `AgentError` rejections + 1
      success, and asserts factory called 1× + prompt called 3×.
- [ ] `decomposePRD()` body otherwise unchanged (comment-only src/ diff).
- [ ] No edits to `agent-factory.ts`, `retry.ts`, `errors.ts`, `ROLE_CONFIG`,
      `createBaseConfig`, or any `docs/` file.

### Code Quality Validation
- [ ] Comment references PRD §6.1 and the regression-test name (standalone, no
      plan-artifact paths).
- [ ] Test is self-contained (per-test mock setup, mirrors existing decomposePRD
      tests).
- [ ] Test does NOT assert the resolved `thinking` value (S2's unit test owns that
      — keeps assertions disjoint across the parallel PRPs).
- [ ] AgentError messages are parse-free (so `isTransientError` classifies them
      retryable).

### Documentation & Deployment
- [ ] No docs edits (item 5: DOCS none).
- [ ] No new env vars / CLI flags / routes / config (pure verify+lock).

---

## Anti-Patterns to Avoid

- ❌ Don't modify `createArchitectAgent()` / `createBaseConfig` / `ROLE_CONFIG` —
  S1/S2 own them. S3 consumes the post-S2 architect as a black box.
- ❌ Don't edit `retry.ts` / `retryAgentPrompt` — it already re-invokes the same
  instance. S3 only proves that with a test.
- ❌ Don't wire `thinking` into the pi harness end-to-end — harness enforcement of
  xhigh is a LATER task. S3 only guarantees the *request* is uniform across
  initial + retry (same agent, same config).
- ❌ Don't move `createArchitectAgent()` inside the retry closure "to be safe" —
  that is the exact regression S3 forbids. The comment + test exist to prevent it.
- ❌ Don't assert the resolved `thinking` value in the pipeline test — that overlaps
  with S2's unit test and couples S3 to S2's exact wiring. Assert the structural
  reuse invariant instead (budget-agnostic).
- ❌ Don't use an AgentError message containing "parse"/"parsing" —
  `isTransientError` returns false and the retry won't fire (test fails with
  promptFn called 1×).
- ❌ Don't configure 3 rejections — `maxAttempts=3` means the 3rd rejection throws
  out of `decomposePRD` to its non-fatal catch. Use 2 rejections + 1 success.
- ❌ Don't touch the `delta-analysis-workflow.ts:131` `retryAgentPrompt` call —
  that's the Delta classifier, a different agent/role; item 3 scopes S3 to
  decomposition only.
- ❌ Don't edit any `docs/` file — item 5 says DOCS none (S1 already documented
  Model Roles).
- ❌ Don't add logic to `decomposePRD()` "to enforce xhigh on retry" — the runtime
  is already correct (single instance reused). S3 is verify + lock, not behavior
  change. Adding redundant config-passing would be cargo-cult code.

---

## Confidence Score

**9/10** — One-pass success likelihood is high. S3 is a 1-comment + 1-test change
whose correctness rests on four pre-proven facts: (1) the agent is created once at
prp-pipeline.ts:774 and the retry re-invokes the same instance (read in full);
(2) `AgentError` (code `PIPELINE_AGENT_LLM_FAILED`) is classified transient by
`isTransientError` → it IS retried (proven from retry.ts + errors.ts:422); (3) the
test helpers/mocks (`mockCreateArchitectAgent`, `mockReadFile`,
`createTestSession`, `createMockSessionManager`) are pre-located and used by every
existing decomposePRD test; (4) the scope fences are airtight (no factory/retry.ts/
docs edits; zero file overlap with the parallel S2). The runtime behavior is already
correct post-S2, so S3 cannot introduce a regression — the only risk is the test's
readFile stubbing not matching the existing happy-path test's pattern, which is
explicitly called out as a "mirror the existing test" gotcha. The remaining 1/10 is
the need to confirm the exact `readFile` stub shape (Buffer vs string) during
implementation.