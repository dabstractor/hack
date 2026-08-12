# Research — strengthen `createFixSubtaskFixture` context_scope (BUG-002 §a)

Findings anchoring P1.M2.T1.S1 (bugfix 001, BUG-002). All line numbers verified.

## 1. Root cause (single shared fixture)

`tests/unit/workflows/fix-cycle-workflow.test.ts` line **165**, inside
`createFixSubtaskFixture` (line 155):
```ts
const createFixSubtaskFixture = (id, title = `Fix ${id}`): Subtask => ({
  id, type: 'Subtask', title, status: 'Planned', story_points: 3,
  dependencies: [],
  context_scope: 'fix',   // ← line 165: FAILS ContextScopeSchema
  prd_selectors: [],
});
```
`'fix'` fails `ContextScopeSchema` (`src/core/models.ts:106`). `runStandardBreakdown`
(test-path) → `BacklogSchema.safeParse` rejects it → `#validateAndHealBacklog` runs the
§4.5.1 heal (extra `retryAgentPrompt` schema-nudge calls + `#healContextScopes` +
`writeTasksJSON`, MUTATING each subtask's `context_scope`). That heal drifts the 6 tests'
exact call-count / backlog-equality assertions.

> **Naming note:** the contract title says `createFixSubtask`; the ACTUAL function in the
> test file is `createFixSubtaskFixture` (line 155). The architecture doc §(a) abbreviates
> it. Use the real name `createFixSubtaskFixture`.

## 2. ContextScopeSchema — the exact rule (models.ts:106-140, verified)

```ts
export const ContextScopeSchema = z.string().min(1).superRefine((value, ctx) => {
  const prefix = 'CONTRACT DEFINITION:\n';
  if (!value.startsWith(prefix)) { addIssue('…must start with "CONTRACT DEFINITION:" followed by a newline'); return; }
  const content = value.slice(prefix.length);
  const requiredSections = [
    { pattern: /1\.\s*RESEARCH\sNOTE:/m },
    { pattern: /2\.\s*INPUT:/m },
    { pattern: /3\.\s*LOGIC:/m },
    { pattern: /4\.\s*OUTPUT:/m },
  ];
  // each must match IN ORDER (searchStartIndex tracks ordering)
});
```
- **Prefix is literal** `'CONTRACT DEFINITION:\n'` (colon + newline). `startsWith` — exact.
- **4 ordered section headers** via regex: `1. RESEARCH NOTE:`, `2. INPUT:`, `3. LOGIC:`,
  `4. OUTPUT:` (`\s*` allows any spacing after the digit). Must appear IN ORDER.
- Content after each header is free-form. So a minimal valid value is the prefix + the 4
  headers each followed by any text.

## 3. The replacement value (verified to pass the schema)

The contract's example passes all checks:
```
CONTRACT DEFINITION:\n1. RESEARCH NOTE: bugfix fixture for fix-cycle.\n2. INPUT: TEST_RESULTS.md bug report.\n3. LOGIC: apply the fix described in the bug report.\n4. OUTPUT: patched source file.
```
- starts with `'CONTRACT DEFINITION:\n'` ✓
- `1. RESEARCH NOTE:` ✓ · `2. INPUT:` ✓ · `3. LOGIC:` ✓ · `4. OUTPUT:` ✓ (in order) ✓
- Each header followed by free-form text ✓

In a TS source literal this is a template/string with real newlines (the `\n` in the
contract is a newline character). Use a backtick template literal (matches the codebase's
context_scope style elsewhere, e.g. `models.test.ts`).

## 4. ONE fixture change fixes all 6 (verified call sites)

`grep` confirms `createFixSubtaskFixture` is the SINGLE constructor for all test subtasks,
called at lines 212, 246, 418-419, 563-564, 611-612. The 6 failing tests:
- L389 `creates the architect agent ONCE …` (asserts `retryAgentPrompt` called 1×; heal adds nudges)
- L415 `reads tasks.json back …` (asserts `backlogArg` toEqual(createFixBacklog([s1,s2])); heal mutated it)
- L665 `persists completed fix subtask outcomes …`
- L710 `marks a failed fix subtask Failed …`
- L761 `uses the bugfix-scoped orchestrator …`
- L812 `falls back to the shared orchestrator …`

All build subtasks via `createFixSubtaskFixture` → `createFixBacklog([...])`. After the fix,
the fixture's context_scope passes `BacklogSchema` on first parse → `#validateAndHealBacklog`
does NOT trigger → no extra nudge/writeTasksJSON calls, no mutation → all 6 assertions
realign AS WRITTEN (no assertion weakening).

## 5. Safety — no test asserts on `'fix'` or the heal path

`grep "context_scope\|heal\|validateAndHeal\|healContextScope"` in the test file → the ONLY
hit is line 165 (`context_scope: 'fix'`). No test asserts `context_scope === 'fix'`, and
none assert that the heal ran. So strengthening the fixture to a valid value CANNOT break a
passing test — it only makes the fixture schema-valid (strictly more conformant). The 26
other tests in the file that use the fixture get a valid context_scope (a no-op for them;
they don't assert on its content).

## 6. Scope boundaries

- **S1 = `tests/unit/workflows/fix-cycle-workflow.test.ts` ONLY** (line 165, one string swap).
  Test-only — no source change, no docs (Mode A: none).
- **Do NOT change source.** The implementation (ContextScopeSchema, the heal path) is
  PRD-compliant; only the test fixture is stale. Do NOT weaken any assertion — make the
  fixture conform so the assertions hold as written.
- **File-disjoint from the parallel P1.M1.T1.S1** (`src/workflows/prp-pipeline.ts` —
  #runValidation BUG-001 fix). Zero overlap.
- **Sibling BUG-002 tasks** (protected-files.test.ts = P1.M2.T2.S1; prp-executor-integration
  = P1.M2.T3.S1) edit DIFFERENT test files — sequenced, no overlap. S1 is the fix-cycle slice.
- **Consumed by P1.M2.T4.S1** (full-suite green verification) — S1 contributes 6 of the 8
  BUG-002 fixes to that gate.

## 7. Validation

- `npx vitest run tests/unit/workflows/fix-cycle-workflow.test.ts` → all 32 GREEN (6 FAIL→PASS).
- `npm run typecheck && npm run lint && npm run format:check` → clean (test file excluded from
  tsc.build; eslint + prettier cover it). Run `npm run fix` first if prettier flags the
  multi-line string.
- Do NOT run the full `npx vitest run` as the S1 gate (the other 2 BUG-002 files + BUG-001 are
  sibling/parallel scope). S1's gate = the fix-cycle file green. (P1.M2.T4.S1 owns full-suite green.)