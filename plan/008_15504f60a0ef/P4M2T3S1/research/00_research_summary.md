# Research Summary — P4.M2.T3.S1: NO_ISSUES_FOUND.md marker

Work item: write `NO_ISSUES_FOUND.md` on a clean QA bug hunt, remove it when a
later hunt finds bugs, and commit the clean result via `smartCommit`. Output is
marker logic in `BugHuntWorkflow`.

---

## 1. Where the marker logic lives & how `run()` flows

`src/workflows/bug-hunt-workflow.ts`:
- `run(sessionPath?)` (bug-hunt-workflow.ts:491) → `analyzeScope` →
  `creativeE2ETesting` → `adversarialTesting` → `generateReport()` →
  `if (sessionPath) await this.writeBugReport(sessionPath, results)`.
- `writeBugReport(sessionPath, testResults)` (bug-hunt-workflow.ts:404) writes
  `TEST_RESULTS.md` (JSON content) **only if** critical/major bugs present;
  otherwise logs a skip and returns. Uses `atomicWrite` + `resolve(sessionPath,
  'TEST_RESULTS.md')`.
- `this.sessionPath` (private, set in `run()`) holds the session/bugfix path.
- `generateReport()` already sets `this.testResults` and returns `TestResults`.

CONTRACT mapping:
- (a) "after generateReport(): if NO bugs (no critical/major/minor), write
  NO_ISSUES_FOUND.md" → the marker write belongs in the `run()` flow, gated by
  `sessionPath`, branched on the clean condition.
- (b) marker content = timestamp + session path tested + tasks.json SHA-256 +
  bug-finder agent.
- (c) "if a later hunt finds bugs, remove the marker" → `unlink` the marker in
  the not-clean branch.
- (d) "committed like a real bug report (via smartCommit)" → call `smartCommit`
  after writing the marker.

## 2. CRITICAL — do NOT fold the marker into `writeBugReport`

`tests/unit/workflows/bug-hunt-workflow.test.ts` has hard assertions that
`writeBugReport` does NOT touch `atomicWrite` for cosmetic-only / empty bugs:
- `should not write if no critical or major bugs (only cosmetic)`
- `should not write if no critical or major bugs (hasBugs false)` (minor-only)
- `should log skip message when only cosmetic bugs present`
- `should log skip message when bugs array is empty`

Per CONTRACT (a), the clean condition is **no critical/major/minor**, so a
cosmetic-only or empty result MUST write the marker (→ `atomicWrite` IS called).
That directly contradicts the `writeBugReport` assertions above. Therefore the
marker logic MUST be a **separate method** (`recordQAMarker` /
`writeNoIssuesMarker`), and `writeBugReport` stays byte-identical.

DECISION: keep `writeBugReport` unchanged; add `recordQAMarker()` (orchestrator)
+ `writeNoIssuesMarker()` (writer) + `removeNoIssuesMarker()` (unlinker). Call
`recordQAMarker()` from `run()` right after `writeBugReport()`, inside the
existing `if (sessionPath)` block.

## 3. Clean condition (literal CONTRACT reading)

```ts
const isClean = !testResults.bugs.some(
  b => b.severity === 'critical' || b.severity === 'major' || b.severity === 'minor'
);
```
- 0 bugs → clean → marker. ✓ (PRD §4.4 "reports no bugs")
- cosmetic-only → clean → marker. ✓ (CONTRACT parenthetical excludes cosmetic)
- any critical/major/minor → NOT clean → remove stale marker + (writeBugReport
  writes TEST_RESULTS.md only if critical/major).
- **minor-only edge**: NOT clean → no marker; `writeBugReport` skips (no
  critical/major) → NO artifact written. This is the literal CONTRACT behavior
  and matches existing `writeBugReport`. Documented (no fix needed here).

`TestResults.hasBugs` (models.ts:1933) = "critical or major found"; it is NOT
the clean signal for this task — use the severity scan above (CONTRACT enumerates
critical/major/**minor**). A clean result always implies `hasBugs === false`.

## 4. tasks.json hash (marker content)

- Path: `resolve(sessionPath, 'tasks.json')` (tasks.json lives in the session
  dir; confirmed in `state-validator.ts` / `file-lock.ts` —
  `resolve(sessionDir, 'tasks.json')`).
- Hash: `createHash('sha256').update(raw).digest('hex')` from `node:crypto`.
- Missing file: catch ENOENT → record sentinel `'tasks.json-not-found'` so the
  marker is still written (the hash's purpose is staleness detection; a missing
  file is itself a signal). Do NOT throw — a missing tasks.json must not abort
  the clean-hunt marker.

## 5. Bug-finder agent name — `getBugFinderAgent()` (parallel PRP contract)

Per `<parallel_execution_context>`, P4.M2.T2.S1 (currently Implementing) adds to
`src/config/constants.ts`:
```ts
export const BUG_FINDER_AGENT = 'BUG_FINDER_AGENT';
export const DEFAULT_BUG_FINDER_AGENT = 'pizr' as const;
export function getBugFinderAgent(): string { /* trim-empty → 'pizr' */ }
```
This item CONSUMES it: `import { getBugFinderAgent } from '../config/constants.js';`
and embed `getBugFinderAgent()` in the marker. `getBugFinderAgent` only reads
`process.env` → safe to call UNMOCKED in tests (returns `'pizr'`). No conflict
with the parallel PRP (different file: this item edits `bug-hunt-workflow.ts` +
its test; the parallel item edits `constants.ts` + `agent-factory.ts`).

## 6. Commit via `smartCommit` — the PROTECTED_FILES asymmetry

`src/utils/git-commit.ts` `PROTECTED_FILES` (git-commit.ts:60) includes
`'TEST_RESULTS.md'` → `smartCommit` FILTERS IT OUT (never committed). But
`'NO_ISSUES_FOUND.md'` is NOT protected → `smartCommit` WILL stage+commit it.

- `smartCommit(sessionPath, message, options?)` runs git at `process.cwd()`
  (repo root), collects modified+untracked, filters PROTECTED, stages, commits
  with `[PRP Auto]` prefix + `Co-Authored-By`. **Never throws** (returns `null`
  on any failure / when nothing to stage). Default path uses `message` verbatim.
- Call ONLY in the clean branch (CONTRACT (d): "commit the CLEAN result"). For
  the not-clean branch, the marker is removed; no extra commit here (the fix
  cycle / pipeline commits). Pass a fixed descriptive message (NOT
  `generateMessage:true` — deterministic marker commit).
- By QA time all task commits are done, so the working tree is clean except the
  new `NO_ISSUES_FOUND.md` (+ `bug_hunt_results.json`); `smartCommit` commits
  exactly the marker set.
- No workflow currently imports `smartCommit` (only `task-orchestrator.ts`
  does) — this is the first workflow-level commit site. Pattern is identical.

## 7. CRITICAL — existing test mocks must be extended

`tests/unit/workflows/bug-hunt-workflow.test.ts` currently:
- `vi.mock('node:fs/promises', () => ({ readFile: mockReadFile }))` — ONLY
  `readFile` is provided. Any OTHER import from `node:fs/promises` (`unlink`)
  is `undefined` in tests → `TypeError: unlink is not a function`.
- `atomicWrite` is mocked from `session-utils.js` (reuse for the marker write ✓).
- `smartCommit` is NOT mocked anywhere → real git ops would run in the test dir.

REQUIRED test-file edits (else existing `run()` tests that pass `sessionPath`
with bugs now call `removeNoIssuesMarker` → `unlink`, and the clean path now
calls `smartCommit`):
1. Extend the `node:fs/promises` mock to include `unlink` (hoisted `mockUnlink`).
2. Add `vi.mock('../../../src/utils/git-commit.js', () => ({ smartCommit:
   vi.fn() }))` + import + configure.
3. Add new tests for `recordQAMarker` / `writeNoIssuesMarker` /
   `removeNoIssuesMarker` (clean→writes marker+commits; bugs→unlinks marker,
   no commit; cosmetic-only→clean; tasks.json-missing→sentinel hash; smartCommit
   null-return tolerated).

`getBugFinderAgent` left UNMOCKED (env read → `'pizr'`).

## 8. Filename constant + marker format

- Define `const NO_ISSUES_FOUND_FILE = 'NO_ISSUES_FOUND.md'` LOCALLY in
  `bug-hunt-workflow.ts` (mirrors the `'TEST_RESULTS.md'` literal already there).
  Do NOT add to `constants.ts` (owned/being-edited by the parallel PRP — avoid
  merge conflict).
- Marker is real Markdown (unlike JSON-in-`.md` TEST_RESULTS.md): an H1 +
  bullet list (timestamp, session path, tasks.json sha256, bug-finder agent) +
  a PRD §4.4 note.

## 9. Coverage gate

`vitest.config.ts` enforces 100% stmt/branch/func/lines globally. New branches:
- `isClean` true/false (2 branches) — cover both.
- `unlink` ENOENT-tolerant path (try/catch) — cover success + ENOENT.
- tasks.json read success vs missing (2 branches) — cover both.
- `smartCommit` is one statement (covered by the clean test).
All must be exercised by the new tests in the unit test file.

## 10. Non-goals / out of scope

- Do NOT change `writeBugReport` behavior (TEST_RESULTS.md write rules).
- Do NOT remove `TEST_RESULTS.md` on a clean hunt (CONTRACT only mandates
  removing `NO_ISSUES_FOUND.md` on a buggy hunt).
- Do NOT add `BUG_RESULTS_FILE` / `BUGFIX_SCOPE` / new config.
- Do NOT touch `prp-pipeline.ts` `runQACycle` (the marker logic is fully inside
  `BugHuntWorkflow`, invoked via the existing `run(sessionPath)` call). The
  pipeline already calls `bugHuntWorkflow.run(sessionPath)` (prp-pipeline.ts
  ~:1554), so the marker writes automatically to the right path with no
  pipeline edit.
- Do NOT edit `constants.ts` (parallel PRP owns it; consume `getBugFinderAgent`).