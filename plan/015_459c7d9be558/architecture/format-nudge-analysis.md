# Format-Nudge Recovery Analysis (PRD §4.5.1)

## Summary

The format-nudge recovery subsystem (PRD §4.5.1) is **~90% implemented**
across three call sites. All three variants exist, are functional, and have
bounded nudge loops with WARN logging. The primary gap is the **missing
`FORMAT_NUDGE_MAX` named constant** in `config/constants.ts` — each variant
inlines its own bound (all happen to be `2`). Budget isolation is enforced
structurally (separate loop variables, not connected to fix/retry budgets)
but there is no shared constant or explicit guard.

---

## 1. Coder Result-Envelope Variant — `src/agents/prp-executor.ts`

### 1.1 `formatFailure` flag

- **Type:** `ExecuteResult` interface, **line 201–205** (`formatFailure?: boolean`).
- Set **only** in `#parseCoderResult`'s catch path (line ~851): when JSON
  parsing fails (agent returned prose / no envelope), the catch returns
  `{ result: 'error', formatFailure: true, message: ... }`.
- `formatFailure` is never set on a successfully parsed envelope — it is a
  distinct signal from a genuine agent-reported `'error'`.

### 1.2 `#parseCoderResult`

- **Lines ~840–860.**
- Extracts JSON from ```` ```json ```` code blocks or bare JSON via regex:
  `/```(?:json)?\s*\n?([\s\S]*?)\n?```/`.
- On `JSON.parse` success → returns the parsed object.
- On `JSON.parse` failure → returns `{ result: 'error', formatFailure: true }`.

### 1.3 In-place nudge loop

- **Lines 349–384** (inside `execute()`).
- Runs **immediately after** initial parse (STEP 3a), **before** any
  validation gate.
- **Bound (inlined):** `const maxFormatNudges = 2;` at **line 357**.
- Loop condition: `while (coderResult.formatFailure === true && formatNudges < maxFormatNudges)`.
- Each iteration: increments `formatNudges`, calls `#nudgeForFormat`, re-extracts
  response content, re-parses via `#parseCoderResult`.
- **On exhaustion:** replaces the raw parse-error message with a clear terminal
  one: `"Coder Agent did not return a parseable JSON result envelope after N
  format nudge(s) (PRD §4.5.1). Last response: ..."` (lines 379–384). The result
  remains `{ result: 'error', formatFailure: true }` — hard-fails as a normal
  `'error'` outcome, `outcome: 'fail'`.

### 1.4 `#nudgeForFormat`

- **Lines 780–826.**
- Re-prompts the **same** Coder Agent with: truncated last response + restated
  envelope contract (`result/message` JSON) + instruction NOT to redo the work.
- Parameters: `(prp, attemptNumber, maxAttempts, lastResponse)`.
- Returns `AgentResponse<unknown>` — caller re-extracts and re-parses.
- Uses `retryAgentPrompt` + `withAgentDeadline` for deadline handling.

### 1.5 WARN logging

- **Present** — line 362–365:
  ```ts
  this.#logger.warn(
    { prpTaskId: prp.taskId, formatNudges, maxFormatNudges },
    'Coder Agent response had no parseable JSON result envelope — sending format nudge (PRD §4.5.1)'
  );
  ```
- Fields: `prpTaskId`, `formatNudges` (current attempt), `maxFormatNudges` (budget).
- This satisfies the §4.5.1 requirement: task id + attempt number + budget.

### 1.6 Budget isolation

- **Structurally isolated.** The `formatNudges` / `maxFormatNudges` variables
  are declared **inside** `execute()` and have **no connection** to:
  - `fixAttempts` / `maxFixAttempts` (validation fix loop — line 311–312, used
    in the `while (fixAttempts <= maxFixAttempts)` gate loop at line 429).
  - `ISSUE_RETRY_MAX` (re-planning loop — lives at a higher layer in
    `prp-pipeline.ts`, not in this file).
- Comment at **line 354** explicitly states isolation: *"This budget is
  separate from the validation maxFixAttempts and from ISSUE_RETRY_MAX."*
- **No shared constant** — `maxFormatNudges = 2` is inlined.

### 1.7 Checkpoint recording

- The post-nudge `coderResponseState` checkpoint (lines 386–397) records
  `coderResult` (which carries `formatFailure: true` if nudge failed) and the
  actual `coderResponse` string — so the checkpoint captures the envelope
  actually used or the persisted `formatFailure` flag. **Satisfies §4.5.1.**

---

## 2. Researcher PRP-File-Write Variant — `src/agents/prp-generator.ts`

### 2.1 Retry-before-nudge structure

- The primary generation path uses `retryAgentPrompt` (the general agent-retry
  wrapper) with a closure that runs the Researcher agent and then reads the
  PRP file (`readFile(prpOutputPath)`).
- If the file is missing after the retry loop, it throws `AgentError("Researcher
  did not write PRP file at ...")`.
- A `.catch()` on the retry result (lines ~753–763) catches this specific
  error (checks `err.message.includes('did not write PRP file')`) and calls
  `#nudgeResearcherToWrite`.

### 2.2 `#nudgeResearcherToWrite`

- **Lines 819–860.**
- Signature: `#nudgeResearcherToWrite(task, prpOutputPath, maxNudges = 2)`.
- **Bound (default param):** `maxNudges = 2` at **line 821** — inlined as a
  default parameter value (not a constant). The caller does not pass an
  explicit value, so the default `2` is always used.
- Loop: `for (let attempt = 1; attempt <= maxNudges; attempt++)`.
- Each iteration:
  1. Re-prompts the Researcher with: "the file at `<path>` is still MISSING —
     write the complete PRP now."
  2. After agent response, reads the file and parses it.
  3. If parseable → returns the parsed PRP (success).
  4. If missing/unparseable → loops to next attempt.
- **On exhaustion:** throws `AgentError("Researcher did not write PRP file at
  ... after N write-nudge(s) (PRD §4.5.1)")`.

### 2.3 WARN logging

- **Present** — line 827–829:
  ```ts
  this.#logger.warn(
    { taskId: task.id, attempt, maxNudges },
    'Researcher did not write PRP file after retries — sending write-nudge (PRD §4.5.1)'
  );
  ```
- Also WARN-logs on agent error during nudge (line 838–841) and INFO-logs on
  success (line 849–852).
- Fields: `taskId`, `attempt`, `maxNudges`. Satisfies §4.5.1.

### 2.4 Budget isolation

- **Structurally isolated.** `#nudgeResearcherToWrite` is called from a `.catch()`
  on the retry wrapper — it runs **after** the `retryAgentPrompt` budget is
  exhausted and **before** the error surfaces upstream. It is entirely
  disconnected from `ISSUE_RETRY_MAX` (re-planning) and from the Coder's
  `maxFixAttempts` (those are in `prp-executor.ts`).
- **No shared constant** — `maxNudges = 2` is a default parameter, inlined.

---

## 3. Architect / Backlog-Schema Variant — `src/workflows/fix-cycle-workflow.ts`

### 3.1 `runStandardBreakdown`

- **Lines 269–350.**
- Builds a bug-fix mini-PRD from the QA bug report (step a).
- Calls the Architect agent to decompose it (step b).
- Reads back `tasks.json` and `JSON.parse`s it (step c).
- **Step (c.5)** at **lines 333–338**: calls `#validateAndHealBacklog` to
  validate the backlog immediately after read.

### 3.2 `#validateAndHealBacklog`

- **Lines 365–428.**
- Uses `BacklogSchema.safeParse(backlog)` (line 370). `BacklogSchema`
  (defined in `src/core/models.ts` line 797) embeds `ContextScopeSchema`
  on every Subtask's `context_scope` field (line 402 of models.ts), so
  validating the full `BacklogSchema` transitively validates every
  `context_scope` against `ContextScopeSchema`.
- **`ContextScopeSchema`** (models.ts line 106): validates the string has the
  `CONTRACT DEFINITION:\n` prefix + all 4 numbered sections (`1. RESEARCH NOTE:`,
  `2. INPUT:`, `3. LOGIC:`, `4. OUTPUT:`) in order.
- **Note:** `ContextScopeSchema` is **not imported** in `fix-cycle-workflow.ts`
  (it imports `BacklogSchema` from `models.ts` at line 31). Validation goes
  through `BacklogSchema` which transitively enforces `ContextScopeSchema`.

### 3.3 Validate-nudge loop

- **Bound (inlined):** `const maxNudge = 2;` at **line 373**.
- If `BacklogSchema.safeParse` succeeds → returns immediately (no nudge needed).
- If it fails → enters the nudge loop (`for (attempt = 1; attempt <= maxNudge; ...)`).
- Each iteration:
  1. Formats the zod issues (up to 25) as a bulleted list.
  2. Nudges the architect via `retryAgentPrompt` with the specific errors and
     a restatement of the `CONTRACT DEFINITION` format contract.
  3. Re-reads `tasks.json`, re-parses, re-validates via `BacklogSchema.safeParse`.
- **On success after nudge:** returns the validated backlog (line 412–415).

### 3.4 WARN logging

- **Present** — lines 379–383:
  ```ts
  this.logger.warn(
    `[FixCycleWorkflow] Architect backlog failed schema validation — nudge ${attempt}/${maxNudge}:\n${errs}`
  );
  ```
- Format: **string-interpolated** (not structured JSON fields). Includes the
  attempt number and budget (`nudge ${attempt}/${maxNudge}`) and the zod issues.
- **Does NOT include a task id** — unlike the other two variants, this logs
  via `this.logger` (the workflow's logger) without a structured task context.
  The §4.5.1 logging requirement ("task id, attempt number, and budget") is
  partially met — it has attempt + budget but not a structured task id.

### 3.5 Auto-heal (`#healContextScopes` + `#normalizeContextScope`)

- After nudge exhaustion (line 418): if the backlog is still invalid, **auto-heals**.
- `#healContextScopes` (**lines 433–451**): walks Phase→Milestone→Task→Subtask,
  calling `#normalizeContextScope` on every Subtask's `context_scope`. Mutates
  in place.
- `#normalizeContextScope` (**lines 457–475**):
  - Extracts existing section content via regex (`grab(re)`) for each of the 4
    sections (`1. RESEARCH NOTE:`, `2. INPUT:`, `3. LOGIC:`, `4. OUTPUT:`).
  - For any missing section, defaults it (e.g. `"1. RESEARCH NOTE: See the bug
    report for <title>."`).
  - Rebuilds as `CONTRACT DEFINITION:\n` + all 4 sections in order.
  - **Section order is preserved** (hardcoded order s1→s2→s3→s4).
  - **Missing pieces are defaulted** (each `grab()` falls back to a default string).
- After healing, writes via `writeTasksJSON` (line 423–427), logs a WARN if
  that itself fails, then returns the healed backlog so the round proceeds.

### 3.6 Budget isolation

- **Structurally isolated.** The nudge loop is entirely within
  `#validateAndHealBacklog`, which is called once from `runStandardBreakdown`.
  It has no connection to `ISSUE_RETRY_MAX` or to any Coder fix budget.

---

## 4. `FORMAT_NUDGE_MAX` in `config/constants.ts`

- **NOT PRESENT.** Grep for `FORMAT_NUDGE` in `src/config/constants.ts` returns
  zero matches.
- The bound is inlined in all three variants:
  - `prp-executor.ts` line 357: `const maxFormatNudges = 2;`
  - `prp-generator.ts` line 821: `maxNudges = 2` (default parameter)
  - `fix-cycle-workflow.ts` line 373: `const maxNudge = 2;`
- All three happen to be `2`, matching the PRD §4.5.1 default of 2.
- **Gap:** PRD §4.5.1 / Milestone 2.1 requires a named `FORMAT_NUDGE_MAX`
  constant (default 2) in `config/constants.ts`, used as the bound for all
  three variants.

---

## 5. Gap Summary

| Requirement (§4.5.1) | Status | Details |
|---|---|---|
| `FORMAT_NUDGE_MAX` constant (default 2) in constants.ts | **MISSING** | Inlined as `2` in all 3 call sites |
| Coder result-envelope nudge | **DONE** | Lines 349–384, `#parseCoderResult`, `formatFailure`, `#nudgeForFormat` |
| Researcher PRP-file-write nudge | **DONE** | Lines 819–860, `#nudgeResearcherToWrite` |
| Architect / backlog-schema nudge + auto-heal | **DONE** | Lines 365–475, `#validateAndHealBacklog`, `#healContextScopes`, `#normalizeContextScope` |
| WARN logging (task id + attempt + budget) | **MOSTLY DONE** | Coder + Researcher variants have structured fields. Fix-cycle variant lacks structured task id. |
| Budget isolation from maxFixAttempts | **DONE** (structural) | Separate loop vars, no connection; explicit comment in prp-executor.ts |
| Budget isolation from ISSUE_RETRY_MAX | **DONE** (structural) | All three live in different layers entirely |
| Post-nudge checkpoint records envelope used | **DONE** | prp-executor.ts line 386–397 records `coderResult` + `coderResponse` |
| JSDoc citing §4.5.1 + FORMAT_NUDGE_MAX | **PARTIAL** | JSDoc exists citing §4.5.1 but references inlined values, not a named constant |

### Work needed (Milestone 2.1 scope)

1. Add `FORMAT_NUDGE_MAX` constant (default `2`) to `config/constants.ts`.
2. Replace the three inlined bounds (`maxFormatNudges = 2`, `maxNudges = 2`,
   `maxNudge = 2`) with the imported `FORMAT_NUDGE_MAX`.
3. Optionally: add structured task-id field to the fix-cycle-workflow WARN log.
4. Optionally: add JSDoc naming `FORMAT_NUDGE_MAX` and the budget-isolation
   rule on the three methods (`#parseCoderResult`, `#nudgeResearcherToWrite`,
   `runStandardBreakdown`/`#validateAndHealBacklog`).