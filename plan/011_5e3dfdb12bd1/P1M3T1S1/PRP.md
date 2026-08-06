# PRP — P1.M3.T1.S1: Update overview docs + mirror §9.9 gate rules into PROMPTS.md

> Session 011, **P1.M3.T1.S1 — Mode B changeset-level documentation sync for PRD §9.9** (Validation
> Gate Semantics — Monotonicity & Terminal-State Re-Execution). The runtime fixes have landed:
> **REQ-G1** (G1.1–G1.5 gate-construction guardrails in `src/agents/prompts.ts`) via P1.M1.T1.S1 +
> P1.M1.T2.S1 (Complete), and **REQ-G2** (executor neutralizes negated-existence gates) via
> P1.M2.T1.S2 (in-flight). This task syncs the **reference/overview docs** so they stop drifting:
> mirror the G1.x forbidden-form rules into the legacy `PROMPTS.md`, add the monotonicity +
> neutralization contract to `docs/ARCHITECTURE.md` + a README note, and **confirm**
> `docs/CONFIGURATION.md` + `.env.example` need no §9.9 change. **Documentation only — no `src/`
> edits, no new tests** (the prompt-text tests live in the sibling REQ-G1 tasks; PROMPTS.md is a
> reference, not runtime-imported).

---

## Goal

**Feature Goal**: Bring the project's reference + overview documentation into alignment with PRD §9.9
and the landed runtime prompts (`src/agents/prompts.ts`), so (a) the legacy `PROMPTS.md` reference
mirrors the G1.1–G1.5 gate-construction guardrails + the Builder terminal-state/G1.4 notes
"byte-for-byte in intent" with `src/agents/prompts.ts`, (b) `docs/ARCHITECTURE.md` states that gates
are monotonic terminal-state assertions and the executor neutralizes negated-existence gates, and
(c) `README.md`'s validation description is consistent — with NO surviving claim that gates are a
rigid mechanical contract. Confirm + record that `docs/CONFIGURATION.md` and `.env.example` require
no §9.9 change.

**Deliverable** (exact files):
1. **`PROMPTS.md`** (repo root) — EDIT (additive mirror): add the G1.1–G1.5 "CRITICAL RULES for gate
   commands" block to §4 PRP_CREATE_PROMPT (Researcher, near L264); add the terminal-state
   re-execution note + the G1.4 throwaway-survival note to §5 PRP_EXECUTE_PROMPT (Builder, right
   after "Each level must pass before proceeding to the next."); add a one-line monotonicity note to
   the §1 "### Validation Gates" concept blurb (L31-34).
2. **`docs/ARCHITECTURE.md`** — EDIT: add a "Gate Semantics (PRD §9.9)" note/subsection under the
   existing "### Validation Gates" section (L616) stating gates are monotonic terminal-state
   assertions, the executor re-runs every gate as a batch on the final tree, and negated-existence
   gates are neutralized (skipped/passed) per REQ-G2.
3. **`README.md`** — EDIT (minimal): append one concise clause to the L151 "4-Level Validation"
   feature bullet noting gates are monotonic terminal-state assertions (citing §9.9).
4. **`docs/CONFIGURATION.md`** — NO CHANGE (record: zero gate references; §9.9 adds no config knob).
5. **`.env.example`** — NO CHANGE (record: §9.9 adds no env var; byte-identical verified).

**Success Definition**:
- `PROMPTS.md` contains the G1.1, G1.2, G1.3, G1.4, G1.5 forbidden-form wording (the same forms as
  `src/agents/prompts.ts:290–293` + `750–756`), so the reference matches the runtime "in intent".
- `docs/ARCHITECTURE.md`'s Validation Gates section states the monotonicity + batch-re-execution +
  negated-existence-neutralization contract (citing §9.9 REQ-G1/REQ-G2).
- No `.md` under README/docs/PROMPTS.md claims gates are a rigid mechanical contract (grep for
  `rigid|mechanical.*re-exec` returns empty — verified baseline; the sync is additive).
- `.env.example` is byte-identical to its pre-change state (`git diff --quiet .env.example` passes).
- `npm run format:check` clean (prettier is the only build gate that applies to `.md`).

---

## Why

- **Mode B docs must not drift from the runtime.** `PROMPTS.md` is the ported-from reference doc
  cited by PRD §6 / §9.3.4. The runtime (`src/agents/prompts.ts`) now enforces G1.1–G1.5 + the
  Builder throwaway-survival/terminal-state notes (P1.M1.T1.S1 + P1.M1.T2.S1 Complete). If
  `PROMPTS.md` keeps its generic pre-§9.9 gate language, a reader (or a future port) following the
  reference would emit the exact non-monotonic gates §9.9 forbids — the reference would actively
  undermine the runtime guardrails.
- **§9.9.3 acceptance criteria require the docs to reflect the new semantics.** The acceptance
  criteria (G1.2/G1.3/G1.4/G2.1/G2.2/G2.3) describe behavior; the overview docs (`docs/ARCHITECTURE.md`
  is the system-architecture home for "Validation Gates") must describe the SAME semantics — gates
  are monotonic terminal-state assertions, re-executed as a batch on the final tree, with
  negated-existence gates neutralized. Without this, the architecture doc contradicts the runtime.
- **No new env var / no config knob.** §9.9 is prompt (REQ-G1) + runtime code (REQ-G2) — it does
  not introduce a config setting. So `docs/CONFIGURATION.md` (the env/config reference) and
  `.env.example` (the env template) need NO change. The item explicitly requires recording that
  finding ("confirm .env.example needs no §9.9 change and record that finding") so the changeset is
  provably complete and no reviewer re-opens it.
- **Scope discipline.** This task edits ONLY `.md` docs. It does NOT touch `PRD.md`/`spec/*`
  (human-owned), `tasks.json`, `prd_snapshot.md`, `src/agents/prompts.ts` (the runtime source,
  owned by the landed P1.M1 tasks), `src/agents/prp-executor.ts` (P1.M2.T1.S2's surface), or any
  `tests/` file. Disjoint from the parallel P1.M2.T1.S2 (executor hardening — a `src/`+`tests/`
  task with zero `.md` overlap).

---

## What

### User-visible behavior
None directly — this is documentation. Observable change: the `PROMPTS.md` reference, the
`docs/ARCHITECTURE.md` Validation Gates section, and the README validation bullet now describe the
§9.9 gate semantics (monotonic terminal-state assertions + batch re-execution + negated-existence
neutralization). `.env.example` and `docs/CONFIGURATION.md` are unchanged.

### Technical requirements (exact contract)

The runtime wording to mirror is in `src/agents/prompts.ts` (READ-ONLY here — it is the source of
truth). Mirror it "in intent" (not necessarily byte-identical — PROMPTS.md is markdown reference,
prompts.ts is a template string; the FORBIDDEN FORMS + the G1.x rule numbers + the §9.9 citations
must match). The exact runtime anchors:
- Blueprint (Researcher) gate rules: `src/agents/prompts.ts:286–293` (ONE-command / prefer-tooling /
  no-mixed-quote-grep / no-heredocs + G1.1/G1.2/G1.3/G1.5).
- Builder notes: `src/agents/prompts.ts:741–756` (terminal-state re-execution + G1.4 throwaway-survival).
- The neutralization contract: PRD §9.9 REQ-G2 (`spec/16-validation-gates.md`), implemented in
  `src/agents/prp-executor.ts` `#runValidationGates` by P1.M2.T1.S2 (negated-existence gates →
  `skipped:true/success:true`, reason citing §9.9).

**Edits (all additive — verified baseline: no `rigid`/`mechanical` claim currently survives):**

**(1) `PROMPTS.md` §1 concept blurb (L31–34)** — after the existing "Validation gate = all tests
pass." sentence, append a one-line monotonicity note, e.g.:
> Gates are **monotonic terminal-state assertions** (PRD §9.9): once true against the final tree,
> they stay true. The executor re-runs every gate as a batch on that final state, so a gate whose
> result flips on intermediate state cannot survive. (Negative file-existence gates are forbidden
> and neutralized at runtime — see §9.9.)

**(2) `PROMPTS.md` §4 PRP_CREATE_PROMPT (Researcher, ~L264)** — after the existing
`**Validation Gates**: Use project-specific validation commands that you've verified work in this
codebase` line, add a "CRITICAL RULES for gate commands (PRD §9.9 REQ-G1)" block mirroring
`src/agents/prompts.ts:286–293`. Include the four pre-existing rules (ONE command per gate; prefer
standard tooling; no mixed-quote grep; no heredocs/for-loops/multi-line) AND the four §9.9 rules,
using the SAME forbidden-form enumeration as the runtime:
- **G1.1** — forbid `test ! -f|-e|-d <path>`, `! test -f|-e|-d <path>`, `[ ! -f|-e|-d <path> ]`,
  `! [ -f|-e|-d <path> ]` (existence owned by the task graph, non-monotonic).
- **G1.2** — scope boundaries ("don't create file X / don't import Y") MUST be a Success Criterion
  OR a `manual: true` Level-4 gate, never a shell gate.
- **G1.3** — cleanup/throwaway deletion is a cleanup instruction; "the artifact is gone" MUST be
  `manual: true`.
- **G1.5** — negated content gate (`! grep -q …`) ONLY on own deliverable + permanent absence;
  never about another task's file.
(Match the runtime wording closely — the G1.x numbers + the forbidden forms + the §9.9 citations
are the contract the grep verification checks.)

**(3) `PROMPTS.md` §5 PRP_EXECUTE_PROMPT (Builder, ~L683)** — right after "**Each level must pass
before proceeding to the next.**" (and before "5. **Completion Verification**"), add TWO notes
mirroring `src/agents/prompts.ts:741–756`:
- **Terminal-state gate re-execution (PRD §9.9)** — the executor RE-RUNS every gate as a single
  BATCH against the FINAL filesystem state; every gate must be a monotonic terminal-state assertion.
- **Do not delete throwaway / spike artifacts during your turn (PRD §9.9 G1.4)** — any
  spike/scratch/throwaway must survive on disk until after validation; cleanup runs only once the
  gates pass (deleting mid-turn would fail the artifact's existence gates on the terminal state).

**(4) `docs/ARCHITECTURE.md` Validation Gates section (L616–660)** — after the 4-level descriptions
(after the L4 Manual/E2E block), add a "**Gate Semantics (PRD §9.9)**" subsection stating:
- Gates are **monotonic terminal-state assertions** — once true at end-of-turn, they stay true.
- `PRPExecutor.#runValidationGates()` RE-RUNS every gate as a single BATCH against the final tree
  (not the incremental order the coder ran).
- **Negative file-existence gates are forbidden at construction (REQ-G1: G1.1–G1.5)** and
  **neutralized at runtime (REQ-G2: G2.1–G2.3)** — a negated-existence gate (`! test -f X`,
  `test ! -f X`, `[ ! -f X ]`, `! [ -f X ]`) is marked `skipped:true / success:true` with a logged
  reason citing §9.9; negated *content* gates (`! grep …`) still execute normally. This repairs
  cached/legacy PRPs without regeneration.

**(5) `README.md` L151** — append to the "4-Level Validation" feature bullet a concise clause, e.g.:
> Gates are monotonic terminal-state assertions (PRD §9.9) — the executor re-runs every gate as a
> batch on the final tree and neutralizes non-monotonic negative-existence gates.
(L649 "Coder: Implements PRPs with validation gates" — NO change; it is a persona blurb.)

**(6) `docs/CONFIGURATION.md`** — **NO CHANGE.** Record (in research/commit): zero gate references
in the file; §9.9 adds no config knob (it is prompt + runtime code, not configuration).

**(7) `.env.example`** — **NO CHANGE.** Record (in research/commit): §9.9 adds no env var; the file
is byte-identical (`git diff --quiet .env.example` passes).

### Success Criteria
- [ ] `PROMPTS.md` contains G1.1/G1.2/G1.3/G1.4/G1.5 wording (grep verifiable) mirroring
      `src/agents/prompts.ts`.
- [ ] `PROMPTS.md` §1 concept blurb + §5 Builder carry the terminal-state/monotonicity/G1.4 notes.
- [ ] `docs/ARCHITECTURE.md` Validation Gates section carries the §9.9 monotonicity + batch-re-exec
      + neutralization contract (citing REQ-G1/REQ-G2).
- [ ] `README.md` L151 carries a monotonicity/§9.9 clause.
- [ ] No `.md` (README/docs/PROMPTS.md) claims gates are a rigid mechanical contract (grep empty).
- [ ] `.env.example` byte-identical (`git diff --quiet .env.example` passes).
- [ ] `docs/CONFIGURATION.md` unchanged (recorded: no §9.9 config knob).
- [ ] `npm run format:check` clean; `git diff --name-only` lists ONLY `PROMPTS.md`,
      `docs/ARCHITECTURE.md`, `README.md`.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the
exact files to edit, the exact runtime wording to mirror (`src/agents/prompts.ts:286–293` +
`741–756`, quoted in research §1), the exact §9.9 contract (`spec/16-validation-gates.md` REQ-G1/REQ-G2),
the verified-baseline finding (no `rigid`/`mechanical` claim survives → additive sync), the exact
insertion anchors in each doc (PROMPTS.md L31-34/L264/L683; ARCHITECTURE.md L616 section; README L151),
the no-change confirmations for CONFIGURATION.md + .env.example, and the docs-only validation
approach (prettier + grep, no unit test). See `research/docs-sync-strategy.md` for per-claim evidence.

### Documentation & References
```yaml
# MUST READ — PRD §9.9 (the contract this sync honors — read it fully)
- docfile: spec/16-validation-gates.md
  section: "9.9.1 Problem", "9.9.2 Requirements (REQ-G1 G1.1–G1.5, REQ-G2 G2.1–G2.3)", "9.9.3 Acceptance Criteria"
  why: Defines the gate-construction guardrails + executor neutralization + the acceptance criteria the docs must reflect.
  critical: §9.9 adds NO config knob + NO env var → CONFIGURATION.md + .env.example are no-ops (record it).

# MUST READ — the runtime source of truth to mirror (READ-ONLY; do NOT edit prompts.ts)
- file: src/agents/prompts.ts
  why: The G1.x wording that LANDED (P1.M1.T1.S1 + P1.M1.T2.S1 Complete). PROMPTS.md must match it "byte-for-byte in intent".
  pattern_blueprint: "L286–293 — the 'CRITICAL RULES for gate commands' block: ONE command per gate / prefer standard tooling / no mixed-quote grep / no heredocs + G1.1 (L290) / G1.2 (L291) / G1.3 (L292) / G1.5 (L293)."
  pattern_builder: "L741–748 terminal-state re-execution note + L750–756 G1.4 throwaway-survival note (the additional protected class = the work artifact created this turn)."
  gotcha: prompts.ts is a template STRING (backtick-escaped). PROMPTS.md is markdown. Mirror INTENT (G1.x numbers + forbidden forms + §9.9 citations), escaping markdown normally — do NOT copy the backslash-escapes.

# MUST READ — the implementation-status doc (the §D/§E doc-sync scope this item owns)
- docfile: plan/011_5e3dfdb12bd1/architecture/implementation-status.md
  section: "D. Mode B documentation sync (changeset-level)" + "E. Agent boundaries & guardrails"
  why: §D prescribes the EXACT doc-sync scope (README/CONFIGURATION/ARCHITECTURE + PROMPTS.md mirror + .env.example verify). §E confirms this task touches NO src/, NO PRD.md, NO tasks.json.
  critical: §D names PROMPTS.md as "legacy reference doc, PRD §6 / §9.3.4 source" that must mirror the G1.x rules; .env.example "no change expected (no new env var); verify and note".

# THIS SUBTASK'S RESEARCH (insertion anchors + verified baseline + validation approach)
- docfile: plan/011_5e3dfdb12bd1/P1M3T1S1/research/docs-sync-strategy.md
  section: "1. Authoritative sources", "2. Target files (2a–2e)", "3. No rigid-mechanical survives (verified)", "4. Validation (docs-only)", "5. Disjointness", "6. npm scripts"
  why: The exact PROMPTS.md section structure (§1 L31-34, §4 L264, §5 L641-715 / L683 anchor), the finding that PROMPTS.md has NONE of the detailed gate rules (grep empty), the ARCHITECTURE.md L616 section, the README L151/L649 mentions, the CONFIGURATION.md no-refs + .env.example no-var findings, the prettier+grep gate.

# THE FILES TO EDIT
- file: PROMPTS.md
  why: EDIT — §1 L31-34 (concept blurb monotonicity note) + §4 ~L264 (G1.1–G1.5 block) + §5 ~L683 (terminal-state + G1.4 notes).
  gotcha: It is the GENERIC ported-from template (1176 lines) with NO detailed gate rules currently. The mirror is ADDITIVE. Run `npm run fix` after — prettier may reflow the .md.
- file: docs/ARCHITECTURE.md
  why: EDIT — add "Gate Semantics (PRD §9.9)" subsection under the "### Validation Gates" section (L616–660, after the L4 block). The PRIMARY home for §9.9 semantics in the architecture doc.
  pattern: "### Validation Gates\n\nEach PRP execution goes through 4 validation gates:\n```mermaid …```\n**Level 1…** … **Level 4: Manual/E2E** …  ← INSERT §9.9 SUBSECTION AFTER THIS"
- file: README.md
  why: EDIT (minimal) — append a monotonicity/§9.9 clause to the L151 "4-Level Validation" feature bullet. L649 persona blurb unchanged.
  pattern: "- **4-Level Validation**: Syntax, unit tests, integration tests, and manual validation gates  ← APPEND §9.9 CLAUSE"

# CONFIRM NO-CHANGE (record findings — these are explicit deliverables)
- file: docs/CONFIGURATION.md
  why: NO CHANGE. Zero gate references (grep `validation gate|gate command|monotonic|§9.9` empty). §9.9 adds no config knob.
- file: .env.example
  why: NO CHANGE. 145 lines; no gate/§9.9/monotonic var (grep empty). §9.9 adds no env var. Verify `git diff --quiet .env.example`.

# READ-ONLY (do NOT edit — owned by other tasks)
- file: src/agents/prompts.ts
  why: The runtime prompt source (P1.M1.T1.S1 + P1.M1.T2.S1). This task MIRRORS it into PROMPTS.md; it does NOT edit it.
- file: src/agents/prp-executor.ts
  why: The executor neutralization (P1.M2.T1.S2, in-flight). This task's docs STATE the contract; they do not implement it.

# THE §9.9 CONTRACT'S REQUIREMENTS (the semantics the docs must express)
- file: spec/16-validation-gates.md (REQ-G1 / REQ-G2)
  why: REQ-G1 = G1.1 (no negative existence gates), G1.2 (scope boundaries → Success Criterion/manual), G1.3 (cleanup → manual), G1.4 (throwaway survives the turn), G1.5 (negated content only on own permanent-deliverable). REQ-G2 = G2.1 (detect+skip negated existence), G2.2 (negated content NOT neutralized), G2.3 (conservative detector). The docs must express these accurately.
```

### Current Codebase tree (relevant slice)
```bash
PROMPTS.md                         # EDIT (§1 + §4 + §5 — mirror G1.x + terminal-state/G1.4)
docs/ARCHITECTURE.md               # EDIT (Validation Gates L616 section — add §9.9 Gate Semantics)
README.md                          # EDIT (minimal — L151 4-Level Validation bullet + §9.9 clause)
docs/CONFIGURATION.md              # NO CHANGE (record: no gate refs; no §9.9 config knob)
.env.example                       # NO CHANGE (record: no §9.9 env var; byte-identical)
src/agents/prompts.ts              # READ-ONLY (the runtime source to mirror — owned by P1.M1)
src/agents/prp-executor.ts         # READ-ONLY (the neutralization impl — owned by P1.M2.T1.S2)
spec/16-validation-gates.md        # READ-ONLY (PRD §9.9 — the contract)
```

### Desired Codebase tree with files to be added/edited
```bash
PROMPTS.md                         # MODIFIED (additive mirror: G1.x rules + Builder notes + concept note)
docs/ARCHITECTURE.md               # MODIFIED (+ "Gate Semantics (PRD §9.9)" subsection)
README.md                          # MODIFIED (+ §9.9 clause on the L151 validation bullet)
```

### Known Gotchas of our codebase & Library Quirks
```markdown
<!-- CRITICAL — This is a DOCS-ONLY task. Do NOT edit src/ (prompts.ts is the runtime source, owned
     by the landed P1.M1 tasks; prp-executor.ts is P1.M2.T1.S2's surface), PRD.md/spec/* (human-owned),
     tasks.json, prd_snapshot.md, or any tests/ file. The deliverable is 3 .md edits + 2 no-change
     confirmations. -->

<!-- CRITICAL — Mirror INTENT, not byte-identity. src/agents/prompts.ts is a TEMPLATE STRING
     (backtick-escaped: \`test ! -f\`). PROMPTS.md is markdown. Copy the G1.x rule NUMBERS + the
     FORBIDDEN FORMS (test ! -f|-e|-d, ! test …, [ ! -f|-e|-d ], ! [ -f|-e|-d ]) + the §9.9
     citations — escaping markdown normally. Do NOT carry over the backslash escapes. -->

<!-- CRITICAL — PROMPTS.md currently has NONE of the detailed gate rules (verified: grep empty). So
     the §4 (Researcher) edit is ADDITIVE (insert a full "CRITICAL RULES for gate commands" block),
     not a find-replace of an existing rule. Anchor on the L264 "**Validation Gates**: Use
     project-specific validation commands…" line and add AFTER it. -->

<!-- CRITICAL — PROMPTS.md §5 Builder anchor: insert the two notes right after "**Each level must
     pass before proceeding to the next.**" and BEFORE "5. **Completion Verification**". Do NOT
     renumber the existing steps (1 Load → 2 ULTRATHINK → 3 Execute → 4 Progressive Validation →
     5 Completion Verification); the notes are sub-bullets of step 4. -->

<!-- CRITICAL — No "rigid mechanical contract" claim currently survives (verified baseline: grep
     rigid|mechanical.*re-exec across README/docs/PROMPTS.md → empty). So the sync is ADDITIVE
     (add monotonicity + neutralization semantics), NOT corrective-removal. Do not invent a claim
     to remove; just add the §9.9 semantics. -->

<!-- GOTCHA — prettier is the ONLY build gate that applies to .md (eslint/tsconfig gate .ts only).
     `npm run format:check` globs **/*.md. PROMPTS.md has some non-standard fenced blocks; run
     `npm run fix` (prettier --write) FIRST and accept its reflow, then format:check. If prettier
     reformats unrelated lines in PROMPTS.md, that's expected (it's a large legacy file) — keep the
     reflow; the semantic gate is the grep verification, not byte-stability of unrelated prose. -->

<!-- GOTCHA — Do NOT add a vitest test for PROMPTS.md content. It is a reference doc, not runtime-
     imported (src/agents/ is never re-loaded from it). The sibling REQ-G1 tasks already assert the
     G1.x wording is in src/agents/prompts.ts (the runtime). A docs-content test is over-engineering
     and outside "documentation only / MOCKING: none". The semantic gate is grep. -->

<!-- CRITICAL — Record the TWO no-change findings explicitly (they are deliverables): (1)
     docs/CONFIGURATION.md has zero gate refs + §9.9 adds no config knob → no change; (2)
     .env.example has no gate/§9.9 var + §9.9 adds no env var → no change, byte-identical
     (git diff --quiet .env.example). State both in the commit message. -->
```

---

## Implementation Blueprint

### Data models and structure
None — this is documentation. The "structure" is the prose: the G1.1–G1.5 rule list, the
terminal-state/G1.4 notes, and the §9.9 Gate-Semantics subsection. All wording is anchored to the
runtime (`src/agents/prompts.ts`) + PRD (`spec/16-validation-gates.md`).

### Implementation Tasks (ordered by dependencies — all additive .md edits)
```yaml
Task 1: EDIT PROMPTS.md — mirror the G1.x gate rules + Builder notes + concept note
  - §1 (L31-34): after "Validation gate = all tests pass." append the one-line monotonicity note
    (gates are monotonic terminal-state assertions; executor re-runs as a batch on the final tree;
    negative existence gates forbidden + neutralized — §9.9).
  - §4 (Researcher, ~L264): after "**Validation Gates**: Use project-specific validation commands
    that you've verified work in this codebase", insert a "CRITICAL RULES for gate commands (PRD
    §9.9 REQ-G1)" block mirroring src/agents/prompts.ts:286-293 — the 4 pre-existing rules (ONE
    command per gate; prefer standard tooling; no mixed-quote grep; no heredocs/for/multi-line) +
    G1.1 (forbid test ! -f|-e|-d / ! test / [ ! ] / ! [ ]), G1.2 (scope boundary → Success Criterion
    or manual: true Level-4), G1.3 (cleanup → manual: true), G1.5 (negated content only on own
    permanent deliverable). Use the SAME forbidden-form enumeration as the runtime.
  - §5 (Builder, ~L683): right after "**Each level must pass before proceeding to the next.**",
    insert TWO sub-notes mirroring src/agents/prompts.ts:741-756 — (a) Terminal-state gate
    re-execution (PRD §9.9): executor re-runs every gate as a BATCH on the FINAL tree; gates must be
    monotonic terminal-state assertions; (b) Do not delete throwaway/spike artifacts during your
    turn (PRD §9.9 G1.4): the artifact must survive until after validation.
  - DO NOT: copy the backslash escapes from prompts.ts (mirror intent in markdown); renumber the
    Builder steps; edit prompts.ts; touch other PROMPTS.md sections.
  - VERIFY (post-edit grep): grep -c "G1.1\|G1.2\|G1.3\|G1.4\|G1.5\|§9.9" PROMPTS.md → ≥5 hits.

Task 2: EDIT docs/ARCHITECTURE.md — add the §9.9 Gate Semantics subsection
  - Under "### Validation Gates" (L616), after the L4 Manual/E2E description block, add a
    "**Gate Semantics (PRD §9.9)**" subsection stating: gates are monotonic terminal-state
    assertions; PRPExecutor.#runValidationGates() re-runs every gate as a single BATCH on the final
    tree (not the coder's incremental order); negative file-existence gates are forbidden at
    construction (REQ-G1: G1.1–G1.5) and neutralized at runtime (REQ-G2: G2.1–G2.3) — a negated-
    existence gate (! test -f X / test ! -f X / [ ! -f X ] / ! [ -f X ]) is marked skipped:true /
    success:true with a logged reason citing §9.9, while negated content gates (! grep …) still
    execute normally; this repairs cached/legacy PRPs without regeneration.
  - DO NOT edit the mermaid diagram, the level descriptions, or the L37/L77/L317/L577/L1077
    high-level gate mentions (they are correct + non-contradicting).
  - VERIFY: grep -c "§9.9\|monotonic\|neutraliz" docs/ARCHITECTURE.md → ≥3 hits.

Task 3: EDIT README.md — minimal §9.9 clause on the L151 validation bullet
  - Append to the L151 "- **4-Level Validation**: Syntax, unit tests, integration tests, and manual
    validation gates" bullet a concise clause: gates are monotonic terminal-state assertions (PRD
    §9.9); the executor re-runs every gate as a batch on the final tree and neutralizes
    non-monotonic negative-existence gates.
  - DO NOT edit L649 (persona blurb — correct as-is) or any other README line.
  - VERIFY: grep -c "§9.9\|monotonic" README.md → ≥1 hit.

Task 4: CONFIRM no-change (record findings — explicit deliverables)
  - docs/CONFIGURATION.md: confirm grep `validation gate|gate command|monotonic|§9.9` → empty; no
    §9.9 config knob. NO CHANGE. Record in the commit message.
  - .env.example: confirm grep `gate|§9.9|monotonic` → empty; no §9.9 env var. NO CHANGE. Verify
    `git diff --quiet .env.example` (exit 0). Record in the commit message.

Task 5: FORMAT + VERIFY
  - RUN: npm run fix            # prettier --write (reflows the edited .md; accept it)
  - RUN: npm run format:check   # prettier --check **/*.md → clean
  - (typecheck/lint gate .ts only — unaffected by .md edits; run project-wide if the session's gate
    requires it, but they are N/A to this task's changes.)
  - SEMANTIC GREP GATE (the real gate — see Validation Loop §2/§3):
      grep -c "G1\.[1-5]\|§9.9" PROMPTS.md              # ≥5 (the mirrored rules)
      grep -c "monotonic\|§9.9\|neutraliz" docs/ARCHITECTURE.md  # ≥3 (the Gate Semantics subsection)
      grep -c "monotonic\|§9.9" README.md               # ≥1 (the L151 clause)
      grep -rni "rigid\|mechanical.*re-exec" README.md docs/ PROMPTS.md  # empty (no surviving claim)
      git diff --quiet .env.example && echo OK          # OK (byte-identical)
      git diff --name-only                             # EXACTLY: PROMPTS.md, docs/ARCHITECTURE.md, README.md
  - DO NOT add a vitest test; do NOT run the full npm run test:run as a semantic gate.
  - EXPECTED: format:check clean; all greps return the expected counts; .env.example unchanged;
    exactly 3 .md files in the diff.
```

### Implementation Patterns & Key Details
```markdown
<!-- The G1.x forbidden-forms enumeration to mirror (from src/agents/prompts.ts:290 + spec/16-validation-gates.md REQ-G1) -->
- **G1.1 (no negative existence):** `test ! -f|-e|-d <path>`, `! test -f|-e|-d <path>`,
  `[ ! -f|-e|-d <path> ]`, `! [ -f|-e|-d <path> ]` — existence is owned by the task graph (non-monotonic).
- **G1.2 (scope boundaries):** "don't create file X / don't import Y" → a Success Criterion OR a
  `manual: true` Level-4 gate (never a shell gate).
- **G1.3 (cleanup):** "the throwaway is gone" → a `manual: true` cleanup instruction (never a gate).
- **G1.4 (throwaway survives):** do not delete a spike/throwaway during the coder's turn; cleanup
  after validation (so the artifact's existence gates pass on the terminal tree).
- **G1.5 (negated content):** `! grep -q 'X' <file>` ONLY when <file> is this task's own deliverable
  AND the asserted absence is permanent; never about another task's file.

<!-- The runtime neutralization contract to state (from spec/16-validation-gates.md REQ-G2) -->
- A negated-EXISTENCE gate (! test -f X / test ! -f X / [ ! -f X ] / ! [ -f X ]) → marked
  `skipped: true / success: true`, reason: "non-monotonic negative-existence gate neutralized —
  file existence is owned by the task graph / is a cleanup step, not a terminal-state assertion (§9.9)".
- A negated-CONTENT gate (! grep …) → executes normally (NOT neutralized — G2.2).
- An AMBIGUOUS command → executes normally (conservative detector — G2.3).

<!-- The docs/ARCHITECTURE.md subsection skeleton (place under "### Validation Gates", after L4) -->
**Gate Semantics (PRD §9.9).** Validation gates are *monotonic terminal-state assertions*: once true
against the final filesystem state, they stay true. `PRPExecutor.#runValidationGates()` re-runs
**every** gate as a single batch against that final tree (not the incremental order the coder ran
during its turn). Negative file-existence gates are **forbidden at construction** (REQ-G1: G1.1–G1.5)
and **neutralized at runtime** (REQ-G2: G2.1–G2.3): a negated-existence gate (`! test -f X`,
`test ! -f X`, `[ ! -f X ]`, `! [ -f X ]`) is marked `skipped: true / success: true` with a logged
reason citing §9.9, while negated *content* gates (`! grep …`) execute normally. This repairs
cached/legacy PRPs without regeneration.
```

### Integration Points
```yaml
DOCS (the deliverable):
  - PROMPTS.md: +§1 concept note, +§4 G1.x rules block, +§5 Builder terminal-state/G1.4 notes.
  - docs/ARCHITECTURE.md: +"Gate Semantics (PRD §9.9)" subsection under "### Validation Gates".
  - README.md: +§9.9 clause on the L151 validation bullet.
  - docs/CONFIGURATION.md: NO CHANGE (recorded: no §9.9 config knob).
  - .env.example: NO CHANGE (recorded: no §9.9 env var; byte-identical).

NO CHANGES TO (hard boundary):
  - src/agents/prompts.ts (runtime source — owned by P1.M1.T1.S1 + P1.M1.T2.S1; mirror FROM it).
  - src/agents/prp-executor.ts (neutralization impl — owned by P1.M2.T1.S2; STATE its contract, don't build it).
  - PRD.md / spec/* (human-owned), tasks.json, prd_snapshot.md, any tests/ file.
  - No new src file, no new test (docs-only).

CONSISTENCY (the runtime backstop this doc describes):
  - The docs state the §9.9 contract that P1.M1 (prompts.ts G1.x) + P1.M2.T1.S2 (executor G2.x)
    implement. The doc does not duplicate their code — it documents the user-visible/author-visible
    contract (gates are monotonic; negated existence is forbidden + neutralized).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # prettier --write (the ONLY formatter that applies to .md; run first — reflows)
npm run format:check   # prettier --check "**/*.{ts,js,json,md,yml,yaml}" → clean
# (npm run typecheck / npm run lint gate .ts ONLY — unaffected by .md edits. Run them project-wide
#  if the session's gate requires a clean tree, but they are N/A to this task's changes.)
# Expected: format:check clean. Likely "failure": prettier reformats unrelated legacy prose in
#   PROMPTS.md — accept the reflow (it is a large legacy file). The semantic gate is the grep below.
```

### Level 2: Semantic Verification (the real gate — grep, since no unit test applies)
```bash
# (a) PROMPTS.md mirrored the G1.x rules + the Builder notes + the concept note:
grep -c "G1\.1\|G1\.2\|G1\.3\|G1\.4\|G1\.5" PROMPTS.md          # ≥5 (the rule numbers)
grep -c "§9.9" PROMPTS.md                                       # ≥4 (concept + §4 + 2× §5)
grep -c "monotonic\|terminal-state\|terminal state" PROMPTS.md  # ≥3 (concept + §4 + §5)
grep -c "throwaway\|spike" PROMPTS.md                           # ≥1 (the §5 G1.4 note)
grep -c "test ! -f\|! test -f" PROMPTS.md                       # ≥1 (a forbidden form enumerated)

# (b) docs/ARCHITECTURE.md carries the §9.9 Gate Semantics:
grep -c "§9.9\|monotonic\|neutraliz" docs/ARCHITECTURE.md       # ≥3 (the new subsection)

# (c) README.md L151 carries the §9.9 clause:
grep -c "monotonic\|§9.9" README.md                             # ≥1

# (d) No rigid-mechanical claim survives (verified baseline + post-edit):
grep -rni "rigid\|mechanical.*re-exec\|re-executed.*exactly once" README.md docs/ PROMPTS.md
# Expected: EMPTY (no output) — no claim that gates are a rigid mechanical contract survives.

# Expected: each grep returns at least its threshold; (d) is empty.
```

### Level 3: Regression / No-Change Confirmation
```bash
# (e) .env.example byte-identical (no §9.9 env var):
git diff --quiet .env.example && echo "env: no change (OK)"   # prints OK, exit 0
grep -ci "gate\|9\.9\|monotonic" .env.example                 # 0 (no §9.9 var)
# (f) docs/CONFIGURATION.md unchanged (no §9.9 config knob):
git diff --quiet docs/CONFIGURATION.md && echo "config: no change (OK)"  # prints OK, exit 0
grep -ci "validation gate\|monotonic\|§9.9\|9\.9" docs/CONFIGURATION.md  # 0 (no gate refs)
# (g) Exactly the 3 expected files changed:
git diff --name-only
# Expected: EXACTLY — PROMPTS.md, docs/ARCHITECTURE.md, README.md (no src/, no PRD, no tasks.json).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP (documentation). Domain reasoning (record in commit message):
#   1. PROMPTS.md now matches src/agents/prompts.ts "byte-for-byte in intent" on the G1.x forbidden
#      forms + the §9.9 citations — a reader/port following the reference emits §9.9-compliant gates.
#   2. docs/ARCHITECTURE.md's Validation Gates section now describes the SAME semantics as the runtime
#      (monotonic terminal-state assertions; batch re-execution; negated-existence neutralization per
#      REQ-G2) — the architecture doc no longer contradicts PRPExecutor.
#   3. README's validation feature bullet is consistent (monotonicity clause) without over-detailing.
#   4. docs/CONFIGURATION.md + .env.example are provably no-ops for §9.9 (no config knob, no env var)
#      — recorded so no reviewer re-opens the changeset.
#   5. No surviving claim that gates are a rigid mechanical contract (grep empty).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run format:check` clean (prettier on the edited .md).
- [ ] Semantic grep (a)–(d) returns the expected thresholds (PROMPTS.md G1.x/§9.9/monotonic;
      ARCHITECTURE.md §9.9/monotonic/neutraliz; README monotonic/§9.9; no rigid-mechanical claim).
- [ ] `git diff --name-only` lists EXACTLY `PROMPTS.md`, `docs/ARCHITECTURE.md`, `README.md`.

### Feature Validation
- [ ] PROMPTS.md §4 (Researcher) carries the G1.1–G1.5 + the 4 pre-existing gate rules.
- [ ] PROMPTS.md §5 (Builder) carries the terminal-state re-execution note + the G1.4 throwaway note.
- [ ] PROMPTS.md §1 concept blurb carries the monotonicity note.
- [ ] docs/ARCHITECTURE.md Validation Gates section carries the §9.9 Gate Semantics subsection
      (monotonic + batch re-exec + REQ-G1/REQ-G2 neutralization).
- [ ] README.md L151 carries the §9.9/monotonicity clause.

### Code Quality Validation
- [ ] Mirrors `src/agents/prompts.ts` "in intent" (G1.x numbers + forbidden forms + §9.9 citations),
      escaping markdown normally (no copied backslash escapes).
- [ ] No renumbering of the PROMPTS.md Builder steps; the notes are sub-bullets of step 4.
- [ ] Additive only (verified baseline: no rigid-mechanical claim to remove).
- [ ] Only `.md` docs touched; no `src/`, `tests/`, `PRD.md`, `tasks.json`, `prd_snapshot.md`.

### Documentation & Deployment
- [ ] docs/CONFIGURATION.md NO-CHANGE finding recorded (no gate refs; no §9.9 config knob).
- [ ] .env.example NO-CHANGE finding recorded (no §9.9 env var; `git diff --quiet` passes).
- [ ] Commit message records: Mode B doc-sync for §9.9; the 3 edited files + 2 no-change findings;
      the mirror-from-prompts.ts intent (not byte-identity); the verified additive baseline; the
      §9.9 REQ-G1/REQ-G2 semantics now expressed in the docs; cross-ref to P1.M1 (prompts.ts) +
      P1.M2.T1.S2 (executor neutralization) as the runtime owners.

---

## Anti-Patterns to Avoid

- ❌ Don't edit `src/agents/prompts.ts`. It is the runtime source of truth (owned by P1.M1.T1.S1 +
      P1.M1.T2.S1, Complete). This task MIRRORS its wording INTO PROMPTS.md — it does not change it.
- ❌ Don't edit `src/agents/prp-executor.ts` or add a test. The executor neutralization is
      P1.M2.T1.S2's (in-flight) surface. This task's docs STATE the contract; they don't build it.
- ❌ Don't copy the backslash escapes from prompts.ts. It is a template STRING (`\`test ! -f\``);
      PROMPTS.md is markdown. Mirror INTENT (G1.x numbers + forbidden forms + §9.9 citations),
      escaping markdown normally.
- ❌ Don't treat PROMPTS.md as if it already has the gate rules. It is the GENERIC ported-from
      template — grep confirms NONE of the detailed rules exist. The §4 edit is ADDITIVE (insert a
      full "CRITICAL RULES" block anchored on the L264 line), not a find-replace.
- ❌ Don't renumber the PROMPTS.md Builder steps. Insert the terminal-state/G1.4 notes as sub-bullets
      of step 4 ("Progressive Validation"), right after "Each level must pass before proceeding to
      the next." — leave steps 1–5 intact.
- ❌ Don't invent a "rigid mechanical contract" claim to remove. The verified baseline is that NONE
      survives (grep empty). The sync is ADDITIVE — add the monotonicity + neutralization semantics.
- ❌ Don't add a vitest test for PROMPTS.md content. It is a reference doc, not runtime-imported; the
      sibling REQ-G1 tasks already assert prompts.ts (the runtime). "MOCKING: none — documentation
      only." The semantic gate is grep, not a unit test.
- ❌ Don't change `.env.example` or `docs/CONFIGURATION.md`. §9.9 adds NO env var and NO config knob
      (it is prompt + runtime code). Record both no-change findings explicitly — they are deliverables.
- ❌ Don't edit `PRD.md`/`spec/*` (human-owned), `tasks.json`, or `prd_snapshot.md`.
- ❌ Don't gate on `npm run typecheck`/`npm run lint` for this task's changes — they gate `.ts` only
      and are unaffected by `.md` edits. The real gate is `npm run format:check` (prettier on .md) +
      the semantic grep. (Run typecheck/lint project-wide only if the session requires a clean tree.)
- ❌ Don't run the full `npm run test:run` as a semantic gate — no test was added (docs-only). The
      semantic proof is the grep verification + the no-change confirmations.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a focused Mode B documentation-sync task with a clear, bounded surface. Every
edit is additive (verified baseline: grep for `rigid|mechanical.*re-exec` across README/docs/
PROMPTS.md is empty — no contradicting claim to remove). The runtime wording to mirror is fully
captured (`src/agents/prompts.ts:286–293` + `741–756`, quoted in research §1) and the PRD §9.9
contract is read in full (`spec/16-validation-gates.md` REQ-G1/REQ-G2). The exact insertion anchors
are pinned: PROMPTS.md §1 L31-34 / §4 L264 / §5 L683; docs/ARCHITECTURE.md "### Validation Gates"
L616 section; README.md L151 bullet. The two no-change deliverables (CONFIGURATION.md + .env.example)
are verified empty (grep) and byte-stable (`.env.example`). The validation is deterministic: prettier
format:check + a grep threshold table + `git diff --name-only`/`git diff --quiet .env.example`. The
non-obvious traps are documented: (1) mirror INTENT not backslash-escapes (prompts.ts is a template
string); (2) PROMPTS.md currently has none of the detailed rules → additive insert, not find-replace;
(3) don't renumber the Builder steps; (4) no vitest test (reference doc, not runtime); (5) typecheck/
lint gate .ts only → the .md gate is prettier + grep. The work is file-disjoint from the parallel
P1.M2.T1.S2 (`src/agents/prp-executor.ts` + tests — zero `.md` overlap). Residual risks: (a) prettier
reflows unrelated legacy prose in the large PROMPTS.md (accepted — the semantic gate is grep, not
byte-stability); (b) under-mirroring (missing one G1.x number — mitigated by the grep threshold
table that checks all of G1.1–G1.5); (c) a wording drift from prompts.ts "intent" (mitigated: the
forbidden-forms enumeration + §9.9 citations + G1.x numbers are the verifiable contract). No
runtime/network/LLM unknowns — pure markdown edits + grep.