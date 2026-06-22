# PRP — P5.M1.T1.S1: Add `RESEARCH_TIMEOUT` config constant + default

## Goal

**Feature Goal**: Add the `RESEARCH_TIMEOUT` environment-variable name constant, its default value constant (`300` seconds), and a small `getResearchTimeoutSeconds()` reader helper to `src/config/constants.ts`, plus a Mode-A docs row. This is the foundational config layer consumed by the later subtasks S2 (deadline-wrap `waitForPRP`) and S3 (synchronous re-research fallback) of Task 5.1.1.

**Deliverable**:
1. `export const RESEARCH_TIMEOUT = 'RESEARCH_TIMEOUT';` — the env-var **name** (bare string).
2. `export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300;` — the default value.
3. `export function getResearchTimeoutSeconds(): number` — reader helper that reads `process.env[RESEARCH_TIMEOUT]`, parses, and falls back to the default on `NaN`/non-positive.
4. A new failing-first test file `tests/unit/config/research-timeout.test.ts` (TDD).
5. A new **"Resilience Tuning"** subsection + `RESEARCH_TIMEOUT` row in `docs/CONFIGURATION.md` (Mode A doc-with-work).

**Success Definition**: `npm run validate` (eslint + prettier --check + tsc --noEmit) and `npm run test:run` (vitest run) are both green; the reader returns `300` by default and honors a `vi.stubEnv`-stubbed value; the docs row exists and references PRD §4.2.

## Why

- **Business value**: The Execution Loop (PRD §4.2) runs "Parallel Research" — a background thread researches task N+1 while task N implements. Without a deadline, a single hung/crashed research agent stalls the whole pipeline forever. `RESEARCH_TIMEOUT` (default 5 min / 300s) is the guard: after it elapses the orchestrator abandons the background work and re-researches synchronously, inline.
- **Scope boundary**: This subtask ships **only the config layer** (constant + default + reader + docs). It does NOT touch the research queue or orchestrator. S2 (2 pts) wraps `ResearchQueue.waitForPRP` in the deadline; S3 (2 pts) adds the orchestrator's synchronous fallback. Both consume `getResearchTimeoutSeconds()`.
- **Scope cohesion**: `ISSUE_RETRY_MAX` (P5.M1.T2.S1) follows the **exact same** config pattern in the same file — keep this subtask minimal and parallel in shape so T2.S1 is a copy-paste-tweak.

## What

### User-visible behavior

None directly — this is a config/infra layer. The observable effect is that the future `RESEARCH_TIMEOUT` env var becomes a recognized, documented, test-backed configuration knob, defaulting to 300 seconds when unset or invalid.

### Technical requirements (the CONTRACT)

1. **No `ConfigService`.** There is no `ConfigService` class anywhere in the codebase. `src/config/environment.ts` is a set of **standalone functions**. Do **NOT** add normalization to `configureEnvironment()`. Follow the Session-004 `PRP_AGENT_HARNESS` precedent exactly.
2. **Constants are bare strings** (env-var name) + a typed default. No enum, no map, no registry.
3. **Reader helper** is a standalone exported function in the same file. It must guard against `NaN` and non-positive values (defensive parse).
4. **TDD**: write the failing test first, then implement.
5. **Mode A docs**: docs this subtask directly touches (the env-var reference) are updated **inside** this subtask via a `DOCS:` line — no separate doc subtask.

### Success Criteria

- [ ] `RESEARCH_TIMEOUT` and `DEFAULT_RESEARCH_TIMEOUT_SECONDS` are exported from `src/config/constants.ts` with the exact names and values above.
- [ ] `getResearchTimeoutSeconds()` is exported from `src/config/constants.ts` and returns `300` when the env var is unset.
- [ ] `getResearchTimeoutSeconds()` returns a stubbed value (e.g. `120`) when `vi.stubEnv(RESEARCH_TIMEOUT, '120')` is used.
- [ ] `getResearchTimeoutSeconds()` returns the default `300` when the env var is `NaN` (e.g. `'abc'`) or non-positive (e.g. `'0'`, `'-5'`).
- [ ] `configureEnvironment()` is **not** modified (grep-verify no new lines there).
- [ ] `docs/CONFIGURATION.md` has a `RESEARCH_TIMEOUT` row (default 300, cross-ref PRD §4.2).
- [ ] `npm run validate` passes (zero errors).
- [ ] `npm run test:run` passes (all tests green, new tests included).

## All Needed Context

### Context Completeness Check

_Pass_: An agent with zero codebase knowledge can implement this from the `PRP_AGENT_HARNESS` precedent (fully quoted below), the test pattern (fully quoted below), the docs table location (with exact line refs), and the validation commands. No inference required.

### Documentation & References

```yaml
# MUST READ — the exact precedent this subtask clones (Session 004)
- file: src/config/constants.ts
  why: PRP_AGENT_HARNESS (bare-string name const) + DEFAULT_HARNESS (`as const` default) is the ONE pattern to copy.
  pattern: |
    export const PRP_AGENT_HARNESS = 'PRP_AGENT_HARNESS';
    export const DEFAULT_HARNESS = 'pi' as const;
  gotcha: The const value IS the env-var name string; `process.env[PRP_AGENT_HARNESS]` indexes process.env by that name. Do NOT mistake it for the resolved value.
  placement: Add the new consts immediately AFTER the `SUPPORTED_HARNESSES` block (end of current file), grouped under a new JSDoc'd "Resilience Tuning" section header.

# MUST READ — the consumer reads inline; here we ADD a helper instead
- file: src/config/harness.ts
  why: Shows how Session 004 consumed the const: `const raw = process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS;` (line ~58).
  pattern: Consumer-side read via `process.env[NAME] ?? DEFAULT`.
  gotcha: S2/S3 will NOT read process.env directly — they will call `getResearchTimeoutSeconds()`. The helper centralizes the parse+guard so the consumer stays simple.

# MUST READ — exact test conventions (vi.stubEnv / SETUP-EXECUTE-VERIFY style)
- file: tests/unit/config/harness-config.test.ts
  why: Canonical config test: imports from `vitest`; `describe('config/harness', ...)`; `beforeEach` resets env (`delete process.env.X` + `vi.stubEnv` for deps); SETUP/EXECUTE/VERIFY comment rhythm; relative import `../../../src/config/...js` (note the `.js` extension for ESM TS).
  pattern: |
    import { beforeEach, describe, expect, it, vi } from 'vitest';
    beforeEach(() => { delete process.env.RESEARCH_TIMEOUT; });
    vi.stubEnv(RESEARCH_TIMEOUT, '120');
    // ... assertions ...
    afterEach(() => vi.unstubAllEnvs());
  gotcha: vi.stubEnv must be paired with vi.unstubAllEnvs() (in afterEach) or leaked stubs break other tests. Also delete the env var in beforeEach for the "unset" case.

# MUST READ — docs Mode A target
- file: docs/CONFIGURATION.md
  why: Add a NEW "### Resilience Tuning" subsection (it does NOT exist yet) between "### Pipeline Control" and "### Bug Hunt Configuration", mirroring the PRD §9.2.2 group ordering. Insert one table row.
  pattern: Existing tables use this markdown format (align with `| ---- |` underlines; see the `PRP_AGENT_HARNESS` row at line ~97 and the Pipeline Control table at line ~120):
    | `RESEARCH_TIMEOUT` | No | `300` | Deadline in seconds for background (parallel) research before falling back to synchronous re-research. See PRD §4.2. |
  gotcha: markdownlint (`npm run docs:lint`) runs on docs/**/*.md. Keep the pipe table aligned and the column count consistent with the header row. Do NOT add a trailing blank line inside the table block.

# Reference — what this config ENABLES (do NOT implement here)
- file: plan/005_d32a2ecf61cd/architecture/implementation_notes.md
  why: §1 (config pattern) confirms the exact const shape; §4 (waitForPRP) confirms S2/S3 will consume getResearchTimeoutSeconds(). Read to respect the boundary — do not start S2/S3 work.
  section: "§1 Config pattern" and "§4 waitForPRP"

- file: plan/005_d32a2ecf61cd/architecture/system_context.md
  why: "Config Pattern" section + validation-gate definitions (`npm run validate` / `npm run test:run`). Confirms NO ConfigService and NO `Ready` status (the latter is irrelevant here but sets scope discipline).
  section: "Config Pattern" and "Validation gates (run after every subtask)"
```

### Current Codebase tree (relevant slice)

```bash
src/config/
├── constants.ts        # <-- EDIT: add 2 consts + getResearchTimeoutSeconds() reader
├── environment.ts      # <-- DO NOT TOUCH (standalone fns; no ConfigService)
├── harness.ts          # <-- DO NOT TOUCH (PRP_AGENT_HARNESS consumer; reference only)
├── endpoint-guard.ts   # <-- DO NOT TOUCH
└── types.ts            # <-- DO NOT TOUCH

tests/unit/config/
├── endpoint-guard.test.ts
├── environment.test.ts
├── harness-config.test.ts     # <-- REFERENCE: canonical test style to clone
├── harness-provider-compat.test.ts
└── harness.test.ts

docs/
└── CONFIGURATION.md    # <-- EDIT: add "Resilience Tuning" subsection + RESEARCH_TIMEOUT row
```

### Desired Codebase tree with files to be added

```bash
src/config/
└── constants.ts        # MODIFIED: + RESEARCH_TIMEOUT, + DEFAULT_RESEARCH_TIMEOUT_SECONDS, + getResearchTimeoutSeconds()

tests/unit/config/
└── research-timeout.test.ts   # NEW: failing-first unit tests for the reader helper

docs/
└── CONFIGURATION.md    # MODIFIED: + "### Resilience Tuning" subsection with RESEARCH_TIMEOUT row
```

> **File-placement decision**: Put the consts + helper in `src/config/constants.ts` (not a new `resilience.ts`). Rationale: (a) exact `PRP_AGENT_HARNESS` precedent lives in `constants.ts`; (b) keeps all env-var name consts in one file for `process.env[NAME]` indexing discoverability; (c) `ISSUE_RETRY_MAX` (T2.S1) will land here too, giving "resilience consts" a natural co-located home. The contract explicitly permits `constants.ts` as the primary location. Re-evaluate splitting to `resilience.ts` ONLY if the file grows beyond ~250 lines.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: There is NO ConfigService class. Do NOT add a registry, enum, or
// configureEnvironment() normalization. The pattern is: bare-string name const
// + default const + consumer-side read. (system_context.md "Config Pattern".)

// CRITICAL: TS ESM source uses `.js` import specifiers even in .ts files.
//   WRONG: import { RESEARCH_TIMEOUT } from './constants';
//   RIGHT: import { RESEARCH_TIMEOUT } from './config/constants.js';
// (vitest + tsc both resolve the .js→.ts mapping via tsconfig "moduleResolution".)

// GOTCHA: `process.env[X]` is typed `string | undefined`. The reader MUST:
//   - use `??` (nullish coalescing), NOT `||` — empty string '' is a real (if invalid) value.
//   - guard `Number('')` which is `0` (not NaN) → treat 0 as non-positive → return default.
//   - guard `Number(undefined)` which is `NaN`, and `Number('abc')` which is `NaN`.

// GOTCHA: vi.stubEnv does NOT reset between files. ALWAYS pair with
//   afterEach(() => vi.unstubAllEnvs()) AND beforeEach(() => delete process.env.RESEARCH_TIMEOUT)
//   or the stubbed '120' leaks into sibling config tests (e.g. environment.test.ts).

// GOTCHA: markdownlint (npm run docs:lint) enforces table formatting. Match the
// existing pipe-alignment of the "Pipeline Control" table (line ~120) character-for-character.
```

## Implementation Blueprint

### Data models and structure

No data models — this subtask adds **two const primitives** and **one pure function**. Type safety comes from `as const` on the default and an explicit `: number` return annotation on the reader.

```typescript
// The ONLY new "model" — a typed default and a guarded numeric reader.
export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300; // plain number (see contract: 300)
// (RESEARCH_TIMEOUT is a bare string name — see Task 1.)
```

### Implementation Tasks (ordered by dependencies — strict TDD)

```yaml
Task 1: WRITE tests/unit/config/research-timeout.test.ts  (FAILING-FIRST — do this before Task 2)
  - IMPLEMENT: a `describe('config/constants: getResearchTimeoutSeconds', ...)` block with these cases:
      (a) returns DEFAULT (300) when process.env.RESEARCH_TIMEOUT is unset
      (b) returns the stubbed numeric value when vi.stubEnv(RESEARCH_TIMEOUT, '120') → expect 120
      (c) returns 300 when stubbed 'abc' (NaN) → expect 300
      (d) returns 300 when stubbed '0' (non-positive) → expect 300
      (e) returns 300 when stubbed '-5' (negative) → expect 300
      (f) returns a fractional/integer value when stubbed '150' → expect 150 (sanity)
  - IMPORT: `import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';`
  - IMPORT: `import { RESEARCH_TIMEOUT, DEFAULT_RESEARCH_TIMEOUT_SECONDS, getResearchTimeoutSeconds } from '../../../src/config/constants.js';`
  - FOLLOW pattern: tests/unit/config/harness-config.test.ts (the SETUP/EXECUTE/VERIFY comment rhythm; `beforeEach` env reset; relative `../../../src/...js` import).
  - NAMING: file `research-timeout.test.ts`; describe block `'config/constants: getResearchTimeoutSeconds'`; test titles like `'(a) returns 300 when env unset'`.
  - MOCKING: vi.stubEnv(RESEARCH_TIMEOUT, '<value>') per case; afterEach(() => vi.unstubAllEnvs()); beforeEach(() => delete process.env.RESEARCH_TIMEOUT). NO file/network mocks.
  - VERIFY IT FAILS FIRST: run `npm run test:run -- research-timeout` BEFORE Task 2; it must fail to compile/run (getResearchTimeoutSeconds not exported yet). This is the RED step.
  - PLACEMENT: tests/unit/config/research-timeout.test.ts

Task 2: MODIFY src/config/constants.ts  (add consts + reader — makes Task 1 GREEN)
  - ADD (at end of file, under a new JSDoc'd section header comment):
      /**
       * Environment variable name: deadline (seconds) for background research (PRD §4.2, §9.2.2).
       * @remarks The VALUE is read at runtime via getResearchTimeoutSeconds().
       */
      export const RESEARCH_TIMEOUT = 'RESEARCH_TIMEOUT';
      /**
       * Default deadline (300s = 5min) for background research before synchronous fallback (PRD §4.2).
       */
      export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300;
      /**
       * Read & validate the RESEARCH_TIMEOUT env var (PRD §4.2, §9.2.2).
       * @returns The configured deadline in seconds, or DEFAULT_RESEARCH_TIMEOUT_SECONDS
       *          when unset, non-numeric, or non-positive.
       */
      export function getResearchTimeoutSeconds(): number {
        const raw = Number(process.env[RESEARCH_TIMEOUT] ?? DEFAULT_RESEARCH_TIMEOUT_SECONDS);
        if (Number.isNaN(raw) || raw <= 0) {
          return DEFAULT_RESEARCH_TIMEOUT_SECONDS;
        }
        return raw;
      }
  - FOLLOW pattern: the `PRP_AGENT_HARNESS` + `DEFAULT_HARNESS` pair (lines ~88-98 of constants.ts) — same JSDoc style with `@example`, same bare-string-name shape.
  - NAMING: RESEARCH_TIMEOUT (SCREAMING_SNAKE string), DEFAULT_RESEARCH_TIMEOUT_SECONDS (SCREAMING_SNAKE number), getResearchTimeoutSeconds (camelCase function).
  - DEPENDENCIES: none new — pure stdlib (`process.env`, `Number`, `Number.isNaN`).
  - PLACEMENT: src/config/constants.ts, appended after the `SUPPORTED_HARNESSES` export.
  - GOTCHA: Do NOT modify configureEnvironment() in environment.ts. Do NOT add a ConfigService.

Task 3: MODIFY docs/CONFIGURATION.md  (Mode A doc-with-work — new subsection + row)
  - ADD a new "### Resilience Tuning" subsection positioned BETWEEN "### Pipeline Control"
    (ends ~line 124) and "### Bug Hunt Configuration" (~line 128). PRD §9.2.2 group order is:
    Pipeline Control → Resilience Tuning → Bug Hunt Configuration.
  - CONTENT:
      ### Resilience Tuning

      Tune execution-loop resilience knobs. See PRD §4.2 (deadline & fallback) and §9.2.2.

      | Variable          | Required | Default | Description                                                                                                          |
      | ----------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
      | `RESEARCH_TIMEOUT` | No       | `300`   | Deadline in seconds for background (parallel) research before falling back to synchronous re-research inline. See PRD §4.2. |
  - FOLLOW pattern: copy the exact markdown table style of the "Pipeline Control" table (line ~120) — same column widths/alignment, same `No` / backtick-wrapped default.
  - GOTCHA: `npm run docs:lint` (markdownlint) runs on docs/**/*.md. Keep table pipes aligned; no blank lines inside the table; leave a blank line before `###` and after the table.
  - PLACEMENT: docs/CONFIGURATION.md, between the Pipeline Control and Bug Hunt Configuration subsections.
  - CROSS-REF: description must mention "PRD §4.2" (the deadline/fallback narrative lives there).

Task 4: VERIFY (validation gates — run after Task 2 and Task 3)
  - RUN: `npm run validate` (eslint . --ext .ts + prettier --check + tsc --noEmit) — expect zero errors.
  - RUN: `npm run test:run` (vitest run) — expect all green incl. the 6 new cases in Task 1.
  - RUN: `npm run docs:lint` — expect zero markdownlint errors on CONFIGURATION.md.
  - GREP-VERIFY no regression: `grep -n "RESEARCH_TIMEOUT" src/config/environment.ts` must return NOTHING (environment.ts untouched).
```

### Implementation Patterns & Key Details

```typescript
// === PATTERN: the reader helper (the one non-trivial piece) ===
// Clone the PRP_AGENT_HARNESS "name const + default const" shape, then add ONE
// guarded reader. Keep it pure, no side effects, no I/O, no logging.

export const RESEARCH_TIMEOUT = 'RESEARCH_TIMEOUT';
export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300;

export function getResearchTimeoutSeconds(): number {
  // `??` (not `||`): empty-string '' is a real value we must reject via the parse, not coerce to default here.
  // Number('') === 0, Number(undefined) === NaN, Number('abc') === NaN.
  const raw = Number(process.env[RESEARCH_TIMEOUT] ?? DEFAULT_RESEARCH_TIMEOUT_SECONDS);
  // Guard BOTH NaN AND non-positive: 0 or negative makes no sense as a deadline.
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_RESEARCH_TIMEOUT_SECONDS;
  }
  return raw;
}

// === PATTERN: consumer usage (S2/S3 will do this — shown for boundary clarity, DO NOT implement now) ===
//   import { getResearchTimeoutSeconds } from '../config/constants.js';
//   const deadlineMs = getResearchTimeoutSeconds() * 1000;
//   await Promise.race([waitForPRP(taskId), sleep(deadlineMs)]);
```

```typescript
// === PATTERN: test skeleton (clone harness-config.test.ts rhythm) ===
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RESEARCH_TIMEOUT_SECONDS,
  RESEARCH_TIMEOUT,
  getResearchTimeoutSeconds,
} from '../../../src/config/constants.js';

describe('config/constants: getResearchTimeoutSeconds', () => {
  beforeEach(() => {
    delete process.env.RESEARCH_TIMEOUT;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) returns the default (300) when env var is unset', () => {
    expect(getResearchTimeoutSeconds()).toBe(DEFAULT_RESEARCH_TIMEOUT_SECONDS); // 300
  });

  it('(b) honors a stubbed positive integer', () => {
    vi.stubEnv(RESEARCH_TIMEOUT, '120');
    expect(getResearchTimeoutSeconds()).toBe(120);
  });

  // ... (c) NaN 'abc' → 300, (d) '0' → 300, (e) '-5' → 300, (f) '150' → 150
});
```

### Integration Points

```yaml
CONFIG (the change):
  - add to: src/config/constants.ts
  - pattern: "export const RESEARCH_TIMEOUT = 'RESEARCH_TIMEOUT';" (mirrors PRP_AGENT_HARNESS)
  - pattern: "export function getResearchTimeoutSeconds(): number { ... }" (NEW — no precedent reader, but contract-mandated)

DOCUMENTATION (Mode A, rides with the work):
  - add to: docs/CONFIGURATION.md
  - pattern: new "### Resilience Tuning" subsection with one table row, cross-ref PRD §4.2.

NOT TOUCHED (scope guardrails):
  - src/config/environment.ts      # configureEnvironment() unchanged
  - src/config/harness.ts          # PRP_AGENT_HARNESS consumer, unchanged
  - src/core/research-queue.ts     # S2 (separate subtask) consumes the reader
  - src/core/task-orchestrator.ts  # S3 (separate subtask) consumes the reader

FUTURE CONSUMERS (informational — do NOT implement in this subtask):
  - S2: ResearchQueue.waitForPRP() will call getResearchTimeoutSeconds() to build the Promise.race deadline.
  - S3: TaskOrchestrator synchronous fallback path.
  - P5.M1.T2.S1: ISSUE_RETRY_MAX will clone this exact pattern in the same file.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After Task 2 (edit constants.ts):
npm run validate
# = eslint . --ext .ts && prettier --check && tsc --noEmit
# Expected: zero errors. If eslint complains about the new function, check JSDoc completeness
# (eslint rules require @returns on exported functions — already provided in Task 2).

# After Task 3 (edit CONFIGURATION.md):
npm run docs:lint
# = markdownlint on docs/**/*.md
# Expected: zero errors. Common failure: misaligned table pipes — copy the Pipeline Control table alignment exactly.
```

### Level 2: Unit Tests (Component Validation)

```bash
# RED step (after Task 1, before Task 2) — MUST fail first (TDD):
npm run test:run -- research-timeout
# Expected: failure (getResearchTimeoutSeconds / RESEARCH_TIMEOUT not exported). This confirms the test actually exercises new code.

# GREEN step (after Task 2):
npm run test:run -- research-timeout
# Expected: all 6 cases pass.

# Full suite (ensure no stub leakage broke sibling config tests):
npm run test:run
# Expected: all green. If environment.test.ts or harness-config.test.ts now fail, vi.unstubAllEnvs()
# is missing or beforeEach env-delete is missing in research-timeout.test.ts.
```

### Level 3: Integration Testing (System Validation)

```bash
# Smoke-check the reader behaves end-to-end with a real (non-vitest) process.env:
RESEARCH_TIMEOUT=240 node --input-type=module -e "import('./src/config/constants.js').then(m => console.log(m.getResearchTimeoutSeconds()))"
# Expected: 240

RESEARCH_TIMEOUT= node --input-type=module -e "import('./src/config/constants.js').then(m => console.log(m.getResearchTimeoutSeconds()))"
# Expected: 300  (empty string → 0 → non-positive → default)

unset RESEARCH_TIMEOUT; node --input-type=module -e "import('./src/config/constants.js').then(m => console.log(m.getResearchTimeoutSeconds()))"
# Expected: 300  (unset → default)

RESEARCH_TIMEOUT=garbage node --input-type=module -e "import('./src/config/constants.js').then(m => console.log(m.getResearchTimeoutSeconds()))"
# Expected: 300  (NaN → default)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Scope-guard regression check — confirm we did NOT over-reach into environment.ts / harness.ts:
git diff --stat
# Expected: ONLY src/config/constants.ts, tests/unit/config/research-timeout.test.ts, docs/CONFIGURATION.md changed.

git diff src/config/environment.ts
# Expected: EMPTY (no changes).

# Boundary check — confirm the future consumer contract is real (symbol exists & is typed number):
node --input-type=module -e "import('./src/config/constants.js').then(m => { console.log(typeof m.getResearchTimeoutSeconds()); console.log(m.RESEARCH_TIMEOUT, m.DEFAULT_RESEARCH_TIMEOUT_SECONDS); })"
# Expected: 'number'  then  'RESEARCH_TIMEOUT' 300
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` passes (eslint + prettier --check + tsc --noEmit, zero errors).
- [ ] `npm run test:run` passes (all tests green; the 6 new cases in `research-timeout.test.ts` included).
- [ ] `npm run docs:lint` passes (CONFIGURATION.md markdownlint clean).
- [ ] RED step observed before GREEN (test failed before implementation — TDD).

### Feature Validation

- [ ] `RESEARCH_TIMEOUT` (string `'RESEARCH_TIMEOUT'`) and `DEFAULT_RESEARCH_TIMEOUT_SECONDS` (`300`) exported from `src/config/constants.ts`.
- [ ] `getResearchTimeoutSeconds()` returns `300` when env unset/NaN/non-positive; returns the parsed value otherwise.
- [ ] `configureEnvironment()` in `src/config/environment.ts` is **unchanged** (`git diff` empty).
- [ ] No `ConfigService` introduced (grep `ConfigService` in src/ returns nothing new).
- [ ] `docs/CONFIGURATION.md` has a `RESEARCH_TIMEOUT` row under a new "Resilience Tuning" subsection, cross-referencing PRD §4.2.

### Code Quality Validation

- [ ] Follows the `PRP_AGENT_HARNESS` precedent exactly (bare-string name const + typed default const).
- [ ] JSDoc on all three new exports (`@remarks`/`@returns`/`@example` matching the file's existing style).
- [ ] File placement matches the desired tree (`constants.ts` edited, `research-timeout.test.ts` added, `CONFIGURATION.md` edited).
- [ ] ESM import specifiers use `.js` extensions in the test file.
- [ ] `vi.stubEnv` paired with `vi.unstubAllEnvs()` (no test-bleed).

### Documentation & Deployment

- [ ] Env-var reference table is accurate and discoverable (new subsection in TOC's spirit).
- [ ] Description row states semantics ("deadline in seconds for background research before synchronous fallback") and cross-refs PRD §4.2.

---

## Anti-Patterns to Avoid

- ❌ Don't add `RESEARCH_TIMEOUT` normalization to `configureEnvironment()` — there is no ConfigService and the contract forbids it.
- ❌ Don't use `||` instead of `??` — `Number('')` must reach the guard, not be short-circuited.
- ❌ Don't forget the `<= 0` guard — `0` parses cleanly but is a meaningless deadline.
- ❌ Don't write the implementation before the failing test (breaks implicit-TDD).
- ❌ Don't start S2/S3 work (research-queue deadline / orchestrator fallback) — that is out of scope for this 1-point subtask and will collide with the next subtasks.
- ❌ Don't split into a `resilience.ts` module yet — `constants.ts` is the established home; split later only if the file bloats.
- ❌ Don't catch all exceptions — the reader uses `Number.isNaN`/`<= 0` guards, not try/catch (the parse itself never throws).
- ❌ Don't use `.ts` import specifiers in test files — ESM requires `.js` (tsc/vitest resolve via moduleResolution).

---

## Success Metrics

**Confidence Score: 9/10** — This is a small, tightly-scoped config subtask with an exact in-repo precedent (`PRP_AGENT_HARNESS`), a fully-specified contract, and deterministic validation gates. The only residual risk is a markdownlint alignment nit on the docs table (Level 1 catches it) and ensuring `vi.unstubAllEnvs()` discipline (Level 2 catches any bleed). One-pass success is highly likely.
