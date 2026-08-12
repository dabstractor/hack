# PRP — P1.M1.T4.S1: Add `.gitignore` scaffolding mandate to `TASK_BREAKDOWN_PROMPT` + `PROMPTS.md`

> Plan 015, PRD §4.1 step 4 + §5.1 "Baseline `.gitignore` (breakdown scaffolding)". This is a
> **prompt-text change** (Mode A — the edit IS the documentation). It adds a baseline-`.gitignore`
> scaffolding mandate to the architect's `TASK_BREAKDOWN_PROMPT` (the LIVE prompt in
> `src/agents/prompts.ts`) and mirrors it in `PROMPTS.md`, so every project the pipeline decomposes
> gets a first dependency-root subtask that creates/extends a `.gitignore` before any feature work
> (preventing the `ARG_MAX` staging overflow at the source). It also performs the "Change D"
> terminology cleanup: renames surviving `stagecoach`-as-in-process-tool wording in the
> `CLEANUP_PROMPT` §4.2 comments → "Smart Commit". No new exports; no code logic.

---

## Goal

**Feature Goal**: Ensure the Architect Agent's decomposition **always** emits a first,
dependency-root scaffolding subtask that creates — or extends (never overwrites) — a baseline
`.gitignore` at the repo root before any feature implementation subtask, so Smart Commit's
`ARG_MAX`-safe pathspec staging never overflows on an unignored dependency tree (e.g.
`node_modules/`). Encode this as a `CRITICAL CONSTRAINT` in `TASK_BREAKDOWN_PROMPT`; mirror the
same text in `PROMPTS.md`. Also rename the two surviving `stagecoach`-as-commit-tool wordings in
the `CLEANUP_PROMPT` §4.2 comments to "Smart Commit" (post-§9.10.1, `stagecoach` is message-only;
the commit is Smart Commit).

**Deliverable**:
1. **`src/agents/prompts.ts`** — (a) a NEW `### 6. BASELINE .gitignore SCAFFOLDING (FIRST
   SUBTASK)` SOW constraint inside `TASK_BREAKDOWN_PROMPT` (after the existing #5 Documentation
   Sync); (b) two `stagecoach` → "Smart Commit" edits in the `CLEANUP_PROMPT` JSDoc (~L1167) and
   body (~L1210). Both ride in this one file.
2. **`PROMPTS.md`** — the corresponding `### 5. BASELINE .gitignore SCAFFOLDING (FIRST SUBTASK)`
   SOW constraint inside the mirrored TASK BREAKDOWN section (after its #4 Context Scope), with
   **identical bullet text** to the prompts.ts version.

**Success Definition**:
- `TASK_BREAKDOWN_PROMPT` contains the mandate: a FIRST subtask creating/extending a repo-root
  `.gitignore` covering dependency dirs (`node_modules/`), build output (`dist/`, `build/`), and
  OS/IDE cruft (`.DS_Store`, `Thumbs.db`), with `plan/`/`PRD.md`/task files explicitly excluded
  from gitignoring.
- `PROMPTS.md` contains the **same** mandate text (heading number may differ due to pre-existing
  drift — see Gotchas).
- No `stagecoach`-as-commit-tool wording remains in `src/agents/prompts.ts` (both CLEANUP_PROMPT
  spots now say "Smart Commit").
- All existing prompt tests stay GREEN (they use `toContain` substring assertions — additions
  don't break them).
- `npm run typecheck` exit 0; `npm run lint` + `npm run format:check` clean; the two targeted
  prompt test files GREEN.
- **No other files modified.** No new exports; no other prompt constant touched; the repo
  `.gitignore` is NOT modified (already adequate).

## User Persona

**Target User**: Developers/operators running the pipeline against fresh repos (or repos without
a `.gitignore`), who would otherwise hit silent `ARG_MAX` / `E2BIG` staging failures when Smart
Commit tries to stage an unignored `node_modules/`.

**Use Case**: The Architect decomposes a PRD for a new project; the FIRST subtask scaffolds the
baseline `.gitignore`, so every subsequent Smart Commit stages only source (not the dependency
tree).

**Pain Points Addressed**: Unignored dependency directories overflow `ARG_MAX` during pathspec
staging, silently breaking every survival/recovery commit and stranding task status (PRD §5.1
"ARG_MAX-safe staging"). This mandate prevents that failure class at the decomposition source.

## Why

- **Closes the §5.1 "Baseline `.gitignore` (breakdown scaffolding)" requirement at the prompt
  layer.** The PRD already cross-references it from §4.1 step 4 ("the decomposition MUST include
  a first, dependency-root subtask …"). T1.S2 made Smart Commit's staging `ARG_MAX`-safe
  (pathspec-default + chunked filtered sets), but that only helps when a `.gitignore` exists; this
  task guarantees one exists for every decomposed project.
- **Prevention at the source beats mechanical recovery.** The repo `.gitignore` already covers
  `node_modules/`/`dist/`/`build/`/`.DS_Store`/`Thumbs.db`, but that's THIS repo's `.gitignore` —
  every OTHER project the pipeline decomposes needs the same guarantee, baked into the architect's
  instructions.
- **Terminology accuracy (Change D).** Post-§9.10.1, `stagecoach` is a message-only binary; the
  snapshot-based atomic COMMIT is "Smart Commit". The two `CLEANUP_PROMPT` comments still say
  "stagecoach … performs the post-cleanup commit" / "stagecoach post-cleanup commit" — that wording
  is stale and misattributes the commit. Renaming to "Smart Commit" keeps the prompts aligned with
  the shipped architecture.
- **Tiny, low-risk, prompt-only.** One new SOW section + a mirrored copy + two word swaps. No code
  logic, no exports, no deps.

## What

### User-visible behavior
Indirectly: every PRD the pipeline decomposes now produces a first scaffolding subtask that
creates/extends a repo-root `.gitignore`. No runtime/CLI behavior change.

### Technical requirements (exact contract)

**Deliverable 1a — `TASK_BREAKDOWN_PROMPT` in `src/agents/prompts.ts`:** add a new SOW constraint
`### 6. BASELINE .gitignore SCAFFOLDING (FIRST SUBTASK)` immediately AFTER the existing
`### 5. DOCUMENTATION SYNC (TWO MODES)` section and BEFORE `## PROCESS`. Use the copy-ready text
below (research §3). The heading is `### 6.` in prompts.ts.

**Deliverable 1b — the mirrored section in `PROMPTS.md`:** add the **same** mandate text inside the
TASK BREAKDOWN section, as `### 5.` (the next SOW number after PROMPTS.md's current #4; see
Gotchas for the drift note). Bullet text is identical to the prompts.ts version.

**Copy-ready mandate text** (identical bullets in both files; only the leading `### N.` differs):
```markdown
### 6. BASELINE `.gitignore` SCAFFOLDING (FIRST SUBTASK)

- **MANDATE:** The decomposition MUST include a FIRST, dependency-root scaffolding subtask
  that creates — or, if one exists, **extends (never overwrites)** — a baseline `.gitignore`
  at the repo root, before any feature implementation subtask. (PRD §4.1 step 4 + §5.1
  "Baseline `.gitignore` (breakdown scaffolding)".)
- **MINIMUM COVERAGE:** language/framework dependency directories (e.g. `node_modules/`),
  build/output directories (e.g. `dist/`, `build/`), and common OS/IDE cruft (e.g.
  `.DS_Store`, `Thumbs.db`).
- **PROTECTED — NEVER GITIGNORED:** `plan/`, `PRD.md`, and any task files (`*tasks*.json`).
  The baseline `.gitignore` MUST respect this.
- **WHY:** the pipeline commits the working tree via Smart Commit; an unignored dependency
  tree overflows `ARG_MAX` during staging and strands task substance. This scaffold subtask
  prevents that failure at the source.
```

**Deliverable 2 — `stagecoach` → "Smart Commit" in `CLEANUP_PROMPT` (`src/agents/prompts.ts`), 2
spots (research §4):**
- JSDoc (~L1167): `the orchestrator's stagecoach (P3.M1.T3.S1) performs the post-cleanup commit`
  → `the orchestrator's Smart Commit performs the post-cleanup commit` (drop the stale
  `(P3.M1.T3.S1)` parenthetical — references the removed in-process agent).
- Body, FORBIDDEN ACTIONS (~L1210): `via the stagecoach post-cleanup commit` → `via the Smart
  Commit post-cleanup commit`.

### Success Criteria
- [ ] `TASK_BREAKDOWN_PROMPT` (prompts.ts) contains a `### 6. BASELINE .gitignore SCAFFOLDING
      (FIRST SUBTASK)` SOW section after #5, with the mandate bullets (FIRST subtask; create OR
      extend/never overwrite; node_modules/ + dist/build + .DS_Store/Thumbs.db; plan/PRD.md/task
      files never gitignored).
- [ ] `PROMPTS.md` contains the **same** bullet text as a new SOW section (`### 5.` there).
- [ ] No `stagecoach`-as-commit-tool wording remains in `src/agents/prompts.ts` (`grep -n stagecoach`
      returns nothing, or only legitimate message-only-binary references — here it returns nothing
      after the 2 edits).
- [ ] `npx vitest run tests/integration/task-breakdown-prompt.test.ts` GREEN (toContain assertions
      unaffected by the addition).
- [ ] `npx vitest run tests/unit/agents/prompts/architect-prompt.test.ts` GREEN.
- [ ] `npm run typecheck` exit 0; `npm run lint` + `npm run format:check` clean.
- [ ] Only `src/agents/prompts.ts` + `PROMPTS.md` touched; no new exports; repo `.gitignore` unchanged.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The
TASK_BREAKDOWN_PROMPT structure with exact section ordering, the copy-ready mandate text, the exact
before/after of both stagecoach edits, the PROMPTS.md drift finding (it's missing SOW #5 + extra #1
bullets → numbering differs but text must match), the test-safety finding (toContain-only →
additions are safe), the no-overlap confirmation with the parallel T3.S3 (git-commit.ts), and the
verified validation commands are all below.

### Documentation & References
```yaml
# AUTHORITATIVE SPEC — the requirement this prompt encodes
- docfile: PRD.md   # (provided in selected_prd_content)
  section: §4.1 step 4 (".gitignore scaffolding") + §5.1 "Baseline .gitignore (breakdown scaffolding)"
        + "ARG_MAX-safe staging"
  why: Defines the mandate (first dependency-root subtask; create-or-extend-never-overwrite; min
        coverage; plan/PRD.md/task-files never gitignored) and the WHY (ARG_MAX overflow). The
        prompt text condenses this into architect instructions.

# EDIT TARGET — the LIVE prompt
- file: src/agents/prompts.ts
  section: TASK_BREAKDOWN_PROMPT (L47–181; SOW #1–#5 then ## PROCESS) + CLEANUP_PROMPT JSDoc (~L1167) + body (~L1210)
  why: Add SOW #6 to TASK_BREAKDOWN_PROMPT after #5; rename the 2 stagecoach mentions in CLEANUP_PROMPT.
  pattern: SOW sections use `### N. TITLE` + `- **BOLD:** text` bullets — mirror #5 Documentation Sync.
  gotcha: PROMPTS.md has drifted (missing SOW #5) — the prompts.ts heading is `### 6.`, PROMPTS.md's is `### 5.`.

# MIRROR TARGET — the documentation copy of the prompt
- file: PROMPTS.md
  section: "# LEAD TECHNICAL ARCHITECT & PROJECT SYNTHESIZER" (~L60+) — SOW #1–#4 then ## PROCESS
  why: Add the SAME mandate bullets as a new SOW section after #4 (heading `### 5.` there).
  critical: PROMPTS.md is an OLDER snapshot — missing SOW #5 (Documentation Sync) and 2 bullets in #1.
        Do NOT re-sync the drifted content (out of scope); add ONLY the .gitignore mandate. The
        heading NUMBER will differ from prompts.ts (#5 vs #6) — that's acceptable; the TEXT must match.

# TERMINOLOGY CONTEXT — why stagecoach→Smart Commit
- docfile: PRD.md   # (provided in selected_prd_content §9.10.1)
  section: §9.10.1 "Commit-Message Generation (stagecoach delegation, message-only)"
  why: Post-§9.10.1 stagecoach is a MESSAGE-ONLY binary; the COMMIT is Smart Commit (snapshot-based
        atomic plumbing). So "stagecoach performs the commit" wording is stale → "Smart Commit".

# TEST SAFETY — confirm additions don't break tests
- file: tests/integration/task-breakdown-prompt.test.ts
  why: Uses `expect(TASK_BREAKDOWN_PROMPT).toContain('<substring>')` (presence-only). No
        not.toContain / toHaveLength / count assertions → adding a section is safe.
- file: tests/unit/agents/prompts/architect-prompt.test.ts
  why: Same toContain pattern; safe under additions.

# PARALLEL PREDECESSOR (confirm no overlap — do NOT implement it)
- docfile: plan/015_459c7d9be558/P1M1T3S3/PRP.md
  why: T3.S3 (generation-timeout/SIGINT rescue) edits src/utils/git-commit.ts + its test ONLY.
        Zero overlap with prompts.ts / PROMPTS.md. Confirmed via its PRP's file list.

# RESEARCH NOTE (this task) — copy-ready text + exact before/after + the drift gotcha
- docfile: plan/015_459c7d9be558/P1M1T4S1/research/gitignore-scaffold-prompt.md
  section: "1. TASK_BREAKDOWN_PROMPT structure", "2. PROMPTS.md drift", "3. Copy-ready text",
           "4. stagecoach→Smart Commit (2 spots)", "5. Test safety", "6. Scope boundaries"
  why: The verbatim mandate text, the exact before/after for both stagecoach edits, the drift note,
        and the test-safety verification.
```

### Current Codebase tree (edit surface)

```bash
src/agents/prompts.ts                  # EDIT: +SOW #6 in TASK_BREAKDOWN_PROMPT; +2 stagecoach→Smart Commit edits in CLEANUP_PROMPT
  ├─ TASK_BREAKDOWN_PROMPT (L47–181)
  │    ├─ SOW #1–#5
  │    └─ [NEW] ### 6. BASELINE .gitignore SCAFFOLDING (FIRST SUBTASK)   ← insert before ## PROCESS
  ├─ CLEANUP_PROMPT (L1172–…)
  │    ├─ JSDoc (~L1167): "stagecoach (P3.M1.T3.S1) performs the post-cleanup commit" → "Smart Commit performs…"
  │    └─ body FORBIDDEN ACTIONS (~L1210): "via the stagecoach post-cleanup commit" → "via the Smart Commit post-cleanup commit"
  └─ PROMPTS barrel (L1332)            # UNCHANGED
PROMPTS.md                             # EDIT: +new SOW section (### 5.) inside TASK BREAKDOWN, identical bullet text
```

### Desired Codebase tree with files to be changed
```bash
src/agents/prompts.ts                  # EDIT — SOW #6 + 2 stagecoach→Smart Commit edits
PROMPTS.md                             # EDIT — mirrored SOW #5 (same bullet text)
# (no other files; no new exports; repo .gitignore unchanged)
```

### Known Gotchas of our codebase & Library Quirks
```markdown
<!-- CRITICAL (PROMPTS.md has DRIFTED): PROMPTS.md mirrors an OLDER snapshot — it is missing SOW #5
     (Documentation Sync Two Modes) and 2 bullets in #1. The .gitignore mandate is therefore #6 in
     prompts.ts but #5 in PROMPTS.md. The heading NUMBER differs between files; the MANDATE TEXT must
     be identical. Do NOT re-sync the rest of PROMPTS.md — that drift is pre-existing and out of scope. -->

<!-- CRITICAL (do NOT modify the repo .gitignore): this task adds a PROMPT RULE so every decomposed
     project gets a .gitignore. The hacky-hack repo's own .gitignore already covers
     node_modules/dist/build/.DS_Store/Thumbs.db. Editing it is NOT this task. -->

<!-- GOTCHA (CLEANUP_PROMPT has no PROMPTS.md mirror): the stagecoach→Smart Commit edits are to the
     CLEANUP_PROMPT constant + its JSDoc in prompts.ts ONLY. Do NOT add CLEANUP_PROMPT wording to
     PROMPTS.md — its own JSDoc says "Source: authored for P3.M1.T3.S3 (no PROMPTS.md source)". The
     contract's mirror requirement is scoped to the .gitignore mandate. -->

<!-- GOTCHA (drop the stale task ref): the JSDoc "stagecoach (P3.M1.T3.S1)" parenthetical references
     the removed in-process commit-message agent (plan 013). When renaming to "Smart Commit", drop
     the "(P3.M1.T3.S1)" — Smart Commit is not tied to that task. The sentence reads cleanly without it. -->

<!-- GOTCHA (tests are addition-safe): both prompt test files use toContain (substring presence).
     Adding a SOW section does not break any toContain assertion, and there are NO not.toContain /
     toHaveLength / count assertions. Still RUN them to confirm. -->

<!-- GOTCHA (format): prettier's glob includes .md AND .ts. The new SOW heading/bullets (markdown
     inside a template literal in .ts, and real markdown in PROMPTS.md) must be valid. Run
     `npm run format` if format:check flags, then re-check. -->

<!-- GOTCHA (placement): insert SOW #6 AFTER #5 Documentation Sync and BEFORE ## PROCESS in
     prompts.ts. In PROMPTS.md, insert the new section after #4 (its last SOW) and before ## PROCESS.
     Match on the verbatim "## PROCESS" heading to locate the insertion anchor. -->
```

## Implementation Blueprint

### Data models and structure
N/A — prompt text. No code, no types, no exports, no tests added.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/agents/prompts.ts — add SOW #6 to TASK_BREAKDOWN_PROMPT
  - LOCATE: the `### 5. DOCUMENTATION SYNC (TWO MODES)` section inside TASK_BREAKDOWN_PROMPT
        (L47–181), and the `## PROCESS` heading that follows it.
  - INSERT (between the end of #5 and `## PROCESS`) the `### 6. BASELINE .gitignore SCAFFOLDING
        (FIRST SUBTASK)` section with the 4 bullets from research §3 (MANDATE / MINIMUM COVERAGE /
        PROTECTED-NEVER-GITIGNORED / WHY). Use the copy-ready text verbatim.
  - DO NOT: renumber #1–#5; touch ## PROCESS / ## OUTPUT FORMAT / other sections; escape the
        backticks (node_modules/ etc. are inside the template literal — use single backticks as in
        the existing SOW bullets).

Task 2: EDIT PROMPTS.md — mirror the mandate (identical bullet text, ### 5. heading)
  - LOCATE: the TASK BREAKDOWN section in PROMPTS.md (`# LEAD TECHNICAL ARCHITECT & PROJECT
        SYNTHESIZER` ~L60+); find its `### 4. THE "CONTEXT SCOPE" BLINDER` section and the
        `## PROCESS` heading after it.
  - INSERT (between #4 and `## PROCESS`) the `### 5. BASELINE .gitignore SCAFFOLDING (FIRST
        SUBTASK)` section with the SAME 4 bullets as Task 1 (only the leading `### N.` differs).
  - DO NOT: re-sync PROMPTS.md's missing #5 Documentation Sync or its #1 bullet drift; renumber
        existing sections. Add ONLY this one section.

Task 3: EDIT src/agents/prompts.ts — stagecoach → Smart Commit (2 spots, CLEANUP_PROMPT)
  - SPOT 1 (JSDoc ~L1167): `the orchestrator's stagecoach (P3.M1.T3.S1) performs the post-cleanup
        commit` → `the orchestrator's Smart Commit performs the post-cleanup commit` (drop the
        `(P3.M1.T3.S1)` parenthetical).
  - SPOT 2 (body ~L1210): `via the stagecoach post-cleanup commit` → `via the Smart Commit
        post-cleanup commit`.
  - VERIFY: `grep -n "stagecoach" src/agents/prompts.ts` returns NOTHING after both edits.
  - DO NOT: touch any other prompt constant; add CLEANUP_PROMPT wording to PROMPTS.md.

Task 4: VALIDATE
  - npm run typecheck && npm run lint && npm run format:check   (run `npm run format` if it flags)
  - npx vitest run tests/integration/task-breakdown-prompt.test.ts tests/unit/agents/prompts/architect-prompt.test.ts
  - grep-gates (Level 3/4 below).
```

### Implementation Patterns & Key Details
```markdown
<!-- PATTERN: the SOW section style to mirror (from existing #5 Documentation Sync) -->
### 5. DOCUMENTATION SYNC (TWO MODES)

- **MODE A (doc-with-work, default):** …
- **MODE B (changeset-level):** …
- **DECISION RULE:** …

<!-- The new #6 follows the same `### N. TITLE` + `- **BOLD:** text` shape. -->

<!-- PATTERN: stagecoach→Smart Commit — minimal word swap, drop stale task ref -->
<!-- BEFORE: "the orchestrator's stagecoach (P3.M1.T3.S1) performs the post-cleanup commit" -->
<!-- AFTER:  "the orchestrator's Smart Commit performs the post-cleanup commit" -->

<!-- GOTCHA: match edits on the verbatim phrases ("stagecoach (P3.M1.T3.S1) performs the post-cleanup
     commit" / "via the stagecoach post-cleanup commit") — both are unique in the file. -->
```

### Integration Points
```yaml
PROMPT CONSTANT (src/agents/prompts.ts TASK_BREAKDOWN_PROMPT):
  - insert: "### 6. BASELINE `.gitignore` SCAFFOLDING (FIRST SUBTASK)" + 4 bullets, after #5, before ## PROCESS.

PROMPTS.md (mirror):
  - insert: same bullets under "### 5. …", after its #4, before ## PROCESS.

CLEANUP_PROMPT (src/agents/prompts.ts):
  - JSDoc ~L1167: "stagecoach (P3.M1.T3.S1) performs the post-cleanup commit" → "Smart Commit performs …"
  - body ~L1210: "via the stagecoach post-cleanup commit" → "via the Smart Commit post-cleanup commit"

NONE OF: other prompt constants, the PROMPTS barrel (L1332), any source file outside
         src/agents/prompts.ts, the repo .gitignore, PRD.md, spec/**, **/tasks.json, prd_snapshot.md,
         src/utils/git-commit.ts (T3.S3), src/agents/commit-message-agent.ts (P1.M2 — stagecoach binary).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit -p tsconfig.build.json — exit 0 (template literal still parses)
npm run lint             # eslint . --ext .ts — clean
npm run format:check     # prettier --check (md + ts in glob) — clean (run `npm run format` if it flags)
# Expected: zero errors. The new markdown heading/bullets must be valid markdown.
```

### Level 2: Prompt Tests (Component Validation)
```bash
npx vitest run tests/integration/task-breakdown-prompt.test.ts tests/unit/agents/prompts/architect-prompt.test.ts
# Expected: GREEN. Both files use toContain (substring presence) — the addition + the rename don't
#   remove any asserted substring. If one fails, READ which substring it expects and confirm it's still present.
```

### Level 3: Grep-Gate Verification (the mandate landed + stagecoach gone)
```bash
# Mandate present in the LIVE prompt with all required elements:
grep -n "BASELINE .gitignore SCAFFOLDING\|extends (never overwrites)\|node_modules/\|\.DS_Store\|Thumbs.db\|NEVER GITIGNORED" src/agents/prompts.ts
# Expected: hits for each (the SOW #6 section is present + complete).
# Mirror present in PROMPTS.md:
grep -n "BASELINE .gitignore SCAFFOLDING\|extends (never overwrites)" PROMPTS.md
# Expected: hits (same text mirrored).
# stagecoach-as-commit-tool GONE from prompts.ts:
grep -n "stagecoach" src/agents/prompts.ts
# Expected: NO output (both spots renamed to Smart Commit). Any hit is a missed edit.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Confirm only the two intended files changed (no scope creep):
git status --porcelain | grep -E '^\s*[AM]\s+(src/agents/prompts\.ts|PROMPTS\.md)$' && echo "OK: intended files only"
git status --porcelain | grep -vE '^\s*[AM]?\s+(src/agents/prompts\.ts|PROMPTS\.md)$' | grep -E '\.(ts|md|json)$' \
  && echo "VIOLATION: out-of-scope file touched" || echo "OK: no out-of-scope file"
# Expected: "OK: intended files only" + "OK: no out-of-scope file".
# Confirm the repo .gitignore was NOT touched:
git status --porcelain | grep -E '\.gitignore' && echo "VIOLATION: .gitignore edited" || echo "OK: .gitignore untouched"
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 typecheck/lint/format:check clean (run `npm run format` first if it flags).
- [ ] Level 2 both prompt test files GREEN.
- [ ] Level 3 mandate present in prompts.ts + PROMPTS.md; `grep stagecoach src/agents/prompts.ts` empty.

### Feature Validation
- [ ] `TASK_BREAKDOWN_PROMPT` has `### 6. BASELINE .gitignore SCAFFOLDING (FIRST SUBTASK)` after #5.
- [ ] Mandate covers: FIRST subtask; create-OR-extend-never-overwrite; node_modules/ + dist/build +
      .DS_Store/Thumbs.db; plan/PRD.md/task-files never gitignored; the ARG_MAX WHY.
- [ ] `PROMPTS.md` mirrors the SAME bullet text (heading `### 5.` due to pre-existing drift).
- [ ] Both CLEANUP_PROMPT `stagecoach` mentions renamed to "Smart Commit"; stale `(P3.M1.T3.S1)` dropped.

### Code Quality Validation
- [ ] SOW section follows the existing `### N. TITLE` + `- **BOLD:**` bullet style.
- [ ] Mandate text is IDENTICAL in prompts.ts and PROMPTS.md (only the heading number differs).
- [ ] No re-sync of PROMPTS.md's unrelated drifted content (out of scope).
- [ ] No new exports; no other prompt constant touched.

### Documentation & Deployment
- [ ] Mode A: the prompt edit IS the documentation change (cites §4.1 step 4 + §5.1).
- [ ] Repo `.gitignore` NOT modified (already adequate).
- [ ] No env-var/config additions.

---

## Anti-Patterns to Avoid
- ❌ Don't modify the repo `.gitignore` — this task adds a PROMPT RULE (so every decomposed project
  gets one), not an edit to hacky-hack's own (already-adequate) `.gitignore`.
- ❌ Don't re-sync PROMPTS.md's drifted content (missing SOW #5 + #1 bullets) — that's pre-existing
  and out of scope. Add ONLY the .gitignore mandate; accept that its heading number is `### 5.` there
  vs `### 6.` in prompts.ts.
- ❌ Don't mirror the CLEANUP_PROMPT wording into PROMPTS.md — its JSDoc explicitly says "no
  PROMPTS.md source". The contract's mirror requirement is scoped to the .gitignore mandate only.
- ❌ Don't keep the stale `(P3.M1.T3.S1)` parenthetical when renaming stagecoach→Smart Commit — it
  references the removed in-process agent; Smart Commit isn't tied to it. Drop it.
- ❌ Don't touch any other prompt constant, the PROMPTS barrel, or any file outside
  `src/agents/prompts.ts` + `PROMPTS.md`. T3.S3 owns `git-commit.ts`; P1.M2 owns the stagecoach
  binary delegation.
- ❌ Don't escape the backticks in the mandate bullets — they live inside the template literal
  (use single backticks like the existing SOW bullets) / inside real markdown (PROMPTS.md).
- ❌ Don't assume the prompt tests will break — they use `toContain` (presence), so additions are
  safe. Still RUN them to confirm, but don't preemptively edit them.
- ❌ Don't place SOW #6 inside `## PROCESS` or `## OUTPUT FORMAT` — it goes in the SOW list
  (`## CRITICAL CONSTRAINTS & STANDARD OF WORK`), after #5, mirroring how #5 itself rides there.

---

## Confidence Score
**9.5 / 10** — one-pass success. The deliverable is two self-contained text insertions (a SOW
section in two files, identical bullets) plus two minimal word swaps — no code logic, no exports, no
tests added. The copy-ready mandate text and exact before/after for both stagecoach edits are pinned.
The only subtleties — PROMPTS.md's pre-existing drift (numbering differs, text must match; do NOT
re-sync) and the toContain-only test safety (additions don't break assertions) — are fully specified
as gotchas. No overlap with the parallel T3.S3 (git-commit.ts). Validation is typecheck + lint +
format:check + two targeted prompt test files, all verified present in package.json.