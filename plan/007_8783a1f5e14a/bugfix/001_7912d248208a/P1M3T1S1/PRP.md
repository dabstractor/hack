# PRP — P1.M3.T1.S1: Update model-name assertions in `tests/integration/agents.test.ts`

```yaml
result: pass
confidence: 10/10   # one-pass implementation success likelihood
scope: test-only (Mode A — no docs surface)
```

---

## Goal

**Feature Goal**: Fix four stale model-name assertions in
`tests/integration/agents.test.ts` so they match the model value actually emitted by the
agent factory (`zai/glm-5.2`), turning four currently-failing integration tests green.

**Deliverable**: The four `model: 'GLM-4.7'` assertions in
`tests/integration/agents.test.ts` changed to `model: 'zai/glm-5.2'` — no other change.

**Success Definition**: `npx vitest run tests/integration/agents.test.ts` shows the four
tests below moving from FAIL → PASS. The file's total failures drop from **6 → 2** (the
remaining 2 are out of scope — see "Scope Boundary"). No other test in the file regresses.

---

## User Persona (if applicable)

**Target User**: The hacky-hack maintainer/CI relying on `npm run validate` as a green gate.

**Use Case**: Restoring the pre-existing model-name assertions that went stale when the
default model tier changed from `GLM-4.7` to `zai/glm-5.2` in an earlier session.

**Pain Points Addressed**: Four integration tests fail purely because their asserted model
string was never updated after the model-default change, adding noise that masks real
regressions in the vitest suite (PRD §h3.2 Issue 3).

---

## Why

- **PRD §h3.2 (Issue 3)**: The full `vitest` suite is red (33 files / 223 tests failing).
  A known subset of those are stale **model-name** assertions expecting `GLM-4.7` while the
  shipped default is now `zai/glm-5.2` (PRD §9.2.3 model defaults). This subtask clears
  four of them in `tests/integration/agents.test.ts`.
- **Integration with existing features**: The agent factory (`src/agents/agent-factory.ts`)
  resolves the model via `getModel('sonnet')`; the assertions must mirror that resolved
  value, not a hardcoded stale literal.
- **Problems this solves**: Removes false-red test signal so genuine regressions (like the
  D1 auth regression tracked separately) are visible.

---

## What

Change the literal `model` value in four `expect.objectContaining({...})` blocks inside
`expect(createAgent).toHaveBeenCalledWith(...)` calls — one per persona-agent factory
test — from the stale `'GLM-4.7'` to the current resolved value `'zai/glm-5.2'`.

### Success Criteria

- [ ] All four persona-agent factory tests pass:
  - [ ] `createArchitectAgent > should create architect agent with TASK_BREAKDOWN_PROMPT`
  - [ ] `createResearcherAgent > should create researcher agent with PRP_BLUEPRINT_PROMPT`
  - [ ] `createCoderAgent > should create coder agent with PRP_BUILDER_PROMPT`
  - [ ] `createQAAgent > should create QA agent with BUG_HUNT_PROMPT`
- [ ] No assertion other than `model` is touched in this file.
- [ ] The other 17 passing tests in the file remain passing.
- [ ] The 2 out-of-scope failures (`createArchitectPrompt`, `createPRPBlueprintPrompt`) are
      left as-is — they are owned by other subtasks.

---

## Scope Boundary (READ — prevents scope creep)

This subtask touches **only** the four `model: 'GLM-4.7'` assertions. The following are
**explicitly out of scope** and must NOT be fixed here (they are owned by sibling subtasks):

| Item | Owner | Why not here |
|------|-------|--------------|
| `createBaseConfig` provider-aware assertions (~line 148-250) | P1.M2.T1.S1 (Complete) | Separate subtask; already done. |
| `enableReflection` / `responseFormat` stale assertions (other files) | P1.M3.T2.S1 (Planned) | Separate subtask. |
| `createArchitectPrompt > should create architect prompt with BacklogSchema` (~line 519) | Not this subtask | Prompt-schema assertion, NOT model-name. |
| `createPRPBlueprintPrompt > should create PRP blueprint prompt with PRPDocumentSchema` | Not this subtask | Prompt-schema assertion, NOT model-name. |
| `GLM-4.7` references in OTHER files (`agents/architect-agent-integration.test.ts`, `coder-agent.test.ts`, `qa-agent.test.ts`, `researcher-agent.test.ts`, `tests/unit/*`, `tests/manual/*`, `tests/validation/*`) | P1.M3.T1.S2 + others | Out of scope — do not touch. |

> **Net effect check**: this file currently reports `6 failed | 17 passed (23)`. After this
> subtask it must report `2 failed | 21 passed (23)`. If you see `3-5 failed`, you
> accidentally changed something beyond the four `model` literals — revert and retry.

---

## All Needed Context

### Context Completeness Check

✅ Passes "No Prior Knowledge" test: the implementer needs the exact file path, the exact
text to find, the exact replacement, the exact verification command, and the expected
before/after failure counts — all provided below with evidence gathered from `HEAD`.

### Documentation & References

```yaml
# MUST READ — model resolution chain (explains WHY the value is zai/glm-5.2)
- file: src/config/constants.ts
  why: Defines MODEL_NAMES.sonnet = 'glm-5.2' (line 47) and DEFAULT_MODEL_PROVIDER = 'zai' (line 128)
  pattern: "export const MODEL_NAMES = { opus: 'glm-5.2', ..., sonnet: 'glm-5.2', ... }"
  gotcha: "MODEL_NAMES values are UNQUALIFIED (no provider prefix); qualification happens in qualifyModel()"

- file: src/config/environment.ts
  why: getModel(tier) at lines ~149-153 is the resolver the factory uses
  pattern: |
    export function getModel(tier: ModelTier): string {
      const envVar = MODEL_ENV_VARS[tier];
      return qualifyModel(process.env[envVar] ?? MODEL_NAMES[tier]);
    }
  critical: |
    qualifyModel(name, provider) returns `name` unchanged if it already contains '/',
    else returns `${provider}/${name}`. So getModel('sonnet') → qualifyModel('glm-5.2')
    → 'zai/glm-5.2' (because 'glm-5.2' has no '/').

- file: src/agents/agent-factory.ts
  why: createBaseConfig calls getModel('sonnet') (line 165) and assigns to config.model (line 178).
        JSDoc on lines 9-19 and 143-160 documents model: 'zai/glm-5.2'.
  pattern: "const model = getModel('sonnet'); // All personas use sonnet → glm-5.2"
  critical: "The factory ALWAYS qualifies the model. Tests must expect the qualified form."

# THE TARGET FILE
- file: tests/integration/agents.test.ts
  why: Contains the four stale assertions to fix.
  pattern: |
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '<Persona>Agent',
        system: <PROMPT>,
        maxTokens: <n>,
        model: 'GLM-4.7',          // ← change this line
        enableCache: true,
        enableReflection: true,
      })
    );
  gotcha: |
    Line numbers in the contract (240, 286, 332, 378) are STALE — the file has shifted by
    +31 lines. The actual occurrences (verified at HEAD d58dd93 / this session) are at lines
    271, 317, 363, 409. DO NOT match by line number — match by the text `model: 'GLM-4.7'`.
  critical: |
    `enableReflection: true` and `enableCache: true` in these four blocks are CORRECT
    (verified via vitest diff: received config also has enableReflection: true,
    enableCache: true, maxTokens: <n>). The ONLY mismatch is `model`. Do NOT touch any
    other key in these assertions or you will mask the real (model) fix.
```

### Current Codebase tree (relevant slice)

```bash
tests/integration/
├── agents.test.ts                 # ← TARGET FILE (4 model assertions to fix)
├── agents/
│   └── architect-agent-integration.test.ts   # P1.M3.T1.S2 — OUT OF SCOPE
├── coder-agent.test.ts            # OUT OF SCOPE (other GLM-4.7 refs)
├── qa-agent.test.ts               # OUT OF SCOPE
└── researcher-agent.test.ts       # OUT OF SCOPE

src/agents/
└── agent-factory.ts               # getModel('sonnet') → 'zai/glm-5.2' (the source of truth)

src/config/
├── constants.ts                   # MODEL_NAMES.sonnet = 'glm-5.2'; DEFAULT_MODEL_PROVIDER = 'zai'
└── environment.ts                 # getModel() / qualifyModel() resolver
```

### Desired Codebase tree with files to be added and responsibility

```bash
# No files added. One file modified in place:
tests/integration/agents.test.ts   # 4 literal string updates only (model: 'GLM-4.7' → 'zai/glm-5.2')
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: Match by TEXT, not by line number.
// The contract's line numbers (240, 286, 332, 378) are stale by +31 lines.
// Verified actual lines at HEAD: 271, 317, 363, 409. Use a text match.

// CRITICAL: The four target lines are byte-identical:
//            "        model: 'GLM-4.7',"   (8 spaces of indent)
//   A single global replace within this ONE file handles all four safely.
//   Do NOT run a repo-wide replace — other files' GLM-4.7 refs are out of scope.

// CRITICAL: enableReflection: true is NOT stale in these four blocks.
//   The vitest diff proves received config matches on enableReflection, enableCache,
//   maxTokens, name, system. Only `model` differs (expected 'GLM-4.7', received 'zai/glm-5.2').
//   The PRD's "enableReflection expectation mismatches" note refers to DIFFERENT files/tests
//   owned by P1.M3.T2.S1, not these four.

// GOTCHA: The tests stub ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL but do NOT stub
//   ANTHROPIC_DEFAULT_SONNET_MODEL. That is intentional and fine — it forces getModel('sonnet')
//   to fall through to MODEL_NAMES.sonnet ('glm-5.2') → qualifyModel → 'zai/glm-5.2'.
//   Deterministic; no env-var stubbing needed in the test.
```

---

## Implementation Blueprint

### Data models and structure

None — this is a four-literal string change in a test file. No models, types, or schemas
are introduced or modified.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: UPDATE tests/integration/agents.test.ts  (single atomic change)
  - FIND: every occurrence of the exact text `        model: 'GLM-4.7',` (8-space indent)
  - REPLACE WITH: `        model: 'zai/glm-5.2',`
  - COUNT: exactly 4 occurrences (lines ~271, 317, 363, 409 — match by text, not line number)
  - GUARD: do NOT touch any other key in those objectContaining blocks (enableReflection,
    enableCache, maxTokens, name, system are all correct)
  - GUARD: do NOT touch createBaseConfig block (lines ~148-250) or prompt blocks (~440-685)
  - GUARD: do NOT touch any other file
  - PLACEMENT: in-place edit of the four existing assertion objects

Task 2: VERIFY the targeted four tests pass (no code change — validation only)
  - RUN: npx vitest run tests/integration/agents.test.ts
  - EXPECT: the four persona-agent factory tests move FAIL → PASS
  - EXPECT: file totals go from "6 failed | 17 passed (23)" → "2 failed | 21 passed (23)"
  - EXPECT the 2 remaining failures to be createArchitectPrompt + createPRPBlueprintPrompt
    (prompt-schema assertions, out of scope — leave them)

Task 3: VERIFY no collateral regressions in this file
  - RUN: npx vitest run tests/integration/agents.test.ts
  - EXPECT: the previously-passing 17 tests still pass (no new failures)
  - If failures INCREASE beyond 2, you changed more than the four literals — revert Task 1
```

### Implementation Patterns & Key Details

```typescript
// BEFORE (one of four identical blocks — the architect one shown):
expect(createAgent).toHaveBeenCalledWith(
  expect.objectContaining({
    name: 'ArchitectAgent',
    system: TASK_BREAKDOWN_PROMPT,
    maxTokens: 8192,
    model: 'GLM-4.7',          // ← stale
    enableCache: true,
    enableReflection: true,
  })
);

// AFTER — ONLY the model line changes:
expect(createAgent).toHaveBeenCalledWith(
  expect.objectContaining({
    name: 'ArchitectAgent',
    system: TASK_BREAKDOWN_PROMPT,
    maxTokens: 8192,
    model: 'zai/glm-5.2',      // ← now matches getModel('sonnet') output
    enableCache: true,
    enableReflection: true,
  })
);

// The other three blocks are identical in shape:
//   name: 'ResearcherAgent' / system: PRP_BLUEPRINT_PROMPT / maxTokens: 8192
//   name: 'CoderAgent'      / system: PRP_BUILDER_PROMPT   / maxTokens: 4096
//   name: 'QaAgent'         / system: BUG_HUNT_PROMPT      / maxTokens: 8192
// All four get the same one-line change: model: 'GLM-4.7' → 'zai/glm-5.2'.
```

### Integration Points

```yaml
DATABASE: none
CONFIG: none (the test deliberately does NOT stub ANTHROPIC_DEFAULT_SONNET_MODEL)
ROUTES: none
SOURCE CODE: none — production code (agent-factory.ts, constants.ts, environment.ts) is
             correct and must NOT be modified. Only the test literal is wrong.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# TypeScript project — no Python tooling. Use the project's own gates.
cd /home/dustin/projects/hacky-hack

# Lint the changed file only
npx eslint tests/integration/agents.test.ts
# Expected: no errors introduced by the string-literal change.

# Format check the changed file
npx prettier --check tests/integration/agents.test.ts
# Expected: passes (a string-literal swap does not affect formatting). If it complains,
# run `npx prettier --write tests/integration/agents.test.ts` and re-check.

# Type check (project-wide, as the file imports types)
npm run typecheck
# Expected: 0 errors. A string literal swap cannot introduce type errors; if any appear,
# they are pre-existing and NOT caused by this change — do not chase them here.
```

### Level 2: Unit/Integration Tests (Component Validation) — THE PRIMARY GATE

```bash
cd /home/dustin/projects/hacky-hack

# THE gate: run the target file
npx vitest run tests/integration/agents.test.ts
# Expected before:  Test Files 1 failed | ... Tests 6 failed | 17 passed (23)
# Expected after:   Test Files 1 failed | ... Tests 2 failed | 21 passed (23)
#
# The four targets that MUST flip to passing:
#   createArchitectAgent  > should create architect agent with TASK_BREAKDOWN_PROMPT
#   createResearcherAgent > should create researcher agent with PRP_BLUEPRINT_PROMPT
#   createCoderAgent      > should create coder agent with PRP_BUILDER_PROMPT
#   createQAAgent         > should create QA agent with BUG_HUNT_PROMPT
#
# The two that REMAIN failing (expected, out of scope):
#   createArchitectPrompt  > should create architect prompt with BacklogSchema
#   createPRPBlueprintPrompt > should create PRP blueprint prompt with PRPDocumentSchema

# Pinpoint run for just the four targets (sanity check they individually pass):
npx vitest run tests/integration/agents.test.ts \
  -t "should create architect agent with TASK_BREAKDOWN_PROMPT" \
  -t "should create researcher agent with PRP_BLUEPRINT_PROMPT" \
  -t "should create coder agent with PRP_BUILDER_PROMPT" \
  -t "should create QA agent with BUG_HUNT_PROMPT"
# Expected: 4 passed. (vitest -t uses substring match on the full test name.)
```

### Level 3: Integration Testing (System Validation)

```bash
# Not applicable — this is a test-only change. There is no service to start, no endpoint,
# no database, no MCP server. The "system under test" IS the agent factory, exercised by
# the integration test itself (Task/Level 2 above).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Optional regression guard: confirm the model resolution is genuinely 'zai/glm-5.2'
# by invoking the real resolver (proves the new literal is the true shipped default).
cd /home/dustin/projects/hacky-hack
npx tsx -e "import('./src/config/environment.js').then(m => console.log(m.getModel('sonnet')))"
# Expected output: zai/glm-5.2
# (This is the exact value the four assertions now expect.)

# Optional: confirm exactly 4 occurrences remain-to-fix is now 0
grep -c "GLM-4.7" tests/integration/agents.test.ts
# Expected before: 4
# Expected after:  0
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npx vitest run tests/integration/agents.test.ts` shows `2 failed | 21 passed (23)`
      (down from `6 failed | 17 passed (23)`).
- [ ] The four persona-agent factory tests (architect/researcher/coder/qa) pass.
- [ ] `npm run typecheck` has 0 errors (no new errors introduced).
- [ ] `npx eslint tests/integration/agents.test.ts` clean.
- [ ] `npx prettier --check tests/integration/agents.test.ts` passes.

### Feature Validation

- [ ] All success criteria from "What" section met (4 targets pass, no other key touched).
- [ ] `grep -c "GLM-4.7" tests/integration/agents.test.ts` returns `0`.
- [ ] The 2 prompt-schema failures are untouched (left for their owners).
- [ ] No collateral regressions in the file (17 previously-passing still pass).
- [ ] No OTHER file was modified.

### Code Quality Validation

- [ ] Change matches the existing assertion style (no new patterns introduced).
- [ ] Only the four `model` literals changed; surrounding keys unchanged.
- [ ] The `zai/glm-5.2` value is the real resolver output (verified via Level 4), not a guess.

### Documentation & Deployment

- [ ] Mode A: no docs surface — test-only change. Confirmed.

---

## Anti-Patterns to Avoid

- ❌ Don't match the assertions by line number — the contract's line numbers (240/286/332/378)
  are stale (+31). Match by the text `model: 'GLM-4.7'`.
- ❌ Don't run a repo-wide find/replace of `GLM-4.7` — 8 other files reference it and belong
  to sibling subtasks (P1.M3.T1.S2 etc.). Scope this edit to `tests/integration/agents.test.ts` only.
- ❌ Don't "fix" `enableReflection: true` while you're in there — it is correct (verified by
  the vitest diff: received config also has `enableReflection: true`). Changing it would
  break a passing assertion and is owned by P1.M3.T2.S1 elsewhere.
- ❌ Don't modify `src/agents/agent-factory.ts`, `src/config/constants.ts`, or
  `src/config/environment.ts` — production code is correct; only the test literal is stale.
- ❌ Don't chase the 2 remaining prompt-schema failures — they are expected and out of scope.
- ❌ Don't skip running `npx vitest run tests/integration/agents.test.ts` "because it's just a
  string change" — that run is the entire success criterion.
