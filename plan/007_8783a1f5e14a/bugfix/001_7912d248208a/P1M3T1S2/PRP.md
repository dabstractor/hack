# PRP — P1.M3.T1.S2: Update model-name assertions in `tests/integration/agents/architect-agent-integration.test.ts`

```yaml
result: pass
confidence: 10/10   # one-pass implementation success likelihood
scope: test-only (Mode A — no docs surface)
```

---

## Goal

**Feature Goal**: Fix the one stale model-name assertion in
`tests/integration/agents/architect-agent-integration.test.ts` so it matches the model value
actually emitted by the agent factory (`zai/glm-5.2`), and update the stale test name + comment
that still reference the old `GLM-4.7` literal. This turns the one currently-failing test in
the `'should create architect agent'` filter green.

**Deliverable**: In `tests/integration/agents/architect-agent-integration.test.ts`:
1. The test name string `'should create architect agent with GLM-4.7 model'` → `'…with zai/glm-5.2 model'` (line 168).
2. The comment `// VERIFY: createAgent called with GLM-4.7 model` → the `zai/glm-5.2` equivalent (line 186).
3. The assertion `model: 'GLM-4.7'` → `model: 'zai/glm-5.2'` (line 190).
   — No other change anywhere.

**Success Definition**: `npx vitest run tests/integration/agents/architect-agent-integration.test.ts -t 'should create architect agent'`
shows the targeted test moving FAIL → PASS, and the filter's totals go from
`1 failed | 3 passed` → `4 passed`. No other test in the file regresses.

---

## User Persona (if applicable)

**Target User**: The hacky-hack maintainer/CI relying on `npm run validate` as a green gate.

**Use Case**: Restoring the one pre-existing model-name assertion that went stale when the
default model tier changed from `GLM-4.7` to `zai/glm-5.2` in an earlier session (PRD §9.2.3).

**Pain Points Addressed**: One integration test fails purely because its asserted model
string (and its human-readable test name) were never updated after the model-default change,
adding noise that masks real regressions in the vitest suite (PRD §h3.2 Issue 3).

---

## Why

- **PRD §h3.2 (Issue 3)**: The full `vitest` suite is red (33 files / 223 tests failing). A
  known subset are stale **model-name** assertions expecting `GLM-4.7` while the shipped
  default is now `zai/glm-5.2`. This subtask clears the `architect-agent-integration.test.ts`
  instance. The sibling `agents.test.ts` instances were already cleared by P1.M3.T1.S1.
- **Integration with existing features**: The agent factory (`src/agents/agent-factory.ts →
  createBaseConfig`) resolves the model via `getModel('sonnet')`; the assertion must mirror
  that resolved value, not a hardcoded stale literal. The test *name* must match too, or a
  future reader will think the test asserts `GLM-4.7`.
- **Problems this solves**: Removes false-red test signal so genuine regressions (like the D1
  auth regression tracked separately) are visible.

---

## What

Three related edits in the same test (`describe('createArchitectAgent configuration')` → first
`it(...)`), all in `tests/integration/agents/architect-agent-integration.test.ts`:

1. **Test name** (line 168): `'…with GLM-4.7 model'` → `'…with zai/glm-5.2 model'`.
2. **Comment** (line 186): `// VERIFY: createAgent called with GLM-4.7 model` → `…with zai/glm-5.2 model`.
3. **Assertion** (line 190): `model: 'GLM-4.7',` → `model: 'zai/glm-5.2',`.

### Success Criteria

- [ ] The targeted test passes: `createArchitectAgent configuration > should create architect agent with zai/glm-5.2 model`.
- [ ] The `-t 'should create architect agent'` filter reports `4 passed` (was `1 failed | 3 passed`).
- [ ] No other key in the target `objectContaining` block is touched (see Scope Boundary).
- [ ] The remaining tests in the file are unchanged in count/behavior (the out-of-scope
      `enableReflection`/`responseFormat`/prompt-content failures stay as-is for their owners).
- [ ] `grep -c "GLM-4.7" tests/integration/agents/architect-agent-integration.test.ts` returns `0`.

---

## Scope Boundary (READ — prevents scope creep)

This subtask touches **only** the single `model` literal + its test-name string + its comment,
all inside the first test of the `createArchitectAgent configuration` group. The following are
**explicitly out of scope** and must NOT be fixed here (they are owned by sibling subtasks):

| Item | Location (this file) | Owner | Why not here |
|------|----------------------|-------|--------------|
| `enableReflection: true` / `responseFormat` stale assertions | lines ~360, 378, 401 (Test Group 3, `createArchitectPrompt`) | P1.M3.T2.S1 (Planned) | These assert the **prompt** creator's contract, which omits reflection by design. NOT a model assertion. |
| `TASK_BREAKDOWN_PROMPT > should contain Research-Driven Architecture section` prompt-content drift | ~line 450 | P1.M3.T2.S1 / separate triage | Prompt body drift, not model-name. |
| `GLM-4.7` references in OTHER files (`agents.test.ts`, `coder-agent.test.ts`, `qa-agent.test.ts`, `researcher-agent.test.ts`, `tests/unit/*`, `tests/manual/*`, `tests/validation/*`) | n/a | P1.M3.T1.S1 (done) + others | Out of scope — do not touch. |

> **CRITICAL — do NOT confuse the two `enableReflection: true` sites in this file:**
> - The `enableReflection: true` **inside the target model test's `objectContaining` block**
>   (~line 178) is **CORRECT** and must stay. `createBaseConfig()` returns `enableReflection: true`
>   for the agent (verified: the test currently passes on every field except `model`). Touching it
>   will break a currently-passing assertion.
> - The stale `enableReflection` assertions at lines ~360/378/401 belong to the **prompt** tests
>   (`createArchitectPrompt`), which omit reflection by design (`src/agents/prompts/architect-prompt.ts:70`).
>   Those are out of scope here.
>
> **Net effect check**: the `-t 'should create architect agent'` filter currently reports
> `1 failed | 3 passed`. After this subtask it must report `4 passed`. If you see a different
> number of failures you changed more than the three intended edits — revert and retry.

---

## All Needed Context

### Context Completeness Check

✅ Passes "No Prior Knowledge" test: the implementer needs the exact file path, the exact three
text locations to find, the exact replacements, the exact verification command, and the expected
before/after counts — all provided below with evidence gathered live against the current tree.

### Documentation & References

```yaml
# MUST READ — model resolution chain (explains WHY the value is zai/glm-5.2)
- file: src/config/constants.ts
  why: Defines MODEL_NAMES.sonnet = 'glm-5.2' (unqualified) and DEFAULT_MODEL_PROVIDER = 'zai'.
  pattern: "export const MODEL_NAMES = { opus: 'glm-5.2', ..., sonnet: 'glm-5.2', ... }"
  gotcha: "MODEL_NAMES values are UNQUALIFIED (no provider prefix); qualification happens in qualifyModel()."

- file: src/config/environment.ts
  why: getModel(tier) is the resolver the factory uses.
  pattern: |
    export function getModel(tier: ModelTier): string {
      return qualifyModel(process.env[MODEL_ENV_VARS[tier]] ?? MODEL_NAMES[tier]);
    }
  critical: |
    qualifyModel(name, provider) returns `name` unchanged if it already contains '/', else
    returns `${provider}/${name}`. So getModel('sonnet') → qualifyModel('glm-5.2') → 'zai/glm-5.2'.
    (Already independently verified by sibling P1.M3.T1.S1's Level-4 gate: prints `zai/glm-5.2`.)

- file: src/agents/agent-factory.ts
  why: createBaseConfig(persona) calls getModel('sonnet') and assigns it to config.model; the
        JSDoc (lines ~9-19, 143-160) literally states `model: 'zai/glm-5.2'`. It also returns
        enableReflection: true, enableCache: true, maxTokens = PERSONA_TOKEN_LIMITS[persona]
        (architect → 8192). This proves every field EXCEPT model already matches the test.
  pattern: "const model = getModel('sonnet'); // All personas use sonnet → glm-5.2"
  critical: "The factory ALWAYS qualifies the model. Tests must expect the qualified form 'zai/glm-5.2'."

# THE TARGET FILE
- file: tests/integration/agents/architect-agent-integration.test.ts
  why: Contains the one stale model assertion (+ stale test name + stale comment) to fix.
  pattern: |
    // Line 168 — TEST NAME (human-readable, referenced by `vitest -t`)
    it('should create architect agent with GLM-4.7 model', async () => {
      ...
      // Line 186 — COMMENT
      // VERIFY: createAgent called with GLM-4.7 model
      expect(gs.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'ArchitectAgent',
          model: 'GLM-4.7',          // ← line 190, the ONLY stale field
          system: TASK_BREAKDOWN_PROMPT,
          maxTokens: 8192,
          enableCache: true,
          enableReflection: true,
        })
      );
    });
  gotcha: |
    Match by TEXT, not by line number — line numbers are session-snapshot approximations.
    Verified current lines at HEAD: 168 (name), 186 (comment), 190 (assertion).
  critical: |
    `enableCache: true`, `enableReflection: true`, `maxTokens: 8192`, `name`, and `system`
    in this block are ALL CORRECT. Proven empirically: running the filter today yields
    `1 failed | 3 passed` — the lone failure is this test, and the vitest diff shows the
    received config matches on every field except `model` (expected 'GLM-4.7',
    received 'zai/glm-5.2'). Change ONLY the `model` literal (plus the name/comment text).
```

### Current Codebase tree (relevant slice)

```bash
tests/integration/
├── agents.test.ts                              # P1.M3.T1.S1 — DONE (cleared)
└── agents/
    └── architect-agent-integration.test.ts     # ← TARGET FILE (this subtask)

src/agents/
├── agent-factory.ts                            # getModel('sonnet') → 'zai/glm-5.2' (source of truth)
└── prompts/
    └── architect-prompt.ts                     # OUT OF SCOPE (enableReflection/responseFormat drift)

src/config/
├── constants.ts                                # MODEL_NAMES.sonnet = 'glm-5.2'; provider = 'zai'
└── environment.ts                              # getModel() / qualifyModel() resolver
```

### Desired Codebase tree with files to be added and responsibility

```bash
# No files added. One file modified in place:
tests/integration/agents/architect-agent-integration.test.ts
  # 3 in-place edits (test name + comment + model literal), all in the first test of the
  # 'createArchitectAgent configuration' group.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: Match by TEXT, not by line number.
// Line numbers are a snapshot; use grep/text matching for the 3 edits.

// CRITICAL: There are exactly THREE occurrences of "GLM-4.7" in this file, all in ONE test:
//   line 168  — it('should create architect agent with GLM-4.7 model', ...)   (test name)
//   line 186  — // VERIFY: createAgent called with GLM-4.7 model              (comment)
//   line 190  — model: 'GLM-4.7',                                            (the assertion)
//   A scoped replace of 'GLM-4.7' → 'zai/glm-5.2' within this ONE file handles all three.
//   Do NOT run a repo-wide replace — other files' GLM-4.7 refs belong to other subtasks.

// CRITICAL: enableReflection: true on line ~178 of THIS block is NOT stale.
//   It is correct: createBaseConfig() returns enableReflection: true for the AGENT config.
//   (The stale enableReflection assertions flagged in the triage doc are at lines 360/378/401,
//   in the createArchitectPrompt tests — owned by P1.M3.T2.S1. Not here.)

// CRITICAL: Do not rename the test to '…with GLM-5.2 model' — use the fully-qualified
//   'zai/glm-5.2' so the test name matches the exact assertion value and the shipped default.

// GOTCHA: The test does NOT stub ANTHROPIC_DEFAULT_SONNET_MODEL. That is intentional — it
//   forces getModel('sonnet') to fall through to MODEL_NAMES.sonnet ('glm-5.2') → qualifyModel
//   → 'zai/glm-5.2'. Deterministic; no env-var stubbing needed.
```

---

## Implementation Blueprint

### Data models and structure

None — this is a three-literal text change in a test file (one assertion + its name + comment).
No models, types, or schemas are introduced or modified.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: UPDATE tests/integration/agents/architect-agent-integration.test.ts  (single atomic change)
  - FIND: every occurrence of the exact text `GLM-4.7` in this file (exactly 3, all in one test)
  - REPLACE WITH: `zai/glm-5.2`  (same replacement for all three — name, comment, assertion)
  - DETAILS (match by text, current line numbers shown for orientation):
      line 168:  'should create architect agent with GLM-4.7 model'
               → 'should create architect agent with zai/glm-5.2 model'
      line 186:  // VERIFY: createAgent called with GLM-4.7 model
               → // VERIFY: createAgent called with zai/glm-5.2 model
      line 190:  model: 'GLM-4.7',
               → model: 'zai/glm-5.2',
  - GUARD: do NOT touch any other key in that objectContaining block (enableReflection,
    enableCache, maxTokens, name, system are all correct — empirically verified)
  - GUARD: do NOT touch the createArchitectPrompt tests (lines ~340-420) — their
    enableReflection/responseFormat assertions are out of scope (P1.M3.T2.S1)
  - GUARD: do NOT touch any other file

Task 2: VERIFY the targeted test passes (validation only — no code change)
  - RUN: npx vitest run tests/integration/agents/architect-agent-integration.test.ts -t 'should create architect agent'
  - EXPECT before:  Tests 1 failed | 3 passed   (the 4 tests in the 'createArchitectAgent configuration' group)
  - EXPECT after:   Tests 4 passed
  - The one target that MUST flip to passing:
      createArchitectAgent configuration > should create architect agent with zai/glm-5.2 model

Task 3: VERIFY no collateral regressions in this file
  - RUN: npx vitest run tests/integration/agents/architect-agent-integration.test.ts -t 'should create architect agent'
  - EXPECT: the previously-passing 3 tests (8192 max tokens, cache enabled, reflection enabled) still pass
  - If failures INCREASE beyond the prior out-of-scope set, you changed more than intended — revert Task 1
```

### Implementation Patterns & Key Details

```typescript
// BEFORE (the first test in 'createArchitectAgent configuration'):
it('should create architect agent with GLM-4.7 model', async () => {   // ← line 168, stale name
  ...
  // VERIFY: createAgent called with GLM-4.7 model                       // ← line 186, stale comment
  expect(gs.createAgent).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'ArchitectAgent',
      model: 'GLM-4.7',                                                  // ← line 190, stale assertion
      system: TASK_BREAKDOWN_PROMPT,
      maxTokens: 8192,
      enableCache: true,
      enableReflection: true,                                            // ← CORRECT, do NOT touch
    })
  );
});

// AFTER — three text swaps, nothing else:
it('should create architect agent with zai/glm-5.2 model', async () => {
  ...
  // VERIFY: createAgent called with zai/glm-5.2 model
  expect(gs.createAgent).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'ArchitectAgent',
      model: 'zai/glm-5.2',
      system: TASK_BREAKDOWN_PROMPT,
      maxTokens: 8192,
      enableCache: true,
      enableReflection: true,                                            // unchanged
    })
  );
});
```

### Integration Points

```yaml
DATABASE: none
CONFIG: none (the test deliberately does NOT stub ANTHROPIC_DEFAULT_SONNET_MODEL)
ROUTES: none
SOURCE CODE: none — production code (agent-factory.ts, constants.ts, environment.ts) is
             correct and must NOT be modified. Only the test literal/name/comment are stale.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# TypeScript project — use the project's own gates. cd to repo root.
cd /home/dustin/projects/hacky-hack

# Lint the changed file only
npx eslint tests/integration/agents/architect-agent-integration.test.ts
# Expected: no errors introduced by the text change.

# Format check the changed file
npx prettier --check tests/integration/agents/architect-agent-integration.test.ts
# Expected: passes (a literal/name swap does not affect formatting). If it complains,
# run `npx prettier --write tests/integration/agents/architect-agent-integration.test.ts` and re-check.

# Type check (project-wide — the file imports types from src/)
npm run typecheck
# Expected: 0 NEW errors. A text swap cannot introduce type errors; if any appear, they are
# pre-existing and NOT caused by this change — do not chase them here.
```

### Level 2: Unit/Integration Tests (Component Validation) — THE PRIMARY GATE

```bash
cd /home/dustin/projects/hacky-hack

# THE gate: run the contract's exact filter (substring match on the full test name)
npx vitest run tests/integration/agents/architect-agent-integration.test.ts -t 'should create architect agent'
# Expected before: Tests 1 failed | 3 passed   (the 4 tests in 'createArchitectAgent configuration')
# Expected after:  Tests 4 passed
#
# The one target that MUST flip to passing:
#   createArchitectAgent configuration > should create architect agent with zai/glm-5.2 model
#
# The three that were already passing and must stay passing:
#   createArchitectAgent configuration > should create architect agent with 8192 max tokens
#   createArchitectAgent configuration > should create architect agent with cache enabled
#   createArchitectAgent configuration > should create architect agent with reflection enabled

# (Optional) pinpoint just the renamed test by its new name:
npx vitest run tests/integration/agents/architect-agent-integration.test.ts \
  -t "should create architect agent with zai/glm-5.2 model"
# Expected: 1 passed.
```

### Level 3: Integration Testing (System Validation)

```bash
# Not applicable — this is a test-only change. There is no service to start, no endpoint,
# no database, no MCP server. The "system under test" IS the agent factory, exercised by the
# integration test itself (Task/Level 2 above).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Optional: confirm the model resolution is genuinely 'zai/glm-5.2' (proves the new literal is
# the true shipped default, not a guess). (Already proven by sibling P1.M3.T1.S1; re-run for certainty.)
cd /home/dustin/projects/hacky-hack
npx tsx -e "import('./src/config/environment.js').then(m => console.log(m.getModel('sonnet')))"
# Expected output: zai/glm-5.2

# Confirm zero GLM-4.7 references remain in the target file
grep -c "GLM-4.7" tests/integration/agents/architect-agent-integration.test.ts
# Expected before: 3
# Expected after:  0
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npx vitest run tests/integration/agents/architect-agent-integration.test.ts -t 'should create architect agent'`
      reports `4 passed` (was `1 failed | 3 passed`).
- [ ] The targeted test `…with zai/glm-5.2 model` passes.
- [ ] `npm run typecheck` introduces 0 new errors.
- [ ] `npx eslint tests/integration/agents/architect-agent-integration.test.ts` clean.
- [ ] `npx prettier --check tests/integration/agents/architect-agent-integration.test.ts` passes.

### Feature Validation

- [ ] All success criteria from "What" section met (1 assertion fixed; name + comment updated).
- [ ] `grep -c "GLM-4.7" tests/integration/agents/architect-agent-integration.test.ts` returns `0`.
- [ ] The out-of-scope `enableReflection`/`responseFormat`/prompt-content failures (lines ~360/378/401/450)
      are left untouched for P1.M3.T2.S1.
- [ ] No collateral regressions (the 3 previously-passing config tests still pass).
- [ ] No OTHER file was modified.

### Code Quality Validation

- [ ] Change matches the existing assertion style (no new patterns introduced).
- [ ] Only the `model` literal + its test name + its comment changed; surrounding keys unchanged.
- [ ] The `zai/glm-5.2` value is the real resolver output (verified via Level 4), not a guess.

### Documentation & Deployment

- [ ] Mode A: no docs surface — test-only change. Confirmed.

---

## Anti-Patterns to Avoid

- ❌ Don't match the edits by line number alone — use text matching (`GLM-4.7`). Line numbers are a snapshot.
- ❌ Don't run a repo-wide find/replace of `GLM-4.7` — other files (agents.test.ts, coder/qa/researcher
  agent tests, unit/manual/validation tests) belong to sibling subtasks. Scope this edit to
  `tests/integration/agents/architect-agent-integration.test.ts` only.
- ❌ Don't rename the test to `…with GLM-5.2 model` — use the fully-qualified `zai/glm-5.2` so the
  name matches the exact assertion value and shipped default.
- ❌ Don't "fix" `enableReflection: true` while you're in the target block — it is CORRECT for the
  agent config (verified: the test passes on every field except `model`). The stale
  enableReflection assertions live at lines ~360/378/401 in the `createArchitectPrompt` tests and
  are owned by P1.M3.T2.S1.
- ❌ Don't modify `src/agents/agent-factory.ts`, `src/agents/prompts/architect-prompt.ts`,
  `src/config/constants.ts`, or `src/config/environment.ts` — production code is correct; only the
  test literal/name/comment are stale.
- ❌ Don't skip running the vitest filter "because it's just a string change" — that run IS the
  entire success criterion.
