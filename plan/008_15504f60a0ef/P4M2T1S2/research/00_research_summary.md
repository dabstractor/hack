# Research Summary — P4.M2.T1.S2: validate.sh generation + abort-on-failure

## The defect (confirmed)

- `architecture/phase_findings.md §PHASE 4` → "Required Changes": **"`VALIDATION_AGENT` (default `pizr`) +
  `VALIDATION_TIMEOUT` (default 7200s) + abort-on-failure."** and Current Bug Hunt Flow has **no
  validate.sh generation**.
- `src/workflows/prp-pipeline.ts:1424` — `runQACycle()` for `this.mode === 'validate'` does:
  ```ts
  this.logger.info('[PRPPipeline] Validate mode: skipping QA cycle');
  this.#bugsFound = 0;
  this.currentPhase = 'qa_skipped';
  return;                       // <-- SKIPS ALL QA. The bug.
  ```
  So `--mode validate` skips QA entirely. PRD §4.4 step 1 mandates validation GENERATE then RUN a
  custom `validate.sh`. Neither exists.

## The contract (item description) → implementation mapping

| CONTRACT | Requirement | Implementation in this PRP |
|---|---|---|
| (1) RESEARCH NOTE | no validate.sh generation; validate mode skips QA | Confirmed above. New `ValidationWorkflow` generates + pipeline runs `validate.sh`. |
| (2) INPUT | VALIDATION config from P4.M2.T1.S1; watchdog-kill terminal from P3.M2.T2.S2 | S1 exports `getValidationAgent()` + `getValidationTimeoutSeconds()` from `src/config/constants.ts`. P3.M2.T2.S2 exported `isWatchdogKillResult()` (`timedOut===true \|\| exitCode===124`) in `src/utils/retry.ts:317`. |
| (3a) LOGIC | module/workflow that GENERATES validate.sh from PRD + codebase tools (agent first step) | New `ValidationWorkflow` (`src/workflows/validation-workflow.ts`) — reasoning agent (`createQAAgent`) writes `${sessionPath}/validate.sh` via FILE-AS-CONTRACT (mirror `BugHuntWorkflow.generateReport`). New prompt `createValidationPrompt` + `VALIDATION_PROMPT` system constant. |
| (3b) LOGIC | RUN validate.sh on VALIDATION_AGENT under VALIDATION_TIMEOUT (override generic timeout, this call only) | Pipeline runs `bash <abs>/validate.sh` via `BashMCP.execute_bash({ cwd: process.cwd(), timeout: getValidationTimeoutSeconds()*1000 })`. The generic gate timeout is 120000ms (`prp-executor.ts:545`); validation uses VALIDATION_TIMEOUT (7200000ms). |
| (3c) LOGIC | non-zero exit → abort BEFORE cleanup, commit, bug-hunt | `runValidation()` throws on `!success`; called from `run()` BEFORE `runQACycle()` so the throw bypasses `runQACycle`'s swallowing catch and lands in `run()`'s catch → returns failure (no bug-hunt, no `setStatus('completed')`). No git commit happens after validation (per-task commits are in `executeSubtask`; `cleanup()` only saves backlog state — verified, NO commit in `cleanup()`). |
| (3d) LOGIC | watchdog-killed (exit 124) → hard failure, never retried | The thrown error carries `{ timedOut: true }` / `{ exitCode: 124 }` so `isWatchdogKillResult()` (`retry.ts:317`) → `isPermanentError` → never retried by `retryAgentPrompt`. |
| (3e) LOGIC | wire into runQACycle OR a new validation step | New `runValidation()` private method on `PRPPipeline`, invoked from `run()` between `executeBacklog()` (line ~2153) and `runQACycle()` (line ~2158). |
| (4) OUTPUT | validate.sh gen + abort; completes P4.M2.T1 | ✓ |
| (5) DOCS | none (config surface was S1) | No .env.example / CONFIGURATION.md edits (those were S1). |

## Why the validation STEP lives in `run()`, not inside `runQACycle`'s try/catch (CRITICAL GOTCHA)

`runQACycle()` wraps everything in:
```ts
try { ...mode decision... bugHunt... } catch (error) {
  if (isFatalError(error, this.#continueOnError)) throw error;   // re-throws
  // else: SWALLOWS — tracks failure, sets qa_failed, continues
}
```
`isFatalError(error, continueOnError)` (`src/utils/errors.ts:835`) returns **`false` for ALL errors when
`continueOnError === true`** (line 840: `if (continueOnError) return false;`). So if validation threw
INSIDE that try, a `--continue-on-error` run would SWALLOW the abort — directly violating PRD §4.4
("MUST abort"). Therefore `runValidation()` MUST be invoked from `run()` (line ~2157, before
`runQACycle()`), where its throw propagates to `run()`'s catch (`prp-pipeline.ts:~2189`) which does NOT
swallow — it sets `status='failed'` and returns a failure result. This makes the abort unconditional.

Secondary benefit: validation then runs in `validate` mode too (today `validate` mode `return`s from
`runQACycle` immediately, so anything inside `runQACycle` after the early return is dead). Placing it in
`run()` before `runQACycle()` guarantees it executes in ALL modes.

## "Abort before cleanup, commit, bug-hunt" — verified semantics

- **bug-hunt**: lives INSIDE `runQACycle()` (line 1483 `bugHuntWorkflow.run`). If `runValidation()`
  throws in `run()` before `runQACycle()`, bug-hunt is never reached. ✓
- **commit**: grep confirms `smartCommit` is NOT called in `run()`'s QA/post-execution path or in
  `cleanup()`. All git commits happen in `executeSubtask` (per-task pre/post-cleanup commits,
  P3.M1.T3.S2) — those are DONE before the QA phase. So "abort before commit" is satisfied trivially
  (no commit is pending at validation time). ✓
- **cleanup**: `run()`'s `finally` (`prp-pipeline.ts:2241`) always calls `this.cleanup()`. `cleanup()`
  (`:1689`) only SAVES backlog state / stops displays — it is NOT a git commit and does not run
  bug-hunt. So cleanup-state-save running is acceptable; it does not violate the "abort" intent.
  (The PRD "before cleanup" refers to not proceeding to the QA-phase commit/bug-hunt, both of which
  are skipped by the throw.)

## Patterns to mirror (exact files)

1. **FILE-AS-CONTRACT generation** — `src/workflows/bug-hunt-workflow.ts:265-310` (`generateReport`):
   `createQAAgent()` → build prompt with `outputPath` → `retryAgentPrompt(() => qaAgent.prompt(prompt))`
   → agent writes the file → caller reads/uses it. Mirror for `validate.sh` (agent WRITES the script;
   pipeline RUNS it).
2. **BashMCP run + exit-code/watchdog observation** — `src/agents/prp-executor.ts:538-560`
   (`#runValidationGates`): `const result = await this.#bashMCP.execute_bash({ command, cwd:
   process.cwd(), timeout })` then `timedOut: result.timedOut || result.exitCode === 124`. THIS is the
   template for running `validate.sh` with deterministic exit-code + watchdog detection.
3. **BashMCP API** — `src/tools/bash-mcp.ts:323` `execute_bash(input: BashToolInput): Promise<BashToolResult>`
   where `BashToolResult = { success, stdout, stderr, exitCode, error, timedOut, killed }`. Construct
   via `new BashMCP()` (`bash-mcp.ts:294`; prp-executor `:264`).
4. **Watchdog terminal detection** — `src/utils/retry.ts:317` `isWatchdogKillResult(error)`:
   `e.timedOut === true || e.exitCode === 124`. Import for the abort classification.
5. **Prompt generator** — `src/agents/prompts/bug-hunt-prompt.ts:126` `createBugHuntPrompt(prd, tasks,
   outputPath): Prompt<T>` using `createPrompt({ user, system, responseFormat, enableReflection })` +
   the FILE-AS-CONTRACT `fileBanner`. System prompt constant `BUG_HUNT_PROMPT` lives in
   `src/agents/prompts.ts:946`. Mirror: new `createValidationPrompt` + `VALIDATION_PROMPT`.
6. **Prompt index export** — `src/agents/prompts/index.ts` (add `export { createValidationPrompt }`).
7. **Workflow class shape** — `src/workflows/bug-hunt-workflow.ts` (`extends Workflow`, `@Step`
   decorators, public state fields, `correlationLogger`, `run(sessionPath)`). Mirror for
   `ValidationWorkflow`.
8. **Test pattern** — `tests/unit/workflows/bug-hunt-workflow.test.ts`: `vi.mock` agent-factory +
   prompt + session-utils + `node:fs/promises`; cast mocked fns `as any`; mock `agent.prompt`. For
   validation-workflow.test.ts ALSO mock `BashMCP` (`vi.mock('../../../src/tools/bash-mcp.js')`).

## Config seam consumed (from P4.M2.T1.S1 — treat as contract)

```ts
// from src/config/constants.ts (S1 delivers these EXACTLY):
import { getValidationAgent, getValidationTimeoutSeconds } from '../config/constants.js';
getValidationAgent();          // 'pizr' default (reasoning role = createQAAgent)
getValidationTimeoutSeconds(); // 7200 default → *1000 for BashMCP timeout ms
```
Note: `getValidationAgent()` returns the agent IDENTIFIER ('pizr'). In the TS rewrite 'pizr' (reasoning)
is realized by `createQAAgent()` (`agent-factory.ts` `createQAAgent` → `createBaseConfig('qa',
'reasoning')` → balanced tier @ xhigh). The validation workflow uses `createQAAgent()` directly (the
runtime realization of the reasoning persona); `getValidationAgent()` is logged for observability and
to honor a future custom override. No new persona / no agent-factory change.

## Test/validation commands (verified present)

- `npm run validate` = lint + format:check + typecheck + test:run (the canonical gate).
- `npx vitest run tests/unit/workflows/validation-workflow.test.ts` (new) +
  `tests/unit/workflows/prp-pipeline-validation.test.ts` (new, or extend existing prp-pipeline test).
- `npm run test:coverage` — 100% gate (`vitest.config.ts` statements/branches/functions/lines).

## Scope boundaries (do NOT touch)

- `BUG_FINDER_AGENT` default (`glp`→`pizr`) = P4.M2.T2.S1.
- `NO_ISSUES_FOUND.md` marker = P4.M2.T3.S1.
- bugfix full-breakdown / resume = P4.M2.T4.
- S1's constants.ts exports (S1 owns them; S2 only CONSUMES the two getters).
- No CLI flag, no `.env.example`/`CONFIGURATION.md` edit (those were S1's Mode-A ride-along).