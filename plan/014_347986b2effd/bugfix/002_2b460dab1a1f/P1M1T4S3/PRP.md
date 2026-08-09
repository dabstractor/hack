# PRP — P1.M1.T4.S3: Sweep docs/ARCHITECTURE.md + docs/CLI_REFERENCE.md for include / marker / dedup references

> Bugfix `002_2b460dab1a1f`, **Mode-B final documentation sweep** (last subtask) for the Distributed-PRD
> Include Dedup bugfixes (BUG-001/002/003, all Complete). The target files are prose documentation — no
> tests. The task is a **verification pass**: confirm any Distributed-PRD include / marker / stale-warning
> / dedup references in `docs/ARCHITECTURE.md` and `docs/CLI_REFERENCE.md` match the **shipped post-fix
> behavior**, and make **minimal, accurate edits ONLY where prose is now wrong or misleading**. The
> architecture analysis + live verification (research §3) both conclude **BOTH files are already
> accurate** — so the expected outcome is **NO-EDIT** (a valid, required deliverable, not a failure).
> CLI_REFERENCE.md has ZERO relevant references (pure vacuous no-edit); ARCHITECTURE.md's one relevant
> section (the "Resolved-Document Invariant (Distributed PRDs)" blurb) already documents the
> `@!include`/`@!end-include` markers + unconditional stale stderr warning + maxDepth default 10.
> Contract DOCS: [Mode B] this subtask IS the ARCHITECTURE.md + CLI_REFERENCE.md sweep. Contract TEST:
> `npm run docs:check` (+ `npm run docs:lint`).

---

## Goal

**Feature Goal**: Verify docs/ARCHITECTURE.md's one relevant section (the "Resolved-Document Invariant
(Distributed PRDs)" blurb: directive intro L159, Expansion Rules L163-165, resolution/depth/idempotency
L168, markers+stale-warning L170, downstream-invariant bullets L172-183) and docs/CLI_REFERENCE.md (which
the grep proves has NO include/marker/include-dedup references) against the shipped post-BUG-001/002/003
behavior, and correct any prose that is now wrong or misleading. Specifically verify four concerns per
file: **(a)** emitted-marker examples match `@!include`/`@!end-include`/`@!include-ref` (keep the `!`); **(b)**
stale-include-warning wording is consistent with the post-BUG-002 **unconditional** stderr behavior (incl.
the maxDepth depth gate — no carve-out); **(c)** any maxDepth reference is accurate (default `10`); **(d)**
no dedup prose contradicts post-BUG-003 **symlink-safe canonical** keying (NEITHER file has dedup prose →
vacuously satisfied). Distinguish the **DIRECTIVE** syntax `@path/to/file.md` (UNCHANGED — do not touch)
from the **EMITTED MARKER** format `@!…` (the collision-proof `@!` prefix — the `!` MUST stay). **If both
files are already accurate, make NO edit and note that in the work log.**

**Deliverable**:
1. **A completed verification pass** of both files against the shipped behavior (the matrix in research §3).
2. **Either** (a) NO source edit — both files verified accurate as-is, outcome documented in the work log
   (the expected/primary outcome); **or** (b) a minimal, surgical prose correction where verification found
   genuinely wrong/misleading text (the only candidate is ARCHITECTURE.md L165's "silent" — see §"The
   optional L165 edit"; CLI_REFERENCE.md has nothing to correct).
3. The outcome recorded in the work log / validation report (required by the contract whether or not an
   edit was made), stated PER FILE.

**Success Definition**:
- ARCHITECTURE.md's relevant section (directive L159 / boundary L163 / existence L165 / resolution+depth
  L168 / markers+stale-warn L170 / downstream L172-183) is verified against the actual shipped code in
  `src/core/session-utils.ts` (source lines cited in research §1) and is consistent.
- CLI_REFERENCE.md is confirmed to have NO include/marker/include-dedup references (all grep hits are
  unrelated features — research §2b); vacuously satisfied.
- No fabricated features, no over-claiming, no scope creep into enhancement (adding dedup prose to a doc
  that currently has none is enhancement, not correction — default: do NOT add; ARCHITECTURE.md describes
  include RESOLUTION at the capability level, not the visited-set dedup MECHANISM).
- If an edit was made: `npm run docs:check` passes, `npm run format:check` passes (run `npm run format`
  first if prettier flags the edit), `npm run docs:lint` passes (run `npm run docs:lint:fix` if it flags
  the edit — but do NOT fix PRE-EXISTING lint issues outside your edit's scope).
- If NO edit: `npm run docs:check` + `npm run format:check` + `npm run docs:lint` still pass (files
  untouched → unchanged; docs:check + format:check pass at baseline today).
- The work log states the outcome explicitly, PER FILE ("verified accurate, no edit" OR "corrected X to
  match source L…").
- **No other files modified.** Only docs/ARCHITECTURE.md + docs/CLI_REFERENCE.md are in scope (T4.S1 owns
  README.md; T4.S2 owns CONFIGURATION.md). No source-code edits — those were T1.S1/T2.S1/T3.S1 (Complete).

## User Persona

**Target User**: Developers/architects reading docs/ARCHITECTURE.md to understand the Distributed
(multi-file) PRD assembly invariant (how `@path/to/file.md` directives resolve, what markers are emitted,
whether stale includes warn, how deep includes nest), and operators/devs reading docs/CLI_REFERENCE.md for
CLI command surface (where the include feature is NOT surfaced — it's config/env-driven, not a CLI flag).

**Use Case**: An architect sets `PRD_INCLUDE_MARKERS=true` and reads ARCHITECTURE.md's "Resolved-Document
Invariant" section to confirm the exact emitted marker format (e.g. to reason about downstream hashing
idempotency) and to know a typo'd include will be flagged on stderr. A CLI user greps CLI_REFERENCE.md for
an include flag and (correctly) finds none — the feature lives in CONFIGURATION.md.

**Pain Points Addressed**: Documentation drift — after BUG-001/002/003 fixes, prose must not promise a
marker format, warning behavior, or dedup semantics the code no longer matches.

## Why

- **Doc/code consistency after three behavior fixes.** BUG-001 made the resolver emit the collision-proof
  `@!` markers; BUG-002 made the stale `.md` warning unconditional (incl. the maxDepth depth gate);
  BUG-003 made dedup symlink-safe (canonical realpath key). ARCHITECTURE.md is the canonical capability
  framing for the resolved-document invariant; a stale claim here misleads anyone reasoning about the
  include pipeline or downstream hashing idempotency.
- **The architecture analysis + live grep both conclude BOTH files are "already accurate" — but that
  conclusion MUST be re-verified against the LIVE files**, because line numbers drift and a verification
  pass converts "probably fine" into "verified accurate against source L593/L621-627/L731." CLI_REFERENCE.md
  requires a positive confirmation that it has NO relevant content (not an assumption).
- **Scope discipline + minimal-edit philosophy.** The contract explicitly authorizes a NO-EDIT outcome.
  Over-editing (adding dedup prose, rewriting the invariant) is enhancement, not the accuracy sweep this
  task is. The strong default is verify-and-confirm.

## What

### User-visible behavior
None — both target files are documentation. The deliverable is correctness of prose.

### Technical requirements (exact contract — verification + conditional edit)

**Step 1 — VERIFY (mandatory, regardless of outcome).** Re-read the LIVE relevant regions of both files
(grep, do NOT trust line numbers — they drift) and confirm each against the shipped source-of-truth.

#### docs/ARCHITECTURE.md — one relevant section: "Resolved-Document Invariant (Distributed PRDs)"

| ARCHITECTURE.md region | Verify against | Expected live text | Source-of-truth |
|------------------------|----------------|--------------------|-----------------|
| Directive intro (L159) | directive syntax | `@path/to/file.md` token = include directive, replaced inline by file contents | directive UNCHANGED by all 3 fixes; `RESOLVE_TOKEN` |
| Boundary rule (L163) | `@` boundary | `@` at line-start or after non-path char; `foo@bar.com` literal | boundary logic unchanged |
| Existence rule (L165) | verbatim + "silent" | directories + missing paths "stay verbatim and silent" | resolver leaves non-file/non-resolving verbatim + continues; "silent" = non-fatal (L170 covers `.md` stderr warn) — **JUDGMENT CALL, default no-edit** |
| Resolution+depth (L168) | project-root-relative + recursive + cycle detection + depth + idempotent | project-root-relative; recursive w/ cycle detection; `PRD_INCLUDE_MAX_DEPTH` default `10`; idempotent | baseDir = entry dir; `DEFAULT_PRD_INCLUDE_MAX_DEPTH = 10`; visited set; `resolve(resolve(x))===resolve(x)` |
| Markers (L170) | emitted markers | `<!-- @!include: path -->` / `<!-- @!end-include -->` (with the `!`) | `src/core/session-utils.ts:593` |
| Stale warning (L170) | unconditional stderr warning | `.md` token that fails to resolve (stale include) emits warning on stderr — NO depth-gate carve-out | `src/core/session-utils.ts:621-627` (`emitStaleIncludeWarning`→`console.warn`→stderr); L731-732 confirms depth gate ALSO warns |
| dedup description | canonical keying | **(ARCHITECTURE.md has NO dedup prose → nothing to reconcile)** | post-BUG-003 `dedupKey` = `realpathSync` (L504-506) |
| Downstream bullets (L172-183) | resolved-document invariant | "fully-resolved, include-expanded document" framing | invariant accurate |

**False-positive grep hits in ARCHITECTURE.md (NOT the include feature — leave them):** L131
(`realpathSync` canonicalizes the git **root** — repo-root resolver `src/utils/repo-root.ts`, §9.8, NOT
BUG-003's include `dedupKey`); L957 ("eliding trailing levels" — commit position layer); L981
(`NO_ISSUES_FOUND.md` "stale marker" — bug-hunt clean-state file).

#### docs/CLI_REFERENCE.md — confirm ZERO relevant references

grep hits and verdict (research §2b): L204 stderr (status/task exit semantics — ✗), L266 dedup
(`.hack.local` **gitignore** dedup in `hack config set` — ✗ NOT include dedup), L271 stderr (config
validate — ✗), L405 "This includes" (prose — ✗), L697 stale (cached PRP content in `hack regenerate` — ✗).
**No `@include`/`@!include`/`PRD_INCLUDE`/`distributed_prd`/include-`visited` text exists.** → vacuously
satisfied.

**Step 2 — DECIDE + EDIT (conditional).**
- **If all verified accurate (expected):** make NO edit. Proceed to Step 3.
- **If any prose is genuinely wrong/misleading:** make the **minimal** correction:
  - Markers line missing the `!` → `<!-- @!include: path -->` / `@!end-include` (match source L593).
  - Stale-warning carve-out → unconditional wording (remove any "except at max depth" exception).
  - Wrong maxDepth default → `10`.
  Each correction is a prose micro-edit. Run `npm run format`, then `npm run format:check`; run
  `npm run docs:lint:fix` if `npm run docs:lint` flags the edit (do NOT fix pre-existing lint outside scope).

**Step 3 — DOCUMENT the outcome** (mandatory, PER FILE). Record in the work log / validation report
whether an edit was made and exactly what was verified (research §3 matrix; PRP §"Implementation Patterns"
has copy-ready wording). Per-file: ARCHITECTURE.md + CLI_REFERENCE.md.

### The optional L165 edit (judgment call — default: do NOT edit)

ARCHITECTURE.md L165's existence rule says "(directories and missing paths stay verbatim and **silent**)."
"Silent" there means **non-fatal control flow** (the resolver leaves the token verbatim and continues; it
does not abort) — NOT "no warning." L170 (two lines later) SEPARATELY and authoritatively documents that a
missing `.md` path emits a stderr warning (advisory; output stays verbatim either way). Read together the
two lines are consistent: missing `.md` → verbatim (output) + non-fatal (continues) + stderr warning
(advisory).

**Decision rule (NO-EDIT default):** Because L170 authoritatively and correctly states the stale warning,
L165's "silent" can stand as "non-fatal." The expected/preferred outcome is NO-EDIT — **identical to the
resolved CONFIGURATION.md L305 "silent" decision in T4.S2**. **Only if** a careful read concludes "silent"
GENUINELY misleads a reader into thinking missing `.md` paths produce no warning should a minimal
scope-narrowing edit be made (qualify "silent" to non-`.md` paths — copy-ready text in
§"Implementation Patterns"). Do NOT add dedup prose as "correction" — ARCHITECTURE.md has none; adding it
is enhancement, not the accuracy sweep.

### Success Criteria
- [ ] LIVE ARCHITECTURE.md re-read via grep (not line numbers); the "Resolved-Document Invariant" section
      located and read (directive / boundary / existence / resolution+depth / markers+stale / downstream).
- [ ] LIVE CLI_REFERENCE.md re-read via grep; confirmed ZERO include/marker/include-dedup references (all
      hits are unrelated features).
- [ ] ARCHITECTURE.md L170 markers verified: `@!include`/`@!end-include` match source L593 (keep the `!`).
- [ ] ARCHITECTURE.md L170 stale-`.md` warning verified UNCONDITIONAL (no depth-gate carve-out; source
      L621-627 + L731-732).
- [ ] ARCHITECTURE.md L168 maxDepth default verified (`10`); cycle-detection + idempotent verified (both
      still accurate post-BUG-003; idempotency preserved by all 3 fixes).
- [ ] No dedup prose contradicts post-BUG-003 canonical keying (NEITHER file has dedup prose → satisfied).
- [ ] If an edit was made: minimal + accuracy-only (no enhancement/fabrication); `npm run format` ran;
      `npm run docs:check` + `npm run format:check` + `npm run docs:lint` pass.
- [ ] If NO edit: `npm run docs:check` + `npm run format:check` + `npm run docs:lint` pass (files
      unchanged; docs:check + format:check pass today).
- [ ] Work log states the outcome PER FILE ("verified accurate, no edit" OR "corrected X to match source L…").
- [ ] Only docs/ARCHITECTURE.md + docs/CLI_REFERENCE.md touched (T4.S1/T4.S2 own the other docs; no
      source-code edits).

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The verbatim
current prose of both target files (the relevant ARCHITECTURE.md section + CLI_REFERENCE.md's confirmed
lack of relevant content), the verbatim shipped marker/warning/dedup behavior with exact LIVE source-line
citations, the pre-built verification matrix (claim → source → verdict) for both files, the decision rule
for the one ambiguous word ("silent", mirroring T4.S2), the conditional-edit templates IF verification
finds something wrong, the per-file work-log wording, and the verified validation commands (incl. a
confirmed-passing docs:check baseline) are all below.

### Documentation & References
```yaml
# AUTHORITATIVE — the bug analysis (what each fix changed)
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/architecture/bugfix_findings.md
  section: h3.0 BUG-001 (markers), h3.1 BUG-002 (depth-gate stale warn), h3.2 BUG-003 (symlink dedup)
  why: Defines the post-fix behavior both files must match: @! markers, unconditional stale stderr
        warning (incl. depth gate), canonical realpath dedup key.

# SOURCE-OF-TRUTH — the shipped behavior the docs are verified against
- file: src/core/session-utils.ts
  section: L593 (emits `<!-- @!include: ${token} -->\n${replacement}\n<!-- @!end-include -->`),
           L610 (emits `<!-- @!include-ref: ${token} -->`), L621-627 (emitStaleIncludeWarning →
           console.warn → stderr), L671 (depth gate ALSO warns), L504-506 (dedupKey = realpathSync with
           lexical fallback), L731-732 (JSDoc: stale .md at maxDepth gate ALSO emits exactly one warning)
  why: Byte-for-byte confirmation of the marker format + that the stale warning is unconditional incl.
        the depth gate + that dedup is canonical-keyed.
  gotcha: Do NOT edit this file (T1/T2/T3 owned it). Read-only verification source.

# EDIT TARGETS — the files under sweep
- file: docs/ARCHITECTURE.md
  section: "Resolved-Document Invariant (Distributed PRDs)" (~L157-183: directive intro, Expansion
        Rules [boundary/existence], resolution/depth/idempotency, markers+stale-warning, downstream bullets)
  why: Verify this section; edit ONLY where genuinely wrong/misleading (expected: none).
  gotcha: Line numbers may have drifted — locate the section by grep
        (`grep -nE "@!?include|@!?end-include|PRD_INCLUDE|distributed_prd|dedup|stale|stderr|maxDepth|max depth|cycle detection|idempotent" docs/ARCHITECTURE.md`),
        not by L157-183. ALSO: the L131 `realpathSync` (repo-root resolver), L957 "eliding" (commit layer),
        and L981 "stale marker" (bug-hunt NO_ISSUES_FOUND.md) are FALSE POSITIVES — different features; leave them.
- file: docs/CLI_REFERENCE.md
  section: (none expected) — confirm via grep there is NO include/marker/include-dedup reference.
  why: The include feature is config/env-driven (CONFIGURATION.md), not a CLI flag; CLI_REFERENCE.md is
        expected to have nothing. Verify that positively (don't assume).
  gotcha: grep hits at L204/L266/L271/L405/L697 are UNRELATED features (status stderr, .hack.local
        gitignore dedup, config-validate stderr, exit-code prose, regenerate-cache stale) — NOT include dedup.

# PARALLEL PREDECESSORS (read as CONTRACTS — their fixes define "shipped behavior")
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T1S1/PRP.md   # BUG-001: constants.ts JSDoc → @! markers (Complete)
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T2S1/PRP.md   # BUG-002: unconditional stale warn incl. depth gate (Complete)
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T3S1/PRP.md   # BUG-003: canonical realpath dedup key (Complete)
  why: These define the post-fix behavior. Both docs must match them.

# PARALLEL SIBLINGS (T4.S1 README sweep, T4.S2 CONFIGURATION sweep — do NOT touch those files)
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T4S1/PRP.md
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T4S2/PRP.md   # CONFIGURATION.md "silent" L305 decision = same shape as ARCHITECTURE.md L165 here
  why: Same Mode-B verification-pass shape, different files. No file overlap.

# RESEARCH NOTE (this task) — verification matrix + decision rule + conditional-edit templates
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T4S3/research/architecture-cli-sweep.md
  section: "1. Shipped post-fix behavior", "2. Current prose of the two target files",
        "3. Verification matrix", "4. The ONE judgment call (silent)", "5. Validation gates"
  why: The verbatim doc regions, the LIVE source-line citations, the claim→verdict matrix (per file),
        and the copy-ready correction text for each concern IF (unexpectedly) verification finds wrong prose.
```

### Current Codebase tree (edit surface)

```bash
docs/ARCHITECTURE.md                      # VERIFY (sweep); EDIT ONLY where prose is wrong/misleading
  ├─ "Resolved-Document Invariant (Distributed PRDs)" section (~L157-183)
  │   ├─ directive intro (~L159)              # @path/to/file.md directive (UNCHANGED — accurate)
  │   ├─ Expansion Rules: boundary (~L163)    # accurate
  │   ├─ Expansion Rules: existence (~L165)   # "silent" ambiguous (JUDGMENT CALL; default no-edit)
  │   ├─ resolution+depth (~L168)             # maxDepth 10 + cycle detection + idempotent (accurate)
  │   ├─ markers+stale-warn (~L170)           # @!include/@!end-include + UNCONDITIONAL stderr warn (CORRECT)
  │   └─ downstream bullets (~L172-183)       # resolved-document invariant (accurate)
  └─ FALSE-POSITIVE grep hits (L131 realpathSync=reporoot, L957 commit eliding, L981 bug-hunt marker) # leave

docs/CLI_REFERENCE.md                     # VERIFY (sweep); expected: NO relevant content → no edit
  └─ (grep hits L204/L266/L271/L405/L697 are UNRELATED features — leave)

src/core/session-utils.ts                 # READ-ONLY — the source-of-truth to verify against (L593/L610/L621-627/L671/L504-506/L731-732)
```

### Desired Codebase tree with files to be changed
```bash
docs/ARCHITECTURE.md                      # EDIT (conditional, minimal) OR no edit (verify-only — the expected outcome)
docs/CLI_REFERENCE.md                     # NO edit (no relevant content — expected)
# (no other files; no source-code edits)
```

### Known Gotchas of our codebase & Library Quirks
```markdown
<!-- CRITICAL (no-edit is a VALID outcome): the architecture analysis + live grep both say BOTH files are
     "already accurate." If verification finds nothing wrong, making a speculative edit is a FAILURE (it
     risks introducing inaccuracy). "Verified accurate, no edit" (per file) is the preferred deliverable. -->

<!-- CRITICAL (verify LIVE, not the snapshot): the L157-183 line numbers are from the architecture snapshot
     and may have drifted. Locate the section by grep, read the actual current prose, and verify THAT
     against source L593/L621-627/L731-732. -->

<!-- CRITICAL (the marker MUST keep the `!`): the emitted markers are `<!-- @!include: ${token} -->` /
     `<!-- @!end-include -->` (source L593) — the `@!` prefix is the deliberate collision-proof technique
     (BUG-001). If ARCHITECTURE.md shows `@include:` WITHOUT the `!`, that is the ONE case that genuinely
     needs correcting. As of the snapshot ARCHITECTURE.md:170 shows `@!include:` correctly. -->

<!-- CRITICAL (directive ≠ emitted marker): the DIRECTIVE `@path/to/file.md` (ARCHITECTURE.md L159) is
     UNCHANGED and correct — do NOT touch it. Only the EMITTED markers `@!include`/`@!end-include`/`@!include-ref`
     carry the `!`. Conflating the two is a classic sweep error. -->

<!-- GOTCHA (stale warning is now UNCONDITIONAL): post-BUG-002 the warning fires even at the maxDepth
     depth gate (source L731-732). ARCHITECTURE.md:170 "a `.md` token that fails to resolve (a stale
     include) emits a warning on stderr" is correct AS LONG AS it has no "except at max depth" carve-out.
     If such a carve-out exists in live ARCHITECTURE.md, remove it. -->

<!-- GOTCHA (the L165 "silent" ambiguity): L165 says missing paths "stay verbatim and silent." "silent"
     there = non-fatal control flow (continues), NOT "no warning." L170 authoritatively covers the stale
     warning. DEFAULT: do NOT edit L165 (same decision as CONFIGURATION.md L305 in T4.S2). Only qualify
     "silent" to non-`.md` paths if a careful read concludes it genuinely misleads. -->

<!-- GOTCHA (CLI_REFERENCE.md has nothing): the include feature is config/env-driven (CONFIGURATION.md),
     not a CLI flag. CLI_REFERENCE.md is EXPECTED to have zero relevant references. The grep hits at
     L204/L266/L271/L405/L697 are unrelated features (status stderr, .hack.local gitignore DEDUP [not
     include dedup], config-validate stderr, exit-code prose, regenerate-cache STALE). Verify the absence
     positively and document it; do NOT add include content to CLI_REFERENCE.md as "correction" — that is
     enhancement. -->

<!-- GOTCHA (dedup is in NEITHER doc): both ARCHITECTURE.md and CLI_REFERENCE.md describe include
     RESOLUTION at most, not the visited-set dedup MECHANISM. So concern (d) is vacuously satisfied in
     both. Do NOT add dedup prose as "correction"; that is enhancement. (The task's "key gotcha"
     hypothesized ARCHITECTURE.md might describe dedup — the live grep proves it does NOT.) -->

<!-- GOTCHA (ARCHITECTURE.md false-positive grep hits): L131 `realpathSync` (repo-root resolver,
     src/utils/repo-root.ts), L957 "eliding" (commit position layer), L981 "stale marker" (bug-hunt
     NO_ISSUES_FOUND.md) are DIFFERENT features. Leave them. Only the "Resolved-Document Invariant
     (Distributed PRDs)" section is in scope. -->

<!-- GOTCHA (format): if an edit IS made, run `npm run format` (prettier writes) then `npm run
     format:check` — markdown is in the prettier glob. `npm run docs:check` (tsx scripts/check-docs.ts)
     is the docs-consistency gate (baseline GREEN: 5 passed). `npm run docs:lint` (markdownlint) is a
     bonus gate per the task TEST contract — only fix lint issues YOUR edit introduced, not pre-existing
     ones outside scope. -->
```

## Implementation Blueprint

### Data models and structure
N/A — prose documentation. No code, no types, no tests.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY ARCHITECTURE.md — re-read LIVE "Resolved-Document Invariant" section + confirm each concern
  - LOCATE (grep, not line numbers): grep -nE "@!?include|@!?end-include|PRD_INCLUDE|distributed_prd|dedup|stale|stderr|maxDepth|max depth|cycle detection|idempotent" docs/ARCHITECTURE.md
  - READ the current prose of the "Resolved-Document Invariant (Distributed PRDs)" section: directive
        intro, Expansion Rules (boundary + existence), resolution/depth/idempotency, markers+stale-warning,
        downstream-invariant bullets.
  - CONFIRM against source-of-truth:
    * directive @path/to/file.md (L159) UNCHANGED — accurate (do NOT touch).
    * boundary rule (L163) — accurate.
    * existence rule (L165) "silent" — judgment call; default NO-EDIT (see Task 2 optional edit).
    * resolution (L168): project-root-relative, recursive, cycle detection, PRD_INCLUDE_MAX_DEPTH default 10,
          idempotent — all accurate (default 10 ✓; cycle detection ✓ [visited set still works post-BUG-003,
          canonical keying preserves real-file behavior]; idempotent preserved by all 3 fixes).
    * markers (L170) `<!-- @!include: path -->` / `@!end-include` === source L593 (✅ if matches — keep the `!`).
    * stale-warn (L170) `.md` fails to resolve → stderr warning, NO depth-gate carve-out; source L621-627 +
          L671 + L731-732 emit it unconditionally post-BUG-002 (✅ if no carve-out).
    * dedup: ARCHITECTURE.md has NO dedup prose → concern (d) vacuously satisfied (✅ N/A).
    * downstream bullets (L172-183): resolved-document invariant — accurate.
  - IGNORE false-positive grep hits: L131 realpathSync (repo-root resolver), L957 commit eliding, L981
        bug-hunt NO_ISSUES_FOUND.md marker — different features; leave them.
  - Record the verdict per region (research §3a matrix is the template).

Task 2: VERIFY CLI_REFERENCE.md — confirm ZERO relevant references
  - LOCATE (grep): grep -nE "@!?include|@!?end-include|@!?include-ref|PRD_INCLUDE|distributed_prd|dedup|stale|stderr|maxDepth|max depth" docs/CLI_REFERENCE.md
  - CLASSIFY each hit: L204 (status stderr — ✗), L266 (.hack.local gitignore dedup — ✗ NOT include dedup),
        L271 (config validate stderr — ✗), L405 ("This includes" prose — ✗), L697 (regenerate cache stale — ✗).
  - CONFIRM no @include/@!include/PRD_INCLUDE/distributed_prd/include-visited text exists → vacuously
        satisfied; nothing to verify or correct.
  - Record the verdict (research §3b matrix is the template).

Task 3: DECIDE + EDIT (conditional — the expected outcome is NO edit in BOTH files)
  - IF all verified accurate (expected): make NO edit. Skip to Task 4.
  - IF an ARCHITECTURE.md concern is genuinely wrong/misleading (unexpected), make the MINIMAL correction:
    * markers line missing the `!` → `<!-- @!include: path -->` / `@!end-include` (match L593).
    * stale-warning carve-out → unconditional wording (remove the exception).
    * wrong maxDepth default → `10`.
  - OPTIONAL ARCHITECTURE.md L165 "silent" edit: DEFAULT do NOT edit (L170 authoritatively covers the
        warning; "silent" = non-fatal — same as CONFIGURATION.md L305 in T4.S2). Only if a careful read
        concludes "silent" genuinely misleads → qualify to non-`.md` paths (copy-ready text in
        "Implementation Patterns").
  - CLI_REFERENCE.md: NEVER edit to ADD include content — it has none; adding it is enhancement.
  - DO NOT: add new dedup prose (NEITHER file has any → adding it is enhancement); rewrite the invariant
        section; touch any file other than docs/ARCHITECTURE.md / docs/CLI_REFERENCE.md.

Task 4: VALIDATE + DOCUMENT the outcome (PER FILE)
  - RUN: npm run docs:check  (must pass — both files in docs-consistency scope; baseline GREEN 5 passed).
  - IF an edit was made: npm run format  then  npm run format:check  (prettier; markdown in glob); also
        npm run docs:lint + (if it flags your edit) npm run docs:lint:fix (do NOT fix pre-existing lint
        outside scope).
    IF no edit: npm run format:check + npm run docs:lint (unchanged files must still pass; do NOT fix
        pre-existing lint issues you did not introduce).
  - DOCUMENT in the work log / validation report (research §3 + PRP "Implementation Patterns" wording), PER FILE:
    * ARCHITECTURE.md: "verified against shipped include-marker / stale-warning / dedup behavior —
      [all accurate | <minimal corrections made with before/after + matching source line>]."
    * CLI_REFERENCE.md: "verified — NO include/marker/include-dedup references present (all grep hits are
      unrelated features); nothing to correct."
    * If NO edit (expected): explicitly state "No edit required; [file] already matches post-BUG-001/002/003
      shipped behavior (marker @!include, unconditional stale stderr warning incl. depth gate, no dedup
      prose to reconcile)."
```

### Implementation Patterns & Key Details
```markdown
<!-- PATTERN: the verification (expected to confirm accuracy in BOTH files) -->
grep -nE "@!?include|@!?end-include|@!?include-ref|PRD_INCLUDE|distributed_prd|dedup|stale|stderr|maxDepth|max depth|cycle detection|idempotent" docs/ARCHITECTURE.md
# Expect ARCHITECTURE.md L170: "...emits `<!-- @!include: path -->` / `<!-- @!end-include -->` markers around
# expanded includes; a `.md` token that fails to resolve (a stale include) emits a warning on stderr."
# Cross-check: src/core/session-utils.ts:593 → `<!-- @!include: ${token} -->\n${replacement}\n<!-- @!end-include -->`  ✅ matches.
# Cross-check: src/core/session-utils.ts:621-627 + L671 + L731-732 → stale .md warning unconditional incl. depth gate  ✅ matches.

grep -nE "@!?include|@!?end-include|@!?include-ref|PRD_INCLUDE|distributed_prd|dedup|stale|stderr|maxDepth|max depth" docs/CLI_REFERENCE.md
# Expect: ZERO include/marker/include-dedup hits; only unrelated-feature hits (status stderr, .hack.local
# gitignore dedup, config-validate stderr, exit-code prose, regenerate-cache stale). ✅ vacuously satisfied.

<!-- PATTERN: the conditional corrections (ONLY if an ARCHITECTURE.md concern is wrong — NOT expected) -->
<!-- If L170 markers were missing the `!`, the minimal edit: -->
...emits `<!-- @!include: path -->` / `<!-- @!end-include -->` markers...   <!-- add the `!` to match source L593 -->
<!-- If L170 had a depth-gate carve-out, the minimal edit: remove " (except when the depth limit is reached)" -->
<!-- so the prose is unconditional, matching post-BUG-002. -->
<!-- If L168 default were wrong, set it back to `10`. -->

<!-- PATTERN: the OPTIONAL ARCHITECTURE.md L165 "silent" qualification (default: do NOT edit) -->
<!-- ONLY if a careful read concludes "silent" genuinely misleads about the .md stale warning: -->
<!-- BEFORE (L165): "…(directories and missing paths stay verbatim and silent)." -->
<!-- AFTER  (minimal scope-narrow to non-.md paths): "…(directories and non-`.md` missing paths stay verbatim and silent; a missing `.md` path warns on stderr — see the PRD_INCLUDE_MARKERS line below)." -->
<!-- This is a JUDGMENT CALL. The DEFAULT is NO-EDIT: L170 already authoritatively documents the warning,
     and "silent" reads as "non-fatal control flow." Only edit if genuinely misleading. -->

<!-- GOTCHA: NO-EDIT is the expected, preferred outcome for BOTH files. The architecture doc + live grep
     say both are "already accurate" (ARCHITECTURE.md) or have "no relevant content" (CLI_REFERENCE.md).
     Fabricating an edit to "have something to show" is a failure mode — it risks introducing inaccuracy
     into accurate prose (ARCHITECTURE.md) or inventing content where none belongs (CLI_REFERENCE.md). -->
```

### Integration Points
```yaml
DOCS-CONSISTENCY:
  - gate: "npm run docs:check" (tsx scripts/check-docs.ts — scans all docs/*.md) — MUST pass after any
        edit (and with no edit). Baseline PASSES today (5 passed, 0 failed).
  - gate: "npm run docs:lint" (markdownlint "docs/**/*.md") — bonus gate per task TEST contract. If no
        edit: it must not regress (don't introduce lint issues); do NOT fix pre-existing issues outside
        scope. If an edit flags: run `npm run docs:lint:fix` for your edit only.
  - gate: "npm run format:check" (prettier --check, markdown in glob) — MUST pass; run `npm run format`
        if an edit flags.

WORK LOG (mandatory output, PER FILE):
  - record ARCHITECTURE.md: the verification verdict per concern + whether an edit was made + (if so)
        before/after + matching source line.
  - record CLI_REFERENCE.md: the positive confirmation of zero relevant references + "nothing to correct."

SCOPE BOUNDARY:
  - in scope: docs/ARCHITECTURE.md + docs/CLI_REFERENCE.md ONLY.
  - out of scope: README.md (T4.S1), docs/CONFIGURATION.md (T4.S2), any src/ file (T1/T2/T3), PRD.md,
        spec/**, **/tasks.json, prd_snapshot.md, all other docs files (user-guide.md, INSTALLATION.md,
        TESTING.md, WORKFLOWS.md, CUSTOM_*.md, GROUNDSWELL_GUIDE.md).
```

## Validation Loop

### Level 1: Read-Only Verification (the PRIMARY activity)
```bash
# Locate the LIVE ARCHITECTURE.md section (do NOT trust L157-183 line numbers).
grep -nE "@!?include|@!?end-include|PRD_INCLUDE|distributed_prd|dedup|stale|stderr|maxDepth|max depth|cycle detection|idempotent" docs/ARCHITECTURE.md
# Confirm the L170 markers keep the `!` and match the emitted open/close markers:
grep -nE "@!include|@!end-include|@!include-ref" src/core/session-utils.ts   # L593/L610
# Confirm the L170 stale warning is unconditional (no depth-gate carve-out in the prose; source L621-627
# emits it, L671 + L731-732 confirm the depth gate also warns).
# Expected ARCHITECTURE.md: markers === `<!-- @!include: path -->` / `@!end-include`; stale prose has no
# carve-out; maxDepth default 10; directive @path/to/file.md unchanged; no dedup prose → all accurate.

# Confirm CLI_REFERENCE.md has ZERO relevant references (all hits unrelated).
grep -nE "@!?include|@!?end-include|@!?include-ref|PRD_INCLUDE|distributed_prd|dedup|stale|stderr|maxDepth|max depth" docs/CLI_REFERENCE.md
# Expected: no @include/@!include/PRD_INCLUDE/distributed_prd text; only unrelated-feature hits.
```

### Level 2: Docs Consistency + Lint + Formatting Gates
```bash
npm run docs:check     # tsx scripts/check-docs.ts — docs-consistency check MUST pass (baseline GREEN 5 passed)
npm run docs:lint      # markdownlint docs/**/*.md — bonus gate; don't regress; fix only your edit's issues
npm run format:check   # prettier --check (markdown in glob) — MUST pass
# IF an edit was made and format:check flags: run `npm run format` then re-run `npm run format:check`.
# IF docs:lint flags your edit: run `npm run docs:lint:fix` (do NOT fix pre-existing issues outside scope).
# IF no edit: all gates pass unchanged (files untouched).
# Expected: all GREEN.
```

### Level 3: Regression (System Validation)
```bash
# Confirm ONLY docs/ARCHITECTURE.md and/or docs/CLI_REFERENCE.md are in the changeset (no source/other-docs).
git status --porcelain | grep -E '^\s*[AM]\s+docs/(ARCHITECTURE|CLI_REFERENCE)\.md$' && echo "OK: in-scope doc(s) only" || echo "(no edit — expected)"
git status --porcelain | grep -vE '^\s*[AM]?\s+docs/(ARCHITECTURE|CLI_REFERENCE)\.md$' | grep -E '\.(ts|md|json)$' \
  && echo "VIOLATION: out-of-scope file touched" || echo "OK: no out-of-scope file touched"
# Expected: "OK: in-scope doc(s) only" (or "(no edit — expected)") + "OK: no out-of-scope file touched".
```

### Level 4: Creative & Domain-Specific Validation
```bash
# (Optional) End-to-end proof the markers ARCHITECTURE.md documents match what the resolver emits.
npx tsx -e "
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { resolvePRD } from './src/core/session-utils.js';
const t = mkdtempSync(join(tmpdir(), 'arch-sweep-'));
writeFileSync(join(t,'a.md'),'A'); writeFileSync(join(t,'main.md'),'@a.md');
const out = await resolvePRD(join(t,'main.md'), { markers: true } as any);
console.log(out);
" 2>/dev/null
# Expected output contains the `<!-- @!include: a.md -->` / `<!-- @!end-include -->` markers — confirming
# ARCHITECTURE.md's documented `<!-- @!include: path -->` / `@!end-include` is accurate.
# (CLI_REFERENCE.md has no include content to spot-check; the stale-warning + dedup claims are covered by
# the T1/T2/T3 tests already; this is a marker spot-check for ARCHITECTURE.md.)
```

## Final Validation Checklist

### Technical Validation
- [ ] LIVE docs/ARCHITECTURE.md "Resolved-Document Invariant" section re-read via grep (not line numbers).
- [ ] LIVE docs/CLI_REFERENCE.md re-read via grep; zero relevant references positively confirmed.
- [ ] Each ARCHITECTURE.md concern verified against the cited source line (L593 markers / L621-627+L671+L731-732
      stale warn / L504 dedup N/A / maxDepth default 10).
- [ ] `npm run docs:check` passes; `npm run docs:lint` does not regress; `npm run format:check` passes
      (run `npm run format` first IF an edit flagged; `npm run docs:lint:fix` for your edit's lint only).

### Feature Validation
- [ ] ARCHITECTURE.md L170 markers match emitted `@!include`/`@!end-include`; stale-`.md` warning
      UNCONDITIONAL (no depth-gate carve-out).
- [ ] ARCHITECTURE.md L168 maxDepth default `10`; cycle detection + idempotent accurate.
- [ ] ARCHITECTURE.md L159 directive `@path/to/file.md` UNCHANGED (not conflated with emitted markers).
- [ ] ARCHITECTURE.md false-positive grep hits (L131 realpathSync/reporoot, L957 commit eliding, L981
      bug-hunt marker) correctly left untouched.
- [ ] CLI_REFERENCE.md confirmed: NO include/marker/include-dedup references (all hits unrelated).
- [ ] No dedup prose contradicts post-BUG-003 canonical keying (NEITHER file has dedup prose → satisfied).
- [ ] NO fabricated features / NO over-claiming / NO enhancement masquerading as correction.

### Code Quality Validation
- [ ] Either NO edit in both files (verified accurate — the expected/preferred outcome) OR minimal
      accuracy-only edits (ARCHITECTURE.md only; CLI_REFERENCE.md has nothing to correct).
- [ ] No scope creep into new dedup prose, the invariant rewrite, include content in CLI_REFERENCE.md,
      or other docs files.
- [ ] Work log states the outcome explicitly PER FILE (verified-no-edit OR corrected-X-to-match-source-L…).

### Documentation & Deployment
- [ ] docs/ARCHITECTURE.md + docs/CLI_REFERENCE.md are the only files touched (T4.S1/T4.S2 own the other
      docs; T1/T2/T3 own src/).
- [ ] No source-code edits; no env-var/config changes.

---

## Anti-Patterns to Avoid
- ❌ Don't fabricate an edit to "have something to show" — the architecture analysis + live grep both say
  ARCHITECTURE.md is "already accurate" and CLI_REFERENCE.md has "no relevant content." **NO-EDIT is the
  preferred, expected outcome for BOTH files.** Inventing a rewrite risks introducing inaccuracy into
  accurate prose (ARCHITECTURE.md) or inventing content where none belongs (CLI_REFERENCE.md).
- ❌ Don't trust the L157-183 / L159 / L165 / L168 / L170 line numbers — they're from the architecture
  snapshot and may have drifted. Locate the section by `grep`, read the LIVE prose, and verify THAT.
- ❌ Don't conflate the DIRECTIVE (`@path/to/file.md`, L159) with the EMITTED markers (`@!include`/
  `@!end-include`/`@!include-ref`, L170). The directive is UNCHANGED and correct — do not touch it. Only
  the emitted markers carry the `!`.
- ❌ Don't drop the `!` from the markers — `@!include` / `@!end-include` is the deliberate collision-proof
  format (BUG-001). ARCHITECTURE.md:170 must show `@!include:` (it already does). The only genuinely-wrong
  case would be `@include:` without the `!`.
- ❌ Don't add a depth-gate carve-out to the stale-warning prose — post-BUG-002 the warning is
  UNCONDITIONAL (incl. depth gate). ARCHITECTURE.md:170's wording is correct precisely because it has no
  carve-out.
- ❌ Don't add new dedup prose as "correction" — NEITHER file has a dedup description; adding one is
  enhancement, not the accuracy sweep. (The task's "key gotcha" hypothesized ARCHITECTURE.md might describe
  dedup — the live grep proves it does NOT; it stays at the capability/invariant level.) The optional
  ARCHITECTURE.md L165 "silent" qualification is a judgment call with a strong default of NO (L170 already
  authoritatively covers the warning — same as CONFIGURATION.md L305 in T4.S2).
- ❌ Don't add include/marker content to CLI_REFERENCE.md — the feature is config/env-driven, not a CLI
  flag. CLI_REFERENCE.md correctly has nothing; adding content is enhancement.
- ❌ Don't be fooled by ARCHITECTURE.md false-positive grep hits — L131 `realpathSync` (repo-root resolver,
  `src/utils/repo-root.ts`), L957 "eliding" (commit position layer), L981 "stale marker" (bug-hunt
  NO_ISSUES_FOUND.md) are DIFFERENT features. Only the "Resolved-Document Invariant (Distributed PRDs)"
  section is in scope.
- ❌ Don't be fooled by CLI_REFERENCE.md false-positive grep hits — L204/L271 stderr (status/config
  diagnostics), L266 dedup (`.hack.local` **gitignore** dedup, not include dedup), L405 "This includes"
  (exit-code prose), L697 stale (regenerate cache) are all UNRELATED features.
- ❌ Don't touch any file other than docs/ARCHITECTURE.md + docs/CLI_REFERENCE.md — README.md is T4.S1,
  CONFIGURATION.md is T4.S2, and all `src/` was T1/T2/T3.
- ❌ Don't skip the work-log documentation — the contract requires recording the outcome PER FILE whether
  or not an edit was made (so the next reviewer knows each file was verified, not forgotten — especially
  CLI_REFERENCE.md, where "nothing to check" must be positively confirmed, not assumed).
- ❌ Don't run a code test suite looking for "ARCHITECTURE/CLI_REFERENCE tests" — there are none; these are
  prose. The gates are `npm run docs:check` + `npm run docs:lint` + `npm run format:check`.

---

## Confidence Score
**9.5 / 10** — one-pass success. This is a verification-pass doc sweep across two files where the
architecture analysis AND the live grep both conclude the expected outcome is NO-EDIT for both:
- **CLI_REFERENCE.md**: zero include/marker/include-dedup references (all grep hits are unrelated features
  — status stderr, `.hack.local` gitignore dedup, config-validate stderr, exit-code prose, regenerate-cache
  stale). Vacuously satisfied; nothing to correct.
- **ARCHITECTURE.md**: the one relevant section ("Resolved-Document Invariant (Distributed PRDs)")
  already documents the `@!include`/`@!end-include` markers (matches source L593) and the stale-`.md` stderr
  warning unconditionally (matches source L621-627 + L671 + L731-732 incl. the depth gate); L168 documents
  maxDepth default 10 + cycle detection + idempotent (all still accurate post-BUG-003); L159 documents the
  UNCHANGED directive `@path/to/file.md`; and there is NO dedup prose to reconcile (concern d vacuously
  satisfied — the doc describes include RESOLUTION at the capability level, not the visited-set dedup
  MECHANISM, contrary to the task's hypothesis).

The task's hardest part is recognizing that **NO-EDIT is the correct deliverable for BOTH files**, not a
sign of incomplete work — which this PRP makes explicit (per file). The one residual nuance — ARCHITECTURE.md
L165's ambiguous "silent" — is handled with a clear decision rule (default: no edit; conditional minimal
qualification only if genuinely misleading) that mirrors the resolved CONFIGURATION.md L305 decision in
T4.S2, plus copy-ready text. Validation is three commands (`docs:check` + `docs:lint` + `format:check`),
all verified present in package.json with a confirmed-passing docs:check baseline (5 passed). The residual
0.5 is the standard "line numbers may have drifted, so re-grep live" caution baked into every step.