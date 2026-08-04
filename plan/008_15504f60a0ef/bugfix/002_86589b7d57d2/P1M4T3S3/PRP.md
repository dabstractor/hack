# PRP — P1.M4.T3.S3: Fix remaining category-(b) rot files (qa-agent, researcher-agent, prd-task-command, prp-blueprint-agent, task-breakdown-prompt)

> Bugfix 002 · **BUG-004 (MAJOR) — Category (b) test-rot.** Five `tests/integration` files are red:
> **13 failed | 109 passed** total. Root causes are model-role ROT (`GLM-4.7` → `zai/glm-5.2` after the
> P2.M2 roles refactor), prompt-text ROT (subagent instructions de-escalated to OPTIONAL in the roles
> refactor), stale mock shapes (`SessionState` is an object, not a path string), one internally-
> inconsistent ordering assertion, and ONE real latent production inconsistency (`createPRPBlueprintPrompt`
> omits `enableReflection` its own JSDoc + 4 siblings all set). **12 of the 13 are test-only corrective
> (rule 5).** The 13th is a one-line rule-5 production corrective (`enableReflection: true`) + an
> architecture note.

> **Parallel-coordination:** DISJOINT from P1.M4.T3.S1 (coder-agent) and P1.M4.T3.S2 (pipeline-main-loop)
> — no file overlap. Does NOT consume `tests/helpers/research-seam.ts`.

> **Empirically validated:** every fix below was prototyped in-place, run green via `npx vitest run`,
> then `git checkout`-reverted. Post-fix results (all measured): qa-agent **27 pass|3 skip**, researcher
> **37/37**, prd-task-command **8/8**, prp-blueprint-agent **11/11**, task-breakdown-prompt **39/39**.
> See `research/findings.md`.

---

## Goal

**Feature Goal**: Drive all five category-(b) rot files to green (0 failed each; 13 failures → 0) by
aligning stale test expectations/mocks with the CURRENT production contract, plus one rule-5
production corrective (`enableReflection: true` in `createPRPBlueprintPrompt`).

**Deliverable** (12 test-only edits across 4 files + 1 one-line `src/` corrective + 1 architecture note):
- **EDIT** `tests/integration/qa-agent.test.ts` — broaden agent-factory `vi.mock` (spread `importOriginal`
  + `createArchitectAgent` stub) · route `readFile` by path in the 3 fix-cycle tests · model literal
  `'GLM-4.7'` → `'zai/glm-5.2'`.
- **EDIT** `tests/integration/researcher-agent.test.ts` — model literal `'GLM-4.7'` → `'zai/glm-5.2'` ·
  re-point 2 stale prompt assertions to current PRP_BLUEPRINT_PROMPT literals.
- **EDIT** `tests/integration/prd-task-command.test.ts` — replace string `currentSession` mock with a
  full `SessionState` object · delete 3 dead `loadSession` blocks · override `taskRegistry` in the
  all-Complete test · re-align the internally-inconsistent ordering assertion · per-test
  `existsSync` override.
- **EDIT** `tests/integration/task-breakdown-prompt.test.ts` — re-point 2 stale assertions to current
  TASK_BREAKDOWN_PROMPT PROCESS-section literals.
- **EDIT (PRODUCTION, rule-5 corrective)** `src/agents/prompts/prp-blueprint-prompt.ts` — add
  `enableReflection: true,` to the `createPRPBlueprintPrompt` return (matches its own JSDoc + 4 siblings).
- **EDIT** `architecture/bug-004-test-suite.md` — one-line note flagging the `enableReflection`
  omission that was corrected (honors the work contract's "flag real src defects" directive).

**Success Definition**:
- Each of the 5 files: `npx vitest run <file>` → **0 failed**.
- Whole-suite failure count strictly decreases by 13; no previously-green file newly red.
- `npm run typecheck && npm run lint && npm run format:check` clean on every touched file.
- `git diff --stat -- src/` shows ONLY `src/agents/prompts/prp-blueprint-prompt.ts` (the one rule-5
  corrective); every other change is under `tests/integration/` (+ the architecture note).

## User Persona (if applicable)

**Target User**: The pipeline/test maintainer + the §4.4 validation-gate path. End users unaffected.

**Use Case**: "Five category-(b) integration files are red (13 failures) from model/prompt/mock rot
after the roles refactor. Drive them green — fix tests to match current production, and fix the ONE
real production omission (`enableReflection`) as rule-5 corrective. Do NOT weaken correct assertions."

**User Journey**:
1. qa-agent: broaden the agent-factory mock + stub the architect + route readFile + fix the model literal.
2. researcher-agent: fix the model literal + re-point the 2 prompt assertions.
3. prd-task-command: make `currentSession` a real `SessionState` + remove dead setup + re-align ordering
   + per-test existsSync.
4. prp-blueprint-agent: add the one-line production `enableReflection: true` + architecture note.
5. task-breakdown-prompt: re-point the 2 prompt assertions.
6. Run all 5 files green → run the whole suite → confirm -13 failures.

**Pain Points Addressed**: 13 of the suite-wide failures; the §4.4 validate gate moves closer to green.

## Why

- **Unblocks the §4.4 validate gate (BUG-004).** These 5 files are 13 failures.
- **Corrective, not feature work.** Rule 5 explicitly permits fixing stale-test expectations and
  test-isolation rot without a PRP. No PRD/feature change; no new behavior — except the one-line
  `enableReflection` corrective, which RESTORES an intended contract (rule 5: "broken contracts ...
  behavior that contradicts an existing requirement").
- **Re-aligns, doesn't weaken.** Every re-pointed assertion is replaced with an equivalent-or-stronger
  assertion on the REAL current-contract text/behavior. The one production touch makes a CORRECT test
  pass without weakening it.

## What

| File | Fails | Root cause | Fix | Scope |
|---|---|---|---|---|
| qa-agent.test.ts | 4 | model literal `'GLM-4.7'`; agent-factory mock stubs only `createQAAgent` (breaks `FixCycleWorkflow`'s dynamic `createArchitectAgent` import); `readFile` returns bug-report JSON for `tasks.json` reads | literal → `zai/glm-5.2`; broaden mock (spread `importOriginal` + `createArchitectAgent` stub); route `readFile` by path | test-only |
| researcher-agent.test.ts | 2 | model literal `'GLM-4.7'`; 2 prompt literals gone (`'spawn subagents'`, `'batch tools'`) | literal → `zai/glm-5.2`; re-point to current PRP_BLUEPRINT_PROMPT literals | test-only |
| prd-task-command.test.ts | 5 | `currentSession` mock is a string path (prod reads a `SessionState` object: `.taskRegistry` + `.metadata.path`); dead `loadSession` setup; internally-inconsistent ordering expectation; `existsSync` mock never reset | full `SessionState` mock; delete dead blocks; re-align ordering; per-test existsSync | test-only |
| prp-blueprint-agent.test.ts | 1 | `createPRPBlueprintPrompt` omits `enableReflection` (its own JSDoc + 4 siblings set it) | add `enableReflection: true` to the builder (rule-5 corrective) + architecture note | **1-line src** + note |
| task-breakdown-prompt.test.ts | 1 | 2 prompt literals gone (`'SPAWN SUBAGENTS'`, `'spawn agents to research the codebase'`); capability still present under new wording | re-point to current TASK_BREAKDOWN_PROMPT PROCESS-section literals | test-only |

### Success Criteria

- [ ] All 5 files pass 0 failed (qa-agent 30 incl. 3 pre-existing skips; researcher 37; prd-task-command 8; prp-blueprint 11; task-breakdown 39).
- [ ] No assertion weakened or deleted to force green (re-pointed assertions assert the current real
      text/behavior; the `enableReflection` test stays `toBe(true)`).
- [ ] `git diff --stat -- src/` shows ONLY `src/agents/prompts/prp-blueprint-prompt.ts`.
- [ ] Whole-suite failure count strictly decreases by 13; no previously-green file newly red.

## All Needed Context

### Context Completeness Check

If an implementer knew nothing about this codebase, would they have everything needed? **Yes.** This
PRP states the verified 13-failure baseline, the current model contract with exact `src:line` citations,
the per-file per-test fixes with EXACT OLD→NEW strings (all empirically validated), and the per-file
validation command.

### Documentation & References

```yaml
# MUST READ — this item's own research (validated per-file fix map + empirical results)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T3S3/research/findings.md
  why: §"Validated per-file fixes + post-fix result" — every fix prototyped green + reverted; exact
       literals/anchors quoted; the enableReflection production decision + fallback documented.
  section: all sections load-bearing.

# MUST READ — the authoritative BUG-004 category map (names this item's root causes)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-004-test-suite.md
  why: Category (b) entries for the 5 files — confirms "likely model/prompt-text rot" and rule 5 applies.
  section: "Category (b) — Test-rot".

# ── SRC (READ-ONLY except prp-blueprint-prompt.ts which gets the 1-line enableReflection fix) ──
- file: src/config/constants.ts
  why: MODEL_NAMES = { high:'glm-5.2', balanced:'glm-5.2', fast:'glm-5-turbo' } (:44-50);
       DEFAULT_MODEL_PROVIDER='zai' (:159) → getModel() qualifies to 'zai/glm-5.2' etc.
- file: src/config/environment.ts
  why: getModel(tier) (:237) returns the provider-QUALIFIED string: getModel('balanced')==='zai/glm-5.2'.
- file: src/agents/agent-factory.ts
  why: ROLE_CONFIG (:248-256) research→balanced, reasoning→balanced+xhigh, implementation→fast.
       createBaseConfig (:296) → getModel(tier). createQAAgent (:454)→('qa','reasoning')→'zai/glm-5.2'.
       createResearcherAgent (:387)→('researcher','research')→'zai/glm-5.2'. createArchitectAgent (:355).
  gotcha: enableReflection:true is hardcoded in createBaseConfig (:326) — but that is the AGENT config,
          not the PROMPT object (prp-blueprint-prompt.ts builds a Prompt separately and omits it).
- file: src/agents/prompts/prp-blueprint-prompt.ts   # EDIT (1 line: +enableReflection:true)
  why: createPRPBlueprintPrompt return (:324-340) — the ONLY builder omitting enableReflection;
       its JSDoc (:255) + 4 siblings (validation:112, change-classifier:183+205, delta-analysis:147,
       bug-hunt:164) all set it.
- file: src/agents/prompts.ts
  why: TASK_BREAKDOWN_PROMPT (:47) PROCESS section (:112-114) — the current subagent-spawn literals.
       PRP_BLUEPRINT_PROMPT (:182-674) — the current OPTIONAL-subagent framing (:239 + :61,:65,:73).
  gotcha: 'Use subagents for parallel work when beneficial' (:717) is in PRP_BUILDER_PROMPT (:675+),
          NOT in PRP_BLUEPRINT_PROMPT — do not use it as an anchor for researcher-agent.test.ts.
- file: src/core/task-orchestrator.ts
  why: constructor (:193-220) reads currentSession.taskRegistry (:196) → resolveScope (#buildQueue :199);
       then `new ResearchQueue(...)` (:205) → builds a PRPGenerator that reads currentSession.metadata.path.
- file: src/core/session-manager.ts
  why: `get currentSession(): SessionState | null` (:313) — an OBJECT, not a path string.
- file: src/agents/prp-generator.ts
  why: constructor (:215) reads `currentSession.metadata.path` — the field the prd-task-command mock lacked.
- file: src/core/models.ts
  why: SessionState { metadata: SessionMetadata{id,hash,path,createdAt,parentSession}, prdSnapshot,
       taskRegistry: Backlog, currentItemId } — the shape the prd-task-command mock must provide.
- file: src/workflows/fix-cycle-workflow.ts
  why: runStandardBreakdown (:247) dynamically imports createArchitectAgent (the import the qa-agent mock
       broke) and (:288) reads `${sessionPath}/tasks.json` as a Backlog (the readFile-routing reason).

# ── Tests under edit (READ + EDIT) ──
- file: tests/integration/qa-agent.test.ts
  why: agent-factory vi.mock (:67), node:fs/promises vi.mock (:82), realFactoryExports via importActual
       (:243), model assertion (:275), 3 fix-cycle tests (:791,:843,:895).
- file: tests/integration/researcher-agent.test.ts
  why: model assertion (:281), 'should instruct to spawn subagents' (:442-445).
- file: tests/integration/prd-task-command.test.ts
  why: SessionManager vi.mock factory (:78-98), node:fs existsSync=>true (:51), createTestBacklog (:207),
       4 TypeError tests (:312,:337,:368,:389), existsSync test (:498-503).
- file: tests/integration/task-breakdown-prompt.test.ts
  why: 'should specify spawning subagents for research' (:93-100).
- file: tests/integration/prp-blueprint-agent.test.ts
  why: enableReflection assertion (:100) — passes unchanged once the production fix lands.

# ── vitest mocking reference ──
- url: https://vitest.dev/guide/mocking.html#factory
  why: vi.mock factory with importOriginal (the qa-agent broadened-mock pattern) + per-test mockReturnValue.
- url: https://vitest.dev/guide/mocking.html#hoisting
  why: vi.mock is hoisted to file top — the broadened factory must stay at module scope.

# ── Architecture note target ──
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-004-test-suite.md
  why: append a one-line note under File 4's area that the enableReflection omission was corrected.
```

### Current Codebase tree (the files this item touches)

```bash
tests/integration/
  qa-agent.test.ts                       # EDIT (mock factory + readFile routing + model literal)
  researcher-agent.test.ts               # EDIT (model literal + 2 prompt re-points)
  prd-task-command.test.ts               # EDIT (SessionState mock + dead-block removal + ordering + existsSync)
  prp-blueprint-agent.test.ts            # (no edit — passes once the src fix lands)
  task-breakdown-prompt.test.ts          # EDIT (2 prompt re-points)
src/agents/prompts/
  prp-blueprint-prompt.ts                # EDIT (1 line: +enableReflection:true) — rule-5 corrective
architecture/ (plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/)
  bug-004-test-suite.md                  # EDIT (1-line note flagging the enableReflection correction)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — model strings are PROVIDER-QUALIFIED. Production emits 'zai/glm-5.2' (with the 'zai/'
//   prefix), NOT bare 'glm-5.2'. The new literal MUST include 'zai/' or the test stays red.
//   Source: getModel('balanced') (environment.ts:237) qualifies via DEFAULT_MODEL_PROVIDER='zai'.

// CRITICAL — QA and Researcher are BOTH balanced tier but DIFFERENT roles. QA = 'reasoning' role
//   (thinking:'xhigh'); Researcher = 'research' role (thinking OMITTED/undefined). Both → 'zai/glm-5.2'.
//   Neither failing model test asserts on `thinking`, so no thinking edit is needed. Do not "fix" a
//   missing thinking — it is correct per ROLE_CONFIG.

// CRITICAL (qa-agent) — the broadened agent-factory mock MUST also stub createArchitectAgent. With
//   just importOriginal() spread, createArchitectAgent is the REAL fn → calls groundswell's mocked
//   createAgent which returns undefined → architectAgent.prompt throws. Provide a stub returning
//   { prompt: vi.fn().mockResolvedValue({ status:'success', value:'{}' }) }.

// CRITICAL (qa-agent) — readFile MUST be routed by path in the 3 fix-cycle tests. The global
//   node:fs/promises readFile mock returns the bug-report JSON for ALL reads; runStandardBreakdown
//   reads tasks.json and JSON.parses it as a Backlog. Return JSON.stringify({ backlog: [] }) for
//   paths ending in 'tasks.json', else the bug report.

// CRITICAL (qa-agent) — realFactoryExports (line 243) is fetched via vi.importActual, so broadening
//   the top-level vi.mock does NOT affect the 'createQAAgent configuration' suite (it still exercises
//   the real factory). Safe.

// CRITICAL (prd-task-command) — currentSession is a SessionState OBJECT, not a string path.
//   TaskOrchestrator reads .taskRegistry; ResearchQueue→PRPGenerator reads .metadata.path. The mock
//   must provide BOTH. Use a live getter/setter so tests can override taskRegistry per-test.

// CRITICAL (prd-task-command) — the (sessionManager.loadSession as any).mockResolvedValue(...) blocks
//   are DEAD (TaskOrchestrator never calls loadSession). Delete them; do not "fix" them.

// CRITICAL (prd-task-command test #2) — DFS leaf order is S1→S2→S3→S4 (confirmed by sibling test #1
//   passing: tasks[0].id==='P1.M1.T1.S1'). .find(Planned||Researching) returns S2 (Planned), NOT S3.
//   The old expectation (S3 Researching) was internally inconsistent with the test's own .find.

// CRITICAL (prd-task-command test #5) — do NOT flip the module-level existsSync default to false;
//   the passing file-override/bugfix tests rely on truthy existsSync. Override per-test only.

// CRITICAL (researcher-agent) — 'Use subagents for parallel work when beneficial' is in
//   PRP_BUILDER_PROMPT (prompts.ts:717), NOT PRP_BLUEPRINT_PROMPT. Use only literals confirmed
//   inside PRP_BLUEPRINT_PROMPT (lines 182-674): 'Subagents are OPTIONAL and may be unavailable'
//   and 'or built-in subagents if available'.

// CRITICAL (prp-blueprint-agent) — this is a REAL production omission, not stale-test text. The test
//   is CORRECT (toBe(true)). Fix production (add enableReflection:true) per AGENTS.md rule 5; do NOT
//   weaken the assertion. Record the architecture note. (Fallback only if reviewer demands test-only:
//   skip the assertion + flag — NOT recommended.)

// CRITICAL (all) — NEVER weaken an assertion to force green. Every re-pointed assertion asserts the
//   REAL current text/behavior. The enableReflection test stays toBe(true).
```

## Implementation Blueprint

### Data models and structure

No production data models change. The prd-task-command mock gains a `SessionState`-shaped object
(matches `src/core/models.ts` `SessionState`/`SessionMetadata`). The prp-blueprint production fix adds
one optional field (`enableReflection: true`) to a `createPrompt({...})` call — no type change (the
Groundswell `Prompt.enableReflection?` field already exists).

### Implementation Tasks (ordered by dependencies)

```yaml
# ═════════════════ TASK 1 — qa-agent.test.ts: broaden agent-factory mock ═════════════════
Task 1: EDIT tests/integration/qa-agent.test.ts  (top-level vi.mock at :67)
  OLD:
    vi.mock('../../src/agents/agent-factory.js', () => ({
      createQAAgent: vi.fn(),
    }));
  NEW:
    vi.mock('../../src/agents/agent-factory.js', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('../../src/agents/agent-factory.js')>();
      return {
        ...actual,
        createQAAgent: vi.fn(),
        // FixCycleWorkflow.runStandardBreakdown dynamically imports + calls createArchitectAgent.
        // Groundswell's createAgent mock returns undefined, so stub the architect's .prompt to
        // succeed and let the breakdown proceed to the (mock-routed) tasks.json read.
        createArchitectAgent: vi.fn().mockReturnValue({
          prompt: vi.fn().mockResolvedValue({ status: 'success', value: '{}' }),
        }),
      };
    });
  WHY: the old factory stubbed ONLY createQAAgent → FixCycleWorkflow's dynamic
       `await import('...agent-factory.js')` of createArchitectAgent (fix-cycle-workflow.ts:247)
       threw "No createArchitectAgent export is defined". Safe for the 'createQAAgent configuration'
       suite (realFactoryExports at :243 uses vi.importActual, bypassing the mock).

# ═════════════════ TASK 2 — qa-agent.test.ts: route readFile in the 3 fix-cycle tests ═════════════════
Task 2: EDIT tests/integration/qa-agent.test.ts  (3 identical sites, tests :791,:843,:895)
  Each test currently has (the literal text is identical at all 3 sites):
  OLD:
        vi.mocked(readFile).mockResolvedValue(JSON.stringify(initialResults));
  NEW:
        vi.mocked(readFile).mockImplementation(async (path: any) => {
          // Route by filename: TEST_RESULTS.md -> bug report; tasks.json -> a valid Backlog
          // (runStandardBreakdown reads tasks.json and JSON.parses it as a Backlog).
          const p = String(path);
          if (p.endsWith('tasks.json')) {
            return JSON.stringify({ backlog: [] });
          }
          return JSON.stringify(initialResults);
        });
  WHY: the old mock returned the bug-report JSON for ALL reads; runStandardBreakdown read tasks.json,
       parsed it as a Backlog, and resolveScope iterated an undefined .backlog. (The 3 tests already
       vi.spyOn BugHuntWorkflow.prototype.run, so the empty Backlog → executeFixes no-ops → loop
       semantics hold. Validated: all 3 pass.)

# ═════════════════ TASK 3 — qa-agent.test.ts: model literal ═════════════════
Task 3: EDIT tests/integration/qa-agent.test.ts  (assertion at :275)
  OLD:   model: 'GLM-4.7',
  NEW:   model: 'zai/glm-5.2',     // P2.M2 roles refactor: QA = reasoning role = balanced tier
  WHY: createQAAgent → createBaseConfig('qa','reasoning') → getModel('balanced') → 'zai/glm-5.2'.
       objectContaining — every other field already matches prod.

# ═════════════════ TASK 4 — researcher-agent.test.ts: model literal ═════════════════
Task 4: EDIT tests/integration/researcher-agent.test.ts  (assertion at :281)
  OLD:   model: 'GLM-4.7',
  NEW:   model: 'zai/glm-5.2',
  WHY: createResearcherAgent → createBaseConfig('researcher','research') → getModel('balanced') →
       'zai/glm-5.2'.

# ═════════════════ TASK 5 — researcher-agent.test.ts: re-point 2 prompt assertions ═════════════════
Task 5: EDIT tests/integration/researcher-agent.test.ts  ('should instruct to spawn subagents', :442-445)
  OLD:
        // VERIFY: Contains instructions for subagent spawning
        // GOTCHA: These are ASPIRATIONAL features, not implemented in current codebase
        // Tests verify prompt CONTAINS these instructions, not that they work
        expect(PRP_BLUEPRINT_PROMPT).toContain('spawn subagents');
        expect(PRP_BLUEPRINT_PROMPT).toContain('batch tools');
  NEW:
        // VERIFY: Prompt still instructs on subagent usage. Wording was de-escalated to
        // OPTIONAL/best-effort during the roles refactor; assert the CURRENT literals present
        // in PRP_BLUEPRINT_PROMPT (src/agents/prompts.ts:182-674).
        expect(PRP_BLUEPRINT_PROMPT).toContain(
          'Subagents are OPTIONAL and may be unavailable'
        );
        expect(PRP_BLUEPRINT_PROMPT).toContain(
          'or built-in subagents if available'
        );
  WHY: 'spawn subagents'/'batch tools' were removed; the prompt now frames subagents as OPTIONAL but
       still references them. (Do NOT use 'Use subagents for parallel work when beneficial' — that is
       in PRP_BUILDER_PROMPT, a different constant.)

# ═════════════════ TASK 6 — prd-task-command.test.ts: SessionState mock factory ═════════════════
Task 6: EDIT tests/integration/prd-task-command.test.ts  (SessionManager vi.mock factory, :78-98)
  OLD:
        SessionManager: vi.fn().mockImplementation(() => {
          const mockInstance = {
            loadSession: vi.fn().mockResolvedValue({
              backlog: createTestBacklog(),
              currentSession: '/tmp/prd-task-test-XXXXXX/plan/001_testsession',
            }),
            discoverSessions: vi
              .fn()
              .mockResolvedValue([
                '/tmp/prd-task-test-XXXXXX/plan/001_testsession',
              ]),
            currentSession: '/tmp/prd-task-test-XXXXXX/plan/001_testsession',
          };
          return mockInstance;
        }),
  NEW:
        SessionManager: vi.fn().mockImplementation(() => {
          // currentSession MUST be a SessionState object (not a path string): TaskOrchestrator
          // reads currentSession.taskRegistry; the ResearchQueue it builds constructs a
          // PRPGenerator that reads currentSession.metadata.path.
          const mockState = {
            metadata: {
              id: '001_testsession',
              hash: 'testhash00000',
              path: '/tmp/prd-task-test-XXXXXX/plan/001_testsession',
              createdAt: new Date(),
              parentSession: null,
            },
            prdSnapshot: '# Test PRD\n',
            taskRegistry: createTestBacklog(),
            currentItemId: null,
          };
          const mockInstance = {
            loadSession: vi.fn(),
            discoverSessions: vi
              .fn()
              .mockResolvedValue([
                '/tmp/prd-task-test-XXXXXX/plan/001_testsession',
              ]),
            get currentSession() {
              return mockState;
            },
            set currentSession(v) {
              Object.assign(mockState, v);
            },
          };
          return mockInstance;
        }),

# ═════════════════ TASK 7 — prd-task-command.test.ts: delete 3 dead loadSession blocks ═════════════════
Task 7: EDIT tests/integration/prd-task-command.test.ts  (3 identical sites in tests :312,:337,:389)
  Each test currently has (identical text at all 3 sites):
  OLD:
        (sessionManager.loadSession as any).mockResolvedValue({
          tasks: backlog.backlog,
          currentSession: '/tmp/prd-task-test-XXXXXX/plan/001_testsession',
        });

        const orchestrator = new TaskOrchestrator(sessionManager);
  NEW:
        const orchestrator = new TaskOrchestrator(sessionManager);
  WHY: loadSession is never called by TaskOrchestrator; the factory (Task 6) now provides a valid
       currentSession with taskRegistry: createTestBacklog(). (The local `backlog` var in these tests
       is now unused — leave it; removing it is optional and risks touching shared helper scope.)

# ═════════════════ TASK 8 — prd-task-command.test.ts: all-Complete test override ═════════════════
Task 8: EDIT tests/integration/prd-task-command.test.ts  ('should return null when all tasks are Complete', :368)
  OLD:
        (sessionManager.loadSession as any).mockResolvedValue({
          tasks: backlog.backlog,
          currentSession: '/tmp/prd-task-test-XXXXXX/plan/001_complete',
        });

        const orchestrator = new TaskOrchestrator(sessionManager);
  NEW:
        (sessionManager as any).currentSession = { taskRegistry: backlog };

        const orchestrator = new TaskOrchestrator(sessionManager);
  WHY: this test needs its custom all-Complete backlog, so override taskRegistry on the live mockState
       (the factory default is createTestBacklog()).

# ═════════════════ TASK 9 — prd-task-command.test.ts: re-align ordering assertion ═════════════════
Task 9: EDIT tests/integration/prd-task-command.test.ts  ('should return next executable task', :345-347)
  OLD:
        // VERIFY: Next task is P1.M1.T2.S1 (Researching, comes before Planned S2 in DFS)
        expect(nextTask).toBeDefined();
        expect(nextTask!.id).toBe('P1.M1.T2.S1');
        expect(nextTask!.status).toBe('Researching');
  NEW:
        // VERIFY: First Planned|Researching in DFS order. DFS leaf order is
        // S1(Complete) -> S2(Planned) -> S3(Researching) -> S4(Implementing), so the first
        // executable (Planned|Researching) leaf is S2 (Planned). (Confirmed by sibling test #1:
        // tasks[0].id === 'P1.M1.T1.S1'.)
        expect(nextTask).toBeDefined();
        expect(nextTask!.id).toBe('P1.M1.T1.S2');
        expect(nextTask!.status).toBe('Planned');
  WHY: the old expectation was internally inconsistent with the test's own `.find(Planned||Researching)`
       over DFS order — S2 (Planned) precedes S3 (Researching). Production ordering is correct.

# ═════════════════ TASK 10 — prd-task-command.test.ts: per-test existsSync override ═════════════════
Task 10: EDIT tests/integration/prd-task-command.test.ts  ('should handle non-existent file gracefully', :499)
  OLD:
        // SETUP: Non-existent file path
        const nonExistentPath = mockJoin(tempDir, 'does-not-exist.json');
  NEW:
        // SETUP: Non-existent file path (override the module-level existsSync=>true default for
        // THIS path only — the passing file-override/bugfix tests rely on truthy existsSync)
        (mockExistsSync as any).mockReturnValue(false);
        const nonExistentPath = mockJoin(tempDir, 'does-not-exist.json');

# ═════════════════ TASK 11 — task-breakdown-prompt.test.ts: re-point 2 assertions ═════════════════
Task 11: EDIT tests/integration/task-breakdown-prompt.test.ts  ('should specify spawning subagents for research', :93-100)
  OLD:
        it('should specify spawning subagents for research', () => {
          expect(TASK_BREAKDOWN_PROMPT).toContain('SPAWN SUBAGENTS');
          expect(TASK_BREAKDOWN_PROMPT).toContain(
            'spawn agents to research the codebase'
          );
        });
  NEW:
        it('should specify spawning subagents for research', () => {
          // Wording updated when subagent usage was de-escalated to optional; the capability is
          // still described in the PROCESS section. Assert the CURRENT verbatim literals
          // (src/agents/prompts.ts:112-114).
          expect(TASK_BREAKDOWN_PROMPT).toContain('**RESEARCH (SPAWN & VALIDATE):**');
          expect(TASK_BREAKDOWN_PROMPT).toContain(
            '**Spawn** subagents to map the codebase and verify PRD feasibility.'
          );
          expect(TASK_BREAKDOWN_PROMPT).toContain(
            '**Spawn** subagents to find external documentation for new tech.'
          );
        });

# ═════════════════ TASK 12 — PRODUCTION (rule-5 corrective): enableReflection ═════════════════
Task 12: EDIT src/agents/prompts/prp-blueprint-prompt.ts  (createPRPBlueprintPrompt return, :339-340)
  OLD:
        // Permissive schema — the FILE is the contract (mirrors the architect).
        responseFormat: z.unknown(),
      });
  NEW:
        // Permissive schema — the FILE is the contract (mirrors the architect).
        responseFormat: z.unknown(),

        // Complex PRP generation: enable reflection for error recovery (matches every sibling
        // builder; this function's own JSDoc above promises it).
        enableReflection: true,
      });
  WHY: REAL latent production inconsistency — the ONLY builder omitting enableReflection; its JSDoc
       (:255) + 4 siblings (validation:112, change-classifier:183+205, delta-analysis:147,
       bug-hunt:164) all set it. The test at prp-blueprint-agent.test.ts:100 is CORRECT (toBe(true)).
       AGENTS.md rule 5 permits fixing broken contracts directly (no PRP). Validated: 11/11 pass;
       sibling prompt suites + prp-generator-integration green in isolation; additive, no regression.

# ═════════════════ TASK 13 — architecture note (flag the corrected defect) ═════════════════
Task 13: EDIT architecture/bug-004-test-suite.md  (append a one-line note)
  Append (e.g. under the Category (b) area or a short "Corrected during P1.M4.T3.S3" line):
    "- prp-blueprint-prompt.ts: createPRPBlueprintPrompt was omitting enableReflection (its JSDoc +
      4 sibling builders all set it) — corrected in P1.M4.T3.S3 as rule-5 corrective work; the
      prp-blueprint-agent.test.ts:100 assertion (toBe(true)) is now satisfied and is NOT weakened."
  WHY: honors the work contract's "If a failure reveals a real src defect, ... flag it in
       architecture/" directive — document the latent omission that was corrected.

# ═════════════════ TASK 14 — VERIFY (per-file + whole-suite delta + static gates + scope guard) ═════════════════
Task 14: VERIFY
  - RUN each file: npx vitest run tests/integration/{qa-agent,researcher-agent,prd-task-command,
    prp-blueprint-agent,task-breakdown-prompt}.test.ts --reporter=verbose → 0 failed each.
  - RUN whole suite: npx vitest run --reporter=dot 2>&1 | tail -n 30 → failure count STRICTLY
    DECREASES by 13 vs baseline; no previously-green file newly red.
  - RUN: npm run typecheck && npm run lint && npm run format:check → clean on every touched file.
  - RUN: git diff --stat -- src/ → ONLY src/agents/prompts/prp-blueprint-prompt.ts.
```

### Implementation Patterns & Key Details

```ts
// ── Pattern A: broadened vi.mock with importOriginal + stub (qa-agent) ───────────────────────
vi.mock('../../src/agents/agent-factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agents/agent-factory.js')>();
  return { ...actual, createQAAgent: vi.fn(), createArchitectAgent: vi.fn().mockReturnValue({
    prompt: vi.fn().mockResolvedValue({ status: 'success', value: '{}' }),
  }) };
});

// ── Pattern B: readFile routing by path (qa-agent fix-cycle tests) ──────────────────────────
vi.mocked(readFile).mockImplementation(async (path: any) => {
  return String(path).endsWith('tasks.json') ? JSON.stringify({ backlog: [] })
                                              : JSON.stringify(initialResults);
});

// ── Pattern C: live SessionState mock with getter/setter (prd-task-command) ─────────────────
const mockState = { metadata: { id, hash, path, createdAt, parentSession: null },
                    prdSnapshot: '# Test PRD\n', taskRegistry: createTestBacklog(), currentItemId: null };
// on the instance:  get currentSession() { return mockState; }  set currentSession(v){ Object.assign(mockState, v); }
// per-test override:  (sessionManager as any).currentSession = { taskRegistry: customBacklog };

// ── Pattern D: rule-5 production corrective (prp-blueprint-prompt.ts) ───────────────────────
return createPrompt({ user, system, responseFormat: z.unknown(), enableReflection: true });

// ── Pattern E: prompt-text re-point (assert CURRENT verbatim literals only) ─────────────────
// ALWAYS grep the current constant first; confirm the literal is INSIDE the right constant's
// line range before asserting it (PRP_BLUEPRINT_PROMPT vs PRP_BUILDER_PROMPT vs TASK_BREAKDOWN_PROMPT).
```

### Integration Points

```yaml
DATABASE: none
CONFIG:   none
ROUTES:   none
GIT:      none
# Edits confined to: 4 tests/integration files (test-only), 1 src/agents/prompts file (1-line
# rule-5 corrective), 1 architecture note. No package.json/tests-setup/tests-helpers change.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # tsc --noEmit ; expect no NEW errors on touched files
npm run lint             # eslint ; expect clean for touched files
npm run format:check     # prettier --check ; if it complains: npx prettier --write <file>
# Expected: Zero errors. Read any output and fix before proceeding.
```

### Level 2: Per-file tests (primary gate — each must be 0 failed)

```bash
npx vitest run tests/integration/qa-agent.test.ts --reporter=verbose 2>&1 | tail -n 8
#   Expected: Tests 27 passed | 3 skipped (30). (3 skips are pre-existing 'FixCycleWorkflow integration'.)
npx vitest run tests/integration/researcher-agent.test.ts --reporter=verbose 2>&1 | tail -n 8
#   Expected: Tests 37 passed (37).
npx vitest run tests/integration/prd-task-command.test.ts --reporter=verbose 2>&1 | tail -n 8
#   Expected: Tests 8 passed (8).
npx vitest run tests/integration/prp-blueprint-agent.test.ts --reporter=verbose 2>&1 | tail -n 8
#   Expected: Tests 11 passed (11). (Requires Task 12 production fix.)
npx vitest run tests/integration/task-breakdown-prompt.test.ts --reporter=verbose 2>&1 | tail -n 8
#   Expected: Tests 39 passed (39).
# Diagnostics:
#   - qa-agent fix-cycle test fails with "No createArchitectAgent export" → Task 1 not applied.
#   - qa-agent fix-cycle test fails with "Cannot read properties of undefined (reading 'prompt')"
#     → Task 1 mock spread importOriginal but forgot the createArchitectAgent stub.
#   - qa-agent fix-cycle test fails with "reading 'backlog'" → Task 2 readFile routing missing.
#   - prd-task-command fails with "reading 'backlog'" → Task 6 currentSession still a string.
#   - prd-task-command fails with "reading 'path'" → Task 6 missing metadata.path.
#   - prd-task-command test #2 fails id mismatch → Task 9 ordering assertion still old.
#   - prp-blueprint-agent fails enableReflection undefined → Task 12 production fix missing.
#   - researcher 'spawn subagents' fails → used a literal not in PRP_BLUEPRINT_PROMPT (re-check Task 5).
```

### Level 3: Whole-suite delta (must NOT regress)

```bash
npx vitest run --reporter=dot 2>&1 | tail -n 30
# Expected:
#   - Failure count STRICTLY DECREASES by 13 vs the pre-item baseline.
#   - No previously-green file newly red.
#   - Category (a) PiHarness files (smart-commit, task-orchestrator-e2e, prp-generator-integration,
#     etc.) and category (c) files are P1.M4.T2 / P1.M4.T1 territory — they may STILL be red; do not
#     fix them here. coder-agent.* = S1; pipeline-main-loop.* = S2 — leave them alone.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Scope guard — prove the ONLY src/ file touched is prp-blueprint-prompt.ts:
git diff --stat -- src/                          # EXPECT: only src/agents/prompts/prp-blueprint-prompt.ts
git status --short -- src/                       # EXPECT: only that one file

# Test-files-touched guard:
git status --short -- tests/integration/         # EXPECT: qa-agent, researcher-agent, prd-task-command,
                                                 #         task-breakdown-prompt (NOT prp-blueprint-agent)

# enableReflection corrective guard (production fix landed):
grep -c "enableReflection: true" src/agents/prompts/prp-blueprint-prompt.ts   # EXPECT: >=1

# Architecture-note guard:
grep -c "enableReflection" plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-004-test-suite.md  # EXPECT: >=1

# Model-literal guard (no GLM-4.7 left in the 2 fixed files):
grep -c "GLM-4.7" tests/integration/qa-agent.test.ts tests/integration/researcher-agent.test.ts   # EXPECT: 0 0

# Mock-completeness guard (prd-task-command SessionState shape):
grep -c "taskRegistry: createTestBacklog()" tests/integration/prd-task-command.test.ts   # EXPECT: >=1
grep -c "metadata:" tests/integration/prd-task-command.test.ts                           # EXPECT: >=1

# No-dead-loadSession guard (prd-task-command):
grep -c "sessionManager.loadSession as any).mockResolvedValue" tests/integration/prd-task-command.test.ts  # EXPECT: 0
```

## Final Validation Checklist

### Technical Validation

- [ ] All 5 files pass 0 failed (counts above).
- [ ] Whole-suite failure count strictly decreases by 13; no previously-green file newly red.
- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check` clean on every touched file.

### Feature Validation

- [ ] **qa-agent (4):** broadened mock + architect stub + readFile routing + model literal → 27 pass|3 skip.
- [ ] **researcher-agent (2):** model literal + 2 prompt re-points (current PRP_BLUEPRINT_PROMPT literals) → 37 pass.
- [ ] **prd-task-command (5):** SessionState mock + dead-block removal + all-Complete override + ordering re-align + existsSync override → 8 pass.
- [ ] **prp-blueprint-agent (1):** production `enableReflection: true` lands → 11 pass (test unchanged, NOT weakened).
- [ ] **task-breakdown-prompt (1):** 2 prompt re-points (current PROCESS-section literals) → 39 pass.

### Code Quality Validation

- [ ] Every re-pointed assertion asserts the REAL current text/behavior (no weakening).
- [ ] `git diff --stat -- src/` shows ONLY `src/agents/prompts/prp-blueprint-prompt.ts`.
- [ ] Architecture note added for the enableReflection correction.

### Documentation & Deployment

- [ ] Commit message uses the project's task-prefix format (P1.M3 landed):
      `P1.M4.T3.S3: <subject>`. Do NOT prepend `[PRP Auto]` (forbidden per PRD §5.1 / BUG-003).

---

## Anti-Patterns to Avoid

- ❌ Don't use bare `'glm-5.2'` — the literal is provider-qualified `'zai/glm-5.2'` (with the `zai/` prefix).
- ❌ Don't broaden the qa-agent mock with ONLY `importOriginal()` and forget the `createArchitectAgent`
  stub — groundswell's `createAgent` returns undefined, so the real architect's `.prompt` throws.
- ❌ Don't route readFile globally — route per-test by path; only the 3 fix-cycle tests need it.
- ❌ Don't "fix" the dead `loadSession.mockResolvedValue` blocks in prd-task-command — DELETE them;
  TaskOrchestrator never calls loadSession.
- ❌ Don't flip the module-level `existsSync` default to false in prd-task-command — override per-test
  (the passing file-override/bugfix tests rely on truthy existsSync).
- ❌ Don't use `'Use subagents for parallel work when beneficial'` as a researcher-agent anchor — it's in
  PRP_BUILDER_PROMPT, not PRP_BLUEPRINT_PROMPT. Grep the constant's line range first.
- ❌ Don't weaken the prp-blueprint-agent `enableReflection` assertion to force green — the test is
  CORRECT; fix production (rule 5) instead.
- ❌ Don't change any production code beyond the one-line `enableReflection: true` corrective.
- ❌ Don't fix files outside scope (coder-agent.* = S1; pipeline-main-loop.* = S2; category (a)/(c)
  files = other items).
- ❌ Don't prepend `[PRP Auto]` to the commit message (forbidden per PRD §5.1 / BUG-003).
- ❌ Don't run the pipeline app (`npm run dev`/`tsx src/index.ts`) — only run vitest.

---

## Confidence Score

**10/10** — one-pass success likelihood. Every one of the 13 failures was empirically validated: each
fix was prototyped in-place, run green via `npx vitest run`, then reverted (`git diff` confirmed clean).
Post-fix results measured: qa-agent 27 pass|3 skip, researcher 37/37, prd-task-command 8/8,
prp-blueprint-agent 11/11, task-breakdown-prompt 39/39. The exact OLD→NEW strings in the tasks are the
literal text that produced green runs. The model contract is traced through source
(constants→environment→agent-factory), the SessionState mock shape is traced through
TaskOrchestrator→ResearchQueue→PRPGenerator, and the one production corrective (`enableReflection`) is
confirmed to match the builder's JSDoc + 4 siblings with no sibling regression (validated in isolation).
The only residual judgment call (the enableReflection production fix vs. test-only re-categorize) is
resolved with a clear primary recommendation + architecture note + documented fallback. Blast radius is
4 edited test files + 1 one-line src corrective + 1 note; `src/` is fenced by an explicit scope guard.