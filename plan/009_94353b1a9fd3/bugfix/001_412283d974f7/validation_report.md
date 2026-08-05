# Validation Report — hacky-hack (PRP Pipeline CLI)

**Date:** 2025-08-05
**Validator:** Automated codebase analysis + `./validate.sh` (6-phase: lint, typecheck, format, build, unit/integration tests, E2E subprocess workflows)
**Scope:** Deep validation of the PRD bug-fix delta (§9.8 repo-root, §9.7 `.hack` config, §5.3 breakdown-in-progress) plus the standard toolchain and complete user workflows.

---

## Executive Summary

The PRD describes **3 bugs** (1 Critical, 2 Minor) to be fixed. The implementation addresses all three, and the **primary intent of every fix is verified working** end-to-end via real subprocess invocations:

| PRD Bug | Severity | Status | Notes |
|---|---|---|---|
| BUG-001 (subcommands resolve `plan/`/`PRD.md` against invocation dir) | Critical | ⚠️ **Partially fixed — 2 new regressions introduced** | Primary fix works for all 7 subcommands + §9.8.5 + §5.3; but the fix mechanism (a `preAction` chdir) silently broke the sibling §9.8.9 `--prd` semantic and 9 existing tests. |
| BUG-002 (config errors render with stack trace) | Minor | ✅ **Fixed** | Clean `❌` rendering, no stack trace, secret values masked. |
| BUG-003 (relational constraint unenforced) | Minor | ✅ **Fixed** | `cap < delay` rejected at startup and via `config validate`. Minor cosmetic blemish only. |

**Bottom line:** BUG-002 and BUG-003 are correctly and completely fixed. BUG-001 achieves its stated goal (run-from-anywhere for subcommands) **but the chosen implementation introduces two new defects** — one a spec violation (§9.8.9), one a red test suite — that were not caught because the existing tests assert the resolver in isolation rather than the action-handler timing the fix changed.

**Validation result:** ❌ **FAIL** — 2 real regressions from the BUG-001 fix must be addressed before this delta ships.

---

## Validation Method

`./validate.sh` runs 6 phases:
1. **Lint** — `eslint . --ext .ts`
2. **Typecheck** — `tsc --noEmit`
3. **Format** — `prettier --check`
4. **Build** — `tsc -p tsconfig.build.json`
5. **Tests** — `vitest run` (env-cleaned: `RESEARCH_DEPTH`/`RESEARCH_QUEUE_CONCURRENCY`/`PARALLEL_RESEARCH` unset, see Finding F-4)
6. **E2E workflows** — real `node dist/index.js` subprocess invocations with controlled `cwd`, covering all 7 subcommands from a nested subdir, §9.8.5 no-repo hard error, §5.3 calm notice, `--repo-root` semantics, BUG-002/BUG-003 reproductions, and a §9.8.9 regression guard.

Phases 1–4 **PASS**. Phase 5 surfaces the 10 real failures (Finding F-1/F-2). Phase 6 confirms BUG-001's primary fix works AND catches the §9.8.9 regression (Finding F-1).

---

## Bug Tracker

### F-1. (Major) BUG-001 fix regressed the explicit `--prd` INVOCATION_CWD semantic (PRD §9.8.9)
**Severity:** Major (spec violation + 1 failing acceptance test)
**Status:** Open — **introduced by the BUG-001 fix**

**Evidence (`./validate.sh` Phase 6, check 6d):**
```
$ cd <repo>/src/deep/nested && hack --dry-run --prd ./PRD.md
INFO:   PRD: /tmp/validate-e2e-XXXX/reg/PRD.md        ← ROOT PRD (WRONG)
```
PRD §9.8.9 requires an **explicit** `--prd` to resolve against INVOCATION_CWD (the dir the user typed the command in), not the repo root. The user explicitly pointed at `./PRD.md` from a subdir, so the *subdir* PRD should be used. It now resolves against the repo root.

**Root cause:** The BUG-001 fix moved `process.chdir(repoRoot)` from `main()` (after `parseCLIArgs`) into a `program.hook('preAction', …)` that runs **during** `program.parse()` (`src/cli/index.ts:852` → `bootstrapRepoRoot` at `src/utils/repo-root.ts:203`). The explicit-`--prd` resolution runs **after** `program.parse()` returns:
```ts
// src/cli/index.ts:966-971  — STALE COMMENT
// PRD §9.8.3: an EXPLICIT --prd resolves against INVOCATION_CWD ... process.cwd() here ===
// INVOCATION_CWD (S1's chdir runs AFTER parseCLIArgs returns), so resolve() now is
// INVOCATION_CWD-relative.
if (program.getOptionValueSource('prd') === 'cli') {
  options.prd = resolve(options.prd);   // ← process.cwd() is now repoRoot, NOT INVOCATION_CWD
}
```
The comment's premise ("S1's chdir runs AFTER parseCLIArgs returns") is **false** after the BUG-001 fix — the preAction hook already chdir'd. So `resolve(options.prd)` is repo-root-relative.

**Fix direction (for the implementing agent — I did not modify code):** resolve against the captured invocation cwd, e.g. `options.prd = resolve(getInvocationCwd(), options.prd);` (`getInvocationCwd` already exists in `src/utils/repo-root.ts`). Re-run `tests/integration/cli/repo-root-semantics.test.ts` (criterion "pre-resolves an explicit relative --prd against INVOCATION_CWD").

**Acceptance test that catches it:** `tests/integration/cli/repo-root-semantics.test.ts` → "pre-resolves an explicit relative --prd against INVOCATION_CWD (absolute)" — currently **FAILING**.

---

### F-2. (Major) BUG-001 fix broke 9 tests in `cli-task-status.test.ts` (red test suite)
**Severity:** Major (test-suite regression — the suite no longer passes cleanly)
**Status:** Open — **introduced by the BUG-001 fix**

**Evidence (`./validate.sh` Phase 5):** 9 of 9 tests in `tests/integration/cli-task-status.test.ts` fail with:
```
NotARepositoryError: No .git entry found at or above "/tmp/hack-cli-XXXX".
  ❯ traverseUp src/utils/repo-root.ts:244
```

**Root cause:** These tests drive `parseCLIArgs()` **in-process** against `mkdtemp()` tmpdirs that are **not git repos** (`process.chdir(cwd)` into a plain temp dir). Before the BUG-001 fix, `hack task`/`hack status` resolved `plan/` against `process.cwd()` and ran. After the fix, the `preAction` hook fires `bootstrapRepoRoot()` → `traverseUp()` finds no `.git` → throws `NotARepositoryError` **before** the action handler runs.

**Important nuance:** Per PRD §9.8.5 the *new* behavior is arguably correct ("any operational invocation of hack from outside any git repository exits 1 with a single actionable 'not a git repository' message"). So this is an **outdated-test / behavior-contract change**, not a code defect — but it leaves the integration suite **red**, which masks future regressions and blocks CI. The tests must be updated to either `git init` their tmpdirs or assert the new §9.8.5 contract.

The 9 affected tests cover §5.3 discovery (bugfix vs main) and §5.4 color-coding, all currently unverified.

---

### F-3. (Minor / cosmetic) `hack config validate` doubles the file path in the relational-constraint error
**Severity:** Minor (cosmetic, no functional impact)
**Status:** Open — surfaced by the BUG-003 fix

**Evidence (`./validate.sh` Phase 6, check 6h):**
```
$ hack config validate   # with [commit] retry_delay_cap_ms=100, retry_delay_ms=200000
/tmp/val-rel-XXXX/.hack: [commit] retry_delay_cap_ms in /tmp/val-rel-XXXX/.hack: 100 is less than retry_delay_ms (200000); the cap must be ≥ the base delay.
```
The `config validate` command prepends `<file>: ` to the thrown message, but `HackConfigError`'s message **already** contains `in <file>`, so the path appears twice. The startup path (`--dry-run`) renders cleanly (single `❌` line). Not a functional defect — purely a redundant-prefix polish item in the `config validate` output path.

---

### F-4. (Minor / pre-existing) Two tests are env-fragile: shell `RESEARCH_DEPTH` makes them fail
**Severity:** Minor (test robustness, not a code bug)
**Status:** Pre-existing, unrelated to the PRD fixes

**Evidence:** `tests/unit/cli/commands/config.test.ts` ("preserves scalar type fidelity in JSON output") and `tests/integration/core/task-orchestrator-runtime.test.ts` ("should enqueue subtasks") **fail when the shell exports `RESEARCH_DEPTH=2`**, and **pass when it is unset** (`env -u RESEARCH_DEPTH …`).

**Root cause:** Both tests read a `.hack` value that maps to the `RESEARCH_DEPTH` env var. The dev shell exports `RESEARCH_DEPTH=2`. The code correctly applies **env-over-file** (PRD §9.2.1: real env wins over file), so the file override is ignored — the tests assume a clean env they never establish. This is a **test-isolation gap**, not a code defect; the pipeline behavior is spec-correct. `./validate.sh` Phase 5 unsets these vars to get a reproducible result.

---

## Verified Working (positive results)

These passed empirically via `./validate.sh` Phase 6 (real subprocess) and corroborate the dedicated integration suites:

- ✅ **BUG-001 primary fix:** all 7 subcommands (`task`, `status`, `inspect`, `artifacts`, `cache`, `validate-state`, `config`) resolve `plan/`/`PRD.md` at the **repo root** when launched from a deeply nested subdir (`src/deep/nested`). No "No sessions found" / subdir-path leakage.
- ✅ **§9.8.5 clean hard error:** `task`/`status`/`validate-state` outside any git repo exit 1 with a single `❌ No .git entry found at or above "<dir>". Run inside a git repository, or pass --repo-root <path>.` line — **no stack trace**, names the invocation dir and the `--repo-root` remediation.
- ✅ **§5.3 breakdown-in-progress calm notice from a subdir:** a session dir with no `tasks.json` prints `[hack] Session <id>: tasks.json is generated during PRD breakdown …` and exits 0 — the synergy case BUG-001 called out.
- ✅ **`--repo-root` semantics:** valid override resolves from outside the repo (exit 0); invalid path → clean `❌ --repo-root path "<p>" does not contain a .git entry.` (exit 1, no stack).
- ✅ **`--help` outside any repo:** exit 0 (Commander short-circuits before the resolver runs).
- ✅ **BUG-002 fixed:** `.hack` range errors (`poll_ms = -5`), secrets errors (`[auth] zai_api_key = "…"`), and (per unit tests) BOM/parse errors all render as a single `❌ <message>` line via the dedicated `HackConfigError` arm (`src/index.ts:414`), with **no stack trace** and **no secret value echoed**.
- ✅ **BUG-003 fixed:** `[commit] retry_delay_cap_ms` < `retry_delay_ms` is rejected (exit 1) at startup and via `config validate`; `cap >= delay` is accepted (exit 0). Cross-key check lives in `validateHackTier` (`src/config/hack-config.ts:810`).
- ✅ **Lint / typecheck / prettier / build:** all pass (lint has 7 `no-explicit-any` **warnings**, 0 errors).

---

## Test-Phase Breakdown (Phase 5, env-cleaned)

- **Total:** 210 files / 7037 tests
- **Passing:** 207 files / 6956 tests
- **Failing:** 2 files / 10 tests — **all 10 are the BUG-001 regressions** (F-1: 1 test; F-2: 9 tests)
- **Skipped:** 71 (pre-existing)

The two env-fragile tests from F-4 **pass** under the env-cleaned run, confirming they are unrelated to the PRD fixes.

---

## Recommendations (for the implementing agent)

1. **F-1 (blocking):** Resolve an explicit `--prd` against `getInvocationCwd()`, not `process.cwd()`, at `src/cli/index.ts:971`. Update the now-stale comment at line 966. Re-run `tests/integration/cli/repo-root-semantics.test.ts`.
2. **F-2 (blocking):** Update `tests/integration/cli-task-status.test.ts` to `git init` its tmpdirs (mirroring the `makeRepo()` helper in `repo-root-acceptance.test.ts` / `subcommand-repo-root.test.ts`), or re-assert the §5.3/§5.4 behavior under a real repo. The 9 tests currently provide zero coverage.
3. **F-3 (nice-to-have):** In the `config validate` output path, avoid prepending `<file>:` to messages that already embed the file (or strip the duplicate). Single-line polish.
4. **F-4 (nice-to-have):** Have the two env-fragile tests unset `RESEARCH_DEPTH`/`RESEARCH_QUEUE_CONCURRENCY` in `beforeEach` so the suite is reproducible in any shell.
5. **Process:** Add the `./validate.sh` Phase-6 pattern (subcommand-from-subdir + explicit-`--prd`-from-subdir subprocess assertions) as a permanent integration suite so this class of action-handler-timing regression cannot recur. The existing `subcommand-repo-root.test.ts` covers the subcommand half; the `--prd` half (`repo-root-semantics.test.ts`) is the one that regressed.

---

## Files Inspected

- `src/cli/index.ts` — CLI parser, subcommand action handlers, `preAction` hook (BUG-001), `--prd` resolution (F-1)
- `src/utils/repo-root.ts` — `bootstrapRepoRoot`, `resolveRepositoryRoot`, `NotARepositoryError`, `getInvocationCwd`
- `src/index.ts` — `main()` + `main().catch()` clean arms (BUG-002)
- `src/config/hack-config.ts` — `validateHackTier`, `validateFieldValue`, relational check (BUG-003)
- `src/config/types.ts` — `HackConfigError` class
- `src/cli/commands/{inspect,validate-state,artifacts,cache,config}.ts` — `resolve('plan')`/`resolve('PRD.md')` defaults
- `tests/integration/{repo-root-acceptance,cli/subcommand-repo-root,cli/repo-root-semantics,config-error-rendering,cli-task-status}.test.ts`, `tests/unit/cli/commands/config.test.ts`, `tests/unit/config/hack-config.test.ts`