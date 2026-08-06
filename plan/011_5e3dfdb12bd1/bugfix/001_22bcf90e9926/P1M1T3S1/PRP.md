# PRP — P1.M1.T3.S1: Verify README.md & docs/ARCHITECTURE.md §9.9 G1.4 references are accurate post-fix

> Bugfix 001, **changeset-level documentation sync (Mode B)**. PRD §9.9 G1.4 mandates the
> throwaway-survival instruction in BOTH the Blueprint (Researcher) and Builder (Coder) prompts.
> The Blueprint gap (BUG-001) was fixed in P1.M1.T1.S1 (commit `363ee37`: added the G1.4 bullet to
> `src/agents/prompts.ts` `PRP_BLUEPRINT_PROMPT` + mirrored it to `PROMPTS.md`). **This task verifies
> that `README.md` and `docs/ARCHITECTURE.md` (and the other `docs/*.md`) do NOT contain a now-stale
> G1.4 reference** (e.g. enumerating the construction guardrails as G1.1–G1.3/G1.5 only, or implying
> G1.4 is Builder-only). Research conclusion: **no edit is expected** — the docs cite §9.9 at a high
> level and ARCHITECTURE.md enumerates the guardrails as the numeric range `G1.1–G1.5` (en-dash),
> which already encompasses G1.4. This PRP makes the verification deterministic and supplies a
> contingency edit if, contrary to expectation, a stale reference is found.

---

## Goal

**Feature Goal**: Run the item-specified grep sweep over `README.md` and `docs/ARCHITECTURE.md`
(plus `docs/*.md`) to confirm the §9.9 / G1.4 documentation state is accurate **after** the T1.S1
Blueprint-prompt fix. Apply a deterministic decision gate: if a doc enumerates the G1.x guardrails
per-prompt OR implies G1.4 is Builder-only (now inaccurate), correct it; otherwise record the
"verified accurate, no edit needed" finding.

**Deliverable**:
1. **A confirmed-accurate documentation state** — `README.md` and `docs/ARCHITECTURE.md` (and any
   `docs/*.md`) verified to contain no stale G1.4 / per-prompt-guardrail reference.
2. **A verification record** at
   `plan/011_5e3dfdb12bd1/bugfix/001_22bcf90e9926/P1M1T3S1/research/doc-g14-verification.md`
   (already authored during planning — the implementing agent **re-runs** §7 of that note and appends
   the executed-command output + dated "verified" line).
3. **(Contingency, only if a stale reference is found)**: a minimal edit to `README.md` or
   `docs/ARCHITECTURE.md` adding/restoring the G1.4 reference per the procedure in *Implementation
   Blueprint → Task C*.

**Success Definition**:
- The grep sweep returns ONLY the expected high-level references (README.md:151; ARCHITECTURE.md:670,
  673, 676) and NO per-prompt G1.x enumeration / no "Builder-only G1.4" claim — OR any such stale
  reference found has been corrected.
- The en-dash range `G1.1–G1.5` in `docs/ARCHITECTURE.md:673` is intact (spans G1.4).
- The verification note records the executed grep output and the dated determination.
- If any doc file was edited: `npx prettier --check <edited-file>` passes (markdown formatting gate).
- **No modification to `PRD.md`, `spec/*.md`, `tasks.json`, `prd_snapshot.md`, `src/**`, `tests/**`,
  or `PROMPTS.md`** (those are owned by humans / T1.S1 / the orchestrator).

## User Persona

N/A — internal documentation accuracy. The "users" are future readers of the reference docs who must
not be misled about which prompts enforce the §9.9 construction guardrails.

## Why

- **Closes the changeset-level docs loop.** `TEST_RESULTS.md` (point 4) already asserts "README,
  docs/ARCHITECTURE.md, and the PROMPTS.md mirror are all synced to §9.9." The T1.S1 fix added a new
  G1.4 bullet to the Blueprint prompt + `PROMPTS.md`; this task is the explicit re-check that the
  *other* docs have nothing that contradicts or pre-dates that fix.
- **Low-risk, bounded scope.** Expected outcome is zero edits; the work is a verification with a
  deterministic decision gate and a ready contingency. No code, tests, config, spec, or PRD changes.
- **Scope discipline.** T1.S1 owns the prompt source + `PROMPTS.md` mirror + its test. T2.S1/S2 own
  the executor test hardening. **T3.S1 owns ONLY README.md / docs/ARCHITECTURE.md / docs/*.md
  accuracy w.r.t. G1.4.** Zero file overlap with T1/T2 except reading their outputs.

## What

### User-visible behavior
None. Documentation-only. No runtime, CLI, config, or API surface change.

### Technical requirements (exact contract)

**Task A — Re-run the verification grep** (the item's specified command + the research note's §7):

```bash
grep -rni 'G1\.4\|throwaway.*surviv\|Blueprint.*gate\|§9\.9\|G1\.1\|G1\.2\|G1\.3\|G1\.5' \
  README.md docs/ARCHITECTURE.md docs/*.md
```

**Task B — Apply the decision gate** (deterministic):

| grep result on README.md / docs/*.md | Action |
| ------------------------------------ | ------ |
| Only high-level §9.9 references + the ARCHITECTURE.md `G1.1–G1.5` **range**; NO literal `G1.4`, NO per-prompt G1.x list, NO "Builder-only" claim | **NO EDIT.** Record the finding (Task D). |
| A line enumerates the G1.x guardrails per-prompt (e.g. "Blueprint: G1.1, G1.2, G1.3, G1.5") and omits G1.4 for the Blueprint | **EDIT** per Task C. |
| A line claims/implying G1.4 is only in the Builder (now inaccurate, since both carry it) | **EDIT** per Task C. |

**Expected result (from planning research): the NO-EDIT branch.** Ground truth (verified this
session): README.md:151 is a high-level "Features" bullet; ARCHITECTURE.md:670–676 is the "Gate
Semantics (PRD §9.9)" paragraph citing `REQ-G1: G1.1–G1.5` as an en-dash numeric range (U+2013,
confirmed via `xxd`). Neither enumerates G1.x per-prompt.

**Task C — Contingency edit (ONLY if the gate routes here).** If a stale reference is found, edit
**only** that doc file (`README.md` or `docs/ARCHITECTURE.md`), preserving the file's existing voice:

- If a per-prompt guardrail list omits G1.4 for the Blueprint: insert the G1.4 entry so the
  Blueprint's construction guardrails read G1.1–G1.5 (matching `spec/16-validation-gates.md:27`):
  _"G1.4 — throwaway artifacts must survive the coder's turn (Blueprint and Builder prompts both
  instruct the Coder not to delete a spike/throwaway artifact until after validation)."_
- If a line implies G1.4 is Builder-only: reword to "the Blueprint **and** Builder prompts" so it
  reflects the dual-prompt requirement now that both carry it.
- Then run `npx prettier --check <edited-file>` (and `npx prettier --write <edited-file>` if needed)
  so the markdown formatting gate stays green. **Do not** add G1.4 where the doc intentionally
  speaks at a high level (e.g. README.md:151) — high-level pointers need no per-bullet change.

**Task D — Record the finding** (runs in BOTH branches):

1. Open
   `plan/011_5e3dfdb12bd1/bugfix/001_22bcf90e9926/P1M1T3S1/research/doc-g14-verification.md`.
2. Under its §7, append the **executed** grep output (paste the actual lines printed) and a dated
   line: `VERIFIED <ISO date>: README.md + docs/ARCHITECTURE.md (+ docs/*.md) accurate post-T1.S1
   G1.4 fix. Edit applied: <none | file + one-line summary>.`
3. The work item's commit message states the outcome verbatim (see *Validation Loop → recording*).

### Success Criteria
- [ ] Task A grep executed; output captured.
- [ ] Decision gate (Task B) applied; the branch taken is documented.
- [ ] (NO-EDIT branch) No file under `README.md` / `docs/` was modified for G1.4 reasons.
- [ ] (EDIT branch) Only the stale doc edited; `npx prettier --check <file>` green.
- [ ] Verification note appended with executed grep output + dated determination.
- [ ] No changes to `PRD.md`, `spec/*.md`, `tasks.json`, `prd_snapshot.md`, `src/**`, `tests/**`,
      `PROMPTS.md`, or `.gitignore`.
- [ ] The `G1.1–G1.5` en-dash range in `docs/ARCHITECTURE.md:673` is intact.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The
exact grep command, the deterministic decision gate, the verified ground-truth doc state (which
lines say what), the contingency edit wording tied to the authoritative spec, the file
ownership/forbidden-edit boundaries, the recording format, and the executable validation commands
are all below.

### Documentation & References
```yaml
# MUST READ — the planning-time ground truth + re-verification recipe (this task's own research note)
- docfile: plan/011_5e3dfdb12bd1/bugfix/001_22bcf90e9926/P1M1T3S1/research/doc-g14-verification.md
  section: "1. What P1.M1.T1.S1 changed", "2. Grep results", "3. Why each reference is accurate", "7. Re-verification recipe"
  why: Pins the exact current doc lines (README.md:151; ARCHITECTURE.md:670/673/676), proves the
        G1.1–G1.5 range is an en-dash spanning G1.4, and gives the copy-paste re-verification commands.
  critical: Expected outcome is NO EDIT. Only edit if re-running §7 reveals a per-prompt enumeration
        or a Builder-only G1.4 claim that the planning sweep did not find.

# MUST READ — the changeset context (bug-hunt findings + recommendations)
- docfile: plan/011_5e3dfdb12bd1/bugfix/001_22bcf90e9926/TEST_RESULTS.md
  section: line 4 point (4) "Docs — README, docs/ARCHITECTURE.md, and the PROMPTS.md mirror are all synced to §9.9"
  why: Establishes the pre-T1.S1 docs-sync baseline this task re-confirms.

# AUTHORITATIVE SPEC (READ-ONLY — do NOT edit; cite only)
- file: spec/16-validation-gates.md
  section: line 27 (G1.4 verbatim definition)
  why: Source of truth for G1.4 wording ("The Blueprint and Builder prompts MUST instruct the Coder
        Agent not to delete a throwaway artifact ... during its own turn"). Use this exact sense in any
        contingency edit; never paraphrase it into a contradiction.

# EDITS-OK FILES (only these may be edited, and ONLY in the EDIT branch)
- file: README.md
  why: §9.9 reference at line 151 (high-level "Features" bullet) — expected accurate, no edit.
- file: docs/ARCHITECTURE.md
  why: "Gate Semantics (PRD §9.9)" paragraph at lines 670–676; range `G1.1–G1.5` at line 673 — expected accurate, no edit.

# INFORMATIONAL — the T1.S1 outputs this task is verifying against (do NOT edit)
- file: src/agents/prompts.ts
  why: Now contains the G1.4 bullet in PRP_BLUEPRINT_PROMPT (commit 363ee37) — out of edit scope.
- file: PROMPTS.md
  why: Mirrors G1.4 at line 277 (T1.S1) — out of edit scope; confirm only.

# FORMAT GATE (markdown formatting, project-wide)
- command: "npx prettier --check README.md docs/ARCHITECTURE.md"  # run only if an edit was made
  why: package.json `format:check` lints **/*.md with prettier. There is .markdownlint.json but no
        markdownlint npm script — prettier is the deterministic CI gate.
```

### Current Codebase tree (docs surface only)

```bash
README.md                 # §9.9 high-level ref at L151 (Features bullet)
docs/
├── ARCHITECTURE.md       # §9.9 "Gate Semantics" para L670–676; range G1.1–G1.5 at L673
├── CUSTOM_AGENTS.md      # PRP_BLUEPRINT_PROMPT name/link refs (L173,216,236,481,1929) — not G1.x
├── TESTING.md            # prp-blueprint-prompt.test.ts file ref (L176) — not G1.x
├── WORKFLOWS.md          # "blueprint prompt" by-name ref (L443) — not G1.x
├── GROUNDSWELL_GUIDE.md  # generic "Critical Rules" heading (L18,84) — not §9.9 G1.x
└── (CONFIGURATION.md, CLI_REFERENCE.md, CUSTOM_TOOLS.md, INSTALLATION.md, user-guide.md — no G1.x)
PROMPTS.md                # G1.4 mirrored at L277 (T1.S1) + Builder G1.4 at L714/L715 — OUT OF SCOPE
spec/16-validation-gates.md  # authoritative G1.4 def at L27 — READ-ONLY
```

### Desired Codebase tree with files to be added/changed

```bash
# Expected (NO-EDIT branch): no source/doc files change.
plan/011_5e3dfdb12bd1/bugfix/001_22bcf90e9926/P1M1T3S1/research/doc-g14-verification.md
    # EDIT (append executed grep output + dated "verified" line under §7) — the durable artifact.

# Contingency (EDIT branch only): at most ONE of
README.md                 # or
docs/ARCHITECTURE.md      # edited to fix a stale G1.4 reference, then prettier --check'd.
```

### Known Gotchas of our codebase & Library Quirks
```bash
# CRITICAL (scope): This task may edit ONLY README.md / docs/ARCHITECTURE.md / docs/*.md for G1.4
# accuracy. It MUST NOT touch PRD.md, spec/*.md, tasks.json, prd_snapshot.md, src/**, tests/**,
# PROMPTS.md, or .gitignore. PROMPTS.md was already mirrored by T1.S1 — re-anchoring it is out of scope.

# CRITICAL (en-dash): docs/ARCHITECTURE.md:673 uses an en-dash (U+2013) in `G1.1–G1.5`, i.e. a
# numeric RANGE that already includes G1.4. Do not "fix" it to a per-item list — that is NOT stale.

# GOTCHA (anchor drift, out of scope): docs/CUSTOM_AGENTS.md:236 links `../PROMPTS.md#L189-L638`.
# T1.S1 grew the prompt by one line, so the L638 end is now off by ~1. This is a coarse whole-prompt
# anchor that still resolves correctly and is NOT a G1.4-accuracy issue. Do NOT re-anchor it here.

# GOTCHA (formatting): package.json has no `markdownlint` script (only .markdownlint.json config).
# The deterministic markdown gate is prettier (`npm run format:check` covers **/*.md). Run
# `npx prettier --check <file>` only on a file you actually edited.
```

## Implementation Blueprint

### Data models and structure
N/A — documentation-only task. No data models, schemas, or types.

### Implementation Tasks (ordered by dependencies)

```yaml
Task A: VERIFY — re-run the §9.9 / G1.4 grep sweep
  - RUN: grep -rni 'G1\.4\|throwaway.*surviv\|Blueprint.*gate\|§9\.9\|G1\.1\|G1\.2\|G1\.3\|G1\.5' README.md docs/ARCHITECTURE.md docs/*.md
  - CAPTURE: the exact printed lines (for the verification note).
  - EXPECTED: README.md:151; docs/ARCHITECTURE.md:670,673,676 only; NO literal G1.4, NO per-prompt list, NO Builder-only claim.
  - ALSO RUN: sed -n '673p' docs/ARCHITECTURE.md | grep -o 'G1.1.G1.5'   # confirm range token intact
  - OPTIONAL: grep -n 'G1\.4' PROMPTS.md   # informational — confirm T1.S1 mirror at L277 (do NOT edit)

Task B: DECIDE — apply the decision gate (table in "What → Technical requirements")
  - IF output matches the EXPECTED row  -> NO-EDIT branch -> go to Task D.
  - IF any line enumerates G1.x per-prompt omitting Blueprint G1.4, OR implies G1.4 is Builder-only -> EDIT branch -> Task C.

Task C (EDIT branch ONLY): CORRECT a stale reference
  - EDIT: only the single offending doc file (README.md or docs/ARCHITECTURE.md).
  - WORDING: mirror spec/16-validation-gates.md:27 sense — "the Blueprint and Builder prompts both
             instruct the Coder not to delete a throwaway/spike artifact until after validation (G1.4)."
  - PRESERVE: the file's existing voice/markdown style; do not downgrade high-level pointers to per-bullet lists.
  - FORMAT: npx prettier --write <file> then npx prettier --check <file>  (must be green).
  - THEN: go to Task D.

Task D: RECORD the finding (BOTH branches)
  - APPEND to: plan/011_5e3dfdb12bd1/bugfix/001_22bcf90e9926/P1M1T3S1/research/doc-g14-verification.md (§7)
      * the executed grep output from Task A,
      * a dated line: "VERIFIED <ISO date>: ... accurate post-T1.S1 G1.4 fix. Edit applied: <none | file + summary>."
  - PREPARE the commit message (see Validation Loop → recording).
  - SCOPE: do NOT modify any file outside this task's edit set.
```

### Implementation Patterns & Key Details
```bash
# Pattern: high-level doc pointer (correct, leave alone) — README.md:151
#   "... gates are monotonic terminal-state assertions (PRD §9.9): the executor re-runs every gate
#    as a batch on the final tree and neutralizes non-monotonic negative-existence gates."
# -> No per-bullet G1.x content. Adding G1.4 to the Blueprint prompt cannot stale this. NO EDIT.

# Pattern: numeric-range citation (correct, leave alone) — docs/ARCHITECTURE.md:673
#   "Negative file-existence gates are forbidden at construction (REQ-G1: G1.1–G1.5) ..."
# -> En-dash range spans G1.4. NO EDIT. (Verify the en-dash survives any edit you make elsewhere.)

# Contingency pattern (only if a per-prompt list is found): insert the canonical G1.4 sense, e.g.
#   "... G1.4 — throwaway artifacts must survive the coder's turn (Blueprint and Builder prompts both
#    instruct the Coder not to delete a spike/throwaway artifact until after validation) ..."
```

### Integration Points
```yaml
DOCUMENTATION:
  - files in scope: README.md, docs/ARCHITECTURE.md, docs/*.md (G1.4 accuracy only)
  - pattern: "high-level §9.9 pointer OR REQ-G1: G1.1–G1.5 range — no per-prompt enumeration expected"

COMMIT (recording):
  - the work item's commit message MUST state the outcome, e.g.:
      NO-EDIT: "Verify README/ARCHITECTURE §9.9 G1.4 references accurate post-T1.S1 fix; no doc edits needed"
      EDIT:    "Correct stale G1.4 reference in <file> after Blueprint dual-prompt fix (BUG-001 T3.S1)"
  - if the orchestrator's commit-of-record only fires on file changes, the appended verification
    note is the committed artifact that carries the determination.

NONE OF: src/, tests/, PROMPTS.md, spec/, PRD.md, tasks.json, config, .gitignore
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
# Re-verification grep (the core of this task)
grep -rni 'G1\.4\|throwaway.*surviv\|Blueprint.*gate\|§9\.9\|G1\.1\|G1\.2\|G1\.3\|G1\.5' \
  README.md docs/ARCHITECTURE.md docs/*.md
# EXPECTED: README.md:151; docs/ARCHITECTURE.md:670,673,676 — high-level / range only.

# Confirm the en-dash range is intact (prints the range token)
sed -n '673p' docs/ARCHITECTURE.md | grep -o 'G1.1.G1.5'

# Markdown formatting — run ONLY if Task C edited a file
npx prettier --check README.md docs/ARCHITECTURE.md   # green; or npx prettier --write <file> first
# (No markdownlint npm script exists; prettier is the gate. .markdownlint.json is editor-only.)

# Expected: grep returns the expected lines; prettier --check passes (or N/A if no edit).
```

### Level 2: Unit Tests (Component Validation)
```bash
# N/A — documentation-only task; no code under test. (Do not run the TS test suite for this task;
# it is unaffected. If you do run it for sanity, `npm run typecheck` + `npm run test:run` should be
# unchanged from the T1.S1/T2 green state.)
```

### Level 3: Integration Testing (System Validation)
```bash
# Confirm the T1.S1 outputs this task verifies against are present (informational, read-only).
grep -n 'G1\.4' PROMPTS.md              # EXPECTED: L277 (Blueprint mirror) + L714/L715 (Builder)
grep -n 'G1\.4' src/agents/prompts.ts   # EXPECTED: Blueprint CRITICAL RULES bullet + Builder block

# Confirm no forbidden file was accidentally modified
git status --porcelain | grep -E 'PRD\.md|spec/|tasks\.json|prd_snapshot|src/|tests/|PROMPTS\.md|\.gitignore' \
  && echo "VIOLATION: out-of-scope file touched" || echo "OK: no out-of-scope files modified"
# Expected: "OK: no out-of-scope files modified" (plus, in the EDIT branch, the one edited doc).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Human-readable accuracy read of the two key passages
sed -n '149,153p' README.md
sed -n '668,678p' docs/ARCHITECTURE.md
# Read both and confirm: (a) neither claims G1.4 is Builder-only; (b) neither enumerates the
# construction guardrails per-prompt; (c) the ARCHITECTURE range G1.1–G1.5 visibly spans G1.4.
# Expected: all three hold. If any fails, apply Task C.
```

### Recording (required in both branches)
- Append the executed Task A output + a dated `VERIFIED ...` line to
  `plan/011_5e3dfdb12bd1/bugfix/001_22bcf90e9926/P1M1T3S1/research/doc-g14-verification.md` §7.
- The work item commit message states the outcome (NO-EDIT vs EDIT) verbatim.

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 grep returns ONLY the expected high-level / range references.
- [ ] En-dash range `G1.1–G1.5` intact at `docs/ARCHITECTURE.md:673`.
- [ ] (EDIT branch only) `npx prettier --check <edited-file>` green.
- [ ] No out-of-scope file modified (`git status` check at Level 3).

### Feature Validation
- [ ] Decision gate applied and the taken branch documented.
- [ ] Verification note appended with executed grep output + dated determination.
- [ ] `PROMPTS.md` G1.4 mirror confirmed present (informational; T1.S1 output).

### Code Quality Validation
- [ ] (EDIT branch) edit preserves the doc's existing voice/markdown style.
- [ ] (EDIT branch) no high-level pointer was downgraded to a per-bullet list without cause.
- [ ] Recording note is clear enough to audit the determination later.

### Documentation & Deployment
- [ ] The determination (no-edit or edit summary) is captured in the commit message.
- [ ] No new environment variables or config (N/A for this task).

---

## Anti-Patterns to Avoid
- ❌ Don't "fix" the en-dash range `G1.1–G1.5` into a per-item list — it is a correct numeric range that already includes G1.4.
- ❌ Don't add a G1.4 bullet to high-level pointers (README.md:151) that intentionally speak about §9.9 at runtime-behavior level.
- ❌ Don't edit `PROMPTS.md`, `src/`, `spec/`, `PRD.md`, `tasks.json`, or `prd_snapshot.md` — they are owned by T1.S1 / humans / the orchestrator.
- ❌ Don't re-anchor the `PROMPTS.md#L189-L638` link in `docs/CUSTOM_AGENTS.md` — anchor drift is out of scope and not a G1.4-accuracy issue.
- ❌ Don't skip recording the finding just because no file changed — the determination itself is the deliverable.
- ❌ Don't run the full TS test/lint suite "to be safe" and then treat unrelated pre-existing diagnostics as this task's failure — this task touches no code.