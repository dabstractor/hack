# Validation Report — PRP Development Pipeline (hacky-hack)

**Generated:** comprehensive static + dynamic validation
**Scope:** full codebase vs. PRD requirements; safe E2E CLI workflows only (the live agent pipeline was NOT invoked — per `AGENTS.md`, running it here would corrupt the in-progress dogfooding session).

---

## 1. Executive Summary

The codebase is in strong shape. Every PRD-mandated subsystem I verified is implemented and wired correctly: the distributed-PRD include resolver (§2.3), provider-neutral config + deprecation fallback (§9.2.8), three model roles with `xhigh` reasoning budgets (§9.2.3), the fail-fast auth preflight honoring file-backed `auth.json` (§9.2.6/§9.2.7), the z.ai endpoint guard (§9.2.4), `flock`-guarded `tasks.json` + `restore_critical_files` + `NO_ISSUES_FOUND` (§5.1/§4.4), the two-phase `stagecoach` commit (§4.2.4), and the lazy-logger / no-transport logging architecture (§9.6 — `--help` runs in ~0.6 s).

**Type-check, lint, format, build, groundswell validation, and docs-check all pass.** All 6 772 unit/integration/e2e tests pass when run in their normal groups.

**However, two HIGH-severity issues block a green "100 % confidence" run:**

1. **The canonical `npm run test:run` exits 1** — a benchmark test forces the macOS `lsof` code path on Linux, OOM-killing a worker (§3, Issue #1).
2. **Bugfix task discovery is broken** — a stray duplicate-sequence directory defeats `findLatestBugfixTasksFile`, so `prd task`/`prd task next`/`prd status` hide an in-progress bugfix session in plain sight, violating §5.3 (§3, Issue #2).

| Phase                                                  | Result                                                |
| ------------------------------------------------------ | ----------------------------------------------------- |
| Type checking (`tsc --noEmit`, strict)                 | ✅ PASS                                               |
| Lint (`eslint`)                                        | ✅ PASS (6 `any` warnings, 0 errors)                  |
| Format (`prettier --check`)                            | ✅ PASS                                               |
| Build (`tsc -p tsconfig.build.json`)                   | ✅ PASS (`dist/index.js` executable)                  |
| Groundswell validation (incl. file-backed `auth.json`) | ✅ PASS                                               |
| Docs structural check                                  | ✅ PASS (1 capitalization warning)                    |
| Logging architecture §9.6 REQ-L1/REQ-L2                | ✅ PASS (no module-scope loggers, no pino transports) |
| CLI performance §9.6.3 (`--help` < 2 s)                | ✅ PASS (~0.6 s)                                      |
| E2E CLI workflows (all safe subcommands)               | ✅ PASS (22/22 checks)                                |
| Project config-completeness sweep                      | ✅ PASS (16/16 knobs present)                         |
| **Test suite — full `npm run test:run`**               | ❌ **FAIL — exit 1 (OOM)**                            |
| Test suite — grouped (unit/integration/e2e)            | ✅ PASS (6 772 tests)                                 |

---

## 2. What was validated (method)

- **Static:** `tsc`, `eslint`, `prettier`, `tsc` emit, targeted `rg` audits of every PRD-mandated constant/flag/primitive, logging-architecture invariants.
- **Dynamic (safe CLI only):** `--help`, `-h`, `--version`, invalid flag, `--dry-run`, `--validate-prd`, and every subcommand (`inspect`, `validate-state`, `task`, `task next`, `task status`, `status` alias, `cache stats`, `artifacts list`). The live pipeline (`npm run dev`, agent runs, session creation) was deliberately **not** invoked.
- **Tests:** vitest full run + per-group runs to isolate failures.
- **Dogfooding state inspected (read-only):** `plan/008_15504f60a0ef` sessions and `bugfix/` children.

---

## 3. Issues Found

### 🔴 Issue #1 — `npm run test:run` exits 1: benchmark test OOM-kills the worker _(HIGH)_

**Symptom.** The canonical test command fails:

```
$ npm run test:run   # → exit 1
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
Error: Worker exited unexpectedly
 Test Files  199 passed | 1 skipped (201)
      Tests  6772 passed | 71 skipped (6851)
     Errors  1 error
```

All 6 772 actual tests pass, but **one test file is lost to a worker crash** and vitest returns exit 1. This is deterministic (reproduced twice).

**Root cause.** `tests/benchmark/resource-monitoring.bench.test.ts` mocks `process.platform = 'darwin'` and benchmarks `ResourceMonitor` with **`cacheTtl: 0` (uncached)** inside a `tinybench` loop (`time: 2000`). The darwin path of `FileHandleMonitor.getHandleCount()` calls `execSync('lsof …')` on **every iteration** (`src/utils/resource-monitor.ts:241-258`). `lsof` exists on this Linux host, so tinybench spawns it synchronously as fast as possible for seconds. Run in isolation the benchmark hangs beyond a 90 s timeout; run inside the forks pool it pushes a worker over its `memoryLimit: 4096` (MB) and is OOM-killed.

The vitest `include` (`tests/**/*.{test,spec}.ts`) picks the file up because it ends in `.bench.test.ts`; nothing excludes or platform-guards it.

**Impact.** Red CI on any non-macOS runner. The grouped runs (`tests/unit`, `tests/integration`, `tests/e2e`, or `tests/unit tests/integration tests/e2e`) pass cleanly precisely because they exclude the benchmark.

**Fix direction (any one).**

- Platform-guard: ` (process.platform !== 'darwin' ? it.skip : it)(...)` for the lsof-spawning benchmarks.
- Mock `execSync` rather than spawning a real `lsof`.
- Exclude `**/*.bench.test.ts` from the default `test.include` (move benchmarks to a separate `npm run bench` script), or raise `poolOptions.forks.memoryLimit`.

---

### 🔴 Issue #2 — Bugfix task discovery defeated by a duplicate-sequence directory (PRD §5.3 violation) _(HIGH)_

**Symptom.** An in-progress bugfix session has unfinished work, but the documented commands hide it:

```
$ node dist/index.js task next
[hack] Using main tasks: 008_15504f60a0ef/tasks.json
No tasks remaining.
```

Yet `plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/tasks.json` contains **non-complete** items: `P1.M4.T4.S1` (**Failed**) and `P1.M5.T1.S1` (**Ready**). Per PRD §5.3 these must be discovered _before_ the main session.

**Root cause.** `findLatestBugfixTasksFile` (`src/core/session-utils.ts:916`) picks the highest-sequence `NNN_*` child and returns its `tasks.json` — **but only if that one child has it**. A stray empty dir shares sequence `002`:

```
bugfix/001_9a4fd2467e1a/      (real)
bugfix/002_86589b7d2/          ← STRAY: 9-hex-char truncated hash, only architecture/*.md, NO tasks.json
bugfix/002_86589b7d57d2/       ← REAL:  12-hex-char hash, full tasks.json with Failed/Ready items
```

Both match `BUGFIX_DIR_PATTERN = /^(\d{3})_/`; `sort((a,b)=>b.seq-a.seq)` leaves them in readdir (alphabetical) order, so `[0]` selects the stray `002_86589b7d2`, finds no `tasks.json`, and **returns `null`** instead of checking its sequence-equal sibling. Verified directly:

```
findLatestBugfixTasksFile('plan/008_15504f60a0ef')  =>  null
```

The CLI then falls through to the main session and reports "No tasks remaining."

The existing unit test (`tests/unit/core/find-latest-bugfix-tasks.test.ts`) **explicitly codifies the fragile behavior** ("falls back to null when the latest child has no tasks.json") and has **no case for duplicate-sequence siblings**, so this regression is unguarded.

**Impact.** Direct §5.3 violation. Users cannot see or resume bugfix work through `prd task` / `prd task next` / `prd status`; the in-progress bugfix is invisible.

**Fix direction.** When the max-sequence child lacks `tasks.json`, fall back to the **next** sequence-equal sibling that has one (iterate the sorted list rather than taking only `[0]`); or tie-break equal sequences deterministically (full dir name) and only give up when _no_ child has `tasks.json`. Add a regression test for two same-`NNN` dirs.

---

### 🟡 Issue #3 — `prd task next` ignores `Ready` / `Failed` items _(MEDIUM)_

**Symptom.** Pointing `task next` directly at the real bugfix file still yields "No tasks remaining":

```
$ node dist/index.js task next -f plan/008_.../bugfix/002_86589b7d57d2/tasks.json
No tasks remaining.
```

**Root cause.** `findNext` in the `taskAction` handler (`src/cli/index.ts`) matches **only** `status === 'Planned'`. The bugfix's next items are `Ready` (research-complete, ready to implement) and `Failed` (retry-eligible), which are invisible to the command.

This mirrors the orchestrator's fresh-pick logic, so it is internally consistent — but for a _user_ inspecting an in-progress session, "next task" silently reporting nothing while `Ready`/`Failed` work exists is misleading. A practical `task next` should surface `Ready` (and arguably `Failed`) items.

**Fix direction.** Treat `Ready` (and optionally `Failed`) as "next" in the CLI `findNext`, or add a `--include-ready/--include-failed` option and document the default.

---

### 🟡 Issue #4 — Stray / truncated-hash bugfix directory (upstream of Issue #2) _(MEDIUM)_

`bugfix/002_86589b7d2` (9 hex chars, no `tasks.json`) co-exists with the real `bugfix/002_86589b7d57d2` (12 hex chars). `nextBugfixDir` (`src/core/session-utils.ts:847`) computes `sequence = Math.max(existing)+1` with **no guard against hash collisions or sequence reuse**, so two children can land on the same `NNN`. This is the upstream condition that triggers Issue #2's discovery failure.

**Fix direction.** Either reject/repair a sequence collision in `nextBugfixDir`, or make the hash derivation stable enough that the same seed cannot produce two different truncated lengths. (The stray dir's committed `architecture/*.md` files suggest an earlier interrupted run left it behind; a cleanup pass + the discovery fix in Issue #2 together close the hole.)

---

### 🟢 Issue #5 — Binary / program / docs command-name mismatch _(LOW)_

- `package.json` `bin` → **`hack`**
- CLI `program.name('prp-pipeline')` → usage prints **`prp-pipeline`**
- README.md, PRD §5.3, and docs reference the command as **`prd`** (e.g. `prd task`, `prd status`)

Users following the README would type `prd …`, which is neither the installed binary nor the program name. Pick one canonical CLI name and align `bin`, `program.name()`, and the docs.

---

### 🟢 Issue #6 — Docs capitalization warnings _(LOW)_

`npm run docs:check` reports (non-blocking): `typescript`→`TypeScript` and `github`→`GitHub` in `docs/ARCHITECTURE.md` (×3), `docs/CONFIGURATION.md` (×1), `docs/CUSTOM_AGENTS.md` (×4).

---

### 🟢 Issue #7 — Test file references a non-existent symbol in its label/JSDoc _(LOW)_

`tests/unit/core/find-latest-bugfix-tasks.test.ts` documents and `describe`s a function named **`ln`** ("Unit tests for ln", `describe('ln (PRD §5.3)')`), but no such export exists — the actual import is `findLatestBugfixTasksFile`. Cosmetic only; the import and assertions are correct.

---

### 🟢 Issue #8 — Stale TODO in source _(LOW)_

`src/agents/prp-executor.ts:470`:

```ts
artifacts: [], // TODO: Extract artifacts from Coder Agent output
```

---

### 🟢 Issue #9 — Active `.env` uses deprecated legacy auth names _(LOW)_

The local `.env` sets `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` (legacy aliases slated for removal, §9.2.8). For the default `zai` path the canonical names are `ZAI_API_KEY` / `PRP_API_BASE_URL`. It happens to work today because `~/.pi/agent/auth.json` resolves the `zai` credential, but the active config is inconsistent with the documented canonical setup. (`.env` is gitignored; this is a local-hygiene note, not a shipped defect.)

---

## 4. PRD-conformance spot checks (all PASS)

| Requirement                                                           | Location                                                           | Status |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| Include resolver + idempotency/markers/depth (§2.3)                   | `src/core/session-utils.ts` `resolvePRD`/`resolveIncludes`         | ✅     |
| Provider-neutral config + legacy fallback + deprecation (§9.2.8)      | `src/config/constants.ts` `MODEL_ENV_VARS`/`LEGACY_MODEL_ENV_VARS` | ✅     |
| Three model roles + `xhigh` reasoning (§9.2.3/§6.1)                   | `src/agents/agent-factory.ts` `ROLE_CONFIG`/`ModelRole`            | ✅     |
| Fail-fast auth preflight, file-backed `auth.json` (§9.2.6/§9.2.7)     | `src/config/harness.ts` `runAuthPreflight`                         | ✅     |
| z.ai endpoint guard blocks `api.anthropic.com` (§9.2.4)               | `src/config/endpoint-guard.ts`                                     | ✅     |
| `flock` tasks.json mutex + atomic writes (§5.1)                       | `src/core/file-lock.ts` `withLockedTasksJSON`                      | ✅     |
| `restore_critical_files` in smartCommit (§5.1)                        | `src/utils/git-commit.ts:419`                                      | ✅     |
| `NO_ISSUES_FOUND.md` marker (§4.4)                                    | `src/workflows/bug-hunt-workflow.ts`                               | ✅     |
| Two-phase `stagecoach` commit (§4.2.4)                                | `src/core/task-orchestrator.ts:1059`                               | ✅     |
| Commit task-prefix format, `PRP_COMMIT_FORMAT` opt-out (§5.1)         | `src/utils/git-commit.ts` `buildTaskPrefix`/`formatCommitMessage`  | ✅     |
| Watchdog kill (exit 124) terminal / not retried (§9.3.2)              | `src/utils/retry.ts` + `BashToolResult.timedOut`                   | ✅     |
| Lazy loggers / no pino transports / fast teardown (§9.6 REQ-L1/L2/L3) | `src/utils/logger.ts` (audited: 0 hits)                            | ✅     |
| `prd status` alias of `prd task` (§5.3)                               | `src/cli/index.ts:724`                                             | ✅     |

**Config-knob sweep (all defaults match PRD):** `RESEARCH_DEPTH=2`, `RESEARCH_TIMEOUT=1800`, `VALIDATION_TIMEOUT=7200`, `COMMIT_RETRY_MAX=5` (delay 10 s, cap 120 s), `BUG_FINDER_AGENT=pizr`, `VALIDATION_AGENT=pizr`, `PRD_INCLUDE_MAX_DEPTH=10`.

---

## 5. Risk assessment & recommendation

- **Ship-blocking:** Issue #1 (red `npm test`) and Issue #2 (silent §5.3 regression) should be fixed before the next run/merge. Both are localized and low-risk to fix.
- **Quality-of-life:** Issues #3 and #4 improve the dogfooding UX and prevent recurrence of the stray-dir class of bug.
- **Cosmetic:** Issues #5–#9 are non-blocking polish.

With Issues #1 and #2 resolved, this codebase passes every gate the project ships plus the full safe-CLI E2E workflow matrix, giving high confidence for production use.

---

_This report was produced by a read-only validation pass. No source, `PRD.md`, `plan/`, or `tasks.json` was modified — only `./validate.sh` and `./validation_report.md` were written._
