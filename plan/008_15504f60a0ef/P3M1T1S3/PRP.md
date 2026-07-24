# PRP — P3.M1.T1.S3: Update RESEARCH_TIMEOUT default and documentation

---

## Goal

**Feature Goal**: Close the documentation/comment gaps left after
**P3.M1.T1.S1** (Complete) changed `DEFAULT_RESEARCH_TIMEOUT_SECONDS` from
`300` → `1800` (PRD §4.2 / §9.2.2). S1 landed the constant literal, its JSDoc,
`.env.example`, `docs/CONFIGURATION.md`, and a fresh `1800` assertion — but it
left **stale `300` references** in a pre-existing test file and in two
user-facing prose docs. S3 is the **verification + polish pass** (Mode A "rides
with the work") that makes every `RESEARCH_TIMEOUT` reference in the repo
truthful, and **documents the grace-period / hard-deadline property** PRD §4.2
describes ("a heartbeat surfaces only after a grace period, so normal research
isn't spammed … still fails fast on a genuinely stuck supervisor").

**Deliverable** (4 files, all additive comment/doc accuracy fixes — **no
behavior change**):
1. **`tests/unit/config/research-timeout.test.ts`** — MODIFY: update **6 stale
   `300` references** → `1800` (header docstring line 7, test-name line 33, and
   4 inline `// 300` comments at lines 40/62/73/84). **Assertion values are
   UNCHANGED** (they compare against `DEFAULT_RESEARCH_TIMEOUT_SECONDS`, so they
   already pass; only the lying comments change). ADD **1 defensive test**
   asserting the grace-period / hard-deadline property holds (see Task 4).
2. **`docs/WORKFLOWS.md`** — MODIFY: **2 prose** `default 300s` →
   `default 1800s` references at **lines 96 and 403 ONLY**. (The duration-
   estimate tables at lines 582-585 / 1227-1242 list unrelated execution-time
   buckets — **leave them untouched**.)
3. **`README.md`** — MODIFY: **1 prose** `default 300s` → `default 1800s` at
   **line 128 ONLY**.
4. **`src/config/constants.ts`** — MODIFY: ADD a `@remarks` grace-period note
   to `getResearchTimeoutSeconds()` JSDoc documenting the **hard-deadline /
   no-intermediate-heartbeat** property (so legitimate long research is not
   flagged as stuck, while a wedged supervisor still fails fast). **No change
   to the function body** (it already references the constant by name, so the
   1800 default flows through). Optionally mirror the note as a one-liner on
   `waitForPRP` in `src/core/research-queue.ts` (see Task 1 GOTCHA).

**Success Definition**:
- `grep -rn "default.*300s\|// 300\|DEFAULT (300)"` across the repo (excluding
  `plan/`, `node_modules/`, `prd_snapshot.md`, `PRD.md`, and the duration-
  estimate tables) returns **zero** matches referencing the RESEARCH_TIMEOUT
  default.
- Every `RESEARCH_TIMEOUT` default reference in shipped docs says `1800`
  (30 min), consistent with `DEFAULT_RESEARCH_TIMEOUT_SECONDS === 1800`.
- `getResearchTimeoutSeconds()` JSDoc documents the grace-period property.
- `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved (the only
  `src/` touch is a comment — no new branches, so coverage is unaffected).
- No behavior change: the deadline code (`waitForPRP`, `withAgentDeadline`) is
  untouched; the new test is defensive and covers already-tested behavior.

---

## User Persona (if applicable)

**Target User**: Pipeline operator reading docs/tests to understand the
background-research deadline.
**Use Case**: Operator sets `RESEARCH_TIMEOUT` and reads `README.md` /
`docs/WORKFLOWS.md` / `docs/CONFIGURATION.md` to learn the default; reads tests
to confirm the contract.
**Pain Points Addressed**: Inconsistent docs (CONFIGURATION.md said 1800 after
S1, but WORKFLOWS.md/README.md still said 300) erode trust and mislead
operators into setting needlessly short timeouts. Lying test comments confuse
maintainers.

---

## Why

- **PRD compliance**: PRD §4.2 (h3.4) specifies `RESEARCH_TIMEOUT` default
  **30 minutes / 1800s**; §9.2.2 (h4.1) enumerates it as a Required Environment
  Variable with the 1800s default and the grace-period phrasing ("A grace period
  precedes the heartbeat so legitimately long research is not flagged as
  stuck").
- **S1 left gaps**: S1's PRP scoped its Mode-A docs edits to
  `docs/CONFIGURATION.md`'s table cell + `.env.example`. The prose defaults in
  `README.md` and `docs/WORKFLOWS.md`, plus the pre-existing
  `research-timeout.test.ts` comments, were not in S1's file list and remain
  stale. S3's contract item 5 (DOCS, Mode A — "This rides WITH the work")
  authorizes completing the sweep.
- **Contract item 4 (grace-period)**: documents/verifies the property that the
  deadline fails fast on a stuck supervisor without flagging legitimate long
  research. Per the gap analysis, the current hard-deadline implementation
  already satisfies this (no intermediate heartbeat = nothing to suppress);
  S3's contribution is a documenting JSDoc + a defensive test, NOT a new
  heartbeat subsystem.

### Out of scope (hard fences)
- **`DEFAULT_RESEARCH_TIMEOUT_SECONDS` literal / `getResearchTimeoutSeconds()`
  body** → S1 (DONE). S3 adds a JSDoc `@remarks` note ONLY; the body is
  unchanged.
- **`.env.example` / `docs/CONFIGURATION.md` table cell** → S1 (DONE). Do NOT
  re-edit.
- **`docs/WORKFLOWS.md` / `README.md` duration-estimate tables** (the `300s`
  values at WORKFLOWS.md:582-585, 1227-1242) → UNRELATED to RESEARCH_TIMEOUT
  (execution-time buckets); leave untouched.
- **Deadline behavior** (`waitForPRP`, `withAgentDeadline`, `ResearchTimeoutError`)
  → UNCHANGED. S3 documents, does not alter, the deadline semantics.
- **S4 (bugfix env-var forwarding)** → S3 produces NO exported symbol for S4.
  Contract item 4 OUTPUT: "No further subtask consumes this directly."
- **`PRD.md` / `tasks.json` / `prd_snapshot.md` / `vitest.config.ts`** →
  READ-ONLY.

---

## What

### User-visible behavior
None at runtime. Documentation and test comments become consistent with the
1800s default that already ships. Operators reading any doc now see the same
default.

### Technical requirements (exact contract — items 3, 4, 5)

**(a) Update stale `300` comments in `tests/unit/config/research-timeout.test.ts`.**
Six edits (all `300` → `1800`, comment/text only — **no assertion-value
changes**):
- Header docstring (line 7): `Returns DEFAULT (300)` → `Returns DEFAULT (1800)`.
- Test name (line 33): `returns the default (300)` → `returns the default (1800)`.
- Inline comments (lines 40, 62, 73, 84): `// 300` → `// 1800`.

The assertions at those lines (`expect(result).toBe(DEFAULT_RESEARCH_TIMEOUT_SECONDS)`)
are **already correct** — they reference the constant, which is now 1800. Only
the trailing human-readable comments are wrong.

**(b) Update prose defaults in `docs/WORKFLOWS.md`.** Two edits:
- Line 96: `` `RESEARCH_TIMEOUT` (default `300`s; PRD §4.2) `` →
  `` `RESEARCH_TIMEOUT` (default `1800`s; PRD §4.2) ``.
- Line 403: `` bounded by `RESEARCH_TIMEOUT` (default `300`s; PRD §4.2) `` →
  `` bounded by `RESEARCH_TIMEOUT` (default `1800`s; PRD §4.2) ``.
- **DO NOT** touch the duration-estimate tables at lines 582-585 / 1227-1242
  (those `300s`/`600s` are unrelated QA/execution buckets).

**(c) Update prose default in `README.md`.** One edit:
- Line 128: `` `RESEARCH_TIMEOUT` (default `300`s; PRD §4.2) `` →
  `` `RESEARCH_TIMEOUT` (default `1800`s; PRD §4.2) ``.
- **DO NOT** touch line 316 (`http://localhost:3000`) — unrelated port number.

**(d) Grace-period documentation on `getResearchTimeoutSeconds()` (constants.ts).**
Add a `@remarks` block to the existing JSDoc (currently lines 252-263) — **no
body change**:

```ts
/**
 * Read & validate the RESEARCH_TIMEOUT env var (PRD §4.2, §9.2.2).
 *
 * @returns The configured deadline in seconds, or DEFAULT_RESEARCH_TIMEOUT_SECONDS
 *          when unset, non-numeric, or non-positive.
 *
 * @remarks
 * Grace period / hard deadline (PRD §4.2): the deadline is a HARD upper bound —
 * `waitForPRP` (research-queue.ts) and `withAgentDeadline` (retry.ts) race the
 * in-flight research against this value and fail fast on a genuinely stuck
 * supervisor. No intermediate "heartbeat" warning is emitted during the window,
 * so legitimately long research is never flagged as stuck (a heartbeat would
 * surface only after a grace period; today there is no heartbeat, so nothing is
 * spammed). On expiry the work is abandoned and re-researched synchronously
 * inline (PRD §4.2 fallback).
 *
 * @example
 * ```ts
 * import { getResearchTimeoutSeconds } from './config/constants.js';
 *
 * const deadline = getResearchTimeoutSeconds(); // 1800 (default)
 * ```
 */
export function getResearchTimeoutSeconds(): number {
  // body UNCHANGED
```

**(e) Defensive grace-period test** (added to the existing
`research-timeout.test.ts` describe block). The property to verify: a promise
that resolves before the deadline is NOT flagged; the deadline only fires for a
promise that genuinely exceeds it. Because the real `withAgentDeadline`/
`waitForPRP` use real timers keyed to `getResearchTimeoutSeconds()` (≥120s by
default), test the **contract at the config layer** (fast, deterministic):
assert `getResearchTimeoutSeconds()` returns a positive number ≥ 1 (the deadline
is a real bound), and document via an inline comment that the grace-period
behavior is proven by the existing `waitForPRP`/`withAgentDeadline` integration
tests (do not duplicate them here).

```ts
  it('(g) returns a positive deadline that bounds research (grace-period property, PRD §4.2)', () => {
    // The deadline is a HARD upper bound: a stuck supervisor fails fast at this
    // value; legitimate long research that completes before it is never flagged
    // (no intermediate heartbeat is emitted — see getResearchTimeoutSeconds() JSDoc).
    // The wait/abandon behavior itself is covered by research-queue.test.ts
    // (waitForPRP) and retry.test.ts (withAgentDeadline) integration tests.
    const deadline = getResearchTimeoutSeconds();
    expect(deadline).toBeGreaterThan(0);
    expect(deadline).toBe(DEFAULT_RESEARCH_TIMEOUT_SECONDS); // 1800 when unset
  });
```

### Success Criteria
- [ ] `grep -rn "default \`300\`s\|// 300\|DEFAULT (300)\|default (300)"`
      across `tests/`, `docs/`, `README.md`, `src/` returns **zero** matches
      referencing the RESEARCH_TIMEOUT default (duration-estimate-table `300s`
      values excluded).
- [ ] `docs/WORKFLOWS.md:96` and `:403`, and `README.md:128` say `default 1800s`.
- [ ] `getResearchTimeoutSeconds()` JSDoc has a `@remarks` grace-period note.
- [ ] `research-timeout.test.ts` has 6 updated comments (300→1800) + 1 new
      defensive test (case g) that passes.
- [ ] `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.
- [ ] `git diff --name-only` shows exactly the intended files (see Task 5).

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** This is a documentation/comment-accuracy sweep across 4 files (3
non-source, 1 JSDoc-only source edit) plus 1 defensive test. Correctness rests
on five pre-proven facts (all pinned below): (1) **S1 is fully landed** for its
declared scope — the constant, `.env.example`, `docs/CONFIGURATION.md` table,
and the `constants.test.ts:243` assertion all already say 1800; (2) the **6
stale `300` references** are at exact line numbers in
`tests/unit/config/research-timeout.test.ts` (lines 7, 33, 40, 62, 73, 84);
(3) the **3 stale prose defaults** are at exact line numbers
(`docs/WORKFLOWS.md:96,403`, `README.md:128`) and are DISJOINT from the
duration-estimate tables that must NOT be touched; (4) the **grace-period is a
documented property, not a subsystem** — no `grace`/`heartbeat` token exists in
`src/`, and the hard-deadline code (`waitForPRP`, `withAgentDeadline`) already
satisfies the PRD phrasing; (5) the **only src/ touch is a JSDoc comment** — no
new branches, so the 100%-coverage gate is unaffected.

### Documentation & References
```yaml
# MUST READ — the PRD spec (provided in selected_prd_content)
- docfile: PRD.md
  section: "4.2 The Execution Loop — Parallel Research, Deadline & Fallback" (h3.4)
       + "9.2.2 Required Environment Variables — RESEARCH_TIMEOUT" (h4.1)
  why: §4.2 mandates 1800s (30 min) and the grace-period phrasing; §9.2.2
       enumerates RESEARCH_TIMEOUT default 1800 with the grace-period note.
  critical: PRD.md is READ-ONLY — do NOT edit it even though it may still say
            "300" somewhere (it is the human-owned source of truth, not S3's job).

# MUST READ — this subtask's research (proven gap analysis against the live tree)
- docfile: plan/008_15504f60a0ef/P3M1T1S3/research/s3-gap-analysis.md
  section: FACT 1 (S1 landed scope), FACT 2 (6 stale test comments w/ line numbers),
       FACT 3 (3 stale prose doc defaults w/ line numbers), FACT 4 (grace-period =
       documented property, no heartbeat subsystem), FACT 5 (terminal polish, no
       S4 consumer), FACT 6 (validation gate)
  why: Proves the exact edit sites, the scope fences (which 300s to change vs
       leave), and that the grace-period is documentation-only.

# MUST READ — S1 contract (what already landed; do NOT duplicate)
- docfile: plan/008_15504f60a0ef/P3M1T1S1/PRP.md
  section: "Goal" (1800 change + .env.example + CONFIGURATION.md) + "Anti-Patterns"
  why: Confirms S1's file list so S3 does not re-edit `.env.example` or the
       CONFIGURATION.md table cell. S1 left the gaps S3 closes.

# MUST READ — S2 contract (the consumer of the deadline; confirms behavior is
# already correct and S3 must not alter it)
- docfile: plan/008_15504f60a0ef/P3M1T1S2/PRP.md
  section: "All Needed Context" → research-queue.ts waitForPRP (≈414-460)
  why: waitForPRP enforces the hard deadline via Promise.race against
       getResearchTimeoutSeconds()*1000. S3 documents this; S2 (and the existing
       implementation) already do it. No deadline-code change in S3.

# THE FILE TO EDIT — stale test comments + new defensive test
- file: tests/unit/config/research-timeout.test.ts
  section: header docstring (line 7), test name (line 33), inline comments (lines
       40, 62, 73, 84); ADD case (g) inside the existing describe block.
  why: These 6 sites still say 300 after S1; the describe block is the natural
       home for the defensive grace-period test.
  pattern: the existing 6 cases (a)-(f) — mirror their SETUP/EXECUTE/VERIFY style.
  gotcha: assertion VALUES are unchanged (they reference the constant); only the
       trailing comments + the test-name/docstring text change. Do NOT alter the
       beforeEach/afterEach env-stub setup.

# THE FILES TO EDIT — prose doc defaults (Mode A)
- file: docs/WORKFLOWS.md
  section: line 96 (Parallel Research deadline) + line 403 (prefetch bound).
  why: User-facing prose still says 300s; S1 only edited CONFIGURATION.md.
  pattern: the existing inline `` `RESEARCH_TIMEOUT` (default `Ns`; PRD §4.2) ``
       backticked form.
  gotcha: lines 582-585 and 1227-1242 contain `300s`/`600s` in DURATION-ESTIMATE
       tables — those are execution-time buckets, NOT the RESEARCH_TIMEOUT
       default. LEAVE THEM. Only the two prose mentions of `RESEARCH_TIMEOUT
       (default 300s)` change.

- file: README.md
  section: line 128 (background research deadline).
  why: Same prose-default drift as WORKFLOWS.md.
  pattern: identical backticked `` default `300`s `` form.
  gotcha: line 316 `http://localhost:3000` is a PORT number — unrelated, do NOT
       touch. Only line 128's RESEARCH_TIMEOUT default changes.

# THE FILE TO EDIT — grace-period JSDoc (src touch, comment-only)
- file: src/config/constants.ts
  section: getResearchTimeoutSeconds() JSDoc (lines 252-263); ADD a @remarks block.
  why: PRD §4.2 grace-period phrasing should be documented at the config helper
       that all deadline consumers (waitForPRP, withAgentDeadline) read from.
  pattern: existing @remarks blocks on neighboring constants (e.g.
       DEFAULT_RESEARCH_TIMEOUT_SECONDS @remarks at ≈238).
  gotcha: the function BODY (lines 264-271) is UNCHANGED — it references the
       constant by name. Adding prose to JSDoc adds NO branches → no coverage
       impact. Do NOT edit the literal (S1 already set it to 1800).

# OPTIONAL mirror — one-line grace-period note on the deadline enforcer
- file: src/core/research-queue.ts
  section: waitForPRP() JSDoc (≈414-436); OPTIONALLY append one sentence to its
       existing @remarks referencing the grace-period property.
  why: Keeps the enforcer's own doc in sync with the config-helper doc.
  pattern: the existing waitForPRP @remarks (≈420-426).
  gotcha: OPTIONAL — if it risks scope creep, do constants.ts ONLY. No body change.

# CONTRACT INPUTS (read-only)
- file: vitest.config.ts
  why: 100/100/100/100 thresholds on src/**/*.ts — confirms a JSDoc-only edit (no
       new branches) cannot regress coverage.
- file: package.json
  why: npm run validate = lint + format:check + typecheck + test:run (the green
       gate). Also format:check — prettier may reflow the new JSDoc; run
       `npm run format` if it complains.
- file: tests/unit/core/research-queue.test.ts  +  tests/unit/utils/retry.test.ts
  why: These already cover waitForPRP / withAgentDeadline deadline behavior. S3's
       new test (case g) is DEFENSIVE at the config layer and does NOT duplicate
       them; reference them in the test comment (see Task 4).
```

### Current Codebase tree (relevant slice)
```bash
src/
  config/
    constants.ts                 # EDIT — +@remarks grace-period note on getResearchTimeoutSeconds() (JSDoc only; body UNCHANGED)
  core/
    research-queue.ts            # OPTIONAL — +one-line grace note on waitForPRP @remarks (body UNCHANGED)
tests/
  unit/
    config/
      research-timeout.test.ts   # EDIT — 6 stale `300`→`1800` comments (lines 7,33,40,62,73,84) + new defensive case (g)
docs/
  WORKFLOWS.md                   # EDIT — 2 prose defaults 300→1800 (lines 96, 403 ONLY)
README.md                        # EDIT — 1 prose default 300→1800 (line 128 ONLY)
.env.example                     # READ-ONLY (S1 done)
docs/CONFIGURATION.md            # READ-ONLY (S1 done — table cell already 1800)
vitest.config.ts                 # READ-ONLY — 100% coverage thresholds
package.json                     # READ-ONLY — npm run validate gate
PRD.md                           # READ-ONLY — human-owned source of truth
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
# (no NEW files — all edits to existing files)
src/config/constants.ts                 # MODIFIED — grace-period @remarks on getResearchTimeoutSeconds()
tests/unit/config/research-timeout.test.ts  # MODIFIED — truthful comments (1800) + defensive grace-period test
docs/WORKFLOWS.md                       # MODIFIED — 2 prose RESEARCH_TIMEOUT defaults 300→1800
README.md                               # MODIFIED — 1 prose RESEARCH_TIMEOUT default 300→1800
src/core/research-queue.ts              # (OPTIONAL) — mirrored one-line grace note on waitForPRP
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (S1 already landed the 1800 change): do NOT re-edit
//   DEFAULT_RESEARCH_TIMEOUT_SECONDS (it is already 1800), its @remarks/@example
//   (already say 1800), .env.example (already has # RESEARCH_TIMEOUT=1800), or the
//   docs/CONFIGURATION.md table cell (already 1800). Re-editing risks a format/lint
//   diff with no value. S3 edits ONLY the sites S1 did not touch.

// CRITICAL (duration-estimate tables are NOT the RESEARCH_TIMEOUT default):
//   docs/WORKFLOWS.md lines 582-585 and 1227-1242 contain `300s` and `600s` in
//   "Duration" / QA-cycle estimate tables. These are EXECUTION-TIME BUCKETS, not
//   the RESEARCH_TIMEOUT env-var default. Changing them would corrupt unrelated
//   estimates. ONLY the two prose mentions of `RESEARCH_TIMEOUT (default 300s)`
//   (lines 96, 403) change.

// CRITICAL (README port 3000 is unrelated): README.md:316 `http://localhost:3000`
//   is a localhost PORT for a dev server, not the timeout. Only line 128's
//   RESEARCH_TIMEOUT default changes.

// CRITICAL (grace-period is a DOCUMENTED PROPERTY, not a subsystem): grep finds
//   NO `grace`/`heartbeat` token in src/. The hard-deadline code (waitForPRP,
//   withAgentDeadline) already satisfies PRD §4.2's phrasing — there is no
//   intermediate heartbeat to suppress, so "a heartbeat surfaces only after a
//   grace period" is vacuously true. S3 DOCUMENTS this (JSDoc @remarks) and
//   VERIFIES it (defensive test); it does NOT build a heartbeat subsystem.
//   Building one would violate contract item 4 OUTPUT ("No further subtask
//   consumes this directly") and balloon scope.

// CRITICAL (test comments vs assertion values): the 6 stale `// 300` comments in
//   research-timeout.test.ts are COSMETIC — the assertions compare against
//   DEFAULT_RESEARCH_TIMEOUT_SECONDS (now 1800), so the tests already pass.
//   Update the COMMENTS/TEST-NAME/DOCSTRING text to 1800; do NOT change the
//   expect(...) values (they are correct as-is).

// GOTCHA (no coverage regression): the only src/ touch is a JSDoc @remarks block
//   on getResearchTimeoutSeconds() (no body change, no new branch). vitest's
//   100%-coverage gate is therefore unaffected. The new test (case g) is
//   defensive and covers already-tested behavior at the config layer.

// GOTCHA (prettier may reflow JSDoc): after adding the @remarks block, run
//   `npm run format` if `npm run format:check` complains (the validate gate
//   includes format:check). Do not hand-format; let prettier do it.

// GOTCHA (do NOT edit PRD.md): PRD.md may still reference 300 somewhere (it is
//   the human-owned source of truth and orchestrator-managed). It is READ-ONLY.
//   S3's job is to align IMPLEMENTATION docs/tests with the already-shipped 1800.
```

---

## Implementation Blueprint

### Data models and structure
None. No types, models, or schemas change. This is a documentation/comment
accuracy pass.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: MODIFY src/config/constants.ts — grace-period @remarks (JSDoc only)
  - LOCATE getResearchTimeoutSeconds() JSDoc (lines 252-263).
  - ADD a @remarks block (see What (d) for the exact text) documenting:
      * the deadline is a HARD upper bound (waitForPRP + withAgentDeadline race
        against it and fail fast on a stuck supervisor);
      * no intermediate heartbeat is emitted, so legitimate long research is
        never flagged (grace-period property, PRD §4.2);
      * on expiry the work is abandoned and re-researched synchronously inline.
  - PRESERVE: the function body (264-271), the @returns, the @example, the
    DEFAULT_RESEARCH_TIMEOUT_SECONDS literal (already 1800), all other constants.
  - FOLLOW pattern: neighboring @remarks blocks (e.g. DEFAULT_RESEARCH_TIMEOUT_SECONDS
    @remarks ≈238).
  - GOTCHA: body UNCHANGED → no new branch → coverage unaffected. Do NOT touch
    the literal (S1 set it). Do NOT edit .env.example or CONFIGURATION.md (S1 done).
  - OPTIONAL: append ONE sentence to waitForPRP()'s @remarks in
    src/core/research-queue.ts (≈420-426) mirroring the grace-period note. Skip
    if it risks scope creep; constants.ts is the canonical home.

Task 2: MODIFY tests/unit/config/research-timeout.test.ts — truthful comments
  - EDIT line 7 (header docstring): `Returns DEFAULT (300)` → `Returns DEFAULT (1800)`.
  - EDIT line 33 (test name): `returns the default (300)` → `returns the default (1800)`.
  - EDIT lines 40, 62, 73, 84 (inline trailing comments): `// 300` → `// 1800`.
  - PRESERVE: all expect(...) assertion values (they reference the constant),
    the beforeEach/afterEach env-stub setup, cases (a)-(f) structure.
  - FOLLOW pattern: the existing comment style (trailing `// <value>` after the
    constant-referencing expect).
  - GOTCHA: assertion VALUES are unchanged — only human-readable text. Do NOT
    "fix" the assertions; they are already correct.

Task 3: MODIFY docs/WORKFLOWS.md — 2 prose defaults (Mode A)
  - EDIT line 96: `` `RESEARCH_TIMEOUT` (default `300`s; PRD §4.2) `` → `1800`s.
  - EDIT line 403: `` bounded by `RESEARCH_TIMEOUT` (default `300`s; PRD §4.2) `` → `1800`s.
  - PRESERVE: the duration-estimate tables at lines 582-585 and 1227-1242
    (`300s`/`600s` there are execution-time buckets, NOT the timeout default).
  - FOLLOW pattern: the existing backticked `` default `Ns` `` inline form.
  - GOTCHA: use rg/precise edit to change ONLY the two RESEARCH_TIMEOUT prose
    mentions. A global `300`→`1800` replace would corrupt the estimate tables.

Task 4: MODIFY README.md — 1 prose default (Mode A)
  - EDIT line 128: `` `RESEARCH_TIMEOUT` (default `300`s; PRD §4.2) `` → `1800`s.
  - PRESERVE: line 316 `http://localhost:3000` (port, unrelated).
  - FOLLOW pattern: the same backticked form as WORKFLOWS.md.
  - GOTCHA: precise edit — do NOT globally replace 300.

Task 5: ADD defensive grace-period test to research-timeout.test.ts
  - ADD inside the existing describe('config/constants: getResearchTimeoutSeconds')
    block, after case (f), a new case (g) (see What (e) for exact code):
      it('(g) returns a positive deadline that bounds research (grace-period property, PRD §4.2)', () => {
        const deadline = getResearchTimeoutSeconds();
        expect(deadline).toBeGreaterThan(0);
        expect(deadline).toBe(DEFAULT_RESEARCH_TIMEOUT_SECONDS); // 1800 when unset
      });
  - The test is DEFENSIVE (the deadline-is-a-positive-bound property is already
    exercised by waitForPRP/withAgentDeadline integration tests); the inline
    comment documents that linkage so a future reader doesn't think S3 duplicated
    coverage.
  - FOLLOW pattern: the existing SETUP/EXECUTE/VERIFY comment structure.
  - GOTCHA: this test runs with RESEARCH_TIMEOUT unset (beforeEach deletes it),
    so it asserts the 1800 default. No env mutation needed → deterministic.

Task 6: VERIFY — no regressions + no stray 300s
  - RUN npm run typecheck → exit 0 (JSDoc-only src change compiles).
  - RUN npx vitest run tests/unit/config/research-timeout.test.ts → ALL green
    (7 cases now; the 6 existing still pass with updated comments).
  - RUN npx vitest run --coverage → 100/100/100/100 on src/**/*.ts (JSDoc adds
    no branches; coverage unaffected).
  - RUN npm run validate → GREEN.
  - RUN the stray-300 sweep:
      grep -rn "default \`300\`s\|// 300\|DEFAULT (300)\|default (300)" \
        tests/ docs/README.md docs/WORKFLOWS.md src/ \
        | grep -v "node_modules" | grep -v "estimate"
      # EXPECT: zero matches (or only the intentionally-preserved duration-table lines).
    Then a targeted confirm:
      grep -n "RESEARCH_TIMEOUT.*300" docs/WORKFLOWS.md README.md   # EXPECT: zero
      grep -n "RESEARCH_TIMEOUT.*1800" docs/WORKFLOWS.md README.md docs/CONFIGURATION.md .env.example  # EXPECT: present
  - RUN npm run format:check → if it complains about the new JSDoc, run
    `npm run format` and re-run validate.
  - VERIFY only the intended files changed: git diff --name-only →
    src/config/constants.ts, tests/unit/config/research-timeout.test.ts,
    docs/WORKFLOWS.md, README.md, (optionally src/core/research-queue.ts).
```

### Implementation Patterns & Key Details
```ts
// PATTERN: truthful trailing comment after a constant-referencing assertion
//   (tests/unit/config/research-timeout.test.ts):
expect(result).toBe(DEFAULT_RESEARCH_TIMEOUT_SECONDS); // 1800   // ← was // 300

// PATTERN: backticked prose default in docs (README.md / docs/WORKFLOWS.md):
`RESEARCH_TIMEOUT` (default `1800`s; PRD §4.2)   // ← was `300`s

// PATTERN: grace-period @remarks on a config helper (constants.ts):
/**
 * @remarks
 * Grace period / hard deadline (PRD §4.2): the deadline is a HARD upper bound —
 * `waitForPRP` (research-queue.ts) and `withAgentDeadline` (retry.ts) race the
 * in-flight research against this value and fail fast on a genuinely stuck
 * supervisor. No intermediate "heartbeat" warning is emitted during the window,
 * so legitimately long research is never flagged as stuck. On expiry the work is
 * abandoned and re-researched synchronously inline (PRD §4.2 fallback).
 */

// PATTERN: defensive config-layer test documenting an already-proven property:
it('(g) returns a positive deadline that bounds research (grace-period property)', () => {
  const deadline = getResearchTimeoutSeconds();
  expect(deadline).toBeGreaterThan(0);
  expect(deadline).toBe(DEFAULT_RESEARCH_TIMEOUT_SECONDS); // 1800 when unset
});

// CRITICAL: the function BODY is unchanged — S3 adds JSDoc prose ONLY. No branch.
// CRITICAL: do NOT globally replace "300" → "1800" anywhere; use precise edits to
//   avoid corrupting the duration-estimate tables (WORKFLOWS.md:582-585,1227-1242)
//   and the localhost:3000 port (README.md:316).
// CRITICAL: PRD.md is READ-OWNER — never edit it, even if it still says 300.
```

### Integration Points
```yaml
CONFIG (src/config/constants.ts):
  - add: @remarks grace-period note on getResearchTimeoutSeconds() (JSDoc only).
  - unchanged: function body, the 1800 literal, all other constants.

TESTS (tests/unit/config/research-timeout.test.ts):
  - update: 6 stale `300` comments → `1800` (lines 7,33,40,62,73,84).
  - add: defensive case (g) (grace-period property).

DOCS (Mode A — rides with the work):
  - docs/WORKFLOWS.md: 2 prose RESEARCH_TIMEOUT defaults 300→1800 (lines 96, 403).
  - README.md: 1 prose RESEARCH_TIMEOUT default 300→1800 (line 128).
  - .env.example / docs/CONFIGURATION.md: UNCHANGED (S1 done).

OPTIONAL (src/core/research-queue.ts):
  - waitForPRP() @remarks: append one grace-period sentence (skip if scope risk).

NO BEHAVIOR CHANGE: waitForPRP, withAgentDeadline, ResearchTimeoutError UNTOUCHED.
NO DATABASE / NO ROUTES / NO MODELS / NO NEW EXPORTS / NO PRD.md / NO tasks.json
  / NO vitest.config.ts / NO .env.example / NO CONFIGURATION.md table.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit → exit 0 (JSDoc-only src change compiles)
npm run format:check     # prettier --check; run `npm run format` if the new JSDoc reflows
# Expected: Zero errors. The only src touch is a comment; tests/docs are text edits.
```

### Level 2: Unit Tests (Component Validation)
```bash
npx vitest run tests/unit/config/research-timeout.test.ts   # 7 cases (6 existing + new (g)) ALL green
npx vitest run --coverage                                   # 100/100/100/100 on src/**/*.ts (unaffected)
npm run test:run                                            # full suite green (no behavior change)
# Expected: ALL green. The new case (g) passes; the 6 updated comments don't alter assertions.
```

### Level 3: Integration Testing (System Validation)
```bash
npm run validate      # lint + format:check + typecheck + test:run → GREEN
npm run build         # tsc -p tsconfig.build.json → succeeds (JSDoc is erased at build)

# Confirm deadline consumers are UNCHANGED (S3 documents, doesn't alter):
npx vitest run tests/unit/core/research-queue.test.ts        # waitForPRP deadline tests GREEN unchanged
npx vitest run tests/unit/utils/retry.test.ts                # withAgentDeadline tests GREEN unchanged
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Stray-300 sweep — confirm no RESEARCH_TIMEOUT default still says 300:
grep -rn "RESEARCH_TIMEOUT.*300" docs/ README.md tests/ src/   # EXPECT: zero matches
grep -rn "default \`300\`s" docs/ README.md                    # EXPECT: zero matches
grep -rn "// 300\|DEFAULT (300)\|default (300)" tests/unit/config/research-timeout.test.ts  # EXPECT: zero

# Positive sweep — confirm 1800 is now consistent everywhere:
grep -rn "RESEARCH_TIMEOUT.*1800\|1800.*RESEARCH_TIMEOUT" docs/ README.md .env.example src/config/constants.ts
# EXPECT: CONFIGURATION.md table, .env.example, constants.ts JSDoc + literal, and
#         now WORKFLOWS.md (×2) + README.md all say 1800.

# Confirm the grace-period note landed:
grep -n "grace period\|Grace period\|HARD upper bound" src/config/constants.ts   # EXPECT: ≥1 match in @remarks

# Confirm duration-estimate tables are PRESERVED (NOT corrupted by a global replace):
grep -n "^| PRD Decomposition\|^| QA Cycle" docs/WORKFLOWS.md   # EXPECT: still present with 300s/600s buckets
grep -n "localhost:3000" README.md                              # EXPECT: still present (port, unrelated)

# Confirm S1's sites were NOT re-edited (no spurious diff):
git diff --stat .env.example docs/CONFIGURATION.md              # EXPECT: no changes (S1 already did them)

# Confirm only the intended files changed:
git diff --name-only
# EXPECT: src/config/constants.ts, tests/unit/config/research-timeout.test.ts,
#         docs/WORKFLOWS.md, README.md, (optionally src/core/research-queue.ts)
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0.
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] `npm run build` succeeds.
- [ ] 100% coverage on `src/**/*.ts` preserved (JSDoc-only src edit → no impact).

### Feature Validation
- [ ] Zero stale `RESEARCH_TIMEOUT … 300` references in `docs/`, `README.md`,
      `tests/`, `src/` (duration-estimate tables and localhost:3000 excluded).
- [ ] `docs/WORKFLOWS.md:96` + `:403` and `README.md:128` say `default 1800s`.
- [ ] `tests/unit/config/research-timeout.test.ts` comments/test-name/docstring
      say 1800 (6 sites); assertions unchanged.
- [ ] `getResearchTimeoutSeconds()` JSDoc has a grace-period `@remarks` note.
- [ ] New defensive case (g) passes and documents the grace-period property.
- [ ] Deadline consumers (`waitForPRP`, `withAgentDeadline`) UNCHANGED and green.

### Code Quality Validation
- [ ] No global `300`→`1800` replace (precise edits only; estimate tables + port preserved).
- [ ] No re-edit of S1's sites (`.env.example`, `CONFIGURATION.md` table cell).
- [ ] No new exported symbols (terminal polish; contract item 4 OUTPUT).
- [ ] No behavior change (JSDoc + comments + prose docs only).
- [ ] `PRD.md` / `tasks.json` / `prd_snapshot.md` / `vitest.config.ts` untouched.

### Documentation & Deployment
- [ ] All shipped `RESEARCH_TIMEOUT` default references are consistent (1800).
- [ ] Grace-period property documented at the config helper read by all consumers.
- [ ] No out-of-scope docs edits (only RESEARCH_TIMEOUT prose defaults changed).

---

## Anti-Patterns to Avoid
- ❌ Don't re-edit `DEFAULT_RESEARCH_TIMEOUT_SECONDS`, `.env.example`, or the
  `docs/CONFIGURATION.md` table cell — S1 already landed them. Re-editing
  produces a pointless diff.
- ❌ Don't globally replace `300` → `1800` anywhere — it would corrupt the
  duration-estimate tables (`docs/WORKFLOWS.md:582-585,1227-1242`) and the
  `localhost:3000` port (`README.md:316`). Use precise, anchored edits.
- ❌ Don't change the `expect(...)` assertion VALUES in
  `research-timeout.test.ts` — they reference the constant and are already
  correct; only the trailing comments/test-name/docstring are stale.
- ❌ Don't build a heartbeat/grace-period SUBSYSTEM — no `grace`/`heartbeat`
  token exists in `src/`, and the hard-deadline code already satisfies PRD §4.2.
  S3 DOCUMENTS the property (JSDoc) and VERIFIES it (defensive test); it does
  not introduce runtime machinery (contract item 4 OUTPUT: nothing consumes it).
- ❌ Don't change `getResearchTimeoutSeconds()` body, `waitForPRP`, or
  `withAgentDeadline` — S3 is documentation-only on the deadline path.
- ❌ Don't edit `PRD.md` — it is the human-owned source of truth and
  orchestrator-managed (READ-ONLY), even if it still references 300 somewhere.
- ❌ Don't introduce new exported symbols for S4 to consume — S3 is terminal
  polish; S4 forwards env vars (`PARALLEL_RESEARCH`/`RESEARCH_DEPTH`), not S3
  artifacts.
- ❌ Don't touch `vitest.config.ts` or `tasks.json`.
- ❌ Don't skip `npm run format:check` — the new multi-line JSDoc may need a
  prettier reflow; run `npm run format` if it complains.

---

## Confidence Score

**9/10** — One-pass success likelihood is very high. S3 is a low-risk
documentation/comment-accuracy sweep: 4 files (3 non-source + 1 JSDoc-only src
edit) and 1 defensive test, with **zero behavior change**. Every edit site is
pinned with exact line numbers proven against the live working tree (6 stale
test comments at `research-timeout.test.ts:7,33,40,62,73,84`; 3 stale prose
defaults at `docs/WORKFLOWS.md:96,403` and `README.md:128`), and the scope
fences are airtight (duration-estimate tables and the `localhost:3000` port are
explicitly excluded; S1's already-landed sites are NOT re-edited). The
grace-period requirement (contract item 4) is correctly scoped to
documentation + verification — the gap analysis proves no heartbeat subsystem
exists or is needed, and contract item 4 OUTPUT confirms nothing consumes an S3
artifact. The only src/ touch is a JSDoc `@remarks` block (no new branches →
the 100%-coverage gate is structurally unaffected). The two residual risks,
both trivial: (1) **prettier reflow of the new JSDoc** — mitigated by running
`npm run format` if `format:check` complains (validate gate catches it); (2)
**accidentally touching a preserved `300`** — mitigated by precise anchored
edits and the Level-4 stray-300 sweep. Zero file overlap with the in-flight S2
(S2 edits `task-orchestrator.ts` + `research-queue.ts` logic; S3's optional
research-queue.ts touch is a one-line @remarks append only, and S2's edits are
to the body/getter, not the waitForPRP JSDoc — coordinate via the orchestrator
if both land simultaneously, but the regions are disjoint).