# Research Summary — P4.M2.T1.S1: VALIDATION_AGENT and VALIDATION_TIMEOUT config

## Item contract (verbatim)

> CONTRACT DEFINITION:
> 1. RESEARCH NOTE: architecture/phase_findings.md §PHASE 4 documents: no VALIDATION_AGENT or
>    VALIDATION_TIMEOUT exist in code. PRD §4.4/§9.2.2 specifies VALIDATION_AGENT (reasoning-tier,
>    default pizr) and VALIDATION_TIMEOUT (default 7200s / 2h — validation legitimately runs full
>    suites), overriding the generic agent timeout for this call only.
> 2. INPUT: Three-role model from P2.M2.T1.S2.
> 3. LOGIC: (a) Add VALIDATION_AGENT env var name to constants.ts (default 'pizr'). (b) Add
>    VALIDATION_TIMEOUT env var name and DEFAULT_VALIDATION_TIMEOUT_SECONDS = 7200 to constants.ts.
>    (c) Add getValidationAgent() and getValidationTimeoutSeconds() helpers (mirror
>    getResearchTimeoutSeconds). (d) The validation agent is the reasoning persona (balanced @ xhigh).
> 4. OUTPUT: Config constants and helpers for validation. Consumed by P4.M2.T1.S2.
> 5. DOCS: [Mode A] Add VALIDATION_AGENT, VALIDATION_TIMEOUT to .env.example and docs/CONFIGURATION.md.
>    This rides WITH the work.

## Defect confirmation (clean slate)

- `grep -rn "VALIDATION_AGENT|VALIDATION_TIMEOUT|getValidationAgent|getValidationTimeoutSeconds" src/ tests/`
  → **NONE.** No constants, no getters, no consumers, no tests. This item creates the config
  surface from scratch.
- `phase_findings.md §PHASE 4` lists under remaining P4 work:
  *"`VALIDATION_AGENT` (default `pizr`) + `VALIDATION_TIMEOUT` (default 7200s) + abort-on-failure."*
  → confirms scope: S1 = config/constants + helpers + docs; S2 = the validate.sh + abort-on-failure
  consumer. S1 is upstream of S2 and must not implement the consumer.
- `BUG_FINDER_AGENT` also does NOT exist in code (it is P4.M2.T2.S1). So there is NO sibling
  agent-name constant/getter to copy; the VALIDATION pair is the FIRST string+number config pair
  of this shape. The template to mirror is the **RESEARCH_TIMEOUT** triplet.

## Primary file to MODIFY: `src/config/constants.ts`

The established triplet pattern (the EXACT mirror for VALIDATION_TIMEOUT):

```typescript
// 1. env-var NAME (string literal)
export const RESEARCH_TIMEOUT = 'RESEARCH_TIMEOUT';

// 2. numeric default
export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 1800;

// 3. reader that guards invalid (NaN / <= 0) → default
export function getResearchTimeoutSeconds(): number {
  const raw = Number(process.env[RESEARCH_TIMEOUT] ?? DEFAULT_RESEARCH_TIMEOUT_SECONDS);
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_RESEARCH_TIMEOUT_SECONDS;
  }
  return raw;
}
```

So VALIDATION_TIMEOUT mirrors it 1:1 with default 7200. VALIDATION_AGENT is a STRING env var
(the agent identifier, not a number) → default `DEFAULT_VALIDATION_AGENT = 'pizr' as const`
(mirrors `DEFAULT_HARNESS = 'pi' as const`), and `getValidationAgent(): string` reads
`process.env[VALIDATION_AGENT]` and falls back to the default when unset/empty-after-trim (the
string analog of guarding "invalid" numerics — prevents an empty agent name silently breaking S2).

### Exact insertion point

constants.ts groups constants under comment-banner sections:
- `// Resilience Tuning (PRD §4.2, §4.5, §9.2.2)` (RESEARCH_*, ISSUE_RETRY_MAX, COMMIT_RETRY_*, CLASSIFIER_RETRY_*)
- `// tasks.json lockfile tunables (PRD §5.1 …)` (TASKS_LOCK_*)
- `// (PRD §2.3)` PRD_INCLUDE_*

VALIDATION is pipeline-control (PRD §4.4 / §9.2.2 "Validation Control"). Natural placement = a
NEW banner section `// Validation Control (PRD §4.4, §9.2.2)` inserted AFTER the COMMIT_RETRY_*
group (i.e. after `getCommitRetryDelayCapMs`, the last resilience-tuning getter) and BEFORE the
`PRD_INCLUDE_MAX_DEPTH` block. Unique, non-overlapping insertion seam.

## Agent/role model (P2.M2.T1.S2 — the INPUT)

`src/agents/agent-factory.ts`:
- `ModelRole = 'research' | 'reasoning' | 'implementation'`
- `ROLE_CONFIG` (single source of truth):
  - `research: { tier: 'balanced' }` (thinking omitted → undefined)
  - `reasoning: { tier: 'balanced', thinking: 'xhigh' }` ← **VALIDATION lives here**
  - `implementation: { tier: 'fast' }`
- `createQAAgent()` uses `createBaseConfig('qa', 'reasoning')` → balanced tier + `xhigh` budget.
  So the validation agent IS the reasoning persona (balanced @ xhigh), realized by the `qa`
  persona. CONTRACT (3)(d) is satisfied semantically by the EXISTING QA agent wiring — S1's job
  is only to declare the config surface (`getValidationAgent()` default `'pizr'`); S2 will wire
  the actual validation call. PRD §9.2.3: "In the bash pipeline these are the `pizr` agent — `pi`
  with `--thinking xhigh`." → `'pizr'` is the bash-pipeline identifier; in the TS rewrite the
  reasoning persona (`qa` + `reasoning` role) is its realization.

**Conclusion:** S1 adds config constants + getters + docs ONLY. It does NOT touch agent-factory.ts
(the reasoning persona already exists), does NOT implement the validation call (S2), does NOT add
a new persona.

## Test strategy

Two-tier (matches existing precedent exactly):

1. **`tests/unit/config/constants.test.ts`** (MODIFY) — value-lock tests for the two new defaults,
   mirroring the existing `describe('config/constants: DEFAULT_RESEARCH_TIMEOUT_SECONDS (1800)')`
   block (constants.test.ts:243). Add imports `DEFAULT_VALIDATION_AGENT`,
   `DEFAULT_VALIDATION_TIMEOUT_SECONDS` and two new describe blocks asserting `=== 'pizr'` and
   `=== 7200`. (constants.test.ts deliberately has NO env mutation — pure value locks — so it stays
   stable under the 100% coverage gate; getters that read `process.env` live in dedicated files.)

2. **`tests/unit/config/validation-config.test.ts`** (NEW) — full getter coverage, mirroring
   `tests/unit/config/research-timeout.test.ts` exactly (same `beforeEach`/`afterEach` env stub
   pattern, same `(a)..(g)` case structure):
   - `getValidationTimeoutSeconds()`: unset→7200, valid '3600', NaN 'abc'→7200, '0'→7200, '-5'→7200,
     integer value, positive-deadline property.
   - `getValidationAgent()`: unset→'pizr', stubbed 'custom-agent'→honored, empty `''`→'pizr' (trim
     guard), whitespace `'  '`→'pizr', set to 'pizr'→'pizr'.
   This single new file must hit 100% of every branch in both getters (the 100% thresholds in
   vitest.config.ts:43-46 gate statements/branches/functions/lines).

## Documentation (Mode A — rides WITH the work)

### `.env.example` (MODIFY)
Current structure (grep-confirmed): `RESEARCH CONFIGURATION (PARALLEL PRP RESEARCH)` block →
`--- Smart Commit Resilience (PRD §5.1) ---` sub-block (COMMIT_RETRY_*) → `SECURITY NOTES`.
There is **NO** bug-hunt section in .env.example today (BUG_FINDER_AGENT etc. are only in
CONFIGURATION.md). Insert a NEW `# VALIDATION CONFIGURATION (OPTIONAL)` section AFTER the
COMMIT_RETRY sub-block (~line 126) and BEFORE `# SECURITY NOTES` (~line 128), documenting
`VALIDATION_AGENT` (default pizr) and `VALIDATION_TIMEOUT` (default 7200). Do NOT add bug-hunt
vars (out of scope — P4.M2.T2).

### `docs/CONFIGURATION.md` (MODIFY)
- Current sections: `### Bug Hunt Configuration` (:171, with a STALE `BUG_FINDER_AGENT` default
  `glp` that P4.M2.T2.S1 will fix → leave it alone). Add a NEW `### Validation Control` section
  immediately AFTER `### Bug Hunt Configuration` (after :178, before `### Advanced Configuration`
  :181), with a table row for `VALIDATION_AGENT` (default `pizr`) and `VALIDATION_TIMEOUT`
  (default `7200`). Cite PRD §4.4 + §9.2.2.
- The `### Model Roles` table (:297) ALREADY lists "Validation" under the Reasoning role
  (balanced / xhigh) → NO change needed there.
- Add the two vars to the Example Configuration env-block near the BUG HUNT CONFIGURATION
  example (~:484) under a new `# VALIDATION CONFIGURATION (OPTIONAL)` comment banner.

## Validation commands (verified against package.json)

- `npm run validate` = `npm run lint && npm run format:check && npm run typecheck && npm run test:run`
- `npm run test:coverage` = `vitest run --coverage` (gated 100% — vitest.config.ts:41-46)
- `npm run lint` = `eslint . --ext .ts`; `npm run format:check` = `prettier --check`
- `npm run typecheck` = `tsc --noEmit -p tsconfig.build.json`

## Scope boundaries (non-overlap)

- This item touches: `src/config/constants.ts` (ADD 6 exports), `tests/unit/config/constants.test.ts`
  (MODIFY: 2 describe blocks + imports), `tests/unit/config/validation-config.test.ts` (NEW),
  `.env.example` (MODIFY: 1 section), `docs/CONFIGURATION.md` (MODIFY: 1 section + example block).
- It does NOT touch: `src/agents/agent-factory.ts` (reasoning persona already exists), any workflow
  file (validate.sh / abort-on-failure is S2), `BUG_FINDER_AGENT` (P4.M2.T2.S1).
- Consumer seam: P4.M2.T1.S2 will import `getValidationAgent()` + `getValidationTimeoutSeconds()`
  from `../config/constants.js` to run validation on the reasoning-tier QA persona under the
  VALIDATION_TIMEOUT watchdog, aborting on non-zero exit. S1 must export both getters so S2 can
  import them with no further constants work.