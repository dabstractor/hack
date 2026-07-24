# Research Note 01 — Current State of bash-mcp.ts

## File under modification
`src/tools/bash-mcp.ts` (single file, ~230 lines). Already read in full.

### `BashToolResult` interface (current — lines ~52-66)
```ts
interface BashToolResult {
  success: boolean;          // exitCode === 0 && !timedOut && !killed
  stdout: string;
  stderr: string;
  exitCode: number | null;   // null only on spawn failure
  error?: string;            // "Command timed out after Nms" | "Command failed with exit code N"
}
```
Exported via `export type { BashToolInput, BashToolResult };` at file bottom.

### `executeBashCommand(input)` — the function we modify (lines ~107-205)
Key structure (paraphrased):
```ts
async function executeBashCommand(input: BashToolInput): Promise<BashToolResult> {
  // ... cwd validation ...
  child = spawn(command, { cwd, stdio: ['ignore','pipe','pipe'], shell: true });

  return new Promise(resolve => {
    let stdout = '', stderr = '';
    let timedOut = false;     // <-- LOCAL STATE already exists!
    let killed = false;       // <-- LOCAL STATE already exists!

    const timeoutId = setTimeout(() => {
      timedOut = true;        // <-- set on timeout
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 2000);
    }, timeout);

    // stdout/stderr 'data' handlers: `if (killed) return;` early-returns

    child.on('close', exitCode => {
      clearTimeout(timeoutId);
      const result: BashToolResult = {
        success: exitCode === 0 && !timedOut && !killed,
        stdout, stderr, exitCode,
      };
      if (timedOut) result.error = `Command timed out after ${timeout}ms`;
      else if (exitCode !== 0) result.error = `Command failed with exit code ${exitCode}`;
      resolve(result);
    });

    child.on('error', error => {   // spawn error path — NO timedOut/killed context
      clearTimeout(timeoutId);
      resolve({ success: false, stdout, stderr, exitCode: null, error: error.message });
    });
  });
}
```

### CRITICAL OBSERVATIONS
1. **The internal `timedOut`/`killed` locals ALREADY EXIST and are correctly set** when the
   watchdog fires. The ONLY gap is that they are NOT surfaced onto the returned `BashToolResult`
   object. The fix is purely additive: add two fields to the interface and populate them in the
   `close`/`error` handlers.
2. The `success` boolean is computed as `exitCode === 0 && !timedOut && !killed` — a timed-out
   command is ALREADY `success: false`. The issue (per architecture/phase_findings.md §PHASE 3
   G4) is that the **CONSUMER** (`PRPExecutor.#runValidationGates`, prp-executor.ts:530) only
   checks `result.success`, so it cannot DISTINGUISH a watchdog kill (exit 124 / signal) from a
   genuine validation failure. S1 surfaces the signal; S2 (the next subtask) will consume it in
   retry.ts to treat exit 124 as permanent/non-retryable.
3. The `close` handler resolves with a result that currently OMITS `timedOut`/`killed`. The
   `error` handler (spawn failure) resolves with an object literal that has NEITHER field — we
   must add both there too (defaulting to `false`, since a spawn failure is not a timeout).

## The watchdog exit-code convention: 124
GNU coreutils `timeout` exits **124** when the command times out
(https://www.gnu.org/software/coreutils/manual/html_node/timeout-invocation.html).
The architecture finding references "exit 124" as the canonical watchdog-kill signal.
HOWEVER: `bash-mcp.ts` does NOT use the `timeout` coreutil — it uses Node's `child.kill('SIGTERM')`
→ `child.kill('SIGKILL')`. So the ACTUAL exit code observed by the `close` handler is the
**shell's translation of the kill signal**:
- SIGTERM → exit 143 (128 + 15)
- SIGKILL → exit 137 (128 + 9)

So the **authoritative signal** that S1 must surface is `timedOut: true` (the internal flag the
watchdog sets), NOT a literal exit-code-124 check. The PRD finding's "exit 124" is shorthand for
"watchdog-killed validation"; the REAL detection is the `timedOut` flag S1 sets. S2 will key off
`result.timedOut` (or, for the Groundswell/bash-equivalent `run_with_retry` that uses the `timeout`
coreutil, the literal exit 124). **S1's job is to surface the flag that S1's own watchdog sets.**

This is important: do NOT introduce a dependency on coreutils `timeout` or a literal `=== 124`
check inside bash-mcp.ts. The `timedOut` flag is the source of truth for THIS tool.

## Consumer surface (read-only — NOT modified by S1)
- `src/agents/prp-executor.ts` `#runValidationGates` (lines 492-560): builds
  `ValidationGateResult` (prp-executor.ts:41-54) from `result` — currently maps only
  `success/stdout/stderr/exitCode`. S1 does NOT touch prp-executor.ts; S2/the downstream
  consumers read `BashToolResult.timedOut`.
- `src/core/checkpoint-manager.ts:53` defines a SEPARATE `ValidationGateResult` (the on-disk
  checkpoint variant) — also out of scope for S1.

## Tests
`tests/unit/tools/bash-mcp.test.ts` exists, mocks `node:child_process` and `node:fs`, and achieves
100% coverage. S1 must ADD tests for the new `timedOut`/`killed` fields (the existing timeout
tests already exercise the watchdog path — extend their assertions) AND maintain 100% coverage.
The mock helper `createMockChild` + manual child-process mocks in the `timeout handling` describe
block are the patterns to follow.