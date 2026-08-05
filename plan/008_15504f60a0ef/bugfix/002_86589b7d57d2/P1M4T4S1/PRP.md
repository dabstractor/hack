# PRP — P1.M4.T4.S1: Run full vitest, confirm 0 failures, fix stragglers

> Bugfix 002 · **BUG-004 (MAJOR) — Full-suite green verification GATE.** This is the FINAL proof
> that the test suite is green (exit 0) so the PRD §4.4 `validate.sh` **abort-on-failure** path can
> pass on a correct build. It is a **verification gate**, not an implementation task: it assumes
> P1.M4.T1 (genuine bugs), T2 (environmental), T3 (rot — incl. the in-flight S3) are ALL landed, and
> its job is to (1) prove the whole suite is green, (2) sweep any **straggler** a category-fix item
> missed, and (3) **STOP + flag** any *real* src defect it uncovers (never mask one).

> **Parallel-coordination:** P1.M4.T3.S3 (5 category-(b) rot files) is still in-flight as this PRP
> is written. **Do NOT begin execution until T3.S3 is marked Complete** — a pre-S3 green run is
> impossible (it owns ~13 of the failures). Consume S3's PRP (`…/P1M4T3S3/PRP.md`) as a contract:
> assume its 5 files land green. This item only touches a file if it is STILL red after T1+T2+T3.

> **Scope:** test-suite greenness + test-only straggler fixes. `src/` is **READ-ONLY** here except
> the one rule-5 carve-out: a *real* contract defect uncovered by a straggler must be **flagged in
> `architecture/bug-004-test-suite.md`** and handed off — NOT fixed in this item (see Decision-Tree).

---

## Goal

**Feature Goal**: Drive the whole vitest suite to **green** — `0 failed test files`, `0 failed
tests`, **exit 0** — and prove the §4.4-equivalent `npm run validate` gate (lint + format:check +
typecheck + test:run) passes, so the PRD §4.4 abort-on-failure validation path works on a correct
build. Any remaining (straggler) failure is line-audited, categorized, and fixed **test-only**; a
genuine production defect is **flagged, not masked**.

**Deliverable**:
- A green `npx vitest run --reporter=dot` (exit 0; 0 failed files, 0 failed tests) recorded in the
  commit message with the **final counts** (`Test Files N passed | 0 failed`, `Tests M passed | K
  skipped | 0 failed`, `exit 0`).
- A green `npm run validate` (exit 0) — the closest in-repo artifact to the §4.4 `validate.sh`.
- Any test-only straggler fixes applied (each one line-audited against the BUG-004 category map).
- `architecture/bug-004-test-suite.md` updated with a one-line note for any **real** src defect
  surfaced (STOP case) — or a one-line "verified green @ <counts>" closure note if none.

**Success Definition**:
- `npx vitest run --reporter=dot` → **exit 0**, `0 failed` test files, `0 failed` tests.
- `npm run validate` → **exit 0** (lint + format:check + typecheck + test:run all green).
- No assertion was **weakened or deleted** to force green (stragglers are re-aligned to the real
  contract, or a real defect is flagged — never masked).
- `git diff --stat -- src/` is **empty** (this item writes NO production code; the rule-5 carve-out,
  if triggered, is recorded in `architecture/` and handed to a separate item).
- Commit subject uses the landed task-prefix: **`1.4.4.1: <subject>`** (NO `[PRP Auto]` — forbidden
  per PRD §5.1 / BUG-003; the `Co-Authored-By` trailer IS preserved).

## User Persona (if applicable)

**Target User**: The pipeline maintainer + the PRD §4.4 validation path. End users unaffected.

**Use Case**: "T1/T2/T3 have fixed the 20 historically-red files. Prove the WHOLE suite (201 files)
is green, sweep anything they missed, and confirm `npm run validate` passes — without masking any
real defect the sweep might uncover."

**User Journey**:
1. **Wait** for P1.M4.T3.S3 to be Complete (precondition).
2. **Capture the real pre-gate baseline** (`npx vitest run --reporter=dot`) — this is the authoritative
   "before" state for this item.
3. If green → record counts, run `npm run validate`, commit, done.
4. If NOT green → for each straggler file: line-audit → categorize (a/b/c) → apply the matching
   **test-only** fix from the Decision-Tree; re-run that file; re-run the whole suite.
5. If a straggler reveals a **real** src defect → STOP that file; flag in `architecture/`; do NOT
   weaken the test; continue sweeping the remaining stragglers.
6. **Final** whole-suite green run + `npm run validate`; commit with final counts.

**Pain Points Addressed**: Closes BUG-004 entirely; unblocks the §4.4 validate gate; guarantees the
abort-on-failure path can ever reach bug-hunt on a green build.

## Why

- **Closes BUG-004.** The validate gate (§4.4) aborts on `non-zero exit`. A red suite aborts even on
  a correct build, so §4.4 is unusable until the suite is green. This item IS that green proof.
- **Catches cross-item regressions.** T1/T2/T3 each fixed a category in isolation; only a full-suite
  run proves they compose (a fix in one item can newly redden a previously-green file via shared
  mocks/state). This gate is the only item with the whole suite in scope.
- **Corrective, not feature work.** No PRD/feature change; no new behavior. Rule 5 permits test-only
  corrective work (stale expectations, isolation rot) without a PRP; the one src carve-out is
  explicitly STOP-and-flag (handed off), not implemented here.

## What

| Step | Action | Scope |
|---|---|---|
| 0 | Capture real pre-gate baseline | observe only |
| 1 | Run `npx vitest run --reporter=dot` | verify |
| 2 | Per straggler: line-audit → categorize (a/b/c) → test-only fix; STOP+flag real src defect | test-only / flag |
| 3 | Re-run whole suite until green | verify |
| 4 | Run `npm run validate` (feasible §4.4-equivalent) | verify |
| 5 | Commit with final counts; task-prefix `1.4.4.1:`; NO `[PRP Auto]` | git |
| 6 | Closure note in `architecture/bug-004-test-suite.md` (green counts OR flagged defect) | doc |

### Success Criteria

- [ ] `npx vitest run --reporter=dot` → exit 0; `0 failed` test files; `0 failed` tests.
- [ ] `npm run validate` → exit 0.
- [ ] Every straggler fix is **test-only** and re-aligns to the real contract (no weakening);
      OR a real defect is flagged in `architecture/` and NOT masked.
- [ ] `git diff --stat -- src/` empty.
- [ ] Commit subject = `1.4.4.1: <subject>` (no `[PRP Auto]`); final counts in the body.

## All Needed Context

### Context Completeness Check

If an implementer knew nothing about this codebase, would they have everything needed? **Yes.** This
PRP states the exact gate commands (with package.json:45 + vitest.config.ts citations), the
exit-0 contract, the full straggler Decision-Tree (category signs + matching test-only fix + the
sibling PRP to crib from), the STOP rule for real src defects, the shared helper exports, the commit
format (prefix `1.4.4.1`, no `[PRP Auto]`), and the phantom-straggler gotchas (endpoint guard,
ambient env, OOM, flakiness).

### Documentation & References

```yaml
# MUST READ — this item's own research (decision-tree + command reference + gotchas)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T4S1/research/findings.md
  why: §4 straggler decision-tree (the core of this item) + §2 exact commands + §8 phantom-straggler
       gotchas (endpoint guard, ambient env, OOM, flakiness).
  section: all sections load-bearing.

# MUST READ — the authoritative BUG-004 category map (names the straggler root causes)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-004-test-suite.md
  why: Category (a)/(b)/(c) definitions + per-file failure lists + "Order: fix (c) first" — this is
       the categorization rubric for stragglers. Also the STOP-case flag target.
  section: "Category (a)/(b)/(c)" + "NOTE on interaction with BUG-001/002/003".

# MUST READ — the sibling PRPs (straggler-fix patterns to crib from; their files are NOT re-owned)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T1S1/PRP.md
  why: Category-(c) pattern (process._events iterable guard). Crib for any genuine-test-bug straggler.
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T1S2/PRP.md
  why: Category-(c) pattern (exit-code/assertion drift, prompt drift). Crib for genuine-bug stragglers.
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T2S2/PRP.md
  why: Category-(a) pattern (apply tests/helpers/research-seam.ts). Crib for PiHarness stragglers.
       Also the EXAMPLE that running-all-files can REFUTE a contract's category label — re-verify
       each straggler's category before applying its fix.
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T3S1/PRP.md   # coder-agent
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T3S2/PRP.md   # pipeline-main-loop
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T3S3/PRP.md   # 5 rot files (IN-FLIGHT)
  why: Category-(b) patterns (model-literal zai/glm-5.x, prompt re-point, SessionState-object mock,
       constructor->run() wiring). Crib for test-rot stragglers. Re-read the file's research/findings.md
       BEFORE editing it — a straggler in a T3 file is almost always "re-apply the sibling pattern".

# ── Test infra (the straggler-fix toolbox) ──
- file: tests/helpers/research-seam.ts
  why: exports (verified via grep): createMockPRPDocument, MOCK_PRP_DOCUMENT, MINIMAL_PRP_JSON_STRING,
       createSuccessAgentResponse, prpJsonPath, wireMockResearcherAgent, wireMockPRPGenerator,
       wireMockResearchQueue, initRealHarness. THE category-(a) fix; do not reinvent the seam.
- file: tests/setup.ts
  why: global per-test hooks — vi.clearAllMocks, validateProviderEndpoint (THROWS on Anthropic → use
       z.ai), unhandled-rejection tracking (an un-awaited promise FAILS the test), delete
       process.env.SKIP_BUG_FINDING hermetic reset. A "unhandled rejection" straggler is often a
       missing await, not an assertion bug.
- file: vitest.config.ts
  why: include ['tests/**/*.{test,spec}.ts']; pool forks 1-4 / 4096 MB (OOM surfaces as a failed FILE,
       not an assertion); coverage.thresholds.global=100% (ONLY under --coverage; NOT a gate here).

# ── Commands + commit format (verified) ──
- file: package.json
  why: :45 "validate" = `npm run lint && npm run format:check && npm run typecheck && npm run test:run`
       (the FEASIBLE §4.4-equivalent gate). "test:run" = `vitest run`.
- file: src/utils/git-commit.ts
  why: formatCommitMessage lands the task-prefix only when position && getPrpCommitFormat()==='task-prefix'
       (default). parseItemPosition('P1.M4.T4.S1')={1,4,4,1} → buildTaskPrefix='1.4.4.1'. [PRP Auto] is
       regex-stripped (§5.1). Co-Authored-By trailer ALWAYS appended.

# ── PRD (the WHY) ──
- file: PRD.md
  why: §4.4 step 1 + "Abort-on-failure" — validate.sh runs the suite and ABORTS on non-zero exit
       BEFORE cleanup/commit/bug-hunt; watchdog-kill (exit 124) is terminal (§9.3.2). GREEN here is
       the precondition for §4.4 to function.

# ── vitest docs (for straggler triage) ──
- url: https://vitest.dev/guide/cli.html#vitest-run
  why: `vitest run` (one-shot, no watch) + `--reporter=dot|verbose` flags. `--bail=1` (`npm run
       test:bail`) stops at the FIRST failure for fast triage of a straggler.
```

### Current Codebase tree (the files this item MAY touch)

```bash
# This item touches files ONLY if they are stragglers (still red after T1+T2+T3) OR newly-regressed.
# Default: it touches NOTHING under src/ and ideally nothing under tests/ either (pure verification).
tests/integration/<any-straggler>.test.ts        # POSSIBLE test-only edit (categorize first)
tests/unit/<any-straggler>.test.ts               # POSSIBLE test-only edit (rare — units are green)
tests/helpers/research-seam.ts                   # (no edit — consume its exports for (a) stragglers)
plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/
  architecture/bug-004-test-suite.md             # EDIT — closure note (green counts) OR STOP-case flag
src/                                             # READ-ONLY (rule-5 carve-out is flagged, NOT fixed here)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — this is a GATE, not a feature. Do NOT add tests, do NOT add production code, do NOT
//   "improve" the suite. Sweep stragglers test-only; flag real defects. If you cannot make a file
//   green WITHOUT weakening an assertion or editing src/, that is the STOP case (flag in architecture/).

// CRITICAL — wait for P1.M4.T3.S3 to be Complete BEFORE running the gate. A pre-S3 run is guaranteed
//   red on S3's 5 files (~13 failures) and tells you nothing actionable.

// CRITICAL — capture the REAL pre-gate baseline as Task 0 (do not trust the architecture-doc number;
//   it predates T1/T2/T3). The baseline + final counts are the contract deliverable in the commit msg.

// CRITICAL — `npm run validate` IS feasible (package.json:45). Run it as the FINAL gate. It chains
//   lint && format:check && typecheck && test:run — a failure in any one aborts. If vitest is green
//   but validate fails, the straggler is lint/format/typecheck (cheaper to fix than a test failure).

// CRITICAL — z.ai endpoint guard (tests/setup.ts validateProviderEndpoint) THROWS if .env points at
//   anthropic.com → EVERY test fails identically with an endpoint error. If failures are uniform
//   across UNRELATED files, check .env/.envrc FIRST — it is env-misconfig, not a straggler.

// CRITICAL — an "unhandled promise rejection" test failure is usually a MISSING AWAIT (setup.ts
//   tracks rejections and fails the test), not an assertion bug. Await the promise before "fixing".

// CRITICAL — OOM (4096 MB forks cap) surfaces as a crashed/failed FILE with no clean assertion
//   failure. A genuine OOM straggler = a test building an unbounded structure; fix the TEST.

// CRITICAL — run-to-run flakiness (±1): re-run twice; a test that flips is a real isolation bug
//   (mock-state bleed, a leaked process listener like the shutdown bug), not noise.

// CRITICAL — model strings are PROVIDER-QUALIFIED ('zai/glm-5.2', 'zai/glm-5-turbo'), NOT bare
//   'glm-5.x'. Any (b)-rot straggler's new literal MUST keep the 'zai/' prefix or it stays red.

// CRITICAL — currentSession is a SessionState OBJECT (not a path string). TaskOrchestrator reads
//   .taskRegistry; PRPGenerator reads .metadata.path. Any (b)-rot straggler mock must provide BOTH.

// CRITICAL — NEVER weaken an assertion to force green. Re-point to the CURRENT verbatim literal;
//   grep the constant's line range FIRST (PRP_BLUEPRINT_PROMPT vs PRP_BUILDER_PROMPT vs
//   TASK_BREAKDOWN_PROMPT are different constants — do not cross them).

// CRITICAL — commit subject prefix is `1.4.4.1:` (from P1.M4.T4.S1). NEVER prepend `[PRP Auto]`
//   (forbidden §5.1; P1.M3 strips it defense-in-depth). The Co-Authored-By trailer IS kept.
```

## Implementation Blueprint

### Data models and structure

None. This item changes no production data models and adds no test fixtures. Straggler fixes reuse
the existing `tests/helpers/research-seam.ts` exports (category a) or re-point assertions to existing
constants (categories b/c). The only doc edit is a one-line note in
`architecture/bug-004-test-suite.md`.

### Implementation Tasks (ordered by dependencies)

```yaml
# ═════════════════════════════ TASK 0 — precondition + capture real baseline ═════════════════════════════
Task 0: VERIFY precondition + capture baseline  (no edit)
  - PRECONDITION: confirm plan/tasks.json shows P1.M4.T3.S3 status == Complete (and T1/T2/T3 all
    Complete). If S3 is still in-flight, STOP — do not run the gate yet.
  - RUN:  npx vitest run --reporter=dot 2>&1 | tail -n 30   >  research/baseline.txt
  - RECORD in research/baseline.txt: "Test Files  X passed | Y failed", "Tests  M passed | N failed |
    K skipped", exit code. THIS is the authoritative pre-gate state for this item.
  - IF baseline is already green (Y==0, N==0, exit 0): skip to Task 5 (npm run validate) + commit.
  - WHY: the architecture-doc number predates T1/T2/T3; only a live capture is authoritative, and
    the commit message must quote the REAL final counts.

# ═════════════════════════════ TASK 1 — triage stragglers by category ═════════════════════════════
Task 1: TRIAGE  (no edit)
  - FOR each file in baseline "failed" list:
      - RUN:  npx vitest run <file> --reporter=verbose 2>&1 | tail -n 60
      - READ the failure message(s); classify by the Decision-Tree (research/findings.md §4):
          (c) GENUINE TEST BUG  -> Task 2
          (a) ENVIRONMENTAL "PiHarness not initialized" -> Task 3
          (b) TEST-ROT (stale model/prompt/mock/wiring) -> Task 4
          REAL SRC DEFECT (test asserts a correct in-spec contract, production violates it)
              -> STOP case (Task 6 flag); do NOT edit; continue to next file
      - RECORD the classification + the ONE failing assertion per file in research/stragglers.md.
  - CROSS-CHECK: if a straggler is a file a PRIOR item (T1/T2/T3) edited, re-read that item's
    PRP + research/findings.md FIRST — the fix is usually "re-apply the sibling pattern", not a new
    edit. A regression in an already-fixed file is most likely mock-state bleed or a sibling fix that
    needs re-application.
  - GOTCHA: running-all-files can REFUTE a contract's category label (see P1.M4.T2.S2's SCOPE
    CORRECTION). Verify each straggler's REAL root cause before applying its category's fix.

# ═════════════════════════════ TASK 2 — category (c): genuine test bug ═════════════════════════════
Task 2: FIX category-(c) stragglers  (test-only; crib P1.M4.T1.S1/S2)
  - PATTERN (process-event iterable guard — from T1.S1):
      OLD:  originalProcessListeners = { SIGINT: process._events?.SIGINT ? [...process._events.SIGINT] : [] }
      NEW:  guard with Array.isArray(process._events?.SIGINT) before spreading; restore by NAME in
            afterEach (capture + re-add the specific listeners — do NOT removeAllListeners, which
            wipes vitest's own handlers).
  - PATTERN (exit-code/assertion drift — from T1.S2): re-read the test's intent vs the current
    deterministic contract; fix the assertion to the real behavior (or fix the test's broken
    exit-code logic). Do NOT change production.
  - AFTER each file: npx vitest run <file> --reporter=verbose -> 0 failed.
  - RULE: never weaken. If the only green path weakens an assertion, it is NOT category (c) — escalate
    to the STOP case (Task 6).

# ═════════════════════════════ TASK 3 — category (a): environmental (PiHarness) ═════════════════════════════
Task 3: FIX category-(a) stragglers  (test-only; crib P1.M4.T2.S2; USE the helper)
  - IMPORT:  import { wireMockResearcherAgent, wireMockPRPGenerator, wireMockResearchQueue,
              initRealHarness } from '../helpers/research-seam.js';
  - PATTERN A (unit-style suite whose subject is NOT research): top-level vi.mock the seam +
              a wireMock* call in beforeEach (matches T2.S2 Group A).
  - PATTERN B (suite that DOES test research integration): beforeAll(() => initRealHarness()).
  - GOTCHA: smart-commit.test.ts was touched by BOTH T2.S2 (seam) AND BUG-003/P1.M3.T2.S1 (task-prefix
            assertions). If it is a straggler, re-apply BOTH — do not clobber either.
  - AFTER each file: npx vitest run <file> --reporter=verbose -> 0 failed.

# ═════════════════════════════ TASK 4 — category (b): test-rot ═════════════════════════════
Task 4: FIX category-(b) stragglers  (test-only; crib P1.M4.T3.S1/S2/S3)
  - PATTERN (model literal): OLD `model: 'GLM-4.7'` -> NEW `model: 'zai/glm-5.2'` (reasoning/research
            = balanced tier) or `'zai/glm-5-turbo'` (coder = fast tier). KEEP the 'zai/' prefix.
  - PATTERN (prompt re-point): grep the CURRENT constant's line range; assert a verbatim literal that
            is INSIDE the right constant (PRP_BLUEPRINT_PROMPT != PRP_BUILDER_PROMPT !=
            TASK_BREAKDOWN_PROMPT). Do NOT weaken (e.g. do not drop to a substring that matches both).
  - PATTERN (mock shape): currentSession is a SessionState OBJECT with .taskRegistry + .metadata.path.
  - PATTERN (wiring drift): PRPPipeline defers SessionManager/TaskOrchestrator into run()/
            initializeSession() — call await pipeline.run() (or initializeSession()) BEFORE asserting
            on pipeline state; inject the orchestrator AFTER init or mock at class level.
  - AFTER each file: npx vitest run <file> --reporter=verbose -> 0 failed.
  - GOTCHA (prp-blueprint-prompt.ts enableReflection): if a (b) straggler is the enableReflection
            assertion (toBe(true)) and production omits it — that is the ONE rule-5 production
            corrective already done by T3.S3. Do NOT re-fix; if it reverts, re-apply T3.S3 Task 12.

# ═════════════════════════════ TASK 5 — whole-suite green + npm run validate ═════════════════════════════
Task 5: VERIFY whole-suite green + validate gate  (no edit)
  - RUN:  npx vitest run --reporter=dot 2>&1 | tail -n 30
    EXPECT: Test Files <N> passed | 0 failed ; Tests <M> passed | <K> skipped | 0 failed ; exit 0.
  - RUN:  npm run validate
    EXPECT: exit 0 (lint && format:check && typecheck && test:run all green).
  - IF vitest green but validate fails: the straggler is lint/format/typecheck (cheaper than a test).
    Fix the reported file (test-only if it's a test; if it's a src type/lint error introduced by a
    sibling, that sibling owns it — flag, do not fix here unless it's an obvious rule-5 corrective).
  - RECORD final counts (Test Files / Tests / skipped / exit) for the commit message.

# ═════════════════════════════ TASK 6 — STOP case: flag a real src defect ═════════════════════════════
Task 6: FLAG real src defect  (doc-only; ONLY if Task 1 finds one)
  - TRIGGER: a straggler whose test asserts a CORRECT, in-spec contract and the production code
    VIOLATES it — i.e. the only green path is weakening a correct assertion or editing src/.
  - ACTION: do NOT edit src/. do NOT weaken the test. Append a one-line note to
            architecture/bug-004-test-suite.md: file:line, the violated contract, why it is NOT
            test-rot, and "handed off as rule-5 corrective (not fixed in P1.M4.T4.S1)".
  - CONTINUE sweeping the remaining stragglers (a flagged file does not block the others); re-run
            the whole suite EXCLUDING the flagged file's failing test only if needed to confirm the
            rest is green (vitest --testNamePattern or a temporary .skip on the ONE assertion —
            RECORD the skip in the commit message so it is never forgotten).

# ═════════════════════════════ TASK 7 — closure note + commit ═════════════════════════════
Task 7: DOC closure + COMMIT  (doc + git)
  - EDIT architecture/bug-004-test-suite.md: append a closure line:
        "P1.M4.T4.S1 verified GREEN: Test Files <N> passed | 0 failed; Tests <M> passed | <K> skipped
         | 0 failed; exit 0; npm run validate exit 0. [stragglers fixed test-only: <list> | OR:
         real src defect flagged: <file:line>]"
  - COMMIT (task-prefix from P1.M4.T4.S1 -> '1.4.4.1'; NO [PRP Auto]; Co-Authored-By trailer kept):
        Subject: 1.4.4.1: drive vitest suite green (0 failures) for §4.4 validate gate
        Body:    final counts (Test Files/Tests/skipped/exit), npm run validate exit 0,
                 per-straggler one-liners, any STOP-case flag.
  - SCOPE GUARD: git diff --stat -- src/  -> EMPTY (this item writes NO production code).
```

### Implementation Patterns & Key Details

```ts
// ── Pattern A: the straggler sweep loop (the whole item is this loop) ─────────────────────────
// baseline = npx vitest run --reporter=dot
// for each failed file:
//   msg = npx vitest run <file> --reporter=verbose
//   cat = classify(msg)  // (a) PiHarness | (b) rot | (c) genuine-bug | REAL
//   if cat === REAL: flag(architecture/); continue   // STOP case — never edit src here
//   apply(sibling_pattern[cat])                       // crib T1.S1/T1.S2 (c) | T2.S2 (a) | T3.* (b)
//   assert npx vitest run <file> -> 0 failed          // re-run the file
// assert npx vitest run --reporter=dot -> exit 0      // whole suite
// assert npm run validate -> exit 0                   // §4.4-equivalent gate

// ── Pattern B: category-(a) seam mock ( crib P1.M4.T2.S2; USE the helper, do not reinvent) ────
import { wireMockPRPGenerator } from '../helpers/research-seam.js';
vi.mock('../../src/agents/prp-generator.js', () => ({ PRPGenerator: vi.fn() }));
beforeEach(() => { wireMockPRPGenerator({ /* opts */ }); });

// ── Pattern C: category-(b) re-point (assert CURRENT verbatim literal, never weaken) ─────────
// grep -n "<CONSTANT>" src/agents/prompts.ts   # find the constant's line range
// pick a literal INSIDE that range; expect(PROMPT).toContain('<that literal>')

// ── Pattern D: commit prefix (P1.M4.T4.S1 -> '1.4.4.1') ──────────────────────────────────────
// formatCommitMessage already does this when given position={1,4,4,1} and PRP_COMMIT_FORMAT!=='plain'
// => subject "1.4.4.1: drive vitest suite green ..." ; trailer Co-Authored-By kept; NO [PRP Auto].

// ── Pattern E: the STOP case (real src defect) ───────────────────────────────────────────────
// DO NOT edit src/. DO NOT weaken the test. flag in architecture/. hand off as rule-5 corrective.
```

### Integration Points

```yaml
DATABASE: none
CONFIG:   none (PRP_COMMIT_FORMAT already defaults to 'task-prefix' — no env change)
ROUTES:   none
GIT:      ONE commit, subject `1.4.4.1: <subject>`, NO `[PRP Auto]`, Co-Authored-By trailer kept.
          Body MUST quote final counts (Test Files / Tests / skipped / exit) + npm run validate exit.
VALIDATE: `npm run validate` (package.json:45) is the §4.4-equivalent gate; MUST exit 0.
# Edits confined to: test-only straggler fixes (only if the suite is red), + ONE closure line in
# architecture/bug-004-test-suite.md. NO src/ edits (rule-5 carve-out is FLAGGED, not fixed here).
```

## Validation Loop

### Level 1: Syntax & Style (run if any test file was edited)

```bash
npm run typecheck        # tsc --noEmit ; expect no NEW errors on touched files
npm run lint             # eslint ; expect clean for touched files
npm run format:check     # prettier --check ; if it complains: npx prettier --write <file>
# Expected: Zero errors. (These are subsumed by `npm run validate` in Level 3.)
```

### Level 2: Per-file re-run (after each straggler fix)

```bash
npx vitest run <straggler-file> --reporter=verbose 2>&1 | tail -n 15
# Expected: 0 failed for that file. Re-run the WHOLE suite after the last straggler (Level 3).
# Fast triage of a single straggler without running the whole suite:
npx vitest run <straggler-file> --reporter=verbose --bail=1   # = npm run test:bail per-file
```

### Level 3: Whole-suite green + §4.4-equivalent gate (THE deliverable)

```bash
# THE primary gate:
npx vitest run --reporter=dot 2>&1 | tail -n 30
# Expected:
#   Test Files  <N> passed | 0 failed
#   Tests       <M> passed | <K> skipped | 0 failed
#   exit 0
# Diagnostics:
#   - "PiHarness not initialized" in the tail -> a category-(a) straggler survived T2; apply Task 3.
#   - model/prompt/mock mismatch in a file -> category-(b) straggler; apply Task 4.
#   - "process._events.X is not iterable" / exit-code drift -> category-(c) straggler; apply Task 2.
#   - uniform endpoint errors across UNRELATED files -> .env/.envrc points at anthropic.com (FIX ENV,
#     not the suite — this is env-misconfig, not a straggler).
#   - a FILE failed with no assertion (crashed) -> OOM (4096 MB cap); fix the TEST building unbounded data.

# THE feasible §4.4-equivalent gate (package.json:45):
npm run validate
# Expected: exit 0 (chains lint && format:check && typecheck && test:run).
# If vitest is green but validate fails: the straggler is lint/format/typecheck (cheaper than a test).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Scope guard — prove this item wrote NO production code:
git diff --stat -- src/                  # EXPECT: empty
git status --short -- src/               # EXPECT: empty

# No-weakness guard — no assertion was weakened to force green:
git diff -- tests/ | grep -E "\.skip|toBe\(undefined\)|toBeFalsy|toContain\(''\)"  # EXPECT: empty
# (Re-pointed assertions should be toContain(<real literal>) / toEqual(<real shape>), never weakened.)

# Commit-format guard:
git log -1 --pretty=%s | grep -E "^1\.4\.4\.1: "       # EXPECT: subject starts with "1.4.4.1: "
git log -1 --pretty=%B | grep -c "\[PRP Auto\]"        # EXPECT: 0 (forbidden per §5.1/BUG-003)
git log -1 --pretty=%B | grep -c "Co-Authored-By: Claude"  # EXPECT: 1 (trailer preserved)

# STOP-case guard (only if Task 6 triggered):
grep -c "P1.M4.T4.S1" plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-004-test-suite.md
# EXPECT: >=1 (either a closure "verified GREEN" line OR a "real src defect flagged" line).

# Count-recording guard (commit body quotes the final counts):
git log -1 --pretty=%B | grep -E "Test Files|Tests .*passed|exit 0"   # EXPECT: matches
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx vitest run --reporter=dot` → exit 0; 0 failed test files; 0 failed tests.
- [ ] `npm run validate` → exit 0 (lint + format:check + typecheck + test:run all green).
- [ ] Final counts (Test Files / Tests / skipped / exit) recorded in the commit body.
- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check` clean (subsumed by `npm run validate`).

### Feature Validation

- [ ] Every straggler line-audited + categorized (a/b/c) before fixing (research/stragglers.md).
- [ ] Every straggler fix is **test-only** and re-aligns to the real contract (no weakening).
- [ ] Any REAL src defect is **flagged** in `architecture/bug-004-test-suite.md` (STOP case), NOT
      masked and NOT fixed in this item.
- [ ] No previously-green file newly red after the sweep (cross-item regression caught + fixed).

### Code Quality Validation

- [ ] `git diff --stat -- src/` empty (NO production code written by this item).
- [ ] No assertion weakened/skipped to force green (Level 4 guard clean) — except a documented
      temporary skip for a STOP-case flagged defect, recorded in the commit message.
- [ ] Straggler fixes crib the sibling patterns (T1.S1/S2 for c, T2.S2 for a, T3.* for b) rather than
      inventing new patterns.

### Documentation & Deployment

- [ ] `architecture/bug-004-test-suite.md` has a closure line (GREEN counts OR flagged defect).
- [ ] Commit subject = `1.4.4.1: <subject>` (task-prefix from P1.M4.T4.S1); NO `[PRP Auto]`
      (forbidden per PRD §5.1 / BUG-003); `Co-Authored-By: Claude <noreply@anthropic.com>` kept.
- [ ] Commit body quotes the final counts + per-straggler one-liners + any STOP-case flag.

---

## Anti-Patterns to Avoid

- ❌ Don't run the gate before P1.M4.T3.S3 is Complete — a pre-S3 run is guaranteed red on S3's files
  and is wasted effort.
- ❌ Don't trust the architecture-doc baseline number — capture the REAL pre-gate baseline (Task 0);
  the commit must quote real final counts.
- ❌ Don't add tests, add production code, or "improve" the suite — this is a GATE + straggler sweep,
  not a feature.
- ❌ Don't weaken/skip an assertion to force green — re-point it to the real current contract, or
  escalate to the STOP case (flag the real defect).
- ❌ Don't edit `src/` here — the rule-5 carve-out for a real defect is FLAGGED in `architecture/`
  and handed off, NOT implemented in this item.
- ❌ Don't reinvent the research seam for a category-(a) straggler — use `tests/helpers/research-seam.ts`
  (`wireMock*` / `initRealHarness`), cribbing P1.M4.T2.S2.
- ❌ Don't apply a category fix before VERIFYING the straggler's real root cause — running-all-files
  can refute the contract's category label (see P1.M4.T2.S2's SCOPE CORRECTION).
- ❌ Don't cross prompt constants — PRP_BLUEPRINT_PROMPT ≠ PRP_BUILDER_PROMPT ≠ TASK_BREAKDOWN_PROMPT;
  grep the constant's line range before asserting a literal.
- ❌ Don't drop the `zai/` prefix from a model literal — production emits provider-qualified strings.
- ❌ Don't chase the groundswell alias or reinvent the harness init — the architecture doc confirms
  the alias is fine; "PiHarness not initialized" is a missing seam/harness-init, not a link problem.
- ❌ Don't treat a uniform endpoint-error failure across unrelated files as a straggler — check
  `.env`/`.envrc` first (the z.ai guard in setup.ts throws on anthropic.com).
- ❌ Don't prepend `[PRP Auto]` to the commit (forbidden §5.1/BUG-003); the prefix is `1.4.4.1:`.
- ❌ Don't run the pipeline app (`npm run dev`/`tsx src/index.ts`) — only vitest + `npm run validate`.

---

## Confidence Score

**9/10** — one-pass success likelihood. The gate commands are verified against `package.json:45`
(`npm run validate` exists and chains lint+format+typecheck+test:run) and `vitest.config.ts`. The
exit-0 contract is unambiguous. The straggler Decision-Tree is fully grounded: each category (a/b/c)
has a verified sibling PRP with an empirically-validated fix pattern to crib from, and the STOP rule
for real src defects is explicit (flag in `architecture/`, never mask). The commit format is traced
through `parseItemPosition('P1.M4.T4.S1')→{1,4,4,1}→'1.4.4.1'` with the `[PRP Auto]` strip confirmed.
The one residual uncertainty — the EXACT straggler set + count — is by definition unknowable until
T1/T2/T3/S3 all land (T3.S3 is in-flight at planning time); the PRP handles this by making Task 0 a
live baseline capture and by giving the executor a complete, category-keyed remediation playbook for
whatever stragglers appear. Minus 1 point for that irreducible run-time dependency on the parallel item.