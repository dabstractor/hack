# Validation Report — hacky-hack PRP Pipeline

**Date:** 2025-08-05
**Validator:** Automated validation agent (read-only; no pipeline/agent invocations)
**Scope:** Current delta — PRD §9.8 (Repository Root Resolution), §9.7 (`.hack` Config File), §5.3 (Breakdown-in-Progress Window), plus full toolchain health.
**Method:** `./validate.sh` (lint, typecheck, format, build, tests) + isolated E2E CLI scenarios in temp git repos using **only safe subcommands** (`--help`, `--version`, `config *`, `status`, `task`, `--dry-run`) — the pipeline itself was **never executed**, per project constraints.

---

## Executive Summary

The codebase is in strong shape. The toolchain is green (lint, typecheck, format, build, and the **6,920-test suite all pass**). The three features in this delta are overwhelmingly correct and well-tested at the unit/integration boundary.

**One significant functional gap** was found through E2E testing: **CLI-only `.hack` keys are non-functional** — the headline §9.7.10 acceptance criterion (`[cli] mode = "bug-hunt"` applied by a bare `hack` run) does **not** hold, because the CLI layer never consumes the merged config. The existing test suite passes because it stops at the config-load boundary (it asserts `merged.cli?.mode === 'bug-hunt'` but never that the value reaches `args.mode`).

A handful of lower-severity items round out the findings (dead config knobs, JSON type fidelity, a spec tension).

| # | Severity | Area | Summary |
|---|----------|------|---------|
| 1 | **High** | §9.7 / §9.7.10 | CLI-only `.hack` keys (`[cli] mode`, `[concurrency] parallelism`, `[monitor] *`, `[cli] scope/max_tasks/…`) have no consumer — setting them does nothing. Violates the headline acceptance criterion. |
| 2 | Low | §9.7.5 | Two `.hack` knobs (`[bug_hunt] fix_scope`, `[api] timeout_ms`) are seeded into `process.env` but never read by the runtime — silent no-ops. |
| 3 | Low | §9.7.8 | `config show -o json` emits every `value` as a **string** (`"false"`, `"2"`), losing boolean/int type fidelity for machine consumers. |
| 4 | Info | §9.7.3 vs §9.7.6 | Spec tension: §9.7.3 says the global `~/.hack` is "treated like `.hack.local`" (secrets allowed), but the implementation refuses secrets there (strict reading of §9.7.6 "`.hack.local` is the ONLY tier"). Defensible, but documents a contradiction. |
| 5 | Info | Docs | README/docs already claim `[cli] mode` works from `.hack` (README:357, CONFIGURATION.md:68/103) — the docs precede the implementation completing. |

---

## What Works (verified by E2E)

All of the following were exercised end-to-end in isolated temp git repos and **pass**:

### §9.8 Repository Root Resolution (Phase 1 — Complete)
- ✅ `hack --help` / `--version` / `-h` return in **~0.6s** (well under the §9.6.3 2s target; no worker-thread teardown stall).
- ✅ `--help`/`--version` work **outside** any git repo (exit 0) — they short-circuit during `parseCLIArgs()` before traversal.
- ✅ Operational commands (`config`, `--dry-run`) outside a git repo hard-error with the actionable `❌ No .git entry found …` message + `--repo-root` remediation, **before** any session/agent/`.env` work (§9.8.5).
- ✅ Run-from-anywhere: `config path` from `src/deep/nested/` resolves to the repo root.
- ✅ **Worktree `.git` file** correctly detected — root resolves to the worktree root, not the common dir (§9.8.4).
- ✅ `--repo-root <abs>` pins the root and skips the search; a non-`.git` path hard-errors (§9.8.6).
- ✅ **Explicit-vs-default `--prd` semantics** (§9.8.3): `--prd ../../../PRD.md` from a subdir resolves against `INVOCATION_CWD`; omitted `--prd` resolves to `<repoRoot>/PRD.md`.

### §9.7 `.hack` Configuration File (Phase 2 — mostly Complete)
- ✅ **Env-over-file rule** (§9.2.1/§9.7.10): `PARALLEL_RESEARCH=false` env beats `[pipeline] parallel_research = true` in `.hack`; without the env var, the file value wins (`source: project`).
- ✅ **Seeding flows to runtime**: `[pipeline] research_depth = 7` in `.hack` reaches `getResearchDepth()` → `7` (verified the env-backed mechanism is sound for all 28 env-linked keys).
- ✅ **Secrets policy** (§9.7.6): a secret in committable `.hack` is a hard error (exit 1, actionable message); the same key in `.hack.local` is allowed.
- ✅ **Type/range/enum validation** (§9.7.7): out-of-range int (`poll_ms = -5`) and bad enum (`name = "foo"`) hard-error; unknown section/key **warn** and exit 0 (lenient, forward-compatible).
- ✅ **BOM rejection** (§9.7.4): UTF-8 BOM rejected with a clear message.
- ✅ `config init` writes a commented template, **refuses clobber** without `--force`, adds `.hack.local` to `.gitignore`, and `--force` overwrites.
- ✅ `config show` **never echoes secret values**; `config show --src` attributes the winning layer (`env`/`project`/`default`/…).
- ✅ `config validate` **warns** when `.hack.local` is git-tracked (potential leak), pointing at `git rm --cached`.
- ✅ `override_key` in `.hack.local` correctly seeds `process.env.PRP_API_KEY` (§9.2.6 layer-1 override), and the `--log-level debug` trace **masks** it as `<redacted>`.

### §5.3 Breakdown-in-Progress (Phase 3 — Complete)
- ✅ `hack status` against a session dir **without** `tasks.json` emits the calm notice to **stderr** and exits **0** — no `ENOENT`, no `ERROR`, no stack trace.
- ✅ `--output json` emits `{ "status": "awaiting_breakdown", "session": "…" }` to stdout, exit 0.
- ✅ `hack task next` shows the breakdown-in-progress notice.
- ✅ **Explicit `--file <missing>` remains a hard error** (scope rule — discovery-only softening).
- ✅ **No sessions at all** remains a hard error — the two empty states are correctly distinguished.

### Toolchain
- ✅ `eslint` — 0 errors (7 pre-existing `any` warnings).
- ✅ `tsc --noEmit` (strict) — clean.
- ✅ `prettier --check` — clean.
- ✅ `tsc -p tsconfig.build.json` build — clean.
- ✅ `vitest run` — **6,920 passed, 71 skipped, 0 failed** (207 files).

---

## Bug Tracker

### 🔴 FINDING 1 (High) — CLI-only `.hack` keys are non-functional

**PRD ref:** §9.7.5, §9.7.10, §9.2.1; task `P2.M2.T1.S1`.
**Reproduction:**
```bash
# In any git repo with a PRD.md:
printf '[cli]\nmode = "bug-hunt"\n' > .hack
hack --dry-run        # → "Mode: normal"   (expected: bug-hunt)
```
**Observed:** dry-run reports `Mode: normal` even though the `--log-level debug` trace confirms `[hack] cli.mode = "bug-hunt"  (source: project)` was loaded.
**Expected (§9.7.10):** "A user can place a committable `<repoRoot>/.hack` setting `[cli] mode = "bug-hunt"` … then run bare `hack` … and observe all three applied."

**Root cause:**
1. The 28 *env-linked* schema keys seed `process.env` and flow through to runtime getters (verified working — e.g. `research_depth`).
2. The 10 *CLI-only* keys have **no `envVar`** (by design — they back Commander flags):
   `concurrency.parallelism`, `monitor.interval_ms`, `monitor.enabled`, `cli.mode`, `cli.scope`, `cli.machine_readable`, `cli.continue_on_error`, `cli.cache_enabled`, `cli.max_tasks`, `cli.max_duration_ms`.
3. `parseCLIArgs()` registers `--mode` with a hardcoded `.default('normal')` and runs **before** `loadHackConfig()` (bootstrap order: `parseCLIArgs → chdir → loadHackConfig`). It never reads `MergedHackConfig`.
4. `main()` calls `loadHackConfig(repoRoot)` (src/index.ts:165) but **discards the return value** — the CLI-only keys loaded into the merged config are never applied to `args`.

The task contract (`P2.M2.T1.S1`) explicitly anticipated this: *"for non-env-linked flags, the CLI layer must read the MergedHackConfig."* That wiring was not implemented.

**Why the test suite didn't catch it:** `tests/integration/config/hack-config-acceptance.test.ts:140` asserts `merged.cli?.mode === 'bug-hunt'` (the value *is* loaded) but never asserts that the *pipeline's resolved* `args.mode === 'bug-hunt'`. The unit test at `hack-config.test.ts:552-568` even explicitly asserts `[cli] mode` seeds **no** env var (the root of the gap) — so the boundary is tested, the end-to-end consumption is not.

**Impact:** ~¼ of the advertised `.hack` tunables silently do nothing. Users setting `[cli] mode = "bug-hunt"`, `[concurrency] parallelism = 4`, `[monitor] enabled = false`, `[cli] max_tasks = 20`, etc. in `.hack` will see no effect and no warning.

**Suggested fix direction (for the implementing agent — not applied here):** One of:
- (a) Load `.hack` once *before* `parseCLIArgs()` (after the §9.8 chdir) and seed the CLI-only keys into Commander `.default(process.env.X ?? …)` via a side-channel env var; **or**
- (b) After `loadHackConfig()` in `main()`, re-apply the CLI-only merged keys onto `args` for any flag the user did **not** explicitly pass (use Commander's `getOptionValueSource('mode') === 'default'` to detect "not explicitly set"); **or**
- (c) Re-order: parse once to discover `--repo-root`, chdir, load `.hack`, then have `parseCLIArgs` consume the merged config for CLI-only defaults.
Any fix needs an end-to-end acceptance test asserting the resolved `args.mode` (not just `merged.cli.mode`).

---

### 🟡 FINDING 2 (Low) — Two `.hack` knobs are seeded but never read

**PRD ref:** §9.7.5 schema rows `[bug_hunt] fix_scope` / `[api] timeout_ms`.
**Reproduction / evidence:**
```bash
# BUGFIX_SCOPE and API_TIMEOUT_MS are seeded into process.env by loadHackConfig...
$ rg -c "BUGFIX_SCOPE|API_TIMEOUT_MS" src/   # → 0 consumers outside hack-config.ts
```
**Observed:** Both `BUGFIX_SCOPE` (default `subtask`) and `API_TIMEOUT_MS` (default `60000`) are written to `process.env` by the loader but **no runtime code reads them** (0 `process.env` reads anywhere in `src/`). The task research note (`P2.M2.T1.S1`) explicitly flagged `API_TIMEOUT_MS` as "NOT currently defined anywhere," yet it remains in `SCHEMA_MAP` with a default, implying it works.
**Impact:** Setting `[bug_hunt] fix_scope = "task"` or `[api] timeout_ms = 120000` in `.hack` is a silent no-op. Low impact (obscure knobs), but it is advertised config that misleads.
**Suggested fix:** Either wire the getters, or drop the rows from `SCHEMA_MAP`/docs until a consumer exists (avoid advertising non-functional knobs).

---

### 🟡 FINDING 3 (Low) — `config show -o json` loses scalar type fidelity

**PRD ref:** §9.7.8 (`show` is machine-readable output).
**Reproduction:**
```bash
hack config show -o json | grep -A1 parallel_research
# {"key": "pipeline.parallel_research", "value": "false"}   ← string, not boolean
# {"key": "pipeline.research_depth",     "value": "2"}       ← string, not number
```
**Root cause:** `ConfigCommand.displayValue()` always returns `String(value)`, and `#showAction` funnels every row through it even for JSON output. So booleans render as `"false"`/`"true"` and ints as `"2"`/`"1800"` — indistinguishable from string-valued knobs in the JSON.
**Impact:** Scripts/jq consumers cannot tell a boolean from a string-valued enum. Cosmetic for humans; a fidelity issue for machine consumers (which is the stated purpose of `-o json`).
**Suggested fix:** In the JSON branch, emit the raw typed value (`boolean|number|string`) instead of `displayValue()`; keep `displayValue()` for the table branch.

---

### 🔵 FINDING 4 (Info) — Spec tension: global-tier secrets handling

**PRD ref:** §9.7.3 (table) vs §9.7.6.
**Observation:** §9.7.3's discovery table states the global `~/.hack` is *"Secrets allowed? Discouraged (lives in `$HOME`); if present, treated like `.hack.local`."* But §9.7.6 says *".hack.local (gitignored) is the ONLY file tier permitted to hold secrets."* The implementation (`validateHackTier`) refuses secrets whenever `tier !== 'project-local'`, so a secret in `~/.hack` is a **hard error** — contradicting §9.7.3's "treated like `.hack.local`".
**Assessment:** The stricter reading (refuse everywhere except `.hack.local`) is the safer default and arguably what §9.7.6's emphatic "ONLY" intends. This is a **spec contradiction**, not a code bug. Flagging for the PRD owner to reconcile (likely amend §9.7.3's table, or relax the global tier to mirror `.hack.local`).

---

### 🔵 FINDING 5 (Info) — Docs claim the unimplemented `[cli] mode` behavior

**Observation:** `README.md:357` advertises that `.hack` captures *"`[cli]` defaults for flags like `--mode`"*, and `docs/CONFIGURATION.md:68/103` states each key *"maps to an env var and/or a CLI flag it seeds as a default"* including `[cli] mode`. The code does not yet deliver this (see Finding 1). Phase 4 (changeset-level doc sync) is still `Ready`, so the docs are ahead of the implementation; once Finding 1 is fixed the docs become accurate. No action needed beyond resolving Finding 1.

---

## Minor observations (no action required)

- `config show` calls `loadHackConfig()`, which **mutates `process.env`** as a side effect of a nominally read-only command. This is acknowledged in a code comment and is harmless (the process exits immediately after), but a `--no-seed`/pure-inspect mode would be cleaner for `show`.
- `_resetValidationWarnings()` is module-global state; the one-time warning dedup is correct for a single process run, and the reset hook is test-only. Fine as-is.
- Lint emits 7 `@typescript-eslint/no-explicit-any` warnings (6 in `src/`, all pre-existing in `cli/index.ts` task-list parsing and `logger.ts`). Non-blocking (`any` is `warn`, not `error`).

---

## Validation Artifacts

- **`./validate.sh`** — executable validation script (lint → typecheck → format → build → tests → 15 E2E scenario groups). Run `./validate.sh` (full) or `./validate.sh --skip-tests` (fast). Exits non-zero on any failure; collects all failures before exiting.
- **Exit status:** `1` (one E2E scenario — Finding 1 — fails by design; all toolchain phases pass).

## Residual risks / not covered

- **The pipeline itself was not executed** (project constraint forbids running it in-tree, and doing so would invoke LLM agents / create `plan/` sessions). Therefore the agent-runtime, harness, auth-preflight-against-a-real-API, Smart Commit, and full task-execution paths were validated only via the existing unit/integration suite (all green), not by a live run.
- Delta/bug-fix sub-pipeline behaviors (§4.3/§4.4) were not exercised live; covered by integration tests only.