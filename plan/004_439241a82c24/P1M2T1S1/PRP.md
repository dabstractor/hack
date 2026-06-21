# PRP — P1.M2.T1.S1: Provider-endpoint guard tests (constraint is on the provider)

---

## Goal

**Feature Goal**: Clarify (PRD §9.2.4) that the API-endpoint safeguard constrains
the **LLM provider** (z.ai), NOT the agent **harness** (`pi`/`claude-code`) — and
prove it with a green, deterministic unit-test suite. Make the guard logic
directly testable by extracting it into a pure module, then assert: (a) the z.ai
provider endpoint is **ALLOWED** under the default `pi` harness; (b) Anthropic's
official API endpoint is **BLOCKED/reported**; (c) the guard message makes clear
it constrains the **provider**, not the harness. Reword the two script guards'
messaging (no weakening of z.ai enforcement; preserve exit codes).

**Deliverable**:

1. **`src/config/endpoint-guard.ts`** — **CREATE**: a shared, 100%-coverable
   guard module exporting `checkProviderEndpoint(baseUrl)` (pure) and
   `validateProviderEndpoint(baseUrl?)` (env-reading; throws on block / warns on
   warning). Message text is centralized here and explicitly states it constrains
   the **provider** and is **orthogonal to the harness**.
2. **`tests/unit/config/endpoint-guard.test.ts`** — **CREATE**: the clarified
   safeguard test suite using `vi.stubEnv` (z.ai / Anthropic / localhost-mock /
   other) asserting branches + the provider-vs-harness message wording.
3. **`src/scripts/validate-api.ts`** — **EDIT**: replace the inlined guard block
   with a call to `checkProviderEndpoint(...)`; print `result.message`; keep
   `process.exit(1)` on block, keep the console.warn on warning. **Do NOT** import
   this script from any test (coverage scope — see Gotchas).
4. **`tests/validation/zai-api-test.ts`** — **EDIT**: same refactor as the script
   above (replace inlined guard with `checkProviderEndpoint(...)`; preserve
   `process.exit(1)`).
5. **`tests/setup.ts`** — **EDIT**: replace the inlined `validateApiEndpoint()`
   body with a call to `validateProviderEndpoint()` (delegation). Preserve the
   EXACT "throw on Anthropic" semantics so no other tests break. The clarified
   provider message now reaches the actual test-time enforcement.

**Success Definition** (the contract from the work item):

- A green, clarified safeguard test suite documenting that the **provider** (not
  the harness) is the constrained axis (PRD §9.2.4).
- `checkProviderEndpoint('https://api.z.ai/api/anthropic').status === 'allowed'`.
- `checkProviderEndpoint('https://api.anthropic.com').status === 'blocked'` and
  its `message` contains "provider" and asserts orthogonality to the harness.
- `checkProviderEndpoint('http://localhost:3000').status === 'allowed'`.
- `validateProviderEndpoint()` (env-default) with `ANTHROPIC_BASE_URL` stubbed to
  Anthropic **throws**; stubbed to z.ai or localhost **does not throw**.
- `validate-api.ts` / `zai-api-test.ts` still `process.exit(1)` on an Anthropic
  endpoint (exit code unchanged); `tests/setup.ts` still throws on Anthropic.
- `npm run validate` + `npm run test:run` both green; **100% coverage** retained
  on all `src/**/*.ts` (incl. the new `endpoint-guard.ts`).

---

## Why

- **PRD §9.2.4 / §9.4 clarification.** The safeguard was written before the
  pluggable-harness work (P1.M1) and its wording ("requires z.ai API endpoint")
  reads as a blanket config rule. PRD §9.2.4 (h4.3) + §9.4 (h3.18) make explicit
  that the constraint is on the LLM **provider** and is orthogonal to the harness
  — the default `pi` harness runs any provider, so the pipeline defaults to `pi` +
  `zai` and the safeguard stays effective. This subtask encodes that clarification
  as executable tests + reworded messages.
- **Turns an untestable guard into a testable one.** `tests/unit/setup-verification.test.ts:146`
  literally laments the guard "is not exported, so it cannot be directly tested" —
  it only documents expected behavior via a local copy of `BLOCKED_PATTERNS`.
  Extracting `endpoint-guard.ts` makes the branch logic + message directly
  assertable, which is exactly what the work item asks ("assert on the guard's
  branch/message, not a live request").
- **De-duplicates the guard.** The same logic is currently copy-pasted across
  `validate-api.ts`, `zai-api-test.ts`, and `tests/setup.ts`. A single module +
  centralized message eliminates drift (the script currently blocks only
  `https://api.anthropic.com` while setup blocks all three protocol variants —
  unifying strengthens, never weakens).
- **Pairs with the harness/provider work.** P1.M1 (config + model resolution) and
  P1.M1.T2.S2 (harness field) establish provider-qualified models + a `pi`
  harness. This item's test (a) ties the allowed z.ai endpoint to the default `pi`
  harness (`DEFAULT_HARNESS`), documenting the orthogonality the harness system
  relies on. It is disjoint from P1.M2.T1.S2 (harness/provider **compatibility
  rejection** test) — that covers `HarnessProviderMismatchError`; this covers the
  **endpoint** guard. Do not overlap.
- **Out of scope (hard boundary):** `configureHarness()`/`harness.ts` (T1.S2),
  `getModel()`/`qualifyModel()` (T2.S1), the `harness` config field (T2.S2),
  harness/provider compatibility tests (M2.T1.S2), feature-parity tests (M2.T2),
  docs files (M2.T3), and the stale model-selection checks inside
  `zai-api-test.ts` Test 2 (unrelated to the guard).

---

## What

### User-visible behavior

None at runtime / CLI for normal operation (the guard was and remains a fail-fast
block on Anthropic endpoints). Observable changes:

1. A new importable module `src/config/endpoint-guard.ts` with a testable API.
2. The block/warn **message text** now explicitly names the **provider** and notes
   orthogonality to the harness (was: generic "requires z.ai API endpoint").
3. The standalone script `validate-api.ts` now blocks all three Anthropic protocol
   variants (was: only `https://`), matching `tests/setup.ts`.

### Technical requirements (exact contract)

**`src/config/endpoint-guard.ts`** (CREATE) — the shared guard:

```ts
export const ZAI_ENDPOINT = 'https://api.z.ai/api/anthropic';
export const BLOCKED_ENDPOINT_PATTERNS = [
  'https://api.anthropic.com',
  'http://api.anthropic.com',
  'api.anthropic.com',
] as const;

export type EndpointCheckStatus = 'allowed' | 'blocked' | 'warning';
export interface EndpointCheckResult {
  readonly status: EndpointCheckStatus;
  readonly message: string;
}

/** PURE predicate — no env access, no side effects. */
export function checkProviderEndpoint(baseUrl: string): EndpointCheckResult;

/** Reads process.env.ANTHROPIC_BASE_URL by default; throws on 'blocked',
 *  console.warn on 'warning'. Used by tests/setup.ts + tests. */
export function validateProviderEndpoint(
  baseUrl: string = process.env.ANTHROPIC_BASE_URL ?? ''
): void;
```

Decision table (the implementation MUST realize exactly this):

| `baseUrl`                                            | `status`  | side effect in `validateProviderEndpoint` |
| ---------------------------------------------------- | --------- | ----------------------------------------- |
| `''` (empty/unset)                                   | `allowed` | none                                      |
| `=== ZAI_ENDPOINT`                                   | `allowed` | none                                      |
| includes `localhost` / `127.0.0.1` / `mock` / `test` | `allowed` | none                                      |
| includes any `BLOCKED_ENDPOINT_PATTERNS` entry       | `blocked` | **throw new Error(message)**              |
| anything else (non-empty, non-z.ai, non-mock)        | `warning` | **console.warn(message)**                 |

The `message` for `blocked`/`warning` MUST:

- contain the word **provider** (e.g. "LLM provider endpoint"),
- state it constrains the **provider** and is **orthogonal to the agent harness**
  (e.g. "This safeguard constrains the LLM provider endpoint (z.ai), not the agent
  harness. The pi harness is provider-neutral; the pipeline defaults to pi + zai."),
- reference PRD §9.2.4,
- NOT attribute the constraint to the harness (must not read or mention
  `PRP_AGENT_HARNESS`).

**`tests/unit/config/endpoint-guard.test.ts`** (CREATE) — mirrors the style of
`tests/unit/config/harness-config.test.ts` (`afterEach(() => vi.unstubAllEnvs())`,
`vi.stubEnv`, `expect(() => fn()).toThrow(Error)`). Covers:

- Pure `checkProviderEndpoint` across all 5 input classes (table above).
- `validateProviderEndpoint()` with `ANTHROPIC_BASE_URL` stubbed (via `vi.stubEnv`)
  to z.ai (no throw), to Anthropic (throws), to localhost/mock (no throw), to other
  (warns — spy `console.warn`).
- **Provider-vs-harness clarification (c):** the blocked `message` contains
  "provider" and asserts orthogonality; AND `DEFAULT_HARNESS === 'pi'` (imported
  from `src/config/constants.js`) to document that the allowed config is the
  default `pi` harness + z.ai provider. Spy that `console.warn` is/isn't called.
- Restore env in `afterEach` (`vi.unstubAllEnvs()`) and restore `console.warn`
  with `vi.spyOn(console, 'warn').mockRestore()` (or `vi.restoreAllMocks()`).

**`src/scripts/validate-api.ts`** (EDIT) — replace the two inlined guard blocks
(the `if (configuredBaseUrl.includes(ANTHROPIC_ENDPOINT)) { … process.exit(1); }`
hard-exit AND the non-z.ai `log.warn` block) with:

```ts
import { checkProviderEndpoint } from '../config/endpoint-guard.js';
// …after configureEnvironment():
const result = checkProviderEndpoint(process.env.ANTHROPIC_BASE_URL ?? '');
if (result.status === 'blocked') {
  log.error(result.message);
  process.exit(1);
}
if (result.status === 'warning') {
  log.warn(result.message);
}
```

Keep the existing `colors`/`log` helpers and everything else byte-for-byte. The
exit code on block stays `1` (work item: "Keep exit-code behavior intact").

**`tests/validation/zai-api-test.ts`** (EDIT) — same refactor: replace its inlined
`if (configuredBaseUrl.includes(ANTHROPIC_ENDPOINT)) { … process.exit(1); }` block
with `checkProviderEndpoint(...)` + `process.exit(1)` on `blocked` + `warn` on
`warning`. (Not run by vitest — filename `-test.ts`; verified.)

**`tests/setup.ts`** (EDIT) — replace the BODY of `validateApiEndpoint()` with a
delegation to `validateProviderEndpoint()`. Concretely: keep the function name
`validateApiEndpoint` (it is called in two places in this file: module-load +
`beforeEach`), and inside it call `validateProviderEndpoint()`. The thrown
`Error(message)` semantics are preserved 1:1 (the new module throws on Anthropic),
so the global test-time guard behaves identically. Remove the now-duplicated
`ZAI_ENDPOINT`/`BLOCKED_PATTERNS` constants + message arrays from `setup.ts` (they
now live in the module). Keep the `console.warn` "non-z.ai endpoint detected"
behavior — it is reproduced by `validateProviderEndpoint`'s warning branch.

### Success Criteria

- [ ] `src/config/endpoint-guard.ts` exists and exports `checkProviderEndpoint`,
      `validateProviderEndpoint`, `ZAI_ENDPOINT`, `BLOCKED_ENDPOINT_PATTERNS`,
      `EndpointCheckStatus`, `EndpointCheckResult`.
- [ ] `checkProviderEndpoint` realizes the decision table exactly (5 input classes).
- [ ] The blocked/warning `message` contains "provider" and the orthogonality note.
- [ ] `tests/unit/config/endpoint-guard.test.ts` is green and covers 100% of
      `endpoint-guard.ts` (all branches of both functions).
- [ ] `validate-api.ts` and `zai-api-test.ts` still `process.exit(1)` on an
      Anthropic endpoint (manual reasoning / script structure preserved).
- [ ] `tests/setup.ts` still throws on an Anthropic endpoint (full `npm run test:run`
      green proves no regression to the global guard).
- [ ] `npm run validate` exits 0; `npm run test:run` exits 0 with 100% coverage.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to
implement this successfully?_ **Yes** — every file path is concrete; the decision
table is exhaustive; the message contract is spelled out word-for-word; the
non-obvious traps (coverage scope of the script, the global-setup `beforeEach`
ordering, vitest ignoring `-test.ts`, `setup-verification.test.ts` independence)
are enumerated in the Gotchas with exact grep evidence in
`research/guard-extraction-and-coverage.md`.

### Documentation & References

```yaml
# MUST READ — PRD sections this item implements
- docfile: PRD.md
  section: "9.2.4 API Endpoint Safeguards"  (h4.3)
  why: Defines the safeguard: z.ai provider endpoint enforced; Anthropic official
       API blocked; warnings for non-z.ai (excluding localhost/mock/test). The h3.18
       "Harness note" clarifies the constraint is on the PROVIDER, not the harness.
  critical: The safeguard is orthogonal to the harness — message MUST say so.

- docfile: PRD.md
  section: "9.4 Agent Harness System (Runtime Selection)"  (h3.18 / h4.11)
  why: Harness ↔ provider orthogonality; default pi harness is provider-neutral;
       pipeline defaults to pi + zai. Test (a) ties the allowed z.ai endpoint to
       DEFAULT_HARNESS === 'pi'.

# MUST READ — architecture (authoritative current-vs-target inventory)
- docfile: plan/004_439241a82c24/architecture/external_deps.md
  section: "6. Safeguard interaction (PRD §9.2.4)"
  why: Confirms the guard lives in validate-api.ts + zai-api-test.ts (+ setup.ts)
       and that the delta CLARIFIES the constraint is on the provider.
- docfile: plan/004_439241a82c24/architecture/delta_impact.md
  section: "B. Agent runtime layer — validate-api.ts + zai-api-test.ts"
  why: TARGET = "clarify the guard targets the provider endpoint; add/note the
       harness↔provider compatibility check. No change to the z.ai happy-path."

# THIS subtask's research (read first — contains the traps)
- docfile: plan/004_439241a82c24/P1M2T1S1/research/guard-extraction-and-coverage.md
  section: "2. Coverage scope", "4. Global-setup interaction", "5. Extraction design",
           "7. setup-verification.test.ts will NOT break"
  why: The four non-obvious traps + the dual-function design + branch-coverage table.

# PATTERN FILES — copy these conventions exactly
- file: tests/unit/config/harness-config.test.ts
  why: Template for the new test file — vi.mock, vi.stubEnv, afterEach(vi.unstubAllEnvs),
       expect(() => fn()).toThrow(Error), delete process.env.X patterns.
  pattern: "afterEach(() => { vi.unstubAllEnvs(); });  …  expect(() => configureHarness()).toThrow(...)"
  gotcha: console.warn must be spied+restored (vi.spyOn(console,'warn')) for the warning branch.

- file: tests/unit/config/environment.test.ts
  why: Confirms the afterEach(vi.unstubAllEnvs()) + DEFAULT_BASE_URL import convention.
  pattern: "import { DEFAULT_BASE_URL } from '../../../src/config/constants.js';"

- file: tests/setup.ts
  why: The global guard to EDIT. validateApiEndpoint() runs at module load AND in
       beforeEach. Replace its BODY with validateProviderEndpoint(); keep the name.
  pattern: "function validateApiEndpoint(): void { … BLOCKED_PATTERNS.some(p => baseUrl.includes(p)) … throw new Error(errorMessage); }"
  gotcha: Global beforeEach runs BEFORE local hooks — vi.stubEnv in the new test is
          applied AFTER the global check, so the global guard never sees a stubbed
          Anthropic URL. Preserve this invariant.

- file: src/scripts/validate-api.ts
  why: The script guard to EDIT. Two inlined blocks (hard-exit + warn) → replace with
        checkProviderEndpoint(). Keep process.exit(1), colors, log helpers, main().
  pattern: "if (configuredBaseUrl.includes(ANTHROPIC_ENDPOINT)) { … process.exit(1); }"
  gotcha: NEVER import this script from a test — it would enter coverage scope and
          its network/exit code breaks the 100% threshold (see research §2).

- file: tests/validation/zai-api-test.ts
  why: The second script guard to EDIT (same refactor). Not run by vitest.
  pattern: "if (configuredBaseUrl.includes(ANTHROPIC_ENDPOINT)) { … process.exit(1); }"
  gotcha: Leave its Test 2 model-selection checks (getModel === 'GLM-4.7') ALONE —
          stale vs T2.S1 but out of scope and not executed by the suite.

# CONSUMERS (read-only — proves non-breaking)
- file: tests/unit/setup-verification.test.ts
  why: Lines ~146 document the guard as "not exported, cannot be directly tested" and
       assert on a LOCAL BLOCKED_PATTERNS copy — they do NOT import setup.ts. The new
       module finally makes the guard testable. Refactoring setup.ts will NOT break it.
- file: src/config/constants.ts
  why: CONSUME — DEFAULT_BASE_URL, DEFAULT_HARNESS==='pi', DEFAULT_MODEL_PROVIDER==='zai'.
        Import DEFAULT_HARNESS into the test for the orthogonality assertion.
- file: src/config/harness.ts
  why: CONSUME (read-only) — the harness/provider MISMATCH guard is SEPARATE
        (HarnessProviderMismatchError, owned by P1.M2.T1.S2). Do NOT duplicate it here.
```

### Current Codebase tree (relevant slice)

```bash
src/config/
├── constants.ts        # CONSUME — DEFAULT_BASE_URL, DEFAULT_HARNESS, DEFAULT_MODEL_PROVIDER
├── environment.ts      # CONSUME — configureEnvironment() (call before guard in scripts)
├── harness.ts          # CONSUME (read-only) — separate mismatch guard (M2.T1.S2)
├── types.ts            # CONSUME — AgentHarness etc. (no edit)
└── endpoint-guard.ts   # CREATE — shared pure + env-reading guard module
src/scripts/
└── validate-api.ts     # EDIT — replace inlined guard with checkProviderEndpoint(); keep exit(1)
tests/
├── setup.ts                          # EDIT — validateApiEndpoint() body → validateProviderEndpoint()
├── validation/zai-api-test.ts        # EDIT — replace inlined guard; keep exit(1) (NOT run by vitest)
└── unit/config/endpoint-guard.test.ts # CREATE — the clarified safeguard test suite
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/config/endpoint-guard.ts                          # NEW — pure check + env-reading validate; provider-clarified message
tests/unit/config/endpoint-guard.test.ts              # NEW — branch + message + vi.stubEnv assertions (100% coverage)
src/scripts/validate-api.ts                           # EDIT — delegate to checkProviderEndpoint(); exit(1) preserved
tests/validation/zai-api-test.ts                      # EDIT — delegate to checkProviderEndpoint(); exit(1) preserved
tests/setup.ts                                        # EDIT — validateApiEndpoint() delegates to validateProviderEndpoint()
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — COVERAGE SCOPE. vitest.config.ts coverage include = src/**/*.ts, thresholds 100%.
// v8 coverage only measures files LOADED during the run. src/scripts/validate-api.ts is currently
// loaded by NOTHING (no test imports it) → it is UNMEASURED. DO NOT add a test that imports it:
// that would drag 16KB of fetch()/process.exit/top-level-await into coverage and BREAK 100%.
// Test the guard via the NEW src/config/endpoint-guard.ts module (imported by the new test only).
// See research/guard-extraction-and-coverage.md §2.

// CRITICAL — GLOBAL SETUP ORDERING. tests/setup.ts registers a global beforeEach that runs the
// guard. Vitest runs setup-hooks BEFORE local-file hooks, and global afterEach calls
// vi.unstubAllEnvs(). So vi.stubEnv('ANTHROPIC_BASE_URL','https://api.anthropic.com') applied in
// a LOCAL beforeEach or test body is active ONLY during the test body — the global beforeEach
// already ran with a clean env. DO NOT move the Anthropic stub into a place the global hook would
// see (e.g. a setup-level hook). See research §4.

// CRITICAL — DO NOT WEAKEN enforcement. Unify on the 3-pattern BLOCKED set
// ['https://api.anthropic.com','http://api.anthropic.com','api.anthropic.com'] (from setup.ts).
// validate-api.ts currently blocks only the https variant — switching to the shared module
// STRENGTHENS it (also blocks http/ + bare domain). This is required, not a regression.

// CRITICAL — MESSAGE WORDING (the clarification). The blocked + warning messages MUST contain
// "provider" and state orthogonality to the "harness" (PRD §9.2.4 h4.3 + h3.18 harness note).
// They MUST NOT read or mention PRP_AGENT_HARNESS. Example message:
//   "LLM provider endpoint safeguard (PRD §9.2.4): ANTHROPIC_BASE_URL points at Anthropic's
//    official API, which is blocked. This constrains the LLM PROVIDER (z.ai), not the agent
//    harness; the pi harness is provider-neutral and the pipeline defaults to pi + zai."

// GOTCHA — zai-api-test.ts is NOT executed by vitest (filename -test.ts ≠ *.test.ts). Its guard
// refactor cannot affect npm run test:run. Leave its Test 2 model checks alone (stale vs T2.S1).

// GOTCHA — tests/setup.ts has the guard in TWO call sites: top-level validateApiEndpoint() and
// inside beforeEach. Keep the FUNCTION NAME validateApiEndpoint (both sites call it) and only
// replace its BODY to delegate to validateProviderEndpoint(). Deleting the function or renaming
// it would require editing both call sites — prefer the body-swap to minimize blast radius.

// GOTCHA — console.warn spying. The 'warning' branch calls console.warn. Assert it with
// vi.spyOn(console, 'warn') and restore in afterEach (mockRestore / vi.restoreAllMocks). Without
// restoration, the spy leaks into subsequent tests.

// GOTCHA — prettier is an ERROR (eslint prettier/prettier). Run `npm run fix` before `npm run validate`.
// Match existing JSDoc + trailing-comma style of src/config/environment.ts / harness.ts.

// CRITICAL — DO NOT touch configureHarness()/harness.ts (T1.S2), getModel()/qualifyModel() (T2.S1),
// the agent-factory harness field (T2.S2), constants/types shapes (T1.S1), docs/ (M2.T3), or add
// harness/provider compatibility tests (M2.T1.S2 — that is HarnessProviderMismatchError, NOT this).
```

---

## Implementation Blueprint

### Data models and structure

```ts
// src/config/endpoint-guard.ts
export const ZAI_ENDPOINT = 'https://api.z.ai/api/anthropic' as const;
export const BLOCKED_ENDPOINT_PATTERNS = [
  'https://api.anthropic.com',
  'http://api.anthropic.com',
  'api.anthropic.com',
] as const;

export type EndpointCheckStatus = 'allowed' | 'blocked' | 'warning';

export interface EndpointCheckResult {
  readonly status: EndpointCheckStatus;
  readonly message: string;
}
```

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)

```yaml
Task 1: CREATE tests/unit/config/endpoint-guard.test.ts   (RED — failing imports/assertions)
  - IMPORT: { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
             { checkProviderEndpoint, validateProviderEndpoint, ZAI_ENDPOINT,
               BLOCKED_ENDPOINT_PATTERNS } from '../../../src/config/endpoint-guard.js';
             { DEFAULT_HARNESS } from '../../../src/config/constants.js';
  - afterEach: vi.unstubAllEnvs(); vi.restoreAllMocks();   (restore env + console.warn spy)
  - describe('checkProviderEndpoint') — it() per decision-table row:
      * zai endpoint            → status 'allowed'
      * empty string ''         → status 'allowed'
      * localhost / 127.0.0.1   → status 'allowed'
      * 'mock'/'test' substring → status 'allowed'
      * 'https://api.anthropic.com' (and http://, bare, :443, /v1 variants) → 'blocked'
      * other endpoint ('https://example.com/api') → 'warning'
  - describe('checkProviderEndpoint message clarification') — it():
      * blocked message contains 'provider', '§9.2.4', and an orthogonality-to-harness phrase;
        does NOT contain 'PRP_AGENT_HARNESS'.
      * DEFAULT_HARNESS === 'pi'  (documents default pi harness + z.ai provider is the allowed config)
  - describe('validateProviderEndpoint') — vi.stubEnv('ANTHROPIC_BASE_URL', X) then:
      * z.ai          → expect(() => validateProviderEndpoint()).not.toThrow()
      * Anthropic     → expect(() => validateProviderEndpoint()).toThrow(/provider/i)
      * localhost/mock→ expect(() => validateProviderEndpoint()).not.toThrow()
      * other         → const warnSpy = vi.spyOn(console,'warn').mockImplementation(()=>{});
                        validateProviderEndpoint(); expect(warnSpy).toHaveBeenCalled();
                        expect(warnSpy.mock.calls[0][0]).toContain('provider');
  - EXPECTED NOW: imports FAIL (module does not exist yet) → RED.

Task 2: CREATE src/config/endpoint-guard.ts   (GREEN — the guard module)
  - EXPORT ZAI_ENDPOINT, BLOCKED_ENDPOINT_PATTERNS (3 entries), EndpointCheckStatus,
    EndpointCheckResult, checkProviderEndpoint(baseUrl), validateProviderEndpoint(baseUrl?).
  - checkProviderEndpoint: realize the decision table EXACTLY (blocked patterns first, then
    empty/zai/mock→allowed, else warning). Build a SINGLE message helper for blocked + warning
    that names "provider", cites §9.2.4, states orthogonality to the harness, and interpolates
    the offending/expected URL.
  - validateProviderEndpoint(baseUrl = process.env.ANTHROPIC_BASE_URL ?? ''): const r =
    checkProviderEndpoint(baseUrl); if (r.status === 'blocked') throw new Error(r.message);
    if (r.status === 'warning') console.warn(r.message);
  - DO NOT read PRP_AGENT_HARNESS anywhere in this module.
  - EXPECTED: endpoint-guard.test.ts turns GREEN (all branches + messages).

Task 3: EDIT src/scripts/validate-api.ts   (delegate; preserve exit code)
  - ADD import { checkProviderEndpoint } from '../config/endpoint-guard.js';
  - REPLACE the two inlined blocks (the includes(ANTHROPIC_ENDPOINT) hard-exit AND the non-z.ai
    log.warn block) with: const result = checkProviderEndpoint(process.env.ANTHROPIC_BASE_URL ?? '');
    if (result.status === 'blocked') { log.error(result.message); process.exit(1); }
    if (result.status === 'warning') { log.warn(result.message); }
  - REMOVE the now-unused local ZAI_ENDPOINT/ANTHROPIC_ENDPOINT consts + their message arrays
    IF they are no longer referenced (grep first — ZAI_ENDPOINT may be used elsewhere in the file).
  - PRESERVE: configureEnvironment() call ordering, colors, log helpers, main(), all 4 tests,
    fetch logic, process handlers, exit codes. Keep `process.exit(1)` on block.
  - EXPECTED: npm run validate green; `npx tsx src/scripts/validate-api.ts` still exit(1) on
    Anthropic URL (manual reasoning). NOT imported by any test.

Task 4: EDIT tests/validation/zai-api-test.ts   (delegate; preserve exit code; not run by vitest)
  - ADD import { checkProviderEndpoint } from '../../src/config/endpoint-guard.js';
  - REPLACE its inlined includes(ANTHROPIC_ENDPOINT) block with checkProviderEndpoint(...) +
    process.exit(1) on 'blocked' + log('…','yellow') on 'warning' (use its existing log() helper).
  - PRESERVE: exit code 1, the ZAiValidator class, all tests, fetch logic.
  - EXPECTED: file typechecks; behavior on Anthropic URL unchanged (exit 1).

Task 5: EDIT tests/setup.ts   (delegate the global guard; preserve throw semantics)
  - ADD import { validateProviderEndpoint } from '../src/config/endpoint-guard.js';
  - REPLACE the BODY of validateApiEndpoint() with: validateProviderEndpoint();
    (keep the function name + both call sites unchanged).
  - REMOVE the now-duplicated ZAI_ENDPOINT / BLOCKED_PATTERNS consts + errorMessage/warning
    arrays from setup.ts (they live in the module now). Keep the dotenv load + promise-rejection
    tracking + beforeEach/afterEach scaffolding byte-for-byte.
  - PRESERVE: "throw on Anthropic" behavior (validateProviderEndpoint throws on blocked →
    setup.ts still throws). The global beforeEach ordering invariant is unchanged.
  - EXPECTED: full `npm run test:run` green — proves no regression to the global guard AND
    that setup-verification.test.ts still passes (its assertions are pure-data, independent).

Task 6: FORMAT + VERIFY
  - RUN: npm run fix; then npm run validate; then
    npx vitest run tests/unit/config/endpoint-guard.test.ts --coverage;
    then npm run test:run (full regression, 100% coverage).
  - EXPECTED: all green. If endpoint-guard.ts coverage < 100%, a decision-table branch is
    unexercised — add the missing input class to the test (see decision table).
```

### Implementation Patterns & Key Details

```ts
// ---- src/config/endpoint-guard.ts (CREATE — full reference impl) ----
export const ZAI_ENDPOINT = 'https://api.z.ai/api/anthropic' as const;
export const BLOCKED_ENDPOINT_PATTERNS = [
  'https://api.anthropic.com',
  'http://api.anthropic.com',
  'api.anthropic.com',
] as const;

export type EndpointCheckStatus = 'allowed' | 'blocked' | 'warning';
export interface EndpointCheckResult {
  readonly status: EndpointCheckStatus;
  readonly message: string;
}

function isMockEndpoint(url: string): boolean {
  return (
    url.includes('localhost') ||
    url.includes('127.0.0.1') ||
    url.includes('mock') ||
    url.includes('test')
  );
}

/**
 * PURE predicate over the LLM PROVIDER endpoint (PRD §9.2.4).
 * Orthogonal to the agent harness — does NOT read PRP_AGENT_HARNESS.
 */
export function checkProviderEndpoint(baseUrl: string): EndpointCheckResult {
  // 1) Blocked: Anthropic official API (any protocol variant)
  if (BLOCKED_ENDPOINT_PATTERNS.some(p => baseUrl.includes(p))) {
    return {
      status: 'blocked',
      message:
        `LLM provider endpoint safeguard (PRD §9.2.4): ANTHROPIC_BASE_URL ` +
        `"${baseUrl}" points at Anthropic's official API, which is blocked. ` +
        `This constrains the LLM PROVIDER (z.ai), not the agent harness — ` +
        `the pi harness is provider-neutral and the pipeline defaults to pi + zai. ` +
        `Expected provider endpoint: ${ZAI_ENDPOINT}.`,
    };
  }
  // 2) Allowed: unset, z.ai, or localhost/mock/test
  if (baseUrl === '' || baseUrl === ZAI_ENDPOINT || isMockEndpoint(baseUrl)) {
    return { status: 'allowed', message: '' };
  }
  // 3) Warning: any other non-z.ai endpoint
  return {
    status: 'warning',
    message:
      `LLM provider endpoint safeguard (PRD §9.2.4): non-z.ai PROVIDER endpoint ` +
      `"${baseUrl}" detected. This constrains the LLM provider, not the agent ` +
      `harness. Recommended provider endpoint: ${ZAI_ENDPOINT}.`,
  };
}

/** Reads env by default; throws on 'blocked', warns on 'warning'. */
export function validateProviderEndpoint(
  baseUrl: string = process.env.ANTHROPIC_BASE_URL ?? ''
): void {
  const result = checkProviderEndpoint(baseUrl);
  if (result.status === 'blocked') {
    throw new Error(result.message);
  }
  if (result.status === 'warning') {
    console.warn(result.message);
  }
}

// ---- src/scripts/validate-api.ts (EDIT — the swapped block) ----
import { checkProviderEndpoint } from '../config/endpoint-guard.js';
// …after configureEnvironment():
const endpointResult = checkProviderEndpoint(
  process.env.ANTHROPIC_BASE_URL ?? ''
);
if (endpointResult.status === 'blocked') {
  log.error(endpointResult.message);
  process.exit(1);
}
if (endpointResult.status === 'warning') {
  log.warn(endpointResult.message);
}

// ---- tests/setup.ts (EDIT — body swap only) ----
import { validateProviderEndpoint } from '../src/config/endpoint-guard.js';
function validateApiEndpoint(): void {
  validateProviderEndpoint(); // throws on Anthropic (same as before); warns on other
}
// (remove local ZAI_ENDPOINT / BLOCKED_PATTERNS / message arrays)

// ---- tests/unit/config/endpoint-guard.test.ts (CREATE — key slices) ----
import {
  checkProviderEndpoint,
  validateProviderEndpoint,
} from '../../../src/config/endpoint-guard.js';
import { DEFAULT_HARNESS } from '../../../src/config/constants.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('blocks Anthropic official API (provider endpoint)', () => {
  const r = checkProviderEndpoint('https://api.anthropic.com');
  expect(r.status).toBe('blocked');
  expect(r.message).toMatch(/provider/i);
  expect(r.message).toContain('§9.2.4');
  expect(r.message).not.toContain('PRP_AGENT_HARNESS');
});

it('allows z.ai provider endpoint under the default pi harness', () => {
  expect(checkProviderEndpoint('https://api.z.ai/api/anthropic').status).toBe(
    'allowed'
  );
  expect(DEFAULT_HARNESS).toBe('pi'); // documents provider/harness orthogonality
});

it('validateProviderEndpoint throws when env points at Anthropic (vi.stubEnv)', () => {
  vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com');
  expect(() => validateProviderEndpoint()).toThrow(/provider/i);
});

it('validateProviderEndpoint warns (not throws) for other non-z.ai endpoint', () => {
  vi.stubEnv('ANTHROPIC_BASE_URL', 'https://example.com/api');
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(() => validateProviderEndpoint()).not.toThrow();
  expect(warnSpy).toHaveBeenCalled();
  expect(warnSpy.mock.calls[0][0]).toMatch(/provider/i);
});
```

### Integration Points

```yaml
NEW MODULE (src/config/endpoint-guard.ts):
  - exports: ZAI_ENDPOINT, BLOCKED_ENDPOINT_PATTERNS, EndpointCheckStatus,
    EndpointCheckResult, checkProviderEndpoint, validateProviderEndpoint
  - NO env read inside checkProviderEndpoint (pure); env read ONLY in validateProviderEndpoint default param
  - NO reference to PRP_AGENT_HARNESS / harness.ts / AgentHarness

VALIDATE-API.TS (src/scripts/validate-api.ts):
  - add import: checkProviderEndpoint from '../config/endpoint-guard.js'
  - replace 2 inlined blocks → checkProviderEndpoint + exit(1)/warn
  - preserve: configureEnvironment() first, colors/log, main(), exit codes; NOT imported by tests

ZAI-API-TEST.TS (tests/validation/zai-api-test.ts):
  - add import: checkProviderEndpoint from '../../src/config/endpoint-guard.js'
  - replace inlined block → checkProviderEndpoint + exit(1)/warn; not run by vitest

SETUP.TS (tests/setup.ts):
  - add import: validateProviderEndpoint from '../src/config/endpoint-guard.js'
  - validateApiEndpoint() body → validateProviderEndpoint(); keep name + both call sites
  - remove duplicated ZAI_ENDPOINT/BLOCKED_PATTERNS/message arrays
  - preserve: throw-on-Anthropic semantics, dotenv load, rejection tracking, hooks

GROUNDWELL / HARNESS (read-only — verified non-overlapping):
  - harness.ts throws HarnessProviderMismatchError for claude-code+zai — that is M2.T1.S2, NOT this.
  - endpoint-guard is orthogonal: it never inspects the harness.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing each file — auto-fix first, then verify.
npm run fix
npm run validate          # = lint && format:check && typecheck   (MUST be green)

# Targeted checks (optional, faster feedback):
npx eslint src/config/endpoint-guard.ts src/scripts/validate-api.ts tests/setup.ts tests/unit/config/endpoint-guard.test.ts
npx tsc --noEmit -p tsconfig.build.json
npx prettier --check src/config/endpoint-guard.ts tests/unit/config/endpoint-guard.test.ts

# Expected: Zero errors. Most likely failure: a prettier nit (re-run `npm run fix`) or the
# new module leaving an unused local const after the setup.ts refactor (delete it).
```

### Level 2: Unit Tests (Component Validation)

```bash
# The directly-affected suite (must pass + 100% coverage of endpoint-guard.ts):
npx vitest run tests/unit/config/endpoint-guard.test.ts --coverage

# Config suite (proves the new module sits cleanly alongside harness/environment tests):
npm run test:run -- config

# Expected: all pass. If endpoint-guard.ts coverage < 100%, a decision-table branch is
# unexercised — add the missing input class (empty string, mock substring, http:// anthropic,
# or the 'other endpoint' warning case). Each branch is small and deterministic.
```

### Level 3: Integration / Regression (System Validation)

```bash
# Full suite — MUST stay green. This is the proof that:
#  (1) the new module + its test are clean,
#  (2) tests/setup.ts delegation did NOT regress the global guard (every test still runs under it),
#  (3) setup-verification.test.ts still passes (its assertions are pure-data, independent),
#  (4) 100% global coverage is retained (no new uncovered src file).
npm run test:run

# Targeted regression on the files whose behavior the refactor touches:
npx vitest run tests/unit/setup-verification.test.ts
npx vitest run tests/unit/config/

# Build emits dist/ cleanly (proves the new module + edits compile):
npx tsc -p tsconfig.build.json

# Expected: full suite green; setup-verification green; build succeeds.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# NO network/LLM in this subtask — the guard is pure logic; tests stub env and assert branches.
# Domain-specific reasoning (record in commit message):
#   1. Provider/harness orthogonality (PRD §9.4 h3.18): the guard checks the PROVIDER endpoint
#      only; it never reads PRP_AGENT_HARNESS. Test (a) pairs the allowed z.ai endpoint with
#      DEFAULT_HARNESS === 'pi' to document the default config is pi + zai.
#   2. No weakening: the unified BLOCKED_ENDPOINT_PATTERNS (3 entries) is a SUPERSET of what
#      validate-api.ts blocked before (1 entry) — the script guard is strengthened, not weakened.
#   3. Coverage hygiene: validate-api.ts was NOT imported by any test before and must remain so
#      (importing it would break the 100% threshold). The guard logic is tested via endpoint-guard.ts.
#   4. Exit-code integrity: both scripts still process.exit(1) on an Anthropic URL; setup.ts still
#      throws on an Anthropic URL (full npm run test:run green is the proof).

# Optional manual script sanity (does NOT run during npm run test:run — manual only):
#   ANTHROPIC_BASE_URL='https://api.anthropic.com' npx tsx src/scripts/validate-api.ts; echo "exit=$?"
#   # Expected: prints the clarified provider message and exit=1.
#   ANTHROPIC_BASE_URL='https://api.z.ai/api/anthropic' npx tsx src/scripts/validate-api.ts; echo "exit=$?"
#   # Expected: proceeds to endpoint tests (network) — run only if a live z.ai token is set.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` exits 0 (lint + format:check + typecheck).
- [ ] `npx vitest run tests/unit/config/endpoint-guard.test.ts --coverage` exits 0 with 100%
      coverage of `src/config/endpoint-guard.ts`.
- [ ] `npm run test:run` (full suite) exits 0 — no regression (incl. `setup-verification.test.ts`).
- [ ] Global coverage remains 100% (no new uncovered `src/**/*.ts` file).
- [ ] `npx tsc -p tsconfig.build.json` compiles with no errors.

### Feature Validation

- [ ] `checkProviderEndpoint('https://api.z.ai/api/anthropic').status === 'allowed'`.
- [ ] `checkProviderEndpoint('https://api.anthropic.com').status === 'blocked'` and its
      `message` contains "provider" + "§9.2.4" + a harness-orthogonality phrase, and does
      NOT contain "PRP_AGENT_HARNESS".
- [ ] `checkProviderEndpoint('http://localhost:3000').status === 'allowed'`.
- [ ] `validateProviderEndpoint()` throws when env is stubbed to Anthropic; does not throw
      when stubbed to z.ai or localhost; warns (spy) when stubbed to another endpoint.
- [ ] `DEFAULT_HARNESS === 'pi'` asserted in the suite (documents provider/harness orthogonality).
- [ ] `validate-api.ts` and `zai-api-test.ts` still `process.exit(1)` on an Anthropic endpoint.
- [ ] `tests/setup.ts` still throws on an Anthropic endpoint (full suite green proves it).

### Code Quality Validation

- [ ] `endpoint-guard.ts` follows existing `src/config/*.ts` conventions (JSDoc, `as const`,
      readonly fields, trailing commas).
- [ ] `checkProviderEndpoint` is PURE (no `process.env`, no side effects); env access lives
      only in `validateProviderEndpoint`'s default parameter.
- [ ] Message text is centralized in `checkProviderEndpoint` (single source); scripts/setup
      print/throw `result.message`.
- [ ] `tests/setup.ts` edit is a body-swap only (function name + call sites preserved).
- [ ] No test imports `src/scripts/validate-api.ts` or `tests/validation/zai-api-test.ts`.
- [ ] `console.warn` spy restored in `afterEach`; env restored via `vi.unstubAllEnvs()`.

### Documentation & Deployment

- [ ] JSDoc on `checkProviderEndpoint`/`validateProviderEndpoint` cites PRD §9.2.4 and states
      provider/harness orthogonality.
- [ ] No new env vars introduced (consumes existing `ANTHROPIC_BASE_URL`).
- [ ] Commit message documents: provider-vs-harness clarification, coverage-scope decision,
      strengthened 3-pattern block list, exit-code preservation.

---

## Anti-Patterns to Avoid

- ❌ Don't import `src/scripts/validate-api.ts` (or `tests/validation/zai-api-test.ts`) from any
  test — it would enter coverage scope and its `fetch()`/`process.exit`/top-level-`await` code
  breaks the 100% threshold. Test the guard via the new `endpoint-guard.ts` module.
- ❌ Don't weaken the block list. Unify on the 3-pattern `BLOCKED_ENDPOINT_PATTERNS`
  (`https://`, `http://`, bare `api.anthropic.com`). The script currently blocks only the
  `https://` variant — the shared module must block all three.
- ❌ Don't make `checkProviderEndpoint` read `process.env` — keep it PURE (URL param only).
  Env access belongs solely in `validateProviderEndpoint`'s default parameter, so message/branch
  assertions are deterministic and the work-item `vi.stubEnv` path is exercised by the wrapper.
- ❌ Don't reference `PRP_AGENT_HARNESS` / `AgentHarness` / `harness.ts` inside `endpoint-guard.ts`
  — the whole point of the clarification is that the guard is harness-orthogonal. The harness/
  provider COMPATIBILITY rejection (`HarnessProviderMismatchError`) is P1.M2.T1.S2, not this.
- ❌ Don't rename or delete `validateApiEndpoint()` in `tests/setup.ts` — it is called at two
  sites (module load + `beforeEach`). Swap its BODY to delegate; keep the name.
- ❌ Don't move the Anthropic `vi.stubEnv` into a setup-level hook — it must be applied in a LOCAL
  `beforeEach` or the test body (after the global `beforeEach` runs with a clean env). See Gotchas.
- ❌ Don't forget to restore the `console.warn` spy + env in `afterEach` (`vi.restoreAllMocks()` /
  `vi.unstubAllEnvs()`), or the warning-branch test leaks into siblings.
- ❌ Don't touch `configureHarness()`/`harness.ts` (T1.S2), `getModel()`/`qualifyModel()` (T2.S1),
  the agent-factory `harness` field (T2.S2), constants/types shapes (T1.S1), the stale
  model-selection checks in `zai-api-test.ts` Test 2, `docs/` (M2.T3), or add harness/provider
  compatibility tests (M2.T1.S2).
- ❌ Don't skip the failing-test-first (RED) step — create `endpoint-guard.test.ts` (Task 1)
  BEFORE the module (Task 2), so RED → GREEN is observable.
- ❌ Don't change the exit code of the scripts or the throw-vs-exit semantics: scripts stay
  `process.exit(1)` on block; `tests/setup.ts` stays throw-on-block.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: The change is small, self-contained, and purely logic+test (no runtime/network/LLM).
The decision table is exhaustive and the reference implementation is spelled out verbatim. All
four non-obvious traps are documented with grep evidence in
`research/guard-extraction-and-coverage.md`: (1) the coverage-scope rule that forbids importing
the script from tests, (2) the global-setup `beforeEach` ordering that makes `vi.stubEnv` safe,
(3) vitest ignoring `-test.ts` filenames, and (4) `setup-verification.test.ts` being pure-data
and therefore immune to the `setup.ts` refactor. The existing pattern files
(`harness-config.test.ts`, `environment.test.ts`) give exact conventions to copy. Upstream
symbols (`DEFAULT_HARNESS='pi'`, `DEFAULT_BASE_URL`) are already merged (T1.S1). The item is
cleanly disjoint from the parallel P1.M1.T2.S2 (harness field) and from P1.M2.T1.S2
(harness/provider compatibility test — `HarnessProviderMismatchError`). Validation commands
(`npm run validate`, `npm run test:run`, targeted `vitest run … --coverage`) are verified
executable. Residual risks: (a) a prettier nit (auto-fixed via `npm run fix`); (b) leaving an
unused local const in `setup.ts`/`validate-api.ts` after removing the duplicated message arrays
(grep before deleting); (c) under-covering one decision-table branch (each is a one-line test
add). None are structural.
