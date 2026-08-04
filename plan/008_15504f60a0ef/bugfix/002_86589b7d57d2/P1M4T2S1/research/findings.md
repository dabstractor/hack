# P1.M4.T2.S1 Research — Shared harness-init / research-seam mock helper

Source of truth for the PRP. Two parallel `scout` runs + targeted `src/` reads.
Scope = BUG-004 **Category (a)** ("PiHarness not initialized", ~9 integration files).

---

## 1. The failure chain (why the error happens)

`TaskOrchestrator.executeSubtask` → `researchQueue.researchNow`
(`src/core/research-queue.ts:343`) → `PRPGenerator.generate`
(`src/agents/prp-generator.ts:688`) → `this.#researcherAgent.prompt()`
(`createResearcherAgent` from `src/agents/agent-factory.ts:386`) → real
Groundswell `Agent` → harness wraps the uninitialized state into
`{ status:'error', error:'PiHarness not initialized' }` → `generate()` throws
`AgentError('Researcher agent failed: ...')`.

- `ensureHarnessInitialized()` is `src/config/harness.ts:~209`. It registers +
  initializes the `pi` harness singleton (idempotent, `has('pi')` guard). It does
  **no** network/LLM work itself — but once it's run, a *real* `agent.prompt()`
  WILL make a real LLM call (needs keys + network). So it is NOT a blanket fix
  for unit-style suites; it's the "real integration" path.
- Groundswell `AgentResponse` (`node_modules/groundswell/dist/types/agent.d.ts:312`):
  `{status:'success',data,error:null,metadata:{agentId,timestamp}}`
  | `{status:'error',data:null,error:{code,message,recoverable},metadata}`
  | `{status:'partial',...}`. `metadata.agentId` + `metadata.timestamp` are required.

## 2. THE critical contract — generate() reads the PRP from a FILE, not from result.data

`PRPGenerator.generate()` ignores `result.data`. After the agent call it does:
1. `if (r.status === 'error') throw AgentError(...)` — **only `status` is read**.
2. `prpJsonText = await readFile(prpOutputPath, 'utf-8')` — ENOENT ⇒ throws
   `AgentError('Researcher did not write PRP file at <path>')`.
3. `this.#parsePRPText(prpJsonText)` (accepts raw JSON **or** a ```json fenced block)
   ⇒ `PRPDocumentSchema.safeParse` must succeed, else throws.

`prpOutputPath = join(sessionPath, 'prps', `${sanitizedId}.json`)` where
`sanitizedId = task.id.replace(/\./g,'_')` and
`sessionPath = sessionManager.currentSession.metadata.path`.
**NOTE the `.json` extension** (NOT `.md` — the `.md` is the downstream artifact
PRPGenerator itself writes via `#writePRPToFile`).

⇒ A **leaf-level** mock (`createResearcherAgent`) that returns a mock agent MUST
**also place a schema-valid `<sessionPath>/prps/<id>.json` file** (or mock
`fs/promises.readFile`), or `generate()` throws "did not write PRP file".

## 3. The PRP file contract (schema-valid minimal doc)

`PRPDocumentSchema` (`src/core/models.ts:1599`):
`{ taskId:string≥1, objective:string≥1, context:string≥1,
implementationSteps:string[], validationGates:ValidationGate[],
successCriteria:SuccessCriterion[], references:string[] }`.

- `ValidationGateSchema` (`:1339`): `level: number|string`,
  `description?: string`, `command: string|null`, `manual?: boolean` (transformed).
- `SuccessCriterionSchema` (`:1444`): `description: string≥1`, `satisfied: boolean` (default false).

Existing (duplicated) fixture to DRY: `createMockPRPDocument` in
`tests/integration/prp-generator-integration.test.ts:97-121` AND
`tests/integration/prp-runtime-integration.test.ts`. This is the canonical
schema-valid doc.

## 4. vi.mock hoisting reality (constrains helper shape)

vitest `^1.6.1` (package.json). `vi.mock(path, factory)` is HOISTED above static
imports; the factory runs before any module resolves and **cannot reference
ordinary imports** (only `vi` + `vi.hoisted` values). ⇒ A shared helper **cannot**
be a "call this fn to mock" that invokes `vi.mock` at call time.

**Proven repo pattern** (prp-generator-integration.test.ts:122-164): keep the
`vi.mock` factory **self-contained** with BARE `vi.fn()` stubs; wire the
*implementation* later in `beforeEach` via `(fn as any).mockReturnValue(...)`
using IMPORTED fixtures. This is exactly what the helper enables:
- helper supplies **pure fixtures** + **wiring helpers** (importable, called in
  `beforeEach`) + the **real-harness init**;
- each test file keeps a **top-level self-contained `vi.mock`** (3-4 lines).

## 5. The 9 affected files — classification (scout survey)

The mock seam that prevents the error is **`agent-factory.js`**
(`createResearcherAgent`/`createCoderAgent`/`createQAAgent`/`createArchitectAgent`),
NOT `prp-runtime.js` (mocking PRPRuntime only blocks the EXECUTION path, not the
RESEARCH path `researchNow→generate`). NONE of the 9 call
`ensureHarnessInitialized`/`configureHarness`.

| # | File | mocks prp-runtime? | mocks agent-factory (which fn)? | SUBJECT | S2 recommendation |
|---|------|---|---|---|---|
| 1 | smart-commit | YES | NO | smart-commit (NOT research) | mock seam (research-queue or prp-generator class — bypass file contract) |
| 2 | core/task-orchestrator-e2e | YES | NO | E2E orchestration (NOT research) | mock seam (class-level) |
| 3 | core/task-orchestrator-runtime | YES | NO | ResearchQueue integration (BORDERLINE) | mock seam (class-level) — touches researchQueue |
| 4 | prp-generator-integration | NO | YES (researcher) | **RESEARCH path** | leaf mock + **fix the file contract** (current mock is STALE — bare PRPDocument, no file) |
| 5 | prp-runtime-integration | NO (real PRPRuntime) | YES (researcher+coder) | **RESEARCH path** | leaf mock + file contract (keep generate() real) |
| 6 | bug-hunt-workflow-integration | NO | YES (QA) | QA workflow (NOT research) | diagnose (mock may be incomplete) |
| 7 | fix-cycle-workflow-integration | NO | NO (mocks bug-hunt-workflow + fake orchestrator) | fix-cycle (NOT research) | diagnose — already isolated, may not be category (a) |
| 8 | prp-executor-integration | NO | YES (coder, preserves actual) | executor (NOT research) | diagnose |
| 9 | core/task-orchestrator | NO (zero mocks) | NO | traversal/executionQueue (NOT research) | mock seam (highest risk: drives processNextItem→real research) |

**STALE-PATTERN RISK (scout flag):** `prp-generator-integration.test.ts` (#4) mocks
`createResearcherAgent` returning a bare `PRPDocument` and never writes the
`.json`; against current `generate()` this throws *"Researcher did not write PRP
file"*, NOT "PiHarness not initialized" — so #4 may be mis-categorized as (a).
The helper MUST handle the file contract so #4's real error is fixed too. **Do
NOT copy #4's current mock verbatim.**

## 6. Depth-of-mock decision matrix (helper must support all three)

| vi.mock target | Real code kept | Must provide | File-contract? |
|---|---|---|---|
| `agent-factory.js` → `createResearcherAgent` (LEAF) | PRPGenerator+ResearchQueue+TaskOrchestrator | mock agent `{prompt}` with `status!=='error'` | **YES — must write `<sessionPath>/prps/<id>.json`** |
| `prp-generator.js` → `PRPGenerator` class | ResearchQueue+TaskOrchestrator | `{generate: vi.fn().mockResolvedValue(prpDoc)}` | none |
| `research-queue.js` → `ResearchQueue` class | TaskOrchestrator only | stub ALL methods TaskOrchestrator calls (see §7) | none |

No existing test mocks `prp-generator.js`/`research-queue.js` classes today; the
work item contract explicitly names them as part of the seam to mock.

## 7. ResearchQueue public surface (for the class-level mock)

Methods TaskOrchestrator calls (grep `this.researchQueue\.`):
`enqueue`, `processNext`, `getStats`, `getPRP`, `waitForPRP`, `researchNow`,
`deletePRP`. Plus readonly fields read directly: `queue`, `researching`,
`results`, `abandoned`, `maxSize`, `sessionManager`, and getter `depth`.
`getStats()` returns `{queued:number, researching:number, cached:number}`.
`waitForPRP(taskId): Promise<PRPDocument>`. `researchNow(task,backlog,feedback?):
Promise<PRPDocument>`.

## 8. Real-harness path (idempotent, safe)

`configureHarness()` (`src/config/harness.ts:124`) + `ensureHarnessInitialized()`
(`:~209`): both guard `HarnessRegistry.has('pi')` before registering; neither
throws on missing keys (the throw lives in `runAuthPreflight`, which tests do
NOT call). Safe to call repeatedly across suites in one fork. No network until
`agent.prompt()`. ⇒ export `initRealHarness()` (= `configureHarness()` then
`await ensureHarnessInitialized()`) as an OPT-IN `beforeAll` for research-
integration suites; do NOT add it to global `tests/setup.ts` (would mask real
LLM calls / change behavior for all tests — rule-4 territory).

## 9. Decision: helper shape

Single file `tests/helpers/research-seam.ts` (supersedes the contract's
suggested `harness-init.ts` name — it unifies BOTH required capabilities:
harness-init + research-seam mock). Exports:
- **Pure fixtures** (vitest-free): `createMockPRPDocument(taskId)`,
  `MOCK_PRP_DOCUMENT`, `MINIMAL_PRP_JSON_STRING`, `createSuccessAgentResponse(data?)`.
- **Path util**: `prpJsonPath(sessionPath, taskId)`.
- **Wiring helpers** (use `vi`, called in `beforeEach`):
  `wireMockResearcherAgent({createResearcherAgent, sessionPath, taskId, prpDocument?})`
  (mock + writes the `.json`), `wireMockPRPGenerator({PRPGenerator, prpDocument?})`,
  `wireMockResearchQueue({ResearchQueue, prpDocument?})`.
- **Real harness**: `initRealHarness()` (+ document `beforeAll(initRealHarness)`).
- **Convention doc** as extensive JSDoc + a module-level block: non-research-path
  suites mock the seam (prefer class-level to dodge the file contract);
  research-path suites use the leaf mock + file contract (or real harness).

Each test file still owns its top-level self-contained `vi.mock(...)` (3-4 bare
`vi.fn()` stubs) per repo convention; the helper supplies fixtures + wiring.

Optional small self-test `tests/unit/helpers/research-seam.test.ts`: verify
`createMockPRPDocument` passes `PRPDocumentSchema.safeParse` and
`createSuccessAgentResponse` has the required `metadata` fields — this is S1's
own validation gate that the fixtures are schema-correct before S2 consumes them.