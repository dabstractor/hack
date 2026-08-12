# Research Notes — P1.M3.T2.S1 (fix stray-`>` bug + assert trailer/banner absence in all modes)

> Documentation/test-only item in the §9.10 "Commit Generation & Agent Tool Safety" changeset.
> **HEADLINE: the contract's premise is STALE on 3 of 4 clauses** — the parallel P1.M2.T3.S2 rewire
> (COMPLETE) already resolved the stray-`>` blocker + the Co-Authored-By inversion. This note reconciles
> each contract clause against the LIVE tree and isolates the REAL remaining work. Verified live.

## 0. The contract vs the live tree — clause-by-clause reconciliation

| Contract clause | Survey doc (stale) claim | LIVE tree finding | Verdict |
|---|---|---|---|
| (a) Strip stray trailing `>` from toBe/toHaveBeenCalledWith | git-commit.test.ts "nearly every" toBe ends in `>`; RED; blocker | git-commit.test.ts is now **2621 lines** (rewired from 2233); `grep ">'[\),]"` = **0 hits**; toBe/toEqual/toHaveBeenCalledWith-with-trailing-`>` = **0**. No `noreply`/`Co-Authored` PRESENCE assertion survives (only the dedicated ABSENCE test @509-531 + comment @1400). | **ALREADY DONE** — VERIFY ONLY |
| (c) Verify smart-commit.test.ts asserts absence | §3: already inverted (2 tests) | CONFIRMED: `should layer the task-prefix and NOT emit [PRP Auto]…` (@387-406) + `should NOT add any Co-Authored-By trailer…` (@409-418) both assert `not.toContain('Co-Authored-By')` / `not.toMatch(/\n\nCo-Authored-By:/)`. Mock returns `msg` verbatim. | **ALREADY DONE** — VERIFY ONLY |
| (d) Remove §5.1 'unless an explicit style layer below adds one' carve-out from src/ | (carve-out exists) | The phrase is **NOT PRESENT** anywhere in src/ (grep all variants `unless an explicit|style layer.*adds|adds one|may add a|carve-out|loophole` = **0 hits**). formatCommitMessage JSDoc already forbids+removes the trailer. | **ALREADY GONE** — VERIFY ONLY |
| (b) Assert ABSENCE across ALL modes | formatCommitMessage block has a dedicated absence test | Dedicated absence test @509-531 covers 3 of 4 modes (null-position, task-prefix env-unset, [PRP Auto]-strip) with the full triple. **The explicit `plain` mode (PRP_COMMIT_FORMAT=plain) is covered for `[PRP Auto]` absence only** (test @462) — NOT for Co-Authored-By/noreply absence. §9.10.2 requires "every mode" × the full triple. | **REAL GAP** — small completion needed |
| DOCS: JSDoc cites §9.10.2 | — | formatCommitMessage JSDoc (@196-230) cites **§5.1** but **NOT §9.10.2**. The §9.10.2 "no style layer may add a Co-Authored-By trailer, ever" wording is absent. | **REAL GAP** — small DOCS edit |

**Why the contract is stale:** the survey doc (`commit-tests-survey.md §1`) described the suite state BEFORE
the P1.M2.T3.S2 rewire. That rewire rewrote git-commit.test.ts (2233→2621 lines), moved the mock target from
the deleted `commit-message-agent` factory to the stagecoach binary-exec boundary, AND in the process cleaned
the stray `>` + the Co-Authored-By inversion. The P1.M2.T3.S2 PRP states this explicitly ("the stray-`>` bug
is ALREADY RESOLVED; passes 111/111; zero `>`-ending assertions"). My item inherits the post-rewire tree.

## 1. The REAL remaining work (the 2 gaps + 1 comment cleanup)

### Gap 1 — complete the all-modes ABSENCE coverage (contract clause b, §9.10.2 behavioral test)
The §9.10.2 acceptance + the contract (b) require formatCommitMessage tests to assert the ABSENCE triple
(`not.toContain('Co-Authored-By')` + `not.toMatch(/noreply@anthropic\.com/)` + `not.toContain('[PRP Auto]')`)
across **all four** modes: task-prefix, **plain (PRP_COMMIT_FORMAT=plain)**, null-position (non-backlog),
and the [PRP Auto]-strip path.

- The dedicated test **`NEVER adds a Co-Authored-By trailer in ANY output (identity-transparent, §5.1)`**
  (git-commit.test.ts:509-531) builds a `results[]` cross-section of 3 cases (plain msg / prefixed msg /
  `[PRP Auto] stripped msg`) and asserts the triple in a for-loop. **It does NOT include the
  `PRP_COMMIT_FORMAT=plain` mode.**
- The plain-mode test **`position + PRP_COMMIT_FORMAT=plain → plain (position IGNORED) + trailer`**
  (@462-475) asserts only `toBe('add utility')` + `not.toContain('[PRP Auto]')` — **no Co-Authored-By /
  noreply absence**.
- The env harness in the formatCommitMessage describe block is ALREADY set up for env stubbing:
  `beforeEach(() => { delete process.env.PRP_COMMIT_FORMAT; })` (@408) + `afterEach(() => { vi.unstubAllEnvs(); })` (@412-413).
  So a plain-mode stub inside a test is safe (reset by afterEach).

**Fix (prescribed):** restructure the dedicated absence test (@509-531) to compute a `results[]` across all
4 modes (stubbing plain env for the plain case, resetting between, before the shared for-loop), rename its
title to cite **§9.10.2** + "every mode", and keep the full triple. This makes ONE test satisfy the
§9.10.2 verbatim behavioral-test requirement. (Fallback: instead add the triple to the plain @462 +
task-prefix-explicit @478 per-mode tests — collectively covers all 4 modes. The restructure is cleaner.)

### Gap 2 — DOCS: formatCommitMessage JSDoc cites §9.10.2 (contract DOCS clause)
- The `formatCommitMessage` JSDoc `@remarks` (@196-230) says the trailer is forbidden + removed and cites
  **PRD §5.1** "Commit-identity transparency". It does NOT cite **§9.10.2**, which is the section that
  CLOSED the §5.1 "unless an explicit style layer below adds one" loophole and added the structural guard.
- The sibling structural-guard test (`tests/unit/guards/commit-identity-guard.test.ts`) already cites §9.10.2.
- **Fix (prescribed):** in the formatCommitMessage `@remarks`, append §9.10.2 to the existing §5.1 citation
  and state "no style layer may add a `Co-Authored-By` trailer, ever (§9.10.2)."

### Cleanup — stale test titles reference a trailer that no longer exists
- Test @462 title: `'position + PRP_COMMIT_FORMAT=plain → plain (position IGNORED) + trailer'` — says
  `+ trailer` but asserts `toBe('add utility')` (NO trailer; production emits none).
- Test @478 title: `'position + PRP_COMMIT_FORMAT=task-prefix (explicit default honored) → prefix + trailer'`
  — same stale `+ trailer`.
- These are half-edited artifacts of the trailer inversion. **Fix:** drop `+ trailer` from both titles (the
  assertions already correctly omit the trailer). (Also: the comment @1400 "plain subject + Co-Authored-By
  trailer, no [PRP Auto]" is stale — it says "Co-Authored-By trailer" which no longer exists; reword to
  "plain subject, no Co-Authored-By trailer, no [PRP Auto]".)

## 2. formatCommitMessage — current behavior (DONE; my tests assert it)
`src/utils/git-commit.ts:231-246` — strips `[PRP Auto] ` (defense-in-depth), layers `<prefix>: ` when
`position && getPrpCommitFormat()==='task-prefix'`, returns the bare/prefixed subject with **NO trailer,
NO machine author** (identity-transparent per §5.1 + §9.10.2). My tests assert this DONE behavior; I do NOT
change the function body. (Only its JSDoc — Gap 2.)

## 3. Verification approach + gate
- typecheck EXCLUDES tests (`tsconfig.build.json`) → validate test changes via `npx vitest run <file>`.
- Gate for THIS item: `npx vitest run tests/unit/utils/git-commit.test.ts tests/integration/smart-commit.test.ts`
  (GREEN) + `npm run typecheck && npm run lint && npm run format:check` (the formatCommitMessage JSDoc edit
  must pass prettier) + `npm run validate` if present. The sibling P1.M3.T1.S1 guard (disjoint file) should
  stay GREEN — my JSDoc edit only adds a §9.10.2 citation in a comment, which the guard's comment-skip
  already ignores (and the guard's forbidden-token list does not include §9.10.2 / "style layer").
- Confirm NO stray `>` + NO carve-out: `grep -rnE ">'[\),]" tests/unit/utils/git-commit.test.ts` (0) +
  `grep -rnEi "unless an explicit style layer|style layer.*adds one|may add a.*trailer" src/` (0).

## 4. Disjointness / scope
- P1.M3.T1.S1 (parallel) = NEW `tests/unit/guards/commit-identity-guard.test.ts` (walks src/ for forbidden
  literals). MY item = git-commit.test.ts behavioral test + formatCommitMessage JSDoc. **File-disjoint.**
- My JSDoc edit is a comment-citation change → the sibling's guard comment-skip handles it; no false trip.
- Do NOT re-rewire the stagecoach mock (P1.M2.T3.S2 did it); do NOT touch formatCommitMessage body, the
  guard test, smart-commit.test.ts (verify-only), or any src/ file other than the formatCommitMessage JSDoc.