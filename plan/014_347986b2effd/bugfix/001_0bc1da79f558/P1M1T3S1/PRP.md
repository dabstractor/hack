# PRP — P1.M1.T3.S1: Sweep README.md & overview docs for the §2.3 idempotency/marker changeset

> Bugfix 001, **changeset-level documentation sweep (Mode B, SOW §5)** for the two §2.3 bugfixes:
> **BUG-001** (collision-proof include markers, T1.S1 Complete — marker byte format changed `@`→`@!`)
> and **BUG-002** (depth-gate elision, T2.S1 Ready — `resolve(resolve(x))===resolve(x)` now holds
> unconditionally). Per-file JSDoc/test comments are already updated by those subtasks (Mode A); **this
> task covers ONLY cross-cutting / overview docs** (`README.md` + `docs/*.md`) and RECORDS (never edits)
> recommendations against the human-owned `spec/02-core-concepts.md`.

---

## Goal

**Feature Goal**: Sweep `README.md` and `docs/*.md` for prose referencing the §2.3 distributed-PRD
include resolver, then align it to the post-fix reality: (1) include markers are now **collision-proof**
(structurally non-resolvable — the byte format is `<!-- @!include: path -->` / `<!-- @!end-include -->` /
`<!-- @!include-ref: token -->`, NOT the old `<!-- @include: … -->`); (2) `resolve(resolve(x))===resolve(x)`
now holds **unconditionally** (the depth gate ELIDES resolvable survivors; no "literal survivor" leak).
Make minimal, accurate touches; leave prose that is already correct untouched. RECORD (do not edit)
subtly-inaccurate lines in the human-owned spec as recommendations for the spec-owner.

**Deliverable**:
1. **`README.md`** — fix the stale OLD marker-format reference at L135 (`<!-- @include: path -->` → `<!-- @!include: path -->`).
2. **`docs/ARCHITECTURE.md`** — fix the stale OLD marker-format reference at L170 (`<!-- @include: path -->` / `<!-- @end-include -->` → `@!` forms).
3. **`docs/CONFIGURATION.md`** — fix the stale OLD marker-format reference at L310 (same `@`→`@!` touch).
4. **Spec recommendations recorded** (in the commit message + the research note §2) for `spec/02-core-concepts.md` L25 (the "dedup itself bounds recursion" framing) and L30 (old marker format) — **NOT edited** (human-owned).
5. **A verification record** appended to
   `plan/014_347986b2effd/bugfix/001_0bc1da79f558/P1M1T3S1/research/changeset-doc-sweep.md` (the executed grep output + dated determination).

**Success Definition**:
- After the edits, `grep -rn '<!-- @include:\|<!-- @end-include\|<!-- @include-ref:' README.md docs/*.md` returns **zero** matches (all overview-doc marker references migrated to the `@!` form).
- `grep -rn '@!include' README.md docs/*.md` shows the new format on the 3 edited lines.
- No overview doc claims the old "literal survivor" / "deeper tokens stay literal" depth behavior (verified — none did; this is a confirmation, not an edit).
- The already-correct idempotency prose (`docs/ARCHITECTURE.md:168`, unconditional) is left untouched (it is now TRUE post-BUG-002).
- `spec/02-core-concepts.md` is **NOT modified**; its L25/L30 staleness is recorded as recommendations.
- `npx prettier --check` on the 3 edited files passes.
- **No modification to** source, tests, config, `PRD.md`, `**/tasks.json`, `prd_snapshot.md`, `.gitignore`, or `spec/**`.

## User Persona

N/A — internal documentation accuracy. The "users" are future readers of the overview docs who must not
see the pre-BUG-001 marker byte format (`<!-- @include: … -->`) contradicted by the actual resolver output
(`<!-- @!include: … -->`), nor be misled about the idempotency guarantee.

## Why

- **Closes the changeset-level docs loop for the §2.3 bugfixes.** The source is already migrated to the
  collision-proof `@!` marker format (T1.S1) and the depth gate now elides resolvable survivors (T2.S1);
  the per-file JSDoc/tests are updated (Mode A). The overview docs still show the OLD marker byte format
  in 3 places — this task syncs them so the docs match the resolver's actual output.
- **Low-risk, minimal touches.** The edit is mechanical (`@`→`@!` in 3 marker examples). No prose rewrite;
  the idempotency/depth descriptions are already accurate post-fix (the fix made the aspirational
  unconditional-idempotency claim actually true).
- **Respects the human-owned spec boundary.** `spec/02-core-concepts.md §2.3` is human-owned; its
  subtly-stale lines (L25 dedup framing, L30 old marker format) are RECORDED as recommendations, not
  auto-mutated — per the task contract.
- **Scope discipline.** T1.S1 = source marker format + its tests; T2.S1 = depth-gate elision + its tests.
  **T3.S1 = overview-doc accuracy ONLY.** Zero source/test overlap.

## What

### User-visible behavior
None. Documentation-only. No runtime, CLI, config, or API surface change.

### Technical requirements (exact contract)

**Task A — Re-run the doc grep sweep** (the item's specified terms + the research note's §4):

```bash
# (a) Find EVERY stale OLD-marker-format reference in overview docs (the edit set).
grep -rn '<!-- @include:\|<!-- @end-include\|<!-- @include-ref:' README.md docs/*.md
# (b) Confirm NO overview doc claims the old literal-survivor depth behavior.
grep -rni 'literal\|survivor\|deeper token\|stay literal' README.md docs/*.md
```

**Task B — Apply the decision gate** (deterministic):

| grep result | Action |
| ----------- | ------ |
| (a) returns `README.md:135`, `docs/ARCHITECTURE.md:170`, `docs/CONFIGURATION.md:310` (the OLD `<!-- @include: … -->` / `<!-- @end-include -->` format) | **EDIT** each: insert `!` after `@` → `<!-- @!include: … -->` / `<!-- @!end-include -->` (Task C). |
| (a) returns an additional overview-doc line with the OLD format | **EDIT** it too (same `@`→`@!` touch) — the sweep is exhaustive. |
| (b) returns a §2.3-resolution claim of "literal survivor" / "deeper tokens stay literal" | **EDIT** it to reflect elision (resolvable survivors are elided; prose verbatim). (Expected: none.) |
| A line already states the post-fix guarantee correctly (e.g. ARCHITECTURE.md:168 unconditional idempotency) | **LEAVE** it. |

**Expected result (from planning research): the 3 marker-format edits at README.md:135, ARCHITECTURE.md:170, CONFIGURATION.md:310; no literal-survivor claim to fix.**

**Task C — The 3 marker-format edits (docs only, minimal touch):**
- `README.md:135` — `<!-- @include: path -->` → `<!-- @!include: path -->`.
- `docs/ARCHITECTURE.md:170` — `<!-- @include: path -->` / `<!-- @end-include -->` → `<!-- @!include: path -->` / `<!-- @!end-include -->`.
- `docs/CONFIGURATION.md:310` — `<!-- @include: path -->` / `<!-- @end-include -->` → `<!-- @!include: path -->` / `<!-- @!end-include -->`.
- (The `@include-ref` elision-ref form is not named in overview docs, so only include/end-include need the `!` here. Do NOT rewrite surrounding prose.)

**Task D — RECORD spec recommendations (do NOT edit spec/02-core-concepts.md):**
- **L30** — old marker format `<!-- @include: path -->` / `<!-- @end-include -->` → recommend the human update to the collision-proof `@!` form.
- **L25** — "dedup itself bounds recursion" framing is subtly incomplete (dedup bounds cycles/diamonds only; deep LINEAR chains are now bounded for idempotency by the depth-gate elision). Recommend noting the depth gate elides resolvable survivors so idempotency holds unconditionally.
- Record both in the commit message (and they are already captured in the research note §2). **Do NOT edit the spec.**

**Task E — Record the finding:**
1. Append the executed Task A output + a dated line to
   `plan/014_347986b2effd/bugfix/001_0bc1da79f558/P1M1T3S1/research/changeset-doc-sweep.md` §4.
2. The commit message states the outcome + the spec recommendations verbatim.

### Success Criteria
- [ ] Task A grep (a)/(b) executed; output captured.
- [ ] Task C applied: the 3 marker-format references migrated to `@!` (or any additional OLD-format overview-doc line found by the sweep).
- [ ] Post-edit: `grep -rn '<!-- @include:\|<!-- @end-include\|<!-- @include-ref:' README.md docs/*.md` is empty; `grep -rn '@!include' README.md docs/*.md` shows the edited lines.
- [ ] Already-correct idempotency/depth prose left untouched.
- [ ] `spec/02-core-concepts.md` NOT modified; L25 + L30 recommendations recorded in the commit message.
- [ ] `npx prettier --check` on the edited files passes.
- [ ] No changes to source, tests, config, `PRD.md`, `**/tasks.json`, `prd_snapshot.md`, `.gitignore`, or `spec/**`.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The exact
grep commands, the deterministic decision gate, the verified ground-truth doc state (which 3 lines carry
the stale OLD marker format; which idempotency/depth prose is already correct), the exact `@`→`@!` edit,
the spec-recommendation text (L25/L30), the docs-only + never-edit-spec boundary, the recording format,
and the executable validation commands are all below.

### Documentation & References
```yaml
# MUST READ — the planning-time ground truth + re-verification recipe (this task's own research note)
- docfile: plan/014_347986b2effd/bugfix/001_0bc1da79f558/P1M1T3S1/research/changeset-doc-sweep.md
  section: "1a. STALE OLD-MARKER-FORMAT references", "1b. Idempotency / depth prose (NO edit)", "1d. No literal-survivor claim", "2. Human-owned spec recommendations", "4. Re-verification recipe"
  why: Pins the exact 3 stale lines (README.md:135; ARCHITECTURE.md:170; CONFIGURATION.md:310), proves the
        idempotency/depth prose is already accurate, gives the L25/L30 spec-recommendation text, and the
        copy-paste re-verification commands.
  critical: The grep pattern `<!-- @include:` does NOT match the new `@!include` (`!` sits between `@`
        and `i`), so it isolates the OLD-format references cleanly. Expected outcome is 3 edits, not a no-op.

# MUST READ — the two fixes this task aligns docs to (semantics)
- docfile: plan/014_347986b2effd/bugfix/001_0bc1da79f558/TEST_RESULTS.md
  section: h3.0 "Issue 1" (BUG-001 marker collision), h3.1 "Issue 2" (BUG-002 deep-chain idempotency), h2.5 "Recommendations"
  why: Establishes the exact OLD marker byte format (`<!-- @include: … -->`), the collision-proof fix
        (`@`→`@!`), the OLD depth behavior ("literal survivor"), and the elision fix.

# INPUT CONTRACTS — the two implementing subtasks (their outputs + per-file JSDoc, already Mode-A updated)
- docfile: plan/014_347986b2effd/bugfix/001_0bc1da79f558/P1M1T1S1/PRP.md
  why: BUG-001 — confirms the NEW marker format is `<!-- @!include: … -->` / `<!-- @!end-include -->` /
        `<!-- @!include-ref: token -->` (technique B: `!` after `@` defeats the path-class token group).
- docfile: plan/014_347986b2effd/bugfix/001_0bc1da79f558/P1M1T2S1/PRP.md
  why: BUG-002 — confirms the depth gate now ELIDES resolvable survivors (was unscanned `return content`),
        so `resolve(resolve(x))===resolve(x)` holds unconditionally. Its research/depth-gate-elision-fix.md
        has the detail.

# SOURCE OF TRUTH (read-only) — confirms the NEW marker format is already in the resolver
- file: src/core/session-utils.ts
  section: L331-332, L442, L465-466, L503, L552, L588-589, L605
  why: The resolver already emits `<!-- @!include: … -->` / `<!-- @!end-include -->` / `<!-- @!include-ref: … -->`.
        The docs lag the source; this task catches them up. (Source is OUT of this task's edit scope.)

# EDITS-OK FILES (only these 3 may be edited)
- file: README.md
  why: L135 marker-format example — OLD `<!-- @include: path -->` → NEW `<!-- @!include: path -->`.
- file: docs/ARCHITECTURE.md
  why: L170 marker-format example — OLD pair → NEW `@!` pair. (L168 idempotency + L183/207 pointers are ACCURATE — leave.)
- file: docs/CONFIGURATION.md
  why: L310 marker-format example — OLD pair → NEW `@!` pair. (L305/309 depth-cap description is ACCURATE — leave.)

# HUMAN-OWNED — RECORD recommendations, NEVER edit
- file: spec/02-core-concepts.md
  section: §2.3 L25 (dedup-bounds-recursion framing), L30 (old marker format)
  why: Human-owned spec. L25 is subtly incomplete re: deep linear chains (now bounded by depth-gate
        elision); L30 shows the OLD marker format. RECORD both as recommendations in the commit message.

# FORMAT GATE (markdown formatting, project-wide)
- command: "npx prettier --check README.md docs/ARCHITECTURE.md docs/CONFIGURATION.md"
  why: package.json `format:check` lints **/*.md with prettier. No markdownlint npm script; prettier is the gate.
```

### Current Codebase tree (docs surface only)

```bash
README.md                       # L132-135 distributed-PRD blurb; L135 marker example (OLD → @!) — EDIT
docs/
├── ARCHITECTURE.md             # L157-183 "Resolved-Document Invariant"; L168 idempotency (accurate); L170 marker example (OLD → @!) — EDIT
├── CONFIGURATION.md            # L301-310 "Distributed PRDs"; L305/309 depth-cap (accurate); L310 marker example (OLD → @!) — EDIT
├── CLI_REFERENCE.md            # prd_changed.marker / delta — UNRELATED to §2.3 resolution
├── (CUSTOM_AGENTS.md, CUSTOM_TOOLS.md, INSTALLATION.md, user-guide.md, WORKFLOWS.md, TESTING.md, GROUNDSWELL_GUIDE.md — no §2.3 marker refs)
spec/02-core-concepts.md        # §2.3 L25/L30 subtly stale — HUMAN-OWNED, RECORD only (do NOT edit)
src/core/session-utils.ts       # already emits @!include markers (T1.S1) — SOURCE, out of scope
```

### Desired Codebase tree with files to be added/changed

```bash
README.md                       # EDIT — L135 marker format @ → @!
docs/ARCHITECTURE.md            # EDIT — L170 marker format @ → @!
docs/CONFIGURATION.md           # EDIT — L310 marker format @ → @!
plan/014_347986b2effd/bugfix/001_0bc1da79f558/P1M1T3S1/research/changeset-doc-sweep.md
                                # EDIT — append executed grep output + dated determination (§4)
# spec/02-core-concepts.md is NOT modified; its L25/L30 recommendations ride in the commit message.
```

### Known Gotchas of our codebase & Library Quirks
```bash
# CRITICAL (scope): edit ONLY README.md / docs/*.md for the marker-format sync. MUST NOT touch source,
#   tests, config, PRD.md, **/tasks.json, prd_snapshot.md, .gitignore — and MUST NOT edit spec/** (human-owned).

# CRITICAL (spec is human-owned): spec/02-core-concepts.md §2.3 L25 (dedup framing) + L30 (old marker
#   format) are subtly stale, but this task RECORDS them as recommendations in the commit message — it
#   does NOT auto-mutate the spec. Editing the spec would violate the task contract.

# GOTCHA (grep isolation): the pattern `<!-- @include:` does NOT match the new `<!-- @!include: … -->`
#   (the `!` sits between `@` and `i`), so grepping for the OLD format cleanly isolates the stale lines.
#   After the edit, the same pattern MUST return zero (the migration is complete).

# GOTCHA (idempotency prose is already correct): docs/ARCHITECTURE.md:168 states unconditional idempotency.
#   Pre-BUG-002 that was aspirational; post-BUG-002 it is TRUE. Do NOT "correct" it — it needs no change.

# GOTCHA (no literal-survivor claim in overview docs): no overview doc describes the old depth-boundary
#   "literal survivor" behavior, so there is nothing to retract on that axis — only the marker format (§1a).

# GOTCHA (formatting): no markdownlint npm script (only .markdownlint.json editor config). The deterministic
#   markdown gate is prettier. Run `npx prettier --check <file>` only on files you actually edited.
```

## Implementation Blueprint

### Data models and structure
N/A — documentation-only task. No data models, schemas, or types.

### Implementation Tasks (ordered by dependencies)

```yaml
Task A: VERIFY — re-run the §2.3 doc grep sweep
  - RUN (a): grep -rn '<!-- @include:\|<!-- @end-include\|<!-- @include-ref:' README.md docs/*.md
  - RUN (b): grep -rni 'literal\|survivor\|deeper token\|stay literal' README.md docs/*.md
  - CAPTURE: the exact printed lines (for the verification note).
  - EXPECTED (a): README.md:135, docs/ARCHITECTURE.md:170, docs/CONFIGURATION.md:310 (OLD marker format).
  - EXPECTED (b): no §2.3-resolution hit.

Task B: DECIDE — apply the decision gate (table in "What → Technical requirements")
  - (a) OLD-format lines -> EDIT branch (Task C).
  - (b) a literal-survivor claim -> EDIT it to elision (expected: none).
  - already-correct idempotency/depth prose -> LEAVE.

Task C: EDIT the marker-format references (docs only, minimal @ -> @! touch)
  - README.md:135            : <!-- @include: path -->        -> <!-- @!include: path -->
  - docs/ARCHITECTURE.md:170 : <!-- @include: path --> / <!-- @end-include --> -> @! pair
  - docs/CONFIGURATION.md:310: <!-- @include: path --> / <!-- @end-include --> -> @! pair
  - (Any additional OLD-format overview-doc line the sweep finds -> same touch.)
  - PRESERVE: surrounding prose. Do NOT rewrite accurate idempotency/depth descriptions.
  - FORMAT: npx prettier --write <file> then npx prettier --check <file> (must be green).
  - DO NOT: edit spec/**, source, tests, config, PRD.md, tasks.json, prd_snapshot.md.

Task D: RECORD spec recommendations (do NOT edit spec/02-core-concepts.md)
  - L30: recommend the human update the OLD marker format (<!-- @include: … -->) to the collision-proof
         @! form (per BUG-001).
  - L25: recommend noting the depth gate elides resolvable survivors (not just caps recursion) so the
         "dedup itself bounds recursion" framing covers deep linear chains and the unconditional-idempotency
         MUST (L27) holds regardless of depth (per BUG-002).
  - Capture both in the commit message (research note §2 already has the detail).

Task E: RECORD the finding
  - APPEND to: plan/014_347986b2effd/bugfix/001_0bc1da79f558/P1M1T3S1/research/changeset-doc-sweep.md (§4)
      * the executed grep output from Task A,
      * a dated line: "VERIFIED <ISO date>: overview docs synced to @! marker format (BUG-001) + unconditional
        idempotency (BUG-002). Edits: README.md:135, ARCHITECTURE.md:170, CONFIGURATION.md:310. Spec
        recommendations recorded (spec/02 L25, L30) — spec NOT edited."
  - PREPARE the commit message (see Validation Loop → recording).
```

### Implementation Patterns & Key Details
```bash
# Pattern: the minimal marker-format touch (README.md:135) — add `!` after `@`
#   BEFORE: Set `PRD_INCLUDE_MARKERS` to emit `<!-- @include: path -->` markers; a stale include warns ...
#   AFTER : Set `PRD_INCLUDE_MARKERS` to emit `<!-- @!include: path -->` markers; a stale include warns ...
# (Same one-char insertion for the include/end-include pairs at ARCHITECTURE.md:170 + CONFIGURATION.md:310.)

# Pattern: accurate prose to LEAVE untouched — docs/ARCHITECTURE.md:168
#   "Re-resolution is idempotent — identical input bytes yield identical resolved bytes."
# -> Unconditional statement, now TRUE post-BUG-002. NOT stale. NO EDIT.

# Pattern: spec recommendation (recorded, not edited) — spec/02-core-concepts.md L30
#   "recommends updating <!-- @include: path --> / <!-- @end-include --> to the collision-proof
#    <!-- @!include: path --> / <!-- @!end-include --> form (BUG-001)."
```

### Integration Points
```yaml
DOCUMENTATION:
  - files in scope: README.md, docs/ARCHITECTURE.md, docs/CONFIGURATION.md (marker-format sync only)
  - pattern: "OLD `<!-- @include: … -->` → NEW `<!-- @!include: … -->` (collision-proof, BUG-001)"

SPEC RECOMMENDATIONS (recorded in commit message; spec NOT edited):
  - spec/02-core-concepts.md L25 (dedup-bounds-recursion framing — incomplete re: deep linear chains)
  - spec/02-core-concepts.md L30 (OLD marker format)

COMMIT (recording):
  - message states the outcome + the spec recommendations, e.g.:
    "Sync overview docs to §2.3 @! marker format (BUG-001) + unconditional idempotency (BUG-002)
     [README/ARCHITECTURE/CONFIGURATION]. Spec recs recorded (spec/02 L25, L30) — spec unmodified."

NONE OF: src/, tests/, config, PRD.md, spec/**, **/tasks.json, prd_snapshot.md, .gitignore
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
# Re-verification grep — the OLD format must be GONE from overview docs after the edit
grep -rn '<!-- @include:\|<!-- @end-include\|<!-- @include-ref:' README.md docs/*.md
# EXPECTED (post-edit): no output.

# The NEW format must now appear on the edited lines
grep -rn '@!include' README.md docs/*.md
# EXPECTED: README.md:135, docs/ARCHITECTURE.md:170, docs/CONFIGURATION.md:310.

# Markdown formatting — run on the 3 edited files
npx prettier --check README.md docs/ARCHITECTURE.md docs/CONFIGURATION.md   # green (or npx prettier --write first)
# Expected: grep empty/new-format present; prettier --check passes.
```

### Level 2: Unit Tests (Component Validation)
```bash
# N/A — documentation-only task; no code under test.
```

### Level 3: Integration Testing (System Validation)
```bash
# Confirm the source already emits the NEW marker format (the docs are catching up to it — read-only check)
grep -n '@!include' src/core/session-utils.ts | head   # EXPECTED: the @!include / @!end-include / @!include-ref forms

# Confirm no forbidden file was accidentally modified
git status --porcelain | grep -E '^\s*[AM]\s+(src/|spec/|PRD\.md|.*tasks\.json|prd_snapshot|.*\.ts)' \
  && echo "VIOLATION: out-of-scope file touched" || echo "OK: no source/spec/PRD/test files modified"
# Expected: "OK: no source/spec/PRD/test files modified" (plus the 3 edited docs + the research note).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Human-readable accuracy read of the 3 edited passages + the idempotency line left untouched.
sed -n '132,136p' README.md
sed -n '166,172p' docs/ARCHITECTURE.md
sed -n '305,311p' docs/CONFIGURATION.md
# Confirm: (a) each marker example now shows @!include / @!end-include; (b) the surrounding prose
# (depth cap, idempotency) is unchanged and accurate. If any old `@include` marker remains, re-apply Task C.
```

### Recording (required)
- Append the executed Task A output + a dated `VERIFIED ...` line to
  `plan/014_347986b2effd/bugfix/001_0bc1da79f558/P1M1T3S1/research/changeset-doc-sweep.md` §4.
- The commit message states the outcome + the L25/L30 spec recommendations verbatim.

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: OLD-marker grep empty post-edit; NEW `@!include` present on the 3 edited lines; prettier --check green.
- [ ] Level 3: source confirmed already on `@!`; no out-of-scope file modified.

### Feature Validation
- [ ] The 3 overview-doc marker-format references migrated to `@!` (README:135, ARCHITECTURE:170, CONFIGURATION:310).
- [ ] No overview doc retains the OLD `<!-- @include: … -->` / `<!-- @end-include -->` format.
- [ ] Already-correct idempotency/depth prose left untouched.
- [ ] `spec/02-core-concepts.md` NOT modified; L25 + L30 recommendations recorded in the commit message.

### Code Quality Validation
- [ ] Edits are minimal (`@`→`@!`), preserving each doc's voice/markdown style.
- [ ] No prose rewritten beyond the marker-format sync.
- [ ] Recording note is clear enough to audit the determination later.

### Documentation & Deployment
- [ ] The determination (3 edits + 2 spec recommendations) is captured in the commit message.
- [ ] No new environment variables or config (N/A for this task).

---

## Anti-Patterns to Avoid
- ❌ Don't edit `spec/02-core-concepts.md` — it is human-owned. L25/L30 staleness is RECORDED as a recommendation in the commit message, not auto-mutated.
- ❌ Don't rewrite the idempotency/depth prose (`ARCHITECTURE.md:168`, `README.md:132-134`, `CONFIGURATION.md:305/309`) — it is accurate post-fix (BUG-002 made the unconditional idempotency claim actually true). The only stale overview content is the OLD marker byte format.
- ❌ Don't "correct" the marker examples to add explanatory prose about collision-proofing — the task is a minimal `@`→`@!` byte sync, not a prose rewrite.
- ❌ Don't edit source, tests, config, `PRD.md`, `**/tasks.json`, `prd_snapshot.md`, or `.gitignore` — docs-only.
- ❌ Don't treat unrelated "marker" grep hits (`NO_ISSUES_FOUND.md` marker, `AgentConfig.thinking` marker, `.adopted` marker, `prd_changed.marker`) as §2.3 references — they are unrelated.
- ❌ Don't skip recording the finding — the determination (3 edits + 2 spec recs) is the deliverable.
- ❌ Don't run the full TS test/lint suite and treat unrelated pre-existing diagnostics as this task's failure — this task touches no code.