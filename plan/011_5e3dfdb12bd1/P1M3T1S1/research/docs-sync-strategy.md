# Research — P1.M3.T1.S1: Update overview docs + mirror §9.9 gate rules into PROMPTS.md

## 0. What this task IS (Mode B doc-sync — no code, no tests)

This is the **Mode B changeset-level documentation sync** for PRD §9.9 (Validation Gate
Semantics — Monotonicity & Terminal-State Re-Execution). It edits ONLY `.md` reference/overview
docs so they stop drifting from the runtime (`src/agents/prompts.ts`) and from §9.9. **No `src/`
changes. No test additions** (the prompt-TEXT tests live in the sibling REQ-G1 tasks P1.M1.T1.S1
and P1.M1.T2.S1, already Complete; this task does not re-test `prompts.ts`). "MOCKING: none —
documentation only" (item LOGIC §3).

## 1. The authoritative sources of truth (read-only — do NOT edit)

- **PRD §9.9** = `spec/16-validation-gates.md` (the merged PRD's §9.9 source file). Defines
  REQ-G1 (G1.1–G1.5 gate-construction guardrails) + REQ-G2 (G2.1–G2.3 executor neutralization) +
  §9.9.3 acceptance criteria. Read it fully — it is the contract this sync honors.
- **Runtime prompts** = `src/agents/prompts.ts` (the ONLY prompt source the pipeline runs;
  PROMPTS.md is NOT imported at runtime — `src/agents/` is never re-loaded from it). The G1.x
  wording already LANDED here (P1.M1.T1.S1 + P1.M1.T2.S1 = Complete):
  - **Blueprint (Researcher) gate rules** at `prompts.ts:286–293` — the "CRITICAL RULES for gate
    commands" block: ONE command per gate / prefer standard tooling / no mixed-quote grep / no
    heredocs + the four new §9.9 rules:
    - L290 **G1.1** — forbid negative file/dir-existence gates (`test ! -f|-e|-d`, `! test …`,
      `[ ! -f|-e|-d ]`, `! [ -f|-e|-d ]`); existence owned by the task graph, non-monotonic.
    - L291 **G1.2** — scope boundaries ("don't create file X / don't import Y") MUST be a Success
      Criterion OR a `manual: true` Level-4 gate, never a shell gate.
    - L292 **G1.3** — cleanup/throwaway deletion is a cleanup instruction, not a gate; "the artifact
      is gone" MUST be `manual: true`.
    - L293 **G1.5** — negated content gate (`! grep -q …`) ONLY on own deliverable + permanent
      absence; never about another task's file.
  - **Builder (Coder)** at `prompts.ts:741–756`:
    - L741–748 **Terminal-state re-execution note** — executor re-runs every gate as a BATCH on the
      FINAL filesystem state; gates must be monotonic terminal-state assertions.
    - L750–756 **G1.4** — do NOT delete throwaway/spike artifacts during the coder's turn; cleanup
      happens after validation (the artifact's existence gates must pass on the terminal state).
- **Executor neutralization** = `src/agents/prp-executor.ts` `#runValidationGates` (P1.M2.T1.S2,
  in-flight previous): negated-existence gates are detected + marked `skipped:true/success:true`
  citing §9.9. This task's docs must state this contract (it's the runtime backstop).

## 2. The target files — what each currently says (VERIFIED)

### 2a. `PROMPTS.md` (repo root — the ported-from reference, PRD §6 / §9.3.4 source)
- **1176 lines**, generic ported-from template. **It has NONE of the detailed gate-construction
  rules** (grep for `ONE command per gate|prefer standard tooling|mixed quote|heredoc|test ! -f|
  G1\.1|monotonic|throwaway|manual: true` → 0 matches). It is purely the generic template.
- Relevant sections:
  - **L31–34 "### Validation Gates"** (in §1 PRP_README concept): the generic concept blurb
    ("Deterministic checks such as pytest, ruff, or static type passes … Validation gate = all
    tests pass."). Pre-§9.9; implies gates are a mechanical contract.
  - **§4 PRP_CREATE_PROMPT (The Researcher)**, L189–~310: the generic Researcher template.
    **L264** `**Validation Gates**: Use project-specific validation commands that you've verified
    work in this codebase` (under "Step 3: Research Integration"). No G1.x rules.
  - **§5 PRP_EXECUTE_PROMPT (The Builder)**, L641–715: the generic Builder template.
    - "4. **Progressive Validation**" (~L673) → the 4 levels → "**Each level must pass before
      proceeding to the next.**" (~L683) → blank → "5. **Completion Verification**". NO terminal-state
      note, NO throwaway-survival note.
- **Action = MIRROR (additive):** add the G1.1–G1.5 block to §4 (Researcher) near L264; add the
  terminal-state + G1.4 note to §5 (Builder) right after "Each level must pass…"; add a one-line
  monotonicity note to the L31–34 concept blurb. Goal: PROMPTS.md matches `prompts.ts`
  "byte-for-byte in intent" (item LOGIC a).

### 2b. `docs/ARCHITECTURE.md` — the PRIMARY §9.9 semantics home
- **"### Validation Gates"** section at **L616–660**: a mermaid diagram of the 4 levels + level
  descriptions (L1 Syntax/Style, L2 Unit, L3 Integration, L4 Manual/E2E). NO mention of
  monotonicity / terminal-state re-execution / negated-existence neutralization / §9.9.
- Other descriptive gate mentions: **L37, L77, L317, L577, L1077** ("4-level validation gates").
  These are high-level/architectural and do NOT claim gates are a rigid mechanical contract — leave
  them; the L616 section gets the §9.9 note.
- **Action = ADD a §9.9 subsection** (or a "Gate Semantics (PRD §9.9)" note) under the L616
  Validation Gates section: gates are monotonic terminal-state assertions; the executor re-runs
  every gate as a batch on the final tree; negated-existence gates are neutralized (skipped/passed)
  per §9.9 REQ-G2.

### 2c. `docs/CONFIGURATION.md`
- **ZERO gate references** (grep `validation gate|gate command|monotonic|§9.9` → empty). §9.9
  introduces no config knob (it's prompt + runtime semantics, not config). **NO CHANGE.** Record
  the finding (item LOGIC b/c).

### 2d. `README.md`
- Gate mentions: **L151** "4-Level Validation: Syntax, unit tests, integration tests, and manual
  validation gates" (feature bullet); **L649** "Coder: Implements PRPs with validation gates"
  (persona bullet). Both high-level/descriptive; **neither claims gates are a rigid mechanical
  contract** (grep `rigid|mechanical.*re-exec|once.*fail-on-first` across all docs → empty).
- **Action = MINIMAL/optional.** Add ONE concise clause to L151 (the validation feature bullet)
  noting gates are monotonic terminal-state assertions (keeps README consistent without
  over-detailing a feature list). L649 needs no change (persona blurb).

### 2e. `.env.example` (145 lines)
- **No `gate` / `§9.9` / `monotonic` var** (grep → empty). §9.9 adds NO env var (it is prompt +
  runtime code). **NO CHANGE.** Record the finding (item LOGIC c) — this is an explicit deliverable
  ("confirm .env.example needs no §9.9 change and record that finding").

## 3. "No rigid mechanical contract survives" — VERIFIED baseline

The item requires that "no claim that gates are a rigid mechanical contract should survive". A
repo-wide grep (`rigid|mechanical.*re-exec|mechanically.*re-exec|re-executed.*exactly once|once
.*fail-on-first|rigid.*mechanical` across README/ARCHITECTURE/CONFIGURATION/PROMPTS.md) returned
**empty** — so nothing currently makes that explicit claim. The sync is therefore **ADDITIVE**
(add the monotonicity + neutralization semantics) rather than corrective-removal. The one place
that IMPLIES mechanical re-execution is the generic PROMPTS.md concept blurb (L31-34) and the
generic Researcher/Builder templates — which the G1.x mirror + the concept-blurb note fix.

## 4. Validation approach for a docs-only task (no unit tests)

- **No `src/` change → no `tsc`/`eslint` relevance** (those gate `.ts`). The ONLY build gate that
  applies to `.md` is **prettier** (`npm run format:check` globs `**/*.md`). Run `npm run fix`
  (prettier --write) before format:check; accept prettier's reflow of the edited .md.
- **Semantic verification = grep** (the real gate): assert the G1.x forbidden-form wording now
  appears in PROMPTS.md; assert the §9.9 monotonicity/neutralization note appears in
  docs/ARCHITECTURE.md; assert no `rigid`/`mechanical.*re-exec` claim survives; assert `.env.example`
  is byte-identical (`git diff --quiet .env.example`).
- Do NOT add a vitest test for PROMPTS.md content — it is a reference doc, not runtime-imported;
  the sibling REQ-G1 tasks already test `prompts.ts` (the runtime source). A docs-content test
  would be over-engineering and outside "documentation only".

## 5. Disjointness / scope boundaries

- **READ-ONLY (do NOT edit):** `PRD.md`/`spec/*` (human-owned), `tasks.json`, `prd_snapshot.md`,
  `src/agents/prompts.ts` (the runtime source of truth — owned by the landed P1.M1 tasks), any
  `src/` or `tests/` file.
- **EDIT:** `PROMPTS.md`, `docs/ARCHITECTURE.md`, `README.md` (minimal). **CONFIRM no-change:**
  `docs/CONFIGURATION.md`, `.env.example` (record findings).
- **Parallel sibling P1.M2.T1.S2** (in-flight) edits `src/agents/prp-executor.ts` + its tests —
  ZERO file overlap with this docs task. This task's docs STATE the neutralization contract that
  P1.M2.T1.S2 implements (it consumes the contract as a given; it does not implement it).

## 6. npm scripts (VERIFIED — same harness as the rest of the session)

```
"fix": "npm run lint:fix && npm run format"   # format = prettier --write (applies to .md)
"lint": "eslint . --ext .ts"                  # .ts only — N/A to .md edits
"typecheck": "tsc --noEmit -p tsconfig.build.json"  # .ts only — N/A to .md edits
"format:check": "prettier --check \"**/*.{ts,js,json,md,yml,yaml}\""  # APPLIES to .md
"test:run": "vitest run"                       # no new test (docs-only)
```
Gate for this task = `npm run fix && npm run format:check` + the grep verifications in §4.
(`typecheck`/`lint` are still run project-wide but are unaffected by .md edits; `test:run` is
untouched — no test added.) Do NOT run the full `npm run test:run` as a semantic gate.