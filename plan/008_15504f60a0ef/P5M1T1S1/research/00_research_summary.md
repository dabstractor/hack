# Research Summary — P5.M1.T1.S1: `--adopt-prd` CLI flag + guard rails

## Scope boundary (CRITICAL)

This item (S1) delivers ONLY: the `--adopt-prd` boolean flag, the four PRD §4.6
guard rails, and Mode-A docs. It does **NOT** implement the adopt *behavior*:

- **S2** (next) = seed completed baseline `tasks.json` + `.adopted` marker +
  `SKIP_EXECUTION_LOOP=true`.
- **S3** (after) = validation + bug-hunt still run in adopt mode.

S1 leaves a clearly-marked **extension seam** where S2 will hook the fresh-project
seeding. S1's fresh-project branch is intentionally inert (logs + proceeds to
normal session creation).

## The four guard rails (PRD §4.6) → mapping to code

| Rail | Contract | Where it lives | Status |
|------|----------|----------------|--------|
| (b) PRD exists | "missing PRD MUST exit loudly" | `parseCLIArgs()` already does `existsSync(options.prd)` → `process.exit(1)` at `src/cli/index.ts` (PRD-file-not-found test = `tests/unit/cli/index.test.ts:309`). Adopt mode inherits it — **no new code**, just don't bypass. |
| (c) no-op if sessions exist | "if sessions already exist the flag is a no-op misuse (warn and proceed)" | NEW: `initializeSession()` adopt block + `SessionManager.hasAnySessions()` helper. |
| (d) reject empty SESSION_DIR | "hard guard MUST reject an empty SESSION_DIR before breakdown/validation" | NEW: `initializeSession()` after `sessionManager.initialize()` (general — runs for ALL sessions) + defense-in-depth in `createSessionDirectory`. |
| (e) mkdir -p PLAN_DIR first | "session creation MUST `mkdir -p PLAN_DIR` first so the session path is always nested under it" | NEW: explicit `mkdir(planDir, {recursive:true})` as FIRST op in `createSessionDirectory` + empty-planDir reject. |

## Key file facts (verified)

### CLI layer — `src/cli/index.ts`
- `CLIArgs` interface (incl. `acceptPrdChanges: boolean`) → `ValidatedCLIArgs extends
  Omit<CLIArgs, …>`. `acceptPrdChanges` is NOT in the Omit list, so it flows through
  unchanged. **`adoptPrd` must be added the same way** (to `CLIArgs`; NOT added to the
  Omit list).
- Boolean flag pattern to mirror (Commander): the `--accept-prd-changes` `.option(...,
  false)` near the `--validate-prd` option.
- `parseCLIArgs()` already validates PRD-exists (rail b) and calls `process.exit(1)` on
  failure. No change for adopt.

### Pipeline layer — `src/workflows/prp-pipeline.ts`
- Constructor: 23 positional params, LAST is `acceptPrdChanges: boolean = false`
  (`:351-374`). Field `private readonly acceptPrdChanges: boolean = false` (`:185`),
  assigned at `:402-403`. **`adoptPrd` becomes the 24th positional param + field,
  mirroring `acceptPrdChanges` exactly.**
- `SessionManagerClass` = `import { SessionManager as SessionManagerClass }` at `:49`
  (value import — static methods callable, e.g. `SessionManagerClass.findLatestSession`
  already used at `:2601`).
- `run()` (`:2238`): creates `this.sessionManager = new SessionManagerClass(prdPath,
  planDir, flushRetries)` at `:2272`, THEN calls `initializeSession()` at `:2316`. So
  `this.sessionManager` is available inside `initializeSession()` BEFORE
  `sessionManager.initialize()` runs.
- `initializeSession()` (`:575-706`): validate/bug-hunt reuse block FIRST (`:590`),
  then `const session = await this.sessionManager.initialize()` (`:634`), then
  `hasSessionChanged()` → `handleDelta()`. **Adopt block goes AFTER the reuse block,
  BEFORE `sessionManager.initialize()`. Empty-SESSION_DIR guard goes AFTER
  `sessionManager.initialize()`.**
- Pipeline layer NEVER calls `process.exit`. Guards THROW or track failure → `run()`
  returns failed `PipelineResult` → `main()` maps to exit 1. (Confirmed by scout.)

### SessionManager — `src/core/session-manager.ts`
- `__scanSessionDirectories(planDir): Promise<SessionDirInfo[]>` is a STATIC method
  (`:1265`), used internally at `:268,:280` (via `SessionManager.__scanSessionDirectories`)
  and statically at `:1348,:1477`. It scans `planDir` for `NNN_hash` dirs.
- **NEW instance method `hasAnySessions(): Promise<boolean>`** wraps
  `(await SessionManager.__scanSessionDirectories(this.planDir)).length > 0`. Clean,
  testable, only needs `this.planDir` (set in ctor `:234`) — safe to call BEFORE
  `initialize()`.

### Session utils — `src/core/session-utils.ts`
- `createSessionDirectory(prdPath, sequence, planDir = resolve('plan'),
  precomputedHash?)` at `:599`. Imports `mkdir` from `node:fs/promises` (`:29`), `resolve,
  join` from `node:path` (`:34`).
- Body: computes hash → `sessionPath = join(planDir, sessionId)` → loops `mkdir(dir,
  {recursive:true, mode:0o755})` over `[sessionPath, …/architecture, …/prps,
  …/artifacts]` (handles EEXIST). **Add explicit `mkdir(planDir, {recursive:true,
  mode:0o755})` as the FIRST op + reject empty `planDir` (rail e) + reject empty
  `sessionPath` (rail d defense-in-depth).**
- `SessionFileError extends Error` (`:67`), ctor `(path, operation, cause?)` — available
  in-file for throws. Or use plain `Error` for validation guards.

### Entry point — `src/index.ts`
- `new PRPPipeline(...)` at `:233` — 23 positional args, last is
  `args.acceptPrdChanges`. **Append `args.adoptPrd` as the 24th.**
- `main()` early-return guard-rail pattern (credential-free): `--dry-run` / `--validate-prd`
  `return 0/1` BEFORE `runAuthPreflight()` (`:143-203`). **Adopt mode is NOT
  credential-free (it runs validation/bug-hunt in S3), so it does NOT early-return here —
  it threads the flag into the pipeline.**

## Docs (Mode A) — exact insertion points (scout-verified)

### `docs/CLI_REFERENCE.md`
- `### Boolean Flags` under `## Options` — a **table** (rows `:242-251`, cols
  `Option | Type | Default | Description`) + a **`Flag Details:` definition list**
  (`:253-269`, bullets `- **\`--flag\`**: prose…`).
- Last table row = `--accept-prd-changes` (`:251`); last bullet = `--accept-prd-changes`
  (`:269`). **Add `--adopt-prd` table row after `:251` + definition bullet after `:269`**
  (before `### Limit Options` `:271`).
- `grep adopt` → absent (confirmed).

### `README.md`
- `## CLI Options` (`:212`) — single 5-col table (`Option | Alias | Type | Default |
  Description`), rows `:214-225`. Boolean rows `:218-225`. `--validate-prd` at `:221` is
  the closest analog (Alias `-`). **Add `--adopt-prd` row after `:221` (or after `:224`
  before `--help` `:225`), Alias `-`.** NOTE: README omits `--accept-prd-changes` (curated
  subset), but the work-item contract says "Add --adopt-prd to docs/CLI_REFERENCE.md AND
  README.md" — the explicit contract wins → add to BOTH.
- `grep adopt` → absent (confirmed).

## Test patterns (scout-verified)

### `tests/unit/cli/index.test.ts`
- Harness: `beforeEach` mocks `process.exit` to THROW (`mockExit = vi.fn(code => throw new
  Error('process.exit(code)'))`, `:81-101`); `setArgv(args)` sets
  `process.argv = ['node','script', ...args]` (`:107`); `parseArgs()` calls `parseCLIArgs()`
  + narrows via `isCLIArgs` (`:115`). Mocks `node:fs` (`existsSync`), logger.
- `--accept-prd-changes` tested in 3 cases (`:241-276`): default-false, present-true,
  "carries onto ValidatedCLIArgs" (`'acceptPrdChanges' in args`). **Mirror exactly for
  `--adopt-prd`.**

### `tests/unit/workflows/prp-pipeline.test.ts` (guard-rail tests live here)
- `createMockSessionManager(session, hasSessionChanged)` factory (`:268-284`): returns mock
  with `initialize`, `currentSession`, etc. Add `hasAnySessions: vi.fn()` to it.
- 1-arg construction + field injection: `const pipeline = new PRPPipeline('./test.md');
  (pipeline as any).sessionManager = mockManager;` (`:327-333`). For adopt tests, set
  `(pipeline as any).adoptPrd = true;` OR pass positionally.
- `initializeSession()` delta tests (`:570+`) pattern: set `hasSessionChanged`, spy
  `handleDelta`, call `pipeline.initializeSession()`, assert. **Mirror for adopt guard
  rails.**
- Pipeline guards THROW / track-failure (NOT process.exit). Use `rejects.toThrow` for the
  empty-SESSION_DIR guard.

### `tests/unit/core/session-utils.test.ts`
- `describe('createSessionDirectory')` at `:331`. `mockMkdir = mkdir as any` (`:59`).
- Existing assertion `expect(mockMkdir).toHaveBeenCalledTimes(4)` (`:361`) — **becomes 5
  after the explicit `mkdir(planDir)` first call** (UPDATE this assertion + assert the
  FIRST call path endsWith the plan dir). Add new tests: empty-planDir throws;
  mkdir-planDir-is-first-call.
- Other createSessionDirectory tests (`:377+`) call with `planDir=undefined` (default) →
  unaffected by the empty-planDir guard (default is non-empty).

## Adjacent/READ-ONLY files (do NOT modify)
- `src/workflows/fix-cycle-workflow.ts`, `bug-hunt-workflow.ts` — other items own them.
- `src/core/session-manager.ts` `initialize()` — DO NOT change adopt seeding here; S1 only
  ADDS `hasAnySessions()`.
- `PRD.md`, `tasks.json`, `prd_snapshot.md` — never touch (FORBIDDEN).

## Risk notes for the implementer
- **24-positional-arg drift**: adding `adoptPrd` as the 24th param requires lock-step
  updates to `src/index.ts:233` (production call site). Test factories that pass all args
  explicitly (`prp-pipeline-delta-response.test.ts buildPipeline`) still compile (24th
  defaults false) but should be updated if they need adoptPrd=true. The 1-arg
  `prp-pipeline.test.ts` factory is unaffected (uses field injection).
- **mockMkdir call-count bump**: the explicit `mkdir(planDir)` changes the count in
  `session-utils.test.ts:361` from 4 → 5. Update or the test fails.
- **No-op branch must NOT throw**: rail (c) warns + FALLS THROUGH to normal
  `sessionManager.initialize()`. Do NOT early-return (the rest of initializeSession must
  run so the session loads normally).
- **Empty-SESSION_DIR guard is GENERAL** (runs for all sessions, not just adopt) — but it
  only ever fires on a pathological empty path, so no existing test breaks.