# PRP — P4.M2.T3.S1: Write `NO_ISSUES_FOUND.md` on clean hunt and commit

---

## Goal

**Feature Goal**: Give `BugHuntWorkflow` the ability to persist a **`NO_ISSUES_FOUND.md`
marker** when a QA bug hunt comes back clean (no critical/major/minor bugs), so a
bugfix/session directory distinguishes *"already hunted clean"* from *"never
hunted."* When a later hunt on the same directory *does* find bugs, the stale
marker is removed. The clean result is committed (`smartCommit`) just like a real
bug report (PRD §4.4). Completes milestone **P4.M2.T3**.

**Deliverable** (1 modified workflow + 1 modified test file; **no** new config
constant of our own — we CONSUME `getBugFinderAgent()` from the parallel
P4.M2.T2.S1; **no** pipeline edit; **no** new dependency; **no** CLI flag):

1. **`src/workflows/bug-hunt-workflow.ts`** (MODIFY) — add three things:
   (a) imports: `unlink` from `node:fs/promises`, `createHash` from `node:crypto`,
   `getBugFinderAgent` from `../config/constants.js`, `smartCommit` from
   `../utils/git-commit.js`; (b) a local filename const
   `NO_ISSUES_FOUND_FILE = 'NO_ISSUES_FOUND.md'`; (c) three new methods —
   `recordQAMarker(sessionPath, testResults)` (orchestrator, called from `run()`),
   `writeNoIssuesMarker(sessionPath, testResults)` (writes the Markdown marker),
   `removeNoIssuesMarker(sessionPath)` (tolerant `unlink`). `writeBugReport` stays
   byte-identical.
2. **`tests/unit/workflows/bug-hunt-workflow.test.ts`** (MODIFY) — extend the
   `node:fs/promises` mock to include `unlink`; add a `smartCommit` mock; add a
   `describe('recordQAMarker / NO_ISSUES_FOUND marker')` block with full branch
   coverage (clean→marker+commit; cosmetic-only→clean; bugs→unlink-no-commit;
   tasks.json-missing→sentinel hash; smartCommit `null` tolerated).

**Success Definition**:
- A clean bug hunt (0 bugs OR cosmetic-only) writes `NO_ISSUES_FOUND.md` (real
  Markdown) to the session/bugfix path containing: ISO timestamp, session path
  tested, the SHA-256 of the current `tasks.json` content (sentinel if missing),
  and `getBugFinderAgent()`.
- A buggy hunt (any critical/major/minor) removes a stale `NO_ISSUES_FOUND.md`
  if present (ENOENT-tolerant) and does NOT write a marker; `TEST_RESULTS.md`
  behavior is unchanged.
- The clean result is committed via `smartCommit` (deterministic message,
  default path); the marker is NOT in `PROTECTED_FILES` so it is committed
  (unlike `TEST_RESULTS.md`).
- `npm run validate` GREEN; `npm run test:coverage` stays at 100% (new branches
  covered by the new tests).
- `git diff --name-only` shows EXACTLY the 2 files above — **no** `constants.ts`
  edit (parallel PRP owns it), **no** `writeBugReport` behavior change, **no**
  `prp-pipeline.ts` edit.

---

## User Persona (if applicable)

**Target User**: A pipeline operator / auditor inspecting a session or bugfix
directory to decide whether QA has already run and found nothing, vs. QA has
never run.

**Use Case**: "After the bug-hunt loop runs, I want the directory to record a
clear, committed marker when it was hunted clean — with a tasks.json hash so a
stale marker is obvious once the task set changes — and I want that marker gone
if a later hunt finds bugs, so the directory always reflects the latest result."

**User Journey**: all tasks complete (or `bug-hunt` mode) → pipeline `runQACycle`
→ `BugHuntWorkflow.run(sessionPath)` → QA agent finds no actionable bugs →
`recordQAMarker` writes `NO_ISSUES_FOUND.md` → `smartCommit` persists it →
directory shows a committed clean marker. On a later re-hunt that finds bugs →
`recordQAMarker` removes the stale marker → `TEST_RESULTS.md` is written → fix
cycle runs.

**Pain Points Addressed**: today a clean hunt leaves NO artifact, so "hunted
clean" is indistinguishable from "never hunted"; PRD §4.4 mandates the marker.

---

## Why

- **PRD compliance (§4.4 No-issues marker)**: *"When the bug finder reports no
  bugs, the bugfix directory MUST record a `NO_ISSUES_FOUND.md` marker
  (timestamp, session tested, a `tasks.json` hash … and the bug-finder agent).
  … removed if a later hunt finds bugs … a clean result is persisted (committed)
  just like a real bug report."* This item implements all of that inside
  `BugHuntWorkflow`.
- **Work-item CONTRACT mapping**:
  - **(1) RESEARCH NOTE** — `architecture/phase_findings.md` §PHASE 4:
    `BugHuntWorkflow.writeBugReport` (bug-hunt-workflow.ts:404) writes
    `TEST_RESULTS.md` (line 438) only if critical/major; it writes JSON content
    despite the `.md` name. PRD §4.4 mandates the `NO_ISSUES_FOUND.md` marker.
    → confirmed the gap; this item fills it.
  - **(2) INPUT** — *"No prior subtask output consumed."* → no input contract.
    (We DO consume `getBugFinderAgent()` from the parallel P4.M2.T2.S1 per
    `<parallel_execution_context>` — that is an env-read helper, not a subtask
    output.)
  - **(3) LOGIC**:
    - (a) after `generateReport()`, if no critical/major/minor → write
      `NO_ISSUES_FOUND.md` to the session/bugfix path → `recordQAMarker` +
      `writeNoIssuesMarker`.
    - (b) content = timestamp + session path + tasks.json SHA-256 + bug-finder
      agent → `writeNoIssuesMarker`.
    - (c) if a prior marker exists and current hunt finds bugs → remove it →
      `removeNoIssuesMarker` (called from the not-clean branch).
    - (d) commit the clean result via `smartCommit` → clean branch of
      `recordQAMarker`.
  - **(4) OUTPUT** — *"NO_ISSUES_FOUND.md marker logic in BugHuntWorkflow.
    Completes P4.M2.T3."* → ✓ (P4.M2.T3 has only this one subtask).
  - **(5) DOCS** — *"none — no user-facing/config/API surface change."* → no
    doc edits.
- **Closes the "clean vs. never-hunted" gap** that the current
  `writeBugReport` (skip-on-no-critical/major) leaves open.

---

## What

A marker subsystem inside `BugHuntWorkflow`: on `run(sessionPath)`, after the
existing `writeBugReport` call, `recordQAMarker(sessionPath, results)` decides
the directory's latest QA state — write the clean marker (and commit), or remove
a stale marker (buggy hunt). `writeBugReport` is untouched.

**No** new CLI flag, **no** `constants.ts` edit, **no** `writeBugReport` behavior
change, **no** `prp-pipeline.ts` edit, **no** `BUG_RESULTS_FILE`/`BUGFIX_SCOPE`,
**no** new dependency.

### Success Criteria

- [ ] **`src/workflows/bug-hunt-workflow.ts`** — ADD imports (`unlink`,
      `createHash`, `getBugFinderAgent`, `smartCommit`), a local
      `NO_ISSUES_FOUND_FILE` const, and methods `recordQAMarker` /
      `writeNoIssuesMarker` / `removeNoIssuesMarker`. `writeBugReport` UNCHANGED.
- [ ] `recordQAMarker(sessionPath, results)` is called from `run()` inside the
      existing `if (sessionPath)` block, AFTER `writeBugReport`.
- [ ] **Clean** (`!bugs.some(critical|major|minor)`) → `writeNoIssuesMarker`
      writes `NO_ISSUES_FOUND.md` (Markdown) with timestamp + session path +
      tasks.json SHA-256 (sentinel on ENOENT) + `getBugFinderAgent()`, then
      `smartCommit(sessionPath, <fixed message>)`.
- [ ] **Not clean** (any critical/major/minor) → `removeNoIssuesMarker` unlinks a
      stale `NO_ISSUES_FOUND.md` (ENOENT-tolerant); NO marker written; NO commit
      from this path.
- [ ] **`tests/unit/workflows/bug-hunt-workflow.test.ts`** — extend
      `node:fs/promises` mock with `unlink`; add `smartCommit` mock; add
      `describe('recordQAMarker / NO_ISSUES_FOUND marker')` covering every new
      branch.
- [ ] `npm run validate` GREEN; `npm run test:coverage` 100% (global gate holds).
- [ ] `git diff --name-only` shows EXACTLY the 2 files above.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — YES. This PRP names: the EXACT file &
methods to add (`bug-hunt-workflow.ts` `recordQAMarker`/`writeNoIssuesMarker`/
`removeNoIssuesMarker`); the EXACT seam in `run()` (inside `if (sessionPath)`,
after `writeBugReport`); the EXACT clean condition (severity scan); the EXACT
marker content & Markdown format; the EXACT `smartCommit` call shape; the
CRITICAL "do NOT touch `writeBugReport`" + "extend the `node:fs/promises` mock
with `unlink`" + "add a `smartCommit` mock" test requirements; the parallel-PRP
contract for `getBugFinderAgent`; and the PROTECTED_FILES asymmetry that makes
the marker committable.

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: plan/008_15504f60a0ef/P4M2T3S1/research/00_research_summary.md
  why: THIS PRP's own research summary. Contains the test-breakage proof (why the
        marker MUST be a separate method), the clean-condition decision, the
        tasks.json-hash strategy, the PROTECTED_FILES asymmetry, and the required
        test-mock extensions. READ FIRST.

- file: src/workflows/bug-hunt-workflow.ts
  section: imports (:29-39); run() (:491-540, esp. the `if (sessionPath)` block
           at :506-511); writeBugReport (:404-465 — the TEMPLATE for the marker
           writer's atomicWrite + resolve + error-handling pattern; DO NOT
           CHANGE IT); the `@Step`/correlationLogger conventions.
  why: THE FILE THIS PRP MODIFIES. writeBugReport is the exact pattern to mirror
        for writeNoIssuesMarker (validate sessionPath → build path → atomicWrite
        → log success / throw on failure). run() is where recordQAMarker is wired.
  pattern: copy writeBugReport's structure (input validation, resolve(), atomicWrite,
        logger().info success, logger().error + throw on failure).
  gotcha: writeBugReport writes JSON.stringify(testResults,null,2) into a .md file —
        the NEW marker is REAL Markdown, not JSON.

- file: tests/unit/workflows/bug-hunt-workflow.test.ts
  section: the top-level mocks (vi.mock 'node:fs/promises' with ONLY readFile at
           ~:35-38; vi.mock 'session-utils' atomicWrite; the hoisted mockReadFile);
           describe('writeBugReport') (~:1100+) for the writer-test pattern; the
           run() tests that pass sessionPath (~:1010-1180) which will now also
           exercise recordQAMarker.
  why: THE TEST FILE THIS PRP MODIFIES. Two HARD requirements: (1) extend the
        node:fs/promises mock to include `unlink` (else removeNoIssuesMarker →
        TypeError); (2) add a smartCommit mock (else the clean path runs real git).
  pattern: mirror the writeBugReport describe block for the new marker tests
        (createTestResults + createTestBug factories; atomicWrite spy assertions;
        correlationLogger.info spies).
  gotcha: getBugFinderAgent is intentionally UNMOCKED — it reads process.env and
        returns 'pizr'; assert the marker content CONTAINS 'pizr' (or stub
        process.env.BUG_FINDER_AGENT for an override case).

- file: src/utils/git-commit.ts
  section: smartCommit (~:370-540) signature + "never-fail-on-commit" contract;
           PROTECTED_FILES (~:60) including 'TEST_RESULTS.md' but NOT
           'NO_ISSUES_FOUND.md'; formatCommitMessage wraps with '[PRP Auto] '.
  why: smartCommit is what persists the marker. NOTE it runs git at process.cwd()
        (repo root), NOT the sessionPath arg; returns null when nothing to stage
        or on any failure (never throws). Default path (no options) uses `message`
        verbatim — use that (deterministic; do NOT pass generateMessage:true).
  gotcha: TEST_RESULTS.md is protected/filtered; NO_ISSUES_FOUND.md is NOT, so the
        marker is the file smartCommit actually commits.

- file: src/core/session-utils.ts
  section: atomicWrite (~:110) signature `atomicWrite(targetPath, data): Promise<void>`.
  why: reuse atomicWrite for the marker write (it is already mocked in the test).
        It writes temp+rename (crash-safe), mode 0o644.

- file: src/core/models.ts
  section: BugSeverity / BugSeverityEnum (~:1746-1760 — 'critical'|'major'|'minor'
           |'cosmetic'); TestResults interface (~:1924-1962 — hasBugs, bugs[],
           summary, recommendations).
  why: the clean condition scans testResults.bugs[].severity. hasBugs is NOT the
        clean signal for this task (CONTRACT enumerates critical/major/minor).

- file: plan/008_15504f60a0ef/P4M2T2S1/PRP.md   # the PARALLEL PRP (contract)
  section: "Task 1: MODIFY src/config/constants.ts — ADD the BUG_FINDER_AGENT
           triplet" → exports BUG_FINDER_AGENT, DEFAULT_BUG_FINDER_AGENT='pizr',
           getBugFinderAgent().
  why: <parallel_execution_context> — treat as a CONTRACT. This item CONSUMES
        `getBugFinderAgent()` (import from '../config/constants.js'). Assume it
        exists exactly as specified. Do NOT redefine it; do NOT edit constants.ts.

- file: PRD.md   # §4.4 "The QA & Bug Hunt Loop" → "No-issues marker"
  section: §4.4 step 2 No-issues marker (verbatim text in selected_prd_content) +
           §4.4 step 5 "Artifact Preservation" ("on a clean hunt) NO_ISSUES_FOUND.md").
  why: THE REQUIREMENT. Cite it in the marker Markdown body + JSDoc.

- file: plan/008_15504f60a0ef/architecture/phase_findings.md
  section: §PHASE 4 "Current Bug Hunt Flow" + "Required Changes → NO_ISSUES_FOUND.md
           marker on clean hunt."
  why: THE RESEARCH NOTE the contract cites.
```

### Current Codebase tree (relevant slice)

```bash
src/workflows/
  bug-hunt-workflow.ts     # MODIFY — + imports, + NO_ISSUES_FOUND_FILE const,
                           #   + recordQAMarker/writeNoIssuesMarker/removeNoIssuesMarker;
                           #   wire recordQAMarker into run(). writeBugReport UNCHANGED.
src/utils/
  git-commit.ts            # READ-ONLY — smartCommit (consumed) + PROTECTED_FILES.
src/core/
  session-utils.ts         # READ-ONLY — atomicWrite (consumed).
  models.ts                # READ-ONLY — BugSeverity, TestResults.
src/config/
  constants.ts             # READ-ONLY (parallel PRP owns) — getBugFinderAgent (consumed).
tests/unit/workflows/
  bug-hunt-workflow.test.ts # MODIFY — + unlink mock, + smartCommit mock, + marker tests.
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/workflows/bug-hunt-workflow.ts
  # + import { unlink } from 'node:fs/promises';
  # + import { createHash } from 'node:crypto';
  # + import { getBugFinderAgent } from '../config/constants.js';
  # + import { smartCommit } from '../utils/git-commit.js';
  # + const NO_ISSUES_FOUND_FILE = 'NO_ISSUES_FOUND.md';
  # + async recordQAMarker(sessionPath, testResults): Promise<void>
  #     - isClean = !testResults.bugs.some(b => critical|major|minor)
  #     - if isClean: await writeNoIssuesMarker(...); await smartCommit(sessionPath, msg)
  #     - else: await removeNoIssuesMarker(sessionPath)
  # + async writeNoIssuesMarker(sessionPath, testResults): Promise<void>
  #     - validate sessionPath; read tasks.json → sha256 (sentinel on ENOENT);
  #       build Markdown; atomicWrite(resolve(sessionPath, NO_ISSUES_FOUND_FILE), md)
  # + async removeNoIssuesMarker(sessionPath): Promise<void>
  #     - unlink(resolve(sessionPath, NO_ISSUES_FOUND_FILE)); ignore ENOENT
  # run(): inside `if (sessionPath)`, AFTER writeBugReport → await recordQAMarker(...)
  # writeBugReport: UNCHANGED
tests/unit/workflows/bug-hunt-workflow.test.ts
  # node:fs/promises mock → + unlink: mockUnlink (hoisted)
  # + vi.mock('../../../src/utils/git-commit.js', () => ({ smartCommit: vi.fn() }))
  # + describe('recordQAMarker / NO_ISSUES_FOUND marker') — clean/cosmetic/bugs/
  #   tasks.json-missing/smartCommit-null branches
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (do NOT fold marker logic into writeBugReport): tests/unit/workflows/
//   bug-hunt-workflow.test.ts asserts writeBugReport does NOT call atomicWrite for
//   cosmetic-only / empty bugs. The CONTRACT clean condition (no critical/major/
//   minor) makes cosmetic-only & empty results WRITE the marker (→ atomicWrite IS
//   called). Putting that in writeBugReport breaks those assertions. KEEP the marker
//   in separate methods; writeBugReport stays byte-identical.

// CRITICAL (extend the node:fs/promises mock or tests crash): the test file mocks
//   node:fs/promises with ONLY readFile. removeNoIssuesMarker imports `unlink` →
//   it would be undefined in tests → TypeError. The mock MUST be extended to
//   `{ readFile: mockReadFile, unlink: mockUnlink }` (hoisted mockUnlink).

// CRITICAL (add a smartCommit mock or real git runs in tests): smartCommit is not
//   mocked anywhere today. The clean path calls it; without a mock the test invokes
//   real git ops (gitStatus/gitAdd/gitCommit) in the repo → flaky/broken. Add
//   vi.mock('../../../src/utils/git-commit.js', () => ({ smartCommit: vi.fn() })).

// CRITICAL (PROTECTED_FILES asymmetry): 'TEST_RESULTS.md' is in PROTECTED_FILES
//   (git-commit.ts:60) so smartCommit FILTERS it out (never committed). But
//   'NO_ISSUES_FOUND.md' is NOT protected → smartCommit commits it. This is exactly
//   why "committed like a real bug report" works for the marker. Do NOT add
//   NO_ISSUES_FOUND.md to PROTECTED_FILES.

// CRITICAL (getBugFinderAgent is a PARALLEL-PRP contract, not ours): per
//   <parallel_execution_context>, P4.M2.T2.S1 adds getBugFinderAgent() to
//   src/config/constants.ts. CONSUME it via import { getBugFinderAgent } from
//   '../config/constants.js'. Do NOT redefine it; do NOT edit constants.ts (avoids
//   merge conflict). It reads process.env → returns 'pizr' by default → safe
//   UNMOCKED in tests.

// GOTCHA (clean condition = severity scan, NOT hasBugs): CONTRACT (a) enumerates
//   "no critical/major/minor". Use:
//     const isClean = !testResults.bugs.some(b =>
//       b.severity === 'critical' || b.severity === 'major' || b.severity === 'minor');
//   TestResults.hasBugs means "critical or major found" and is NOT the signal here.
//   cosmetic-only ⇒ isClean (marker written). minor-only ⇒ NOT clean (no marker;
//   writeBugReport also skips → no artifact; matches CONTRACT, do not "fix").

// GOTCHA (tasks.json hash must not abort the marker): read resolve(sessionPath,
//   'tasks.json'); on ENOENT record a sentinel ('tasks.json-not-found') and STILL
//   write the marker. The hash's job is staleness detection — a missing file is a
//   valid signal. Do NOT throw.

// GOTCHA (smartCommit never throws): it returns null on no-files-to-stage or any
//   failure. Call it and log the returned hash|null; do NOT wrap in try/catch for
//   control flow (a null return is non-fatal — the marker file still exists on disk
//   and will be swept into the next commit).

// GOTCHA (smartCommit commits at repo root, ignores sessionPath for git ops):
//   smartCommit validates sessionPath is non-empty, then runs git at process.cwd().
//   Pass sessionPath (the QA session path) — it is non-empty (run() guards on it).

// GOTCHA (ESM .js imports): intra-project imports use .js extensions in .ts source
//   (e.g. '../utils/git-commit.js'). Node builtins use 'node:fs/promises' /
//   'node:crypto' (NO .js).

// GOTCHA (100% coverage gate): vitest.config.ts enforces 100% globally. New
//   branches: isClean true/false; unlink success/ENOENT; tasks.json read
//   present/missing; smartCommit statement. Cover ALL in the new describe block.

// GOTCHA (filename const is LOCAL): define NO_ISSUES_FOUND_FILE locally in
//   bug-hunt-workflow.ts (mirrors the existing 'TEST_RESULTS.md' literal at :438).
//   Do NOT add to constants.ts — that file is being edited by the parallel PRP.
```

---

## Implementation Blueprint

### Data models and structure

No new data models. The marker is a Markdown string. `TestResults`/`Bug` already
exist (`src/core/models.ts`). The clean signal is derived from `testResults.bugs`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/workflows/bug-hunt-workflow.ts — ADD imports + filename const
  - ADD imports (top, grouped with existing node: + intra-project imports):
      import { unlink } from 'node:fs/promises';
      import { createHash } from 'node:crypto';
      import { getBugFinderAgent } from '../config/constants.js';
      import { smartCommit } from '../utils/git-commit.js';
    NOTE: readFile is ALREADY imported from 'node:fs/promises' (used by
    #readResultsFile) — add `unlink` to that SAME import line, do not duplicate.
  - ADD a module-level const near the class (or just above it):
      /** Marker file written when a bug hunt finds no actionable bugs (PRD §4.4). */
      const NO_ISSUES_FOUND_FILE = 'NO_ISSUES_FOUND.md';
  - FOLLOW pattern: the existing imports + the 'TEST_RESULTS.md' literal usage.
  - SCOPE: imports + one const only. No behavior yet.

Task 2: MODIFY src/workflows/bug-hunt-workflow.ts — ADD removeNoIssuesMarker()
  - IMPLEMENT (place near writeBugReport):
      /**
       * Removes a stale NO_ISSUES_FOUND.md marker (PRD §4.4).
       * Tolerant of a missing file (ENOENT) — a clean marker from a prior hunt
       * is removed when the current hunt finds bugs, so the directory always
       * reflects the latest result.
       */
      public async removeNoIssuesMarker(sessionPath: string): Promise<void> {
        const markerPath = resolve(sessionPath, NO_ISSUES_FOUND_FILE);
        try {
          await unlink(markerPath);
          this.correlationLogger.info(
            '[BugHuntWorkflow] Removed stale NO_ISSUES_FOUND.md marker', { markerPath });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException)?.code;
          if (code === 'ENOENT') {
            // No prior marker — nothing to remove. Not an error.
            return;
          }
          // Real failure to delete — log + rethrow (matches writeBugReport's throw style).
          this.correlationLogger.error(
            '[BugHuntWorkflow] Failed to remove NO_ISSUES_FOUND.md marker',
            { markerPath, error: toErrorMessage(error) });
          throw new Error(`Failed to remove marker ${markerPath}: ${toErrorMessage(error)}`);
        }
      }
  - FOLLOW pattern: writeBugReport's resolve() + logger().info/error + toErrorMessage.
  - GOTCHA: ENOENT MUST be swallowed (a missing marker is the common case).

Task 3: MODIFY src/workflows/bug-hunt-workflow.ts — ADD writeNoIssuesMarker()
  - IMPLEMENT (place near writeBugReport):
      /**
       * Writes NO_ISSUES_FOUND.md (real Markdown) recording a clean bug hunt
       * (PRD §4.4). Content: ISO timestamp, session path tested, SHA-256 of the
       * current tasks.json (sentinel if missing), and the bug-finder agent.
       */
      public async writeNoIssuesMarker(
        sessionPath: string,
        testResults: TestResults
      ): Promise<void> {
        if (typeof sessionPath !== 'string' || sessionPath.trim() === '') {
          throw new Error('sessionPath must be a non-empty string');
        }
        const timestamp = new Date().toISOString();
        // tasks.json hash — sentinel on missing so the marker is still written.
        const tasksJsonPath = resolve(sessionPath, 'tasks.json');
        let tasksHash: string;
        try {
          const raw = await readFile(tasksJsonPath, 'utf-8');
          tasksHash = createHash('sha256').update(raw).digest('hex');
        } catch {
          tasksHash = 'tasks.json-not-found';
        }
        const bugFinderAgent = getBugFinderAgent();
        const content = [
          '# No Issues Found',
          '',
          'This directory was hunted clean by the QA bug-finder: no critical, major, or minor bugs.',
          '',
          `- **Timestamp:** ${timestamp}`,
          `- **Session path tested:** ${sessionPath}`,
          `- **tasks.json hash (SHA-256):** ${tasksHash}`,
          `- **Bug-finder agent:** ${bugFinderAgent}`,
          '',
          'PRD §4.4 — distinguishes "already hunted clean" from "never hunted." ' +
            'Removed automatically if a later hunt finds bugs.',
          '',
        ].join('\n');
        const markerPath = resolve(sessionPath, NO_ISSUES_FOUND_FILE);
        try {
          this.correlationLogger.info('[BugHuntWorkflow] Writing NO_ISSUES_FOUND.md', {
            markerPath, tasksHash, bugFinderAgent });
          await atomicWrite(markerPath, content);
          this.correlationLogger.info(
            '[BugHuntWorkflow] NO_ISSUES_FOUND.md written successfully', { markerPath });
        } catch (error) {
          this.correlationLogger.error(
            '[BugHuntWorkflow] Failed to write NO_ISSUES_FOUND.md',
            { markerPath, error: toErrorMessage(error) });
          throw new Error(
            `Failed to write marker to ${markerPath}: ${toErrorMessage(error)}`);
        }
      }
  - FOLLOW pattern: writeBugReport (input validation → resolve → atomicWrite → log).
  - GOTCHA: readFile + createHash are already imported (Task 1 / existing). Use the
    EXISTING readFile import from node:fs/promises (it is mocked in tests).

Task 4: MODIFY src/workflows/bug-hunt-workflow.ts — ADD recordQAMarker() (orchestrator)
  - IMPLEMENT (place near writeBugReport):
      /**
       * Records the latest QA result in the directory (PRD §4.4 No-issues marker).
       *
       * - Clean (no critical/major/minor bugs): write NO_ISSUES_FOUND.md and commit
       *   it via smartCommit (a clean result is persisted like a real bug report).
       * - Bugs found (any critical/major/minor): remove a stale NO_ISSUES_FOUND.md
       *   if present (TEST_RESULTS.md is handled separately by writeBugReport).
       *
       * Called from run() inside the `if (sessionPath)` block, after writeBugReport.
       */
      public async recordQAMarker(
        sessionPath: string,
        testResults: TestResults
      ): Promise<void> {
        const isClean = !testResults.bugs.some(
          b =>
            b.severity === 'critical' ||
            b.severity === 'major' ||
            b.severity === 'minor'
        );
        if (isClean) {
          await this.writeNoIssuesMarker(sessionPath, testResults);
          const commitHash = await smartCommit(
            sessionPath,
            'chore(qa): bug hunt clean — no issues found (NO_ISSUES_FOUND.md)'
          );
          this.correlationLogger.info(
            '[BugHuntWorkflow] Committed clean-hunt marker', { commitHash });
        } else {
          await this.removeNoIssuesMarker(sessionPath);
        }
      }
  - GOTCHA: smartCommit returns null on no-files/failure and never throws — log it,
    do not branch on it.

Task 5: MODIFY src/workflows/bug-hunt-workflow.ts — WIRE recordQAMarker into run()
  - In run() (~:506-511), the current block is:
        if (sessionPath) {
          this.correlationLogger.info(`[BugHuntWorkflow] Writing TEST_RESULTS.md to ${sessionPath}`);
          await this.writeBugReport(sessionPath, results);
        }
  - CHANGE it to ALSO call recordQAMarker AFTER writeBugReport:
        if (sessionPath) {
          this.correlationLogger.info(`[BugHuntWorkflow] Writing TEST_RESULTS.md to ${sessionPath}`);
          await this.writeBugReport(sessionPath, results);
          await this.recordQAMarker(sessionPath, results);
        }
  - PRESERVE: the existing log line + writeBugReport call + order + return value.
  - GOTCHA: keep writeBugReport FIRST (it writes TEST_RESULTS.md on critical/major);
    recordQAMarker then writes/removes the marker. On a clean hunt writeBugReport is
    a no-op (skips), so only the marker is written. On a buggy hunt both run:
    writeBugReport writes TEST_RESULTS.md, recordQAMarker removes a stale marker.

Task 6: MODIFY tests/unit/workflows/bug-hunt-workflow.test.ts — extend mocks
  - EXTEND the node:fs/promises mock to include unlink:
      const { mockReadFile, mockUnlink } = vi.hoisted(() => ({
        mockReadFile: vi.fn(),
        mockUnlink: vi.fn(),
      }));
      vi.mock('node:fs/promises', () => ({
        readFile: mockReadFile,
        unlink: mockUnlink,
      }));
  - ADD a smartCommit mock (near the other vi.mock calls):
      vi.mock('../../../src/utils/git-commit.js', () => ({
        smartCommit: vi.fn(),
      }));
    and import it:
      import { smartCommit } from '../../../src/utils/git-commit.js';
      const mockSmartCommit = smartCommit as any;
  - In beforeEach: mockUnlink.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    (default: marker absent → unlink ENOENT → swallowed); mockSmartCommit.mockResolvedValue('deadbeef');
  - FOLLOW pattern: the existing mockReadFile hoist + vi.mock + import + cast.
  - GOTCHA: getBugFinderAgent stays UNMOCKED (returns 'pizr').

Task 7: MODIFY tests/unit/workflows/bug-hunt-workflow.test.ts — ADD marker tests
  - ADD describe('recordQAMarker / NO_ISSUES_FOUND marker') covering:
      (a) CLEAN (empty bugs) → writeNoIssuesMarker called → atomicWrite called with
          resolve(session,'NO_ISSUES_FOUND.md') + content containing timestamp,
          session path, a 64-hex sha256 (tasks.json present), and 'pizr';
          smartCommit called once with the session path; removeNoIssuesMarker NOT
          invoked (unlink not called).
      (b) COSMETIC-ONLY → still CLEAN → marker written + committed (assertion that
          isClean includes cosmetic as clean per CONTRACT).
      (c) BUGS FOUND (critical) → removeNoIssuesMarker called (mockUnlink called
          with marker path); smartCommit NOT called; writeNoIssuesMarker does NOT
          call atomicWrite for the marker (only writeBugReport's TEST_RESULTS.md
          atomicWrite may fire).
      (d) BUGS FOUND (minor) → NOT clean → removeNoIssuesMarker called; no marker
          write; no commit.
      (e) tasks.json MISSING → mockReadFile rejects ENOENT for the tasks.json path
          → marker still written with tasksHash === 'tasks.json-not-found'.
      (f) removeNoIssuesMarker ENOENT-tolerant → mockUnlink rejects ENOENT → method
          resolves without throwing (no error logged).
      (g) removeNoIssuesMarker real failure → mockUnlink rejects EACCES → method
          throws 'Failed to remove marker ...'.
      (h) smartCommit returns null → recordQAMarker still resolves (clean marker
          written; null logged, not treated as error).
      (i) sessionPath empty → writeNoIssuesMarker throws 'sessionPath must be a
          non-empty string'.
  - ALSO: update existing run() tests that pass sessionPath so the new smartCommit
    mock + unlink mock keep them GREEN (most need no assertion change — they spy on
    writeBugReport / setStatus / log lines which are unaffected; just ensure
    mockSmartCommit/mockUnlink defaults are set in beforeEach so the real fns are
    never called). Re-run the whole file and fix any assertion that now double-fires.
  - FOLLOW pattern: the writeBugReport describe block (factories + atomicWrite spy
    + correlationLogger spies + resolve() path assertions).
  - COVERAGE: every new branch (isClean T/F; unlink success/ENOENT/EACCES;
    tasks.json present/missing; smartCommit statement) MUST be hit (100% gate).
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (clean condition — CONTRACT literal, NOT hasBugs):
const isClean = !testResults.bugs.some(
  b => b.severity === 'critical' || b.severity === 'major' || b.severity === 'minor'
);

// PATTERN (tasks.json sha256, sentinel on missing — do NOT throw):
let tasksHash: string;
try {
  const raw = await readFile(resolve(sessionPath, 'tasks.json'), 'utf-8');
  tasksHash = createHash('sha256').update(raw).digest('hex');
} catch {
  tasksHash = 'tasks.json-not-found';
}

// PATTERN (ENOENT-tolerant unlink — swallow the common "no prior marker" case):
try {
  await unlink(markerPath);
} catch (error) {
  if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return; // nothing to remove
  throw new Error(`Failed to remove marker ${markerPath}: ${toErrorMessage(error)}`);
}

// PATTERN (smartCommit — default path, fixed message, never throws):
const commitHash = await smartCommit(
  sessionPath,
  'chore(qa): bug hunt clean — no issues found (NO_ISSUES_FOUND.md)'
);
// commitHash is string | null; log it, do not branch on it.

// PATTERN (run() wiring — additive, preserves writeBugReport + its log line):
if (sessionPath) {
  this.correlationLogger.info(`[BugHuntWorkflow] Writing TEST_RESULTS.md to ${sessionPath}`);
  await this.writeBugReport(sessionPath, results);   // UNCHANGED
  await this.recordQAMarker(sessionPath, results);   // NEW
}
```

### Integration Points

```yaml
WORKFLOW (bug-hunt-workflow.ts):
  - ADD imports: unlink (node:fs/promises), createHash (node:crypto),
    getBugFinderAgent (../config/constants.js), smartCommit (../utils/git-commit.js).
  - ADD const NO_ISSUES_FOUND_FILE = 'NO_ISSUES_FOUND.md' (module-level).
  - ADD methods: recordQAMarker / writeNoIssuesMarker / removeNoIssuesMarker.
  - MODIFY run(): inside `if (sessionPath)`, after writeBugReport → recordQAMarker.
  - writeBugReport: UNCHANGED.

CONFIG (constants.ts):
  - NONE (owned by parallel PRP P4.M2.T2.S1 — consume getBugFinderAgent).

GIT-COMMIT (git-commit.ts):
  - NONE (read-only consumer). NO_ISSUES_FOUND.md is NOT in PROTECTED_FILES → it
    IS committed (unlike TEST_RESULTS.md).

PIPELINE (prp-pipeline.ts):
  - NONE. runQACycle already calls bugHuntWorkflow.run(sessionPath)
    (prp-pipeline.ts ~:1554), so the marker writes to the session path with no
    pipeline edit. (The FixCycleWorkflow re-test also calls run(bugfixSessionPath)
    → a clean re-test writes the marker into the bugfix dir — desirable.)

NO DATABASE / NO ROUTES / NO CLI FLAG / NO NEW DEPENDENCY / NO DOC EDITS (CONTRACT 5).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing bug-hunt-workflow.ts — fix before proceeding
npm run lint            # eslint . --ext .ts  (expected: zero errors)
npm run format:check    # prettier --check    (run `npm run format` to fix)
npm run typecheck       # tsc --noEmit -p tsconfig.build.json (expected: zero errors)

# Canonical CI gate
npm run validate        # = lint && format:check && typecheck && test:run

# Expected: Zero errors. READ the output and fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The modified workflow test (marker logic + existing regression)
npx vitest run tests/unit/workflows/bug-hunt-workflow.test.ts

# Full workflows suite (nothing else regressed)
npx vitest run tests/unit/workflows/

# Expected: All pass. If a run() test fails, it likely double-invoked a now-mocked
# smartCommit/unlink — set their defaults in beforeEach (Task 6) rather than weakening
# the assertion.
```

### Level 3: Integration Testing (System Validation)

```bash
# Coverage gate — MUST stay 100% globally (vitest.config.ts)
npm run test:coverage
# Confirm the new branches (isClean T/F; unlink success/ENOENT/EACCES; tasks.json
# present/missing; smartCommit statement) are all covered.

# Grep guard — marker logic is present & writeBugReport untouched
grep -n "recordQAMarker\|writeNoIssuesMarker\|removeNoIssuesMarker\|NO_ISSUES_FOUND_FILE" src/workflows/bug-hunt-workflow.ts
grep -n "NO_ISSUES_FOUND" src/utils/git-commit.ts   # Expected: NO match (NOT protected)
grep -n "TEST_RESULTS.md" src/utils/git-commit.ts   # Expected: still protected (unchanged)

# Grep guard — constants.ts NOT edited by this item (parallel PRP owns it)
git diff --name-only src/config/constants.ts        # Expected: empty

# Expected: coverage 100%; grep guards clean; only the 2 intended files changed.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral smoke: a clean TestResults yields a Markdown marker with all 4 fields.
# (Exercise via a temporary vitest case if no direct .ts runner is configured.)
# Assert the written NO_ISSUES_FOUND.md content contains:
#   - "# No Issues Found"
#   - "**Timestamp:**" + an ISO date
#   - "**Session path tested:** <sessionPath>"
#   - "**tasks.json hash (SHA-256):**" + either a 64-char hex or 'tasks.json-not-found'
#   - "**Bug-finder agent:** pizr" (default getBugFinderAgent)

# Round-trip guard: a buggy hunt after a clean hunt removes the marker.
#   1. run() with clean results → NO_ISSUES_FOUND.md exists, smartCommit called.
#   2. run() with critical results → unlink(marker) called, smartCommit NOT called.

# PROTECTED_FILES guard: confirm the marker is committable by smartCommit.
node -e "const p=require('./src/utils/git-commit.ts');" 2>/dev/null || true
grep -c "'NO_ISSUES_FOUND.md'" src/utils/git-commit.ts   # Expected: 0 (not protected)
grep -c "'TEST_RESULTS.md'" src/utils/git-commit.ts      # Expected: 1 (still protected)

# Expected: marker is Markdown with all 4 CONTRACT fields; buggy-after-clean removes it.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed successfully
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run)
- [ ] `npm run test:coverage` 100% (global gate — all new branches covered)
- [ ] No linting errors: `npm run lint`
- [ ] No type errors: `npm run typecheck`
- [ ] No formatting issues: `npm run format:check`

### Feature Validation

- [ ] Clean hunt (0 bugs) writes `NO_ISSUES_FOUND.md` (Markdown) with timestamp +
      session path + tasks.json SHA-256 + `getBugFinderAgent()`; committed via
      `smartCommit`
- [ ] Cosmetic-only hunt is treated as clean (marker written) per CONTRACT (a)
- [ ] Buggy hunt (critical/major/minor) removes a stale `NO_ISSUES_FOUND.md`
      (ENOENT-tolerant) and writes NO marker; no commit from this path
- [ ] `TEST_RESULTS.md` write rules unchanged (`writeBugReport` byte-identical)
- [ ] Missing `tasks.json` does NOT abort the marker (sentinel hash recorded)
- [ ] `smartCommit` returning `null` is tolerated (non-fatal)
- [ ] `NO_ISSUES_FOUND.md` is committable (NOT in `PROTECTED_FILES`)

### Code Quality Validation

- [ ] Follows existing patterns (mirrors `writeBugReport` for the marker writer)
- [ ] File placement matches the desired codebase tree (2 files only)
- [ ] Anti-patterns avoided (no `writeBugReport` change; no `constants.ts` edit;
      no real git in unit tests)
- [ ] Dependencies properly managed (ESM `.js` intra-project imports; node builtins
      via `node:` prefix; `getBugFinderAgent` consumed from parallel PRP)
- [ ] JSDoc cites PRD §4.4 on the new methods + marker body

### Documentation & Deployment

- [ ] CONTRACT (5): no doc edits (no user-facing/config/API surface change)
- [ ] No new environment variables (consume existing `BUG_FINDER_AGENT` indirectly)
- [ ] Code is self-documenting (method names + JSDoc explain the marker lifecycle)

---

## Anti-Patterns to Avoid

- ❌ Don't fold the marker logic into `writeBugReport` — its existing tests assert
      `atomicWrite` is NOT called for cosmetic-only/empty results; the CONTRACT
      clean condition makes those WRITE the marker. Keep them separate.
- ❌ Don't forget to extend the `node:fs/promises` mock with `unlink` AND add a
      `smartCommit` mock — without them, existing `run()` tests that pass
      `sessionPath` crash (unlink undefined) or run real git (smartCommit).
- ❌ Don't use `TestResults.hasBugs` as the clean signal — CONTRACT (a) enumerates
      critical/major/**minor**; scan `bugs[].severity`.
- ❌ Don't add `NO_ISSUES_FOUND.md` to `PROTECTED_FILES` — it MUST be committable.
- ❌ Don't edit `src/config/constants.ts` — it is owned by the parallel PRP
      (P4.M2.T2.S1); consume `getBugFinderAgent()` only.
- ❌ Don't throw when `tasks.json` is missing — record a sentinel hash and still
      write the marker.
- ❌ Don't pass `generateMessage: true` to `smartCommit` — use the default path
      with a fixed deterministic message for the marker commit.
- ❌ Don't branch on `smartCommit`'s return — it never throws and `null` is
      non-fatal; just log it.
- ❌ Don't remove `TEST_RESULTS.md` on a clean hunt — CONTRACT only mandates
      removing `NO_ISSUES_FOUND.md` on a buggy hunt.