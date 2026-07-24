# Audit: deletion-prohibition text across deletion-capable agent prompts

## PRD §5.1 mandate (verbatim from PRD.md h3.9)

> **Prompt layer:** every deletion-capable agent prompt (cleanup, bug hunter,
> bug-fix breakdown, post-validation fix) forbids `rm` / `git rm` / `git clean`
> / `mv` against `PRD.md`, any `PRP.md`, or anything under `plan/`, and forbids
> treating pipeline-state files as "temporary."

The work-item contract (P3.M2.T4.S1) restates the exact required text:

> 'You MUST NOT use rm, git rm, git clean, or mv to delete or move PRD.md, any
> PRP.md file, or anything under plan/. Pipeline-state files (PRD.md, PRP.md,
> tasks.json, prd_snapshot.md) are NOT temporary — do not delete them.'

## Status per deletion-capable prompt (file: `src/agents/prompts.ts`)

| PRD §5.1 name     | Constant               | Lines       | Has prohibition? | Owner agent                |
|-------------------|------------------------|-------------|------------------|----------------------------|
| cleanup           | `CLEANUP_PROMPT`       | 1055-1116   | ✅ YES (template)| createCleanupAgent         |
| bug hunter        | `BUG_HUNT_PROMPT`      | 920-1033    | ❌ NO            | createQAAgent              |
| bug-fix breakdown | `PRP_BLUEPRINT_PROMPT` | 182-651     | ❌ NO            | createResearcherAgent      |
| post-validation fix| `PRP_BUILDER_PROMPT`  | 662-909     | ❌ NO            | createCoderAgent           |

## Reference template — CLEANUP_PROMPT "FORBIDDEN ACTIONS" block (prompts.ts:1077-1093)

```
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
```

The CLEANUP block has a cleanup-specific opener ("the one agent explicitly
licensed to delete things") and a `git commit`/`git add` clause that does NOT
apply to the other three prompts. So we cannot copy the block verbatim — we
extract the CORE prohibition (the `rm`/`git rm`/`git clean`/`mv` list + the
"NOT temporary" clause) and reuse it across the three missing prompts, with a
neutral opener.

## How "bug-fix breakdown" + "post-validation fix" map to prompts (NO dedicated prompts exist)

- **bug-fix breakdown**: `src/workflows/fix-cycle-workflow.ts` `createFixTasks`
  (L232-257) builds fix Subtasks in CODE (no LLM). The fix tasks then run the
  standard PRP pipeline: PRP creation → `createResearcherAgent` whose system
  prompt = `PRP_BLUEPRINT_PROMPT` (agent-factory.ts:358). So "bug-fix breakdown"
  deletion-capability maps to **PRP_BLUEPRINT_PROMPT** (and, at execution time,
  PRP_BUILDER_PROMPT via the coder).
- **post-validation fix**: `src/agents/prp-executor.ts` `#fixAndRetry`
  (L595-642) builds a `createPrompt({user})` inline (NO system override); it runs
  on `this.#coderAgent` whose system prompt = `PRP_BUILDER_PROMPT`
  (createCoderAgent, agent-factory.ts:391, comment at prp-executor.ts:309-310).
  So "post-validation fix" maps to **PRP_BUILDER_PROMPT**.

=> Target files: `BUG_HUNT_PROMPT`, `PRP_BLUEPRINT_PROMPT`, `PRP_BUILDER_PROMPT`
(all in `src/agents/prompts.ts`). `CLEANUP_PROMPT` is ALREADY done — DO NOT
re-add (would duplicate the block).

## git-commit.ts PROTECTED_FILES (src/utils/git-commit.ts:52-58) — RESEARCH NOTE confirmed

```
const PROTECTED_FILES = [
  'PRD.md',           // Original PRD document
  'prd_snapshot.md',  // PRP snapshot for delta detection
  'delta_prd.md',     // Delta PRD document
  'delta_from.txt',   // Parent session reference for delta sessions
  'TEST_RESULTS.md',  // QA bug report output
] as const;
```

**`PRP.md` is NOT in PROTECTED_FILES.** Confirmed by:
- `architecture/phase_findings.md` line 77: *"PROTECTED_FILES includes PRD.md,
  prd_snapshot.md, delta_prd.md, TEST_RESULTS.md — but NOT PRP.md or plan/ dirs."*
- This is WHY the prompt layer + the mechanical `restore_critical_files` layer
  (P3.M2.T4.S2, separate PRP) are the sole guards for PRP.md.

Note: `PROTECTED_FILES` controls commit-EXCLUSION (smartCommit does not
`git add` them). It is unrelated to deletion protection — that is the prompt
layer (THIS item) + the mechanical `restore_critical_files` layer (S2).

## phase_findings.md location

`./plan/008_15504f60a0ef/architecture/phase_findings.md` (7991 bytes) — the
only occurrence in the repo. The item description's "RESEARCH NOTE" references
its §PHASE 3 (lines 68+), specifically line 77 on PROTECTED_FILES.

## Insertion points

- **BUG_HUNT_PROMPT**: closes at prompts.ts:1033 (` ` as const;`). The block
  "## Output - IMPORTANT" (L1015-1032) is the last section. Insert the new
  FORBIDDEN ACTIONS section BEFORE `## Output - IMPORTANT` (or right after
  "## Important Guidelines") so it is prominent but does not disrupt the
  critical file-presence/absence contract at the very end. Recommended: insert
  after "## Important Guidelines" block, before "## Output - IMPORTANT".
- **PRP_BLUEPRINT_PROMPT**: closes at prompts.ts:651. It ends with the
  `<PRP-TEMPLATE>...</PRP-TEMPLATE>` block (which contains "Anti-Patterns to
  Avoid"). Insert the FORBIDDEN ACTIONS section right after the
  `${PRD_PREMERGED_DECLARATION}` line (~L186) so it sits at the top with the
  other absolute rules, OR as its own top-level `##` section after "## Work Item
  Information". Recommended placement: as a new top-level section immediately
  after the `## Work Item Information` block (after L188), before the
  MULTI-PRP BATCHING POLICY — because it is an absolute behavioral constraint.
  (Alternative: after PRP Creation Mission. Either is acceptable; consistency
  with how CLEANUP places it as a prominent `##` section is the guiding rule.)
- **PRP_BUILDER_PROMPT**: closes at prompts.ts:909. Opens with "# Execute BASE
  PRP" + "## PRP File:". Insert the FORBIDDEN ACTIONS section early — right
  after the opening "## PRP File:" header, before "## Your Goal" — so the coder
  sees the prohibition before it begins loading/implementing.

## Exact required phrases (from the contract + CLEANUP template)

The prohibition text MUST contain (verbatim or equivalent):
1. `rm`, `git rm`, `git clean`, `mv` (the four forbidden verbs)
2. `PRD.md`, `PRP.md` (any PRP.md file), `plan/` (anything under plan/)
3. "Pipeline-state files (PRD.md, PRP.md, tasks.json, prd_snapshot.md) are NOT
   temporary — do not delete them."

## Tests

`tests/unit/agents/prompts.test.ts` already has per-prompt content tests (e.g.
"BUG_HUNT_PROMPT should contain expected header"). Add a new `describe` block
"critical-file deletion prohibition (PRD §5.1)" asserting each of the THREE
target prompts contains the prohibition phrases. CLEANUP_PROMPT already passes
its existing implicit coverage but adding it to the same block documents the
full §5.1 coverage. No new test files needed.

## Do NOT touch (out of scope)

- `src/utils/git-commit.ts` (PROTECTED_FILES / restore_critical_files) → that is
  P3.M2.T4.S2's mechanical layer. This item is PROMPT-only.
- `CLEANUP_PROMPT` body (already has the block; re-adding duplicates it).
- `createPrompt` / `#fixAndRetry` in prp-executor.ts (no system override; the
  prohibition rides on PRP_BUILDER_PROMPT).
- agent-factory.ts / commit-message-agent.ts (P3.M2.T3.S1 scope).