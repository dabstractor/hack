# PRP — P5.M1.T1.S1: CLI flag and guard rails for `--adopt-prd`

---

## Goal

**Feature Goal**: Implement the `--adopt-prd` CLI flag and its PRD §4.6 **guard rails**
— the safe, inert plumbing that P5.M1.T1.S2 will later turn into real adopt behavior
(seed baseline `tasks.json`, `.adopted` marker, `SKIP_EXECUTION_LOOP`). PRD §4.6
("Adopt Mode") declares the PRD the source of truth for an *already-shipped* codebase.
On a **fresh project** (no `plan/` sessions) it would seed a completed baseline; but
**this subtask (S1) only delivers the flag + the four guard rails + Mode-A docs** — the
seeding itself is S2, and validation/bug-hunt-still-run is S3.

The four guard rails (PRD §4.6 "Guard rails"), all of which S1 implements:

1. **(b) PRD must exist** — a missing PRD MUST exit loudly rather than scribble session
   files near the filesystem root. *(Already satisfied by `parseCLIArgs()`'s
   `existsSync(prd)` → `process.exit(1)`; S1 inherits it and must NOT bypass it.)*
2. **(c) no-op if sessions already exist** — `--adopt-prd` applies only to fresh
   projects; if sessions exist, the flag is a misuse → **warn and proceed with normal
   session resolution** (do NOT seed, do NOT abort).
3. **(d) hard guard: reject empty `SESSION_DIR`** — before breakdown/validation, reject
   an empty/falsy session dir so collapsed root paths can never be written.
4. **(e) `mkdir -p PLAN_DIR` first** — session creation MUST `mkdir -p` the plan dir
   first so the session path is always nested under it.

**Deliverable** (4 source files MODIFY + 2 doc files MODIFY + 2 test files MODIFY;
**no** new files, **no** new dependency, **no** config/env constant, **no** change to
`SessionManager.initialize()`, `fix-cycle-workflow.ts`, or `bug-hunt-workflow.ts`):

1. **`src/cli/index.ts`** (MODIFY) — add `adoptPrd: boolean` to `CLIArgs`; add
   `--adopt-prd` Commander `.option(..., false)` mirroring `--accept-prd-changes`.
   (`ValidatedCLIArgs` picks it up automatically — do NOT add it to the `Omit` list.)
2. **`src/workflows/prp-pipeline.ts`** (MODIFY) — add 24th constructor param
   `adoptPrd: boolean = false` + `private readonly adoptPrd` field (mirror
   `acceptPrdChanges`); in `initializeSession()` add the adopt guard-rail block (rail c:
   no-op-if-sessions-exist) and the general empty-`SESSION_DIR` hard guard (rail d).
3. **`src/core/session-utils.ts`** (MODIFY) — in `createSessionDirectory()` add rail (e)
   explicit `mkdir(planDir, {recursive:true})` as the FIRST op + reject empty `planDir`,
   and rail (d) defense-in-depth: reject empty computed `sessionPath`.
4. **`src/core/session-manager.ts`** (MODIFY) — add `async hasAnySessions(): Promise<boolean>`
   instance method (wraps the existing static `__scanSessionDirectories`).
5. **`src/index.ts`** (MODIFY) — thread `args.adoptPrd` as the 24th positional arg to
   `new PRPPipeline(...)`.
6. **`docs/CLI_REFERENCE.md`** (MODIFY) — add `--adopt-prd` table row + `Flag Details:`
   definition bullet (Mode A).
7. **`README.md`** (MODIFY) — add `--adopt-prd` row to the `## CLI Options` table (Mode A).
8. **`tests/unit/cli/index.test.ts`** (MODIFY) — add `--adopt-prd` default-false /
   present-true / carried-onto-`ValidatedCLIArgs` cases (mirror `--accept-prd-changes`).
9. **`tests/unit/workflows/prp-pipeline.test.ts`** (MODIFY) — add `hasAnySessions` to the
   mock-session-manager factory + a `describe('--adopt-prd guard rails')` block
   (no-op-if-sessions-exist; fresh-project inert seam; empty-SESSION_DIR hard guard).
10. **`tests/unit/core/session-utils.test.ts`** (MODIFY) — bump the `mockMkdir`
    `toHaveBeenCalledTimes(4)` assertion to 5 + assert the FIRST call is the plan dir;
    add empty-`planDir` reject + empty-`sessionPath` reject tests.

**Success Definition**:
- `npm run dev -- --adopt-prd` parses to `args.adoptPrd === true` (default `false` when
  absent), and the flag threads through `main()` → `PRPPipeline` constructor (24th arg).
- In `initializeSession()`, when `adoptPrd` is set: `hasAnySessions()` is consulted; if
  sessions exist, a **warn** is logged and normal session resolution proceeds (no abort,
  no seeding); if the project is fresh, S1 logs an informational "seeding lands in S2"
  message and proceeds to normal session creation (S1 is intentionally inert on the
  fresh path — the seeding seam is marked for S2).
- `createSessionDirectory()` now `mkdir -p`s `planDir` as its **first** operation and
  **rejects** an empty `planDir` / empty computed `sessionPath` with a thrown error.
- `initializeSession()` **rejects** an empty `session.metadata.path` (the hard guard)
  before returning, for ALL sessions (general defense, not adopt-only).
- `docs/CLI_REFERENCE.md` and `README.md` document `--adopt-prd`.
- `npm run validate` GREEN; `npm run test:coverage` stays 100%; `git diff --name-only`
  shows EXACTLY the 10 files above.

---

## User Persona (if applicable)

**Target User**: A pipeline operator with an *already-implemented* codebase who wrote a
`PRD.md` retroactively and wants the pipeline to treat that PRD as the source of truth —
skipping a wasteful "build code that already exists" pass. They run
`npm run dev -- --prd ./PRD.md --adopt-prd`.

**Use Case**: "My codebase already ships. I just wrote the PRD. Adopt it as the baseline
so future PRD edits produce deltas against the real code, without re-implementing
everything."

**User Journey**: `main()` parses `--adopt-prd` → threads into `PRPPipeline` →
`run()` → `initializeSession()` → **adopt guard-rail block**: `hasAnySessions()`?
  - sessions exist → warn "no-op" → normal session resolution (the operator already has
    sessions, so adopt is the wrong tool).
  - fresh project → (S1: log + proceed; S2 will seed the baseline here) → normal session
    creation → (S2: `.adopted` + completed `tasks.json` + `SKIP_EXECUTION_LOOP`) →
    (S3: validation + bug-hunt run against the real codebase).

**Pain Points Addressed**: today there is NO way to adopt a legacy codebase; the only
options are a full breakdown+implement pass (wasteful, re-implements existing code) or
nothing. S1 lays the safe foundation (flag + guard rails) so S2/S3 can complete adopt
mode without risking root-scribble or misuse on non-fresh projects.

---

## Why

- **PRD compliance (§4.6 "Guard rails", verbatim)**:
  - *"`--adopt-prd` requires the PRD to exist; a missing PRD MUST exit loudly rather than
    scribbling session files near the filesystem root."* → rail (b).
  - *"It applies only to fresh projects; if sessions already exist the flag is a no-op
    misuse (warn and proceed with normal session resolution)."* → rail (c).
  - *"A hard guard MUST reject an empty `SESSION_DIR` before breakdown/validation so
    collapsed root paths can never be written, and session creation MUST `mkdir -p
    "$PLAN_DIR"` first so the session path is always nested under it."* → rails (d)+(e).
- **Work-item CONTRACT mapping**:
  - **(1) RESEARCH NOTE** — `architecture/phase_findings.md` §PHASE 5: "No adopt code
    exists in `src/`"; "CLI has 5 subcommands + default pipeline"; "PRPPipeline
    constructor takes 23 positional args"; "SessionManager.initialize() creates session
    dir, hashes PRD, writes snapshot"; "Guard rails: require PRD exists, no-op if
    sessions exist, reject empty SESSION_DIR, mkdir -p PLAN_DIR first." → ALL verified
    and mapped (see research/00_research_summary.md).
  - **(2) INPUT** — "No prior subtask output consumed (greenfield feature)." → ✓ S1 is
    the first subtask of P5.
  - **(3) LOGIC** — (a) flag in `parseCLIArgs` ✓; (b) PRD-exists validate in `main()`
    (already done by parseCLIArgs — inherited) ✓; (c) no-op-if-sessions-exist warn+
    proceed ✓; (d) reject empty SESSION_DIR before breakdown/validation ✓; (e)
    mkdir-p-PLAN_DIR first ✓.
  - **(4) OUTPUT** — "--adopt-prd CLI flag with guard rails. Consumed by P5.M1.T1.S2."
    → ✓ S2 reads `this.adoptPrd` + the marked seam in `initializeSession()`.
  - **(5) DOCS** — "[Mode A] Add --adopt-prd to docs/CLI_REFERENCE.md and README.md
    (flag documentation). This rides WITH the work." → ✓ items 6 & 7.
- **Foundation for the milestone**: S2 (seeding) and S3 (validation/bug-hunt) both depend
  on the flag being threaded and the guard rails being in place. S1 is the safe base.

---

## What

`parseCLIArgs()` gains a `--adopt-prd` boolean flag (mirroring `--accept-prd-changes`).
`main()` threads it as the 24th positional arg into `PRPPipeline`. `initializeSession()`
gains an adopt guard-rail block (consults `SessionManager.hasAnySessions()`; warns +
proceeds on existing sessions; logs the S2 seam on fresh projects) and a general
empty-`SESSION_DIR` hard guard. `createSessionDirectory()` gains an explicit
`mkdir -p planDir` first step plus empty-`planDir`/empty-`sessionPath` rejects.
`SessionManager` gains a `hasAnySessions()` instance method. Docs add `--adopt-prd`.

**No** change to `SessionManager.initialize()` (S1 only ADDS `hasAnySessions`), **no**
change to `fix-cycle-workflow.ts` / `bug-hunt-workflow.ts`, **no** new CLI subcommand,
**no** new config/env constant, **no** new dependency.

### Success Criteria

- [ ] `--adopt-prd` parses to `args.adoptPrd === true`; absent → `false`; survives into
      `ValidatedCLIArgs` (`'adoptPrd' in args === true`).
- [ ] `PRPPipeline` constructor has a 24th param `adoptPrd: boolean = false` and a
      `private readonly adoptPrd` field; `main()` passes `args.adoptPrd` positionally.
- [ ] `SessionManager.hasAnySessions(): Promise<boolean>` returns true iff
      `__scanSessionDirectories(this.planDir).length > 0`.
- [ ] In `initializeSession()`, when `adoptPrd === true && hasAnySessions() === true`:
      a **warn** is logged ("--adopt-prd is a no-op …") AND normal session resolution
      proceeds (the rest of `initializeSession()` runs — `sessionManager.initialize()`
      is still called). **No abort, no seeding.**
- [ ] In `initializeSession()`, when `adoptPrd === true && hasAnySessions() === false`:
      an **info** log notes seeding lands in S2, and normal session creation proceeds
      (S1 is inert on the fresh path). The seam is marked with an
      `EXTENSION POINT (P5.M1.T1.S2)` comment.
- [ ] `initializeSession()` throws (or non-fatally tracks the failure) when
      `session.metadata.path` is empty/falsy AFTER `sessionManager.initialize()` — the
      general empty-`SESSION_DIR` hard guard (rail d). Runs for ALL sessions.
- [ ] `createSessionDirectory()` calls `mkdir(planDir, { recursive: true, mode: 0o755 })`
      as its **first** filesystem op, and throws on empty `planDir` (rail e) and empty
      computed `sessionPath` (rail d defense-in-depth).
- [ ] `docs/CLI_REFERENCE.md` has a `--adopt-prd` table row + `Flag Details:` bullet.
- [ ] `README.md` has a `--adopt-prd` row in `## CLI Options`.
- [ ] `tests/unit/cli/index.test.ts` adds 3 `--adopt-prd` cases (default/present/carried).
- [ ] `tests/unit/workflows/prp-pipeline.test.ts` adds `hasAnySessions` to the mock
      factory + a `--adopt-prd guard rails` describe block (no-op-on-existing; fresh
      inert seam; empty-SESSION_DIR throw).
- [ ] `tests/unit/core/session-utils.test.ts` bumps `mockMkdir` count 4→5, asserts the
      first call is `planDir`, and adds empty-`planDir` / empty-`sessionPath` reject cases.
- [ ] `npm run validate` GREEN; `npm run test:coverage` 100%; `git diff --name-only` =
      exactly the 10 listed files.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed?" —
YES. This PRP names: the EXACT interface field + Commander option to add; the EXACT 24th
constructor param + field (mirroring `acceptPrdChanges`); the EXACT seam in
`initializeSession()` (after the validate/bug-hunt reuse block, before
`sessionManager.initialize()`); the EXACT `hasAnySessions()` method to add and the static
it wraps; the EXACT guard-rail predicates (warn-and-proceed vs inert-seam vs throw); the
EXACT doc insertion lines (CLI_REFERENCE.md table row after `:251`, bullet after `:269`;
README row after `:221`); and the precise test patterns (the `--accept-prd-changes`
triple in `index.test.ts:241-276`, the mock-session-manager factory, the
`createSessionDirectory` `mockMkdir` count bump). It treats S2's seeding as a black-box
contract (S1 only marks the seam).

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: plan/008_15504f60a0ef/P5M1T1S1/research/00_research_summary.md
  why: THIS PRP's own research summary. The rail→code mapping, verified file facts,
        the mockMkdir count bump (4→5), the SessionFileError ctor, the docs insertion
        lines, and the test patterns. READ FIRST.

- file: PRD.md
  section: §4.6 "Adopt Mode (--adopt-prd)" + its "Guard rails" bulleted list (in
           selected_prd_content). Cite it in the adopt block + createSessionDirectory
           JSDoc. Also §4.1 "Initialization & Breakdown" (the state-check / decomposition
           flow that adopt guard rails protect).

- file: plan/008_15504f60a0ef/architecture/phase_findings.md
  section: §PHASE 5 "Adopt Mode" (Current State + Required Changes). The RESEARCH NOTE
           the contract cites.

- file: src/cli/index.ts
  section: CLIArgs interface (incl. `acceptPrdChanges: boolean`, ~:92); ValidatedCLIArgs
           `Omit<CLIArgs, …>` (~:127 — NOTE adoptPrd must NOT be in the Omit list);
           the `--accept-prd-changes` `.option('--accept-prd-changes', '…', false)` near
           `--validate-prd`; the `existsSync(options.prd)` → `process.exit(1)` block
           (rail b — ALREADY PRESENT).
  why: THE CLI FILE THIS PRP MODIFIES (item 1). Mirror the accept-prd-changes option +
        interface field exactly.
  pattern: boolean flag = `.option('--adopt-prd', '<desc> (PRD §4.6)', false)`. Add
           `adoptPrd: boolean;` to CLIArgs. Do NOT add to the ValidatedCLIArgs Omit list.
  gotcha: parseCLIArgs calls process.exit(1) on PRD-missing — that IS rail (b); do not
          duplicate it in main().

- file: src/workflows/prp-pipeline.ts
  section: constructor (:351-374 — 23 positional params, LAST is `acceptPrdChanges:
           boolean = false`); field `private readonly acceptPrdChanges: boolean = false`
           (:185) assigned at :402-403; SessionManagerClass value import (:49);
           initializeSession() (:575-706): validate/bug-hunt reuse block (:590-632),
           `const session = await this.sessionManager.initialize()` (:634),
           hasSessionChanged→handleDelta (:679); run() (:2238) creates
           `this.sessionManager = new SessionManagerClass(prdPath, planDir, flushRetries)`
           (:2272) THEN calls initializeSession() (:2316).
  why: THE PIPELINE FILE THIS PRP MODIFIES (items 2). The 24th param + field + adopt
        block + empty-SESSION_DIR guard all live here.
  pattern: copy the `acceptPrdChanges` field+param+assignment verbatim, s/acceptPrdChanges/adoptPrd/.
  gotcha: the adopt block runs BEFORE sessionManager.initialize() (hasAnySessions only
          needs this.sessionManager.planDir, set in SessionManager ctor). The empty-
          SESSION_DIR guard runs AFTER initialize() (needs session.metadata.path). The
          pipeline layer NEVER calls process.exit — THROW (or #trackFailure under
          continueOnError) so run() returns a failed PipelineResult.

- file: src/core/session-manager.ts
  section: `static async __scanSessionDirectories(planDir)` (:1265 — returns
           SessionDirInfo[] matching /^(\d{3})_([a-f0-9]{12})$/); internal uses at :268,
           :280 (via SessionManager.__scanSessionDirectories), :1348, :1477; `readonly
           planDir: string` (:166) set in ctor (:234); `initialize()` (:298 — DO NOT
           MODIFY in S1).
  why: ADD `hasAnySessions()` here (item 4). It wraps the existing static scan.
  pattern: `async hasAnySessions(): Promise<boolean> { const sessions = await
           SessionManager.__scanSessionDirectories(this.planDir); return sessions.length
           > 0; }` — instance method, only needs this.planDir (safe before initialize()).

- file: src/core/session-utils.ts
  section: createSessionDirectory() (:599) — imports `mkdir` from node:fs/promises (:29),
           `resolve, join` from node:path (:34); body computes hash → `sessionPath =
           join(planDir, sessionId)` → loops mkdir(dir,{recursive:true,mode:0o755}) over
           [sessionPath, …/architecture, …/prps, …/artifacts] (EEXIST swallowed);
           SessionFileError class (:67, ctor (path, operation, cause?)).
  why: THE SESSION-CREATION FILE THIS PRP MODIFIES (item 3). Rails (d)+(e) live here.
  pattern: add `if (!planDir || !planDir.trim()) throw new Error('planDir cannot be
           empty (PRD §4.6)');` FIRST; then `await mkdir(planDir, { recursive: true,
           mode: 0o755 });`; after computing sessionPath, `if (!sessionPath ||
           !sessionPath.trim()) throw new Error('Computed session path is empty (PRD
           §4.6)');`.
  gotcha: the explicit mkdir(planDir) is IN ADDITION to the existing mkdir loop (which
          already creates parents via recursive:true) — it is the documented §4.6
          ordering guarantee + the empty-planDir guard is the real collapse protection.

- file: src/index.ts
  section: `const pipeline = new PRPPipeline(…)` (:233-261 — 23 positional args, LAST is
           `args.acceptPrdChanges`); main() early-return guard-rail pattern for
           credential-free modes (--dry-run/--validate-prd return 0/1 BEFORE
           runAuthPreflight at :143-203).
  why: THE ENTRY-POINT FILE THIS PRP MODIFIES (item 5). Append `args.adoptPrd` as 24th
        positional arg.
  gotcha: adopt mode is NOT credential-free (S3 runs validation/bug-hunt) → do NOT add
          an early-return here; just thread the flag.

- file: docs/CLI_REFERENCE.md
  section: `## Options` > `### Boolean Flags` — table rows (:242-251, cols Option|Type|
           Default|Description) + `Flag Details:` definition list (:253-269, bullets
           `- **\`--flag\`**: prose`). Last row/bullet = `--accept-prd-changes` (:251/:269);
           `### Limit Options` follows at :271.
  why: DOC FILE THIS PRP MODIFIES (item 6). Add table row after :251 + bullet after :269.
  gotcha: `grep adopt` currently absent. Match the pipe-padding of the surrounding rows
          (col 1 ~22 chars) or `npm run format`/markdownlint will flag it.

- file: README.md
  section: `## CLI Options` (:212) — single 5-col table (Option|Alias|Type|Default|
           Description), boolean rows :218-225. `--validate-prd` at :221 (Alias `-`) is
           the closest analog.
  why: DOC FILE THIS PRP MODIFIES (item 7). Add one row (Alias `-`) after :221 or after
        :224 (keep `--help` :225 last).
  gotcha: README is a curated subset (it OMITS `--accept-prd-changes`), but the work-item
          contract explicitly says "Add --adopt-prd to docs/CLI_REFERENCE.md AND README.md"
          → the explicit contract wins; add to BOTH.

- file: tests/unit/cli/index.test.ts
  section: beforeEach process.exit-throw mock (:81-101); setArgv() (:107); parseArgs()
           (:115); the `--accept-prd-changes` triple (:241-276 — default-false, present-
           true, carried-onto-ValidatedCLIArgs); PRD-file-not-found throw test (:309).
  why: TEST FILE THIS PRP MODIFIES (item 8). Copy the accept-prd-changes triple, s/accept-
        prd-changes/adopt-prd/.

- file: tests/unit/workflows/prp-pipeline.test.ts
  section: createMockSessionManager() factory (:268-284 — ADD `hasAnySessions: vi.fn()`);
           1-arg construction + field injection (:327-333); initializeSession() delta
           tests (:570+ — set hasSessionChanged, spy handleDelta, call initializeSession,
           assert).
  why: TEST FILE THIS PRP MODIFIES (item 9). Add a `--adopt-prd guard rails` describe
        block using field injection (`(pipeline as any).adoptPrd = true`).

- file: tests/unit/core/session-utils.test.ts
  section: describe('createSessionDirectory') (:331); `mockMkdir = mkdir as any` (:59);
           `expect(mockMkdir).toHaveBeenCalledTimes(4)` (:361 — becomes 5); calls
           inspected at :364-370.
  why: TEST FILE THIS PRP MODIFIES (item 10). Bump count 4→5, assert first call is
        planDir, add empty-planDir/empty-sessionPath reject tests.
```

### Current Codebase tree (relevant slice)

```bash
src/cli/index.ts                       # MODIFY — + adoptPrd field, + --adopt-prd option
src/index.ts                           # MODIFY — + args.adoptPrd (24th positional arg)
src/workflows/prp-pipeline.ts          # MODIFY — + 24th ctor param/field, + adopt guard
                                       #   block + empty-SESSION_DIR guard in initializeSession
src/core/session-manager.ts            # MODIFY — + hasAnySessions() instance method
                                       #   (initialize() UNCHANGED)
src/core/session-utils.ts              # MODIFY — createSessionDirectory: + mkdir-p-planDir
                                       #   first + empty-planDir/empty-sessionPath rejects
docs/CLI_REFERENCE.md                  # MODIFY — + --adopt-prd row + bullet
README.md                              # MODIFY — + --adopt-prd row
tests/unit/cli/index.test.ts           # MODIFY — + --adopt-prd triple
tests/unit/workflows/prp-pipeline.test.ts  # MODIFY — + hasAnySessions mock + adopt guard tests
tests/unit/core/session-utils.test.ts  # MODIFY — mockMkdir count 4→5 + reject tests
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/cli/index.ts
  # + `adoptPrd: boolean;` in CLIArgs interface (NOT added to ValidatedCLIArgs Omit list).
  # + `.option('--adopt-prd', 'Declare the PRD as the source of truth for an
  #   already-implemented codebase (PRD §4.6)', false)` near --accept-prd-changes.
src/workflows/prp-pipeline.ts
  # + 24th ctor param `adoptPrd: boolean = false`.
  # + `private readonly adoptPrd: boolean = false;` field (mirror acceptPrdChanges).
  # + `this.adoptPrd = adoptPrd;` in ctor body.
  # + initializeSession() adopt guard-rail block (after validate/bug-hunt reuse block,
  #   before sessionManager.initialize()):
  #     if (this.adoptPrd) {
  #       const hasSessions = await this.sessionManager.hasAnySessions();
  #       if (hasSessions) {
  #         this.logger.warn('[PRPPipeline] --adopt-prd is a no-op: sessions already '
  #           + `exist in ${this.sessionManager.planDir}; proceeding with normal session resolution (PRD §4.6)`);
  #         // fall through to normal session resolution below
  #       } else {
  #         // EXTENSION POINT (P5.M1.T1.S2): seed completed baseline tasks.json +
  #         // .adopted marker + SKIP_EXECUTION_LOOP=true here. S1 is intentionally
  #         // inert on the fresh-project path (flag threaded + guard rails only).
  #         this.logger.info('[PRPPipeline] --adopt-prd set on fresh project (no '
  #           + 'sessions); adopt baseline seeding is implemented in P5.M1.T1.S2');
  #         // fall through to normal session creation below
  #       }
  #     }
  # + initializeSession() empty-SESSION_DIR hard guard (AFTER sessionManager.initialize(),
  #   general — runs for ALL sessions):
  #     if (!session.metadata.path || session.metadata.path.trim() === '') {
  #       throw new Error('Session directory (SESSION_DIR) is empty; refusing to proceed '
  #         + 'to breakdown/validation to prevent collapsed root paths (PRD §4.6)');
  #     }
src/core/session-manager.ts
  # + `async hasAnySessions(): Promise<boolean> { const sessions = await
  #   SessionManager.__scanSessionDirectories(this.planDir); return sessions.length > 0; }`
  #   (public instance method; initialize() UNCHANGED)
src/core/session-utils.ts
  # + createSessionDirectory(): as FIRST op, `if (!planDir || !planDir.trim()) throw new
  #   Error('planDir cannot be empty (PRD §4.6)');` then `await mkdir(planDir, { recursive:
  #   true, mode: 0o755 });`. After computing sessionPath: `if (!sessionPath ||
  #   !sessionPath.trim()) throw new Error('Computed session path is empty (PRD §4.6)');`.
  #   (existing mkdir loop UNCHANGED after these additions)
src/index.ts
  # + append `args.adoptPrd` as the 24th positional arg to `new PRPPipeline(...)`.
docs/CLI_REFERENCE.md
  # + table row (after :251): `| \`--adopt-prd\` | boolean | false | Declare the PRD as the
  #   source of truth for an already-implemented codebase (PRD §4.6) |`
  # + Flag Details bullet (after :269): `- **\`--adopt-prd\`**: ... (PRD §4.6) ...`
README.md
  # + row in ## CLI Options (after :221 or :224): `| \`--adopt-prd\` | - | boolean | false |
  #   <one-line description> |`
tests/unit/cli/index.test.ts
  # + 3 cases mirroring the --accept-prd-changes triple (:241-276): default-false,
  #   present-true, carried-onto-ValidatedCLIArgs.
tests/unit/workflows/prp-pipeline.test.ts
  # + `hasAnySessions: vi.fn()` in createMockSessionManager factory.
  # + describe('--adopt-prd guard rails') with: no-op-on-existing-sessions (warn +
  #   initialize still called); fresh-project-inert-seam (info log + initialize called);
  #   empty-SESSION_DIR-throw (session.metadata.path='' → initializeSession rejects).
tests/unit/core/session-utils.test.ts
  # + bump `expect(mockMkdir).toHaveBeenCalledTimes(4)` → `5` (:361) + assert
  #   `calls[0][0]` endsWith the plan dir.
  # + it('throws on empty planDir') and it('throws on empty computed sessionPath').
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (ValidatedCLIArgs Omit list): `ValidatedCLIArgs extends Omit<CLIArgs, ...>`.
//   `acceptPrdChanges` is NOT in the Omit list, so it flows through unchanged. Add
//   `adoptPrd` to CLIArgs the SAME way — do NOT add it to the Omit list, or it will be
//   stripped and `args.adoptPrd` will be undefined in main().

// CRITICAL (24-positional-arg drift): the constructor becomes 24 params. The ONLY
//   production call site is src/index.ts:233 — update it to pass args.adoptPrd. Test
//   factories that pass all args explicitly (prp-pipeline-delta-response.test.ts
//   buildPipeline) still compile (24th defaults false); the 1-arg prp-pipeline.test.ts
//   factory uses field injection and is unaffected.

// CRITICAL (adopt block placement): it MUST run AFTER the validate/bug-hunt reuse block
//   (:590-632) and BEFORE `const session = await this.sessionManager.initialize()` (:634).
//   hasAnySessions() only needs this.sessionManager.planDir (set in SessionManager ctor,
//   available because run() constructs this.sessionManager at :2272 before initializeSession()).
//   Do NOT call sessionManager.initialize() inside the adopt block — the no-op path must
//   FALL THROUGH to the existing initialize() call so normal session resolution runs.

// CRITICAL (rail c must NOT abort): the no-op-on-existing-sessions branch WARNS and falls
//   through. It must NOT throw, return early, or skip sessionManager.initialize(). "Warn
//   and proceed with normal session resolution" is the verbatim contract.

// CRITICAL (rail d is GENERAL): the empty-SESSION_DIR guard runs for ALL sessions (not
//   just adopt). It only ever fires on a pathological empty path, so no existing test
//   breaks — but it MUST be placed AFTER sessionManager.initialize() (needs
//   session.metadata.path) and BEFORE the method returns.

// CRITICAL (pipeline layer never process.exit): guards in initializeSession() THROW (or
//   non-fatally #trackFailure under continueOnError) so run() returns a failed
//   PipelineResult and main() maps it to exit 1. process.exit is reserved for the CLI
//   layer (parseCLIArgs + subcommand actions).

// GOTCHA (explicit mkdir(planDir) bumps the test count): createSessionDirectory already
//   mkdirs [sessionPath, architecture, prps, artifacts] = 4 calls. The new explicit
//   mkdir(planDir) FIRST makes it 5. tests/unit/core/session-utils.test.ts:361 asserts 4
//   → update to 5 AND assert calls[0][0] is the plan dir.

// GOTCHA (SessionFileError vs plain Error): SessionFileError(path, operation, cause?) is
//   the IO-error class in session-utils.ts. For VALIDATION guards (empty planDir/
//   sessionPath) a plain `throw new Error('... (PRD §4.6)')` is clearer and matches the
//   pipeline-layer guard style. Either is acceptable; keep the message actionable.

// GOTCHA (createSessionDirectory default planDir): the default `planDir = resolve('plan')`
//   is always non-empty, so the empty-planDir guard only fires if a caller explicitly
//   passes ''. Existing tests pass `undefined` (→ default) → unaffected.

// GOTCHA (hasAnySessions before initialize): safe because SessionManager ctor (:204-234)
//   sets this.planDir = resolve(planDir) unconditionally. initialize() is NOT required.

// GOTCHA (README curated subset): README omits --accept-prd-changes, but the work-item
//   DOCS contract says add --adopt-prd to BOTH CLI_REFERENCE.md and README.md. The
//   explicit contract overrides the subset convention.

// GOTCHA (S1 is INERT on the fresh-project adopt path): do NOT implement seeding (S2),
//   the .adopted marker (S2), or SKIP_EXECUTION_LOOP (S2). S1 logs the seam and proceeds
//   to normal session creation. The EXTENSION POINT comment is the handoff to S2.

// GOTCHA (100% coverage gate): vitest.config.ts enforces 100% globally. New branches —
//   adoptPrd true/false × hasAnySessions true/false × sessionPath empty/not — MUST all be
//   covered by the new describe blocks.
```

---

## Implementation Blueprint

### Data models and structure

No new data models. `adoptPrd` is a plain boolean CLI flag → constructor param → private
field, mirroring `acceptPrdChanges`. `hasAnySessions(): Promise<boolean>` is a new
instance method returning a boolean. No Zod/schema/config changes.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/cli/index.ts — add --adopt-prd flag + interface field
  - ADD to CLIArgs interface (near acceptPrdChanges, ~:92):
      /** Declare the PRD as the source of truth for an already-implemented codebase
       *  (PRD §4.6 Adopt Mode). On a fresh project this is the baseline-adoption flag;
       *  on a project with existing sessions it is a no-op (warn + proceed). */
      adoptPrd: boolean;
  - ADD to the Commander program (near the --accept-prd-changes .option, after it):
      .option(
        '--adopt-prd',
        'Declare the PRD as the source of truth for an already-implemented codebase (PRD §4.6)',
        false
      )
  - DO NOT add `adoptPrd` to the ValidatedCLIArgs `Omit<CLIArgs, …>` list (~:127). It
    must flow through unchanged (exactly like acceptPrdChanges).
  - GOTCHA: rail (b) "PRD must exist" is ALREADY enforced by the existing
    `if (!existsSync(options.prd)) { … process.exit(1); }` block later in parseCLIArgs.
    Do NOT duplicate it. Adopt mode inherits it.

Task 2: MODIFY src/core/session-manager.ts — add hasAnySessions() instance method
  - ADD a public instance method (near #findSessionByHash / #getNextSequence, ~:266-292,
    which already call SessionManager.__scanSessionDirectories):
      /**
       * Returns true iff at least one session directory exists under this.planDir.
       *
       * Used by the --adopt-prd guard rail (PRD §4.6): adopt mode applies only to fresh
       * projects; if sessions already exist the flag is a no-op. Safe to call BEFORE
       * {@link initialize} — only requires {@link planDir} (set in the constructor).
       *
       * @returns true if any `NNN_<hash>` session dir exists under this.planDir.
       */
      async hasAnySessions(): Promise<boolean> {
        const sessions: SessionDirInfo[] =
          await SessionManager.__scanSessionDirectories(this.planDir);
        return sessions.length > 0;
      }
  - NOTE: `SessionDirInfo` and `SessionManager.__scanSessionDirectories` are already in
    scope (used at :267-268). No new imports.
  - SCOPE: additive method only. initialize() UNCHANGED.

Task 3: MODIFY src/core/session-utils.ts — createSessionDirectory guard rails (d)+(e)
  - In createSessionDirectory() (:599), INSERT as the FIRST operations (before hash
    computation):
      // PRD §4.6 guard rail (e): mkdir -p PLAN_DIR FIRST so the session path is always
      // nested under it, and reject an empty planDir so collapsed root paths can never
      // be written.
      if (!planDir || planDir.trim() === '') {
        throw new Error('planDir cannot be empty (PRD §4.6)');
      }
      await mkdir(planDir, { recursive: true, mode: 0o755 });
  - AFTER computing `const sessionPath = join(planDir, sessionId);`, INSERT:
      // PRD §4.6 guard rail (d): reject an empty computed session path.
      if (!sessionPath || sessionPath.trim() === '') {
        throw new Error('Computed session path is empty (PRD §4.6)');
      }
  - PRESERVE the existing mkdir loop over [sessionPath, architecture, prps, artifacts]
    unchanged (it still runs; the explicit mkdir(planDir) above is ADDITIONAL and is the
    documented ordering guarantee).
  - GOTCHA: `mkdir` is already imported from node:fs/promises (:29). No new import.
  - SCOPE: createSessionDirectory only.

Task 4: MODIFY src/workflows/prp-pipeline.ts — 24th ctor param + field
  - ADD the 24th constructor param (after acceptPrdChanges, ~:366):
      adoptPrd: boolean = false
  - ADD the private field (near acceptPrdChanges field, ~:185):
      /**
       * `--adopt-prd` (PRD §4.6 Adopt Mode): declare the PRD the source of truth for an
       * already-implemented codebase. Guard rails (no-op if sessions exist, reject empty
       * SESSION_DIR, mkdir -p PLAN_DIR) run in {@link initializeSession}. The baseline
       * seeding (completed tasks.json + .adopted marker + SKIP_EXECUTION_LOOP) is
       * implemented in P5.M1.T1.S2; S1 is intentionally inert on the fresh-project path.
       */
      private readonly adoptPrd: boolean = false;
  - ADD the assignment in the ctor body (near this.acceptPrdChanges = acceptPrdChanges,
    ~:403):
      this.adoptPrd = adoptPrd;
  - SCOPE: ctor signature + field + assignment only. No behavior yet.

Task 5: MODIFY src/workflows/prp-pipeline.ts — adopt guard-rail block in initializeSession()
  - FIND the seam in initializeSession() (~:575-706): AFTER the validate/bug-hunt reuse
    block (`if (this.mode === 'validate' || this.mode === 'bug-hunt') { … }`, :590-632)
    and BEFORE `const session = await this.sessionManager.initialize();` (:634).
  - INSERT:
      // ============================================================
      // PRD §4.6 Adopt Mode (--adopt-prd) guard rails.
      // Applies only to fresh projects; if sessions already exist the flag is a no-op
      // misuse (warn and proceed with normal session resolution). The baseline seeding
      // (completed tasks.json + .adopted marker + SKIP_EXECUTION_LOOP) is implemented in
      // P5.M1.T1.S2; P5.M1.T1.S1 (this block) is intentionally inert on the fresh path.
      // ============================================================
      if (this.adoptPrd) {
        const hasSessions = await this.sessionManager.hasAnySessions();
        if (hasSessions) {
          this.logger.warn(
            `[PRPPipeline] --adopt-prd is a no-op: sessions already exist in ${this.sessionManager.planDir}; proceeding with normal session resolution (PRD §4.6)`
          );
          // Fall through to normal session resolution below (rail c: warn + proceed).
        } else {
          // EXTENSION POINT (P5.M1.T1.S2): seed completed baseline tasks.json +
          // .adopted marker + SKIP_EXECUTION_LOOP=true here. S1 threads the flag +
          // guard rails only and is intentionally inert on the fresh-project path.
          this.logger.info(
            '[PRPPipeline] --adopt-prd set on fresh project (no sessions); adopt baseline seeding is implemented in P5.M1.T1.S2'
          );
          // Fall through to normal session creation below.
        }
      }
  - GOTCHA: do NOT call sessionManager.initialize() inside this block — both branches
    fall through to the existing :634 call.

Task 6: MODIFY src/workflows/prp-pipeline.ts — empty-SESSION_DIR hard guard (rail d)
  - FIND: right AFTER `const session = await this.sessionManager.initialize();` (:634)
    and its surrounding log lines, BEFORE the MetricsCollector/TaskOrchestrator setup.
  - INSERT:
      // ============================================================
      // PRD §4.6 guard rail (d): reject an empty SESSION_DIR before breakdown/validation
      // so collapsed root paths can never be written. General guard (runs for ALL
      // sessions, not just adopt) — only ever fires on a pathological empty path.
      // ============================================================
      if (!session.metadata.path || session.metadata.path.trim() === '') {
        throw new Error(
          'Session directory (SESSION_DIR) is empty; refusing to proceed to breakdown/validation to prevent collapsed root paths (PRD §4.6)'
        );
      }
  - GOTCHA: this is OUTSIDE the adoptPrd `if` (general). It throws → caught by the
    initializeSession() try/catch (:701) → isFatalError decides re-throw vs #trackFailure.
    Under default (no --continue-on-error) it re-throws → run() returns failed result.
    That is the desired "exit loudly" behavior.

Task 7: MODIFY src/index.ts — thread args.adoptPrd into PRPPipeline
  - FIND `const pipeline = new PRPPipeline(…)` (:233-261). The LAST positional arg is
    `args.acceptPrdChanges`.
  - APPEND `args.adoptPrd` as the 24th positional arg (immediately after
    `args.acceptPrdChanges`).
  - GOTCHA: do NOT add an early-return for adopt mode in main() — adopt is NOT
    credential-free (S3 runs validation/bug-hunt). It threads the flag and runs the
    normal pipeline.

Task 8: MODIFY docs/CLI_REFERENCE.md — add --adopt-prd (Mode A)
  - In `### Boolean Flags`, ADD a table row immediately AFTER the `--accept-prd-changes`
    row (:251), matching the 4-col pipe padding:
      | `--adopt-prd`        | boolean | false   | Declare the PRD as the source of truth for an already-shipped codebase (PRD §4.6) |
  - In `Flag Details:`, ADD a bullet immediately AFTER the `--accept-prd-changes` bullet
    (:269), before `### Limit Options` (:271):
      - **`--adopt-prd`**: Declare the PRD the source of truth for an *already-implemented* codebase (PRD §4.6). On a **fresh project** (no `plan/` sessions) it seeds a completed baseline session (P5.M1.T1.S2) so future PRD edits produce deltas against the real code. Guard rails: requires the PRD to exist; is a **no-op** (warn + proceed) if sessions already exist; rejects an empty session dir; and `mkdir -p`s the plan dir first. See [Adopt Mode](#adopt-mode) (PRD §4.6).
  - GOTCHA: keep one blank line before `### Limit Options`. Match pipe padding or run
    `npm run format`.

Task 9: MODIFY README.md — add --adopt-prd row (Mode A)
  - In `## CLI Options`, ADD a row (after the `--validate-prd` row :221, or after
    `--no-cache` :224 keeping `--help` :225 last), 5-col, Alias `-`:
      | `--adopt-prd`        | -     | boolean | false      | Adopt an already-implemented codebase against the PRD (PRD §4.6)            |
  - GOTCHA: README is a curated subset (omits --accept-prd-changes) but the work-item
    DOCS contract mandates README inclusion — add it.

Task 10: MODIFY tests/unit/cli/index.test.ts — --adopt-prd triple
  - COPY the `--accept-prd-changes` triple (:241-276) and adapt:
      it('should default --adopt-prd to false when absent', () => {
        setArgv([]);
        const args = parseArgs();
        expect(args.adoptPrd).toBe(false);
      });
      it('should parse --adopt-prd flag as true', () => {
        setArgv(['--adopt-prd']);
        const args = parseArgs();
        expect(args.adoptPrd).toBe(true);
      });
      it('should carry --adopt-prd onto ValidatedCLIArgs', () => {
        setArgv(['--adopt-prd']);
        const args = parseArgs();
        expect('adoptPrd' in args).toBe(true);
      });
  - FOLLOW pattern: the existing acceptPrdChanges cases (:241-276) + setArgv/parseArgs
    helpers (:107/:115).

Task 11: MODIFY tests/unit/workflows/prp-pipeline.test.ts — adopt guard-rail tests
  - ADD `hasAnySessions: vi.fn()` to the createMockSessionManager factory (:268-284).
  - ADD a describe('--adopt-prd guard rails') block. Use field injection:
      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).adoptPrd = true;
  - Cases:
      (1) NO-OP ON EXISTING SESSIONS: mockManager.hasAnySessions → resolved true; spy
          logger.warn; call pipeline.initializeSession(); assert warn called with a
          string containing 'no-op' AND mockManager.initialize WAS called (normal
          resolution proceeded — did not abort).
      (2) FRESH-PROJECT INERT SEAM: mockManager.hasAnySessions → resolved false; spy
          logger.info; call pipeline.initializeSession(); assert info called with a
          string containing 'S2' (or 'P5.M1.T1.S2') AND mockManager.initialize WAS
          called (normal creation proceeded — S1 is inert, no seeding in S1).
      (3) adoptPrd FALSE (control): do NOT set adoptPrd; assert hasAnySessions is NEVER
          called (the adopt block is skipped entirely).
      (4) EMPTY-SESSION_DIR HARD GUARD: mockManager.initialize → resolved session with
          metadata.path = '' (and adoptPrd can be false — guard is general); call
          pipeline.initializeSession(); assert it rejects / throws with a message
          containing 'SESSION_DIR' (or 'empty'). (Under default continueOnError=false
          initializeSession re-throws → rejects.)
  - FOLLOW pattern: the existing initializeSession() delta tests (:570+) — set mock
    return, spy, call initializeSession, assert. createMockSessionManager returns
    `initialize: vi.fn().mockResolvedValue(session)`.
  - GOTCHA: for case (4), the empty-path session must still be a valid SessionState
    shape (metadata.path='' is the only mutation). Mirror createTestSession.

Task 12: MODIFY tests/unit/core/session-utils.test.ts — createSessionDirectory guard tests
  - In the existing 'should create session directory with all subdirectories' test (:331-
    369), CHANGE `expect(mockMkdir).toHaveBeenCalledTimes(4)` (:361) → `5` AND add:
      // PRD §4.6 (e): the FIRST mkdir is the plan dir itself.
      const firstCallPath = calls[0][0];
      expect(firstCallPath).toMatch(/plan$/);
    (the explicit mkdir(planDir) is now call 0; the 4 session subdirs follow).
  - ADD:
      it('should throw on empty planDir (PRD §4.6)', async () => {
        mockMkdir.mockResolvedValue(undefined);
        await expect(createSessionDirectory('/test/PRD.md', 1, '', PRECOMPUTED_HASH))
          .rejects.toThrow(/planDir cannot be empty/);
      });
      it('should mkdir -p the plan dir as the FIRST operation (PRD §4.6)', async () => {
        mockMkdir.mockResolvedValue(undefined);
        await createSessionDirectory('/test/PRD.md', 1, '/tmp/planX', PRECOMPUTED_HASH);
        expect(mockMkdir.mock.calls[0][0]).toBe('/tmp/planX');
      });
  - GOTCHA: the empty-planDir test passes planDir='' which fails BEFORE any mkdir, so
    mockMkdir is not called — assert toThrow only. The other createSessionDirectory tests
    (:377+) pass planDir=undefined (→ default resolve('plan'), non-empty) → unaffected by
    the guard.

Task 13: VERIFY npm run validate + coverage
  - `npm run validate` (= lint && format:check && typecheck && test:run) → GREEN.
  - `npm run test:coverage` → 100% (all new branches covered).
  - `git diff --name-only` → EXACTLY the 10 listed files.
  - If coverage drops: ensure adoptPrd true/false × hasAnySessions true/false ×
    sessionPath empty/not are all exercised (Tasks 11-12).
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (CLI boolean flag — mirror acceptPrdChanges):
//   CLIArgs: `adoptPrd: boolean;`  (NOT in ValidatedCLIArgs Omit list)
//   Commander: `.option('--adopt-prd', '<desc> (PRD §4.6)', false)`

// PATTERN (24th constructor param + field — mirror acceptPrdChanges):
constructor(
  /* …22 existing…, */
  acceptPrdChanges: boolean = false,
  adoptPrd: boolean = false,           // NEW 24th
) {
  /* … */
  this.acceptPrdChanges = acceptPrdChanges;
  this.adoptPrd = adoptPrd;            // NEW
}
// private readonly adoptPrd: boolean = false;

// PATTERN (hasAnySessions — wraps existing static scan, safe before initialize):
async hasAnySessions(): Promise<boolean> {
  const sessions = await SessionManager.__scanSessionDirectories(this.planDir);
  return sessions.length > 0;
}

// PATTERN (adopt guard-rail block — warn+proceed vs inert seam; NEVER abort):
if (this.adoptPrd) {
  const hasSessions = await this.sessionManager.hasAnySessions();
  if (hasSessions) {
    this.logger.warn(`[PRPPipeline] --adopt-prd is a no-op: sessions already exist in ${this.sessionManager.planDir}; proceeding with normal session resolution (PRD §4.6)`);
  } else {
    // EXTENSION POINT (P5.M1.T1.S2): seed baseline here. S1 is inert.
    this.logger.info('[PRPPipeline] --adopt-prd set on fresh project (no sessions); adopt baseline seeding is implemented in P5.M1.T1.S2');
  }
}
// BOTH branches fall through to: const session = await this.sessionManager.initialize();

// PATTERN (empty-SESSION_DIR hard guard — general, AFTER initialize):
const session = await this.sessionManager.initialize();
if (!session.metadata.path || session.metadata.path.trim() === '') {
  throw new Error('Session directory (SESSION_DIR) is empty; refusing to proceed to breakdown/validation to prevent collapsed root paths (PRD §4.6)');
}

// PATTERN (createSessionDirectory rails — explicit mkdir-p-planDir FIRST):
if (!planDir || planDir.trim() === '') {
  throw new Error('planDir cannot be empty (PRD §4.6)');
}
await mkdir(planDir, { recursive: true, mode: 0o755 });
/* … hash … */
const sessionPath = join(planDir, sessionId);
if (!sessionPath || sessionPath.trim() === '') {
  throw new Error('Computed session path is empty (PRD §4.6)');
}
/* … existing mkdir loop over [sessionPath, architecture, prps, artifacts] … */

// ANTI-PATTERN (forbidden): implementing seeding / .adopted / SKIP_EXECUTION_LOOP in S1
//   (that is S2). S1 is the flag + guard rails + docs only.
// ANTI-PATTERN (forbidden): making rail (c) abort or early-return — it MUST warn + fall
//   through to normal session resolution.
// ANTI-PATTERN (forbidden): calling process.exit in the pipeline layer — THROW so run()
//   returns a failed PipelineResult.
// ANTI-PATTERN (forbidden): adding adoptPrd to the ValidatedCLIArgs Omit list (it would
//   be stripped and args.adoptPrd would be undefined).
// ANTI-PATTERN (forbidden): modifying SessionManager.initialize(), fix-cycle-workflow.ts,
//   or bug-hunt-workflow.ts (out of scope / owned by other items).
```

### Integration Points

```yaml
CLI (src/cli/index.ts):
  - ADD: adoptPrd field to CLIArgs; --adopt-prd .option(..., false).

PIPELINE (src/workflows/prp-pipeline.ts):
  - ADD: 24th ctor param adoptPrd + private field + assignment.
  - ADD: adopt guard-rail block in initializeSession() (rail c).
  - ADD: empty-SESSION_DIR hard guard in initializeSession() (rail d, general).

SESSION MANAGER (src/core/session-manager.ts):
  - ADD: hasAnySessions() instance method. initialize() UNCHANGED.

SESSION UTILS (src/core/session-utils.ts):
  - ADD: createSessionDirectory explicit mkdir-p-planDir first (rail e) + empty-planDir
         reject + empty-sessionPath reject (rail d defense-in-depth).

ENTRY POINT (src/index.ts):
  - ADD: args.adoptPrd as 24th positional arg to new PRPPipeline(...).

DOCS (docs/CLI_REFERENCE.md, README.md):
  - ADD: --adopt-prd row + bullet (CLI_REFERENCE) + row (README). Mode A.

NO DATABASE / NO ROUTES / NO NEW SUBCOMMAND / NO NEW CONFIG OR ENV CONSTANT / NO NEW
DEPENDENCY.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After each source edit — fix before proceeding
npm run lint            # eslint . --ext .ts  (expected: zero errors)
npm run format:check    # prettier --check    (run `npm run format` to fix table padding)
npm run typecheck       # tsc --noEmit -p tsconfig.build.json (expected: zero errors)

# Canonical CI gate
npm run validate        # = lint && format:check && typecheck && test:run

# Expected: Zero errors. READ the output and fix before proceeding.
# Watch for: adoptPrd unused-import/unused-field if a later task didn't land; table
# pipe-padding flagged by prettier/markdownlint.
```

### Level 2: Unit Tests (Component Validation)

```bash
# CLI parse tests (--adopt-prd triple)
npx vitest run tests/unit/cli/index.test.ts

# Pipeline adopt guard-rail tests
npx vitest run tests/unit/workflows/prp-pipeline.test.ts

# createSessionDirectory guard tests (+ the mockMkdir 4→5 bump)
npx vitest run tests/unit/core/session-utils.test.ts

# Full suites for the touched areas
npx vitest run tests/unit/cli/ tests/unit/workflows/ tests/unit/core/

# Expected: All pass. If session-utils 'toHaveBeenCalledTimes(4)' test fails, you forgot
# Task 12 (bump to 5). If an existing initializeSession test fails on the empty-SESSION_DIR
# guard, the mock session's metadata.path is '' — fix the mock to return a real path.
```

### Level 3: Integration Testing (System Validation)

```bash
# Coverage gate — MUST stay 100% globally (vitest.config.ts)
npm run test:coverage
# Confirm the new branches are ALL covered:
#   adoptPrd: true/false; hasAnySessions: true/false; session.metadata.path: ''/non-empty;
#   createSessionDirectory: empty-planDir / empty-sessionPath / mkdir-planDir-first.

# Grep guards — flag + rails present
grep -n "adoptPrd\|hasAnySessions\|--adopt-prd" src/cli/index.ts src/workflows/prp-pipeline.ts \
  src/core/session-manager.ts src/core/session-utils.ts src/index.ts
# Expected: adoptPrd in cli + pipeline; hasAnySessions in session-manager + pipeline call;
#   --adopt-prd in cli; rails (d)+(e) in session-utils; args.adoptPrd in index.ts.

grep -n "adopt" docs/CLI_REFERENCE.md README.md   # Expected: present in BOTH

# Scope guard — no forbidden files touched
git diff --name-only
# Expected: EXACTLY the 10 listed files (4 src + 1 session-manager + 1 session-utils +
#   1 index.ts + 2 docs + 3 tests = 12? NO — count: cli/index.ts, prp-pipeline.ts,
#   session-manager.ts, session-utils.ts, index.ts = 5 src; CLI_REFERENCE.md, README.md
#   = 2 docs; index.test.ts, prp-pipeline.test.ts, session-utils.test.ts = 3 tests → 10).
git diff --name-only | grep -E "fix-cycle-workflow|bug-hunt-workflow|PRD.md|tasks.json"  # NO matches
git diff --name-only | grep -n "session-manager.ts" && \
  git diff src/core/session-manager.ts | grep -E "^\+" | grep -v "hasAnySessions" | grep -vE "^\+\s*\*|^\+\s*//|^\+\s*$"
# Expected: initialize() UNCHANGED — only the hasAnySessions method added (plus comments).

# Expected: coverage 100%; grep guards clean; exactly 10 files changed.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral smoke (via the new vitest cases — there is no direct adopt CLI runner
# until S2 lands seeding):
#   1. --adopt-prd parses to args.adoptPrd===true; absent → false (index.test.ts).
#   2. adoptPrd + hasAnySessions===true → warn 'no-op' + initialize still called
#      (normal resolution proceeds; no abort).
#   3. adoptPrd + hasAnySessions===false → info 'S2 seam' + initialize still called
#      (S1 inert; no seeding).
#   4. adoptPrd===false → hasAnySessions NEVER called (block skipped).
#   5. session.metadata.path==='' → initializeSession rejects 'SESSION_DIR … empty'.
#   6. createSessionDirectory('', …) → rejects 'planDir cannot be empty'.
#   7. createSessionDirectory(…, validPlanDir, …) → FIRST mkdir call is planDir.

# End-to-end CLI smoke (S1 behavior — inert fresh path; no real adopt yet):
npm run dev -- --prd ./PRD.md --adopt-prd --dry-run
# Expected: dry-run prints args (incl. adoptPrd) and exits 0 (credential-free early return
# in main() happens BEFORE the pipeline; confirms the flag parses). NOTE: --dry-run
# short-circuits before PRPPipeline is constructed, so this only proves parsing. For the
# guard-rail behavior, rely on the Level 2 vitest cases.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed successfully.
- [ ] All tests pass: `npm run test:run`.
- [ ] No linting errors: `npm run lint`.
- [ ] No type errors: `npm run typecheck`.
- [ ] No formatting issues: `npm run format:check`.
- [ ] Coverage 100%: `npm run test:coverage`.

### Feature Validation

- [ ] `--adopt-prd` parses (default false, present true, carried onto ValidatedCLIArgs).
- [ ] `adoptPrd` is the 24th PRPPipeline ctor param + private field; `main()` threads it.
- [ ] `hasAnySessions()` exists on SessionManager and returns the scan length > 0.
- [ ] Adopt block warns + proceeds on existing sessions; logs S2 seam on fresh projects;
      both fall through to normal session resolution.
- [ ] Empty-SESSION_DIR hard guard throws (general, after initialize()).
- [ ] createSessionDirectory mkdir-p's planDir first + rejects empty planDir/sessionPath.
- [ ] `docs/CLI_REFERENCE.md` + `README.md` document `--adopt-prd`.
- [ ] `git diff --name-only` = exactly the 10 files; initialize() unchanged.

### Code Quality Validation

- [ ] Follows existing patterns (mirrors `acceptPrdChanges` for the flag + field).
- [ ] File placement matches the desired codebase tree.
- [ ] Anti-patterns avoided (no seeding in S1; rail c never aborts; no process.exit in
      pipeline layer; adoptPrd not in the Omit list).
- [ ] No new dependency / config / env constant.

### Documentation & Deployment

- [ ] `--adopt-prd` row + bullet in CLI_REFERENCE.md; row in README.md.
- [ ] JSDoc on `adoptPrd` field, `hasAnySessions()`, and the adopt block cite PRD §4.6.
- [ ] EXTENSION POINT (P5.M1.T1.S2) comment marks the seeding seam for the next subtask.

---

## Anti-Patterns to Avoid

- ❌ Don't implement adopt *seeding* (baseline tasks.json / `.adopted` / SKIP_EXECUTION_LOOP)
     — that is P5.M1.T1.S2. S1 is the flag + guard rails + docs only.
- ❌ Don't make rail (c) abort or early-return — it MUST warn and fall through to normal
     session resolution.
- ❌ Don't call `process.exit` in the pipeline layer — THROW so `run()` returns a failed
     `PipelineResult`.
- ❌ Don't add `adoptPrd` to the `ValidatedCLIArgs` `Omit` list (it would be stripped).
- ❌ Don't modify `SessionManager.initialize()`, `fix-cycle-workflow.ts`, or
     `bug-hunt-workflow.ts` (out of scope / owned by other items).
- ❌ Don't skip the `mockMkdir` count bump (4→5) in `session-utils.test.ts` — it WILL fail.
- ❌ Don't add an early-return for adopt mode in `main()` — adopt is not credential-free.
- ❌ Don't hardcode values that should be config (none needed here).
- ❌ Don't catch all exceptions — be specific (the empty-SESSION_DIR guard throws a typed
     `Error`; initializeSession's existing try/catch decides fatal vs non-fatal).