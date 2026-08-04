# P1.M4.T3.S3 — Validated Fix Map (5 files, 13 failures)

**Method:** every fix below was prototyped in-place, run green via `npx vitest run`, then
`git checkout`-reverted. `git diff --stat` confirmed EMPTY after each revert. The five files
are DISJOINT from P1.M4.T3.S1 (coder-agent) and P1.M4.T3.S2 (pipeline-main-loop) — no file
overlap. The only production (`src/`) touch in this item is the one-line `enableReflection`
corrective fix in `src/agents/prompts/prp-blueprint-prompt.ts` (rule-5 corrective; see File 4).

## Baseline (pre-item, per-file `npx vitest run`)

| File | Failed | Passed | Skipped |
|---|---|---|---|
| tests/integration/qa-agent.test.ts | 4 | 23 | 3 |
| tests/integration/researcher-agent.test.ts | 2 | 35 | 0 |
| tests/integration/prd-task-command.test.ts | 5 | 3 | 0 |
| tests/integration/prp-blueprint-agent.test.ts | 1 | 10 | 0 |
| tests/integration/task-breakdown-prompt.test.ts | 1 | 38 | 0 |
| **TOTAL** | **13** | | |

## Validated per-file fixes + post-fix result

### File 1 — `tests/integration/qa-agent.test.ts`  → 27 passed | 3 skipped (was 4 fail)
Four failures, three root causes:

1. **Model-role ROT (1 test):** `should create QA agent with GLM-4.7 model` asserts
   `model: 'GLM-4.7'`. Current prod: `createQAAgent` → `createBaseConfig('qa','reasoning')` →
   `getModel('balanced')` → **`'zai/glm-5.2'`** (constants.ts:46,50 + environment.ts:237 +
   agent-factory.ts:454,296,304). **Fix:** literal `'GLM-4.7'` → `'zai/glm-5.2'` (objectContaining,
   all other fields already match).

2. **agent-factory mock ROT (3 tests):** the top-level `vi.mock('../../src/agents/agent-factory.js',
   () => ({ createQAAgent: vi.fn() }))` (line 67) stubs ONLY `createQAAgent`. `FixCycleWorkflow.
   runStandardBreakdown` (fix-cycle-workflow.ts:247) dynamically imports `createArchitectAgent`,
   which the mock does not export → `[vitest] No "createArchitectAgent" export is defined`.
   **Fix:** broaden the factory to spread `importOriginal()` AND add a `createArchitectAgent`
   stub returning `{ prompt: vi.fn().mockResolvedValue({ status:'success', value:'{}' }) }`
   (groundswell's `createAgent` mock returns undefined, so the real architect's `.prompt` would
   throw). Safe: `realFactoryExports` (line 243) is obtained via `vi.importActual`, so the
   `createQAAgent configuration` suite still exercises the real factory.

3. **readFile routing (same 3 fix-cycle tests):** the global `node:fs/promises` `readFile` mock is
   set per-test to `mockResolvedValue(JSON.stringify(initialResults))` (the TestResults bug
   report). `runStandardBreakdown` then reads `${sessionPath}/tasks.json` and `JSON.parse`s it as
   a `Backlog` → gets a TestResults-shaped object → `resolveScope` iterates `backlog.backlog` →
   undefined → throw. **Fix:** change each test's readFile to a `mockImplementation` that returns
   `JSON.stringify({ backlog: [] })` for paths ending in `tasks.json`, else the bug report.
   Validated: the 3 loop-behavior tests then pass (`BugHuntWorkflow.prototype.run` is already
   `vi.spyOn`-mocked per test; the empty Backlog → `executeFixes` no-ops → loop semantics hold).

### File 2 — `tests/integration/researcher-agent.test.ts`  → 37 passed (was 2 fail)
Two failures, two root causes:

1. **Model-role ROT (1 test):** `should create researcher agent with GLM-4.7 model` asserts
   `model: 'GLM-4.7'`. Current prod: `createResearcherAgent` → `createBaseConfig('researcher',
   'research')` → `getModel('balanced')` → **`'zai/glm-5.2'`**. **Fix:** literal → `'zai/glm-5.2'`.

2. **Prompt-text ROT (1 test):** `should instruct to spawn subagents` asserts
   `PRP_BLUEPRINT_PROMPT.toContain('spawn subagents')` + `.toContain('batch tools')`. Neither
   literal exists anymore — the prompt was de-escalated to OPTIONAL subagents (roles refactor).
   The test's own comment admits these were "ASPIRATIONAL." **Fix (re-point to CURRENT literals
   confirmed inside the PRP_BLUEPRINT_PROMPT constant, lines 182-674):**
   `'Subagents are OPTIONAL and may be unavailable'` + `'or built-in subagents if available'`.
   (NOTE: `'Use subagents for parallel work when beneficial'` is in PRP_BUILDER_PROMPT (675+), NOT
   in PRP_BLUEPRINT_PROMPT — do NOT use it.)

### File 3 — `tests/integration/prd-task-command.test.ts`  → 8 passed (was 5 fail)
Five failures, three root causes (all test-only; NO src defect — TaskOrchestrator/PRPGenerator/
scope-resolver are in-spec):

1. **SessionManager mock shape ROT (4 tests):** the `vi.mock` factory returns `currentSession` as a
   STRING PATH. Production reads `currentSession` as a `SessionState` object: TaskOrchestrator
   (task-orchestrator.ts:196) reads `.taskRegistry`; the ResearchQueue it builds constructs a
   PRPGenerator (prp-generator.ts:215) that reads `.metadata.path`. A string → `.taskRegistry`
   undefined → `resolveScope` throws `Cannot read properties of undefined (reading 'backlog')`.
   The per-test `(sessionManager.loadSession as any).mockResolvedValue(...)` is DEAD —
   TaskOrchestrator never calls loadSession. **Fix:** replace the factory's string `currentSession`
   with a full SessionState object via a live getter/setter (`metadata{id,hash,path,createdAt,
   parentSession}`, `prdSnapshot`, `taskRegistry: createTestBacklog()`, `currentItemId:null`);
   DELETE the 3 dead `loadSession` blocks (tests #1/#2/#4 — the factory default already provides a
   valid backlog); for the all-Complete test (#3) override via
   `(sessionManager as any).currentSession = { taskRegistry: backlog }`.

2. **Stale ordering expectation (1 test, #2):** `should return next executable task` asserts the
   first Planned|Researching leaf is `P1.M1.T2.S1` (Researching). The fixture's DFS leaf order is
   S1(Complete)→S2(Planned)→S3(Researching)→S4(Implementing) — confirmed by sibling test #1
   (`tasks[0].id === 'P1.M1.T1.S1'` passes). A plain `.find(t=>Planned||Researching)` therefore
   returns **S2 (Planned = `P1.M1.T1.S2`)**, never S3. The expectation was internally inconsistent
   with the test's own `.find`. **Fix:** re-align to `id:'P1.M1.T1.S2'`, `status:'Planned'`.

3. **existsSync mock never reset (1 test, #5):** `node:fs` mock hard-codes
   `existsSync: vi.fn(() => true)`; `afterEach` `clearAllMocks()` clears call history, not the
   impl. The "non-existent file" test calls `mockExistsSync(path)` and gets `true`. **Fix:** per-test
   `(mockExistsSync as any).mockReturnValue(false)` before the call (do NOT flip the module default
   — the passing file-override/bugfix tests rely on truthy existsSync).

### File 4 — `tests/integration/prp-blueprint-agent.test.ts`  → 11 passed (was 1 fail)
**REAL latent production inconsistency (test is CORRECT).** `expect(prompt.enableReflection).
toBe(true)` fails because `createPRPBlueprintPrompt` (src/agents/prompts/prp-blueprint-prompt.ts:324)
returns `createPrompt({ user, system, responseFormat })` with **NO `enableReflection`**. The
Groundswell `Prompt.enableReflection?` field defaults `undefined`. But the function's OWN JSDoc
(line 255) promises `enableReflection: true`, and ALL FOUR sibling builders set it explicitly
(validation-prompt.ts:112, change-classifier-prompt.ts:183+205, delta-analysis-prompt.ts:147,
bug-hunt-prompt.ts:164). PRP generation is the most complex structured-output task.

**Fix (PRODUCTION — AGENTS.md rule-5 corrective: broken contract, no PRP needed):** add
`enableReflection: true,` to the `createPrompt({...})` call in prp-blueprint-prompt.ts. Validated:
the test passes unchanged (11/11), and `enableReflection:true` is additive — matches all siblings,
no behavior regression (sibling prompt suites + prp-generator-integration green in isolation).
**Also REQUIRED:** record a one-line note in `architecture/bug-004-test-suite.md` flagging the
latent omission that was corrected (honors the work contract's "flag real src defects" directive).
**Fallback (if reviewer insists on test-only scope):** skip the assertion + flag in architecture/
only — but this weakens a correct test and leaves the latent bug; NOT recommended.

### File 5 — `tests/integration/task-breakdown-prompt.test.ts`  → 39 passed (was 1 fail)
**Prompt-text ROT.** `should specify spawning subagents for research` asserts
`TASK_BREAKDOWN_PROMPT.toContain('SPAWN SUBAGENTS')` + `'spawn agents to research the codebase'`.
Neither literal remains, but the capability IS still described in the PROCESS section under new
wording (src/agents/prompts.ts:112-114). **Fix (re-point to verbatim current literals):**
`'**RESEARCH (SPAWN & VALIDATE):**'` + `'**Spawn** subagents to map the codebase and verify PRD
feasibility.'` + `'**Spawn** subagents to find external documentation for new tech.'`

## Whole-suite impact
+13 tests green, -13 failures. No previously-green file newly red (every fix was run in isolation
green; the disjoint files S1/S2 and the rest of the suite are untouched). This item + S1 + S2
together clear category (b) entirely; P1.M4.T4.S1 (full green) then only has category (a)/(c)
stragglers to confirm.

## No real src defects requiring escalation
Only the `enableReflection` omission (File 4), which is a one-line rule-5 corrective fix handled
IN this item (+ architecture note). Everything else is test-only rot. TaskOrchestrator, PRPGenerator,
scope-resolver, createQAAgent, createResearcherAgent, createPRPBlueprintPrompt's prompt TEXT, and
TASK_BREAKDOWN_PROMPT's current wording are all in-spec.