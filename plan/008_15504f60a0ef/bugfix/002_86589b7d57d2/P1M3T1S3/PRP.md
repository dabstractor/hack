# PRP — P1.M3.T1.S3: Update stagecoach system prompt (no Conventional-Commit type/scope)

> Bugfix 002, **BUG-003 (MAJOR) — S3 (stagecoach prompt relaxation)**. PRD §5.1 mandates the
> standardized `<phase>.<milestone>.<task>.<subtask>:` task-prefix and FORBIDS the legacy
> `[PRP Auto]` banner **and Conventional-Commit scope encoding**. The §5.1 example
> `1.2.1.1: add createDeferredPromise utility and utils barrel` has a **plain descriptive imperative
> subject** — no `feat:`/`fix:` type prefix, no `(scope)`. Today the stagecoach agent's system prompt
> (`COMMIT_MESSAGE_SYSTEM`, `src/agents/commit-message-agent.ts:66–77`) MANDATES Conventional Commits
> ("`Type prefix: feat, fix, refactor…`") AND instructs the agent to "reference the work-item id in
> the subject" — both of which PRD §5.1 forbids (the **task-prefix now encodes position**, so a
> Conventional-Commit type/scope is redundant cruft and a P-id in the subject duplicates the prefix).
> This item **rewrites the prompt** so the agent emits a **plain descriptive imperative summary**
> (subject ≤72 chars, optional body explaining WHY), and updates the one test that asserts the prompt
> content. The agent's existing HARD RULES are KEPT VERBATIM (output only; no fences/preamble; do NOT
> emit `[PRP Auto]`/`Co-Authored-By`; `skip` for empty diff). **S2** (P1.M3.T1.S2, parallel) reworks
> `formatCommitMessage` to drop `[PRP Auto]` and layer the task-prefix; **S3→S4** in this doc's
> numbering (the plan's **P1.M3.T2.S1**) wires `position` through `smartCommit`. This item (S4 of the
> architecture's fix design) is a **2-file, ~15-line change**: the prompt const + its descriptive JSDoc
> + the test assertion. The architecture contract (`architecture/bug-003-commit-format.md`
> §"Stagecoach prompt" + §"S4 — stagecoach prompt update") prescribes the exact outcome; this PRP fuses
> that spec with the codebase's **verbatim current prompt text**, the **caller-flow invariant**
> (`generateCommitMessage` returns the bare descriptive message; `formatCommitMessage` adds prefix +
> trailer), and the **vitest prompt-assertion pattern**.

---

## Goal

**Feature Goal**: Rewrite `COMMIT_MESSAGE_SYSTEM` in `src/agents/commit-message-agent.ts` so the
stagecoach agent emits a **plain descriptive imperative summary** (no Conventional-Commit type prefix,
no `(P-id)` scope, no work-item-id-in-subject instruction), while KEEPING the existing hard rules
verbatim (output-only, no fences/preamble, do NOT emit `[PRP Auto]`/`Co-Authored-By`, `skip` for empty
diff). Refresh the const's own JSDoc + the module's stale "conventional-commit"/`[PRP Auto]` prose so
the module reads coherently after the change. Update `tests/unit/agents/commit-message-agent.test.ts`
so the prompt-content assertion NO LONGER requires a Conventional-Commit type, NO LONGER instructs
referencing the P-id in the subject, and STILL forbids the agent emitting `[PRP Auto]`/`Co-Authored-By`.

**Deliverable**:
1. **`src/agents/commit-message-agent.ts`** — REWRITE the `COMMIT_MESSAGE_SYSTEM` const (lines 66–77):
   replace the `Follow Conventional Commits … Type prefix: feat, fix, …` block + the
   `If a work-item id appears in changed paths … reference it in the subject.` line with a
   "plain descriptive imperative summary" instruction; KEEP the HARD RULES block verbatim; KEEP the
   `≤72 characters` + `imperative mood` + `optional body explaining WHY` lines. UPDATE the const's
   JSDoc (lines 56–64) + module `@remarks` (line 8 + lines 27–31) to drop the "conventional-commit" /
   "Conventional Commits 1.0.0 spec" / `[PRP Auto]` wording (the latter goes stale after S2).
2. **`tests/unit/agents/commit-message-agent.test.ts`** — UPDATE the `it('should set a system prompt
   instructing conventional-commit output', …)` test (lines 127–143): DROP the
   `expect(cfg.system).toContain('Conventional Commits')` assertion; ADD negative assertions that the
   prompt does NOT mandate a type prefix and does NOT instruct referencing a P-id in the subject; KEEP
   `toContain('imperative')` + `toContain('[PRP Auto]')` + `toContain('Co-Authored-By')` (the hard
   rule text still mentions those tokens, so they still pass). Rename the test title to reflect the
   new contract. The other 9 config-field assertions in the file are UNAFFECTED.

**Success Definition**:
- The agent's system prompt NO LONGER contains any Conventional-Commit type mandate (`feat`/`fix`/
  `refactor`/`chore`/… type list) and NO LONGER contains the "reference the work-item id in the
  subject" instruction (verified by `expect(cfg.system).not.toMatch(/type prefix|Conventional Commits/i)`
  and `not.toMatch(/reference.*in the subject/i)`).
- The agent's system prompt STILL instructs an imperative subject ≤72 chars with an optional
  WHY-body; STILL contains the verbatim HARD RULES (output-only, no fences/preamble, no
  `[PRP Auto]`/`Co-Authored-By`, `skip` for empty diff).
- `tests/unit/agents/commit-message-agent.test.ts` is GREEN after the assertion update.
- `npm run typecheck && npm run lint && npm run format:check` clean.
- NO executable logic change (const string + JSDoc + assertions only) → 100% coverage gate unaffected.

---

## User Persona (if applicable)

**Target User**: Maintainer reading the git history + the LLM (stagecoach agent) that generates the
descriptive subject. End users are unaffected (this is an internal commit-message-generation prompt).

**Use Case**: Each committed subtask carries a `<n.n.n[.n]>:` task-prefix (layered by the caller, S2/S3)
over a **plain descriptive imperative summary** generated by the agent — e.g.
`1.2.1.1: add createDeferredPromise utility and utils barrel`, NOT
`feat(utils): add createDeferredPromise utility [P1.M2.T1.S1]` (the old Conventional-Commit + P-id form).

**Pain Points Addressed**: The agent emits `feat(...)`/`fix(...)` Conventional-Commit subjects and
duplicates the work-item id in the subject — exactly the redundant decoration PRD §5.1 forbids and that
the task-prefix was designed to replace.

---

## Why

- **BUG-003 S3: the prompt still mandates Conventional Commits + P-id-in-subject.** The stagecoach
  prompt (`commit-message-agent.ts:66–77`) tells the agent to use a `feat`/`fix`/`refactor`/… type
  prefix and to "reference the work-item id in the subject". PRD §5.1 forbids Conventional-Commit
  **scope** and layers the task-prefix as the sole position/decoration carrier — so a type prefix and
  a P-id in the subject are redundant cruft. This item relaxes the prompt to a plain descriptive
  imperative summary. It is the non-negotiable companion slice to S2 (which reworks `formatCommitMessage`
  to drop `[PRP Auto]` and layer the task-prefix): **S2 controls the decoration; S3 controls the
  summary the decoration wraps.**
- **The hard rules are load-bearing and MUST stay.** `generateCommitMessage`
  (`src/utils/git-commit.ts:155–200`) returns the agent's trimmed output as the **bare descriptive
  message** and treats `'skip'`/empty as a generation failure (→ `AgentError` → retry → fallback). The
  caller (`formatCommitMessage`) adds the trailer (+ task-prefix in task-prefix mode). So the agent
  MUST NOT emit `[PRP Auto]`/`Co-Authored-By` and MUST emit `'skip'` for an empty diff — these rules
  are unchanged and still asserted.
- **S2 is parallel; S3 is file-disjoint.** S2 edits `src/utils/git-commit.ts` + its test; S3 edits
  `src/agents/commit-message-agent.ts` + its test. **No file-level conflict.** The one shared concern
  is the stale `[PRP Auto]` prose at `commit-message-agent.ts:30` — it lives in **S3's** file, so S3
  owns rewording it to the post-S2 wording (caller wraps via `formatCommitMessage` → task-prefix/plain
  subject + trailer).
- **Scope discipline.** This slice touches ONLY the 2 files named above. It does NOT touch
  `formatCommitMessage`, `smartCommit`, `constants.ts`, the call sites, or any other test. Zero
  executable-logic change.

---

## What

### User-visible behavior
The stagecoach agent's generated commit subjects change shape: instead of `feat(api): add endpoint`,
the agent now emits `add endpoint` (plain descriptive imperative). The caller (S2/S3) then layers the
task-prefix → `1.2.1.1: add endpoint` (task-prefix mode) or uses it verbatim → `add endpoint`
(plain mode). The `[PRP Auto]`/`Co-Authored-By` banner/trailer behavior is S2's concern; S3 only
ensures the **summary** the agent produces is plain and descriptive.

### Technical requirements (exact contract — from architecture/bug-003-commit-format.md §"Stagecoach prompt" + §"S4")

In `src/agents/commit-message-agent.ts`:

**(a) REWRITE the `COMMIT_MESSAGE_SYSTEM` const** (replace lines 66–77). The new const text (prescribed
verbatim — implement as-is, formatting handled by prettier):

```ts
const COMMIT_MESSAGE_SYSTEM = `You generate concise git commit messages from staged diffs.

Write a PLAIN DESCRIPTIVE summary of the change (imperative mood).
- Subject line in imperative mood, ≤72 characters, no trailing period.
- Do NOT add a Conventional-Commit type prefix (no "feat:", "fix:", "refactor:", etc.) and do NOT add a "(scope)" — the caller layers the task-position prefix separately.
- Do NOT reference any work-item id (e.g. P3.M1.T3.S1) in the subject — the caller's task-prefix already encodes the position.
- Optional blank line + body explaining WHY (not WHAT — the diff shows what).

HARD RULES:
- Output ONLY the commit message (subject + optional body). No explanation.
- No markdown fences, no leading/trailing whitespace, no preamble.
- Do NOT include "[PRP Auto]", "Co-Authored-By", or any trailer — the caller adds those.
- If the diff is empty or whitespace-only, output the single word "skip".`;
```

Net change vs. the current text:
- **REMOVE**: the `Follow Conventional Commits (https://www.conventionalcommits.org/):` line + the
  `- Type prefix: feat, fix, refactor, docs, chore, test, perf, build, ci.` line.
- **REMOVE**: the `- If a work-item id appears in changed paths (e.g. P3.M1.T3.S1), reference it in the
  subject.` line.
- **ADD**: the two explicit "Do NOT add a Conventional-Commit type prefix…" + "Do NOT reference any
  work-item id…" guidance lines (turn the old positive mandate into an explicit prohibition so the LLM
  does not regress to Conventional-Commit form).
- **KEEP verbatim**: `Subject line in imperative mood, ≤72 characters, no trailing period.`;
  `Optional blank line + body explaining WHY (not WHAT — the diff shows what).`; and the ENTIRE
  `HARD RULES:` block (4 rules, unchanged).

**(b) UPDATE the `COMMIT_MESSAGE_SYSTEM` JSDoc** (lines 56–64) so it stops claiming "conventional-commit"
and "Conventional Commits 1.0.0 spec". New JSDoc:

```ts
/**
 * System prompt instructing the agent to emit a plain descriptive imperative
 * summary (PRD §5.1 "Commit Message Format (Standardized Task-Prefix)").
 *
 * @remarks
 * PRD §5.1 forbids Conventional-Commit type/scope and the [PRP Auto] banner —
 * the standardized task-prefix (`<phase>.<milestone>.<task>[.<subtask>]:`)
 * carries the item's position, so a type prefix and a work-item id in the
 * subject are redundant. The agent therefore emits ONLY the plain descriptive
 * subject (+ optional WHY body); the caller (`formatCommitMessage` in
 * `src/utils/git-commit.ts`) layers the task-prefix and appends the
 * Co-Authored-By trailer. Hard rules ensure the output is a bare message the
 * caller can wrap — a verbose agent output would corrupt the commit.
 */
```

**(c) UPDATE the module `@remarks` stale wording** (line 8 + lines 27–31):
- Line 8: `descriptive conventional-commit messages from a staged diff` →
  `descriptive commit messages from a staged diff` (drop "conventional-commit").
- Lines 27–31 (the caller-wrap paragraph): reword to the post-S2 wording so the module does not claim
  the caller adds `[PRP Auto]` (S2 removes it). New text:
  ```
  * The agent emits ONLY the commit message (subject + optional body). The caller
  * (generateCommitMessage in src/utils/git-commit.ts) wraps the output via
  * formatCommitMessage, which layers the standardized task-prefix (or emits the
  * subject plain per PRP §5.1) and appends the Co-Authored-By trailer. The
  * system prompt forbids the agent from emitting the prefix/trailer.
  ```

**(d) DO NOT touch** the `createCommitMessageAgent()` factory body (lines 103–122): persona, role,
maxTokens, enableReflection, enableCache, stateless, and the `system: COMMIT_MESSAGE_SYSTEM` field
binding all stay. S3 changes ONLY the const's TEXT + the descriptive JSDoc around it. (The `system:`
field still references the same const name — no wiring change.)

### Success Criteria
- [ ] `COMMIT_MESSAGE_SYSTEM` const contains NO Conventional-Commit type mandate (no `feat`/`fix`/
      `refactor`/`chore`/… type-list line; no "Follow Conventional Commits" line).
- [ ] `COMMIT_MESSAGE_SYSTEM` const contains NO "reference the work-item id in the subject" instruction.
- [ ] `COMMIT_MESSAGE_SYSTEM` const STILL contains: imperative-mood + `≤72 characters` + optional WHY
      body + the 4 verbatim HARD RULES (output-only / no fences / no `[PRP Auto]`/`Co-Authored-By` /
      `skip` for empty diff).
- [ ] `COMMIT_MESSAGE_SYSTEM` JSDoc (lines 56–64) updated (no "conventional-commit" / "Conventional
      Commits 1.0.0 spec" claims).
- [ ] Module `@remarks` line 8 + lines 27–31 updated (no "conventional-commit"; no stale `[PRP Auto]`
      caller-claim — now describes the task-prefix/plain wrap).
- [ ] `tests/unit/agents/commit-message-agent.test.ts` prompt-content test updated: no longer requires
      a Conventional-Commit type; no longer instructs P-id-in-subject; STILL forbids the agent emitting
      `[PRP Auto]`/`Co-Authored-By`; STILL requires `imperative`.
- [ ] The other 9 config-field assertions in the test file UNAFFECTED (persona/role, name, maxTokens,
      reflection, cache, mcps, stateless, model/harness/env).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/agents/commit-message-agent.test.ts` GREEN.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the
verbatim current const text, the verbatim new const text, the exact lines to remove/keep/add, the
exact JSDoc rewrites (const-level + module-level), the exact test-assertion changes (which asserts to
drop / keep / add), the caller-flow invariant (why the hard rules stay), the architecture contract
(quoted), the PRD §5.1 example subject, the npm scripts, and the hard scope boundary (2 files only).
See `research/01-codebase-facts.md` for per-claim evidence.

### Documentation & References
```yaml
# MUST READ — the authoritative architecture spec (S4 block + Stagecoach-prompt section are quoted)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-003-commit-format.md
  section: "Stagecoach prompt (`src/agents/commit-message-agent.ts:69-77`)" AND "Fix design → S4 — stagecoach prompt update"
  why: Prescribes the EXACT S4 outcome: "relax the prompt so the agent emits a plain descriptive imperative
       summary (no Conventional-Commit type, no (P-id) scope); the task-prefix is layered on by the caller.
       Keep 'Output ONLY the commit message', the 'skip' empty-diff rule, and the 'no banner/trailer' rule."
  critical: KEEP the hard rules verbatim. The two REMOVABLES are the Conventional-Commits type mandate and
            the P-id-in-subject instruction. Do NOT drop the [PRP Auto]/Co-Authored-By prohibition.

# MUST READ — PRD §5.1 (the contract this realizes)
- file: PRD.md
  section: "5.1 Commit Message Format (Standardized Task-Prefix)"
  why: Example `1.2.1.1: add createDeferredPromise utility and utils barrel` — the descriptive part is a
       PLAIN imperative summary (no type prefix, no scope). "[PRP Auto] banner and Conventional-Commit scope
       MUST NOT be prepended. The task-prefix already encodes the item's position; layering both on top is
       redundant cruft." Non-task commits degrade to plain.
  critical: The agent must emit a clean plain descriptive subject usable verbatim in plain mode AND under
            the task-prefix in task-prefix mode. No type/scope, no P-id duplication.

# THE FILE TO EDIT (source) — rewrite the const + its JSDoc + module @remarks stale wording
- file: src/agents/commit-message-agent.ts
  why: EDIT — rewrite COMMIT_MESSAGE_SYSTEM (66-77); update its JSDoc (56-64); fix module @remarks line 8 +
       lines 27-31. Do NOT touch createCommitMessageAgent() body (103-122).
  pattern_const: "the const is a backtick template literal assigned to `const COMMIT_MESSAGE_SYSTEM`; the
                  factory binds it via `system: COMMIT_MESSAGE_SYSTEM` at line 108 — that binding is UNCHANGED."
  pattern_jsdoc: "every const/fn in this module carries a `@remarks` block citing the PRD section + a
                  `@example`. Match that style in the rewritten JSDoc."
  critical: The HARD RULES block inside the const (lines 73-77) is KEPT VERBATIM — it is load-bearing:
            generateCommitMessage treats 'skip'/empty as failure and formatCommitMessage adds the trailer;
            the agent MUST NOT emit [PRP Auto]/Co-Authored-By and MUST emit 'skip' for empty diffs.

# THE CALLER CONTRACT (why the hard rules stay) — READ-ONLY here (S2 owns the rework)
- file: src/utils/git-commit.ts
  section: "generateCommitMessage (lines 155-200)" + "smartCommit generateMessage path (480-525)"
  why: READ-ONLY. generateCommitMessage returns the agent's TRIMMED output as the bare descriptive message
       (throws on 'skip'/empty). The caller wraps it via formatCommitMessage (S2: task-prefix/plain subject
       + Co-Authored-By trailer). So the agent must emit a bare descriptive message + 'skip' on empty diff,
       and must NOT emit the trailer/prefix. This is WHY the hard rules stay.
  critical: Do NOT edit this file — S2 owns it. The generateCommitMessage JSDoc example `'feat(api): add
            endpoint'` (~line 190) is S2's to update (it is in S2's file, not S3's).

# THE TEST FILE TO EDIT — update the prompt-content assertion
- file: tests/unit/agents/commit-message-agent.test.ts
  why: EDIT — S3 owns this file's prompt-content test (lines 127-143). DROP `toContain('Conventional Commits')`;
       ADD `not.toMatch(/type prefix|Conventional Commits/i)` + `not.toMatch(/reference.*in the subject/i)`;
       KEEP `toContain('imperative')` + `toContain('[PRP Auto]')` + `toContain('Co-Authored-By')`.
  pattern_assert: "the file captures the agent config via `mockCreateAgent.mock.calls[0][0] as { system: string }`
                   and asserts `cfg.system.toContain(...)`. The 9 OTHER config-field assertions (persona/role,
                   name, maxTokens, reflection, cache, mcps, stateless, model/harness/env) are UNAFFECTED."
  critical: `toContain('[PRP Auto]')` + `toContain('Co-Authored-By')` STILL PASS after the edit — the hard
            rule text still mentions those tokens (the rule forbids EMITTING them; the token is still IN the
            prompt as the prohibition). Do NOT remove these two assertions; they guard the load-bearing rule.

# THE INPUT CONTRACT (S1 — COMPLETE; the format toggle the caller reads)
- file: src/config/constants.ts
  why: READ-ONLY here. getPrpCommitFormat()/PrpCommitFormat (S1, DONE) control whether the caller (S2/S3)
       layers the task-prefix or uses the agent's subject plain. The agent itself is FORMAT-AGNOSTIC — it
       always emits a plain descriptive summary; the caller decides prefix-or-plain.
  critical: No constants.ts change in S3. The agent prompt must NOT mention PRP_COMMIT_FORMAT or branch on
            format — it emits ONE plain descriptive summary for both modes.

# OUT OF SCOPE (hard boundary — DO NOT TOUCH in S3)
- file: src/utils/git-commit.ts                 # S2 — formatCommitMessage rework + generateCommitMessage JSDoc/example
- file: src/config/constants.ts                 # S1 (DONE) — getPrpCommitFormat/PrpCommitFormat
- file: src/core/task-orchestrator.ts           # S3-of-plan (P1.M3.T2.S1) — wires position through smartCommit call sites
- file: src/workflows/bug-hunt-workflow.ts      # S3-of-plan — non-backlog call site
- file: tests/unit/utils/git-commit.test.ts     # S2 — formatCommitMessage/parseItemPosition/buildTaskPrefix tests
- file: tests/integration/smart-commit.test.ts  # S3-of-plan — wires position through smartCommit
- file: docs/CONFIGURATION.md                   # S1 (DONE) — PRP_COMMIT_FORMAT row
```

### Current Codebase tree (relevant slice)
```bash
src/agents/commit-message-agent.ts           # EDIT: rewrite COMMIT_MESSAGE_SYSTEM (66-77) + its JSDoc (56-64) + module @remarks (line 8, 27-31)
src/utils/git-commit.ts                      # READ-ONLY (S2): generateCommitMessage caller (155-200) + smartCommit wrap (480-525)
src/config/constants.ts                      # READ-ONLY (S1 DONE): getPrpCommitFormat/PrpCommitFormat
tests/unit/agents/commit-message-agent.test.ts  # EDIT: update prompt-content test (127-143)
tests/unit/agents/cleanup-agent.test.ts      # READ-ONLY: references commit-message-agent in COMMENT-only; UNAFFECTED
tests/unit/protected-files.test.ts           # READ-ONLY: mocks createCommitMessageAgent as no-op import stub; UNAFFECTED
```

### Desired Codebase tree with files to be added/edited
```bash
src/agents/commit-message-agent.ts           # MODIFIED (const text + const JSDoc + module @remarks wording; factory body UNCHANGED)
tests/unit/agents/commit-message-agent.test.ts  # MODIFIED (1 prompt-content test block updated; 9 config-field tests UNCHANGED)
# (no new files; no new deps; no executable-logic change)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — KEEP the HARD RULES block VERBATIM (const lines 73-77). It is load-bearing:
//   generateCommitMessage (git-commit.ts:155-200) returns the agent's trimmed output as the BARE
//   descriptive message and throws on 'skip'/empty (→ AgentError → retry → fallback). The caller
//   (formatCommitMessage, S2) adds the trailer (+ task-prefix in task-prefix mode). So the agent
//   MUST NOT emit [PRP Auto]/Co-Authored-By and MUST emit 'skip' for empty diffs. Dropping these
//   rules breaks the caller contract.

// CRITICAL — Do NOT remove the test assertions `toContain('[PRP Auto]')` + `toContain('Co-Authored-By')`.
//   They STILL PASS after the edit because the hard-rule text still MENTIONS those tokens (the rule
//   forbids EMITTING them; the token remains in the prompt as the prohibition target). These two
//   assertions guard the load-bearing "no trailer/prefix" rule — keep them.

// CRITICAL — The two REMOVABLES are exactly: (1) the Conventional-Commits type mandate
//   ("Follow Conventional Commits … Type prefix: feat, fix, …"), and (2) the "reference the work-item
//   id in the subject" instruction. Removing anything else (imperative mood, ≤72 chars, WHY body, the
//   4 hard rules) is OUT OF SCOPE and would regress the contract.

// CRITICAL — Turn the removed positive mandate into an explicit PROHIBITION. LLMs regress to familiar
//   forms; an explicit "Do NOT add a Conventional-Commit type prefix" + "Do NOT reference any work-item
//   id in the subject" line is more robust than mere silence. (This is why the new const ADDS two
//   negative-guidance lines instead of just deleting the old ones.)

// GOTCHA — The agent must be FORMAT-AGNOSTIC. It must NOT mention PRP_COMMIT_FORMAT, task-prefix, or
//   "1.2.1.1:" — the caller (S2/S3) owns prefixing. The agent emits ONE plain descriptive summary for
//   BOTH modes (task-prefix wraps it; plain uses it verbatim). Mentioning the prefix in the prompt risks
//   the agent duplicating it in the subject.

// GOTCHA — prettier is ERROR-enforced (format:check). The rewritten const + JSDoc may reflow; run
//   `npm run fix` (lint:fix + prettier --write) BEFORE format:check. Let the formatter own alignment.

// GOTCHA — bugfix BUG-004: the FULL `npm run test:run` is PRE-EXISTING-RED (178 failures — P1.M4 scope).
//   Do NOT use it as the gate. Gate = typecheck + lint + format:check + the edited test file.

// GOTCHA — 100% coverage gate (vitest.config.ts) is UNAFFECTED: S3 changes NO executable code (const
//   text + JSDoc + assertions). The factory body (the only executable code in the module) is UNCHANGED.

// CRITICAL — DO NOT touch createCommitMessageAgent() body (lines 103-122), formatCommitMessage,
//   smartCommit, constants.ts, the call sites, or any test other than the prompt-content block. Those
//   are S2 / S1 / S3-of-plan. S3 ships ONLY the prompt const + its descriptive JSDoc + the one test block.
```

---

## Implementation Blueprint

### Data models and structure
None — S3 changes a string constant, its descriptive JSDoc, and one test block. No types, no
interfaces, no executable logic. (`PrpCommitFormat` / `ItemPosition` exist in S1/S2's files; S3 does
not import or reference them.)

### Implementation Tasks (ordered to keep the gate GREEN at each checkpoint)
```yaml
Task 1: EDIT src/agents/commit-message-agent.ts — REWRITE the COMMIT_MESSAGE_SYSTEM const
  - REPLACE the const at lines 66-77 with the new text specified in "Technical requirements (a)".
    Net: REMOVE the "Follow Conventional Commits … Type prefix: …" lines + the "reference the work-item
    id in the subject" line; ADD two explicit "Do NOT add a Conventional-Commit type prefix…" + "Do NOT
    reference any work-item id…" lines; KEEP imperative/≤72/WHY-body + the 4 HARD RULES verbatim.
  - The `system: COMMIT_MESSAGE_SYSTEM` binding at line 108 is UNCHANGED (same const name).
  - AFTER Task 1: the const no longer mandates Conventional Commits, but the test at lines 127-143 still
    asserts `toContain('Conventional Commits')` → that test is now RED (EXPECTED — Task 3 fixes it).
  - VERIFY: `npm run typecheck` clean (string literal change — no type impact).

Task 2: EDIT src/agents/commit-message-agent.ts — UPDATE the descriptive JSDoc (const-level + module-level)
  - STEP 2a — REPLACE the COMMIT_MESSAGE_SYSTEM JSDoc (lines 56-64) with the new block from "Technical
    requirements (b)" (drop "conventional-commit message" + "Conventional Commits 1.0.0 spec"; cite
    PRD §5.1 + the task-prefix-as-position-carrier rationale).
  - STEP 2b — REWORD module @remarks line 8: `descriptive conventional-commit messages` →
    `descriptive commit messages` (drop "conventional-commit").
  - STEP 2c — REWORD module @remarks lines 27-31 (the caller-wrap paragraph) to the post-S2 wording
    from "Technical requirements (c)": describe formatCommitMessage as layering the task-prefix (or
    emitting plain per PRD §5.1) + appending the trailer — NOT "the [PRP Auto] prefix". (This line goes
    stale after S2 removes the banner; S3 owns it because it is in S3's file.)
  - VERIFY: `npm run typecheck` clean (JSDoc-only; no code impact).

Task 3: EDIT tests/unit/agents/commit-message-agent.test.ts — UPDATE the prompt-content test (127-143)
  - RENAME the test: `it('should set a system prompt instructing conventional-commit output', …)` →
    `it('should set a system prompt instructing a plain descriptive imperative summary', …)`.
  - DROP: `expect(cfg.system).toContain('Conventional Commits');` (no longer Conventional-Commits).
  - ADD negative assertions (the new contract):
      expect(cfg.system).not.toMatch(/type prefix|Conventional Commits/i);     // no type mandate
      expect(cfg.system).not.toMatch(/reference.*(?:work-item|id).*in the subject/i); // no P-id-in-subject
  - KEEP: `expect(cfg.system).toContain('imperative');` (imperative mood stays).
  - KEEP: `expect(cfg.system).toContain('[PRP Auto]');` + `expect(cfg.system).toContain('Co-Authored-By');`
    (the hard-rule text still mentions those tokens as prohibition targets — they STILL PASS).
  - The other 9 config-field tests in the file are UNCHANGED.
  - VERIFY: `npx vitest run tests/unit/agents/commit-message-agent.test.ts` GREEN.

Task 4: FORMAT + VERIFY
  - RUN: npm run fix  → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/agents/commit-message-agent.test.ts    # the edited file → GREEN.
  - DO NOT run the full `npm run test:run` (pre-existing red — BUG-004, P1.M4 scope).
  - EXPECTED: typecheck/lint/format clean; edited file GREEN (all 10 tests pass: 9 unchanged config-field
    tests + the updated prompt-content test). If the prompt-content test fails → (a) a negative assertion
    regex is too broad and matches a kept token (loosen it); (b) the kept toContain assertions were
    accidentally removed (re-add them — the hard rule still mentions those tokens).
```

### Implementation Patterns & Key Details
```ts
// ---- src/agents/commit-message-agent.ts: the new const (Task 1) ----
const COMMIT_MESSAGE_SYSTEM = `You generate concise git commit messages from staged diffs.

Write a PLAIN DESCRIPTIVE summary of the change (imperative mood).
- Subject line in imperative mood, ≤72 characters, no trailing period.
- Do NOT add a Conventional-Commit type prefix (no "feat:", "fix:", "refactor:", etc.) and do NOT add a "(scope)" — the caller layers the task-position prefix separately.
- Do NOT reference any work-item id (e.g. P3.M1.T3.S1) in the subject — the caller's task-prefix already encodes the position.
- Optional blank line + body explaining WHY (not WHAT — the diff shows what).

HARD RULES:
- Output ONLY the commit message (subject + optional body). No explanation.
- No markdown fences, no leading/trailing whitespace, no preamble.
- Do NOT include "[PRP Auto]", "Co-Authored-By", or any trailer — the caller adds those.
- If the diff is empty or whitespace-only, output the single word "skip".`;

// ---- the updated prompt-content test (Task 3) — before → after ----
// BEFORE:
//   it('should set a system prompt instructing conventional-commit output', () => {
//     createCommitMessageAgent();
//     const cfg = mockCreateAgent.mock.calls[0][0] as { system: string };
//     expect(cfg.system).toContain('Conventional Commits');
//     expect(cfg.system).toContain('imperative');
//     expect(cfg.system).toContain('[PRP Auto]');
//     expect(cfg.system).toContain('Co-Authored-By');
//   });
// AFTER:
//   it('should set a system prompt instructing a plain descriptive imperative summary', () => {
//     createCommitMessageAgent();
//     const cfg = mockCreateAgent.mock.calls[0][0] as { system: string };
//     // MUST NOT mandate a Conventional-Commit type/scope (PRD §5.1 forbids it; task-prefix carries position).
//     expect(cfg.system).not.toMatch(/type prefix|Conventional Commits/i);
//     // MUST NOT instruct referencing a work-item id in the subject (task-prefix already encodes position).
//     expect(cfg.system).not.toMatch(/reference.*(?:work-item|id).*in the subject/i);
//     // STILL requires an imperative summary.
//     expect(cfg.system).toContain('imperative');
//     // STILL forbids the agent emitting [PRP Auto]/Co-Authored-By (caller adds the trailer).
//     expect(cfg.system).toContain('[PRP Auto]');
//     expect(cfg.system).toContain('Co-Authored-By');
//   });
```

### Integration Points
```yaml
COMMIT-MESSAGE-AGENT.TS (src/agents/commit-message-agent.ts):
  - REWRITE COMMIT_MESSAGE_SYSTEM (66-77): plain descriptive imperative summary; remove type mandate +
    P-id-in-subject; keep imperative/≤72/WHY + the 4 HARD RULES.
  - UPDATE const JSDoc (56-64): drop "conventional-commit"/"Conventional Commits 1.0.0 spec"; cite §5.1.
  - UPDATE module @remarks line 8 (drop "conventional-commit") + lines 27-31 (post-S2 caller-wrap wording).
  - PRESERVE: createCommitMessageAgent() body (103-122) UNCHANGED — persona/role/maxTokens/reflection/
    cache/stateless + the `system: COMMIT_MESSAGE_SYSTEM` binding all stay.

GIT-COMMIT.TS (src/utils/git-commit.ts):
  - NO CHANGE in S3 (S2 owns it). READ-ONLY reference: generateCommitMessage returns the agent's bare
    descriptive message; formatCommitMessage wraps it (task-prefix/plain + trailer). This is WHY the
    agent hard rules (no trailer/prefix, 'skip' on empty) are load-bearing and KEPT.

CONSTANTS.TS (src/config/constants.ts):
  - NO CHANGE (S1 DONE). The agent is FORMAT-AGNOSTIC — it emits one plain summary for both modes.

TESTS (tests/unit/agents/commit-message-agent.test.ts):
  - UPDATE the prompt-content test (127-143): drop Conventional-Commits require; add 2 negative assertions;
    keep imperative + the 2 token-mentions. Rename test title.
  - PRESERVE: the 9 other config-field tests UNCHANGED.

DOWNSTREAM (S2 parallel; S3-of-plan P1.M3.T2.S1 after):
  - S2 reworks formatCommitMessage (task-prefix/plain + trailer; removes [PRP Auto]); S3-of-plan wires
    `position` through smartCommit + the call sites. S3 (THIS item) only relaxes the agent's summary shape;
    it is independent of both (disjoint files). The module-@remarks line-30 reword (Task 2c) describes the
    post-S2 end-state S3 lands into.

OUT OF SCOPE (hard boundary):
  - src/utils/git-commit.ts (S2), src/config/constants.ts (S1), src/core/task-orchestrator.ts +
    src/workflows/bug-hunt-workflow.ts (S3-of-plan), tests/unit/utils/git-commit.test.ts (S2),
    tests/integration/smart-commit.test.ts (S3-of-plan), docs/CONFIGURATION.md (S1).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — the const + JSDoc may reflow)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean (string-literal + JSDoc change → no type impact)
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. Likely failures:
#   - lint error only if an unused var slips in (none expected — no import/logic change).
#   - format:check error if the const/JSDoc was hand-aligned — run `npm run fix` first.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The EDITED file — MUST be GREEN (the updated prompt-content test + 9 unchanged config-field tests):
npx vitest run tests/unit/agents/commit-message-agent.test.ts
# Expected: 10 tests pass (9 unchanged + the renamed/updated prompt-content test). If the prompt-content
#   test fails → (a) a negative-assertion regex is too broad and matches a kept token (loosen the regex);
#   (b) the kept toContain('[PRP Auto]')/toContain('Co-Authored-By') assertions were removed (re-add them —
#   the hard rule still MENTIONS those tokens, so they still pass).
# Do NOT run the full `npm run test:run` — pre-existing red (BUG-004, P1.M4 scope).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm the new const shape (the 2 REMOVABLES are gone; the KEEPS are present):
grep -n "Conventional Commits\|Type prefix: feat" src/agents/commit-message-agent.ts   # expect ZERO hits in the const (the JSDoc may still cite §5.1's "forbids Conventional-Commit" rationale — that's fine)
grep -n "reference it in the subject\|reference.*work-item id.*in the subject" src/agents/commit-message-agent.ts  # expect ZERO hits
grep -n "imperative\|≤72\|HARD RULES\|\[PRP Auto\]\|Co-Authored-By\|skip" src/agents/commit-message-agent.ts  # expect hits in the const (KEPT)
# Confirm the const JSDoc + module @remarks no longer claim "conventional-commit"/"[PRP Auto] caller prefix":
grep -n "conventional-commit" src/agents/commit-message-agent.ts   # expect ZERO (line 8 reworded)
grep -n "\[PRP Auto\] prefix" src/agents/commit-message-agent.ts   # expect ZERO (line 30 reworded to task-prefix/plain)
# Confirm the test reflects the new contract:
grep -n "toContain('Conventional Commits')" tests/unit/agents/commit-message-agent.test.ts  # expect ZERO (dropped)
grep -n "not.toMatch" tests/unit/agents/commit-message-agent.test.ts                         # expect 2 hits (the added negative assertions)
grep -n "toContain('\[PRP Auto\]')\|toContain('Co-Authored-By')" tests/unit/agents/commit-message-agent.test.ts  # expect 2 hits (KEPT)
# Confirm the factory body is UNCHANGED (config fields intact):
grep -n "name: 'CommitMessageAgent'\|maxTokens: 512\|enableReflection: false\|enableCache: false\|stateless: true\|system: COMMIT_MESSAGE_SYSTEM" src/agents/commit-message-agent.ts  # expect all hits present
# Build emits dist/ cleanly (proves no accidental type/syntax breakage from the const edit):
npx tsc -p tsconfig.build.json
# Expected: all greps return expected hit counts; build clean; factory body intact.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP/LLM (a prompt-string change). Domain checks (record in commit message):
#   1. The agent prompt NO LONGER mandates a Conventional-Commit type/scope — verified by the 2 negative
#      assertions (not.toMatch type prefix / Conventional Commits) + grep "Type prefix: feat" → 0 hits.
#   2. The agent prompt NO LONGER instructs referencing a P-id in the subject — verified by the negative
#      assertion + grep → 0 hits. (The task-prefix, layered by the caller, now carries position.)
#   3. The agent prompt STILL produces a clean descriptive imperative summary usable verbatim in plain mode
#      AND under the task-prefix in task-prefix mode (imperative mood + ≤72 chars + optional WHY body kept).
#   4. The HARD RULES are intact (output-only / no fences / no [PRP Auto]/Co-Authored-By / 'skip' on empty)
#      — verified by the 2 kept toContain assertions + grep.
#   5. The agent is FORMAT-AGNOSTIC — the prompt mentions NO PRP_COMMIT_FORMAT / task-prefix / "1.2.1.1:"
#      (the caller owns prefixing). grep "PRP_COMMIT_FORMAT\|task-prefix\|1\.2\.1\.1" → 0 hits in the const.
#   6. No file-disjoint conflict with S2: src/agents/commit-message-agent.ts (S3) vs src/utils/git-commit.ts
#      (S2). The module-@remarks line-30 reword describes the post-S2 end-state S3 lands into.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/agents/commit-message-agent.test.ts` GREEN (10 tests).

### Feature Validation
- [ ] `COMMIT_MESSAGE_SYSTEM` const has NO Conventional-Commit type mandate and NO P-id-in-subject rule.
- [ ] `COMMIT_MESSAGE_SYSTEM` const STILL has imperative/≤72/WHY-body + the 4 verbatim HARD RULES.
- [ ] Agent prompt is FORMAT-AGNOSTIC (no PRP_COMMIT_FORMAT/task-prefix mention).
- [ ] Test: dropped `toContain('Conventional Commits')`; added 2 negative assertions; kept `imperative` +
      `[PRP Auto]` + `Co-Authored-By` token assertions.
- [ ] 9 other config-field tests UNCHANGED.

### Code Quality Validation
- [ ] Const JSDoc (56-64) + module @remarks (line 8, 27-31) updated to drop "conventional-commit" / stale
      `[PRP Auto]` caller-claim (now describes the post-S2 task-prefix/plain wrap).
- [ ] `createCommitMessageAgent()` body (103-122) UNCHANGED.
- [ ] Only `src/agents/commit-message-agent.ts` + `tests/unit/agents/commit-message-agent.test.ts` touched.
- [ ] JSDoc style matches the module's existing `@remarks`-cites-PRD-section + `@example` convention.

### Documentation & Deployment
- [ ] DOCS: none (internal prompt — the item's MOCKING point 6). The JSDoc rewrites ride with the change
      (Mode A); no docs/ edits.
- [ ] Commit message records: BUG-003 S3; the 2 REMOVABLES (type mandate + P-id-in-subject) and why
      (task-prefix encodes position per PRD §5.1); the KEEPS (hard rules, imperative, ≤72, WHY body);
      the explicit-prohibition (turn removed mandate into "Do NOT…"); the format-agnostic invariant;
      the module-@remarks line-30 post-S2 reword; the test-assertion contract (drop require / add
      negatives / keep token-mentions).

---

## Anti-Patterns to Avoid

- ❌ Don't drop the HARD RULES block. It is load-bearing: `generateCommitMessage` treats `'skip'`/empty as
      failure and `formatCommitMessage` adds the trailer — the agent MUST NOT emit `[PRP Auto]`/`Co-Authored-By`
      and MUST emit `'skip'` for empty diffs. Keep all 4 rules verbatim.
- ❌ Don't remove the `toContain('[PRP Auto]')` / `toContain('Co-Authored-By')` test assertions. They STILL
      PASS after the edit — the hard-rule text still MENTIONS those tokens (as the prohibition target). They
      guard the load-bearing "no trailer/prefix" rule.
- ❌ Don't just delete the Conventional-Commits lines — ADD explicit prohibitions ("Do NOT add a
      Conventional-Commit type prefix…"; "Do NOT reference any work-item id in the subject…"). LLMs regress
      to familiar forms; an explicit "Do NOT" is more robust than silence.
- ❌ Don't make the agent format-aware. The prompt must NOT mention `PRP_COMMIT_FORMAT`, the task-prefix, or
      `1.2.1.1:`. The caller (S2/S3) owns prefixing; the agent emits ONE plain descriptive summary for both
      modes. Mentioning the prefix risks the agent duplicating it in the subject.
- ❌ Don't touch `createCommitMessageAgent()` body, `formatCommitMessage`, `smartCommit`, `constants.ts`, the
      call sites, or any test other than the prompt-content block. Those are S2 / S1 / S3-of-plan.
- ❌ Don't leave the module self-contradictory. After the const change, the const JSDoc (claims
      "conventional-commit message" + "Conventional Commits 1.0.0 spec") and the module @remarks (line 8
      "conventional-commit"; line 30 "`[PRP Auto]` prefix") become lies. Update them (Tasks 2a/2b/2c).
- ❌ Don't run the full `npm run test:run` as the gate — it's pre-existing red (BUG-004, 178 failures,
      P1.M4 scope). Gate = typecheck + lint + format:check + the edited test file.
- ❌ Don't broaden the negative-assertion regexes to match kept tokens. `not.toMatch(/type prefix|Conventional
      Commits/i)` must NOT match the JSDoc's "forbids Conventional-Commit" rationale (it targets the const's
      guidance lines, not the JSDoc). If a negative assertion over-matches, loosen it to the specific
      guidance phrase.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is the smallest, lowest-risk slice in the BUG-003 set — a 2-file, ~15-line change with
**zero executable-logic change** (a prompt-string const + descriptive JSDoc + one test block). The exact
current const text is quoted verbatim; the exact new const text is prescribed verbatim (with the 2 REMOVABLES
and the kept hard rules enumerated line-by-line); the architecture doc (`architecture/bug-003-commit-format.md`
§"Stagecoach prompt" + §"S4") prescribes the outcome explicitly; the caller-flow invariant
(`generateCommitMessage` returns the bare descriptive message; `formatCommitMessage` wraps it — hence the
hard rules are load-bearing and KEPT) is verified against the working tree; the single test block to edit is
identified by line range with per-assertion drop/keep/add instructions; and the 9 unaffected config-field
tests are enumerated. The non-obvious risks are all enumerated and mitigated: (a) KEEP the hard rules
(load-bearing caller contract); (b) KEEP the two token-mention assertions (they still pass); (c) turn the
removed mandate into an explicit prohibition (LLM-regression guard); (d) keep the agent format-agnostic
(no prefix mention); (e) update the stale module JSDoc (don't leave the module self-contradictory); (f)
no file-disjoint conflict with parallel S2 (different files); (g) the module-@remarks line-30 reword
describes the post-S2 end-state. The only residual risk is a negative-assertion regex over-matching a kept
token — caught at Level 2 (test fails → loosen the regex, deterministic fix). Confidence is high; the
deterministic typecheck + the 10-test gate confirm correctness in one pass.