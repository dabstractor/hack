# PRP — P1.M1.T4.S2: Sweep docs/CONFIGURATION.md for the PRD_INCLUDE_MARKERS / dedup rows

> Bugfix `002_2b460dab1a1f`, **Mode-B final documentation sweep** for the Distributed-PRD Include Dedup
> bugfixes (BUG-001/002/003, all Complete). docs/CONFIGURATION.md is prose documentation — no tests. The
> task is a **verification pass**: confirm the Distributed-PRD prose + the two env-var rows
> (`PRD_INCLUDE_MAX_DEPTH`, `PRD_INCLUDE_MARKERS`) match the **shipped post-fix behavior**, and make
> **minimal, accurate edits ONLY where prose is now wrong or misleading**. The architecture analysis and
> the live verification (research §3) both conclude CONFIGURATION.md is "already correct" — so the most
> likely outcome is **NO EDIT**, which is a valid, expected deliverable (not a failure). Contract DOCS:
> [Mode B] this subtask IS the CONFIGURATION.md sweep. Contract TEST: `npm run docs:check`.

---

## Goal

**Feature Goal**: Verify docs/CONFIGURATION.md's Distributed-PRD content (the `[distributed_prd]`
profile→env-var mapping row at L100, the "Control distributed / multi-file PRD assembly" blurb at L305,
the `PRD_INCLUDE_MAX_DEPTH` env-var row at L309, and the `PRD_INCLUDE_MARKERS` env-var row at L310) is
consistent with the shipped post-BUG-001/002/003 behavior, and correct any prose that is now wrong or
misleading. Specifically verify four concerns: **(a)** the marker-format examples in L310 match the
emitted `@!include` / `@!end-include`; **(b)** the stale-include-warning wording in L310 is consistent
with the post-BUG-002 **unconditional** stderr behavior (including at the maxDepth depth gate — no
carve-out); **(c)** any maxDepth row/blurb (L305 + L309) is accurate; **(d)** there is no dedup prose
that contradicts post-BUG-003 **symlink-safe canonical** keying (CONFIGURATION.md has none → vacuously
satisfied). **If CONFIGURATION.md is already accurate, make NO edit and note that in the work log.**

**Deliverable**:
1. **A completed verification pass** of docs/CONFIGURATION.md against the shipped behavior (the matrix
   in research §3).
2. **Either** (a) NO source edit — CONFIGURATION.md verified accurate as-is, outcome documented in the
   work log (the expected/primary outcome); **or** (b) a minimal, surgical prose correction where
   verification found genuinely wrong/misleading text (the only candidate is L305's "silent"; see §"The
   optional L305 edit").
3. The outcome recorded in the work log / validation report (required by the contract whether or not an
   edit was made).

**Success Definition**:
- The `[distributed_prd]` mapping row (L100), the Distributed-PRD blurb (L305), and both env-var rows
  (L309 maxDepth, L310 markers) are each verified against the actual shipped code in
  `src/core/session-utils.ts` (source lines cited in research §1) and are consistent.
- No fabricated features, no over-claiming, no scope creep into enhancement (adding dedup prose to a doc
  that currently has none is enhancement, not correction — default: do NOT add).
- If an edit was made: `npm run docs:check` passes, `npm run format:check` passes (run `npm run format`
  first if prettier flags the edit).
- If NO edit: `npm run docs:check` + `npm run format:check` still pass (file untouched → unchanged; both
  pass at baseline today).
- The work log states the outcome explicitly ("verified accurate, no edit" OR "corrected X to match
  source L…").
- **No other files modified.** Only docs/CONFIGURATION.md is in scope (T4.S1 owns README.md; T4.S3 owns
  ARCHITECTURE.md + CLI_REFERENCE.md). No source-code edits — those were T1.S1/T2.S1/T3.S1 (Complete).

## User Persona

**Target User**: Developers/operators reading docs/CONFIGURATION.md to configure the Distributed
(multi-file) PRD feature — specifically what `PRD_INCLUDE_MARKERS` emits, whether stale includes warn,
how deep includes nest, and (if present) how dedup works.

**Use Case**: A user sets `PRD_INCLUDE_MARKERS=true` and `PRD_INCLUDE_MAX_DEPTH=10` and reads this doc
to know the exact emitted marker format (e.g. to write an external parser) and to confirm a typo'd
include will be flagged on stderr.

**Pain Points Addressed**: Documentation drift — after BUG-001/002/003 fixes, prose must not promise a
marker format, warning behavior, or dedup semantics the code no longer matches.

## Why

- **Doc/code consistency after three behavior fixes.** BUG-001 made the code emit the collision-proof
  `@!` markers (and the constants.ts JSDoc was corrected in T1.S1); BUG-002 made the stale `.md` warning
  unconditional (incl. the maxDepth depth gate); BUG-003 made dedup symlink-safe (canonical realpath
  key). CONFIGURATION.md is the canonical env-var reference for operators — a stale claim here misleads
  anyone configuring the feature.
- **The architecture analysis + the live verification both conclude CONFIGURATION.md is "already
  correct" — but that conclusion MUST be re-verified against the LIVE file**, because line numbers drift
  and a verification pass converts "probably fine" into "verified accurate against source L593/L622."
- **Scope discipline + minimal-edit philosophy.** The contract explicitly authorizes a NO-EDIT outcome.
  Over-editing (adding dedup prose, rewriting the blurb) is enhancement, not the accuracy sweep this task
  is. The strong default is verify-and-confirm.

## What

### User-visible behavior
None — docs/CONFIGURATION.md is documentation. The deliverable is correctness of prose.

### Technical requirements (exact contract — verification + conditional edit)

**Step 1 — VERIFY (mandatory, regardless of outcome).** Re-read the LIVE CONFIGURATION.md's four
relevant regions (grep, do NOT trust the L100/L305/L309/L310 line numbers — they may have drifted) and
confirm each against the shipped source-of-truth:

| CONFIGURATION.md region | Verify against | Expected live text | Source-of-truth |
|-------------------------|----------------|--------------------|-----------------|
| `[distributed_prd]` mapping row (L100) | profile→env-var mapping | `include_max_depth`, `include_markers` → `PRD_INCLUDE_MAX_DEPTH`, `PRD_INCLUDE_MARKERS` | accurate mapping (no `dedup` knob — correct) |
| Distributed-PRD blurb (L305) | directive syntax + rules + depth | `@path/to/file.md` directive; boundary+existence; project-root-relative; cycle detection; depth limit `PRD_INCLUDE_MAX_DEPTH` | resolver logic; `DEFAULT_PRD_INCLUDE_MAX_DEPTH = 10` |
| `PRD_INCLUDE_MAX_DEPTH` row (L309) | default + fallback | default `10`; non-numeric/non-positive → fallback | `DEFAULT_PRD_INCLUDE_MAX_DEPTH = 10` |
| `PRD_INCLUDE_MARKERS` row (L310) — markers | emitted markers | `<!-- @!include: path -->` / `<!-- @!end-include -->` (with the `@!`) | `src/core/session-utils.ts:593` — `<!-- @!include: ${token} -->\n${replacement}\n<!-- @!end-include -->` |
| `PRD_INCLUDE_MARKERS` row (L310) — stale warn | unconditional stderr warning | "a `.md` token that fails to resolve (stale include) emits a stderr warning" — NO depth-gate carve-out | `src/core/session-utils.ts:622-623` `console.warn(...)`; L731 confirms depth-gate emits exactly one warning |
| dedup description | canonical keying | **(CONFIGURATION.md has NO dedup description → nothing to reconcile)** | post-BUG-003 `dedupKey` = `realpathSync` (L504-506) |

**Step 2 — DECIDE + EDIT (conditional).**
- **If all verified accurate (expected):** make NO edit. Proceed to Step 3.
- **If any prose is genuinely wrong/misleading:** make the **minimal** correction:
  - Markers row missing the `!` → `<!-- @!include: path -->` / `@!end-include` (match source L593).
  - Stale-warning carve-out in L310 → unconditional wording (remove any "except at max depth" exception).
  - L305 "silent" ambiguity (see §"The optional L305 edit" below — default: do NOT edit; L310 covers it).
  - Wrong maxDepth default → `10`.
  Each correction is a prose micro-edit. Run `npm run format`, then `npm run format:check`.

**Step 3 — DOCUMENT the outcome** (mandatory). Record in the work log / validation report whether an
edit was made and exactly what was verified (research §3 matrix; PRP §"Implementation Patterns" has
copy-ready wording).

### The optional L305 edit (judgment call — default: do NOT edit)

L305's EXISTENCE-clause parenthetical says "(directories and missing paths stay verbatim and **silent**)."
"Silent" there means **non-fatal control flow** (the resolver leaves the token verbatim and continues;
it does not abort) — NOT "no warning." L310 SEPARATELY and authoritatively documents that a missing
`.md` path emits a stderr warning (advisory; output stays verbatim either way). Read together the two
rows are consistent: missing `.md` → verbatim (output) + non-fatal (continues) + stderr warning
(advisory).

**Decision rule (NO-EDIT default):** Because L310 authoritatively and correctly states the stale
warning, L305's "silent" can stand as "non-fatal." The expected/preferred outcome is NO-EDIT. **Only
if** a careful read concludes "silent" GENUINELY misleads a reader into thinking missing `.md` paths
produce no warning should a minimal scope-narrowing edit be made (qualify "silent" to non-`.md` paths —
copy-ready text in §"Implementation Patterns"). Do NOT add dedup prose as "correction" — CONFIGURATION.md
has none; adding it is enhancement, not the accuracy sweep.

### Success Criteria
- [ ] LIVE CONFIGURATION.md re-read via grep (not line numbers); all four regions located and read.
- [ ] L100 `[distributed_prd]` mapping row verified accurate (no `dedup` knob — correct).
- [ ] L305 blurb verified: directive syntax, boundary/existence rules, project-root-relative, cycle
      detection, depth limit — all accurate.
- [ ] L309 `PRD_INCLUDE_MAX_DEPTH` row verified (default `10`, fallback on non-numeric/non-positive).
- [ ] L310 `PRD_INCLUDE_MARKERS` row verified: markers match `@!include`/`@!end-include` (source L593);
      stale-`.md` warning is UNCONDITIONAL (no depth-gate carve-out; source L622-623 + L731).
- [ ] No dedup prose contradicts post-BUG-003 canonical keying (CONFIGURATION.md has none → satisfied).
- [ ] If an edit was made: minimal + accuracy-only (no enhancement/fabrication); `npm run format` ran;
      `npm run docs:check` + `npm run format:check` pass.
- [ ] If NO edit: `npm run docs:check` + `npm run format:check` pass (file unchanged; both pass today).
- [ ] Work log states the outcome ("verified accurate, no edit" OR "corrected X to match source L…").
- [ ] Only docs/CONFIGURATION.md touched (T4.S1/T4.S3 own the other docs; no source-code edits).

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The verbatim
current CONFIGURATION.md prose (all four regions), the verbatim shipped marker/warning/dedup behavior
with exact LIVE source-line citations, the pre-built verification matrix (claim → source → verdict), the
decision rule for the one ambiguous word ("silent"), the conditional-edit templates for each concern IF
verification finds something wrong, the work-log wording, and the verified validation commands (incl. a
confirmed-passing docs:check baseline) are all below.

### Documentation & References
```yaml
# AUTHORITATIVE — the bug analysis (what each fix changed)
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/bugfix_findings.md   # provided in selected_prd_content
  section: h3.0 BUG-001 (markers), h3.1 BUG-002 (depth-gate stale warn), h3.2 BUG-003 (symlink dedup)
  why: Defines the post-fix behavior CONFIGURATION.md must match: @! markers, unconditional stale stderr
        warning (incl. depth gate), canonical realpath dedup key.

# SOURCE-OF-TRUTH — the shipped behavior CONFIGURATION.md is verified against
- file: src/core/session-utils.ts
  section: L593 (emits `<!-- @!include: ${token} -->\n${replacement}\n<!-- @!end-include -->`),
           L610 (emits `<!-- @!include-ref: ${token} -->`), L614-623 (emitStaleIncludeWarning →
           console.warn → stderr), L504-506 (dedupKey = realpathSync with lexical fallback),
           L731 (JSDoc: stale .md at maxDepth gate ALSO emits exactly one warning)
  why: Byte-for-byte confirmation of the marker format + that the stale warning is unconditional incl.
        the depth gate + that dedup is canonical-keyed.
  gotcha: Do NOT edit this file (T1/T2/T3 owned it). Read-only verification source.

# EDIT TARGET — the file under sweep
- file: docs/CONFIGURATION.md
  section: "[distributed_prd] mapping row" (~L100); "Control distributed / multi-file PRD assembly"
        blurb + env-var table (~L303-310, rows PRD_INCLUDE_MAX_DEPTH + PRD_INCLUDE_MARKERS)
  why: Verify these regions; edit ONLY where genuinely wrong/misleading.
  gotcha: Line numbers may have drifted — locate regions by grep
        (e.g. `grep -nE "@!?include|PRD_INCLUDE|distributed_prd|dedup|stale|stderr|maxDepth|max depth" docs/CONFIGURATION.md`),
        not by L100/L305/L309/L310.

# PARALLEL PREDECESSORS (read as CONTRACTS — their fixes define "shipped behavior")
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T1S1/PRP.md   # BUG-001: constants.ts JSDoc → @! markers (Complete)
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T2S1/PRP.md   # BUG-002: unconditional stale warn incl. depth gate (Complete)
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T3S1/PRP.md   # BUG-003: canonical realpath dedup key (Complete)
  why: These define the post-fix behavior. CONFIGURATION.md must match them.

# PARALLEL SIBLING (T4.S1 — README sweep; do NOT touch README)
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T4S1/PRP.md
  why: Same Mode-B verification-pass shape, different file. T4.S1 owns README.md; T4.S2 owns
        CONFIGURATION.md only. No file overlap.

# RESEARCH NOTE (this task) — verification matrix + decision rule + conditional-edit templates
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T4S2/research/configuration-sweep.md
  section: "1. Shipped post-fix behavior", "2. CONFIGURATION.md current prose", "3. Verification matrix",
        "4. The ONE judgment call (silent)", "5. Validation gates"
  why: The verbatim CONFIGURATION.md regions, the LIVE source-line citations, the claim→verdict matrix,
        and the copy-ready correction text for each concern IF (unexpectedly) verification finds wrong prose.
```

### Current Codebase tree (edit surface)

```bash
docs/CONFIGURATION.md                    # VERIFY (sweep); EDIT ONLY where prose is wrong/misleading
  ├─ "[distributed_prd]" mapping row (~L100)          # profile→env-var mapping (accurate)
  ├─ "Control distributed / multi-file PRD assembly" blurb (~L303-305)  # directive/rules/depth (accurate; "silent" ambiguous)
  ├─ PRD_INCLUDE_MAX_DEPTH env-var row (~L309)        # default 10 + fallback (accurate)
  └─ PRD_INCLUDE_MARKERS env-var row (~L310)          # @! markers + unconditional stale warn (CORRECT)

src/core/session-utils.ts                # READ-ONLY — the source-of-truth to verify against (L593/L610/L622/L504/L731)
```

### Desired Codebase tree with files to be changed
```bash
docs/CONFIGURATION.md                    # EDIT (conditional, minimal) OR no edit (verify-only — the expected outcome)
# (no other files; no source-code edits)
```

### Known Gotchas of our codebase & Library Quirks
```markdown
<!-- CRITICAL (no-edit is a VALID outcome): the architecture analysis + live verification both say
     CONFIGURATION.md is "already correct." If verification finds nothing wrong, making a speculative
     edit is a FAILURE (it risks introducing inaccuracy). "Verified accurate, no edit" is the preferred
     deliverable. -->

<!-- CRITICAL (verify LIVE, not the snapshot): the L100/L305/L309/L310 line numbers are from the
     architecture snapshot and may have drifted. Locate regions by grep
     (`grep -nE "@!?include|PRD_INCLUDE|distributed_prd|dedup|stale|stderr|maxDepth|max depth" docs/CONFIGURATION.md`),
     read the actual current prose, and verify THAT against source L593/L622/L731. -->

<!-- CRITICAL (the marker MUST keep the `!`): the emitted markers are `<!-- @!include: ${token} -->` /
     `<!-- @!end-include -->` (source L593) — the `@!` prefix is the deliberate collision-proof technique
     (BUG-001). If CONFIGURATION.md shows `@include:` WITHOUT the `!`, that is the ONE case that genuinely
     needs correcting. As of the snapshot CONFIGURATION.md:310 shows `@!include:` correctly. -->

<!-- GOTCHA (stale warning is now UNCONDITIONAL): post-BUG-002 the warning fires even at the maxDepth
     depth gate (source L731). CONFIGURATION.md:310 "a `.md` token that fails to resolve (stale include)
     emits a stderr warning" is correct AS LONG AS it has no "except at max depth" carve-out. If such a
     carve-out exists in live CONFIGURATION.md, remove it. -->

<!-- GOTCHA (the L305 "silent" ambiguity): L305 says missing paths "stay verbatim and silent." "silent"
     there = non-fatal control flow (continues), NOT "no warning." L310 authoritatively covers the stale
     warning. DEFAULT: do NOT edit L305. Only qualify "silent" to non-`.md` paths if a careful read
     concludes it genuinely misleads. -->

<!-- GOTCHA (dedup is not in CONFIGURATION.md): CONFIGURATION.md describes include RESOLUTION
     (directives/markers/depth/stale) but NOT dedup. So concern (d) is vacuously satisfied — there is no
     dedup prose to make inconsistent. Do NOT add dedup prose as "correction"; that is enhancement. -->

<!-- GOTCHA (format): if an edit IS made, run `npm run format` (prettier writes) then `npm run
     format:check` — markdown is in the prettier glob. `npm run docs:check` (tsx scripts/check-docs.ts,
     scans all docs/*.md) is the docs-consistency gate. Baseline docs:check PASSES today (5 passed). -->
```

## Implementation Blueprint

### Data models and structure
N/A — prose documentation. No code, no types, no tests.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY — re-read LIVE docs/CONFIGURATION.md and confirm each concern against shipped source
  - LOCATE (grep, not line numbers): grep -nE "@!?include|PRD_INCLUDE|distributed_prd|dedup|stale|stderr|maxDepth|max depth" docs/CONFIGURATION.md
  - READ the current prose of: (a) the [distributed_prd] mapping table row; (b) the "Control distributed
        / multi-file PRD assembly" blurb; (c) the PRD_INCLUDE_MAX_DEPTH env-var row; (d) the
        PRD_INCLUDE_MARKERS env-var row.
  - CONFIRM against source-of-truth:
    * [distributed_prd] row maps include_max_depth/include_markers → PRD_INCLUDE_MAX_DEPTH/PRD_INCLUDE_MARKERS (✅).
    * blurb: directive syntax @path/to/file.md, boundary+existence rules, project-root-relative, cycle
          detection, depth limit PRD_INCLUDE_MAX_DEPTH (✅).
    * PRD_INCLUDE_MAX_DEPTH default 10 + non-numeric/non-positive→fallback (✅).
    * PRD_INCLUDE_MARKERS markers `<!-- @!include: path -->` / `@!end-include` === source L593 (✅ if matches).
    * PRD_INCLUDE_MARKERS stale-`.md` → stderr warning, NO depth-gate carve-out; source L622-623 + L731
          emit it unconditionally post-BUG-002 (✅ if no carve-out).
    * dedup: CONFIGURATION.md has NO dedup description → concern (d) vacuously satisfied (✅ N/A).
  - Record the verdict per region (research §3 matrix is the template).

Task 2: DECIDE + EDIT (conditional — the expected outcome is NO edit)
  - IF all verified accurate (expected): make NO edit. Skip to Task 3.
  - IF a concern is genuinely wrong/misleading (unexpected), make the MINIMAL correction:
    * PRD_INCLUDE_MARKERS markers missing the `!` → `<!-- @!include: path -->` / `@!end-include` (match L593).
    * PRD_INCLUDE_MARKERS stale-warning carve-out → unconditional wording (remove the exception).
    * PRD_INCLUDE_MAX_DEPTH wrong default → `10`.
  - OPTIONAL L305 "silent" edit: DEFAULT do NOT edit (L310 authoritatively covers the warning; "silent" =
        non-fatal). Only if a careful read concludes "silent" genuinely misleads → qualify to non-`.md`
        paths (copy-ready text in "Implementation Patterns"). 
  - DO NOT: add new dedup prose (CONFIGURATION.md has none → adding it is enhancement); rewrite the blurb;
        touch any file other than docs/CONFIGURATION.md.

Task 3: VALIDATE + DOCUMENT the outcome
  - RUN: npm run docs:check  (must pass — CONFIGURATION.md is in the docs-consistency scope; baseline GREEN)
  - IF an edit was made: npm run format  then  npm run format:check  (prettier; markdown is in the glob).
    IF no edit: npm run format:check (unchanged file must still pass).
  - DOCUMENT in the work log / validation report (research §3 + PRP "Implementation Patterns" wording):
    * "docs/CONFIGURATION.md verified against shipped include-marker / stale-warning / dedup behavior —
      [all accurate | <minimal corrections made with before/after + matching source line>]."
    * If NO edit: explicitly state "No edit required; CONFIGURATION.md already matches post-BUG-001/002/003
      shipped behavior (marker @!include, unconditional stale stderr warning incl. depth gate, no dedup
      prose to reconcile)."
```

### Implementation Patterns & Key Details
```markdown
<!-- PATTERN: the verification (expected to confirm accuracy) -->
grep -nE "@!?include|PRD_INCLUDE|distributed_prd|dedup|stale|stderr|maxDepth|max depth" docs/CONFIGURATION.md
# Expect to SEE at L310: "...emits `<!-- @!include: path -->` / `<!-- @!end-include -->` markers around
# expanded includes; a `.md` token that fails to resolve (stale include) emits a stderr warning."
# Cross-check: src/core/session-utils.ts:593 → `<!-- @!include: ${token} -->\n${replacement}\n<!-- @!end-include -->`  ✅ matches.
# Cross-check: src/core/session-utils.ts:622-623 + L731 → stale .md warning unconditional incl. depth gate  ✅ matches.

<!-- PATTERN: the conditional corrections (ONLY if a concern is wrong — NOT expected) -->
<!-- If L310 markers were missing the `!`, the minimal edit: -->
...emits `<!-- @!include: path -->` / `<!-- @!end-include -->` markers...   <!-- add the `!` to match source L593 -->
<!-- If L310 had a depth-gate carve-out, the minimal edit: remove " (except when the depth limit is reached)" -->
<!-- so the prose is unconditional, matching post-BUG-002. -->
<!-- If L309 default were wrong, set it back to `10`. -->

<!-- PATTERN: the OPTIONAL L305 "silent" qualification (default: do NOT edit) -->
<!-- ONLY if a careful read concludes "silent" genuinely misleads about the .md stale warning: -->
<!-- BEFORE (L305): "…(directories and missing paths stay verbatim and silent)." -->
<!-- AFTER  (minimal scope-narrow to non-.md paths): "…(directories and non-`.md` missing paths stay verbatim and silent; a missing `.md` path warns on stderr — see PRD_INCLUDE_MARKERS)." -->
<!-- This is a JUDGMENT CALL. The DEFAULT is NO-EDIT: L310 already authoritatively documents the warning,
     and "silent" reads as "non-fatal control flow." Only edit if genuinely misleading. -->

<!-- GOTCHA: NO-EDIT is the expected, preferred outcome. The architecture doc + live verification say
     CONFIGURATION.md is "already correct." Fabricating an edit to "have something to show" is a failure
     mode — it risks introducing inaccuracy into accurate prose. -->
```

### Integration Points
```yaml
DOCS-CONSISTENCY:
  - gate: "npm run docs:check" (tsx scripts/check-docs.ts — scans all docs/*.md) — MUST pass after any
        edit (and with no edit). Baseline PASSES today (5 passed, 0 failed).
  - gate: "npm run format:check" (prettier --check, markdown in glob) — MUST pass; run `npm run format`
        if an edit flags.

WORK LOG (mandatory output):
  - record: the verification verdict per concern + whether an edit was made + (if so) before/after +
        matching source line.

SCOPE BOUNDARY:
  - in scope: docs/CONFIGURATION.md ONLY ([distributed_prd] row + blurb + the two env-var rows).
  - out of scope: README.md (T4.S1), docs/ARCHITECTURE.md + docs/CLI_REFERENCE.md (T4.S3), any src/ file
        (T1/T2/T3), PRD.md, spec/**, **/tasks.json, prd_snapshot.md.
```

## Validation Loop

### Level 1: Read-Only Verification (the PRIMARY activity)
```bash
# Locate the LIVE CONFIGURATION.md regions (do NOT trust L100/L305/L309/L310 line numbers).
grep -nE "@!?include|PRD_INCLUDE|distributed_prd|dedup|stale|stderr|maxDepth|max depth" docs/CONFIGURATION.md
# Confirm the L310 markers keep the `!` and match the emitted open/close markers:
grep -nE "@!include|@!end-include|@!include-ref" src/core/session-utils.ts   # L593/L610
# Confirm the L310 stale warning is unconditional (no depth-gate carve-out in the prose; source L622-623
# emits it, L731 confirms the depth gate also warns).
# Expected: CONFIGURATION.md markers === `<!-- @!include: path -->` / `@!end-include`; stale prose has no
# carve-out; maxDepth default 10; mapping row accurate; no dedup prose → all accurate.
```

### Level 2: Docs Consistency + Formatting Gates
```bash
npm run docs:check     # tsx scripts/check-docs.ts — docs-consistency check MUST pass
npm run format:check   # prettier --check (markdown in glob) — MUST pass
# IF an edit was made and format:check flags: run `npm run format` then re-run `npm run format:check`.
# IF no edit: both gates pass unchanged (file untouched).
# Expected: both GREEN. (docs:check baseline is GREEN today: 5 passed, 0 failed.)
```

### Level 3: Regression (System Validation)
```bash
# Confirm ONLY docs/CONFIGURATION.md is in the changeset (no source/other-docs files touched).
git status --porcelain | grep -E '^\s*[AM]\s+docs/CONFIGURATION\.md$' && echo "OK: CONFIGURATION only" || echo "(no edit — expected)"
git status --porcelain | grep -vE '^\s*[AM]?\s+docs/CONFIGURATION\.md$' | grep -E '\.(ts|md|json)$' \
  && echo "VIOLATION: out-of-scope file touched" || echo "OK: no out-of-scope file touched"
# Expected: "OK: CONFIGURATION only" (or "(no edit — expected)") + "OK: no out-of-scope file touched".
```

### Level 4: Creative & Domain-Specific Validation
```bash
# (Optional) End-to-end proof the markers CONFIGURATION.md documents match what the resolver emits.
npx tsx -e "
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { resolvePRD } from './src/core/session-utils.js';
const t = mkdtempSync(join(tmpdir(), 'cfg-sweep-'));
writeFileSync(join(t,'a.md'),'A'); writeFileSync(join(t,'main.md'),'@a.md');
const out = await resolvePRD(join(t,'main.md'), { markers: true } as any);
console.log(out);
" 2>/dev/null
# Expected output contains the `<!-- @!include: a.md -->` / `<!-- @!end-include -->` markers — confirming
# CONFIGURATION.md's documented `<!-- @!include: path -->` / `@!end-include` is accurate.
# (The stale-warning + dedup claims are covered by the T1/T2/T3 tests already; this is a marker spot-check.)
```

## Final Validation Checklist

### Technical Validation
- [ ] LIVE docs/CONFIGURATION.md re-read via grep (not line numbers); all four regions located and read.
- [ ] Each concern verified against the cited source line (L593 markers / L622-623 + L731 stale warn /
      L504 dedup N/A / maxDepth default 10).
- [ ] `npm run docs:check` passes; `npm run format:check` passes (run `npm run format` first IF an edit
      flagged).

### Feature Validation
- [ ] L100 `[distributed_prd]` mapping row verified accurate (no `dedup` knob — correct).
- [ ] L305 blurb verified (directive syntax, boundary/existence, project-root-relative, cycle detection,
      depth limit).
- [ ] L309 `PRD_INCLUDE_MAX_DEPTH` row verified (default `10`, fallback).
- [ ] L310 markers match emitted `@!include`/`@!end-include`; stale-`.md` warning UNCONDITIONAL (no
      depth-gate carve-out).
- [ ] No dedup prose contradicts post-BUG-003 canonical keying (CONFIGURATION.md has none → satisfied).
- [ ] NO fabricated features / NO over-claiming / NO enhancement masquerading as correction.

### Code Quality Validation
- [ ] Either NO edit (verified accurate — the expected/preferred outcome) OR minimal accuracy-only edits.
- [ ] No scope creep into new dedup prose (unless the optional L305 "silent" edit, default no), the blurb
      rewrite, or other docs files.
- [ ] Work log states the outcome explicitly (verified-no-edit OR corrected-X-to-match-source-L…).

### Documentation & Deployment
- [ ] docs/CONFIGURATION.md is the only file touched (T4.S1/T4.S3 own the other docs; T1/T2/T3 own src/).
- [ ] No source-code edits; no env-var/config changes.

---

## Anti-Patterns to Avoid
- ❌ Don't fabricate an edit to "have something to show" — the architecture analysis + live verification
  both say CONFIGURATION.md is "already correct." **NO-EDIT is the preferred, expected outcome.**
  Inventing a rewrite risks introducing inaccuracy into accurate prose.
- ❌ Don't trust the L100/L305/L309/L310 line numbers — they're from the architecture snapshot and may
  have drifted. Locate regions by `grep`, read the LIVE prose, and verify THAT.
- ❌ Don't drop the `!` from the markers — `@!include` / `@!end-include` is the deliberate collision-proof
  format (BUG-001). CONFIGURATION.md:310 must show `@!include:` (it already does). The only genuinely-
  wrong case would be `@include:` without the `!`.
- ❌ Don't add a depth-gate carve-out to the stale-warning prose — post-BUG-002 the warning is
  UNCONDITIONAL (incl. depth gate). CONFIGURATION.md:310's wording is correct precisely because it has no
  carve-out.
- ❌ Don't add new dedup prose as "correction" — CONFIGURATION.md has no dedup description; adding one is
  enhancement, not the accuracy sweep. The optional L305 "silent" qualification is a judgment call with a
  strong default of NO (L310 already authoritatively covers the warning).
- ❌ Don't touch any file other than docs/CONFIGURATION.md — README.md is T4.S1,
  ARCHITECTURE.md/CLI_REFERENCE.md are T4.S3, and all `src/` was T1/T2/T3.
- ❌ Don't skip the work-log documentation — the contract requires recording the outcome whether or not an
  edit was made (so the next reviewer knows CONFIGURATION.md was verified, not forgotten).
- ❌ Don't run a code test suite looking for "CONFIGURATION tests" — there are none; this is prose. The
  gates are `npm run docs:check` + `npm run format:check`.

---

## Confidence Score
**9.5 / 10** — one-pass success. This is a verification-pass doc sweep where the architecture analysis
AND the live grep both conclude CONFIGURATION.md is "already correct": L310 documents the `@!include`/
`@!end-include` markers (matches source L593) and the stale-`.md` stderr warning unconditionally (matches
source L622-623 + L731 incl. the depth gate); L309 documents maxDepth default 10; L100 maps the profile
keys accurately; and there is NO dedup prose to reconcile (concern d vacuously satisfied). The task's
hardest part is recognizing that **NO-EDIT is the correct deliverable**, not a sign of incomplete work —
which this PRP makes explicit. The one residual nuance — L305's ambiguous "silent" — is handled with a
clear decision rule (default: no edit; conditional minimal qualification only if genuinely misleading)
and copy-ready text. Validation is two commands (`docs:check` + `format:check`), both verified present in
package.json with a confirmed-passing docs:check baseline.