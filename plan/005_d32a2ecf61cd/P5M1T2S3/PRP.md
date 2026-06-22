# PRP — P5.M1.T2.S3: Inject `issue_feedback` into the blueprint prompt + PRPGenerator

## Goal

**Feature Goal**: Wire the PRD §4.5 feedback-injection point into the Researcher prompt path. Add an optional
`issueFeedback?: string` param to `createPRPBlueprintPrompt(...)` (and through to `constructUserPrompt`), and to
`PRPGenerator.generate(...)`. When provided and non-empty, inject a clearly-delimited
`<issue_feedback>…</issue_feedback>` block into the USER prompt so the Researcher re-researches WITH the reported gap
addressed. When omitted/empty, the prompt is byte-identical to today (the normal path is unchanged). Plumb the param
through `generate()` to the prompt builder, and bypass the stale cache READ when feedback is present so a re-research
never serves the insufficient cached PRP.

**Deliverable**:
1. `src/agents/prompts/prp-blueprint-prompt.ts` — `constructUserPrompt(task, backlog, codebasePath?, issueFeedback?)`
   builds a conditional `feedbackSection` (empty when no feedback) and splices it into the returned user prompt;
   `createPRPBlueprintPrompt(task, backlog, codebasePath?, issueFeedback?)` passes it through. Mode-A JSDoc on both
   documenting the `issueFeedback` param + the `<issue_feedback>` block semantics.
2. `src/agents/prp-generator.ts` — `generate(task, backlog, issueFeedback?)` threads the param to
   `createPRPBlueprintPrompt(...)` and bypasses cache READ when `issueFeedback` is non-empty. Mode-A JSDoc on the new param.
3. Failing-first TDD tests added to `tests/unit/agents/prompts/prp-blueprint-prompt.test.ts` (block present when
   provided, absent when omitted/empty) and `tests/unit/agents/prp-generator.test.ts` (forwards the feedback to the
   prompt builder + the existing `toHaveBeenCalledWith` updated for the 4th arg).

**Success Definition**: `npm run validate` (eslint + prettier --check + tsc --noEmit) and `npm run test:run` (vitest run)
both green; providing a non-empty `issueFeedback` causes `prompt.user` to contain a clearly-delimited
`<issue_feedback>…</issue_feedback>` block (and to NOT contain it when omitted/empty); `PRPGenerator.generate(task, backlog, feedback)`
forwards `feedback` as the 4th arg to `createPRPBlueprintPrompt` and skips the cache-read path; all pre-existing
no-feedback call sites/tests remain byte-identical in behavior.

## Why

- **Business value**: PRD §4.5 (Issue-Driven Re-planning Loop) turns a Coder-Agent `issue` result (a *recoverable
  planning gap* — the PRP was insufficient but the work is valid) into a self-correcting retry. Step 4 of that loop is
  "Re-research with Feedback" where the captured feedback is injected into the PRP-generation prompt so the new PRP
  directly addresses the reported gap. Today there is **no feedback-injection mechanism** — the blueprint prompt cannot
  carry per-re-research context, so a second research pass would produce an identical (still-insufficient) PRP. This
  subtask adds the injection point that S4 (orchestrator) will drive.
- **Scope boundary**: This subtask ships ONLY the param plumbing + the prompt block. It does NOT implement the
  orchestrator re-planning flow (S4), does NOT read `ExecutionResult.issueMessage` (S2's field), does NOT write
  `issue_feedback.md` or delete the stale PRP (both S4). It is the seam S4 calls: `generator.generate(task, backlog, feedback)`.
- **Scope cohesion**: Step 3 of the 4-subtask issue-driven re-planning chain (S1 config → S2 type/signal → **S3
  feedback injection** → S4 orchestrator flow). S3 is consumed by S4 verbatim.
- **Why bypass cache-read on feedback**: `#computeTaskHash` keys on `id/title/context_scope` only — it does NOT include
  `issueFeedback`. Without a guard, a re-research would serve the STALE (insufficient) cached PRP if the file still
  existed. S4 deletes the stale PRP before re-research (belt), and S3's cache-read bypass is the suspenders. The
  no-feedback path is untouched (work-item constraint preserved).

## What

### User-visible behavior

None directly — internal prompt/generator layer. The observable effect is that the Researcher Agent now receives an
explicit `<issue_feedback>…</issue_feedback>` block in its user message whenever the orchestrator (S4) passes a
feedback string, instructing it to address the prior planning gap. Existing callers that never pass feedback see no change.

### Technical requirements (the CONTRACT)

1. **Add optional `issueFeedback?: string` to `createPRPBlueprintPrompt`** (4th positional param, after `codebasePath`).
   Thread it into `constructUserPrompt` (which also gains the optional param). The param is OPTIONAL + LAST so every
   existing ≤3-arg call site stays valid (verified: all call sites are positional ≤3 args).
2. **Inject via `constructUserPrompt`, NOT the HEREDOC.** The system prompt `PRP_BLUEPRINT_PROMPT`
   (`src/agents/prompts.ts` ~L157) is UNCHANGED. Build a `feedbackSection` string exactly the way `codebaseSection` is
   built today (`''` when undefined/empty, else a templated block) and splice it into the returned user-prompt template.
3. **The feedback block must be clearly delimited** with `<issue_feedback>…</issue_feedback>` tags and CRITICAL framing
   text so the Researcher addresses it. Mirror the block convention used by the orchestrator's outer task wrapper
   (see "Implementation Patterns" below for the exact block).
4. **No-feedback path is byte-identical.** When `issueFeedback` is `undefined` or `''`, `feedbackSection === ''` and the
   returned prompt is identical to today. Existing tests that pass no feedback must be unchanged.
5. **Add optional `issueFeedback?: string` to `PRPGenerator.generate`** (3rd positional param, after `backlog`). Pass
   it through to `createPRPBlueprintPrompt(task, backlog, process.cwd(), issueFeedback)`.
6. **Bypass cache READ when feedback is present.** Wrap the existing cache-read guard so it is skipped when
   `issueFeedback` is non-empty (`if (!this.#noCache && !issueFeedback)`). Cache WRITE is unchanged (overwrites with the
   feedback-aware PRP). This makes a re-research always hit the LLM, never the stale cache.
7. **TDD + same-commit test updates** (implementation_notes.md §7): write the failing tests first; UPDATE the ONE
   existing `toHaveBeenCalledWith(task, backlog, expect.stringContaining('hacky-hack'))` assertion in
   `prp-generator.test.ts` (line ~219) to include the 4th arg, because vitest's `toHaveBeenCalledWith` is strict on arg
   count and `generate()` will now pass 4 args (4th `undefined` when no feedback).
8. **Mode A docs**: JSDoc on `createPRPBlueprintPrompt`, `constructUserPrompt`, and `PRPGenerator.generate` documenting
   the `issueFeedback` param and the `<issue_feedback>` block semantics. No standalone docs subtask.

### Success Criteria

- [ ] `createPRPBlueprintPrompt(task, backlog, codebasePath, issueFeedback)` accepts an optional 4th param and threads it into `constructUserPrompt`.
- [ ] `constructUserPrompt` injects a `<issue_feedback>…</issue_feedback>` block into `prompt.user` when `issueFeedback` is provided and non-empty.
- [ ] `prompt.user` does NOT contain `<issue_feedback>` when `issueFeedback` is omitted, `undefined`, or `''`.
- [ ] The no-feedback user prompt is byte-identical to today (existing blueprint-prompt tests pass unchanged).
- [ ] `PRPGenerator.generate(task, backlog, issueFeedback?)` accepts an optional 3rd param and forwards it to `createPRPBlueprintPrompt`.
- [ ] When `issueFeedback` is non-empty, `generate()` bypasses the cache READ (the LLM is always invoked).
- [ ] When `issueFeedback` is omitted, `generate()` behaves exactly as today (cache read/writes identical).
- [ ] Mode-A JSDoc on the new param present on all three functions.
- [ ] `src/agents/prompts.ts` HEREDOC `PRP_BLUEPRINT_PROMPT` is UNCHANGED (`git diff` empty).
- [ ] `src/core/task-orchestrator.ts`, `src/agents/prp-executor.ts`, `src/agents/prp-runtime.ts`, `src/config/constants.ts` UNCHANGED (S1/S2/S4 territory — `git diff` empty).
- [ ] `npm run validate` passes (zero errors).
- [ ] `npm run test:run` passes (all green, new + updated tests included).
- [ ] RED step observed before GREEN (failing test written before implementation — TDD).

## All Needed Context

### Context Completeness Check

_Pass_: An agent with zero codebase knowledge can implement this from the exact current code blocks quoted below (the
`constructUserPrompt` template + the `codebaseSection` conditional pattern to mirror; the `generate()` cache-read guard
+ prompt-build call site; the two test files' SETUP/EXECUTE/VERIFY rhythm and the ONE `toHaveBeenCalledWith` to update),
the verified validation commands, and the exact block structure to inject. Every reference resolves to a real file/line
in the tree today. No inference required — it is a conditional-section addition + a param thread + a one-line cache-guard.

### Documentation & References

```yaml
# MUST READ — the primary file edited (prompt builder)
- file: src/agents/prompts/prp-blueprint-prompt.ts
  why: Contains constructUserPrompt (builds the USER message — INJECT HERE) + createPRPBlueprintPrompt (public export to extend). The codebaseSection conditional is the EXACT pattern to mirror for feedbackSection.
  pattern: |
    # CURRENT constructUserPrompt signature + conditional-section pattern to MIRROR (codebaseSection):
    function constructUserPrompt(
      task: Task | Subtask,
      backlog: Backlog,
      codebasePath?: string
    ): string {
      ...
      # PATTERN TO MIRROR — build a string that is '' when undefined/empty, else a templated block:
      const codebaseSection =
        codebasePath !== undefined && codebasePath.length > 0
          ? `\n\n## Codebase Analysis\n\nThe codebase is located at: ${codebasePath}\n\n...`
          : '';
      ...
      # The returned template (splice feedbackSection in here — see "Implementation Patterns"):
      return `
    # Work Item Context
    ...
    ## Parent Context
    ${parentContextDisplay}
    ${codebaseSection}
    ---
    ${PRP_BLUEPRINT_PROMPT}
    `;
    }
    # CURRENT createPRPBlueprintPrompt signature (~L250) + the createPrompt call:
    export function createPRPBlueprintPrompt(
      task: Task | Subtask,
      backlog: Backlog,
      codebasePath?: string
    ): Prompt<PRPDocument> {
      return createPrompt({
        user: constructUserPrompt(task, backlog, codebasePath),
        system: PRP_BLUEPRINT_PROMPT,
        responseFormat: PRPDocumentSchema,
        enableReflection: true,
      });
    }
  gotcha: |
    - Inject into the USER prompt (constructUserPrompt), NOT the system HEREDOC (PRP_BLUEPRINT_PROMPT).
    - `issueFeedback` MUST be the LAST optional param so existing ≤3-arg calls stay valid.
    - When issueFeedback is undefined/'' the returned prompt MUST be byte-identical to today.

# MUST READ — the generator (param thread + cache-read bypass)
- file: src/agents/prp-generator.ts
  why: generate() (the public method to extend, ~L588) builds the prompt at ~L617 and runs the cache-read guard at ~L573-609. #computeTaskHash keys on id/title/context_scope ONLY (does NOT include feedback) — that is WHY the cache-read bypass is needed.
  pattern: |
    # CURRENT generate signature (~L588):
    async generate(task: Task | Subtask, backlog: Backlog): Promise<PRPDocument> {
    # CURRENT cache-read guard (~L573) — add `&& !issueFeedback` to skip on feedback:
    if (!this.#noCache) {
      const cachePath = this.getCachePath(task.id);
      const currentHash = this.#computeTaskHash(task, backlog);
      if (await this.#isCacheRecent(cachePath)) { ... #loadCachedPRP → hash match → HIT ... }
    }
    # CURRENT prompt-build call site (~L617) — pass issueFeedback as 4th arg:
    const prompt = createPRPBlueprintPrompt(task, backlog, process.cwd());
  gotcha: |
    - #computeTaskHash does NOT include issueFeedback ⇒ a feedback re-research would HIT the stale cache without the bypass.
    - Cache WRITE stays unchanged (overwrites with the feedback-aware PRP). Only the READ is bypassed.
    - vitest `toHaveBeenCalledWith` is strict on arg COUNT ⇒ the existing assertion (prp-generator.test.ts ~L219) must add the 4th expected arg.

# MUST READ — blueprint-prompt test pattern to clone (the #/ alias import)
- file: tests/unit/agents/prompts/prp-blueprint-prompt.test.ts
  why: Canonical test file. (1) Uses the vitest `#/prompts/index.js` alias import (`#` → src/agents per vitest.config.ts resolve.alias). (2) "should include codebase path when provided" + "should not include codebase section when path is not provided" are the EXACT two-test pattern to clone for feedback (present when provided, absent when omitted). (3) SETUP/EXECUTE/VERIFY rhythm: grab `mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1]` → call → assert `prompt.user`.
  pattern: |
    import { createPRPBlueprintPrompt } from '#/prompts/index.js';
    ...
    it('should include codebase path when provided', () => {
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];
      const prompt = createPRPBlueprintPrompt(task, mockBacklog, codebasePath);
      expect(prompt.user).toContain('Codebase Analysis');
      expect(prompt.user).toContain(codebasePath);
    });
    # NEW feedback tests (clone the pair above):
    it('should include <issue_feedback> block when issueFeedback is provided', () => {
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];
      const feedback = 'PRP did not specify the API contract for /health; re-research with that gap filled.';
      const prompt = createPRPBlueprintPrompt(task, mockBacklog, undefined, feedback);
      expect(prompt.user).toContain('<issue_feedback>');
      expect(prompt.user).toContain('</issue_feedback>');
      expect(prompt.user).toContain(feedback);
    });
    it('should not include <issue_feedback> block when issueFeedback is omitted', () => {
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);
      expect(prompt.user).not.toContain('<issue_feedback>');
    });
  gotcha: Pass `codebasePath` as `undefined` (3rd arg) in the present-feedback test so the codebase section does not muddy the assertion. Assert the literal tags `<issue_feedback>` + `</issue_feedback>`.

# MUST READ — generator test (the ONE assertion that BREAKS + the forwarding test to add)
- file: tests/unit/agents/prp-generator.test.ts
  why: Mocks createPRPBlueprintPrompt (vi.mock + `as any`). The existing "should successfully generate PRP on first attempt" test asserts `toHaveBeenCalledWith(task, backlog, expect.stringContaining('hacky-hack'))` at ~L219 — vitest is strict on arg count, so after S3 it MUST add the 4th expected arg. Then ADD a forwarding test that asserts generate() passes the feedback as the 4th arg.
  pattern: |
    # EXISTING assertion at ~L219 (UPDATE — add 4th arg `undefined` for the no-feedback path):
    expect(mockCreatePRPBlueprintPrompt).toHaveBeenCalledWith(
      task,
      backlog,
      expect.stringContaining('hacky-hack'),
      undefined
    );
    # NEW forwarding test (ADD):
    it('should forward issueFeedback to createPRPBlueprintPrompt', async () => {
      const task = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const feedback = 'Prior PRP missed the /health contract; address it.';
      mockAgent.prompt.mockResolvedValue(createMockPRPDocument(task.id));
      const generator = new PRPGenerator(mockSessionManager);
      await generator.generate(task, backlog, feedback);
      expect(mockCreatePRPBlueprintPrompt).toHaveBeenCalledWith(
        task,
        backlog,
        expect.stringContaining('hacky-hack'),
        feedback
      );
    });
  gotcha: |
    - The mock returns `{ system: 'system', user: 'user', responseFormat: {} }` — fine; assert call args only.
    - AFTER adding the cache-read bypass, also assert generate() skips cache read when feedback is present (optional but recommended): with feedback + an existing cache file present, mockAgent.prompt MUST still be called.

# REFERENCE — the feature cluster + downstream contract
- file: plan/005_d32a2ecf61cd/architecture/delta_impact.md
  why: R2 confirms S3 = feedback injection only (this subtask). Lists the exact tests touched (incl. both files above). Confirms S2 ships the type/ignal and S4 the orchestrator flow. Confirms issue_feedback.md is implicitly protected (not our concern).
  section: "R2 (Issue-Driven Re-planning)"

# REFERENCE — PRD source of truth for the injection semantics
- file: PRD.md
  why: §4.5 step 4 defines the injection: "<issue_feedback> injected into the PRP-generation prompt so the new PRP directly addresses the reported gap." §6.2 defines the blueprint prompt's role (Researcher / context curation). This subtask implements the §4.5 injection point consumed by S4.
  section: "§4.5 The Issue-Driven Re-planning Loop" + "§6.2 PRP Creation Prompt"

# REFERENCE — same-commit test-update rule (why the test edits are IN scope)
- file: plan/005_d32a2ecf61cd/architecture/implementation_notes.md
  why: §7 mandates updating consuming tests in the SAME subtask (implicit TDD) so the suite stays green. This is why the prp-generator.test.ts `toHaveBeenCalledWith` update + the new tests land HERE.
  section: "§7 Test fragility"

# PARALLEL-EXECUTION CONTEXT (zero file overlap — safe to land together)
- file: plan/005_d32a2ecf61cd/P5M1T2S2/PRP.md
  why: S2 (ExecutionResult.outcome/issueMessage) is implemented IN PARALLEL. It edits src/agents/prp-executor.ts + src/agents/prp-runtime.ts + their tests. S3 edits prp-blueprint-prompt.ts + prp-generator.ts + their tests — ZERO overlap. S3 consumes NOTHING from S2 at the type level; S4 will read S2's result.issueMessage and pass it as the feedback string into generate().
- file: plan/005_d32a2ecf61cd/P5M1T2S1/PRP.md
  why: S1 (ISSUE_RETRY_MAX config) is implemented IN PARALLEL. It edits ONLY src/config/constants.ts, tests/unit/config/issue-retry-max.test.ts, docs/CONFIGURATION.md. This subtask edits NONE of those. S1 ships getIssueRetryMax() which S4 (not S3) consumes.
```

### Current Codebase tree (relevant slice)

```bash
src/agents/
├── prompts.ts                       # <-- DO NOT TOUCH (PRP_BLUEPRINT_PROMPT HEREDOC unchanged)
├── prompts/
│   └── prp-blueprint-prompt.ts      # <-- EDIT: constructUserPrompt + createPRPBlueprintPrompt gain optional issueFeedback param; inject <issue_feedback> block; JSDoc
├── prp-generator.ts                 # <-- EDIT: generate() gains optional issueFeedback param; thread to prompt builder; bypass cache READ on feedback; JSDoc
├── prp-executor.ts                  # <-- DO NOT TOUCH (S2 territory)
└── prp-runtime.ts                   # <-- DO NOT TOUCH (S2 territory)

src/core/
├── task-orchestrator.ts             # <-- DO NOT TOUCH (S4 territory)
└── research-queue.ts                # <-- DO NOT TOUCH (S4 will plumb feedback into the .generate(task, backlog, feedback) calls)

src/config/
└── constants.ts                     # <-- DO NOT TOUCH (S1 territory, parallel)

tests/unit/agents/
├── prompts/prp-blueprint-prompt.test.ts  # <-- EDIT: ADD feedback-present + feedback-absent tests (TDD failing-first)
└── prp-generator.test.ts                 # <-- EDIT: UPDATE the 1 with ToHaveBeenCalledWith (4th arg) + ADD forwarding test
```

### Desired Codebase tree with files to be added/modified

```bash
src/agents/
├── prompts/prp-blueprint-prompt.ts  # MODIFIED: + issueFeedback? on constructUserPrompt + createPRPBlueprintPrompt; + <issue_feedback> block; JSDoc
└── prp-generator.ts                 # MODIFIED: + issueFeedback? on generate(); thread to prompt builder; cache-read bypass on feedback; JSDoc

tests/unit/agents/
├── prompts/prp-blueprint-prompt.test.ts  # MODIFIED: + feedback block-present test, + feedback block-absent test
└── prp-generator.test.ts                 # MODIFIED: UPDATE with ToHaveBeenCalledWith (4th arg); + forwarding test
```

> **File-placement decision**: All edits land in the existing files — no new modules. No new types (the param is a
> plain optional `string`). The block is injected at runtime by `constructUserPrompt`, not stored in a constant.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: Inject into the USER prompt (constructUserPrompt), NOT the system HEREDOC (PRP_BLUEPRINT_PROMPT).
//   The HEREDOC in src/agents/prompts.ts has NO <issue_feedback> placeholder today
//   (grep -n "issue_feedback" src/agents/prompts.ts → no matches). Do NOT modify the HEREDOC.

// CRITICAL: issueFeedback MUST be the LAST optional param on BOTH functions:
//   createPRPBlueprintPrompt(task, backlog, codebasePath?, issueFeedback?)   // 4th
//   PRPGenerator.generate(task, backlog, issueFeedback?)                      // 3rd
//   Every existing call site is positional with ≤3 args (blueprint) / ≤2 args (generate) — adding a LAST optional
//   param keeps them all valid. (Verified across src/ + all test files.)

// CRITICAL: No-feedback path is byte-identical. feedbackSection MUST be '' when issueFeedback is undefined OR ''.
//   Mirror the codebaseSection guard exactly: `issueFeedback !== undefined && issueFeedback.length > 0`.
//   This is a work-item constraint ("the normal path is unchanged") and keeps every existing no-feedback test green.

// CRITICAL: vitest `toHaveBeenCalledWith` is STRICT on argument COUNT. After S3, generate() calls
//   createPRPBlueprintPrompt with 4 args (4th = undefined when no feedback). The existing assertion at
//   prp-generator.test.ts ~L219 (3 expected args) WILL FAIL unless updated to add the 4th expected arg.

// CRITICAL: Cache READ must be bypassed when feedback is present. #computeTaskHash keys on id/title/context_scope
//   ONLY (NOT feedback) → a feedback re-research would HIT the stale (insufficient) cache. Guard:
//   `if (!this.#noCache && !issueFeedback) { ...existing cache-read block... }`. Cache WRITE is unchanged.

// GOTCHA: TS ESM source uses `.js` import specifiers in `.ts` files. Tests use `.js` for src imports OR the
//   vitest `#/` alias (`#` → src/agents). The blueprint-prompt test uses `#/prompts/index.js`.
//   WRONG: from '../../src/agents/prompts/prp-blueprint-prompt';
//   RIGHT: from '../../src/agents/prompts/prp-blueprint-prompt.js';

// GOTCHA: eslint requires JSDoc on exported functions in this repo (createPRPBlueprintPrompt already has it).
//   Add a `@param issueFeedback` + `@remarks` describing the <issue_feedback> block semantics. Mirror the existing
//   @example style. constructUserPrompt is NOT exported → JSDoc optional but recommended.

// GOTCHA: The block must use the literal tags <issue_feedback> and </issue_feedback> (angle brackets) so the
//   Researcher + downstream parsing can detect it. The test asserts these literal substrings.
```

## Implementation Blueprint

### Data models and structure

No new data models — this subtask **adds one optional `string` param to two functions** and **one conditional string
section**. Type safety is trivial (optional string; runtime empty-check mirroring the existing `codebaseSection` guard).

```typescript
// === constructUserPrompt: the new conditional section (mirror codebaseSection) ===
function constructUserPrompt(
  task: Task | Subtask,
  backlog: Backlog,
  codebasePath?: string,
  issueFeedback?: string            // NEW (last, optional)
): string {
  // ...existing codebaseSection build...
  // NEW: build the feedback section — '' when undefined/empty (byte-identical no-feedback path)
  const feedbackSection =
    issueFeedback !== undefined && issueFeedback.length > 0
      ? `

## Issue Feedback (Re-planning)

This is a **re-planning attempt** after a previous implementation reported an issue (a recoverable planning gap).
**CRITICAL**: You MUST address the feedback below in your revised PRP — do not repeat the prior approach unchanged.

<issue_feedback>
${issueFeedback}
</issue_feedback>`
      : '';

  // ...splice ${feedbackSection} into the returned template (see "Implementation Patterns" for placement)...
}

// === createPRPBlueprintPrompt: thread the param ===
export function createPRPBlueprintPrompt(
  task: Task | Subtask,
  backlog: Backlog,
  codebasePath?: string,
  issueFeedback?: string            // NEW (last, optional)
): Prompt<PRPDocument> {
  return createPrompt({
    user: constructUserPrompt(task, backlog, codebasePath, issueFeedback),  // pass through
    system: PRP_BLUEPRINT_PROMPT,
    responseFormat: PRPDocumentSchema,
    enableReflection: true,
  });
}

// === PRPGenerator.generate: thread + cache-read bypass ===
async generate(task: Task | Subtask, backlog: Backlog, issueFeedback?: string): Promise<PRPDocument> {
  // Cache checking — bypass READ when feedback is present (re-research must always hit the LLM)
  if (!this.#noCache && !issueFeedback) {
    // ...existing cache-read block unchanged...
  } else if (!this.#noCache && issueFeedback) {
    this.#logger.debug({ taskId: task.id }, 'PRP cache READ bypassed for feedback re-research');
  } else {
    this.#logger.debug('Cache bypassed via --no-cache flag');
  }
  // ...
  const prompt = createPRPBlueprintPrompt(task, backlog, process.cwd(), issueFeedback);  // pass through
  // ...rest unchanged...
}
```

### Implementation Tasks (ordered by dependencies — strict TDD)

```yaml
Task 1: WRITE/EXTEND failing tests in tests/unit/agents/prompts/prp-blueprint-prompt.test.ts  (RED — before Task 3)
  - ADD two tests inside the existing `describe('createPRPBlueprintPrompt', ...)` block, cloned from the codebase-section test pair (~L149 "should include codebase path when provided" + ~L163 "should not include codebase section when path is not provided"):
      it('should include the <issue_feedback> block when issueFeedback is provided', () => {
        const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];
        const feedback = 'PRP did not specify the /health API contract; re-research with that gap filled.';
        const prompt = createPRPBlueprintPrompt(task, mockBacklog, undefined, feedback);
        expect(prompt.user).toContain('<issue_feedback>');
        expect(prompt.user).toContain('</issue_feedback>');
        expect(prompt.user).toContain(feedback);
      });
      it('should not include the <issue_feedback> block when issueFeedback is omitted', () => {
        const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];
        const prompt = createPRPBlueprintPrompt(task, mockBacklog);
        expect(prompt.user).not.toContain('<issue_feedback>');
      });
  - ADD a third test (edge — empty string behaves like omitted):
      it('should not include the <issue_feedback> block when issueFeedback is an empty string', () => {
        const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];
        const prompt = createPRPBlueprintPrompt(task, mockBacklog, undefined, '');
        expect(prompt.user).not.toContain('<issue_feedback>');
      });
  - FOLLOW pattern: the codebase-section test pair (assert `prompt.user` contains/not-contains a substring).
  - NAMING: "should include the <issue_feedback> block when issueFeedback is provided" etc.
  - MOCKING: NO agent/network — pure prompt construction + string assertions.
  - VERIFY IT FAILS FIRST: `npm run test:run -- prp-blueprint-prompt` BEFORE Task 3 — the present-feedback test must fail (block not injected yet). RED step.
  - PLACEMENT: tests/unit/agents/prompts/prp-blueprint-prompt.test.ts (inside the existing `describe('createPRPBlueprintPrompt')` block).

Task 2: WRITE/EXTEND failing tests in tests/unit/agents/prp-generator.test.ts  (RED — before Task 4)
  - UPDATE the ONE existing assertion (~L219 in "should successfully generate PRP on first attempt") to add the 4th expected arg (vitest is strict on arg count; generate() now passes 4 args):
      expect(mockCreatePRPBlueprintPrompt).toHaveBeenCalledWith(
        task,
        backlog,
        expect.stringContaining('hacky-hack'),
        undefined
      );
  - ADD a forwarding test inside `describe('generate', ...)`:
      it('should forward issueFeedback to createPRPBlueprintPrompt as the 4th arg', async () => {
        const task = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
        const backlog = createMockBacklog();
        const feedback = 'Prior PRP missed the /health contract; address it.';
        mockAgent.prompt.mockResolvedValue(createMockPRPDocument(task.id));
        const generator = new PRPGenerator(mockSessionManager);
        await generator.generate(task, backlog, feedback);
        expect(mockCreatePRPBlueprintPrompt).toHaveBeenCalledWith(
          task,
          backlog,
          expect.stringContaining('hacky-hack'),
          feedback
        );
      });
  - ADD a cache-bypass test (optional but recommended) inside `describe('cache', ...)` — seed a recent cache file with matching hash, pass feedback, assert the agent WAS still called (cache read bypassed):
      it('should bypass cache read and invoke the agent when issueFeedback is provided', async () => {
        const task = createMockSubtask('P1.M1.T1.S1', 'Test Subtask');
        const backlog = createMockBacklog();
        const cachedPRP = createMockPRPDocument(task.id);
        const mockMetadata = { taskId: task.id, taskHash: 'abc123', createdAt: Date.now(), accessedAt: Date.now(), version: '1.0', prp: cachedPRP };
        mockStat.mockResolvedValue({ mtimeMs: Date.now(), isFile: () => true });
        mockReadFile.mockResolvedValue(JSON.stringify(mockMetadata));
        mockAgent.prompt.mockResolvedValue(cachedPRP);
        const generator = new PRPGenerator(mockSessionManager, false);
        await generator.generate(task, backlog, 'feedback forcing re-research');
        expect(mockAgent.prompt).toHaveBeenCalledTimes(1); // cache READ bypassed → agent invoked
      });
  - FOLLOW pattern: the existing "should successfully generate PRP on first attempt" test (mock wiring via beforeEach).
  - MOCKING: createPRPBlueprintPrompt is vi.mock'd (`as any`); assert call args only. No real agent/network.
  - VERIFY IT FAILS FIRST: `npm run test:run -- prp-generator` BEFORE Task 4 — the forwarding test fails (4th arg not passed yet); the cache-bypass test fails (agent not called because cache hits). RED step.
  - PLACEMENT: tests/unit/agents/prp-generator.test.ts.

Task 3: MODIFY src/agents/prompts/prp-blueprint-prompt.ts  (makes Task 1 GREEN)
  - STEP 3a: ADD `issueFeedback?: string` as the LAST param of `constructUserPrompt`. Build `feedbackSection` mirroring `codebaseSection` ('' when undefined/empty, else the templated block from "Data models and structure" above).
  - STEP 3b: SPLICE `${feedbackSection}` into the returned template. Recommended placement: immediately AFTER `${codebaseSection}` and BEFORE the `---\n\n${PRP_BLUEPRINT_PROMPT}` separator (groups all Work Item Context material together; the CRITICAL framing ensures the Researcher prioritizes it).
  - STEP 3c: ADD `issueFeedback?: string` as the LAST (4th) param of `createPRPBlueprintPrompt`. Pass it through: `user: constructUserPrompt(task, backlog, codebasePath, issueFeedback)`.
  - STEP 3d: ADD Mode-A JSDoc: a `@param issueFeedback` line + `@remarks` on `createPRPBlueprintPrompt` (and `constructUserPrompt`) documenting that when provided+non-empty a `<issue_feedback>…</issue_feedback>` block is injected into the user prompt for re-planning (PRD §4.5); when omitted/empty the prompt is unchanged.
  - GOTCHA: Do NOT modify `src/agents/prompts.ts` HEREDOC. Do NOT change the system prompt.
  - GOTCHA: `issueFeedback` MUST be the last param. Keep `codebasePath` as the 3rd.
  - PLACEMENT: src/agents/prompts/prp-blueprint-prompt.ts.

Task 4: MODIFY src/agents/prp-generator.ts  (makes Task 2 GREEN)
  - STEP 4a: ADD `issueFeedback?: string` as the LAST (3rd) param of `generate(task, backlog, issueFeedback?)`.
  - STEP 4b: BYPASS cache READ when feedback is present. Change the existing guard `if (!this.#noCache) {` to `if (!this.#noCache && !issueFeedback) {` and add an `else if (!this.#noCache && issueFeedback)` debug-log branch (see "Data models and structure"). Cache WRITE block (`if (!this.#noCache) { ... #saveCacheMetadata ... }`) is UNCHANGED.
  - STEP 4c: THREAD the param to the prompt builder: `createPRPBlueprintPrompt(task, backlog, process.cwd(), issueFeedback)` (was 3-arg, now 4-arg).
  - STEP 4d: ADD Mode-A JSDoc `@param issueFeedback` on `generate` (mirror the existing @remarks/@example style) documenting the re-research semantics + cache-read bypass.
  - GOTCHA: The cache WRITE (step 6 `#saveCacheMetadata`) must remain unconditional on feedback so the feedback-aware PRP is cached for reuse. Only the READ is bypassed.
  - GOTCHA: Do NOT touch task-orchestrator.ts (S4), prp-executor.ts/prp-runtime.ts (S2), constants.ts (S1).
  - PLACEMENT: src/agents/prp-generator.ts.

Task 5: VERIFY (validation gates — run after Tasks 3 + 4)
  - RUN: `npm run validate` (eslint . --ext .ts + prettier --check + tsc --noEmit) — expect zero errors. If prettier --check fails on new JSDoc/strings, run `npm run format` (writes) then re-run `npm run validate`.
  - RUN: `npm run test:run` (vitest run) — expect all green incl. the new feedback tests + the updated `toHaveBeenCalledWith`.
  - GREP-VERIFY scope: `git diff --stat` must show ONLY the 4 files (prp-blueprint-prompt.ts, prp-generator.ts, + their 2 unit tests). `git diff src/agents/prompts.ts src/core/task-orchestrator.ts src/agents/prp-executor.ts src/agents/prp-runtime.ts src/config/constants.ts` must be EMPTY.
  - GREP-VERIFY HEREDOC untouched: `git diff src/agents/prompts.ts` must be EMPTY.
```

### Implementation Patterns & Key Details

```typescript
// === PATTERN: the feedback block to inject (mirror the orchestrator's outer-wrapper convention) ===
const feedbackSection =
  issueFeedback !== undefined && issueFeedback.length > 0
    ? `

## Issue Feedback (Re-planning)

This is a **re-planning attempt** after a previous implementation reported an issue (a recoverable planning gap).
**CRITICAL**: You MUST address the feedback below in your revised PRP — do not repeat the prior approach unchanged.

<issue_feedback>
${issueFeedback}
</issue_feedback>`
    : '';

// === PATTERN: splice into the returned user-prompt template (after codebaseSection, before the separator) ===
return `
# Work Item Context

## Task Information

**Title**: ${task.title}
**Description**: ${itemDescription}

${taskContext}

## Parent Context

${parentContextDisplay}

${codebaseSection}
${feedbackSection}

---

${PRP_BLUEPRINT_PROMPT}
`;
// NOTE: when feedbackSection is '', the template collapses to exactly today's output (no extra blank lines beyond the
// existing `${codebaseSection}` trailing newline). Verify byte-identity of the no-feedback path with a regression test.

// === PATTERN: cache-read bypass on feedback (generate) ===
// BEFORE:  if (!this.#noCache) { /* cache-read block */ } else { log('--no-cache'); }
// AFTER:
if (!this.#noCache && !issueFeedback) {
  /* cache-read block — UNCHANGED */
} else if (!this.#noCache && issueFeedback) {
  this.#logger.debug({ taskId: task.id }, 'PRP cache READ bypassed for feedback re-research');
} else {
  this.#logger.debug('Cache bypassed via --no-cache flag');
}
// Cache WRITE (step 6) is UNCHANGED — the feedback-aware PRP is still cached for reuse.
```

```typescript
// === PATTERN: the blueprint-prompt feedback-present test (clone of the codebase-section test) ===
const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];
const feedback = 'PRP did not specify the /health API contract; re-research with that gap filled.';
const prompt = createPRPBlueprintPrompt(task, mockBacklog, undefined, feedback);  // codebasePath=undefined
expect(prompt.user).toContain('<issue_feedback>');
expect(prompt.user).toContain('</issue_feedback>');
expect(prompt.user).toContain(feedback);

// === PATTERN: the generator forwarding test (asserts the 4th arg) ===
await generator.generate(task, backlog, feedback);
expect(mockCreatePRPBlueprintPrompt).toHaveBeenCalledWith(
  task,
  backlog,
  expect.stringContaining('hacky-hack'),
  feedback
);
```

### Integration Points

```yaml
PROMPT BUILDER (the change):
  - extend: src/agents/prompts/prp-blueprint-prompt.ts → constructUserPrompt (+ issueFeedback?, + feedbackSection), createPRPBlueprintPrompt (+ issueFeedback? threaded)

GENERATOR (the change):
  - extend: src/agents/prp-generator.ts → generate(+ issueFeedback?); cache-read bypass on feedback; thread to createPRPBlueprintPrompt

RE-EXPORT (auto-adapts — NO edit):
  - src/agents/prompts/index.ts `export { createPRPBlueprintPrompt }` is signature-less → picks up the new optional param automatically.

NOT TOUCHED (scope guardrails):
  - src/agents/prompts.ts (PRP_BLUEPRINT_PROMPT HEREDOC)                                        # inject via constructUserPrompt, NOT the HEREDOC
  - src/agents/prp-executor.ts, src/agents/prp-runtime.ts                                       # S2: ExecutionResult.outcome/issueMessage
  - src/core/task-orchestrator.ts                                                               # S4: issue→Planned + re-research flow
  - src/core/research-queue.ts                                                                   # S4 will plumb feedback into .generate(task, backlog, feedback)
  - src/config/constants.ts                                                                      # S1: ISSUE_RETRY_MAX (parallel)
  - docs/WORKFLOWS.md                                                                            # S4: issue subsection (needs the full flow)

FUTURE CONSUMER (informational — do NOT implement here):
  - P5.M1.T2.S4: on result.outcome === 'issue', reads result.issueMessage (S2) → saves issue_feedback.md → deletes
                 stale PRP → resets item to Planned → calls generator.generate(task, backlog, issueMessage) (THIS subtask's API),
                 bounded by getIssueRetryMax() (S1).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After Task 3 (edit prp-blueprint-prompt.ts) + Task 4 (edit prp-generator.ts):
npm run validate
# = npm run lint && npm run format:check && npm run typecheck
# = eslint . --ext .ts && prettier --check "**/*.{ts,js,json,md,yml,yaml}" && tsc --noEmit -p tsconfig.build.json
# Expected: zero errors. If prettier --check fails on the new JSDoc/templated strings, run:
npm run format        # WRITES the prettier-compliant form
npm run validate      # re-check; expect zero errors.
# Common failure: missing @param/@remarks on the extended exported function — add Mode-A JSDoc per the tasks.
```

### Level 2: Unit Tests (Component Validation)

```bash
# RED step (after Task 1, before Task 3) — MUST fail first (TDD):
npm run test:run -- prp-blueprint-prompt
# Expected: the NEW feedback-present test fails (block not injected yet) — confirms it exercises new code.

# RED step (after Task 2, before Task 4) — MUST fail first (TDD):
npm run test:run -- prp-generator
# Expected: the forwarding test fails (4th arg not passed) + the cache-bypass test fails (agent not called).

# GREEN step (after Task 3 + Task 4):
npm run test:run -- prp-blueprint-prompt
npm run test:run -- prp-generator
# Expected: all green, incl. the new feedback tests + the updated with ToHaveBeenCalledWith + forwarding test.

# Full suite (confirm no backward-compat regression in consumers/integration tests):
npm run test:run
# Expected: all green. If agent-context-injection.test.ts / prp-blueprint-agent.test.ts / prp-generator-integration.test.ts
# fail, the no-feedback path was accidentally changed (feedbackSection must be '' when feedback is absent).
```

### Level 3: Integration Testing (System Validation)

```bash
# Confirm backward compatibility: existing integration tests that never pass feedback still pass.
npm run test:run -- prp-blueprint-agent
npm run test:run -- prp-generator-integration
npm run test:run -- agent-context-injection
npm run test:run -- agents
# Expected: all green (they call createPRPBlueprintPrompt with ≤3 args / generate with 2 args; the new optional param
# is unused, and prompt.user must be byte-identical to today on the no-feedback path).

# Scope-guard regression check — confirm we did NOT over-reach:
git diff --stat
# Expected: ONLY src/agents/prompts/prp-blueprint-prompt.ts, src/agents/prp-generator.ts,
#           tests/unit/agents/prompts/prp-blueprint-prompt.test.ts, tests/unit/agents/prp-generator.test.ts.

git diff src/agents/prompts.ts src/core/task-orchestrator.ts src/agents/prp-executor.ts src/agents/prp-runtime.ts src/config/constants.ts src/core/research-queue.ts
# Expected: EMPTY (all untouched — S1/S2/S4 territory + the HEREDOC).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# HEREDOC-untouched check — confirm PRP_BLUEPRINT_PROMPT was NOT modified:
git diff src/agents/prompts.ts
# Expected: EMPTY. (grep confirms no <issue_feedback> placeholder ever existed in the HEREDOC; injection is runtime-only.)

# Byte-identity check — the no-feedback user prompt is unchanged:
# Add/keep a regression assertion: createPRPBlueprintPrompt(task, backlog).user snapshot MUST equal today's output.
# (The new feedback-absent test covers this: `expect(prompt.user).not.toContain('<issue_feedback>')`.)
npm run test:run -- prp-blueprint-prompt 2>&1 | grep -c "issue_feedback"
# Expected: ≥3 (present-when-provided, absent-when-omitted, absent-when-empty-string assertions).

# Arg-count check — generate() passes the 4th arg:
grep -n "createPRPBlueprintPrompt(task, backlog, process.cwd()" src/agents/prp-generator.ts
# Expected: the call now reads createPRPBlueprintPrompt(task, backlog, process.cwd(), issueFeedback).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` passes (eslint + prettier --check + tsc --noEmit, zero errors).
- [ ] `npm run test:run` passes (all green; new + updated tests included).
- [ ] RED step observed before GREEN (feedback tests failed before Tasks 3+4 — TDD).

### Feature Validation

- [ ] `createPRPBlueprintPrompt(task, backlog, codebasePath, issueFeedback)` injects a `<issue_feedback>…</issue_feedback>` block into `prompt.user` when `issueFeedback` is provided and non-empty.
- [ ] `prompt.user` does NOT contain `<issue_feedback>` when `issueFeedback` is omitted, `undefined`, or `''`.
- [ ] The no-feedback user prompt is byte-identical to today (existing blueprint-prompt tests pass unchanged).
- [ ] `PRPGenerator.generate(task, backlog, issueFeedback)` forwards `issueFeedback` as the 4th arg to `createPRPBlueprintPrompt`.
- [ ] When `issueFeedback` is non-empty, `generate()` bypasses the cache READ (the agent is always invoked).
- [ ] When `issueFeedback` is omitted, `generate()` behaves exactly as today (cache read/write identical).
- [ ] Mode-A JSDoc on the new param present on `constructUserPrompt`, `createPRPBlueprintPrompt`, and `generate`.

### Code Quality Validation

- [ ] `issueFeedback` is the LAST optional param on both functions (backward-compatible with all existing ≤3-arg / ≤2-arg calls).
- [ ] File placement matches the desired tree (only the 4 files touched).
- [ ] `feedbackSection` empty-guard mirrors `codebaseSection` exactly (`!== undefined && .length > 0`).
- [ ] ESM import specifiers use `.js` extensions in source; tests use `.js` or the `#/` vitest alias.
- [ ] JSDoc follows the file's existing `@param`/`@remarks`/`@example` style.

### Documentation & Deployment

- [ ] Mode-A JSDoc documents the `issueFeedback` param + the `<issue_feedback>` block re-planning semantics (cross-ref PRD §4.5).
- [ ] NO `docs/WORKFLOWS.md` edit in this subtask (the issue subsection is S4 — needs the full flow).

---

## Anti-Patterns to Avoid

- ❌ Don't modify the `PRP_BLUEPRINT_PROMPT` HEREDOC in `src/agents/prompts.ts` — it has no `<issue_feedback>` placeholder today; inject at runtime via `constructUserPrompt` (the user prompt), per the work item.
- ❌ Don't make `issueFeedback` anything other than the LAST optional param — every existing call site is positional ≤3 args (blueprint) / ≤2 args (generate). Putting it first/middle breaks call sites.
- ❌ Don't change the no-feedback path — `feedbackSection` MUST be `''` when `issueFeedback` is `undefined` OR `''`. Byte-identity is a work-item constraint and keeps every existing no-feedback test green.
- ❌ Don't skip the `toHaveBeenCalledWith` update in `prp-generator.test.ts` — vitest is strict on arg count; `generate()` will now pass 4 args (4th `undefined` when no feedback). The existing 3-arg assertion WILL FAIL.
- ❌ Don't skip the cache-read bypass — `#computeTaskHash` excludes `issueFeedback`, so without the guard a feedback re-research serves the STALE cached PRP (latent bug for direct callers; belt-and-suspenders vs S4's PRP deletion).
- ❌ Don't bypass the cache WRITE on feedback — the feedback-aware PRP should still be cached for reuse; only the READ is bypassed.
- ❌ Don't touch `src/core/task-orchestrator.ts` (S4), `src/agents/prp-executor.ts` / `prp-runtime.ts` (S2), `src/config/constants.ts` (S1, parallel), or `src/core/research-queue.ts` (S4 will plumb feedback into the `.generate(task, backlog, feedback)` calls).
- ❌ Don't write the implementation before the failing tests (breaks implicit-TDD; implementation_notes.md §7).
- ❌ Don't defer the consuming-test updates to S4 — §7 mandates they land in the SAME commit so the suite stays green.
- ❌ Don't use `.ts` import specifiers in test/source files — ESM requires `.js` (or the `#/` vitest alias in the blueprint-prompt test).
- ❌ Don't add a `docs/WORKFLOWS.md` subsection here — it is explicitly S4 (needs the full issue-driven flow).
- ❌ Don't read `ExecutionResult.issueMessage` or write `issue_feedback.md` here — that is S4. S3 only provides the param plumbing + prompt block.

---

## Success Metrics

**Confidence Score: 9/10** — This is a tightly-scoped optional-param addition + conditional string section + one-line
cache guard, with every reference resolving to a real file/line in the tree today. The contract names the exact
functions, the exact conditional-section pattern to mirror (`codebaseSection`), the exact call site to update
(`generate` → `createPRPBlueprintPrompt(..., process.cwd())`), the ONE `toHaveBeenCalledWith` that breaks
(`prp-generator.test.ts` ~L219), and the exact block structure to inject. Backward compatibility is structurally
guaranteed by making `issueFeedback` the last optional param and mirroring the existing empty-guard. The HEREDOC is
untouched (injection is runtime-only in `constructUserPrompt`). Residual risks are minor: (a) accidentally changing the
no-feedback path's byte output (Level 4's byte-identity check + the absent-feedback tests catch it); (b) forgetting the
`toHaveBeenCalledWith` 4th-arg update (Level 2 RED on `prp-generator` surfaces it immediately); (c) the cache-bypass
edge being broader than intended (the `&& !issueFeedback` guard is minimal and only affects the feedback path). The
parallel subtasks (S1 config, S2 executor type) edit disjoint files — zero overlap. One-pass success is highly likely.
