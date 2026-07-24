# PRP — P3.M2.T4.S1: Prompt layer — add deletion prohibitions to deletion-capable agents

---

## Goal

**Feature Goal**: Complete the **prompt layer** of PRD §5.1's Critical-File
Deletion Protection. PRD §5.1 mandates that *every deletion-capable agent
prompt* — cleanup, bug hunter, bug-fix breakdown, post-validation fix — forbids
`rm` / `git rm` / `git clean` / `mv` against `PRD.md`, any `PRP.md`, or anything
under `plan/`, and forbids treating pipeline-state files as "temporary." Today
only **one** of the four (the cleanup prompt) carries this text; the other three
are **silent**, so a bug-hunter / coder / researcher that decides to "tidy up"
can `rm PRD.md` or `git rm plan/**/PRP.md` and — because `git-commit.ts`
`PROTECTED_FILES` (src/utils/git-commit.ts:52-58) lists `PRD.md` but **NOT**
`PRP.md` (confirmed: architecture/phase_findings.md:77) and Smart Commit stages
with `git add -A` — the deletion is committed permanently, silently wiping the
real PRD and every PRP. S1 closes that prompt-layer gap on the three missing
prompts. (The mechanical `restore_critical_files` safety net is a SEPARATE
work item, P3.M2.T4.S2; S1 does not touch it.)

**Deliverable** (1 modified production file + 1 modified test file; **no** new
files, **no** config, **no** new dependencies):
1. **`src/agents/prompts.ts`** — ADD a "FORBIDDEN ACTIONS — Critical-File
   Deletion Protection (PRD §5.1)" section to THREE prompt constants that
   currently lack it: `BUG_HUNT_PROMPT` (closes at line 1033),
   `PRP_BLUEPRINT_PROMPT` (closes at line 651), and `PRP_BUILDER_PROMPT`
   (closes at line 909). The three new sections share a single **core
   prohibition paragraph** (the four forbidden verbs + the three protected
   path-classes + the "NOT temporary" clause), each phrased neutrally for its
   agent's job (NOT the cleanup-specific "you are the one agent licensed to
   delete" opener). `CLEANUP_PROMPT` already has the block (prompts.ts:1077-1093,
   authored in P3.M1.T3.S3) and is the **reference template** — DO NOT re-add
   to it.
2. **`tests/unit/agents/prompts.test.ts`** — ADD a `describe('critical-file
   deletion prohibition (PRD §5.1)')` block asserting each of the THREE target
   prompts (plus `CLEANUP_PROMPT` for completeness/documentation) contains the
   required prohibition phrases (`rm`, `git rm`, `git clean`, `mv`, `PRD.md`,
   `PRP.md`, `plan/`, "NOT temporary"). No new test file.

**Success Definition**:
- `BUG_HUNT_PROMPT`, `PRP_BLUEPRINT_PROMPT`, and `PRP_BUILDER_PROMPT` each
  contain a section whose text states (verbatim or equivalent): *"You MUST NOT
  use `rm`, `git rm`, `git clean`, or `mv` to delete or move `PRD.md`, any
  `PRP.md` file, or anything under `plan/`. Pipeline-state files (`PRD.md`,
  `PRP.md`, `tasks.json`, `prd_snapshot.md`) are NOT temporary — do not delete
  them."*
- `CLEANUP_PROMPT` is UNCHANGED (it already has the block — re-adding would
  duplicate it).
- The three new sections are consistent in phrasing (shared core paragraph) but
  have a neutral opener appropriate to each agent (NOT the cleanup-specific
  "you are the one agent explicitly licensed to delete things").
- `npm run validate` GREEN.
- `git diff --name-only` shows EXACTLY `src/agents/prompts.ts` +
  `tests/unit/agents/prompts.test.ts` (no `git-commit.ts`, no
  `agent-factory.ts`, no workflow files).

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline (no human in the loop). Specifically the
four deletion-capable agent personas named in PRD §5.1: cleanup, bug hunter (QA),
bug-fix breakdown (researcher/PRP-blueprint), and post-validation fix (coder).
Transitively the workflows that drive them: `cleanup-runner.ts`, `bug-hunt-workflow.ts`,
`fix-cycle-workflow.ts`, and `prp-executor.ts:#fixAndRetry`.

**Use Case**: A bug-hunt / coder / researcher agent runs in the working tree and
is tempted to delete a "scratch" file that is actually pipeline state — e.g.
`rm plan/.../PRP.md`, `git rm PRD.md`, or `mv plan/.../research/ /tmp`. Pre-S1:
no prompt text forbids it; Smart Commit's `git add -A` then commits the deletion,
permanently wiping the PRD or a PRP (PRP.md is NOT in `git-commit.ts`
PROTECTED_FILES, so there is no commit-side guard for it either — research/01).
Post-S1: every deletion-capable agent's system prompt carries an absolute
"MUST NOT rm/git rm/git clean/mv against PRD.md, any PRP.md, or anything under
plan/" rule, so the agent does not delete them in the first place. The mechanical
`restore_critical_files` layer (P3.M2.T4.S2) remains the second line of defense.

**User Journey**: `createQAAgent()` → `BUG_HUNT_PROMPT` system prompt now contains
the FORBIDDEN ACTIONS block → the QA agent, while tidying test artifacts, sees
the rule and leaves `PRD.md` / `plan/.../PRP.md` alone → Smart Commit stages no
spurious deletion → `restore_critical_files` (S2) is a no-op → pipeline state
intact. A unit test asserts the block is present.

**Pain Points Addressed**: PRD §5.1 (h3.9) — silent permanent loss of PRD.md /
PRP.md on bug-fix runs. The §5.1 narrative names the cleanup agent, bug hunter,
bug-fix breakdown, and post-validation fix explicitly; only the first was done.
This item finishes the other three.

---

## Why

- **PRD compliance**: PRD §5.1 (h3.9) "Critical-File Deletion Protection" names a
  **Prompt layer** and a **Mechanical layer**. S1 is the prompt layer; S2 (separate
  PRP) is the mechanical layer. Both are required; S1 alone is not sufficient but
  it is necessary and is the contracted scope of THIS item.
- **Work-item contract (LOGIC)**: *"Add explicit deletion-prohibition text to the
  system prompts of deletion-capable agents: CLEANUP_PROMPT (from P3.M1.T3.S3 or
  create new), BUG_HUNT_PROMPT (prompts.ts), PRP_BLUEPRINT_PROMPT (prompts.ts —
  for bug-fix breakdown), and any post-validation fix prompt."*
  - `CLEANUP_PROMPT` → already done in P3.M1.T3.S3 (prompts.ts:1077-1093). S1
    does NOT touch it (would duplicate).
  - `BUG_HUNT_PROMPT` → ADD (prompts.ts:920-1033).
  - `PRP_BLUEPRINT_PROMPT` → ADD (prompts.ts:182-651). This is the prompt the
    contract calls "bug-fix breakdown" because fix-task PRP creation reuses it
    via `createResearcherAgent` (agent-factory.ts:358; fix-cycle-workflow.ts runs
    fix tasks through the standard PRP pipeline, research/01 §3).
  - "post-validation fix prompt" → there is NO dedicated prompt constant; the
    post-validation fix runs on the coder agent whose SYSTEM prompt is
    `PRP_BUILDER_PROMPT` (`createCoderAgent`, agent-factory.ts:391; the fix
    `createPrompt({user})` in prp-executor.ts:616 supplies no `system` override).
    So "post-validation fix prompt" = `PRP_BUILDER_PROMPT`. ADD to it.
- **Contract item 1 (RESEARCH NOTE)**: *"PROTECTED_FILES in git-commit.ts includes
  PRD.md but NOT PRP.md."* → confirmed (research/01 §"git-commit.ts
  PROTECTED_FILES"). This is WHY the prompt layer matters for PRP.md specifically:
  there is no commit-side guard for PRP.md at all (S2 adds the mechanical guard).
  The prompt layer is the first and only behavioral defense until S2 lands.
- **Contract item 2 (INPUT)**: No prior subtask consumed. Correct — S1 is a
  leaf prompt-editing task.
- **Contract item 3 (LOGIC) — exact required text**: *"The text must state: 'You
  MUST NOT use rm, git rm, git clean, or mv to delete or move PRD.md, any PRP.md
  file, or anything under plan/. Pipeline-state files (PRD.md, PRP.md, tasks.json,
  prd_snapshot.md) are NOT temporary — do not delete them.'"* → this EXACT
  phrasing (or equivalent) is the shared core paragraph added to each of the three
  target prompts. See the Implementation Blueprint for the literal text.
- **Contract item 4 (OUTPUT)**: *"Deletion prohibitions in all deletion-capable
  agent prompts. Consumed by P3.M2.T4.S2."* → S2's `restore_critical_files` is the
  mechanical backstop; S1's prompt text is the behavioral front line. S2 can
  proceed in parallel once S1 lands (no code dependency, both guard the same files).
- **Contract item 5 (DOCS)**: *"[Mode A] none — no user-facing/config/API surface
  change (prompt-internal)."* → Mode A. No `.env.example`, no `constants.ts`, no
  `docs/` edit, no README. The change is prompt-internal.

---

## What

One modified production file (`src/agents/prompts.ts`), one modified test file
(`tests/unit/agents/prompts.test.ts`). **No** config, **no** new files, **no** new
dependencies, **no** `git-commit.ts` edit (that's S2), **no** `agent-factory.ts`
edit (that's P3.M2.T3.S1), **no** workflow edits.

### Success Criteria

- [ ] **`BUG_HUNT_PROMPT`** (prompts.ts:920-1033) contains a new
      `## FORBIDDEN ACTIONS — Critical-File Deletion Protection (PRD §5.1)`
      section whose body states the four forbidden verbs (`rm`, `git rm`,
      `git clean`, `mv`), the three protected path-classes (`PRD.md`, any
      `PRP.md`, anything under `plan/`), and the "Pipeline-state files ... are NOT
      temporary — do not delete them" clause. Inserted as a prominent `##` section
      (recommended: after the `## Important Guidelines` block, before
      `## Output - IMPORTANT`).
- [ ] **`PRP_BLUEPRINT_PROMPT`** (prompts.ts:182-651) contains the same shared-core
      FORBIDDEN ACTIONS section (neutral opener, not the cleanup-specific one).
      Inserted as a prominent top-level `##` section (recommended: immediately
      after the `## Work Item Information` block, before the MULTI-PRP BATCHING
      POLICY).
- [ ] **`PRP_BUILDER_PROMPT`** (prompts.ts:662-909) contains the same shared-core
      FORBIDDEN ACTIONS section. Inserted early (recommended: right after the
      `## PRP File:` header, before `## Your Goal`).
- [ ] **`CLEANUP_PROMPT`** is UNCHANGED. Its existing FORBIDDEN ACTIONS block
      (prompts.ts:1077-1093) already satisfies §5.1. Re-adding would duplicate.
      (If a test asserts CLEANUP_PROMPT contains the phrases, it already passes.)
- [ ] **The three new sections use a CONSISTENT shared core paragraph** (the
      contract's literal text, lightly framed per agent). They do NOT copy the
      cleanup-specific opener ("you are the one agent explicitly licensed to
      delete things") nor the cleanup-specific `git commit`/`git add` clause.
- [ ] **`tests/unit/agents/prompts.test.ts`** adds a
      `describe('critical-file deletion prohibition (PRD §5.1)')` block with,
      for each of `BUG_HUNT_PROMPT`, `PRP_BLUEPRINT_PROMPT`, `PRP_BUILDER_PROMPT`
      (and `CLEANUP_PROMPT` for completeness), an `it(...)` asserting the prompt
      contains the phrases: `` `rm` ``, `` `git rm` ``, `` `git clean` ``,
      `` `mv` ``, `` `PRD.md` ``, `` `PRP.md` ``, `` `plan/` ``, and the substring
      "NOT temporary".
- [ ] `npm run validate` GREEN.
- [ ] `git diff --name-only` shows EXACTLY `src/agents/prompts.ts` and
      `tests/unit/agents/prompts.test.ts` — nothing else.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed
to implement this successfully?" — YES. This PRP names: the single production
file (`src/agents/prompts.ts`), the THREE target constants with their exact line
ranges and closing `` ` as const;`` lines, the ONE reference template
(`CLEANUP_PROMPT`'s existing FORBIDDEN ACTIONS block at 1077-1093), the EXACT
contract-mandated core paragraph text, the recommended insertion point for each
of the three prompts, the precise "bug-fix breakdown → PRP_BLUEPRINT_PROMPT" and
"post-validation fix → PRP_BUILDER_PROMPT" mappings (with the agent-factory.ts
system-prompt line numbers that prove them), the test file and its existing per-
prompt content-test pattern, and the explicit out-of-scope list (`git-commit.ts`,
`CLEANUP_PROMPT` body, `agent-factory.ts`, workflows).

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/agents/prompts.ts
  why: PRIMARY TARGET. Four prompt constants live here. Their exact line ranges
       (verified via `grep -n '` as const;'`):
         PRP_BLUEPRINT_PROMPT   opens L182,  closes L651
         PRP_BUILDER_PROMPT     opens L662,  closes L909
         BUG_HUNT_PROMPT        opens L920,  closes L1033
         CLEANUP_PROMPT         opens L1055, closes ~L1116 (ends with ` `; not ` as const;`)
       CLEANUP_PROMPT ALREADY has the FORBIDDEN ACTIONS block at L1077-1093 — it
       is the REFERENCE TEMPLATE; do not re-add to it. The other three are the targets.
  pattern: |
           // REFERENCE — CLEANUP_PROMPT FORBIDDEN ACTIONS block (L1077-1093), VERBATIM.
           // This is the source of truth for the prohibition phrasing. The three new
           // sections reuse the CORE of this block (verbs + path-classes + NOT-temporary)
           // but with a NEUTRAL opener (NOT the cleanup-specific "you are the one agent
           // licensed to delete things") and WITHOUT the cleanup-only git commit/git add clause:

           ## FORBIDDEN ACTIONS — Critical-File Deletion Protection (PRD §5.1)

           You are the one agent explicitly licensed to delete things — so the rules below
           are absolute. Violating them corrupts pipeline state.

           You **MUST NOT** run `rm`, `git rm`, `git clean`, or `mv` (or any equivalent
           deletion or move command) against ANY of:

           - **`PRD.md`** — the product requirements document. Never temporary.
           - **any `PRP.md`** — anywhere in the repo. Never temporary.
           - **anything under `plan/`** — the pipeline work directory. Its substance was
             already persisted by the survival commit; you must not touch it.

           You **MUST NOT** treat `PRD.md`, `PRP.md`, or `tasks.json` as "temporary."
  gotcha: The three NEW sections must NOT include the cleanup-only sentence "You are
          the one agent explicitly licensed to delete things" (the bug hunter, researcher,
          and coder are NOT licensed to delete things at all) NOR the "You MUST NOT run
          `git commit` or `git add`" clause (that is cleanup-specific double-commit
          avoidance). Reuse ONLY the core prohibition (four verbs + three path-classes +
          NOT-temporary). See Implementation Blueprint for the exact neutral text.

- file: src/agents/agent-factory.ts
  why: PROOF of the prompt→agent mapping (do NOT edit this file — P3.M2.T3.S1 owns it).
       - createResearcherAgent system = PRP_BLUEPRINT_PROMPT  (L358)  ← "bug-fix breakdown"
       - createCoderAgent     system = PRP_BUILDER_PROMPT    (L391)  ← "post-validation fix"
       - createQAAgent        system = BUG_HUNT_PROMPT       (L420)  ← "bug hunter"
       - createCleanupAgent   system = CLEANUP_PROMPT        (L464)  ← already protected
       These line numbers are the EVIDENCE that "bug-fix breakdown" maps to
       PRP_BLUEPRINT_PROMPT and "post-validation fix" maps to PRP_BUILDER_PROMPT
       (there are no dedicated prompts for either).

- file: src/agents/prp-executor.ts
  why: PROOF that the post-validation fix has NO system-override and thus runs under
       PRP_BUILDER_PROMPT. `#fixAndRetry` (L595-642) builds createPrompt({user: ...})
       with NO `system` field, then calls this.#coderAgent.prompt(fixPrompt). The
       comment at L309-310 states "PRP_BUILDER_PROMPT is the coder agent's SYSTEM
       prompt (set in createCoderAgent)". So adding the prohibition to
       PRP_BUILDER_PROMPT covers the post-validation fix. Do NOT edit this file.
  section: "#fixAndRetry (L595-642)"

- file: src/workflows/fix-cycle-workflow.ts
  why: PROOF that "bug-fix breakdown" reuses PRP_BLUEPRINT_PROMPT. createFixTasks
       (L232-257) builds fix Subtasks in CODE (no LLM); they then run the standard
       PRP pipeline (executeSubtask → PRPRuntime/TaskOrchestrator) whose PRP-creation
       step uses createResearcherAgent → system = PRP_BLUEPRINT_PROMPT. There is NO
       dedicated bug-fix-breakdown prompt. Do NOT edit this file.

- file: src/utils/git-commit.ts
  why: PROOF of the RESEARCH NOTE (PROTECTED_FILES includes PRD.md but NOT PRP.md).
       L52-58:
         const PROTECTED_FILES = [
           'PRD.md', 'prd_snapshot.md', 'delta_prd.md', 'delta_from.txt', 'TEST_RESULTS.md',
         ] as const;
       This is WHY the prompt layer is the only behavioral guard for PRP.md today
       (the mechanical restore_critical_files guard is S2). Do NOT edit this file —
       S2 owns it. Cite this fact in the PRP rationale but do not change PROTECTED_FILES.

- file: plan/008_15504f60a0ef/architecture/phase_findings.md
  why: The contract's "RESEARCH NOTE" references §PHASE 3 of this file. Line 77 states
       verbatim: "PROTECTED_FILES includes PRD.md, prd_snapshot.md, delta_prd.md,
       TEST_RESULTS.md — but NOT PRP.md or plan/ dirs." This confirms the gap that
       motivates S1. Read-only reference; do NOT modify (plan/ is protected).

- file: tests/unit/agents/prompts.test.ts
  why: TEST PATTERNS. Existing per-prompt content tests (e.g. "BUG_HUNT_PROMPT should
       contain expected header" using `expect(BUG_HUNT_PROMPT).toContain(...)`) are the
       exact shape for the new assertions. The "pre-merged PRD declaration (PRD §2.3)"
       describe-block (asserting multiple prompts carry a shared declaration) is the
       template for the new "critical-file deletion prohibition (PRD §5.1)" describe-block.
  pattern: |
           // ADD a new describe block mirroring the existing "pre-merged PRD declaration" block:
           describe('critical-file deletion prohibition (PRD §5.1)', () => {
             const PROHIBITION_TARGETS = [
               ['BUG_HUNT_PROMPT', BUG_HUNT_PROMPT],
               ['PRP_BLUEPRINT_PROMPT', PRP_BLUEPRINT_PROMPT],
               ['PRP_BUILDER_PROMPT', PRP_BUILDER_PROMPT],
               ['CLEANUP_PROMPT', CLEANUP_PROMPT], // already protected — documents full coverage
             ] as const;

             it.each(PROHIBITION_TARGETS)('%s must forbid rm/git rm/git clean/mv against protected files', (_name, prompt) => {
               expect(prompt).toContain('`rm`');
               expect(prompt).toContain('`git rm`');
               expect(prompt).toContain('`git clean`');
               expect(prompt).toContain('`mv`');
               expect(prompt).toContain('`PRD.md`');
               expect(prompt).toContain('`PRP.md`');
               expect(prompt).toContain('`plan/`');
               expect(prompt).toContain('NOT temporary');
             });
           });
  gotcha: The backticks in the assertions (`'`rm`'`) are LITERAL characters being matched
          inside the prompt string — the prompts wrap the forbidden verbs in backticks
          (see CLEANUP_PROMPT L1082). If you phrase the new sections WITHOUT backticks
          around the verbs, update the assertions to match the actual phrasing. The
          requirement is that each prompt asserts the four verbs + three path-classes +
          "NOT temporary" are PRESENT — the exact punctuation is your choice but MUST be
          consistent between the prompt text and the test assertions.
```

### Current Codebase tree (relevant slice)

```bash
src/agents/
  prompts.ts                # PRIMARY TARGET: 4 prompt constants. CLEANUP already done;
                            #   BUG_HUNT (920-1033), PRP_BLUEPRINT (182-651),
                            #   PRP_BUILDER (662-909) need the FORBIDDEN ACTIONS section.
  agent-factory.ts          # UNCHANGED — system-prompt wiring (PROOF of mapping; P3.M2.T3.S1 owns)
  prp-executor.ts           # UNCHANGED — #fixAndRetry runs under PRP_BUILDER_PROMPT (PROOF)
  prompts/                  # UNCHANGED — prompt builders consume the constants
src/utils/
  git-commit.ts             # UNCHANGED — PROTECTED_FILES (S2 owns restore_critical_files)
src/workflows/
  bug-hunt-workflow.ts      # UNCHANGED — consumes createQAAgent
  fix-cycle-workflow.ts     # UNCHANGED — fix tasks reuse standard pipeline (PRP_BLUEPRINT)
tests/unit/agents/
  prompts.test.ts           # MODIFY: add "critical-file deletion prohibition (PRD §5.1)" block
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. One modified production file, one modified test file:
src/agents/prompts.ts           # +FORBIDDEN ACTIONS section in BUG_HUNT, PRP_BLUEPRINT, PRP_BUILDER
tests/unit/agents/prompts.test.ts # +describe('critical-file deletion prohibition (PRD §5.1)')
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: CLEANUP_PROMPT already has the FORBIDDEN ACTIONS block (prompts.ts:1077-1093,
// authored in P3.M1.T3.S3). DO NOT re-add to CLEANUP_PROMPT — it would DUPLICATE the block
// inside one prompt constant. CLEANUP is the REFERENCE TEMPLATE only.

// CRITICAL: The three NEW sections must NOT copy the cleanup-specific opener
// ("You are the one agent explicitly licensed to delete things") — the bug hunter,
// researcher (bug-fix breakdown), and coder (post-validation fix) are NOT licensed to delete
// things. Use a NEUTRAL opener. Also drop the cleanup-only "You MUST NOT run `git commit` or
// `git add`" clause (that is cleanup's double-commit-avoidance rule, irrelevant to the others).

// CRITICAL: PRP_BLUEPRINT_PROMPT (L182-651) and PRP_BUILDER_PROMPT (L662-909) are LARGE
// template strings that include a <PRP-TEMPLATE>/<PRP-README> block and example code fences
// containing their own `rm`-less prose. When inserting the FORBIDDEN ACTIONS section, place
// it OUTSIDE the <PRP-TEMPLATE> / <PRP-README> XML-tagged regions so it is a top-level
// instruction, not buried inside the template example. Recommended insertion points are
// BEFORE the template region (PRP_BLUEPRINT: after "## Work Item Information"; PRP_BUILDER:
// after "## PRP File:").

// GOTCHA: The exact closing-token line for each constant (verified via grep) is:
//   PRP_BLUEPRINT_PROMPT  → ` ` as const;` at L651
//   PRP_BUILDER_PROMPT    → ` ` as const;` at L909
//   BUG_HUNT_PROMPT       → ` ` as const;` at L1033
//   (CLEANUP_PROMPT closes with ` `;` near L1116 — it has NO ` as const`)
// Insert BEFORE the closing backtick of each target, not after.

// GOTCHA: The contract's literal required text mentions `prd_snapshot.md` as a
// pipeline-state file. CLEANUP_PROMPT's existing block names `PRD.md, PRP.md, tasks.json`
// but NOT prd_snapshot.md in its "NOT temporary" sentence. To honor the contract verbatim,
// the three NEW sections should list "Pipeline-state files (PRD.md, PRP.md, tasks.json,
// prd_snapshot.md) are NOT temporary — do not delete them." You do NOT need to edit
// CLEANUP_PROMPT to add prd_snapshot.md there (it is out of scope and CLEANUP already
// forbids deleting plan/ wholesale, which covers prd_snapshot.md in practice).

// GOTCHA: Test assertions match backtick-wrapped verbs ('`rm`', '`git rm`', '`git clean`',
// '`mv`'). The prompts wrap the verbs in backticks (see CLEANUP L1082). If you choose to
// phrase the new sections WITHOUT backticks around the verbs, you MUST update the test
// assertions to match the actual text. Keep prompt phrasing and test assertions consistent.
```

---

## Implementation Blueprint

### Data models and structure

No data models change. This item edits prompt template strings (multi-line
backtick template literals) and adds test assertions. The only "structure" is the
shared core prohibition paragraph, defined once here and inlined into each of the
three target sections.

### The shared core prohibition paragraph (literal text to inline)

This is the contract's required text (contract LOGIC item 3), framed neutrally.
Inline this exact paragraph into each of the three target prompt sections (the
opener line is the ONLY per-prompt variable):

```markdown
## FORBIDDEN ACTIONS — Critical-File Deletion Protection (PRD §5.1)

You **MUST NOT** use `rm`, `git rm`, `git clean`, or `mv` to delete or move
`PRD.md`, any `PRP.md` file, or anything under `plan/`. These files are
pipeline state, not scratch artifacts — deleting or moving them corrupts the
session and can be committed permanently by Smart Commit (`git add -A`).

Pipeline-state files (`PRD.md`, `PRP.md`, `tasks.json`, `prd_snapshot.md`) are
**NOT temporary** — do not delete them.
```

Per-prompt openers (one line, prepended to the shared paragraph):

- **BUG_HUNT_PROMPT**: `You are a bug hunter that may tidy test artifacts, but
  the following files are off-limits.` (then the shared paragraph)
- **PRP_BLUEPRINT_PROMPT** ("bug-fix breakdown"): `You are researching and
  planning; you must never delete pipeline-state files. The following are
  absolute.` (then the shared paragraph)
- **PRP_BUILDER_PROMPT** ("post-validation fix"): `You are implementing a fix;
  you must never delete pipeline-state files even when cleaning up failed
  attempts. The following are absolute.` (then the shared paragraph)

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/agents/prompts.ts — add FORBIDDEN ACTIONS section to BUG_HUNT_PROMPT
  - LOCATE: BUG_HUNT_PROMPT (opens L920, closes L1033 with ` ` as const;`).
  - INSERT: a new `## FORBIDDEN ACTIONS — Critical-File Deletion Protection (PRD §5.1)`
            section using the BUG_HUNT opener + the shared core paragraph (see Blueprint).
  - PLACE: as a prominent `##` section. Recommended: AFTER the `## Important Guidelines`
           block (which ends before `## Output - IMPORTANT`), so it is visible but does
           NOT disrupt the critical file-presence/absence contract in `## Output - IMPORTANT`
           (which MUST remain the final section of the prompt). Alternative acceptable
           placement: immediately after the `## Your Mission` header. Either is fine;
           the rule is "prominent, top-level, not buried".
  - NAMING: section header EXACTLY `## FORBIDDEN ACTIONS — Critical-File Deletion Protection (PRD §5.1)`
            (matches CLEANUP_PROMPT L1077 for grep-ability).
  - PRESERVE: the `## Output - IMPORTANT` block (L1015-1032) UNCHANGED — its
            file-presence/absence semantics control the bugfix pipeline. The new section
            goes ABOVE it.

Task 2: MODIFY src/agents/prompts.ts — add FORBIDDEN ACTIONS section to PRP_BLUEPRINT_PROMPT
  - LOCATE: PRP_BLUEPRINT_PROMPT (opens L182, closes L651 with ` ` as const;`).
  - INSERT: the PRP_BLUEPRINT ("bug-fix breakdown") opener + shared core paragraph.
  - PLACE: as a top-level `##` section OUTSIDE the <PRP-TEMPLATE> region. Recommended:
            immediately after the `## Work Item Information` block (the block with
            **ITEM TITLE**/**ITEM DESCRIPTION**, ~L186-188), BEFORE `## MULTI-PRP
            BATCHING POLICY`. This makes it an absolute behavioral constraint visible
            at the top, consistent with how absolute rules precede guidance.
  - NAMING: section header EXACTLY `## FORBIDDEN ACTIONS — Critical-File Deletion Protection (PRD §5.1)`.
  - GOTCHA: Do NOT place the section INSIDE the <PRP-TEMPLATE> ... </PRP-TEMPLATE>
            block (which starts later in the constant) — it must be a top-level
            instruction to the researcher agent, not part of the template example.
            The `## Work Item Information` area is safely ABOVE the template region.

Task 3: MODIFY src/agents/prompts.ts — add FORBIDDEN ACTIONS section to PRP_BUILDER_PROMPT
  - LOCATE: PRP_BUILDER_PROMPT (opens L662, closes L909 with ` ` as const;`).
  - INSERT: the PRP_BUILDER ("post-validation fix") opener + shared core paragraph.
  - PLACE: as a top-level `##` section. Recommended: right after the `## PRP File:`
            header (near the top, ~L663-664), BEFORE `## Your Goal`. This puts the
            prohibition in front of the coder before it loads the PRP and starts
            editing files.
  - NAMING: section header EXACTLY `## FORBIDDEN ACTIONS — Critical-File Deletion Protection (PRD §5.1)`.
  - PRESERVE: the `## Execution Process`, `## Completion Verification`, the JSON output
            contract, and the <PRP-README> region UNCHANGED.

Task 4: MODIFY tests/unit/agents/prompts.test.ts — add the prohibition assertion block
  - ADD: a `describe('critical-file deletion prohibition (PRD §5.1)', () => { ... })`
            block, mirroring the existing `describe('pre-merged PRD declaration
            (PRD §2.3)')` block shape (an it.each over the target prompts).
  - ASSERT: for each of BUG_HUNT_PROMPT, PRP_BLUEPRINT_PROMPT, PRP_BUILDER_PROMPT,
            and CLEANUP_PROMPT — that the prompt contains: '`rm`', '`git rm`',
            '`git clean`', '`mv`', '`PRD.md`', '`PRP.md`', '`plan/`', and 'NOT temporary'.
  - IMPORT: the four constants are ALREADY imported at the top of the test file
            (verify the existing import includes all four; it does — see the
            "prompt exports" describe block). No new import needed.
  - FOLLOW pattern: the existing `expect(BUG_HUNT_PROMPT).toContain('...')` style.
  - GOTCHA: keep the backtick-in-string assertions consistent with the prompt phrasing
            you actually wrote (see Known Gotchas). If you wrote the verbs WITHOUT
            backticks, change the assertions to match.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: shared core prohibition paragraph, inlined (not a function) into each prompt.
// The prompts are `as const` template-literal string constants — they CANNOT call a
// helper function at module-eval time for their BODY (the body is a static string).
// (PRD_PREMERGED_DECLARATION IS interpolated via ${...} because it is a module const
// declared ABOVE the prompts — you MAY follow that pattern and extract the core paragraph
// into a `const DELETION_PROHIBITION_CORE = \`...\`;` if you prefer DRY. Either is
// acceptable. If you interpolate, declare the const ABOVE PRP_BLUEPRINT_PROMPT (L182)
// so all three prompts can reference it, and mirror how PRD_PREMERGED_DECLARATION is
// declared + interpolated.)

// OPTION A (inline, simplest, matches CLEANUP_PROMPT's own style — RECOMMENDED):
//   paste the shared paragraph verbatim into each of the three target sections.

// OPTION B (DRY, interpolated — mirrors PRD_PREMERGED_DECLARATION):
//   const DELETION_PROHIBITION_CORE = `
// You **MUST NOT** use \`rm\`, \`git rm\`, \`git clean\`, or \`mv\` to delete or move
// \`PRD.md\`, any \`PRP.md\` file, or anything under \`plan/\`. ...
// Pipeline-state files (\`PRD.md\`, \`PRP.md\`, \`tasks.json\`, \`prd_snapshot.md\`) are
// **NOT temporary** — do not delete them.
// ` as const;
//   then in each prompt:  ## FORBIDDEN ACTIONS ... <opener>\n${DELETION_PROHIBITION_CORE}

// Choose ONE option and apply it consistently to all three prompts. Do NOT mix.
// (CLEANUP_PROMPT stays inline-as-authored; do not refactor it.)

// CRITICAL — what NOT to do:
// ❌ Do NOT add the section to CLEANUP_PROMPT — it already has it (L1077-1093).
// ❌ Do NOT copy the cleanup-specific opener ("you are the one agent explicitly licensed
//    to delete things") or the cleanup-only `git commit`/`git add` clause into the other three.
// ❌ Do NOT modify src/utils/git-commit.ts (PROTECTED_FILES / restore_critical_files) — S2.
// ❌ Do NOT modify agent-factory.ts, prp-executor.ts, or any workflow file — out of scope.
// ❌ Do NOT bury the section inside <PRP-TEMPLATE> / <PRP-README> tagged regions.
```

### Integration Points

```yaml
DATABASE:
  - none

CONFIG:
  - none (no .env.example, no constants.ts, no new env vars). The prohibition is
    prompt-internal text, not operator-tunable config.

ROUTES:
  - none (no CLI surface change; prompt-internal)

DOWNSTREAM (consumed by P3.M2.T4.S2):
  - S2 (restore_critical_files mechanical layer) is the second line of defense.
    S1's prompt text and S2's git-side guard are INDEPENDENT (no code dependency);
    S2 can proceed in parallel. S1 reduces the frequency with which S2's restore
    fires; S2 catches the cases where an agent deletes despite the prompt.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing src/agents/prompts.ts:
npm run lint           # ESLint — zero errors (the new sections are inside template literals; no new code)
npm run format:check   # Prettier — zero diffs (run `npm run format` to auto-fix)
npm run typecheck      # tsc --noEmit — zero errors (no type changes; template strings only)

# Combined gate:
npm run lint && npm run format:check && npm run typecheck
# Expected: GREEN. If you chose OPTION B (interpolated DELETION_PROHIBITION_CORE const),
#   typecheck confirms the const is declared above its first use.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The modified test file:
npx vitest run tests/unit/agents/prompts.test.ts
# Expected: GREEN. The new "critical-file deletion prohibition (PRD §5.1)" block passes
#   for all four prompts (three new + CLEANUP which already had the phrases).

# Related prompt-builder tests (they consume the constants — should be unaffected since
# the constants are still strings, just longer):
npx vitest run tests/unit/agents/prompts/
# Expected: GREEN. If a prompt-builder test deep-asserts exact prompt LENGTH or exact
#   substring absence, it may need updating — but none currently do (they assert presence
#   of headers/phases, not absence). Investigate any failure before editing the test.
```

### Level 3: Integration Testing (System Validation)

```bash
# This PRP adds prompt text; it does NOT change runtime control flow. Integration tests
# that assert prompt CONTENT (not exact shape) should be unaffected. Run them to confirm:
npx vitest run tests/integration/bug-finding-prompt.test.ts
npx vitest run tests/integration/prp-create-prompt.test.ts
npx vitest run tests/integration/prp-execute-prompt.test.ts 2>/dev/null || true
# Expected: GREEN. If an integration test asserts the prompt does NOT contain a phrase
#   you added, it was over-asserting; update it to allow the new section.

# Manual grep check — prove all four deletion-capable prompts now carry the prohibition:
grep -nE 'FORBIDDEN ACTIONS — Critical-File Deletion Protection' src/agents/prompts.ts
# Expected: FOUR matches — one each in PRP_BLUEPRINT_PROMPT, PRP_BUILDER_PROMPT,
#   BUG_HUNT_PROMPT, and CLEANUP_PROMPT. If fewer than four, a target was missed.

grep -nE 'git rm' src/agents/prompts.ts
# Expected: at least FOUR matches (the four FORBIDDEN ACTIONS sections). CLEANUP has it
#   at ~L1082; the three new sections add three more.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the three new sections do NOT accidentally include the cleanup-only opener
# or the cleanup-only git commit/git add clause (those are cleanup-specific):
for p in PRP_BLUEPRINT_PROMPT PRP_BUILDER_PROMPT BUG_HUNT_PROMPT; do
  echo "=== $p ==="
  awk "/export const $p = /,/\` as const;/" src/agents/prompts.ts \
    | grep -nE 'one agent explicitly licensed|git commit.*git add|MUST NOT run .git commit' \
    || echo "  (clean — no cleanup-only clauses leaked)"
done
# Expected: each prints "(clean — no cleanup-only clauses leaked)". If any leaks, remove
#   the cleanup-specific sentence/clause from that section.

# Confirm scope — only the two files changed:
git diff --name-only
# Expected EXACTLY:
#   src/agents/prompts.ts
#   tests/unit/agents/prompts.test.ts
# (plus plan/008_…/P3M2T4S1/ research/PRP artifacts, which are not source). If
#   git-commit.ts, agent-factory.ts, prp-executor.ts, or any workflow appears, STOP —
#   that is out of scope / collides with S2 or P3.M2.T3.S1.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed successfully.
- [ ] `npm run lint` GREEN (zero errors).
- [ ] `npm run format:check` GREEN (zero diffs).
- [ ] `npm run typecheck` GREEN (zero errors).
- [ ] `npm run test:run` GREEN (full suite).
- [ ] `npm run validate` GREEN (the project's combined gate).

### Feature Validation

- [ ] `BUG_HUNT_PROMPT` contains a `## FORBIDDEN ACTIONS — Critical-File Deletion Protection (PRD §5.1)` section with the four verbs + three path-classes + "NOT temporary".
- [ ] `PRP_BLUEPRINT_PROMPT` contains the same shared-core section (neutral opener).
- [ ] `PRP_BUILDER_PROMPT` contains the same shared-core section (neutral opener).
- [ ] `CLEANUP_PROMPT` is UNCHANGED (its existing block at L1077-1093 already satisfies §5.1).
- [ ] The three new sections do NOT contain the cleanup-only opener or the cleanup-only `git commit`/`git add` clause (Level 4 grep confirms).
- [ ] `grep -nE 'FORBIDDEN ACTIONS — Critical-File Deletion Protection' src/agents/prompts.ts` returns FOUR matches.
- [ ] The new `describe('critical-file deletion prohibition (PRD §5.1)')` test block passes for all four prompts.
- [ ] `git diff --name-only` shows EXACTLY `src/agents/prompts.ts` + `tests/unit/agents/prompts.test.ts`.

### Code Quality Validation

- [ ] Follows existing patterns: mirrors CLEANUP_PROMPT's FORBIDDEN ACTIONS section structure and the test file's `describe('pre-merged PRD declaration')` it.each shape.
- [ ] File placement unchanged (no new files).
- [ ] Anti-patterns avoided: no re-adding to CLEANUP_PROMPT; no cleanup-specific clauses leaked into the other three; no out-of-scope file edits.
- [ ] Shared core paragraph is consistent across the three new sections (verbatim or via an interpolated `DELETION_PROHIBITION_CORE` const).

### Documentation & Deployment

- [ ] Mode A: no new env vars, no config file changes, no README/docs/ edits (the change is prompt-internal).
- [ ] The PRD §5.1 "Prompt layer" sentence is now fully satisfied for all four named prompts (cleanup, bug hunter, bug-fix breakdown, post-validation fix).

---

## Anti-Patterns to Avoid

- ❌ **Don't re-add the section to `CLEANUP_PROMPT`.** It already has it (prompts.ts:1077-1093,
     authored in P3.M1.T3.S3). Re-adding duplicates the block inside one constant.
- ❌ **Don't copy the cleanup-specific opener** ("You are the one agent explicitly licensed to
     delete things") or the cleanup-only `git commit`/`git add` clause into the bug-hunter /
     researcher / coder prompts. Those agents are NOT licensed to delete things, and the
     double-commit rule is cleanup-only. Use the neutral openers in the Blueprint.
- ❌ **Don't modify `src/utils/git-commit.ts`** (`PROTECTED_FILES` / `restore_critical_files`).
     That is P3.M2.T4.S2's mechanical layer. S1 is PROMPT-only.
- ❌ **Don't modify `agent-factory.ts`, `prp-executor.ts`, or any workflow file.** They are out
     of scope (P3.M2.T3.S1 owns agent-factory.ts/commit-message-agent.ts; the fix-prompt user
     message in prp-executor.ts needs no change because the prohibition rides on the system
     prompt = PRP_BUILDER_PROMPT).
- ❌ **Don't bury the section inside `<PRP-TEMPLATE>` / `<PRP-README>` tagged regions.** Those
     are template examples, not top-level instructions. Place the section as a top-level `##`
     block above those regions.
- ❌ **Don't disrupt `BUG_HUNT_PROMPT`'s `## Output - IMPORTANT` block** (its file-presence/
     absence semantics control the bugfix pipeline). The FORBIDDEN ACTIONS section goes ABOVE it.
- ❌ **Don't make the test assertions and the prompt phrasing inconsistent.** If you write the
     verbs without backticks in the prompt, the `'`rm`'`-style assertions fail. Keep them aligned.
- ❌ **Don't add config, env vars, or docs.** This is Mode A — prompt-internal only.

---

## Confidence Score

**9/10** for one-pass implementation success.

Rationale: The change is text-only (three new sections in template-literal strings + one new
test describe-block), with a single reference template already in the codebase (CLEANUP_PROMPT's
FORBIDDEN ACTIONS block) and a fully-specified contract paragraph. The mapping of "bug-fix
breakdown" → `PRP_BLUEPRINT_PROMPT` and "post-validation fix" → `PRP_BUILDER_PROMPT` is proven
by agent-factory.ts system-prompt line numbers and prp-executor.ts's no-system-override fix path.
The only subtlety — not leaking the cleanup-specific opener/clause into the other three — is
explicitly called out in Tasks 1-3, the Known Gotchas, and the Level 4 grep check. No external
dependencies, no runtime control-flow change, no parallel-PR collision (scoped strictly to
prompts.ts + its test; S2 owns git-commit.ts). The -1 is for the small judgment call on
exact insertion placement and the optional DRY-vs-inline choice, both of which are resolved by
the "prominent top-level `##` section outside the template region" rule and the consistency
requirement.