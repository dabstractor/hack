# PRP — P4.M2.T1.S2: validate.sh generation and abort-on-failure

---

## Goal

**Feature Goal**: Implement the **Validation Scripting** stage of PRD §4.4 ("The QA & Bug Hunt Loop",
step 1) that is currently **entirely missing** from the pipeline. `architecture/phase_findings.md
§PHASE 4` documents: *"no validate.sh generation exists. The `--mode validate` path skips QA
entirely."* Confirmed at `src/workflows/prp-pipeline.ts:1424`, where `runQACycle()` for
`this.mode === 'validate'` logs "skipping QA cycle" and `return`s before doing anything.

This subtask builds the missing stage end-to-end:
1. A **`ValidationWorkflow`** (new `src/workflows/validation-workflow.ts`) where the **reasoning agent**
   (`createQAAgent()` — the runtime realization of `VALIDATION_AGENT` default `pizr` per S1) **generates**
   a custom `validate.sh` from the PRD + codebase tools (FILE-AS-CONTRACT, mirroring `BugHuntWorkflow`).
2. The **pipeline RUNS** that `validate.sh` via `BashMCP.execute_bash()` under
   `getValidationTimeoutSeconds()` (S1's getter; default 7200s = 2h), overriding the generic gate
   timeout of 120000ms (`prp-executor.ts:545`) for this call only.
3. **Abort-on-failure** (PRD §4.4 / §9.3.2): a non-zero exit aborts the run **before** bug-hunt;
   a watchdog kill (exit 124 / `timedOut`) is a **hard, never-retried** terminal failure.

**Deliverable** (2 new production modules + 1 modified production module + 1 new prompt module +
1 modified prompts file + 1 modified prompt index + 2 new test files; **no** new dependency, **no**
agent-factory change, **no** model/persona change, **no** CLI flag, **no** `.env.example`/`CONFIGURATION.md`
edit — those were S1's Mode-A ride-along):

1. **`src/agents/prompts/validation-prompt.ts`** (NEW) — `createValidationPrompt(prd, codebasePath,
   outputPath): Prompt<string>` mirroring `createBugHuntPrompt` (`createPrompt` + FILE-AS-CONTRACT
   `fileBanner` instructing the agent to WRITE `validate.sh` to `outputPath`; `responseFormat: z.unknown()`
   since the deliverable is the file, not the chat reply).
2. **`src/agents/prompts.ts`** (MODIFY — ADD 1 const) — `VALIDATION_PROMPT` system-prompt constant
   (placed near `BUG_HUNT_PROMPT` at `:946`; includes `PRD_PREMERGED_DECLARATION`), instructing the
   reasoning agent to author a deterministic, exit-code-driven `validate.sh` from the PRD + discovered
   codebase tooling (lint/typecheck/test/build commands), `set -euo pipefail`, runnable via `bash`.
3. **`src/agents/prompts/index.ts`** (MODIFY — ADD 1 export) — `export { createValidationPrompt } from
   './validation-prompt.js';`.
4. **`src/workflows/validation-workflow.ts`** (NEW) — `ValidationWorkflow extends Workflow`
   (`@Step`-decorated `generateScript()` + `runScript()`; public state: `prdContent`, `codebasePath`,
   `sessionPath`, `outcome: ValidationOutcome | null`). `generateScript()` uses `createQAAgent()` +
   `retryAgentPrompt` + FILE-AS-CONTRACT (agent writes `${sessionPath}/validate.sh`). `runScript()`
   executes `bash <abs>/validate.sh` via a `BashMCP` instance with
   `timeout: getValidationTimeoutSeconds() * 1000`, `cwd: process.cwd()`, and returns a
   `ValidationOutcome { success, exitCode, timedOut, stdout, stderr, scriptPath, durationMs }`.
5. **`src/workflows/prp-pipeline.ts`** (MODIFY — ADD 1 private method + 1 call site + 1 import) —
   `#runValidation()` that constructs `ValidationWorkflow`, calls `.run(sessionPath)`, and on
   `!outcome.success` throws an error carrying `{ timedOut, exitCode }` so `isWatchdogKillResult()`
   classifies watchdog kills as terminal. Invoked from `run()` **between `executeBacklog()` and
   `runQACycle()`** (so the throw bypasses `runQACycle`'s swallowing catch — see "Why the step lives
   in `run()`"). This also fixes the `validate`-mode-skips-QA defect: `runValidation()` now runs in
   **all** modes.
6. **`tests/unit/workflows/validation-workflow.test.ts`** (NEW) — unit tests mirroring
   `bug-hunt-workflow.test.ts` (mock `agent-factory` + `validation-prompt` + `session-utils` +
   `node:fs/promises` **+ `bash-mcp`**). Covers: agent writes script; script run success (exit 0) →
   `success:true`; non-zero exit → `success:false, timedOut:false`; Node-watchdog kill (`timedOut:true`)
   → terminal; `timeout`-coreutil exit 124 → `timedOut:false, exitCode:124`; timeout budget passed =
   `getValidationTimeoutSeconds()*1000`; cwd = `process.cwd()`.
7. **`tests/unit/workflows/prp-pipeline-validation.test.ts`** (NEW) — unit tests for the wiring:
   `#runValidation()` throws on `!success` (mocked `ValidationWorkflow`); the throw propagates through
   `run()` to a failed result (bug-hunt never reached); watchdog-kill throw is terminal
   (`isWatchdogKillResult`-shaped); `validate` mode now invokes validation instead of skipping.

**Success Definition**:
- After all tasks complete, the pipeline **generates** `validate.sh` (reasoning agent writes it to the
  session dir) and **runs** it at the project root under `VALIDATION_TIMEOUT` (default 7200s).
- **Exit 0** → pipeline proceeds to bug-hunt (`runQACycle`) as today.
- **Non-zero exit (not a watchdog kill)** → the run aborts: `run()` returns a failure result, bug-hunt
  is never reached, no `setStatus('completed')`. Logged clearly.
- **Watchdog kill** (`timedOut` from the Node watchdog, OR exit `124` from a `timeout`-coreutil inside
  the script) → hard terminal failure that `isWatchdogKillResult()` (`retry.ts:317`) detects, so it is
  never retried by `retryAgentPrompt`.
- `--mode validate` now **actually validates** (runs `runValidation()`) instead of no-op skipping.
- `npm run validate` GREEN; `npm run test:coverage` ~100% on the new code.
- `git diff --name-only` shows EXACTLY the 7 files above — **no** agent-factory edit, **no**
  constants.ts edit (S1 owns it), **no** `BUG_FINDER_AGENT` change.

---

## User Persona (if applicable)

**Target User**: A pipeline operator running the autonomous PRP pipeline (normal mode) or a validation
pass (`--mode validate`) against a completed session.

**Use Case**: "After the build completes, the pipeline must independently verify the implementation
against the PRD by generating and running a real validation script — and if that script fails, the run
must stop immediately rather than committing/bug-hunting a half-validated build."

**User Journey**: build tasks complete → pipeline invokes `#runValidation()` → `ValidationWorkflow`
reasoning agent authors `validate.sh` from the PRD + the repo's lint/typecheck/test tools → pipeline
runs `bash validate.sh` under `VALIDATION_TIMEOUT` → on success, proceeds to bug-hunt; on failure,
aborts with a clear log line ("Validation failed (exit N) — aborting before bug-hunt"); on watchdog
kill, aborts as a hard terminal failure ("Validation watchdog-killed — never retried").

**Pain Points Addressed**: today there is NO validation stage — a broken build sails straight into
bug-hunt (or, in `validate` mode, does nothing at all). PRD §4.4 step 1's "Abort-on-failure:
Proceeding on a half-validated build is forbidden" is unenforced.

---

## Why

- **PRD compliance**: PRD §4.4 step 1 mandates verbatim: *"An agent generates a custom `validate.sh`
  based on the PRD requirements and codebase tools, then runs it. Validation runs on a dedicated
  `VALIDATION_AGENT` … under its own watchdog budget `VALIDATION_TIMEOUT` … overriding the generic
  agent timeout for this call only."* and *"Abort-on-failure: If validation does not finish (non-zero
  exit), the run MUST abort before cleanup, commit, and bug-hunt … A watchdog-killed validation is a
  hard failure, never retried — see §9.3.2."*
- **Work-item CONTRACT mapping**:
  - **CONTRACT (1) RESEARCH NOTE** — *"no validate.sh generation exists; `--mode validate` skips QA
    entirely"* → confirmed (`prp-pipeline.ts:1424`; `phase_findings.md §PHASE 4`). This item builds it.
  - **CONTRACT (2) INPUT** — *"VALIDATION config from P4.M2.T1.S1; watchdog-kill terminal from
    P3.M2.T2.S2."* → S1 exports `getValidationAgent()` + `getValidationTimeoutSeconds()` from
    `src/config/constants.ts` (CONSUMED here, not redefined). P3.M2.T2.S2 exported
    `isWatchdogKillResult()` (`retry.ts:317`).
  - **CONTRACT (3) LOGIC** — (a) generate `validate.sh` from PRD + codebase tools (agent first step) →
    Tasks 1–4; (b) run it on `VALIDATION_AGENT` under `VALIDATION_TIMEOUT` (override generic timeout,
    this call only) → Task 4 `runScript()`; (c) non-zero exit → abort before cleanup/commit/bug-hunt →
    Task 5 (`#runValidation` throws from `run()`); (d) watchdog-killed (exit 124) → hard failure,
    never retried → Task 4+5 (`timedOut`/`exitCode` carried into the thrown error →
    `isWatchdogKillResult`); (e) wire into runQACycle OR a new validation step → Task 5 (new
    `#runValidation()` called from `run()` before `runQACycle()`).
  - **CONTRACT (4) OUTPUT** — *"validate.sh generation + abort-on-failure. Completes P4.M2.T1."* → ✓.
  - **CONTRACT (5) DOCS** — *"none — no user-facing/config/API surface change beyond P4.M2.T1.S1."* →
    no `.env.example`/`CONFIGURATION.md` edits.
- **No overlap with siblings**: S1 (`P4.M2.T1.S1`) OWNS the two config getters — this PRP only IMPORTS
  them. `BUG_FINDER_AGENT` default `glp`→`pizr` is `P4.M2.T2.S1` (do NOT touch).
  `NO_ISSUES_FOUND.md`, bugfix-breakdown, and adopt-mode are unrelated.

---

## What

A new `ValidationWorkflow` (FILE-AS-CONTRACT generation + BashMCP execution) wired into the pipeline
as a `#runValidation()` step that runs **before** `runQACycle()` and **aborts the run** on a non-zero
`validate.sh` exit (watchdog kills = terminal, never retried). A new `createValidationPrompt` +
`VALIDATION_PROMPT` system constant author the script. Two new unit-test files cover the workflow and
the wiring.

**No** new CLI flag, **no** model/persona change, **no** constants.ts change (S1 owns it), **no**
`.env.example`/`CONFIGURATION.md` edit, **no** `BUG_FINDER_AGENT` change.

### Success Criteria

- [ ] **`src/agents/prompts/validation-prompt.ts`** (NEW) — `createValidationPrompt(prd, codebasePath,
      outputPath)` returns a `Prompt<string>` with a FILE-AS-CONTRACT banner (agent writes `validate.sh`
      to `outputPath`) + the `VALIDATION_PROMPT` system prompt.
- [ ] **`src/agents/prompts.ts`** — ADD `VALIDATION_PROMPT` constant (near `BUG_HUNT_PROMPT` `:946`),
      including `PRD_PREMERGED_DECLARATION`, instructing deterministic `set -euo pipefail` script
      generation from PRD + repo tooling.
- [ ] **`src/agents/prompts/index.ts`** — ADD `export { createValidationPrompt }`.
- [ ] **`src/workflows/validation-workflow.ts`** (NEW) — `ValidationWorkflow extends Workflow` with
      `generateScript()` (`createQAAgent` + FILE-AS-CONTRACT) and `runScript()` (`BashMCP.execute_bash`,
      `timeout = getValidationTimeoutSeconds()*1000`, `cwd = process.cwd()`); returns
      `ValidationOutcome { success, exitCode, timedOut, stdout, stderr, scriptPath, durationMs }`.
- [ ] **`src/workflows/prp-pipeline.ts`** — ADD `#runValidation()` (constructs workflow, runs it, throws
      on `!success` carrying `{timedOut, exitCode}`); ADD the call in `run()` between `executeBacklog()`
      (`:~2153`) and `runQACycle()` (`:~2158`); ADD imports.
- [ ] **`tests/unit/workflows/validation-workflow.test.ts`** (NEW) — full coverage mirroring
      `bug-hunt-workflow.test.ts` (+ `BashMCP` mock).
- [ ] **`tests/unit/workflows/prp-pipeline-validation.test.ts`** (NEW) — abort-on-failure + watchdog
      terminal + validate-mode-runs-validation wiring tests.
- [ ] `npm run validate` GREEN; `npm run test:coverage` ~100% on new code.
- [ ] `git diff --name-only` shows EXACTLY the 7 files above.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed to implement this
successfully?" — YES. This PRP names: the EXACT defect (`prp-pipeline.ts:1424` validate-mode skip); the
EXACT abort seam (`run()` between `:~2153` and `:~2158`, NOT inside `runQACycle`'s swallowing try —
with the `continueOnError` reasoning); the EXACT generation pattern (`BugHuntWorkflow.generateReport`
FILE-AS-CONTRACT); the EXACT execution pattern (`prp-executor.ts:538-560` `#runValidationGates` →
`BashMCP.execute_bash` + `timedOut || exitCode===124`); the EXACT terminal-detection helper
(`isWatchdogKillResult` `retry.ts:317`); the EXACT config seam (S1's two getters); the EXACT prompt
template (`createBugHuntPrompt` + `BUG_HUNT_PROMPT`); the EXACT test template
(`bug-hunt-workflow.test.ts` mocks); and the scope boundary (no S1/constants/agent-factory/BUG_FINDER).

### Why the validation step lives in `run()`, NOT inside `runQACycle()` (CRITICAL — read carefully)

`runQACycle()` (`prp-pipeline.ts:1408`) wraps its body in:
```ts
try { ...mode decision... bugHuntWorkflow.run... } catch (error) {
  if (isFatalError(error, this.#continueOnError)) { throw error; }   // re-throws ONLY when fatal
  // ELSE: SWALLOWS — tracks failure, sets qa_failed, continues
}
```
`isFatalError(error, continueOnError)` (`src/utils/errors.ts:835`) short-circuits at line 840:
```ts
if (continueOnError) { return false; }   // <-- NOTHING is fatal under --continue-on-error
```
So if `#runValidation()` were called INSIDE that try and threw, a `--continue-on-error` run would
**swallow the abort** — directly violating PRD §4.4 ("MUST abort"). Therefore `#runValidation()` is
invoked from `run()` (`prp-pipeline.ts:~2157`, between `executeBacklog()` and `runQACycle()`), where
its throw propagates to `run()`'s catch (`:~2189`) which does **not** swallow — it sets
`status='failed'` and returns a failure result. This makes the abort **unconditional** across all
modes and all flag combinations.

Secondary benefit: `runQACycle()`'s `validate`-mode branch (`:1424`) `return`s immediately, so any
logic placed inside `runQACycle()` after that branch is **dead in `validate` mode**. Placing validation
in `run()` **before** `runQACycle()` guarantees it executes in **every** mode (normal, bug-hunt,
validate), which is exactly the fix for the "`validate` mode skips QA" defect.

### "Abort before cleanup, commit, and bug-hunt" — verified semantics

- **bug-hunt**: lives INSIDE `runQACycle()` (`:1483` `bugHuntWorkflow.run`). If `#runValidation()`
  throws in `run()` before `runQACycle()`, bug-hunt is never reached. ✓
- **commit**: `grep` confirms `smartCommit` is NOT called in `run()`'s post-execution path or in
  `cleanup()`. All git commits happen per-task inside `executeSubtask` (P3.M1.T3.S2 pre/post-cleanup
  commits) and are DONE before the QA phase. So "abort before commit" holds trivially — no commit is
  pending at validation time. ✓
- **cleanup**: `run()`'s `finally` (`:2241`) always calls `this.cleanup()`. `cleanup()` (`:1689`) only
  SAVES backlog state / stops displays — it is NOT a git commit and does not run bug-hunt, so it does
  not violate the abort intent. (The PRD "before cleanup" means: don't proceed to the QA-phase
  commit/bug-hunt, both skipped by the throw. The finally state-save is acceptable and unavoidable.)

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: plan/008_15504f60a0ef/P4M2T1S2/research/00_research_summary.md
  why: THIS PRP's own research summary. Contains the defect confirmation, the CRITICAL abort-seam
        reasoning (continueOnError swallows inside runQACycle), the exact pattern mirrors, the config
        seam from S1, and the scope boundaries. READ FIRST.

- file: plan/008_15504f60a0ef/P4M2T1S1/PRP.md
  section: Goal + "Why no agent-factory change" + Data models (the six constants exports).
  why: S1 is the CONTRACT for the config surface this PRP CONSUMES. S1 exports EXACTLY
        getValidationAgent() (→ 'pizr') and getValidationTimeoutSeconds() (→ 7200) from
        src/config/constants.ts. Import them; DO NOT redefine, DO NOT edit constants.ts.

- file: src/workflows/bug-hunt-workflow.ts
  section: generateReport() (:265-345) — THE FILE-AS-CONTRACT TEMPLATE. createQAAgent() → build prompt
           with outputPath → retryAgentPrompt(() => qaAgent.prompt(prompt)) → agent writes file.
           Also the CLASS SHAPE template (extends Workflow, @Step decorators, public state fields,
           correlationLogger, private sessionPath, run(sessionPath)).
  why: THE WORKFLOW THIS PRP MIRRORS. ValidationWorkflow.generateScript() == this method, with the
        deliverable file = validate.sh instead of bug_hunt_results.json, and responseFormat z.unknown().
  pattern: see "Implementation Blueprint" — full ValidationWorkflow code.
  gotcha: retryAgentPrompt is used for the GENERATION call only (it is a transient-LLM retry loop).
        The validate.sh EXECUTION must NOT go through retryAgentPrompt — it is a deterministic bash
        call observed for exit code (retrying a failing validate.sh would mask the abort). Call
        BashMCP.execute_bash directly.

- file: src/agents/prp-executor.ts
  section: #runValidationGates (:506-580) — THE EXECUTION TEMPLATE. Line 543:
           `const result = await this.#bashMCP.execute_bash({ command: gate.command, cwd:
           process.cwd(), timeout: 120000 });` then line 558
           `timedOut: result.timedOut || result.exitCode === 124`.
  why: THE EXACT PATTERN for running a shell validation command + observing exit code + watchdog.
        ValidationWorkflow.runScript() mirrors this, with `timeout: getValidationTimeoutSeconds()*1000`
        (7200000) instead of the hardcoded 120000, and command `bash <abs>/validate.sh`.
  pattern: see "Implementation Blueprint" — runScript() code.
  gotcha: cwd MUST be process.cwd() (PROJECT ROOT) — same as #runValidationGates. The prior bug where
        gates ran inside the plan/ metadata dir (wrong tree) is called out in a comment at :538-542;
        do not regress it.

- file: src/tools/bash-mcp.ts
  section: BashToolInput (:7-14: {command, cwd?, timeout?}); BashToolResult (:23-55:
           {success, stdout, stderr, exitCode: number|null, error?, timedOut, killed});
           executeBashCommand (:152, sets timedOut=true on Node watchdog fire, SIGTERM→SIGKILL);
           class BashMCP (:277, constructor + execute_bash (:323)).
  why: THE API ValidationWorkflow.runScript() calls. `new BashMCP()` (no args; see prp-executor :264).
        execute_bash is the direct (non-MCP) path. timedOut is true ONLY for the NODE watchdog
        (setTimeout→kill); a `timeout`-coreutil inside the script exits 124 with timedOut:false —
        BOTH are terminal (isWatchdogKillResult checks `timedOut===true || exitCode===124`).

- file: src/utils/retry.ts
  section: isWatchdogKillResult (:295-318) — `e.timedOut === true || e.exitCode === 124`.
  why: THE TERMINAL-DETECTION HELPER. The abort error thrown by #runValidation() on a watchdog kill
        MUST be shaped so this returns true (carry timedOut:true OR exitCode:124), so it is never
        retried by retryAgentPrompt (isTransientError → false before the message-pattern fallback).
  pattern: import { isWatchdogKillResult } from '../utils/retry.js' (used in the pipeline test +
        optionally in runValidation to choose the error message).

- file: src/agents/prompts/bug-hunt-prompt.ts
  section: createBugHuntPrompt (:126-175) — createPrompt({ user: fileBanner + constructUserPrompt,
           system: BUG_HUNT_PROMPT, responseFormat: outputPath?z.unknown():TestResultsSchema,
           enableReflection: true }); the fileBanner (:128-148) FILE-AS-CONTRACT block.
  why: THE PROMPT TEMPLATE. createValidationPrompt mirrors it: fileBanner instructs the agent to WRITE
        validate.sh to outputPath; system = VALIDATION_PROMPT; responseFormat = z.unknown() (the file
        is the contract, the chat reply is a one-line confirmation).
  pattern: see "Implementation Blueprint" — createValidationPrompt code.

- file: src/agents/prompts.ts
  section: BUG_HUNT_PROMPT (:946) + PRD_PREMERGED_DECLARATION (:34) + the PROMPTS map (:1260).
  why: WHERE THE NEW VALIDATION_PROMPT CONSTANT GOES (near :946). It MUST interpolate
        ${PRD_PREMERGED_DECLARATION} (every agent-facing prompt declares the PRD is pre-merged).
  pattern: see "Implementation Blueprint" — VALIDATION_PROMPT constant text.

- file: src/agents/prompts/index.ts
  why: ADD `export { createValidationPrompt } from './validation-prompt.js';` (mirror the existing
        createBugHuntPrompt export line).

- file: src/agents/agent-factory.ts
  section: createQAAgent (:447) → createBaseConfig('qa','reasoning') → balanced tier @ xhigh
           (ROLE_CONFIG.reasoning, :254).
  why: PROVES the reasoning persona (VALIDATION_AGENT default 'pizr') ALREADY EXISTS. ValidationWorkflow
        calls createQAAgent() directly — the runtime realization of the reasoning persona. NO
        agent-factory change, NO new persona. READ-ONLY.

- file: src/config/constants.ts   # S1 DELIVERS — import only, do NOT edit
  section: getValidationAgent() (→ 'pizr'), getValidationTimeoutSeconds() (→ 7200).
  why: THE CONFIG SEAM. `import { getValidationAgent, getValidationTimeoutSeconds } from
        '../config/constants.js'`. getValidationAgent() is logged for observability (+ honors a future
        custom override); the actual agent is createQAAgent() (the 'pizr'/reasoning realization).

- file: src/workflows/prp-pipeline.ts
  section: |
    run() (:~2100-2245): executeBacklog (:~2153) → [INSERT await this.#runValidation() HERE] →
      runQACycle (:~2158). run()'s catch (:~2189) does NOT swallow (returns failure result).
    runQACycle() (:1408): the validate-mode early-return (:1424) is the DEFECT to leave in place for
      bug-hunt skipping — runValidation() in run() handles validation for ALL modes now.
  why: THE FILE THIS PRP MODIFIES (add #runValidation + call site + imports).

- file: tests/unit/workflows/bug-hunt-workflow.test.ts
  section: imports + vi.mock blocks (:15-48); createTestTask factory (:57); the "should call
           createQAAgent" / "should call agent.prompt" / "should propagate errors" describes (:292-551).
  why: THE TEST TEMPLATE. Mirror for validation-workflow.test.ts, ADDITIONALLY mocking
        '../../../src/tools/bash-mcp.js' (vi.mock returns a class with execute_bash: vi.fn()).

- file: PRD.md   # §4.4 step 1 + §9.3.2 — the source of truth
  section: §4.4 step 1 (generate+run validate.sh; VALIDATION_AGENT default pizr; VALIDATION_TIMEOUT
           default 7200; abort-on-failure before cleanup/commit/bug-hunt; watchdog = hard, never
           retried → §9.3.2). Verbatim text in selected_prd_content.
  why: THE REQUIREMENT. Quote it in JSDoc on ValidationWorkflow + #runValidation.
```

### Current Codebase tree (relevant slice)

```bash
src/agents/
  agent-factory.ts          # READ-ONLY — createQAAgent (:447) = reasoning persona (no change).
  prompts.ts                # MODIFY — ADD VALIDATION_PROMPT const (near BUG_HUNT_PROMPT :946).
  prompts/
    index.ts                # MODIFY — ADD export { createValidationPrompt }.
    bug-hunt-prompt.ts      # READ-ONLY — the createBugHuntPrompt TEMPLATE.
    validation-prompt.ts    # NEW — createValidationPrompt(prd, codebasePath, outputPath).
src/config/
  constants.ts              # READ-ONLY (S1 owns) — import getValidationAgent/getValidationTimeoutSeconds.
src/tools/
  bash-mcp.ts               # READ-ONLY — BashMCP.execute_bash + BashToolResult (the run API).
src/utils/
  retry.ts                  # READ-ONLY — isWatchdogKillResult (:317) + retryAgentPrompt.
src/workflows/
  bug-hunt-workflow.ts      # READ-ONLY — the Workflow shape + FILE-AS-CONTRACT TEMPLATE.
  validation-workflow.ts    # NEW — ValidationWorkflow (generateScript + runScript).
  prp-pipeline.ts           # MODIFY — ADD #runValidation() + call in run() + imports.
tests/unit/workflows/
  bug-hunt-workflow.test.ts # READ-ONLY — the test TEMPLATE.
  validation-workflow.test.ts    # NEW — workflow unit tests (+ BashMCP mock).
  prp-pipeline-validation.test.ts# NEW — abort/watchdog/validate-mode wiring tests.
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/agents/prompts/validation-prompt.ts  # NEW
  # createValidationPrompt(prd, codebasePath, outputPath): Prompt<string>
  #   - FILE-AS-CONTRACT fileBanner: agent WRITES validate.sh to outputPath
  #   - system: VALIDATION_PROMPT; responseFormat: z.unknown(); enableReflection: true
src/agents/prompts.ts
  # + VALIDATION_PROMPT const (near BUG_HUNT_PROMPT) — authors deterministic
  #   `set -euo pipefail` validate.sh from PRD + repo tooling; includes PRD_PREMERGED_DECLARATION
src/agents/prompts/index.ts
  # + export { createValidationPrompt } from './validation-prompt.js'
src/workflows/validation-workflow.ts  # NEW
  # ValidationWorkflow extends Workflow
  #   - generateScript(): createQAAgent() + createValidationPrompt + retryAgentPrompt →
  #                       agent writes ${sessionPath}/validate.sh (FILE-AS-CONTRACT)
  #   - runScript(): new BashMCP().execute_bash({ command: `bash <abs>/validate.sh`,
  #                    cwd: process.cwd(), timeout: getValidationTimeoutSeconds()*1000 })
  #                  → returns ValidationOutcome { success, exitCode, timedOut, stdout, stderr,
  #                    scriptPath, durationMs }
  #   - run(sessionPath): generateScript → runScript → set outcome
  #   - logs getValidationAgent() for observability
src/workflows/prp-pipeline.ts
  # + import ValidationWorkflow + getValidationAgent/getValidationTimeoutSeconds (if needed)
  # + #runValidation(): construct ValidationWorkflow(prd, codebasePath=process.cwd());
  #                     outcome = await workflow.run(sessionPath);
  #                     if (!outcome.success) throw abort error carrying {timedOut, exitCode}
  # + in run(): await this.#runValidation();  // between executeBacklog() and runQACycle()
tests/unit/workflows/validation-workflow.test.ts     # NEW
  # generateScript calls createQAAgent + agent.prompt; runScript: exit0→success,
  #   non-zero→!success, Node-watchdog timedOut→terminal, exit124→terminal, timeout budget,
  #   cwd=process.cwd(), error propagation
tests/unit/workflows/prp-pipeline-validation.test.ts # NEW
  # #runValidation throws on !success (mocked workflow); throw propagates via run() to failed result;
  #   watchdog throw is isWatchdogKillResult-shaped; validate mode invokes validation (not skip)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (abort seam — DO NOT place validation inside runQACycle's try): runQACycle()'s catch
//   (prp-pipeline.ts:~1638) calls isFatalError(error, this.#continueOnError), and isFatalError
//   returns false for ALL errors when continueOnError===true (errors.ts:840). A validation abort
//   thrown there would be SWALLOWED under --continue-on-error, violating PRD §4.4 "MUST abort".
//   FIX: invoke #runValidation() from run() BEFORE runQACycle(); its throw lands in run()'s catch
//   (:~2189) which returns a failure result (does NOT swallow).

// CRITICAL (watchdog detection is TWO vectors): a watchdog kill surfaces EITHER as
//   result.timedOut===true (Node watchdog in executeBashCommand, exitCode 137/143) OR as
//   result.exitCode===124 (a `timeout SECS` coreutil inside validate.sh, timedOut:false). BOTH are
//   terminal. Classify with: const watchdog = result.timedOut || result.exitCode === 124; (mirror
//   prp-executor.ts:558) and/or isWatchdogKillResult (retry.ts:317). The thrown abort error MUST
//   carry {timedOut, exitCode} so isWatchdogKillResult(error)===true on the watchdog path (→ never
//   retried by retryAgentPrompt).

// CRITICAL (do NOT retry the validate.sh EXECUTION): wrap ONLY the GENERATION call (agent.prompt)
//   in retryAgentPrompt (transient-LLM retries). The EXECUTION (BashMCP.execute_bash) must be called
//   DIRECTLY — retrying a failing/hanging validate.sh would mask the abort and burn the budget.
//   The abort is the intended outcome of a non-zero exit.

// CRITICAL (timeout is in MILLISECONDS for BashMCP, SECONDS for the config): execute_bash takes
//   timeout in ms. getValidationTimeoutSeconds() returns seconds (7200). Pass
//   `timeout: getValidationTimeoutSeconds() * 1000`. Do NOT pass 7200 raw (that is 7.2 seconds).

// CRITICAL (cwd = project root, NOT the session dir): run validate.sh with cwd: process.cwd()
//   (mirror prp-executor.ts:543). The session dir holds metadata; the implementation under test
//   lives at the project root. (prp-executor :538-542 documents the prior bug of running gates in
//   the wrong tree — do not regress.)

// CRITICAL (validate.sh path is ABSOLUTE): pass `bash ${resolve(sessionPath, 'validate.sh')}` so
//   the script resolves regardless of cwd. The agent WRITES it to the session dir (FILE-AS-CONTRACT
//   outputPath = resolve(sessionPath, 'validate.sh')).

// CRITICAL (the agent GENERATES; the pipeline RUNS): PRD §4.4 says "an agent generates … then runs
//   it", but deterministic abort-on-failure + watchdog-terminal REQUIRE the pipeline to observe the
//   exit code. So: the agent WRITES validate.sh (FILE-AS-CONTRACT); the PIPELINE runs it via BashMCP
//   and inspects exitCode/timedOut. This is the only design that satisfies both the PRD intent and
//   the exit-124/watchdog machinery. Do NOT have the agent run the script itself (no deterministic
//   exit-code observation).

// CRITICAL (S1 owns the config — import, do not edit): getValidationAgent()/getValidationTimeoutSeconds()
//   are delivered by P4.M2.T1.S1 in src/config/constants.ts. This PRP only IMPORTS them. Do NOT edit
//   constants.ts, do NOT add a new getter.

// CRITICAL (no agent-factory change): createQAAgent() (agent-factory.ts:447) IS the reasoning
//   persona (balanced @ xhigh) = the runtime realization of VALIDATION_AGENT default 'pizr'. Do NOT
//   add createValidationAgent(), do NOT add a 'validation' persona/role.

// CRITICAL (do NOT touch BUG_FINDER_AGENT): its stale 'glp' default is P4.M2.T2.S1.

// GOTCHA (100% coverage gate): vitest.config.ts enforces 100% stmt/branch/func/lines. Every branch
//   in runScript (success/non-zero/watchdog) and #runValidation (throw vs proceed) must be exercised.

// GOTCHA (ESM .js imports): intra-project imports use .js extensions in .ts source
//   (e.g. '../tools/bash-mcp.js'). The new files follow this.

// GOTCHA (Groundswell Workflow base): ValidationWorkflow extends Workflow (constructor takes a name
//   string; mirror BugHuntWorkflow). @Step decorators are optional but match convention. Public state
//   fields are observable via the base. Keep generateScript/runScript as plain async methods if @Step
//   decorator wiring is uncertain — functionality is identical.
```

---

## Implementation Blueprint

### Data models and structure

```typescript
// === src/workflows/validation-workflow.ts (NEW) — types ===

/** Outcome of running validate.sh (PRD §4.4 step 1). */
export interface ValidationOutcome {
  /** True iff exitCode === 0 && !timedOut (validation passed). */
  readonly success: boolean;
  /** Exit code of `bash validate.sh` (null only if the process failed to spawn). */
  readonly exitCode: number | null;
  /** True iff a watchdog killed validation — Node watchdog (exitCode 137/143) OR `timeout`
   *  coreutil (exitCode 124). Terminal per PRD §9.3.2 — never retried. */
  readonly timedOut: boolean;
  /** Captured stdout of validate.sh (truncated for logging). */
  readonly stdout: string;
  /** Captured stderr of validate.sh. */
  readonly stderr: string;
  /** Absolute path to the generated validate.sh. */
  readonly scriptPath: string;
  /** Wall-clock duration of the validate.sh run in ms. */
  readonly durationMs: number;
}

/**
 * Error thrown by the pipeline when validation fails (PRD §4.4 "Abort-on-failure").
 *
 * @remarks
 * Carries `timedOut`/`exitCode` so {@link isWatchdogKillResult} (retry.ts) classifies a watchdog
 * kill as terminal (never retried). Non-watchdog failures are plain aborts (run() returns failure).
 */
export class ValidationFailedError extends Error {
  readonly timedOut: boolean;
  readonly exitCode: number | null;
  constructor(outcome: ValidationOutcome) {
    const kind = outcome.timedOut || outcome.exitCode === 124
      ? 'watchdog-killed (terminal, never retried — PRD §9.3.2)'
      : `non-zero exit (exitCode ${outcome.exitCode})`;
    super(
      `Validation failed — ${kind}. Aborting before bug-hunt (PRD §4.4). ` +
      `script=${outcome.scriptPath}`
    );
    this.name = 'ValidationFailedError';
    this.timedOut = outcome.timedOut || outcome.exitCode === 124;
    this.exitCode = outcome.exitCode;
  }
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/agents/prompts/validation-prompt.ts (NEW)
  - IMPLEMENT createValidationPrompt(prd: string, codebasePath: string, outputPath: string):
    Prompt<string> mirroring createBugHuntPrompt (bug-hunt-prompt.ts:126).
  - BUILD the FILE-AS-CONTRACT fileBanner instructing the agent to WRITE a runnable
    `validate.sh` to outputPath (set -euo pipefail; derive lint/typecheck/test/build commands from
    the repo; exit non-zero on any failure; no interactive prompts).
  - CONFIG: createPrompt({ user: fileBanner + userPrompt, system: VALIDATION_PROMPT,
    responseFormat: z.unknown(), enableReflection: true }).
  - FOLLOW pattern: src/agents/prompts/bug-hunt-prompt.ts:126-175 (fileBanner + createPrompt).
  - NAMING: createValidationPrompt (verb-first, matches createBugHuntPrompt).
  - PLACEMENT: src/agents/prompts/validation-prompt.ts.

Task 2: MODIFY src/agents/prompts.ts — ADD the VALIDATION_PROMPT constant
  - ADD `export const VALIDATION_PROMPT` near BUG_HUNT_PROMPT (:946).
  - CONTENT: a system prompt that instructs the reasoning agent to author a DETERMINISTIC
    validate.sh from the PRD requirements + the discovered codebase tooling (package.json scripts,
    tsc/eslint/vitest/ruff/etc.), using `set -euo pipefail`, printing clear PASS/FAIL context, and
    exiting non-zero on the first failure. Include ${PRD_PREMERGED_DECLARATION}.
  - FOLLOW pattern: BUG_HUNT_PROMPT (:946) — template literal, interpolate PRD_PREMERGED_DECLARATION.
  - NAMING: VALIDATION_PROMPT (SCREAMING_SNAKE, matches BUG_HUNT_PROMPT).
  - PLACEMENT: immediately before or after BUG_HUNT_PROMPT.

Task 3: MODIFY src/agents/prompts/index.ts — ADD the export
  - ADD `export { createValidationPrompt } from './validation-prompt.js';` (mirror the
    createBugHuntPrompt export line).

Task 4: CREATE src/workflows/validation-workflow.ts (NEW)
  - IMPLEMENT `class ValidationWorkflow extends Workflow` mirroring BugHuntWorkflow shape
    (constructor(prdContent, codebasePath); public state fields; private sessionPath?;
    correlationLogger; async run(sessionPath)).
  - IMPLEMENT generateScript(): createQAAgent() → createValidationPrompt(prd, codebasePath,
    scriptPath) → retryAgentPrompt(() => agent.prompt(prompt), { agentType:'QA',
    operation:'generateValidationScript' }) → verify validate.sh exists at scriptPath (read it;
    throw if missing/empty). FILE-AS-CONTRACT (mirror BugHuntWorkflow.generateReport :265-345).
  - IMPLEMENT runScript(): record start; `const result = await new BashMCP().execute_bash({
    command: \`bash ${scriptPath}\`, cwd: process.cwd(), timeout:
    getValidationTimeoutSeconds()*1000 })`; compute durationMs; build ValidationOutcome with
    `success: result.exitCode === 0 && !result.timedOut`, `timedOut: result.timedOut ||
    result.exitCode === 124` (mirror prp-executor.ts:558). Log getValidationAgent() + outcome.
  - IMPLEMENT run(sessionPath): set sessionPath; await generateScript(); const outcome =
    await runScript(); set this.outcome; return outcome.
  - FOLLOW pattern: src/workflows/bug-hunt-workflow.ts (class shape + generateReport FILE-AS-CONTRACT)
    + src/agents/prp-executor.ts:538-560 (BashMCP execute + watchdog).
  - IMPORTS: { Workflow [, Step] } from 'groundswell'; { resolve } from 'node:path'; { readFile,
    stat } from 'node:fs/promises'; { createQAAgent } from '../agents/agent-factory.js';
    { createValidationPrompt } from '../agents/prompts/validation-prompt.js'; { retryAgentPrompt }
    from '../utils/retry.js'; { BashMCP } from '../tools/bash-mcp.js'; { getValidationAgent,
    getValidationTimeoutSeconds } from '../config/constants.js'; { getLogger } from '../utils/logger.js'.
  - NAMING: ValidationWorkflow; methods generateScript/runScript/run (verb-first; matches
    BugHuntWorkflow.generateReport/run).
  - PLACEMENT: src/workflows/validation-workflow.ts.

Task 5: MODIFY src/workflows/prp-pipeline.ts — ADD #runValidation() + call site + imports
  - ADD imports: { ValidationWorkflow, ValidationFailedError } from './validation-workflow.js'
    (and getValidationAgent/getValidationTimeoutSeconds if referenced — optional, only if logged
    here; the workflow already logs them).
  - ADD private async #runValidation(): Promise<void>:
      const sessionPath = this.sessionManager.currentSession?.metadata.path;
      if (!sessionPath) throw new Error('[PRPPipeline] No session path for validation');
      const prdContent = this.sessionManager.currentSession?.prdSnapshot ?? '';
      this.logger.info('[PRPPipeline] Validation stage (PRD §4.4) — generating + running validate.sh');
      const workflow = new ValidationWorkflow(prdContent, process.cwd());
      const outcome = await workflow.run(sessionPath);
      this.logger.info('[PRPPipeline] Validation outcome', { success: outcome.success,
        exitCode: outcome.exitCode, timedOut: outcome.timedOut, durationMs: outcome.durationMs });
      if (!outcome.success) { throw new ValidationFailedError(outcome); }   // aborts the run
  - ADD the call in run(): `await this.#runValidation();` BETWEEN `await this.executeBacklog();`
    (:~2153) and `await this.runQACycle();` (:~2158). (Placing it in run() — NOT inside runQACycle's
    try — guarantees the abort propagates even under --continue-on-error; see Context §"abort seam".)
  - LEAVE the runQACycle() validate-mode early-return (:1424) AS-IS for bug-hunt skipping —
    validation for ALL modes now happens in run() before runQACycle().
  - FOLLOW pattern: runQACycle's sessionPath/prdSnapshot access (:1467-1481) + the @Step/async
    method shape used elsewhere in the file.
  - NAMING: #runValidation (private method, matches #runValidationGates naming in prp-executor).
  - PLACEMENT: prp-pipeline.ts (method near runQACycle; call in run()).

Task 6: CREATE tests/unit/workflows/validation-workflow.test.ts (NEW)
  - IMPLEMENT unit tests mirroring tests/unit/workflows/bug-hunt-workflow.test.ts (vi.mock
    agent-factory → createQAAgent; vi.mock validation-prompt → createValidationPrompt; vi.mock
    session-utils if used; vi.mock node:fs/promises for readFile/stat; **ADDITIONALLY**
    vi.mock('../../../src/tools/bash-mcp.js' → class { execute_bash = vi.fn() })).
  - CASES: (a) generateScript calls createQAAgent + agent.prompt with the prompt; (b) generateScript
    throws if validate.sh missing/empty after the agent runs; (c) runScript exit 0 →
    outcome.success===true, timedOut===false; (d) runScript exit 1 (non-zero, not 124) →
    success===false, timedOut===false, exitCode===1; (e) runScript Node-watchdog
    (result.timedOut===true) → success===false, timedOut===true; (f) runScript `timeout`-coreutil
    (exitCode===124, timedOut===false) → success===false, timedOut===true (per outcome contract);
    (g) timeout passed to execute_bash === getValidationTimeoutSeconds()*1000; (h) cwd ===
    process.cwd(); (i) command === `bash <abs>/validate.sh`; (j) error propagation from
    agent.prompt / execute_bash.
  - FOLLOW pattern: tests/unit/workflows/bug-hunt-workflow.test.ts (:15-80 mocks + factories).
  - COVERAGE: every branch (success/non-zero/watchdog/missing-file) — the 100% gate.
  - PLACEMENT: tests/unit/workflows/validation-workflow.test.ts.

Task 7: CREATE tests/unit/workflows/prp-pipeline-validation.test.ts (NEW)
  - IMPLEMENT wiring tests with ValidationWorkflow mocked (vi.mock
    '../../../src/workflows/validation-workflow.js' → { ValidationWorkflow: vi.fn(),
    ValidationFailedError }).
  - CASES: (a) #runValidation() with outcome.success===true → does NOT throw (proceeds);
    (b) outcome.success===false (non-watchdog) → throws ValidationFailedError with timedOut===false,
    exitCode!==124; (c) watchdog outcome (timedOut===true OR exitCode===124) → thrown error has
    timedOut===true → isWatchdogKillResult(thrownError)===true (terminal, never retried); (d) the
    throw from #runValidation propagates through run() to a FAILED result and bug-hunt
    (BugHuntWorkflow.run) is NEVER called (assert the bug-hunt mock is not invoked); (e) 'validate'
    mode invokes #runValidation (i.e. validation is no longer skipped) — assert
    ValidationWorkflow.run was called.
  - FOLLOW pattern: existing prp-pipeline unit tests (tests/unit/workflows/prp-pipeline-*.test.ts)
    for PRPPipeline construction + run() invocation + mock strategy.
  - COVERAGE: throw vs proceed; watchdog terminal; validate-mode runs validation.
  - PLACEMENT: tests/unit/workflows/prp-pipeline-validation.test.ts.
```

### Implementation Patterns & Key Details

```typescript
// === src/workflows/validation-workflow.ts — core methods ===

import { Workflow } from 'groundswell';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createQAAgent } from '../agents/agent-factory.js';
import { createValidationPrompt } from '../agents/prompts/validation-prompt.js';
import { retryAgentPrompt } from '../utils/retry.js';
import { BashMCP } from '../tools/bash-mcp.js';
import { getValidationAgent, getValidationTimeoutSeconds } from '../config/constants.js';
import { getLogger } from '../utils/logger.js';

export class ValidationWorkflow extends Workflow {
  prdContent: string;
  codebasePath: string;
  outcome: ValidationOutcome | null = null;
  private sessionPath?: string;
  private readonly logger = getLogger();

  constructor(prdContent: string, codebasePath: string) {
    super('ValidationWorkflow');
    if (typeof prdContent !== 'string' || prdContent.trim() === '') {
      throw new Error('prdContent must be a non-empty string');
    }
    this.prdContent = prdContent;
    this.codebasePath = codebasePath;
  }

  /** Phase 1: reasoning agent WRITES validate.sh (FILE-AS-CONTRACT). */
  async generateScript(): Promise<string> {
    if (this.sessionPath === undefined) throw new Error('sessionPath required');
    const scriptPath = resolve(this.sessionPath, 'validate.sh');
    this.logger.info(`[ValidationWorkflow] Generating validate.sh (agent=${getValidationAgent()})`);
    const agent = createQAAgent();
    const prompt = createValidationPrompt(this.prdContent, this.codebasePath, scriptPath);
    await retryAgentPrompt(() => agent.prompt(prompt), {
      agentType: 'QA',
      operation: 'generateValidationScript',
    });
    // FILE-AS-CONTRACT: verify the agent wrote a non-empty script.
    const content = await readFile(scriptPath, 'utf8');
    if (content.trim() === '') {
      throw new Error(`VALIDATION_AGENT did not write a non-empty validate.sh at ${scriptPath}`);
    }
    return scriptPath;
  }

  /** Phase 2: pipeline RUNS validate.sh under VALIDATION_TIMEOUT; observes exit code + watchdog. */
  async runScript(scriptPath: string): Promise<ValidationOutcome> {
    const timeoutMs = getValidationTimeoutSeconds() * 1000; // SECONDS→MS (gotcha)
    this.logger.info(
      `[ValidationWorkflow] Running validate.sh (timeout=${timeoutMs}ms, cwd=${process.cwd()})`
    );
    const start = Date.now();
    const bashMCP = new BashMCP();
    const result = await bashMCP.execute_bash({
      command: `bash ${scriptPath}`,
      cwd: process.cwd(), // PROJECT ROOT (gotcha — mirror prp-executor.ts:543)
      timeout: timeoutMs,
    });
    const durationMs = Date.now() - start;
    const timedOut = result.timedOut || result.exitCode === 124; // TWO vectors (gotcha)
    const outcome: ValidationOutcome = {
      success: result.exitCode === 0 && !timedOut,
      exitCode: result.exitCode,
      timedOut,
      stdout: result.stdout,
      stderr: result.stderr,
      scriptPath,
      durationMs,
    };
    this.outcome = outcome;
    return outcome;
  }

  async run(sessionPath: string): Promise<ValidationOutcome> {
    this.sessionPath = sessionPath;
    const scriptPath = await this.generateScript();
    return this.runScript(scriptPath);
  }
}

// === src/workflows/prp-pipeline.ts — the abort seam ===

private async #runValidation(): Promise<void> {
  const sessionPath = this.sessionManager.currentSession?.metadata.path;
  if (!sessionPath) {
    throw new Error('[PRPPipeline] No session path available for validation');
  }
  const prdContent = this.sessionManager.currentSession?.prdSnapshot ?? '';
  this.logger.info(
    '[PRPPipeline] Validation stage (PRD §4.4) — generate + run validate.sh'
  );
  const workflow = new ValidationWorkflow(prdContent, process.cwd());
  const outcome = await workflow.run(sessionPath);
  this.logger.info('[PRPPipeline] Validation outcome', {
    success: outcome.success,
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
    durationMs: outcome.durationMs,
  });
  // PRD §4.4 Abort-on-failure: non-zero exit aborts BEFORE bug-hunt. Watchdog kills
  // are terminal (ValidationFailedError carries timedOut/exitCode → isWatchdogKillResult).
  if (!outcome.success) {
    throw new ValidationFailedError(outcome);
  }
}

// in run(): between `await this.executeBacklog();` and `await this.runQACycle();`
//   await this.#runValidation();   // <-- aborts the run on validation failure (all modes)
```

```typescript
// === src/agents/prompts/validation-prompt.ts — FILE-AS-CONTRACT prompt (mirrors bug-hunt-prompt) ===
import { createPrompt, type Prompt } from 'groundswell';
import { z } from 'zod';
import { VALIDATION_PROMPT } from '../prompts.js';

export function createValidationPrompt(
  prd: string,
  codebasePath: string,
  outputPath: string
): Prompt<string> {
  const fileBanner = `## ⚠️ DELIVERABLE — READ FIRST (overrides any conflicting instruction below)

Your FINAL deliverable is an EXECUTABLE shell script written to this file:

    ${outputPath}

The script (validate.sh) MUST:
- Begin with \`#!/usr/bin/env bash\` and \`set -euo pipefail\`.
- Derive concrete validation commands from the PRD requirements below AND the codebase tools
  discovered at ${codebasePath} (read package.json scripts, tsconfig, the test runner, linters,
  type-checkers, build tools).
- Run every applicable gate (lint, typecheck, unit tests, build, plus any PRD-specified checks).
- Print a clear context line before each gate and capture failures.
- EXIT NON-ZERO on the first failing gate (so \`set -e\` propagates it). Exit 0 only if ALL pass.
- Be non-interactive (no prompts, no TTY assumptions).

Write ONLY the script to that file (no markdown fence). After writing, return a one-line
confirmation like "validate.sh written to <path>". The script in the file is the ONLY thing the
system runs.

---

`;
  return createPrompt({
    user: fileBanner + `## PRD (pre-merged)\n\n${prd}\n`,
    system: VALIDATION_PROMPT,
    responseFormat: z.unknown(), // file is the contract; chat reply is a one-line confirmation
    enableReflection: true,
  }) as Prompt<string>;
}
```

```typescript
// === src/agents/prompts.ts — the VALIDATION_PROMPT constant (add near BUG_HUNT_PROMPT :946) ===
export const VALIDATION_PROMPT = `
You are the VALIDATION_AGENT (a reasoning-tier agent; PRD §4.4, §9.2.3). Your single job is to
author a deterministic, exit-code-driven \`validate.sh\` that proves the implementation satisfies the
PRD. You do NOT run the script yourself — the pipeline runs it and inspects the exit code.

Authoring rules:
1. READ the repo at the project root to discover the REAL toolchain (package.json "scripts",
   tsconfig.json, the test runner, eslint, the build command, any ruff/mypy/pytest if Python is
   present). Do not invent commands that do not exist.
2. Map each PRD requirement to one or more concrete checks. Prefer existing project gates
   (\`npm run lint\`, \`npm run typecheck\`, \`npm test\`, \`npm run build\`) over ad-hoc commands.
3. Make the script deterministic and non-interactive: \`#!/usr/bin/env bash\`, \`set -euo pipefail\`,
   no TTY, no network calls unless the PRD requires them.
4. Fail FAST: \`set -e\` means the first failing gate exits non-zero. The pipeline treats ANY non-zero
   exit as an abort (PRD §4.4). A watchdog kill (exit 124 / timedOut) is a HARD, never-retried
   failure (PRD §9.3.2) — so do not wrap the whole script in an unbounded \`timeout\`; let the
   pipeline's VALIDATION_TIMEOUT govern the budget.
5. Print a one-line context header before each gate and include the command, so failures are
   diagnosable from stdout/stderr.

${PRD_PREMERGED_DECLARATION}
`;
```

### Integration Points

```yaml
PIPELINE (prp-pipeline.ts):
  - ADD: private async #runValidation(): Promise<void>  (constructs + runs ValidationWorkflow;
    throws ValidationFailedError on !success).
  - ADD call site in run(): `await this.#runValidation();` between executeBacklog() and runQACycle().
  - ADD imports: { ValidationWorkflow, ValidationFailedError } from './validation-workflow.js'.

WORKFLOW (validation-workflow.ts — NEW):
  - CONSUMES: createQAAgent (agent-factory); createValidationPrompt (prompts/validation-prompt);
    retryAgentPrompt (utils/retry); BashMCP (tools/bash-mcp); getValidationAgent +
    getValidationTimeoutSeconds (config/constants — from S1).

PROMPTS:
  - NEW src/agents/prompts/validation-prompt.ts (createValidationPrompt).
  - MODIFY src/agents/prompts.ts (add VALIDATION_PROMPT const).
  - MODIFY src/agents/prompts/index.ts (add export).

NO DATABASE / NO ROUTES / NO CLI FLAG / NO MODEL / NO PERSONA / NO constants.ts CHANGE / NO
  .env.example OR CONFIGURATION.md CHANGE (those were S1). NO BUG_FINDER_AGENT CHANGE.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after creating/editing each file — fix before proceeding
npm run lint            # eslint . --ext .ts  (expected: zero errors)
npm run format:check    # prettier --check    (run `npm run format` to fix)
npm run typecheck       # tsc --noEmit -p tsconfig.build.json (expected: zero errors)

# Canonical CI gate
npm run validate        # = lint && format:check && typecheck && test:run

# Expected: Zero errors. READ the output and fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
# New workflow unit tests
npx vitest run tests/unit/workflows/validation-workflow.test.ts

# New wiring unit tests
npx vitest run tests/unit/workflows/prp-pipeline-validation.test.ts

# Affected prompt tests (if a validation-prompt test is added)
npx vitest run tests/unit/agents/prompts/

# Full suite (regression — ensure runQACycle/run() changes did not break existing QA flow)
npx vitest run tests/unit/workflows/

# Coverage gate (100% stmt/branch/func/lines)
npm run test:coverage

# Expected: All pass; ~100% on validation-workflow.ts + the new #runValidation branches.
```

### Level 3: Integration Testing (System Validation)

```bash
# Consumer-seam dry run: verify S1's getters import cleanly into the new workflow.
node --input-type=module -e "
import('./src/config/constants.js').then(m => {
  console.log('VALIDATION_TIMEOUT seconds =', m.getValidationTimeoutSeconds());
  console.log('VALIDATION_AGENT =', m.getValidationAgent());
});
" 2>/dev/null || npx tsc --noEmit -p tsconfig.build.json && echo "typecheck OK"

# Static guarantee: BashMCP + isWatchdogKillResult + createQAAgent import paths resolve.
npx tsc --noEmit -p tsconfig.build.json && echo "imports resolve"

# Manual end-to-end (optional, against a fixture session): set a SHORT VALIDATION_TIMEOUT and a
# deliberately-failing validate.sh to observe the abort, then a passing one to observe proceed.
# VALIDATION_TIMEOUT=5 npm run dev -- <fixture>   # expect: ValidationFailedError, run() failure
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Abort semantics verification (unit): assert the watchdog-thrown error is terminal.
npx vitest run tests/unit/workflows/prp-pipeline-validation.test.ts -t "watchdog"

# Scope-boundary check: confirm NO unintended files changed.
git diff --name-only
# Expected EXACTLY: src/agents/prompts/validation-prompt.ts (NEW),
#   src/agents/prompts.ts, src/agents/prompts/index.ts,
#   src/workflows/validation-workflow.ts (NEW), src/workflows/prp-pipeline.ts,
#   tests/unit/workflows/validation-workflow.test.ts (NEW),
#   tests/unit/workflows/prp-pipeline-validation.test.ts (NEW).

# Untouched-surface checks (must show NO change):
git diff src/config/constants.ts | head && echo "constants.ts untouched (S1 owns it)"
git diff src/agents/agent-factory.ts | head && echo "agent-factory untouched"
git diff .env.example docs/CONFIGURATION.md | head && echo "docs untouched (S1 owned the ride-along)"
git diff docs/CONFIGURATION.md | grep -i "BUG_FINDER_AGENT" || echo "BUG_FINDER_AGENT untouched"
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] `npm run test:coverage` ~100% on new code (every branch: success/non-zero/watchdog/missing-file;
      throw vs proceed).
- [ ] `git diff --name-only` shows EXACTLY the 7 files (no constants.ts, no agent-factory, no docs).

### Feature Validation

- [ ] After build, the pipeline generates `validate.sh` (agent writes it to the session dir) and runs
      it at the project root under `VALIDATION_TIMEOUT` (default 7200s).
- [ ] **Exit 0** → proceeds to bug-hunt (`runQACycle`) as before.
- [ ] **Non-zero exit (not watchdog)** → run aborts: `run()` returns failure; bug-hunt never reached;
      clear log line.
- [ ] **Watchdog kill** (`timedOut` OR exit `124`) → terminal failure; `isWatchdogKillResult(thrown)`
      === true; never retried by `retryAgentPrompt`.
- [ ] `--mode validate` now RUNS validation (no longer a no-op skip).
- [ ] `--continue-on-error` does NOT swallow a validation abort (validation throws from `run()`, not
      from inside `runQACycle`'s try).

### Code Quality Validation

- [ ] `ValidationWorkflow` mirrors `BugHuntWorkflow` (extends Workflow, FILE-AS-CONTRACT generation,
      correlationLogger, public state).
- [ ] `runScript` mirrors `prp-executor.ts #runValidationGates` (`BashMCP.execute_bash`, cwd
      `process.cwd()`, `timedOut || exitCode === 124`).
- [ ] `createValidationPrompt` mirrors `createBugHuntPrompt` (fileBanner + createPrompt +
      `responseFormat: z.unknown()`).
- [ ] `VALIDATION_PROMPT` includes `PRD_PREMERGED_DECLARATION` (every agent-facing prompt does).
- [ ] Timeout passed to `execute_bash` is `getValidationTimeoutSeconds() * 1000` (ms), NOT raw seconds.
- [ ] The GENERATION call uses `retryAgentPrompt`; the EXECUTION call does NOT (no masking the abort).
- [ ] The abort error carries `{timedOut, exitCode}` for terminal classification.

### Documentation & Deployment

- [ ] No `.env.example` / `CONFIGURATION.md` edits (S1 owned the Mode-A ride-along).
- [ ] JSDoc on `ValidationWorkflow`, `ValidationOutcome`, `ValidationFailedError`, and `#runValidation`
      cites PRD §4.4 / §9.3.2.

---

## Anti-Patterns to Avoid

- ❌ Don't place `#runValidation()` (or its throw) INSIDE `runQACycle()`'s try/catch —
  `isFatalError(error, continueOnError)` returns false for everything under `--continue-on-error`
  (`errors.ts:840`), so the abort would be swallowed. Invoke it from `run()` before `runQACycle()`.
- ❌ Don't run `validate.sh` through `retryAgentPrompt` — retrying a failing/hanging script masks the
  abort. Only the GENERATION (`agent.prompt`) call is retried (transient LLM failures).
- ❌ Don't pass `timeout: getValidationTimeoutSeconds()` raw to `execute_bash` — it expects
  **milliseconds**. Multiply by 1000 (or you get a 7.2s budget).
- ❌ Don't run `validate.sh` with `cwd: sessionPath` (the plan/metadata dir) — use `process.cwd()`
  (project root), mirroring `prp-executor.ts:543`. Regressing this makes every path-relative check fail.
- ❌ Don't have the agent RUN `validate.sh` itself — deterministic abort-on-failure + watchdog-terminal
  require the PIPELINE to observe the exit code. The agent only WRITES the script.
- ❌ Don't treat only `timedOut` as the watchdog signal — exit `124` (a `timeout` coreutil inside the
  script) is ALSO terminal and has `timedOut: false`. Use `result.timedOut || result.exitCode === 124`.
- ❌ Don't edit `src/config/constants.ts` (S1 owns it) or `agent-factory.ts` (the reasoning persona
  already exists via `createQAAgent`). Import only.
- ❌ Don't touch `BUG_FINDER_AGENT` / `.env.example` / `CONFIGURATION.md` (S1 + P4.M2.T2.S1 own those).
- ❌ Don't add a CLI flag — validation runs automatically as the first QA stage in all modes.