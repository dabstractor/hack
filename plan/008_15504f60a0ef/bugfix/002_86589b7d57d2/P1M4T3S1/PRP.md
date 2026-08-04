# PRP — P1.M4.T3.S1: Fix coder-agent.test.ts (vi.mock hoisting + model rot + 2 more verified causes)

> Bugfix 002 · **BUG-004 (MAJOR) — Category (b) test-rot.** `tests/integration/coder-agent.test.ts`
> is red: **24 failed | 6 passed (30)**. The item contract names two causes (hoisting + model rot);
> a **live run proves FOUR** distinct test-only causes (see §"4-Cause Map"). All four are test-rot —
> the production code (`src/agents/prp-executor.ts`, `src/agents/agent-factory.ts`,
> `src/core/checkpoint-manager.ts`) is **in-spec**. Every fix here is test-only (rule 5):
> `git diff --stat -- src/` MUST stay empty.

> **Parallel-coordination:** This item is INDEPENDENT of P1.M4.T2.S2 (it edits
> `coder-agent.test.ts` only; P1.M4.T2.S2 edits a disjoint set of integration files and the
> shared helper). No file overlap. It does NOT consume `tests/helpers/research-seam.ts`
> (the config suite needs only the `groundswell` mock it already has; the executor suites need
> only a temp dir). Do NOT touch any file owned by P1.M4.T3.S2/S3 (pipeline-main-loop, qa-agent,
> researcher-agent, prd-task-command, prp-blueprint-agent, task-breakdown-prompt).

---

## Goal

**Feature Goal**: Drive `tests/integration/coder-agent.test.ts` to green (and add one split-off
config file) by fixing the four verified test-only causes, so this file stops contributing its
24 failures to the §4.4 `validate.sh` abort-on-failure gate.

**Deliverable** (test-only; NO `src/` changes; ONE new test file + edits to the existing one):
1. **NEW** `tests/integration/coder-agent-config.test.ts` — the 7-test `createCoderAgent
   configuration` suite extracted into its own file (no agent-factory mock), with the corrected
   `model:'zai/glm-5-turbo'` assertion.
2. **EDIT** `tests/integration/coder-agent.test.ts` — remove Suite 2 (now in the new file); add a
   shared temp-dir `sessionPath` for Suites 3–8 (CheckpointManager isolation); correct the one
   stale prompt-injection assertion.

**Success Definition**:
- `npx vitest run tests/integration/coder-agent.test.ts` → **0 failed (30/30 split as 23 here)**.
- `npx vitest run tests/integration/coder-agent-config.test.ts` → **0 failed (7/7)**.
- Whole suite failure count strictly decreases; no previously-green file newly red.
- `npm run typecheck && npm run lint && npm run format:check` clean on the two files.
- `git diff --stat -- src/` is **EMPTY** (rule 5: test-only corrective).

## User Persona (if applicable)

**Target User**: The pipeline maintainer + the §4.4 validation-gate path. End users unaffected.

**Use Case**: "The coder-agent integration suite is red (24/30). Two causes are known (hoisting,
model rot); research found two more (a stale tracked checkpoint file colliding via
`process.cwd()`, and prompt-object drift). Make the file green test-only — do NOT change
production, do NOT weaken assertions."

**User Journey**:
1. Create `coder-agent-config.test.ts` from the extracted Suite 2 (groundswell mock only) + fix model.
2. Remove Suite 2 from `coder-agent.test.ts` (kills the hoisting collision).
3. Add temp-dir `sessionPath` for the executor suites (kills the checkpoint collision).
4. Fix the one prompt-injection assertion (kills the prompt-object drift).
5. Re-run both files → green; run the whole suite → failure count drops.

**Pain Points Addressed**: 24 of the 178 suite-wide failures; a subtle hoisting trap that silently
neutralized the entire config suite; and a stale-artifact collision that made every executor test
return `{success:false}` regardless of the (correct) implementation.

## Why

- **Unblocks the §4.4 validate gate (BUG-004).** This file alone is 24 failures.
- **Corrective, not feature work.** Rule 5 explicitly permits fixing stale-test expectations and
  test-isolation rot without a PRP. No PRD/feature change; no new behavior.
- **Splits a genuine mock-collision, not papered over.** Suite 2 needs the REAL `createCoderAgent`
  (to assert the config via the mocked `gs.createAgent`); Suites 3–8 need a MOCKED
  `createCoderAgent`. Those are incompatible module-level mock setups → the robust fix is two files.

## What

Fix all four verified causes, test-only:

| Cause | Where | Fix |
|-------|-------|-----|
| **(1) vi.mock hoisting collision** | Suite 2 (7 tests) | Extract Suite 2 to `coder-agent-config.test.ts` (no agent-factory mock). |
| **(2) model rot** | Suite 2, model test | `'GLM-4.7'` → `'zai/glm-5-turbo'`. |
| **(3) CheckpointManager stale-file collision** | Suites 3–8 (16 tests) | Use a fresh `mkdtempSync` temp dir as `sessionPath`, not `process.cwd()`. |
| **(4) prompt-object drift** | Suite 3 test 1 | Assert on `gs.createPrompt` call args (`user` contains `prpPath`); drop the stale string checks. |

### Success Criteria

- [ ] `coder-agent.test.ts` passes 0 failed; `coder-agent-config.test.ts` passes 0 failed.
- [ ] No assertion weakened or deleted to force green (except the 4 stale prompt lines, replaced
      with an equivalent-or-stronger assertion on the real injection point).
- [ ] `git diff --stat -- src/` empty; typecheck/lint/format clean on both files.
- [ ] Whole-suite failure count strictly decreases; no previously-green file newly red.

## All Needed Context

### Context Completeness Check

If an implementer knew nothing about this codebase, would they have everything needed? **Yes.**
This PRP states the verified 24/6 baseline, each of the 4 causes with its exact `src:line`, the
model-resolution chain with source citations, why the split needs no harness-seam mock, the
per-suite `beforeEach` insertion points, the temp-dir convention to mirror, the precise stale
assertion block to replace, and the per-file validation command.

### Documentation & References

```yaml
# MUST READ — this item's own research (verified 4-cause map + line-by-line executor audit)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T3S1/research/findings.md
  why: §"Cause map" (which tests → which cause); §"Model resolution chain"; §"Why split is safe";
       §"Line-by-line audit" proving the executor assertions are otherwise correct; §"Fix design".
  section: all sections load-bearing.

# MUST READ — the authoritative BUG-004 category map (names causes 1 & 2; this PRP adds 3 & 4)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-004-test-suite.md
  why: Category (b) `coder-agent.test.ts(24)` entry — confirms hoisting + model rot, confirms
       "None of these are production-runtime defects" (rule 5 applies).
  section: "Category (b) — Test-rot".

# ── SRC under test (READ-ONLY — do NOT modify) ──
- file: src/agents/agent-factory.ts
  why: createCoderAgent() (line ~"export function createCoderAgent") → createBaseConfig('coder','implementation').
       createBaseConfig reads ROLE_CONFIG[role].tier → getModel(tier); sets enableCache:true,
       enableReflection:true, maxTokens: PERSONA_TOKEN_LIMITS[persona]; stateless for coder.
       MCP_TOOLS = [BASH_MCP, FILESYSTEM_MCP, GIT_MCP] (length 3). name = `${Persona}Agent`.
       resolvedHarness() lazily runs configureEnvironment()+configureHarness() (safe for pi+zai).
  gotcha: The groundswell mock spreads `actual`, so configureHarnesses() inside configureHarness()
          is the REAL fn — fine. createAgent is the MOCKED boundary that captures the config.
- file: src/config/environment.ts
  why: getModel(tier) (line 237): PRP_MODEL_FAST env? no → LEGACY? no → qualifyModel(MODEL_NAMES[tier]).
       qualifyModel(name, 'zai') → name.includes('/') ? name : `zai/${name}` ⇒ 'zai/glm-5-turbo'.
  gotcha: getResolvedProvider() = getModel('balanced').split('/')[0] ⇒ 'zai' (default). Do NOT assert
          a harness-qualified string; the AgentConfig.model is provider-qualified only.
- file: src/config/constants.ts
  why: MODEL_NAMES.fast = 'glm-5-turbo' (line ~47); DEFAULT_MODEL_PROVIDER = 'zai' (line 159);
       PERSONA_TOKEN_LIMITS lives in agent-factory.ts (coder: 4096 — already correct).
- file: src/config/harness.ts
  why: configureHarness() does NOT throw for pi+zai (the only forbidden combo is claude-code+zai).
       Registers PiHarness idempotently (registry.has('pi') guard). ⇒ split config file needs no
       harness-seam mock / no initRealHarness.
- file: src/agents/prp-executor.ts
  why: execute() (a) builds `injectedPrompt = createPrompt({user:`Execute the PRP located at: ${prpPath}…`,
       responseFormat})` (~line 455) — a Prompt OBJECT, not a string; (b) calls saveCheckpoint() which
       writes to `<sessionPath>/artifacts/<taskId>/checkpoints.json`; (c) #runValidationGates `break`s
       on first failure; (d) fix-loop `while(fixAttempts<=2)` → fixAttempts===2 on exhaustion;
       (e) gates set timedOut on every result (so FRESH writes satisfy CheckpointFileSchema).
  gotcha: execute() try/catches saveCheckpoint failures and returns {success:false, validationResults:[],
          fixAttempts:0} — which is why ALL 16 executor tests fail identically (they never reach the
          agent/validation path), masquerading as "everything broken".
- file: src/core/checkpoint-manager.ts
  why: #getCheckpointPath(taskId) = resolve(sessionPath,'artifacts',taskId,'checkpoints.json') (line 623).
       saveCheckpoint() (line ~389): if existsSync(path) → readFile + CheckpointFileSchema.parse(stale)
       → THROWS at line 398 when a pre-`timedOut` file is present (validationResults[].timedOut Required).
  gotcha: The stale file `artifacts/P1.M2.T2.S2/checkpoints.json` is git-tracked; ALL tests reuse
          taskId 'P1.M2.T2.S2' + sessionPath cwd ⇒ all hit the SAME stale file. A temp-dir sessionPath
          sidesteps it entirely (fresh path, no stale collision, no project pollution).

# ── Test under edit (READ + EDIT) ──
- file: tests/integration/coder-agent.test.ts
  why: Suite 1 (5, keep), Suite 2 (7, EXTRACT), Suites 3–8 (18, keep + isolate + fix 1 assertion).
       Top-level mocks: groundswell (keep) + agent-factory (keep; collision-free once Suite 2 leaves).
       `createMockAgentResponse`, `loadGroundswell`, `createMockPRPDocument` helpers (keep/reuse).
  gotcha: Suite 2's `gs` is scoped to its own describe; the executor suites do NOT have `gs` in scope
          — to assert on `gs.createPrompt` in Suite 3 test 1, call `const gs = await loadGroundswell();`
          inside that test (the module-level groundswell mock is already wired).

# ── New file (mirror the existing file's own groundswell-mock pattern) ──
- file: tests/integration/coder-agent-config.test.ts  (NEW)
  why: Self-contained copy of the groundswell mock + Suite 2 (dynamic-import real createCoderAgent).
  pattern: identical to the existing top-of-file groundswell vi.mock + loadGroundswell() + beforeAll.

# ── Temp-dir convention to mirror (READ-ONLY templates) ──
- file: tests/integration/pipeline-main-loop.test.ts
  why: line 24 `import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';` + tmpdir pattern.
- file: tests/integration/cli-task-status.test.ts
  why: `import { tmpdir } from 'node:os';` + `mkdtemp(join(tmpdir(),'prefix-'))` in beforeEach.

# ── vitest mocking reference ──
- url: https://vitest.dev/guide/mocking.html#hoisting
  why: confirms vi.mock() is ALWAYS hoisted to file top regardless of where it's written — the
       mechanical reason Cause 1 cannot be fixed in-file by "moving" the mock. (vitest 1.6.1 here.)
```

### Current Codebase tree (the files this item touches + READ-ONLY src)

```bash
tests/integration/coder-agent.test.ts          # EDIT (remove Suite 2; isolate Suites 3–8; fix 1 assertion)
tests/integration/coder-agent-config.test.ts   # NEW  (Suite 2 extracted; model assertion fixed)
src/                                            # READ-ONLY (rule 5: test-only corrective)
  agents/agent-factory.ts                       # READ — createCoderAgent / createBaseConfig / ROLE_CONFIG
  agents/prp-executor.ts                        # READ — execute() / saveCheckpoint path / prompt object
  config/environment.ts                         # READ — getModel / qualifyModel
  config/constants.ts                           # READ — MODEL_NAMES.fast / DEFAULT_MODEL_PROVIDER
  config/harness.ts                             # READ — configureHarness (safe for pi+zai)
  core/checkpoint-manager.ts                    # READ — #getCheckpointPath / stale-file re-parse
```

### Desired Codebase tree with files to be added

```bash
tests/integration/coder-agent-config.test.ts   # NEW — 7 config tests, groundswell mock only
# coder-agent.test.ts is EDITED in place (no structural tree change beyond losing Suite 2).
# Research notes already at:
#   plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T3S1/research/findings.md
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — vi.mock('../../src/agents/agent-factory.js') is HOISTED to file top no matter where it's
//   written. It therefore mocks createCoderAgent for EVERY suite in the file, including the config
//   suite that needs the REAL factory. ⇒ CANNOT be fixed in-file by relocating the mock. SPLIT files.

// CRITICAL — AgentConfig.model is PROVIDER-qualified ('zai/glm-5-turbo'), NOT harness-qualified and
//   NOT bare ('glm-5-turbo'). getModel('fast') → qualifyModel('glm-5-turbo','zai'). Assert the FULL
//   'zai/glm-5-turbo'. (maxTokens:4096 is already correct — do not change it.)

// CRITICAL — new PRPExecutor(sessionPath) writes checkpoints to `<sessionPath>/artifacts/<taskId>/checkpoints.json`.
//   With sessionPath=process.cwd() and taskId 'P1.M2.T2.S2', it collides with a STALE git-tracked file
//   (pre-`timedOut`) → CheckpointFileSchema.parse throws → execute() returns {success:false,…} for ALL
//   executor tests. ⇒ Use a fresh mkdtempSync temp dir per test; never process.cwd().

// CRITICAL — the executor passes a Prompt OBJECT (createPrompt({user,…})) to coderAgent.prompt(), not
//   a string. createPrompt is the mocked gs.createPrompt (returns undefined). ⇒ Assert the prpPath is
//   in the createPrompt call's `user` arg; do NOT assert `typeof promptArg === 'string'`.

// CRITICAL (all) — NEVER weaken an assertion to force green, and NEVER edit src/ to match a stale test.
//   The 4 stale prompt lines are REPLACED with an equivalent-or-stronger assertion on the real injection
//   point (gs.createPrompt user contains prpPath), not deleted.
```

## Implementation Blueprint

### Data models and structure

No production data models change. The new file reuses the existing test helpers
(`createMockAgentResponse`, `loadGroundswell`, the groundswell mock factory) verbatim — copy them
into the new file (self-contained, per repo convention that each file keeps its own top-level mocks).

### Implementation Tasks (ordered by dependencies)

```yaml
# ═════════════════════ TASK 1 — EXTRACT Suite 2 into coder-agent-config.test.ts ═════════════════════
Task 1: CREATE tests/integration/coder-agent-config.test.ts
  - COPY into it (self-contained): the vitest import block; the `createMockAgentResponse` helper;
    the top-level `vi.mock('groundswell', async () => { const actual = await vi.importActual('groundswell');
    return { ...actual, createAgent: vi.fn().mockReturnValue({id,name,prompt:vi.fn()}), createPrompt: vi.fn() }; })`;
    the `loadGroundswell()` helper; and `import { PRP_BUILDER_PROMPT } from '../../src/agents/prompts.js';`
    (needed by the 'should use PRP_BUILDER_PROMPT as system prompt' test).
  - DO NOT include the `vi.mock('../../src/agents/agent-factory.js')` mock (that is the whole point).
  - MOVE the entire `describe('integration/coder-agent > createCoderAgent configuration', …)` block
    (the 7 tests, currently at lines ~230–345 of coder-agent.test.ts) into this new file.
  - FIX the model assertion in 'should create coder agent with GLM-4.7 model':
      OLD:  expect(gs.createAgent).toHaveBeenCalledWith(expect.objectContaining({ model: 'GLM-4.7' }));
      NEW:  expect(gs.createAgent).toHaveBeenCalledWith(expect.objectContaining({ model: 'zai/glm-5-turbo' }));
    (and rename the test title 'GLM-4.7' → 'zai/glm-5-turbo' for accuracy).
  - KEEP all 7 tests' bodies otherwise identical (4096 tokens, enableCache:true, enableReflection:true,
    mcps Array length 3, system: PRP_BUILDER_PROMPT, name:'CoderAgent'). Each test dynamically imports
    `const { createCoderAgent } = await import('../../src/agents/agent-factory.js');` — the REAL factory
    (no mock) → calls the mocked gs.createAgent with the real config.
  - VERIFY: npx vitest run tests/integration/coder-agent-config.test.ts → 7 passed, 0 failed.

# ═════════════════════ TASK 2 — Remove Suite 2 from coder-agent.test.ts ═════════════════════
Task 2: EDIT tests/integration/coder-agent.test.ts
  - DELETE the entire `describe('integration/coder-agent > createCoderAgent configuration', …)` block
    (Suite 2, the 7 tests). It now lives in the new file.
  - KEEP: Suite 1 (PRP_BUILDER_PROMPT structure); the top-level groundswell vi.mock; the top-level
    agent-factory vi.mock (now collision-free — it only applies to Suites 3–8, which WANT it);
    `createMockAgentResponse`, `loadGroundswell`, `createMockPRPDocument`; the `mockCreateCoderAgent`
    wiring; Suites 3–8.
  - RESULT: the agent-factory mock no longer sabotages any real-factory suite (there is none left).
  - DO NOT delete the `createMockAgentResponse`/`loadGroundswell`/`createMockPRPDocument` helpers
    (Suites 3–8 + the prompt fix still use them).

# ═════════════════════ TASK 3 — Isolate CheckpointManager via a temp-dir sessionPath ═════════════════════
Task 3: EDIT tests/integration/coder-agent.test.ts  (Suites 3–8)
  - ADD imports (top of file, near the other imports):
      import { mkdtempSync, rmSync } from 'node:fs';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
  - ADD a module-scoped (or per-suite) scratch variable + beforeAll/beforeEach/afterEach that creates
    and tears down a UNIQUE temp dir. Recommended placement: a single block reused by Suites 3–8 —
    either (a) hoist into a shared top-level `let tempDir: string;` with a `beforeEach`/`afterEach`
    OUTSIDE any describe (vitest runs top-level beforeEach/afterEach for every test in the file), or
    (b) repeat the 3-hook block inside each of Suites 3–8. (a) is DRYer:
      let tempDir: string;
      beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'coder-agent-')); });
      afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });
    NOTE: Suites 3–8 already each have their own beforeEach (wires mockAgent) + the file has a top-level
    afterEach (vi.clearAllMocks). Merge cleanly — do NOT clobber the existing mock wiring.
  - REPLACE every `new PRPExecutor(process.cwd())` and every `const sessionPath = process.cwd(); … new PRPExecutor(sessionPath)`
    in Suites 3–8 with `new PRPExecutor(tempDir)` (i.e. sessionPath === tempDir). This routes
    CheckpointManager to `<tempDir>/artifacts/P1.M2.T2.S2/checkpoints.json` — a fresh path every test,
    so the stale git-tracked file is never touched and no parse error occurs.
  - DO NOT change Suite 3 test 2 ('should use real BashMCP for validation') beyond using tempDir — it
    only constructs the executor (no execute()), and currently passes; keep it passing.
  - WHY: unblocks the 16 executor tests that today return {success:false} from the swallowed
    CheckpointFileSchema parse failure.
  - VERIFY (interim): npx vitest run tests/integration/coder-agent.test.ts → most suites now green;
    the only remaining failure should be Suite 3 test 1 ('should inject PRP path into prompt') → Task 4.

# ═════════════════════ TASK 4 — Fix the prompt-injection assertion (prompt-object drift) ═════════════════════
Task 4: EDIT tests/integration/coder-agent.test.ts  (Suite 3 test 1: 'should inject PRP path into prompt')
  - LOCATE the assertion block (currently ~lines 400–405):
      expect(mockAgent.prompt).toHaveBeenCalled();
      const promptArg = mockAgent.prompt.mock.calls[0][0];
      expect(typeof promptArg).toBe('string');
      expect(promptArg).toContain('Execute BASE PRP');
      expect(promptArg).toContain('Progressive Validation');
      expect(promptArg).not.toContain('$PRP_FILE_PATH');
  - REPLACE the stale 4 lines (typeof/toContain×3) with an assertion on the REAL injection point.
    The executor calls `createPrompt({ user: \`Execute the PRP located at: ${prpPath}\\n\\nRead it with your file tools, then implement it following your system instructions.\`, responseFormat: z.unknown() })`
    (src/agents/prp-executor.ts ~line 455) — createPrompt is the mocked gs.createPrompt. So:
      expect(mockAgent.prompt).toHaveBeenCalled();
      const gs = await loadGroundswell();
      expect(vi.mocked(gs.createPrompt)).toHaveBeenCalledWith(
        expect.objectContaining({ user: expect.stringContaining(prpPath) })
      );
    (KEEP the setup above: prp, prpPath='/tmp/test-session/prps/P1M2T2S2.md', mockAgent.prompt
    mockResolvedValue(success JSON), `new PRPExecutor(tempDir)`, `await executor.execute(prp, prpPath)`.)
  - DO NOT change production. DO NOT delete the assertion — replace it with an equivalent-or-stronger
    one that verifies the prpPath actually reaches the prompt.
  - VERIFY: npx vitest run tests/integration/coder-agent.test.ts → 0 failed.

# ═════════════════════ TASK 5 — VERIFY (both files + whole-suite delta + static gates + scope guard) ═════════════════════
Task 5: VERIFY
  - RUN: npx vitest run tests/integration/coder-agent.test.ts tests/integration/coder-agent-config.test.ts → 0 failed (30 total).
  - RUN whole suite: npx vitest run --reporter=dot 2>&1 | tail -n 30 → failure count STRICTLY DECREASES
    by ~24 vs baseline; no previously-green file newly red.
  - RUN: npm run typecheck && npm run lint && npm run format:check → clean on both files.
  - RUN: git diff --stat -- src/ → EMPTY (rule 5 test-only).
```

### Implementation Patterns & Key Details

```ts
// ── Pattern A: the new config file's mock + dynamic import (self-contained, no agent-factory mock) ──
vi.mock('groundswell', async () => {
  const actual = await vi.importActual('groundswell');
  return {
    ...actual,
    createAgent: vi.fn().mockReturnValue({ id: 'mock-agent-id', name: 'MockAgent', prompt: vi.fn() }),
    createPrompt: vi.fn(),
  };
});
// …
describe('integration/coder-agent > createCoderAgent configuration', () => {
  let gs: Awaited<ReturnType<typeof loadGroundswell>>;
  beforeAll(async () => { gs = await loadGroundswell(); });
  beforeEach(() => { vi.clearAllMocks(); });
  it('should create coder agent with zai/glm-5-turbo model', async () => {
    const { createCoderAgent } = await import('../../src/agents/agent-factory.js'); // REAL factory
    createCoderAgent();
    expect(gs.createAgent).toHaveBeenCalledWith(expect.objectContaining({ model: 'zai/glm-5-turbo' }));
  });
  // …4096 / enableCache / enableReflection / mcps(3) / system=PRP_BUILDER_PROMPT / name='CoderAgent'…
});

// ── Pattern B: temp-dir isolation for the executor suites ─────────────────────────────────────
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let tempDir: string;
beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'coder-agent-')); });
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });
// …
const executor = new PRPExecutor(tempDir);   // was: new PRPExecutor(process.cwd())

// ── Pattern C: corrected prompt-injection assertion ───────────────────────────────────────────
expect(mockAgent.prompt).toHaveBeenCalled();
const gs = await loadGroundswell();
expect(vi.mocked(gs.createPrompt)).toHaveBeenCalledWith(
  expect.objectContaining({ user: expect.stringContaining(prpPath) })
);
```

### Integration Points

```yaml
DATABASE: none
CONFIG:   none
ROUTES:   none
GIT:      none
# Edits confined to tests/integration/coder-agent.test.ts (EDIT) + coder-agent-config.test.ts (NEW).
# No package.json change. No tests/setup.ts change. No tests/helpers/ change. No src/ change.
# NOTE: the stale git-tracked files artifacts/P1.M2.T2.S2/checkpoints.json and
#   artifacts/P1.M3.T3.S2/checkpoints.json are NOT deleted (the temp-dir fix makes them irrelevant to
#   tests; deleting tracked artifacts is an orthogonal maintainer call, out of this item's scope).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing each file:
npm run typecheck        # tsc --noEmit ; expect no NEW errors on the 2 files
npm run lint             # eslint ; expect clean for the 2 files
npm run format:check     # prettier --check ; if it complains: npx prettier --write <file>
# Expected: Zero errors. Read any output and fix before proceeding.
```

### Level 2: Per-file tests (primary gate — both files must be green)

```bash
npx vitest run tests/integration/coder-agent.test.ts --reporter=verbose 2>&1 | tail -n 40
npx vitest run tests/integration/coder-agent-config.test.ts --reporter=verbose 2>&1 | tail -n 20
# Expected: each "Tests  N passed (N)", "Test Files  1 passed (1)", exit 0.
# Diagnostics:
#   - If coder-agent-config STILL fails with "expected … to have been called with {model:…}" and
#     gs.createAgent was NOT called → the agent-factory mock leaked into the new file (remove it) OR
#     createCoderAgent threw in resolvedHarness() (it won't for pi+zai; check PRP_AGENT_HARNESS env).
#   - If coder-agent.test.ts executor tests still return {success:false, validationResults:[]} → the
#     temp-dir wiring isn't applied to that test's `new PRPExecutor(...)` (grep for leftover process.cwd()).
#   - If 'should inject PRP path into prompt' fails on the createPrompt assertion → confirm gs came from
#     loadGroundswell() INSIDE that test and that mockAgent.prompt was awaited via executor.execute().
```

### Level 3: Whole-suite delta (must NOT regress)

```bash
npx vitest run --reporter=dot 2>&1 | tail -n 30
# Expected:
#   - Failure count STRICTLY DECREASES by ~24 vs the pre-item baseline.
#   - No previously-green file newly red.
#   - Sibling category-(b) files NOT owned here (pipeline-main-loop, qa-agent, researcher-agent,
#     prd-task-command, prp-blueprint-agent, task-breakdown-prompt) may STILL be red — those are
#     P1.M4.T3.S2/S3 territory. Do not fix them here.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Scope guard — prove NO src/ file was touched (rule 5 test-only corrective):
git diff --stat -- src/                          # EXPECT: empty
git status --short -- src/                       # EXPECT: empty

# Split guard — Suite 2 lives ONLY in the new file now:
grep -c "createCoderAgent configuration" tests/integration/coder-agent.test.ts          # EXPECT: 0
grep -c "createCoderAgent configuration" tests/integration/coder-agent-config.test.ts   # EXPECT: 1

# Hoisting guard — the new config file has NO agent-factory mock:
grep -c "vi.mock('../../src/agents/agent-factory.js'" tests/integration/coder-agent-config.test.ts  # EXPECT: 0

# Isolation guard — no executor suite still uses process.cwd() as sessionPath:
grep -c "new PRPExecutor(process.cwd())" tests/integration/coder-agent.test.ts  # EXPECT: 0

# Model-rot guard — the corrected model string is asserted:
grep -c "zai/glm-5-turbo" tests/integration/coder-agent-config.test.ts  # EXPECT: >=1
grep -c "GLM-4.7" tests/integration/coder-agent-config.test.ts          # EXPECT: 0
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx vitest run tests/integration/coder-agent.test.ts` → 0 failed.
- [ ] `npx vitest run tests/integration/coder-agent-config.test.ts` → 0 failed (7/7).
- [ ] Whole-suite failure count strictly decreases; no previously-green file newly red.
- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check` clean on both files.

### Feature Validation

- [ ] **Cause 1 (hoisting):** Suite 2 extracted to its own file; no agent-factory mock there; all 7
      config assertions see `gs.createAgent` actually called.
- [ ] **Cause 2 (model rot):** asserts `model: 'zai/glm-5-turbo'`; `maxTokens: 4096` unchanged.
- [ ] **Cause 3 (checkpoint collision):** executor suites use a fresh temp dir; no
      `CheckpointFileSchema` parse failure; executor tests reach the real agent/validation path.
- [ ] **Cause 4 (prompt drift):** 'should inject PRP path into prompt' asserts prpPath in the
      `gs.createPrompt` `user` arg.
- [ ] No assertion weakened/deleted to force green (the 4 stale lines are replaced, not removed).

### Code Quality Validation

- [ ] New file is self-contained (own groundswell vi.mock + helpers) — repo convention.
- [ ] Temp-dir pattern mirrors `pipeline-main-loop.test.ts` / `cli-task-status.test.ts`.
- [ ] `git diff --stat -- src/` empty (rule 5).

### Documentation & Deployment

- [ ] Commit message uses the project's task-prefix format (P1.M3 landed): `P1.M4.T3.S1: <subject>`.
      Do NOT prepend `[PRP Auto]` (forbidden per PRD §5.1 / BUG-003).

---

## Anti-Patterns to Avoid

- ❌ Don't try to fix Cause 1 (hoisting) in-file by "moving" the `vi.mock('../../src/agents/agent-factory.js')`
  — vi.mock is ALWAYS hoisted; relocation changes nothing. Split the file.
- ❌ Don't assert a bare or harness-qualified model — `AgentConfig.model` is provider-qualified
  (`'zai/glm-5-turbo'`), not `'glm-5-turbo'` and not `'GLM-4.7'`.
- ❌ Don't keep `new PRPExecutor(process.cwd())` — it collides with the stale tracked
  `artifacts/P1.M2.T2.S2/checkpoints.json` and silently fails every executor test. Use a temp dir.
- ❌ Don't delete the stale `artifacts/*.json` to "fix" the checkpoint issue — that's fragile (recurs
  on any schema drift) and is an orthogonal tracked-artifact decision. The temp-dir isolation is the
  durable, minimal fix.
- ❌ Don't assert `typeof promptArg === 'string'` — the executor passes a Prompt OBJECT via the mocked
  `createPrompt`; assert on the `createPrompt` call's `user` arg instead.
- ❌ Don't mock the harness/environment seam in the new config file — `configureHarness()` is safe for
  the default pi+zai config; the mocked `gs.createAgent` is the correct capture boundary.
- ❌ Don't change production code (`src/`) to make a test pass — rule 5 is test-only corrective. The
  executor's stop-on-failure / fixAttempts===2 / stderr / stdout / exitCode / JSON-parsing behaviors
  are all CORRECT (verified line-by-line in research/findings.md); only the 4 stale prompt lines drift.
- ❌ Don't fix files outside this item's scope (pipeline-main-loop, qa-agent, researcher-agent,
  prd-task-command, prp-blueprint-agent, task-breakdown-prompt are P1.M4.T3.S2/S3).
- ❌ Don't touch `tests/helpers/research-seam.ts` or any P1.M4.T2-owned file — disjoint.
- ❌ Don't prepend `[PRP Auto]` to the commit message (forbidden per PRD §5.1 / BUG-003).
- ❌ Don't run the pipeline app (`npm run dev`/`tsx src/index.ts`) — only run vitest.

---

## Confidence Score

**9/10** — one-pass success likelihood. Every cause is verified by a live run (24/6 baseline) with
exact `src:line` citations; the 4-cause map is complete (the contract's 2 + 2 more discovered by
execution); the executor assertions are line-by-line audited as correct (only the prompt test drifts);
the model chain is traced through source; the split is proven to need no harness-seam mock
(configureHarness is safe for pi+zai); and the temp-dir convention is mirrored from existing repo
tests. Residual risk: merging the temp-dir beforeEach/afterEach with the suites' existing mock-wiring
beforeEach (mechanical, flagged). Blast radius is 1 edited test file + 1 new test file; `src/` is
fenced off by an explicit scope guard.