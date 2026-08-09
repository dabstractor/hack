# PRP — P1.M1.T4.S1: Sweep README.md for include-marker / dedup / stale-warning accuracy

> Bugfix `002_2b460dab1a1f`, **Mode-B final documentation sweep** for the Distributed-PRD Include Dedup
> bugfixes (BUG-001/002/003). README.md is prose documentation — no tests. The task is a **verification
> pass**: confirm README's Distributed-PRD / include / marker / stale-warning prose matches the **shipped
> post-fix behavior**, and make **minimal, accurate edits only where prose is now wrong or misleading**.
> The architecture analysis already concluded README is "already correct" — so the most likely outcome is
> **NO EDIT**, which is a valid, expected deliverable (not a failure). Contract DOCS: [Mode B] this
> subtask IS the README sweep.

---

## Goal

**Feature Goal**: Verify README.md's Distributed-PRD content (the `## Distributed (Multi-File) PRDs`
section + the Features bullet + the project-tree comment) is consistent with the shipped post-BUG-001/002/003
behavior, and correct any prose that is now wrong or misleading. Specifically verify three concerns:
**(a)** include-marker format examples match the emitted `@!include`/`@!end-include`/`@!include-ref`;
**(b)** any stale-include-warning mention is consistent with the post-BUG-002 **unconditional** stderr
behavior (including at the maxDepth depth gate); **(c)** any dedup description is consistent with the
post-BUG-003 **symlink-safe canonical** keying. **If README is already accurate, make NO edit and note
that in the work log.**

**Deliverable**:
1. **A completed verification pass** of README.md against the shipped behavior (the matrix in research §4).
2. **Either** (a) NO source edit — README verified accurate as-is, outcome documented in the work log; **or**
   (b) minimal, surgical prose corrections where verification found genuinely wrong/misleading text.
3. The outcome recorded in the work log / validation report (required by the contract whether or not an
   edit was made).

**Success Definition**:
- Every include-marker / stale-warning / dedup reference in README.md is verified against the actual
  shipped code in `src/core/session-utils.ts` (source lines cited in research §3) and is consistent.
- No fabricated features, no over-claiming, no scope creep into enhancement (the symlink-dedup note is a
  judgment call — default: do NOT add; see Why §5).
- If an edit was made: `npm run docs:check` passes, `npm run format:check` passes (run `npm run format`
  first if prettier flags the edit).
- If NO edit: `npm run docs:check` + `npm run format:check` still pass (README untouched → unchanged).
- The work log states the outcome explicitly ("verified accurate, no edit" OR "corrected X to match
  source L…").
- **No other files modified.** Only README.md is in scope (T4.S2 owns CONFIGURATION.md; T4.S3 owns
  ARCHITECTURE.md + CLI_REFERENCE.md). No source-code edits — those were T1.S1/T2.S1/T3.S1.

## User Persona

**Target User**: Developers/operators reading README to understand how Distributed (Multi-File) PRDs work
— specifically what `PRD_INCLUDE_MARKERS` emits, whether stale includes warn, and (if mentioned) how dedup
works.

**Use Case**: A user enables `PRD_INCLUDE_MARKERS` and wants to know the marker format to write an
external parser, or wants to confirm a typo'd include will be flagged.

**Pain Points Addressed**: Documentation drift — after BUG-001/002/003 fixes, prose must not promise a
marker format, warning behavior, or dedup semantics the code no longer matches.

## Why

- **Doc/code consistency after three behavior fixes.** BUG-001 corrected the `constants.ts` JSDoc to the
  `@!` markers; BUG-002 made the stale warning unconditional (incl. depth gate); BUG-003 made dedup
  symlink-safe (canonical key). README is the most user-facing doc surface for these features — a stale
  claim here misleads more readers than any in-code comment.
- **The architecture analysis already flagged README as "already correct" — but that conclusion must be
  re-verified against the LIVE README**, because line numbers drift and the parallel T3.S1 may have
  settled wording the snapshot predates. A verification pass converts "probably fine" into "verified
  accurate against source L560/L577/L589."
- **Scope discipline + minimal-edit philosophy.** The contract explicitly authorizes a NO-EDIT outcome.
  Over-editing README (adding dedup prose, rewriting the Features bullet) is enhancement, not the accuracy
  sweep this task is. The strong default is verify-and-confirm.

## What

### User-visible behavior
None — README.md is documentation. The deliverable is correctness of prose.

### Technical requirements (exact contract — verification + conditional edit)

**Step 1 — VERIFY (mandatory, regardless of outcome).** Re-read the LIVE README's three relevant regions
(grep, do NOT trust the L135/L145 line numbers — they may have drifted) and confirm each against the
shipped source-of-truth:

| README region | Verify against | Expected live text | Source-of-truth |
|--------------|----------------|--------------------|-----------------|
| `## Distributed (Multi-File) PRDs` marker example | emitted open marker | `<!-- @!include: path -->` (with the `@!`) | `src/core/session-utils.ts:560` — `<!-- @!include: ${token} -->` |
| "a stale include warns on stderr" | unconditional warning | present, with NO depth-gate carve-out | `src/core/session-utils.ts:589–590` `console.warn(...)`; post-BUG-002 unconditional |
| directive syntax `@path/to/file.md` | resolver token matching | accurate | resolver matches `@<token>` tokens |
| `PRD_INCLUDE_MAX_DEPTH` default `10` | constant | accurate | `DEFAULT_PRD_INCLUDE_MAX_DEPTH = 10` |
| dedup description | canonical keying | **(README has NO dedup description → nothing to reconcile)** | post-BUG-003 `dedupKey` (realpath) |

**Step 2 — DECIDE + EDIT (conditional).**
- **If all verified accurate (expected):** make NO edit. Proceed to Step 3.
- **If any prose is genuinely wrong/misleading** (e.g. an `@include:` missing the `!`, or a "no warning at
  max depth" carve-out): make the **minimal** correction:
  - Wrong marker → `<!-- @!include: path -->` / `@!end-include` / `@!include-ref` (match source L560/L577).
  - Wrong stale-warning carve-out → unconditional "a stale include warns on stderr" (remove any exception).
  - Wrong dedup wording → "canonical (realpath-resolved) absolute path" keying.
  Each correction is a prose micro-edit. Run `npm run format`, then `npm run format:check`.

**Step 3 — DOCUMENT the outcome** (mandatory). Record in the work log / validation report whether an edit
was made and exactly what was verified (research §8 has copy-ready wording).

### The optional symlink-dedup note (judgment call — default: do NOT add)
The architecture doc says "possibly note symlink-safe dedup." README's Distributed section describes
include resolution (directives, markers, depth, stale warning, fully-resolved semantics) but does NOT
describe dedup. Adding a dedup sentence is **enhancement, not correction** of wrong/misleading prose, and
the contract favors minimal/no edits. **Default: do NOT add.** The existing "a split PRD behaves
identically to a monolithic one" already conveys the user-facing guarantee; dedup is an implementation
detail. (If the implementer judges a brief clause reads naturally, the maximum acceptable addition is ONE
clause — but no edit is the preferred, contract-aligned outcome.)

### Success Criteria
- [ ] LIVE README re-read (grep, not line numbers); the marker example, stale-warning prose, directive
      syntax, and depth default each verified against the cited source lines.
- [ ] Marker example matches emitted `@!include` (open marker); no stray `@include:` without the `!`.
- [ ] Stale-warning prose has NO depth-gate carve-out (consistent with post-BUG-002 unconditional behavior).
- [ ] No dedup prose exists that contradicts post-BUG-003 canonical keying (README has none → satisfied).
- [ ] If an edit was made: it is minimal + accuracy-only (no enhancement/fabrication); `npm run format` ran;
      `npm run docs:check` + `npm run format:check` pass.
- [ ] If NO edit: `npm run docs:check` + `npm run format:check` pass (README unchanged).
- [ ] Work log states the outcome ("verified accurate, no edit" OR "corrected X to match source L…").
- [ ] Only README.md touched (T4.S2/T4.S3 own the other docs; no source-code edits).

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The verbatim
current README prose (all three regions), the verbatim shipped marker/warning/dedup behavior with exact
source line citations, the pre-built verification matrix (claim → source → verdict), the architecture
doc's own "already correct" conclusion, the decision rule for the optional dedup note (default: no edit),
the conditional-edit templates for each concern IF verification finds something wrong, the work-log
wording, and the verified validation commands are all below.

### Documentation & References
```yaml
# AUTHORITATIVE — the architecture doc's own documentation-surface analysis
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/architecture/system_context.md
  section: "Documentation Surface (for §5 doc-sync)" (L87-99)
  why: States "README.md:135,145 — already correct (@!include). Verify only; possibly note symlink-safe
        dedup." This is the architecture team's conclusion THIS task re-verifies against live code.
  critical: "Verify only" is the operative phrase — the expected outcome is confirmation, not rewrite.

# AUTHORITATIVE — the bug analysis (what each fix changed)
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/bugfix_findings.md   # provided in selected_prd_content
  section: h3.0 BUG-001 (markers), h3.1 BUG-002 (depth-gate stale warn), h3.2 BUG-003 (symlink dedup)
  why: Defines the post-fix behavior README must match: @! markers, unconditional stale stderr warning
        (incl. depth gate), canonical realpath dedup key.

# SOURCE-OF-TRUTH — the shipped behavior README is verified against
- file: src/core/session-utils.ts
  section: L560 (emits `<!-- @!include: ${token} -->\n${replacement}\n<!-- @!end-include -->`),
           L577 (emits `<!-- @!include-ref: ${token} -->`), L589-590 (stale console.warn → stderr)
  why: Byte-for-byte confirmation of the marker format + that the stale warning is emitted.
  gotcha: Do NOT edit this file (T1/T2/T3 owned it). Read-only verification source.

# EDIT TARGET — the file under sweep
- file: README.md
  section: "## Distributed (Multi-File) PRDs" (~L129-141); Features bullet (~L145); project-tree comment (~L815)
  why: Verify these regions; edit ONLY where genuinely wrong/misleading.
  gotcha: Line numbers may have drifted — locate regions by grep (e.g. `grep -n "@!include\|include directive\|stale include\|Distributed" README.md`), not by L135/L145.

# PARALLEL PREDECESSORS (read as CONTRACTS — their fixes define "shipped behavior")
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T1S1/PRP.md   # BUG-001: constants.ts JSDoc → @! markers (Complete)
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T2S1/PRP.md   # BUG-002: unconditional stale warn incl. depth gate (Complete)
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T3S1/PRP.md   # BUG-003: canonical realpath dedup key (Implementing)
  why: These define the post-fix behavior. README must match them.

# RESEARCH NOTE (this task) — verification matrix + decision rule + conditional-edit templates
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T4S1/research/readme-sweep.md
  section: "2. README current prose", "3. Shipped post-fix behavior", "4. Verification matrix",
           "5. The optional symlink-dedup note", "7. Defensive: what IF verification finds something wrong"
  why: The verbatim README regions, the source-line citations, the claim→verdict matrix, and the
        copy-ready correction text for each concern IF (unexpectedly) verification finds wrong prose.
```

### Current Codebase tree (edit surface)

```bash
README.md                              # VERIFY (sweep); EDIT ONLY where prose is wrong/misleading
  ├─ "## Distributed (Multi-File) PRDs" (~L129-141)  # marker example + stale-warning prose
  ├─ Features bullet (~L145)                          # "@include directives" shorthand (imprecise, not wrong)
  └─ project-tree comment (~L815)                     # "assembled from @includes" (fine)

src/core/session-utils.ts              # READ-ONLY — the source-of-truth to verify against (L560/L577/L589)
plan/.../architecture/system_context.md # READ-ONLY — §Documentation Surface: "README already correct"
```

### Desired Codebase tree with files to be changed
```bash
README.md                              # EDIT (conditional, minimal) OR no edit (verify-only — the expected outcome)
# (no other files; no source-code edits)
```

### Known Gotchas of our codebase & Library Quirks
```markdown
<!-- CRITICAL (no-edit is a VALID outcome): the architecture doc says README is "already correct" and the
     verification matrix confirms it. If verification finds nothing wrong, making a speculative edit is a
     FAILURE (it risks introducing inaccuracy). "Verified accurate, no edit" is the preferred deliverable. -->

<!-- CRITICAL (verify LIVE, not the snapshot): the L135/L145 line numbers are from the architecture
     snapshot and may have drifted. Locate README regions by grep (e.g. `grep -n "@!include\|include
     directive\|stale include\|Distributed (Multi-File)" README.md`), read the actual current prose, and
     verify THAT against source L560/L577/L589. -->

<!-- CRITICAL (the marker MUST keep the `!`): the emitted open marker is `<!-- @!include: ${token} -->`
     (source L560) — the `@!` prefix is the deliberate collision-proof technique (BUG-001). If README shows
     `@include:` WITHOUT the `!`, that is the ONE case that genuinely needs correcting. As of the snapshot
     README shows `@!include:` correctly. -->

<!-- GOTCHA (stale warning is now UNCONDITIONAL): post-BUG-002 the warning fires even at the maxDepth depth
     gate. README's "a stale include warns on stderr" is correct AS LONG AS it has no "except at max depth"
     carve-out. If such a carve-out exists in live README, remove it. -->

<!-- GOTCHA (dedup is not in README): README describes include RESOLUTION (directives/markers/depth/stale/
     fully-resolved) but NOT dedup. So concern (c) is vacuously satisfied — there is no dedup prose to make
     inconsistent. Do NOT add dedup prose as "correction"; that is enhancement. -->

<!-- GOTCHA (the optional symlink note): default to NOT adding it. The Distributed section's existing "a
     split PRD behaves identically to a monolithic one" already conveys the guarantee. Adding dedup detail
     is out of the accuracy-sweep scope. -->

<!-- GOTCHA (format): if an edit IS made, run `npm run format` (prettier writes) then `npm run format:check`
     — markdown is in the prettier glob. `npm run docs:check` (tsx scripts/check-docs.ts) is the
     docs-consistency gate. -->
```

## Implementation Blueprint

### Data models and structure
N/A — prose documentation. No code, no types, no tests.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY — re-read the LIVE README and confirm each concern against shipped source
  - LOCATE (grep, not line numbers): grep -n "@!include\|include directive\|stale include\|Distributed (Multi-File)\|@include" README.md
  - READ the current prose of: (a) the "## Distributed (Multi-File) PRDs" section; (b) the Features
        bullet mentioning Distributed PRDs; (c) the project-tree comment for spec/SPEC.md.
  - CONFIRM against source-of-truth:
    * marker example `<!-- @!include: path -->` === source L560 `<!-- @!include: ${token} -->` (open marker). ✅ if matches.
    * "a stale include warns on stderr" has NO depth-gate carve-out; source L589-590 emits it unconditionally post-BUG-002. ✅ if no carve-out.
    * directive syntax `@path/to/file.md`, depth default 10 — accurate. ✅ if matches.
    * dedup: README has NO dedup description → concern (c) vacuously satisfied. ✅ N/A.
  - Record the verdict per region (research §4 matrix is the template).

Task 2: DECIDE + EDIT (conditional — the expected outcome is NO edit)
  - IF all verified accurate (expected): make NO edit. Skip to Task 3.
  - IF a concern is genuinely wrong/misleading (unexpected), make the MINIMAL correction:
    * marker missing the `!` → `<!-- @!include: path -->` / `@!end-include` / `@!include-ref` (match L560/L577).
    * stale-warning carve-out → unconditional "a stale include warns on stderr" (remove the exception).
    * wrong dedup wording (if any dedup prose exists) → "canonical (realpath-resolved) absolute path".
  - OPTIONAL symlink-dedup note: DEFAULT do NOT add (enhancement, not correction; README has no dedup prose).
    If added, ONE clause max, must read naturally, must NOT over-claim.
  - DO NOT: rewrite the Features bullet's "@include directives" shorthand (imprecise, not wrong; body
        clarifies it); add new sections; touch any file other than README.md.

Task 3: VALIDATE + DOCUMENT the outcome
  - RUN: npm run docs:check  (must pass — README is in the docs-consistency scope)
  - IF an edit was made: npm run format  then  npm run format:check  (prettier; markdown is in the glob).
    IF no edit: npm run format:check (unchanged README must still pass).
  - DOCUMENT in the work log / validation report (research §8 wording):
    * "README.md verified against shipped include-marker / stale-warning / dedup behavior — [all accurate |
      <minimal corrections made with before/after + matching source line>]."
    * If NO edit: explicitly state "No edit required; README already matches post-BUG-001/002/003 shipped
      behavior (marker @!include, unconditional stale stderr warning, no dedup prose to reconcile)."
```

### Implementation Patterns & Key Details
```markdown
<!-- PATTERN: the verification (expected to confirm accuracy) -->
grep -n "@!include\|stale include\|Distributed (Multi-File)" README.md
# Expect to SEE: "Set `PRD_INCLUDE_MARKERS` to emit `<!-- @!include: path -->` markers; a stale include warns on stderr."
# Cross-check: src/core/session-utils.ts:560 → `<!-- @!include: ${token} -->`  ✅ matches.

<!-- PATTERN: the conditional correction (ONLY if a concern is wrong — NOT expected) -->
<!-- If README showed `<!-- @include: path -->` (no `!`), the minimal edit: -->
Set `PRD_INCLUDE_MARKERS` to emit `<!-- @!include: path -->` markers   <!-- add the `!` to match source L560 -->
<!-- If README had a depth-gate carve-out, the minimal edit: remove " (except when the depth limit is reached)" so the prose is unconditional, matching post-BUG-002. -->

<!-- GOTCHA: NO-EDIT is the expected, preferred outcome. The architecture doc says README is "already
     correct" and the verification matrix confirms it. Fabricating an edit to "have something to show" is a
     failure mode — it risks introducing inaccuracy into accurate prose. -->
```

### Integration Points
```yaml
DOCS-CONSISTENCY:
  - gate: "npm run docs:check" (tsx scripts/check-docs.ts) — MUST pass after any edit (and with no edit).
  - gate: "npm run format:check" (prettier --check, markdown in glob) — MUST pass; run `npm run format` if an edit flags.

WORK LOG (mandatory output):
  - record: the verification verdict per concern + whether an edit was made + (if so) before/after + source line.

SCOPE BOUNDARY:
  - in scope: README.md ONLY (Distributed-PRD section + Features bullet + project-tree comment).
  - out of scope: docs/CONFIGURATION.md (T4.S2), docs/ARCHITECTURE.md + docs/CLI_REFERENCE.md (T4.S3),
        any src/ file (T1/T2/T3), PRD.md, spec/**, **/tasks.json, prd_snapshot.md.
```

## Validation Loop

### Level 1: Read-Only Verification (the PRIMARY activity)
```bash
# Locate the LIVE README regions (do NOT trust L135/L145 line numbers).
grep -n "@!include\|include directive\|stale include\|Distributed (Multi-File)\|@include" README.md
# Confirm the marker example keeps the `!` and matches the emitted open marker:
grep -n "@!include" src/core/session-utils.ts   # L560 `<!-- @!include: ${token} -->`
# Confirm the stale warning is unconditional (no depth-gate carve-out in README prose; source L589-590 emits it).
# Expected: README marker example === `<!-- @!include: path -->`; stale prose has no carve-out; → all accurate.
```

### Level 2: Docs Consistency + Formatting Gates
```bash
npm run docs:check     # tsx scripts/check-docs.ts — docs-consistency check MUST pass
npm run format:check   # prettier --check (markdown in glob) — MUST pass
# IF an edit was made and format:check flags: run `npm run format` then re-run `npm run format:check`.
# IF no edit: both gates pass unchanged (README untouched).
# Expected: both GREEN.
```

### Level 3: Regression (System Validation)
```bash
# Confirm ONLY README.md is in the changeset (no source/docs files touched).
git status --porcelain | grep -E '^\s*[AM]\s+(README\.md)$' && echo "OK: README only" || echo "check scope"
git status --porcelain | grep -vE '^\s*[AM]?\s+README\.md$' | grep -E '\.(ts|md|json)$' \
  && echo "VIOLATION: out-of-scope file touched" || echo "OK: no out-of-scope file touched"
# Expected: "OK: README only" + "OK: no out-of-scope file touched".
```

### Level 4: Creative & Domain-Specific Validation
```bash
# (Optional) End-to-end proof the marker README documents matches what the resolver actually emits.
npx tsx -e "
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { resolvePRD } from './src/core/session-utils.js';
const t = mkdtempSync(join(tmpdir(), 'readme-sweep-'));
writeFileSync(join(t,'a.md'),'A'); writeFileSync(join(t,'main.md'),'@a.md');
const out = await resolvePRD(join(t,'main.md'), { markers: true } as any);
console.log(out);
" 2>/dev/null
# Expected output contains the `<!-- @!include: a.md -->` open marker — confirming README's `<!-- @!include: path -->` is accurate.
# (The stale-warning + dedup claims are covered by the T1/T2/T3 tests already; this is a marker spot-check only.)
```

## Final Validation Checklist

### Technical Validation
- [ ] LIVE README re-read via grep (not line numbers); all three regions located and read.
- [ ] Each concern verified against the cited source line (L560 markers / L589-590 stale warn / dedup N/A).
- [ ] `npm run docs:check` passes; `npm run format:check` passes (run `npm run format` first IF an edit flagged).

### Feature Validation
- [ ] Marker example matches emitted `@!include` (open marker); no stray `@include:` without the `!`.
- [ ] Stale-warning prose has no depth-gate carve-out (post-BUG-002 unconditional).
- [ ] No dedup prose contradicts post-BUG-003 canonical keying (README has none → satisfied).
- [ ] NO fabricated features / NO over-claiming / NO enhancement masquerading as correction.

### Code Quality Validation
- [ ] Either NO edit (verified accurate — the expected/preferred outcome) OR minimal accuracy-only edits.
- [ ] No scope creep into the Features-bullet rewrite, new dedup prose (unless the optional note, default no), or other docs files.
- [ ] Work log states the outcome explicitly (verified-no-edit OR corrected-X-to-match-source-L…).

### Documentation & Deployment
- [ ] README.md is the only file touched (T4.S2/T4.S3 own the other docs; T1/T2/T3 own src/).
- [ ] No source-code edits; no env-var/config changes.

---

## Anti-Patterns to Avoid
- ❌ Don't fabricate an edit to "have something to show" — the architecture doc says README is "already
  correct," and the verification matrix confirms it. **NO-EDIT is the preferred, expected outcome.**
  Inventing a rewrite risks introducing inaccuracy into accurate prose.
- ❌ Don't trust the L135/L145 line numbers — they're from the architecture snapshot and may have drifted.
  Locate README regions by `grep`, read the LIVE prose, and verify THAT.
- ❌ Don't drop the `!` from the marker — `@!include` is the deliberate collision-proof format (BUG-001).
  README must show `@!include:` (it already does). The only genuinely-wrong case would be `@include:` without the `!`.
- ❌ Don't add a depth-gate carve-out to the stale-warning prose — post-BUG-002 the warning is UNCONDITIONAL.
  README's "a stale include warns on stderr" is correct precisely because it has no carve-out.
- ❌ Don't add new dedup prose as "correction" — README has no dedup description; adding one is enhancement,
  not the accuracy sweep. The optional symlink note is a judgment call with a strong default of NO.
- ❌ Don't touch any file other than README.md — CONFIGURATION.md is T4.S2, ARCHITECTURE.md/CLI_REFERENCE.md
  are T4.S3, and all `src/` was T1/T2/T3.
- ❌ Don't skip the work-log documentation — the contract requires recording the outcome whether or not an
  edit was made (so the next reviewer knows README was verified, not forgotten).
- ❌ Don't run a code test suite looking for "README tests" — there are none; this is prose. The gates are
  `npm run docs:check` + `npm run format:check`.

---

## Confidence Score
**9.5 / 10** — one-pass success. This is a verification-pass doc sweep where the authoritative architecture
analysis already concluded README is "already correct" and the source-line verification confirms it
(marker `@!include` at source L560 matches README; unconditional stale warning at L589-590 matches README's
no-carve-out prose; no dedup prose exists to reconcile). The task's hardest part is recognizing that
**NO-EDIT is the correct deliverable**, not a sign of incomplete work — which this PRP makes explicit. The
only residual risk is a line-number drift that hides wrong prose the snapshot didn't catch; mitigated by
the grep-don't-trust-line-numbers instruction and the conditional-edit templates. Validation is two
commands (`docs:check` + `format:check`), both verified present in package.json.