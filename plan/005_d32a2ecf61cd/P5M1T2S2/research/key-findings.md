# Research Notes — P5.M1.T2.S2 (Extend ExecutionResult to tri-state)

Source files inspected directly (no inference): `src/agents/prp-executor.ts`,
`src/agents/prp-runtime.ts`, `tests/unit/agents/prp-executor.test.ts`,
`tests/unit/agents/prp-runtime.test.ts`, `src/core/task-orchestrator.ts`,
`plan/005_d32a2ecf61cd/architecture/{implementation_notes,delta_impact}.md`,
`package.json`. All findings verified against the live tree.

## 1. The three `ExecutionResult` construction sites in `execute()` (ALL must set `outcome`)

`src/agents/prp-executor.ts`:

| Line | Site | Current | Target `outcome` |
|------|------|---------|------------------|
| ~309 | `if (coderResult.result !== 'success')` collapse | `success:false` (collapses BOTH `error`+`issue`) | **SPLIT**: `issue`→`'issue'` (+issueMessage); `error`→`'fail'` |
| ~392 | final return after validation loop | `success: allPassed` | `allPassed ? 'success' : 'fail'` |
| ~416 | `catch` block | `success:false` | `'fail'` |

Exact current code of the collapse (the ONE branch to rewrite):
```ts
      // If Coder Agent reported error, return failed result
      if (coderResult.result !== 'success') {
        return {
          success: false,
          validationResults: [],
          artifacts: [],
          error: coderResult.message,
          fixAttempts: 0,
        };
      }
```

## 2. Internal `ExecuteResult` already parses the tri-state — DO NOT touch it

`interface ExecuteResult { result: 'error' | 'success' | 'issue'; message: string }`
(line ~147) is produced by `#parseCoderResult()`. It already works. The bug is purely that
line ~309 collapses `issue` into `fail`. Fix = branch on it, don't re-parse.

## 3. `PRPRuntime.executeSubtask` is a pass-through (no behavior change)

- It returns the executor's `result` object **unchanged** on the normal path (only sets
  status Complete/Failed from `result.success`). So if executor returns `outcome:'issue'`,
  runtime already surfaces it — zero code change for the normal path.
- Its own `catch` (executeSubtask) constructs a hardcoded `{ success:false, ... }`. Add
  `outcome:'fail'` there for completeness (additive, no behavior change) — the ONLY runtime edit.
- Runtime STILL sets status `'Failed'` when `success===false` (incl. issue). **The issue→Planned
  reset + re-research is S4 (orchestrator), NOT S2.** S2 only makes the signal available.

## 4. Backward-compat surface (verified)

- `outcome` + `issueMessage` are declared **optional** (`?`) → every existing construction
  site (mock factories, test objects, structural tests) keeps compiling.
- `result.success` semantics unchanged: `success === (outcome === 'success')`.
- Consumers of `result.success` (orchestrator L740,767; runtime L196,205; integration tests)
  keep working. The orchestrator issue-branch (L767 `if (result.success)`) is **S4** — out of scope.
- `prp-template-validation.test.ts` `outcome` hits are PRP-template markdown checkboxes, NOT a
  field collision. Clean slate.

## 5. Test impact (implementation_notes.md §7 — update in SAME subtask, implicit TDD)

- **`tests/unit/agents/prp-executor.test.ts`**:
  - existing "reports error" test (L~280) → add `expect(result.outcome).toBe('fail')`.
  - existing "all gates passing" test (L~196) → add `expect(result.outcome).toBe('success')`.
  - **NEW** test: coder returns `{result:'issue', message}` → assert `success===false`,
    `outcome==='issue'`, `issueMessage===message`, `error===message`.
- **`tests/unit/agents/prp-runtime.test.ts`**:
  - **NEW** test: mockExecutor returns `outcome:'issue'` → runtime passes through
    (`result.outcome==='issue'`), status STILL `'Failed'` (documents S4 boundary).
- **Integration tests** (`coder-agent.test.ts`, `prp-executor-integration.test.ts`,
  `prp-runtime-integration.test.ts`): all assert `result.success` only → stay GREEN, no edits.

## 6. Scope boundaries (do NOT cross)

- `ISSUE_RETRY_MAX` config = **S1** (parallel, `src/config/constants.ts` — zero file overlap).
- `issue_feedback` injection into blueprint prompt = **S3** (`src/agents/prompts.ts`, `prp-generator.ts`).
- Orchestrator issue-branch (reset→Planned, save `issue_feedback.md`, delete PRP, re-research,
  bounded by `getIssueRetryMax()`) = **S4** (`src/core/task-orchestrator.ts` L767).
- `docs/WORKFLOWS.md` issue subsection = **S4** (needs the full flow).
- `task-retry-manager.ts` = different retry dimension (transient infra errors) — do NOT touch.

## 7. Validation gates (verified from package.json)

```
npm run validate      # eslint . --ext .ts && prettier --check ... && tsc --noEmit
npm run test:run      # vitest run
```
Both must be green. JSDoc rule: exported fns/interfaces need `@remarks` (already the file style).
