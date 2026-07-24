# Research Note 02 — S1/S2 Contract Boundary & Consumer (S2) Handoff

## What S1 produces (this PRP)
A `BashToolResult` that SURFACES the watchdog/timeout state:
```ts
interface BashToolResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
  // NEW (S1):
  timedOut: boolean;   // true iff the watchdog setTimeout fired (Node child.kill path)
  killed: boolean;     // true iff child.kill() was called (SIGTERM or SIGKILL)
}
```
Both fields default to `false` on the spawn-error path and on normal completion. They are
populated from the existing internal locals of the same name inside `executeBashCommand`.

## What S2 (P3.M2.T2.S2) consumes — the contract S1 MUST satisfy
Per architecture/phase_findings.md §PHASE 3 G4 + Retry section:
> "Required: treat exit 124 (watchdog kill) as PERMANENT (not transient). Distinct from
>  LLM-generation timeout (should be retried)."

S2 will modify `src/utils/retry.ts`:
- `run_with_retry` / `run_with_retry_stdin` (the bash equivalents — NOTE: these do NOT yet exist
  in retry.ts; S2 may add them OR adapt the existing `retryMcpTool`). S1's contract is field-level
  regardless of how S2 structures the wrapper.
- S2 needs a DETERMINISTIC, BOOLEAN signal that "this result represents a watchdog kill, do not
  retry." That signal is `result.timedOut === true`.
- S2 ALSO needs to handle the bash-coreutil path: when a PRP validation gate's `validate.sh`
  wraps the command in `timeout SECS cmd`, the shell exits **124**. So `exitCode === 124` is the
  other detection vector. **S1 surfaces `timedOut` for the Node-watchdog path; S2 handles BOTH
  `result.timedOut === true` AND `result.exitCode === 124` as terminal.** S1 does NOT need to
  synthesize exit 124 — it just must not HIDE it (it already passes `exitCode` through unchanged).

## Why S1 does NOT touch prp-executor.ts
`PRPExecutor.#runValidationGates` is a CONSUMER of `BashToolResult`. The work item's OUTPUT
contract says "Consumed by P3.M2.T2.S2" — NOT by prp-executor. S1's scope is strictly the tool
layer: surface the flag. Whether/how prp-executor maps `timedOut` onto `ValidationGateResult`
is a separate concern (prp-executor's `ValidationGateResult` does NOT currently have a timedOut
field; adding one is out of scope for S1 and is NOT required by the work item contract).

If a future task wants `ValidationGateResult.timedOut`, that is a follow-up — NOT S1. S1 keeps
its blast radius to ONE production file (`bash-mcp.ts`).

## The "exit 124" naming nuance (DO NOT over-engineer)
The work item title says "Detect exit 124". But the body (LOGIC 3c) says: *"ensure the timedOut
flag is set when the timeout fires."* The body is authoritative: S1 sets `timedOut` when ITS OWN
watchdog (the `setTimeout` → `child.kill`) fires. The literal "exit 124" is the value the
`timeout` coreutil produces when a PRP's `validate.sh` uses it — that already flows through as
`exitCode: 124` unchanged. S1 does NOT rewrite exit codes. S1 surfaces the flag.

### Decision matrix (what to implement)
| Scenario | `timedOut` | `killed` | `exitCode` | `success` |
|---|---|---|---|---|
| Normal success | false | false | 0 | true |
| Normal failure | false | false | N (≠0) | false |
| Node watchdog fires (SIGTERM→SIGKILL) | **true** | **true** | 137 or 143 | false |
| `timeout` coreutil kills (validate.sh) | false | false | **124** | false |
| Spawn error (ENOENT etc.) | false | false | null | false |

S2 keys on `timedOut === true` (row 3) OR `exitCode === 124` (row 4). Both are terminal.

## Field-naming decision: `timedOut` and `killed` (camelCase)
- Match the EXISTING internal local variable names (`timedOut`, `killed`) → zero rename risk,
  minimal diff, self-documenting.
- camelCase matches the rest of the interface (`exitCode`, `success`).
- `timedOut` is the Node-convention spelling (`child_process` "timed out"). Avoid `timeout`/`timedout`/`isTimedOut`.

## Do we need a separate "watchdogKilled" boolean distinct from `killed`?
No. `killed` already means "we called child.kill()." In this tool the ONLY reason `kill()` is
called is the watchdog timeout. So `killed === true` ⟺ watchdog fired ⟺ `timedOut === true`
in the close handler. They are populated from the same two locals set together. Surfacing BOTH
(per the work item: "Add `timedOut: boolean` and `killed: boolean`") satisfies the contract and
gives S2 a redundant, robust signal. Keep both — the work item explicitly asks for both.