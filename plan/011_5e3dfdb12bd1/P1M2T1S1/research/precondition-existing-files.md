# Research Note — P1.M2.T1.S1: PRECONDITION — detector + tests ALREADY EXIST and PASS

Pure research (read-only). HEAD at authoring time. Supersedes the stale "ABSENT" claim in
`plan/011_5e3dfdb12bd1/research/P1_M2_T1_S1_research.md` (which was accurate at 2026-08-06 but
is no longer current — the files have since been created on the working tree).

## 0. CRITICAL PRECONDITION FINDING — the deliverable already exists and is green

The work-item contract for S1 is: *"An exported `isNegatedFileExistenceGate(command)` with a
green unit-test table."* **Both halves already exist on the working tree and pass:**

| Artifact | Path | State (verified) |
| --- | --- | --- |
| Source | `src/agents/gate-semantics.ts` | EXISTS — exports `isNegatedFileExistenceGate(command: string): boolean`; two anchored regexes (`LEADING_NEGATED_EXISTENCE`, `INNER_NEGATED_EXISTENCE`) + defensive non-string/empty guard. Matches the research-note design verbatim. |
| Test | `tests/unit/agents/gate-semantics.test.ts` | EXISTS — `it.each` table (9 contract rows + extra conservative edge cases) + defensive + whitespace cases. |

Live run (this session):

```
$ npx vitest run tests/unit/agents/gate-semantics.test.ts
 ✓ tests/unit/agents/gate-semantics.test.ts  (14 tests) 3ms
 Test Files  1 passed (1)
      Tests  14 passed (14)
```

- `npx tsc --noEmit -p tsconfig.build.json` → **no errors** mentioning `gate-semantics`.
- `grep -n "isNegatedFileExistenceGate\|gate-semantics" src/agents/prp-executor.ts` → **no matches**
  → the detector is correctly NOT yet wired into the executor (that is **S2 / P1.M2.T1.S2**'s
  job; the S1/S2 boundary is intact).

## 1. Contract coverage check — every contract row is covered by the existing test

The work-item LOGIC table maps 1:1 onto the existing `it.each` table (all verified PASS):

| Contract row (expected) | Existing test row | Passes? |
| --- | --- | --- |
| `! test -f src/hooks/index.ts` → true | ✓ (G2.1) | ✓ |
| `test ! -f x` → true | ✓ (G2.1) | ✓ |
| `! [ -e x ]` → true | ✓ (G2.1) | ✓ |
| `[ ! -d x ]` → true | ✓ (G2.1) | ✓ |
| `! grep -q TODO src/x.ts` → false | ✓ (G2.2) | ✓ |
| `test -f x` → false | ✓ | ✓ |
| `npm test` → false | ✓ | ✓ |
| `grep -q foo x` → false | ✓ | ✓ |
| `test -n foo` → false (ambiguous) | ✓ (G2.3) | ✓ |

Plus the existing test adds EXTRA conservative edge cases (all → false, matching G2.3):
`test -f x -a ! -f y` (compound), `bash -c "! test -f x"` (wrapped), `''`/`'   '` (defensive),
and a whitespace-tolerance case (`'  test ! -d  x  '` → true). The contract is **fully and
correctly satisfied**.

## 2. Why this happened (orchestrator-level note, not actionable for S1)

The session-level research note (`plan/011_5e3dfdb12bd1/research/P1_M2_T1_S1_research.md`) was
authored when `gate-semantics.ts` was absent. A subsequent execution attempt created both files
correctly. The task's `<plan_status>` still shows S1 as "Researching", but the implementation
is in fact complete on the tree. The PRP therefore uses a **Branch A (already complete) /
Branch B (create per spec)** structure so the implementing agent succeeds regardless of which
tree state it lands on.

## 3. The S1/S2 boundary is intact — do NOT cross it

- `isNegatedFileExistenceGate` is exported but **not imported** by `prp-executor.ts` (verified).
- Wiring it into `PRPExecutor.#runValidationGates()` (the neutralization branch that mirrors the
  manual/null skip block at line 528) + the executor integration tests is **P1.M2.T1.S2**.
- S1 = the pure function + its unit-test table ONLY. On the current tree that is **already done**.

## 4. Branch decision for the PRP

- **Branch A (current tree — files present, tests green):** verify the function exists, the test
  passes, the contract table is covered, and the executor is untouched. Record as a
  verified-complete state. No edit required (unless a contract row is missing — it is not).
- **Branch B (fresh/alternate tree — files absent):** create `src/agents/gate-semantics.ts` and
  `tests/unit/agents/gate-semantics.test.ts` verbatim from the PRP's "Implementation Patterns"
  section, then verify.

Both branches share the same verification commands (§Validation Loop of the PRP).