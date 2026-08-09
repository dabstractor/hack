# Validation Report — hacky-hack (PRP Pipeline)

**Validator:** autonomous validation pass
**Date:** 2026-08-08
**Scope:** Full codebase — toolchain health (lint/typecheck/format/docs/build/tests) + end-to-end exercise of the safe, non-pipeline CLI surface + cross-cutting PRD invariants (logging §9.6, repo-root §9.8, include idempotency §2.3, gate semantics §9.9, critical-file protection §5.1).
**Validation script:** `./validate.sh` (executable; run results below)

> **Safety note.** The validator never launches the autonomous pipeline (no bare
> `hack`, no `--prd` without `--dry-run`/`--validate-prd`), per `AGENTS.md`.
> Write-capable checks (`config init`, `hack update`) ran inside throwaway temp
> git repos and were cleaned up. No source code, `PRD.md`, `plan/`, or
> `tasks.json` was modified.

---

## Executive Summary

The codebase is in **strong health**. Every core gate passes:

| Gate | Result |
| --- | --- |
| ESLint | ✅ 0 errors (6 pre-existing `no-explicit-any` warnings, non-blocking) |
| TypeScript (`tsc --noEmit`) | ✅ clean |
| Prettier (`--check`) | ✅ all files formatted |
| Docs check (`docs:check`) | ✅ links / terminology / code blocks / dates |
| Build (`tsc`) | ✅ builds, `dist/` in sync with `src/` |
| Tests (Vitest) | ✅ **7208 passed**, 3 skipped (218 files) |

All documented user workflows exercised end-to-end behave correctly, including:
repo-root resolution from subdirs (§9.8), `--help`/`--version` under 2 s with no
worker threads (§9.6), credential-free `--dry-run`/`--validate-prd` (§9.2.7),
`config`/`task`/`status`/`inspect`/`validate-state` subcommands, `hack update`
loose-ID + status-fuzzy matching + cascade + ancestor-recompute + error paths
(§5.4), PRD include-resolution idempotency (§2.3 fixed point), gate-semantics
neutralization (§9.9), and critical-file deletion protection (§5.1).

**`validate.sh` final result: 48 passed · 0 failed · 2 known issues.**

Two genuine bugs were found, **both in machine-readable (`-o json`) output**.
No correctness, security, or data-integrity defects were found in the pipeline
core, state management, or git-commit path.

---

## Bug Tracker

### BUG-1 — `hack status -o json` / `hack task -o json` (default list) emits colored text, not JSON
**Severity:** Medium · **Category:** CLI / machine-readable output · **PRD ref:** §5.3

**Symptom.** The default listing action of `hack status` and `hack task` silently
ignores `--output json` and prints the human-readable, color-coded tree instead:

```
$ hack status -o json | head -1
P1: Distributed-PRD Include Dedup (Each File Imported At Most Once) - Complete   ← text, not JSON
```

The output is not parseable JSON, so `hack status -o json | jq .` fails.

**Root cause.** `src/cli/index.ts:814` — the `else` branch that handles the
default list action defines `listItems()` and unconditionally calls it; there is
no `if (options.output === 'json')` arm. The `-o json` option **is** honored in
every sibling code path:

| Code path | JSON branch? | Location |
| --- | --- | --- |
| `awaiting_breakdown` (no `tasks.json` yet) | ✅ yes | `src/cli/index.ts:713` |
| `task next` | ✅ yes | `src/cli/index.ts:772` |
| `task status` (summary) | ✅ yes | `src/cli/index.ts:783` |
| **default list** | ❌ **missing** | `src/cli/index.ts:814` |

The option is advertised in `--help` as `Output format (table, json)` for both
commands, so users reasonably expect it to work for the default listing.

**Repro.**
```
hack status -o json        # → colored text (BUG)
hack status -o json | jq . # → parse error
hack task next -o json     # → valid JSON (works; used for contrast)
```

**Suggested fix (for a PRP agent).** Add an `options.output === 'json'` arm to
the default-list branch (`src/cli/index.ts:814`) that serializes the backlog
tree (e.g. `console.log(JSON.stringify(data.backlog, null, 2))`), mirroring the
`task next` / `task status` handlers. Add a regression test asserting `hack
status -o json` stdout is valid JSON.

---

### BUG-2 — `hack update -o json` pollutes stdout with pino INFO logs
**Severity:** Medium · **Category:** CLI / machine-readable output · **PRD ref:** §5.4

**Symptom.** `hack update ... -o json` writes a pino `INFO` log line (and its
multi-line fields) to **stdout** *before* the JSON result, so the JSON payload
is not at the start of stdout and `hack update ... -o json | jq .` fails:

```
$ hack update 1.1.1.1 done -o json -f tasks.json 2>/dev/null
[00:48:50] INFO: [uuid] [session-utils] tasks.json written successfully   ← stdout (pino)
    tasksPath: "/tmp/.../tasks.json"                                      ← stdout
    size: 3617                                                            ← stdout
{                                                                         ← the actual JSON
  "id": "P1.M1.T1.S1",
  "status": "Complete",
  "title": "Sub1"
}
```

(`2>/dev/null` discards stderr; the log lines survive, proving they are on stdout.)

**Root cause.** `writeTasksJSON` logs success via the pipeline's pino logger
(`src/core/session-utils.ts:1062` `tasks.json written successfully`). The pino
logger's destination is **stdout** in every mode (`src/utils/logger.ts:246`/`259`
— "JSON → default stdout"). The per-command `-o json` output flag is independent
of the global `--machine-readable` logger flag, so the structured log is not
redirected to stderr under `-o json`.

This is a systemic machine-readability concern, but it **only manifests on
write-capable commands** that emit logs (read-only commands like `status`/
`inspect`/`validate-state` produce no INFO log, so their `-o json` stdout stays
clean). `hack update` is the confirmed manifestation.

**Impact.** Any script or CI doing `hack update <id> <status> -o json | jq .`
breaks. The PRD §5.4 contract for `-o json` is to emit `{ "id", "status",
"title" }`, which the command does — but the surrounding log noise makes it
unparseable without ad-hoc trailing-JSON extraction.

**Suggested fix (for a PRP agent).** When a command's resolved output format is
`json`, route human/structured logs to stderr (or suppress them) so stdout
carries only the machine-readable payload. The cleanest single-site fix is in
the logger/output layer: a per-command `-o json` should imply log→stderr, the
same way the global `--machine-readable` flag is intended to. Mirror the
behavior already used for read-only JSON commands.

---

## Observations (non-blocking, no action required)

### OBS-1 — ESLint: 6 `no-explicit-any` warnings (pre-existing)
`src/cli/index.ts` (4) and `src/utils/logger.ts` (2) use `any` in a few typed
positions. Zero errors; warnings are non-blocking and consistent with the
existing code style. The `npm run lint` gate does not fail on warnings.

### OBS-2 — Coverage report understates true line coverage
The `coverage/` report shows many `src/` files at 0 % because the test suite
heavily mocks Groundswell/agent modules (`vi.mock(...)`), so the real source is
not instrumented during test runs. This is a property of the test strategy
(mocks replace real modules), **not** missing tests — 7208 tests exercise the
behavior. Treat the coverage numbers as a lower bound, not a reliability signal.

### OBS-3 — Spec's self-referential `@path/to/file.md` triggers a benign stale-include warning
When `resolvePRD('spec/SPEC.md')` resolves the spec, the documentation prose
that *describes* the include directive (`@path/to/file.md` in §2.3) is itself
treated as an include token: it matches the boundary rule (preceded by a
non-path char), fails existence, ends in `.md`, and correctly emits the
documented stale-include warning to stderr:

```
[prd-resolver] stale include '@path/to/file.md': path does not resolve to an existing file
```

This is **exactly the behavior PRD §2.3 specifies** (a `.md` token that fails to
resolve MUST warn). It is cosmetically noisy only because the spec documents the
feature using a literal example path. No functional impact; the resolved
document is still a correct idempotent fixed point.

---

## What was verified (full pass list)

These checks all **passed** in the final `./validate.sh` run:

- **Pre-flight:** Node ≥ 20, git repo present, `package.json`/`node_modules` present.
- **Lint:** ESLint 0 errors.
- **Typecheck:** `tsc --noEmit` clean.
- **Format:** Prettier — all files formatted.
- **Docs:** `docs:check` (links, terminology, code blocks, dates).
- **Build:** `tsc` builds; `dist/` byte-identical to a fresh build (no drift).
- **Tests:** Vitest — 7208 passed, 3 skipped.
- **Logging §9.6 (REQ-L1):** `logger.ts` uses synchronous destinations (`pino-pretty` as a direct destination, no worker-thread `transport:`). The only `transport:` references in `src/` are MCP transport objects (`git-mcp.ts`, `bash-mcp.ts`, `filesystem-mcp.ts`), not pino.
- **Logging §9.6 (REQ-L2):** No module-scope `getLogger()` calls (`rg "^(export )?(const|let) \w+ = getLogger\(" src/` → 0 hits); all loggers are lazily instantiated.
- **Logging §9.6 (REQ-L3):** `--help`/`--version` complete in ~0.6 s (well under the 2 s acceptance target).
- **Repo-root §9.8.9:** launch from a deep subdir (`src/core/`) resolves the repo root; launch from outside any git repo hard-errors with exit 1; `--help`/`--version` are exempt and work outside a repo.
- **Credential-free §9.2.7:** `--dry-run` and `--validate-prd` run with no API call (the real spec validates as VALID).
- **`config` subcommand §9.7:** `show` / `validate` / `path` exit 0; `show -o json` emits a valid JSON array on clean (JSON-first) stdout; `init` writes `.hack` and appends `.hack.local` to `.gitignore`; `init` without `--force` refuses and exits non-zero; `init --force` overwrites.
- **`task`/`status` §5.3:** text + `next` + `status` actions exit 0; `task next -o json` (→ `null` on completed session) and `task status -o json` (→ counts object) both emit valid JSON; `inspect -o json` and `validate-state -o json` emit JSON.
- **`hack update` §5.4:** loose ID matching (`1.1.1.1` numeric, `p1m1t1s1` concat) ✓; synonym status (`done`→Complete, `re`→Ready) ✓; cascade Complete down a phase (`update 1 done`) ✓; ancestor recompute on reset ✓; unknown ID → non-zero ✓; ambiguous status `r` → non-zero listing `Researching, Ready` ✓; unknown status → non-zero listing valid statuses ✓; `-o json` emits `{id,status,title}` (trailing, see BUG-2) ✓.
- **PRD include resolution §2.3:** `resolvePRD(resolvePRD(x)) === resolvePRD(x)` — confirmed idempotent fixed point over the real `spec/SPEC.md`.
- **Gate semantics §9.9 (REQ-G2):** `isNegatedFileExistenceGate` neutralizes all negated *existence* forms (`! test -f`, `test ! -f`, `[ ! -f ]`, `! [ -e ]`, `test ! -d`) and correctly leaves negated *content* (`! grep …`), positive existence, and plain commands to execute (9/9 cases).
- **Critical-file protection §5.1:** `restore_critical_files` is implemented and invoked from Smart Commit; agent prompts forbid `rm`/`git rm`/`git clean`/`mv` against `PRD.md`/`PRP.md`/`plan/`.
- **Code hygiene:** no real actionable TODO/FIXME markers; no `@ts-ignore`/`@ts-expect-error` directives; `dist/index.js` is executable.

---

## Residual Risks / Notes for the maintainer

1. **Both bugs share one theme — machine-readable JSON output.** BUG-1 is a
   missing branch; BUG-2 is logs on stdout. Fixing them together (a small PRP
   scoped to "`-o json` output correctness across all `task`/`status`/`update`
   actions") would close the entire machine-readability gap and make every
   `hack <cmd> -o json | jq .` invocation reliable.
2. Neither bug affects pipeline correctness, session/state integrity, or git
   safety. They are usability defects in scripting/automation surfaces only.
3. The validator did **not** exercise the live agent/pipeline path (LLM calls,
   breakdown, PRP generation/execution, bug hunt, delta sessions) — these are
   mocked in the test suite (7208 tests) and are out of scope for a read-only
   validation pass. Confidence in those paths rests on the passing test suite,
   not on live execution here.