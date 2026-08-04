# PRP — P1.M4.T2.S1: Establish shared harness-init / research-seam mock helper

> Bugfix 002 · **BUG-004 (MAJOR) — Category (a) environmental failures.** Builds the reusable
> test-infra consumed by **P1.M4.T2.S2** (which applies it across the ~9 affected integration
> suites). **This item ships ONLY the helper + its convention doc + a tiny self-test; it does NOT
> touch the 9 suites** (that is S2's contract).
>
> **Contract (verbatim from the work item):** The error `"PiHarness not initialized. Call
> initialize() first."` comes from running the **real Researcher agent** via
> `researchQueue.researchNow` → `PRPGenerator.generate` (`src/agents/prp-generator.ts:688`).
> `ensureHarnessInitialized()` is `src/config/harness.ts:190`. **The Groundswell link is NOT the
> problem.** Create a small shared test helper exposing (a) an `ensureHarnessInitialized()`
> `beforeAll` hook AND/OR (b) a factory for mocking the research seam (`research-queue.js` /
> `prp-generator.js` / `createResearcherAgent`). Document the convention: suites whose SUBJECT is
> NOT the research path should MOCK the seam (isolation); suites that explicitly test research
> integration should call the real harness init. **Decide per-suite in S2.**
>
> **Parallel-coordination note:** P1.M4.T1.S2 (category-c genuine-bug files) is being implemented
> concurrently but edits fully disjoint files (`progressive-validation` / `prp-create-prompt` /
> `prp-pipeline-integration`). This item ONLY adds NEW files under `tests/helpers/` (and one under
> `tests/unit/helpers/`); it modifies no existing test or `src/` file, so there is zero overlap.

---

## Goal

**Feature Goal**: Ship one reusable, well-documented test-infrastructure module that gives every
category-(a) integration suite TWO proven escape hatches from the `"PiHarness not initialized"`
chain — (1) mock the research seam at one of three depths, or (2) initialize the real `pi`
harness singleton — so that P1.M4.T2.S2 can drive the ~9 affected files green by *applying* the
helper rather than re-deriving the seam contract in each file.

**Deliverable** (all NEW files; no edits to existing suites or `src/`):
1. `tests/helpers/research-seam.ts` — the shared helper. Exports:
   - **Pure fixtures** (vitest-free): `createMockPRPDocument(taskId)`, `MOCK_PRP_DOCUMENT`,
     `MINIMAL_PRP_JSON_STRING`, `createSuccessAgentResponse(data?)`.
   - **Path util**: `prpJsonPath(sessionPath, taskId)`.
   - **Wiring helpers** (use `vi`, called in `beforeEach`): `wireMockResearcherAgent(...)`,
     `wireMockPRPGenerator(...)`, `wireMockResearchQueue(...)`.
   - **Real-harness init**: `initRealHarness()`.
   - **Convention documentation** as module-level JSDoc + per-export JSDoc (the per-suite
     decision guide S2 follows).
2. `tests/unit/helpers/research-seam.test.ts` — a SMALL self-test (S1's own validation gate):
   proves the fixtures are schema-valid (`PRPDocumentSchema.safeParse`) and the AgentResponse
   shape is correct, so S2 can trust the helper.
3. (Optional, only if lint requires) a one-line `tests/helpers/.gitkeep` is NOT needed — the dir
   is created by the helper file itself.

**Success Definition**:
- `npm run typecheck && npm run lint && npm run format:check` clean on the new files.
- `npx vitest run tests/unit/helpers/research-seam.test.ts` → green (fixtures validate).
- The helper's JSDoc states the convention unambiguously and lists the per-suite decision for
  each of the 9 category-(a) files (the S2 playbook).
- `git diff --stat` shows ONLY new files under `tests/helpers/` + `tests/unit/helpers/`. **No
  existing suite or `src/` file is modified** (S1 builds; S2 applies).

## User Persona (if applicable)

**Target User**: The implementer of **P1.M4.T2.S2** (and any future maintainer adding an
integration suite that would otherwise trip the harness error). End users are unaffected.

**Use Case**: "I have a `tests/integration/*.test.ts` whose subject is orchestration/commits/
workflows/executors (NOT the research path). It fails with `PiHarness not initialized`. I want to
import one helper, add a self-contained top-level `vi.mock(...)`, call a wiring helper in
`beforeEach`, and have the test isolated from the research seam — without re-reading
`prp-generator.ts` to rediscover the file contract."

**User Journey**:
1. Read the helper's JSDoc → identify the suite's SUBJECT (research path vs not).
2. If NOT research path → copy the class-level `vi.mock('...research-queue.js'|'...prp-generator.js')`
   snippet + call the matching `wireMock*` helper in `beforeEach`.
3. If research path → copy the leaf `vi.mock('...agent-factory.js')` snippet + call
   `wireMockResearcherAgent` (which writes the `.json` file automatically).
4. (Rare) If the suite genuinely wants real-harness plumbing → `beforeAll(initRealHarness)`.

**Pain Points Addressed**: The file-contract gotcha (`generate()` reads `<sessionPath>/prps/<id>.json`,
ignores `result.data`) is a trap that the stale `prp-generator-integration.test.ts` already fell
into; the helper bakes the correct behavior in once so S2 cannot reproduce it.

## Why

- **Unblocks the §4.4 validation gate (BUG-004).** Category (a) is ~9 files / ~81 failures — the
  single largest cluster. S1 is the shared substrate; without it S2 would re-derive the seam
  contract 9 times (and likely re-hit the `.json`-file trap).
- **DRYs two duplicated fixtures.** `createMockPRPDocument` is copy-pasted in
  `prp-generator-integration.test.ts:97-121` and `prp-runtime-integration.test.ts`; the helper
  canonicalizes it.
- **Scope discipline.** Pure test-infra, NEW files only. Fixes a test-setup gap, not a production
  defect (architecture doc: *"None of these are production-runtime defects — the pipeline code is
  in-spec."*). No PRD/feature change.

## What

Create **`tests/helpers/research-seam.ts`** exporting the API in §"Implementation Blueprint" below,
plus **`tests/unit/helpers/research-seam.test.ts`**. The helper provides three mock depths (leaf
`createResearcherAgent`, class `PRPGenerator`, class `ResearchQueue`) AND the real-harness path,
each with a documented copy-paste `vi.mock` snippet. It does NOT modify `tests/setup.ts`
(global harness init would mask real LLM calls and change behavior for all tests — rule-4
territory; the architecture doc's "extend setup.ts" option is explicitly rejected for that reason).

### Success Criteria

- [ ] `tests/helpers/research-seam.ts` exists, exports every symbol in the blueprint, and its
      module-level JSDoc documents the convention + the S2 per-suite playbook for all 9 files.
- [ ] `tests/unit/helpers/research-seam.test.ts` passes: `createMockPRPDocument('P3.M3.T1.S1')`
      passes `PRPDocumentSchema.safeParse`; `createSuccessAgentResponse()` yields a valid
      success-shaped `AgentResponse` (required `metadata.agentId` + `metadata.timestamp`);
      `prpJsonPath('/tmp/s', 'P3.M3.T1.S1')` === `'/tmp/s/prps/P3_M3_T1_S1.json'`.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean on the new files.
- [ ] No existing test file or `src/` file is modified.

## All Needed Context

### Context Completeness Check

If an implementer knew nothing about this codebase, would they have everything needed? **Yes.**
This PRP states the exact failure chain, the file-vs-data contract (with `src` line refs), the
schema the fixture must satisfy, the `vi.mock` hoisting constraint and the pattern that defeats it,
the full ResearchQueue method surface, the per-export API + signatures, the copy-paste `vi.mock`
snippets S2 will use, and the precise validation commands. The companion
`research/findings.md` holds the raw scout evidence.

### Documentation & References

```yaml
# MUST READ — the contract + authoritative category-(a) breakdown
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-004-test-suite.md
  why: Authoritative BUG-004 breakdown; §"Category (a)" names the ~9 files + ~81 failures and
       prescribes exactly this helper ("add a shared beforeAll(ensureHarnessInitialized) OR mock
       the research seam ... Prefer the mock for suites whose subject is NOT the research path;
       prefer real harness for suites that explicitly test research integration").
  section: "Category (a) — Environmental" + "NOTE on interaction with BUG-001/002/003".

# Companion research (full evidence: seam chain, schema, hoisting, 9-file survey, depth matrix)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T2S1/research/findings.md
  why: Per-symbol contracts with exact line refs; the S2 per-suite recommendation table.
  section: §5 (9-file survey) + §6 (depth matrix) + §9 (helper decision).

# The next item's contract — S2 consumes this helper (do NOT implement S2 here)
- (no PRP yet) plan_status: P1.M4.T2.S2 "Apply harness-init / research-seam fix to the ~9 suites" — Planned.
  why: Confirms S1's output is the INPUT to S2; S1 must NOT edit the 9 suites.

# ── SRC under test (READ-ONLY — do NOT modify) ──
- file: src/config/harness.ts
  why: ensureHarnessInitialized() (~:209) + configureHarness() (:124). Idempotent (has('pi') guard);
       neither throws on missing keys (only runAuthPreflight does). No network until agent.prompt().
  pattern: initRealHarness() must call configureHarness() THEN await ensureHarnessInitialized().
  gotcha: Do NOT call runAuthPreflight() from the helper — it throws AuthPreflightError without keys.

- file: src/agents/prp-generator.ts
  why: generate() (~:688) is the contract the helper's leaf mock + file writer must satisfy.
  pattern: generate() reads ONLY r.status (must be !=='error'); then readFile(prpOutputPath)
           (~:728-740); prpOutputPath = join(sessionPath,'prps',`${task.id.replace(/\./g,'_')}.json`)
           (~:650-656); #parsePRPText accepts raw JSON or a ```json fenced block (~:255-270).
  gotcha: generate() IGNORES result.data — a mock agent MUST return status!=='error' AND the
          .json file MUST exist+validate. The `.md` file is a DIFFERENT artifact generate() writes itself.

- file: src/agents/agent-factory.ts
  why: createResearcherAgent() (:386) returns a Groundswell Agent; the leaf mock seam.
  pattern: `export function createResearcherAgent(): Agent { ... return createAgent(config); }`.
           Also exports createCoderAgent/createQAAgent/createArchitectAgent (same shape).

- file: src/core/research-queue.ts
  why: researchNow() (:343) + the public surface the class-level mock must stub.
  pattern: researchNow(task,backlog,feedback?): Promise<PRPDocument> → delegates to prpGenerator.generate.
           TaskOrchestrator calls: enqueue, processNext, getStats, getPRP, waitForPRP, researchNow,
           deletePRP (grep `this.researchQueue\.` in task-orchestrator.ts). getStats()->{queued,researching,cached}.

- file: src/core/models.ts
  why: PRPDocumentSchema (:1599), ValidationGateSchema (:1339), SuccessCriterionSchema (:1444) —
       the gates createMockPRPDocument must pass.
  pattern: import { PRPDocumentSchema } from '../../src/core/models.js' in the self-test.

# ── Existing mock patterns to mirror (READ-ONLY — the template for the wiring helpers) ──
- file: tests/integration/prp-generator-integration.test.ts
  why: the PROVEN leaf pattern: top-level `vi.mock('...agent-factory.js', () => ({ createResearcherAgent: vi.fn() }))`
       then `(createResearcherAgent as any).mockReturnValue({ prompt: vi.fn().mockResolvedValue(...) })` in beforeEach.
       ALSO the createMockPRPDocument fixture (:97-121) to DRY.
  gotcha: its current mock returns a bare PRPDocument and NEVER writes the .json — STALE, will throw
          "Researcher did not write PRP file". Do NOT copy verbatim; the helper must add the file write.

- file: tests/integration/smart-commit.test.ts
  why: the class-mock shape `vi.mock('...prp-runtime.js', () => ({ PRPRuntime: vi.fn().mockImplementation(() => ({...})) }))`
       (:62-78) — the template for wireMockPRPGenerator/wireMockResearchQueue. Also the vi.hoisted logger (:88-94).

- file: tests/integration/pipeline-main-loop.test.ts
  why: the all-four-fns agent-factory stub (:46-53) — the most complete leaf snippet.

# ── vitest mocking references ──
- url: https://vitest.dev/guide/mocking.html
  why: vi.mock hoisting (factory runs before imports; cannot reference ordinary imports) — the
       constraint that forces the helper to supply fixtures+wiring rather than a "call to mock" fn.
  section: "Hoisting" + "vi.doMock".
- url: https://vitest.dev/api/#vi-mocked
  why: vi.mocked() typing for the wiring helpers.

# ── Groundswell AgentResponse shape (the helper's createSuccessAgentResponse) ──
- file: node_modules/groundswell/dist/types/agent.d.ts
  why: AgentResponse<T> (:312) — success variant requires {status:'success',data,error:null,
       metadata:{agentId:string,timestamp:number,...}}.
```

### Current Codebase tree (the NEW files + the READ-ONLY src/seam they mock)

```bash
tests/
  setup.ts                              # NOT edited (global harness init rejected — see Why)
  helpers/                              # NEW dir (created by the helper file)
    research-seam.ts                    # NEW — the shared helper (this item's deliverable)
  unit/
    helpers/                            # NEW dir
      research-seam.test.ts             # NEW — self-test (S1's validation gate)
  integration/                          # NOT touched by S1 (S2's territory)
src/config/harness.ts                   # READ-ONLY — configureHarness + ensureHarnessInitialized
src/agents/prp-generator.ts             # READ-ONLY — generate() file-vs-data contract
src/agents/agent-factory.ts             # READ-ONLY — createResearcherAgent (leaf seam)
src/core/research-queue.ts              # READ-ONLY — researchNow + public surface (class seam)
src/core/models.ts                      # READ-ONLY — PRPDocumentSchema (self-test validates against)
```

### Desired Codebase tree with files to be added

```bash
tests/helpers/research-seam.ts          # NEW — fixtures + wiring helpers + initRealHarness + convention JSDoc
tests/unit/helpers/research-seam.test.ts# NEW — schema/shape/path self-test
# Nothing else. No src/, no existing test, no tests/setup.ts, no package.json change.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — generate() reads the PRP from a FILE, not from result.data (src/agents/prp-generator.ts:728-740).
//   prpOutputPath = join(sessionPath, 'prps', `${task.id.replace(/\./g,'_')}.json`)  // .json, NOT .md
//   A leaf-level createResearcherAgent mock MUST return status!=='error' AND the helper MUST write a
//   schema-valid file there (or generate() throws "Researcher did not write PRP file").
//   ⇒ wireMockResearcherAgent writes the file automatically; class-level mocks bypass it entirely.

// CRITICAL — vi.mock() is HOISTED; the factory CANNOT reference ordinary imports (vitest ^1.6.1).
//   The helper therefore EXPORTS fixtures + wiring helpers; each test file keeps its own top-level
//   self-contained vi.mock(... ) of BARE vi.fn() stubs (the proven repo pattern). The helper NEVER
//   calls vi.mock itself.

// CRITICAL — Groundswell AgentResponse success variant REQUIRES metadata.{agentId,timestamp}
//   (node_modules/groundswell/dist/types/agent.d.ts:312). generate() only reads .status, but other
//   consumers (PRPExecutor.#extractResponseContent) read .data; build the full shape to be safe.

// GOTCHA — configureHarness()/ensureHarnessInitialized() do NOT throw on missing keys and make NO
//   network/LLM call (the throw is in runAuthPreflight, which tests must NOT call). They ARE
//   idempotent (has('pi') guard). initRealHarness() = configureHarness() then await ensureHarnessInitialized().

// GOTCHA — do NOT add initRealHarness to tests/setup.ts globally. It would register the real harness
//   for ALL tests, turning "PiHarness not initialized" (an obvious test-isolation signal) into a
//   silent real-LLM call (or a confusing auth error) — masking the real fix (mock the seam). Opt-in only.

// GOTCHA — the .json file is the agent→disk handoff; PRPGenerator separately writes <id>.md (the
//   downstream coder artifact) via #writePRPFile. They are DIFFERENT files. write the .json for the mock.

// CRITICAL (all) — NEVER weaken an existing suite's assertions, and NEVER modify src/ to make a test
//   pass. S1 only ADDS infra; the seam-mocking is test-only isolation of in-spec production code.
```

## Implementation Blueprint

### Data models and structure

No production data models change. The helper defines/re-exports:
- A canonical `PRPDocument` fixture (`createMockPRPDocument`) — DRYing the duplicated fixture in
  two integration suites.
- A canonical success `AgentResponse` builder (`createSuccessAgentResponse`) matching Groundswell's
  discriminated-union type.
- A path utility (`prpJsonPath`) mirroring `PRPGenerator`'s own computation.
- Vitest wiring helpers (return/call `vi.fn()`/`vi.Mock`).

### Implementation Tasks (ordered by dependencies)

```yaml
# ───────────────────────────────── TASK 1: the helper module ─────────────────────────────────
Task 1: CREATE tests/helpers/research-seam.ts
  - DOC (module-level JSDoc, top of file): state the failure chain
      TaskOrchestrator.executeSubtask → researchQueue.researchNow (src/core/research-queue.ts:343)
      → PRPGenerator.generate (src/agents/prp-generator.ts:688) → createResearcherAgent().prompt()
      (src/agents/agent-factory.ts:386) → real Groundswell → {status:'error','PiHarness not initialized'}.
    Then state the CONVENTION (the S2 playbook):
      • SUBJECT is NOT the research path (orchestration/commits/workflows/executors/traversal)
        → MOCK the seam for isolation. Prefer the CLASS-LEVEL mock (research-queue.js or
        prp-generator.js) to avoid the .json file contract; use the leaf mock only when you want
        generate() to really run.
      • SUBJECT IS the research path (prp-generator / prp-runtime suites) → LEAF mock
        (createResearcherAgent) + wireMockResearcherAgent (auto-writes the .json) so generate()
        runs for real against a stub agent.
      • Rarely (suite genuinely wants real harness plumbing) → beforeAll(initRealHarness).
    Then list the 9 category-(a) files + each one's recommended path (from research/findings.md §5).
  - EXPORT (pure, vitest-free — importable anywhere):
      • createMockPRPDocument(taskId: string): PRPDocument  — schema-valid minimal doc
        (DRY of tests/integration/prp-generator-integration.test.ts:97-121). Fields:
        taskId, objective, context, implementationSteps[], validationGates[] (4 gates, last manual),
        successCriteria[] (2), references[]. MUST pass PRPDocumentSchema.safeParse.
      • MOCK_PRP_DOCUMENT: PRPDocument  — createMockPRPDocument('P3.M3.T1.S1') default.
      • MINIMAL_PRP_JSON_STRING: string  — JSON.stringify(MOCK_PRP_DOCUMENT) (for the file write).
      • createSuccessAgentResponse(data: unknown = MOCK_PRP_DOCUMENT): AgentResponse
        → { status:'success', data, error:null, metadata:{ agentId:'mock-researcher', timestamp:Date.now() } }.
  - EXPORT (path util, mirrors PRPGenerator's own computation):
      • prpJsonPath(sessionPath: string, taskId: string): string
        → join(sessionPath, 'prps', `${taskId.replace(/\./g, '_')}.json`).
  - EXPORT (wiring helpers — use vi, called in beforeEach; each returns the mock for assertions):
      • wireMockResearcherAgent(opts: {
          createResearcherAgent: unknown;          // the imported vi.mocked fn
          sessionPath: string; taskId: string; prpDocument?: PRPDocument;
        }): { prompt: vi.Mock }
        — sets (createResearcherAgent as any).mockReturnValue({ prompt: vi.fn().mockResolvedValue(
          createSuccessAgentResponse(prpDocument ?? createMockPRPDocument(taskId))) });
        AND writes the .json: await mkdir(join(sessionPath,'prps'),{recursive:true}); await
        writeFile(prpJsonPath(sessionPath,taskId), MINIMAL_PRP_JSON_STRING-or-stringify(prpDocument),'utf-8').
        Import { mkdir, writeFile } from 'node:fs/promises', { join } from 'node:path'.
        GOTCHA: write the prpDocument actually passed (or the taskId-derived default), so the parsed
        file matches what generate() validates.
      • wireMockPRPGenerator(opts: { PRPGenerator: unknown; prpDocument?: PRPDocument }): void
        — (PRPGenerator as any).mockImplementation(() => ({
            generate: vi.fn().mockResolvedValue(prpDocument ?? MOCK_PRP_DOCUMENT),
            getCachePath: vi.fn().mockReturnValue(''),  // mirror the real getter shape if read
          })).
        (No file write — generate() is fully bypassed.)
      • wireMockResearchQueue(opts: { ResearchQueue: unknown; prpDocument?: PRPDocument }): void
        — (ResearchQueue as any).mockImplementation(() => {
            const doc = prpDocument ?? MOCK_PRP_DOCUMENT;
            return {
              enqueue: vi.fn().mockResolvedValue(undefined),
              processNext: vi.fn().mockResolvedValue(undefined),
              researchNow: vi.fn().mockResolvedValue(doc),
              waitForPRP: vi.fn().mockResolvedValue(doc),
              getPRP: vi.fn().mockReturnValue(doc),
              deletePRP: vi.fn().mockResolvedValue(undefined),
              getStats: vi.fn().mockReturnValue({ queued:0, researching:0, cached:0 }),
              isResearching: vi.fn().mockReturnValue(false),
              isAbandoned: vi.fn().mockReturnValue(false),
              clearCache: vi.fn(),
              queue: [], researching: new Map(), results: new Map(), abandoned: new Set(),
              maxSize: 3, sessionManager: undefined, depth: 0,
            };
          }).
        (Stubs EVERY method TaskOrchestrator calls — see research/findings.md §7.)
  - EXPORT (real harness — opt-in beforeAll):
      • async initRealHarness(): Promise<void>
        — const { configureHarness, ensureHarnessInitialized } = await import('../../src/config/harness.js');
          configureHarness(); await ensureHarnessInitialized();
        (DYNAMIC import so a suite that mocks harness.js elsewhere isn't fighting a static import.)
  - DOC (each export JSDoc): when to use + the matching top-level vi.mock snippet to copy, e.g.:
      # Leaf (research path — keeps generate() real, file auto-written):
      vi.mock('../../src/agents/agent-factory.js', () => ({ createResearcherAgent: vi.fn() }));
      # then in beforeEach: wireMockResearcherAgent({ createResearcherAgent, sessionPath, taskId });
      # Class — PRPGenerator (bypass generate()):
      vi.mock('../../src/agents/prp-generator.js', () => ({ PRPGenerator: vi.fn() }));
      # then: wireMockPRPGenerator({ PRPGenerator });
      # Class — ResearchQueue (bypass everything, TaskOrchestrator-only):
      vi.mock('../../src/core/research-queue.js', () => ({ ResearchQueue: vi.fn() }));
      # then: wireMockResearchQueue({ ResearchQueue });
      # Real harness (rare, research-integration suites):
      import { initRealHarness } from '../helpers/research-seam';
      beforeAll(initRealHarness);
  - FOLLOW pattern: tests/integration/prp-generator-integration.test.ts:97-164 (fixture + leaf wiring),
      tests/integration/smart-commit.test.ts:62-94 (class-mock shape + vi.hoisted).
  - NAMING: camelCase fns, the vitest primitives via `import { vi } from 'vitest'`.
  - PLACEMENT: tests/helpers/research-seam.ts (supersedes the contract's "harness-init.ts" name —
      it unifies harness-init + research-seam-mock, both required by the contract).

# ───────────────────────────────── TASK 2: the self-test (S1's validation gate) ─────────────────────────────────
Task 2: CREATE tests/unit/helpers/research-seam.test.ts
  - IMPORT: { describe, it, expect } from 'vitest'; { PRPDocumentSchema } from '../../../src/core/models.js';
    { createMockPRPDocument, MOCK_PRP_DOCUMENT, createSuccessAgentResponse, prpJsonPath,
      MINIMAL_PRP_JSON_STRING } from '../../helpers/research-seam';
  - TEST 1 (schema): expect(PRPDocumentSchema.safeParse(createMockPRPDocument('P3.M3.T1.S1')).success).toBe(true);
  - TEST 2 (default constant): expect(PRPDocumentSchema.safeParse(MOCK_PRP_DOCUMENT).success).toBe(true);
  - TEST 3 (AgentResponse shape): const r = createSuccessAgentResponse();
      expect(r.status).toBe('success'); expect(r.error).toBeNull();
      expect(r.metadata).toMatchObject({ agentId: expect.any(String), timestamp: expect.any(Number) });
  - TEST 4 (path util): expect(prpJsonPath('/tmp/s', 'P3.M3.T1.S1')).toBe('/tmp/s/prps/P3_M3_T1_S1.json');
  - TEST 5 (JSON string round-trips through #parsePRPText's JSON.parse path):
      expect(JSON.parse(MINIMAL_PRP_JSON_STRING).taskId).toBe(MOCK_PRP_DOCUMENT.taskId);
  - FOLLOW pattern: any tests/unit/*.test.ts (describe/it/expect, no heavy setup).
  - NAMING: describe('tests/helpers/research-seam', () => { it('createMockPRPDocument satisfies PRPDocumentSchema', ...) }).
  - COVERAGE: the pure fixtures + path util only. Do NOT test the vi wiring helpers here (they need a
      real vi.mock context — that is exercised by S2 applying them to the real suites).
  - PLACEMENT: tests/unit/helpers/research-seam.test.ts.

# ───────────────────────────────── TASK 3: VERIFY (no edit) ─────────────────────────────────
Task 3: VERIFY helper + self-test green + clean static gates + scope guard
  - RUN: npx vitest run tests/unit/helpers/research-seam.test.ts   → 5 passed | 0 failed
  - RUN: npm run typecheck && npm run lint && npm run format:check → clean on new files
  - RUN: git diff --stat   → ONLY tests/helpers/research-seam.ts + tests/unit/helpers/research-seam.test.ts (NEW)
  - RUN: npx vitest run --reporter=dot 2>&1 | tail -n 25
    EXPECT: the new self-test file PASSES; the 9 category-(a) files remain RED (expected — S2 owns them;
    S1 only ships the substrate). The overall failure count should NOT increase (this item adds a passing
    file). If any previously-passing file newly fails, STOP — the helper likely has a static-import side
    effect (re-check that initRealHarness uses a DYNAMIC import and the pure fixtures import nothing from src).
```

### Implementation Patterns & Key Details

```ts
// ── Pure fixture (vitest-free) — DRYs the duplicated createMockPRPDocument ────────────────────
import type { PRPDocument } from '../../src/core/models.js';
export function createMockPRPDocument(taskId: string): PRPDocument {
  return {
    taskId,
    objective: 'Implement PRPGenerator class',
    context: '## Context\nFull implementation context',
    implementationSteps: ['Step 1: Create class', 'Step 2: Add retry logic'],
    validationGates: [
      { level: 1, description: 'Lint', command: 'npm run lint', manual: false },
      { level: 2, description: 'Test', command: 'npm test', manual: false },
      { level: 3, description: 'Integration', command: 'npm run test:integration', manual: false },
      { level: 4, description: 'Manual', command: null, manual: true },
    ],
    successCriteria: [
      { description: 'Tests pass', satisfied: false },
      { description: 'Code complete', satisfied: false },
    ],
    references: ['src/agents/prp-generator.ts'],
  };
}

// ── AgentResponse success shape (full, so all consumers are safe) ────────────────────────────
export function createSuccessAgentResponse(data: unknown = MOCK_PRP_DOCUMENT) {
  return {
    status: 'success' as const,
    data,
    error: null,
    metadata: { agentId: 'mock-researcher', timestamp: Date.now() },
  };
}

// ── Leaf wiring: mock agent + AUTO-WRITE the .json (the trap the stale test fell into) ───────
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function wireMockResearcherAgent(opts: {
  createResearcherAgent: unknown; sessionPath: string; taskId: string; prpDocument?: PRPDocument;
}) {
  const doc = opts.prpDocument ?? createMockPRPDocument(opts.taskId);
  const prompt = vi.fn().mockResolvedValue(createSuccessAgentResponse(doc));
  (opts.createResearcherAgent as any).mockReturnValue({ prompt });
  await mkdir(join(opts.sessionPath, 'prps'), { recursive: true });
  await writeFile(prpJsonPath(opts.sessionPath, opts.taskId), JSON.stringify(doc), 'utf-8');
  return { prompt };
}

// ── Real harness init (opt-in; DYNAMIC import so it never fights a per-suite harness mock) ───
export async function initRealHarness(): Promise<void> {
  const { configureHarness, ensureHarnessInitialized } = await import('../../src/config/harness.js');
  configureHarness();
  await ensureHarnessInitialized();
}
```

### Integration Points

```yaml
DATABASE: none
CONFIG:   none
ROUTES:   none
GIT:      none
# Two NEW test-infra files. They interact with:
#  - vitest's vi (fixtures use vi.fn in the wiring helpers; self-test uses expect).
#  - src/core/models.js (PRPDocumentSchema — READ in the self-test only).
#  - src/config/harness.js (DYNAMICALLY imported by initRealHarness — never statically, so a suite
#    that mocks harness.js elsewhere is unaffected).
#  - node:fs/promises + node:path (wireMockResearcherAgent writes the .json).
# No new package.json deps. No tests/setup.ts change.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After creating each file:
npm run typecheck        # tsc --noEmit -p tsconfig.build.json ; expect clean (no new errors)
npm run lint             # eslint . --ext .ts ; expect clean for the new files
npm run format:check     # prettier --check ; expect clean
# If prettier complains: npx prettier --write tests/helpers/research-seam.ts tests/unit/helpers/research-seam.test.ts
# Expected: Zero errors. Read any output and fix before proceeding.
```

### Level 2: The self-test (primary gate — proves the fixtures are schema-correct)

```bash
# Must be 5 passed | 0 failed:
npx vitest run tests/unit/helpers/research-seam.test.ts
# Expected: "Tests  5 passed (5)", "Test Files  1 passed (1)", exit 0.
# If the schema test fails: createMockPRPDocument does NOT satisfy PRPDocumentSchema — fix the
# fixture (re-read src/core/models.ts ValidationGateSchema/SuccessCriterionSchema field rules),
# do NOT loosen the schema.
```

### Level 3: System Validation (whole-suite delta check — must NOT regress)

```bash
# Confirm the new file is green AND nothing previously-green newly fails:
npx vitest run --reporter=dot 2>&1 | tail -n 30
# Expected:
#   - tests/unit/helpers/research-seam.test.ts is in the PASSED set.
#   - The 9 category-(a) integration files REMAIN red (expected — S2 owns them; S1 only ships the
#     substrate). Do NOT try to fix them here.
#   - Overall failure count does NOT increase vs. the pre-S1 baseline (S1 adds a passing file).
# If a previously-passing file newly fails: the helper has a static-import side effect. Re-check
# that initRealHarness uses `await import(...)` (dynamic) and the pure fixtures import NOTHING from
# src/ at module top-level (only `import type`).
npm run typecheck   # confirm clean (catches stray edits)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Scope guards — prove NO existing suite or src/ file was touched:
git diff --stat -- src/                          # EXPECT: empty
git diff --stat -- 'tests/integration/*'         # EXPECT: empty (S2's territory, not S1)
git diff --stat -- tests/setup.ts                # EXPECT: empty (global init explicitly rejected)
git status --short                               # EXPECT: only the 2 NEW files (untracked)

# Convention-doc guard — the helper documents the S2 playbook for all 9 files:
grep -c "smart-commit\|task-orchestrator\|prp-generator\|prp-runtime\|bug-hunt\|fix-cycle\|prp-executor" tests/helpers/research-seam.ts
# Expected: ≥ several matches (the per-suite playbook is present).

# Real-harness safety guard — initRealHarness uses a DYNAMIC import (never static):
grep -n "await import('../../src/config/harness.js')" tests/helpers/research-seam.ts
# Expected: 1 match inside initRealHarness. A STATIC `import { ... } from '../../src/config/harness.js'`
# at top-level would fight per-suite harness mocks — must NOT exist.
```

## Final Validation Checklist

### Technical Validation

- [ ] `tests/helpers/research-seam.ts` + `tests/unit/helpers/research-seam.test.ts` created (NEW only).
- [ ] `npx vitest run tests/unit/helpers/research-seam.test.ts` → 5 passed | 0 failed.
- [ ] `npx vitest run --reporter=dot`: new file green; no previously-green file newly red; the 9
      category-(a) files remain red (expected, S2-owned).
- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check` clean on new files.
- [ ] `git diff --stat` shows ONLY the 2 new files; `src/`, `tests/integration/`, `tests/setup.ts` untouched.

### Feature Validation

- [ ] Helper exports every symbol in the blueprint (fixtures, path util, 3 wiring helpers, initRealHarness).
- [ ] `createMockPRPDocument` passes `PRPDocumentSchema.safeParse` (proven by the self-test).
- [ ] `wireMockResearcherAgent` writes the `.json` file (the trap the stale test fell into is closed).
- [ ] `wireMockResearchQueue` stubs EVERY method TaskOrchestrator calls (enqueue/processNext/getStats/
      getPRP/waitForPRP/researchNow/deletePRP + the readonly fields + getStats return shape).
- [ ] `initRealHarness` uses a dynamic import and does NOT call `runAuthPreflight` (would throw).
- [ ] Module-level JSDoc states the convention + lists the per-suite recommendation for all 9 files.

### Code Quality Validation

- [ ] Follows repo conventions (2-space indent, single quotes, trailing commas; class-mock shape from
      smart-commit.test.ts; leaf pattern from prp-generator-integration.test.ts).
- [ ] Pure fixtures are vitest-free and import NOTHING from `src/` at module top-level (only `import type`).
- [ ] `initRealHarness` dynamic-imports `harness.js` so it never conflicts with a per-suite harness mock.
- [ ] Anti-patterns avoided (see below).

### Documentation & Deployment

- [ ] Module-level + per-export JSDoc document the failure chain, the convention, the copy-paste
      `vi.mock` snippets, and the 9-file S2 playbook.
- [ ] No new env vars, no package.json change, no tests/setup.ts change.
- [ ] Commit message uses the project's task-prefix format (P1.M3 landed): `P1.M4.T2.S1: <subject>`.
      Do NOT prepend `[PRP Auto]` (forbidden per PRD §5.1 / BUG-003).

---

## Anti-Patterns to Avoid

- ❌ Don't call `vi.mock(...)` from inside the helper — it's hoisted per-file and cannot reference
  imports. The helper EXPORTS fixtures + wiring; each test file owns its top-level self-contained
  `vi.mock` of bare `vi.fn()` stubs (the proven repo pattern).
- ❌ Don't copy `prp-generator-integration.test.ts`'s current leaf mock verbatim — it returns a bare
  `PRPDocument` and never writes the `.json`, so `generate()` throws "did not write PRP file". The
  helper's `wireMockResearcherAgent` writes the file to close that trap.
- ❌ Don't add `initRealHarness` (or any harness init) to `tests/setup.ts` globally — it would mask
  real LLM calls / change behavior for every test (rule-4 territory). Opt-in `beforeAll` only.
- ❌ Don't have the helper STATICALLY import `src/config/harness.js` — a suite that mocks harness.js
  would then fight the static import. Use a dynamic `await import(...)` inside `initRealHarness`.
- ❌ Don't call `runAuthPreflight()` from the helper — it throws `AuthPreflightError` without keys.
  `configureHarness()` + `ensureHarnessInitialized()` are the safe, idempotent pair.
- ❌ Don't write the `.md` file where the `.json` belongs — `generate()` reads `<id>.json`; the `.md`
  is a different artifact PRPGenerator writes itself. `prpJsonPath` enforces `.json`.
- ❌ Don't apply the helper to any of the 9 suites in this item — that is P1.M4.T2.S2's contract.
  S1 ships the substrate + docs only.
- ❌ Don't modify `src/`, `tests/setup.ts`, `package.json`, or any existing test to make the self-test
  pass. If the schema check fails, fix the FIXTURE, never the schema.
- ❌ Don't prepend `[PRP Auto]` to the commit message (forbidden per PRD §5.1 / BUG-003).
- ❌ Don't run the project's pipeline app (`npm run dev`/`pipeline`/`tsx src/index.ts`) — only run the
  targeted vitest file + the whole-suite delta check.

---

## Confidence Score

**9/10** — one-pass success likelihood. This item adds two NEW, self-contained files with no edits
to existing suites or `src/`, so the blast radius is near-zero. Every contract the helper must
satisfy is pinned to exact `src/` line refs (the file-vs-data trap at `prp-generator.ts:728-740`, the
`.json` path at `:650-656`, the schema at `models.ts:1599`, the ResearchQueue surface, the harness
idempotency). The one residual risk — a stale fixture that fails `PRPDocumentSchema` — is closed by
the self-test (Task 2), which is itself the primary validation gate. The vi.mock hoisting
constraint is explicitly designed around (helper exports fixtures+wiring, never calls vi.mock). The
only thing S1 deliberately does NOT do (apply to the 9 suites) is S2's contract, clearly fenced.