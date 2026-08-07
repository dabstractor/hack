# Research — P1.M1.T1.S1 (PRP_COMMIT_STYLE + PRP_COMMIT_STYLE_EXAMPLES config)

Foundation for the PRD §5.1 commit-message **style layer** (orthogonal to the
existing `PRP_COMMIT_FORMAT` position layer). S1 adds the config constants, type,
two getters, and `.env.example` docs. Consumed by S2 (.hack schema), T3 (prompt
builder), T4 (generateCommitMessage wiring).

## 1. The pattern to mirror — PRP_COMMIT_FORMAT block (src/config/constants.ts ~677+)

Section header `// Commit Message Format (PRP_COMMIT_FORMAT) — PRD §5.1`, then four exports:
```ts
export const PRP_COMMIT_FORMAT = 'PRP_COMMIT_FORMAT';                 // env-var name
export const DEFAULT_PRP_COMMIT_FORMAT = 'task-prefix' as const;      // default (as const)
export type PrpCommitFormat = 'task-prefix' | 'plain';                // union
export function getPrpCommitFormat(): PrpCommitFormat {               // getter
  const raw = process.env[PRP_COMMIT_FORMAT];
  if (raw === undefined) return DEFAULT_PRP_COMMIT_FORMAT;
  const v = raw.trim();
  return v === 'plain' ? 'plain' : 'task-prefix'; // CASE-SENSITIVE; only exact lowercase 'plain' opts out
}
```
Each symbol has thorough JSDoc (`@remarks`, `@example`, the "SINGLE read site" convention
note). The new PRP_COMMIT_STYLE block goes IMMEDIATELY AFTER this block, same shape.

## 2. The new block (verbatim shapes)

```ts
export const PRP_COMMIT_STYLE = 'PRP_COMMIT_STYLE';
export const DEFAULT_PRP_COMMIT_STYLE = 'auto' as const;
export type PrpCommitStyle = 'auto' | 'plain' | 'conventional' | 'gitmoji';

// CASE-INSENSITIVE (4 values) — UNLIKE getPrpCommitFormat (case-sensitive, 1 opt-out).
export function getPrpCommitStyle(): PrpCommitStyle {
  const raw = process.env[PRP_COMMIT_STYLE];
  if (raw === undefined) return DEFAULT_PRP_COMMIT_STYLE;
  const v = raw.trim().toLowerCase();
  if (v === 'auto' || v === 'plain' || v === 'conventional' || v === 'gitmoji') return v;
  return DEFAULT_PRP_COMMIT_STYLE;   // unrecognized/empty → auto
}

export const PRP_COMMIT_STYLE_EXAMPLES = 'PRP_COMMIT_STYLE_EXAMPLES';
export const DEFAULT_PRP_COMMIT_STYLE_EXAMPLES = 5;

// ⚠️ ALLOW 0 — guard is `< 0`, NOT `<= 0` (deviation from getIssueRetryMax/getResearchTimeoutSeconds).
export function getPrpCommitStyleExamples(): number {
  const raw = Number(process.env[PRP_COMMIT_STYLE_EXAMPLES] ?? DEFAULT_PRP_COMMIT_STYLE_EXAMPLES);
  if (Number.isNaN(raw) || raw < 0) return DEFAULT_PRP_COMMIT_STYLE_EXAMPLES;  // 0 is VALID
  return raw;
}
```

## 3. ⚠️ CRITICAL reconciliation: the contract's "<=0 → 5 (ALLOW 0)" is contradictory

The work-item LOGIC says: "`getPrpCommitStyleExamples()` — `Number(... ?? 5)` +
`Number.isNaN/<=0 → 5` (ALLOW 0 — it disables style learning under auto)." The two halves
CONTRADICT: `<=0 → 5` would REJECT 0, but "ALLOW 0" + PRD §9.2.2 ("Integer ≥ 0") + §5.1
("`PRP_COMMIT_STYLE_EXAMPLES=0` disables style learning") all require 0 to be ACCEPTED.

**Resolution (PRD is the source of truth):** guard is `Number.isNaN(raw) || raw < 0 → DEFAULT`
— i.e. reject NaN and NEGATIVES, but **ACCEPT 0**. This DEVIATES from the existing numeric
getters (`getIssueRetryMax`/`getResearchTimeoutSeconds` use `<= 0 → default` because a 0
timeout/retry is meaningless; a 0 examples-count is meaningful = disable learning). The PRP
must state this explicitly so the implementer does NOT copy the `<= 0` pattern blindly.

## 4. Why the style getter is CASE-INSENSITIVE (deviation from getPrpCommitFormat)

Contract: "The style getter must be CASE-INSENSITIVE (four valid values, unlike
PRP_COMMIT_FORMAT which only matches the exact lowercase 'plain')." So `PRP_COMMIT_STYLE=PLAIN`,
`=Conventional`, `=GITMOJI` all resolve correctly. `getPrpCommitFormat` is deliberately
case-sensitive (only exact `'plain'`); `getPrpCommitStyle` is deliberately case-insensitive
(4 values, user-friendly). Both choices are intentional — do NOT "normalize" them to match.

## 5. .env.example insertion (after Smart Commit Resilience block)

The Smart Commit Resilience block is at lines 111–115 (`# COMMIT_RETRY_DELAY_CAP=120000`).
Insert a new `# --- Commit Message Style (PRD §5.1) ---` subsection between line 115 and the
`VALIDATION CONFIGURATION` header (line 117), matching the COMMIT_RETRY_* comment style:
```
# --- Commit Message Style (PRD §5.1) ---
# PRP_COMMIT_STYLE governs the descriptive-message STYLE, orthogonal to PRP_COMMIT_FORMAT's
# position prefix. auto (default) learns from the last N commits; plain/conventional/gitmoji
# are explicit contracts. See PRD §5.1, §9.2.2.
# PRP_COMMIT_STYLE=auto
# How many recent commits `auto` sends as style examples (default 5; 0 disables learning).
# PRP_COMMIT_STYLE_EXAMPLES=5
```

## 6. Tests — mirror tests/unit/config/{prp-commit-format,issue-retry-max}.test.ts

Create `tests/unit/config/prp-commit-style.test.ts`. Pattern: `vi.stubEnv(VAR, val)` per case +
`vi.unstubAllEnvs()` in afterEach (see issue-retry-max.test.ts:30). Coverage-required cases:
- getPrpCommitStyle: unset→'auto'; 'auto'→'auto'; 'plain'→'plain'; 'conventional'→'conventional';
  'gitmoji'→'gitmoji'; 'PLAIN'→'plain' (case-insensitive); 'Conventional'→'conventional';
  'bogus'→'auto'; '' (empty)→'auto'; '  plain  '→'plain' (trim).
- getPrpCommitStyleExamples: unset→5; '5'→5; '0'→0 (ALLOW 0 — the key case); 'abc'→5 (NaN);
  '-3'→5 (negative); '  7  '→7 (trim via Number).

vitest enforces 100% coverage on src/**/*.ts → every getter branch must be hit.

## 7. Validation

- `npm run typecheck` (tsc --noEmit -p tsconfig.build.json) — clean.
- `npm run lint && npm run format:check` — clean (prettier ERROR-enforced; `npm run fix`).
- `npx vitest run tests/unit/config/prp-commit-style.test.ts` — green; new getter branches at 100%.
- Existing `prp-commit-format.test.ts` still green (S1 is purely additive — no change to PRP_COMMIT_FORMAT).