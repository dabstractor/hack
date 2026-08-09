# Research — P1.M1.T4.S2: Sweep docs/CONFIGURATION.md for the PRD_INCLUDE_MARKERS / dedup rows

> Mode-B documentation verification pass for the Distributed-PRD Include Dedup bugfixes
> (BUG-001/002/003, all Complete). The task is a **verification sweep** of docs/CONFIGURATION.md:
> confirm the Distributed-PRD prose + the two env-var rows are consistent with the SHIPPED post-fix
> behavior, and make **minimal, accurate edits ONLY where prose is now wrong**. The expected outcome is
> **NO-EDIT** (CONFIGURATION.md is already correct) — which is a valid deliverable, not a failure.

## 1. The shipped post-fix behavior (source-of-truth — `src/core/session-utils.ts`, verified LIVE)

| Concern | Shipped behavior | Source line (LIVE) |
|---------|------------------|--------------------|
| Open marker | `<!-- @!include: ${token} -->` | L593 |
| Close marker | `<!-- @!end-include -->` | L593 |
| Elided-ref marker | `<!-- @!include-ref: ${token} -->` | L610 |
| Stale `.md` warning | `emitStaleIncludeWarning()` → `console.warn(...)` → stderr, **UNCONDITIONAL** | L614-623 |
| Depth-gate stale warning | "A stale `.md` at the `maxDepth` gate ALSO emits exactly one warning" | L731 (JSDoc) + neutralizeResolvableTokens L639 |
| Dedup key | `dedupKey(abs)` = `realpathSync(abs)` (canonical), lexical fallback | L504-506, applied L538/L560 |
| Depth default | `DEFAULT_PRD_INCLUDE_MAX_DEPTH = 10` | constants.ts (see CONFIGURATION.md L309) |

**Net:** BUG-001 (`@!` markers) ✅ shipped · BUG-002 (unconditional stale stderr warning incl. depth
gate) ✅ shipped · BUG-003 (canonical realpath dedup key) ✅ shipped.

## 2. CONFIGURATION.md current prose (the file under sweep — verified LIVE via grep)

**L100** — `[distributed_prd]` profile→env-var mapping table row:
> `| \`[distributed_prd]\` | \`include_max_depth\`, \`include_markers\` | \`PRD_INCLUDE_MAX_DEPTH\`, \`PRD_INCLUDE_MARKERS\` |`
Verdict: accurate. (No `dedup` key in the profile — dedup is unconditional/global, not a config knob, which is CORRECT.)

**L305** — Distributed-PRD paragraph (the "blurb"):
> "A PRD may be authored across multiple files … An `@path/to/file.md` token is an **include directive** …
> A token expands only when **both** (1) **boundary** … and (2) **existence** — the path resolves to an
> existing **file** (directories and missing paths stay verbatim and silent). Includes resolve
> **project-root-relative** … and expand recursively with cycle detection up to `PRD_INCLUDE_MAX_DEPTH`."
- Directive syntax, boundary/existence rules, project-root-relative, cycle detection, depth limit: all accurate.
- Does NOT mention dedup → vacuously satisfied (no dedup prose to reconcile).
- ⚠ ONE ambiguous word: "**silent**" — could be misread as "no warning," in tension with the `.md` stale warning (L310). See §4 judgment call.

**L309** — `PRD_INCLUDE_MAX_DEPTH` env-var row:
> "Max recursion depth for include expansion (PRD §2.3). Non-numeric or non-positive values fall back to the default." Default `10`.
Verdict: accurate (matches `DEFAULT_PRD_INCLUDE_MAX_DEPTH = 10`).

**L310** — `PRD_INCLUDE_MARKERS` env-var row (the row the work item calls out as "ALREADY correct"):
> "When set, resolved output emits `<!-- @!include: path -->` / `<!-- @!end-include -->` markers around
> expanded includes; a `.md` token that fails to resolve (stale include) emits a stderr warning."
- Markers `@!include` / `@!end-include` → match source L593 ✅
- Stale `.md` → stderr warning, stated UNCONDITIONALLY (no depth-gate carve-out) → matches post-BUG-002 ✅
Verdict: **CORRECT** (confirms the RESEARCH NOTE in the work item).

## 3. Verification matrix (claim → source → verdict)

| Region | Claim | Verify against | Verdict |
|--------|-------|----------------|---------|
| L100 profile row | include_max_depth/include_markers → env vars | mapping is accurate | ✅ correct |
| L305 directive syntax `@path/to/file.md` | resolver token matching | resolver matches `@<token>` | ✅ correct |
| L305 boundary+existence rules | expand rules | resolver logic | ✅ correct |
| L305 depth limit `PRD_INCLUDE_MAX_DEPTH` | constant = 10 | constants.ts | ✅ correct |
| L305 "verbatim and silent" | non-fatal control flow | resolver doesn't abort | ✅ correct (⚠ "silent" ambiguous — §4) |
| L309 maxDepth row | default 10 + fallback | constant | ✅ correct |
| L310 markers `@!include`/`@!end-include` | source L593 | byte-match | ✅ correct |
| L310 stale `.md` → stderr warning, unconditional | source L614-623 + L731 depth gate | unconditional, no carve-out | ✅ correct |
| dedup prose | (none — grep "dedup" empty) | canonical dedupKey L504-506 | ✅ N/A vacuous |

**Overall verdict: CONFIGURATION.md is ALREADY CORRECT. Expected deliverable = NO-EDIT + work-log note.**

## 4. The ONE judgment call — L305 "verbatim and silent" vs the `.md` stale warning

L305's parenthetical "(directories and missing paths stay verbatim and **silent**)" sits in the
EXISTENCE clause (when does a token expand vs stay verbatim?). "Silent" there means **non-fatal control
flow** — the resolver leaves the token verbatim and CONTINUES (does not abort/error). It does NOT mean
"no stderr warning." L310 SEPARATELY and authoritatively documents that a missing `.md` path emits a
stderr warning (advisory; output stays verbatim either way). Read together the two rows are consistent:
missing `.md` → verbatim (output) + non-fatal (continues) + stderr warning (advisory).

**Decision rule (NO-EDIT default):** Because L310 authoritatively and correctly states the stale
warning, L305's "silent" can stand as "non-fatal." The expected/preferred outcome is NO-EDIT.
**Only if** a careful read concludes "silent" GENUINELY misleads a reader into thinking missing `.md`
paths produce no warning should a minimal scope-narrowing edit be made — qualify "silent" to
non-`.md` paths. Copy-ready conditional fix in PRP §"Implementation Patterns."

## 5. Validation gates (verified)

- `npm run docs:check` = `tsx scripts/check-docs.ts` — scans all `docs/*.md` (incl. CONFIGURATION.md).
  **Baseline PASSES today** (5 passed, 0 failed) — confirmed before any edit.
- `npm run format:check` = `prettier --check "**/*.{ts,js,json,md,yml,yaml}"` — markdown is in the
  glob; if an edit is made, run `npm run format` first, then re-check.

## 6. Scope boundaries (what NOT to touch)

- In scope: docs/CONFIGURATION.md ONLY (L100 mapping row, L305 blurb, L309 maxDepth row, L310 markers row).
- Out of scope: README.md (T4.S1), docs/ARCHITECTURE.md + docs/CLI_REFERENCE.md (T4.S3), all `src/`
  (T1.S1/T2.S1/T3.S1 — Complete), PRD.md, spec/**, **/tasks.json, prd_snapshot.md.
- No source-code edits; no new env vars; no tests (prose doc — gate is docs:check, not vitest).