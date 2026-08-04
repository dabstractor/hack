# PRP — P1.M4.T2.S2: Apply harness-init / research-seam fix to the ~9 affected integration suites

> Bugfix 002 · **BUG-004 (MAJOR) — Category (a) environmental failures.** Consumes the shared
> helper shipped by **P1.M4.T2.S1** (`tests/helpers/research-seam.ts`) and APPLIES it across
> the affected integration suites so they no longer fail with `PiHarness not initialized` and
> their non-environmental assertions run.
>
> **⚠️ SCOPE CORRECTION (research refuted the contract's category-(a) label for 3 files).**
> Running all 9 files proves **6 are true category-(a)/file-contract failures** (harness seam)
> and **3 fail for completely different reasons** (verified category b/c test-rot). Crucially,
> the plan shows **P1.M4.T3 does NOT own those 3** (its files are coder-agent, pipeline-main-loop,
> qa-agent, researcher-agent, prd-task-command, prp-blueprint-agent, task-breakdown-prompt), so
> this item is their SOLE owner and MUST fix them with the CORRECT (non-harness) test-only fix.
> Applying the harness seam to the 3 would be wasted effort — their root cause is elsewhere.
>
> **INPUT dependency:** `tests/helpers/research-seam.ts` from P1.M4.T2.S1 (PRP
> `…/P1M4T2S1/PRP.md` is the contract). Assume its exports exist verbatim:
> `createMockPRPDocument`, `MOCK_PRP_DOCUMENT`, `MINIMAL_PRP_JSON_STRING`,
> `createSuccessAgentResponse`, `prpJsonPath`, `wireMockResearcherAgent`,
> `wireMockPRPGenerator`, `wireMockResearchQueue`, `initRealHarness`.
>
> **Parallel-coordination:** `smart-commit.test.ts` is touched by BOTH this item (seam fix) and
> BUG-003 / P1.M3.T2.S1 (task-prefix assertions). **SERIALIZE edits to that file** — apply the
> seam fix, re-run, do NOT clobber the `[PRP Auto]`-removal work. P1.M4.T1.S2 (category-c) edits
> disjoint files — no overlap.

---

## Goal

**Feature Goal**: Drive each of the 9 listed integration suites to green by applying, per-file,
the CORRECT root-cause fix: the S1 research-seam helper for the 6 true category-(a)/file-contract
suites, and the verified minimal test-only fix for the 3 mis-categorized category-(b)/c suites —
so the §4.4 `validate.sh` abort-on-failure gate can finally pass on a green `npm test`.

**Deliverable** (edits to 9 EXISTING test files; NO new files; NO `src/` changes):
- **Group A (harness seam — 6 files):** `smart-commit.test.ts`, `core/task-orchestrator-e2e.test.ts`,
  `core/task-orchestrator-runtime.test.ts`, `prp-generator-integration.test.ts`,
  `prp-runtime-integration.test.ts`, `core/task-orchestrator.test.ts` — each gets a top-level
  `vi.mock` of the seam + a `wireMock*` call in `beforeEach` (or, for the 2 file-contract suites,
  a `readFile` stub + success `AgentResponse`), so the `PiHarness not initialized` /
  `did not write PRP file` chain is broken and non-environmental assertions execute.
- **Group B (non-harness test-rot — 3 files):** `bug-hunt-workflow-integration.test.ts` (wrap QA
  mock returns in `createSuccessAgentResponse`), `fix-cycle-workflow-integration.test.ts` (ctor-signature
  + disk fixtures + possible architect leaf mock), `prp-executor-integration.test.ts` (add
  `withAgentDeadline` to the retry.js mock factory).

**Success Definition**:
- Each of the 9 files: `npx vitest run <file>` → **0 failed**.
- Whole suite: `npx vitest run --reporter=dot` → failure count strictly DECREASES (these 9 files
  contribute ~80 failures today); no previously-green file newly red.
- `npm run typecheck && npm run lint && npm run format:check` clean on the edited files.
- `git diff --stat -- src/` is **EMPTY** (rule 5: test-only corrective; no production change to
  make a test pass).

## User Persona (if applicable)

**Target User**: The pipeline maintainer + the §4.4 validation-gate path. End users unaffected
(this is test-infra / test-rot corrective work).

**Use Case**: "`npm test` is red on ~80 integration failures across 9 files, mostly
`PiHarness not initialized`. The §4.4 validate gate aborts on the red suite even when production
code is correct. Make the suites green by isolating the research seam (or fixing the genuine
test bugs), without weakening any assertion and without touching `src/`."

**User Journey**:
1. Apply Group A (the harness seam) — one `vi.mock` + one `wireMock*` per file.
2. Fix `task-orchestrator.test.ts`'s 3 mixed failure modes (seam + context_scope fixtures + queue-count).
3. Apply Group B (3 non-harness test-only fixes).
4. Re-run the whole suite; failure count drops; static gates green.

**Pain Points Addressed**: The largest red cluster blocking BUG-004's "suite green" goal; the
file-contract trap (`generate()` reads a `.json` the stale leaf mock never wrote); and the
3 mis-labeled files whose real bugs (stale mock shape, ctor rot, missing mock export) were hidden
behind a category-(a) assumption.

## Why

- **Unblocks the §4.4 validate gate (BUG-004).** Category (a) is the single largest red cluster
  (~80 failures / 9 files). The architecture doc is explicit: *"None of these are production-runtime
  defects — the pipeline code is in-spec."* → all fixes are test-only isolation/correction.
- **Reuses S1's substrate instead of re-deriving the seam 9 times.** S1 already canonicalized the
  fixtures, the `AgentResponse` shape, the `prpJsonPath`, the 3 wiring helpers, and the
  per-suite playbook. This item APPLIES it.
- **Scope discipline.** Rule 5 explicitly permits corrective test fixes (test-isolation, stale
  mocks, ctor-rot) without a PRP. No `src/`, no PRD/feature change. The 3 non-harness files are
  owned here (P1.M4.T3 does not cover them) — leaving them red would fail this item's OUTPUT.

## What

Apply, per-file, ONE of these proven fixes (decision keyed to the verified root cause — see
`research/findings.md` §1 table):

| Fix | Applies to | Mechanism |
|-----|-----------|-----------|
| **PRPGenerator class mock** (`wireMockPRPGenerator`) | smart-commit, e2e, runtime, task-orchestrator | top-level `vi.mock('.../prp-generator.js', () => ({ PRPGenerator: vi.fn() }))` + `wireMockPRPGenerator({ PRPGenerator })` in `beforeEach`. Breaks `researchNow→generate→agent`; no file contract. |
| **Leaf mock + readFile stub** (keep `generate()` real) | prp-generator-integration, prp-runtime-integration | extend the existing `node:fs/promises` mock to stub `readFile`→`MINIMAL_PRP_JSON_STRING` for prps paths; make the leaf `createResearcherAgent` mock return `createSuccessAgentResponse(...)`. (The existing fs mock intercepts `writeFile` → do NOT rely on `wireMockResearcherAgent`'s real file write.) |
| **Mixed (3 causes)** | task-orchestrator | the class mock above (PiHarness tests) + fix context_scope fixtures (CONTRACT DEFINITION format) + line-audit queue-count expectations. |
| **QA mock shape** | bug-hunt | wrap `prompt()` returns in `createSuccessAgentResponse(data)` (NOT a seam mock). |
| **ctor-signature + disk fixtures** | fix-cycle | pass a `bugfix` sessionPath string; create `TEST_RESULTS.md`+`tasks.json`; mock architect if reached. |
| **retry.js mock export** | prp-executor | add `withAgentDeadline: vi.fn(async p => p)` to the existing `vi.mock('.../retry.js')` factory. |

### Success Criteria

- [ ] All 9 files pass `npx vitest run <file>` (0 failed each).
- [ ] No file fails with `PiHarness not initialized` or `Researcher did not write PRP file`.
- [ ] `task-orchestrator.test.ts`: PiHarness tests, context_scope tests, AND queue-count tests all green.
- [ ] Whole-suite failure count strictly decreases; no previously-green file newly red.
- [ ] `git diff --stat -- src/` empty; `npm run typecheck && npm run lint && npm run format:check` clean.

## All Needed Context

### Context Completeness Check

If an implementer knew nothing about this codebase, would they have everything needed? **Yes.**
This PRP states the verified failure string for EACH of the 9 files, the exact `src:line` that
throws, the exact test line that triggers it, the precise seam/mock to add, the per-file
`beforeEach` line number, the `node:fs/promises`-intercepts-write gotcha, the 3-way mixed
classification for `task-orchestrator.test.ts`, and the per-file validation command. The S1 PRP
is the contract for the helper's exact exports/signatures.

### Documentation & References

```yaml
# MUST READ — the input contract (the helper this item consumes)
- file: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T2S1/PRP.md
  why: Defines every export/signature of tests/helpers/research-seam.ts verbatim. THIS item imports
       from that helper; assume it exists as specified.
  pattern: wireMockPRPGenerator({PRPGenerator, prpDocument?}); wireMockResearchQueue({ResearchQueue});
           wireMockResearcherAgent({createResearcherAgent,sessionPath,taskId,prpDocument?});
           createSuccessAgentResponse(data?); MOCK_PRP_DOCUMENT; MINIMAL_PRP_JSON_STRING; prpJsonPath.

# MUST READ — this item's own research (verified per-file root causes + insertion points)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T2S2/research/findings.md
  why: §1 the 6-vs-3 scope correction; §2 per-suite seam choice; §2.3 the fs-mock gotcha;
       §3 the 3-way mixed task-orchestrator breakdown; §4 the 3 non-harness fixes with src:line;
       §5 the per-file vi.mock/beforeEach insertion table.
  section: all sections are load-bearing.

# MUST READ — the authoritative BUG-004 category map
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-004-test-suite.md
  why: Category (a) prescribes exactly this approach ("mock the research seam ... Prefer the mock
       for suites whose subject is NOT the research path"). Confirms none are production defects.
  section: "Category (a) — Environmental" + "NOTE on interaction with BUG-001/002/003".

# ── SRC under test (READ-ONLY — do NOT modify) ──
- file: src/agents/prp-generator.ts
  why: generate() (~:688) reads ONLY r.status then readFile(prpOutputPath) (~:728-740);
       prpOutputPath = join(sessionPath,'prps',`${task.id.replace(/\./g,'_')}.json`). Ignores result.data.
  gotcha: For the 2 file-contract suites, generate() must stay REAL; the file contract is satisfied
          by stubbing readFile (NOT writeFile — the existing fs mock intercepts writeFile).
- file: src/core/research-queue.ts
  why: researchNow() (:350) delegates to prpGenerator.generate. Mocking the PRPGenerator class
       breaks the chain here while keeping ResearchQueue real.
- file: src/core/task-orchestrator.ts
  why: processNextItem (:1394) → executeSubtask (:913) → researchNow — the chain that throws.
       buildExecutionQueue + setScope are what the queue-count line-audit must re-read.
- file: src/core/models.ts
  why: ContextScopeSchema superRefine (:116) requires 'CONTRACT DEFINITION:\n' prefix — the cause
       of the task-orchestrator.test.ts fixture failures.
- file: src/workflows/bug-hunt-workflow.ts
  why: :310 legacy branch expects AgentResponse{status,data}; :353 rewraps to ground-truth string.
- file: src/workflows/fix-cycle-workflow.ts
  why: :130-131 ctor guard (sessionPath string); #loadBugReport (~:575) reads TEST_RESULTS.md from disk;
       runStandardBreakdown (~:233-240) may invoke real createArchitectAgent.
- file: src/utils/retry.ts
  why: :713 withAgentDeadline STILL EXISTS (NOT removed) — prp-executor's mock factory just omits it.
- file: src/agents/agent-factory.ts
  why: createResearcherAgent/createCoderAgent/createQAAgent/createArchitectAgent — leaf seams.

# ── Existing mock patterns to mirror (READ-ONLY templates) ──
- file: tests/integration/smart-commit.test.ts
  why: :62-78 the proven CLASS-mock shape (PRPRuntime) that wireMockPRPGenerator mirrors; :79-84 the
       CONTRACT DEFINITION context_scope shape to copy into task-orchestrator fixtures.
- file: tests/integration/prp-generator-integration.test.ts
  why: :29-49 the fs mock with prps short-circuit (the gotcha); :148-150 the stale leaf mock to fix.
- file: tests/integration/prp-executor-integration.test.ts
  why: :32-47 the retry.js mock factory that must gain withAgentDeadline.

# ── vitest mocking references ──
- url: https://vitest.dev/guide/mocking.html
  why: vi.mock is hoisted → each file keeps its OWN top-level self-contained vi.mock of bare vi.fn()
       stubs; the helper supplies fixtures+wiring (it never calls vi.mock itself).
```

### Current Codebase tree (the 9 files this item edits + the READ-ONLY helper/src)

```bash
tests/helpers/research-seam.ts                 # INPUT (from S1) — NOT edited here
tests/integration/
  smart-commit.test.ts                         # EDIT (Group A: seam)
  core/task-orchestrator-e2e.test.ts           # EDIT (Group A: seam)
  core/task-orchestrator-runtime.test.ts       # EDIT (Group A: seam)
  prp-generator-integration.test.ts            # EDIT (Group A: file-contract)
  prp-runtime-integration.test.ts              # EDIT (Group A: file-contract)
  core/task-orchestrator.test.ts               # EDIT (Group A: MIXED — seam+fixtures+counts)
  bug-hunt-workflow-integration.test.ts        # EDIT (Group B: QA mock shape)
  fix-cycle-workflow-integration.test.ts       # EDIT (Group B: ctor sig + disk + maybe architect)
  prp-executor-integration.test.ts             # EDIT (Group B: retry.js mock export)
src/                                           # READ-ONLY (rule 5: test-only corrective)
```

### Desired Codebase tree with files to be added

```bash
# NO new files. This item EDITS the 9 existing test files only.
# research notes already live at:
#   plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T2S2/research/findings.md
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — generate() reads the PRP from a FILE, not result.data (src/agents/prp-generator.ts:728-740).
//   prpOutputPath = join(sessionPath,'prps',`${task.id.replace(/\./g,'_')}.json`). It reads ONLY
//   result.status (must be !=='error'); result.data is ignored.
// ⇒ For the 2 file-contract suites, satisfy this by stubbing readFile (see next gotcha), NOT writeFile.

// CRITICAL — prp-generator-integration & prp-runtime-integration MOCK node:fs/promises with a prps
//   short-circuit that NO-OPs writeFile/mkdir for paths containing 'prps' (and leaves readFile REAL).
//   ⇒ wireMockResearcherAgent's REAL file write is INTERCEPTED (no-op'd) → do NOT rely on it here.
//   ⇒ Instead EXTEND that fs mock to also stub readFile → MINIMAL_PRP_JSON_STRING for prps paths,
//     and make the leaf createResearcherAgent mock return createSuccessAgentResponse(...).

// CRITICAL — vi.mock() is HOISTED; the factory CANNOT reference ordinary imports. Each test file
//   keeps its OWN top-level self-contained vi.mock of bare vi.fn() stubs (the proven repo pattern).
//   The helper only supplies fixtures + wireMock* helpers (called in beforeEach), never vi.mock.

// CRITICAL — Groundswell AgentResponse success variant REQUIRES {status:'success',data,error:null,
//   metadata:{agentId,timestamp}}. createSuccessAgentResponse (helper) builds this exactly. The
//   bug-hunt QA mock currently returns a BARE object → "QA agent failed: Unknown error".

// CRITICAL — context_scope (src/core/models.ts:116 superRefine) MUST start with
//   'CONTRACT DEFINITION:\n'. Short values like 'Test'/'Test scope' FAIL schema →
//   "Failed to write tasks.json". Use the smart-commit createMockSubtask (:79-84) shape.

// CRITICAL — fix-cycle ctor's FIRST param is now sessionPath: string (was initialResults object).
//   validateBugfixSession requires the literal substring 'bugfix' in the path.
//   #loadBugReport reads TEST_RESULTS.md from sessionPath at run time. May need a real bugfix dir.

// GOTCHA — smart-commit.test.ts is shared with BUG-003 (P1.M3.T2.S1 task-prefix assertions).
//   SERIALIZE: apply the seam fix, re-run, do not revert the [PRP Auto]-removal / task-prefix work.

// CRITICAL (all) — NEVER weaken an existing assertion, and NEVER modify src/ to make a test pass.
//   If a suite can only pass via a production change, STOP — that is out of scope (rule 5 is test-only).
```

## Implementation Blueprint

### Data models and structure

No production data models change. Each edit either (a) adds a top-level `vi.mock` of a seam +
a `wireMock*` call, (b) extends an existing fs/retry mock factory, or (c) corrects a stale mock
return shape / fixture value. All fixtures come from the S1 helper.

### Implementation Tasks (ordered by dependencies)

> **Order:** Group A (the 4 seam-only files) → the 2 file-contract files → the mixed
> task-orchestrator file → Group B (the 3 non-harness files). Re-run the whole suite after each
> cluster so failure counts stabilize and regressions surface immediately.

```yaml
# ═══════════════════════ GROUP A — PRPGenerator class mock (seam, 4 files) ═══════════════════════
Task 1: EDIT tests/integration/smart-commit.test.ts
  - ADD (top-level, near the existing vi.mock block ~line 62-90):
      vi.mock('../../src/agents/prp-generator.js', () => ({ PRPGenerator: vi.fn() }));
  - ADD import: import { wireMockPRPGenerator } from '../helpers/research-seam.js';
  - ADD in beforeEach (~line 225): wireMockPRPGenerator({ PRPGenerator });
    (PRPGenerator is the mocked class — import it: import { PRPGenerator } from '../../src/agents/prp-generator.js';
     cast with vi.mocked(PRPGenerator) or pass the vi.fn directly.)
  - KEEP: existing prp-runtime/git-commit/git-mcp/logger mocks + ALL assertions.
  - COORDINATE: do NOT revert BUG-003's [PRP Auto] removal / task-prefix work (serial edit).
  - WHY: smart-commit's subject is commits; the orchestrator is a vehicle → mock the seam at the
    class level (no file contract). Alternative: wireMockResearchQueue (deeper isolation).
  - VERIFY: npx vitest run tests/integration/smart-commit.test.ts → 0 failed.

Task 2: EDIT tests/integration/core/task-orchestrator-e2e.test.ts
  - ADD top-level: vi.mock('../../../src/agents/prp-generator.js', () => ({ PRPGenerator: vi.fn() }));
    (note the deeper relative path — file is in tests/integration/core/).
  - ADD import + wireMockPRPGenerator({ PRPGenerator }) in beforeEach (~line 261).
  - KEEP: existing prp-runtime(53)/git-commit(72) mocks + assertions.
  - VERIFY: npx vitest run tests/integration/core/task-orchestrator-e2e.test.ts → 0 failed.

Task 3: EDIT tests/integration/core/task-orchestrator-runtime.test.ts
  - ADD top-level: vi.mock('../../../src/agents/prp-generator.js', () => ({ PRPGenerator: vi.fn() }));
  - ADD import + wireMockPRPGenerator({ PRPGenerator }) in beforeEach (~line 205).
  - KEEP: existing prp-runtime(51)/git-commit(70) mocks + assertions.
  - NOTE: this suite BORDERLINES on ResearchQueue integration — PRPGenerator class mock keeps
    ResearchQueue real (preferred over stubbing ResearchQueue, which would erase the subject).
  - VERIFY: npx vitest run tests/integration/core/task-orchestrator-runtime.test.ts → 0 failed.

# ═══════════════════════ GROUP A — file-contract (leaf mock + readFile stub, 2 files) ═══════════════════════
Task 4: EDIT tests/integration/prp-generator-integration.test.ts
  - IMPORT from helper: { createSuccessAgentResponse, createMockPRPDocument, MINIMAL_PRP_JSON_STRING }.
  - EXTEND the existing vi.mock('node:fs/promises', …) factory (~line 29) to ALSO stub readFile:
      readFile: vi.fn(async (path: string, ...rest: unknown[]) => {
        if (typeof path === 'string' && path.includes('prps')) return MINIMAL_PRP_JSON_STRING;
        return actualFs.readFile(path, ...(rest as [unknown]));
      }),
    (the existing ...actualFs spread already supplies a real readFile; OVERRIDE it for prps paths so
     generate()'s readFile succeeds without a real file. KEEP the existing mkdir/writeFile behavior.)
  - FIX the stale leaf mock in beforeEach (~line 148-150): replace
      prompt: vi.fn().mockResolvedValue(createMockPRPDocument('P3.M3.T1.S1'))
    with
      prompt: vi.fn().mockResolvedValue(createSuccessAgentResponse(createMockPRPDocument('P3.M3.T1.S1')))
    (generate() reads result.status, NOT the bare doc — the bare doc has status===undefined → would throw.)
  - KEEP: generate() REAL (this suite's subject IS PRPGenerator.generate). KEEP all assertions.
  - DO NOT: rely on wireMockResearcherAgent's file write (intercepted by this fs mock).
  - VERIFY: npx vitest run tests/integration/prp-generator-integration.test.ts → 0 failed.

Task 5: EDIT tests/integration/prp-runtime-integration.test.ts
  - SAME shape as Task 4 (it has the identical fs mock ~line 28 + a stale researcher leaf mock ~line 177 region):
      + extend fs mock readFile → MINIMAL_PRP_JSON_STRING for prps paths;
      + make the createResearcherAgent leaf mock return createSuccessAgentResponse(createMockPRPDocument(<the suite's taskId>)).
    (Confirm the exact taskId the suite uses — findings saw 'P3.M3.T1.S3'; use createMockPRPDocument with that id,
     or whatever id the test's backlog fixture declares, so taskId round-trips through #parsePRPText.)
  - KEEP: existing agent-factory(153)/prp-executor(164) mocks + assertions; PRPRuntime real.
  - VERIFY: npx vitest run tests/integration/prp-runtime-integration.test.ts → 0 failed.

# ═══════════════════════ GROUP A — MIXED task-orchestrator (3 independent causes) ═══════════════════════
Task 6: EDIT tests/integration/core/task-orchestrator.test.ts  (do (c)→(a)→(b) in order)
  6a. FIX context_scope fixtures (cause c) — replace EVERY short context_scope value at lines
      ~76, 86, 96, 124, 161, 313, 430, 439, 547, 556, 774 with a valid minimal contract string:
        'CONTRACT DEFINITION:\n1. INPUT: none\n2. LOGIC: none\n3. OUTPUT: none'
      (copy the proven shape from tests/integration/smart-commit.test.ts:79-84). This clears
      "Failed to write tasks.json … context_scope must start with CONTRACT DEFINITION:".
  6b. ADD the seam (cause a) — the file currently has ZERO vi.mock. Add top-level:
        vi.mock('../../../src/agents/prp-generator.js', () => ({ PRPGenerator: vi.fn() }));
      + import { wireMockPRPGenerator } + wireMockPRPGenerator({ PRPGenerator }) in the top-level
        beforeEach (line 228). This clears the PiHarness failures at test sites 273/349/387/810.
  6c. LINE-AUDIT queue-count (cause b) — 3 tests (~lines 673, 705, 740) assert queue.length and get
      MORE items than expected (e.g. "expected 5 to be 4"). Re-read src/core/task-orchestrator.ts
      buildExecutionQueue + setScope to see what is now enqueued (subtasks? scope filter?), then
      UPDATE THE 3 EXPECTATIONS to match current correct behavior. Do NOT change src/ to match.
  - VERIFY: npx vitest run tests/integration/core/task-orchestrator.test.ts → 0 failed (all 3 causes clear).

# ═══════════════════════ GROUP B — non-harness test-rot (3 files) ═══════════════════════
Task 7: EDIT tests/integration/bug-hunt-workflow-integration.test.ts
  - IMPORT: { createSuccessAgentResponse } from '../helpers/research-seam.js'.
  - At EVERY success-path QA mock site (~87, 119, 145, 197, 219, 246, 294, 357, 386, 419, 447) and the
    beforeEach default (~line 68), wrap the resolved value:
      prompt: vi.fn().mockResolvedValue(createSuccessAgentResponse(expectedResults))
    (was: .mockResolvedValue(expectedResults) — a bare TestResults with no .status →
     src/workflows/bug-hunt-workflow.ts:310 throws "QA agent failed: Unknown error".)
  - LEAVE: the error-path tests (they already reject intentionally).
  - NOT a seam mock — the real QA agent is already mocked; this is purely the response-envelope shape.
  - VERIFY: npx vitest run tests/integration/bug-hunt-workflow-integration.test.ts → 0 failed.

Task 8: EDIT tests/integration/fix-cycle-workflow-integration.test.ts  (HIGHER EFFORT — incrementally)
  - 8a. FIX ctor-signature rot: at all 10 `new FixCycleWorkflow(...)` sites (167, 222, 289, 353, 414,
        459, 512, 562, 604, 639) the FIRST arg is currently a TestResults OBJECT; the ctor now wants
        sessionPath: string (src/workflows/fix-cycle-workflow.ts:130-131). Pass a valid path containing
        'bugfix', e.g. const sessionPath = join(tempDir,'plan','001_test','bugfix','001_test').
  - 8b. CREATE on-disk fixtures the ctor/run now needs: a bugfix session dir containing TEST_RESULTS.md
        (the bug report #loadBugReport reads at fix-cycle-workflow.ts:~575) + tasks.json, OR refactor the
        test to inject the report if the ctor/run allows. validateBugfixSession requires 'bugfix' substring.
  - 8c. IF runStandardBreakdown (fix-cycle-workflow.ts:~233-240) invokes the REAL createArchitectAgent:
        add a top-level vi.mock('.../agent-factory.js', () => ({ createArchitectAgent: vi.fn() })) +
        wire an architect mock (leaf pattern) so no real agent/harness runs.
  - RE-RUN after each sub-step; fix the NEXT failure that surfaces. If a step requires a PRODUCTION
    change to pass, STOP and document (rule 5 is test-only) — flag for a follow-up rather than editing src/.
  - VERIFY: npx vitest run tests/integration/fix-cycle-workflow-integration.test.ts → 0 failed (or
            document why it can't be fully green test-only + what remains).

Task 9: EDIT tests/integration/prp-executor-integration.test.ts
  - In the existing vi.mock('../../src/utils/retry.js', …) factory (lines 32-47) ADD the missing export:
      withAgentDeadline: vi.fn(async (p: Promise<unknown>) => p),
    (the real fn is Promise.race vs a deadline — an identity pass-through preserves the agent's resolved
     value for the existing retryAgentPrompt wrapper. withAgentDeadline STILL EXISTS at retry.ts:713;
     the mock factory simply omitted it → "[vitest] No 'withAgentDeadline' export".)
  - KEEP: existing retryAgentPrompt wrapper + agent-factory(17)/prompts(26)/checkpoint-manager(54) mocks.
  - VERIFY: npx vitest run tests/integration/prp-executor-integration.test.ts → 0 failed.

# ═══════════════════════ VERIFY (whole-suite delta + static gates + scope guard) ═══════════════════════
Task 10: VERIFY
  - RUN per-file: npx vitest run <each of the 9 files> → 0 failed each.
  - RUN whole suite: npx vitest run --reporter=dot 2>&1 | tail -n 30 → failure count STRICTLY DECREASES;
    no previously-green file newly red.
  - RUN: npm run typecheck && npm run lint && npm run format:check → clean on edited files.
  - RUN: git diff --stat -- src/ → EMPTY (rule 5 test-only).
```

### Implementation Patterns & Key Details

```ts
// ── Pattern A: PRPGenerator class mock (Tasks 1,2,3,6b) — the primary seam ────────────────────
// top-level (self-contained; hoisted):
vi.mock('../../src/agents/prp-generator.js', () => ({ PRPGenerator: vi.fn() }));
// (use '../../../src/...' for files in tests/integration/core/)
import { PRPGenerator } from '../../src/agents/prp-generator.js';
import { wireMockPRPGenerator } from '../helpers/research-seam.js';
// in beforeEach:
wireMockPRPGenerator({ PRPGenerator: vi.mocked(PRPGenerator) });
// → ResearchQueue.researchNow calls the mock generate() → returns MOCK_PRP_DOCUMENT.
//   No real agent, no file read, no PiHarness.

// ── Pattern B: file-contract (Tasks 4,5) — keep generate() REAL, stub readFile ────────────────
// extend the EXISTING vi.mock('node:fs/promises', …) factory:
readFile: vi.fn(async (path: string, ...rest: unknown[]) => {
  if (typeof path === 'string' && path.includes('prps')) return MINIMAL_PRP_JSON_STRING;
  return actualFs.readFile(path, ...(rest as [unknown]));
}),
// + fix the leaf mock to return an AgentResponse (generate() reads .status):
(createResearcherAgent as any).mockReturnValue({
  prompt: vi.fn().mockResolvedValue(createSuccessAgentResponse(createMockPRPDocument(taskId))),
});

// ── Pattern C: QA mock envelope (Task 7) ───────────────────────────────────────────────────────
mockCreateQAAgent.mockReturnValue({
  prompt: vi.fn().mockResolvedValue(createSuccessAgentResponse(expectedResults)), // was: expectedResults
});

// ── Pattern D: missing-export mock (Task 9) ────────────────────────────────────────────────────
vi.mock('../../src/utils/retry.js', () => ({
  retryAgentPrompt: vi.fn(async (fn, _ctx) => { const r = await fn(); return typeof r === 'string' ? { status:'success', data:r, error:null } : r; }),
  withAgentDeadline: vi.fn(async (p) => p),   // ← ADD (was missing)
  retry: vi.fn(), /* …existing stubs… */
}));
```

### Integration Points

```yaml
DATABASE: none
CONFIG:   none
ROUTES:   none
GIT:      none
# Edits are confined to the 9 test files under tests/integration/. They consume:
#  - tests/helpers/research-seam.ts (INPUT from S1) — wireMockPRPGenerator, createSuccessAgentResponse,
#    createMockPRPDocument, MINIMAL_PRP_JSON_STRING.
#  - vitest's vi (top-level vi.mock per file; vi.mocked for typed wiring).
# No package.json change. No tests/setup.ts change. No src/ change.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing each file (or cluster):
npm run typecheck        # tsc --noEmit ; expect no NEW errors on edited files
npm run lint             # eslint ; expect clean for edited files
npm run format:check     # prettier --check ; if it complains: npx prettier --write <file>
# Expected: Zero errors. Read any output and fix before proceeding.
```

### Level 2: Per-file unit/integration tests (primary gate — each file must be green)

```bash
# Run after EACH task; the file must be 0 failed before moving on:
for f in tests/integration/smart-commit.test.ts \
         tests/integration/core/task-orchestrator-e2e.test.ts \
         tests/integration/core/task-orchestrator-runtime.test.ts \
         tests/integration/prp-generator-integration.test.ts \
         tests/integration/prp-runtime-integration.test.ts \
         tests/integration/core/task-orchestrator.test.ts \
         tests/integration/bug-hunt-workflow-integration.test.ts \
         tests/integration/fix-cycle-workflow-integration.test.ts \
         tests/integration/prp-executor-integration.test.ts ; do
  echo "=== $f ===";
  npx vitest run "$f" --reporter=dot 2>&1 | tail -n 8;
done
# Expected: each file "Tests  N passed (N)", "Test Files  1 passed (1)", exit 0.
# If a file still fails with "PiHarness not initialized" → the seam mock isn't wired (recheck the
#   vi.mock path + that wireMock* runs in the SAME beforeEach that constructs the orchestrator).
# If a file-contract file fails with "did not write PRP file" → readFile stub isn't matching the prps
#   path, or the leaf mock still returns a bare doc (recheck createSuccessAgentResponse wrapping).
```

### Level 3: Whole-suite delta (must NOT regress)

```bash
# After each cluster (Group A → mixed → Group B) and at the end:
npx vitest run --reporter=dot 2>&1 | tail -n 30
# Expected:
#   - Failure count STRICTLY DECREASES vs the pre-item baseline (~80 failures across these 9 files).
#   - No previously-green file newly red. If one regresses, the most likely cause is a vi.mock that
#     leaked across files in the same fork — confirm each vi.mock target path is file-local.
#   - The other category-(b)/(c) files NOT in this item's 9 (coder-agent, pipeline-main-loop, qa-agent,
#     researcher-agent, prd-task-command, prp-blueprint-agent, task-breakdown-prompt, prp-pipeline-*)
#     may STILL be red — those are P1.M4.T1/P1.M4.T3 territory. Do not fix them here.
npm run typecheck   # confirm clean
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Scope guard — prove NO src/ file was touched (rule 5 test-only corrective):
git diff --stat -- src/                          # EXPECT: empty
git status --short -- src/                       # EXPECT: empty

# Helper-consumption guard — the edited files import from the S1 helper:
grep -rl "helpers/research-seam" tests/integration/smart-commit.test.ts \
  tests/integration/core/task-orchestrator-e2e.test.ts \
  tests/integration/core/task-orchestrator-runtime.test.ts \
  tests/integration/prp-generator-integration.test.ts \
  tests/integration/prp-runtime-integration.test.ts \
  tests/integration/core/task-orchestrator.test.ts \
  tests/integration/bug-hunt-workflow-integration.test.ts
# Expected: the 7 files that use the helper are listed (fix-cycle may not need it; prp-executor doesn't).

# smart-commit coordination guard — BUG-003's [PRP Auto] removal must still be intact:
grep -c "\[PRP Auto\]" tests/integration/smart-commit.test.ts   # EXPECT: 0 (banner stays removed)
grep -c "task-prefix\|PRP_COMMIT_FORMAT\|formatCommitMessage" tests/integration/smart-commit.test.ts  # EXPECT: >0

# task-orchestrator mixed-fix guard — context_scope fixtures now valid:
grep -c 'CONTRACT DEFINITION:' tests/integration/core/task-orchestrator.test.ts  # EXPECT: matches the ~11 fixture sites
```

## Final Validation Checklist

### Technical Validation

- [ ] All 9 files pass `npx vitest run <file>` (0 failed each).
- [ ] No file fails with `PiHarness not initialized` or `Researcher did not write PRP file`.
- [ ] Whole-suite failure count strictly decreases; no previously-green file newly red.
- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check` clean on edited files.

### Feature Validation

- [ ] **Group A (seam):** smart-commit, e2e, runtime green via `wireMockPRPGenerator`.
- [ ] **Group A (file-contract):** prp-generator-integration, prp-runtime-integration green via
      readFile stub + `createSuccessAgentResponse` (generate() stays real).
- [ ] **task-orchestrator.test.ts:** all 3 mixed causes clear (seam + CONTRACT DEFINITION fixtures + queue-count).
- [ ] **bug-hunt:** green via `createSuccessAgentResponse` wrapping (no seam mock).
- [ ] **fix-cycle:** green, OR documented why it can't be fully green test-only + what remains.
- [ ] **prp-executor:** green via `withAgentDeadline` added to the retry.js mock factory.
- [ ] No assertion weakened; no test deleted to force green.

### Code Quality Validation

- [ ] Each vi.mock is top-level + self-contained (bare vi.fn() stubs) — repo convention.
- [ ] File-contract suites keep `generate()` real (their subject IS the research path).
- [ ] Non-research suites mock at the class level (no file contract) — preserves isolation.
- [ ] `git diff --stat -- src/` empty (rule 5).

### Documentation & Deployment

- [ ] Commit message uses the project's task-prefix format (P1.M3 landed): `P1.M4.T2.S2: <subject>`.
      Do NOT prepend `[PRP Auto]` (forbidden per PRD §5.1 / BUG-003).
- [ ] smart-commit edit does not collide with BUG-003's task-prefix work (serialized).

---

## Anti-Patterns to Avoid

- ❌ Don't apply the harness/seam fix blindly to bug-hunt / fix-cycle / prp-executor — research proves
  they are category (b)/(c) test-rot, NOT category (a). Their real fixes are a mock-shape wrap, a
  ctor-signature + disk-fixture fix, and a missing mock export respectively.
- ❌ Don't use `wireMockResearcherAgent`'s real-file write in prp-generator-integration /
  prp-runtime-integration — the existing `node:fs/promises` mock intercepts `writeFile` for prps paths.
  Stub `readFile` → `MINIMAL_PRP_JSON_STRING` there instead.
- ❌ Don't make the leaf `createResearcherAgent` mock return a BARE `PRPDocument` — `generate()` reads
  `result.status`; wrap in `createSuccessAgentResponse(...)`.
- ❌ Don't change production code (`src/`) to make a test pass — rule 5 is test-only corrective. If a
  suite (esp. fix-cycle) can only pass via a production change, STOP and document.
- ❌ Don't weaken or delete an assertion to force green. Fix the root cause.
- ❌ Don't fix files outside this item's 9 (coder-agent, pipeline-main-loop, qa-agent, etc. are
  P1.M4.T1/P1.M4.T3 territory).
- ❌ Don't revert BUG-003's `[PRP Auto]` removal / task-prefix work in smart-commit.test.ts — serialize.
- ❌ Don't add a global `initRealHarness` to `tests/setup.ts` (S1 explicitly rejected this; it masks
  real LLM calls for all tests). Opt-in `beforeAll` only, and only for suites that genuinely want real
  harness plumbing (none of these 9 need it — the seam mock is preferred per the architecture doc).
- ❌ Don't copy the STALE leaf mock from prp-generator-integration verbatim — it returns a bare doc and
  never satisfies the file contract. Use the helper's `createSuccessAgentResponse` + readFile stub.
- ❌ Don't prepend `[PRP Auto]` to the commit message (forbidden per PRD §5.1 / BUG-003).
- ❌ Don't run the pipeline app (`npm run dev`/`tsx src/index.ts`) — only run vitest.

---

## Confidence Score

**8.5/10** — one-pass success likelihood. Every failure string is from a real run; every `src:line`
is verified; the 6-vs-3 split is proven by execution + a scout deep-dive with exact citations. The
seam fix (Group A) is mechanical and the S1 helper already canonicalizes the fixtures/wiring. The
mixed `task-orchestrator.test.ts` is fully decomposed (3 independent causes, each with its fix). The
one residual risk is **fix-cycle** (substantially rotted ctor + on-disk read + possible real-architect
seam) — flagged higher-effort with a STOP-and-document fallback if it needs production changes. The
3 non-harness fixes are small and surgical. Blast radius is contained to 9 test files; `src/` is
fenced off by an explicit scope guard.