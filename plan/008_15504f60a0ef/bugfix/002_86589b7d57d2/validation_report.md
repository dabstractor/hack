# Validation Report — hacky-hack (PRP Pipeline)

**Project:** `hacky-hack` — Autonomous PRP Development Pipeline (TypeScript / Node.js 20+ / Groundswell)
**Validator:** Validation agent (read-only; no pipeline execution, no `plan/` mutation per repo `AGENTS.md`)
**Date:** 2025-08-04
**Validation script:** [`./validate.sh`](./validate.sh) (executable; run `./validate.sh --help` for usage)

---

## 1. Executive Summary

The codebase is in **strong shape**: the standard toolchain gates (lint, type-check, format, full test suite, build, groundswell link) **all pass**, the documented **credential-free and read-only CLI workflows all operate correctly**, and the cross-cutting requirements I could verify mechanically (PRD §9.6 lazy-logger / synchronous-destination logging, the `[PRP Auto]` banner removal of PRD §5.1, provider-neutral `PRP_*` config with `ANTHROPIC_*` legacy fallback) are correctly implemented.

However, validation surfaced **6 issues** (1 medium-functional, 1 medium, 1 medium-docs/usability, 3 low). The most material is that the **configured 100 % coverage gate is non-functional** — `npm run test:coverage` exits `0` at ~90 % actual coverage, so coverage regressions slip through silently. Two documentation defects (a failing `docs:check` and a `prd`-vs-`hack` binary-name mismatch) are the only failures an automated run will actually flag.

**Overall verdict:** ⚠️ **Pass with caveats** — safe to develop against; the coverage-gate and docs/link defects should be addressed before relying on them as release gates.

| Gate | Result |
| --- | --- |
| Lint (eslint) | ✅ PASS — 0 errors, 6 `no-explicit-any` warnings |
| Type check (`tsc --noEmit`) | ✅ PASS |
| Format check (prettier) | ✅ PASS |
| Test suite (vitest run) | ✅ PASS — **6773 passed / 71 skipped** (199 files) |
| Coverage gate (`test:coverage`) | ⚠️ **NON-FUNCTIONAL** — ~90 % actual, exits 0 (see I-1) |
| Build (`tsc -p tsconfig.build.json`) | ✅ PASS — `dist/index.js` emitted |
| Docs consistency (`docs:check`) | ❌ **FAIL** — 2 broken links (see I-2) |
| Groundswell validation | ✅ PASS — §9.2.6 file-backed auth fix is live |
| PRD §9.6 logging criteria | ✅ PASS — 0 module-scope loggers, 0 `transport:` configs |
| CLI smoke tests (16) | ✅ PASS — all credential-free / read-only workflows |

---

## 2. The Validation Script — `./validate.sh`

A self-contained, dependency-light bash script that runs **every safe, non-pipeline validation phase** in the repo. It never runs the pipeline and never touches `plan/` (repo `AGENTS.md` compliance): every CLI invocation is either **credential-free** (`--help`, `--version`, `--dry-run`, `--validate-prd`, error-path arg validation) or a **strictly read-only query** (`inspect`, `validate-state`, `task`, `status`) against an existing session.

**Phases:** preflight → lint → type-check → format → test suite → coverage gate (100 %; skippable) → build → docs consistency → groundswell validation → PRD §9.6 logging checks → 16 CLI smoke tests.

**Usage:**
```bash
./validate.sh                 # all phases, fail-fast
./validate.sh --keep-going    # run all phases, report every failure at end
./validate.sh --no-coverage   # skip the slow coverage phase
./validate.sh --smoke-only    # fast: only the 16 CLI smoke tests
```

**Authoritative run** (`./validate.sh --no-coverage --keep-going`): **23 PASS · 1 WARN · 1 FAIL** → `Docs consistency` (the only gate an automated run fails on; coverage was skipped in this run and is characterized separately below).

---

## 3. Issues Found (Bug Tracker)

> This is a **reporting** pass — no code was modified. Severities are the validator's judgement, not a fix commitment.

### I-1 · Coverage gate is non-functional (configured 100 %, actual ~90 %, exits 0) — **Medium / Functional**
- **Where:** `vitest.config.ts` declares `coverage.thresholds.global = { statements: 100, branches: 100, functions: 100, lines: 100 }` (the config comment states *"Enforces 100% code coverage thresholds for all source files"*).
- **Observed:** `npm run test:coverage` reports **`All files | 89.82 % stmts | 90.47 % branches | 94.2 % funcs | 89.82 % lines`** and **exits `0`** — no `does not meet threshold` / threshold-ERROR message is emitted.
- **Consequence:** The coverage gate that the project clearly *intends* to enforce is a silent no-op. Coverage regressions are not caught; the comment's promise is false. Notable uncovered surface: several files at **0 %** (`src/scripts/validate-api.ts`, `src/workflows/hello-world.ts`, `src/workflows/index.ts`, `src/utils/typecheck-runner.ts`, `src/utils/memory-error-detector.ts`, `src/utils/startup-error-verifier.ts`, `src/utils/package-json-syntax-verifier.ts`, `src/commands/process-code.command.ts`, `src/scripts/validate-groundswell.ts`, `src/scripts/validate-test-suite-p4m3t1s1.ts`) and many well below 100 % (e.g. `token-counter.ts` 75 %, `tree-renderer.ts` 80 %, `resource-monitor.ts` 84 %, `prp-generator.ts` 88 %, `cli/commands/cache.ts` 47 %, `cli/commands/validate-state.ts` 55 %).
- **Note for `validate.sh`:** because the underlying gate does not fire, the *Coverage* phase in `./validate.sh` (without `--no-coverage`) will report **PASS** even though coverage is ~90 %. Treat a "PASS" there as uninformative until this is fixed.
- **Suggested look:** vitest 1.6.x + v8 provider threshold enforcement; confirm whether the threshold key path / provider interaction is preventing the check from running, or downgrade the documented threshold to a realistic target.

### I-2 · `docs:check` fails — 2 broken internal links — **Medium / Docs**
- **Where:** `docs/ARCHITECTURE.md:736` and `docs/ARCHITECTURE.md:852`. `npm run docs:check` → exit `1`.
- **Cause:** Both lines write `[Configuration](docs/CONFIGURATION.md#resilience-tuning)`. Because `ARCHITECTURE.md` already lives in `docs/`, the relative link resolves to the nonexistent `docs/docs/CONFIGURATION.md`. The anchor `resilience-tuning` *does* exist in `docs/CONFIGURATION.md`.
- **Fix:** drop the `docs/` prefix → `[Configuration](CONFIGURATION.md#resilience-tuning)`.
- **Impact:** the shipped `docs:check` gate is red; the two cross-references 404 in rendered docs.

### I-3 · Binary-name mismatch: docs/CLI say `prd`, but the only binary is `hack` — **Medium / Usability**
- **Where:**
  - `package.json` → `"bin": { "hack": "./dist/index.js" }` (no `prd` bin).
  - `src/cli/index.ts:304` → `program.name('prd')` (only affects help text).
  - `README.md` and `docs/CLI_REFERENCE.md` document commands as `prd task`, `prd status`, `prd status next -o json`, etc.
  - The source itself emits a `[hack]` prefix in `task`/`status` output (`src/cli/index.ts` `taskAction`), confirming the real command name is `hack`.
- **Observed:** `command -v prd` → not found. A user who `npm i -g` this package and follows the docs types `prd task` and gets `command not found`; the working invocation is `hack task` (or `npm run dev -- ...`).
- **Fix (one of):** register a `prd` bin in `package.json`, **or** correct the docs + `program.name()` to `hack` everywhere. Pick one name and make it consistent.

### I-4 · Stale manual validation script `tests/validation/zai-api-test.ts` — **Low / Tooling**
- **Where:** `tests/validation/zai-api-test.ts` (a manual script — filename `*-test.ts` is **not** picked up by vitest's `*.test.ts` glob, so it does not affect the automated suite).
- **Stale facts:**
  - Asserts `getModel('high') === 'GLM-4.7'` and `getModel('fast') === 'glm-5-turbo'` — but the configured/default high & balanced model is **`glm-5.2`** (`getModel('high')` returns `glm-5.2`). The "Model Selection" check would warn-and-fail against a correct config.
  - Requires `process.env.ANTHROPIC_API_KEY` and instructs users to set `ANTHROPIC_AUTH_TOKEN` — contradicting the provider-neutral auth model (PRD §9.2.6): the default path authenticates via `pi /login` (`~/.pi/agent/auth.json`) **or** `ZAI_API_KEY`. A correctly-configured user would fail the "Environment Configuration" step.
- **Impact:** misleading onboarding tooling. Run `npx tsx tests/validation/zai-api-test.ts` and it reports false failures.
- **Fix:** update expected models to `glm-5.2` and the auth check to the provider-aware resolution (override → `ZAI_API_KEY` → `~/.pi/agent/auth.json`), or delete it in favour of `src/scripts/validate-api.ts`.

### I-5 · Hardcoded `Co-Authored-By: Claude <noreply@anthropic.com>` trailer on every commit — **Low / Consistency**
- **Where:** `src/utils/git-commit.ts:226` (`formatCommitMessage` unconditionally appends `\n\nCo-Authored-By: Claude <noreply@anthropic.com>`); also asserted in `docs/ARCHITECTURE.md:852`.
- **Why it's stale:** the default harness is now the vendor-neutral `pi` + `zai` provider (PRD §9.1 explicitly downgrades Anthropic to a second-class option). Attributing **every** commit to "Claude" is Anthropic-specific and misleading for `pi`/z.ai runs.
- **Scope note:** the **task-prefix** commit format itself (`<phase>.<milestone>.<task>[.<subtask>]:`, trailing-elision, `[PRP Auto]` banner stripped, `PRP_COMMIT_FORMAT=plain` opt-out) is implemented **correctly** per PRD §5.1 — only the co-author trailer is the issue.
- **Fix:** make the trailer harness/provider-aware (or drop it / make it configurable).

### I-6 · `task next -o json` / `status next -o json` emit non-JSON when no tasks remain — **Low / Robustness**
- **Where:** `src/cli/index.ts`, `taskAction` "next" branch. When no next task is found it runs `console.log('No tasks remaining.')` **regardless of `--output json`**.
- **Impact:** `hack task next -o json | jq .` (and the documented `prd status next -o json`) fails on a completed session because the empty-result path prints plain text, not JSON. (The *with-result* path correctly emits JSON.)
- **Fix:** in the no-result branch, honour `options.output === 'json'` (e.g. print `null` or `{}`).

---

## 4. What Was Verified Working (positives)

- **Test suite is green and broad:** 199 files, 6773 passed / 71 skipped; includes `tests/unit`, `tests/integration`, `tests/e2e`, mocked-groundswell hermetic E2E, and forbidden-operations / authority / shutdown coverage. (Note: some `ERROR`-level log lines appear during the run — these are *intentional* negative-path exercise, e.g. `tasks.json` corruption/ENOENT recovery and flush-retry exhaustion; the tests asserting those paths pass.)
- **PRD §9.6 logging architecture** (mechanically verified): zero module-scope `getLogger(...)` declarations in `src/`; zero pino `transport:` configs; `pino-pretty` is wired as a **destination stream** (not a transport). `--help`/`--version` return in well under 2 s with no worker-thread spawn.
- **PRD §5.1 commit format:** the legacy `[PRP Auto]` banner is correctly **stripped/forbidden** (all in-source references are stripping/forbidding logic, none emit it); task-prefix builder with trailing-level elision and `plain` fallback is in place.
- **Provider-neutral config (PRD §9.2.8):** `PRP_MODEL_HIGH/BALANCED/FAST` + `PRP_API_BASE_URL` canonical names with `ANTHROPIC_DEFAULT_*` / `ANTHROPIC_BASE_URL` legacy fallback; `docs/CONFIGURATION.md` carries the full deprecation table; `.env.example` documents canonical names only.
- **Groundswell §9.2.6 fix is live:** `validate-groundswell` confirms `node_modules/groundswell` (registry 1.0.1) uses `AuthStorage.create()` (file-backed), and `PiHarness` resolves an `auth.json`-only `zai` credential.
- **z.ai endpoint safeguard (PRD §9.2.4):** active in `tests/setup.ts` via `validateProviderEndpoint()` (blocks Anthropic endpoints, warns on non-z.ai).
- **All credential-free + read-only CLI workflows operate correctly** (16/16 smoke tests): `--help`, `--version`, `--dry-run`, `--validate-prd` (VALID, 0 issues on the real `PRD.md`), invalid-flag/missing-PRD/bad-scope/bad-`--mode` error paths (all exit 1 with clear messages), and read-only `inspect` / `validate-state` / `task` / `status` / `task status` / `task next` against the existing session.

---

## 5. Notes, Scope & Limitations

- **No pipeline execution.** Per repo `AGENTS.md`, the full pipeline (`npm run dev -- --prd …`, `--mode delta|bug-hunt|validate`, `--adopt-prd`, `--continue`, agent-driven breakdown/implementation/bug-hunt) was **not** executed — doing so would create sessions and mutate `plan/`. Those code paths are covered by the (passing) mocked unit/integration/e2e suites rather than a live run here.
- **Live LLM / z.ai connectivity not exercised.** `src/scripts/validate-api.ts` and `tests/validation/zai-api-test.ts` make real network calls and were not run end-to-end (and I-4 notes the latter is stale); the provider-endpoint *safeguard* and the harness/auth resolution are verified structurally and via `validate-groundswell`.
- **Coverage verdict is definitive** despite the gate being non-functional: the v8 per-file report (saved during validation) shows real numbers; the global rollup is **89.82 %** statements.
- **Temporary artifacts:** `./validate.sh` and `./validation_report.md` are validation-only outputs and can be deleted after review.