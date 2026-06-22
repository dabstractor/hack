# PRP — P5.M1.T2.S1: Add `ISSUE_RETRY_MAX` config constant + default

## Goal

**Feature Goal**: Add the `ISSUE_RETRY_MAX` environment-variable name constant, its default value constant (`3`), and a `getIssueRetryMax(): number` reader helper to `src/config/constants.ts`, plus a Mode-A docs row. This is the foundational config layer consumed by P5.M1.T2.S4 (orchestrator issue-handling flow bounded by the retry count). It is a **clone-and-tweak of the `RESEARCH_TIMEOUT` block** that P5.M1.T1.S1 already shipped in the same file.

**Deliverable**:
1. `export const ISSUE_RETRY_MAX = 'ISSUE_RETRY_MAX';` — the env-var **name** (bare string).
2. `export const DEFAULT_ISSUE_RETRY_MAX = 3;` — the default value (integer count; **no unit suffix** — it is a dimensionless count, unlike `DEFAULT_RESEARCH_TIMEOUT_SECONDS`).
3. `export function getIssueRetryMax(): number` — reader helper that reads `process.env[ISSUE_RETRY_MAX]`, parses, and falls back to the default on `NaN`/non-positive.
4. A new failing-first test file `tests/unit/config/issue-retry-max.test.ts` (TDD).
5. A new `ISSUE_RETRY_MAX` **row** added to the **existing** "Resilience Tuning" table in `docs/CONFIGURATION.md` (S1 already created that subsection), plus an update to the subsection intro line to reference PRD §4.5.

**Success Definition**: `npm run validate` (eslint + prettier --check + tsc --noEmit) and `npm run test:run` (vitest run) are both green; the reader returns `3` by default and honors a `vi.stubEnv`-stubbed value; the docs row exists and references PRD §4.5.

## Why

- **Business value**: PRD §4.5 introduces the **Issue-Driven Re-planning Loop**. When a Coder Agent reports `issue` (a *recoverable planning gap* — the PRP was insufficient), the pipeline deletes the stale PRP, resets the item to `Planned`, and re-researches with `<issue_feedback>` injected. Without a bound, a persistent PRP gap loops forever. `ISSUE_RETRY_MAX` (default `3`) bounds this: after 3 issue-driven re-planning attempts the item **hard-fails** instead of spinning.
- **Scope boundary**: This subtask ships **only the config layer** (constant + default + reader + docs). It does NOT wire any counter into the orchestrator or touch the retry manager. S2 (2 pts) extends `ExecutionResult` to a tri-state; S3 (1 pt) injects `issue_feedback` into the blueprint prompt; S4 (2 pts) implements the orchestrator issue-handling flow that *consumes* `getIssueRetryMax()`.
- **Scope cohesion**: This is the `ISSUE_RETRY_MAX` analog of P5.M1.T1.S1 (`RESEARCH_TIMEOUT`). The S1 PRP explicitly states "ISSUE_RETRY_MAX (T2.S1) follows the **exact same** config pattern in the same file — keep this subtask minimal and parallel in shape so T2.S1 is a copy-paste-tweak." Both are "Resilience Tuning" knobs co-located in `constants.ts`.
- **Retry-dimension discipline** (implementation_notes.md §3): `ISSUE_RETRY_MAX` is a **DIFFERENT retry dimension** from `TaskRetryManager.maxAttempts`. The latter bounds *transient infra errors* (API/network) with exponential backoff (executor-level, fix-and-retry path for hard `fail`). `ISSUE_RETRY_MAX` bounds *re-planning attempts* (orchestrator-level). This subtask ships only the *value* the orchestrator will later read; it does NOT touch `task-retry-manager.ts`.

## What

### User-visible behavior

None directly — this is a config/infra layer. The observable effect is that the future `ISSUE_RETRY_MAX` env var becomes a recognized, documented, test-backed configuration knob, defaulting to `3` when unset or invalid.

### Technical requirements (the CONTRACT)

1. **No `ConfigService`.** There is no `ConfigService` class anywhere in the codebase. `src/config/environment.ts` is a set of **standalone functions**. Do **NOT** add normalization to `configureEnvironment()`. Follow the `RESEARCH_TIMEOUT` precedent exactly (it lives in `constants.ts`).
2. **Constants are bare strings** (env-var name) + a typed default. No enum, no map, no registry.
3. **Reader helper** is a standalone exported function in the same file. It must guard against `NaN` and non-positive values (`<= 0` → default) — identical parse-and-guard idiom to `getResearchTimeoutSeconds`.
4. **TDD**: write the failing test first, then implement.
5. **Mode A docs**: docs this subtask directly touches (the env-var reference) are updated **inside** this subtask via a `DOCS:` line — no separate doc subtask. S1 already created the "Resilience Tuning" subsection; this subtask **adds a row** to it (and updates the intro line to reference §4.5).
6. **Naming** (verbatim from item + implementation_notes.md §1): const `ISSUE_RETRY_MAX` (string), default `DEFAULT_ISSUE_RETRY_MAX` (number `3`, **no unit suffix**), reader `getIssueRetryMax` (camelCase).

### Success Criteria

- [ ] `ISSUE_RETRY_MAX` (string `'ISSUE_RETRY_MAX'`) and `DEFAULT_ISSUE_RETRY_MAX` (`3`) are exported from `src/config/constants.ts` with the exact names and values above.
- [ ] `getIssueRetryMax()` is exported from `src/config/constants.ts` and returns `3` when the env var is unset.
- [ ] `getIssueRetryMax()` returns a stubbed value (e.g. `5`) when `vi.stubEnv(ISSUE_RETRY_MAX, '5')` is used.
- [ ] `getIssueRetryMax()` returns the default `3` when the env var is `NaN` (e.g. `'abc'`) or non-positive (e.g. `'0'`, `'-5'`).
- [ ] `configureEnvironment()` in `src/config/environment.ts` is **unchanged** (`git diff` empty).
- [ ] No `ConfigService` introduced (grep `ConfigService` in src/ returns nothing new).
- [ ] `task-retry-manager.ts` is **unchanged** — this is a separate retry dimension (implementation_notes.md §3).
- [ ] `docs/CONFIGURATION.md` has an `ISSUE_RETRY_MAX` row in the existing "Resilience Tuning" table (default `3`, cross-ref PRD §4.5), and the subsection intro references §4.5.
- [ ] `npm run validate` passes (zero errors).
- [ ] `npm run test:run` passes (all tests green, new tests included).
- [ ] `npm run docs:lint` passes (CONFIGURATION.md markdownlint clean).

## All Needed Context

### Context Completeness Check

_Pass_: An agent with zero codebase knowledge can implement this from the `RESEARCH_TIMEOUT` block (fully quoted below, already in the tree), the test pattern (the existing `research-timeout.test.ts`, fully quoted below), the docs table location (with exact line refs), and the validation commands. No inference required — it is a copy-paste-tweak.

### Documentation & References

```yaml
# MUST READ — the EXACT precedent this subtask clones (S1 shipped it; it is in the tree TODAY)
- file: src/config/constants.ts
  why: The RESEARCH_TIMEOUT block (the "Resilience Tuning (PRD §4.2, §9.2.2)" section, ~lines 155-203) is the ONE pattern to copy. It contains the bare-string name const, the typed default const, and the guarded reader. ISSUE_RETRY_MAX goes IMMEDIATELY AFTER this block (keep the two resilience knobs co-located).
  pattern: |
    # VERBATIM from the tree (clone this, rename, change default + semantics):
    export const RESEARCH_TIMEOUT = 'RESEARCH_TIMEOUT';
    export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300;
    export function getResearchTimeoutSeconds(): number {
      const raw = Number(process.env[RESEARCH_TIMEOUT] ?? DEFAULT_RESEARCH_TIMEOUT_SECONDS);
      if (Number.isNaN(raw) || raw <= 0) {
        return DEFAULT_RESEARCH_TIMEOUT_SECONDS;
      }
      return raw;
    }
  gotcha: The const value IS the env-var name string; `process.env[ISSUE_RETRY_MAX]` indexes process.env by that name. Do NOT mistake it for the resolved value.
  placement: Add the new consts + reader IMMEDIATELY AFTER the getResearchTimeoutSeconds() function (end of file), in the same "Resilience Tuning (PRD §4.2, §9.2.2)" section. Add §4.5 to the section header comment so it covers both knobs.

# MUST READ — exact test conventions (clone-and-tweak this file)
- file: tests/unit/config/research-timeout.test.ts
  why: Canonical config test for a reader helper with a numeric parse+guard. SAME 6 contract cases apply to getIssueRetryMax: (a) unset→default, (b) honors stubbed positive int, (c) NaN→default, (d) zero→default, (e) negative→default, (f) stubbed int honored. Imports from 'vitest'; describe('config/constants: <reader>', ...); beforeEach env reset + afterEach vi.unstubAllEnvs(); SETUP/EXECUTE/VERIFY comment rhythm; relative import '../../../src/config/constants.js' (note the .js extension for ESM TS).
  pattern: |
    import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
    import { DEFAULT_ISSUE_RETRY_MAX, ISSUE_RETRY_MAX, getIssueRetryMax } from '../../../src/config/constants.js';
    describe('config/constants: getIssueRetryMax', () => {
      beforeEach(() => { delete process.env.ISSUE_RETRY_MAX; });
      afterEach(() => { vi.unstubAllEnvs(); });
      it('(a) returns the default (3) when env var is unset', () => {
        expect(getIssueRetryMax()).toBe(DEFAULT_ISSUE_RETRY_MAX); // 3
      });
      it('(b) honors a stubbed positive integer', () => {
        vi.stubEnv(ISSUE_RETRY_MAX, '5'); expect(getIssueRetryMax()).toBe(5);
      });
      // (c) 'abc'→3, (d) '0'→3, (e) '-5'→3, (f) '7'→7
    });
  gotcha: vi.stubEnv must be paired with vi.unstubAllEnvs() (in afterEach) AND beforeEach(() => delete process.env.ISSUE_RETRY_MAX) or leaked stubs break sibling config tests (e.g. environment.test.ts, research-timeout.test.ts).

# MUST READ — docs Mode A target (S1 ALREADY created the subsection; ADD a row + update intro)
- file: docs/CONFIGURATION.md
  why: The "### Resilience Tuning" subsection ALREADY EXISTS (S1 added it, ~lines 128-138) with ONE row (RESEARCH_TIMEOUT). This subtask (a) adds a second ROW for ISSUE_RETRY_MAX, and (b) updates the subsection intro line to also reference PRD §4.5 so the heading accurately describes both knobs.
  section: "### Resilience Tuning (~line 128) — between '### Pipeline Control' and '### Bug Hunt Configuration'"
  pattern: |
    # CURRENT intro (UPDATE to add §4.5):
    ### Resilience Tuning
    Tune execution-loop resilience knobs. See PRD §4.2 (deadline & fallback) and §9.2.2.
    # NEW intro:
    ### Resilience Tuning
    Tune execution-loop resilience knobs. See PRD §4.2 (deadline & fallback), §4.5 (issue-driven re-planning), and §9.2.2.
    # NEW ROW (append after the RESEARCH_TIMEOUT row in the same table):
    | `ISSUE_RETRY_MAX`  | No       | `3`     | Maximum number of issue-driven re-planning attempts per item before it hard-fails. See PRD §4.5. |
  gotcha: |
    - prettier (npm run format:check) DOES check docs/*.md (.prettierignore excludes node_modules/dist/coverage/plan/ but NOT docs/). The hand-aligned table may be reformatted by prettier. SAFE PATH: add the row, run `npm run format` (writes), then `npm run validate`. (S1's table already passes — adding one row keeps the structure valid.)
    - markdownlint (npm run docs:lint) runs on docs/**/*.md. Keep the pipe table consistent; no blank lines inside the table block.

# REFERENCE — the retry-dimension distinction (do NOT conflate)
- file: plan/005_d32a2ecf61cd/architecture/implementation_notes.md
  why: §1 confirms the EXACT const shape (ISSUE_RETRY_MAX = 'ISSUE_RETRY_MAX'; DEFAULT_ISSUE_RETRY_MAX = 3). §3 confirms ISSUE_RETRY_MAX is a DIFFERENT retry dimension from TaskRetryManager.maxAttempts (re-planning vs transient infra errors) — do NOT reuse TaskRetryManager, and (for this subtask) do NOT touch task-retry-manager.ts at all. §9 (two-mode doc rule), §10 (validation gates).
  section: "§1 Config pattern" and "§3 ISSUE_RETRY_MAX ≠ TaskRetryManager.maxAttempts"

# REFERENCE — what this config ENABLES (do NOT implement here)
- file: plan/005_d32a2ecf61cd/architecture/delta_impact.md
  why: Confirms ISSUE_RETRY_MAX bounds the orchestrator's issue-handling flow (R2). Read to respect the boundary — this subtask ships only the value; S4 wires the counter.
  section: "R2 (Issue-Driven Re-planning)"

# REFERENCE — PRD source of truth for semantics + default
- file: PRD.md
  why: §4.5 defines the issue-driven re-planning loop; §9.2.2 defines ISSUE_RETRY_MAX (default 3). The docs row cross-refs §4.5.
  section: "§4.5 (line ~113) and §9.2.2 (line ~327)"

# PARALLEL-EXECUTION CONTEXT (zero file overlap — safe to land together)
- file: plan/005_d32a2ecf61cd/P5M1T1S3/PRP.md
  why: P5.M1.T1.S3 (orchestrator synchronous re-research fallback) is being implemented IN PARALLEL. It edits ONLY src/core/research-queue.ts, src/core/task-orchestrator.ts, tests/unit/core/task-orchestrator.test.ts, tests/unit/core/research-queue.test.ts. This subtask edits NONE of those — zero overlap. S3's PRP even lists src/config/constants.ts under "NOT TOUCHED — read-only reference".
```

### Current Codebase tree (relevant slice)

```bash
src/config/
├── constants.ts        # <-- EDIT: add ISSUE_RETRY_MAX + DEFAULT_ISSUE_RETRY_MAX + getIssueRetryMax() (append after getResearchTimeoutSeconds)
├── environment.ts      # <-- DO NOT TOUCH (standalone fns; no ConfigService; configureEnvironment unchanged)
├── harness.ts          # <-- DO NOT TOUCH (reference only)
├── endpoint-guard.ts   # <-- DO NOT TOUCH
└── types.ts            # <-- DO NOT TOUCH

src/core/
└── task-retry-manager.ts   # <-- DO NOT TOUCH (different retry dimension; implementation_notes.md §3)

tests/unit/config/
├── endpoint-guard.test.ts
├── environment.test.ts
├── harness-config.test.ts
├── harness-provider-compat.test.ts
├── harness.test.ts
└── research-timeout.test.ts   # <-- REFERENCE: canonical reader-helper test to clone-and-tweak

docs/
└── CONFIGURATION.md    # <-- EDIT: add ISSUE_RETRY_MAX row to existing "Resilience Tuning" table + update intro line
```

### Desired Codebase tree with files to be added/modified

```bash
src/config/
└── constants.ts        # MODIFIED: + ISSUE_RETRY_MAX, + DEFAULT_ISSUE_RETRY_MAX, + getIssueRetryMax()

tests/unit/config/
└── issue-retry-max.test.ts   # NEW: failing-first unit tests for the reader helper

docs/
└── CONFIGURATION.md    # MODIFIED: + ISSUE_RETRY_MAX row in existing "Resilience Tuning" table; intro line + §4.5
```

> **File-placement decision**: Put the consts + helper in `src/config/constants.ts` (not a new module). Rationale: (a) the EXACT precedent (`RESEARCH_TIMEOUT`) lives there; (b) keeps all env-var name consts co-located for `process.env[NAME]` discoverability; (c) the S1 PRP explicitly stated ISSUE_RETRY_MAX lands here too. The contract permits `constants.ts` as the primary location. Do NOT split into a `resilience.ts` module.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: There is NO ConfigService class. Do NOT add a registry, enum, or
// configureEnvironment() normalization. The pattern is: bare-string name const
// + default const + standalone reader function. (implementation_notes.md §1, system_context.md "Config Pattern".)

// CRITICAL: ISSUE_RETRY_MAX is a DIFFERENT retry dimension from TaskRetryManager.maxAttempts
//   (implementation_notes.md §3). TaskRetryManager = transient infra errors (executor-level,
//   fix-and-retry for hard `fail`). ISSUE_RETRY_MAX = re-planning bound (orchestrator-level,
//   consumed by S4). Do NOT touch task-retry-manager.ts in this subtask.

// CRITICAL: TS ESM source uses `.js` import specifiers even in .ts files.
//   WRONG: import { ISSUE_RETRY_MAX } from './constants';
//   RIGHT: import { ISSUE_RETRY_MAX } from './config/constants.js';
// (vitest + tsc both resolve the .js→.ts mapping via tsconfig "moduleResolution".)

// GOTCHA: `process.env[X]` is typed `string | undefined`. The reader MUST:
//   - use `??` (nullish coalescing), NOT `||` — empty string '' is a real (if invalid) value.
//   - guard `Number('')` which is `0` (not NaN) → the `<= 0` guard catches it → return default.
//   - guard `Number(undefined)` which is `NaN`, and `Number('abc')` which is `NaN`.

// GOTCHA: the default-const name has NO unit suffix (DEFAULT_ISSUE_RETRY_MAX) because it is a
//   dimensionless COUNT — contrast DEFAULT_RESEARCH_TIMEOUT_SECONDS which carries _SECONDS.
//   This is mandated by implementation_notes.md §1 and the item contract. Do NOT add a suffix.

// GOTCHA: vi.stubEnv does NOT reset between files. ALWAYS pair with
//   afterEach(() => vi.unstubAllEnvs()) AND beforeEach(() => delete process.env.ISSUE_RETRY_MAX)
//   or the stubbed '5' leaks into sibling config tests (e.g. environment.test.ts, research-timeout.test.ts).

// GOTCHA: prettier (npm run format:check) DOES check docs/*.md (.prettierignore excludes plan/ but NOT docs/).
//   The docs table may be reformatted by prettier. Safe path: add the row, run `npm run format` (writes),
//   then re-run `npm run validate`. markdownlint (npm run docs:lint) also runs on docs/**/*.md.
```

## Implementation Blueprint

### Data models and structure

No data models — this subtask adds **two const primitives** and **one pure function**. Type safety comes from the default being a `number` and an explicit `: number` return annotation on the reader.

```typescript
// The ONLY new "model" — a typed default and a guarded numeric reader.
export const DEFAULT_ISSUE_RETRY_MAX = 3; // plain number (see contract: 3); NO unit suffix (dimensionless count)
// (ISSUE_RETRY_MAX is a bare string name — see Task 2.)
```

### Implementation Tasks (ordered by dependencies — strict TDD)

```yaml
Task 1: WRITE tests/unit/config/issue-retry-max.test.ts  (FAILING-FIRST — do this before Task 2)
  - IMPLEMENT: a `describe('config/constants: getIssueRetryMax', ...)` block with these 6 cases:
      (a) returns DEFAULT (3) when process.env.ISSUE_RETRY_MAX is unset
      (b) returns the stubbed numeric value when vi.stubEnv(ISSUE_RETRY_MAX, '5') → expect 5
      (c) returns 3 when stubbed 'abc' (NaN) → expect 3
      (d) returns 3 when stubbed '0' (non-positive) → expect 3
      (e) returns 3 when stubbed '-5' (negative) → expect 3
      (f) returns a stubbed integer value when stubbed '7' → expect 7 (sanity)
  - IMPORT: `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';`
  - IMPORT: `import { ISSUE_RETRY_MAX, DEFAULT_ISSUE_RETRY_MAX, getIssueRetryMax } from '../../../src/config/constants.js';`
  - FOLLOW pattern: tests/unit/config/research-timeout.test.ts (the SETUP/EXECUTE/VERIFY comment rhythm; `beforeEach` env reset; relative `../../../src/...js` import). It is a near-exact clone.
  - NAMING: file `issue-retry-max.test.ts`; describe block `'config/constants: getIssueRetryMax'`; test titles like `'(a) returns 3 when env unset'`.
  - MOCKING: vi.stubEnv(ISSUE_RETRY_MAX, '<value>') per case; afterEach(() => vi.unstubAllEnvs()); beforeEach(() => delete process.env.ISSUE_RETRY_MAX). NO file/network mocks.
  - VERIFY IT FAILS FIRST: run `npm run test:run -- issue-retry-max` BEFORE Task 2; it must fail (getIssueRetryMax / ISSUE_RETRY_MAX / DEFAULT_ISSUE_RETRY_MAX not exported yet). This is the RED step.
  - PLACEMENT: tests/unit/config/issue-retry-max.test.ts

Task 2: MODIFY src/config/constants.ts  (add consts + reader — makes Task 1 GREEN)
  - ADD (at end of file, immediately AFTER the getResearchTimeoutSeconds() function, in the same
      "Resilience Tuning" section; update the section header comment to cite §4.2 AND §4.5 AND §9.2.2):
      /**
       * Environment variable name: max issue-driven re-planning attempts per item (PRD §4.5, §9.2.2).
       *
       * @remarks
       * Bounds the issue-driven re-planning loop (PRD §4.5): after this many issue outcomes
       * (recoverable PRP gaps re-researched with feedback), the item hard-fails. This is a SEPARATE
       * retry dimension from TaskRetryManager (transient infra errors) — see implementation_notes.md §3.
       * The VALUE of this variable is read at runtime via getIssueRetryMax().
       *
       * @example
       * ```ts
       * import { ISSUE_RETRY_MAX } from './config/constants.js';
       *
       * console.log(ISSUE_RETRY_MAX); // 'ISSUE_RETRY_MAX'
       * console.log(process.env[ISSUE_RETRY_MAX]); // e.g. '3'
       * ```
       */
      export const ISSUE_RETRY_MAX = 'ISSUE_RETRY_MAX';
      /**
       * Default max issue-driven re-planning attempts per item before hard-fail (PRD §4.5).
       *
       * @remarks
       * When the ISSUE_RETRY_MAX env var is unset or invalid, this value is used.
       *
       * @example
       * ```ts
       * import { DEFAULT_ISSUE_RETRY_MAX } from './config/constants.js';
       *
       * console.log(DEFAULT_ISSUE_RETRY_MAX); // 3
       * ```
       */
      export const DEFAULT_ISSUE_RETRY_MAX = 3;
      /**
       * Read & validate the ISSUE_RETRY_MAX env var (PRD §4.5, §9.2.2).
       *
       * @returns The configured max re-planning attempts, or DEFAULT_ISSUE_RETRY_MAX
       *          when unset, non-numeric, or non-positive.
       *
       * @example
       * ```ts
       * import { getIssueRetryMax } from './config/constants.js';
       *
       * const max = getIssueRetryMax(); // 3 (default)
       * ```
       */
      export function getIssueRetryMax(): number {
        const raw = Number(
          process.env[ISSUE_RETRY_MAX] ?? DEFAULT_ISSUE_RETRY_MAX
        );
        if (Number.isNaN(raw) || raw <= 0) {
          return DEFAULT_ISSUE_RETRY_MAX;
        }
        return raw;
      }
  - FOLLOW pattern: the `RESEARCH_TIMEOUT` + `DEFAULT_RESEARCH_TIMEOUT_SECONDS` + `getResearchTimeoutSeconds()` trio (already in the file). Same JSDoc style with `@remarks`/`@example`, same bare-string-name shape, same `??` + `Number.isNaN` + `<= 0` guard.
  - NAMING: ISSUE_RETRY_MAX (SCREAMING_SNAKE string), DEFAULT_ISSUE_RETRY_MAX (SCREAMING_SNAKE number, NO unit suffix), getIssueRetryMax (camelCase function).
  - DEPENDENCIES: none new — pure stdlib (`process.env`, `Number`, `Number.isNaN`).
  - PLACEMENT: src/config/constants.ts, appended after the getResearchTimeoutSeconds() function.
  - GOTCHA: Do NOT modify configureEnvironment() in environment.ts. Do NOT add a ConfigService. Do NOT touch task-retry-manager.ts.

Task 3: MODIFY docs/CONFIGURATION.md  (Mode A doc-with-work — add a row + update intro line)
  - STEP 3a: UPDATE the "### Resilience Tuning" subsection intro line (S1 wrote it referencing only §4.2 + §9.2.2). Change:
      "Tune execution-loop resilience knobs. See PRD §4.2 (deadline & fallback) and §9.2.2."
      to:
      "Tune execution-loop resilience knobs. See PRD §4.2 (deadline & fallback), §4.5 (issue-driven re-planning), and §9.2.2."
    (Rationale: the subsection now covers BOTH the §4.2 deadline knob and the §4.5 re-planning knob, so the intro should name both.)
  - STEP 3b: ADD a second ROW to the EXISTING "Resilience Tuning" table (right after the `RESEARCH_TIMEOUT` row):
      | `ISSUE_RETRY_MAX`  | No       | `3`     | Maximum number of issue-driven re-planning attempts per item before it hard-fails. See PRD §4.5. |
  - FOLLOW pattern: copy the exact markdown table style of the existing "Resilience Tuning" table (one row up) — same `No` / backtick-wrapped default, same column structure.
  - GOTCHA: prettier (npm run format:check) checks docs/*.md and may reformat the table alignment. After editing, run `npm run format` (writes) THEN `npm run validate` so the final form is prettier-compliant. markdownlint (npm run docs:lint) also runs on docs/**/*.md — keep the table consistent (no blank lines inside the block).
  - PLACEMENT: docs/CONFIGURATION.md, in the existing "### Resilience Tuning" subsection.
  - CROSS-REF: description must mention "PRD §4.5" (the issue-driven re-planning narrative lives there).

Task 4: VERIFY (validation gates — run after Task 2 and Task 3)
  - RUN: `npm run validate` (eslint . --ext .ts + prettier --check + tsc --noEmit) — expect zero errors.
      If prettier --check fails on CONFIGURATION.md, run `npm run format` (writes) then re-run `npm run validate`.
  - RUN: `npm run test:run` (vitest run) — expect all green incl. the 6 new cases in Task 1.
  - RUN: `npm run docs:lint` — expect zero markdownlint errors on CONFIGURATION.md.
  - GREP-VERIFY no regression: `git diff src/config/environment.ts src/core/task-retry-manager.ts` must be EMPTY (both untouched).
```

### Implementation Patterns & Key Details

```typescript
// === PATTERN: the reader helper (the one non-trivial piece) ===
// Clone the RESEARCH_TIMEOUT reader shape exactly, rename, change the default to 3, and adjust
// the semantics in JSDoc. Keep it pure — no side effects, no I/O, no logging.

export const ISSUE_RETRY_MAX = 'ISSUE_RETRY_MAX';
export const DEFAULT_ISSUE_RETRY_MAX = 3;

export function getIssueRetryMax(): number {
  // `??` (not `||`): empty-string '' is a real value we must reject via the parse, not coerce here.
  // Number('') === 0, Number(undefined) === NaN, Number('abc') === NaN.
  const raw = Number(process.env[ISSUE_RETRY_MAX] ?? DEFAULT_ISSUE_RETRY_MAX);
  // Guard BOTH NaN AND non-positive: 0 or negative makes no sense as a re-planning bound.
  // (Contract: "default on NaN/non-positive" — identical idiom to getResearchTimeoutSeconds.)
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_ISSUE_RETRY_MAX;
  }
  return raw;
}

// === PATTERN: consumer usage (S4 will do this — shown for boundary clarity, DO NOT implement now) ===
//   import { getIssueRetryMax } from '../config/constants.js';
//   let issueAttempts = 0;
//   while (issueAttempts < getIssueRetryMax()) { /* re-research with feedback */ }
```

```typescript
// === PATTERN: test skeleton (clone research-timeout.test.ts rhythm) ===
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ISSUE_RETRY_MAX,
  ISSUE_RETRY_MAX,
  getIssueRetryMax,
} from '../../../src/config/constants.js';

describe('config/constants: getIssueRetryMax', () => {
  beforeEach(() => {
    delete process.env.ISSUE_RETRY_MAX;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) returns the default (3) when env var is unset', () => {
    expect(getIssueRetryMax()).toBe(DEFAULT_ISSUE_RETRY_MAX); // 3
  });

  it('(b) honors a stubbed positive integer', () => {
    vi.stubEnv(ISSUE_RETRY_MAX, '5');
    expect(getIssueRetryMax()).toBe(5);
  });

  // ... (c) NaN 'abc' → 3, (d) '0' → 3, (e) '-5' → 3, (f) '7' → 7
});
```

### Integration Points

```yaml
CONFIG (the change):
  - add to: src/config/constants.ts
  - pattern: "export const ISSUE_RETRY_MAX = 'ISSUE_RETRY_MAX';" (mirrors RESEARCH_TIMEOUT)
  - pattern: "export function getIssueRetryMax(): number { ... }" (mirrors getResearchTimeoutSeconds)

DOCUMENTATION (Mode A, rides with the work):
  - add to: docs/CONFIGURATION.md
  - pattern: a new ROW in the EXISTING "### Resilience Tuning" table + intro line updated to cite §4.5.

NOT TOUCHED (scope guardrails):
  - src/config/environment.ts          # configureEnvironment() unchanged
  - src/core/task-retry-manager.ts     # DIFFERENT retry dimension (implementation_notes.md §3)
  - src/core/research-queue.ts         # P5.M1.T1.S2/S3 territory (parallel, zero overlap)
  - src/core/task-orchestrator.ts      # P5.M1.T1.S3 + P5.M1.T2.S4 territory (parallel, zero overlap)

FUTURE CONSUMERS (informational — do NOT implement in this subtask):
  - P5.M1.T2.S2: extends ExecutionResult to a tri-state (success/fail/issue).
  - P5.M1.T2.S3: injects issue_feedback into the blueprint prompt + PRPGenerator.
  - P5.M1.T2.S4: orchestrator issue-handling flow — the FIRST caller of getIssueRetryMax().
                 Maintains a per-item counter, resets to Planned + re-researches with feedback on
                 `issue`, hard-fails after getIssueRetryMax() attempts.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After Task 2 (edit constants.ts):
npm run validate
# = eslint . --ext .ts && prettier --check "**/*.{ts,js,json,md,yml,yaml}" && tsc --noEmit
# Expected: zero errors. If eslint complains about the new function, check JSDoc completeness
# (eslint rules require @returns on exported functions — already provided in Task 2).

# After Task 3 (edit CONFIGURATION.md) — prettier checks docs/*.md, so it may reformat the table:
npm run format        # WRITES the prettier-compliant form (safe; run before re-validating)
npm run validate      # re-check; expect zero errors.
npm run docs:lint     # markdownlint on docs/**/*.md
# Expected: zero errors. Common failure: misaligned table pipes — running `npm run format` first avoids it.
```

### Level 2: Unit Tests (Component Validation)

```bash
# RED step (after Task 1, before Task 2) — MUST fail first (TDD):
npm run test:run -- issue-retry-max
# Expected: failure (getIssueRetryMax / ISSUE_RETRY_MAX / DEFAULT_ISSUE_RETRY_MAX not exported). This confirms the test actually exercises new code.

# GREEN step (after Task 2):
npm run test:run -- issue-retry-max
# Expected: all 6 cases pass.

# Full suite (ensure no stub leakage broke sibling config tests — esp. research-timeout.test.ts):
npm run test:run
# Expected: all green. If environment.test.ts or research-timeout.test.ts now fail, vi.unstubAllEnvs()
# is missing or the beforeEach env-delete is missing in issue-retry-max.test.ts.
```

### Level 3: Integration Testing (System Validation)

```bash
# Smoke-check the reader behaves end-to-end with a real (non-vitest) process.env:
ISSUE_RETRY_MAX=5 node --input-type=module -e "import('./src/config/constants.js').then(m => console.log(m.getIssueRetryMax()))"
# Expected: 5

ISSUE_RETRY_MAX= node --input-type=module -e "import('./src/config/constants.js').then(m => console.log(m.getIssueRetryMax()))"
# Expected: 3  (empty string → 0 → non-positive → default)

unset ISSUE_RETRY_MAX; node --input-type=module -e "import('./src/config/constants.js').then(m => console.log(m.getIssueRetryMax()))"
# Expected: 3  (unset → default)

ISSUE_RETRY_MAX=garbage node --input-type=module -e "import('./src/config/constants.js').then(m => console.log(m.getIssueRetryMax()))"
# Expected: 3  (NaN → default)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Scope-guard regression check — confirm we did NOT over-reach into environment.ts / retry-manager:
git diff --stat
# Expected: ONLY src/config/constants.ts, tests/unit/config/issue-retry-max.test.ts, docs/CONFIGURATION.md changed.

git diff src/config/environment.ts src/core/task-retry-manager.ts
# Expected: EMPTY (no changes to either — retry-manager is a different retry dimension).

# Boundary check — confirm the future consumer contract is real (symbol exists & is typed number):
node --input-type=module -e "import('./src/config/constants.js').then(m => { console.log(typeof m.getIssueRetryMax()); console.log(m.ISSUE_RETRY_MAX, m.DEFAULT_ISSUE_RETRY_MAX); })"
# Expected: 'number'  then  'ISSUE_RETRY_MAX' 3

# Docs-row check — confirm the row + the §4.5 intro reference are present:
grep -n "ISSUE_RETRY_MAX\|§4.5" docs/CONFIGURATION.md
# Expected: at least two matches — the intro line (§4.5) and the ISSUE_RETRY_MAX table row.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` passes (eslint + prettier --check + tsc --noEmit, zero errors).
- [ ] `npm run test:run` passes (all tests green; the 6 new cases in `issue-retry-max.test.ts` included).
- [ ] `npm run docs:lint` passes (CONFIGURATION.md markdownlint clean).
- [ ] RED step observed before GREEN (test failed before implementation — TDD).

### Feature Validation

- [ ] `ISSUE_RETRY_MAX` (string `'ISSUE_RETRY_MAX'`) and `DEFAULT_ISSUE_RETRY_MAX` (`3`) exported from `src/config/constants.ts`.
- [ ] `getIssueRetryMax()` returns `3` when env unset/NaN/non-positive; returns the parsed value otherwise.
- [ ] `configureEnvironment()` in `src/config/environment.ts` is **unchanged** (`git diff` empty).
- [ ] `src/core/task-retry-manager.ts` is **unchanged** (different retry dimension).
- [ ] No `ConfigService` introduced (grep `ConfigService` in src/ returns nothing new).
- [ ] `docs/CONFIGURATION.md` has an `ISSUE_RETRY_MAX` row in the existing "Resilience Tuning" table (default `3`, cross-ref PRD §4.5), and the subsection intro references §4.5.

### Code Quality Validation

- [ ] Follows the `RESEARCH_TIMEOUT` precedent exactly (bare-string name const + typed default const + guarded reader; same `??` + `Number.isNaN` + `<= 0` idiom).
- [ ] Default const has NO unit suffix (`DEFAULT_ISSUE_RETRY_MAX`, a dimensionless count).
- [ ] JSDoc on all three new exports (`@remarks`/`@returns`/`@example` matching the file's existing style); §4.5 + retry-dimension note in the const's `@remarks`.
- [ ] File placement matches the desired tree (`constants.ts` edited, `issue-retry-max.test.ts` added, `CONFIGURATION.md` edited).
- [ ] ESM import specifiers use `.js` extensions in the test file.
- [ ] `vi.stubEnv` paired with `vi.unstubAllEnvs()` (no test-bleed).

### Documentation & Deployment

- [ ] Env-var reference table row is accurate and discoverable (added to the existing "Resilience Tuning" subsection).
- [ ] Description row states semantics ("Maximum number of issue-driven re-planning attempts per item before it hard-fails") and cross-refs PRD §4.5.
- [ ] Subsection intro line references both §4.2 and §4.5 (covers both resilience knobs).

---

## Anti-Patterns to Avoid

- ❌ Don't add `ISSUE_RETRY_MAX` normalization to `configureEnvironment()` — there is no ConfigService and the contract forbids it.
- ❌ Don't conflate `ISSUE_RETRY_MAX` with `TaskRetryManager.maxAttempts` — they are DIFFERENT retry dimensions (re-planning vs transient infra errors; implementation_notes.md §3). Do NOT touch `task-retry-manager.ts`.
- ❌ Don't use `||` instead of `??` — `Number('')` must reach the guard, not be short-circuited.
- ❌ Don't forget the `<= 0` guard — `0` parses cleanly but is a meaningless re-planning bound (contract: "default on non-positive").
- ❌ Don't add a unit suffix to `DEFAULT_ISSUE_RETRY_MAX` (e.g. `_COUNT`) — it is a dimensionless count; the item + implementation_notes.md §1 mandate the bare name. (Contrast `DEFAULT_RESEARCH_TIMEOUT_SECONDS` which legitimately carries `_SECONDS`.)
- ❌ Don't write the implementation before the failing test (breaks implicit-TDD).
- ❌ Don't start S2/S3/S4 work (ExecutionResult tri-state / issue_feedback injection / orchestrator counter) — that is out of scope for this 1-point subtask and will collide with sibling subtasks.
- ❌ Don't split into a `resilience.ts` module yet — `constants.ts` is the established home (and the `RESEARCH_TIMEOUT` precedent is already there).
- ❌ Don't catch all exceptions — the reader uses `Number.isNaN`/`<= 0` guards, not try/catch (the parse itself never throws).
- ❌ Don't use `.ts` import specifiers in the test file — ESM requires `.js` (tsc/vitest resolve via moduleResolution).
- ❌ Don't hand-align the docs table and assume prettier accepts it — run `npm run format` after editing `docs/CONFIGURATION.md`, then `npm run validate`.

---

## Success Metrics

**Confidence Score: 9/10** — This is a small, tightly-scoped config subtask with an EXACT in-repo precedent (`RESEARCH_TIMEOUT`, already merged in the same file), a fully-specified contract (the item names every symbol + value + the docs row semantics + the retry-dimension caveat), and deterministic validation gates. It is a literal copy-paste-tweak of the `RESEARCH_TIMEOUT` reader and a near-exact clone of `research-timeout.test.ts`. The only residual risks are: (a) a markdownlint/prettier alignment nit on the docs table (Level 1 catches it — mitigated by running `npm run format` before `validate`); (b) `vi.unstubAllEnvs()` discipline to avoid test-bleed into the sibling `research-timeout.test.ts` (Level 2 catches any bleed); (c) resisting the temptation to touch `task-retry-manager.ts` (the §3 retry-dimension rule + the `git diff` scope check guard against it). One-pass success is highly likely.
