# PRP — P1.M1.T1.S2: Five per-role reasoning getters (`getReasoningAgent`/`Breakdown`/`BugFinder`/`Validation`/`Impl`)

> PRD §9.2.9 (Per-Role Reasoning Level). S1 (LANDED) added the validated vocabulary layer —
> `ReasoningLevel`, `REASONING_LEVELS`, the 5 `PRP_REASONING_*` env-name constants, the 5
> `DEFAULT_REASONING_*` defaults, `resolveReasoningLevel`, and `ReasoningConfigError`. **S2 adds the
> 5 per-role getters** (one-line wrappers over `resolveReasoningLevel`) and a fail-fast
> `validateAllReasoningLevels()` aggregate. Consumed by T3 (agent factories) and T4 (startup). The
> agent-factory reconcile (S3), `.env.example` (S4), `.hack` schema (T2), and startup wiring (T4) are
> separate subtasks.

---

## Goal

**Feature Goal**: Add five zero-arg per-role reasoning getters to `src/config/constants.ts` —
`getReasoningAgent()`, `getReasoningBreakdown()`, `getReasoningBugFinder()`, `getReasoningValidation()`,
`getReasoningImpl()` — each returning a `ReasoningLevel` by routing `process.env[PRP_REASONING_*]`
through S1's `resolveReasoningLevel` (case-insensitive, empty/whitespace→default, invalid→throws).
Plus `validateAllReasoningLevels(): void` that calls all five in sequence for fail-fast startup
validation. Each getter carries `getValidationAgent`-style JSDoc (default + empty→default +
invalid→hard-error + §9.2.9 ref).

**Deliverable**:
1. **`src/config/constants.ts`** — append (in the `// Reasoning Configuration (PRD §9.2.9)` section,
   after `resolveReasoningLevel` ~L1654): the 5 getters + `validateAllReasoningLevels`, each with JSDoc.
2. **`tests/unit/config/constants.test.ts`** — append a describe block (after S1's
   `resolveReasoningLevel`/`ReasoningConfigError` blocks, ~L452): per-getter cases (default/empty/
   valid-case-insensitive/invalid-throws) + `validateAllReasoningLevels` (no-op-when-valid /
   throws-when-any-invalid).

**Success Definition**:
- Each getter returns its role default when the env var is unset/empty/whitespace; honors a set value
  case-insensitively (lowercased); throws `ReasoningConfigError` on an invalid value.
- Defaults: Agent/Breakdown/BugFinder/Validation → `high`; Impl → `off` (the one non-`high`).
- `validateAllReasoningLevels()` is a no-op when all five are valid/unset; throws the first
  `ReasoningConfigError` if ANY role's env value is invalid.
- `npm run typecheck && npm run lint && npm run format:check` clean; `constants.test.ts` green at
  100% coverage on the new lines; S1's `resolveReasoningLevel`/`ReasoningConfigError` tests stay green.

---

## Why

- **Completes the §9.2.9 read surface.** S1 landed the vocabulary + the shared validator; S2 provides
  the per-role getters that consumers (T3 agent factories, T4 startup) actually call. Without S2 there
  is no role-keyed way to read a resolved level — only the generic `resolveReasoningLevel(raw, key, default)`.
- **Mirrors a proven pattern.** `getValidationAgent()` (constants.ts:993-1004) is the getter-shape
  template (env read + default + JSDoc). S2's getters add validation (route through
  `resolveReasoningLevel`) — the existing agent getters are free-string; the reasoning getters enforce
  the vocabulary and hard-throw on invalid (§9.2.9 #4).
- **Fail-fast aggregate.** `validateAllReasoningLevels()` lets T4 validate every role's env value in
  one call on the startup path (before any session/agent), so a bad level surfaces as an actionable
  startup error, not a deep runtime failure inside the first agent call.
- **Scope discipline.** S2 = the 5 getters + the aggregate validator + JSDoc + tests ONLY. S1 (landed)
  owns the primitives; S3 reconciles `agent-factory`'s `ThinkingLevel`; S4 owns `.env.example`; T2 owns
  the `.hack [reasoning]` schema; T4 owns the startup call + `main().catch` arm.

---

## What

### User-visible behavior
None directly (config getters). Indirectly, once T3/T4 land: each agent role runs at its resolved
reasoning level (`high`/`high`/`high`/`high`/`off` by default), decoupled from its model tier.

### Technical requirements (exact contract)

**File — `src/config/constants.ts`** (append in the Reasoning section, after `resolveReasoningLevel`
~L1654). Five getters + one aggregate validator:

```ts
/**
 * Read `PRP_REASONING_AGENT` → resolved reasoning level for the research/PRP role (PRD §9.2.9).
 *
 * @returns The resolved {@link ReasoningLevel}, or {@link DEFAULT_REASONING_AGENT} (`'high'`)
 *          when unset or blank.
 *
 * @remarks
 * Routes through {@link resolveReasoningLevel}: the value is matched case-insensitively against
 * {@link REASONING_LEVELS}; an empty/whitespace-only value is treated as unset and falls back to
 * the default (NEVER forwarded — PRD §9.2.9 #4). A value outside the vocabulary is a HARD startup
 * error ({@link ReasoningConfigError}) — unlike the free-string agent getters, this getter validates.
 *
 * @example
 * ```ts
 * import { getReasoningAgent } from './config/constants.js';
 * const level = getReasoningAgent(); // 'high' (default)
 * ```
 */
export function getReasoningAgent(): ReasoningLevel {
  return resolveReasoningLevel(
    process.env[PRP_REASONING_AGENT],
    PRP_REASONING_AGENT,
    DEFAULT_REASONING_AGENT
  );
}
```
…identical shape for the other four, each with its (env-name constant, default) pair and a JSDoc
naming its role + default:
- `getReasoningBreakdown()` → `PRP_REASONING_BREAKDOWN_AGENT` / `DEFAULT_REASONING_BREAKDOWN_AGENT` (`high`)
- `getReasoningBugFinder()` → `PRP_REASONING_BUG_FINDER_AGENT` / `DEFAULT_REASONING_BUG_FINDER_AGENT` (`high`)
- `getReasoningValidation()` → `PRP_REASONING_VALIDATION_AGENT` / `DEFAULT_REASONING_VALIDATION_AGENT` (`high`)
- `getReasoningImpl()` → `PRP_REASONING_IMPL_AGENT` / `DEFAULT_REASONING_IMPL_AGENT` (`off`)

```ts
/**
 * Validate every role's reasoning level by invoking all five getters (PRD §9.2.9 #4 fail-fast).
 *
 * @remarks
 * Each getter throws {@link ReasoningConfigError} on an invalid value; calling all five in sequence
 * makes a single invocation validate the entire reasoning config. Consumed by the startup path (T4)
 * so a bad level aborts before any session is created or agent invoked. A no-op (returns void) when
 * all five resolve successfully.
 */
export function validateAllReasoningLevels(): void {
  getReasoningAgent();
  getReasoningBreakdown();
  getReasoningBugFinder();
  getReasoningValidation();
  getReasoningImpl();
}
```

**Do NOT modify** any S1 symbol (`ReasoningLevel`, `REASONING_LEVELS`, the 5 env-name constants, the
5 defaults, `resolveReasoningLevel`, `ReasoningConfigError`) or any existing getter.

### Success Criteria
- [ ] 5 getters exported, each a one-line `resolveReasoningLevel(process.env[KEY], KEY, DEFAULT)` wrapper.
- [ ] `validateAllReasoningLevels()` exported; calls all 5 getters; `: void`.
- [ ] Each getter: unset/empty/whitespace → its default; valid case-insensitive → lowercased; invalid → throws `ReasoningConfigError`.
- [ ] Defaults: Agent/Breakdown/BugFinder/Validation = `high`; Impl = `off`.
- [ ] `validateAllReasoningLevels()`: no-op when all valid; throws when ANY one is invalid.
- [ ] JSDoc on each (default + empty→default + invalid→hard-error + §9.2.9 ref).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; `constants.test.ts` green at 100% on new lines.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — S1's landed symbols (with line numbers), the verbatim getter bodies,
the `getValidationAgent` JSDoc template, the getter→role→env→default mapping, the test-file structure
(S1's blocks + the env-stub pattern to mirror), the data-driven test plan, and the executable
validation commands are all below.

### Documentation & References

```yaml
# MUST READ — the getter pattern + consumer mapping + .hack schema (cross-checks)
- docfile: plan/013_3f31aa2b81b7/architecture/integration-points.md
  section: "A. src/config/constants.ts" and "C. src/agents/agent-factory.ts"
  why: §A pins getValidationAgent (L993-1004) as the getter-shape template + the env-name/defaults;
        §C cross-checks the consumer mapping (createResearcherAgent→getReasoningAgent, etc. — T3 owns).
  critical: getValidationAgent is FREE-STRING (no validation). The reasoning getters route through
        resolveReasoningLevel (which validates + throws). Do NOT copy the free-string body verbatim.

# MUST READ — S1's landed symbols (with line numbers) + getter bodies + test plan
- docfile: plan/013_3f31aa2b81b7/P1M1T1S2/research/reasoning-getters-design.md
  section: "1. S1 is LANDED" and "2. The getter→role→env→default mapping" and "5. The test file"
  why: Confirms the exact S1 symbols consumed (line numbers), the mapping table, and the test-file
        append site + the vi.stubEnv env pattern.

# PATTERN FILE 1 — the only source file edited
- file: src/config/constants.ts
  why: S1's Reasoning section (ReasoningLevel L1519, REASONING_LEVELS L1534, 5 env-name constants
        L1551-1588, 5 defaults L1593-1616, resolveReasoningLevel L1637-1654). S2 APPENDS the 5 getters
        + validateAllReasoningLevels AFTER resolveReasoningLevel (~L1654). getValidationAgent (L978-1004)
        is the JSDoc+shape template.
  pattern: "export function getValidationAgent(): string { const raw = process.env[KEY]; if (raw === undefined) return DEFAULT; ... }"
  gotcha: The reasoning getter body is a ONE-LINER (return resolveReasoningLevel(...)), NOT the
        free-string body. The validation lives in resolveReasoningLevel (S1).

# PATTERN FILE 2 — the test file to extend
- file: tests/unit/config/constants.test.ts
  why: S1 added describe('resolveReasoningLevel') (L361) + describe('ReasoningConfigError') (end, L452).
        S2 APPENDS after L452. The env-mutating getter tests (getResearchDepth L179, getBugfixScope L296)
        show the pattern: afterEach(() => vi.unstubAllEnvs()) + vi.stubEnv('<VAR>', value) per case.
  pattern: "afterEach(() => vi.unstubAllEnvs()); ... vi.stubEnv('PRP_REASONING_AGENT', 'medium'); expect(getReasoningAgent()).toBe('medium');"
  gotcha: S1's resolveReasoningLevel tests passed raw values as ARGS (no env mutation). S2's getter
        tests READ process.env, so they MUST control env via vi.stubEnv + afterEach unstub.

# VERIFIED FACTS
- fact: "S1 is LANDED. constants.ts:1519 ReasoningLevel; :1534 REASONING_LEVELS; :1551-1588 the 5 PRP_REASONING_* env-name constants; :1593-1616 the 5 DEFAULT_REASONING_* (high/high/high/high/off); :1637-1654 resolveReasoningLevel. types.ts has ReasoningConfigError."
- fact: "getValidationAgent (constants.ts:993-1004) is FREE-STRING (no validation). The reasoning getters route through resolveReasoningLevel, which ADDS toLowerCase + REASONING_LEVELS membership + ReasoningConfigError throw."
- fact: "Getter names (per contract + integration-points §C): getReasoningAgent / getReasoningBreakdown / getReasoningBugFinder / getReasoningValidation / getReasoningImpl. validateAllReasoningLevels calls all 5 in sequence."
- fact: "The 5 getters + validateAllReasoningLevels are one-liners with NO internal branches (branches live in resolveReasoningLevel, covered by S1's tests). For 100% FUNCTION coverage each must be called ≥ once — the data-driven test + validateAll tests cover them."
```

### Current Codebase tree (relevant slice)

```bash
src/config/constants.ts                  # EDIT — append 5 getters + validateAllReasoningLevels + JSDoc (Reasoning section, after resolveReasoningLevel)
tests/unit/config/constants.test.ts      # EDIT — append a describe block (after S1's resolveReasoningLevel/ReasoningConfigError blocks, ~L452)
src/config/types.ts                      # READ-ONLY (ReasoningConfigError — S1, consumed unchanged)
src/agents/agent-factory.ts              # READ-ONLY (T3 wires the getters; S2 must NOT touch it)
```

### Desired Codebase tree with files to be added/edited

```bash
src/config/constants.ts                  # MODIFIED (additive: 5 getters + 1 validator + JSDoc)
tests/unit/config/constants.test.ts      # MODIFIED (additive: 1+ describe blocks)
# No other files. No agent-factory (T3), no .env.example (S4), no .hack schema (T2), no startup (T4).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — S2 is ADDITIVE ONLY. Do NOT modify any S1 symbol (ReasoningLevel, REASONING_LEVELS, the
//   5 env-name constants, the 5 defaults, resolveReasoningLevel) or any existing getter. Append the 5
//   getters + validateAllReasoningLevels in the Reasoning section AFTER resolveReasoningLevel.

// CRITICAL — each getter is a ONE-LINER: `return resolveReasoningLevel(process.env[KEY], KEY, DEFAULT);`
//   Do NOT copy getValidationAgent's free-string body (raw/undefined/trim/''). The validation
//   (lowercase + vocabulary + throw) lives in resolveReasoningLevel — the getter just routes through it.

// CRITICAL — getter DEFAULTS differ: Agent/Breakdown/BugFinder/Validation = 'high'; Impl = 'off'. Wire
//   each getter to its OWN (env-name constant, default) pair — do not hardcode; reference the S1
//   constants (PRP_REASONING_AGENT / DEFAULT_REASONING_AGENT, etc.).

// GOTCHA — validateAllReasoningLevels returns `: void` and calls all 5 getters in sequence. It does
//   NOT collect/return the levels. Its purpose is fail-fast: an invalid value in ANY role throws at
//   the call site (consumed by T4's startup path).

// GOTCHA — JSDoc: mirror getValidationAgent's shape (@returns naming the default + @remarks + @example)
//   but ADD the invalid→ReasoningConfigError note (the reasoning getters validate + throw, unlike the
//   free-string agent getters). Cite §9.2.9 + §9.2.9 #4 (fail-fast) in each getter's @remarks.

// GOTCHA — the getter tests READ process.env (unlike S1's resolveReasoningLevel tests, which passed
//   raw values as args). Use vi.stubEnv('<VAR>', value) + afterEach(() => vi.unstubAllEnvs()) — mirror
//   the getResearchDepth (L179) / getBugfixScope (L296) pattern. Stub the EXACT env-name string
//   ('PRP_REASONING_AGENT', etc.) or use the imported constant.

// GOTCHA — vitest 100% coverage on src/**/*.ts. The 5 getters + validateAllReasoningLevels are
//   branchless one-liners; for 100% FUNCTION coverage each must be CALLED ≥ once. The data-driven
//   test (calling all 5) + the validateAll tests cover every new function. resolveReasoningLevel's
//   branches remain covered by S1's tests (the getters delegate to it).

// GOTCHA — for the "unset → default" test case, the PRP_REASONING_* vars are unset in the test env
//   (S4 adds them to .env.example commented-out), so a bare getter call returns the default. But to
//   be deterministic against any .env leakage, prefer vi.stubEnv('<VAR>', '') for the empty→default
//   case and rely on unset only if you confirm the var is absent.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — do NOT wire any consumer (T3 agent-factory, T4 startup). S2 only PROVIDES the getters.
```

---

## Implementation Blueprint

### Data models and structure
None new — S2 consumes S1's `ReasoningLevel` type + the 5 env-name constants + 5 defaults +
`resolveReasoningLevel`. The getters return `ReasoningLevel`; `validateAllReasoningLevels` is `: void`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/config/constants.ts — append the 5 getters + validateAllReasoningLevels
  - APPEND (in the Reasoning section, after resolveReasoningLevel ~L1654): getReasoningAgent,
        getReasoningBreakdown, getReasoningBugFinder, getReasoningValidation, getReasoningImpl — each
        a one-line `return resolveReasoningLevel(process.env[KEY], KEY, DEFAULT)` wired to its own
        (env-name constant, default) pair.
  - APPEND validateAllReasoningLevels(): void that calls all 5 getters in sequence.
  - JSDoc on each (mirror getValidationAgent: @returns default + @remarks empty→default +
        invalid→ReasoningConfigError + §9.2.9 ref + @example). validateAllReasoningLevels JSDoc:
        states it calls all 5 (fail-fast; consumed by T4 startup).
  - DO NOT modify any S1 symbol or existing getter. Reference the S1 constants by name.
  - EXPECTED: typecheck clean (getters return ReasoningLevel; resolveReasoningLevel is already typed).

Task 2: EDIT tests/unit/config/constants.test.ts — append the getter + validator tests
  - IMPORT the 5 getters + validateAllReasoningLevels from '../../../src/config/constants.js'
        (ReasoningConfigError already imported at L47). Append after S1's blocks (~L452).
  - PREFER a data-driven describe iterating the 5 [getter, envName, default] tuples (DRY; the file's
        style also accepts per-getter describes). Each tuple tests:
      * unset → default (bare call, or stubEnv '' for determinism).
      * empty ('') → default; whitespace ('  ') → default.
      * valid lowercase ('medium') → 'medium'; case-insensitive ('HIGH') → 'high'.
      * invalid ('ultra') → throws ReasoningConfigError (instanceof + .name + .key === envName + .value === 'ultra').
  - FOCUSED: getReasoningImpl() default is 'off' (the one non-high default) — assert explicitly.
  - validateAllReasoningLevels():
      * all-unset → no throw (returns void).
      * one invalid (vi.stubEnv('PRP_REASONING_AGENT', 'ultra')) → throws ReasoningConfigError.
  - afterEach(() => vi.unstubAllEnvs()) in the new describe (mirror getResearchDepth L179).
  - NAMING: it('returns the role default when unset'), it('honors a set value case-insensitively'),
        it('throws ReasoningConfigError on an invalid value'), it('validateAllReasoningLevels is a no-op when all valid'),
        it('validateAllReasoningLevels throws when any role is invalid').
  - PLACEMENT: append after the ReasoningConfigError describe block.

Task 3: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/config/constants.test.ts --coverage.
  - EXPECTED: clean; constants.ts at 100% on the new lines (all 5 getters + validateAllReasoningLevels
        called). S1's resolveReasoningLevel/ReasoningConfigError tests stay green. If a new function is
        uncovered, add a call in the data-driven test.
```

### Implementation Patterns & Key Details

```ts
// ---- src/config/constants.ts: the 5 one-liner getters + the aggregate validator ----
export function getReasoningAgent(): ReasoningLevel {
  return resolveReasoningLevel(
    process.env[PRP_REASONING_AGENT], PRP_REASONING_AGENT, DEFAULT_REASONING_AGENT);
}
export function getReasoningBreakdown(): ReasoningLevel {
  return resolveReasoningLevel(
    process.env[PRP_REASONING_BREAKDOWN_AGENT], PRP_REASONING_BREAKDOWN_AGENT, DEFAULT_REASONING_BREAKDOWN_AGENT);
}
export function getReasoningBugFinder(): ReasoningLevel {
  return resolveReasoningLevel(
    process.env[PRP_REASONING_BUG_FINDER_AGENT], PRP_REASONING_BUG_FINDER_AGENT, DEFAULT_REASONING_BUG_FINDER_AGENT);
}
export function getReasoningValidation(): ReasoningLevel {
  return resolveReasoningLevel(
    process.env[PRP_REASONING_VALIDATION_AGENT], PRP_REASONING_VALIDATION_AGENT, DEFAULT_REASONING_VALIDATION_AGENT);
}
export function getReasoningImpl(): ReasoningLevel {
  return resolveReasoningLevel(
    process.env[PRP_REASONING_IMPL_AGENT], PRP_REASONING_IMPL_AGENT, DEFAULT_REASONING_IMPL_AGENT);
}
export function validateAllReasoningLevels(): void {
  getReasoningAgent();
  getReasoningBreakdown();
  getReasoningBugFinder();
  getReasoningValidation();
  getReasoningImpl();
}

// ---- tests/unit/config/constants.test.ts: data-driven getter tests (DRY) ----
describe('config/constants: per-role reasoning getters', () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  const cases: Array<[string, () => ReasoningLevel, string, ReasoningLevel]> = [
    ['PRP_REASONING_AGENT', getReasoningAgent, 'PRP_REASONING_AGENT', 'high'],
    ['PRP_REASONING_BREAKDOWN_AGENT', getReasoningBreakdown, 'PRP_REASONING_BREAKDOWN_AGENT', 'high'],
    ['PRP_REASONING_BUG_FINDER_AGENT', getReasoningBugFinder, 'PRP_REASONING_BUG_FINDER_AGENT', 'high'],
    ['PRP_REASONING_VALIDATION_AGENT', getReasoningValidation, 'PRP_REASONING_VALIDATION_AGENT', 'high'],
    ['PRP_REASONING_IMPL_AGENT', getReasoningImpl, 'PRP_REASONING_IMPL_AGENT', 'off'],
  ];
  for (const [envName, getter, , def] of cases) {
    it(`${getter.name}: returns default (${def}) when unset/empty/whitespace`, () => {
      vi.stubEnv(envName, ''); expect(getter()).toBe(def);
      vi.stubEnv(envName, '   '); expect(getter()).toBe(def);
    });
    it(`${getter.name}: honors a set value case-insensitively`, () => {
      vi.stubEnv(envName, 'medium'); expect(getter()).toBe('medium');
      vi.stubEnv(envName, 'HIGH'); expect(getter()).toBe('high');
    });
    it(`${getter.name}: throws ReasoningConfigError on invalid`, () => {
      vi.stubEnv(envName, 'ultra');
      expect(() => getter()).toThrow(ReasoningConfigError);
    });
  }
  it('validateAllReasoningLevels is a no-op when all valid', () => {
    expect(() => validateAllReasoningLevels()).not.toThrow();
  });
  it('validateAllReasoningLevels throws when any role is invalid', () => {
    vi.stubEnv('PRP_REASONING_AGENT', 'ultra');
    expect(() => validateAllReasoningLevels()).toThrow(ReasoningConfigError);
  });
});
```

### Integration Points

```yaml
DOWNSTREAM (S2 ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T3 (agent-factory): createResearcherAgent→getReasoningAgent(); createArchitectAgent→
        getReasoningBreakdown(); createCoderAgent→getReasoningImpl(); createQAAgent(level) receives
        the caller-resolved bug-finder/validation level. S2 only PROVIDES the getters.
  - P1.M1.T4 (startup): validateAllReasoningLevels() on the startup path (after configureEnvironment,
        before any agent) + a ReasoningConfigError arm in main().catch.

NO SOURCE INTEGRATION in S2 beyond constants.ts: no consumer reads these getters yet (T3/T4 wire
  them). S1's primitives are UNCHANGED.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint && npm run format:check   # clean
# Expected: clean. typecheck cannot fail on additive getters delegating to an already-typed validator.
```

### Level 2: Unit Tests (the getters + aggregate validator)

```bash
npx vitest run tests/unit/config/constants.test.ts --coverage
# Expected: green; constants.ts at 100% on the new lines (all 5 getters + validateAllReasoningLevels
# called by the data-driven test + the validateAll cases). S1's resolveReasoningLevel/ReasoningConfigError
# tests stay green. If a new function is uncovered, add a call. Do NOT run the full `npm run test:run`.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S2 — config getters with no consumers yet (T3/T4 wire them). Smoke-confirm the getters
# resolve from real env:
npx tsx -e "
import { getReasoningAgent, getReasoningImpl, validateAllReasoningLevels } from './src/config/constants.ts';
console.log('agent default:', getReasoningAgent(), '| impl default:', getReasoningImpl());
process.env.PRP_REASONING_VALIDATION_AGENT = 'XHIGH';
console.log('validation XHIGH →', getReasoningValidation());
validateAllReasoningLevels(); console.log('validateAll (all valid) → no throw');
process.env.PRP_REASONING_AGENT = 'ultra';
try { validateAllReasoningLevels(); } catch (e) { console.log('validateAll threw:', (e as Error).message.split('.')[0]); }
"
# Expected: agent default: high | impl default: off | validation XHIGH → xhigh | validateAll (all valid) → no throw
#   | validateAll threw: Invalid reasoning level for 'PRP_REASONING_AGENT': 'ultra'
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — config getters with no creative surface. Domain checks (record in commit msg):
#   - 5 getters route through resolveReasoningLevel (case-insensitive, empty→default, invalid→throw).
#   - Defaults high/high/high/high/off (Impl is the non-high one).
#   - validateAllReasoningLevels is a fail-fast aggregate (consumed by T4 startup).
#   - No consumer wired (T3 agent-factory / T4 startup are separate).
#   - S1 primitives unchanged.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/constants.test.ts` green; constants.ts at 100% on new lines.

### Feature Validation
- [ ] 5 getters exported; each returns `ReasoningLevel` via `resolveReasoningLevel(process.env[KEY], KEY, DEFAULT)`.
- [ ] Defaults: Agent/Breakdown/BugFinder/Validation = `high`; Impl = `off`.
- [ ] Each getter: unset/empty/whitespace → default; valid case-insensitive → lowercased; invalid → throws `ReasoningConfigError`.
- [ ] `validateAllReasoningLevels()`: no-op when all valid; throws when ANY invalid.
- [ ] JSDoc on each (default + empty→default + invalid→hard-error + §9.2.9).

### Code Quality Validation
- [ ] Only `src/config/constants.ts` (5 getters + validator + JSDoc) + the test file modified.
- [ ] S1 symbols (`ReasoningLevel`, `REASONING_LEVELS`, env-name constants, defaults, `resolveReasoningLevel`, `ReasoningConfigError`) UNCHANGED.
- [ ] Each getter wired to its OWN (env-name constant, default) pair (no hardcoded defaults).
- [ ] Getters are one-liners over `resolveReasoningLevel` (not free-string copies).
- [ ] Tests use `vi.stubEnv` + `afterEach(vi.unstubAllEnvs)` (mirror getResearchDepth/getBugfixScope).

### Documentation & Deployment
- [ ] JSDoc on each getter (Mode A — rides with the code) + `validateAllReasoningLevels`.
- [ ] Commit message notes: 5 per-role getters + fail-fast aggregate; consumers = T3/T4; S1 primitives unchanged.

---

## Anti-Patterns to Avoid

- ❌ Don't copy `getValidationAgent`'s free-string body (raw/undefined/trim/'') — the reasoning getters
      are ONE-LINERS over `resolveReasoningLevel`, which does the validation. The free-string agent
      getters do NOT validate; the reasoning getters MUST (via the validator).
- ❌ Don't modify any S1 symbol (`ReasoningLevel`, `REASONING_LEVELS`, the env-name constants, the
      defaults, `resolveReasoningLevel`) or any existing getter. S2 is purely additive.
- ❌ Don't hardcode the defaults in the getters — reference the S1 `DEFAULT_REASONING_*` constants.
      Impl's default is `off` (not `high`) — wire each getter to its own pair.
- ❌ Don't make `validateAllReasoningLevels` collect/return the levels — it's `: void`; its job is
      fail-fast (call all 5; an invalid one throws).
- ❌ Don't write the getter tests as arg-passing (like S1's `resolveReasoningLevel` tests) — the
      getters READ `process.env`, so the tests MUST use `vi.stubEnv` + `afterEach(vi.unstubAllEnvs)`.
- ❌ Don't wire any consumer (T3 agent-factory, T4 startup) — S2 only PROVIDES the getters.
- ❌ Don't touch `src/agents/agent-factory.ts` (T3 owns the reconcile) or `.env.example` (S4) or the
      `.hack` schema (T2).
- ❌ Don't skip the Impl-`off`-default check — it's the one non-`high` default and easy to mis-wire.
- ❌ Don't run the full `npm run test:run` as the gate — use the targeted constants.test.ts.

---

## Confidence Score

**9/10** — one-pass implementation success likelihood.

Rationale: S1 is LANDED (all primitives verified present with line numbers). The 5 getters are
one-line wrappers with verbatim bodies supplied, each wired to a confirmed (env-name constant, default)
pair from S1. The `getValidationAgent` JSDoc template is identified (with the add-validation note
called out). The test-file append site is confirmed (after S1's blocks, ~L452) and the env-stub pattern
(`vi.stubEnv` + `afterEach unstubAllEnvs`) is mirrored from existing getter tests (getResearchDepth/
getBugfixScope). The data-driven test plan covers all 5 getters + validateAllReasoningLevels at 100%
function coverage (the getters are branchless; branches live in S1's already-covered
`resolveReasoningLevel`). The one residual risk — mis-wiring the Impl-`off` default (the only non-`high`)
— is explicitly gated by a focused test. No external/runtime unknowns.