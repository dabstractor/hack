# P2.M1.T1.S2 — Research: confirm budget isolation, consistent WARN logging, JSDoc completion

Scope: a **verification + small-completion** task (NO behavioral change) for the §4.5.1
format-nudge recovery across its three variants. Confirms budget isolation, fixes the ONE
inconsistent WARN log (fix-cycle-workflow), completes JSDoc on three methods, confirms the
post-nudge checkpoint. Consumes `FORMAT_NUDGE_MAX` from P2.M1.T1.S1.

Implementation order: S1 (constant + wiring) → S2 (this). S2 assumes line 356 (prp-executor),
822 (prp-generator), 373 (fix-cycle) now resolve to `FORMAT_NUDGE_MAX` (S1's pure refactor).

---

## 1. The three variants — exact current state (verified by direct read)

### A. Coder envelope — `src/agents/prp-executor.ts`
- **Nudge loop** (349-384): `let formatNudges = 0; const maxFormatNudges = FORMAT_NUDGE_MAX;`
  (post-S1); `while (coderResult.formatFailure === true && formatNudges < maxFormatNudges)`.
- **Budget isolation — CONFIRMED, comment EXISTS** (349-354): the STEP 3a comment explicitly
  says "This budget is separate from the validation maxFixAttempts and from ISSUE_RETRY_MAX."
  `fixAttempts`/`maxFixAttempts` (311-312) gate the SEPARATE `while (fixAttempts <= maxFixAttempts)`
  validation loop (429). ISSUE_RETRY_MAX lives in prp-pipeline.ts (higher layer). → (a) CONFIRM,
  no edit (optionally name FORMAT_NUDGE_MAX in the comment post-S1).
- **WARN logging — GOOD** (362-365): `this.#logger.warn({ prpTaskId: prp.taskId, formatNudges,
  maxFormatNudges }, '…(PRD §4.5.1)')` — structured, has task id + attempt + budget. ✓
- **Post-nudge checkpoint — CONFIRMED** (386-397): `coderResponseState` records both
  `coderResponse` (the actual string used) AND `coderResult` (which carries `formatFailure: true`
  if it never arrived). **Satisfies §4.5.1 "Logging." → (d) CONFIRM, no edit.**
- **`#parseCoderResult` JSDoc (833-837) — THIN**: only `@param`/`@returns`/`@private`, NO `@remarks`,
  no §4.5.1 citation, no FORMAT_NUDGE_MAX/budget-isolation. → (c) COMPLETE.

### B. Researcher PRP-write — `src/agents/prp-generator.ts`
- **`#nudgeResearcherToWrite`** (819-857): `maxNudges = FORMAT_NUDGE_MAX` (post-S1);
  `for (let attempt = 1; attempt <= maxNudges; attempt++)`.
- **WARN logging — GOOD** (827-829): `this.#logger.warn({ taskId: task.id, attempt, maxNudges },
  '…(PRD §4.5.1)')` — structured. ✓ (Also a second WARN at 833-836 for nudge-agent error, structured
  with `taskId`/`attempt`/`error`.)
- **Budget isolation — STRUCTURAL but NO in-method comment.** Analysis §2.4 confirms it's
  disconnected from ISSUE_RETRY_MAX + Coder's maxFixAttempts, but the method body has no comment
  stating it. → (a) ADD an explicit isolation comment.
- **JSDoc (812-818) — PARTIAL**: has a prose block ("Mirrors the Coder format-nudge… Bounded; on
  exhaustion…") but NOT a formal `@remarks`, doesn't name FORMAT_NUDGE_MAX or the budget-isolation
  rule. → (c) COMPLETE.

### C. Architect backlog — `src/workflows/fix-cycle-workflow.ts`
- **`#validateAndHealBacklog`** (365-432): `const maxNudge = FORMAT_NUDGE_MAX;` (post-S1);
  `for (let attempt = 1; attempt <= maxNudge && !vr.success; attempt++)`.
- **WARN logging — INCONSISTENT (line 379-381)**: `this.logger.warn(
  '[FixCycleWorkflow] Architect backlog failed schema validation — nudge ${attempt}/${maxNudge}:\n${errs}')`
  — **string-interpolated, NO structured task id** (the only one of the three variants without one).
  → (b) FIX to a structured call. **Available identifier:** `this.sessionPath` (and `tasksPath`);
  there is NO single per-task id here (it's a backlog-level nudge), so `sessionPath` is the right
  structured field (contract: "taskId or sessionPath").
  - NOTE: sibling WARNs at 392-394, 400-403, 417-418 are ALSO string-interpolated and lack
    sessionPath. The contract targets the 379 nudge-attempt WARN (it carries attempt/maxNudge);
    adding sessionPath to the siblings is a recommended consistency follow-up (low-risk), not
    mandatory.
- **Budget isolation — STRUCTURAL but NO in-method comment.** Analysis §3.6: no connection to
  ISSUE_RETRY_MAX or any Coder fix budget. → (a) ADD an isolation comment.
- **JSDoc (361-364) — BRIEF**: cites "PRD §4.5.1-extended" but doesn't name FORMAT_NUDGE_MAX or the
  budget-isolation rule. → (c) COMPLETE.

## 2. Test-impact analysis (verified — S2 is behavior-safe)

- **No test asserts the fix-cycle WARN message string** (`rg "Architect backlog failed schema
  validation|validation-nudge|FixCycleWorkflow.*nudge" tests/` → empty). → Restructuring the 379
  WARN to structured fields is SAFE (no string assertion breaks).
- The Coder nudge test asserts BEHAVIOR not WARN text: `prp-executor.test.ts:694`
  `expect(mockAgent.prompt).toHaveBeenCalledTimes(3)` (1 initial + 2 format nudges). S2 changes NO
  behavior (JSDoc + comments + WARN field-shape only) → this stays green.
- The Researcher "did not write PRP file" references in `tests/helpers/research-seam.ts` are about
  the THROWN error (prp-generator.ts:857 `AgentError`), NOT the WARN. S2 does NOT touch the thrown
  error → safe.
- → **S2 needs NO test edits.** Gate = typecheck + lint + format:check + the existing nudge
  behavior tests stay green (no behavioral change).

## 3. The fix-cycle WARN fix (exact before/after)

Before (379-381, string-interpolated, no structured id):
```ts
this.logger.warn(
  `[FixCycleWorkflow] Architect backlog failed schema validation — nudge ${attempt}/${maxNudge}:\n${errs}`
);
```
After (structured fields — sessionPath is the identifier; errs becomes a field, not interpolated):
```ts
this.logger.warn(
  { sessionPath: this.sessionPath, attempt, maxNudge, validationErrors: errs },
  'Architect backlog failed schema validation — sending schema-nudge (PRD §4.5.1)'
);
```
(Keep `errs` available — it's reused in the nudge prompt at line 383; the WARN just stops
interpolating it into the message and carries it as a structured field instead.)

## 4. Budget-isolation comments to ADD (a) — exact text

prp-generator.ts `#nudgeResearcherToWrite` (above the `for` loop, ~826):
```ts
// Budget isolation (PRD §4.5.1 #4): FORMAT_NUDGE_MAX write-nudges are a SEPARATE budget from
// ISSUE_RETRY_MAX (re-planning, prp-pipeline.ts) and from the Coder's maxFixAttempts
// (validation fix-and-retry, prp-executor.ts). A write-nudge neither consumes nor resets either.
```
fix-cycle-workflow.ts `#validateAndHealBacklog` (above `const maxNudge`, ~373):
```ts
// Budget isolation (PRD §4.5.1 #4): FORMAT_NUDGE_MAX schema-nudges are a SEPARATE budget from
// ISSUE_RETRY_MAX (re-planning) and from the Coder's maxFixAttempts (validation fix-and-retry).
// A schema-nudge neither consumes nor resets either.
```
(prp-executor.ts already has its comment at 349-354 — CONFIRM, optionally append "; bounded by
FORMAT_NUDGE_MAX" for symmetry.)

## 5. JSDoc completion (c) — what each must contain

Each method's JSDoc `@remarks` must: (1) cite §4.5.1, (2) name `FORMAT_NUDGE_MAX` (default 2),
(3) state the budget-isolation rule (separate from maxFixAttempts + ISSUE_RETRY_MAX). Per-method
focus:
- `#parseCoderResult` (prp-executor.ts): its ROLE is DETECTION — sets `formatFailure: true` on a
  JSON-parse miss, which the execute() nudge loop keys on; explain that flag is what triggers the
  bounded FORMAT_NUDGE_MAX in-place re-prompt (distinct from a genuine agent 'error'/'issue').
- `#nudgeResearcherToWrite` (prp-generator.ts): re-prompts the SAME researcher to write the missing
  PRP file; bounded by FORMAT_NUDGE_MAX; budget-isolated.
- `#validateAndHealBacklog` (fix-cycle-workflow.ts): nudges the Architect with zod issues, then
  auto-heals residual context_scope; bounded by FORMAT_NUDGE_MAX; budget-isolated.

## 6. Scope boundaries (what S2 does NOT do)

- NO behavioral change (loop bounds stay 2 via FORMAT_NUDGE_MAX from S1; nudge logic unchanged).
- NO edits to the Coder/Researcher WARN fields (already structured/good) — only fix-cycle's 379.
- NO new tests (behavior unchanged; verified no test asserts the WARN strings). Optional: none.
- NO env/`.hack` knob for FORMAT_NUDGE_MAX (§4.5.1 fixed default; S1 made it a plain const).
- NO edits to the post-nudge checkpoint (386-397 — already correct, just CONFIRM).
- NO edits to the thrown errors (the AgentError messages) — those are test-referenced, leave them.
- P1.M4.T3.S1 (remote-mutation prompt prohibition) is file-disjoint (prompt text in FORBIDDEN
  OPERATIONS sections) — no overlap.

## 7. Validation gate (verified)

- `npm run typecheck && npm run lint && npm run format:check` clean.
- `npx vitest run tests/unit/agents/prp-executor.test.ts` GREEN (the 1+2 nudge behavior test
  unchanged). `npx vitest run tests/unit/workflows/fix-cycle-workflow*.test.ts` GREEN if present.
- `npm run test:run` stays green (no behavioral change; no test asserts the restructured WARN).
- 100% coverage unaffected (JSDoc/comments/WARN-field-shape add no new branches).