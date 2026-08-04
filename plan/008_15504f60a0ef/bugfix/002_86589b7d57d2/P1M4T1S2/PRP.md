---
name: "P1.M4.T1.S2 — Diagnose + fix remaining genuine-bug test files (progressive-validation, prp-pipeline-integration, prp-create-prompt)"
description: >
  BUG-004 Category-(c) test-suite remediation. The architecture doc
  (architecture/bug-004-test-suite.md §Category c) COUNTED these three files as failing
  (9 / 6 / 4) but did NOT line-audit them. This subtask's contract is the line-audit:
  run each file, read the actual assertion failures + stack traces, categorize each
  failure, and fix the TEST logic (never production code). VERIFICATION-FIRST FINDING
  (from research): at the time of this PRP, ALL THREE FILES ARE GREEN — 69/69 tests pass
  individually, together, AND in the full tests/integration suite context (no
  contamination). The doc's 9/6/4 counts are STALE — the test files were last modified
  ~6 months ago and the failures resolved via src-only lifecycle-stabilization commits
  (e.g. 36a07a4 "stabilize lifecycle and error reporting", c520546 "propagate fatal
  execution errors"). Expected outcome: re-verify green, document per-file root cause,
  zero-or-minimal code change. The PRP still carries a full re-diagnosis playbook for
  the contingency that the baseline has shifted by execution time.
---

## Goal

**Feature Goal**: For the three Category-(c) test files —
`tests/integration/progressive-validation.test.ts`,
`tests/integration/prp-pipeline-integration.test.ts`, and
`tests/integration/prp-create-prompt.test.ts` — perform the contract-mandated LINE-AUDIT
(run each, read actual failures + stack traces), confirm each is green in isolation AND in
the full-suite context, and document the per-file root cause. Make minimal test-logic edits
ONLY where a genuine Category-(c) test bug is still present.

**Deliverable**: All three files pass (individually and in full `tests/integration` context),
with any remaining failures correctly re-categorized to (a) environmental (→ P1.M4.T2) or
(b) test-rot (→ P1.M4.T3) and handed off, and a per-file root-cause record. **Per research,
the expected outcome is ZERO code change** — the executor re-verifies the green state and
documents why the doc's counts were stale.

**Success Definition**:
1. Each of the three files, run individually, passes with **0 failures**.
2. Each of the three files is confirmed green in the **full `tests/integration` run**
   (no cross-file contamination reintroducing failures).
3. Every failure (if any appears at execution time) is categorized: **(c) genuine test bug**
   → fixed here; **(a) environmental** → handed to P1.M4.T2; **(b) test-rot** → handed to
   P1.M4.T3. No failure is left uncategorized.
4. **No production code (`src/`) is changed to satisfy a stale test** (rules 2/4 + AGENTS.md
   §5). If a failure reveals a REAL src defect, the executor STOPS, does NOT mask it, and
   records it in `architecture/` for a separate PRD-entry fix.
5. Per-file root cause is documented (in the commit message if a fix was made; otherwise in
   an appended note to `architecture/bug-004-test-suite.md` updating the stale counts).

## Why

- **PRD §4.4** generates a `validate.sh` that runs `npm test` and aborts on non-zero exit
  before cleanup/commit/bug-hunt. The suite is red (154 failed | 910 passed across 18 failed
  files in `tests/integration`), so the validation gate is unusable. BUG-004 drives it green.
- This subtask owns the **Category-(c) genuine-test-bug** subset. Categories (a)
  (environmental "PiHarness not initialized") and (b) (test-rot) are owned by sibling
  subtasks P1.M4.T2 and P1.M4.T3 respectively. Keeping the boundaries clean prevents two
  subtasks from editing the same file.
- The architecture doc explicitly flagged these three files as "counted, not line-audited —
  diagnose before fixing." The line-audit (this task) IS the deliverable; its result happens
  to be "already green," which is itself a valid, valuable finding that retires the stale
  counts and shrinks BUG-004's true scope.

## What

### RESEARCH FINDING (must re-verify at execution time — baselines shift run-to-run)

At PRP research time, all three target files are **GREEN**:

| File | Individual run | In full `tests/integration` context | Doc's stale count |
| --- | --- | --- | --- |
| `tests/integration/progressive-validation.test.ts` | ✅ 28/28 | ✅ 28/28 (24s — slowest) | "9 fail" |
| `tests/integration/prp-pipeline-integration.test.ts` | ✅ 10/10 | ✅ 10/10 (0.7s) | "6 fail" |
| `tests/integration/prp-create-prompt.test.ts` | ✅ 31/31 | ✅ 31/31 (0.4s) | "4 fail" |
| **Total** | **✅ 69/69** | **✅ 69/69, contamination-free** | (19 stale) |

The three files were last modified ~6 months ago (commits `bbf5c4d` / `faaef89` / `68fe77f` —
"complete comprehensive integration tests"). They are UNCHANGED by the recent BUG-001/002/003
work. The failures the doc counted have since resolved via **src-only** changes — most
plausibly the lifecycle/error-reporting stabilization commits visible in git log
(`36a07a4 fix(runtime): stabilize lifecycle and error reporting`,
`c520546 fix(pipeline): propagate fatal execution errors`,
`df59eb2 fix(pipeline): restore delta breakdown reachability via reorder`).

Each file properly mocks the research/harness seam (see per-file mocking style below), so none
of them are subject to Category-(a) "PiHarness not initialized" failures — the doc's (c)
categorization is correct; only the counts are stale.

### What the executor must DO

1. **Re-run each file individually** (line-audit — do NOT trust the research numbers).
2. **Run each file in the full `tests/integration` context** (contamination check).
3. If green everywhere → document root cause (see Success Definition #5); no code change.
4. If red → execute the re-diagnosis playbook (below), categorize, and act per contract.

### Success Criteria

- [ ] Each of the 3 files passes individually with 0 failures (`npx vitest run <file>`).
- [ ] Each of the 3 files is green in the full `tests/integration` run (grep its result line).
- [ ] Any failure observed is categorized (c / a / b) and routed correctly.
- [ ] No `src/` file was modified to satisfy a test (verified via `git status --short`).
- [ ] Per-file root cause documented in commit message OR appended architecture note.

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, could they verify and (if needed) fix these
test files?_ **Yes** — each file's exact mocking style, the src it exercises, the runtime
verification commands, and the categorization routing are all specified below. The executor
needs no prior knowledge of the PRP pipeline internals.

### Documentation & References

```yaml
# MUST READ — the architecture doc that spawned this task (its counts are now STALE; the
# doc itself says these files were "counted, not line-audited — diagnose before fixing")
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-004-test-suite.md
  why: "§Category (c) lists these 3 files with stale failure counts; §'Order' says fix (c)
        first so failure counts stabilize. §'NOTE on interaction with BUG-001/002/003' says
        run the final full-green check AFTER BUG-001/002/003 land (they have)."
  critical: "The doc's 9/6/4 counts for these 3 files are CONFIRMED STALE by line-audit
             (all green). Do NOT chase 19 phantom failures. Re-verify and document."

# FILE 1 — progressive-validation.test.ts (28 tests; src: PRPExecutor + PRP_BUILDER_PROMPT)
- file: tests/integration/progressive-validation.test.ts
  why: Category-(c) target #1. Asserts (a) PRP_BUILDER_PROMPT contains progressive-validation
        spec text (Levels 1-4, sequential progression, failure/fix-cycle protocol) and
        (b) PRPExecutor validation-gate execution (sequential gates, fix-cycle retry up to
        maxFixAttempts, skipped-gate tracking, exit-code recording).
  mocking_style: "vi.mock('../../src/agents/agent-factory.js') at L32 provides createCoderAgent
        as a stub — ISOLATES from the real Researcher/harness (so NOT category-a). PRESERVE
        this mock; do not remove it or the suite becomes category-a."
  src_exercised:
    - "src/agents/prp-executor.ts (PRPExecutor validation-gate + fix-cycle loop)"
    - "src/agents/prompts.ts (PRP_BUILDER_PROMPT constant — prompt-text assertions)"
  gotcha: "Slowest of the three (~24s) due to real fix-cycle retry delays. Use a generous
           timeout when running. Passing output includes expected WARN 'Validation failed,
           retrying' and USERLVL 'Validation gate failed' lines — these are NOT failures."

# FILE 2 — prp-pipeline-integration.test.ts (10 tests; src: PRPPipeline full run())
- file: tests/integration/prp-pipeline-integration.test.ts
  why: Category-(c) target #2. Exercises PRPPipeline.run() end-to-end: new-session workflow,
        existing-session reuse, state transitions through all phases, PipelineResult summary
        accuracy (counts/duration), scope parameter, and error handling.
  mocking_style: "FOUR vi.mock() at L26/57/73/94: (1) agent-factory.js — stubs
        createResearcherAgent→stubAgent (the explicit research-seam isolation, see comment
        L20-24); (2) git-commit.js; (3) validation-workflow.js; (4) node:fs/promises
        (importOriginal passthrough). PRESERVE all four — removing any re-exposes the suite
        to category-a (PiHarness) or real-filesystem side effects."
  src_exercised:
    - "src/workflows/prp-pipeline.ts (PRPPipeline.run / initializeSession — NOTE BUG-003
       refactored this to DEFER SessionManager/TaskOrchestrator creation into run(); these
       tests already call run() so they survived that refactor)"
  gotcha: "Uses mkdtempSync real temp dirs (L12 import) for session snapshots — these are
           cleaned in afterEach. Do not switch to a non-temp path."

# FILE 3 — prp-create-prompt.test.ts (31 tests; pure prompt-text assertions)
- file: tests/integration/prp-create-prompt.test.ts
  why: Category-(c) target #3. Pure text-containment assertions over the PRP_CREATE_PROMPT
        constant: verifies it instructs Research Process (subagents, plan/architecture,
        external research, user clarification), PRP Generation Process, Codebase Analysis,
        Information Density Standards, and PRP Quality Gates. 'Prompt-assertion drift' would
        be a failure here.
  mocking_style: "vi.mock('groundswell', ...) at L46 — importActual passthrough (intercepts
        the import but returns the real module). This mock exists only so the suite does not
        hit a non-linked groundswell; it does NOT alter behavior. PRESERVE."
  src_exercised:
    - "The PRP_CREATE_PROMPT / PRP_BLUEPRINT_PROMPT constant (see test header L26 @see
       ../../PROMPTS.md lines 189-639 for the canonical text)."
  gotcha: "If this file is RED, the root cause is almost always prompt-text drift — the
           src prompt dropped/renamed a section the test greps for. Per contract, you may
           update the TEST literal to match current intended behavior, but if the prompt
           genuinely LOST a §4.3/§9.x-mandated instruction, that is a REAL src defect → STOP
           and flag in architecture/ (do not weaken the test to hide it)."

# CONTRACT CONSTRAINTS (from the work item)
- rule: "OUTPUT: each file passes, OR its failures are re-categorized to (a)/(b) and handed
         to the sibling subtask. Document per-file root cause."
- rule: "Do NOT change production code to satisfy a stale test (AGENTS.md rules 2/4). If a
         failure reveals a REAL src defect, STOP and flag it in architecture/ — do not mask."
- rule: "MOCKING: as-isolated-as-possible; match the mocking style each file ALREADY uses
         (documented per-file above). Do not introduce a new mocking pattern."

# ROUTING for failures outside Category (c)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-004-test-suite.md
  why: "Category (a) environmental failures ('PiHarness not initialized' from a real,
        unmocked Researcher run) → P1.M4.T2. Category (b) test-rot (stale model names like
        GLM-4.7, stale maxTokens, constructor→run() drift) → P1.M4.T3. Do NOT fix those here."
```

### Current Codebase tree (relevant slice)

```bash
tests/integration/
├── progressive-validation.test.ts          # ← TARGET #1 (28 tests; mocks agent-factory)
├── prp-pipeline-integration.test.ts        # ← TARGET #2 (10 tests; mocks 4 modules)
├── prp-create-prompt.test.ts               # ← TARGET #3 (31 tests; mocks groundswell)
├── prp-pipeline-shutdown.test.ts           # ← sibling P1.M4.T1.S1 (DONE — process._events fix)
├── coder-agent.test.ts                     # ← sibling P1.M4.T3.S1 (category b — NOT yours)
├── pipeline-main-loop.test.ts              # ← sibling P1.M4.T3.S2 (category b — NOT yours)
├── smart-commit.test.ts                    # ← sibling P1.M4.T2 (category a — NOT yours)
└── core/task-orchestrator*.test.ts         # ← sibling P1.M4.T2 (category a — NOT yours)
src/
├── agents/
│   ├── prp-executor.ts                     # exercised by TARGET #1
│   └── prompts.ts                          # PRP_BUILDER_PROMPT (TARGET #1) / PRP_CREATE_PROMPT (TARGET #3)
└── workflows/
    └── prp-pipeline.ts                     # exercised by TARGET #2
vitest.config.ts                            # resolve.alias.groundswell → sibling repo dist (NOT node_modules)
plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/
└── bug-004-test-suite.md                   # ← where stale counts live; append root-cause note here
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — vitest resolve.alias.groundswell → sibling repo, NOT node_modules.
//   When a test does vi.mock('groundswell', importActual) it gets the sibling dist.
//   The three target files either mock the research SEAM (agent-factory) or mock
//   groundswell directly, so NONE of them hit Category-(a) "PiHarness not initialized".
//   Do NOT "simplify" a passing mock away — that re-introduces category-a.

// CRITICAL — failure counts in bug-004-test-suite.md are RUN-TO-RUN ±1 and several are
//   STALE (written before the lifecycle-stabilization src commits). Trust a fresh
//   `npx vitest run <file>`, never the doc's numbers.

// CRITICAL — progressive-validation.test.ts is SLOW (~24s) by design: it exercises real
//   fix-cycle retry delays. WARN "Validation failed, retrying" / USERLVL "Validation gate
//   failed" log lines in its output are EXPECTED, not failures.

// RULE — AGENTS.md rules 2/4: NEVER change src/ to make a stale test pass. A red test that
//   reflects a genuine missing §4.3/§9.x behavior is a REAL src defect → STOP, record in
//   architecture/, do not mask by weakening the assertion.
```

## Implementation Blueprint

### Re-diagnosis Playbook (run FIRST — the contract-mandated line-audit)

```yaml
Step 0: RE-VERIFY CURRENT STATE (do NOT trust research numbers — baselines shift)
  - RUN: npx vitest run tests/integration/progressive-validation.test.ts --reporter=verbose
  - RUN: npx vitest run tests/integration/prp-pipeline-integration.test.ts --reporter=verbose
  - RUN: npx vitest run tests/integration/prp-create-prompt.test.ts --reporter=verbose
  - EXPECT (per research): all 3 fully green (28 / 10 / 31).
  - RECORD: the actual pass/fail count for each (you will cite it in the root-cause note).

Step 1: CONTAMINATION CHECK — confirm green in full-suite context
  - RUN: npx vitest run tests/integration/ 2>&1 | grep -E "progressive-validation|prp-pipeline-integration|prp-create-prompt"
  - EXPECT: three "✓ tests/integration/<file>  (N tests)" lines, NO "FAIL" for these three.
  - WHY: a file can pass in isolation yet fail in-suite (module-level vi.mock in a sibling,
        shared state, fork-pool ordering). The contract output is "passes" = passes in the
        project's test run, so confirm in-context.

Step 2: IF ALL GREEN → DOCUMENT + DONE (most likely path)
  - Append a "P1.M4.T1.S2 line-audit results" note to
    architecture/bug-004-test-suite.md §Category (c): record the fresh per-file pass counts,
    state that the doc's 9/6/4 counts were stale, and name the src-only commits that resolved
    them (36a07a4 / c520546 / df59eb2 et al.). No src/ and no test-file change.
  - COMMIT message (if a commit is warranted): "test(BUG-004): retire stale category-(c)
    counts for progressive-validation/prp-pipeline-integration/prp-create-prompt (line-audit:
    all green; resolved by prior lifecycle-stabilization src commits)".

Step 3: IF ANY FILE IS RED → LINE-AUDIT + CATEGORIZE (contingency playbook)
  For EACH failing assertion, read the stack trace and classify EXACTLY ONE of:
    (c) GENUINE TEST BUG (logic error in the test itself: wrong exit-code expectation, broken
        spy/setup, iterable-spread on a non-iterable, etc.):
          → FIX the test logic here. Match the file's EXISTING mocking style. Do not touch src/.
    (b) TEST-ROT (stale literal: model name like GLM-4.7, maxTokens, constructor→run() drift,
        renamed API):
          → If it is ONE trivial literal in a file you are already editing, you MAY fix it
            inline (note in commit). Otherwise HAND OFF to P1.M4.T3 (category b) — do not
            expand this subtask's scope into a rot sweep.
    (a) ENVIRONMENTAL ("PiHarness not initialized" / real unmocked Researcher):
          → This means a mock was lost/regressed. Either RESTORE the documented mock
            (per-file mocking_style above) to keep the suite category-(c)-clean, OR hand the
            file to P1.M4.T2 (category a) if it legitimately needs real-harness init.
    REAL SRC DEFECT (the test correctly asserts a §4.3/§9.x behavior that src no longer does):
          → STOP. Do NOT weaken the assertion. Record the defect in architecture/ for a
            separate PRD-entry fix. Report up so this subtask does not mask a production bug.

Step 4: RE-RUN AFFECTED FILE(S) AFTER ANY EDIT
  - RUN: npx vitest run <edited-file> --reporter=verbose
  - EXPECT: 0 failures. Then re-run the Step 1 contamination check.
```

### Implementation Patterns & Key Details

```typescript
// This is a TEST-ONLY remediation. The dominant pattern is:
//   1. Line-audit (run the file, read failures).   ← Step 0/1
//   2. If green: document + done.                   ← Step 2 (most likely)
//   3. If red: categorize, then fix TEST logic only.← Step 3/4
//
// Per-file mocking styles to PRESERVE (do not rewrite):
//   progressive-validation.test.ts:    vi.mock('../../src/agents/agent-factory.js') [stub createCoderAgent]
//   prp-pipeline-integration.test.ts:  vi.mock x4 — agent-factory (stub createResearcherAgent),
//                                      git-commit, validation-workflow, node:fs/promises
//   prp-create-prompt.test.ts:         vi.mock('groundswell', importActual passthrough)
//
// The ONE hard rule (AGENTS.md §2/§4): never edit src/ to satisfy a test. A red test that
// encodes a real PRD requirement is a defect report, not a fix target.
```

### Integration Points

```yaml
TEST RUNNER:
  - command: "npx vitest run <file>"  (single) / "npx vitest run tests/integration/"  (cluster)
  - config: vitest.config.ts (pool forks, setup tests/setup.ts, alias groundswell→sibling dist)
  - note: "npm test" = vitest (watch); "npm run test:run" = vitest run (CI mode). Use test:run
          for deterministic exit codes.

DOCUMENTATION (where stale counts live + where root-cause note goes):
  - file: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-004-test-suite.md
  - section: "Category (c) — Genuine test bugs"  (append a P1.M4.T1.S2 line-audit results note)

NO SOURCE CHANGES EXPECTED:
  - This subtask edits ONLY the 3 test files (if a fix is needed) and/or the architecture doc
    note. It does NOT touch src/, package.json, vitest.config.ts, or PRD.md.
  - HAND-OFF targets: P1.M4.T2 (category a), P1.M4.T3 (category b), P1.M4.T4 (final full-green).
```

## Validation Loop

### Level 1: Line-audit (the contract-mandated first step)

```bash
cd /home/dustin/projects/hacky-hack

# Run each file individually — record the actual pass/fail count for each:
npx vitest run tests/integration/progressive-validation.test.ts --reporter=verbose 2>&1 | tail -5
npx vitest run tests/integration/prp-pipeline-integration.test.ts --reporter=verbose 2>&1 | tail -5
npx vitest run tests/integration/prp-create-prompt.test.ts --reporter=verbose 2>&1 | tail -5
# EXPECT (per research): 28 / 10 / 31 passed, 0 failed each.
# (progressive-validation is ~24s and logs expected WARN/USERLVL validation-fail lines — not failures.)
```

### Level 2: Contamination check (full-suite context)

```bash
cd /home/dustin/projects/hacky-hack

# Confirm the 3 files are green when the WHOLE integration dir runs together:
npx vitest run tests/integration/ 2>&1 \
  | grep -E "progressive-validation|prp-pipeline-integration|prp-create-prompt"
# EXPECT: three "✓ tests/integration/<file>  (N tests)" lines; NO "FAIL" line for these 3.
# (Other files in the dir WILL still fail — those are categories a/b, owned by sibling subtasks.)

# Optional: all three together (fast confirmation, no other files):
npx vitest run tests/integration/progressive-validation.test.ts \
  tests/integration/prp-pipeline-integration.test.ts \
  tests/integration/prp-create-prompt.test.ts --reporter=dot 2>&1 | tail -3
# EXPECT: "Test Files  3 passed (3)" / "Tests  69 passed (69)".
```

### Level 3: Scope-integrity check (prove you stayed in bounds)

```bash
cd /home/dustin/projects/hacky-hack

# You must NOT have changed production code to satisfy a stale test:
git status --short
# EXPECT: at most the 3 test files (if edited) + the architecture note. src/ MUST be clean.

# Confirm no sibling-owned file was touched:
git diff --name-only HEAD | grep -E "coder-agent|pipeline-main-loop|smart-commit|task-orchestrator|prp-pipeline-shutdown" \
  || echo "GOOD: no sibling-owned test files touched"
```

### Level 4: Final categorization sweep

```bash
# For EVERY failure you observed (if any), confirm it is classified and routed:
#   (c) fixed here  |  (a) → P1.M4.T2  |  (b) → P1.M4.T3  |  real-src-defect → architecture/ flag
# There must be ZERO uncategorized failures across the 3 files.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: each of the 3 files passes individually (fresh pass counts recorded).
- [ ] Level 2: each of the 3 files is green in the full `tests/integration` run (contamination-free).
- [ ] Level 3: `git status` shows at most the 3 test files + architecture note; `src/` clean.
- [ ] Level 4: every observed failure (if any) categorized and routed; zero uncategorized.

### Contract Compliance (from the work item)

- [ ] Line-audit was performed FIRST (run each file, read actual failures + stack traces) — not
      assumed from the doc's stale counts.
- [ ] Each failure categorized test-rot / genuine-test-bug / environmental before editing.
- [ ] Test-logic fixes match the file's EXISTING mocking style (as-isolated-as-possible).
- [ ] NO production code changed to satisfy a stale test (AGENTS.md rules 2/4).
- [ ] Any real src defect was STOPPED-and-flagged in `architecture/`, not masked.
- [ ] Per-file root cause documented (commit message and/or architecture note).

### Scope Boundary

- [ ] Category-(c) genuine test bugs fixed HERE.
- [ ] Category-(a) failures handed to P1.M4.T2 (not fixed here).
- [ ] Category-(b) failures handed to P1.M4.T3 (not fixed here, except a trivial inline literal
      in a file already being edited).
- [ ] `prp-pipeline-shutdown.test.ts` NOT touched (owned by completed P1.M4.T1.S1).

### Documentation

- [ ] Stale 9/6/4 counts in `architecture/bug-004-test-suite.md` retired with a P1.M4.T1.S2
      line-audit note citing the fresh counts and the resolving src commits.

---

## Anti-Patterns to Avoid

- ❌ Don't trust the doc's 9/6/4 counts — they are CONFIRMED STALE. Re-run each file.
- ❌ Don't chase 19 phantom failures — line-audit shows all three green; document, don't invent work.
- ❌ Don't "simplify" a passing `vi.mock` away (e.g. drop the agent-factory or groundswell mock)
      — that re-exposes the suite to Category-(a) "PiHarness not initialized."
- ❌ Don't edit `src/` to make a test pass — that is exactly what AGENTS.md rules 2/4 forbid. A
      red test encoding a real PRD requirement is a defect report, not a fix target.
- ❌ Don't expand scope into the Category-(a)/(b) sibling files (coder-agent, smart-commit,
      task-orchestrator, pipeline-main-loop) — those are P1.M4.T2 / P1.M4.T3.
- ❌ Don't weaken a prompt assertion in `prp-create-prompt.test.ts` to hide prompt drift — if a
      §4.3/§9.x instruction genuinely vanished from the prompt, that is a real src defect → STOP.
- ❌ Don't treat the slow (~24s) `progressive-validation.test.ts` or its expected WARN/USERLVL
      validation-fail log lines as a failure.

---

## Confidence Score

**9/10** for one-pass success. The line-audit is already done in this PRP and shows all three
files green (69/69 individual, 69/69 together, and contamination-free in the full
`tests/integration` run). The overwhelmingly likely executor outcome is "re-verify green →
document the stale-counts root cause → zero code change." The residual 1-point uncertainty is
baseline drift between research and execution time; the PRP carries a full re-diagnosis
playbook (Steps 0–4) with explicit categorization routing so that, IF a file is red at
execution, the executor can still classify and act correctly without re-planning. The hard
guardrail (never edit src/ for a stale test; STOP-and-flag real defects) is stated four ways
so it cannot be missed.