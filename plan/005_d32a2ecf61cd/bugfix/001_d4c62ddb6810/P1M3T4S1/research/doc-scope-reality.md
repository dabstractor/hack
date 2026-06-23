# Research Note — P1.M3.T4.S1 Doc Sync Scope

## Why this research exists
The task contract references `README.md` line numbers and a "Self-Healing & Resilience" section
that exist on **`main` at `4e6d2ef`**, but the implementation is happening on a **detached HEAD**
(`bbd8ce3`) that is a child of the bug-report commit — it does NOT contain main's Session-005
resilience work. This note records the working-directory reality so the doc edits stay accurate
and do not overclaim.

## Git topology (verified)
- Current HEAD: `bbd8ce3` ("Add git history primitives and R4 recovery E2E test"), DETACHED from `b03ed87`.
- `main` is at `4e6d2ef` (has R1–R4 source + README resilience blurb + the logger regression).
- The bugfix branch has ADDED (on top of the pre-Session-005 baseline `b03ed87`):
  - `src/core/tasks-json-recovery.ts` + R4 config/unit tests (commit `6e80a4f`)
  - `tests/unit/logger.test.ts` regression test (`a2a762e`)
  - `package.json` validate now includes `test:run` + `docs/TESTING.md` callout (`d58dd93`)
  - `src/tools/git-mcp.ts` git-history primitives + `tests/integration/core/tasks-json-recovery-e2e.test.ts` (`bbd8ce3`)

## What R1–R2 integration tests? (BLOCKED — critical for docs accuracy)
- `P1.M3.T1.S1` (deadline fallback, R1) and `P1.M3.T2.S1` (issue re-plan, R2) are **BLOCKED**.
  Their `issue_feedback.md` files confirm the R1/R2 source features (`RESEARCH_TIMEOUT`,
  `getResearchTimeoutSeconds`, `researchNow`, `ISSUE_RETRY_MAX`, `getIssueRetryMax`, tri-state
  `ExecutionResult`, `deletePRP`) are **NOT implemented** in `src/` on this branch.
- Therefore the ONLY resilience integration test that actually exists on this branch is the
  **R4 tasks.json smart-recovery E2E test** (`tasks-json-recovery-e2e.test.ts`).
- DOC CONSEQUENCE: do NOT write that "integration tests now cover the R1–R4 flows" — that is
  FALSE here. Only R4 recovery exists.

## Working-directory README.md reality (differs from main)
- NO "Self-Healing & Resilience" section exists (grep `resilien|self-heal|recover|re-plan|deadline|fallback`
  in README.md returns ZERO matches). That section lives only on `main`. → The contract's
  conditional clause "If there is a 'Self-Healing & Resilience' section…" does NOT apply. SKIP.
- Script table is at lines **596–609** (NOT 627–631 as in the contract, which is main's numbering).
- The validate row is line 608: `| \`npm run validate\`      | Run all validation checks       |`
- Table "Description" column is 31 chars wide (set by "Type check without compilation").
  A replacement description ≤ 31 chars avoids reflowing every row. `Lint, format, typecheck & tests` = 31 chars (exact fit).

## docs/ARCHITECTURE.md & docs/WORKFLOWS.md — validation-gate mentions
- `docs/ARCHITECTURE.md` "Validation Gates" section (line ~486) describes the **pipeline's**
  4-level gates applied to AI-generated code (L1 Syntax/Lint → L2 Unit → L3 Integration → L4 Manual).
  This is a DIFFERENT concept from the developer `npm run validate` commit script. It does NOT
  reference the npm script → NO change required.
- `docs/WORKFLOWS.md` describes QA/BugHunt/FixCycle workflows. The only `validate` token (line ~395)
  is the CLI `--mode validate` mode, not the npm script → NO change required.
- Net: the contract's conditional "if they mention testing or validation gates, ensure they are
  consistent with the updated validate script" → on review, neither references the npm commit gate.
  Implementer should VERIFY, not assume.

## docs/TESTING.md (already done by P1.M2.T1.S1 — DO NOT DUPLICATE)
Already contains:
- Layered-testing note: "`npm run validate` enforces all layers at commit time — it runs `lint`,
  `format:check`, `typecheck`, **and `test:run`**…"
- "Commit-time gate" callout in "Running Tests": "The `npm run validate` convenience script runs
  the **complete** pre-commit gate, in order — `npm run lint && npm run format:check && npm run
  typecheck && npm run test:run`…"

## Formatting tooling facts
- `.prettierignore` excludes: node_modules, dist, coverage, package-lock.json, pnpm-lock.yaml,
  .eslintcache, **artifacts/**, **plan/**. README.md is NOT ignored → it IS checked by
  `npm run format:check`.
- `npm run docs:lint` = `markdownlint "docs/**/*.md"` — does NOT cover root README.md. So README
  is only subject to **prettier** formatting, not markdownlint rules.
- To fix alignment after editing the table: `npm run format` (prettier --write), then verify with
  `npm run format:check`.

## Minimal, accurate deliverable
1. README.md:608 — update the `npm run validate` description to convey it includes the full test suite.
2. Verify (read-only) README has no Self-Healing/Resilience section (skip if absent — it is).
3. Verify (read-only) ARCHITECTURE.md / WORKFLOWS.md don't reference the npm validate script (they don't).
4. Do NOT duplicate TESTING.md. Do NOT claim R1–R4 integration coverage.
5. `npm run format` → `npm run format:check` → `npm run validate` all green.
