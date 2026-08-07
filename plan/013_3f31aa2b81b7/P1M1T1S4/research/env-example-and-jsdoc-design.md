# Research — P1.M1.T1.S4: `.env.example` Reasoning Levels subsection + getter/validator JSDoc cross-references

> PRD §9.2.9 (Per-Role Reasoning Level). S1 (LANDED) + S2 (LANDED) put the validated vocabulary +
> 5 per-role getters + `validateAllReasoningLevels` + `ReasoningConfigError` into `src/config/`.
> S3 (in progress, treated as contract) reconciles `agent-factory`'s `ThinkingLevel` alias.
> **S4 is the doc layer**: (a) a new `# Reasoning Levels (PRD §9.2.9)` box in `.env.example`,
> and (b) ensure the getter/validator/env-name-constant JSDoc cross-references §9.2.9 + `.env.example`
> and, while there, FIX the broken getter-name cross-references S1 left behind.

---

## 1. S1/S2 are LANDED — the exact symbols S4 cross-references

All verified present in-repo (constants.ts Reasoning section L1500–end, types.ts L293–345):

**constants.ts:**
- `type ReasoningLevel` (L1519): `'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`
- `const REASONING_LEVELS` (L1534): the 6 tokens, `as const`
- 5 env-name constants (L1551–1588): `PRP_REASONING_AGENT`, `PRP_REASONING_BREAKDOWN_AGENT`,
  `PRP_REASONING_BUG_FINDER_AGENT`, `PRP_REASONING_VALIDATION_AGENT`, `PRP_REASONING_IMPL_AGENT`
  (each `=== 'PRP_REASONING_…'`, i.e. the const is the env-var name).
- 5 defaults (L1593–1616): `DEFAULT_REASONING_AGENT='high'`, `_BREAKDOWN_='high'`,
  `_BUG_FINDER_='high'`, `_VALIDATION_='high'`, `_IMPL_='off'` (all `as const`).
- `resolveReasoningLevel(raw, envKey, defaultLevel)` (L1637–1654): undefined/empty/whitespace→default;
  valid case-insensitive→lowercased; invalid→throws `ReasoningConfigError`.
- 5 getters (L1662–1779): **`getReasoningAgent`**, **`getReasoningBreakdown`**,
  **`getReasoningBugFinder`**, **`getReasoningValidation`**, **`getReasoningImpl`** — one-liners
  over `resolveReasoningLevel(process.env[KEY], KEY, DEFAULT)`. ⚠️ See §3 for the naming gotcha.
- `validateAllReasoningLevels()` (L1790–1797): `: void`; calls all 5 getters (fail-fast; consumed by T4).

**types.ts:**
- `class ReasoningConfigError extends Error` (L320–333): `readonly key`, `readonly value`,
  `name = 'ReasoningConfigError'`, message via `buildReasoningErrorMessage`.
- `buildReasoningErrorMessage({ key, value })` (L335–345): actionable text naming key + value +
  the accepted list.

**S3 (contract, in progress):** `src/agents/agent-factory.ts` → `export type ThinkingLevel = ReasoningLevel;`.
S4 does NOT touch agent-factory (S3 owns it). S4 cross-references only constants.ts + types.ts symbols.

---

## 2. `.env.example` — structure, insertion point, comment style

**Current section boxes (grep-confirmed line numbers):**

| Lines | Box title |
|------|-----------|
| 8–10  | API AUTHENTICATION |
| 27–29 | API ENDPOINT |
| 39–66 | **MODEL CONFIGURATION** ← S4 inserts AFTER this block |
| 68–70 | ADVANCED CONFIGURATION |
| 75–77 | DISTRIBUTED / MULTI-FILE PRDs |
| 89–91 | CONCURRENCY CONFIGURATION |
| 98–100| RESEARCH CONFIGURATION (PARALLEL PRP RESEARCH) |
| 125–127 | VALIDATION CONFIGURATION (OPTIONAL) |
| 138–140 | BUG HUNT CONFIGURATION (OPTIONAL) |
| 147–149 | SECURITY NOTES |

**MODEL CONFIGURATION block ends at L66** (`# ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5-turbo`); L67 blank;
**ADVANCED CONFIGURATION `# ===` starts at L68**. → **S4 inserts the new box between L66 and L68**
(after the model block, before the next section — exactly as integration-points.md §H + the contract
require).

**Box-title convention (mirror exactly):** ALL CAPS + a parenthetical — e.g.
`VALIDATION CONFIGURATION (OPTIONAL)`, `BUG HUNT CONFIGURATION (OPTIONAL)`,
`RESEARCH CONFIGURATION (PARALLEL PRP RESEARCH)`. integration-points.md §H names the heading
`Reasoning Levels (PRD §9.2.9)` → render the box title as **`REASONING LEVELS (PER-ROLE / PRD §9.2.9)`**
(or `REASONING LEVELS (PRD §9.2.9)`) to match the sibling ALL-CAPS-with-parenthetical style while
keeping the §9.2.9 anchor. The `# ===` underline/overline uses **80 `=`** on the third line of the
MODEL CONFIGURATION box (L41) — match 80 (not 76) for visual consistency with that immediate neighbor.

**Inner comment style (mirror):**
- Prose rationale citing the PRD section up top (see MODEL CONFIGURATION intro L42–49;
  `RESEARCH CONFIGURATION` intro L101–102; `BUG HUNT CONFIGURATION` intro L141–144).
- **Commented-out examples** (`# VAR=value`) for discoverability — every example value is commented
  (`# RESEARCH_DEPTH=2`, `# VALIDATION_AGENT=pizr`, `# ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.2`).
  No uncommented `KEY=value` lines unless it's a value users MUST set (only `ZAI_API_KEY`,
  `PRP_MODEL_HIGH/BALANCED/FAST` are uncommented). → All 5 `PRP_REASONING_*` examples are **commented**
  (defaults apply when absent; users opt in to override).
- A `# See PRD §…` / `# (PRD §…)` citation is standard (L33, L42, L92, L101, L124, L131, L135, L142).

**No existing reasoning content** anywhere in `.env.example` (grep-confirmed) → S4 adds it fresh;
no duplication risk.

---

## 3. ⚠️ THE JSDoc getter-name bug S4 must fix (it's in S4's contract)

S1 wrote the env-name-constant JSDoc blocks *anticipating* S2's getters, but got 4 of the 5 names
WRONG. Verified in-repo: the env-name constants' `@remarks` cite getters that **do not exist**.

| Env-name const | JSDoc `@remarks` says (WRONG) | Actual getter (S2 LANDED) |
|----------------|-------------------------------|---------------------------|
| `PRP_REASONING_AGENT` (L1547) | `getReasoningAgent()` ✅ | `getReasoningAgent()` ✅ |
| `PRP_REASONING_BREAKDOWN_AGENT` (L1557) | `getReasoningBreakdownAgent()` ❌ | `getReasoningBreakdown()` |
| `PRP_REASONING_BUG_FINDER_AGENT` (L1566) | `getReasoningBugFinderAgent()` ❌ | `getReasoningBugFinder()` |
| `PRP_REASONING_VALIDATION_AGENT` (L1575) | `getReasoningValidationAgent()` ❌ | `getReasoningValidation()` |
| `PRP_REASONING_IMPL_AGENT` (L1585) | `getReasoningImplAgent()` ❌ | `getReasoningImpl()` |

This is squarely in S4's contract: "ensure getter/validator JSDoc (S1/S2) cross-reference §9.2.9 and
.env.example." The fix: correct the 4 wrong names to the real S2 getter names AND, per the contract,
add the `.env.example` cross-reference (e.g. each getter + each env-name const JSDoc names `.env.example`
as the user-facing doc for the var). The 5 getters' own JSDoc (L1656–1779) + `resolveReasoningLevel`
(L1619–1635) already cite §9.2.9; S4 confirms/strengthens the `.env.example` link on them too.

**Why this isn't "new behavior" requiring a PRD entry:** it is a doc-correctness fix to comments that
reference symbols that don't exist — an out-of-spec corrective fix (AGENTS.md rule 5), not a feature.

---

## 4. The exact contract content for the `.env.example` box

From the item description INPUT/LOGIC + PRD §9.2.9 + §9.2.2 "Reasoning Configuration" block:

The box MUST document:
1. **The 5 vars** as commented examples with the right defaults:
   - `# PRP_REASONING_AGENT=high` (research/PRP; default high)
   - `# PRP_REASONING_BREAKDOWN_AGENT=high` (task decomposition; default high)
   - `# PRP_REASONING_BUG_FINDER_AGENT=high` (bug finder; default high)
   - `# PRP_REASONING_VALIDATION_AGENT=high` (validation; default high)
   - `# PRP_REASONING_IMPL_AGENT=off` (implementation/codegen; default **off**)
2. **The 6 valid case-insensitive levels**: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`
   (`xhigh` is the max; there is no `max`).
3. **The two-independent-axes note** (the heart of §9.2.9): "model (tier) and reasoning are TWO
   INDEPENDENT axes — tuning one never forces a compromise on the other" (i.e. you can run a strong
   model with reasoning off, or a fast model with reasoning on; you no longer drop model tier to turn
   reasoning off).
4. **empty/whitespace→default** (unset or blank falls back to the role default; never forwarded).
5. **invalid→hard startup error** (exit 1, names the var + value + accepted levels; mirrors §9.2.7
   fail-fast).
6. Cross-ref: `See PRD §9.2.9`. (Also note the `.hack [reasoning]` keys are the file-config layer for
   the same vars — see §9.7.5 / T2 — one line, for discoverability.)

Suggested structure (mirror MODEL CONFIGURATION): 3-line `# ===` box title → 4–6-line intro prose
(the two-axes note + §9.2.9 cite + the 6 levels) → 5 commented `# PRP_REASONING_*=…` lines with a
one-line per-role rationale comment → a short "semantics" footer (empty→default, invalid→hard error).

---

## 5. Validation-gate facts (so the PRP's gates are accurate)

| Tool | Scans `.env.example`? | Scans `constants.ts` JSDoc? | Notes |
|------|-----------------------|-----------------------------|-------|
| `npm run format:check` (prettier) | ❌ (glob `{ts,js,json,md,yml,yaml}`) | ✅ (.ts) | prettier does NOT touch `.env.example`; its formatting is by convention only |
| `npm run lint` (eslint) | ❌ (eslint . --ext .ts) | ✅ (.ts) | config = `@typescript-eslint/recommended` + `prettier/recommended`; **no `eslint-plugin-jsdoc`** → broken `{@link}` refs are NOT enforced. The JSDoc fix is correctness, not a gate requirement |
| `npm run typecheck` (tsc) | ❌ | ✅ (.ts) | type-erases JSDoc; won't catch `{@link}` to a missing symbol |
| `npm run docs:check` (`scripts/check-docs.ts`) | ❌ (scans `docs/**/*.md` only) | ❌ | checks markdown files / internal links / terminology / code blocks / dates |
| `npm run docs:lint` (markdownlint) | ❌ (`docs/**/*.md`) | ❌ | markdown only |

**Consequence:** `.env.example` has **no automated gate** — S4 validates it by manual review against
§9.2.9 + a grep smoke check (the 5 vars + 6 levels present; no uncommented `PRP_REASONING_*=` line).
The `constants.ts` JSDoc edits DO get `typecheck`+`lint`+`format:check` (it's a .ts file) — run those
after editing. `docs:check` is run as a regression-only gate (it won't scan the changed files but
confirms docs/ stays consistent — relevant because docs/CONFIGURATION.md is the sibling M2.T1.S1).

---

## 6. Scope fences (do NOT do these)

- ❌ Do NOT create/edit `docs/CONFIGURATION.md`, `docs/ARCHITECTURE.md`, `README.md` → those are
  **M2.T1.S1/S2/S3** (Mode B changeset docs). S4 is Mode A: the `.env.example` update IS the doc.
- ❌ Do NOT touch `src/agents/agent-factory.ts` → S3 owns the `ThinkingLevel` reconcile (in progress).
- ❌ Do NOT modify any S1/S2 symbol *body* (types, values, getter logic). S4 only touches **JSDoc
  comments** in constants.ts/types.ts + the `.env.example` doc. No runtime change.
- ❌ Do NOT add the `.hack [reasoning]` schema → T2 owns it. (One discoverability line *mentioning*
  `[reasoning]` in `.env.example` is fine; the schema wiring is not.)
- ❌ Do NOT add a `[reasoning]` block to the repo `./.hack` file → that's noted in integration-points.md
  §H as a *separate* optional discoverability item, not part of S4's deliverable.
- ❌ Do NOT write unit tests for `.env.example` (it's a doc file; contract: "no tests for a doc file").

---

## 7. The two-axes wording — use PRD §9.2.9's own phrasing

PRD §9.2.3 + §9.2.9 state it crisply; mirror in the box intro so the .env.example and the PRD agree:
> "which model a role runs and how hard it reasons are two independent axes … Tuning one never forces
> a compromise on the other — a user no longer has to drop to a lower-tier model merely to turn
> reasoning off." (§9.2.3)

And the rationale for the impl `off` default:
> "codegen executes a complete PRP contract and needs no extended thinking, and this decouples
> reasoning from model choice." (§9.2.2)