# PRP — P3.M2.T3.S1: Audit and disable session persistence for stateless personas

---

## Goal

**Feature Goal**: Make the **"stateless single-shot" invariant of PRD §9.3.2 an explicit,
audited, defended property of the pipeline's agent layer** — instead of the implicit,
undocumented assumption the scout reported.

PRD §9.3.2 mandates:

> **Stateless single-shot invocations:** Agent calls that are stateless by nature (cleanup,
> mid-session task update, validation, post-validation fix, bug-finder, per-item PRP
> execution) MUST NOT create or resume sessions. They are single-shot or operate on
> freshly-built prompts, so enabling session persistence only creates orphaned sessions
> that serve no purpose (the bash equivalent is the `--no-session` flag).

Today the pipeline's six `createAgent()` call sites pass **NO** session/sessionId/persistence
config (confirmed: `architecture/signatures.md:84` — *"No session/sessionId/persistence
field in AgentConfig"*). That is necessary but **not sufficient**: the absence of a field is
a silent coincidence, not a defended invariant. Worse, the *actual* orphaned-session source
is one layer DOWN — the Groundswell `PiHarness` hardcodes `createAgentSession({...})` **without
a `sessionManager`**, so pi defaults to the disk-persisted `SessionManager.create(cwd)` writing
append-only JSONL to `~/.pi/agent/sessions/<encoded-cwd>/` on **every** run (research/01 §"pi-harness
execute() does NOT pass sessionManager"). That mechanical disable is **blocked** by
Groundswell's public API surface today (`AgentConfig` has no session field; `HarnessOptions`
has no `sessionManager`/`noSession` — research/01). This PRP makes the invariant explicit at
the pipeline layer we own, classifies the personas, documents the Groundswell gap, and future-wires
the disable so the moment the harness exposes the seam it is a one-line wiring.

**Deliverable** (2 modified production files + 2 modified test files; **no** new files, **no**
config, **no** new dependencies, **no** Groundswell monkey-patching):
1. **`src/agents/agent-factory.ts`** — ADD a `stateless: boolean` field to the pipeline
   `AgentConfig` interface (pipeline-internal invariant marker, exactly mirroring the existing
   `thinking?: ThinkingLevel` marker at lines 160-166 — *"Pipeline-internal budget marker …
   harness wiring is downstream"*). ADD an exported `STATELESS_PERSONAS: ReadonlySet<AgentPersona>`
   constant (the audited, PRD-§9.3.2-derived classification). THREAD `stateless` through
   `createBaseConfig()` so it is derived from the persona (`STATELESS_PERSONAS.has(persona)`),
   making it a single-source-of-truth property, NOT a per-factory manual override. ADD Mode-A
   JSDoc on `AgentConfig.stateless`, `createBaseConfig`, and `STATELESS_PERSONAS` citing
   PRD §9.3.2 / P3.M2.T3.S1 and recording the Groundswell-pi-harness gap.
2. **`src/agents/commit-message-agent.ts`** — the commit-message agent does NOT go through a
   persona constant (it reuses `createBaseConfig('researcher', ...)`), so `'researcher'` would
   wrongly mark it stateful. Override `stateless: true` in the config spread (mirroring how it
   already overrides `maxTokens`/`enableReflection`/`enableCache`). Update its JSDoc.
3. **`tests/unit/agents/agent-factory.test.ts`** — ADD assertions that `createBaseConfig()` sets
   `stateless` correctly per persona (`coder`/`qa`/`cleanup` → `true`; `architect`/`researcher`
   → `false`), that `STATELESS_PERSONAS` membership matches §9.3.2, and that the field is `readonly`.
4. **`tests/unit/agents/commit-message-agent.test.ts`** — ADD one assertion that the config spread
   carries `stateless: true`.

**Success Definition**:
- `createBaseConfig('coder')` → `config.stateless === true`; same for `'qa'`, `'cleanup'`.
- `createBaseConfig('architect')` → `config.stateless === false`; same for `'researcher'`.
- `createCommitMessageAgent()` config → `stateless === true` (override wins over the researcher base).
- `STATELESS_PERSONAS` exports a `ReadonlySet` whose members are exactly `{'coder','qa','cleanup'}`
  (the four stateless **personas**; commit-message is an ad-hoc persona-less agent handled by override).
- The JSDoc on `AgentConfig.stateless`, `createBaseConfig`, and `STATELESS_PERSONAS` each cite
  PRD §9.3.2 / P3.M2.T3.S1 AND name the Groundswell `PiHarness` gap (no `sessionManager` /
  `HarnessOptions` field) as the reason the disable is a marker, not a mechanical switch today.
- **100% coverage** maintained on `src/agents/agent-factory.ts` AND `src/agents/commit-message-agent.ts`.
- `npm run validate` GREEN; `package.json` `dependencies` byte-identical.

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline (no human in the loop). Specifically the agent factory
(`src/agents/agent-factory.ts`), the commit-message agent (`src/agents/commit-message-agent.ts`),
and transitively every consumer that instantiates a persona
(`prp-executor.ts`, `prp-generator.ts`, `cleanup-runner.ts`, `bug-hunt-workflow.ts`,
`delta-analysis-workflow.ts`, `prp-pipeline.ts`, `git-commit.ts`).

**Use Case**: A pipeline agent runs a single-shot prompt (cleanup reorg, validation gate, bug hunt,
per-item PRP execution, stagecoach commit message). Pre-S1: the run silently leaves an orphaned
JSONL session file under `~/.pi/agent/sessions/<encoded-cwd>/` because the Groundswell `PiHarness`
defaults `createAgentSession` to `SessionManager.create(cwd)` (disk-persisted), and the pipeline
never expressed — or even modeled — the stateless intent. Post-S1: the intent is an explicit,
tested, documented property of every stateless persona config; the Groundswell gap is recorded in
JSDoc so the future harness-seam wiring is obvious; and a regression that adds a stateful persona
to the stateless set (or vice-versa) fails a unit test.

**User Journey**: `createCoderAgent()` → `createBaseConfig('coder', 'implementation')` → reads
`STATELESS_PERSONAS.has('coder') === true` → sets `stateless: true` on the returned `AgentConfig`
→ `createAgent({...baseConfig, system, mcps})` → the `stateless: true` field rides through the
object spread (Groundswell ignores unknown fields today) → a future harness-wiring change reads
it to pass `SessionManager.inMemory()`. A unit test asserts `config.stateless === true`.

**Pain Points Addressed**: PRD §9.3.2 (h4.9) — orphaned sessions from stateless calls. The scout
(reporting only the `AgentConfig`-surface absence) under-specified the real defect: the persistence
happens in the pi harness, one layer down. S1 turns the invariant from "happens to be unset" into
"explicitly modeled, classified, tested, and documented with the upstream blocker named".

---

## Why

- **PRD compliance**: PRD §9.3.2 (h4.9) explicitly mandates stateless personas MUST NOT create or
  resume sessions. Today this holds only by omission; S1 makes it a defended, classified invariant.
- **Work-item contract (LOGIC a–d)**:
  - (a) *"Audit all agent-creation call sites … (agent-factory.ts createBaseConfig + persona
    factories, prp-executor.ts, prp-generator.ts, prp-runtime.ts, bug-hunt-workflow.ts,
    delta-analysis-workflow.ts)."* → research/02 audits ALL six `createAgent()` call sites and ALL
    factory-consumer call sites. NONE pass session config (confirmed). The audit is encoded as the
    `STATELESS_PERSONAS` classification + JSDoc.
  - (b) *"For stateless-by-nature personas … ensure they do not create or resume sessions. This may
    involve adding an explicit stateless/no-session flag to AgentConfig and passing it to the pi
    harness."* → ADD the explicit `stateless` flag to the pipeline `AgentConfig` (single source of
    truth via `STATELESS_PERSONAS`). Passing it to the pi harness is BLOCKED (see c) — the flag is
    future-wired instead.
  - (c) *"If the pi harness supports a --no-session equivalent or a programmatic option, enable it
    for these personas."* → **It does NOT, through the pipeline's API surface.** The pi SDK supports
    `SessionManager.inMemory()` (`CreateAgentSessionOptions.sessionManager`, sdk.d.ts:48-49;
    README.md:572 `--no-session`), but Groundswell's `PiHarness.execute()` hardcodes
    `createAgentSession({...})` with NO `sessionManager` (pi-harness.js:188) and `AgentConfig` /
    `HarnessOptions` expose NO field to inject one (research/01). So the mechanical enable is
    impossible without monkey-patching Groundswell or depending on its private internals — both
    forbidden. S1 records this gap in JSDoc as the required future upstream change.
  - (d) *"If session persistence is already absent (as the scout reports), verify and document this;
    add defensive flags/comments to prevent future regressions."* → THIS is the operative branch.
    The flag IS the defensive measure; the JSDoc IS the documentation; the unit tests ARE the
    regression guard.
- **Contract item 1 (RESEARCH NOTE)**: *"agent-factory.ts passes no session/sessionId/persistence
  config to createAgent(). AgentConfig has no sessions/session/sessionId field. … 'Sessions'
  elsewhere (prp-runtime.ts, prp-executor.ts, session-manager.ts) refer to the filesystem
  SessionManager directory, a separate concept."* → verified (research/01, research/02). The pipeline's
  own `SessionManager` (`src/core/session-manager.ts`) is the `plan/{seq}_{hash}/` directory concept —
  UNRELATED to pi's `~/.pi/agent/sessions/` JSONL store. S1 touches only the pi-session invariant; it
  does not conflate the two.
- **Contract item 4 (OUTPUT)**: *"Stateless personas confirmed/configured to not create sessions.
  Completes P3.M2.T3."* → S1 confirms (audit) + configures (explicit flag) + documents (JSDoc) +
  guards (tests).
- **Contract item 5 (DOCS)**: *"[Mode A] JSDoc on createBaseConfig and AgentConfig noting the
  stateless-single-shot invariant. This rides WITH the work."* → Mode A inline JSDoc, no
  `.env.example`, no `constants.ts`, no `docs/` edit.

---

## What

Two modified production files, two modified test files. **No** config, **no** new files, **no** new
dependencies, **no** Groundswell source changes, **no** monkey-patching.

### Success Criteria

- [ ] **`src/agents/agent-factory.ts` `AgentConfig` interface** has a new `readonly stateless: boolean`
      field with Mode-A JSDoc citing PRD §9.3.2 / P3.M2.T3.S1 and naming the Groundswell `PiHarness`
      gap (no `sessionManager` / `HarnessOptions` field → disable is a marker today, mechanical
      wiring is a future upstream change).
- [ ] **`src/agents/agent-factory.ts`** exports `STATELESS_PERSONAS: ReadonlySet<AgentPersona>` whose
      members are EXACTLY `{'coder', 'qa', 'cleanup'}` — the personas mapped from PRD §9.3.2's list
      (per-item PRP execution → coder; validation/bug-finder → qa; cleanup → cleanup). Architect
      (breakdown) and researcher (PRP creation) are EXCLUDED (multi-turn / large-context, not in the
      §9.3.2 list). JSDoc cites PRD §9.3.2 and records the derivation.
- [ ] **`createBaseConfig(persona, role)`** sets `stateless: STATELESS_PERSONAS.has(persona)` on the
      returned config object (single source of truth — NOT a per-factory manual override).
- [ ] **The `createCleanupAgent()` JSDoc** (currently at lines 423-426 saying *"(`AgentConfig` has
      no `session` field yet; P3.M2.T3.S1 audits/disables mechanical session persistence later.)"*) is
      UPDATED to reflect that S1 is now DONE: it should state the cleanup persona is stateless by
      `STATELESS_PERSONAS`, and reference the new `AgentConfig.stateless` field + the Groundswell gap.
- [ ] **`src/agents/commit-message-agent.ts`** overrides `stateless: true` in its config spread
      (the agent reuses `createBaseConfig('researcher', ...)` but is single-shot; the override mirrors
      the existing `maxTokens`/`enableReflection`/`enableCache` overrides). Its JSDoc is updated.
- [ ] **`retryAgentPrompt` / `retry.ts` / `prp-executor.ts` / `prp-runtime.ts` / `bug-hunt-workflow.ts`
      / `delta-analysis-workflow.ts` are NOT modified.** This PRP touches ONLY `agent-factory.ts` and
      `commit-message-agent.ts` (the two files that BUILD `AgentConfig`). Consumers are unchanged —
      they already call the factories, which now set the flag. (Do NOT touch the parallel P3.M2.T2.S2
      work on `retry.ts` / `prp-executor.ts`.)
- [ ] **`tests/unit/agents/agent-factory.test.ts`** adds: a `createBaseConfig` `it.each` test asserting
      `stateless` per persona (`coder`/`qa`/`cleanup` → true; `architect`/`researcher` → false); a
      `STATELESS_PERSONAS` membership test (`.has(...)` assertions + size === 3); a readonly check.
- [ ] **`tests/unit/agents/commit-message-agent.test.ts`** adds: one assertion that the config passed
      to `createAgent` carries `stateless: true`.
- [ ] **100% coverage** maintained on both modified files.
- [ ] `npm run validate` GREEN; `package.json` `dependencies` byte-identical (no new imports beyond
      what exists).

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?" — YES. This PRP names: the two exact files, the exact interface
(`AgentConfig` at lines 145-178), the exact function (`createBaseConfig` lines 248-284), the exact
precedent for a pipeline-internal marker (`thinking?: ThinkingLevel` lines 160-166 — *"Pipeline-
internal budget marker … harness wiring is downstream"*), the exact classification constant to add,
the exact persona→stateless derivation (from PRD §9.3.2 verbatim), the commit-message override site
(commit-message-agent.ts:99-112), the test files + their existing `it.each`/mock patterns, and the
full Groundswell API evidence (research/01) explaining WHY the disable is a marker not a switch.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/agents/agent-factory.ts
  why: PRIMARY TARGET. The `AgentConfig` interface (lines 145-178), `createBaseConfig()`
       (lines 248-284), the persona factories (createArchitectAgent 305, createResearcherAgent
       337, createCoderAgent 370, createQAAgent 399, createCleanupAgent 443), and the existing
       `PERSONA_TOKEN_LIMITS` constant (line 181) — `STATELESS_PERSONAS` mirrors its placement
       and `as const` style. The `thinking?: ThinkingLevel` field (lines 160-166) is the EXACT
       precedent for a pipeline-internal marker that Groundswell ignores — `stateless` follows it.
  pattern: |
           // ADD to AgentConfig (after `thinking?`, before `env:`), mirroring thinking's JSDoc tone:
           /** Stateless single-shot invariant (PRD §9.3.2 / P3.M2.T3.S1).
            *
            * `true` for personas in {@link STATELESS_PERSONAS}: the agent is single-shot and MUST NOT
            * create or resume a pi session (the `pi --no-session` equivalent). Pipeline-internal
            * invariant marker — Groundswell's `AgentConfig` / `HarnessOptions` do NOT model a
            * session-disable field, and `PiHarness.execute()` hardcodes `createAgentSession({…})`
            * WITHOUT a `sessionManager` (so pi defaults to the disk-persisted
            * `SessionManager.create(cwd)` → orphaned JSONL under ~/.pi/agent/sessions/). This flag
            * records the intent and future-wires the disable: the moment a harness seam exposes
            * `SessionManager.inMemory()` (pi SDK supports it), the wiring is one line. Today it is a
            * guarded, tested, documented marker — NOT a mechanical switch (research/01). */
           readonly stateless: boolean;

           // ADD as a module-level constant (next to PERSONA_TOKEN_LIMITS, line ~181):
           /**
            * Personas that are stateless single-shot invocations per PRD §9.3.2.
            *
            * Derivation from the PRD §9.3.2 list ("cleanup, mid-session task update, validation,
            * post-validation fix, bug-finder, per-item PRP execution"):
            *  - per-item PRP execution → `coder` (createCoderAgent, prp-executor.ts:255)
            *  - post-validation fix   → `coder` (same coder agent, prp-executor fix-loop)
            *  - validation / bug-finder → `qa` (createQAAgent, bug-hunt-workflow.ts:267,
            *    delta-analysis-workflow.ts:121)
            *  - cleanup → `cleanup` (createCleanupAgent, cleanup-runner.ts:117)
            * `architect` (task breakdown) and `researcher` (PRP creation) are EXCLUDED — they are
            * multi-turn / large-context and NOT in the §9.3.2 stateless list. "mid-session task
            * update" has no persona yet (P4.M1.T2); when added it MUST be registered here.
            * @see {@link AgentConfig.stateless}
            */
           export const STATELESS_PERSONAS: ReadonlySet<AgentPersona> = new Set<AgentPersona>([
             'coder', 'qa', 'cleanup',
           ]);

           // In createBaseConfig(), ADD to the returned object (e.g. right after `thinking,`):
           stateless: STATELESS_PERSONAS.has(persona),
  gotcha: `AgentPersona` is the union type defined at lines 92-99. `STATELESS_PERSONAS` MUST be
          declared with an explicit `Set<AgentPersona>` generic + `ReadonlySet<AgentPersona>` return
          type so TS narrows the literal members (matching `PERSONA_TOKEN_LIMITS` `as const` rigor).
          Do NOT use a bare `new Set([...])` — it loses the literal-narrowing that keeps the 100%
          coverage thresholds happy. The constant is exported (like PERSONA_TOKEN_LIMITS is module-
          internal but ROLE_CONFIG is exported at line 209) because the tests assert on it directly.

- file: src/agents/commit-message-agent.ts
  why: SECONDARY TARGET. `createCommitMessageAgent()` (lines 98-113) reuses
       `createBaseConfig('researcher', 'research')` — which would set `stateless: false` (researcher
       is NOT in STATELESS_PERSONAS). The commit-message agent IS single-shot (reads a staged diff,
       emits one message), so override `stateless: true` in the config spread at line ~106, exactly
       where `maxTokens: 512`, `enableReflection: false`, `enableCache: false` are already overridden.
  pattern: |
           // In createCommitMessageAgent(), the config spread (lines 101-108) — ADD `stateless: true`:
           const config = {
             ...baseConfig,
             name: 'CommitMessageAgent',
             system: COMMIT_MESSAGE_SYSTEM,
             maxTokens: 512,
             enableReflection: false,
             enableCache: false,
             stateless: true, // single-shot stagecoach; overrides researcher base (P3.M2.T3.S1)
           };
  gotcha: The override MUST come AFTER `...baseConfig` (it already does for the other overrides) or
          the spread would clobber it. The commit-message agent's JSDoc (lines 60-97) should gain one
          line noting it is stateless single-shot per PRD §9.3.2.

- file: plan/008_15504f60a0ef/P3M2T3S1/research/01-groundswell-agentconfig-api.md
  why: The evidence that the mechanical disable is BLOCKED. Cite the specific facts in JSDoc:
       `AgentConfig` (agent.d.ts) has no session field; `HarnessOptions` (harnesses.d.ts:61) has
       `sessionId` (resume) but no `sessionManager`/`noSession`; `PiHarness.execute()`
       (pi-harness.js:188) calls `createAgentSession({…})` without `sessionManager` → pi defaults to
       disk-persisted `SessionManager.create(cwd)`; the pi SDK DOES support
       `SessionManager.inMemory()` (sdk.d.ts:48-49) and `--no-session` (README.md:572).
  section: "Conclusion / IMPLICATION FOR PRP"

- file: plan/008_15504f60a0ef/P3M2T3S1/research/02-audit-personas.md
  why: The full call-site audit + persona→stateless classification table. Confirms NONE of the six
       `createAgent()` sites pass session config, and maps the §9.3.2 list to the four stateless
       pipeline agents.
  section: "PRD §9.3.2 'Stateless single-shot invocations' list (verbatim)"

- file: tests/unit/agents/agent-factory.test.ts
  why: TEST PATTERNS. `it.each(personas)` over the union (line 38); `.toHaveProperty(...)` style
       (lines 45-53); the "should enable cache and reflection for all personas" pattern (lines 75-83)
       is the template for a new "should set stateless per STATELESS_PERSONAS" test. Import
       `STATELESS_PERSONAS` from the source to assert membership directly.
  pattern: |
           // ADD (mirroring the existing it.each + .toBe patterns):
           it.each([
             ['coder', true],
             ['qa', true],
             ['cleanup', true],
             ['architect', false],
             ['researcher', false],
           ] as const)('should set stateless=%s for %s persona per STATELESS_PERSONAS',
             (persona, expected) => {
               expect(createBaseConfig(persona).stateless).toBe(expected);
             });

           it('should expose STATELESS_PERSONAS matching PRD §9.3.2 (coder, qa, cleanup)', () => {
             expect(STATELESS_PERSONAS.has('coder')).toBe(true);
             expect(STATELESS_PERSONAS.has('qa')).toBe(true);
             expect(STATELESS_PERSONAS.has('cleanup')).toBe(true);
             expect(STATELESS_PERSONAS.has('architect')).toBe(false);
             expect(STATELESS_PERSONAS.has('researcher')).toBe(false);
             expect(STATELESS_PERSONAS.size).toBe(3);
           });
  gotcha: The existing test at line 38 lists personas as `['architect','researcher','coder','qa']`
          (NO `cleanup`). The new `it.each` MUST include all FIVE personas so the cleanup branch of
          `STATELESS_PERSONAS.has()` is covered (100% coverage). Do not rely on the existing
          `personas` array — declare the expected-mapping array inline as shown.

- file: tests/unit/agents/commit-message-agent.test.ts
  why: TEST PATTERNS. `createBaseConfig` is mocked (lines 16-30) so the test asserts on the config
       SPREAD passed to `createAgent` (lines 76-104 pattern: `mockCreateAgent.mock.calls[0][0] as
       { … }`). ADD one test: `cfg.stateless === true`.
  pattern: |
           it('should mark itself stateless (single-shot, PRD §9.3.2)', () => {
             createCommitMessageAgent();
             const cfg = mockCreateAgent.mock.calls[0][0] as { stateless: boolean };
             expect(cfg.stateless).toBe(true);
           });
  gotcha: The mock `createBaseConfig` (lines 19-30) returns a config WITHOUT a `stateless` field.
          That is fine — the production override sets it; the test asserts the override. But if a
          later test asserts `createBaseConfig` was called with certain args, the mock return shape
          is irrelevant. Do NOT change the mock return shape unless a test needs it.

- url: file:///home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.d.ts
  why: The pi SDK `CreateAgentSessionOptions` — the `sessionManager?: SessionManager` field (lines
       48-49) and the `SessionManager.inMemory()` example (line 101) prove the disable IS supported
       by pi; only the Groundswell harness layer blocks it. Reference this in JSDoc as the future seam.
  critical: "Session manager. Default: SessionManager.create(cwd)" — this DEFAULT is the orphaned-
            session source. The fix-once-harness-exposes-it is `sessionManager:
            config.stateless ? SessionManager.inMemory(cwd) : undefined`.

- url: file:///home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts
  why: `static inMemory(cwd?, options?): SessionManager` (search "Create an in-memory session") —
       "no file persistence". This is the `pi --no-session` programmatic equivalent.
```

### Current Codebase tree (relevant slice)

```bash
src/agents/
  agent-factory.ts          # PRIMARY: AgentConfig iface (145-178), createBaseConfig (248-284),
                            #   persona factories (305-453), PERSONA_TOKEN_LIMITS (181),
                            #   ROLE_CONFIG (209) — ADD STATELESS_PERSONAS + stateless field
  commit-message-agent.ts   # SECONDARY: createCommitMessageAgent (98-113) — override stateless:true
  prp-executor.ts           # UNCHANGED (consumes createCoderAgent; coder now stateless via factory)
  prp-generator.ts          # UNCHANGED (consumes createResearcherAgent; researcher stays stateful)
  prp-runtime.ts            # UNCHANGED (no agent creation; 'session' = plan/ dir, unrelated)
  prompts/                  # UNCHANGED
src/core/
  cleanup-runner.ts         # UNCHANGED (consumes createCleanupAgent; cleanup now stateless via factory)
  session-manager.ts        # UNCHANGED (plan/{seq}_{hash}/ SessionManager — DISTINCT concept from pi sessions)
src/workflows/
  bug-hunt-workflow.ts      # UNCHANGED (consumes createQAAgent; qa now stateless via factory)
  delta-analysis-workflow.ts# UNCHANGED (consumes createQAAgent; qa now stateless via factory)
  prp-pipeline.ts           # UNCHANGED (consumes createArchitectAgent; architect stays stateful)
src/utils/
  git-commit.ts             # UNCHANGED (consumes createCommitMessageAgent; now stateless via override)
tests/unit/agents/
  agent-factory.test.ts     # MODIFY: add stateless + STATELESS_PERSONAS tests
  commit-message-agent.test.ts # MODIFY: add stateless:true assertion
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. Two modified production files, two modified test files:
src/agents/agent-factory.ts          # +AgentConfig.stateless, +STATELESS_PERSONAS, createBaseConfig threading, JSDoc
src/agents/commit-message-agent.ts   # +stateless:true override, JSDoc
tests/unit/agents/agent-factory.test.ts        # +stateless per-persona, +STATELESS_PERSONAS membership
tests/unit/agents/commit-message-agent.test.ts # +stateless:true assertion
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: Groundswell's `AgentConfig` (node_modules/groundswell/dist/types/agent.d.ts) has NO
// session field, and `HarnessOptions` (harnesses.d.ts:61) has NO `sessionManager`/`noSession`.
// The pi SDK DOES support stateless (`SessionManager.inMemory()`, `--no-session`), but the
// Groundswell `PiHarness.execute()` (pi-harness.js:188) hardcodes `createAgentSession({…})` with
// NO `sessionManager` → pi defaults to disk-persisted `SessionManager.create(cwd)`.
// => The mechanical disable is BLOCKED by Groundswell's public API. S1 makes the invariant an
//    explicit, tested MARKER. Do NOT monkey-patch the harness or reach into its privates.

// CRITICAL: The pipeline's own `SessionManager` (src/core/session-manager.ts) is a DIFFERENT concept
// from pi's SessionManager. Pipeline SessionManager = the plan/{seq}_{hash}/ working directory.
// pi SessionManager = ~/.pi/agent/sessions/<encoded-cwd>/ JSONL transcript store. Do NOT conflate.
// S1 touches ONLY the pi-session invariant.

// CRITICAL: `stateless` rides on the config object the SAME WAY `thinking` already does
// (agent-factory.ts:160-166) — Groundswell ignores unknown extra fields. The object spread
// `...baseConfig` in each persona factory carries `stateless` through to `createAgent(config)`
// harmlessly. Do NOT add a `stateless` field to Groundswell's interface (we can't — it's a node_module).

// GOTCHA: The existing test `personas` array (agent-factory.test.ts:38) is `['architect',
// 'researcher','coder','qa']` — it OMITS `cleanup`. The new `it.each` stateless test MUST declare
// its own inline array including ALL FIVE personas, or the cleanup branch of
// STATELESS_PERSONAS.has() is uncovered and 100% coverage FAILS.

// GOTCHA: `STATELESS_PERSONAS` MUST be typed `ReadonlySet<AgentPersona>` with `new Set<AgentPersona>([…])`
// (explicit generic), mirroring how `ROLE_CONFIG` (line 209) uses `Readonly<Record<…>>` and
// `PERSONA_TOKEN_LIMITS` uses `as const`. A bare `new Set( […])` widens to `Set<string>` and loses
// the literal narrowing the coverage/typing depends on.

// GOTCHA: The commit-message agent reuses `createBaseConfig('researcher', …)`. Because `researcher`
// is NOT in STATELESS_PERSONAS, the base config has `stateless: false`. The override
// (`stateless: true`) MUST appear AFTER `...baseConfig` in the spread — it already does for
// maxTokens/enableReflection/enableCache; place stateless in the same block.
```

---

## Implementation Blueprint

### Data models and structure

The only data model change is the `AgentConfig` interface gaining one `readonly stateless: boolean`
field and one module-level exported `STATELESS_PERSONAS` constant. There are no ORM/pydantic
models (this is a TypeScript pipeline).

```typescript
// src/agents/agent-factory.ts

// 1. AgentConfig interface — add the field (pipeline-internal marker, mirrors `thinking`):
export interface AgentConfig {
  // … existing fields unchanged …
  readonly thinking?: ThinkingLevel;
  /** Stateless single-shot invariant (PRD §9.3.2 / P3.M2.T3.S1). … see JSDoc in Context … */
  readonly stateless: boolean;
  readonly env: { /* … */ };
}

// 2. Module-level constant (next to PERSONA_TOKEN_LIMITS):
export const STATELESS_PERSONAS: ReadonlySet<AgentPersona> = new Set<AgentPersona>([
  'coder', 'qa', 'cleanup',
]);

// 3. createBaseConfig — derive stateless from the persona (single source of truth):
export function createBaseConfig(persona: AgentPersona, role: ModelRole = 'research'): AgentConfig {
  // … existing tier/thinking/model/name/system …
  return {
    // … existing fields …
    thinking,
    stateless: STATELESS_PERSONAS.has(persona), // P3.M2.T3.S1
    // … env …
  };
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/agents/agent-factory.ts — add STATELESS_PERSONAS constant
  - ADD: module-level `export const STATELESS_PERSONAS: ReadonlySet<AgentPersona> = new Set<AgentPersona>(['coder', 'qa', 'cleanup']);`
  - PLACE: immediately after the `PERSONA_TOKEN_LIMITS` declaration (~line 181), mirroring its
           `as const`/readonly rigor and `ROLE_CONFIG`'s export style (line 209).
  - NAMING: SCREAMING_SNAKE_CASE module constant (matches PERSONA_TOKEN_LIMITS, ROLE_CONFIG).
  - JSDOC: cite PRD §9.3.2 + the derivation table (per-item PRP execution→coder;
           validation/bug-finder→qa; cleanup→cleanup; architect/researcher EXCLUDED; mid-session
           task update has no persona yet — P4.M1.T2).
  - DEPENDENCIES: none (AgentPersona type already defined at line 92).

Task 2: MODIFY src/agents/agent-factory.ts — add stateless to AgentConfig + thread through createBaseConfig
  - ADD: `readonly stateless: boolean;` field to the AgentConfig interface (after `thinking?`,
         before `env:`), with Mode-A JSDoc citing PRD §9.3.2 / P3.M2.T3.S1 and naming the Groundswell
         PiHarness gap (no sessionManager/HarnessOptions field; pi-harness.execute() hardcodes
         createAgentSession without sessionManager → disk-persisted default; pi SDK supports
         SessionManager.inMemory() but the seam is not exposed). See Context for exact JSDoc text.
  - MODIFY: createBaseConfig() return object — add `stateless: STATELESS_PERSONAS.has(persona),`
            right after the existing `thinking,` line (~line 271).
  - FOLLOW pattern: the existing `thinking` field (lines 160-166) and how it rides through the
            persona factories' `...baseConfig` spread without each factory touching it. `stateless`
            rides identically — NO changes to the five persona factory bodies (createArchitectAgent,
            createResearcherAgent, createCoderAgent, createQAAgent, createCleanupAgent) are needed
            for the field to propagate. Each factory already does `{ ...baseConfig, system, mcps }`.
  - NAMING: `stateless` (lowercase boolean field, matches enableCache/enableReflection style).
  - PRESERVE: all existing fields, the `role` default 'research', the lazy resolvedHarness() accessor,
            the env-block API-key resolution. NO behavior change other than the new field.

Task 3: MODIFY src/agents/agent-factory.ts — UPDATE the createCleanupAgent JSDoc
  - FIND: the createCleanupAgent JSDoc block (lines ~423-426) currently saying:
          "(`AgentConfig` has no `session` field yet; P3.M2.T3.S1 audits/disables mechanical session
          persistence later.)"
  - REPLACE: with text reflecting S1 is DONE — cleanup is stateless via STATELESS_PERSONAS, the
          new AgentConfig.stateless field carries the invariant, and the Groundswell PiHarness gap
          (research/01) means the disable is a guarded marker today pending a harness seam.
  - WHY: the existing comment is a forward-reference to THIS task; leaving it stale is a regression.
  - PRESERVE: the rest of the createCleanupAgent JSDoc (enableReflection:false, enableCache:false,
            MCP_TOOLS divergence from commit-message agent, prompt-layer deletion protection).

Task 4: MODIFY src/agents/commit-message-agent.ts — override stateless:true + JSDoc
  - MODIFY: the config spread in createCommitMessageAgent() (lines ~101-108) — add
            `stateless: true,` alongside the existing maxTokens/enableReflection/enableCache overrides.
  - WHY: the agent reuses createBaseConfig('researcher', …); researcher is NOT in STATELESS_PERSONAS,
         so the base config has stateless:false. The commit-message agent IS single-shot, so override.
  - FOLLOW pattern: the existing overrides (maxTokens:512, enableReflection:false, enableCache:false)
         — same spread position (after ...baseConfig).
  - JSDOC: add one line to the createCommitMessageAgent JSDoc (~lines 60-97) noting it is stateless
         single-shot per PRD §9.3.2 (P3.M2.T3.S1), overriding the researcher base.
  - PRESERVE: COMMIT_MESSAGE_SYSTEM, name/system/maxTokens/enableReflection/enableCache values, the
         NO-mcps invariant, the createAgent(config) return.

Task 5: MODIFY tests/unit/agents/agent-factory.test.ts — stateless + STATELESS_PERSONAS tests
  - ADD: an `it.each([...])` test asserting `createBaseConfig(persona).stateless` for ALL FIVE
         personas (coder/qa/cleanup→true; architect/researcher→false). Declare the expected-mapping
         array INLINE (do NOT reuse the existing `personas` array at line 38, which omits `cleanup`).
  - ADD: a `STATELESS_PERSONAS` membership test — import it from the source; assert `.has(...)` for
         each persona + `size === 3`.
  - ADD: a readonly-field assertion for `stateless` (mirror the existing readonly-properties test
         at lines 129+).
  - FOLLOW pattern: the existing `it.each(personas)` (line 38) and the "should enable cache and
         reflection for all personas" test (lines 75-83).
  - COVERAGE: the inline five-persona array GUARANTEES the cleanup branch of
         STATELESS_PERSONAS.has() executes (100% coverage).
  - IMPORT: add `STATELESS_PERSONAS` to the existing `import { … } from '../../src/agents/agent-factory.js';`.

Task 6: MODIFY tests/unit/agents/commit-message-agent.test.ts — stateless:true assertion
  - ADD: one `it(...)` asserting the config passed to createAgent has `stateless === true`, using the
         existing `mockCreateAgent.mock.calls[0][0] as { stateless: boolean }` pattern (lines 76-104).
  - FOLLOW pattern: the existing "should disable reflection" (lines 85-93) / "should disable cache"
         (lines 96-104) tests — identical shape, different field.
  - NO change to the mock `createBaseConfig` return shape (lines 19-30) — the production override
         sets the field; the test asserts the override.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: pipeline-internal marker on AgentConfig (precedent = `thinking`, agent-factory.ts:160-166).
// Groundswell's AgentConfig does not model the field; the runtime object carries it anyway because
// the persona factories spread `...baseConfig`. This is the BLESSED pattern in this file — reuse it.
//
// createBaseConfig — single source of truth (NOT a per-factory manual override):
export function createBaseConfig(persona: AgentPersona, role: ModelRole = 'research'): AgentConfig {
  const { tier, thinking } = ROLE_CONFIG[role];
  const model = getModel(tier);
  const name = `${persona.charAt(0).toUpperCase() + persona.slice(1)}Agent`;
  const system = `You are a ${persona} agent.`;
  return {
    name, system, model, thinking,
    stateless: STATELESS_PERSONAS.has(persona), // ← NEW (P3.M2.T3.S1)
    harness: resolvedHarness(),
    enableCache: true, enableReflection: true,
    maxTokens: PERSONA_TOKEN_LIMITS[persona],
    env: { /* …unchanged… */ },
  };
}

// PATTERN: override for a persona-less agent (commit-message reuses 'researcher' base):
export function createCommitMessageAgent(): Agent {
  const baseConfig = createBaseConfig('researcher', 'research'); // → stateless:false (researcher)
  const config = {
    ...baseConfig,
    name: 'CommitMessageAgent',
    system: COMMIT_MESSAGE_SYSTEM,
    maxTokens: 512,
    enableReflection: false,
    enableCache: false,
    stateless: true, // ← NEW override (P3.M2.T3.S1): single-shot stagecoach
  };
  return createAgent(config);
}

// CRITICAL — what NOT to do:
// ❌ Do NOT add a `stateless` param to createBaseConfig() and have each factory pass it. That
//    duplicates STATELESS_PERSONAS and lets a factory lie. The persona IS the source of truth.
// ❌ Do NOT modify retry.ts / prp-executor.ts / prp-runtime.ts / the workflows. They consume the
//    factories unchanged. (P3.M2.T2.S2 owns retry.ts/prp-executor.ts in parallel — do not collide.)
// ❌ Do NOT monkey-patch Groundswell's PiHarness or reach into node_modules. The disable is a
//    marker; the mechanical wiring waits on a Groundswell harness seam (documented in JSDoc).
// ❌ Do NOT conflate the pipeline SessionManager (src/core/session-manager.ts, plan/ dir) with pi's
//    SessionManager (~/.pi/agent/sessions/ JSONL). S1 is about the LATTER only.
```

### Integration Points

```yaml
DATABASE:
  - none (no persistence layer touched)

CONFIG:
  - none (no .env.example, no constants.ts, no new env vars). The classification is a code constant
    (STATELESS_PERSONAS), not config — the PRD §9.3.2 list is fixed, not operator-tunable.

ROUTES:
  - none (no CLI surface change; this is an internal invariant)

UPSTREAM (Groundswell) — DOCUMENTED, NOT MODIFIED:
  - The future mechanical disable requires Groundswell's PiHarness to forward a sessionManager to
    createAgentSession(). The seam would be either:
      (a) HarnessOptions.sessionManager?: SessionManager  (harnesses.d.ts:61 — does not exist today), OR
      (b) AgentConfig gaining a session field (agent.d.ts — does not exist today).
    Once either exists, the wiring is:
      sessionManager: config.stateless ? SessionManager.inMemory(cwd) : undefined
    This is recorded in the AgentConfig.stateless JSDoc so the future change is self-evident.
    S1 does NOT make this change (blocked; out of pipeline's control).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing src/agents/agent-factory.ts and src/agents/commit-message-agent.ts:
npm run lint           # ESLint — zero errors (the new field/constant must follow existing conventions)
npm run format:check   # Prettier — zero diffs (run `npm run format` to auto-fix)
npm run typecheck      # tsc --noEmit — zero errors (the readonly field + ReadonlySet must typecheck)

# Project-wide (the validate script runs all of these):
npm run lint && npm run format:check && npm run typecheck
# Expected: GREEN. If the STATELESS_PERSONAS Set loses its generic, typecheck fails on the .has() calls.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The two modified files' unit tests:
npx vitest run tests/unit/agents/agent-factory.test.ts
npx vitest run tests/unit/agents/commit-message-agent.test.ts

# Coverage on the two modified production files MUST stay 100%:
npx vitest run tests/unit/agents/agent-factory.test.ts tests/unit/agents/commit-message-agent.test.ts \
  --coverage --coverage.include='src/agents/agent-factory.ts' --coverage.include='src/agents/commit-message-agent.ts'
# Expected: statements/branches/functions/lines ALL 100% on both files.
#   If <100%, the likely cause is the cleanup branch of STATELESS_PERSONAS.has() being uncovered
#   (fix: the inline five-persona it.each array in Task 5 must include 'cleanup').

# Full unit suite (ensure no regression in consumers — they should be unaffected since the
# factories' call signatures are unchanged):
npx vitest run tests/unit/
# Expected: GREEN.
```

### Level 3: Integration Testing (System Validation)

```bash
# This PRP adds a marker field; it does NOT change runtime behavior (Groundswell ignores the field,
# and no consumer branches on it yet). So integration tests should be UNCHANGED. Run them to confirm
# no accidental regression (e.g. an integration test that deep-asserts the exact AgentConfig shape):

npx vitest run tests/integration/prp-executor-integration.test.ts
npx vitest run tests/integration/prp-generator-integration.test.ts
npx vitest run tests/integration/prp-runtime-integration.test.ts
npx vitest run tests/integration/bug-hunt-workflow-integration.test.ts 2>/dev/null || true
# Expected: GREEN. If an integration test fails on an unexpected `stateless` property in a config
#   snapshot, that test was over-asserting; update its expected shape to include `stateless`.

# Manual invariant check (optional, documents the orphaned-session source for the future wiring):
# Before S1, every agent run writes to ~/.pi/agent/sessions/<encoded-cwd>/. S1 does NOT change this
# (the disable is blocked by Groundswell). Confirm the marker is set, not that the file is absent:
node -e "
  import('./dist/agents/agent-factory.js').then(({ createBaseConfig, STATELESS_PERSONAS }) => {
    for (const p of ['architect','researcher','coder','qa','cleanup']) {
      console.log(p, '→ stateless:', createBaseConfig(p).stateless);
    }
    console.log('STATELESS_PERSONAS size:', STATELESS_PERSONAS.size);
  });
"
# Expected: architect→false, researcher→false, coder→true, qa→true, cleanup→true; size 3.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Audit completeness check — prove EVERY createAgent() call site now resolves to a classified persona:
grep -rn "createAgent(" src/ | grep -v '\.test\.\|\.map'
# Expected: 6 sites — 5 in agent-factory.ts (the persona factories) + 1 in commit-message-agent.ts.
# Each resolves to: architect(researcher-role, NOT stateless) | researcher(NOT stateless) |
#   coder(stateless) | qa(stateless) | cleanup(stateless) | commit-message(stateless override).
# If a 7th site appears, it is UNAUDITED and MUST be classified before merge (add to STATELESS_PERSONAS
# or override).

# Confirm NO consumer was accidentally modified (this PRP is scoped to the two config-building files):
git diff --name-only
# Expected exactly:
#   src/agents/agent-factory.ts
#   src/agents/commit-message-agent.ts
#   tests/unit/agents/agent-factory.test.ts
#   tests/unit/agents/commit-message-agent.test.ts
# (plus plan/008_…/P3M2T3S1/ research/PRP artifacts, which are not source). If retry.ts,
# prp-executor.ts, or any workflow file appears, STOP — that collides with P3.M2.T2.S2 / scope creep.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed successfully.
- [ ] `npm run lint` GREEN (zero errors).
- [ ] `npm run format:check` GREEN (zero diffs).
- [ ] `npm run typecheck` GREEN (zero errors).
- [ ] `npm run test:run` GREEN (full suite).
- [ ] **100% coverage** on `src/agents/agent-factory.ts` AND `src/agents/commit-message-agent.ts`.
- [ ] `npm run validate` GREEN (the project's combined gate = lint + format:check + typecheck + test:run).
- [ ] `package.json` `dependencies` byte-identical (no new imports added).

### Feature Validation

- [ ] `AgentConfig.stateless: boolean` field exists, is `readonly`, with Mode-A JSDoc citing PRD §9.3.2 / P3.M2.T3.S1 and naming the Groundswell PiHarness gap.
- [ ] `STATELESS_PERSONAS` exported `ReadonlySet<AgentPersona>` === `{'coder','qa','cleanup'}`, with derivation JSDoc.
- [ ] `createBaseConfig('coder'|'qa'|'cleanup')` → `.stateless === true`; `('architect'|'researcher')` → `.stateless === false`.
- [ ] `createCommitMessageAgent()` config → `.stateless === true` (override).
- [ ] `createCleanupAgent` JSDoc updated (the stale "P3.M2.T3.S1 … later" forward-reference replaced with "S1 done" text).
- [ ] The six `createAgent()` call sites are the ONLY agent-creation sites (Level 4 grep confirms).
- [ ] `git diff --name-only` shows ONLY the 2 production + 2 test files (no retry.ts / prp-executor.ts / workflow collision).

### Code Quality Validation

- [ ] Follows existing patterns: `stateless` mirrors `thinking` (pipeline-internal marker); `STATELESS_PERSONAS` mirrors `PERSONA_TOKEN_LIMITS`/`ROLE_CONFIG` (readonly constant).
- [ ] File placement unchanged (no new files).
- [ ] Anti-patterns avoided: no monkey-patching Groundswell; no per-factory manual `stateless` param (single source of truth via persona); no conflation of pipeline SessionManager with pi SessionManager.
- [ ] The `stateless` field propagates through the existing `...baseConfig` spread without touching the five persona factory bodies.

### Documentation & Deployment

- [ ] Mode-A JSDoc on `AgentConfig.stateless`, `createBaseConfig`, `STATELESS_PERSONAS`, and the updated `createCleanupAgent` block — all cite PRD §9.3.2 / P3.M2.T3.S1.
- [ ] The Groundswell PiHarness gap (no `sessionManager`/`HarnessOptions` field; pi SDK supports `SessionManager.inMemory()`) is recorded in JSDoc as the required future upstream change.
- [ ] No new env vars, no config file changes, no README/docs/ edits (Mode A).

---

## Anti-Patterns to Avoid

- ❌ **Don't monkey-patch Groundswell's `PiHarness`** or reach into `node_modules/groundswell/dist/**`
     to force `SessionManager.inMemory()`. The disable is a marker today because the public API
     blocks the mechanical path; record the gap, don't hack around it.
- ❌ **Don't add a `stateless` parameter to `createBaseConfig()`** and have each persona factory pass
     it manually. That duplicates `STATELESS_PERSONAS` and lets a factory lie about its nature. The
     persona IS the single source of truth — derive via `STATELESS_PERSONAS.has(persona)`.
- ❌ **Don't modify `retry.ts`, `prp-executor.ts`, `prp-runtime.ts`, or any workflow file.** They
     consume the factories unchanged. `prp-executor.ts`/`retry.ts` are owned by the PARALLEL
     P3.M2.T2.S2 — colliding breaks both PRPs.
- ❌ **Don't conflate the pipeline `SessionManager`** (`src/core/session-manager.ts`, the
     `plan/{seq}_{hash}/` directory) with pi's `SessionManager` (`~/.pi/agent/sessions/` JSONL).
     S1 is exclusively about the latter.
- ❌ **Don't reuse the existing test `personas` array** (`['architect','researcher','coder','qa']`,
     which omits `cleanup`) for the new `it.each` stateless test — the cleanup branch would be
     uncovered and 100% coverage FAILS. Declare the five-persona expected-mapping array inline.
- ❌ **Don't skip the JSDoc.** The contract (DOCS, Mode A) explicitly requires JSDoc on
     `createBaseConfig` and `AgentConfig` noting the invariant. The Groundswell gap MUST be recorded
     there — it is the whole reason the disable is a marker, and the map for the future wiring.
- ❌ **Don't catch all exceptions / don't change error handling.** This PRP adds a typed field and a
     constant; there are no new failure modes. Leave all existing try/catch and throw sites alone.

---

## Confidence Score

**9/10** for one-pass implementation success.

Rationale: The change is small (one interface field, one constant, one override, two test additions),
follows two existing in-file precedents exactly (`thinking` for the marker pattern;
`PERSONA_TOKEN_LIMITS`/`ROLE_CONFIG` for the constant pattern), and the only subtlety — the
Groundswell API gap that makes this a marker not a switch — is fully documented with the evidence
in research/01 and baked into the JSDoc text in the Context section. The -1 is for the 100%-coverage
gotcha (the existing test `personas` array omits `cleanup`), which is explicitly called out in Task 5
and the Known Gotchas so the implementer will not trip on it. No external dependencies, no runtime
behavior change, no parallel-PR collision (scoped strictly to the two config-building files).