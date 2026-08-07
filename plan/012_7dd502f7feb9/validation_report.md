# Validation Report — hacky-hack (PRP Pipeline)

**Validator:** Autonomous validation agent (read-only; no source/`plan/`/`tasks.json` mutated)
**Date:** 2026-08-07
**Repo:** `/home/dustin/projects/hacky-hack` @ clean working tree
**Entry PRD:** `spec/SPEC.md` (distributed, 16 `@include` files) per committed `.hack` `[cli] prd`
**Runner:** Node v26.4.0, npm 11.18.0, git 2.55.0

---

## 1. Executive Summary

The codebase is in strong shape on every **automated quality gate**: lint, type-check,
formatting, and the full unit/integration suite (7 112 tests) all pass cleanly, the
production build succeeds, the distributed-PRD assembly resolves correctly, and the
read-only CLI surface (`--version`, `--help`, `--dry-run`, `--validate-prd`, `status`,
`task`, `inspect`, `validate-state`, `cache`, `config`) behaves exactly as specified —
including the §9.6.3 fast-teardown requirement (`hack --help` returns in **0.60 s**, well
under the 2 s budget).

However, the E2E CLI-workflow suite uncovered **two real defects**, one of them serious:

| # | Severity | Defect | Impact |
|---|----------|--------|--------|
| **BUG-1** | 🔴 **Critical** | `hack update` is the only subcommand missing from `parseCLIArgs()`'s fallthrough-detection list, so **every `hack update` invocation concurrently starts the main PRP pipeline** alongside the update handler. | A latent race condition. The update handler's `process.exit()` usually wins, but the pipeline still reaches `initializeSession()` (which creates session directories). On the project's own terms (AGENTS.md: *"NEVER run this project within this directory… catastrophic meltdown"*) this is the worst possible command to leak into. Confirmed in both `tsx` and the production `dist` build. |
| **BUG-2** | 🟡 Medium | **Documentation drift.** The project migrated its canonical PRD from root `./PRD.md` to a distributed `spec/SPEC.md` (pinned in `.hack`), but `README.md` and `docs/` were never updated. | The **#1 onboarding command** in README §Quick Start (`npm run dev -- --prd ./PRD.md`) **fails** with `PRD file not found`. `npm run docs:check` reports **3 broken markdown links** (`../PRD.md`). 15+ stale `--prd ./PRD.md` examples across README + `docs/`. |

Both defects are **invisible to the existing test suite** (all 7 112 tests pass) because
the tests exercise the update logic and the docs *in isolation*, never driving the real
`argv → main()` entry point nor the documented end-user command sequence.

**Bottom line:** The implementation core is solid and production-grade, but
`hack update` (the most recently shipped user-facing command, per session `012`) ships
with a concurrency defect, and the public-facing docs/onboarding are out of sync with the
spec layout. Neither blocks development, but BUG-1 should be fixed before `hack update`
sees real use, and BUG-2 should be fixed so new users can actually follow the Quick Start.

---

## 2. Methodology & Scope

Validation proceeded in five phases, mirroring the request's structure:

1. **Discover real user workflows** — read `README.md`, `AGENTS.md`, `docs/`, `.hack`,
   `package.json` scripts, and the distributed PRD (`spec/SPEC.md` + 16 includes).
   Identified the CLI as the sole user surface (no HTTP API, no Docker, no external
   service integrations beyond the z.ai LLM provider).
2. **Deep codebase analysis** — 121 source files / 229 test files; mapped the
   `src/index.ts → parseCLIArgs() → main() → PRPPipeline` bootstrap, the `§9.7` `.hack`
   loader, the `§9.8` repo-root traversal, the `§9.2.6/7` provider-aware auth preflight,
   and the `§5.1` `tasks.json` locking/recovery layer.
3. **Generate `validate.sh`** — a single executable harness running the project's *real*
   tooling (`eslint`, `tsc`, `prettier`, `vitest`, `check-docs.ts`) **plus** an E2E CLI
   suite that drives the actual `hack` binary through the documented journeys.
4. **Execute** — ran `validate.sh` end-to-end (vitest phase ~3.5 min).
5. **Manual workflow simulation** — exercised read-only subcommands and `hack update`
   against throwaway `/tmp` fixtures to reproduce findings without touching `plan/`.

**Hard constraints honored (per AGENTS.md & the validator contract):** no source files,
`PRD.md`, `plan/`, `**/tasks.json`, or `.gitignore` were modified. All `hack update`
reproductions used `-f <tmpdir>/tasks.json` under `mktemp`, and the repo working tree
was verified clean before and after every step.

---

## 3. Automated Quality Gates — ✅ ALL PASS

| Gate | Command | Result |
|------|---------|--------|
| **Lint** | `eslint . --ext .ts` | ✅ **0 errors** (6 `no-explicit-any` warnings in `src/cli/index.ts` + `src/utils/logger.ts` — non-blocking) |
| **Type-check** | `tsc --noEmit -p tsconfig.build.json` | ✅ **0 errors** |
| **Format** | `prettier --check "**/*.{ts,js,json,md,yml,yaml}"` | ✅ all files conform |
| **Tests** | `vitest run` | ✅ **214 files / 7 112 passed, 71 skipped** (0 failed), 204 s |
| **Build** | `npm run build` (`tsc -p tsconfig.build.json` + chmod shebang) | ✅ exit 0, `dist/index.js` produced |
| **Coverage floor** | vitest v8 thresholds (statements 89 / branches 90 / functions 94 / lines 89) | ✅ enforced & met |

The 6 lint warnings are all `@typescript-eslint/no-explicit-any` on `any[]` parameters
in the deeply-recursive `hack task`/`status` tree walkers and two `pino` log-bindings
in `logger.ts` — stylistic, not functional.

---

## 4. E2E CLI Workflows — ✅ 17 pass, 🔴 4 fail (2 root causes)

Every read-only / credential-free user journey works correctly and is properly isolated
(never leaks into the main pipeline):

```
[PASS] hack --version (exit 0, '0.1.0')
[PASS] hack --help fast teardown (0.60s < 2s, §9.6.3)
[PASS] hack --no-such-flag rejected (exit 1)
[PASS] hack --dry-run (exit 0, credential-free)
[PASS] dry-run resolves .hack [cli] prd = spec/SPEC.md
[PASS] hack --validate-prd (exit 0, distributed PRD resolves + validates)
[PASS] hack status / task / task next (exit 0, reads latest session)
[PASS] hack config show / validate / path (exit 0, .hack well-formed)
[PASS] hack inspect / validate-state / cache stats isolated (no pipeline start)
[PASS] spec/SPEC.md exists + all 16 @include directives resolve
[PASS] node_modules/groundswell/dist exists
```

The four failures decompose into **two** root causes (BUG-1 and BUG-2 below).

---

## 5. Bug Tracker

### 🔴 BUG-1 (Critical) — `hack update` concurrently starts the main PRP pipeline

**Symptom (reproduced in both `tsx` and `dist`):**

```bash
$ hack update P1.M1.T1.S1 plan -f /tmp/seed/tasks.json
# stdout:
[PRPPipeline] Starting PRP Pipeline workflow     ← the MAIN PIPELINE started!
[PRPPipeline] Initializing session               ← reached session-manager init
Updated P1.M1.T1.S1 status to Planned            ← the update ALSO ran (and won the exit race)
# exit 0
```

The `update` handler succeeds (the file is written, exit 0), but the **main pipeline is
constructed and `run()` is entered at the same time**. This is a genuine race: the update
handler's `process.exit(0)` happens to win on this machine, but the pipeline has already
logged `Starting PRP Pipeline workflow` and `Initializing session` and reached
`PRPPipeline.initializeSession()` (`src/workflows/prp-pipeline.ts:627`), which calls
`this.sessionManager.initialize()` (`:705`) — the call that creates `plan/NNN_<hash>/`
session directories.

**Root cause — a one-line omission in `src/cli/index.ts`:**

`parseCLIArgs()` builds a Commander program with these subcommands (defined via
`.command('X')`):

```
inspect, artifacts, validate-state, cache, config, status, task, update   ← line 1040
```

After `program.parse()`, it inspects `process.argv[0]` and returns a *subcommand
sentinel* (`{ subcommand: 'X', ... }`) so that `main()` in `src/index.ts` **skips**
pipeline construction. The detection branches live at **lines 1094–1158**:

```
1094  inspect      1107  artifacts      1115  validate-state
1123  cache        1135  config         1151  task      1158  status
```

**There is no `args[0] === 'update'` branch.** So when a user runs `hack update …`:

1. `program.parse()` runs the `update` action handler (`src/cli/index.ts:1040`), which
   is `async` and eventually calls `process.exit(0|1)`.
2. `program.parse()` returns.
3. `parseCLIArgs()` finds no match for `'update'`, **falls through** to the default
   path, calls `program.opts<CLIArgs>()`, and returns a full `ValidatedCLIArgs` object.
4. `main()` (`src/index.ts`) receives `ValidatedCLIArgs`, runs `configureHarness()` →
   `runAuthPreflight()` → `ensureHarnessInitialized()`, then at **`src/index.ts:286`**
   constructs `new PRPPipeline(...)` and calls `pipeline.run()`.

Steps 1 and 4 now execute **concurrently** in the same Node process — a classic
"subcommand escape." `hack inspect` / `status` / `config` etc. do **not** exhibit this
(verified: zero `PRPPipeline` log lines) precisely *because* they appear in the detection
list.

**Why CI is green (test-coverage gap):**

`tests/integration/cli-update.test.ts` *does* drive the real parser, but it (a) **mocks
`process.exit`** (`process.exit = exitMock`) and (b) calls **`parseCLIArgs()` directly**,
never `main()`. It then asserts `exitMock` was called with `0` and that the file was
updated. Because `parseCLIArgs()` returns *something* (the `ValidatedCLIArgs` fallthrough)
and the test never reads that return value nor invokes `main()`, the leak is invisible.
The unit suite `tests/unit/cli/update-command.test.ts` tests `matchStatus` /
`findItemByLooseId` / `cascadeCompleteDown` in isolation — also blind to the integration
glue. **There is no test that runs `node dist/index.js update …` (the real entry point)
and asserts the pipeline did not start.**

**Severity rationale:** Critical. On its own merits a subcommand must never spawn the
main workflow (correctness + wasted agent/harness init + confusing interleaved logs).
Compounding it, this repo's `AGENTS.md` explicitly forbids running the pipeline here
(*"catastrophic meltdown"*), and `hack update` is exactly the command that now does so
probabilistically. If a future change makes the update path slower (larger `tasks.json`,
lock contention) or the auth preflight faster, the pipeline could win the race and
materialize a stray `plan/` session.

**Fix direction (for the PRP execution agent — not applied here):** add an `update`
branch to the detection list in `parseCLIArgs()` mirroring the existing seven (return
`{ subcommand: 'update', options: {} }`), and ideally add a parity guard so a future
subcommand can't silently regress. A regression test should spawn the real binary and
assert no `PRPPipeline` log line appears for *every* subcommand.

---

### 🟡 BUG-2 (Medium) — Documentation drift: `./PRD.md` → `spec/SPEC.md` not propagated

**Symptom 1 — the README Quick Start is broken:**

```bash
$ hack --prd ./PRD.md --dry-run
PRD file not found: /home/dustin/projects/hacky-hack/PRD.md
Please provide a valid PRD file path using --prd
# exit 1
```

`PRD.md` **does not exist** at the repo root. The canonical PRD was migrated to a
*distributed* spec assembled from `spec/SPEC.md` + 16 `@include` files, and the committed
`.hack` pins it (`[cli] prd = "spec/SPEC.md"`). A bare `hack` works (it honours the
`.hack` default), but every documented example that passes `--prd ./PRD.md` fails — and
that includes the **very first command** in README §Quick Start:
`npm run dev -- --prd ./PRD.md`.

**Symptom 2 — `npm run docs:check` fails (broken internal links):**

```
❌ Internal Links — Found 3 broken internal link(s)
   docs/INSTALLATION.md:746 - ../PRD.md → PRD.md
   docs/user-guide.md:62    - ../PRD.md → PRD.md
   docs/user-guide.md:1494  - ../PRD.md → PRD.md
```

**Extent of the drift (15+ stale references):**
- `README.md` — lines 98, 101, 202, 205, 214, 217, 220, 223, 232, 252, 270, 281, 344,
  351, 358, … all use `--prd ./PRD.md`.
- `docs/INSTALLATION.md:70,751`, `docs/user-guide.md` (≈20 occurrences) — same.
- The 3 hard markdown links `](../PRD.md)` resolve to a non-existent file.

**Why CI is green:** `npm run validate` is `lint && format:check && typecheck && test:run`
— it does **not** include `docs:check`. The docs gate is a separate script
(`tsx scripts/check-docs.ts`) that is never run by the default validate/CI path, so the
broken links and stale examples escape the main gate. (There is also no
`.github/workflows/` in this checkout — the README CI badge points at a workflow file
that isn't present locally, so it's unclear whether docs are gated upstream at all.)

**Note — the canonical/legacy env-var split is correctly done in `.env.example`** (it
documents `PRP_MODEL_*` / `PRP_API_BASE_URL` as primary and the `ANTHROPIC_*` names only
as commented-out deprecated aliases, exactly per PRD §9.2.8). The drift is confined to
the *PRD path* (`./PRD.md` vs `spec/SPEC.md`) in user-facing prose, not the env config.

**Severity rationale:** Medium. No runtime breakage for a user who follows the bare-`hack`
flow, but the canonical onboarding path (README Quick Start) is broken and the docs gate
is red. Cheap to fix (mechanical find/replace + link repair), high payoff for new users.

**Fix direction:** update README + `docs/INSTALLATION.md` + `docs/user-guide.md` to use
`spec/SPEC.md` (or bare `hack`) in examples and fix the 3 `](../PRD.md)` links; fold
`docs:check` into `npm run validate` so this class of drift is caught automatically.

---

## 6. Additional Observations (non-blocking, informational)

These are **not** defects — recorded for completeness.

1. **`hack update -f <path>` assumes the file is literally named `tasks.json`.** The
   handler reads the exact `-f` path for its loose-ID lookup, but then passes
   `dirname(tasksFile)` to `withLockedTasksJSON()` (`src/core/file-lock.ts`), which
   re-derives `<dir>/tasks.json`. Pointing `-f` at a file named anything else (e.g.
   `/tmp/seed.json`) makes the pre-lock lookup succeed but the locked RMW read an empty
   `/tmp/tasks.json` → spurious "Task not found." Standard usage (`-f` → a real
   `<session>/tasks.json`) is unaffected and is all the PRD §5.4 acceptance criteria
   exercise. Worth a defensive note or a `basename === 'tasks.json'` guard if custom
   filenames are meant to be supported.

2. **Committed `.env` / `.envrc` use the legacy `ANTHROPIC_*` names** while `.hack` and
   `.env.example` use the canonical `PRP_*` names. This is *functionally fine* under the
   default `pi + zai` path — zai auth resolves via `~/.pi/agent/auth.json` (present) and
   `ANTHROPIC_BASE_URL` is honoured as a deprecated alias (emitting a one-time warning).
   But the committed credential files are inconsistent with the §9.2.8 canonical-first
   convention; `ANTHROPIC_AUTH_TOKEN` in particular is dead weight for the `zai`
   provider (it's only consulted when the provider is `anthropic`). Hygiene item only.

3. **Lint: 6 `no-explicit-any` warnings** in `src/cli/index.ts` (the recursive
   `any[]` task-tree walkers in `taskAction`) and `src/utils/logger.ts` (pino
   `bindings` cast). Already downgraded to `warn` in `.eslintrc.json`; non-blocking.

4. **No `.github/workflows/` in this checkout.** The README advertises a CI badge
   (`dabstractor/hacky-hack/actions/workflows/ci.yml`) but the workflow file isn't
   present locally, so the actual CI surface is unverifiable from the repo alone.

5. **§9.6.3 logging requirement met.** `hack --help` measured **0.60 s** via the dist
   build (1.28 s under `tsx` cold-start). No multi-second teardown stall — the lazy-logger
   / synchronous-destination architecture is holding.

---

## 7. Test-Coverage Gaps (recommendations for a future PRP)

- **No argv→`main()` integration test for subcommands.** Add a suite that spawns
  `node dist/index.js <sub>` for *every* subcommand and asserts (a) correct exit code
  and (b) **no `PRPPipeline` log line** (subcommand isolation). This would have caught
  BUG-1 immediately and prevents the class recurring for future subcommands.
- **`npm run validate` omits `docs:check`.** Folding it in (or wiring it into CI) would
  have surfaced BUG-2's broken links automatically.
- **README/docs examples are not exercised.** A smoke test that runs the literal
  commands from README §Quick Start against a throwaway repo would catch
  documentation-vs-reality drift like BUG-2.

---

## 8. Files Produced

- `./validate.sh` — executable validation harness (5 phases; run `./validate.sh` for all,
  or `./validate.sh quality|e2e|docs` for a subset). **Safe by construction:** only
  read-only/credential-free commands + `hack update -f <mktemp>`; never touches `plan/`,
  `PRD.md`, or `tasks.json`.
- `./validation_report.md` — this file.

*Per the validator contract, both files are temporary artifacts and may be deleted after
review; no other files were created or modified.*