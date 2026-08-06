# Validation Report — PRP Pipeline (hacky-hack)

**Validated:** 2026-08-06
**Validator:** automated validation agent (`./validate.sh`)
**Branch / HEAD:** `main` @ `e084cb2`
**Scope:** static analysis, type-check, unit/integration tests, production build, and documented user-workflow (E2E) checks that do **not** invoke an LLM agent. The agent-driven pipeline itself was intentionally not executed (per `AGENTS.md`: *"NEVER run this project within this directory"*).

---

## 1. Executive Summary

| # | Gate | Result |
|---|------|--------|
| 1 | Lint (eslint) | ✅ PASS — 0 errors, **6 `any`-type warnings** |
| 2 | Typecheck (tsc --noEmit) | ✅ PASS |
| 3 | Format (prettier --check) | ✅ PASS |
| 4 | Unit + integration tests (vitest) | ❌ **FAIL — 18 failures** |
| 5 | Production build (tsc + dist) | ✅ PASS |
| 6 | E2E / documented workflows | ❌ **FAIL — subcommand regression** |

**Overall: ❌ VALIDATION FAILED (2 of 6 gates).**

The codebase is fundamentally healthy — types are clean, the build succeeds, the distributed PRD assembles correctly, and **6,985 of 7,074 tests pass (98.7 %)**. The two failing gates trace to **one root cause**: the project migrated its monolithic root `PRD.md` into a distributed spec (`spec/SPEC.md` + 16 section files, declared via `.hack` `[cli] prd = "spec/SPEC.md"`), but **four read-only CLI subcommands and three integration test files were not updated** and still hard-code the legacy root `./PRD.md`.

Beyond the failing gates, the run surfaced three further findings (no exit-code impact): a tracked repo-root file mutated by a test every run (GAP-5), `.hack.local` missing from `.gitignore` (GAP-3), and stale local `.env` names (OBS-4).

This is a focused regression, not a systemic defect. Details below.

---

## 2. Environment

- Node `v26.4.0`, npm `11.18.0`
- `groundswell` linked from `~/projects/groundswell/dist` ✅
- Repo root has **no `PRD.md`** — canonical spec is `spec/SPEC.md` (distributed, `@`-include assembled)
- `.hack` declares `[cli] prd = "spec/SPEC.md"`, `[harness] name = "pi"`, `[models] { high=balanced="glm-5.2", fast="glm-5-turbo" }`

---

## 3. Bug Tracker

### 🔴 BUG-1 — Read-only inspection subcommands ignore `.hack [cli] prd` and hard-code the legacy root `./PRD.md`  *(HIGH)*

**Symptom.** `hack artifacts`, `hack cache`, `hack inspect`, and `hack validate-state` all throw
`SessionFileError: ... validate PRD exists` (ENOENT for `…/PRD.md`) and `process.exit(1)` for **any project whose PRD is a distributed spec** — which is both the documented, recommended setup (PRD §2.3) and this repository's own configuration.

**Root cause.** The main pipeline path (`src/index.ts` `main()`) honors `.hack` via `applyHackCliDefaults(args, mergedHackConfig)` *before* the PRD-exists guard (this was fixed in commit `f248867`, *"make `[cli] prd` functional"*). The four subcommand action handlers in `parseCLIArgs()`, however, **bypass that resolution entirely** and resolve the PRD themselves with a hard-coded `resolve('PRD.md')`. Each subcommand then constructs a `SessionManager(prdPath, planDir)`, whose constructor **synchronously validates** the PRD exists and throws on ENOENT (`src/core/session-manager.ts:283–303`).

**Affected locations (all confirmed by static scan):**

| File | Line | Code |
|------|------|------|
| `src/cli/index.ts` | 517 | `const prdPath = resolve('PRD.md');` (artifacts subcommand action) |
| `src/cli/index.ts` | 576 | `const prdPath = resolve('PRD.md');` (cache subcommand action) |
| `src/cli/commands/artifacts.ts` | 174 | `prdPath: string = resolve('PRD.md')` (ctor default) |
| `src/cli/commands/cache.ts` | 71 | `prdPath: string = resolve('PRD.md')` (ctor default) |
| `src/cli/commands/inspect.ts` | 148 | `prdPath: string = resolve('PRD.md')` (ctor default) |
| `src/cli/commands/validate-state.ts` | 87 | `prdPath: string = resolve('PRD.md')` (ctor default) |

**Reproduction (test-facing).** The 12 failures in `tests/integration/artifacts-command.test.ts` exercise exactly this path: `new ArtifactsCommand(planDir)` → default `prdPath = resolve('PRD.md')` → `SessionManager` throws → the test's mocked `process.exit` re-throws `process.exit(1)`. Stderr: `Failed to validate PRD exists at /home/dustin/projects/hacky-hack/PRD.md: ENOENT`.

**Reproduction (runtime, not executed here).** `hack artifacts list` (or any of the four) from the repo root → `ArtifactsCommand.execute` → `#loadSession` → `new SessionManager(resolve('PRD.md'), …)` → `statSync` ENOENT → throw → handler logs `Artifacts command failed` → `process.exit(1)`.

**PRD conflict.** This violates three binding requirements:
- §2.3 — *"A split PRD MUST behave identically to a monolithic one everywhere downstream."*
- §9.7.10 — *"`hack` run from any subdirectory resolves the same `.hack`…"* (acceptance criterion).
- §9.8.7 — *"All subcommands benefit automatically."* (the §9.8 `chdir` rationale claims the subcommands need no per-command changes — true for cwd, false for the PRD path).

**Suggested direction (not a fix).** Resolve the effective PRD once via the same `.hack`-aware path the main loop uses (e.g. a shared `resolveEffectivePrd()` used by both `main()` and the four subcommand handlers), or have the handlers read the already-loaded merged `.hack` config. Either makes the subcommands consistent with the documented `--repo-root` / `.hack [cli] prd` story.

---

### 🟠 BUG-2 — Three integration test files not updated for the monolithic→distributed PRD migration *(MEDIUM — test-suite regression)*

**Symptom.** `npm run test:run` → **18 failed | 6,985 passed | 71 skipped (7,074 total)**; **3 failed | 208 passed | 1 skipped (212 files)**.

**Root cause.** Identical to BUG-1's origin: the root `PRD.md` was split into `spec/SPEC.md` (commit `543dd59`, *"docs: split monolithic PRD.md into distributed spec with include directives"*), and `.hack` now pins `[cli] prd = "spec/SPEC.md"`. The tests below still reference the legacy root file.

| Test file | Hard-coded reference | Failures | Failure mode |
|-----------|---------------------|:--------:|--------------|
| `tests/integration/architect-agent.test.ts:24` | `const PRD_PATH = resolve(process.cwd(), 'PRD.md')` | **5** | `ENOENT: … open '…/PRD.md'` when `readFile(PRD_PATH)` |
| `tests/integration/artifacts-command.test.ts` | `new ArtifactsCommand(planDir)` (no `prdPath` arg → default `resolve('PRD.md')`) | **12** | `SessionFileError: validate PRD exists` → test-mocked `process.exit(1)` |
| `tests/integration/prd-validation-integration.test.ts:36` | `validator.validate('PRD.md')` | **1** | `summary.critical` = 1 (PRDValidator reports a missing-file *existence* issue); test expects 0 |

> The 12 `artifacts-command` failures are the **test-facing reflection of BUG-1** — they would be fixed by the same `.hack`-aware PRD resolution. The `architect-agent` and `prd-validation-integration` failures additionally need their hard-coded paths pointed at the canonical `spec/SPEC.md` (or resolved through the same effective-PRD helper).

**Note on the passing majority.** Everything else is green, including the auth preflight, harness/provider compatibility, `.hack` schema/validation, gate-semantics neutralization (§9.9), `tasks.json` recovery, repo-root traversal, distributed-PRD include expansion, and the full PRP-pipeline unit suite.

---

### 🟡 GAP-3 — `.hack.local` is not gitignored *(MEDIUM — latent secrets-hygiene gap)*

**Symptom.** `git check-ignore .hack.local` → **not ignored**. No `.hack.local` file exists today (no active leak), but the shipped `.gitignore` does not preemptively cover it.

**PRD conflict.** §9.7.3 / §9.7.6 designate `.hack.local` as the *only* secrets-bearing file tier and require it to be gitignored. `hack config init` is specified (§9.7.8) to append it — but a developer who creates `.hack.local` by hand before running `hack config init` could commit secrets. PRD §9.7.6 also requires `hack config validate` to *warn* when `.hack.local` is tracked.

**Adjacent positives (verified):** `.env` **is** gitignored ✅; the committed `.hack` contains **no** secret-bearing keys ✅ (`[auth] override_key`, `[auth] *_api_key`, etc. are absent).

---

### 🟡 GAP-5 — Test mutates a tracked repo-root file every run (test-isolation defect) *(MEDIUM — repo hygiene)*

**Symptom.** After *any* `npm run test:run`, `git status` reports `artifacts/P1.M3.T3.S2/checkpoints.json` as modified, with a diff of **only timestamps and `Date.now()`-derived checkpoint IDs** (e.g. `2026-08-06T07:19:01Z` → `2026-08-06T08:01:15Z`, and id `…_1786000741291_…` → `…_1786003275154_…`). The file content is otherwise identical.

**Root cause.** `tests/integration/progressive-validation.test.ts:203` does `const sessionPath = process.cwd();` and then constructs `new PRPExecutor(sessionPath)` (lines 228, 284, 318, …) for task `P1.M3.T3.S2`. The executor's **real (non-mocked) `CheckpointManager`** writes checkpoints to `<sessionPath>/artifacts/<taskId>/checkpoints.json`, which — because `sessionPath` is the repo root — is the **tracked** file `artifacts/P1.M3.T3.S2/checkpoints.json`. Every run rewrites it with fresh timestamps.

**Why it matters.** Non-deterministic tracked-file churn: `git status` is noisy after every test run, and a careless `git add -A` could commit throwaway checkpoint state. (Contrast: `tests/unit/core/checkpoint-manager.test.ts` correctly mocks `mkdir`/`writeFile` and is unaffected.)

**Suggested direction (not a fix).** Point `sessionPath` at a temp dir (`mkdtempSync`) like the other integration tests do, so no tracked file is touched. *(This file was restored to HEAD after the validation run; the repo is clean apart from the two deliverables.)*

---

### 🔵 OBS-4 — Local `.env` uses the deprecated `ANTHROPIC_*` names *(LOW — config drift, not a code defect)*

**Observation.** The untracked `.env` still sets `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`. The README/`.env.example` now document `ZAI_API_KEY` / `pi /login` as the canonical default path, with the `ANTHROPIC_*` names as deprecated aliases (§9.2.8). The legacy aliases still function (the loader maps `ANTHROPIC_AUTH_TOKEN`→`ANTHROPIC_API_KEY` under the `anthropic` provider), so this is personal-config drift rather than a bug. Worth refreshing the local `.env` to the canonical `ZAI_API_KEY` form for clarity. *(Not a code issue — `.env` is untracked and user-owned.)*

---

## 4. Lint Warnings (informational)

`npm run lint` passes with **0 errors** and **6 `@typescript-eslint/no-explicit-any` warnings** — all in two files:

- `src/cli/index.ts:735, 780, 801` (4) — `any` in CLI option coercion
- `src/utils/logger.ts:324, 325` (2) — `any` in logger transport handling

These are pre-existing and do not block the build. Consider typing them when convenient.

---

## 5. What Works (confidence builder)

To give 100 %-confidence in the parts of the system that *do* function:

- ✅ **Type system clean** — `tsc --noEmit -p tsconfig.build.json` exits 0.
- ✅ **Production build green** — `npm run build` produces an executable `dist/index.js` (chmod 0755 via `postbuild`).
- ✅ **Distributed PRD assembles correctly** — the project's own `resolvePRD()` expands `spec/SPEC.md` to **129,635 chars** with all 16 `@`-includes resolved; §9.9 (Validation Gate Semantics), §14 (`.hack`), and §15 (Repo Root) are all present. No unexpanded `@file.md` tokens remain. (The only resolver warnings are for the *documentation example* `@path/to/file.md` inside the §2.3 prose — expected and harmless.)
- ✅ **`.hack` loads** and its `[cli] prd` points at an existing, resolving file.
- ✅ **Main pipeline path honors `.hack [cli] prd`** — `main()` runs `applyHackCliDefaults()` *before* the `existsSync(args.prd)` guard (the `f248867` fix), so a bare `hack` correctly loads `spec/SPEC.md`.
- ✅ **Secrets hygiene on committed files is clean** — `.env` ignored, `.hack` secret-free.
- ✅ **Test depth is strong** — 212 files / 7,074 cases; 98.7 % passing; the 18 failures are one root cause.

---

## 6. Residual Risks / Out-of-Scope

- **Agent pipeline not exercised.** Per `AGENTS.md` the agent-driven loop (`npm run dev`, `--mode delta`, `--mode bug-hunt`, `--adopt-prd`) was not run. Those paths require live z.ai credentials and would modify the in-progress implementation. They are unit/integration-tested but not validated end-to-end here.
- **External integrations** (z.ai LLM provider, `pi` harness, live git commit via `stagecoach`) were not hit. Their wiring is covered by the passing unit/integration suites.
- **Coverage gate** is not part of `npm run validate` (it uses `test:run`, not `test:coverage`); the regression-floor thresholds in `vitest.config.ts` (statements 89 / branches 90 / functions 94 / lines 89) were therefore not evaluated. Not flagged as a defect.

---

## 7. Recommended Action Order

1. **BUG-1 (HIGH)** — make `hack artifacts|cache|inspect|validate-state` honor `.hack [cli] prd` (shared effective-PRD resolver). This also clears 12 of the 18 test failures.
2. **BUG-2 (MEDIUM)** — point `architect-agent.test.ts` and `prd-validation-integration.test.ts` at the canonical `spec/SPEC.md` (or the effective-PRD helper). Clears the remaining 6 failures.
4. **GAP-3 (MEDIUM)** — add `.hack.local` to `.gitignore` (and ensure `hack config init` does so per §9.7.8).
5. **GAP-5 (MEDIUM)** — point `progressive-validation.test.ts`'s `sessionPath` at a temp dir so it stops mutating the tracked `artifacts/P1.M3.T3.S2/checkpoints.json`.
6. **OBS-4 (LOW)** — refresh local `.env` to canonical `ZAI_API_KEY`.
7. *(Optional)* type the 6 `any` lint warnings.

After 1–3, `./validate.sh` should report **ALL PHASES PASSED** (GAP-5 does not affect `validate.sh`'s exit code but keeps `git status` clean).

---

*Generated by `./validate.sh`. Re-run anytime with `./validate.sh` (full) or `./validate.sh --no-tests` (fast, ~1 min).*