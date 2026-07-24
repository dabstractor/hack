# P3.M2.T6.S2 — Research Summary

## VERDICT (decides the strategy)

**No temp file backs any agent prompt today.** Prompt delivery is 100%
programmatic:

```
Prompt.buildUserMessage() → HarnessRequest.prompt (in-memory string)
  → Pi:     session.prompt(request.prompt)        [groundswell pi-harness.js:245]
  → Claude: sdk.query({prompt}) + streamInput()   [groundswell-code-harness.js:393]
```

→ **S2 is PREVENTIVE INFRASTRUCTURE**, not a TARGETED fix. There is no
file:line to "fix." S2 delivers a module-level cleanup registry + exit/signal
handlers (mirroring `src/core/file-lock.ts`) ready for any future temp-file-
backed prompt, a retry-aware write helper that re-writes on every attempt, a
documented SIGKILL/power-loss limitation, and a regression test that locks in
both the cleanup contract and the "no temp file backs a prompt today"
invariant.

## The canonical template: `src/core/file-lock.ts:347,577-615`

S2 MUST mirror this pattern EXACTLY (module-level, not per-instance):

| Concern | file-lock.ts | line |
|---|---|---|
| module-level registry | `const _heldLockPaths = new Set<string>()` | 347 |
| add on acquire | `_heldLockPaths.add(lockPath)` | 377,415,538 |
| delete on release (finally) | `_heldLockPaths.delete(lockPath)` | 382,430,555 |
| idempotent cleanup iterator | `cleanupHeldLocks()` for-of + `releaseFileLock`/`tryUnlink` (swallows errors) | 577-580 |
| testable signal handler w/ injectable exit | `onLockCleanupSignal(code, mockExit = c => process.exit(c))` | 593-599 |
| named wrappers (coverable, no anon arrow in `process.on`) | `onSIGINTCleanup()`→130, `onSIGTERMCleanup()`→143 | 603-611 |
| registration at module top level | `process.on('exit', cleanupHeldLocks)` / `process.on('SIGINT', onSIGINTCleanup)` / `process.on('SIGTERM', onSIGTERMCleanup)` | 613-615 |
| SIGKILL/OOM best-effort doc | JSDoc: "Does NOT help for SIGKILL/OOM/segfault" | 568 |

### Critical gotchas from the template
1. **Idempotency is load-bearing.** `exit` fires AFTER the signal handler's
   `process.exit()`; so cleanup runs twice (signal → exit). Safe ONLY because
   unlink-missing is a no-op that never throws. S2's temp cleanup MUST be the
   same.
2. **`process.exit` is illegal inside an `exit` handler.** The `exit` handler
   is cleanup-only; signal handlers are the ones that call exit.
3. **No `process.off` for module-level.** file-lock.ts has none. Registered
   once at module load; outlives every run. (Only the per-run pipeline does
   `process.off`.)
4. **`mockExit` default must re-read `process.exit` at call time**
   (`= c => process.exit(c)`), NOT capture a reference — else
   `vi.spyOn(process,'exit')` tests break.
5. **Named wrappers, never inline arrow in `process.on(...)`.** Keeps the
   registration site coverable.

## The test template: `tests/unit/core/file-lock.test.ts:413-471`

Two variants for testing handlers without killing vitest:
- **Variant A (explicit injectable):** `onLockCleanupSignal(130, c => { exitCode = c })`.
- **Variant B (spy):** `vi.spyOn(process, 'exit').mockImplementation(((c?) => { exitCode = c }) as never)`, works because the default param re-resolves `process.exit`.
- `afterEach(() => vi.restoreAllMocks())`.
- NOTE: tests call handlers DIRECTLY; the `process.on(...)` registration sites
  are deliberately untested (single line, no branch). S2 follows the same
  convention.

## The retry path (the "re-write on every attempt" clause)

`src/agents/prp-executor.ts:332-333`:
```ts
const coderAgentResponse = await retryAgentPrompt(
  () => withAgentDeadline(this.#coderAgent.prompt(injectedPrompt)),
  ...
);
```
`retryAgentPrompt` (`src/utils/retry.ts:686`) takes a `() => Promise<T>`
FACTORY and re-invokes it on each retry. **If a temp file backs the prompt,
the factory must (re-)write it on every invocation.** Today the prompt is an
in-memory string, so the clause is satisfied VACUOUSLY. S2 provides a
`writeTempPromptFile(path, content)` helper that ALWAYS (re-)writes +
registers, so any retry loop using it re-writes on every attempt by
construction.

## All temp-file write sites audited (24) — NONE backs a prompt
See scout1 for the full table. Every `writeFile`/`mkdtemp`/`tmpdir` site
writes an output/artifact, state, or a test fixture — never a prompt. The
"no temp file backs a prompt" invariant is real and lockable.

## Sibling-boundary constraints (no overlap)
- **S1** owns `src/agents/prompt-delivery.ts` + `tests/unit/agents/prompt-delivery.test.ts` (argv half of §9.3.3). S2 does NOT touch them.
- **P3.M2.T5.S1** owns `src/core/task-orchestrator.ts`.
- S2 owns a NEW module (mirrors `src/core/file-lock.ts`) + its NEW test. `git diff --name-only` = exactly 2 new files.

## SIGKILL / power-loss limitation (PRD §9.3.3 hard clause)
No signal handler can catch SIGKILL/power-loss/segfault. file-lock.ts relies
on a PID+mtime stale-lock DETECTOR for those cases. For temp files, the
PRD's own retry-resilience note ("re-write on every attempt") is the primary
mitigation (a fresh temp file is written each attempt, so a stale one is
harmless). S2 DOCUMENTS the SIGKILL limitation in code + test (best-effort,
matching the file-lock.ts precedent) and does NOT over-engineer a startup
sweep (out of scope for a 2-point subtask; the re-write-on-every-attempt
helper + the programmatic-delivery invariant make a sweep unnecessary today).