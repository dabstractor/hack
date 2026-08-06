# PRP — P1.M2.T1.S2: Integrate the detector into `PRPExecutor.#runValidationGates` + executor integration tests

> **Subtask** — P1.M2.T1.S2 of PRD §9.9 (Validation Gate Semantics). REQ-G2 runtime layer,
> the executor-integration half. S1 (Complete) shipped the pure detector
> `isNegatedFileExistenceGate` in `src/agents/gate-semantics.ts:37`. **S2 wires it into
> `#runValidationGates`**: after the manual/null skip block, a negated file/directory-existence
> gate is neutralized (skipped + logged, identical result shape to the manual skip) WITHOUT
> calling BashMCP. Negated content / ambiguous gates still execute normally. This is the
> geoform-hack regression fix (§9.9.3 bullet 3) — cached/legacy PRPs with `! test -f X` gates
> no longer hard-fail.

---

## Goal

**Feature Goal**: Wire `isNegatedFileExistenceGate(gate.command)` into
`PRPExecutor.#runValidationGates()` so a non-monotonic negated file/directory-existence gate
(`! test -f X`, `test ! -f X`, `[ ! -d X ]`, `! [ -e X ]`) is **neutralized at runtime** —
pushed as a `skipped:true / success:true / exitCode:null` result (identical shape to the
existing manual/null skip) and `continue`d without invoking BashMCP, with an info log citing §9.9.
Negated content checks (`! grep …`) and ambiguous commands execute normally (G2.2/G2.3 — the
detector already returns `false` for them). No change to the watchdog/terminal-abort logic
(§9.3.2), no schema change, no change to pass/fail aggregation.

**Deliverable**:
1. **`src/agents/prp-executor.ts`** — EDIT: (a) add `import { isNegatedFileExistenceGate } from './gate-semantics.js';`
   (near the other `./` imports ~L22); (b) in `#runValidationGates`, AFTER the manual/null skip
   block (~L542) and BEFORE the `execute_bash` call (~L548), insert the neutralization branch:
   if `isNegatedFileExistenceGate(gate.command)` → log info + push the skipped result (mirror
   manual-skip shape) + `continue`.
2. **`tests/unit/agents/prp-executor.test.ts`** — EDIT (additive): 3 integration tests under
   `describe('execute')` — (a) G2.1 negated-existence neutralized (`! test -f src/hooks/index.ts`
   → skipped, `execute_bash` NOT called for it, run succeeds); (b) G2.2 negated content executes
   (`! grep -q TODO src/x.ts` → `execute_bash` IS called); (c) G2.3 ambiguous executes
   (`test -n foo` → `execute_bash` IS called).

**Success Definition**:
- A PRP with a `! test -f src/hooks/index.ts` gate runs to `outcome:'success'`; that gate's
  `ValidationGateResult` is `{ skipped:true, success:true, exitCode:null, command:'! test -f …' }`;
  and `mockExecuteBash` is NEVER called with that command (the real gates still run).
- A PRP with a `! grep -q TODO src/x.ts` gate calls `mockExecuteBash` with it (executes normally).
- A PRP with an ambiguous `test -n foo` gate calls `mockExecuteBash` with it (executes normally).
- No existing executor test breaks (real commands like `npm run lint` → detector returns `false`
  → unchanged behavior); `prp-executor.ts` stays at 100% coverage (the new TRUE branch is covered
  by test (a); the FALSE branch by every existing gate-execution test).
- `npm run typecheck && npm run lint && npm run format:check` clean; the targeted test file is GREEN.

---

## Why

- **REQ-G2 (PRD §9.9.2) — deterministic neutralization at runtime.** PRPs are cached (§4.2) and
  resumed, so PRPs generated before REQ-G1 ships (or any gate that slips past G1) would keep
  failing on `! test -f X` gates. The executor MUST repair them at execution time so no item is
  hard-failed solely because a file legitimately exists/absents due to another task's completed
  work. S1 provided the detector; **S2 is the call site that makes the repair actually happen.**
- **Fixes the geoform-hack regression (§9.9.3 bullet 3).** geoform-hack `P1.M3.T1.S1` has a cached
  `! test -f src/hooks/index.ts` gate; the barrel legitimately exists from sibling `P1.M3.T1.S3`,
  so the gate fails on the terminal state and the item is stuck. G2.1 neutralization (this subtask)
  unblocks it without PRP regeneration.
- **Mirrors the proven manual-skip shape — zero new semantics.** The neutralization reuses the
  EXACT result shape the manual/null skip already pushes (`skipped:true / success:true /
  exitCode:null`), and the existing aggregation `allPassed = every(r => r.success || r.skipped)`
  already counts skipped gates as passed. So S2 is a pure, conservative relaxation — no aggregation
  change, no schema change, no new branch in `execute()`.
- **Conservative by construction (G2.2/G2.3 inherited from S1).** The detector returns `false` for
  negated content and ambiguous commands, so those still execute and can still FAIL an item. S2
  cannot accidentally suppress a legitimate gate — it only ever skips the unambiguous negated-
  existence forms S1 already validated.
- **Scope discipline.** S2 edits ONLY `prp-executor.ts` (import + branch) + its test file. It does
  NOT touch `gate-semantics.ts` (S1 — read-only import), `models.ts` (no schema change), `prompts.ts`
  (REQ-G1 — P1.M1.*, Complete), the watchdog/abort logic, or any `docs/*.md` (DOCS: none).
- **Out of scope (hard boundary):** the detector itself (S1), REQ-G1 prompt rules (P1.M1.*,
  Complete), the `ValidationGate` schema (no change), Mode-B doc sync (P1.M3.T1.S1), and any change
  to pass/fail aggregation / the fix-and-retry loop / the watchdog terminal-abort path.

---

## What

### User-visible behavior
A cached/legacy PRP containing a `! test -f X` / `test ! -f X` gate no longer hard-fails when `X`
legitimately exists — the gate is neutralized (skipped + logged) and the run proceeds. Negated
content gates and ambiguous gates behave exactly as before (they execute). No CLI surface change.

### Technical requirements (exact contract)

**`src/agents/prp-executor.ts`** — add the import (top, near the other `./` imports; after L22
`import { createCoderAgent } from './agent-factory.js';`):
```ts
import { isNegatedFileExistenceGate } from './gate-semantics.js';
```

**`#runValidationGates`** — insert the neutralization branch AFTER the manual/null skip block
(the `if (gate.manual || gate.command === null) { … continue; }` at ~L528-542) and BEFORE the
`execute_bash` call (~L548). At that point TS has narrowed `gate.command` to `string` (the null
case was handled by the skip block), so the call typechecks with no cast:
```ts
      // G2.1 (PRD §9.9): neutralize non-monotonic negated file/directory-existence gates.
      // File existence is owned by the task graph / is a cleanup step, not a terminal-state
      // assertion, so a `! test -f X` gate can fail spuriously when X legitimately exists from
      // another task's completed work (cached/legacy PRPs). Skip+log rather than hard-fail.
      // (Negated content `! grep …` and ambiguous commands are NOT matched — they execute normally;
      //  the detector is conservative per G2.2/G2.3.) Result shape mirrors the manual/null skip
      //  so the existing `allPassed = every(r => r.success || r.skipped)` aggregation is unchanged.
      if (isNegatedFileExistenceGate(gate.command)) {
        this.#logger.info(
          {
            level: gate.level,
            description: gate.description,
            command: gate.command,
          },
          'non-monotonic negative-existence gate neutralized — file existence is owned by the task graph / is a cleanup step, not a terminal-state assertion (§9.9)'
        );
        results.push({
          level: gate.level,
          description: gate.description,
          success: true,
          command: gate.command,
          stdout: '',
          stderr: '',
          exitCode: null,
          skipped: true,
          timedOut: false,
        });
        continue;
      }
```

**Method signature, the manual/null skip block, the `execute_bash` call, the stop-on-failure
logic, and `execute()`'s aggregation are all UNCHANGED.**

**`tests/unit/agents/prp-executor.test.ts`** — 3 additive `it()` blocks under
`describe('execute')` (see Implementation Tasks for the verbatim bodies). Do NOT mock
`gate-semantics.js` (the real detector classifies the test commands).

### Success Criteria
- [ ] `isNegatedFileExistenceGate` is imported from `'./gate-semantics.js'` and called in `#runValidationGates`.
- [ ] A `! test -f src/hooks/index.ts` gate → result `{skipped:true, success:true, exitCode:null}`;
      `mockExecuteBash` NOT called with that command; run `outcome:'success'`.
- [ ] A `! grep -q TODO src/x.ts` gate → `mockExecuteBash` IS called with it (executes normally).
- [ ] A `test -n foo` gate → `mockExecuteBash` IS called with it (executes normally).
- [ ] No existing executor test breaks; `prp-executor.ts` stays at 100% coverage.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; targeted test file GREEN.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the
exact insertion site (after the manual/null skip block, before `execute_bash`), the verbatim
neutralization branch (with the verbatim log message + the exact result-shape mirror), the
type-narrowing fact (`gate.command` is `string` after the skip block), the import line, the
logger pattern (in-repo precedent at L331), the test-mocking recipe (verbatim from the existing
suite), the 3 verbatim integration tests, and the executable validation commands. See
`research/executor-integration.md` for the per-claim evidence.

### Documentation & References
```yaml
# MUST READ — the authoritative requirement (REQ-G2) + acceptance (§9.9.3)
- docfile: plan/011_5e3dfdb12bd1/prd_snapshot.md
  section: "#### 9.9.2 Requirements > REQ-G2" (G2.1/G2.2/G2.3) and "#### 9.9.3 Acceptance Criteria"
  why: G2.1 (detect+skip negated existence — push skipped:true/success:true, log §9.9, don't call
        BashMCP); G2.2 (negated existence ONLY — content executes); G2.3 (conservative — ambiguous
        executes). The exact neutralization contract + the geoform-hack regression bullet.
  critical: Skipped gates already count as passed (the §9.9.2 text says so) — NO aggregation change.

# MUST READ — exact files, line ranges, the manual-skip shape to mirror, and the S1/S2 boundary
- docfile: plan/011_5e3dfdb12bd1/architecture/implementation-status.md
  section: "B.1 PRPExecutor.#runValidationGates()" and "C. Test surfaces (implicit-TDD)"
  why: Pins the insertion point (after L528 manual/null skip, before L548 execute_bash), the exact
        result shape to mirror, the unchanged aggregation, and the 3 executor integration tests.
  critical: S2 MUST NOT edit gate-semantics.ts (S1), models.ts (no schema change), or prompts.ts (P1.M1.*).

# MUST READ — this subtask's research (the traps + verbatim branch + test recipe)
- docfile: plan/011_5e3dfdb12bd1/P1M2T1S2/research/executor-integration.md
  section: "1. S1 is COMPLETE", "2. insertion site", "3. logger call", "4. no test breaks + coverage",
           "5. test mocking", "6. the 3 integration tests"
  why: Proves the detector exists + is green (S2 imports, doesn't recreate); the type-narrowing fact
        (gate.command is string after the skip block — no cast); the logger.info(obj,msg) precedent
        (L331); why no existing test breaks + coverage stays 100%; the verbatim test-mocking recipe.

# CONTEXT — S1 (the detector S2 consumes) — read the CONTRACT, do NOT edit
- file: plan/011_5e3dfdb12bd1/P1M2T1S1/PRP.md
  why: S1 shipped isNegatedFileExistenceGate(command:string):boolean in src/agents/gate-semantics.ts:37
        (pure, conservative, 14/14 green). S2 imports it; S2 does NOT touch gate-semantics.ts.

# THE FILE TO EDIT + the detector to import
- file: src/agents/prp-executor.ts
  why: EDIT #runValidationGates (~518) — insert the neutralization branch after the manual/null skip
        block (~L542) and before execute_bash (~L548); add the import near L22.
  pattern: "if (gate.manual || gate.command === null) { results.push({…skipped:true, success:true, exitCode:null…}); continue; }  // L528 — the shape to MIRROR"
  critical: After the skip block, TS narrows gate.command to `string` (null excluded) — so
        isNegatedFileExistenceGate(gate.command) typechecks with NO cast. Place the branch THERE.
        Do NOT change the manual/null skip block, execute_bash call, stop-on-failure logic, or execute()
        aggregation (allPassed = every(r => r.success || r.skipped)).

- file: src/agents/gate-semantics.ts
  why: READ-ONLY — provides `export function isNegatedFileExistenceGate(command: string): boolean`
        (line 37). Zero-dependency pure predicate; conservative (G2.3). Import the FUNCTION (value)
        into prp-executor.ts; do NOT edit this file (S1 owns it).
  gotcha: The detector returns false for negated content (`! grep …`) and ambiguous (`test -n foo`) —
        so those fall through to execute_bash unchanged. S2 inherits G2.2/G2.3 from S1 for free.

- file: src/utils/logger.ts
  why: READ-ONLY — confirms the Logger interface has `info(obj, msg?, ...args)` (L91). The exact
        `this.#logger.info({ … }, 'msg')` pattern is already used in prp-executor.ts:331.

# PATTERN FILE — the test file S2 extends (mocking recipe + factory)
- file: tests/unit/agents/prp-executor.test.ts
  why: EDIT (additive). Mocks bash-mcp at top (L36); mockBashMCP = BashMCP as any (L51); in beforeEach
        mockExecuteBash = vi.fn() + mockBashMCP.mockImplementation(() => ({ execute_bash: mockExecuteBash }))
        (L142-145); createMockPRPDocument(taskId) factory (L92). Build custom PRPs by spreading the
        factory + overriding validationGates. Assert execute_bash calls via
        mockExecuteBash.mock.calls.map(([args]: any) => args.command).
  pattern: "const prp: PRPDocument = { ...createMockPRPDocument('P1.M3.T1.S1'), validationGates: [ { level:1, description:'…', command:'! test -f src/hooks/index.ts', manual:false } ] };"
  critical: Do NOT mock gate-semantics.js — the REAL detector must classify the test commands (it's pure;
        no I/O). Mocking it would defeat the integration test's purpose. The existing vi.mock blocks for
        bash-mcp/agent-factory/prompts/retry/checkpoint-manager stay as-is.

# MODEL (read-only — NO schema change)
- file: src/core/models.ts
  why: READ-ONLY — ValidationGate (L1271) already has `manual: boolean` + `command: string | null`.
        The neutralization is a RUNTIME decision in the executor; it does NOT mutate the PRP or schema.
        Do NOT edit this file.

# CONSUMER-ADJACENT (read-only — the aggregation S2 does NOT change)
- file: src/agents/prp-executor.ts (execute, ~L421/L445)
  why: `allPassed = validationResults.every(r => r.success || r.skipped)` already counts skipped gates
        as passed. The neutralized result has success:true && skipped:true → counts as passed. NO change.
```

### Current Codebase tree (relevant slice)
```bash
src/agents/
├── gate-semantics.ts       # READ-ONLY (S1 — isNegatedFileExistenceGate; S2 imports it)
├── prp-executor.ts         # EDIT — #runValidationGates neutralization branch + the import
└── prompts.ts              # UNCHANGED (REQ-G1 — P1.M1.*, Complete)
src/core/
└── models.ts               # READ-ONLY (ValidationGate — NO schema change)
tests/unit/agents/
├── gate-semantics.test.ts  # UNCHANGED (S1's unit test — verify still green)
└── prp-executor.test.ts    # EDIT (additive — 3 integration tests)
```

### Desired Codebase tree with files to be added/edited
```bash
src/agents/prp-executor.ts         # MODIFIED (+1 import, +1 neutralization branch in #runValidationGates)
tests/unit/agents/prp-executor.test.ts  # MODIFIED (+3 integration tests under describe('execute'))
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — place the neutralization branch AFTER the manual/null skip block, BEFORE execute_bash.
//   The skip block is `if (gate.manual || gate.command === null) { … continue; }` (~L528-542). After it,
//   TS narrows gate.command from `string | null` to `string` (null excluded) — so
//   isNegatedFileExistenceGate(gate.command) typechecks with NO cast. Placing it BEFORE the skip block
//   would require a null-guard/cast and would re-check manual gates (wrong).

// CRITICAL — the neutralization result MUST mirror the manual-skip shape EXACTLY: { level, description,
//   success:true, command:gate.command, stdout:'', stderr:'', exitCode:null, skipped:true, timedOut:false }.
//   Identical shape ⇒ the existing `allPassed = every(r => r.success || r.skipped)` aggregation counts it
//   as passed with NO change to execute()'s aggregation logic.

// CRITICAL — DO NOT call execute_bash for a neutralized gate. `continue` immediately after pushing the
//   skipped result. The whole point of G2.1 is to NOT execute the non-monotonic command.

// CRITICAL — DO NOT change the pass/fail aggregation (allPassed at L421/L445), the watchdog/terminal-abort
//   logic (§9.3.2, already correct), the manual/null skip block, or the stop-on-failure break (L568). S2 is
//   a pure additive branch.

// GOTCHA — `this.#logger.info({ level, description, command }, 'msg')` is the exact in-repo pattern
//   (prp-executor.ts:331 uses `this.#logger.info({ prpTaskId }, 'Starting PRP execution')`). Logger.info
//   (obj, msg?) overload confirmed at logger.ts:91. Use `info` (neutralization is intended behavior, not a
//   warning — the contract allows "info/warn"; info matches the L331 precedent).

// GOTCHA — NO existing test breaks: real commands (`npm run lint`, `npm test`, …) → detector returns false
//   → falls through to execute_bash unchanged. The new branch's FALSE side is covered by EVERY existing
//   gate-execution test; the TRUE side is covered by the new G2.1 test. prp-executor.ts stays at 100%.

// GOTCHA — in the executor tests, DO NOT mock gate-semantics.js. The REAL detector must classify the test
//   commands (it's pure; no I/O). The existing vi.mock blocks (bash-mcp/agent-factory/prompts/retry/
//   checkpoint-manager) stay as-is. Build custom PRPs by spreading createMockPRPDocument + overriding
//   validationGates.

// GOTCHA — 100% coverage globally enforced (vitest.config.ts). The new branch's TRUE side MUST be hit
//   (the G2.1 test) or prp-executor.ts coverage drops. The 3 integration tests cover it.

// GOTCHA — bugfix context: the FULL `npm run test:run` may have unrelated pre-existing failures. Gate =
//   typecheck + lint + format:check + the TARGETED prp-executor.test.ts (+ gate-semantics.test.ts regression).
//   Adding 1 branch + 3 tests cannot increase the red count.

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` before validate. The multi-line
//   branch + log call may reflow — let `npm run fix` handle it.

// CRITICAL — DO NOT touch gate-semantics.ts (S1 — read-only import), models.ts (ValidationGate — NO schema
//   change), prompts.ts (REQ-G1 — P1.M1.*, Complete), or any docs/*.md (DOCS: none — §9.9 contract is
//   covered by Mode B in P1.M3.T1.S1).
```

---

## Implementation Blueprint

### Data models and structure
None — no model change. S2 consumes `ValidationGate` (`command: string | null`, `manual: boolean`,
`level`, `description`) and `ValidationGateResult` (the result it pushes). The neutralization is a
runtime decision; the `ValidationGate` schema is untouched. The only "structure" is the import + the
neutralization branch + the 3 tests.

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)
```yaml
Task 1: EDIT tests/unit/agents/prp-executor.test.ts  (RED — add the 3 integration tests FIRST)
  - ADD under describe('execute') (after the existing gate tests, ~L677):
      * it('neutralizes a negated file-existence gate (G2.1): skipped, execute_bash NOT called, run succeeds'):
          const negCmd = '! test -f src/hooks/index.ts';
          const prp: PRPDocument = { ...createMockPRPDocument('P1.M3.T1.S1'), validationGates: [
            { level:1, description:'barrel must NOT exist (legacy gate)', command: negCmd, manual:false },
            { level:2, description:'lint', command:'npm run lint', manual:false } ] };
          mockAgent.prompt.mockResolvedValue(JSON.stringify({ result:'success', message:'done' }));
          mockExecuteBash.mockResolvedValue({ success:true, stdout:'', stderr:'', exitCode:0 });
          const executor = new PRPPipeline... NO — new PRPExecutor(sessionPath);
          const result = await executor.execute(prp, '/tmp/test-session/prps/P1M3T1S1.md');
          expect(result.outcome).toBe('success');
          const negResult = result.validationResults.find(r => r.command === negCmd);
          expect(negResult?.skipped).toBe(true);
          expect(negResult?.success).toBe(true);
          expect(negResult?.exitCode).toBeNull();
          const calledCommands = mockExecuteBash.mock.calls.map(([args]: any) => args.command);
          expect(calledCommands).not.toContain(negCmd);      // G2.1: NOT executed
          expect(calledCommands).toContain('npm run lint');  // the real gate still ran
      * it('executes a negated CONTENT gate normally (G2.2): execute_bash IS called'):
          const contentCmd = '! grep -q TODO src/x.ts';
          const prp: PRPDocument = { ...createMockPRPDocument('P1.M3.T1.S2'), validationGates: [
            { level:1, description:'no TODO markers', command: contentCmd, manual:false } ] };
          mockAgent.prompt.mockResolvedValue(JSON.stringify({ result:'success', message:'done' }));
          mockExecuteBash.mockResolvedValue({ success:true, stdout:'', stderr:'', exitCode:0 });
          await new PRPExecutor(sessionPath).execute(prp, '/tmp/test-session/prps/P1M3T1S2.md');
          const calledCommands = mockExecuteBash.mock.calls.map(([args]: any) => args.command);
          expect(calledCommands).toContain(contentCmd);      // G2.2: IS executed
      * it('executes an ambiguous gate normally (G2.3): execute_bash IS called'):
          const ambCmd = 'test -n foo';
          const prp: PRPDocument = { ...createMockPRPDocument('P1.M3.T1.S3'), validationGates: [
            { level:1, description:'ambiguous', command: ambCmd, manual:false } ] };
          mockAgent.prompt.mockResolvedValue(JSON.stringify({ result:'success', message:'done' }));
          mockExecuteBash.mockResolvedValue({ success:true, stdout:'', stderr:'', exitCode:0 });
          await new PRPExecutor(sessionPath).execute(prp, '/tmp/test-session/prps/P1M3T1S3.md');
          const calledCommands = mockExecuteBash.mock.calls.map(([args]: any) => args.command);
          expect(calledCommands).toContain(ambCmd);          // G2.3: IS executed
  - DO NOT mock gate-semantics.js (the real detector classifies the commands). DO NOT change the existing
        vi.mock blocks or createMockPRPDocument.
  - EXPECTED NOW: test (a) FAILS (no neutralization yet → execute_bash IS called for negCmd → `not.toContain`
        fails; OR the gate "fails" because the file exists and execute_bash returns success:true mock anyway…
        actually with the mock returning success:true the gate would pass but execute_bash WOULD be called →
        `not.toContain(negCmd)` fails). Tests (b)/(c) PASS already (they execute normally today). → RED on (a).

Task 2: EDIT src/agents/prp-executor.ts  (GREEN — the import + the neutralization branch)
  - ADD import near L22: import { isNegatedFileExistenceGate } from './gate-semantics.js';
  - IN #runValidationGates, AFTER the manual/null skip block (~L542) and BEFORE execute_bash (~L548), insert
        the verbatim neutralization branch from "Technical requirements" (if isNegatedFileExistenceGate(...) →
        this.#logger.info({level,description,command}, '<§9.9 reason>') → push the skipped result (mirror
        manual-skip shape) → continue).
  - DO NOT: change the manual/null skip block, execute_bash call, stop-on-failure break, or execute()
        aggregation; touch gate-semantics.ts/models.ts/prompts.ts; cast gate.command (it's narrowed to string).
  - EXPECTED: test (a) turns GREEN (negCmd now neutralized → execute_bash not called for it). (b)/(c) stay
        GREEN (detector returns false → execute_bash called). Existing tests stay GREEN (real commands → false).

Task 3: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/agents/prp-executor.test.ts   # existing + 3 new tests → GREEN.
  - RUN: npx vitest run tests/unit/agents/gate-semantics.test.ts  # S1 regression — MUST stay green.
  - EXPECTED: typecheck/lint/format clean; prp-executor.test.ts green (incl. the 3 new + all existing);
        gate-semantics.test.ts green. If test (a) fails → the branch isn't placed after the skip block, or
        the detector isn't imported. If coverage drops on prp-executor.ts → the TRUE branch isn't hit (test (a)
        must run). If an existing test fails → the branch is too broad (check it's gated on the detector, not
        unconditional).
```

### Implementation Patterns & Key Details
```ts
// ---- src/agents/prp-executor.ts: the import (near L22) ----
import { createCoderAgent } from './agent-factory.js';
import { isNegatedFileExistenceGate } from './gate-semantics.js';   // ← NEW (S1's detector)

// ---- #runValidationGates: the neutralization branch (insert after the manual/null skip, before execute_bash) ----
      // (existing) if (gate.manual || gate.command === null) { results.push({…skipped:true…}); continue; }

      // G2.1 (PRD §9.9): neutralize non-monotonic negated file/directory-existence gates.
      if (isNegatedFileExistenceGate(gate.command)) {
        this.#logger.info(
          { level: gate.level, description: gate.description, command: gate.command },
          'non-monotonic negative-existence gate neutralized — file existence is owned by the task graph / is a cleanup step, not a terminal-state assertion (§9.9)'
        );
        results.push({
          level: gate.level,
          description: gate.description,
          success: true,
          command: gate.command,
          stdout: '',
          stderr: '',
          exitCode: null,
          skipped: true,
          timedOut: false,
        });
        continue;
      }

      // (existing) const result = await this.#bashMCP.execute_bash({ command: gate.command, … });

// ---- tests/unit/agents/prp-executor.test.ts: the G2.1 test (the headline new assertion) ----
it('neutralizes a negated file-existence gate (G2.1): skipped, execute_bash NOT called, run succeeds', async () => {
  const negCmd = '! test -f src/hooks/index.ts';
  const prp: PRPDocument = {
    ...createMockPRPDocument('P1.M3.T1.S1'),
    validationGates: [
      { level: 1, description: 'barrel must NOT exist (legacy gate)', command: negCmd, manual: false },
      { level: 2, description: 'lint', command: 'npm run lint', manual: false },
    ],
  };
  mockAgent.prompt.mockResolvedValue(JSON.stringify({ result: 'success', message: 'done' }));
  mockExecuteBash.mockResolvedValue({ success: true, stdout: '', stderr: '', exitCode: 0 });
  const result = await new PRPExecutor(sessionPath).execute(prp, '/tmp/test-session/prps/P1M3T1S1.md');
  expect(result.outcome).toBe('success');
  const negResult = result.validationResults.find(r => r.command === negCmd);
  expect(negResult?.skipped).toBe(true);
  expect(negResult?.success).toBe(true);
  expect(negResult?.exitCode).toBeNull();
  const calledCommands = mockExecuteBash.mock.calls.map(([args]: any) => args.command);
  expect(calledCommands).not.toContain(negCmd);      // neutralized → NOT executed
  expect(calledCommands).toContain('npm run lint');  // the real gate still ran
});
```

### Integration Points
```yaml
PRP-EXECUTOR.TS (src/agents/prp-executor.ts):
  - +import { isNegatedFileExistenceGate } from './gate-semantics.js' (near L22)
  - #runValidationGates (~518): +neutralization branch after the manual/null skip block (~L542), before execute_bash (~L548)
  - PRESERVE: the manual/null skip block; execute_bash call; stop-on-failure break (L568); execute() aggregation
        (allPassed = every(r => r.success || r.skipped) at L421/L445); the watchdog/terminal-abort logic (§9.3.2).

GATE-SEMANTICS.TS (src/agents/gate-semantics.ts): READ-ONLY — S2 imports isNegatedFileExistenceGate (S1 owns it).

MODELS.TS (src/core/models.ts): READ-ONLY — ValidationGate needs NO schema change (manual + command already exist).

TEST (tests/unit/agents/prp-executor.test.ts):
  - +3 it() blocks under describe('execute') (G2.1 neutralization / G2.2 content executes / G2.3 ambiguous executes).
  - Build custom PRPs via {...createMockPRPDocument(id), validationGates: [...]}. DO NOT mock gate-semantics.js.
  - PRESERVE: the existing vi.mock blocks, mockExecuteBash/mockBashMCP setup, createMockPRPDocument, all existing tests.

DOCS (contract DOCS: none):
  - No docs change. The §9.9 contract is covered by Mode B in P1.M3.T1.S1. The only "doc" is the §9.9 reference
    in the neutralization log message.

DOWNSTREAM / OUT OF SCOPE:
  - REQ-G1 prompt rules (P1.M1.*, Complete) — prevent NEW non-monotonic gates; S2 is the retroactive backstop for cached PRPs.
  - Mode-B doc sync (P1.M3.T1.S1) — README/CONFIGURATION/ARCHITECTURE/PROMPTS.md mirror.
  - The ValidationGate schema (no change) and the fix-and-retry loop (no change).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — the branch + log call may reflow)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean (gate.command is narrowed to string; no cast needed)
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. Likely failure: a type error if the branch is placed BEFORE the skip block (gate.command
#   is then `string | null` → isNegatedFileExistenceGate rejects null) → move it AFTER the skip block.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The directly-affected suite — MUST be GREEN (existing + 3 new integration tests):
npx vitest run tests/unit/agents/prp-executor.test.ts
# S1 regression — the detector is unchanged (S2 only imports it); must stay green:
npx vitest run tests/unit/agents/gate-semantics.test.ts
# Coverage on the touched source file (confirm 100% retained — the new TRUE branch is hit by the G2.1 test):
npx vitest run tests/unit/agents/prp-executor.test.ts --coverage
# Expected: all green. If the G2.1 test fails → the neutralization branch isn't placed after the skip block, or the
#   detector isn't imported. If coverage drops on prp-executor.ts → the TRUE branch isn't hit (the G2.1 test must run).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm the wiring + import landed:
grep -n "isNegatedFileExistenceGate" src/agents/prp-executor.ts   # Expect: 1 import + 1 call = 2 hits.
grep -n "non-monotonic negative-existence gate neutralized" src/agents/prp-executor.ts  # Expect: 1 hit (the log msg).
# Confirm the detector (S1) is UNCHANGED:
grep -n "export function isNegatedFileExistenceGate" src/agents/gate-semantics.ts  # Expect: 1 hit (S1 intact).
# Build emits dist/ cleanly (proves the import + branch compile):
npx tsc -p tsconfig.build.json
# Expected: grep confirms the wiring; build clean; detector intact.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP (execute_bash is mocked). Domain checks (record in commit message):
#   1. G2.1 — a `! test -f X` gate is neutralized (skipped+success, exitCode null), execute_bash NOT called for it,
#      run succeeds. (geoform-hack regression: the cached `! test -f src/hooks/index.ts` gate no longer hard-fails.)
#   2. G2.2 — a negated CONTENT gate (`! grep -q TODO …`) executes normally (can still fail the item).
#   3. G2.3 — an ambiguous gate (`test -n foo`) executes normally.
#   4. Real gates (npm run lint, etc.) are unaffected (detector returns false → unchanged behavior).
#   5. Aggregation is unchanged (skipped+success counts as passed via the existing every(r => r.success || r.skipped)).
#   6. No schema change (ValidationGate already has manual + command); no change to watchdog/abort or fix-retry.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/agents/prp-executor.test.ts` GREEN (existing + 3 new).
- [ ] `npx vitest run tests/unit/agents/gate-semantics.test.ts` GREEN (S1 regression).
- [ ] `src/agents/prp-executor.ts` remains at 100% coverage.

### Feature Validation
- [ ] `isNegatedFileExistenceGate` imported from `'./gate-semantics.js'` and called in `#runValidationGates`.
- [ ] `! test -f src/hooks/index.ts` → `{skipped:true, success:true, exitCode:null}`; execute_bash NOT called for it; run succeeds.
- [ ] `! grep -q TODO src/x.ts` → execute_bash IS called (executes normally).
- [ ] `test -n foo` → execute_bash IS called (executes normally).
- [ ] Neutralization result shape mirrors the manual/null skip exactly.
- [ ] No change to aggregation, the manual/null skip block, execute_bash call, stop-on-failure, or watchdog/abort.

### Code Quality Validation
- [ ] Branch placed AFTER the manual/null skip block (gate.command narrowed to string — no cast).
- [ ] Neutralization logs via `this.#logger.info({level,description,command}, '<§9.9 reason>')` (L331 precedent).
- [ ] Only `src/agents/prp-executor.ts` + `tests/unit/agents/prp-executor.test.ts` modified.
- [ ] `gate-semantics.ts`, `models.ts`, `prompts.ts` UNTOUCHED.

### Documentation & Deployment
- [ ] No docs change (contract DOCS: none — §9.9 is covered by Mode B in P1.M3.T1.S1).
- [ ] Commit message notes: the G2.1 neutralization wiring, the manual-skip-shape mirror, the unchanged aggregation,
      the geoform-hack regression fix, the 3 integration tests, and the S1-detector cross-reference.

---

## Anti-Patterns to Avoid

- ❌ Don't place the neutralization branch BEFORE the manual/null skip block. After the skip block, TS has narrowed
      `gate.command` to `string` (null excluded), so `isNegatedFileExistenceGate(gate.command)` typechecks with no
      cast. Placing it before would require a null-guard and would re-check manual gates (wrong).
- ❌ Don't call `execute_bash` for a neutralized gate. `continue` immediately after pushing the skipped result — the
      whole point of G2.1 is to NOT execute the non-monotonic command.
- ❌ Don't invent a new result shape. Mirror the manual/null skip result EXACTLY (`{level, description, success:true,
      command, stdout:'', stderr:'', exitCode:null, skipped:true, timedOut:false}`). A different shape could break the
      aggregation or downstream consumers.
- ❌ Don't change the pass/fail aggregation (`allPassed = every(r => r.success || r.skipped)`), the watchdog/terminal-
      abort logic (§9.3.2), the stop-on-failure break, or the manual/null skip block. S2 is a pure additive branch.
- ❌ Don't touch `gate-semantics.ts` (S1 — read-only import), `models.ts` (ValidationGate — NO schema change; the
      neutralization is runtime-only), or `prompts.ts` (REQ-G1 — P1.M1.*, Complete).
- ❌ Don't mock `gate-semantics.js` in the executor tests. The REAL detector must classify the test commands (it's
      pure; no I/O). Mocking it would defeat the integration test's purpose.
- ❌ Don't broaden the wiring (e.g. neutralizing all `!`-prefixed commands). The detector is deliberately conservative
      (G2.2/G2.3); S2 inherits that conservatism by calling it as-is. S2 must NOT add its own command-matching logic.
- ❌ Don't run the full `npm run test:run` as the primary gate if it has unrelated pre-existing failures. Gate =
      typecheck + lint + format:check + the targeted prp-executor.test.ts + gate-semantics.test.ts (regression).
- ❌ Don't edit any `docs/*.md` — DOCS is none for this subtask (the §9.9 contract is covered by Mode B in P1.M3.T1.S1).
- ❌ Don't forget the G2.1 test — without it, the new branch's TRUE side is uncovered and prp-executor.ts coverage drops.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: S1 is COMPLETE — the pure, conservative, 14/14-green detector `isNegatedFileExistenceGate` already
exists in `src/agents/gate-semantics.ts:37`. S2 is a focused wiring task: one import + one additive branch in
`#runValidationGates` that mirrors the proven manual-skip result shape (so the unchanged aggregation counts it as
passed). The type-narrowing fact (gate.command is `string` after the skip block → no cast) and the exact logger
pattern (`this.#logger.info({…}, 'msg')`, precedent at L331) are verified in-repo. No existing test breaks (real
commands → detector returns false → unchanged), and coverage stays 100% (TRUE branch covered by the new G2.1 test;
FALSE branch by every existing gate-execution test). The 3 integration tests are specified verbatim with the exact
mocking recipe (mirror the existing suite; do NOT mock gate-semantics). Scope is airtight: S2 edits only
prp-executor.ts + its test; file-disjoint from S1 (gate-semantics.ts), P1.M1.* (prompts), and P1.M3 (docs). Residual
risks: (a) placing the branch before the skip block (typecheck catches it — gate.command is then nullable); (b) a
coverage drop if the G2.1 test is omitted (specified); (c) a prettier reflow (auto-fixed via `npm run fix`). No
runtime/network/LLM unknowns — execute_bash is mocked in tests.