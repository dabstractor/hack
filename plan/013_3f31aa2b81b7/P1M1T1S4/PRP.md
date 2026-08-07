# PRP — P1.M1.T1.S4: `.env.example` 'Reasoning Levels' subsection + getter/validator JSDoc cross-references

> Plan 013, PRD §9.2.9 (Per-Role Reasoning Level / Extended-Thinking Budget). S1 (LANDED) added
> `ReasoningLevel`/`REASONING_LEVELS`/`resolveReasoningLevel`/`ReasoningConfigError` + the 5 env-name
> constants + 5 defaults. S2 (LANDED) added the 5 per-role getters + `validateAllReasoningLevels`.
> S3 (in progress, treated as CONTRACT) reconciles `agent-factory`'s `ThinkingLevel = ReasoningLevel`.
> **S4 is the doc layer (Mode A — this subtask IS the `.env.example` doc update)**: (a) a new
> `# Reasoning Levels (PRD §9.2.9)` box in `.env.example` documenting the 5 vars / 6 levels / defaults /
> two-axes note / empty→default / invalid→hard-error; (b) ensure the getter/validator/env-name-constant
> JSDoc cross-references §9.2.9 + `.env.example`, which also FIXES the broken getter-name cross-references
> S1 left behind. **Doc + JSDoc comments only; no runtime change, no tests for the doc file.**

---

## Goal

**Feature Goal**: Document the per-role reasoning-level surface for users in `.env.example`, and make
the code-side JSDoc (env-name constants, getters, validator, typed error) correctly cross-reference
PRD §9.2.9 and the new `.env.example` section — repairing the 4 broken `{@link}`/getter-name references
S1 introduced when it pre-named getters that S2 ultimately landed under different names.

**Deliverable**:
1. **`.env.example`** — insert a new `# REASONING LEVELS (PER-ROLE / PRD §9.2.9)` box **between the
   existing `MODEL CONFIGURATION` block (ends L66) and the `ADVANCED CONFIGURATION` block (starts L68)**.
   The box documents: the five `PRP_REASONING_*` vars as commented examples
   (`agent`/`breakdown_agent`/`bug_finder_agent`/`validation_agent` default `high`; `impl_agent`
   default `off`), the six valid case-insensitive levels (`off`,`minimal`,`low`,`medium`,`high`,`xhigh`),
   the explicit two-independent-axes note, empty/whitespace→default, and invalid→hard startup error.
2. **`src/config/constants.ts`** — JSDoc-only edits: (a) fix the 4 env-name-constant `@remarks` that cite
   non-existent getters (`getReasoningBreakdownAgent` → `getReasoningBreakdown`, etc.); (b) add a
   `.env.example` cross-reference line to each of the 5 env-name constants, the 5 getters, and
   `resolveReasoningLevel` (they already cite §9.2.9).
3. **`src/config/types.ts`** — JSDoc-only: add a `.env.example` cross-reference to the
   `ReasoningConfigError` class JSDoc (it already cites §9.2.9 #4).

**Success Definition**:
- `.env.example` has a `# Reasoning Levels (PRD §9.2.9)` box placed right after MODEL CONFIGURATION,
  matching the sibling ALL-CAPS-box comment style, with the 5 vars (all commented), 6 levels,
  two-axes note, empty→default, invalid→hard-error, and a §9.2.9 cite.
- No env-name-constant JSDoc references a getter that doesn't exist; every reasoning env-name const +
> getter + `resolveReasoningLevel` + `ReasoningConfigError` JSDoc names both §9.2.9 AND `.env.example`.
- No runtime behavior changes (doc + JSDoc comments only); `npm run typecheck && npm run lint &&
  npm run format:check` clean; `npm run docs:check` clean (regression-only — see Context).

---

## Why

- **User discoverability of the §9.2.9 surface.** §9.2.9 makes reasoning a first-class, independently-
  configurable per-role axis, but `.env.example` (the file users copy to configure the pipeline) had
  **zero** mention of it. Users had no way to discover the 5 `PRP_REASONING_*` vars, the 6 accepted
  levels, the defaults, or the two-axes decoupling from the config template. S4 closes that gap.
- **The two-axes promise must be visible at the config layer.** The central insight of §9.2.9 is that
  model tier and reasoning level are independent — "tuning one never forces a compromise on the other."
> That insight is most useful *where users pick models* (the adjacent MODEL CONFIGURATION box), so the
> reasoning box sits right after it, restating the independence explicitly. Without this, users keep the
> old mental model (drop model tier to disable thinking) that §9.2.9 was designed to eliminate.
- **Correctness: S1 left broken JSDoc cross-references.** S1's env-name-constant JSDoc blocks name
> getters that do not exist (`getReasoningBreakdownAgent()`, `getReasoningBugFinderAgent()`,
  `getReasoningValidationAgent()`, `getReasoningImplAgent()`). S2 landed them as `getReasoningBreakdown()`
  /`BugFinder()`/`Validation()`/`Impl()`. A reader following those JSDoc links hits dead ends. S4's
  contract ("ensure getter/validator JSDoc cross-reference §9.2.9 and .env.example") is the natural
  place to repair them. This is an out-of-spec doc-correctness fix (AGENTS.md rule 5), not new behavior.
- **Mode A cohesion.** The JSDoc is the code-side twin of the `.env.example` doc. Cross-referencing
  them both ways (code → `.env.example` for the user-facing surface; `.env.example` → §9.2.9 for the
  spec) keeps the two views of the same config in lockstep.
- **Scope discipline.** S4 = `.env.example` box + JSDoc cross-refs ONLY. No M2 changeset docs
  (`docs/CONFIGURATION.md` etc. = M2.T1.S1/S2/S3), no agent-factory (S3), no `.hack` schema (T2), no
  startup wiring (T4), no symbol-body changes, no tests for the doc file.

---

## What

### User-visible behavior
None at runtime. Indirectly: a user reading `.env.example` now sees how to tune per-role reasoning
levels and that doing so never forces a model-tier compromise.

### Technical requirements (exact contract)

**File 1 — `.env.example`** — insert ONE new box. **Insertion point: between the last line of the
MODEL CONFIGURATION block (L66, `# ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5-turbo`) and the `# ===` line
that opens ADVANCED CONFIGURATION (L68).** (integration-points.md §H: "add a `# Reasoning Levels
(PRD §9.2.9)` subsection after the `# MODEL CONFIGURATION` block … before the next section.")

The box MUST follow the sibling box style (ALL-CAPS title + 80-char `# ===` over/underline; prose
intro citing §9.2.9; commented `# VAR=value` examples — never uncommented, since defaults apply when
absent; a `# See PRD §…` cite). Title: **`# REASONING LEVELS (PER-ROLE / PRD §9.2.9)`** (ALL-CAPS to
match `MODEL CONFIGURATION` / `VALIDATION CONFIGURATION (OPTIONAL)` siblings; §9.2.9 anchor in the
parenthetical, matching how those siblings carry a parenthetical).

The box MUST contain, in this order:
1. **Intro prose (4–6 lines)** — the two-independent-axes note (model tier and reasoning are two
   independent axes; tuning one never forces a compromise on the other; you can run a strong model
   with reasoning off, or a fast model with reasoning on — no longer drop model tier to disable
   thinking) + the 6 valid case-insensitive levels + a `See PRD §9.2.9` cite. Use PRD §9.2.3's phrasing.
2. **The 5 vars as commented examples**, each with a one-line per-role rationale + its default:
   - `# PRP_REASONING_AGENT=high` — research/PRP role (default `high`)
   - `# PRP_REASONING_BREAKDOWN_AGENT=high` — task decomposition (default `high`)
   - `# PRP_REASONING_BUG_FINDER_AGENT=high` — bug finder (default `high`)
   - `# PRP_REASONING_VALIDATION_AGENT=high` — validation (default `high`)
   - `# PRP_REASONING_IMPL_AGENT=off` — implementation/codegen (default **`off`**) — note *why* off
     (codegen executes a complete PRP contract; reasoning off is faster/cheaper and decouples from
     model choice — §9.2.2/§9.2.9).
3. **Semantics footer (3–5 lines)** — empty/whitespace→default (unset or blank falls back to the role
   default; never forwarded); invalid value→**hard startup error** (exit 1, names the var + value +
   accepted levels; mirrors §9.2.7 fail-fast); optionally one discoverability line noting the `.hack
   [reasoning]` keys (§9.7.5) are the file-config layer for the same vars (the schema wiring is T2).

**File 2 — `src/config/constants.ts`** — JSDoc-only edits (no symbol bodies):
- **(a) Fix the 4 broken getter cross-references** in the env-name-constant `@remarks`:
  - `PRP_REASONING_BREAKDOWN_AGENT` (L1557): `getReasoningBreakdownAgent()` → **`getReasoningBreakdown()`**
  - `PRP_REASONING_BUG_FINDER_AGENT` (L1566): `getReasoningBugFinderAgent()` → **`getReasoningBugFinder()`**
  - `PRP_REASONING_VALIDATION_AGENT` (L1575): `getReasoningValidationAgent()` → **`getReasoningValidation()`**
  - `PRP_REASONING_IMPL_AGENT` (L1585): `getReasoningImplAgent()` → **`getReasoningImpl()`**
  - (`PRP_REASONING_AGENT` L1547 is already correct: `getReasoningAgent()`.)
- **(b) Add a `.env.example` cross-reference** to: each of the 5 env-name-constant JSDoc blocks, each of
  the 5 getter JSDoc blocks (JSDoc@1656/1682/1709/1736/1763), and the `resolveReasoningLevel` JSDoc (JSDoc@1618). Each already
  cites §9.2.9; add one short line, e.g. `Documented for users in \`.env.example\` (Reasoning Levels box).`
  (style consistent with the existing `@remarks` — see the file's existing inline cross-refs).

**File 3 — `src/config/types.ts`** — JSDoc-only: add a `.env.example` cross-reference to the
`ReasoningConfigError` class JSDoc (JSDoc@302; it already cites §9.2.9 #4).

**Do NOT modify:** any symbol body (types, values, getter/validator logic), `agent-factory.ts` (S3),
any `.hack` schema (T2), any startup path (T4), any `docs/` markdown (M2.T1.S1/S2/S3), or the repo
`./.hack` file. No tests are added for the doc file (contract: "no tests for a doc file").

### Success Criteria
- [ ] `.env.example` has a `# REASONING LEVELS (PER-ROLE / PRD §9.2.9)` box placed between MODEL
      CONFIGURATION (after L66) and ADVANCED CONFIGURATION (before L68).
- [ ] The box contains: 2-axes note; 6 valid case-insensitive levels; 5 commented `PRP_REASONING_*`
      examples with correct defaults (high/high/high/high/**off**); empty→default; invalid→hard error;
      a §9.2.9 cite. All example lines are commented (no uncommented `PRP_REASONING_*=`).
- [ ] No env-name-constant JSDoc cites a non-existent getter (all 5 now cite the real S2 getter names).
- [ ] Each reasoning env-name const + getter + `resolveReasoningLevel` + `ReasoningConfigError` JSDoc
      names both §9.2.9 AND `.env.example`.
- [ ] No runtime change; `npm run typecheck && npm run lint && npm run format:check` clean;
      `npm run docs:check` clean.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement this
successfully?_ **Yes** — the exact `.env.example` insertion point (with line numbers + the sibling box
style to mirror), the verbatim content the box must carry (drawn from §9.2.9/§9.2.2), the exact
JSDoc-bug sites (4 wrong getter names, with line numbers + the correct replacements), the validation
facts (which gates scan which files), and the executable verification commands are all below.

### Documentation & References

```yaml
# MUST READ — the insertion-point spec + the box content the contract requires
- docfile: plan/013_3f31aa2b81b7/architecture/integration-points.md
  section: "H. .env.example + repo ./.hack"
  why: Pins: "add a # Reasoning Levels (PRD §9.2.9) subsection after the # MODEL CONFIGURATION block
        (starts :40) … before the next section" + the required content (5 vars + 6 levels + defaults +
        the two-axes note + empty→default + invalid→hard-error). The ./.hack [reasoning] block is a
        SEPARATE optional item — NOT S4's deliverable.

# MUST READ — S1/S2 landed symbols (with line numbers) + the JSDoc-bug details + validation-gate facts
- docfile: plan/013_3f31aa2b81b7/P1M1T1S4/research/env-example-and-jsdoc-design.md
  section: "1. S1/S2 are LANDED", "2. .env.example structure", "3. THE JSDoc getter-name bug",
        "4. The exact contract content", "5. Validation-gate facts", "7. The two-axes wording"
  why: The exact insertion line (between L66 and L68), the sibling box-title convention (ALL-CAPS +
        parenthetical; 80-char === lines), the table of the 4 wrong getter names → correct names, the
        prettier/eslint/docs:check coverage matrix, and PRD §9.2.3's two-axes phrasing to mirror.

# MUST READ — the S2 PRP (defines the getter names S4 must cross-reference; S1's JSDoc diverged from them)
- file: plan/013_3f31aa2b81b7/P1M1T1S2/PRP.md
  why: S2 LANDED getters are getReasoningAgent/getReasoningBreakdown/getReasoningBugFinder/
        getReasoningValidation/getReasoningImpl (NOT the *_Agent names S1's env-const JSDoc cite). S4
        aligns the env-const JSDoc to S2's actual names.

# MUST READ — the contract's authoritative source for wording/levels/defaults
- docfile: PRD.md   # or the prd_snapshot — §9.2.9 (Per-Role Reasoning Level) + §9.2.2 "Reasoning
        Configuration" + §9.2.3 two-axes phrasing
  why: The 5 vars + 6 levels + defaults + two-axes note + empty→default + invalid→hard-error all come
        from here. Mirror §9.2.3's wording ("two independent axes … tuning one never forces a
        compromise on the other") so the .env.example and the spec agree.

# PATTERN FILE 1 — the ONLY .env file edited (current state verified in-repo)
- file: .env.example
  why: S4 inserts ONE box between MODEL CONFIGURATION (L39–66) and ADVANCED CONFIGURATION (L68–70).
        Mirror the sibling box style: 80-char `# ===` over/underline, ALL-CAPS title + parenthetical
        (see MODEL CONFIGURATION L39–41, VALIDATION CONFIGURATION (OPTIONAL) L125–127), prose intro
        citing §9.2.9, commented `# VAR=value` examples (never uncommented — defaults apply when
        absent), a `# See PRD §…` cite. The MODEL CONFIGURATION box (L42–66) is the closest style twin.
  pattern: "# ============… (80) =\n# TITLE (PARENTHETICAL)\n# ============… (80)\n# prose …\n# VAR=val"
  gotcha: Line 41's underline is 80 `=` (the other underlines are 76) — match 80 to the immediate
        MODEL CONFIGURATION neighbor for visual consistency. Do NOT uncomment any PRP_REASONING_*
        example (defaults apply when absent; an uncommented line would FORCE a value on users).

# PATTERN FILE 2 — JSDoc edits (READ the existing JSDoc; edit comments only, never symbol bodies)
- file: src/config/constants.ts
  why: Env-name-const JSDoc to fix+cross-ref: PRP_REASONING_AGENT (JSDoc@1543, const@1551),
        _BREAKDOWN_AGENT (JSDoc@1553, const@1560), _BUG_FINDER_AGENT (JSDoc@1562, const@1569),
        _VALIDATION_AGENT (JSDoc@1571, const@1578), _IMPL_AGENT (JSDoc@1580, const@1588). Getter JSDoc
        to cross-ref: getReasoningAgent (JSDoc@1656, fn@1674), getReasoningBreakdown (JSDoc@1682, fn@1701),
        getReasoningBugFinder (JSDoc@1709, fn@1728), getReasoningValidation (JSDoc@1736, fn@1755),
        getReasoningImpl (JSDoc@1763, fn@1783). resolveReasoningLevel JSDoc@1618 (fn@1637). ALL already
        cite §9.2.9; S4 ADDS one `.env.example` line each + fixes the 4 wrong getter names in the
        env-const @remarks.
  gotcha: Do NOT edit any `export const`/`export function` BODY — JSDoc comments only. The getter NAMES
        are getReasoningAgent/getReasoningBreakdown/getReasoningBugFinder/getReasoningValidation/
        getReasoningImpl (verified fn@1674/1701/1728/1755/1783). The env-const @remarks at L1557/1566/
        1575/1585 cite the WRONG names — those are the exact fix sites (grep-confirmed).

# PATTERN FILE 3 — the typed-error JSDoc cross-ref (READ; add one .env.example line)
- file: src/config/types.ts
  why: ReasoningConfigError class JSDoc@302 (class body@320; already cites §9.2.9 #4). Add one `.env.example`
        cross-reference line. Do NOT touch the class body (@320) or buildReasoningErrorMessage.

# VERIFIED FACTS
- fact: "S1 + S2 are LANDED. constants.ts Reasoning section L1500–end; types.ts ReasoningConfigError class@320.
        The 5 getters are getReasoningAgent/getReasoningBreakdown/getReasoningBugFinder/getReasoningValidation/
        getReasoningImpl (fn@1674/1701/1728/1755/1783; JSDoc@1656/1682/1709/1736/1763)."
- fact: "S1's env-name-const @remarks cite 4 non-existent getters: getReasoningBreakdownAgent (L1557),
        getReasoningBugFinderAgent (L1566), getReasoningValidationAgent (L1575), getReasoningImplAgent
        (L1585). getReasoningAgent (L1547) is correct."
- fact: ".env.example MODEL CONFIGURATION block = L39–66 (box title L40; content L42–66); ADVANCED
        CONFIGURATION box starts L68. Insert the Reasoning box between L66 and L68."
- fact: "prettier glob {ts,js,json,md,yml,yaml} + eslint --ext .ts + docs:check (docs/**/*.md) + docs:lint
        (docs/**/*.md) all EXCLUDE .env.example. So .env.example has NO automated gate — validate by manual
        review + grep. constants.ts/types.ts JSDoc edits DO get typecheck/lint/format:check (they're .ts)."
- fact: "eslint config = @typescript-eslint/recommended + pretter/recommended; NO eslint-plugin-jsdoc →
        broken {@link} refs are NOT enforced. The JSDoc fix is correctness, not gate-enforced."
```

### Current Codebase tree (relevant slice)

```bash
.env.example                  # EDIT — insert ONE # Reasoning Levels box (after MODEL CONFIGURATION, before ADVANCED)
src/config/constants.ts       # EDIT (JSDoc only) — fix 4 wrong getter names + add .env.example cross-refs
src/config/types.ts           # EDIT (JSDoc only) — add .env.example cross-ref to ReasoningConfigError
# src/agents/agent-factory.ts  READ-ONLY (S3 owns ThinkingLevel reconcile)
# docs/*.md                     READ-ONLY (M2.T1.S1/S2/S3 own changeset docs)
```

### Desired Codebase tree with files to be edited

```bash
.env.example                  # MODIFIED (additive: 1 new box between two existing boxes)
src/config/constants.ts       # MODIFIED (JSDoc comments only: 4 name fixes + ~11 .env.example cross-ref lines)
src/config/types.ts           # MODIFIED (JSDoc comments only: 1 .env.example cross-ref line)
# No other files. No agent-factory (S3), no .hack schema (T2), no docs/ (M2), no startup (T4), no tests.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# CRITICAL — .env.example is a DOC file. There are NO tests for it and NO automated gate scans it
#   (prettier/eslint/docs:check/docs:lint all exclude it — verified). Validate by MANUAL REVIEW against
#   §9.2.9 + a grep smoke check (5 vars + 6 levels present; NO uncommented PRP_REASONING_*= line).

# CRITICAL — every PRP_REASONING_* example line in the new box MUST be COMMENTED (# VAR=val). An
#   uncommented KEY=value would FORCE that value on every user who copies .env.example. The only
#   uncommented keys in the file today are values users MUST set (ZAI_API_KEY, PRP_MODEL_*). Reasoning
#   defaults apply when absent → comment them.

# CRITICAL — the 4 env-name-constant JSDoc getter cross-refs are WRONG (S1 bug): they cite
#   getReasoningBreakdownAgent/getReasoningBugFinderAgent/getReasoningValidationAgent/getReasoningImplAgent,
#   none of which exist. Fix to getReasoningBreakdown/getReasoningBugFinder/getReasoningValidation/
#   getReasoningImpl (the actual S2 getters, verified at constants.ts fn@1674/1701/1728/1755/1783).

# CRITICAL — JSDoc EDITS ONLY in constants.ts/types.ts. Do NOT touch any `export const`/`export function`
#   /`export class` BODY. No type/value/logic change. This keeps the change doc-only (no runtime diff,
#   no re-coverage, no test impact).

# GOTCHA — box title: ALL-CAPS + parenthetical to match siblings (MODEL CONFIGURATION; VALIDATION
#   CONFIGURATION (OPTIONAL)). Use `# REASONING LEVELS (PER-ROLE / PRD §9.2.9)`. The `# ===` underline
#   under MODEL CONFIGURATION (L41) is 80 `=`; match 80 for visual parity with that neighbor.

# GOTCHA — placement is BETWEEN two existing boxes, not a rename/merge. Keep the MODEL CONFIGURATION box
#   (L39–66) and ADVANCED CONFIGURATION box (L68+) intact; the new box is a third sibling between them.

# GOTCHA — eslint has NO jsdoc plugin, so a stale {@link} won't fail `npm run lint`. The fix is a
#   correctness/doc-quality improvement, not a gate requirement — but do it anyway (it's in the contract).

# GOTCHA — the .env.example box intro should mirror PRD §9.2.3's two-axes phrasing ("two independent
#   axes … tuning one never forces a compromise on the other … no longer drop model tier to disable
#   thinking") so the user-facing doc and the spec agree verbatim in spirit.

# GOTCHA — do NOT add a [reasoning] block to the repo ./.hack (integration-points.md §H lists it as a
#   SEPARATE optional discoverability item, not S4). One mention of `.hack [reasoning]` keys INSIDE the
#   .env.example box (for discoverability) is fine; editing ./.hack is not.

# GOTCHA — prettier DOES format src/**/*.ts (and ERROR-enforces prettier/prettier). Run `npm run fix`
#   after the constants.ts/types.ts JSDoc edits before format:check (JSDoc comment wrapping can shift).
```

---

## Implementation Blueprint

### Data models and structure
None — S4 is doc + JSDoc comments only. No types, values, or logic change.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT .env.example — insert the # Reasoning Levels box
  - INSERT a new box BETWEEN L66 (# ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5-turbo, last MODEL CONFIG line)
        and L68 (# === opening ADVANCED CONFIGURATION). Keep a blank line above and below the new box.
  - BOX TITLE: 80-char # === overline → `# REASONING LEVELS (PER-ROLE / PRD §9.2.9)` → 80-char # ===
        underline (mirror MODEL CONFIGURATION L39–41, which uses 80 = on L41).
  - INTRO (4–6 comment lines): the two-independent-axes note (mirror §9.2.3) + the 6 valid
        case-insensitive levels (off, minimal, low, medium, high, xhigh; xhigh is the max; no max) +
        `# See PRD §9.2.9.`.
  - 5 COMMENTED examples, each with a one-line role rationale + default:
        # PRP_REASONING_AGENT=high                         # research/PRP (default high)
        # PRP_REASONING_BREAKDOWN_AGENT=high               # task decomposition (default high)
        # PRP_REASONING_BUG_FINDER_AGENT=high              # bug finder (default high)
        # PRP_REASONING_VALIDATION_AGENT=high              # validation (default high)
        # PRP_REASONING_IMPL_AGENT=off                     # implementation/codegen (default OFF —
                                                          # codegen runs a full PRP contract; off is
                                                          # faster/cheaper & decouples from model tier)
    (Align comments to taste; the file mixes inline-trailing and standalone comment styles — match the
     nearest neighbor, MODEL CONFIGURATION, which uses standalone # rationale lines above uncommented
     values. Here all values are commented.)
  - SEMANTICS FOOTER (3–5 comment lines): empty/whitespace→default (falls back to the role default;
        never forwarded); invalid value→HARD startup error (exit 1; names the var + value + accepted
        levels; mirrors §9.2.7 fail-fast); optionally `# The same vars are configurable via the .hack
        # [reasoning] keys (§9.7.5); shell env / .env override .hack per §9.2.1.`
  - DO NOT: uncomment any PRP_REASONING_* line; touch any other box; edit ./.hack.
  - EXPECTED: no gate scans .env.example — validate by manual review + grep (Task 4).

Task 2: EDIT src/config/constants.ts — JSDoc only (fix 4 getter names + add .env.example cross-refs)
  - FIX the 4 env-name-const @remarks getter names:
        L1557 getReasoningBreakdownAgent() → getReasoningBreakdown()
        L1566 getReasoningBugFinderAgent() → getReasoningBugFinder()
        L1575 getReasoningValidationAgent() → getReasoningValidation()
        L1585 getReasoningImplAgent()       → getReasoningImpl()
        (L1547 getReasoningAgent() is already correct — leave it.)
  - ADD one .env.example cross-reference line to the @remarks of the 5 env-name consts (PRP_REASONING_*
        JSDoc@1543/1553/1562/1571/1580), the 5 getters (getReasoning* JSDoc@1656/1682/1709/1736/1763),
        and resolveReasoningLevel (JSDoc@1618). Phrasing e.g.:
          `Documented for users in the Reasoning Levels box of \`.env.example\` (see PRD §9.2.9).`
  - DO NOT edit any export const / export function BODY. JSDoc comments only.
  - EXPECTED: typecheck/lint/format:check clean (JSDoc is erased by tsc; eslint has no jsdoc plugin).

Task 3: EDIT src/config/types.ts — JSDoc only (ReasoningConfigError .env.example cross-ref)
  - ADD one .env.example cross-reference line to the ReasoningConfigError class JSDoc (JSDoc@302; already
        cites §9.2.9 #4). Same phrasing family as Task 2.
  - DO NOT edit the class body (L320–333) or buildReasoningErrorMessage (L335–345).
  - EXPECTED: typecheck/lint/format:check clean.

Task 4: FORMAT + VERIFY
  - RUN: npm run fix          # lint:fix + prettier --write — formats constants.ts/types.ts (NOT .env.example)
  - RUN: npm run typecheck && npm run lint && npm run format:check   # clean (covers the .ts JSDoc edits)
  - RUN: npm run docs:check   # regression-only (scans docs/**/*.md, NOT .env.example); expect clean
  - RUN (manual smoke checks for .env.example, since no gate scans it):
        grep -c 'PRP_REASONING_' .env.example            # expect 5
        grep -nE '^[^#]*PRP_REASONING_[A-Z_]+=' .env.example   # expect NO matches (all commented)
        grep -n 'Reasoning Levels' .env.example          # expect the new box title
        grep -n 'two independent axes' .env.example      # expect 1 (the two-axes note)
        awk '/MODEL CONFIGURATION/{m=NR} /ADVANCED CONFIGURATION/{a=NR} END{print m,a}' .env.example
        # then confirm the Reasoning box's line number is strictly between m and a.
  - EXPECTED: 5 commented PRP_REASONING_* lines; 0 uncommented; box title + two-axes note present;
        box sits between the MODEL CONFIGURATION and ADVANCED CONFIGURATION titles.
```

### Implementation Patterns & Key Details

```bash
# ---- .env.example: the new box (illustrative shape — match sibling style exactly) ----
# =============================================================================
# REASONING LEVELS (PER-ROLE / PRD §9.2.9)
# =============================================================================
# Per-role extended-thinking ("reasoning") budget. Which MODEL a role runs and
# how hard it REASONS are TWO INDEPENDENT axes (PRD §9.2.3 / §9.2.9): tuning one
# never forces a compromise on the other — you can run a strong model with
# reasoning off, or a fast model with reasoning on. You no longer drop model
# tier merely to disable thinking.
#
# Valid levels (case-insensitive): off, minimal, low, medium, high, xhigh
# (xhigh is the maximum; there is no `max`). See PRD §9.2.9.
#
# Defaults apply when a var is unset/blank; uncomment + set to override.

# Reasoning level for the research/PRP role (default high)
# PRP_REASONING_AGENT=high

# Reasoning level for task decomposition (default high)
# PRP_REASONING_BREAKDOWN_AGENT=high

# Reasoning level for the bug finder (default high)
# PRP_REASONING_BUG_FINDER_AGENT=high

# Reasoning level for validation (default high)
# PRP_REASONING_VALIDATION_AGENT=high

# Reasoning level for implementation/codegen (default OFF — codegen runs a full
# PRP contract; reasoning off is faster, cheaper, and decouples from model tier)
# PRP_REASONING_IMPL_AGENT=off

# Semantics: an empty/whitespace value falls back to the role default (never
# forwarded). An invalid value (e.g. PRP_REASONING_AGENT=ultra) is a HARD
# startup error (exit 1, naming the var, value, and accepted levels; PRD §9.2.7).
# The same vars are also configurable via .hack [reasoning] keys (§9.7.5); shell
# env / .env override .hack per §9.2.1.
```

```ts
// ---- constants.ts: the 4 getter-name fixes (JSDoc @remarks — no body change) ----
// PRP_REASONING_BREAKDOWN_AGENT @remarks (L1557):
//   BEFORE: read + validated via the S2 `getReasoningBreakdownAgent()` getter.
//   AFTER : read + validated via the S2 `getReasoningBreakdown()` getter.
//            + Documented for users in the Reasoning Levels box of `.env.example` (PRD §9.2.9).
// (analogous for BUG_FINDER→getReasoningBugFinder, VALIDATION→getReasoningValidation,
//  IMPL→getReasoningImpl; PRP_REASONING_AGENT already correct — just add the .env.example line.)

// ---- types.ts: ReasoningConfigError class JSDoc (@302) — add one line, no body change ----
//   + The user-facing config for these vars is documented in the Reasoning Levels box of
//     `.env.example` (PRD §9.2.9).
```

### Integration Points

```yaml
DEPENDS ON (must be LANDED):
  - P1.M1.T1.S1 (ReasoningLevel/REASONING_LEVELS/resolveReasoningLevel/ReasoningConfigError + 5 env-name
        consts + 5 defaults): LANDED — constants.ts L1500–1654, types.ts L293–345. S4 fixes S1's stale
        getter-name JSDoc + adds .env.example cross-refs.
  - P1.M1.T1.S2 (5 getters + validateAllReasoningLevels): LANDED — constants.ts getters JSDoc@1656–1798
        (validateAllReasoningLevels fn@1800). S4
        cross-references these (correcting S1's divergent names to S2's actual ones).

S3 (in progress, CONTRACT — do NOT touch): src/agents/agent-factory.ts → ThinkingLevel = ReasoningLevel.
  S4's .env.example box is consistent with S3's reconciled vocabulary (off/minimal/low/medium/high/xhigh).

DOWNSTREAM (S4 ENABLES / pairs with — separate subtasks, do NOT do them here):
  - P1.M2.T1.S1 (docs/CONFIGURATION.md): mirrors the same vars/levels/defaults/two-axes/empty/invalid
        content in the changeset docs. S4's .env.example wording is the reference S1 should match.
  - P1.M1.T2 (.hack [reasoning] schema): the `.hack` discoverability line inside S4's box points here.

NO RUNTIME INTEGRATION. S4 changes doc + JSDoc comments only — no symbol body, no consumer, no test.
  The repo ./.hack file is NOT edited (its [reasoning] block is a separate optional item, §H).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write — formats constants.ts + types.ts
                             # (.env.example is NOT in the prettier glob — its formatting is by convention)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean (JSDoc erased; no body change)
npm run lint                 # eslint . --ext .ts — clean (no jsdoc plugin; nothing to trip)
npm run format:check         # prettier --check — clean (covers the .ts JSDoc edits)
# Expected: clean. If prettier reformats a JSDoc comment (line-wrap), `npm run fix` already applied it.
# .env.example is NOT checked by any of the above — verify it manually (Task 4 grep smoke checks).
```

### Level 2: Unit Tests (Component Validation)

```bash
# N/A — S4 adds no tests. .env.example is a doc file (contract: "no tests for a doc file"); the JSDoc
# edits are comment-only (no runtime branch, no coverage delta). Do NOT add tests for doc content.
# (S1/S2 tests in tests/unit/config/constants.test.ts stay green — no symbol body changed.)
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A — S4 is doc + JSDoc comments only (no runtime behavior). Smoke-confirm the .env.example content
# (no automated gate scans it):
echo "--- 5 PRP_REASONING vars present (expect 5) ---"
grep -c 'PRP_REASONING_' .env.example
echo "--- any UNCOMMENTED PRP_REASONING_*= (expect NONE) ---"
grep -nE '^[^#]*PRP_REASONING_[A-Z_]+=' .env.example || echo "(none — good)"
echo "--- box title + two-axes note present ---"
grep -n 'REASONING LEVELS' .env.example
grep -n 'two independent axes' .env.example
echo "--- 6 levels listed ---"
grep -n 'off, minimal, low, medium, high, xhigh' .env.example
echo "--- box sits between MODEL CONFIGURATION and ADVANCED CONFIGURATION ---"
awk '/# MODEL CONFIGURATION/{m=NR} /# REASONING LEVELS/{r=NR} /# ADVANCED CONFIGURATION/{a=NR}
     END{printf "MODEL=%d REASONING=%d ADVANCED=%d  (need MODEL < REASONING < ADVANCED)\n", m, r, a}' .env.example
# Expected: 5 vars; 0 uncommented; title + two-axes note + 6-levels line present; MODEL < REASONING < ADVANCED.

# Regression: docs check (scans docs/**/*.md — NOT .env.example; confirms no docs breakage):
npm run docs:check
# Expected: clean (S4 changed no docs/ markdown; this is a regression gate).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — no MCP/DB/HTTP/CLI surface. Domain checks (record in commit msg):
#   - .env.example now documents the §9.2.9 reasoning surface for users (5 vars, 6 levels, defaults,
#     two-axes note, empty→default, invalid→hard-error), placed adjacent to MODEL CONFIGURATION.
#   - The 4 stale S1 getter-name JSDoc cross-refs are corrected to the S2 getters that actually exist.
#   - Every reasoning env-name const + getter + resolveReasoningLevel + ReasoningConfigError JSDoc now
#     cross-references BOTH §9.2.9 and .env.example.
#   - No runtime change (doc + JSDoc comments only); M2 changeset docs (docs/CONFIGURATION.md etc.) are
#     untouched (separate subtasks); agent-factory (S3), .hack schema (T2), startup (T4) untouched.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npm run docs:check` clean (regression-only — scans docs/**/*.md, not .env.example).
- [ ] `.env.example` smoke checks pass (5 vars; 0 uncommented; title + two-axes note + 6 levels;
      box between MODEL CONFIGURATION and ADVANCED CONFIGURATION).

### Feature Validation
- [ ] `.env.example` has a `# REASONING LEVELS (PER-ROLE / PRD §9.2.9)` box between MODEL CONFIGURATION
      and ADVANCED CONFIGURATION.
- [ ] Box carries: two-axes note; 6 valid case-insensitive levels; 5 commented `PRP_REASONING_*`
      examples with defaults high/high/high/high/**off**; empty→default; invalid→hard-error; §9.2.9 cite.
- [ ] All 5 `PRP_REASONING_*` example lines are commented (no uncommented `PRP_REASONING_*=`).
- [ ] No env-name-constant JSDoc cites a non-existent getter (4 fixed: Breakdown/BugFinder/Validation/Impl).
- [ ] Each reasoning env-name const + getter + `resolveReasoningLevel` + `ReasoningConfigError` JSDoc
      names both §9.2.9 AND `.env.example`.

### Code Quality Validation
- [ ] Only `.env.example` (1 new box) + `constants.ts`/`types.ts` (JSDoc comments only) are touched.
- [ ] No symbol BODY changed (no `export const`/`export function`/`export class` body edit) → no runtime
      diff, no coverage delta, no test impact.
- [ ] Box style matches siblings (ALL-CAPS title + parenthetical; 80-char `# ===` lines; commented
      examples; §9.2.9 cite).
- [ ] `agent-factory.ts` (S3), `.hack` schema (T2), `docs/*.md` (M2), startup path (T4), repo `./.hack`
      all UNCHANGED.

### Documentation & Deployment
- [ ] Mode A: the `.env.example` box IS the user-facing doc for the reasoning surface.
- [ ] Code-side JSDoc ↔ `.env.example` ↔ §9.2.9 cross-referenced both ways.
- [ ] Commit message notes: .env.example Reasoning Levels box added (§9.2.9); S1's 4 stale getter-name
      JSDoc cross-refs fixed to the S2 getters; JSDoc now cross-refs .env.example + §9.2.9; no runtime
      change; M2 docs / T2 schema / T4 startup are separate.

---

## Anti-Patterns to Avoid

- ❌ Don't uncomment any `PRP_REASONING_*=` line in `.env.example` — defaults apply when absent; an
      uncommented line would FORCE a value on every user who copies the template. Every example stays
      commented (`# PRP_REASONING_AGENT=high`).
- ❌ Don't place the box inside the MODEL CONFIGURATION box or merge it — it's a SIBLING box between
      MODEL CONFIGURATION and ADVANCED CONFIGURATION. Keep both existing boxes intact.
- ❌ Don't leave S1's 4 stale getter-name JSDoc refs (`getReasoningBreakdownAgent()` etc.) — they cite
      getters that don't exist. Fix to `getReasoningBreakdown()`/`BugFinder()`/`Validation()`/`Impl()`
      (the actual S2 getters). This is the "ensure getter/validator JSDoc" half of S4's contract.
- ❌ Don't edit any symbol BODY in constants.ts/types.ts — JSDoc comments ONLY. A body change would
      make this a code subtask (re-coverage, test risk) and breach Mode A doc-only scope.
- ❌ Don't rely on a gate to validate `.env.example` — prettier/eslint/docs:check/docs:lint ALL exclude
      it. Validate by manual review + the grep smoke checks in Task 4.
- ❌ Don't create/edit `docs/CONFIGURATION.md`, `docs/ARCHITECTURE.md`, or `README.md` — those are
      M2.T1.S1/S2/S3 (Mode B changeset docs). S4 is Mode A: the `.env.example` update IS the doc.
- ❌ Don't touch `src/agents/agent-factory.ts` (S3 owns the ThinkingLevel reconcile), the `.hack` schema
      (T2), the startup path (T4), or the repo `./.hack` file (its `[reasoning]` block is a separate
      optional item per integration-points.md §H — a one-line *mention* inside the .env.example box is
      fine; editing the file is not).
- ❌ Don't add tests for `.env.example` — the contract explicitly says "no tests for a doc file."
- ❌ Don't drop the two-axes note or the invalid→hard-error note from the box — both are required by the
      contract (§9.2.9) and are the load-bearing user-facing insights of the feature.
- ❌ Don't cite only §9.2.9 in code JSDoc OR only `.env.example` — the contract wants BOTH
      cross-references (spec anchor + user-facing doc).

---

## Confidence Score

**9/10** — one-pass implementation success likelihood.

Rationale: S4 is a doc + JSDoc-comment-only subtask with no runtime change. The `.env.example` insertion
point is pinned to the line (between MODEL CONFIGURATION L66 and ADVANCED CONFIGURATION L68), the box
style has an exact sibling twin to mirror (MODEL CONFIGURATION), and the required content is fully
specified from §9.2.9/§9.2.2/§9.2.3 (5 vars, 6 levels, defaults, two-axes note, empty→default,
invalid→hard-error). The JSDoc half is a 4-name fix (with line numbers + exact before/after) plus
additive `.env.example` cross-reference lines — comment-only, verified against S2's landed getter names.
The validation-gate subtlety — that NO automated tool scans `.env.example` (prettier/eslint/docs:check
all exclude it), so the box is validated by manual review + grep, while the `.ts` JSDoc edits DO get
typecheck/lint/format:check — is explicitly documented with concrete smoke-check commands. Residual
risks: (a) a cosmetic comment-alignment nit in the box (no gate enforces it — match the nearest
neighbor); (b) prettier re-wrapping a JSDoc line (auto-fixed by `npm run fix`). No external/runtime
unknowns; no symbol body is touched, so S1/S2 tests stay green and coverage is unaffected.