# Research Notes — P5.M1.T2.S1: Add `ISSUE_RETRY_MAX` config constant + default

## 1. Exact precedent is ALREADY in the tree (S1 is Complete)

`src/config/constants.ts` already contains the `RESEARCH_TIMEOUT` block (added by
P5.M1.T1.S1). This subtask is a **clone-and-tweak** of that block, NOT a greenfield
pattern invention. The full block (lines ~155-203) is quoted verbatim in the PRP.

Relevant constants/helpers already shipped by S1:
- `export const RESEARCH_TIMEOUT = 'RESEARCH_TIMEOUT';`
- `export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300;`
- `export function getResearchTimeoutSeconds(): number { … }` (guard: `Number.isNaN(raw) || raw <= 0 → default`)

`ISSUE_RETRY_MAX` follows the SAME shape, differing only in:
- name (`ISSUE_RETRY_MAX`), default value (`3`, an integer *count* not seconds),
- default const name (`DEFAULT_ISSUE_RETRY_MAX` — **no unit suffix**, because it is a
  dimensionless count; contrast `DEFAULT_RESEARCH_TIMEOUT_SECONDS` which carries `_SECONDS`),
- reader name (`getIssueRetryMax` — no unit suffix),
- semantics (re-planning count, PRD §4.5 — NOT a deadline).

## 2. The "Resilience Tuning" docs subsection ALREADY EXISTS

S1 created `### Resilience Tuning` in `docs/CONFIGURATION.md` (between Pipeline Control
and Bug Hunt Configuration) with ONE row (`RESEARCH_TIMEOUT`). Therefore this subtask:
- **adds a second ROW** (`ISSUE_RETRY_MAX`) to that existing table — it does NOT create
  a new subsection,
- **updates the subsection intro line** to also reference PRD §4.5 (issue-driven
  re-planning), so the heading accurately describes both knobs.

This is the single most important divergence from the S1 PRP (S1 *created* the
subsection; S1's PRP even says "ISSUE_RETRY_MAX (T2.S1) follows the exact same config
pattern … a copy-paste-tweak").

## 3. ISSUE_RETRY_MAX is a DIFFERENT retry dimension (implementation_notes.md §3)

CRITICAL scope discipline — do NOT conflate with the existing transient-error retry path:
- `TaskRetryManager` (`src/core/task-retry-manager.ts`): retries **transient infra errors**
  (API timeout, network) with exponential backoff, gated by `maxAttempts` (default 3). This
  is the **fix-and-retry path** for hard `fail` outcomes. Executor-level.
- `ISSUE_RETRY_MAX`: bounds **re-planning attempts** (PRP gap → re-research with feedback
  injected). This is an **orchestrator-level** counter, consumed by P5.M1.T2.S4. PRD §4.5.

This subtask ships ONLY the config layer (const + default + reader + docs). It does NOT
touch `task-retry-manager.ts` and does NOT wire any counter into the orchestrator (that is
S4). The reader is a pure function that returns the configured integer.

## 4. Guard semantics: `<= 0` → default (contract-mandated)

The item contract says the reader must "default on NaN/non-positive". So the guard is
`if (Number.isNaN(raw) || raw <= 0) return DEFAULT_ISSUE_RETRY_MAX;` — identical to
`getResearchTimeoutSeconds`. A value of `0` is treated as invalid (defensive: a zero
re-planning bound is almost certainly a misconfiguration; the safe default is 3). This is
deliberately consistent with the RESEARCH_TIMEOUT reader so both resilience knobs share one
parse-and-guard idiom. (If 0-as-fail-fast is ever desired, that is a future contract change,
NOT this subtask.)

## 5. Validation commands (verified from package.json)

- `npm run validate` = `npm run lint` (eslint . --ext .ts) **AND** `npm run format:check`
  (prettier --check "**/*.{ts,js,json,md,yml,yaml}") **AND** `npm run typecheck` (tsc --noEmit).
  - prettier **does** check `docs/*.md` (`.prettierignore` excludes `node_modules dist
    coverage plan/ …` but NOT `docs/`). → The docs table must be prettier-compliant. Safe
    path: add the row, then run `npm run format` (writes) then `npm run validate`.
- `npm run test:run` = `vitest run` (no `--coverage` → the 100% coverage threshold in
  vitest.config.ts is NOT enforced by this command; it only applies to `test:coverage`).
- `npm run docs:lint` = `markdownlint "docs/**/*.md"` (S1's table passes; one more row is fine).

## 6. No file overlap with the in-parallel P5.M1.T1.S3 work

P5.M1.T1.S3 (orchestrator synchronous re-research fallback) edits ONLY:
`src/core/research-queue.ts`, `src/core/task-orchestrator.ts`,
`tests/unit/core/task-orchestrator.test.ts`, `tests/unit/core/research-queue.test.ts`.

This subtask edits ONLY: `src/config/constants.ts`,
`tests/unit/config/issue-retry-max.test.ts` (NEW), `docs/CONFIGURATION.md`.

→ **Zero file overlap.** Safe to land in parallel. (S3's PRP even lists
`src/config/constants.ts` under "NOT TOUCHED — read-only reference".)
