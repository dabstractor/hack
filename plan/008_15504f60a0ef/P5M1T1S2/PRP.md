# PRP — P5.M1.T1.S2: Seed completed baseline `tasks.json`, `.adopted` marker, and `SKIP_EXECUTION_LOOP`

---

## Goal

**Feature Goal**: Implement the **seeding half** of Adopt Mode (PRD §4.6). On a fresh
project with `--adopt-prd`, after `SessionManager.initialize()` creates the session dir +
`prd_snapshot.md`, S2 seeds a **single completed baseline** (`tasks.json` = one Phase →
Milestone → Task → "Adopt existing codebase" Subtask, **all** `Complete`), writes an
`.adopted` marker, and sets `SKIP_EXECUTION_LOOP=true` on the pipeline instance — so the
Architect agent is never invoked (zero tokens), the execution loop is skipped, yet
`decomposePRD()`/`executeBacklog()` no-op cleanly and validation + bug-hunt (S3) still run.
This adopted session becomes the idempotent baseline that future deltas diff against.

**Deliverable**:
1. `SessionManager.seedAdoptedBaseline(): Promise<SessionState>` — writes `.adopted` +
   the completed baseline `tasks.json` + updates the in-memory `taskRegistry`. (Reuses
   `initialize()`'s dir/snapshot; does NOT duplicate them.)
2. `createAdoptedBaseline(): Backlog` — exported pure factory for the 4-level complete
   hierarchy (also directly unit-testable).
3. `PRPPipeline.skipExecutionLoop` field + a post-`initialize()` seeding call (gated on
   `adoptFresh`) in `initializeSession()` (replacing S1's `EXTENSION POINT` comment).
4. `executeBacklog()` early-skip guard when `skipExecutionLoop` is true.
5. `docs/CONFIGURATION.md` — new `### Adopt Mode (\`--adopt-prd\`)` subsection (Mode A).
6. Unit tests for the seeding + the skip (TDD): `session-manager.test.ts` (baseline shape
   + seedAdoptedBaseline writes marker + tasks.json + updates memory + throws pre-init) and
   `prp-pipeline.test.ts` (seeds on fresh adopt, sets skipExecutionLoop, executeBacklog skips).

**Success Definition**: On `--adopt-prd` + fresh project, `initializeSession()` produces a
session whose disk has `.adopted` + a schema-valid completed `tasks.json` (all items
`Complete`); `this.skipExecutionLoop === true`; `decomposePRD()` auto-skips (non-empty
backlog, no architect agent invoked); `executeBacklog()` early-returns (skip guard); the
next `PRD.md` edit produces a normal delta session. `npm run validate` GREEN;
`npm run test:coverage` stays 100%; `git diff --name-only` shows EXACTLY the listed files.

---

## User Persona (if applicable)

**Target User**: A pipeline operator whose codebase **already ships** and who wrote a
`PRD.md` retroactively. They run `npm run dev -- --prd ./PRD.md --adopt-prd` so the PRD
becomes the source of truth and future edits diff against the real code — without a
wasteful re-build of existing code.

**User Journey**: S1 parses `--adopt-prd` → threads into `PRPPipeline` → `initializeSession()`
→ adopt guard rail: `hasAnySessions()` false → **S2**: fall through to `initialize()`
(creates dir + snapshot) → `seedAdoptedBaseline()` writes `.adopted` + completed baseline +
sets `skipExecutionLoop` → `decomposePRD()` auto-skips → `executeBacklog()` skip-guard
returns → (S3) `#runValidation()` + `runQACycle()` run against the real codebase.

**Pain Points Addressed**: today the only ways onto the pipeline are a full breakdown+implement
pass (re-implements existing code) or nothing. S2 makes the adopted session the idempotent
baseline so deltas drive ongoing development from the real codebase.

---

## Why

- **PRD compliance (§4.6 "Adopt Mode")**: verbatim — "Seeds a single completed `tasks.json`
  (one Phase → Milestone → Task → 'Adopt existing codebase' Subtask, all `Complete`) with no
  breakdown and no agent tokens, so `is_session_complete` is true"; "Sets
  `SKIP_EXECUTION_LOOP=true`: implementation is skipped, but validation + bug hunt still run".
- **Work-item CONTRACT mapping**:
  - **(1) RESEARCH NOTE** — `phase_findings.md §PHASE 5` + this PRP's research notes map
    exactly (seed-after-initialize, decomposePRD auto-skip, skipExecutionLoop guard).
  - **(2) INPUT** — `adoptPrd` field + `hasAnySessions()` from **P5.M1.T1.S1**; resolved PRD
    content from **P1.M1.T2.S1** (already threaded through `initialize()` → `snapshotPRD`).
  - **(3) LOGIC** — (a) `seedAdoptedBaseline()` writes `.adopted` + completed baseline +
    updates memory; (b) all `Complete`, no architect invoked; (c) `skipExecutionLoop=true` on
    the instance; (d) all-Complete ⇒ complete baseline ⇒ next edit deltas against it.
  - **(4) OUTPUT** — "Baseline session seeding + .adopted marker + SKIP_EXECUTION_LOOP.
    Consumed by P5.M1.T1.S3." (S3 reads `this.skipExecutionLoop` + the `.adopted` marker.)
  - **(5) DOCS** — "[Mode A] Add 'Adopt lifecycle' subsection to docs/CONFIGURATION.md
    noting the SKIP_EXECUTION_LOOP behavior. This rides WITH the work."
- **Foundation for the milestone**: S1 (flag + guard rails) is the safe base; S2 (this)
  turns the inert seam into real seeding; S3 (validation/bug-hunt-still-run) consumes
  `skipExecutionLoop` + the adopted baseline.

---

## What

On a fresh-project `--adopt-prd` run, `initializeSession()` — after `sessionManager.initialize()`
creates the dir + writes `prd_snapshot.md` — calls `sessionManager.seedAdoptedBaseline()`,
which writes an `.adopted` marker + a schema-valid completed `tasks.json` (one all-`Complete`
hierarchy) and updates the in-memory `taskRegistry`. `PRPPipeline.skipExecutionLoop` becomes
`true`. In `run()`, `decomposePRD()` auto-skips (backlog non-empty → existing guard, zero
tokens), `executeBacklog()` early-returns (new skip guard), then `#runValidation()` +
`runQACycle()` run as normal (S3 refines adopt-specific behavior).

**No** new CLI flag (S1 owns it), **no** change to `decomposePRD()` (auto-skip suffices),
**no** change to `createSessionDirectory()`/`snapshotPRD()`/`writeTasksJSON()` (reused as-is),
**no** change to bug-hunt/validation workflows (S3), **no** new config/env constant, **no**
new dependency.

### Success Criteria

- [ ] `createAdoptedBaseline(): Backlog` is exported from `src/core/session-manager.ts` and
      returns exactly one Phase → Milestone → Task → Subtask, ALL `status: 'Complete'`, IDs
      `P1`/`P1.M1`/`P1.M1.T1`/`P1.M1.T1.S1`, Subtask `title === 'Adopt existing codebase'`,
      and **passes `BacklogSchema.parse`** (i.e. `writeTasksJSON` would accept it).
- [ ] `SessionManager.seedAdoptedBaseline()` (a) requires `#currentSession` set (throws a
      clear error otherwise); (b) writes `join(sessionPath, '.adopted')`; (c) calls
      `writeTasksJSON(sessionPath, createAdoptedBaseline())`; (d) updates in-memory
      `this.#currentSession.taskRegistry` to the baseline; (e) returns the updated `SessionState`.
- [ ] In `initializeSession()`, when `adoptPrd && !hasAnySessions()`: after
      `sessionManager.initialize()`, `seedAdoptedBaseline()` is called and
      `this.skipExecutionLoop = true` is set (S1's `EXTENSION POINT` comment is replaced
      by this real seeding). The existing-session branch (warn+proceed) does NOT seed.
- [ ] `PRPPipeline.skipExecutionLoop: boolean` (default `false`) is a new private field.
- [ ] `executeBacklog()` early-returns (`this.currentPhase = 'backlog_complete'` + info log)
      when `this.skipExecutionLoop === true`, WITHOUT entering the orchestrator loop.
- [ ] `decomposePRD()` is UNCHANGED and auto-skips for the seeded baseline (no new code).
- [ ] `docs/CONFIGURATION.md` gains a `### Adopt Mode (\`--adopt-prd\`)` subsection under
      `## CLI Options` documenting the seeding + `SKIP_EXECUTION_LOOP` lifecycle.
- [ ] `npm run validate` GREEN; `npm run test:coverage` 100%; `git diff --name-only` =
      exactly the listed files.

---

## All Needed Context

### Context Completeness Check

✅ "No Prior Knowledge" — an agent with zero codebase knowledge can implement this from:
the exact S1 seam (quoted), the exact `initialize()` new-session path (quoted), the exact
model/schema fields (quoted), the `writeTasksJSON`/`snapshotPRD` signatures, the
`decomposePRD()` auto-skip guard (quoted), the `run()` step ordering, the docs insertion
line, and the test-mock conventions (quoted). No inference required.

### Documentation & References

```yaml
# MUST READ — this PRP's own design notes (the WHY behind seed-after-initialize)
- file: plan/008_15504f60a0ef/P5M1T1S2/research/design-decisions.md
  why: §1 (why seed AFTER initialize, not standalone createAdoptedSession), §2 (decomposePRD
       auto-skip = free zero-token skip), §3 (skipExecutionLoop guard), §4 (baseline shape),
       §5 (.adopted marker), §6 (is_session_complete is a data property), §7 (docs), §8 (scope).

# MUST READ — the PREVIOUS PRP (P5.M1.T1.S1) = the contract S2 consumes/extends
- file: plan/008_15504f60a0ef/P5M1T1S1/PRP.md
  why: S1 adds `adoptPrd` field (24th ctor param), `hasAnySessions()` on SessionManager, the
       adopt guard-rail block in initializeSession() with the `EXTENSION POINT (P5.M1.T1.S2)`
       comment (Task 5), and the fall-through to `sessionManager.initialize()`. S2 REPLACES
       that EXTENSION POINT comment with real seeding and consumes `this.adoptPrd` +
       `this.sessionManager.hasAnySessions()`.
  section: "Task 5" (adopt guard-rail block + EXTENSION POINT) + "Success Criteria".

# MUST READ — the pipeline file S2 modifies
- file: src/workflows/prp-pipeline.ts
  section: initializeSession() (:575-706): the adopt block (S1, after validate/bug-hunt reuse
           :590-632, before `const session = await this.sessionManager.initialize()` :634);
           the `executeBacklog()` method (:1168, guard goes at the very top after the
           `this.logger.info('Executing backlog')`); `run()` (:2310-2385) step order:
           initializeSession → decomposePRD (:2333) → rebuildQueue (:2349) → executeBacklog
           (:2357) → #runValidation (:2373) → runQACycle (:2375).
  why: S2 adds the `skipExecutionLoop` field, the post-initialize seeding call, and the
       executeBacklog skip guard here.
  pattern: |
    # initializeSession() — replace S1's EXTENSION POINT branch with adoptFresh capture:
    let adoptFresh = false;
    if (this.adoptPrd) {
      const hasSessions = await this.sessionManager.hasAnySessions();
      if (hasSessions) { this.logger.warn('…no-op…'); /* fall through */ }
      else { adoptFresh = true; this.logger.info('…adopt fresh…'); /* fall through */ }
    }
    const session = await this.sessionManager.initialize();
    if (adoptFresh) {
      await this.sessionManager.seedAdoptedBaseline();
      this.skipExecutionLoop = true;
      this.logger.info('[PRPPipeline] Adopted baseline seeded (PRD §4.6); execution loop will be skipped');
    }
    # executeBacklog() — FIRST statement after the opening info log:
    if (this.skipExecutionLoop) {
      this.logger.info('[PRPPipeline] Skipping execution loop (adopt mode / SKIP_EXECUTION_LOOP)');
      this.currentPhase = 'backlog_complete';
      return;
    }
  gotcha: |
    - The adopt block (S1) runs BEFORE initialize(); the seeding runs AFTER it (needs the dir).
      Capture `adoptFresh` in the block, use it after initialize().
    - Do NOT add a skip to decomposePRD() — its existing non-empty-backlog guard (:1036)
      already skips the architect for free once the in-memory taskRegistry is seeded.

# MUST READ — SessionManager (where seedAdoptedBaseline + createAdoptedBaseline live)
- file: src/core/session-manager.ts
  section: `#currentSession` field (:169) + getter (:245); `initialize()` new-session path
           (:461-548 — createSessionDirectory, snapshotPRD, builds SessionState with
           `taskRegistry: { backlog: [] }`); imports already present: `writeTasksJSON`,
           `snapshotPRD` from session-utils (:42-ish); `writeFile`/`join` (add if missing).
  why: ADD `seedAdoptedBaseline()` + `createAdoptedBaseline()` here. seedAdoptedBaseline
       REUSES writeTasksJSON (which validates via BacklogSchema.parse) and writes the
       `.adopted` marker via writeFile.
  pattern: |
    // module-private (or exported for test) factory:
    export function createAdoptedBaseline(): Backlog { /* 4-level all-Complete hierarchy */ }
    // instance method (requires #currentSession set by initialize()):
    async seedAdoptedBaseline(): Promise<SessionState> {
      if (!this.#currentSession) throw new Error('seedAdoptedBaseline requires an initialized session (call initialize() first) (PRD §4.6)');
      const sessionPath = this.#currentSession.metadata.path;
      await writeFile(join(sessionPath, '.adopted'), `Adopted baseline (PRD §4.6).\nCreated: ${new Date().toISOString()}\n`);
      const baseline = createAdoptedBaseline();
      await writeTasksJSON(sessionPath, baseline);   // BacklogSchema.parse + atomicWrite
      this.#currentSession = { ...this.#currentSession, taskRegistry: baseline };
      return this.#currentSession;
    }
  gotcha: `#currentSession` is private; the immutable-spread update (`{ ...cur, taskRegistry }`)
          is the safe way to "mutate" it. Do NOT reassign nested readonly fields directly.

# MUST READ — the model/schema the baseline must satisfy (writeTasksJSON runs BacklogSchema.parse)
- file: src/core/models.ts
  section: Status enum (:200 — 'Complete' is valid); Subtask (:273 — fields id/type/title/
           status/story_points(number)/dependencies(string[])/context_scope(string)/
           prd_selectors(string[], added P1.M2.T1.S1)); Task (:437 — +subtasks[], id regex
           ^P\d+\.M\d+\.T\d+$); Milestone (:541 — +tasks[], id ^P\d+\.M\d+$); Phase (:643 —
           +milestones[], id ^P\d+$); Backlog (:757 — { backlog: Phase[] }); BacklogSchema
           (:797 — root validator).
  why: The seeded baseline MUST pass BacklogSchema.parse (writeTasksJSON enforces it). Field
        names, types, and ID regexes are all fixed.
  pattern: IDs are regex-validated: P1, P1.M1, P1.M1.T1, P1.M1.T1.S1. Title min 1 / max 200.
           description min 1 on Task/Milestone/Phase. Subtask story_points is a number.

# MUST READ — session-utils (reused, NOT modified)
- file: src/core/session-utils.ts
  section: `writeTasksJSON(sessionPath, backlog)` (:746 — BacklogSchema.parse → atomicWrite
           to `sessionPath/tasks.json`); `snapshotPRD(sessionPath, prdPath, resolved)` (:1037 —
           writes prd_snapshot.md, ALREADY called by initialize()).
  why: seedAdoptedBaseline calls writeTasksJSON (do NOT hand-roll the JSON write — you'd skip
        validation). Do NOT re-call snapshotPRD (initialize already wrote it).

# MUST READ — the docs file S2 modifies (Mode A)
- file: docs/CONFIGURATION.md
  section: `## CLI Options` (:201) → `### Delta Response` (:253) is the last CLI subsection
           before `## Model Selection` (:265). The existing `SKIP_EXECUTION_LOOP` table row
           is at :145 (Pipeline Control) — reference it, do NOT duplicate it.
  why: Add a `### Adopt Mode (\`--adopt-prd\`)` subsection AFTER `### Delta Response` (:253)
        and BEFORE `## Model Selection` (:265). Document the adopt LIFECYCLE + the
        SKIP_EXECUTION_LOOP behavior. Cite PRD §4.6.
  gotcha: markdownlint runs on docs/**/*.md (`npm run docs:lint` if wired; `npm run format`
          enforces prettier). Keep heading levels consistent (### under ##) and one blank line
          around the new block.

# REFERENCE — architecture findings (the RESEARCH NOTE the contract cites)
- file: plan/008_15504f60a0ef/architecture/phase_findings.md
  section: §PHASE 5 "Adopt Mode" (Current State: "No adopt code exists"; Required Changes:
           seed completed baseline, .adopted marker, SKIP_EXECUTION_LOOP).
- file: plan/008_15504f60a0ef/architecture/signatures.md
  section: SessionManager signatures; writeTasksJSON/readTasksJSON; Status enum.

# REFERENCE — PRD §4.6 (in selected_prd_content) + §4.1 (state check/decomposition adopt protects)
```

### Current Codebase tree (relevant slice)

```bash
src/workflows/prp-pipeline.ts        # MODIFY — + skipExecutionLoop field, + seeding in
                                     #   initializeSession (replace S1 EXTENSION POINT),
                                     #   + skip guard in executeBacklog
src/core/session-manager.ts          # MODIFY — + createAdoptedBaseline() factory,
                                     #   + seedAdoptedBaseline() method
docs/CONFIGURATION.md                # MODIFY — + ### Adopt Mode subsection (Mode A)
tests/unit/core/session-manager.test.ts   # MODIFY — + createAdoptedBaseline + seedAdoptedBaseline tests
tests/unit/workflows/prp-pipeline.test.ts # MODIFY — + adopt seeding + skipExecutionLoop tests

# REUSED (NOT modified):
src/core/session-utils.ts            # writeTasksJSON, snapshotPRD (called by seed/initialize)
src/core/models.ts                   # Backlog/Phase/.../Subtask + BacklogSchema (validated)
src/cli/index.ts                     # S1 owns --adopt-prd + adoptPrd field
```

### Desired Codebase tree with files to be added/modified

```bash
src/core/session-manager.ts
  # + export function createAdoptedBaseline(): Backlog  (pure factory; all-Complete hierarchy)
  # + async seedAdoptedBaseline(): Promise<SessionState>  (instance method: .adopted +
  #   writeTasksJSON + in-memory taskRegistry update; requires #currentSession)
src/workflows/prp-pipeline.ts
  # + private skipExecutionLoop: boolean = false;   (field near acceptPrdChanges/adoptPrd)
  # + initializeSession(): capture `adoptFresh` in S1's adopt block; after initialize(),
  #   if adoptFresh → seedAdoptedBaseline() + this.skipExecutionLoop = true + log.
  #   (REPLACES S1's `EXTENSION POINT (P5.M1.T1.S2)` comment.)
  # + executeBacklog(): first-statement skip guard (this.skipExecutionLoop → early return).
docs/CONFIGURATION.md
  # + ### Adopt Mode (`--adopt-prd`) subsection under ## CLI Options (after ### Delta Response).
tests/unit/core/session-manager.test.ts
  # + describe('createAdoptedBaseline') + describe('seedAdoptedBaseline').
tests/unit/workflows/prp-pipeline.test.ts
  # + describe('--adopt-prd baseline seeding') (fresh→seeds+skip; existing→no seed) +
  #   executeBacklog skip-when-skipExecutionLoop.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (seed AFTER initialize, not before): the session dir + prd_snapshot.md do NOT
//   exist until sessionManager.initialize() returns (it calls createSessionDirectory +
//   snapshotPRD). S1's adopt block runs BEFORE initialize(); so capture the `adoptFresh`
//   decision in the block but perform the seeding AFTER `const session = await
//   this.sessionManager.initialize()`. (research §1)

// CRITICAL (in-memory taskRegistry MUST be updated): decomposePRD() auto-skips the architect
//   ONLY if `sessionManager.currentSession.taskRegistry.backlog.length > 0`. If seedAdoptedBaseline
//   writes tasks.json to disk but does NOT update this.#currentSession.taskRegistry, the very
//   next decomposePRD() call WILL invoke the architect (burning tokens). The immutable-spread
//   update `{ ...this.#currentSession, taskRegistry: baseline }` is mandatory. (research §2)

// CRITICAL (#currentSession is private + fields readonly): do NOT mutate nested readonly
//   fields directly. Reassign the whole #currentSession via spread. seedAdoptedBaseline is an
//   instance method BECAUSE it needs private #currentSession access.

// CRITICAL (writeTasksJSON validates): hand-rolling JSON.stringify + writeFile would BYPASS
//   BacklogSchema.parse. Always go through writeTasksJSON(sessionPath, baseline) so a
//   malformed baseline fails loudly at seed time, not at first read.

// GOTCHA (ESM .js imports): in .ts source, import with `.js` specifiers —
//   `import { writeTasksJSON } from './session-utils.js';` (already imported in session-manager).
//   writeFile from 'node:fs/promises' and join from 'node:path' — check/add imports.

// GOTCHA (skip guard placement in executeBacklog): it MUST be the FIRST statement (after the
//   opening `this.logger.info('[PRPPipeline] Executing backlog')`), BEFORE the backlog
//   existence/`#countTasks()` checks, so adopt mode never touches the orchestrator loop.
//   Set this.currentPhase = 'backlog_complete' (the same value the 0-subtask path uses at :1186).

// GOTCHA (S1 dependency): this PRP assumes S1 lands `adoptPrd` (24th ctor param + field),
//   `hasAnySessions()`, and the adopt guard-rail block with the EXTENSION POINT comment
//   EXACTLY as specified. If S1 is still in flight, treat its PRP as the contract.

// GOTCHA (100% coverage gate): vitest.config.ts enforces 100% globally. New branches —
//   adoptFresh true/false, #currentSession null (throw), skipExecutionLoop true/false —
//   MUST all be covered by the new tests.

// GOTCHA (do NOT touch decomposePRD / createSessionDirectory / snapshotPRD): they are reused
//   unchanged. decomposePRD's non-empty-backlog guard is the FREE architect skip.
```

---

## Implementation Blueprint

### Data models and structure

No new persistence models. The "model" is the seeded `Backlog` (validated by `BacklogSchema`).
Type safety comes from the `Backlog`/`Phase`/`Milestone`/`Task`/`Subtask` interfaces + the
`Status` literal `'Complete'`.

```typescript
import type { Backlog } from './models.js';

/**
 * Build the single completed baseline backlog used by Adopt Mode (PRD §4.6).
 *
 * One Phase → Milestone → Task → "Adopt existing codebase" Subtask, ALL `status: 'Complete'`.
 * The returned object passes `BacklogSchema.parse` (so `writeTasksJSON` accepts it). This is
 * the idempotent baseline that future delta sessions diff against.
 *
 * @returns A schema-valid all-Complete baseline backlog.
 */
export function createAdoptedBaseline(): Backlog {
  return {
    backlog: [
      {
        id: 'P1',
        type: 'Phase',
        title: 'Adopt Existing Codebase',
        status: 'Complete',
        description: 'Baseline adoption of the already-implemented codebase against the PRD (PRD §4.6).',
        milestones: [
          {
            id: 'P1.M1',
            type: 'Milestone',
            title: 'Adopt Existing Codebase',
            status: 'Complete',
            description: 'Baseline adoption of the already-implemented codebase against the PRD (PRD §4.6).',
            tasks: [
              {
                id: 'P1.M1.T1',
                type: 'Task',
                title: 'Adopt Existing Codebase',
                status: 'Complete',
                description: 'Declare the PRD the source of truth for the already-shipped codebase (PRD §4.6).',
                subtasks: [
                  {
                    id: 'P1.M1.T1.S1',
                    type: 'Subtask',
                    title: 'Adopt existing codebase',
                    status: 'Complete',
                    story_points: 0,
                    dependencies: [],
                    context_scope: 'Adopt Mode baseline (PRD §4.6): no breakdown or implementation performed.',
                    prd_selectors: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}
```

### Implementation Tasks (ordered by dependencies — strict TDD)

```yaml
Task 1: WRITE tests in tests/unit/core/session-manager.test.ts + tests/unit/workflows/prp-pipeline.test.ts  (FAILING-FIRST — before Task 2)
  - In session-manager.test.ts ADD:
      describe('createAdoptedBaseline', () => {
        it('returns one Phase→Milestone→Task→Subtask, all Complete', () => {
          const b = createAdoptedBaseline();
          const p = b.backlog[0]; const m = p.milestones[0]; const t = m.tasks[0]; const s = t.subtasks[0];
          expect(p.id).toBe('P1'); expect(p.status).toBe('Complete');
          expect(m.id).toBe('P1.M1'); expect(m.status).toBe('Complete');
          expect(t.id).toBe('P1.M1.T1'); expect(t.status).toBe('Complete');
          expect(s.id).toBe('P1.M1.T1.S1'); expect(s.title).toBe('Adopt existing codebase');
          expect(s.status).toBe('Complete'); expect(s.prd_selectors).toEqual([]);
        });
        it('passes BacklogSchema.parse (schema-valid)', () => {
          expect(() => BacklogSchema.parse(createAdoptedBaseline())).not.toThrow();
        });
      });
      describe('seedAdoptedBaseline', () => {
        it('writes .adopted marker + tasks.json and updates in-memory taskRegistry', async () => {
          // SETUP: a manager with #currentSession set (path='/sess'); mockWriteFile + mocked
          // writeTasksJSON (session-utils is vi.mock'd at top of file). EXECUTE: seedAdoptedBaseline().
          // VERIFY: writeFile called with join('/sess','.adopted'); writeTasksJSON called with
          // ('/sess', <baseline>); currentSession.taskRegistry.backlog.length === 1.
        });
        it('throws if called before initialize() (#currentSession null)', async () => {
          // SETUP: manager with NO currentSession. EXECUTE/VERIFY: rejects.toThrow(/initialized session/).
        });
      });
    - IMPORT (add to the existing imports near top): `import { createAdoptedBaseline } from '../../../src/core/session-manager.js';`
      and `import { BacklogSchema } from '../../../src/core/models.js';`
    - NOTE: session-utils is ALREADY vi.mock'd in this file (:49) — so writeTasksJSON is a mock;
      assert `expect(writeTasksJSON).toHaveBeenCalledWith(sessionPath, expect.any(Object))` (or
      a baseline whose backlog[0].id==='P1'). writeFile is mocked via node:fs/promises (:37).
    - In prp-pipeline.test.ts ADD a describe('--adopt-prd baseline seeding'):
        (1) fresh project (hasAnySessions→false): after initializeSession(), assert
            seedAdoptedBaseline WAS called on the mock sessionManager AND (pipeline as any)
            .skipExecutionLoop === true.
        (2) existing sessions (hasAnySessions→true): assert seedAdoptedBaseline NOT called AND
            skipExecutionLoop === false.
        (3) executeBacklog skip: set (pipeline as any).skipExecutionLoop = true; spy currentPhase;
            call executeBacklog(); assert it returned WITHOUT calling taskOrchestrator.processNextItem
            and currentPhase === 'backlog_complete'.
    - Use field injection (`(pipeline as any).adoptPrd = true; (pipeline as any).sessionManager = mock`)
      mirroring the S1 prp-pipeline.test.ts pattern (S1 Task 11).
  - VERIFY RED: `npx vitest run tests/unit/core/session-manager.test.ts tests/unit/workflows/prp-pipeline.test.ts`
    → fails (createAdoptedBaseline/seedAdoptedBaseline not exported; skipExecutionLoop absent).

Task 2: MODIFY src/core/session-manager.ts — add createAdoptedBaseline() + seedAdoptedBaseline()
  - STEP 2a: ensure imports present (add if missing): `writeFile` from 'node:fs/promises';
      `join` from 'node:path'; `writeTasksJSON` is already imported (:42-ish). Verify `Backlog`
      type is imported from './models.js' (it is — used by saveBacklog).
  - STEP 2b: ADD `export function createAdoptedBaseline(): Backlog { … }` (see "Data models"
      above) as a module-level function ABOVE `export class SessionManager` (or just below the
      imports). Full JSDoc citing PRD §4.6.
  - STEP 2c: ADD the instance method inside `class SessionManager` (near saveBacklog /
      updateItemStatus, ~:1512-1641):
      /**
       * Seed the Adopt-Mode baseline for the current session (PRD §4.6).
       *
       * Writes the `.adopted` marker and a single completed baseline `tasks.json` (one
       * Phase → Milestone → Task → "Adopt existing codebase" Subtask, all `Complete`), then
       * updates the in-memory task registry so the subsequent `decomposePRD()` auto-skips the
       * Architect (zero tokens) and `executeBacklog()` is skipped via `PRPPipeline.skipExecutionLoop`.
       *
       * @remarks Requires {@link initialize} to have run (it creates the session dir + writes
       *          `prd_snapshot.md`). Reuses `writeTasksJSON` (which validates via BacklogSchema).
       * @returns The updated SessionState with the seeded baseline task registry.
       * @throws {Error} If called before {@link initialize} (#currentSession is null).
       */
      async seedAdoptedBaseline(): Promise<SessionState> {
        if (!this.#currentSession) {
          throw new Error(
            'seedAdoptedBaseline requires an initialized session (call initialize() first) (PRD §4.6)'
          );
        }
        const sessionPath = this.#currentSession.metadata.path;
        await writeFile(
          join(sessionPath, '.adopted'),
          `Adopted baseline (PRD §4.6).\nCreated: ${new Date().toISOString()}\n`
        );
        const baseline = createAdoptedBaseline();
        await writeTasksJSON(sessionPath, baseline); // BacklogSchema.parse + atomicWrite
        this.#currentSession = { ...this.#currentSession, taskRegistry: baseline };
        this.#logger?.info?.({ sessionId: this.#currentSession.metadata.id }, '[SessionManager] Adopted baseline seeded');
        return this.#currentSession;
      }
    - NOTE: if `#logger` may be undefined in some ctor paths, guard with `?.`; otherwise use
      `this.#logger.info(...)` matching the file style (the class has a logger — check ctor).
  - SCOPE: additive only. initialize() UNCHANGED.

Task 3: MODIFY src/workflows/prp-pipeline.ts — skipExecutionLoop field + seeding + guard
  - STEP 3a: ADD the field (near `private readonly adoptPrd` from S1, ~:185):
      /** True after an `--adopt-prd` fresh-project seeding (PRD §4.6). When set,
       *  {@link executeBacklog} early-returns so implementation is skipped while validation
       *  + bug hunt still run. */
      private skipExecutionLoop: boolean = false;
  - STEP 3b: In `initializeSession()`, REPLACE S1's `else { // EXTENSION POINT (P5.M1.T1.S2) … }`
      fresh-branch body so it sets a local `adoptFresh`, and ADD the post-initialize seeding.
      Net shape of the relevant region:
        let adoptFresh = false;
        if (this.adoptPrd) {
          const hasSessions = await this.sessionManager.hasAnySessions();
          if (hasSessions) {
            this.logger.warn(`[PRPPipeline] --adopt-prd is a no-op: sessions already exist in ${this.sessionManager.planDir}; proceeding with normal session resolution (PRD §4.6)`);
          } else {
            adoptFresh = true;
            this.logger.info('[PRPPipeline] --adopt-prd set on fresh project (no sessions); seeding adopted baseline (PRD §4.6)');
          }
        }
        const session = await this.sessionManager.initialize();
        // PRD §4.6 Adopt Mode: seed the completed baseline + .adopted marker, then skip execution.
        if (adoptFresh) {
          await this.sessionManager.seedAdoptedBaseline();
          this.skipExecutionLoop = true;
          this.logger.info('[PRPPipeline] Adopted baseline seeded (PRD §4.6); execution loop will be skipped (validation/bug-hunt still run)');
        }
        // … existing log lines for Session/Path/Existing + MetricsCollector + TaskOrchestrator …
    - GOTCHA: keep S1's warn-branch text + the fall-through semantics (both branches still
      reach `sessionManager.initialize()`). Only the fresh branch now also seeds after init.
    - GOTCHA: the empty-SESSION_DIR hard guard (S1, AFTER initialize) still runs AFTER the
      seeding block — fine (seedAdoptedBaseline uses session.metadata.path which S1's guard
      also validates; if path were empty, writeTasksJSON/.adopted would write near root — but
      S1's createSessionDirectory reject + initialize guard prevent that). Order: seed THEN
      S1's empty-path guard is acceptable because initialize already produced a valid path; if
      you prefer, place seeding AFTER S1's guard (both are safe — initialize guarantees a real path).
  - STEP 3c: In `executeBacklog()` (:1168), as the FIRST statement after
      `this.logger.info('[PRPPipeline] Executing backlog');`, ADD:
        // PRD §4.6 Adopt Mode: skip implementation while still allowing validation + bug hunt
        // (called later in run()). The adopted baseline is all-Complete, so nothing would run
        // anyway; this guard makes the skip explicit and fast.
        if (this.skipExecutionLoop) {
          this.logger.info('[PRPPipeline] Skipping execution loop (adopt mode / SKIP_EXECUTION_LOOP)');
          this.currentPhase = 'backlog_complete';
          return;
        }
  - SCOPE: field + initializeSession seeding block + executeBacklog guard. decomposePRD UNCHANGED.

Task 4: MODIFY docs/CONFIGURATION.md — add ### Adopt Mode subsection (Mode A)
  - In `## CLI Options`, AFTER `### Delta Response` (:253) and BEFORE `## Model Selection` (:265),
    INSERT:
        ### Adopt Mode (`--adopt-prd`)

        Declares the PRD the source of truth for an *already-implemented* codebase (PRD §4.6).
        On a **fresh project** (no `plan/` sessions), `--adopt-prd` seeds a single completed
        baseline `tasks.json` (one "Adopt existing codebase" item, all `Complete`) and writes an
        `.adopted` marker, then sets the internal `SKIP_EXECUTION_LOOP` flag so implementation
        is skipped while **validation and bug hunt still run** against the real codebase. This
        adopted session becomes the idempotent baseline that future deltas diff against.

        - Requires the PRD to exist; is a **no-op** (warn + proceed) if sessions already exist.
        - Guard rails: rejects an empty session dir and `mkdir -p`s the plan dir first.
        - See also the [`SKIP_EXECUTION_LOOP`](#pipeline-control) env var (§9.2.2) and CLI Reference → `--adopt-prd`.
  - GOTCHA: keep one blank line before `## Model Selection`. Cite PRD §4.6. `npm run format`
    will normalize spacing.

Task 5: VERIFY (validation gates)
  - RUN: `npm run validate` (lint + format:check + typecheck + test:run) → GREEN.
  - RUN: `npm run test:coverage` → 100% (all new branches covered).
  - RUN: `git diff --name-only` → EXACTLY: src/core/session-manager.ts,
      src/workflows/prp-pipeline.ts, docs/CONFIGURATION.md,
      tests/unit/core/session-manager.test.ts, tests/unit/workflows/prp-pipeline.test.ts.
  - GREP guards: `grep -n "seedAdoptedBaseline\|createAdoptedBaseline\|skipExecutionLoop" src`
      → present in session-manager.ts + prp-pipeline.ts. `grep -n "decomposePRD\|EXTENSION POINT"
      src/workflows/prp-pipeline.ts` → decomposePRD unchanged, EXTENSION POINT comment removed.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (the all-Complete baseline — see "Data models" for the full body)
export function createAdoptedBaseline(): Backlog { /* P1→P1.M1→P1.M1.T1→P1.M1.T1.S1, all Complete */ }

// PATTERN (seedAdoptedBaseline — reuses writeTasksJSON validation; updates memory immutably)
async seedAdoptedBaseline(): Promise<SessionState> {
  if (!this.#currentSession) throw new Error('seedAdoptedBaseline requires an initialized session … (PRD §4.6)');
  const sessionPath = this.#currentSession.metadata.path;
  await writeFile(join(sessionPath, '.adopted'), `Adopted baseline (PRD §4.6).\nCreated: ${new Date().toISOString()}\n`);
  const baseline = createAdoptedBaseline();
  await writeTasksJSON(sessionPath, baseline);               // BacklogSchema.parse + atomicWrite
  this.#currentSession = { ...this.#currentSession, taskRegistry: baseline }; // ← CRITICAL in-memory update
  return this.#currentSession;
}

// PATTERN (initializeSession seeding — capture adoptFresh, seed AFTER initialize)
let adoptFresh = false;
if (this.adoptPrd) {
  const hasSessions = await this.sessionManager.hasAnySessions();
  if (hasSessions) { this.logger.warn('…no-op…'); }
  else { adoptFresh = true; this.logger.info('…fresh adopt…'); }
}
const session = await this.sessionManager.initialize();
if (adoptFresh) {
  await this.sessionManager.seedAdoptedBaseline();
  this.skipExecutionLoop = true;
  this.logger.info('[PRPPipeline] Adopted baseline seeded (PRD §4.6); execution loop will be skipped');
}

// PATTERN (executeBacklog skip guard — FIRST statement)
async executeBacklog(): Promise<void> {
  this.logger.info('[PRPPipeline] Executing backlog');
  if (this.skipExecutionLoop) {                       // PRD §4.6
    this.logger.info('[PRPPipeline] Skipping execution loop (adopt mode / SKIP_EXECUTION_LOOP)');
    this.currentPhase = 'backlog_complete';
    return;
  }
  /* …existing body… */
}

// ANTI-PATTERN (forbidden): seeding BEFORE initialize() (dir/snapshot don't exist yet).
// ANTI-PATTERN (forbidden): writing tasks.json by hand (bypasses BacklogSchema.parse).
// ANTI-PATTERN (forbidden): forgetting the in-memory taskRegistry update (architect WOULD run).
// ANTI-PATTERN (forbidden): adding a skip to decomposePRD() (the non-empty-backlog guard already skips it).
// ANTI-PATTERN (forbidden): touching S1's files (cli/index.ts, createSessionDirectory) or
//   bug-hunt/validation workflows (S3 territory).
```

### Integration Points

```yaml
SESSION MANAGER (src/core/session-manager.ts):
  - ADD: createAdoptedBaseline() factory (exported) + seedAdoptedBaseline() instance method.
  - REUSE: writeTasksJSON (validation), writeFile (marker). initialize() UNCHANGED.

PIPELINE (src/workflows/prp-pipeline.ts):
  - ADD: private skipExecutionLoop field.
  - ADD: post-initialize seeding in initializeSession() (replaces S1 EXTENSION POINT comment).
  - ADD: executeBacklog() skip guard.
  - CONSUME (from S1): this.adoptPrd + this.sessionManager.hasAnySessions().

DOCS (docs/CONFIGURATION.md):
  - ADD: ### Adopt Mode (`--adopt-prd`) subsection (Mode A). Cite PRD §4.6.

NO DATABASE / NO ROUTES / NO NEW CLI FLAG (S1) / NO NEW CONFIG OR ENV CONSTANT / NO NEW
DEPENDENCY / NO CHANGE TO decomposePRD() / session-utils / models / bug-hunt / validation.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run lint            # eslint . --ext .ts  → zero errors (add @returns/@param JSDoc if flagged)
npm run format:check    # prettier --check   → run `npm run format` to fix doc/code spacing
npm run typecheck       # tsc --noEmit -p tsconfig.build.json → zero errors
npm run validate        # = lint && format:check && typecheck && test:run → GREEN

# Expected: zero errors. Watch for: unused `writeFile`/`join` import; missing JSDoc on the
# new exports; mis-sized Adopt Mode heading (### under ##).
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run tests/unit/core/session-manager.test.ts        # createAdoptedBaseline + seedAdoptedBaseline
npx vitest run tests/unit/workflows/prp-pipeline.test.ts      # adopt seeding + executeBacklog skip
npx vitest run tests/unit/core/ tests/unit/workflows/         # full touched areas

# Expected: all pass. If createAdoptedBaseline fails BacklogSchema.parse, fix field names/IDs
# (see models.ts regexes). If seedAdoptedBaseline "throws pre-init" test fails, the manager's
# #currentSession isn't null in the fixture.
```

### Level 3: Integration Testing (System Validation)

```bash
npm run test:coverage
# MUST stay 100%. Confirm new branches are covered: adoptFresh true/false; #currentSession
# null (throw); skipExecutionLoop true/false.

# Grep guards
grep -n "seedAdoptedBaseline\|createAdoptedBaseline\|skipExecutionLoop" src/core/session-manager.ts src/workflows/prp-pipeline.ts
grep -n "EXTENSION POINT" src/workflows/prp-pipeline.ts   # Expected: NO matches (S1 comment removed)
grep -n "decomposePRD" src/workflows/prp-pipeline.ts | head   # Expected: unchanged (auto-skip guard intact)
grep -n "Adopt Mode" docs/CONFIGURATION.md                # Expected: 1+ match (new subsection)

# Scope guard
git diff --name-only
# Expected: EXACTLY the 5 listed files.
git diff --name-only | grep -E "cli/index\.ts|session-utils\.ts|models\.ts|decomposePRD|bug-hunt|PRD\.md|tasks\.json"
# Expected: NO matches (forbidden files untouched; decomposePRD/session-utils unchanged).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral reasoning (covered by the vitest cases; no direct adopt CLI runner needs a live LLM):
#   1. fresh + --adopt-prd → initialize() creates dir+snapshot → seedAdoptedBaseline writes
#      .adopted + completed tasks.json + updates memory → skipExecutionLoop=true.
#   2. decomposePRD() sees backlog.length>0 → logs "Existing backlog found, skipping" → NO architect.
#   3. executeBacklog() skip-guard returns → currentPhase='backlog_complete'.
#   4. run() proceeds to #runValidation() + runQACycle() (S3 refines adopt behavior).
#   5. existing sessions + --adopt-prd → warn, NO seeding, skipExecutionLoop stays false.
#   6. seedAdoptedBaseline before initialize() → throws "requires an initialized session".

# Schema-validity smoke (the baseline MUST parse):
node --input-type=module -e "import('./dist/core/session-manager.js').then(m => {
  console.log(JSON.stringify(m.createAdoptedBaseline().backlog[0].id));  // P1
});"   # after `npm run build`

# End-to-end CLI smoke (requires S1 merged + a fresh temp plan dir; no LLM in S2's path):
rm -rf /tmp/adopt-smoke && mkdir -p /tmp/adopt-smoke && cp PRD.md /tmp/adopt-smoke/PRD.md && \
  cd /tmp/adopt-smoke && PLAN_DIR=/tmp/adopt-smoke/plan node /home/dustin/projects/hacky-hack/dist/index.js -- --prd ./PRD.md --adopt-prd --dry-run
# (dry-run short-circuits before the pipeline; for real seeding, rely on the Level 2 vitest
#  cases + a guarded integration test that does not hit the network.)
```

---

## Final Validation Checklist

### Technical Validation
- [ ] All 4 validation levels completed.
- [ ] `npm run validate` GREEN; `npm run test:coverage` 100%.
- [ ] `git diff --name-only` = exactly the 5 listed files.

### Feature Validation
- [ ] `createAdoptedBaseline()` returns the 4-level all-`Complete` hierarchy and passes `BacklogSchema.parse`.
- [ ] `seedAdoptedBaseline()` writes `.adopted` + `tasks.json` (via writeTasksJSON) + updates in-memory `taskRegistry`; throws if `#currentSession` is null.
- [ ] Fresh `--adopt-prd`: `initializeSession()` calls `seedAdoptedBaseline()` + sets `skipExecutionLoop=true`; existing-sessions branch does NOT seed.
- [ ] `executeBacklog()` early-returns (`currentPhase='backlog_complete'`) when `skipExecutionLoop`; `decomposePRD()` auto-skips (unchanged, non-empty backlog).
- [ ] `docs/CONFIGURATION.md` has the `### Adopt Mode` subsection citing PRD §4.6 + SKIP_EXECUTION_LOOP.

### Code Quality Validation
- [ ] Mirrors existing patterns (immutable `#currentSession` spread; writeTasksJSON reuse; field-injection test style).
- [ ] File placement matches the desired tree; no new dependency/config/env constant.
- [ ] Anti-patterns avoided (no pre-init seeding; no hand-rolled JSON; no decomposePRD skip; in-memory update present).

### Documentation & Deployment
- [ ] JSDoc on `createAdoptedBaseline`, `seedAdoptedBaseline`, `skipExecutionLoop` cite PRD §4.6.
- [ ] Adopt Mode subsection documents the seeding + SKIP_EXECUTION_LOOP lifecycle + guard rails.

---

## Anti-Patterns to Avoid
- ❌ Don't seed BEFORE `initialize()` — the dir + `prd_snapshot.md` don't exist yet (research §1).
- ❌ Don't hand-roll the `tasks.json` write — go through `writeTasksJSON` (BacklogSchema.parse) (research §4).
- ❌ Don't forget the in-memory `taskRegistry` update — without it `decomposePRD()` WOULD invoke the architect (research §2).
- ❌ Don't add a skip to `decomposePRD()` — its non-empty-backlog guard already skips for free.
- ❌ Don't mutate `#currentSession` nested readonly fields — use the immutable spread.
- ❌ Don't touch S1's files (`cli/index.ts`, `createSessionDirectory`), `session-utils`, `models`, `decomposePRD`, or the bug-hunt/validation workflows (S3 / out of scope).
- ❌ Don't set `process.env.SKIP_EXECUTION_LOOP` unless required — the contract says "on the pipeline instance"; keep it to the `skipExecutionLoop` field (env-var wiring is a future/S3 concern).
- ❌ Don't skip the `#currentSession`-null throw test (100% coverage gate).
- ❌ Don't duplicate `prd_snapshot.md` writing — `initialize()` already wrote it; S2 only adds `.adopted` + `tasks.json`.

---

## Success Metrics

**Confidence Score: 9/10** — tightly-scoped (2 src + 1 doc + 2 test files), additive change with:
(a) an exact S1 seam to consume/replace; (b) `initialize()` reused (no duplication); (c) the
architect skip free via `decomposePRD()`'s existing guard; (d) schema-validity auto-enforced by
`writeTasksJSON`; (e) deterministic unit tests via the existing session-utils/pipeline mocks. The
only residual risks (caught by Level 1/2): forgetting the in-memory `taskRegistry` update (would
burn tokens — covered by an explicit test assertion), a baseline field/ID that fails
`BacklogSchema.parse` (covered by the `BacklogSchema.parse` test), or a coverage gap on the
`#currentSession`-null branch (covered by the throw test). One-pass success is highly likely.