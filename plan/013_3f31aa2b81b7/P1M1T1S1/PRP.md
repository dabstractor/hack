# PRP — P1.M1.T1.S1: `ReasoningLevel` type, `REASONING_LEVELS` vocabulary, `ReasoningConfigError`, shared validator

> Foundation subtask for PRD §9.2.9 (Per-Role Reasoning Level / Extended-Thinking Budget).
> S1 adds the canonical `ReasoningLevel` type, the vocabulary array, the 5 env-name constants
> + 5 defaults, a shared `resolveReasoningLevel` validator (case-insensitive, hard-throws on
> invalid), and the `ReasoningConfigError` typed error. Consumed by S2 (getters), T2 (.hack
> schema), T3 (agent factories), T4 (startup fail-fast).

---

## Goal

**Feature Goal**: Land the validated vocabulary layer for per-role reasoning levels — the type,
the accepted-values array, the env-var-name constants and defaults for the 5 roles, a shared
validator that accepts values case-insensitively and throws a typed, actionable error on
invalid input, and the `ReasoningConfigError` class that carries the offending key + value.

**Deliverable**:
1. **`src/config/constants.ts`** — a new `// Reasoning Configuration (PRD §9.2.9)` section exporting
   `ReasoningLevel` (type), `REASONING_LEVELS` (readonly array), 5 `PRP_REASONING_*` env-name
   constants, 5 `DEFAULT_REASONING_*` defaults, and `resolveReasoningLevel(raw, envKey, defaultLevel)`.
2. **`src/config/types.ts`** — `ReasoningConfigError` class + a module-local `buildReasoningErrorMessage`
   helper (mirrors `AuthPreflightError`/`buildPreflightMessage`).
3. **`tests/unit/config/constants.test.ts`** — TDD tests for `resolveReasoningLevel` + `ReasoningConfigError`.

**Success Definition**:
- `resolveReasoningLevel` accepts the 6 vocabulary tokens case-insensitively; returns the role
  default for `undefined`/empty/whitespace; throws `ReasoningConfigError` (carrying `key`+`value`)
  for any other value.
- `REASONING_LEVELS === ['off','minimal','low','medium','high','xhigh']` (matches the pi SDK's
  `VALID_THINKING_LEVELS` exactly — verified).
- `npm run typecheck && npm run lint && npm run format:check` clean; new tests pass; the new
  constants.ts/types.ts lines are at 100% coverage.
- No existing getter/type/consumer is modified (S1 is purely additive).

---

## Why

- **Foundation for the §9.2.9 feature.** The per-role reasoning level is a first-class,
  independently-configurable axis (orthogonal to the model tier). Every downstream piece — the 5
  getters (S2), the `.hack [reasoning]` keys (T2), the agent-factory decoupling (T3), and the
  startup fail-fast (T4) — consumes these primitives. S1 must land first.
- **Vocabulary aligned with the pi SDK.** The pi SDK's `VALID_THINKING_LEVELS` is
  `["off","minimal","low","medium","high","xhigh"]` — IDENTICAL to §9.2.9 (verified in
  `external-deps.md §2`). Defining `ReasoningLevel` from this exact set means S3's later
  `ThinkingLevel = ReasoningLevel` alias is a clean reconciliation (drops the divergent `max`,
  adds the missing `minimal`).
- **Fail-fast discipline (§9.2.9 #4).** An invalid level must be a hard startup error with an
  actionable message — not a deep runtime failure inside the first agent call. The validator +
  `ReasoningConfigError` enforce this at the read site.
- **Scope discipline.** S1 = type + vocabulary + 5 env names + 5 defaults + validator + error +
  tests ONLY. The getters (S2), the agent-factory reconcile (S3), `.env.example` (S4), `.hack`
  wiring (T2), and startup integration (T4) are separate subtasks.

---

## What

### User-visible behavior
None directly (config primitives). Indirectly, once S2/T3/T4 land: each agent role runs at its
configured reasoning level (default `high`/`high`/`high`/`high`/`off`), decoupled from its model.

### Technical requirements (exact contract)

**File 1 — `src/config/constants.ts`** — add `import { ReasoningConfigError } from './types.js';`
(NEW one-directional import; verified cycle-free — types.ts does not import constants.ts) and a
new `// Reasoning Configuration (PRD §9.2.9)` section (place near the Bug Hunt / Validation
Control sections). Export:
- `type ReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';`
- `const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;`
- 5 env-name constants: `PRP_REASONING_AGENT`, `PRP_REASONING_BREAKDOWN_AGENT`,
  `PRP_REASONING_BUG_FINDER_AGENT`, `PRP_REASONING_VALIDATION_AGENT`, `PRP_REASONING_IMPL_AGENT`
  (each equals its own name string).
- 5 defaults (`as const`): `DEFAULT_REASONING_AGENT='high'`, `DEFAULT_REASONING_BREAKDOWN_AGENT='high'`,
  `DEFAULT_REASONING_BUG_FINDER_AGENT='high'`, `DEFAULT_REASONING_VALIDATION_AGENT='high'`,
  `DEFAULT_REASONING_IMPL_AGENT='off'`.
- `function resolveReasoningLevel(raw: string | undefined, envKey: string, defaultLevel: ReasoningLevel): ReasoningLevel`:
  `raw === undefined → defaultLevel`; `trim() === '' → defaultLevel`; `lower = trim().toLowerCase()`;
  if `lower` not in `REASONING_LEVELS` → `throw new ReasoningConfigError({ key: envKey, value: raw })`;
  else return `lower`.

**File 2 — `src/config/types.ts`** — add (mirror `AuthPreflightError` at :219-237 + helper at :260):
- `class ReasoningConfigError extends Error` with `readonly key: string; readonly value: string;`
  constructor `({ key, value })` → `super(buildReasoningErrorMessage({ key, value })); this.name =
  'ReasoningConfigError'; this.key = key; this.value = value;`.
- module-local `function buildReasoningErrorMessage({ key, value }): string` returning e.g.
  ``Invalid reasoning level for 'PRP_REASONING_AGENT': 'ultra'. Accepted (case-insensitive): off, minimal, low, medium, high, xhigh.``

**File 3 — `tests/unit/config/constants.test.ts`** — append TDD cases for `resolveReasoningLevel`
+ `ReasoningConfigError` (import both; also `REASONING_LEVELS`).

### Success Criteria
- [ ] `ReasoningLevel`, `REASONING_LEVELS`, 5 `PRP_REASONING_*`, 5 `DEFAULT_REASONING_*`,
      `resolveReasoningLevel` exported from `constants.ts`.
- [ ] `ReasoningConfigError` (+ helper) exported from `types.ts`.
- [ ] `resolveReasoningLevel`: undefined/empty/whitespace → default; valid tokens (case-insensitive)
      → lowercased token; invalid → throws `ReasoningConfigError` with `key`+`value`.
- [ ] `REASONING_LEVELS` deep-equals `['off','minimal','low','medium','high','xhigh']`.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] New tests pass; new constants.ts/types.ts lines at 100% coverage.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the verbatim symbol bodies, the two patterns to mirror (with
file:line), the verified vocabulary alignment (pi SDK == §9.2.9), the verified cycle-free
import direction, the exact test cases, and the executable validation commands are all below.

### Documentation & References

```yaml
# MUST READ — exact verified change sites + the vocabulary-alignment proof
- docfile: plan/013_3f31aa2b81b7/architecture/integration-points.md
  section: "A. src/config/constants.ts" and "B. src/config/types.ts"
  why: Pins the patterns to mirror (getValidationAgent free-string getter; AuthPreflightError +
        buildPreflightMessage typed error), the env-name constant pattern, the defaults, and the
        exact actionable error-message shape.
  critical: The existing getValidationAgent/getBugFinderAgent are FREE-STRING (no validation).
        resolveReasoningLevel ADDS lowercase + vocabulary validation + hard-throw. Do NOT copy the
        free-string body verbatim — add the validation.

# MUST READ — verbatim symbols + cycle-free import note (authored with this PRP)
- docfile: plan/013_3f31aa2b81b7/P1M1T1S1/research/reasoning-config-foundation.md
  section: "3. ⚠️ Import direction (verified cycle-free)" and "4. The new symbols (verbatim shapes)"
  why: Ready-to-paste bodies + the critical note that constants.ts→types.ts is a NEW but cycle-free
        import (types.ts does not import constants.ts).

# PATTERN FILE 1 — the getter pattern to EXTEND (not copy)
- file: src/config/constants.ts
  why: getValidationAgent (~L993-1004) shows the raw/undefined/trim/'' → default shape. Add a NEW
        `import { ReasoningConfigError } from './types.js'` (cycle-free) and the Reasoning section.
  pattern: "const raw = process.env[KEY]; if (raw === undefined) return DEFAULT; const trimmed = raw.trim(); return trimmed === '' ? DEFAULT : trimmed;"
  gotcha: That getter is FREE-STRING (no validation). resolveReasoningLevel must ADD toLowerCase +
        REASONING_LEVELS membership + throw. The 5 per-role GETTERS (S2) wrap this validator — do
        NOT write them in S1.

# PATTERN FILE 2 — the typed error to mirror
- file: src/config/types.ts
  why: AuthPreflightError (L219-237) — `extends Error`, `this.name`, readonly fields, message via
        module-local buildPreflightMessage helper (L260). Mirror this for ReasoningConfigError.
  pattern: "export class AuthPreflightError extends Error { readonly harness; readonly provider; readonly model; constructor(opts){ super(buildPreflightMessage(opts)); this.name='AuthPreflightError'; ... } }"
  gotcha: Use the rich AuthPreflightError form (readonly key+value fields + helper-built message),
        NOT the bare HackConfigError form (L241, message-only). The key+value fields are consumed
        by S4's startup error rendering and tests.

# VOCABULARY PROOF (pi SDK == §9.2.9)
- file: node_modules/@earendil-works/pi-coding-agent/dist/cli/args.js
  why: Line 6 `VALID_THINKING_LEVELS = ["off","minimal","low","medium","high","xhigh"]` — IDENTICAL
        to §9.2.9. So ReasoningLevel matches the pi SDK; S3's later ThinkingLevel alias is clean.
  pattern: 'const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];'
  gotcha: The pipeline's CURRENT agent-factory ThinkingLevel DIVERGES ('off'|'low'|'medium'|'high'|
        'xhigh'|'max' — has 'max', lacks 'minimal'). S3 reconciles it; S1 just defines the canonical
        ReasoningLevel. Do NOT touch agent-factory in S1.

# TEST FILE (append per contract)
- file: tests/unit/config/constants.test.ts
  why: The contract names this file for the validator/error tests. Append a new describe block.
        (S2's per-getter tests may later go in a dedicated reasoning-config.test.ts.)
  pattern: "describe('config/constants: resolveReasoningLevel', () => { it('returns the default for undefined/empty/whitespace', ...); it('accepts valid tokens case-insensitively', ...); it('throws ReasoningConfigError on invalid', ...); })"
  gotcha: Cover EVERY branch for 100% coverage: undefined→default, ''→default, '  '→default, valid,
        case-fold ('HIGH'→'high'), invalid→throw (assert key+value+message+name).
```

### Current Codebase tree (relevant slice)

```bash
src/config/constants.ts   # EDIT — add types.ts import + Reasoning section (type, array, 5 names, 5 defaults, validator)
src/config/types.ts       # EDIT — add ReasoningConfigError + buildReasoningErrorMessage helper
tests/unit/config/constants.test.ts   # EDIT — append resolveReasoningLevel + ReasoningConfigError tests
src/agents/agent-factory.ts   # READ-ONLY (S3 reconciles ThinkingLevel; S1 must NOT touch it)
```

### Desired Codebase tree with files to be added/edited

```bash
src/config/constants.ts   # MODIFIED (additive: 1 import + 1 section)
src/config/types.ts       # MODIFIED (additive: 1 class + 1 helper)
tests/unit/config/constants.test.ts   # MODIFIED (additive: 1 describe block)
# No other files. No getters (S2), no agent-factory (S3), no .env.example (S4), no .hack (T2).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — constants.ts→types.ts is a NEW import. It is cycle-free (types.ts does NOT import
//   constants.ts — verified). Do NOT add the reverse edge. The established "getter-that-throws"
//   module is harness.ts (imports both), but the contract puts resolveReasoningLevel in constants.ts.

// CRITICAL — the existing getValidationAgent/getBugFinderAgent are FREE-STRING (no validation).
//   resolveReasoningLevel ADDS toLowerCase + REASONING_LEVELS membership + throw. Don't copy the
//   free-string body without the validation additions.

// CRITICAL — ReasoningLevel is the pi-SDK-aligned vocabulary: off|minimal|low|medium|high|xhigh.
//   It INCLUDES 'minimal' and does NOT include 'max'. (The current agent-factory ThinkingLevel
//   diverges — S3 reconciles it; S1 only defines ReasoningLevel.) Do NOT add 'max'.

// GOTCHA — REASONING_LEVELS is `as const` (readonly tuple). To call .includes(lowered) where
//   lowered is a string, cast the ARRAY: `(REASONING_LEVELS as readonly string[]).includes(lowered)`
//   (not the value). Then return `lowered as ReasoningLevel`.

// GOTCHA — mirror the rich AuthPreflightError form (readonly key+value fields + helper-built
//   message), NOT the bare HackConfigError form. The key+value fields are needed by tests + T4's
//   startup rendering.

// GOTCHA — resolveReasoningLevel's `raw` is `string | undefined` (it receives process.env[KEY]
//   directly). `envKey` is the var NAME (for the error message). `defaultLevel` is the role default.

// GOTCHA — vitest 100% coverage on src/**/*.ts. Hit every branch: undefined→default, ''→default,
//   '  '→default, valid token, case-fold, invalid→throw. Plus REASONING_LEVELS shape + direct
//   ReasoningConfigError construction.

// GOTCHA — JSDoc: follow getValidationAgent/AuthPreflightError JSDoc style. resolveReasoningLevel's
//   JSDoc must state: case-insensitive, empty/whitespace→default, invalid→ReasoningConfigError
//   (hard startup error per §9.2.9). ReasoningConfigError's JSDoc must cite §9.2.9 fail-fast.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — do NOT write the 5 per-role getters (S2), the agent-factory reconcile (S3), .env.example
//   (S4), the .hack schema (T2), or the startup validateAllReasoningLevels (T4). S1 is the
//   vocabulary + validator + error ONLY.
```

---

## Implementation Blueprint

### Data models and structure

```ts
// constants.ts (new section) — the validated vocabulary + shared validator.
export type ReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
// + 5 PRP_REASONING_* env-name constants + 5 DEFAULT_REASONING_* defaults (as const)
export function resolveReasoningLevel(raw, envKey, defaultLevel): ReasoningLevel { /* validate */ }

// types.ts (new) — typed error mirroring AuthPreflightError.
export class ReasoningConfigError extends Error { readonly key; readonly value; /* name + helper msg */ }
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/config/types.ts — add ReasoningConfigError + helper
  - APPEND (mirror AuthPreflightError L219-237 + buildPreflightMessage L260):
        export class ReasoningConfigError extends Error { readonly key: string; readonly value: string;
          constructor(opts: { key: string; value: string }) { super(buildReasoningErrorMessage(opts));
          this.name = 'ReasoningConfigError'; this.key = opts.key; this.value = opts.value; } }
  - APPEND module-local function buildReasoningErrorMessage({ key, value }): string returning
        `Invalid reasoning level for '${key}': '${value}'. Accepted (case-insensitive): off, minimal, low, medium, high, xhigh.`
  - JSDoc on the class citing PRD §9.2.9 fail-fast (mirror AuthPreflightError's @remarks).
  - DO NOT modify existing error classes.

Task 2: EDIT src/config/constants.ts — add the Reasoning section
  - ADD `import { ReasoningConfigError } from './types.js';` (cycle-free — types.ts does not import constants.ts).
  - APPEND a `// Reasoning Configuration (PRD §9.2.9)` section near the Bug Hunt / Validation sections:
        ReasoningLevel type, REASONING_LEVELS (`as const`), 5 PRP_REASONING_* env-name constants,
        5 DEFAULT_REASONING_* defaults (`as const`), resolveReasoningLevel (verbatim body from the
        research note §4 / "Technical requirements").
  - JSDoc on resolveReasoningLevel (case-insensitive; empty/whitespace→default; invalid→ReasoningConfigError).
  - DO NOT modify existing getters/constants.

Task 3: EDIT tests/unit/config/constants.test.ts — TDD cases
  - IMPORT resolveReasoningLevel, REASONING_LEVELS from '../../../src/config/constants.js';
        ReasoningConfigError from '../../../src/config/types.js'.
  - describe('config/constants: resolveReasoningLevel') cases:
      * undefined → defaultLevel; '' → defaultLevel; '   ' → defaultLevel.
      * 'high' → 'high'; 'HIGH' → 'high' (case-insensitive); 'xHigh' with defaultLevel 'off' → 'xhigh'.
      * 'ultra' → throws ReasoningConfigError (instanceof Error; .name === 'ReasoningConfigError';
        .key === KEY; .value === 'ultra'; message includes KEY + 'ultra' + the accepted list).
      * 'yes' → throws (second invalid token).
      * REASONING_LEVELS deep-equals the 6 lowercase tokens.
      * new ReasoningConfigError({key,value}) carries key+value + name set.
  - PLACEMENT: append the describe block in constants.test.ts (per contract).

Task 4: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/config/constants.test.ts --coverage.
  - EXPECTED: clean; constants.ts + types.ts at 100% on new lines. If a branch is uncovered
        (e.g. case-fold, invalid-throw), add the matching case.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the validator (case-insensitive; empty→default; invalid→typed throw).
export function resolveReasoningLevel(
  raw: string | undefined,
  envKey: string,
  defaultLevel: ReasoningLevel
): ReasoningLevel {
  if (raw === undefined) return defaultLevel;
  const trimmed = raw.trim();
  if (trimmed === '') return defaultLevel;
  const lowered = trimmed.toLowerCase();
  if (!(REASONING_LEVELS as readonly string[]).includes(lowered)) {
    throw new ReasoningConfigError({ key: envKey, value: raw }); // hard startup error (§9.2.9)
  }
  return lowered as ReasoningLevel;
}

// PATTERN — the typed error (mirrors AuthPreflightError: name + readonly fields + helper-built msg).
export class ReasoningConfigError extends Error {
  readonly key: string;
  readonly value: string;
  constructor(opts: { key: string; value: string }) {
    super(buildReasoningErrorMessage(opts));
    this.name = 'ReasoningConfigError';
    this.key = opts.key;
    this.value = opts.value;
  }
}
function buildReasoningErrorMessage(opts: { key: string; value: string }): string {
  return `Invalid reasoning level for '${opts.key}': '${opts.value}'. Accepted (case-insensitive): off, minimal, low, medium, high, xhigh.`;
}
```

### Integration Points

```yaml
DOWNSTREAM (S1 ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T1.S2 (getters): getReasoningAgent/Breakdown/BugFinder/Validation/Impl — one-line wrappers:
        resolveReasoningLevel(process.env[PRP_REASONING_AGENT], PRP_REASONING_AGENT, DEFAULT_REASONING_AGENT).
  - P1.M1.T1.S3 (agent-factory): alias ThinkingLevel = ReasoningLevel (add minimal, drop max).
  - P1.M1.T2 (.hack schema): 5 [reasoning] SCHEMA_MAP entries using these env names + defaults + acceptedValues.
  - P1.M1.T4 (startup): validateAllReasoningLevels() calls all 5 getters; main().catch ReasoningConfigError arm.

NO SOURCE INTEGRATION in S1 beyond the two config files: no consumer reads these symbols yet.
  Existing getters/types are UNCHANGED.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint && npm run format:check   # clean
# Expected: clean. If typecheck errors on the new import, confirm types.ts doesn't import constants.ts
# (it must not — cycle). If it errors on .includes, use the (REASONING_LEVELS as readonly string[]) cast.
```

### Level 2: Unit Tests (the validator + error)

```bash
npx vitest run tests/unit/config/constants.test.ts --coverage
# Expected: green; constants.ts + types.ts at 100% on the new lines. If a branch is uncovered
# (undefined/empty/whitespace-default, case-fold, invalid-throw), add the matching case.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S1 — config primitives with no consumers yet (S2/T3/T4 wire them). Smoke-confirm the
# validator behaves end-to-end:
npx tsx -e "
import { resolveReasoningLevel, REASONING_LEVELS } from './src/config/constants.ts';
import { ReasoningConfigError } from './src/config/types.ts';
console.log('vocab:', REASONING_LEVELS.join(','));
console.log('HIGH →', resolveReasoningLevel('HIGH', 'PRP_REASONING_AGENT', 'high'));
console.log('unset →', resolveReasoningLevel(undefined, 'X', 'off'));
try { resolveReasoningLevel('ultra', 'PRP_REASONING_AGENT', 'high'); } catch (e) { console.log('threw:', (e as Error).message); }
"
# Expected: vocab: off,minimal,low,medium,high,xhigh | HIGH → high | unset → off | threw: Invalid reasoning level for 'PRP_REASONING_AGENT': 'ultra'. Accepted (case-insensitive): off, minimal, low, medium, high, xhigh.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — config primitives with no creative surface. Domain checks (record in commit msg):
#   - ReasoningLevel matches the pi SDK VALID_THINKING_LEVELS exactly (off/minimal/low/medium/high/xhigh).
#   - Case-insensitive acceptance + empty/whitespace→default + invalid→typed hard error (§9.2.9 #2/#3/#4).
#   - constants.ts→types.ts import is cycle-free (types.ts does not import constants.ts).
#   - No consumer wired (S2 getters / S3 agent-factory / T2 .hack / T4 startup are separate).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/constants.test.ts` green; new lines at 100% coverage.

### Feature Validation
- [ ] `ReasoningLevel` = `off|minimal|low|medium|high|xhigh`; `REASONING_LEVELS` deep-equals that array.
- [ ] 5 `PRP_REASONING_*` env-name constants + 5 `DEFAULT_REASONING_*` defaults (high/high/high/high/off).
- [ ] `resolveReasoningLevel`: undefined/empty/whitespace→default; valid case-insensitive→lowercased; invalid→throws.
- [ ] `ReasoningConfigError` carries `key`+`value`, `name` set, actionable message (key+value+accepted list).

### Code Quality Validation
- [ ] Only `constants.ts` (additive section + 1 import), `types.ts` (additive class + helper), and the test file modified.
- [ ] Existing getters/types/consumers UNCHANGED.
- [ ] `constants.ts→types.ts` import is cycle-free (types.ts does not import constants.ts).
- [ ] ReasoningLevel matches the pi SDK vocabulary (no `max`, includes `minimal`).

### Documentation & Deployment
- [ ] JSDoc on `resolveReasoningLevel` (case-insensitive, empty→default, invalid→ReasoningConfigError, §9.2.9) + `ReasoningConfigError` (§9.2.9 fail-fast).
- [ ] Commit message notes: vocabulary foundation aligned with pi SDK; cycle-free constants→types import; consumers = S2/T3/T4.

---

## Anti-Patterns to Avoid

- ❌ Don't copy `getValidationAgent`'s body verbatim — it's FREE-STRING (no validation). `resolveReasoningLevel` ADDS toLowerCase + vocabulary membership + hard-throw.
- ❌ Don't include `max` in `ReasoningLevel` (it diverges from the pi SDK; the current agent-factory `ThinkingLevel` has it but S3 removes it). The canonical set is `off|minimal|low|medium|high|xhigh`.
- ❌ Don't drop `minimal` — it IS in the pi SDK vocabulary and §9.2.9 (verified).
- ❌ Don't create a circular import. `constants.ts` imports `ReasoningConfigError` from `types.ts`; `types.ts` must NOT import `constants.ts` (verified today; keep it that way).
- ❌ Don't write the 5 per-role getters (S2), the agent-factory reconcile (S3), `.env.example` (S4), the `.hack` schema (T2), or the startup validator (T4) — S1 is the vocabulary + validator + error ONLY.
- ❌ Don't use the bare `HackConfigError` form for `ReasoningConfigError` — use the rich `AuthPreflightError` form (readonly key+value fields + helper-built message); tests + T4 need the fields.
- ❌ Don't cast the value to satisfy `.includes` — cast the ARRAY: `(REASONING_LEVELS as readonly string[]).includes(lowered)`.
- ❌ Don't touch `src/agents/agent-factory.ts` — its `ThinkingLevel` diverges but S3 reconciles it; S1 only defines the canonical `ReasoningLevel`.
- ❌ Don't run the full `npm run test:run` as the S1 gate — use the targeted constants.test.ts (the wider suite state is orthogonal to this additive change).

---

## Confidence Score

**9/10** — one-pass implementation success likelihood.

Rationale: This is a config-primitives subtask with verbatim symbol bodies supplied, two verified
patterns to mirror (`getValidationAgent` for the getter shape, `AuthPreflightError`+`buildPreflightMessage`
for the typed error), and a verified vocabulary alignment (pi SDK `VALID_THINKING_LEVELS` == §9.2.9 ==
`ReasoningLevel`). The one structural subtlety — that `constants.ts` gains a new `types.ts` import — is
explicitly verified cycle-free (types.ts does not import constants.ts) and called out at the top. The
test plan covers every branch for 100% coverage. The only residual risks are (a) the `.includes`
tuple-typing cast (shown explicitly) and (b) accidentally touching agent-factory (fenced off: S3 owns it).
No external/runtime unknowns.