# PRP — P1.M1.T2.S2: Add integration test for G2.1 neutralization through the real BashMCP path

> Bugfix 001, **optional test-coverage hardening** (Recommendation #2 of `TEST_RESULTS.md`, integration half).
> The executor already neutralizes non-monotonic negated file-existence gates (PRD §9.9 G2.1) at
> `src/agents/prp-executor.ts:553` — BEFORE `execute_bash` is reached. The existing UNIT test
> (`tests/unit/agents/prp-executor.test.ts`, owned by S1) proves the result shape + log with a
> MOCKED `execute_bash`. **T2.S2 adds ONE new `it()` to the INTEGRATION test file that runs the
> neutralization through the REAL executor + REAL BashMCP** (the LLM agent is still mocked), proving
> the contrast the unit test cannot: a neutralized gate bypasses BashMCP entirely while a sibling
> real gate in the same PRP runs for real. Test-only — no source/config/docs change. The behavior
> already exists; this proves it holds end-to-end.

---

## Goal

**Feature Goal**: Add one integration test in `tests/integration/prp-executor-integration.test.ts`
(inside the existing `describe('execute() with real dependencies')` block) that exercises the §9.9
G2.1 negated-existence-gate neutralization through the REAL `PRPExecutor` + REAL `BashMCP` (agent
mocked to avoid LLM calls). The test builds a PRP with (i) a negated file-existence gate that would
FAIL if executed (targeting a file that exists) and (ii) a real executable gate, then asserts: (a)
overall `outcome === 'success'`; (b) the negated gate was neutralized (`skipped: true, success: true,
exitCode: null`); (c) the real gate was ACTUALLY executed via BashMCP (`exitCode` not null, captured
`stdout`). This is the end-to-end proof that neutralization works through the real code path — not
just the mocked-`execute_bash` unit path.

**Deliverable**:
1. **`tests/integration/prp-executor-integration.test.ts`** — EDIT (the ONLY file touched): append
   one new `it()` case to the existing `describe('execute() with real dependencies')` block, using
   the file's established patterns (`createMockPRPDocument(id, customGates)`,
   `mockAgent.prompt.mockResolvedValue(success JSON)`, `new PRPExecutor(sessionPath)`,
   `await executor.execute(prp, prpPath)`, `result.validationResults.find(r => r.level === N)`).

**Success Definition**:
- The new test runs the REAL executor + REAL BashMCP (no `execute_bash` mock), mocks only the agent.
- The negated gate (`! test -f package.json`) is neutralized: `skipped:true, success:true,
  exitCode:null, stdout:''` — it never reaches BashMCP.
- A sibling real gate (`echo "real gate executed"`) runs for real: `skipped:false, exitCode:0`,
  `stdout` contains the echo output — proving the real BashMCP path works for non-neutralized gates.
- Overall `result.success === true` AND `result.outcome === 'success'`.
- `npx vitest run tests/integration/prp-executor-integration.test.ts` is GREEN — the new test passes
  (the §9.9 behavior already exists in source) AND every existing test in the file still passes.
- `npm run typecheck && npm run lint && npm run format:check` clean (test-only change).
- **No source/config/docs files modified.**

---

## Why

- **Closes the integration-coverage gap the bug-hunt flagged.** `TEST_RESULTS.md` Recommendation #2:
  "add one integration test exercising the neutralization through the real BashMCP path." The unit
  test mocks `execute_bash`, so it cannot prove the neutralization `continue` actually fires before
  the real BashMCP in the real executor. This test does — by showing a real sibling gate IS executed
  (non-null exitCode) while the negated gate is NOT (null exitCode, empty stdout).
- **Proves neutralization is load-bearing, not a no-op.** By targeting `package.json` (which EXISTS
  at the repo root), the negated gate `! test -f package.json` would EXIT 1 (FAIL) if it ran. The
  only way the overall `outcome` is `'success'` is because the gate was neutralized. (The work item's
  suggested `src/hooks/index.ts` does NOT exist — see research §4 — so it would pass either way and
  wouldn't prove neutralization matters.)
- **Low risk, test-only.** The §9.9 behavior already exists in source (`prp-executor.ts:553`); this
  task only adds an end-to-end test. No production code changes; the integration harness (real
  BashMCP, mocked agent) is already established in the file.
- **Scope discipline.** T2.S2 = the INTEGRATION-level real-BashMCP test (this file). T2.S1 = the
  UNIT-level log assertion (mocked `execute_bash`, distinct file `tests/unit/agents/...`). The G1.4
  prompt fix is P1.M1.T1.S1 (distinct files). The docs sync is P1.M1.T3. **Zero file overlap with S1.**

---

## What

### User-visible behavior
None. Test-only hardening of an existing code path. No user/config/API/runtime surface change (the
item's "DOCS: none").

### Technical requirements (exact contract)

**Edit — `tests/integration/prp-executor-integration.test.ts`** (the ONLY file edited; one new `it()`):

Add a new `it()` inside the EXISTING `describe('execute() with real dependencies')` block (after the
"capture stdout/stderr" test, ~L258). Use the established custom-gate-array + factory + mock-agent +
real-executor pattern. Assert the contract's a/b/c:

```ts
it(
  'should neutralize a negated file-existence gate (G2.1) through the real BashMCP path',
  async () => {
    // SETUP: mix a real executable gate, a G2.1 negated-existence gate, a second real gate,
    // and a manual gate. The negated gate targets package.json (EXISTS at the repo root), so
    // `! test -f package.json` would EXIT 1 (fail) if it ran — neutralization is the ONLY way
    // this PRP passes overall. (See PRP research §4 for why an existing-file target matters.)
    const customValidationGates: PRPDocument['validationGates'] = [
      {
        level: 1,
        description: 'Real executable gate (proves the BashMCP path works)',
        command: 'echo "real gate executed"',
        manual: false,
      },
      {
        level: 2,
        description: 'Negated file-existence gate (G2.1 — must be neutralized, never executed)',
        command: '! test -f package.json',
        manual: false,
      },
      {
        level: 3,
        description: 'Second real gate',
        command: 'echo "second real gate"',
        manual: false,
      },
      {
        level: 4,
        description: 'Manual review',
        command: null,
        manual: true,
      },
    ];
    const prp = createMockPRPDocument('P1.M2.T2.S2', customValidationGates);
    const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

    // Mock Coder Agent to return success (no LLM call; everything else is REAL).
    mockAgent.prompt.mockResolvedValue(
      JSON.stringify({
        result: 'success',
        message: 'Implementation complete',
      })
    );

    const executor = new PRPExecutor(sessionPath);

    // EXECUTE
    const result = await executor.execute(prp, prpPath);

    // VERIFY (a): overall execution succeeded (the negated gate counted as passed via §9.9).
    expect(result.success).toBe(true);
    expect(result.outcome).toBe('success');

    // VERIFY (b): the negated-existence gate (level 2) was NEUTRALIZED — skipped, counted as
    // passed, never touched BashMCP (exitCode null, empty stdout/stderr). It bypasses the real
    // path entirely even though the real BashMCP is wired up.
    const negatedResult = result.validationResults.find(r => r.level === 2);
    expect(negatedResult?.skipped).toBe(true);
    expect(negatedResult?.success).toBe(true);
    expect(negatedResult?.exitCode).toBeNull();
    expect(negatedResult?.command).toBe('! test -f package.json');
    expect(negatedResult?.stdout).toBe('');
    expect(negatedResult?.stderr).toBe('');

    // VERIFY (c): the real gate (level 1) was ACTUALLY executed via the real BashMCP — non-null
    // exitCode, captured stdout, not skipped. This is the integration proof: a sibling gate runs
    // for real while the negated gate (b) bypasses BashMCP.
    const realResult = result.validationResults.find(r => r.level === 1);
    expect(realResult?.skipped).toBe(false);
    expect(realResult?.exitCode).not.toBeNull();
    expect(realResult?.exitCode).toBe(0);
    expect(realResult?.stdout).toContain('real gate executed');
  }
);
```

### Success Criteria
- [ ] One new `it()` added inside `describe('execute() with real dependencies')`.
- [ ] The test uses the REAL executor (`new PRPExecutor(sessionPath)`) + REAL BashMCP (no
      `execute_bash` mock); only the agent is mocked (as in every other test in the file).
- [ ] `(a)` asserts `result.success === true` AND `result.outcome === 'success'`.
- [ ] `(b)` the negated gate (level 2) has `skipped:true, success:true, exitCode:null`, empty
      stdout/stderr, and `command === '! test -f package.json'`.
- [ ] `(c)` the real gate (level 1) has `skipped:false, exitCode` not null (`=== 0`), `stdout`
      contains `'real gate executed'`.
- [ ] `npx vitest run tests/integration/prp-executor-integration.test.ts` GREEN (new + all existing).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] No source/config/docs files modified.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the
exact `it()` body to add (copy-ready), the verified result interfaces (`ValidationGateResult` +
`ExecutionResult` with the `success`/`outcome` invariant), the verified neutralization result shape
(`skipped:true/success:true/exitCode:null/stdout:''`), the rationale for targeting `package.json`
(an existing file → neutralization is load-bearing), the file-disjoint proof vs S1, and the
executable validation command.

### Documentation & References
```yaml
# MUST READ — the test design + the result-shape facts + the target-file rationale (authored with this PRP)
- docfile: plan/011_5e3dfdb12bd1/bugfix/001_22bcf90e9926/P1M1T2S2/research/neutralization-integration-test.md
  section: "2. The two result interfaces", "3. The neutralization result shape", "4. Picking the negated-gate target", "6. Test design"
  why: Exact ValidationGateResult + ExecutionResult field names; the neutralized-gate shape; why package.json (existing) makes the
        test prove neutralization is load-bearing vs the work item's src/hooks/index.ts (which does NOT exist); the copy-ready test.

# MUST READ — the bug-hunt recommendation this task implements
- docfile: plan/011_5e3dfdb12bd1/bugfix/001_22bcf90e9926/TEST_RESULTS.md
  section: "Recommendations" (item 2: "add one integration test exercising the neutralization through the real BashMCP path")
  why: States the integration-coverage gap.

# PATTERN FILE 1 — the integration test file being edited (the ONLY edit site)
- file: tests/integration/prp-executor-integration.test.ts
  why: The harness — mocks ONLY the LLM boundary (agent-factory L24, prompts L29, retry L44, checkpoint-manager L71) and keeps
        BashMCP/logger/gate-semantics REAL. createMockPRPDocument(id, gates?) factory L90. sessionPath = process.cwd() L120.
        Existing patterns to mirror: the real-BashMCP success test (L132–167), "skip manual gates" (L236–261), "null command"
        (L236+). All assert via result.validationResults.find(r => r.level === N) reading success/skipped/exitCode/stdout.
  pattern: "const prp = createMockPRPDocument('P1.M2.T2.S2', customValidationGates); mockAgent.prompt.mockResolvedValue(JSON.stringify({result:'success',…})); const executor = new PRPExecutor(sessionPath); const result = await executor.execute(prp, prpPath);"
  gotcha: Add the new it() INSIDE describe('execute() with real dependencies') — NOT in 'error handling' or 'ExecutionResult structure'.

# PATTERN FILE 2 — the executor source (READ-ONLY — the path under test)
- file: src/agents/prp-executor.ts
  why: L42 ValidationGateResult (level/description/success/command/stdout/stderr/exitCode/skipped/timedOut). L100 ExecutionResult
        (success + outcome?:'success'|'fail'|'issue', invariant success===(outcome==='success') at L87/L101). L553–574 the G2.1
        neutralization: isNegatedFileExistenceGate → info-log → push {skipped:true,success:true,exitCode:null,stdout:'',…} → continue
        (execute_bash NEVER reached). L595 executed gates: exitCode = result.exitCode ?? null (0 for echo), skipped:false.
  pattern: "if (isNegatedFileExistenceGate(gate.command)) { this.#logger.info({level,description,command}, '…neutralized…(§9.9)'); results.push({…skipped:true,success:true,exitCode:null…}); continue; }"
  critical: The neutralized gate runs BEFORE execute_bash — so it is observable even though BashMCP is real & wired up (it simply is never called for that gate).

# PATTERN FILE 3 — the detector (READ-ONLY)
- file: src/agents/gate-semantics.ts
  why: isNegatedFileExistenceGate matches LEADING (`! test -f X`) and INNER (`test ! -f X`) negation over -f/-e/-d. Our `! test -f
        package.json` matches LEADING_NEGATED_EXISTENCE. Conservative: negated content (`! grep …`), positive checks, ambiguous
        expressions all return false → execute normally (G2.2/G2.3). So the test's real `echo` gates are guaranteed to run.
  gotcha: Do NOT add a negated-CONTENT gate (e.g. `! grep …`) expecting neutralization — those EXECUTE (G2.2). Only negated existence neutralizes.

# READ-ONLY — the spec
- docfile: spec/16-validation-gates.md
  section: "§9.9.2 REQ-G2 — G2.1 (Detect and skip negative file-existence gates)" and "G2.2 (Scope: negated existence only)"
  why: Authoritative G2.1 contract: `! test -f` / `test ! -f` → skipped:true, success:true, logged reason, counts as passed.

# VERIFIED FACTS
- fact: "ExecutionResult has BOTH success:boolean AND outcome?:'success'|'fail'|'issue' (invariant success===(outcome==='success')). The work item's 'result.outcome' is valid; assert BOTH for robustness."
- fact: "The neutralized-gate shape is {skipped:true, success:true, exitCode:null, stdout:'', stderr:'', command:<negated>, timedOut:false} (prp-executor.ts:553)."
- fact: "An executed real gate has exitCode = result.exitCode ?? null (=0 for echo), skipped:false, stdout carrying output."
- fact: "src/hooks/index.ts does NOT exist; package.json EXISTS at the repo root. Targeting package.json makes `! test -f package.json` fail-if-executed → neutralization is the only path to outcome:'success'."
- fact: "The integration harness does NOT mock execute_bash/BashMCP/logger — only agent-factory/prompts/retry/checkpoint-manager. BashMCP runs at cwd: process.cwd() (repo root)."
- fact: "S1 edits tests/unit/agents/prp-executor.test.ts (mocked execute_bash + logger mock). S2 edits tests/integration/prp-executor-integration.test.ts (real BashMCP, no logger mock). Different files — zero overlap."
```

### Current Codebase tree (relevant slice)
```bash
tests/integration/prp-executor-integration.test.ts   # EDIT — +1 it() in describe('execute() with real dependencies')
src/agents/prp-executor.ts                           # READ-ONLY (L42/L100 interfaces, L553 neutralization — NOT modified)
src/agents/gate-semantics.ts                         # READ-ONLY (the detector — NOT modified)
```

### Desired Codebase tree with files to be added/edited
```bash
tests/integration/prp-executor-integration.test.ts   # MODIFIED (one new it() case)
# No source/config/docs changes. No new files. (Item's "DOCS: none".)
```

### Known Gotchas of our Codebase & Library Quirks
```ts
// CRITICAL — target an EXISTING file for the negated gate. `! test -f package.json` (package.json exists
//   at the repo root) would EXIT 1 if executed, so the test's outcome:'success' is ONLY achievable via
//   neutralization. The work item's `src/hooks/index.ts` does NOT exist → the gate would pass either way
//   (weaker). Use package.json. (See research §4.)

// CRITICAL — assert BOTH result.success===true AND result.outcome==='success'. ExecutionResult carries both
//   (invariant success===(outcome==='success'), prp-executor.ts:87/101). The work item asks for outcome; the
//   existing tests use success. Asserting both is the robust, self-documenting choice.

// CRITICAL — the neutralized-gate discriminator is exitCode===null AND stdout==='' (the neutralization path
//   pushes stdout:''/stderr:''). A real executed gate has exitCode not null AND stdout with output. Asserting
//   BOTH on the level-2 (negated) and level-1 (real) gates is what proves neutralization bypassed BashMCP
//   while a sibling gate ran for real — the whole point of this integration test.

// CRITICAL — do NOT mock execute_bash or BashMCP in this file. The harness keeps them REAL (the executor
//   instantiates its own BashMCP). Mocking them would defeat the test's purpose (it must prove the real path).
//   Only the agent is mocked (as in every other test in the file).

// GOTCHA — the real getLogger('PRPExecutor') emits the §9.9 info log during this test (fire-and-forget to
//   console). Do NOT mock the logger here (that's S1's unit-test concern). The log is harmless; this test
//   asserts the RESULT shape, not the log message.

// GOTCHA — place the new it() INSIDE describe('execute() with real dependencies'), NOT in 'error handling'
//   or 'ExecutionResult structure'. It belongs with the other real-BashMCP execution tests.

// GOTCHA — the real gates are `echo` commands (exit 0, no side effects, deterministic). The negated gate is
//   neutralized (never runs). The manual gate is skipped. So the test is side-effect-free and deterministic.
//   No timeout option is needed (success-path, no fix-retries); the existing success tests omit it. Add
//   { timeout: 10000 } only if CI proves flaky.

// GOTCHA — this is test-hardening of an EXISTING code path (neutralization already fires at L553). It is NOT
//   a RED→GREEN TDD cycle for new behavior. The test passes immediately once added. If it FAILS, the
//   neutralization regressed in source — that's the finding to report (do NOT edit source to make it pass).

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check (the it() body is short;
//   prettier may adjust spacing/commas).

// GOTCHA — vitest 100% coverage on src/**/*.ts is UNAFFECTED — no src/ lines change. The new test is in a
//   test file (excluded from coverage).
```

---

## Implementation Blueprint

### Data models and structure
None — test-only. The "structure" is the custom `validationGates` array (4 gates) and the three
assertion groups (a/b/c) over the verified `ValidationGateResult`/`ExecutionResult` interfaces.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT tests/integration/prp-executor-integration.test.ts — append the new it()
  - ADD the new it() (from "Technical requirements") INSIDE describe('execute() with real dependencies'),
        after the "capture stdout/stderr from real BashMCP commands" test (~L258).
  - REUSE the file's established pattern: createMockPRPDocument('P1.M2.T2.S2', customValidationGates);
        mockAgent.prompt.mockResolvedValue(JSON.stringify({result:'success',message:…})); new PRPExecutor(sessionPath);
        await executor.execute(prp, prpPath); result.validationResults.find(r => r.level === N).
  - Use '! test -f package.json' for the negated gate (existing-file target → neutralization is load-bearing).
  - Assert (a) result.success===true AND result.outcome==='success'; (b) level-2 neutralized shape
        (skipped/success/exitCode-null/empty stdout+stderr/command); (c) level-1 real-executed shape
        (skipped:false, exitCode:0, stdout contains 'real gate executed').
  - DO NOT: mock execute_bash/BashMCP/logger, modify source, touch the unit test file (S1), or add docs.
  - EXPECTED: the test passes immediately (neutralization already fires at prp-executor.ts:553).

Task 2: FORMAT + VERIFY
  - RUN: npm run fix (lint:fix + prettier --write).
  - RUN: npx vitest run tests/integration/prp-executor-integration.test.ts → ALL GREEN (new test + every
        existing test). This is the contract's gate.
  - RUN: npm run typecheck && npm run lint && npm run format:check → clean (test-only change).
  - EXPECTED: all green. If the new test FAILS, the §9.9 neutralization regressed in source (prp-executor.ts:553)
        — report it (do NOT silently weaken the test or edit source to make it pass unless it genuinely
        regressed). If OTHER tests fail, the new it() is breaking the shared beforeEach/afterEach — confirm
        it is inside the right describe block and uses the established pattern.
```

### Implementation Patterns & Key Details
```ts
// ---- the new it() (copy-ready — see "Technical requirements" for the full body) ----
// Key assertion groups:

// (a) overall success — ExecutionResult carries BOTH success + outcome (invariant: success===(outcome==='success'))
expect(result.success).toBe(true);
expect(result.outcome).toBe('success');

// (b) neutralized gate — the §9.9 path pushed {skipped:true,success:true,exitCode:null,stdout:'',…} BEFORE execute_bash
const negatedResult = result.validationResults.find(r => r.level === 2);
expect(negatedResult?.skipped).toBe(true);
expect(negatedResult?.success).toBe(true);
expect(negatedResult?.exitCode).toBeNull();
expect(negatedResult?.command).toBe('! test -f package.json');
expect(negatedResult?.stdout).toBe('');

// (c) real gate — executed via the REAL BashMCP (exitCode:0, captured stdout, not skipped)
const realResult = result.validationResults.find(r => r.level === 1);
expect(realResult?.skipped).toBe(false);
expect(realResult?.exitCode).not.toBeNull();
expect(realResult?.exitCode).toBe(0);
expect(realResult?.stdout).toContain('real gate executed');

// ---- why package.json (not src/hooks/index.ts) ----
// src/hooks/index.ts does NOT exist → `! test -f <nonexistent>` would PASS if executed (weak proof).
// package.json EXISTS at the repo root → `! test -f package.json` would FAIL if executed → the ONLY way
// to outcome:'success' is neutralization. Strong, load-bearing proof.

// ---- why both success + outcome ----
// ExecutionResult (prp-executor.ts:100): success:boolean + outcome?:'success'|'fail'|'issue'.
// Invariant (L87/L101): success === (outcome === 'success'). The work item asks for outcome; existing
// tests use success. Asserting both is robust and self-documenting.
```

### Integration Points
```yaml
NO SOURCE INTEGRATION: this task changes NO src/ files. The executor (src/agents/prp-executor.ts) is
  consumed unchanged; its L553 neutralization already fires. BashMCP, gate-semantics, and the logger are
  all REAL in this integration harness (only the agent is mocked, as in every other test in the file).

NO DOCS/CONFIG CHANGE (the item's "DOCS: none"). No user-facing surface.

DOWNSTREAM / COMPLEMENTARY (separate subtasks, do NOT do them here):
  - P1.M1.T2.S1 (unit-level log assertion): edits tests/unit/agents/prp-executor.test.ts — distinct file,
        mocked execute_bash + logger mock. Zero overlap with S2.
  - P1.M1.T1.S1 (G1.4 prompt fix, Complete): edits prompts.ts + PROMPTS.md + prompts.test.ts — unrelated.
  - P1.M1.T3 (docs sync): verifies README/ARCHITECTURE §9.9 references — unrelated.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix                  # lint:fix + prettier --write (run after the edit)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean (test-only; no src change)
npm run lint && npm run format:check   # clean
# Expected: clean. If lint flags something, it's a formatting nit (re-run npm run fix).
```

### Level 2: Integration Tests (the PRIMARY gate — the contract's command)
```bash
npx vitest run tests/integration/prp-executor-integration.test.ts
# Expected: ALL GREEN — the new test passes (neutralization already fires at prp-executor.ts:553 with the
#   REAL BashMCP) AND every existing test in the file still passes. If the new test FAILS, the §9.9
#   neutralization regressed in source — report it (don't silently weaken the test). If OTHER tests fail,
#   the new it() is breaking the shared setup — confirm it's in the right describe block + uses the pattern.

# Confirm the unit-level neutralization + detector suites are untouched (regression):
npx vitest run tests/unit/agents/prp-executor.test.ts tests/unit/agents/gate-semantics.test.ts
# Expected: GREEN (S2 touches neither; these prove the broader §9.9 surface is intact).
```

### Level 3: Integration Testing (System Validation)
```bash
# This task IS an integration test — Level 2 above is the system validation. No service to start; the
# executor runs real BashMCP against process.cwd() (repo root) with the agent mocked.
# Smoke-confirm the new test landed in the right describe block:
grep -n "neutralize a negated file-existence gate (G2.1) through the real BashMCP" tests/integration/prp-executor-integration.test.ts
# Expected: exactly one match, inside describe('execute() with real dependencies').
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP beyond the real local BashMCP. Domain checks (record in commit msg):
#   1. Load-bearing neutralization: the negated gate targets package.json (EXISTS) → `! test -f package.json`
#      would fail if executed; outcome:'success' is ONLY reachable via neutralization. (Stronger than a
#      non-existent-file target, which would pass either way.)
#   2. Real-path discrimination: level-1 (real echo) has exitCode:0 + captured stdout via the REAL BashMCP,
#      while level-2 (negated) has exitCode:null + empty stdout — proving neutralization bypassed BashMCP
#      even though BashMCP is fully wired up for sibling gates.
#   3. Aggregation: the neutralized gate's success:true|skipped:true counts as passed in
#      allPassed = every(r => r.success || r.skipped) → outcome:'success' (no fix-retry triggered).
#   4. Conservative detector: the real `echo` gates are NOT matched by isNegatedFileExistenceGate (G2.2/G2.3)
#      → they execute normally. Only the negated existence gate is neutralized.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/integration/prp-executor-integration.test.ts` GREEN (new test + all existing).
- [ ] `npx vitest run tests/unit/agents/prp-executor.test.ts tests/unit/agents/gate-semantics.test.ts` GREEN (untouched regression).

### Feature Validation
- [ ] One new `it()` added inside `describe('execute() with real dependencies')`.
- [ ] The test uses the REAL executor + REAL BashMCP; only the agent is mocked.
- [ ] `(a)` asserts `result.success === true` AND `result.outcome === 'success'`.
- [ ] `(b)` the negated gate (`! test -f package.json`, level 2) is neutralized: `skipped:true, success:true,
      exitCode:null`, empty stdout/stderr.
- [ ] `(c)` the real gate (`echo "real gate executed"`, level 1) ran for real: `skipped:false, exitCode:0`,
      `stdout` contains the echo output.

### Code Quality Validation
- [ ] ONLY `tests/integration/prp-executor-integration.test.ts` modified (one new `it()`).
- [ ] No source/config/docs files modified (test-only; the item's "DOCS: none").
- [ ] Follows the file's established patterns (factory, mock-agent, real-executor, find-by-level assertions).
- [ ] Negated gate targets an EXISTING file (package.json) so neutralization is load-bearing.

### Documentation & Deployment
- [ ] No docs change (test-only).
- [ ] Commit message notes: integration test proving G2.1 neutralization through the real BashMCP path;
      load-bearing target (package.json exists → gate would fail without neutralization); real-gate
      discriminator (exitCode:0 vs null); file-disjoint from S1's unit test; behavior already existed (hardening).

---

## Anti-Patterns to Avoid

- ❌ Don't mock `execute_bash` or `BashMCP` in this file — the whole point is to run the REAL path. The
      harness keeps them real (only the agent is mocked). Mocking them would make this test redundant with
      S1's unit test.
- ❌ Don't target a NON-EXISTENT file (`src/hooks/index.ts`) for the negated gate — `! test -f <nonexistent>`
      would PASS if executed, so the test wouldn't prove neutralization matters. Target `package.json`
      (exists) so the gate would FAIL without neutralization.
- ❌ Don't mock the logger here — the real `getLogger('PRPExecutor')` emits the §9.9 info log harmlessly.
      Asserting the log message is S1's unit-test job (different file). Assert the RESULT shape here.
- ❌ Don't assert ONLY `result.outcome` OR ONLY `result.success` — assert BOTH. `ExecutionResult` carries
      both (invariant `success === (outcome === 'success')`); the work item asks for `outcome`, the existing
      tests use `success`. Both is robust.
- ❌ Don't add a negated-CONTENT gate (e.g. `! grep …`) expecting neutralization — those EXECUTE (G2.2). Only
      negated existence (`! test -f`, `test ! -f`, `-f`/`-e`/`-d`) neutralizes. The real gates here are plain
      `echo` commands (never matched) so they execute normally.
- ❌ Don't place the new `it()` in `describe('error handling')` or `describe('ExecutionResult structure')` —
      it belongs in `describe('execute() with real dependencies')` alongside the other real-BashMCP tests.
- ❌ Don't modify `src/agents/prp-executor.ts` or any source file — this is test-only. The L553 neutralization
      already fires; this test only proves it holds end-to-end. (If the test fails because neutralization
      regressed, REPORT it — don't silently weaken the test.)
- ❌ Don't edit `tests/unit/agents/prp-executor.test.ts` — that's S1's file (parallel). S2 is the integration
      file only. Zero overlap.
- ❌ Don't add a `{ timeout: 10000 }` unnecessarily — this is a success-path test (passes first try, no
      fix-retries); the existing success tests omit it. Add it only if CI proves flaky.
- ❌ Don't treat this as a RED→GREEN TDD cycle for new behavior — neutralization already exists; the test
      passes immediately. It's hardening of an existing code path.

---

## Confidence Score

**10/10** — one-pass implementation success likelihood.

Rationale: This is a test-only change (one file, one new `it()`) whose target behavior ALREADY EXISTS in
source (`prp-executor.ts:553` neutralizes the gate with exactly the result shape the test asserts:
`{skipped:true, success:true, exitCode:null, stdout:''}` before `execute_bash`). The integration harness is
already established in the file (real `PRPExecutor` + real `BashMCP`, mocked agent) and every existing test
follows the exact pattern the new test reuses (`createMockPRPDocument(id, gates)` + `find(r => r.level===N)`).
The result interfaces are verified (`ExecutionResult` carries both `success` and `outcome`; `ValidationGateResult`
carries `exitCode`/`skipped`/`stdout`), so the assertions are precise. The one research-driven improvement over
the work item — targeting `package.json` (which EXISTS) instead of the suggested `src/hooks/index.ts` (which does
not) — makes the test prove neutralization is load-bearing (the gate would fail without it). The real-gate
discriminator (level-1 `exitCode:0` + captured stdout vs level-2 `exitCode:null` + empty stdout) is exactly what
distinguishes this integration test from S1's mocked-`execute_bash` unit test. File-disjoint from S1 (different
file, different concern). No external/runtime unknowns — the behavior already fires, the harness is real, and the
gate command is `npx vitest run tests/integration/prp-executor-integration.test.ts`. The only "risk" is a
copy-paste typo or a prettier nit (auto-caught/fixed by the test run + `npm run fix`).