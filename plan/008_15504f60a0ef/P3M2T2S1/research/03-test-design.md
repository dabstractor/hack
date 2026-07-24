# Research Note 03 — Test Design & 100%-Coverage Strategy

## The 100% coverage constraint
`vitest.config.ts` enforces 100% statements/branches/functions/lines on ALL `src/**/*.ts`.
`src/tools/bash-mcp.ts` is in scope. The new fields `timedOut`/`killed` add branches only if we
introduce conditional logic; since we populate them UNCONDITIONALLY from the existing locals, the
only new "branches" are the boolean literals themselves (no branching → no new branch-coverage
burden). The risk is the OBJECT-LITERAL paths that currently OMIT the fields.

## Three resolution sites in executeBashCommand (all must carry the new fields)
1. **`close` handler** (~line 180): builds `result: BashToolResult` then conditionally sets
   `result.error`. → Add `timedOut` and `killed` to the initial object literal. They read the
   in-closure locals directly.
2. **`error` handler** (~line 195, spawn error): resolves an object literal with NO timedOut/killed.
   → Add `timedOut: false, killed: false` (a spawn error is never a watchdog kill).
3. **The synchronous `catch` around `spawn()`** (~line 130): returns
   `{ success:false, stdout:'', stderr:'', exitCode:null, error }`. → Add `timedOut: false, killed: false`.

If ANY of the three literals omits the fields, `BashToolResult` becomes structurally inconsistent
and consumers cannot rely on `result.timedOut` being defined. TypeScript will flag it (the
interface now requires the fields), so this is enforced at compile time — but the TESTS must
assert all three paths return both fields.

## Test additions (extend tests/unit/tools/bash-mcp.test.ts)
The existing `timeout handling` describe block already exercises the watchdog. Extend/add:

### A. Timed-out result surfaces `timedOut: true` and `killed: true`
Reuse the manual-stub pattern from the existing "should handle timeout correctly" test
(non-closing child, real `setTimeout` for the watchdog). Assert on the RESOLVED result:
```ts
expect(result.timedOut).toBe(true);
expect(result.killed).toBe(true);
expect(result.success).toBe(false);
expect(result.exitCode).toBe(143); // or 137 depending on stub
```
The existing tests trigger `close` manually with code 143/137 — extend them to also await the
result and assert the flags. NOTE: several existing timeout tests never inspect the resolved
result's flag fields; ADD assertions to at least one that resolves cleanly.

### B. Normal success surfaces `timedOut: false`, `killed: false`
Extend an existing "successful execution" test (uses `createMockChild({ exitCode: 0 })`):
```ts
expect(result.timedOut).toBe(false);
expect(result.killed).toBe(false);
```

### C. Normal failure (non-zero exit) surfaces `timedOut: false`, `killed: false`
Extend "should return failure for non-zero exit code":
```ts
expect(result.timedOut).toBe(false);
expect(result.killed).toBe(false);
```

### D. Spawn-error path surfaces `timedOut: false`, `killed: false`
Extend "should handle spawn errors (command not found)":
```ts
expect(result.timedOut).toBe(false);
expect(result.killed).toBe(false);
```

### E. Async child `error` event surfaces `timedOut: false`, `killed: false`
Extend "should handle async child process error events":
```ts
expect(result.timedOut).toBe(false);
expect(result.killed).toBe(false);
```

### F. Non-Error spawn throw surfaces `timedOut: false`, `killed: false`
Extend "should handle non-Error objects thrown during spawn":
```ts
expect(result.timedOut).toBe(false);
expect(result.killed).toBe(false);
```

## Why NOT add a dedicated "exit 124" test inside bash-mcp
A literal `exitCode === 124` result is produced by the `timeout` COREUTIL, which bash-mcp never
invokes — bash-mcp uses `child.kill`. Forcing exit 124 through a mock is artificial and would test
the MOCK, not the tool. The `exitCode: 124` detection is S2's concern (in retry.ts, where the
bash `run_with_retry` wrapper sees whatever exit code the shell produced). S1's tests assert the
FLAG surface. The work item LOGIC 3c is satisfied by setting `timedOut` when the Node watchdog
fires (test A).

## Does adding fields break the existing assertions?
No. Every existing assertion keys on specific fields (`result.success`, `result.exitCode`, etc.)
and the new fields are ADDITIVE. No existing `expect(result).toEqual(...)` deep-equality exists
that would now fail (the tests use property-access assertions, not whole-object equality). Verified
by reading the full test file.

## Validation commands (verified to exist in package.json)
- `npm run validate` → lint + format:check + typecheck + test:run (THE canonical gate)
- `npx vitest run tests/unit/tools/bash-mcp.test.ts -v` (single file)
- `npx vitest run --coverage src/tools/bash-mcp.ts` (confirm 100%)
- `npx tsc --noEmit -p tsconfig.json` (catches missing-field-on-literal compile errors)