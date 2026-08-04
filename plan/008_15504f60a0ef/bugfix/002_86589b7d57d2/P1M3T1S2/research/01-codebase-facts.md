# Research Notes — P1.M3.T1.S2 (task-prefix builder + formatCommitMessage rework)

> Verified facts gathered while writing the PRP. All line numbers are against the
> working tree at research time (S1 already merged; S2 not started). These are the
> load-bearing claims the PRP depends on.

## 1. S1 (the input contract) is COMPLETE — symbols exist & are exported

`src/config/constants.ts` already contains the full PRP_COMMIT_FORMAT section (P1.M3.T1.S1
shipped before this item — `parallel_execution_context` treated it as a contract; reality
confirms it). Verified via grep:

| Symbol | Kind | Line | Export |
|---|---|---|---|
| `PRP_COMMIT_FORMAT` | const (`'PRP_COMMIT_FORMAT'`) | 705 | ✅ |
| `DEFAULT_PRP_COMMIT_FORMAT` | const (`'task-prefix' as const`) | 723 | ✅ |
| `PrpCommitFormat` | type union (`'task-prefix' \| 'plain'`) | ~730 | ✅ |
| `getPrpCommitFormat()` | fn → `PrpCommitFormat` | 760 | ✅ |

- `getPrpCommitFormat()` reads `process.env[PRP_COMMIT_FORMAT]`; returns `'plain'` only for
  exact trimmed `'plain'`; else `'task-prefix'` (unset/empty/unknown/case-mismatch → default).
  **CASE-SENSITIVE** (documented + tested in S1's `prp-commit-format.test.ts`).
- The `PrpCommitFormat` type JSDoc literally says "consumed by `formatCommitMessage`
  (P1.M3.T1.S2)" → confirms the handoff contract.
- **S2 imports `getPrpCommitFormat` (and optionally the `PrpCommitFormat` type) from
  `'../config/constants.js'`.** No env reads in git-commit.ts — single-read-site convention.

## 2. The function to rework + its JSDoc

`src/utils/git-commit.ts`:
- **JSDoc**: lines **92–106** (`/** Formats a commit message with PRP prefix … */`). Currently
  documents the `[PRP Auto]` banner as INTENDED ("Adds [PRP Auto] prefix to distinguish
  automated commits"). Must be rewritten to describe task-prefix/plain per PRD §5.1.
- **Function**: lines **108–110**:
  ```ts
  export function formatCommitMessage(message: string): string {
    return `[PRP Auto] ${message}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
  }
  ```
- New signature (contract): `formatCommitMessage(message: string, position?: ItemPosition | null): string`.

## 3. Internal call sites of formatCommitMessage (all single-arg → backward compatible)

`grep -n formatCommitMessage src/utils/git-commit.ts` → 3 production call sites, all inside
`smartCommit`, all single-arg:
- `:508` → `formatCommitMessage(generated)` (stagecoach happy path)
- `:520` → `formatCommitMessage(buildFallbackCommitMessage(genError))` (fallback)
- `:525` → `formatCommitMessage(message)` (default path)

**Implication:** adding an OPTIONAL `position` param keeps all 3 call sites compiling
unchanged. After S2 (no position passed) they produce **plain** output (`message + trailer`,
NO `[PRP Auto]`). **S2 does NOT thread `position` into `smartCommit`** — that is
P1.M3.T2.S1 (S3). S2 only reworks `formatCommitMessage` itself.

Other `formatCommitMessage` mentions in src/ are JSDoc `{@link}`/prose refs only:
`commit-message-agent.ts:25,62` + `git-commit.ts:104,161,177,237,355,360,472`. The
`:237` JSDoc line says "via formatCommitMessage (adds `[PRP Auto]` prefix + Co-Authored-By)" —
**update this prose** to drop the `[PRP Auto]` mention (it's a comment, not code; keep the
file internally consistent).

## 4. `[PRP Auto]` test occurrences — S2 owns ONLY the in-file ones

`grep -rln '\[PRP Auto\]' tests/` → 3 files. Ownership split:

| File | Count | Owner | Action |
|---|---|---|---|
| `tests/unit/utils/git-commit.test.ts` | **11** | **S2 (this item)** | update to new plain/task-prefix contract |
| `tests/unit/agents/commit-message-agent.test.ts` | few | **S4** (P1.M3.T1.S3) | DO NOT TOUCH — verifies the AGENT never EMITS `[PRP Auto]` (still true) |
| `tests/integration/smart-commit.test.ts` | few | **S3** (P1.M3.T2.S1) | DO NOT TOUCH — wires position through smartCommit |

### The 11 in git-commit.test.ts (enumerated — update each)
1. `describe('formatCommitMessage')` → **rewrite the whole block** (5 tests) to the new
   contract (plain default, task-prefix when position+env, plain when position+plain-env,
   no `[PRP Auto]` ever, defense-in-depth strip, Co-Authored-By preserved).
2. `smartCommit` › "should return commit hash on success": `mockGitCommit` message
   `.toBe('[PRP Auto] Test commit\n\n…')` → drop `[PRP Auto] ` prefix → `'Test commit\n\n…'`.
3. `smartCommit generateMessage option` › "happy path": `'[PRP Auto] feat(api): add endpoint\n\n…'`
   → `'feat(api): add endpoint\n\n…'`.
4. …› "generateCommitMessage throws after retries → FALLBACK": regex
   `/\[PRP Auto\] chore: commit-gen failed \(exit \d+\); fallback commit…/` → drop `\[PRP Auto\] `.
5. …› "BACKWARD COMPAT: no options": `'[PRP Auto] Pre-formatted message\n\n…'` → plain.
6. …› "retry: succeeds on 3rd attempt": `'[PRP Auto] feat: retry works\n\n…'` → plain.
7. …› "retry: exhausted → FALLBACK": regex `/chore: commit-gen failed \(exit \d+\)…/`
   (already no `[PRP Auto]` — leave).

**Rule:** every `[PRP Auto] ` literal in an EXPECTED committed message becomes the plain
subject; every `toContain('[PRP Auto]')`/regex assertion in the `formatCommitMessage` block
is replaced by the new-contract assertions. The defense-in-depth strip test asserts a message
that STARTED with `[PRP Auto] ` is emitted WITHOUT it.

## 5. subtask.id format (parseItemPosition input)

`src/core/models.ts:~382` — `SubtaskSchema` enforces `id: z.string().regex(/^P\d+\.M\d+\.T\d+\.S\d+$/, …)`.
So **runtime Subtask ids are always 4-level** (`P1.M2.T1.S1`). BUT the architecture doc + PRD §5.1
require trailing-level ELISION for a Task-level item (no subtask → `1.2.1`). Therefore
`parseItemPosition` must accept BOTH:
- `P1.M2.T1.S1` → `{phase:1, milestone:2, task:1, subtask:1}`
- `P1.M2.T1`    → `{phase:1, milestone:2, task:1}` (no `subtask`)

Contract regex: `^P(\d+)\.M(\d+)\.T(\d+)(?:\.S(\d+))?$`. Non-match → `null`
(covers `'garbage'`, `'P1.M2'`, `'P1.M2.T1.S1.X'`, `''`, lowercase, etc.).

## 6. Coverage gate (100% global — vitest.config.ts)

`vitest.config.ts` → `coverage.thresholds.global.{statements,branches,functions,lines}=100`,
`include: ['src/**/*.ts']`. So every branch S2 adds must be exercised:

- `parseItemPosition`: non-match(null) / 3-level match / 4-level match.
- `buildTaskPrefix`: `subtask` present / absent (elision).
- `formatCommitMessage`: position absent(undefined) / position null / position+task-prefix /
  position+plain / defense-in-depth `[PRP Auto] ` strip.

## 7. npm scripts (verified)

- `npm run fix` = `lint:fix && format` (run FIRST — JSDoc/tests reflow).
- `npm run typecheck` = `tsc --noEmit -p tsconfig.build.json`.
- `npm run lint` = `eslint . --ext .ts`.
- `npm run format:check` = `prettier --check "**/*.{ts,js,json,md,yml,yaml}"`.
- `npm run test:run` = `vitest run` — **PRE-EXISTING RED (BUG-004, 178 fails, P1.M4 scope).**
  DO NOT use as the gate. Gate = typecheck + lint + format:check + the targeted file
  (`tests/unit/utils/git-commit.test.ts`) + sibling regression
  (`tests/unit/config/prp-commit-format.test.ts`, `tests/unit/config/commit-retry.test.ts`).

## 8. Test env-management convention (copy from config tests)

`tests/unit/config/{validation-config,commit-retry,prp-commit-format}.test.ts` use:
`beforeEach(() => { delete process.env.<VAR>; })` + `afterEach(() => { vi.unstubAllEnvs(); })`.
S2's `formatCommitMessage` tests that exercise `getPrpCommitFormat()` branches MUST use the
same harness (a leftover `vi.stubEnv(PRP_COMMIT_FORMAT, …)` would bleed across cases).
`parseItemPosition`/`buildTaskPrefix` are pure literals → no env stubbing.

## 9. Co-Authored-By trailer decision (preserved in BOTH modes)

Per `architecture/bug-003-commit-format.md`: PRD §5.1's forbidden-banner statement names
`[PRP Auto]` + Conventional-Commit SCOPE but is SILENT on the trailer. The §5.1 format spec
is about the SUBJECT line; a trailer is a separate body/footer. **DECISION: PRESERVE
`Co-Authored-By: Claude <noreply@anthropic.com>` (after a blank line) in BOTH task-prefix and
plain modes.** Only `[PRP Auto]` is removed. (S1 PRP + arch doc agree.)

## 10. Scope boundary (disjoint from siblings)

- **S2 TOUCHES:** `src/utils/git-commit.ts` (interface + 2 helpers + reworked fn + JSDoc
  rewrite + the `:237` prose fix) and `tests/unit/utils/git-commit.test.ts` (rewrite
  `formatCommitMessage` block + add `parseItemPosition`/`buildTaskPrefix` blocks + update the
  ~6 smartCommit `[PRP Auto]` message assertions).
- **S2 does NOT touch:** `src/agents/commit-message-agent.ts` (S4),
  `tests/unit/agents/commit-message-agent.test.ts` (S4),
  `tests/integration/smart-commit.test.ts` (S3), `src/core/task-orchestrator.ts` +
  `src/workflows/bug-hunt-workflow.ts` (S3 call-site wiring + smartCommit `position` threading),
  `src/config/constants.ts` (S1 — done), `docs/CONFIGURATION.md` (S1 — done).
- **No new external dependency / no web research needed** — this is a pure internal string
  refactor; the spec is fully internal (architecture/bug-003 §S2 + PRD §5.1).