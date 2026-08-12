# PRP — P2.M1.T1.S2: Confirm budget isolation + consistent WARN logging + JSDoc completion

---

## Goal

**Feature Goal**: Complete and harden the §4.5.1 **format-nudge recovery** across its three
variants (Coder envelope / Researcher PRP-write / Architect backlog) — **no behavioral change**.
Specifically: (a) **confirm** budget isolation in all three files and **add an explicit
isolation comment** where missing; (b) **fix the one inconsistent WARN log** (fix-cycle-workflow
string-interpolates and lacks a structured task id) to a structured call carrying `sessionPath`;
(c) **complete JSDoc** on `#parseCoderResult`, `#nudgeResearcherToWrite`, and
`#validateAndHealBacklog` — each citing §4.5.1, naming `FORMAT_NUDGE_MAX`, and stating the
budget-isolation rule; (d) **confirm** the post-nudge `coder-response` checkpoint records the
envelope actually used / the persisted `formatFailure` flag.

**Deliverable** (3 src files; JSDoc + comments + 1 WARN restructure; **zero behavioral change**):
1. **`src/workflows/fix-cycle-workflow.ts`** — restructure the line-379 nudge WARN from
   string-interpolation to a structured `this.logger.warn({ sessionPath, attempt, maxNudge,
   validationErrors }, msg)`; add a budget-isolation comment; complete `#validateAndHealBacklog` JSDoc.
2. **`src/agents/prp-generator.ts`** — add a budget-isolation comment in `#nudgeResearcherToWrite`;
   complete its JSDoc.
3. **`src/agents/prp-executor.ts`** — complete `#parseCoderResult` JSDoc; (confirm the existing
   isolation comment at 349-354 + the checkpoint at 386-397 — no edit, optionally enhance the
   comment to name `FORMAT_NUDGE_MAX`).

**Success Definition**:
- All three variants have an explicit budget-isolation comment naming `FORMAT_NUDGE_MAX` and the
  rule "separate from `maxFixAttempts` and `ISSUE_RETRY_MAX`" (prp-executor's already exists —
  confirm/enhance; prp-generator + fix-cycle get a NEW comment).
- The fix-cycle-workflow line-379 WARN is a structured call with `sessionPath` + `attempt` +
  `maxNudge` (+ `validationErrors`), consistent with the Coder (`prpTaskId`) and Researcher
  (`taskId`) variants. (Sibling WARNs at 392/400/417 optionally gain `sessionPath` for consistency.)
- `#parseCoderResult`, `#nudgeResearcherToWrite`, `#validateAndHealBacklog` each have a `@remarks`
  citing §4.5.1, naming `FORMAT_NUDGE_MAX`, and stating the budget-isolation rule.
- **No behavioral change**: nudge loop bounds still 2 (via `FORMAT_NUDGE_MAX` from S1); nudge
  prompts, re-parse logic, terminal errors, and the post-nudge checkpoint are UNCHANGED.
- `npm run typecheck && npm run lint && npm run format:check` clean; the existing nudge behavior
  tests stay GREEN (notably `prp-executor.test.ts:694` 1-initial+2-nudges); `npm run test:run` green.
- S2 edits ONLY the 3 src files above (JSDoc/comments/1 WARN). No new tests, no behavioral logic,
  no constant additions (S1 owns `FORMAT_NUDGE_MAX`).

---

## Why

- **§4.5.1 "Logging" requires a structured WARN with task id + attempt + budget.** Two of the three
  variants already comply (Coder: `{ prpTaskId, formatNudges, maxFormatNudges }`; Researcher:
  `{ taskId, attempt, maxNudges }`). The Architect variant (fix-cycle-workflow:379) string-interpolates
  `nudge ${attempt}/${maxNudge}` and omits any structured task/session id — the one gap the analysis
  flags ("MOSTLY DONE… Fix-cycle variant lacks structured task id"). S2 closes it for log-grep parity.
- **Budget isolation is load-bearing (§4.5.1 #4).** A format nudge must NOT consume/reset
  `maxFixAttempts` or `ISSUE_RETRY_MAX`. It is already STRUCTURALLY enforced (separate loop vars in
  separate layers — analysis §1.6/§2.4/§3.6), but only prp-executor has an in-code COMMENT stating it.
  Adding the comment to the other two variants documents the invariant where future contributors
  actually edit the loop — preempting an accidental coupling.
- **JSDoc completion makes the cross-variant contract legible.** Each method currently under-documents
  its role in the §4.5.1 recovery (detection vs. nudge vs. heal) and the shared `FORMAT_NUDGE_MAX`
  bound + isolation rule. Completing them turns three scattered loops into one coherent, greppable
  contract — the kind of context-curation §4.5.1's rationale ("killed multi-hour runs on a missing
  envelope") demands be obvious to the next reader.
- **Foundational, low-risk.** This is documentation + one WARN-shape fix with no behavioral change —
  it hardens the recovery S1 just refactored without touching its logic.
- **Out of scope (hard boundaries):** any behavioral change to the nudge loops (bounds, prompts,
  re-parse, terminal errors, checkpoint), the `FORMAT_NUDGE_MAX` constant itself (S1), the Coder /
  Researcher WARN fields (already structured), the thrown `AgentError` messages (test-referenced),
  any env/`.hack` knob for the bound (§4.5.1 deliberately omits one), and any `docs/*.md` (Mode A =
  JSDoc only). P1.M4.T3.S1 (prompt-text remote-mutation prohibition) is file/region-disjoint.

---

## What

### User-visible behavior
None. JSDoc + comments + one WARN-field-shape change. The recovery behavior (bounded FORMAT_NUDGE_MAX
in-place nudges, terminal hard-fail on exhaustion, post-nudge checkpoint) is byte-for-byte unchanged.

### Technical requirements (exact contract)

**`src/workflows/fix-cycle-workflow.ts`** — (b) restructure the WARN + (a) isolation comment + (c) JSDoc:

WARN at line 379-381 — BEFORE (string-interpolated, no structured id):
```ts
this.logger.warn(
  `[FixCycleWorkflow] Architect backlog failed schema validation — nudge ${attempt}/${maxNudge}:\n${errs}`
);
```
AFTER (structured; `sessionPath` is the identifier — there is no per-task id at backlog level):
```ts
this.logger.warn(
  { sessionPath: this.sessionPath, attempt, maxNudge, validationErrors: errs },
  'Architect backlog failed schema validation — sending schema-nudge (PRD §4.5.1)'
);
```
(`errs` is still reused in the nudge prompt at line 383 — only the WARN stops interpolating it.)

Isolation comment — ADD immediately above `const maxNudge = FORMAT_NUDGE_MAX;` (~373):
```ts
// Budget isolation (PRD §4.5.1 #4): FORMAT_NUDGE_MAX schema-nudges are a SEPARATE budget from
// ISSUE_RETRY_MAX (re-planning) and from the Coder's maxFixAttempts (validation fix-and-retry).
// A schema-nudge neither consumes nor resets either.
```

JSDoc — REPLACE the brief block at 361-364 with a complete `@remarks` (cite §4.5.1 + FORMAT_NUDGE_MAX
+ isolation). Example shape:
```ts
/**
 * Validate the architect's bugfix backlog; on failure, nudge the architect with the specific
 * schema errors, then auto-heal residual `context_scope` fields so the round can proceed instead
 * of wedging (PRD §4.5.1 — Architect/breakdown variant).
 *
 * @remarks
 * The Architect writes `tasks.json` directly, so a non-conforming `context_scope` (systematically a
 * missing `4. OUTPUT:` on small bugfix tasks) is only caught at the downstream `writeTasksJSON`
 * schema gate — which would reject it and wedge the round. This method validates immediately after
 * read, nudges the SAME architect with the zod issues (bounded by {@link FORMAT_NUDGE_MAX}, default 2),
 * and on exhaustion auto-heals each `context_scope` back into valid CONTRACT DEFINITION form.
 *
 * **Budget isolation (§4.5.1 #4):** these schema-nudges are a SEPARATE budget from the validation
 * `maxFixAttempts` (Coder fix-and-retry) and from `ISSUE_RETRY_MAX` (§4.5 re-planning). A nudge
 * neither consumes nor resets either.
 */
```

**`src/agents/prp-generator.ts`** — (a) isolation comment + (c) JSDoc (the WARN at 827 is already
structured — leave it):

Isolation comment — ADD immediately above the `for` loop in `#nudgeResearcherToWrite` (~826):
```ts
// Budget isolation (PRD §4.5.1 #4): FORMAT_NUDGE_MAX write-nudges are a SEPARATE budget from
// ISSUE_RETRY_MAX (re-planning, prp-pipeline.ts) and from the Coder's maxFixAttempts
// (validation fix-and-retry, prp-executor.ts). A write-nudge neither consumes nor resets either.
```

JSDoc — EXPAND the prose block at 812-818 into a formal `@remarks` (it already says "Mirrors the
Coder format-nudge… Bounded; on exhaustion…"). Add the §4.5.1 citation, `FORMAT_NUDGE_MAX` naming,
and the isolation rule. Example shape:
```ts
/**
 * Re-prompt the SAME researcher to write the PRP file when it ran but did not write it
 * (silent contract miss — the most common researcher failure; unhandled, it kills whole runs).
 *
 * @remarks
 * Mirrors the Coder format-nudge (PRD §4.5.1 — Researcher/PRP-file-write variant). The agent retains
 * its turn context, so the nudge is short. The file is re-checked each attempt; bounded by
 * {@link FORMAT_NUDGE_MAX} (default 2). On exhaustion the original "did not write PRP file" error
 * surfaces.
 *
 * **Budget isolation (§4.5.1 #4):** these write-nudges are a SEPARATE budget from the validation
 * `maxFixAttempts` (Coder fix-and-retry) and from `ISSUE_RETRY_MAX` (§4.5 re-planning). A write-nudge
 * neither consumes nor resets either.
 *
 * @private
 */
```

**`src/agents/prp-executor.ts`** — (c) complete `#parseCoderResult` JSDoc + (a) confirm/enhance the
existing isolation comment + (d) confirm the checkpoint (no edit):

JSDoc at 833-837 — EXPAND the thin block (currently only `@param`/`@returns`/`@private`) into a
`@remarks` explaining the DETECTION role + the nudge loop it feeds:
```ts
/**
 * Parse the Coder Agent's response into an {@link ExecuteResult}, flagging a missing JSON envelope
 * distinctly from a genuine agent-reported error/issue (PRD §4.5.1).
 *
 * @remarks
 * On a successful JSON parse (optionally fenced in ```json), returns the envelope as-is. On a parse
 * failure (prose / trailing sentence / no envelope), returns `{ result: 'error', formatFailure: true }`.
 * That `formatFailure` flag is what {@link PRPExecutor.execute}'s in-place nudge loop keys on
 * (`while (coderResult.formatFailure === true && formatNudges < maxFormatNudges)`): a transport/contract
 * miss triggers a bounded FORMAT_NUDGE_MAX re-prompt for the envelope, NOT a hard item failure —
 * distinct from a valid envelope reporting `error`/`issue`, which flows the existing fix-and-retry path.
 *
 * **Budget isolation (§4.5.1 #4):** the nudge loop this flag gates is a SEPARATE budget from the
 * validation `maxFixAttempts` and from `ISSUE_RETRY_MAX` (see the STEP 3a comment in {@link execute}).
 *
 * @param response - Raw string response from the Coder Agent.
 * @returns Parsed result; on parse failure, `{ result: 'error', formatFailure: true, message }`.
 * @private
 */
```
(a) The STEP 3a comment (349-354) ALREADY states "separate from the validation maxFixAttempts and
from ISSUE_RETRY_MAX" — CONFIRM (no edit). OPTIONAL: append "; bounded by `FORMAT_NUDGE_MAX`" for
symmetry with the two new comments.
(d) The post-nudge checkpoint (386-397) records BOTH `coderResponse` and `coderResult` (which carries
`formatFailure`) — CONFIRM it captures the envelope actually used / the persisted flag. NO edit.

### Success Criteria
- [ ] fix-cycle-workflow:379 WARN is structured `{ sessionPath, attempt, maxNudge, validationErrors }`
      (+ a §4.5.1 message); no remaining `nudge ${attempt}/${maxNudge}` string interpolation there.
- [ ] `#nudgeResearcherToWrite` and `#validateAndHealBacklog` each have an explicit budget-isolation
      comment naming `FORMAT_NUDGE_MAX`; prp-executor's existing comment confirmed (optionally enhanced).
- [ ] `#parseCoderResult`, `#nudgeResearcherToWrite`, `#validateAndHealBacklog` each have a `@remarks`
      citing §4.5.1 + `FORMAT_NUDGE_MAX` + the isolation rule.
- [ ] No behavioral change: `rg "maxNudge = FORMAT_NUDGE_MAX|maxNudges = FORMAT_NUDGE_MAX|maxFormatNudges = FORMAT_NUDGE_MAX" src/` (S1's wiring intact); nudge bounds still 2; terminal errors + checkpoint unchanged.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; `npx vitest run tests/unit/agents/prp-executor.test.ts` GREEN (1+2 nudge behavior); `npm run test:run` green.
- [ ] S2 edits ONLY the 3 src files (no new tests, no constant, no behavioral logic).

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The exact before/after of every edit is given with file:line anchors verified by direct
read. The verification items (a/d) are proven from source: prp-executor's isolation comment (349-354)
+ structured WARN (362) + checkpoint (386-397) all already satisfy §4.5.1. The one real edit (b) is
specified verbatim, including WHY `sessionPath` is the identifier (no per-task id at backlog level)
and WHY `errs` moves to a field (it's reused in the prompt at 383). The test-impact analysis proves
no test asserts the restructured WARN string (the Coder test asserts behavior: 1 initial + 2 nudges),
so the change is behavior-safe. The S1→S2 boundary (S1 owns `FORMAT_NUDGE_MAX`; S2 consumes it) is
explicit, and the three JSDoc completions are given as ready-to-paste blocks scoped per method role.

### Documentation & References
```yaml
# MUST READ — the PRD spec
- docfile: plan/015_459c7d9be558/prd_snapshot.md   # (or PRD.md §4.5.1)
  section: "4.5.1 Format-Nudge Recovery (Missing Result Envelope)" (h4.0)
  why: Defines the three variants, FORMAT_NUDGE_MAX (default 2), budget isolation (#4), terminal
        behavior (#5), and the Logging requirement ("Each nudge emits a WARN with the task id,
        attempt number, and budget. The final post-nudge coder-response checkpoint records the
        envelope actually used (or the persisted formatFailure flag)."). THIS is the contract.

# MUST READ — S1's PRP (contract input; defines FORMAT_NUDGE_MAX wiring)
- docfile: plan/015_459c7d9be558/P2M1T1S1/PRP.md
  section: "Technical requirements"
  why: S1 adds `export const FORMAT_NUDGE_MAX = 2` to constants.ts and wires the three call sites
        (prp-executor ~356, prp-generator ~822, fix-cycle ~373) to it — pure refactor, no behavioral
        change. S2 ASSUMES that wiring is in place and reasons about the bound symbolically.

# MUST READ — this subtask's research (exact current state + before/after + test-impact)
- docfile: plan/015_459c7d9be558/P2M1T1S2/research/budget-isolation-warn-jsdoc.md
  section: §1 the three variants' current state, §2 test-impact (WARN-safe), §3 the fix-cycle WARN
           fix, §4 isolation comments, §5 JSDoc per method, §6 boundaries
  why: Proven facts: prp-executor's isolation comment (349-354) + structured WARN (362) + checkpoint
        (386-397) already satisfy §4.5.1 (CONFIRM, no edit); fix-cycle:379 is the ONLY inconsistent
        WARN; no test asserts the WARN string → restructure is safe; the Coder test asserts behavior
        (1+2 nudges), not WARN text.

# MUST READ — the cited analysis (confirms the gap + isolation)
- docfile: plan/015_459c7d9be558/architecture/format-nudge-analysis.md
  section: "1.5/1.6/1.7 WARN/Budget-isolation/Checkpoint", "2.3/2.4", "3.4/3.6", "§5 summary table"
  why: Confirms: Coder + Researcher WARNs are structured (DONE); fix-cycle WARN LACKS structured task
        id (the gap); budget isolation is structural in all three; checkpoint satisfies §4.5.1.

# THE FILES TO EDIT — exact current state + anchors
- file: src/workflows/fix-cycle-workflow.ts
  why: EDIT the 379 WARN (string→structured) + add isolation comment (~373) + complete JSDoc (361-364).
  pattern: `this.logger.warn({ …fields }, 'message')` — the codebase pino structured-call convention
        (cf. prp-executor.ts:362 `this.#logger.warn({ prpTaskId, formatNudges, maxFormatNudges }, msg)`).
  gotcha: use `this.sessionPath` (public logger + public sessionPath here; fix-cycle uses `this.logger`,
        not `this.#logger`). `errs` stays a local (reused in the prompt at 383) — move it into a field.
- file: src/agents/prp-generator.ts
  why: ADD isolation comment (~826) + expand JSDoc (812-818) on #nudgeResearcherToWrite. WARN at 827
        is ALREADY structured — DO NOT change it.
  gotcha: uses `this.#logger` (private). The thrown AgentError (857) is test-referenced — leave it.
- file: src/agents/prp-executor.ts
  why: COMPLETE #parseCoderResult JSDoc (833-837, thin). CONFIRM the isolation comment (349-354) +
        checkpoint (386-397) — no edit. WARN (362) already structured — DO NOT change it.
  gotcha: uses `this.#logger` (private). Do NOT touch the nudge loop, terminal error, or checkpoint.

# CONTRACT — the constant S2 consumes (S1 adds it; S2 does NOT edit constants.ts)
- file: src/config/constants.ts
  why: S1 adds `export const FORMAT_NUDGE_MAX = 2` after getIssueRetryMax(). S2 REFERENCES it in
        JSDoc/comments only (the call-site wiring is S1's). DO NOT edit this file in S2.

# PATTERN FILES — structured WARN convention (mirror for the fix-cycle fix)
- file: src/agents/prp-executor.ts:362
  why: `this.#logger.warn({ prpTaskId: prp.taskId, formatNudges, maxFormatNudges }, '…(PRD §4.5.1)')`
        — the structured WARN shape to mirror in fix-cycle (fields-first, §4.5.1 in the message).
- file: src/agents/prp-generator.ts:827
  why: `this.#logger.warn({ taskId: task.id, attempt, maxNudges }, '…(PRD §4.5.1)')` — second precedent.
```

### Current Codebase tree (relevant slice — S2 edits 3 src files, JSDoc/comments/1 WARN)
```bash
src/workflows/fix-cycle-workflow.ts   # EDIT — 379 WARN restructure + isolation comment (~373) + #validateAndHealBacklog JSDoc (361-364)
src/agents/prp-generator.ts           # EDIT — isolation comment (~826) + #nudgeResearcherToWrite JSDoc (812-818)
src/agents/prp-executor.ts            # EDIT — #parseCoderResult JSDoc (833-837); CONFIRM comment (349-354) + checkpoint (386-397) [no edit]
src/config/constants.ts               # READ-ONLY (S1 owns FORMAT_NUDGE_MAX)
```

### Desired Codebase tree with files to be added/edited
```bash
src/workflows/fix-cycle-workflow.ts   # MODIFIED (WARN structured + isolation comment + JSDoc)
src/agents/prp-generator.ts           # MODIFIED (isolation comment + JSDoc)
src/agents/prp-executor.ts            # MODIFIED (#parseCoderResult JSDoc; comment optionally enhanced)
# (NO constants.ts, NO tests, NO behavioral logic — S2 is JSDoc/comments/1 WARN-shape only.)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — NO behavioral change. S2 adds JSDoc + comments + restructures ONE WARN's fields. The
//   nudge loop bounds (FORMAT_NUDGE_MAX from S1), prompts, re-parse, terminal AgentError messages,
//   and the post-nudge checkpoint are UNCHANGED. The Coder behavior test (prp-executor.test.ts:694,
//   1 initial + 2 format nudges) must stay green untouched.

// CRITICAL — the fix-cycle WARN identifier is `this.sessionPath`, NOT a taskId. #validateAndHealBacklog
//   nudges at the BACKLOG level (a whole tasks.json), so there is no single per-task id in scope.
//   sessionPath is the correct structured field (contract: "taskId or sessionPath").

// GOTCHA — fix-cycle-workflow uses `this.logger` (public) + `this.sessionPath` (public); prp-executor
//   and prp-generator use `this.#logger` (private). Preserve each file's convention — do NOT cross them.

// GOTCHA — keep `errs` as a local variable in #validateAndHealBacklog; it is REUSED in the nudge prompt
//   (line 383). The WARN fix moves it from string-interpolation INTO a structured field — it is not deleted.

// GOTCHA — the thrown AgentError messages ("Researcher did not write PRP file at <path>",
//   "Coder Agent did not return a parseable JSON result envelope after N format nudge(s)") are
//   test-referenced (tests/helpers/research-seam.ts). DO NOT touch them — S2 changes only WARN + JSDoc/comments.

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` before validate. JSDoc `@remarks`
//   blocks must be prettier-clean (watch line length / list formatting).

// GOTCHA — `formatFailure` is set ONLY on a JSON-parse miss (#parseCoderResult catch path), never on a
//   successfully parsed envelope. The JSDoc must state this distinction (it's what separates a nudge
//   from a genuine agent 'error'/'issue').
```

---

## Implementation Blueprint

### Data models and structure
None. No types, no constants, no behavioral logic. S2 is JSDoc + comments + one WARN field-shape.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT src/workflows/fix-cycle-workflow.ts — restructure the 379 WARN + isolation comment + JSDoc
  - REPLACE the line-379 WARN (string-interpolated) with the structured call:
        this.logger.warn(
          { sessionPath: this.sessionPath, attempt, maxNudge, validationErrors: errs },
          'Architect backlog failed schema validation — sending schema-nudge (PRD §4.5.1)'
        );
    (KEEP `errs` — it's reused in the prompt at line 383.)
  - ADD the budget-isolation comment immediately above `const maxNudge = FORMAT_NUDGE_MAX;` (~373).
  - REPLACE the brief JSDoc (361-364) with the complete @remarks (cite §4.5.1 + FORMAT_NUDGE_MAX + isolation).
  - (OPTIONAL consistency) add `sessionPath: this.sessionPath` to the sibling WARNs at 392-394, 400-403,
        417-418 so every WARN in the method is greppable by session. (Recommended, not mandatory.)
  - DO NOT change the loop bound, prompt, retryAgentPrompt call, auto-heal, or writeTasksJSON.
  - EXPECTED: typecheck/lint/format clean; no behavior change.

Task 2: EDIT src/agents/prp-generator.ts — isolation comment + #nudgeResearcherToWrite JSDoc
  - ADD the budget-isolation comment above the `for` loop in #nudgeResearcherToWrite (~826).
  - EXPAND the JSDoc prose (812-818) into a formal @remarks citing §4.5.1 + FORMAT_NUDGE_MAX + isolation
        (keep the existing "Mirrors the Coder format-nudge… Bounded…" intent).
  - DO NOT change the WARN at 827 (already structured) or the thrown AgentError at 857 (test-referenced).
  - EXPECTED: typecheck/lint/format clean; no behavior change.

Task 3: EDIT src/agents/prp-executor.ts — complete #parseCoderResult JSDoc + confirm (a)/(d)
  - REPLACE the thin JSDoc (833-837) with the complete @remarks explaining the DETECTION role
        (formatFailure flag) + the nudge loop it gates + budget isolation (see "Technical requirements").
  - (a) CONFIRM the STEP 3a comment (349-354) states isolation (it does: "separate from the validation
        maxFixAttempts and from ISSUE_RETRY_MAX"). OPTIONAL: append "; bounded by FORMAT_NUDGE_MAX".
  - (d) CONFIRM the post-nudge checkpoint (386-397) records coderResponse + coderResult (formatFailure).
        NO edit — read and verify.
  - DO NOT change the WARN at 362 (already structured), the nudge loop, the terminal error, or the checkpoint.
  - EXPECTED: typecheck/lint/format clean; no behavior change.

Task 4: VERIFY (no behavioral change)
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check. (MUST be clean.)
  - RUN: npx vitest run tests/unit/agents/prp-executor.test.ts  (EXPECTED: GREEN — incl. the 1+2 nudge test at :694).
  - RUN: npm run test:run  (EXPECTED: green — no behavioral change; no test asserts the restructured WARN).
  - RUN: rg -n "nudge \\\$\{attempt\}/\$\{maxNudge\}" src/workflows/fix-cycle-workflow.ts  (EXPECTED: empty — old string form gone).
  - RUN: rg -n "Budget isolation \(PRD §4\.5\.1 #4\)" src/  (EXPECTED: ≥3 hits — the three variants).
  - EXPECTED: all green; 3 isolation comments; 3 completed JSDoc; 1 restructured WARN; zero behavior change.
```

### Implementation Patterns & Key Details
```ts
// ---- fix-cycle WARN: string-interpolated → structured (mirror prp-executor:362 / prp-generator:827) ----
this.logger.warn(
  { sessionPath: this.sessionPath, attempt, maxNudge, validationErrors: errs },
  'Architect backlog failed schema validation — sending schema-nudge (PRD §4.5.1)'
);

// ---- isolation comment (identical rule, per-variant wording) ----
// Budget isolation (PRD §4.5.1 #4): FORMAT_NUDGE_MAX <variant>-nudges are a SEPARATE budget from
// ISSUE_RETRY_MAX (re-planning) and from the Coder's maxFixAttempts (validation fix-and-retry).
// A <variant>-nudge neither consumes nor resets either.

// ---- JSDoc @remarks must contain (all three methods) ----
// 1. cite "PRD §4.5.1" (+ variant name: Coder envelope / Researcher PRP-write / Architect backlog)
// 2. name FORMAT_NUDGE_MAX (default 2)
// 3. state the budget-isolation rule (separate from maxFixAttempts + ISSUE_RETRY_MAX)
// per-method role: #parseCoderResult=DETECTION (sets formatFailure); #nudgeResearcherToWrite=NUDGE;
//                  #validateAndHealBacklog=NUDGE + AUTO-HEAL
```

### Integration Points
```yaml
LOGGING (fix-cycle-workflow.ts:379):
  - RESTRUCTURE: `this.logger.warn('[FixCycleWorkflow] … nudge ${attempt}/${maxNudge}:\n${errs}')`
        → `this.logger.warn({ sessionPath, attempt, maxNudge, validationErrors: errs }, '… (PRD §4.5.1)')`.
  - Now consistent with prp-executor:362 ({ prpTaskId, formatNudges, maxFormatNudges }) and
        prp-generator:827 ({ taskId, attempt, maxNudges }) — all three carry a structured id + attempt + budget.

DOCUMENTATION (JSDoc + comments, Mode A):
  - prp-executor.ts #parseCoderResult: complete JSDoc (detection role + formatFailure + isolation).
  - prp-generator.ts #nudgeResearcherToWrite: complete JSDoc + isolation comment.
  - fix-cycle-workflow.ts #validateAndHealBacklog: complete JSDoc + isolation comment.
  - prp-executor.ts STEP 3a comment (349-354): CONFIRM (optionally name FORMAT_NUDGE_MAX).

VERIFICATION (no edit):
  - prp-executor.ts checkpoint (386-397): CONFIRM records coderResponse + coderResult (formatFailure).

NO CHANGES TO (hard boundary):
  - FORMAT_NUDGE_MAX constant (S1) / constants.ts. The nudge loop bounds, prompts, re-parse, terminal
    AgentError messages, the post-nudge checkpoint. The Coder/Researcher WARN fields (already structured).
  - Any env/.hack knob (§4.5.1 omits one). Any docs/*.md (Mode A = JSDoc). Any test (behavior unchanged).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — JSDoc blocks must be prettier-clean)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json (JSDoc/comments/WARN-field-shape — must stay clean)
npm run lint           # eslint . --ext .ts
npm run format:check   # prettier --check
# Targeted:
npx eslint src/workflows/fix-cycle-workflow.ts src/agents/prp-generator.ts src/agents/prp-executor.ts
npx prettier --check src/workflows/fix-cycle-workflow.ts src/agents/prp-generator.ts src/agents/prp-executor.ts
# Expected: clean. Likely failure: a JSDoc line-length/format nit → npm run fix auto-resolves.
```

### Level 2: Unit Tests (the no-behavioral-change proof)
```bash
# The Coder nudge behavior test (must stay GREEN — asserts 1 initial + 2 format nudges, NOT the WARN text):
npx vitest run tests/unit/agents/prp-executor.test.ts
#   Expected: GREEN. If it fails, S2 accidentally changed nudge loop behavior — revert the logic edit.
# fix-cycle workflow tests (if present — the restructured WARN must not break them):
npx vitest run tests/unit/workflows/fix-cycle-workflow.test.ts 2>/dev/null || echo "(no dedicated file — covered by test:run)"
#   Expected: GREEN (no test asserts the old WARN string — verified by research §2).
```

### Level 3: Integration / Regression (System Validation)
```bash
npm run validate      # = lint && format:check && typecheck && test:run  → MUST exit 0 (no behavioral change)
npm run build         # tsc -p tsconfig.build.json → dist/ emits (JSDoc/comments compile fine)
# Confirm the edits landed (grep the new shapes):
rg -n "nudge \\\$\{attempt\}/\$\{maxNudge\}" src/workflows/fix-cycle-workflow.ts   # EXPECTED: empty (old form gone)
rg -n "sessionPath: this\.sessionPath, attempt, maxNudge" src/workflows/fix-cycle-workflow.ts   # EXPECTED: ≥1 (new structured WARN)
rg -n "Budget isolation \(PRD §4\.5\.1 #4\)" src/   # EXPECTED: ≥3 (prp-executor [existing/enhanced] + prp-generator + fix-cycle)
# Expected: all green; 1 restructured WARN; 3 isolation comments; zero behavioral change.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. WARN parity — all three variants now emit a structured WARN with (id, attempt, budget):
#      Coder {prpTaskId,formatNudges,maxFormatNudges} | Researcher {taskId,attempt,maxNudges} |
#      Architect {sessionPath,attempt,maxNudge,validationErrors}. (grep each — all present.)
#   2. Budget isolation documented in-code at all three loop sites (grep "Budget isolation (PRD §4.5.1 #4)").
#   3. Post-nudge checkpoint still records coderResult (formatFailure) + coderResponse (read 386-397 — unchanged).
#   4. No behavioral change — the Coder 1+2 nudge test is GREEN; loop bounds still resolve to FORMAT_NUDGE_MAX (2).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean; `npm run lint` clean; `npm run format:check` clean.
- [ ] `npm run validate` exits 0; `npm run build` compiles.
- [ ] `npx vitest run tests/unit/agents/prp-executor.test.ts` GREEN (1+2 nudge behavior unchanged).

### Feature Validation
- [ ] fix-cycle:379 WARN is structured `{ sessionPath, attempt, maxNudge, validationErrors }` (+ §4.5.1 msg).
- [ ] `#nudgeResearcherToWrite` + `#validateAndHealBacklog` have an isolation comment naming FORMAT_NUDGE_MAX;
      prp-executor's existing comment confirmed (optionally enhanced).
- [ ] `#parseCoderResult`, `#nudgeResearcherToWrite`, `#validateAndHealBacklog` each have a `@remarks`
      citing §4.5.1 + FORMAT_NUDGE_MAX + isolation.
- [ ] Post-nudge checkpoint (386-397) confirmed to record coderResult (formatFailure) + coderResponse.
- [ ] No behavioral change (loop bounds, prompts, terminal errors, checkpoint unchanged).

### Code Quality Validation
- [ ] S2 edits ONLY the 3 src files (JSDoc/comments/1 WARN); no constants.ts, no tests, no behavioral logic.
- [ ] Each file's logger convention preserved (`this.logger` in fix-cycle; `this.#logger` in the agents).
- [ ] `errs` retained as a local in #validateAndHealBacklog (reused in the prompt at 383).
- [ ] Thrown AgentError messages untouched (test-referenced); Coder/Researcher WARNs untouched (already structured).

### Documentation & Deployment
- [ ] Mode-A JSDoc is the only doc artifact (rides with the code); no docs/*.md / README / .env.example changes.
- [ ] Commit message notes: this is a no-behavioral-change completion (confirm isolation + 1 WARN restructure +
      JSDoc); the fix-cycle WARN now carries sessionPath (no per-task id at backlog level); the Coder behavior
      test proves no regression; FORMAT_NUDGE_MAX is S1's (consumed, not redefined here).

---

## Anti-Patterns to Avoid

- ❌ Don't change nudge-loop behavior — S2 is JSDoc + comments + ONE WARN field-shape. The bounds
      (FORMAT_NUDGE_MAX from S1), prompts, re-parse, terminal errors, and checkpoint are UNCHANGED.
- ❌ Don't restructure the Coder (362) or Researcher (827) WARNs — they're ALREADY structured and compliant.
      Only fix-cycle:379 is inconsistent.
- ❌ Don't invent a taskId for the fix-cycle WARN — there is no per-task id at the backlog level. Use
      `this.sessionPath` (the contract explicitly allows "taskId or sessionPath").
- ❌ Don't delete `errs` when restructuring the fix-cycle WARN — it's reused in the nudge prompt (line 383);
      move it into a structured field, don't remove the variable.
- ❌ Don't touch the thrown AgentError messages ("…did not write PRP file…", "…did not return a parseable
      JSON result envelope…") — they're test-referenced (tests/helpers/research-seam.ts).
- ❌ Don't add an env/`.hack` knob for FORMAT_NUDGE_MAX — §4.5.1 deliberately gives it a fixed default;
      S1 made it a plain const. P3.M1.T1.S2 confirms "no .hack schema row."
- ❌ Don't edit constants.ts — S1 owns FORMAT_NUDGE_MAX. S2 references it in JSDoc/comments only.
- ❌ Don't add tests — behavior is unchanged and no test asserts the restructured WARN string (verified).
      Adding tests implies a behavior change, which is out of scope.
- ❌ Don't cross logger conventions — fix-cycle uses `this.logger`; the two agents use `this.#logger`.
- ❌ Don't skip the (a)/(d) CONFIRMATIONS — they're deliverables too (cite them in the commit message as
      verified-against-source, with the file:line evidence).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, no-behavioral-change completion task with every edit pinned to a
verified file:line and given as ready-to-paste before/after. The verification items (a)/(d) are
proven from source: prp-executor's isolation comment (349-354), structured WARN (362), and checkpoint
(386-397) already satisfy §4.5.1 — S2 confirms them, it doesn't rebuild them. The one real edit (b)
is fully specified, including WHY `sessionPath` is the identifier (no per-task id at backlog level)
and WHY `errs` stays a local (reused in the prompt). The test-impact analysis proves the restructure
is safe: no test asserts the WARN string, and the Coder test asserts behavior (1 initial + 2 nudges),
not WARN text — so S2's zero-behavioral-change guarantee is empirically grounded. The three JSDoc
completions are scoped per method role (detection / nudge / nudge+heal) and each carries the mandated
§4.5.1 + FORMAT_NUDGE_MAX + isolation content. S1's constant wiring is consumed, not duplicated.
Residual risks are mechanical and gate-caught: (a) a JSDoc prettier nit (auto-fixed via `npm run fix`);
(b) accidentally touching a WARN that was already compliant (the anti-patterns + the per-file "DO NOT
change" notes prevent this); (c) a stale line number after S1 lands (use the exact-text anchors, which
are robust to the ±1 line drift the S1 PRP itself flagged). No runtime/network/LLM unknowns.