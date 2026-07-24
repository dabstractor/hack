# PRP — P3.M2.T6.S2: Temp-file cleanup on graceful and hard-killed exits

---

## Goal

**Feature Goal**: Implement the **temp-file-cleanup half** of PRD §9.3.3
(h4.10) "Prompt Delivery (no argv-size limit)". PRD §9.3.3 mandates:

> Any temp files backing these prompts MUST be cleaned up on both graceful
> and hard-killed (SIGTERM/SIGKILL/power-loss) exits. When a temp file backs
> a retry loop, it MUST be (re-)written on *every* attempt: if the agent or
> the system cleans `/tmp` mid-run, a write-once temp file fails forever on
> every later retry, whereas re-writing is cheap and makes retries resilient.

The **first half** (P3.M2.T6.S1 — argv guard + audit, owns
`src/agents/prompt-delivery.ts`) is implemented in parallel and **confirms
the codebase delivers every prompt programmatically** (in-memory
`session.prompt(request.prompt)` / `sdk.query({prompt})`, never argv, never a
temp file — see `plan/008_15504f60a0ef/P3M2T6S1/PRP.md` and
`research/01_summary.md` §VERDICT). Therefore **no temp file backs any agent
prompt today**. This subtask is consequently **PREVENTIVE INFRASTRUCTURE**,
not a targeted fix: it delivers a module-level cleanup registry + exit/signal
handlers (mirroring the established `src/core/file-lock.ts` pattern EXACTLY),
a retry-aware write helper that (re-)writes + registers on every call, an
explicit code+test documentation of the unrecoverable SIGKILL/power-loss
limitation, and a regression test that locks in both the cleanup contract AND
the "no temp file backs a prompt" invariant.

**Deliverable** (1 new production module + 1 new test file; **no** existing
source files modified, **no** config, **no** new dependencies, **no** edits
to S1's `src/agents/prompt-delivery.ts`):

1. **`src/core/temp-prompt-cleanup.ts`** (NEW) — a dependency-free (node:fs +
   node:os + node:path only), module-level temp-file cleanup registry that
   mirrors `src/core/file-lock.ts:347,577-615` verbatim in structure:
   - a module-level `Set<string>` registry (`_trackedTempPromptFiles`);
   - `registerTempPromptFile(path)` / `unregisterTempPromptFile(path)` /
     `isTempPromptFileTracked(path)` (mutate/query the registry, symmetric
     add/delete like `_heldLockPaths`);
   - `cleanupTrackedTempPromptFiles()` — an idempotent iterator
     (`for ... of` + a never-throwing `tryUnlink`) over the registry, called
     by all three handlers (matches `cleanupHeldLocks`);
   - `onTempCleanupSignal(code, mockExit = c => process.exit(c))` — the
     testable handler with the injectable exit seam (matches
     `onLockCleanupSignal`);
   - `onTempSIGINTCleanup()` → 130 and `onTempSIGTERMCleanup()` → 143 —
     thin NAMED wrappers (never an inline arrow in `process.on(...)`, matching
     the file-lock.ts coverability rule);
   - the three top-level `process.on('exit', …)`, `process.on('SIGINT', …)`,
     `process.on('SIGTERM', …)` registrations (module-load, registered ONCE,
     no `process.off`);
   - JSDoc on EVERY export + the module header, citing PRD §9.3.3 verbatim
     and documenting the **SIGKILL/power-loss best-effort limitation**
     ("signal handlers do NOT fire on SIGKILL/OOM/segfault/power-loss; this
     is best-effort — re-write-on-every-attempt (PRD §9.3.3) is the primary
     mitigation, and programmatic prompt delivery means no temp file backs a
     prompt today").
   - `writeTempPromptFile(targetPath, content)` — the retry-aware write
     helper that ALWAYS `(re-)writes` the file AND `registerTempPromptFile`s
     it on every call (so any retry loop using it re-writes on every attempt
     by construction, satisfying the §9.3.3 retry clause). Returns the path.
   - a module-level audit comment summarizing the S1 verdict ("no temp file
     backs a prompt today — see
     `plan/008_15504f60a0ef/P3M2T6S1/PRP.md` +
     `research/01_summary.md`").
2. **`tests/unit/core/temp-prompt-cleanup.test.ts`** (NEW) — the regression
   suite (vitest, mirroring `tests/unit/core/file-lock.test.ts:413-471`):
   - **registry + write helper** — register/unregister/query, idempotent
     double-unregister, `writeTempPromptFile` re-writes + re-registers on
     every call (writes 3× via a simulated retry factory, asserts content
     reflects the LAST write + the path is tracked exactly once);
   - **cleanup iterator** — registers 2 real temp files in `os.tmpdir()`,
     calls `cleanupTrackedTempPromptFiles()`, asserts BOTH unlinked from disk
     AND the iterator is idempotent (a second call is a safe no-op);
   - **signal handlers** — `onTempCleanupSignal(code, mockExit)` with the
     explicit-injectable Variant A AND the `vi.spyOn(process,'exit')` Variant
     B; `onTempSIGINTCleanup()` → 130, `onTempSIGTERMCleanup()` → 143; the
     `mockExit` default re-resolves `process.exit` at call time (proven by
     the spy test);
   - **"no temp file backs a prompt today" static invariant** — reads the
     agent-runtime source files at runtime (`src/agents/prp-executor.ts`,
     `src/agents/prp-generator.ts`, `src/agents/prp-runtime.ts`,
     `src/agents/agent-factory.ts`, `src/tools/bash-mcp.ts`) via
     `readFileSync` and asserts NONE writes a prompt to a temp file to back
     delivery (a targeted scanner; excludes legitimate output/state/test
     sites — see Implementation Blueprint). Plus a sentinel assertion that
     S1's `isPromptDeliveryProgrammatic === true` still holds (ties the two
     halves of §9.3.3 together);
   - **SIGKILL-limitation documentation assertion** — asserts the production
     module's JSDoc/source literally contains the `SIGKILL` + `power-loss`
     limitation text (locks the documentation in place so a future edit
     cannot silently drop it).

**Success Definition**:
- A module-level `Set<string>` registry tracks temp-prompt-file paths and is
  cleaned on `process.on('exit'/'SIGINT'/'SIGTERM')` exactly as
  `file-lock.ts` cleans `_heldLockPaths` (named wrappers, injectable exit
  seam, idempotent iterator).
- `cleanupTrackedTempPromptFiles()` unlinks every tracked file from disk and
  is a safe no-op when called twice (idempotency is load-bearing: the `exit`
  event fires after a signal handler's `process.exit()`).
- `writeTempPromptFile(path, content)` ALWAYS (re-)writes AND registers — so
  a retry loop calling it re-writes on every attempt (PRD §9.3.3 retry
  clause).
- The SIGKILL/power-loss limitation is documented IN CODE (JSDoc + module
  comment) AND asserted IN TEST (a literal-substring check).
- The "no temp file backs a prompt today" invariant is locked by a static
  scan that FAILS LOUDLY if a future commit backs a prompt with a temp file
  without going through this module.
- `npm run validate` GREEN.
- `git diff --name-only` shows EXACTLY `src/core/temp-prompt-cleanup.ts` and
  `tests/unit/core/temp-prompt-cleanup.test.ts` (zero overlap with S1's
  `src/agents/prompt-delivery.ts` / `tests/unit/agents/prompt-delivery.test.ts`,
  and zero overlap with any other sibling PRP).

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline (no human in the loop), transitively
future maintainers. This subtask has **no runtime behavior change today**:
the registry is empty at steady state (no temp file backs a prompt), so the
cleanup handlers iterate an empty `Set` and the `exit`/signal registrations
are harmless no-ops. The persona is "the developer six months from now who
adds a harness or tool that genuinely needs to back a prompt with a temp
file" — this PRP gives them a correct, registry-tracked, retry-aware, exit-
cleaned primitive (`writeTempPromptFile`) instead of forcing them to invent
one (and almost certainly forget the exit handler).

**Use Case**: A future maintainer adds a `codex` harness whose SDK requires
the prompt on stdin via a temp file. They write
`const p = await writeTempPromptFile(tmpPath, prompt)` before each
`spawn('codex', ['--prompt-file', p])`, wrapped in a `retryAgentPrompt`
factory. On every retry the factory re-runs → `writeTempPromptFile` re-writes
+ re-registers → the temp file survives `/tmp` mid-run sweeps (PRD §9.3.3
retry clause). On SIGINT/SIGTERM/exit the registry cleans the file. If the
process is SIGKILLed, the file leaks — documented as best-effort (the re-
write-on-every-attempt design means the NEXT attempt's fresh file supersedes
the stale one, so the leak is harmless).

**User Journey**: CI runs `npm run validate` → `vitest run` executes
`temp-prompt-cleanup.test.ts` → (a) the cleanup contract tests prove the
registry + handlers behave exactly like `file-lock.ts`; (b) the static-
invariant scan proves no agent prompt is backed by a temp file today; (c)
the SIGKILL-documentation assertion proves the limitation is documented. All
GREEN. If a future commit backs a prompt with a raw `writeFile` to a temp
path (bypassing `writeTempPromptFile`), the static-invariant scan FAILS in
CI, blocking the merge.

**Pain Points Addressed**: PRD §9.3.3 — the silent temp-file leak that occurs
when (a) a temp-file-backed prompt is abandoned on a crash, and (b) a retry
loop writes the temp file once then fails forever after a `/tmp` sweep. Today
the pipeline is safe by construction (no temp files back prompts), but
nothing ENFORCES that or PROVIDES the correct primitive for the future. This
PRP converts "safe by happenstance" into "safe by test" AND ships the
correct, registry-aware primitive so the future path of least resistance is
the correct one.

---

## Why

- **PRD compliance**: PRD §9.3.3 (h4.10) quotes verbatim:
  > Any temp files backing these prompts MUST be cleaned up on both graceful
  > and hard-killed (SIGTERM/SIGKILL/power-loss) exits. When a temp file
  > backs a retry loop, it MUST be (re-)written on *every* attempt…
  This PRP implements the **temp-file-cleanup + retry-resilience** clauses.
  The argv half is S1 (already implemented in parallel; out of scope here).
- **Work-item contract (LOGIC)** — item-by-item mapping:
  - **(a) Identify any temp files used to back agent prompts (search for
    `tmpdir`, `mkdtemp`, `writeFile` to temp paths in prompt-related
    code).** → research/01 §"All temp-file write sites audited (24)" is the
    audit; the static-invariant test (Task 3) re-runs it in CI on every
    commit. AUDIT RESULT: **NONE**. (Confirmed independently by S1's audit
    and by scout1 — see research/01 §VERDICT.)
  - **(b) Register cleanup handlers: `process.on('SIGTERM')`,
    `process.on('SIGINT')`, `process.on('exit')` that clean up temp prompt
    files. For SIGKILL/power-loss, this is best-effort (no handler can run);
    document the limitation.** → Task 1 implements the three handlers
    (mirroring `file-lock.ts:613-615`), and Task 1's JSDoc + Task 3's
    documentation-assertion test document the SIGKILL/power-loss limitation.
  - **(c) When a temp file backs a retry loop, ensure it is re-written on
    every attempt (not just the first).** → Task 1's `writeTempPromptFile`
    ALWAYS (re-)writes + registers on every call; any retry loop using it
    re-writes on every attempt by construction (Task 2's retry-factory test
    proves this). Today no retry loop uses it (the prompt is in-memory), so
    the clause is satisfied vacuously AND the correct primitive is ready for
    the future.
  - **(d) Add a module-level cleanup registry that tracks temp file paths
    and removes them on exit.** → Task 1's `_trackedTempPromptFiles` +
    `registerTempPromptFile`/`unregisterTempPromptFile`/`cleanupTrackedTempPromptFiles`,
    mirroring `_heldLockPaths` + `cleanupHeldLocks`.
- **Contract item 2 (INPUT)**: *"Audit results from P3.M2.T6.S1."* → This
  PRP consumes S1's audit conclusion (no argv prompt delivery, hence no temp
  file backing a prompt — because programmatic delivery needs none) as its
  foundational premise. S1's `src/agents/prompt-delivery.ts`
  `isPromptDeliveryProgrammatic` sentinel is asserted in the test (Task 3)
  to tie the two halves of §9.3.3 together.
- **Contract item 4 (OUTPUT)**: *"Temp-file cleanup on exit. Completes
  P3.M2.T6 and P3.M2."* → This PRP delivers the cleanup-on-exit
  infrastructure + the regression guard. It is the final subtask of P3.M2.T6
  (and thus of P3.M2).
- **Contract item 5 (DOCS)**: *"none — no user-facing/config/API surface
  change."* → Mode A only. JSDoc on every export + module header citing PRD
  §9.3.3 verbatim and documenting the SIGKILL/power-loss limitation. No
  `.env.example`, no `docs/`, no README.
- **No overlap with sibling PRPs**: S1 owns `src/agents/prompt-delivery.ts` +
  `tests/unit/agents/prompt-delivery.test.ts` (DO NOT TOUCH — both exist);
  P3.M2.T5.S1 owns `src/core/task-orchestrator.ts`; P3.M2.T4.S2 owns
  `src/tools/git-mcp.ts` + `src/utils/git-commit.ts`. This PRP touches
  NEITHER — it adds `src/core/temp-prompt-cleanup.ts` (new) and
  `tests/unit/core/temp-prompt-cleanup.test.ts` (new). `src/core/file-lock.ts`
  is READ as the template but NOT modified.

---

## What

One new production module (`src/core/temp-prompt-cleanup.ts`), one new test
file (`tests/unit/core/temp-prompt-cleanup.test.ts`). **No** existing source
files modified, **no** config, **no** new dependencies, **no** edits to S1's
`src/agents/prompt-delivery.ts`, **no** workflow/harness/CLI changes.

### Success Criteria

- [ ] **`src/core/temp-prompt-cleanup.ts`** (NEW) exports:
      - `export function registerTempPromptFile(path: string): void` — adds
        `path` to the module-level `_trackedTempPromptFiles` Set (idempotent
        re-add). JSDoc cites PRD §9.3.3 + the symmetric delete contract.
      - `export function unregisterTempPromptFile(path: string): void` —
        deletes `path` from the Set (idempotent re-delete; safe to call on an
        untracked path). JSDoc notes it does NOT unlink (the caller unlinks
        explicitly or relies on cleanup).
      - `export function isTempPromptFileTracked(path: string): boolean` —
        Set membership query (test introspection).
      - `export function cleanupTrackedTempPromptFiles(): void` — iterates
        the Set, `tryUnlink`s each (NEVER throws; ENOENT swallowed), and
        clears the Set. JSDoc: idempotent; called by all three handlers;
        "Does NOT help for SIGKILL/OOM/segfault/power-loss — signal handlers
        do NOT fire there (best-effort, PRD §9.3.3); re-write-on-every-attempt
        is the primary mitigation."
      - `export function onTempCleanupSignal(code: number, mockExit:
        (code: number) => void = c => process.exit(c)): void` — cleanup then
        `mockExit(code)`. Injectable exit seam (MUST be
        `c => process.exit(c)`, re-resolving at call time so a
        `vi.spyOn(process,'exit')` test is hit). JSDoc: 130 = SIGINT, 143 =
        SIGTERM.
      - `export function onTempSIGINTCleanup(): void` —
        `onTempCleanupSignal(130)`. Named wrapper (no inline arrow in
        `process.on`).
      - `export function onTempSIGTERMCleanup(): void` —
        `onTempCleanupSignal(143)`. Named wrapper.
      - `export async function writeTempPromptFile(targetPath: string,
        content: string): Promise<string>` — ALWAYS `writeFile(targetPath,
        content)` THEN `registerTempPromptFile(targetPath)`, returns
        `targetPath`. JSDoc: "re-writes + re-registers on EVERY call — PRD
        §9.3.3 retry clause. Use inside a `retryAgentPrompt` factory so every
        attempt re-writes (survives /tmp sweeps). Does NOT unregister; the
        exit/signal handlers clean up."
      - three top-level registrations (module-load, once):
        `process.on('exit', cleanupTrackedTempPromptFiles)`,
        `process.on('SIGINT', onTempSIGINTCleanup)`,
        `process.on('SIGTERM', onTempSIGTERMCleanup)`.
      - a module header comment summarizing the S1 verdict + the
        SIGKILL/power-loss limitation + the PRD §9.3.3 citation.
      - a private `tryUnlink(path: string): boolean` (NOT exported, mirrors
        file-lock.ts) that `unlinkSync`s and swallows ALL errors.
- [ ] **`tests/unit/core/temp-prompt-cleanup.test.ts`** (NEW):
      - **`describe('temp-prompt-file registry')`**: register adds to Set
        (`isTempPromptFileTracked` true); unregister removes (false);
        double-unregister is a safe no-op; querying an untracked path is
        false.
      - **`describe('writeTempPromptFile — retry resilience (PRD §9.3.3)')`**:
        simulate a retry factory — call `writeTempPromptFile(p, contentN)`
        3× with different content, assert (a) the file on disk reflects the
        THIRD write, (b) `isTempPromptFileTracked(p)` is true (registered
        exactly once — Set dedupes), (c) writing to a NEW path registers it
        too. Use real `os.tmpdir()` files; clean up in `afterEach`.
      - **`describe('cleanupTrackedTempPromptFiles')`**: register 2 real
        temp files (write them via `writeFile`), call cleanup, assert
        `!existsSync` for both + the Set is cleared (`isTempPromptFileTracked`
        false); call cleanup AGAIN → no throw (idempotency, the load-bearing
        invariant: `exit` fires after a signal handler's `process.exit()`).
      - **`describe('process cleanup handlers')`** (mirrors
        `file-lock.test.ts:413-471`): `afterEach(() =>
        vi.restoreAllMocks())`; **Variant A** — `onTempCleanupSignal(130, c
        => { exitCode = c })` asserts cleanup ran (a real temp file
        registered before the call is unlinked) + `exitCode === 130`;
        **Variant B** — `vi.spyOn(process,'exit').mockImplementation(((c?) =>
        { exitCode = c }) as never)` then `onTempSIGINTCleanup()` asserts
        `exitCode === 130` + spy called with 130 (proves the default param
        re-resolves `process.exit`); same for `onTempSIGTERMCleanup()` → 143.
      - **`describe('static invariant — no temp file backs a prompt today
        (PRD §9.3.3)')`**: read the 5 agent-runtime source files via
        `readFileSync(resolve(process.cwd(), 'src/agents/...'))` +
        `src/tools/bash-mcp.ts`; define a scanner (see Implementation
        Blueprint) that flags a `writeFile*`/`mkdtemp*`/`tmpdir()`/`.tmp`
        call that ALSO references a prompt-named identifier within a bounded
        look-ahead; assert the scanner returns `[]` for all 5 files today;
        PLUS a scanner self-test (a contrived
        `writeFile(tmpPath, injectedPrompt)` MUST match — proves the scanner
        is not a no-op); PLUS a sentinel assertion
        `expect(isPromptDeliveryProgrammatic).toBe(true)` imported from S1's
        `src/agents/prompt-delivery.ts` (ties the two §9.3.3 halves).
      - **`describe('SIGKILL / power-loss limitation is documented (PRD
        §9.3.3)')`**: read `src/core/temp-prompt-cleanup.ts` source via
        `readFileSync`; assert the source literally contains `SIGKILL` AND
        `power-loss` AND `best-effort` (locks the documentation in place so
        a future edit cannot silently drop it — the test FAILS if someone
        deletes the limitation note).
- [ ] `npm run validate` GREEN.
- [ ] `git diff --name-only` shows EXACTLY `src/core/temp-prompt-cleanup.ts`
      and `tests/unit/core/temp-prompt-cleanup.test.ts`.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — YES. This PRP names: the exact
template to mirror (`src/core/file-lock.ts:347,577-615`, with the verbatim
code for the registry, the idempotent cleanup iterator, the injectable-exit
signal handler, the named 130/143 wrappers, and the three module-level
`process.on(...)` lines); the exact test template to mirror
(`tests/unit/core/file-lock.test.ts:413-471` with the two `mockExit`
variants); the exact audit result that makes this PREVENTIVE not TARGETED
(research/01 §VERDICT: no temp file backs a prompt); the exact retry-path
call site (`prp-executor.ts:332-333` via `retryAgentPrompt` taking a
`() => Promise<T>` factory) that motivates the re-write-on-every-attempt
helper; the exact sibling boundaries (S1's `prompt-delivery.ts` exists and is
read-only to this PRP; no other file is touched); and the explicit
SIGKILL/power-loss documentation requirement (asserted in test).

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- url: https://nodejs.org/api/process.html#event-exit
  why: 'exit' event semantics — fires AFTER process.exit() is called; process.exit() called
        from within an 'exit' listener is ignored. Load-bearing for why the exit handler is
        cleanup-only and why cleanup runs twice (signal → exit) — idempotency is REQUIRED.

- url: https://nodejs.org/api/process.html#signal-events
  why: SIGTERM/SIGINT are catchable; SIGKILL cannot be caught (PRD §9.3.3 hard clause). Documents
        the 'beforeExit' vs 'exit' distinction and that signal handlers must call process.exit()
        themselves (Node does NOT default-exit on SIGTERM/SIGINT in all cases).

- file: src/core/file-lock.ts
  section: lines 347, 577-615 (registry + cleanup + handlers + registrations)
  why: THE CANONICAL TEMPLATE. S2 mirrors this verbatim in structure. _heldLockPaths Set →
        _trackedTempPromptFiles Set; cleanupHeldLocks → cleanupTrackedTempPromptFiles;
        onLockCleanupSignal(code, mockExit) → onTempCleanupSignal(code, mockExit);
        onSIGINTCleanup/onSIGTERMCleanup → onTempSIGINTCleanup/onTempSIGTERMCleanup;
        process.on('exit'/'SIGINT'/'SIGTERM') → identical three lines. READ-ONLY — do NOT modify.
  pattern: module-level Set registry; symmetric add/delete; idempotent tryUnlink iterator;
        injectable-exit signal handler; named wrappers (no inline arrow in process.on); top-level
        registration (once, no process.off).
  gotcha: the SIGKILL/OOM/segfault limitation is documented in JSDoc (line 568: "Does NOT help for
        SIGKILL/OOM/segfault"). S2 must replicate this doc for SIGKILL/power-loss.

- file: src/core/file-lock.ts
  section: tryUnlink (~lines 297-307) + releaseFileLock (~284-292)
  why: the idempotent, never-throwing unlink primitive. S2's private tryUnlink MUST mirror this
        (unlinkSync inside try/catch that swallows ALL errors → returns boolean). This is what
        makes double-cleanup (signal then exit) safe.

- file: tests/unit/core/file-lock.test.ts
  section: lines 413-471 (describe('process cleanup handlers'))
  why: THE TEST TEMPLATE. Variant A (explicit injectable: onLockCleanupSignal(130, c => {exitCode=c}))
        and Variant B (vi.spyOn(process,'exit').mockImplementation(((c?)=>{exitCode=c}) as never)).
        afterEach(() => vi.restoreAllMocks()). S2's handler tests mirror these two variants.
  gotcha: the `as never` cast on the spy mock is REQUIRED (TS process.exit signature differs). The
        Variant B spy works ONLY because the default param `c => process.exit(c)` re-resolves
        process.exit at call time — keep that default exactly.

- file: src/agents/prp-executor.ts
  section: lines 332-333 (retryAgentPrompt(() => withAgentDeadline(this.#coderAgent.prompt(injectedPrompt))))
  why: THE retry call site. retryAgentPrompt takes a () => Promise<T> FACTORY and re-invokes on each
        retry — this is why writeTempPromptFile must (re-)write on EVERY call (so a retry loop using
        it re-writes on every attempt by construction). Today injectedPrompt is in-memory (no temp
        file), so the §9.3.3 retry clause is satisfied VACUOUSLY; writeTempPromptFile is the correct
        primitive for the future. READ-ONLY.

- file: src/utils/retry.ts
  section: retryAgentPrompt signature (line 686)
  why: confirms retryAgentPrompt(agentPromptFn: () => Promise<T>, context) re-invokes the factory on
        each retry. Justifies writeTempPromptFile's "always re-write" contract.

- file: src/agents/prompt-delivery.ts
  why: S1's module (argv half of §9.3.3). S2 IMPORTS isPromptDeliveryProgrammatic from it (ties the
        two halves in the sentinel test). DO NOT MODIFY (S1 owns it; it already exists with exports
        MAX_ARG_STRLEN, assertPromptNotRoutedViaArgv, isPromptDeliveryProgrammatic). READ-ONLY to S2.

- file: tests/unit/agents/prompt-delivery.test.ts
  why: S1's test (argv half). DO NOT MODIFY. Read-only reference for the static-scan test style S2's
        "no temp file backs a prompt" scanner mirrors (readFileSync + bounded regex + self-test).

- file: node_modules/groundswell/dist/harnesses/pi-harness.js
  section: line 245 (await session.prompt(request.prompt))
  why: proof prompts are delivered programmatically (in-process SDK call), NOT via temp file.
        research/01 §VERDICT. READ-ONLY (published dependency).

- file: vitest.config.ts
  why: confirms vitest runs from repo root (tests import via ../../../src/...). resolve(process.cwd(),
        'src/agents/...') in the static-invariant test resolves correctly. pool: 'forks' (each test
        file in its own fork — the process.on registrations in temp-prompt-cleanup.ts do NOT pollute
        other test files). setupFiles: ['./tests/setup.ts'].

- file: plan/008_15504f60a0ef/P3M2T6S1/PRP.md
  why: the SIBLING PRP (argv half of §9.3.3). Its audit conclusion (no argv, hence no temp file
        backing a prompt) is S2's foundational premise. Its prompt-delivery.ts exports are imported
        by S2's test. Read to understand the two halves compose.

- file: plan/008_15504f60a0ef/P3M2T6S2/research/01_summary.md
  why: S2's own audit summary. §VERDICT (no temp file backs a prompt → PREVENTIVE strategy); the
        file-lock.ts template table; the test template; the retry path; all 24 temp-file write sites
        classified (none backs a prompt); SIGKILL/power-loss limitation analysis. The implementer
        MUST read this before writing the module.
```

### Current Codebase tree (relevant slice)

```bash
src/core/
  file-lock.ts                 # TEMPLATE (read-only) — _heldLockPaths Set, cleanupHeldLocks,
                               #   onLockCleanupSignal(code,mockExit), onSIGINTCleanup(130)/onSIGTERMCleanup(143),
                               #   process.on('exit'/'SIGINT'/'SIGTERM') at module top level. tryUnlink idempotent primitive.
  session-utils.ts             # (not modified) atomicWrite temp+rename for tasks.json/PRP — NOT prompt-related.
src/agents/
  prompt-delivery.ts           # S1's module (read-only) — isPromptDeliveryProgrammatic sentinel imported by S2's test.
  prp-executor.ts              # (read-only) retryAgentPrompt(() => ...prompt(injectedPrompt)) at L332 — retry call site.
src/utils/
  retry.ts                     # (read-only) retryAgentSignature: () => Promise<T> factory re-invoked per retry.
tests/unit/core/
  file-lock.test.ts            # TEMPLATE (read-only) — describe('process cleanup handlers') L413-471, mockExit variants A/B.
  (no temp-prompt-cleanup.test.ts yet — NEW file this PRP)
tests/unit/agents/
  prompt-delivery.test.ts      # S1's test (read-only) — static-scan style reference.
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/core/
  temp-prompt-cleanup.ts       # NEW — module-level temp-prompt-file cleanup registry mirroring file-lock.ts:
                               #   _trackedTempPromptFiles Set; register/unregister/isTracked;
                               #   cleanupTrackedTempPromptFiles (idempotent tryUnlink iterator); onTempCleanupSignal
                               #   (code, injectable mockExit); onTempSIGINTCleanup(130)/onTempSIGTERMCleanup(143);
                               #   three process.on(...) registrations at module top level; writeTempPromptFile
                               #   (ALWAYS re-write + register — PRD §9.3.3 retry clause); SIGKILL/power-loss
                               #   limitation in JSDoc + module header; S1 verdict in module header.
tests/unit/core/
  temp-prompt-cleanup.test.ts  # NEW — (1) registry + writeTempPromptFile retry-resilience; (2) cleanupTrackedTempPromptFiles
                               #   idempotency + disk unlink; (3) signal handlers (mockExit Variant A + vi.spyOn Variant B,
                               #   130/143); (4) static-invariant scan (no temp file backs a prompt today) + scanner self-test
                               #   + isPromptDeliveryProgrammatic sentinel; (5) SIGKILL/power-loss documentation assertion.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (research/01 §VERDICT): No temp file backs any agent prompt today. This PRP is PREVENTIVE
// INFRASTRUCTURE. Do NOT invent a "fix" to a non-existent temp-file-backing-prompt bug. The module
// ships an empty-at-steady-state registry + exit handlers that are harmless no-ops today, PLUS the
// correct retry-aware primitive (writeTempPromptFile) for the future, PLUS the regression guard.

// CRITICAL (idempotency is load-bearing): On SIGINT, the flow is onTempSIGINTCleanup →
// cleanupTrackedTempPromptFiles → mockExit(130) → process.exit(130) → Node fires 'exit' →
// cleanupTrackedTempPromptFiles runs AGAIN. This is safe ONLY because tryUnlink swallows ENOENT and
// never throws, AND because cleanup clears the Set on the first run (the second run iterates an empty
// Set). DO NOT write a cleanup that throws on double-removal or that does not clear the Set.

// CRITICAL (process.exit is illegal inside 'exit' handler): The 'exit' handler MUST be
// cleanupTrackedTempPromptFiles (cleanup only), NOT onTempCleanupSignal (which calls process.exit —
// Node ignores process.exit called from within an 'exit' listener). The signal handlers are the ones
// that call exit. Mirror file-lock.ts:613 exactly (process.on('exit', cleanupFn); not the signal fn).

// CRITICAL (mockExit default MUST re-resolve process.exit at call time): The default param MUST be
// `= c => process.exit(c)` (a function EXPRESSION that re-reads process.exit when called), NOT a
// captured reference (`const realExit = process.exit; … = c => realExit(c)`). The Variant B test
// (vi.spyOn(process,'exit')) works ONLY because the default re-resolves the spy. file-lock.ts:595.

// CRITICAL (no process.off for module-level): file-lock.ts has ZERO process.off. The handlers are
// registered once at module load and outlive every run. DO NOT add process.off (it would re-introduce
// the leak on the next run). vitest pool:'forks' isolates test files, so the registration does not
// pollute other tests.

// GOTCHA (named wrappers, never inline arrow in process.on): process.on('SIGINT', onTempSIGINTCleanup)
// uses a NAMED reference, never `process.on('SIGINT', () => {...})`. The anonymous arrow would be an
// uncoverable registration site (file-lock.ts:601-611 JSDoc: "exported so the registration site has
// no anonymous arrow body that would otherwise be uncoverable"). The wrappers exist for THIS reason.

// GOTCHA (exit codes): 128 + signum. SIGINT=2 → 130. SIGTERM=15 → 143. Shell convention; mirror file-lock.ts.

// GOTCHA (scanner must not over-match): the "no temp file backs a prompt" scanner targets the PROMPT
// DELIVERY PATH. Many legitimate writeFile sites exist (PRP artifacts, tasks.json, metrics, MCP
// filesystem tool, test fixtures — research/01 §"All temp-file write sites audited (24)"). The scanner
// must flag a writeFile/mkdtemp/tmpdir/.tmp call that ALSO references a prompt-named identifier
// (injectedPrompt, fixPrompt, request.prompt, \w+Prompt) within a bounded look-ahead — NOT a blanket
// ban on writeFile. Exclude src/scripts/** (validate-groundswell.ts legitimately mkstemps test fixtures).

// GOTCHA (scanner self-test is mandatory): without a self-test (a contrived
// `writeFile(tmpPath, injectedPrompt)` that MUST match), a too-loose scanner (e.g. one that never
// matches) would make the invariant test vacuously pass. The self-test proves the scanner CAN match.

// GOTCHA (writeTempPromptFile does NOT unregister): the helper writes + registers; it does NOT
// unregister (unregister would defeat exit cleanup). The exit/signal handlers clean up. If a caller
// wants to clean a file eagerly mid-run, they call unregisterTempPromptFile + their own unlink — but
// the default lifecycle is "register on write, clean on exit."

// GOTCHA (no new dependencies): temp-prompt-cleanup.ts uses only node:fs (unlinkSync, writeFileSync),
// node:os (tmpdir — only in the TEST), node:path. No groundswell, no new npm packages. Keep it
// dependency-free so the registry can never be blocked by a missing dep.

// GOTCHA (do not overlap S1): src/agents/prompt-delivery.ts + tests/unit/agents/prompt-delivery.test.ts
// are S1's. They ALREADY EXIST. S2 IMPORTS isPromptDeliveryProgrammatic from prompt-delivery.ts (for
// the sentinel test) but does NOT modify either file. S2's git diff is EXACTLY two new files under
// src/core/ and tests/unit/core/.

// GOTCHA (pool:'forks' isolates process.on registrations): vitest.config.ts uses pool:'forks', so each
// test file runs in its own fork. The module-level process.on(...) registrations in temp-prompt-cleanup.ts
// fire when the module is imported (by the test) and are torn down with the fork. They do NOT leak into
// other test files and do NOT affect the main vitest process. (file-lock.ts has the same module-level
// registrations and its tests pass for the same reason.)
```

---

## Implementation Blueprint

### Data models and structure

No domain models. The module is a module-level `Set<string>` registry + leaf
functions + one async write helper. Mirrors `file-lock.ts` structure exactly.

```typescript
/**
 * (Module comment — Mode A) PRD §9.3.3 "Prompt Delivery (no argv-size limit)" —
 * TEMP-FILE CLEANUP HALF. (The argv half is src/agents/prompt-delivery.ts, P3.M2.T6.S1.)
 *
 * AUDIT RESULT (P3.M2.T6.S2): NO temp file backs any agent prompt today. Every
 * prompt flows Prompt.buildUserMessage() → HarnessRequest.prompt → the in-process
 * harness SDK (Pi: session.prompt(request.prompt) at groundswell pi-harness.js:245;
 * Claude-Code: sdk.query({prompt}) at claude-code-harness.js:393). See
 * plan/008_15504f60a0ef/P3M2T6S1/PRP.md + plan/008_15504f60a0ef/P3M2T6S2/research/01_summary.md.
 *
 * This module is PREVENTIVE INFRASTRUCTURE: a module-level registry + exit/signal
 * handlers (mirroring src/core/file-lock.ts) ready for any future temp-file-backed
 * prompt, plus a retry-aware write helper (writeTempPromptFile) that re-writes +
 * registers on EVERY call (PRD §9.3.3 retry clause).
 *
 * SIGKILL / POWER-LOSS LIMITATION (PRD §9.3.3, best-effort): signal handlers do
 * NOT fire on SIGKILL/OOM/segfault/power-loss. Cleanup is therefore best-effort
 * for those cases. The primary mitigation is re-write-on-every-attempt (a fresh
 * temp file supersedes any stale one) — see writeTempPromptFile. This matches the
 * file-lock.ts precedent (its PID+mtime stale-lock detector handles SIGKILL; for
 * temp files the re-write design makes a stale leak harmless).
 */
import { unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getLogger } from '../utils/logger.js'; // optional; file-lock.ts uses console-free logging.
// (If a logger is desired, mirror file-lock.ts's getLogger usage. A leaf module may also stay
//  logger-free and rely on the caller's logging. Prefer logger-free to keep the module dependency-light;
//  if used, lazy-instantiate like session-utils.ts: `let _logger; const logger = () => (_logger ??= getLogger(...))`.)

/**
 * Module-level registry of temp-prompt-file paths currently tracked by THIS process,
 * for best-effort cleanup on graceful exit / signal handlers. Mirrors file-lock.ts's
 * _heldLockPaths. The registry is mutated in symmetric add/delete pairs.
 *
 * @internal
 */
const _trackedTempPromptFiles = new Set<string>();

/**
 * Idempotent, never-throwing unlink. Mirrors file-lock.ts tryUnlink. Swallows ALL
 * errors (ENOENT race, EACCES) so cleanup can run twice (signal → exit) safely.
 */
function tryUnlink(p: string): boolean {
  try {
    unlinkSync(p);
    return true;
  } catch {
    return false; // already gone / no permission — fine.
  }
}

/** Register a temp-prompt-file path for exit cleanup (idempotent re-add). PRD §9.3.3. */
export function registerTempPromptFile(path: string): void {
  _trackedTempPromptFiles.add(path);
}

/** Unregister a temp-prompt-file path (idempotent re-delete; does NOT unlink). */
export function unregisterTempPromptFile(path: string): void {
  _trackedTempPromptFiles.delete(path);
}

/** @returns whether `path` is currently tracked. (Test introspection.) */
export function isTempPromptFileTracked(path: string): boolean {
  return _trackedTempPromptFiles.has(path);
}

/**
 * Unlink every tracked temp-prompt-file and clear the registry. Idempotent (a second
 * call iterates an empty Set + tryUnlink swallows ENOENT). Called by all three handlers.
 *
 * Does NOT help for SIGKILL/OOM/segfault/power-loss — signal handlers do NOT fire there
 * (best-effort, PRD §9.3.3). Re-write-on-every-attempt (writeTempPromptFile) is the
 * primary mitigation for those cases.
 *
 * @internal
 */
export function cleanupTrackedTempPromptFiles(): void {
  for (const p of _trackedTempPromptFiles) {
    tryUnlink(p);
  }
  _trackedTempPromptFiles.clear();
}

/**
 * Signal/exit handler: clean up tracked temp-prompt-files, then exit with `code`.
 * Injectable `mockExit` (defaults to `c => process.exit(c)`, re-resolving at call time
 * so a vi.spyOn(process,'exit') test is hit). Mirrors file-lock.ts onLockCleanupSignal.
 *
 * @param code - 130 = SIGINT, 143 = SIGTERM.
 * @param mockExit - Injectable exit hook for testability.
 * @internal
 */
export function onTempCleanupSignal(
  code: number,
  mockExit: (code: number) => void = c => process.exit(c)
): void {
  cleanupTrackedTempPromptFiles();
  mockExit(code);
}

/** Registered SIGINT handler (named, not an inline arrow — coverable). @internal */
export function onTempSIGINTCleanup(): void {
  onTempCleanupSignal(130);
}

/** Registered SIGTERM handler (named, not an inline arrow — coverable). @internal */
export function onTempSIGTERMCleanup(): void {
  onTempCleanupSignal(143);
}

// Module-load registration (once per process; mirrors file-lock.ts:613-615). NO process.off.
process.on('exit', cleanupTrackedTempPromptFiles);
process.on('SIGINT', onTempSIGINTCleanup);
process.on('SIGTERM', onTempSIGTERMCleanup);

/**
 * (Re-)write a temp-prompt-file and register it for exit cleanup. PRD §9.3.3 retry clause:
 * ALWAYS re-writes + re-registers on EVERY call, so a retry loop using this helper re-writes
 * the temp file on every attempt (survives a /tmp mid-run sweep). Use inside a retryAgentPrompt
 * factory: `retryAgentPrompt(() => { const p = await writeTempPromptFile(tmp, prompt); return deliver(p); })`.
 *
 * Does NOT unregister (the exit/signal handlers clean up). Returns targetPath for chaining.
 */
export async function writeTempPromptFile(
  targetPath: string,
  content: string
): Promise<string> {
  writeFileSync(targetPath, content, { mode: 0o644 });
  registerTempPromptFile(targetPath);
  return targetPath;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/core/temp-prompt-cleanup.ts
  - IMPLEMENT: the module header comment (S1 verdict + SIGKILL/power-loss limitation + PRD §9.3.3
    citation); _trackedTempPromptFiles Set; private tryUnlink (idempotent, never-throwing, mirrors
    file-lock.ts); registerTempPromptFile/unregisterTempPromptFile/isTempPromptFileTracked;
    cleanupTrackedTempPromptFiles (for-of + tryUnlink + Set.clear); onTempCleanupSignal(code, mockExit
    = c => process.exit(c)); onTempSIGINTCleanup(130)/onTempSIGTERMCleanup(143); the three process.on
    ('exit'/'SIGINT'/'SIGTERM') registrations at module top level; writeTempPromptFile (writeFileSync +
    registerTempPromptFile, returns targetPath). See Data models block for exact code.
  - FOLLOW pattern: src/core/file-lock.ts:347,577-615 (structure verbatim) + tryUnlink at ~297-307.
  - NAMING: _trackedTempPromptFiles (private Set, leading underscore, @internal); camelCase functions;
    onTempSIGINTCleanup/onTempSIGTERMCleanup (named wrappers).
  - DEPENDENCIES: node:fs (unlinkSync, writeFileSync), node:path (none strictly needed — targetPath is
    caller-supplied; import dirname only if used). NO groundswell, NO new npm packages.
  - PLACEMENT: src/core/ (alongside file-lock.ts — both are module-level process-cleanup registries).
  - GOTCHA: the mockExit default MUST be `c => process.exit(c)` (re-resolves at call time). The 'exit'
    handler is cleanupTrackedTempPromptFiles (NOT onTempCleanupSignal — process.exit is illegal inside
    'exit'). NO process.off. Named wrappers only (no inline arrow in process.on).

Task 2: CREATE tests/unit/core/temp-prompt-cleanup.test.ts — registry + writeTempPromptFile + cleanup
  - IMPORT: from '../../../src/core/temp-prompt-cleanup.js' — registerTempPromptFile,
    unregisterTempPromptFile, isTempPromptFileTracked, cleanupTrackedTempPromptFiles,
    onTempCleanupSignal, onTempSIGINTCleanup, onTempSIGTERMCleanup, writeTempPromptFile.
  - IMPORT: import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'; import
    { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join, resolve } from
    'node:path'; import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'.
  - HELPER: a per-test temp dir — `let dir: string; beforeEach(() => { dir = mkdtempSync(join(tmpdir(),
    'temp-prompt-cleanup-')); }); afterEach(() => { try { for (const f of readdirSync(dir)) unlinkSync(
    join(dir, f)); rmdirSync(dir); } catch {} vi.restoreAllMocks(); });` (cleanup the dir + reset spies).
  - describe('temp-prompt-file registry'): register adds (isTracked true); unregister removes (false);
    double-unregister safe no-op; query untracked → false. Use string paths (no FS needed for these).
  - describe('writeTempPromptFile — retry resilience (PRD §9.3.3)'):
    * call writeTempPromptFile(p, 'v1') then 'v2' then 'v3' (p = join(dir,'prompt.txt')); assert
      readFileSync(p,'utf8') === 'v3' (re-written every call); assert isTempPromptFileTracked(p) === true.
    * simulate a retry factory: `const factory = async (content: string) => { const pp = await
      writeTempPromptFile(p, content); return pp; };` call 3×; assert last write wins + tracked once.
    * new path registers too: writeTempPromptFile(join(dir,'p2.txt'),'x'); isTempPromptFileTracked(...) === true.
  - describe('cleanupTrackedTempPromptFiles'): write 2 real files (writeFileSync) + registerTempPromptFile
    each; assert existsSync both true; call cleanupTrackedTempPromptFiles(); assert existsSync both FALSE
    (disk unlinked) + isTempPromptFileTracked both false (Set cleared); call cleanup AGAIN → expect(() =>
    cleanupTrackedTempPromptFiles()).not.toThrow() (idempotency — the load-bearing double-cleanup case).
  - FOLLOW pattern: tests/unit/core/file-lock.test.ts (real tmpdir + real fs, NO vi.mock('node:fs');
    SETUP/EXECUTE/VERIFY comment-block style).

Task 3: CREATE tests/unit/core/temp-prompt-cleanup.test.ts — signal handlers (mirror file-lock.test.ts:413-471)
  - describe('process cleanup handlers') with afterEach(() => vi.restoreAllMocks()):
    * Variant A (explicit injectable): register a real temp file (writeFileSync + registerTempPromptFile);
      let exitCode; onTempCleanupSignal(130, c => { exitCode = c; }); assert exitCode === 130 + the file
      was unlinked (!existsSync) + isTempPromptFileTracked false (cleanup ran before mockExit).
    * Variant B (spy): const exitSpy = vi.spyOn(process,'exit').mockImplementation((((c?: number) => {
      exitCode = c; }) as never)); onTempSIGINTCleanup(); assert exitCode === 130 + exitSpy.toHaveBeenCalled
      With(130). (Proves the default param `c => process.exit(c)` re-resolves the spy.) Repeat for
      onTempSIGTERMCleanup() → 143.
    * default-path: onTempCleanupSignal(143) with NO mock arg + the spy → exitSpy.toHaveBeenCalledWith(143).
  - GOTCHA: the `as never` cast on the spy mockImpl is REQUIRED. The spy works ONLY because the default
    param re-resolves process.exit — keep that default EXACTLY as `c => process.exit(c)`.

Task 4: CREATE tests/unit/core/temp-prompt-cleanup.test.ts — static invariant + SIGKILL-doc assertions
  - IMPORT: isPromptDeliveryProgrammatic from '../../../src/agents/prompt-delivery.js' (S1's sentinel).
  - DEFINE scanner (see Implementation Patterns):
        const PROMPT_IDENTIFIERS = ['injectedPrompt','fixPrompt','request\\.prompt','\\w+Prompt'];
        const TEMP_WRITE_RE = new RegExp(
          String.raw`\b(?:writeFile|writeFileSync|mkdtemp|mkdtempSync|tmpdir\(\))\b[^;{0,300}?\b(?:${PROMPT_IDENTIFIERS.join('|')})\b`,
          's'
        );
        function scanForTempPromptBacking(source: string): string[] { /* match-all, return substrings */ }
    NOTE: the bounded `[^;{]{0,300}?` look-ahead keeps it scoped (a temp-write call followed within ~300
    chars by a prompt identifier). Excludes src/scripts/** (legit mkdtemp test fixtures).
  - describe('static invariant — no temp file backs a prompt today (PRD §9.3.3)'):
    * for each of ['src/agents/prp-executor.ts','src/agents/prp-generator.ts','src/agents/prp-runtime.ts',
      'src/agents/agent-factory.ts','src/tools/bash-mcp.ts']: readFileSync(resolve(process.cwd(), f));
      expect(scanForTempPromptBacking(src), `${f} must not back a prompt with a temp file`).toEqual([]).
    * scanner self-test: const contrived = "writeFileSync(tmpPath, injectedPrompt);"; expect(
      scanForTempPromptBacking(contrived)).not.toEqual([]); (proves scanner is not a no-op).
    * sentinel: expect(isPromptDeliveryProgrammatic).toBe(true); (ties the two §9.3.3 halves).
  - describe('SIGKILL / power-loss limitation is documented (PRD §9.3.3)'):
    * const src = readFileSync(resolve(process.cwd(),'src/core/temp-prompt-cleanup.ts'),'utf8');
    * expect(src).toMatch(/SIGKILL/); expect(src).toMatch(/power-loss/); expect(src).toMatch(/best-effort/);
      (locks the documentation in place — FAILS if someone deletes the limitation note).
  - GOTCHA (false positives): verify the 5-file scan PASSES today (research/01 confirms no matches). If it
    FAILS, tighten the scanner (the bounded look-ahead or the identifier list). Run `npm run test:run --
    temp-prompt-cleanup` to confirm before committing.

Task 5: JSDoc (Mode A — rides with the work)
  - temp-prompt-cleanup.ts: module header (S1 verdict + SIGKILL/power-loss limitation + PRD §9.3.3 citation);
    every export gets JSDoc (register/unregister/isTracked/cleanup/onTempCleanupSignal/onTempSIGINTCleanup/
    onTempSIGTERMCleanup/writeTempPromptFile) citing PRD §9.3.3 + the file-lock.ts precedent where relevant.
  - temp-prompt-cleanup.test.ts: describe-block doc comments citing PRD §9.3.3 + research/01 for each
    invariant tested.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: the module-level registry + handlers — a 1:1 mirror of file-lock.ts:347,577-615.
//   (See Data models block for the full module. Key invariants:)
//   - _trackedTempPromptFiles is a Set<string> mutated in symmetric add/delete pairs.
//   - cleanupTrackedTempPromptFiles is idempotent (tryUnlink swallows ENOENT + Set.clear).
//   - the 'exit' handler is cleanup ONLY (process.exit is illegal inside 'exit').
//   - the signal handlers are onTempCleanupSignal(130/143) which DO call exit.
//   - the mockExit default re-resolves process.exit at call time (load-bearing for the spy test).

// PATTERN: writeTempPromptFile — retry-resilient by construction (PRD §9.3.3 retry clause).
export async function writeTempPromptFile(targetPath: string, content: string): Promise<string> {
  writeFileSync(targetPath, content, { mode: 0o644 }); // ALWAYS re-write
  registerTempPromptFile(targetPath);                  // ALWAYS (re-)register (Set dedupes)
  return targetPath;
}
//   A retry loop using it re-writes on every attempt:
//     retryAgentPrompt(async () => {
//       const p = await writeTempPromptFile(tmpPath, prompt); // fresh file every attempt
//       return deliverViaTempFile(p);
//     }, ctx);

// PATTERN: the static-invariant scanner. Flags a temp-write call whose bounded look-ahead references a
// prompt-named identifier. Zero false positives today (research/01); self-test proves it CAN match.
const PROMPT_IDENTIFIERS = ['injectedPrompt', 'fixPrompt', 'request\\.prompt', '\\w+Prompt'];
const TEMP_WRITE_RE = new RegExp(
  String.raw`\b(?:writeFile|writeFileSync|mkdtemp|mkdtempSync|tmpdir\(\))\b[^;{]{0,300}?\b(?:${PROMPT_IDENTIFIERS.join('|')})\b`,
  's'
);
function scanForTempPromptBacking(source: string): string[] {
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(TEMP_WRITE_RE);
  while ((m = re.exec(source)) !== null) {
    matches.push(m[0].replace(/\s+/g, ' ').slice(0, 120));
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return matches;
}
//   GOTCHA: the [^;{]{0,300}? bound stops at a statement terminator or block open, keeping the look-ahead
//   scoped to the same statement. If a future prompt-temp pattern uses a different shape, broaden the regex
//   — but do not over-engineer now. The self-test guards against a too-loose (always-[]) scanner.

// PATTERN: the mockExit Variant B spy test (mirrors file-lock.test.ts:436-442).
const exitSpy = vi.spyOn(process, 'exit').mockImplementation((((c?: number) => {
  exitCode = c;
}) as never) as never);
onTempSIGINTCleanup();
expect(exitCode).toBe(130);
expect(exitSpy).toHaveBeenCalledWith(130);
//   The `as never` cast is REQUIRED (TS process.exit signature differs from the spy shim).
```

### Integration Points

```yaml
NO INTEGRATION POINTS — this PRP adds a self-contained module + test. It does NOT:
  - modify DATABASE / CONFIG / ROUTES / CLI / harness / workflow / any existing source file.
  - add environment variables.
  - add npm dependencies.
  - wire writeTempPromptFile into any existing call site (there is none today — the prompt is in-memory;
    wiring it would require editing prp-executor.ts, which is FORBIDDEN by the zero-modification scope and
    would be dead code). The helper exists as the correct primitive for the future.
  - change any user-facing, config, or API surface (contract item 5: DOCS = none).
The ONLY consumers of temp-prompt-cleanup.ts are:
  - tests/unit/core/temp-prompt-cleanup.test.ts (this PRP).
  - (future, optional) any harness/tool that needs to back a prompt with a temp file — it would call
    writeTempPromptFile + the registry handles exit cleanup. This PRP does NOT wire such a call site.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after creating src/core/temp-prompt-cleanup.ts
npm run lint         # eslint . --ext .ts (the new file must pass)
npm run typecheck    # tsc --noEmit -p tsconfig.build.json
npm run format:check # prettier --check (run `npm run format` if it complains)

# Expected: Zero errors. If errors exist, READ output and fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new module
npm run test:run -- temp-prompt-cleanup

# Full suite (ensure no regression — pool:'forks' isolates the process.on registrations)
npm run test:run

# Expected: All tests pass. The new tests (registry + writeTempPromptFile + cleanup idempotency +
# signal handlers Variants A/B + static-invariant scan + scanner self-test + SIGKILL-doc assertion)
# must be GREEN. If the static-invariant scan FAILS, the scanner is too loose (tighten it). If the
# scanner self-test FAILS, the scanner is too strict (broaden the identifier list).
```

### Level 3: Integration Testing (System Validation)

```bash
# Not applicable — this PRP adds a leaf module + tests. There is no runtime integration to validate
# (no existing call site uses writeTempPromptFile; the registry is empty at steady state). The
# "integration" is: npm run validate (lint + format + typecheck + test) all GREEN.

npm run validate
# Expected: GREEN. This is the gate.

# Manual re-verification (optional, for confidence): re-run the audit grep to independently confirm
# no temp file backs a prompt in src/ (excludes src/scripts/** legit test fixtures):
grep -rnE "\b(writeFile|writeFileSync|mkdtemp|mkdtempSync|tmpdir\(\))\b" src/agents/ src/tools/ | \
  grep -iE "prompt"
# Expected: ZERO matches (this is the invariant the regression test encodes).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Verify the module-level process.on registrations do not break the vitest runner (pool:'forks').
# (file-lock.ts has the same module-level registrations and its tests pass — this is the precedent.)
npm run test:run -- temp-prompt-cleanup
# Expected: GREEN; vitest exits cleanly (the handlers are no-ops on an empty registry).

# Verify the SIGKILL/power-loss limitation is documented (the test asserts this, but a manual grep helps):
grep -nE "SIGKILL|power-loss|best-effort" src/core/temp-prompt-cleanup.ts
# Expected: matches in the module header + cleanupTrackedTempPromptFiles JSDoc.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] All new tests pass: `npm run test:run -- temp-prompt-cleanup`.
- [ ] No linting errors: `npm run lint`.
- [ ] No type errors: `npm run typecheck`.
- [ ] No formatting issues: `npm run format:check`.
- [ ] `git diff --name-only` shows EXACTLY `src/core/temp-prompt-cleanup.ts` and
      `tests/unit/core/temp-prompt-cleanup.test.ts`.

### Feature Validation

- [ ] Module-level `_trackedTempPromptFiles` Set + register/unregister/isTracked work (symmetric
      add/delete, idempotent).
- [ ] `cleanupTrackedTempPromptFiles()` unlinks every tracked file from disk AND clears the Set AND
      is a safe no-op when called twice (idempotency — the load-bearing double-cleanup case).
- [ ] `writeTempPromptFile(path, content)` ALWAYS (re-)writes + re-registers on every call (PRD
      §9.3.3 retry clause) — proven by a 3× retry-factory test asserting the LAST write wins.
- [ ] `onTempCleanupSignal(code, mockExit)` cleanup-then-exit; `onTempSIGINTCleanup()` → 130,
      `onTempSIGTERMCleanup()` → 143.
- [ ] The `mockExit` default (`c => process.exit(c)`) re-resolves `process.exit` at call time
      (proven by the Variant B `vi.spyOn(process,'exit')` test).
- [ ] The three `process.on('exit'/'SIGINT'/'SIGTERM')` registrations are at module top level
      (mirroring file-lock.ts:613-615); NO `process.off`.
- [ ] Static-invariant scan PASSES today (no temp file backs a prompt in src/agents/* + src/tools/
      bash-mcp.ts) AND the scanner self-test proves it CAN match a real violation.
- [ ] `isPromptDeliveryProgrammatic` (from S1) is `true` (ties the two §9.3.3 halves).
- [ ] SIGKILL/power-loss limitation documented in code AND asserted in test (literal `SIGKILL` +
      `power-loss` + `best-effort` substrings present in the source).
- [ ] No existing source file modified (zero overlap with S1's prompt-delivery.ts or any sibling PRP).

### Code Quality Validation

- [ ] Mirrors `src/core/file-lock.ts` structure verbatim (registry, idempotent iterator, injectable-
      exit signal handler, named 130/143 wrappers, top-level process.on registrations).
- [ ] Test mirrors `tests/unit/core/file-lock.test.ts:413-471` (real tmpdir + real fs, mockExit
      Variants A and B, `afterEach(() => vi.restoreAllMocks())`).
- [ ] File placement: `src/core/temp-prompt-cleanup.ts` (alongside file-lock.ts); test in
      `tests/unit/core/` (alongside file-lock.test.ts).
- [ ] Anti-patterns avoided (see Anti-Patterns below): no editing existing files, no S1 overlap, no
      process.off, no inline arrow in process.on, no non-idempotent cleanup, no captured-exit default.
- [ ] Dependency-free production module (node:fs/node:os/node:path only; no groundswell).

### Documentation & Deployment

- [ ] JSDoc on EVERY export + module header citing PRD §9.3.3 verbatim + the SIGKILL/power-loss
      limitation + the file-lock.ts precedent + the S1 verdict.
- [ ] No environment variables added (contract item 5: DOCS = none).
- [ ] No user-facing / config / API surface change.

---

## Anti-Patterns to Avoid

- ❌ **Don't modify any existing source file.** The audit found NO temp file backs a prompt today.
  Editing `src/agents/*`, `src/tools/bash-mcp.ts`, or `src/core/file-lock.ts` is OUT OF SCOPE and
  risks runtime regressions. This PRP adds TWO new files and nothing else.
- ❌ **Don't touch S1's `src/agents/prompt-delivery.ts` or
  `tests/unit/agents/prompt-delivery.test.ts`.** Both ALREADY EXIST (S1 implemented in parallel). S2
  IMPORTS `isPromptDeliveryProgrammatic` from prompt-delivery.ts (for the sentinel test) but does
  NOT modify either file.
- ❌ **Don't write a non-idempotent cleanup.** The `exit` event fires AFTER a signal handler's
  `process.exit()`, so `cleanupTrackedTempPromptFiles` runs TWICE. It MUST swallow ENOENT (via
  tryUnlink) and clear the Set on the first run. A cleanup that throws on double-removal will crash
  the exit handler.
- ❌ **Don't call `process.exit` inside the `exit` handler.** The `exit` handler is
  `cleanupTrackedTempPromptFiles` (cleanup only). Node ignores `process.exit()` called from within
  an `exit` listener. The signal handlers (`onTempSIGINTCleanup`/`onTempSIGTERMCleanup` →
  `onTempCleanupSignal`) are the ones that call exit. Mirror file-lock.ts:613 exactly.
- ❌ **Don't add `process.off`.** file-lock.ts has NONE. The handlers are registered once at module
  load and outlive every run. Removing them would re-introduce the leak on the next run. (Only the
  per-run pipeline does `process.off` — and this module is module-level, not per-instance.)
- ❌ **Don't use an inline arrow in `process.on(...)`.** `process.on('SIGINT', onTempSIGINTCleanup)`
  uses a NAMED reference. An inline arrow would be an uncoverable registration site
  (file-lock.ts:601-611 JSDoc rationale). The named wrappers exist for this reason.
- ❌ **Don't capture `process.exit` in the default param.** The default MUST be
  `c => process.exit(c)` (a function expression that re-reads `process.exit` when called), NOT
  `const realExit = process.exit; … = c => realExit(c)`. The Variant B spy test (`vi.spyOn(process,
  'exit')`) works ONLY because the default re-resolves the spy.
- ❌ **Don't write a blanket `writeFile` ban in the scanner.** Many legitimate `writeFile` sites
  exist (PRP artifacts, tasks.json, metrics, MCP filesystem tool, test fixtures). The scanner flags
  a temp-write call that ALSO references a prompt-named identifier within a bounded look-ahead —
  scoped to the prompt-delivery path. Exclude `src/scripts/**`.
- ❌ **Don't skip the scanner self-test.** Without it, a too-loose scanner (always `[]`) would make
  the invariant test vacuously pass. The self-test (a contrived `writeFileSync(tmpPath,
  injectedPrompt)` that MUST match) proves the scanner is meaningful.
- ❌ **Don't wire `writeTempPromptFile` into `prp-executor.ts`.** There is no temp-file-backed prompt
  today (the prompt is in-memory). Wiring it would require editing prp-executor.ts (forbidden) and
  would be dead code. The helper exists as the correct primitive for the future.
- ❌ **Don't over-engineer a SIGKILL startup-sweep.** SIGKILL/power-loss cannot be caught; the PRD's
  own re-write-on-every-attempt note is the primary mitigation, and programmatic delivery means no
  temp file backs a prompt today. A PID-stamped sweep is out of scope for a 2-point subtask. Document
  the limitation (in code + test) and ship the retry-aware primitive. This matches the file-lock.ts
  precedent (document the limitation; rely on the design).