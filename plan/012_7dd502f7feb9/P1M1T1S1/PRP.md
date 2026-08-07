# PRP — P1.M1.T1.S1: `PRP_COMMIT_STYLE` + `PRP_COMMIT_STYLE_EXAMPLES` constants, types, getters & `.env.example`

> Foundation subtask for the PRD §5.1 commit-message **style layer** (orthogonal to the existing
> `PRP_COMMIT_FORMAT` position layer). S1 adds the config constants, the `PrpCommitStyle` type, two
> getters, and the `.env.example` documentation. Consumed by P1.M1.T1.S2 (.hack schema),
> P1.M1.T3.S1 (prompt builder), P1.M1.T4.S1 (generateCommitMessage wiring).

---

## Goal

**Feature Goal**: Add the commit-style configuration surface to `src/config/constants.ts` — the
env-var names, defaults, the `PrpCommitStyle` union, and two runtime getters (`getPrpCommitStyle`
case-insensitive over 4 modes; `getPrpCommitStyleExamples` accepting 0) — plus a `.env.example`
subsection and a dedicated unit test. This mirrors the existing `PRP_COMMIT_FORMAT` block exactly
in shape, with two deliberate, documented deviations (case-insensitive matching; 0 allowed).

**Deliverable**:
1. **`src/config/constants.ts`** — append (immediately after the `PRP_COMMIT_FORMAT` block): `PRP_COMMIT_STYLE`, `DEFAULT_PRP_COMMIT_STYLE`, `PrpCommitStyle`, `getPrpCommitStyle`, `PRP_COMMIT_STYLE_EXAMPLES`, `DEFAULT_PRP_COMMIT_STYLE_EXAMPLES`, `getPrpCommitStyleExamples`.
2. **`.env.example`** — append a `# --- Commit Message Style (PRD §5.1) ---` subsection after the Smart Commit Resilience block.
3. **`tests/unit/config/prp-commit-style.test.ts`** (NEW) — unit tests for both getters (mirrors `prp-commit-format.test.ts` / `issue-retry-max.test.ts`).

**Success Definition**:
- `getPrpCommitStyle()` returns one of `auto|plain|conventional|gitmoji`, matching case-insensitively, defaulting to `auto` for unset/empty/unrecognized.
- `getPrpCommitStyleExamples()` returns a number ≥ 0, defaulting to 5 for unset/NaN/negative, and **accepting 0** (disables learning).
- `.env.example` documents both vars (commented out), matching the surrounding commit-block style.
- `npm run typecheck && npm run lint && npm run format:check` clean; the new test passes; `constants.ts` stays at 100% coverage on the new lines.
- The existing `PRP_COMMIT_FORMAT` block + `prp-commit-format.test.ts` are UNCHANGED.

---

## Why

- **Unblocks the §5.1 style layer.** `PRP_COMMIT_FORMAT` governs only the *position prefix*
  (`1.2.1.1:`); the *style* of the descriptive message (plain / conventional / gitmoji / learned)
  is a separate, orthogonal axis that S2/T3/T4 build on top of. S1 provides the config primitives.
- **Mirrors a proven pattern.** The `PRP_COMMIT_FORMAT` block (const → default → type → getter, each
  with full JSDoc) is the exact template; copying it keeps the config module consistent.
- **Two deliberate, documented deviations.** (1) Case-insensitive matching (4 user-facing modes vs.
  format's single opt-out token); (2) examples getter allows 0 (meaningful = disable learning) whereas
  the existing numeric getters reject 0. Both are mandated by PRD §5.1/§9.2.2 and must NOT be
  "normalized" to match `getPrpCommitFormat`/`getIssueRetryMax`.
- **Scope discipline.** S1 = config + .env.example + tests ONLY. The .hack schema wiring (S2), the
  dynamic prompt builder (T3), and the generateCommitMessage wiring (T4) are separate subtasks.

---

## What

### User-visible behavior
None directly (config primitives). Indirectly, once T3/T4 land: `PRP_COMMIT_STYLE`/`PRP_COMMIT_STYLE_EXAMPLES`
control how the `stagecoach` agent styles its generated descriptive commit messages.

### Technical requirements (exact contract)

**File 1 — `src/config/constants.ts`** (append immediately AFTER the `getPrpCommitFormat` block;
mirror its shape — section-header comment, then each symbol with full JSDoc):

```ts
// Commit Message Style (PRP_COMMIT_STYLE / PRP_COMMIT_STYLE_EXAMPLES) — PRD §5.1, §9.2.2

export const PRP_COMMIT_STYLE = 'PRP_COMMIT_STYLE';

export const DEFAULT_PRP_COMMIT_STYLE = 'auto' as const;

export type PrpCommitStyle = 'auto' | 'plain' | 'conventional' | 'gitmoji';

// CASE-INSENSITIVE over 4 values (deliberate deviation from getPrpCommitFormat's case-sensitive
// single opt-out). Unset/empty/unrecognized → 'auto'.
export function getPrpCommitStyle(): PrpCommitStyle {
  const raw = process.env[PRP_COMMIT_STYLE];
  if (raw === undefined) return DEFAULT_PRP_COMMIT_STYLE;
  const v = raw.trim().toLowerCase();
  if (v === 'auto' || v === 'plain' || v === 'conventional' || v === 'gitmoji') return v;
  return DEFAULT_PRP_COMMIT_STYLE;
}

export const PRP_COMMIT_STYLE_EXAMPLES = 'PRP_COMMIT_STYLE_EXAMPLES';

export const DEFAULT_PRP_COMMIT_STYLE_EXAMPLES = 5;

// ⚠️ Guard is `< 0`, NOT `<= 0` — 0 is VALID (disables style learning under auto, PRD §5.1/§9.2.2).
// This DEVIATES from getIssueRetryMax/getResearchTimeoutSeconds (which reject 0).
export function getPrpCommitStyleExamples(): number {
  const raw = Number(
    process.env[PRP_COMMIT_STYLE_EXAMPLES] ?? DEFAULT_PRP_COMMIT_STYLE_EXAMPLES
  );
  if (Number.isNaN(raw) || raw < 0) return DEFAULT_PRP_COMMIT_STYLE_EXAMPLES;
  return raw;
}
```

Each new symbol gets JSDoc following the `getPrpCommitFormat`/`DEFAULT_PRP_COMMIT_FORMAT` style
(`@remarks`, `@example`, the "SINGLE read site" convention note). The style getter's JSDoc MUST
describe each of the 4 modes (auto=learn-from-history; plain/conventional/gitmoji=explicit
contracts) and the case-insensitive matching; the examples getter's JSDoc MUST note "0 disables
learning" and the `< 0` (not `<= 0`) guard.

**File 2 — `.env.example`** — insert between the Smart Commit Resilience block (ends ~line 115,
`# COMMIT_RETRY_DELAY_CAP=120000`) and the `VALIDATION CONFIGURATION` header (~line 117):
```
# --- Commit Message Style (PRD §5.1) ---
# PRP_COMMIT_STYLE governs the descriptive-message STYLE, orthogonal to PRP_COMMIT_FORMAT's
# position prefix. auto (default) learns from the last N commits; plain/conventional/gitmoji
# are explicit contracts. See PRD §5.1, §9.2.2.
# PRP_COMMIT_STYLE=auto
# How many recent commits `auto` sends as style examples (default 5; 0 disables learning).
# PRP_COMMIT_STYLE_EXAMPLES=5
```

**File 3 — `tests/unit/config/prp-commit-style.test.ts`** (NEW) — mirror
`tests/unit/config/prp-commit-format.test.ts` and `issue-retry-max.test.ts` (`vi.stubEnv` per case,
`vi.unstubAllEnvs()` in afterEach). Coverage-required cases listed in the blueprint below.

### Success Criteria
- [ ] Seven new symbols exported from `constants.ts` (2 env-var names, 2 defaults, 1 type, 2 getters).
- [ ] `getPrpCommitStyle()` matches the 4 modes case-insensitively; defaults to `auto` for unset/empty/unrecognized.
- [ ] `getPrpCommitStyleExamples()` defaults to 5; returns the parsed int for ≥ 0; **accepts 0**; returns 5 for NaN/negative.
- [ ] `.env.example` has the new subsection (both vars commented out) after the Smart Commit Resilience block.
- [ ] New test file passes; `constants.ts` at 100% coverage on the new lines.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] Existing `PRP_COMMIT_FORMAT` block + `prp-commit-format.test.ts` UNCHANGED.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the exact pattern to mirror (with the verbatim existing block), the
verbatim new symbols, both documented deviations (case-insensitive; allow-0), the `.env.example`
insertion site + verbatim block, the test pattern to copy with the per-branch cases, and the
executable validation commands are all below.

### Documentation & References

```yaml
# MUST READ — the exact pattern to mirror (the PRP_COMMIT_FORMAT block + getter)
- file: src/config/constants.ts
  why: The PRP_COMMIT_FORMAT block (~L677+) is the shape template: section-header comment → env-var
        name const → default const (as const) → type union → getter, each with full JSDoc and the
        "SINGLE read site" convention note. Append the new block IMMEDIATELY AFTER getPrpCommitFormat.
        getIssueRetryMax/getResearchTimeoutSeconds show the numeric-getter guard (`<= 0 → default`)
        that getPrpCommitStyleExamples must DEVIATE from (`< 0`, allow 0).
  pattern: "export const X = 'X'; export const DEFAULT_X = '...' as const; export type X = '...' | '...'; export function getX(): X { const raw = process.env[X]; if (raw === undefined) return DEFAULT_X; ... }"
  gotcha: getPrpCommitFormat is CASE-SENSITIVE (only exact 'plain'); getPrpCommitStyle MUST be
        CASE-INSENSITIVE (toLowerCase + match 4 values). Do NOT copy the case-sensitive pattern.

# MUST READ — verbatim symbols + the allow-0 reconciliation (authored with this PRP)
- docfile: plan/012_7dd502f7feb9/P1M1T1S1/research/commit-style-config.md
  section: "2. The new block (verbatim shapes)" and "3. ⚠️ CRITICAL reconciliation"
  why: Ready-to-paste symbol bodies + the explicit reconciliation of the contract's contradictory
        "<=0 → 5 (ALLOW 0)" — PRD wins (guard is `< 0`, 0 is valid).

# PATTERN FILE — test style to mirror
- file: tests/unit/config/prp-commit-format.test.ts
  why: The closest existing test (string-getter + vi.stubEnv). Also reference issue-retry-max.test.ts
        for the numeric-getter test shape (unset/valid/NaN/0/negative cases). Create a NEW file
        prp-commit-style.test.ts mirroring these.
  pattern: "describe('config/constants: getPrpCommitStyle', () => { afterEach(() => vi.unstubAllEnvs()); it('returns auto when unset', () => { vi.stubEnv(PRP_COMMIT_STYLE, 'plain'); expect(getPrpCommitStyle()).toBe('plain'); }); ... })"
  gotcha: The numeric getter test MUST include an `it('accepts 0 (disables learning)')` case asserting
        getPrpCommitStyleExamples() === 0 when the env var is '0' — this is the case that proves the
        guard is `< 0` not `<= 0`. Without it the allow-0 requirement is unverified.

# DOC FILE — .env.example insertion
- file: .env.example
  why: Insert the new '# --- Commit Message Style (PRD §5.1) ---' subsection between the Smart Commit
        Resilience block (ends ~L115) and the VALIDATION CONFIGURATION header (~L117). Match the
        COMMIT_RETRY_* comment style (commented-out VAR=value lines + a one-line description).
  pattern: "# --- Smart Commit Resilience (PRD §5.1) ---\n# COMMIT_RETRY_MAX=5\n# COMMIT_RETRY_DELAY=10000"
  gotcha: Both new vars are COMMENTED OUT (they're optional with defaults). Keep the section between
        the two existing headers — don't append at file end (it belongs with the commit config).

# VERIFIED FACTS
- fact: "getPrpCommitFormat is CASE-SENSITIVE (only exact lowercase 'plain' opt out) — getPrpCommitStyle is CASE-INSENSITIVE (4 values). Both are intentional; do not normalize."
- fact: "getIssueRetryMax/getResearchTimeoutSeconds use `Number.isNaN(raw) || raw <= 0 → default`. getPrpCommitStyleExamples MUST use `< 0` (allow 0). PRD §9.2.2 'Integer ≥ 0' + §5.1 '0 disables learning' are authoritative over the contract's contradictory '<=0 → 5 (ALLOW 0)'."
- fact: "constants.ts is source (in tsconfig.build.json) → npm run typecheck covers it."
- fact: "vitest 100% coverage on src/**/*.ts → every getter branch (4 style values + default + case-fold; examples unset/valid/0/NaN/negative) must be hit by the new test."
```

### Current Codebase tree (relevant slice)

```bash
src/config/constants.ts                       # EDIT — append the PRP_COMMIT_STYLE block after getPrpCommitFormat
.env.example                                  # EDIT — insert the Commit Message Style subsection
tests/unit/config/prp-commit-style.test.ts    # NEW — unit tests for both getters
tests/unit/config/prp-commit-format.test.ts   # UNCHANGED (existing — reference for style)
```

### Desired Codebase tree with files to be added/edited

```bash
src/config/constants.ts                       # MODIFIED (append-only: 7 new exported symbols + JSDoc)
.env.example                                  # MODIFIED (insert one subsection)
tests/unit/config/prp-commit-style.test.ts    # NEW
# No other files. PRP_COMMIT_FORMAT block unchanged. No source consumers wired yet (S2/T3/T4).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — getPrpCommitStyleExamples MUST allow 0. Guard is `Number.isNaN(raw) || raw < 0 → DEFAULT`,
//   NOT `<= 0`. PRD §9.2.2 ("Integer ≥ 0") + §5.1 ("0 disables style learning") override the work-item's
//   contradictory "<=0 → 5 (ALLOW 0)" prose. The existing getIssueRetryMax/getResearchTimeoutSeconds
//   reject 0 because a 0 timeout/retry is meaningless; a 0 examples-count is meaningful. Do NOT copy
//   their `<= 0` guard blindly.

// CRITICAL — getPrpCommitStyle is CASE-INSENSITIVE (trim + toLowerCase + match 4 values).
//   getPrpCommitFormat is deliberately CASE-SENSITIVE (only exact 'plain'). Do NOT normalize them.
//   Match all 4: 'auto' | 'plain' | 'conventional' | 'gitmoji'.

// GOTCHA — append the new block IMMEDIATELY AFTER getPrpCommitFormat, keeping the file's sectioned
//   layout. Do NOT reorder or touch the PRP_COMMIT_FORMAT block.

// GOTCHA — JSDoc: each new symbol gets full JSDoc (mirror DEFAULT_PRP_COMMIT_FORMAT/getPrpCommitFormat).
//   The style getter's JSDoc MUST describe each of the 4 modes + case-insensitive matching. The
//   examples getter's JSDoc MUST note "0 disables learning" and the `< 0` guard. (eslint has no
//   jsdoc plugin, but this is the codebase convention and aids S2/T3/T4 consumers.)

// GOTCHA — .env.example: insert BETWEEN the Smart Commit Resilience block (ends ~L115) and the
//   VALIDATION CONFIGURATION header (~L117). Both vars COMMENTED OUT. Match the COMMIT_RETRY_* style.

// GOTCHA — the test MUST include the `accepts 0` case for getPrpCommitStyleExamples (asserts === 0
//   when env='0'). Without it the allow-0 deviation is unverified and could silently regress to `<= 0`.

// GOTCHA — vitest 100% coverage on src/**/*.ts. Hit every branch: style (unset/auto/plain/conventional/
//   gitmoji + case-fold + unrecognized + empty + trim); examples (unset/valid/0/NaN/negative).

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — do NOT wire any consumer (S2 .hack schema, T3 prompt builder, T4 generateCommitMessage)
//   in this subtask. S1 is config primitives + docs + tests ONLY.
```

---

## Implementation Blueprint

### Data models and structure

```ts
// src/config/constants.ts (append) — mirrors the PRP_COMMIT_FORMAT block shape.
export const PRP_COMMIT_STYLE = 'PRP_COMMIT_STYLE';
export const DEFAULT_PRP_COMMIT_STYLE = 'auto' as const;
export type PrpCommitStyle = 'auto' | 'plain' | 'conventional' | 'gitmoji';
export function getPrpCommitStyle(): PrpCommitStyle { /* case-insensitive, default auto */ }
export const PRP_COMMIT_STYLE_EXAMPLES = 'PRP_COMMIT_STYLE_EXAMPLES';
export const DEFAULT_PRP_COMMIT_STYLE_EXAMPLES = 5;
export function getPrpCommitStyleExamples(): number { /* Number + NaN/<0 → 5; allow 0 */ }
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/config/constants.ts — append the PRP_COMMIT_STYLE block
  - APPEND immediately after the getPrpCommitFormat block: the 7 symbols from "Technical requirements"
        (File 1), each with full JSDoc (mirror DEFAULT_PRP_COMMIT_FORMAT/getPrpCommitFormat).
  - getPrpCommitStyle: trim + toLowerCase → match 'auto'|'plain'|'conventional'|'gitmoji' → else 'auto'.
  - getPrpCommitStyleExamples: Number(process.env[...] ?? 5); if (Number.isNaN(raw) || raw < 0) return 5; return raw.
  - DO NOT modify the PRP_COMMIT_FORMAT block or any existing symbol.

Task 2: EDIT .env.example — insert the Commit Message Style subsection
  - INSERT (between the Smart Commit Resilience block ~L115 and the VALIDATION CONFIGURATION header
        ~L117) the block from "Technical requirements" (File 2): a '# --- Commit Message Style ---'
        header + two commented-out vars with one-line descriptions. Match COMMIT_RETRY_* comment style.

Task 3: CREATE tests/unit/config/prp-commit-style.test.ts — mirror prp-commit-format.test.ts
  - IMPORT the new symbols from '../../../src/config/constants.js'; vitest primitives (describe/it/
        expect/vi/afterEach). afterEach(() => vi.unstubAllEnvs()).
  - describe('config/constants: getPrpCommitStyle') cases:
      * unset → 'auto'; 'auto'→'auto'; 'plain'→'plain'; 'conventional'→'conventional'; 'gitmoji'→'gitmoji'.
      * case-insensitive: 'PLAIN'→'plain'; 'Conventional'→'conventional'; 'GITMOJI'→'gitmoji'; 'Auto'→'auto'.
      * unrecognized 'bogus'→'auto'; empty ''→'auto'; whitespace '  plain  '→'plain' (trim).
  - describe('config/constants: getPrpCommitStyleExamples') cases:
      * unset → 5; '5'→5; '10'→10.
      * '0' → 0  ← MANDATORY (proves allow-0; the deviation from the <=0 pattern).
      * 'abc' → 5 (NaN); '-3' → 5 (negative); '  7  ' → 7 (Number trims).
  - NAMING: it('returns the explicit mode (case-insensitive)'), it('accepts 0 (disables learning)'),
        it('defaults to 5 on NaN'), it('defaults to 5 on negative'), etc.
  - PLACEMENT: tests/unit/config/prp-commit-style.test.ts.

Task 4: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/config/prp-commit-style.test.ts --coverage.
  - RUN: npx vitest run tests/unit/config/prp-commit-format.test.ts (regression — S1 is additive).
  - EXPECTED: all clean; constants.ts at 100% on the new lines. If a branch is uncovered (e.g. the
        '0' case, the case-fold branch, the unrecognized→default branch), add the matching case.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the style getter (CASE-INSENSITIVE, 4 values, default auto). Deviates from getPrpCommitFormat.
export function getPrpCommitStyle(): PrpCommitStyle {
  const raw = process.env[PRP_COMMIT_STYLE];
  if (raw === undefined) return DEFAULT_PRP_COMMIT_STYLE;
  const v = raw.trim().toLowerCase();
  if (v === 'auto' || v === 'plain' || v === 'conventional' || v === 'gitmoji') return v;
  return DEFAULT_PRP_COMMIT_STYLE;
}

// PATTERN — the examples getter (ALLOW 0 → guard is `< 0`, NOT `<= 0`).
export function getPrpCommitStyleExamples(): number {
  const raw = Number(
    process.env[PRP_COMMIT_STYLE_EXAMPLES] ?? DEFAULT_PRP_COMMIT_STYLE_EXAMPLES
  );
  if (Number.isNaN(raw) || raw < 0) return DEFAULT_PRP_COMMIT_STYLE_EXAMPLES; // 0 is VALID
  return raw;
}

// PATTERN — the mandatory allow-0 test case (proves the guard deviation).
it('accepts 0 (disables learning under auto)', () => {
  vi.stubEnv(PRP_COMMIT_STYLE_EXAMPLES, '0');
  expect(getPrpCommitStyleExamples()).toBe(0);
});
```

### Integration Points

```yaml
DOWNSTREAM (S1 ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T1.S2 (.hack schema): adds [pipeline] commit_style + commit_style_examples keys to SCHEMA_MAP
        + HACK_CONFIG_SCHEMA, seeding these env vars. Consumes the constants/type/getters.
  - P1.M1.T3.S1 (prompt builder): buildCommitMessageSystemPrompt(style, examples?) consumes
        PrpCommitStyle + getPrpCommitStyle to pick the contract.
  - P1.M1.T4.S1 (generateCommitMessage wiring): resolves the style + fetches N examples + builds the
        dynamic prompt. Consumes getPrpCommitStyle/getPrpCommitStyleExamples.

NO SOURCE INTEGRATION in S1: the getters have no consumers yet. constants.ts is the single add site.
  PRP_COMMIT_FORMAT is UNCHANGED.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint && npm run format:check   # clean
# Expected: clean. typecheck cannot fail on additive constants/getters; if it does, a typo in the
# type union or getter return — re-check the verbatim bodies.
```

### Level 2: Unit Tests (the new getters)

```bash
npx vitest run tests/unit/config/prp-commit-style.test.ts --coverage
# Expected: green; constants.ts at 100% on the new lines. The '0' case MUST pass (proves allow-0).
# Regression — the existing format test stays green (S1 is additive):
npx vitest run tests/unit/config/prp-commit-format.test.ts
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S1 — config primitives with no consumers yet (S2/T3/T4 wire them). Smoke-confirm the
# getters resolve from a real env:
npx tsx -e "
import { getPrpCommitStyle, getPrpCommitStyleExamples, DEFAULT_PRP_COMMIT_STYLE } from './src/config/constants.ts';
console.log('default style:', DEFAULT_PRP_COMMIT_STYLE, '| unset →', getPrpCommitStyle(), '| examples unset →', getPrpCommitStyleExamples());
process.env.PRP_COMMIT_STYLE = 'CONVENTIONAL'; process.env.PRP_COMMIT_STYLE_EXAMPLES = '0';
console.log('CONVENTIONAL →', getPrpCommitStyle(), '| 0 →', getPrpCommitStyleExamples());
"
# Expected: default style: auto | unset → auto | examples unset → 5  ;  CONVENTIONAL → conventional | 0 → 0.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — config primitives with no creative surface. Domain checks (record in commit msg):
#   - Style getter is case-insensitive over 4 modes (deviation from format's case-sensitive single opt-out).
#   - Examples getter allows 0 (deviation from the <=0 numeric-getter pattern; PRD §9.2.2 "Integer ≥ 0").
#   - .env.example docs the new vars alongside the existing commit config.
#   - No consumer wired (S2/T3/T4 own that).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/prp-commit-style.test.ts` green; `constants.ts` 100% on new lines.
- [ ] `npx vitest run tests/unit/config/prp-commit-format.test.ts` green (regression).

### Feature Validation
- [ ] 7 new symbols exported (PRP_COMMIT_STYLE, DEFAULT_PRP_COMMIT_STYLE, PrpCommitStyle, getPrpCommitStyle, PRP_COMMIT_STYLE_EXAMPLES, DEFAULT_PRP_COMMIT_STYLE_EXAMPLES, getPrpCommitStyleExamples).
- [ ] `getPrpCommitStyle()` matches 4 modes case-insensitively; defaults `auto`.
- [ ] `getPrpCommitStyleExamples()` accepts 0; defaults 5 on unset/NaN/negative.
- [ ] `.env.example` has the Commit Message Style subsection (both vars commented) after Smart Commit Resilience.
- [ ] Test includes the `accepts 0` case.

### Code Quality Validation
- [ ] Only `src/config/constants.ts` (append), `.env.example` (insert), and the new test file modified.
- [ ] `PRP_COMMIT_FORMAT` block + `prp-commit-format.test.ts` UNCHANGED.
- [ ] New block mirrors the format block's shape (const → default → type → getter + JSDoc).
- [ ] Both documented deviations (case-insensitive; allow-0) implemented, not "normalized" away.

### Documentation & Deployment
- [ ] JSDoc on every new symbol (style getter describes 4 modes + case-insensitive; examples getter notes "0 disables learning" + `< 0` guard).
- [ ] `.env.example` updated (Mode A — rides with the code).
- [ ] Commit message notes: style layer config primitives; case-insensitive (deviation); allow-0 (deviation, PRD wins over contract prose); consumers = S2/T3/T4.

---

## Anti-Patterns to Avoid

- ❌ Don't copy the `<= 0 → default` guard from getIssueRetryMax/getResearchTimeoutSeconds — `getPrpCommitStyleExamples` MUST allow 0 (guard is `< 0`). PRD §9.2.2/§5.1 override the contract's contradictory "<=0 → 5 (ALLOW 0)".
- ❌ Don't make `getPrpCommitStyle` case-sensitive like `getPrpCommitFormat` — it MUST be case-insensitive (trim + toLowerCase + match 4 values). The two are intentionally different.
- ❌ Don't modify the `PRP_COMMIT_FORMAT` block or `prp-commit-format.test.ts` — S1 is purely additive.
- ❌ Don't wire any consumer (S2 .hack schema / T3 prompt builder / T4 generateCommitMessage) — that's later subtasks.
- ❌ Don't skip the `accepts 0` test case — it's the proof that the guard is `< 0` not `<= 0`; without it the deviation is unverified.
- ❌ Don't append the `.env.example` block at file end — insert it between Smart Commit Resilience and VALIDATION CONFIGURATION (it belongs with the commit config).
- ❌ Don't leave the `.env.example` vars uncommented — they're optional with defaults; match the COMMIT_RETRY_* commented style.
- ❌ Don't drop the JSDoc — mirror the format block's full-JSDoc convention (describes each mode; notes the allow-0 guard); S2/T3/T4 consumers rely on it.
- ❌ Don't run the full `npm run test:run` as the S1 gate — use the targeted config suite (the wider suite state is orthogonal to this additive change).

---

## Confidence Score

**9/10** — one-pass implementation success likelihood.

Rationale: This is a config-primitives subtask that mirrors an existing, proven block (`PRP_COMMIT_FORMAT`)
verbatim in shape, with two deliberate deviations (case-insensitive; allow-0) that are explicitly
reconciled against the PRD (the authoritative source) and against the existing numeric-getter pattern.
The verbatim symbol bodies, the `.env.example` insertion site + block, the test pattern to copy (with
the mandatory `accepts 0` case), and the executable validation commands are all specified. The one
genuine trap — the work-item's contradictory "<=0 → 5 (ALLOW 0)" — is called out at the top of the PRP
and resolved (guard is `< 0`, allow 0), so the implementer will not copy the `<= 0` pattern blindly.
Residual risk: a missing coverage branch (e.g. the case-fold or the `0` case) — covered by the
per-branch test plan. No external/runtime unknowns.