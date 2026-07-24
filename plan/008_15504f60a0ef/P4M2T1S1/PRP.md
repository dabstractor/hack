# PRP — P4.M2.T1.S1: VALIDATION_AGENT and VALIDATION_TIMEOUT config

---

## Goal

**Feature Goal**: Implement the **Validation Control** configuration surface mandated by PRD §4.4
("The QA & Bug Hunt Loop") + §9.2.2 ("Required Environment Variables" → "Validation Control"). Today
**neither `VALIDATION_AGENT` nor `VALIDATION_TIMEOUT` exists anywhere in the code** (confirmed by
`grep` over `src/` and `tests/`, and documented in `architecture/phase_findings.md §PHASE 4`). This
subtask creates that surface from scratch: two env-var-name constants, two default constants, and two
reader helpers in `src/config/constants.ts` — plus their Mode-A documentation ride-along in
`.env.example` and `docs/CONFIGURATION.md`. The validation agent is the **reasoning persona**
(balanced tier @ `xhigh` thinking — already realized by `createQAAgent()` via the `'reasoning'`
`ModelRole` from P2.M2.T1.S2); this item only declares the **config knobs**, it does NOT wire the
validation call itself (that is P4.M2.T1.S2).

**Deliverable** (1 modified production module + 1 modified test file + 1 new test file + 2 modified
doc files; **no** new dependency, **no** workflow change, **no** agent-factory change, **no** model
change, **no** BUG_FINDER_AGENT change):

1. **`src/config/constants.ts`** (MODIFY — ADD 6 exports under a new `// Validation Control
   (PRD §4.4, §9.2.2)` banner section) —
   - `VALIDATION_AGENT` — env-var NAME (`'VALIDATION_AGENT'`).
   - `DEFAULT_VALIDATION_AGENT` — default agent identifier (`'pizr' as const`; the bash-pipeline
     reasoning agent — `pi` with `--thinking xhigh` per PRD §9.2.3 — which in the TS rewrite is the
     `'reasoning'` `ModelRole` / `qa` persona).
   - `getValidationAgent(): string` — returns `process.env[VALIDATION_AGENT]` when set to a
     non-empty-after-trim value, else `DEFAULT_VALIDATION_AGENT`.
   - `VALIDATION_TIMEOUT` — env-var NAME (`'VALIDATION_TIMEOUT'`).
   - `DEFAULT_VALIDATION_TIMEOUT_SECONDS` — default watchdog budget (`7200` = 2h; validation
     legitimately runs full test suites per PRD §4.4/§9.2.2).
   - `getValidationTimeoutSeconds(): number` — **exact 1:1 mirror of
     `getResearchTimeoutSeconds()`**: `Number(process.env[VALIDATION_TIMEOUT] ??
     DEFAULT_VALIDATION_TIMEOUT_SECONDS)`, guarding `NaN` / `<= 0` → default.
2. **`tests/unit/config/constants.test.ts`** (MODIFY — ADD 2 describe blocks + imports) — value-lock
   tests mirroring the existing `DEFAULT_RESEARCH_TIMEOUT_SECONDS (1800)` block: assert
   `DEFAULT_VALIDATION_AGENT === 'pizr'` and `DEFAULT_VALIDATION_TIMEOUT_SECONDS === 7200`.
3. **`tests/unit/config/validation-config.test.ts`** (NEW) — full getter coverage mirroring
   `tests/unit/config/research-timeout.test.ts` exactly (same `beforeEach`/`afterEach` env-stub
   pattern): `getValidationTimeoutSeconds()` (unset→7200, valid, NaN→7200, `'0'`→7200, `'-5'`→7200,
   integer value, positive-deadline property) and `getValidationAgent()` (unset→`'pizr'`, custom
   honored, empty `''`→`'pizr'`, whitespace→`'pizr'`, set to `'pizr'`→`'pizr'`).
4. **`.env.example`** (MODIFY — ADD 1 section) — a `# VALIDATION CONFIGURATION (OPTIONAL)` block
   (after the Smart-Commit-Resilience sub-block, before `# SECURITY NOTES`) documenting
   `VALIDATION_AGENT` (default `pizr`) and `VALIDATION_TIMEOUT` (default `7200`).
5. **`docs/CONFIGURATION.md`** (MODIFY — ADD 1 section + example block) — a `### Validation Control`
   section immediately after `### Bug Hunt Configuration` (table rows for both vars, citing PRD
   §4.4/§9.2.2) and a matching `# VALIDATION CONFIGURATION (OPTIONAL)` block in the Example
   Configuration env-block near the bug-hunt example.

**Success Definition**:
- `getValidationAgent()` returns `'pizr'` by default and honors `VALIDATION_AGENT` when set to a
  non-blank value; `getValidationTimeoutSeconds()` returns `7200` by default and honors
  `VALIDATION_TIMEOUT` when set to a positive integer (mirroring `getResearchTimeoutSeconds` exactly,
  including the `NaN`/`<=0` → default guard).
- Both getters are exported from `src/config/constants.ts` and importable by P4.M2.T1.S2 with no
  further constants work (the consumer seam: S2 imports `getValidationAgent` +
  `getValidationTimeoutSeconds` from `'../config/constants.js'`).
- `npm run validate` GREEN and `npm run test:coverage` shows ~100% on the new code (the project's
  coverage gate is 100% statements/branches/functions/lines — `vitest.config.ts:41-46`).
- `.env.example` and `docs/CONFIGURATION.md` both document `VALIDATION_AGENT` and `VALIDATION_TIMEOUT`
  with their correct defaults and PRD citations.
- `git diff --name-only` shows EXACTLY the 5 files above — **no** agent-factory edit, **no** workflow
  edit, **no** `BUG_FINDER_AGENT` change (that is P4.M2.T2.S1).

---

## User Persona (if applicable)

**Target User**: A pipeline operator / developer who tunes how the QA & validation stage runs.
Validation legitimately executes full test suites (PRD §4.4), so it needs a much larger watchdog
budget than a normal agent call and its own reasoning-tier agent identity.

**Use Case**: "I want to point validation at a heavier reasoning agent (`VALIDATION_AGENT`) and give
it up to 2h (`VALIDATION_TIMEOUT`) to run my full suite, without that budget leaking into every other
agent call."

**User Journey**: set `VALIDATION_TIMEOUT=7200` (+ optional `VALIDATION_AGENT=pizr`) in `.env` → the
pipeline reads them via the new getters → validation runs on the reasoning persona under the 2h
watchdog → on non-zero exit the run aborts before cleanup/commit/bug-hunt (the abort is S2; the
*config* is S1).

**Pain Points Addressed**: today there is NO `VALIDATION_TIMEOUT`, so validation either inherits the
generic agent timeout (far too short for a full suite — it gets watchdog-killed mid-suite) or runs
unbounded. And there is no `VALIDATION_AGENT`, so validation cannot be pointed at a dedicated
reasoning persona independent of `$AGENT`.

---

## Why

- **PRD compliance**: PRD §4.4 step 1 mandates verbatim: *"Validation runs on a dedicated
  **`VALIDATION_AGENT`** (a reasoning-tier agent, default `pizr` …) under its own watchdog budget
  **`VALIDATION_TIMEOUT`** (default 7200s / 2h — validation legitimately runs full test suites),
  overriding the generic agent timeout for this call only."* PRD §9.2.2 ("Validation Control") lists
  both as required env vars with the same defaults.
- **Work-item CONTRACT mapping**:
  - **CONTRACT (1) RESEARCH NOTE** — *"no VALIDATION_AGENT or VALIDATION_TIMEOUT exist in code"* →
    confirmed (`grep` over `src/`+`tests/` = NONE; `phase_findings.md §PHASE 4`). This item is a
    clean-slate creation, not a rename.
  - **CONTRACT (2) INPUT** — *"Three-role model from P2.M2.T1.S2."* → the validation agent is the
    `reasoning` role (`ROLE_CONFIG.reasoning = { tier: 'balanced', thinking: 'xhigh' }`,
    `agent-factory.ts`). `createQAAgent()` ALREADY uses `createBaseConfig('qa', 'reasoning')`. So the
    reasoning persona EXISTS; S1 only declares the config knobs. (See Context §"Why no agent-factory
    change".)
  - **CONTRACT (3) LOGIC** — (a) `VALIDATION_AGENT` env var name (default `'pizr'`) → Task 1a/b/c.
    (b) `VALIDATION_TIMEOUT` env var name + `DEFAULT_VALIDATION_TIMEOUT_SECONDS = 7200` → Task 1d/e/f.
    (c) `getValidationAgent()` + `getValidationTimeoutSeconds()` (mirror `getResearchTimeoutSeconds`)
    → Task 1c/f. (d) "validation agent is the reasoning persona (balanced @ xhigh)" → satisfied by
    the EXISTING `createQAAgent`/`reasoning` role; documented in the new constants' JSDoc + the
    CONFIGURATION.md Model Roles table (which already lists Validation under Reasoning).
  - **CONTRACT (4) OUTPUT** — *"Config constants and helpers for validation. Consumed by
    P4.M2.T1.S2."* → both getters are exported; S2 imports them with no further constants work.
  - **CONTRACT (5) DOCS** — *"[Mode A] Add VALIDATION_AGENT, VALIDATION_TIMEOUT to .env.example and
    docs/CONFIGURATION.md. This rides WITH the work."* → Tasks 4 + 5.
- **No overlap with siblings**: S2 (`P4.M2.T1.S2`, validate.sh generation + abort-on-failure) is the
  CONSUMER — it will import these getters; S1 must not implement the consumer. `BUG_FINDER_AGENT`
  default `glp`→`pizr` is `P4.M2.T2.S1`; S1 does NOT touch it. `NO_ISSUES_FOUND.md`,
  bugfix-breakdown, and adopt-mode are unrelated tasks. The parallel item `P4.M1.T3.S1`
  (delta-PRD binding) is fully disjoint (session-utils + prp-pipeline).

---

## What

A new `// Validation Control (PRD §4.4, §9.2.2)` section in `src/config/constants.ts` declaring six
exports — the `VALIDATION_AGENT` string-knob triplet and the `VALIDATION_TIMEOUT` number-knob
triplet, each mirroring the established `RESEARCH_TIMEOUT` / `getResearchTimeoutSeconds` shape.
Two-tier tests (value-lock in `constants.test.ts` + env-stub getter coverage in a new
`validation-config.test.ts`), and a Mode-A doc ride-along in `.env.example` + `docs/CONFIGURATION.md`.

**No** new CLI flag, **no** model change, **no** persona change, **no** workflow change, **no**
dependency, **no** `BUG_FINDER_AGENT` change.

### Success Criteria

- [ ] **`src/config/constants.ts`** — ADD `VALIDATION_AGENT`, `DEFAULT_VALIDATION_AGENT` (`'pizr' as
      const`), `getValidationAgent(): string`, `VALIDATION_TIMEOUT`,
      `DEFAULT_VALIDATION_TIMEOUT_SECONDS` (`7200`), `getValidationTimeoutSeconds(): number`, each
      with JSDoc citing PRD §4.4 / §9.2.2, under a new banner comment. (Exact code in the Blueprint.)
- [ ] **`tests/unit/config/constants.test.ts`** — ADD imports + two value-lock describe blocks
      asserting `DEFAULT_VALIDATION_AGENT === 'pizr'` and `DEFAULT_VALIDATION_TIMEOUT_SECONDS === 7200`.
- [ ] **`tests/unit/config/validation-config.test.ts`** (NEW) — full getter coverage for both helpers
      mirroring `research-timeout.test.ts` (unset/valid/NaN/zero/negative + agent unset/custom/
      empty/whitespace).
- [ ] **`.env.example`** — ADD a `# VALIDATION CONFIGURATION (OPTIONAL)` section documenting both
      vars with their defaults.
- [ ] **`docs/CONFIGURATION.md`** — ADD a `### Validation Control` section (table rows + PRD cites)
      after `### Bug Hunt Configuration`, and a `# VALIDATION CONFIGURATION (OPTIONAL)` block in the
      Example Configuration env-block.
- [ ] `npm run validate` GREEN.
- [ ] `npm run test:coverage` shows ~100% on the new getters (every branch: the NaN/<=0 guard, the
      trim-empty guard, both default fall-throughs).
- [ ] `git diff --name-only` shows EXACTLY the 5 files above.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed to implement this
successfully?" — YES. This PRP names: the EXACT mirror pattern (`RESEARCH_TIMEOUT` triplet +
`getResearchTimeoutSeconds` at `constants.ts:234/249/274`); the EXACT insertion seam (new banner
section after the COMMIT_RETRY group / `getCommitRetryDelayCapMs`, before `PRD_INCLUDE_MAX_DEPTH`);
the EXACT default values (`'pizr'` and `7200`); the EXACT getter bodies (number mirror 1:1; string
with trim-empty guard); the EXACT test template (`research-timeout.test.ts`); the EXACT doc insertion
points (`.env.example` after the Smart-Commit-Resilience sub-block before `# SECURITY NOTES`;
`CONFIGURATION.md` new `### Validation Control` after `### Bug Hunt Configuration`); and the scope
boundary (no agent-factory change, no S2 consumer, no BUG_FINDER_AGENT).

### Why no agent-factory change (read carefully)

CONTRACT (3)(d) says "the validation agent is the reasoning persona (balanced @ xhigh)." A naive
reading might think this item must add a `createValidationAgent()` factory or change
`agent-factory.ts`. It does NOT. The reasoning persona ALREADY EXISTS:

- `agent-factory.ts` `ROLE_CONFIG.reasoning = { tier: 'balanced', thinking: 'xhigh' }` (single source
  of truth for the role→tier/budget mapping).
- `createQAAgent()` calls `createBaseConfig('qa', 'reasoning')` → balanced tier + `xhigh`.
- PRD §9.2.3: the Reasoning role covers "task decomposition, creative bug discovery, AND validation"
  and the Model Roles table in `docs/CONFIGURATION.md:297` already lists **Validation** under the
  Reasoning role.

So CONTRACT (3)(d) is a SEMANTIC statement about which persona validation uses, satisfied by the
existing QA/reasoning wiring. S1's deliverable is purely the **config surface** (the env-var knobs +
getters). The CONSUMER that actually runs validation on that persona under that budget is S2
(`P4.M2.T1.S2`). Do NOT add a persona, do NOT touch `agent-factory.ts`, do NOT add
`createValidationAgent()` — those are out of scope and would duplicate the reasoning role.

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: plan/008_15504f60a0ef/P4M2T1S1/research/00_research_summary.md
  why: THIS PRP's own research summary. Contains the defect confirmation (grep NONE), the
        insertion seams, the agent/role analysis proving no agent-factory change is needed, the
        two-tier test strategy, the exact doc edit points, and the verified validation commands.
        READ FIRST.

- file: src/config/constants.ts
  section: |
    RESEARCH_TIMEOUT triplet = THE TEMPLATE to mirror 1:1:
      export const RESEARCH_TIMEOUT = 'RESEARCH_TIMEOUT';            # :234  (env-var name)
      export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 1800;          # :249  (numeric default)
      export function getResearchTimeoutSeconds(): number {          # :274  (guard NaN/<=0)
        const raw = Number(process.env[RESEARCH_TIMEOUT] ?? DEFAULT_RESEARCH_TIMEOUT_SECONDS);
        if (Number.isNaN(raw) || raw <= 0) { return DEFAULT_RESEARCH_TIMEOUT_SECONDS; }
        return raw;
      }
    DEFAULT_HARNESS = 'pi' as const;   # :?  — the `as const` string-default precedent
    INSERTION SEAM: a NEW banner section "// Validation Control (PRD §4.4, §9.2.2)" placed AFTER
      the COMMIT_RETRY_* group (after getCommitRetryDelayCapMs — the last resilience-tuning getter)
      and BEFORE the PRD_INCLUDE_MAX_DEPTH block.
  why: THE FILE THIS PRP MODIFIES. getValidationTimeoutSeconds mirrors getResearchTimeoutSeconds
        byte-for-byte (swap RESEARCH→VALIDATION, 1800→7200). getValidationAgent is the string analog
        (default DEFAULT_VALIDATION_AGENT; trim-empty guard is the string equivalent of guarding
        invalid numerics).
  pattern: see the "Implementation Patterns" block below — full JSDoc'd code for all six exports.
  gotcha: |
    1. Use `as const` on DEFAULT_VALIDATION_AGENT ('pizr') to preserve the literal type (matches
       DEFAULT_HARNESS). Do NOT use `as const` on DEFAULT_VALIDATION_TIMEOUT_SECONDS — it is a plain
       number (matches DEFAULT_RESEARCH_TIMEOUT_SECONDS).
    2. getValidationTimeoutSeconds MUST guard NaN AND <=0 (mirror getResearchTimeoutSeconds exactly)
       — do not invent a different guard (e.g. Number.isFinite) that would diverge from the
       established pattern and confuse reviewers.
    3. getValidationAgent MUST fall back to the default on empty/whitespace (trim guard), NOT just
       on undefined — `VALIDATION_AGENT=` (empty) would otherwise yield '' and silently break S2.

- file: tests/unit/config/constants.test.ts
  section: describe('config/constants: DEFAULT_RESEARCH_TIMEOUT_SECONDS (1800)') block (:243-247);
           the existing imports block at the top (:25-33).
  why: THE VALUE-LOCK TEMPLATE + where to add the two new describe blocks. constants.test.ts is
        deliberately env-mutation-free (pure value locks) so it stays stable under the 100% coverage
        gate; the env-reading getters are tested in a DEDICATED file (see next).
  pattern: |
    describe('config/constants: DEFAULT_VALIDATION_AGENT (pizr)', () => {
      it('SHOULD be "pizr" (PRD §4.4/§9.2.2 — reasoning-tier agent, default pizr)', () => {
        expect(DEFAULT_VALIDATION_AGENT).toBe('pizr');
      });
    });
    describe('config/constants: DEFAULT_VALIDATION_TIMEOUT_SECONDS (7200)', () => {
      it('SHOULD be 7200 (PRD §4.4/§9.2.2 — 2h; validation runs full suites)', () => {
        expect(DEFAULT_VALIDATION_TIMEOUT_SECONDS).toBe(7200);
      });
    });
    # + add DEFAULT_VALIDATION_AGENT, DEFAULT_VALIDATION_TIMEOUT_SECONDS to the existing import
    #   statement from '../../../src/config/constants.js'.

- file: tests/unit/config/research-timeout.test.ts
  why: THE EXACT TEMPLATE for the new env-stub getter test file. Copy its structure verbatim
        (imports, describe/beforeEach/afterEach, the (a)..(g) case layout, vi.stubEnv +
        vi.unstubAllEnvs). The new file is tests/unit/config/validation-config.test.ts.
  pattern: see the "Test blueprint" block below — full test cases for both getters.
  gotcha: beforeEach deletes process.env.VALIDATION_AGENT AND process.env.VALIDATION_TIMEOUT;
          afterEach calls vi.unstubAllEnvs(); constants.test.ts deliberately does NOT stub env
          (keep the separation).

- file: src/agents/agent-factory.ts
  section: ROLE_CONFIG (:?, reasoning = { tier:'balanced', thinking:'xhigh' }); createQAAgent()
           (createBaseConfig('qa','reasoning')); ModelRole/ThinkingLevel types.
  why: PROVES the reasoning persona already exists and the 'qa' persona already maps to it, so
        CONTRACT (3)(d) needs NO agent-factory change. READ-ONLY — do not modify.

- file: docs/CONFIGURATION.md
  section: |
    ### Bug Hunt Configuration (:171-178 — LEAVE the stale BUG_FINDER_AGENT default 'glp' ALONE;
      P4.M2.T2.S1 fixes it); INSERT new "### Validation Control" section IMMEDIATELY AFTER it,
      before "### Advanced Configuration" (:181).
    ### Model Roles table (:297-303) — ALREADY lists "Validation" under the Reasoning role
      (balanced/xhigh). NO change needed there (confirms CONTRACT 3(d) is already documented).
    Example Configuration env-block (:470+) — INSERT a "# VALIDATION CONFIGURATION (OPTIONAL)"
      comment block near the BUG HUNT CONFIGURATION example (:478-485).
  why: THE DOC FILE THIS PRP MODIFIES (Mode A ride-along). Mirror the existing table-row format
        exactly (Variable | Required | Default | Description, citing PRD §4.4/§9.2.2).
  pattern: see the "Doc edits" block below — exact new section + example block.

- file: .env.example
  section: after the "--- Smart Commit Resilience (PRD §5.1) ---" sub-block
    (# COMMIT_RETRY_DELAY_CAP=120000, ~:126) and BEFORE "# SECURITY NOTES" (~:128).
  why: THE OTHER DOC FILE THIS PRP MODIFIES. There is NO bug-hunt section in .env.example today
        (those vars live only in CONFIGURATION.md). Add ONLY the VALIDATION section — do NOT add
        bug-hunt vars (out of scope).
  pattern: see the "Doc edits" block below — exact new section.

- file: PRD.md   # §4.4 step 1 + §9.2.2 "Validation Control" — the source of truth
  section: §4.4 step 1 (VALIDATION_AGENT default pizr; VALIDATION_TIMEOUT default 7200/2h) +
           §9.2.2 "Validation Control" (same two vars, same defaults).
  why: THE REQUIREMENT. Verbatim text is in the selected_prd_content. Quote it in JSDoc on all six
        new exports and in the CONFIGURATION.md table rows.
```

### Current Codebase tree (relevant slice)

```bash
src/config/
  constants.ts              # MODIFY (ADD 6 exports under new "// Validation Control" banner).
src/agents/
  agent-factory.ts          # READ-ONLY — reasoning persona already exists (no change).
tests/unit/config/
  constants.test.ts         # MODIFY (ADD 2 value-lock describe blocks + imports).
  research-timeout.test.ts  # READ-ONLY — the env-stub getter-test TEMPLATE.
  validation-config.test.ts # NEW — full getter coverage for both new helpers.
.env.example                # MODIFY (ADD "# VALIDATION CONFIGURATION (OPTIONAL)" section).
docs/
  CONFIGURATION.md          # MODIFY (ADD "### Validation Control" section + example block).
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/config/constants.ts
  # + VALIDATION_AGENT = 'VALIDATION_AGENT'                       (env-var name; PRD §9.2.2)
  # + DEFAULT_VALIDATION_AGENT = 'pizr' as const                  (default agent id; PRD §9.2.3)
  # + getValidationAgent(): string                                (trim-empty → default guard)
  # + VALIDATION_TIMEOUT = 'VALIDATION_TIMEOUT'                   (env-var name; PRD §9.2.2)
  # + DEFAULT_VALIDATION_TIMEOUT_SECONDS = 7200                   (2h default; PRD §4.4)
  # + getValidationTimeoutSeconds(): number                       (mirror getResearchTimeoutSeconds)
tests/unit/config/constants.test.ts
  # + describe DEFAULT_VALIDATION_AGENT (=== 'pizr')
  # + describe DEFAULT_VALIDATION_TIMEOUT_SECONDS (=== 7200)
tests/unit/config/validation-config.test.ts  # NEW
  # + getValidationTimeoutSeconds: unset→7200, valid, NaN→7200, '0'→7200, '-5'→7200, value, >0
  # + getValidationAgent: unset→'pizr', custom honored, ''→'pizr', '  '→'pizr', 'pizr'→'pizr'
.env.example
  # + "# VALIDATION CONFIGURATION (OPTIONAL)" block (VALIDATION_AGENT + VALIDATION_TIMEOUT)
docs/CONFIGURATION.md
  # + "### Validation Control" section (table rows, PRD §4.4/§9.2.2) after Bug Hunt Configuration
  # + "# VALIDATION CONFIGURATION (OPTIONAL)" block in Example Configuration
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (clean slate — no rename): VALIDATION_AGENT / VALIDATION_TIMEOUT do NOT exist anywhere
//   (grep over src/+tests/ = NONE). This item CREATES them. Do not search for a legacy alias to
//   preserve — there is none. Do not "migrate" anything.

// CRITICAL (getValidationTimeoutSeconds mirrors getResearchTimeoutSeconds BYTE-FOR-BYTE): use the
//   SAME guard (`Number.isNaN(raw) || raw <= 0`), NOT a divergent one (e.g. Number.isFinite).
//   Consistency with the established pattern is the review bar; diverging breaks 100% coverage
//   expectations and reviewer trust. The ONLY differences are the var name (VALIDATION_TIMEOUT),
//   the default (DEFAULT_VALIDATION_TIMEOUT_SECONDS = 7200), and the JSDoc.

// CRITICAL (string getter needs a trim-empty guard): `process.env[VALIDATION_AGENT] ?? DEFAULT`
//   would NOT fall back on an EMPTY string (?? only catches null/undefined). `VALIDATION_AGENT=`
//   (empty) would then yield '' and silently break S2. So: read → trim → if empty, return default;
//   else return the trimmed value. This is the string analog of guarding invalid numerics.

// CRITICAL (`as const` only on the STRING default): DEFAULT_VALIDATION_AGENT = 'pizr' as const
//   (matches DEFAULT_HARNESS = 'pi' as const). DEFAULT_VALIDATION_TIMEOUT_SECONDS = 7200 (NO `as
//   const` — matches DEFAULT_RESEARCH_TIMEOUT_SECONDS = 1800). Inverting this is wrong.

// CRITICAL (do NOT touch agent-factory.ts): the reasoning persona (balanced @ xhigh) ALREADY
//   exists (ROLE_CONFIG.reasoning; createQAAgent). CONTRACT (3)(d) is satisfied by existing wiring.
//   Do NOT add createValidationAgent(), do NOT add a 'validation' persona. S2 wires the call.

// CRITICAL (do NOT touch BUG_FINDER_AGENT): its stale 'glp' default is fixed by P4.M2.T2.S1, not
//   here. Leave docs/CONFIGURATION.md ### Bug Hunt Configuration and its example block untouched.

// CRITICAL (do NOT implement the validation call): the validate.sh generation + abort-on-failure is
//   S2 (P4.M2.T1.S2). S1 exports the getters; S2 imports them. Do not add a workflow method.

// GOTCHA (100% coverage gate): vitest.config.ts:41-46 enforces 100% statements/branches/functions/
//   lines. Every branch in BOTH getters must be exercised: the NaN branch, the <=0 branch, the
//   trim-empty branch, both default fall-throughs, and the happy paths. constants.test.ts alone
//   (value-lock, no env mutation) does NOT cover the getters — the new validation-config.test.ts
//   does.

// GOTCHA (constants.test.ts is env-mutation-free by design): it only asserts constant VALUES. Do
//   NOT add vi.stubEnv calls there. Env-reading getters are tested in the dedicated
//   validation-config.test.ts (precedent: research-timeout.test.ts vs constants.test.ts).

// GOTCHA (ESM .js imports): intra-project imports use .js extensions in .ts source
//   (e.g. '../../../src/config/constants.js'). The new test file imports from that exact path.

// GOTCHA (prettier table formatting): docs/CONFIGURATION.md tables are hand-aligned with padding
//   spaces and a `| ----- |` separator row. Run `npm run format:check` (or `npm run format`) so
//   prettier normalizes the new rows; do not hand-fight alignment.
```

---

## Implementation Blueprint

### Data models and structure

**No new data models.** Six plain exports (two env-var-name strings, one `as const` string default,
one numeric default, two reader functions). The number getter mirrors `getResearchTimeoutSeconds`
exactly; the string getter adds a trim-empty guard.

```typescript
// === additions to src/config/constants.ts — under a new banner: ===
// =============================================================================
// Validation Control (PRD §4.4, §9.2.2)
// =============================================================================
// Two env-var knobs for the QA & validation stage: which reasoning-tier agent runs
// validation (VALIDATION_AGENT), and the watchdog budget for that call only
// (VALIDATION_TIMEOUT). Both OVERRIDE the generic agent defaults for the validation
// call only. Consumed by P4.M2.T1.S2 (validate.sh generation + abort-on-failure).

/**
 * Environment variable name: the reasoning-tier agent that generates and runs `validate.sh`
 * (PRD §4.4 step 1, §9.2.2 "Validation Control").
 *
 * @remarks
 * The VALUE of this variable (read at runtime via {@link getValidationAgent}) is an agent
 * identifier. Overrides the generic `$AGENT` for the validation call only. This constant is
 * the env-var NAME itself. The DEFAULT ({@link DEFAULT_VALIDATION_AGENT}) is `pizr` — the
 * bash-pipeline reasoning agent (`pi` with `--thinking xhigh` per PRD §9.2.3); in the TS
 * rewrite the reasoning persona (balanced tier @ `xhigh`) realizes it via the `qa` persona
 * (`createQAAgent`, `agent-factory.ts`).
 *
 * @example
 * ```ts
 * import { VALIDATION_AGENT } from './config/constants.js';
 *
 * console.log(VALIDATION_AGENT); // 'VALIDATION_AGENT'
 * console.log(process.env[VALIDATION_AGENT]); // e.g. 'pizr'
 * ```
 */
export const VALIDATION_AGENT = 'VALIDATION_AGENT';

/**
 * Default validation agent identifier (PRD §4.4, §9.2.3).
 *
 * @remarks
 * `pizr` — the reasoning-tier agent. Uses `as const` to preserve the literal type (matches
 * {@link DEFAULT_HARNESS}).
 *
 * @example
 * ```ts
 * import { DEFAULT_VALIDATION_AGENT } from './config/constants.js';
 *
 * console.log(DEFAULT_VALIDATION_AGENT); // 'pizr'
 * ```
 */
export const DEFAULT_VALIDATION_AGENT = 'pizr' as const;

/**
 * Read the VALIDATION_AGENT env var (PRD §4.4, §9.2.2).
 *
 * @returns The configured validation agent identifier, or {@link DEFAULT_VALIDATION_AGENT}
 *          (`'pizr'`) when unset or blank (empty/whitespace-only).
 *
 * @remarks
 * The trim-empty guard is the string analog of the numeric getters' `NaN`/`<=0` guard: an
 * explicitly-empty value (`VALIDATION_AGENT=`) falls back to the default rather than yielding
 * `''`, which would silently break the validation call.
 *
 * @example
 * ```ts
 * import { getValidationAgent } from './config/constants.js';
 *
 * const agent = getValidationAgent(); // 'pizr' (default)
 * ```
 */
export function getValidationAgent(): string {
  const raw = process.env[VALIDATION_AGENT];
  if (raw === undefined) {
    return DEFAULT_VALIDATION_AGENT;
  }
  const trimmed = raw.trim();
  return trimmed === '' ? DEFAULT_VALIDATION_AGENT : trimmed;
}

/**
 * Environment variable name: the watchdog budget in seconds for the validation call
 * (PRD §4.4 step 1, §9.2.2 "Validation Control").
 *
 * @remarks
 * The VALUE of this variable (read at runtime via {@link getValidationTimeoutSeconds}) is a
 * positive number of seconds. Overrides the generic agent timeout for the validation call
 * only — validation legitimately runs full test suites (PRD §4.4). This constant is the
 * env-var NAME itself.
 *
 * @example
 * ```ts
 * import { VALIDATION_TIMEOUT } from './config/constants.js';
 *
 * console.log(VALIDATION_TIMEOUT); // 'VALIDATION_TIMEOUT'
 * console.log(process.env[VALIDATION_TIMEOUT]); // e.g. '7200'
 * ```
 */
export const VALIDATION_TIMEOUT = 'VALIDATION_TIMEOUT';

/**
 * Default watchdog budget (7200s = 2h) for the validation call (PRD §4.4).
 *
 * @remarks
 * When the VALIDATION_TIMEOUT env var is unset or invalid, this value is used. 2h because
 * validation legitimately runs full test suites (PRD §4.4).
 *
 * @example
 * ```ts
 * import { DEFAULT_VALIDATION_TIMEOUT_SECONDS } from './config/constants.js';
 *
 * console.log(DEFAULT_VALIDATION_TIMEOUT_SECONDS); // 7200
 * ```
 */
export const DEFAULT_VALIDATION_TIMEOUT_SECONDS = 7200;

/**
 * Read & validate the VALIDATION_TIMEOUT env var (PRD §4.4, §9.2.2).
 *
 * @returns The configured watchdog budget in seconds, or
 *          {@link DEFAULT_VALIDATION_TIMEOUT_SECONDS} (`7200`) when unset, non-numeric, or
 *          non-positive.
 *
 * @remarks
 * Mirrors {@link getResearchTimeoutSeconds} exactly (same `Number(... ?? default)` + `NaN`/
 * `<=0` → default guard). PRD §4.4: validation runs on its own watchdog; a non-zero exit MUST
 * abort before cleanup/commit/bug-hunt (the abort is wired by P4.M2.T1.S2; this getter only
 * supplies the budget).
 *
 * @example
 * ```ts
 * import { getValidationTimeoutSeconds } from './config/constants.js';
 *
 * const budget = getValidationTimeoutSeconds(); // 7200 (default)
 * ```
 */
export function getValidationTimeoutSeconds(): number {
  const raw = Number(
    process.env[VALIDATION_TIMEOUT] ?? DEFAULT_VALIDATION_TIMEOUT_SECONDS
  );
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_VALIDATION_TIMEOUT_SECONDS;
  }
  return raw;
}
```

### Test blueprint (tests/unit/config/validation-config.test.ts)

```typescript
/**
 * Unit tests for VALIDATION_AGENT / VALIDATION_TIMEOUT config constants and reader helpers
 *
 * @remarks
 * Tests validate getValidationAgent() and getValidationTimeoutSeconds() from
 * src/config/constants.ts. Mirrors research-timeout.test.ts structure verbatim (beforeEach
 * env reset, afterEach vi.unstubAllEnvs, the (a)..(g) case layout).
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VALIDATION_AGENT,
  DEFAULT_VALIDATION_TIMEOUT_SECONDS,
  VALIDATION_AGENT,
  VALIDATION_TIMEOUT,
  getValidationAgent,
  getValidationTimeoutSeconds,
} from '../../../src/config/constants.js';

describe('config/constants: getValidationTimeoutSeconds', () => {
  beforeEach(() => {
    delete process.env.VALIDATION_TIMEOUT;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) returns the default (7200) when env var is unset', () => {
    expect(getValidationTimeoutSeconds()).toBe(DEFAULT_VALIDATION_TIMEOUT_SECONDS); // 7200
  });
  it('(b) honors a stubbed positive integer', () => {
    vi.stubEnv(VALIDATION_TIMEOUT, '3600');
    expect(getValidationTimeoutSeconds()).toBe(3600);
  });
  it('(c) returns default when env var is NaN', () => {
    vi.stubEnv(VALIDATION_TIMEOUT, 'abc');
    expect(getValidationTimeoutSeconds()).toBe(DEFAULT_VALIDATION_TIMEOUT_SECONDS);
  });
  it('(d) returns default when env var is zero', () => {
    vi.stubEnv(VALIDATION_TIMEOUT, '0');
    expect(getValidationTimeoutSeconds()).toBe(DEFAULT_VALIDATION_TIMEOUT_SECONDS);
  });
  it('(e) returns default when env var is negative', () => {
    vi.stubEnv(VALIDATION_TIMEOUT, '-5');
    expect(getValidationTimeoutSeconds()).toBe(DEFAULT_VALIDATION_TIMEOUT_SECONDS);
  });
  it('(f) returns a stubbed integer value', () => {
    vi.stubEnv(VALIDATION_TIMEOUT, '14400');
    expect(getValidationTimeoutSeconds()).toBe(14400);
  });
  it('(g) returns the 2h default (7200) that bounds a full test-suite run (PRD §4.4)', () => {
    const budget = getValidationTimeoutSeconds();
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBe(DEFAULT_VALIDATION_TIMEOUT_SECONDS); // 7200 when unset
  });
});

describe('config/constants: getValidationAgent', () => {
  beforeEach(() => {
    delete process.env.VALIDATION_AGENT;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) returns the default (pizr) when env var is unset', () => {
    expect(getValidationAgent()).toBe(DEFAULT_VALIDATION_AGENT); // 'pizr'
  });
  it('(b) honors a stubbed custom agent', () => {
    vi.stubEnv(VALIDATION_AGENT, 'custom-reasoner');
    expect(getValidationAgent()).toBe('custom-reasoner');
  });
  it('(c) returns default when env var is empty', () => {
    vi.stubEnv(VALIDATION_AGENT, '');
    expect(getValidationAgent()).toBe(DEFAULT_VALIDATION_AGENT); // 'pizr'
  });
  it('(d) returns default when env var is whitespace-only', () => {
    vi.stubEnv(VALIDATION_AGENT, '   ');
    expect(getValidationAgent()).toBe(DEFAULT_VALIDATION_AGENT); // 'pizr'
  });
  it('(e) trims surrounding whitespace from a set value', () => {
    vi.stubEnv(VALIDATION_AGENT, '  pizr  ');
    expect(getValidationAgent()).toBe('pizr');
  });
  it('(f) returns pizr when explicitly set to pizr', () => {
    vi.stubEnv(VALIDATION_AGENT, 'pizr');
    expect(getValidationAgent()).toBe(DEFAULT_VALIDATION_AGENT); // 'pizr'
  });
});
```

> Cases (c)/(d) cover the trim-empty guard branches; (e) covers the trim-but-non-empty branch;
> (a) covers the `undefined` branch; (b)/(f) cover the happy path. Together with
> constants.test.ts's two value-lock blocks this achieves 100% on both getters.

### Doc edits

**`.env.example`** — insert this NEW block AFTER the Smart-Commit-Resilience sub-block
(after `# COMMIT_RETRY_DELAY_CAP=120000`) and BEFORE `# SECURITY NOTES`:

```bash
# =============================================================================
# VALIDATION CONFIGURATION (OPTIONAL)
# =============================================================================

# Reasoning-tier agent that generates and runs validate.sh (default: pizr).
# Overrides the generic agent for the validation call only. See PRD §4.4, §9.2.2.
# VALIDATION_AGENT=pizr

# Watchdog budget in seconds for the validation call (default: 7200 = 2h — validation
# legitimately runs full test suites). Overrides the generic agent timeout for this call
# only. See PRD §4.4, §9.2.2.
# VALIDATION_TIMEOUT=7200
```

**`docs/CONFIGURATION.md`** — (1) insert this NEW section immediately AFTER `### Bug Hunt
Configuration` (after its `BUGFIX_SCOPE` row, before `### Advanced Configuration`):

```markdown
### Validation Control

Configure the validation stage of the QA & bug-hunt loop. See PRD §4.4 and §9.2.2.

| Variable            | Required | Default | Description                                                                                                                                                   |
| ------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_AGENT`  | No       | `pizr`  | Reasoning-tier agent that generates and runs `validate.sh`. Overrides the generic `$AGENT` for the validation call only. See PRD §4.4, §9.2.3.                |
| `VALIDATION_TIMEOUT`| No       | `7200`  | Watchdog budget in seconds for the validation call (2h — validation legitimately runs full test suites). Overrides the generic agent timeout for this call only. See PRD §4.4. |
```

> Do NOT edit the existing `### Bug Hunt Configuration` table (`BUG_FINDER_AGENT` default `glp` is
> fixed by P4.M2.T2.S1). Do NOT edit the `### Model Roles` table (it already lists Validation under
> the Reasoning role).

(2) Add a matching block in the Example Configuration env-block near the BUG HUNT CONFIGURATION
example (`# BUG_FINDER_AGENT=glp` etc.), inserted after the bug-hunt example and before the ADVANCED
CONFIGURATION example:

```bash
# =============================================================================
# VALIDATION CONFIGURATION (OPTIONAL)
# =============================================================================

# Reasoning-tier agent that generates and runs validate.sh (default: pizr)
# VALIDATION_AGENT=pizr

# Watchdog budget in seconds for the validation call (default: 7200 = 2h)
# VALIDATION_TIMEOUT=7200
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/config/constants.ts — ADD the Validation Control section (6 exports)
  - ADD a "// Validation Control (PRD §4.4, §9.2.2)" banner section AFTER the COMMIT_RETRY_*
    group (after getCommitRetryDelayCapMs) and BEFORE the PRD_INCLUDE_MAX_DEPTH block.
  - IMPLEMENT the six exports EXACTLY as in the Data models block above (JSDoc cites PRD §4.4/
    §9.2.2 on every export; getValidationTimeoutSeconds mirrors getResearchTimeoutSeconds
    byte-for-byte; getValidationAgent has the trim-empty guard; DEFAULT_VALIDATION_AGENT uses
    `as const`, DEFAULT_VALIDATION_TIMEOUT_SECONDS does NOT).
  - FOLLOW pattern: RESEARCH_TIMEOUT/DEFAULT_RESEARCH_TIMEOUT_SECONDS/getResearchTimeoutSeconds
    triplet (:234/:249/:274); DEFAULT_HARNESS = 'pi' as const (string-default `as const` precedent).
  - NAMING: VALIDATION_AGENT / DEFAULT_VALIDATION_AGENT / getValidationAgent; VALIDATION_TIMEOUT /
    DEFAULT_VALIDATION_TIMEOUT_SECONDS / getValidationTimeoutSeconds (verb-first getters, match
    getResearchTimeoutSeconds).
  - PLACEMENT: new banner section between the resilience-tuning group and the PRD_INCLUDE group.

Task 2: MODIFY tests/unit/config/constants.test.ts — ADD 2 value-lock describe blocks
  - ADD DEFAULT_VALIDATION_AGENT + DEFAULT_VALIDATION_TIMEOUT_SECONDS to the existing import
    statement from '../../../src/config/constants.js'.
  - ADD two describe blocks (DEFAULT_VALIDATION_AGENT === 'pizr'; DEFAULT_VALIDATION_TIMEOUT_SECONDS
    === 7200) per the pattern block above, placed near the existing
    DEFAULT_RESEARCH_TIMEOUT_SECONDS block (:243).
  - DO NOT add vi.stubEnv here (constants.test.ts is env-mutation-free by design).

Task 3: CREATE tests/unit/config/validation-config.test.ts (NEW)
  - IMPLEMENT per the Test blueprint block above — full getter coverage for BOTH helpers, mirroring
    research-timeout.test.ts structure (beforeEach deletes env, afterEach vi.unstubAllEnvs).
  - FOLLOW pattern: tests/unit/config/research-timeout.test.ts (imports, (a)..(g) layout).
  - COVERAGE: every branch — NaN, <=0, trim-empty, trim-non-empty, undefined, happy path — must be
    exercised (the 100% gate in vitest.config.ts:41-46).
  - PLACEMENT: tests/unit/config/validation-config.test.ts.

Task 4: MODIFY .env.example — ADD the VALIDATION CONFIGURATION (OPTIONAL) section
  - INSERT the block from the Doc edits section AFTER the Smart-Commit-Resilience sub-block
    (# COMMIT_RETRY_DELAY_CAP=120000) and BEFORE "# SECURITY NOTES".
  - DO NOT add bug-hunt vars (out of scope — P4.M2.T2).
  - Run `npm run format` (prettier normalizes spacing).

Task 5: MODIFY docs/CONFIGURATION.md — ADD the Validation Control section + example block
  - INSERT "### Validation Control" (table rows + PRD cites) IMMEDIATELY AFTER
    "### Bug Hunt Configuration" and BEFORE "### Advanced Configuration".
  - INSERT the "# VALIDATION CONFIGURATION (OPTIONAL)" block in the Example Configuration
    env-block after the bug-hunt example, before the ADVANCED CONFIGURATION example.
  - DO NOT edit ### Bug Hunt Configuration (BUG_FINDER_AGENT 'glp' → P4.M2.T2.S1).
  - DO NOT edit ### Model Roles (already lists Validation under Reasoning).
  - Run `npm run format` so prettier aligns the new table rows.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: number-knob triplet (env-var name + numeric default + reader). VALIDATION_TIMEOUT
//   mirrors RESEARCH_TIMEOUT exactly — same Number() coercion, same NaN/<=0 guard. Only the
//   names + default (7200) differ.
export function getValidationTimeoutSeconds(): number {
  const raw = Number(
    process.env[VALIDATION_TIMEOUT] ?? DEFAULT_VALIDATION_TIMEOUT_SECONDS
  );
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_VALIDATION_TIMEOUT_SECONDS;
  }
  return raw;
}

// PATTERN: string-knob triplet (env-var name + `as const` default + reader with trim-empty guard).
//   The trim-empty guard is REQUIRED: `??` alone would not fall back on '' (only null/undefined).
export function getValidationAgent(): string {
  const raw = process.env[VALIDATION_AGENT];
  if (raw === undefined) return DEFAULT_VALIDATION_AGENT;
  const trimmed = raw.trim();
  return trimmed === '' ? DEFAULT_VALIDATION_AGENT : trimmed;
}

// GOTCHA: `as const` on DEFAULT_VALIDATION_AGENT ('pizr') but NOT on the numeric
//   DEFAULT_VALIDATION_TIMEOUT_SECONDS (7200) — matches DEFAULT_HARNESS /
//   DEFAULT_RESEARCH_TIMEOUT_SECONDS respectively.
```

### Integration Points

```yaml
CONFIG (consumed by P4.M2.T1.S2 — the validate.sh + abort-on-failure consumer):
  - import { getValidationAgent, getValidationTimeoutSeconds } from '../config/constants.js'
  - S2 will run validation on the reasoning-tier QA persona under getValidationTimeoutSeconds()
    and abort the run (before cleanup/commit/bug-hunt) on a non-zero exit. S1 only exports the
    getters; it does NOT wire the call.

DOCS (Mode A ride-along — rides WITH the work, not deferred):
  - .env.example: new "# VALIDATION CONFIGURATION (OPTIONAL)" section.
  - docs/CONFIGURATION.md: new "### Validation Control" section + example block.

NO DATABASE / NO ROUTES / NO CLI FLAG / NO MODEL / NO PERSONA change.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after editing constants.ts — fix before proceeding
npm run lint            # eslint . --ext .ts  (expected: zero errors)
npm run format:check    # prettier --check    (expected: zero issues; run `npm run format` to fix)
npm run typecheck       # tsc --noEmit -p tsconfig.build.json (expected: zero errors)

# Project-wide gate (the canonical CI gate)
npm run validate        # = lint && format:check && typecheck && test:run

# Expected: Zero errors. If any exist, READ the output and fix before proceeding.
# NOTE: docs/CONFIGURATION.md + .env.example are covered by prettier (format:check), so run
#       `npm run format` once after the doc edits to normalize table alignment.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new getters in isolation
npx vitest run tests/unit/config/validation-config.test.ts
npx vitest run tests/unit/config/constants.test.ts

# Expected: All tests pass. If failing, debug root cause and fix.

# Coverage gate (the project enforces 100% statements/branches/functions/lines)
npm run test:coverage

# Expected: 100% on src/config/constants.ts (the new getters' branches: NaN, <=0, trim-empty,
#           trim-non-empty, undefined, both default fall-throughs, all happy paths).
```

### Level 3: Integration Testing (System Validation)

```bash
# Type-level integration: verify the exports are importable exactly as S2 will import them.
npx tsc --noEmit src/config/constants.ts 2>/dev/null || true
node --input-type=module -e "
import('./src/config/constants.js').then(m => {
  console.log('VALIDATION_AGENT =', m.VALIDATION_AGENT);
  console.log('DEFAULT_VALIDATION_AGENT =', m.DEFAULT_VALIDATION_AGENT);
  console.log('getValidationAgent() =', m.getValidationAgent());
  console.log('VALIDATION_TIMEOUT =', m.VALIDATION_TIMEOUT);
  console.log('DEFAULT_VALIDATION_TIMEOUT_SECONDS =', m.DEFAULT_VALIDATION_TIMEOUT_SECONDS);
  console.log('getValidationTimeoutSeconds() =', m.getValidationTimeoutSeconds());
  if (m.DEFAULT_VALIDATION_AGENT !== 'pizr') throw new Error('default agent mismatch');
  if (m.DEFAULT_VALIDATION_TIMEOUT_SECONDS !== 7200) throw new Error('default timeout mismatch');
  console.log('OK — exports + defaults verified');
});
" 2>/dev/null || echo "(compiled smoke check — run via vitest if ESM import fails without build)"

# Expected: prints the six exports with defaults 'pizr' and 7200; "OK — exports + defaults
#           verified". (If the raw node ESM import needs the built dist, rely on the vitest
#           suite + typecheck instead — the assertions above are mirrored in the unit tests.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Consumer-seam dry run: simulate P4.M2.T1.S2 importing the getters (no LLM, no workflow).
# This is a static guarantee that S2 will have a clean import path with no further constants work.
npx tsc --noEmit -p tsconfig.build.json && echo "typecheck OK — getters import-clean"

# Documentation drift check: confirm both vars are documented in both doc files.
grep -n "VALIDATION_AGENT" .env.example docs/CONFIGURATION.md
grep -n "VALIDATION_TIMEOUT" .env.example docs/CONFIGURATION.md
# Expected: each var appears in BOTH .env.example and docs/CONFIGURATION.md.

# Scope-boundary check: confirm NO unintended files changed and BUG_FINDER_AGENT untouched.
git diff --name-only
# Expected EXACTLY: src/config/constants.ts, tests/unit/config/constants.test.ts,
#                   tests/unit/config/validation-config.test.ts, .env.example, docs/CONFIGURATION.md
git diff docs/CONFIGURATION.md | grep -i "BUG_FINDER_AGENT" || echo "OK — BUG_FINDER_AGENT untouched"
# Expected: "OK — BUG_FINDER_AGENT untouched" (no edits to the stale 'glp' default).
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] `npm run test:coverage` shows ~100% on the new getters (every branch exercised).
- [ ] `git diff --name-only` shows EXACTLY the 5 files (constants.ts, constants.test.ts,
      validation-config.test.ts, .env.example, CONFIGURATION.md).

### Feature Validation

- [ ] `getValidationTimeoutSeconds()` returns `7200` by default; honors a positive integer;
      falls back on `NaN`/`'0'`/`'-5'` (mirrors `getResearchTimeoutSeconds`).
- [ ] `getValidationAgent()` returns `'pizr'` by default; honors a non-blank value; trims; falls
      back on empty/whitespace.
- [ ] Both getters are exported and importable from `../config/constants.js` (the S2 seam).
- [ ] `.env.example` + `docs/CONFIGURATION.md` both document `VALIDATION_AGENT` (`pizr`) and
      `VALIDATION_TIMEOUT` (`7200`) with PRD §4.4/§9.2.2 citations.

### Code Quality Validation

- [ ] `getValidationTimeoutSeconds` mirrors `getResearchTimeoutSeconds` byte-for-byte (same guard).
- [ ] `DEFAULT_VALIDATION_AGENT` uses `as const`; `DEFAULT_VALIDATION_TIMEOUT_SECONDS` does not.
- [ ] `getValidationAgent` has the trim-empty guard (not just `??`).
- [ ] All six exports carry JSDoc citing PRD §4.4 / §9.2.2.
- [ ] constants.test.ts stays env-mutation-free (value locks only); env stubs live in the new file.

### Documentation & Deployment

- [ ] New doc sections are prettier-normalized (`npm run format`).
- [ ] No `BUG_FINDER_AGENT` / `Bug Hunt Configuration` edits (left for P4.M2.T2.S1).
- [ ] No `Model Roles` table edits (already documents Validation under Reasoning).

---

## Anti-Patterns to Avoid

- ❌ Don't invent a different guard for `getValidationTimeoutSeconds` (e.g. `Number.isFinite`) —
  mirror `getResearchTimeoutSeconds` exactly (`Number.isNaN(raw) || raw <= 0`). Consistency is the
  review bar.
- ❌ Don't use `process.env[VALIDATION_AGENT] ?? DEFAULT` without the trim-empty guard — an empty
  string (`VALIDATION_AGENT=`) would yield `''` and silently break S2.
- ❌ Don't add `as const` to the numeric default (or omit it from the string default) — match
  `DEFAULT_RESEARCH_TIMEOUT_SECONDS` (no `as const`) and `DEFAULT_HARNESS` (`as const`).
- ❌ Don't modify `agent-factory.ts` / add a persona — the reasoning persona already exists; CONTRACT
  (3)(d) is satisfied by existing wiring.
- ❌ Don't implement the validation call / abort-on-failure — that is S2 (P4.M2.T1.S2).
- ❌ Don't touch `BUG_FINDER_AGENT` (stale `glp` default → P4.M2.T2.S1) or the `Bug Hunt
  Configuration` table.
- ❌ Don't add `vi.stubEnv` to `constants.test.ts` — it is deliberately env-mutation-free; stubs
  belong in the dedicated `validation-config.test.ts`.
- ❌ Don't hardcode `'pizr'` / `7200` in the getters — always reference the `DEFAULT_*` constants.