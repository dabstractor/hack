---
name: "P1.M3.T2.S1 — Update stale enableReflection/responseFormat assertions to match current prompt contracts"
result: pass
work_item: P1.M3.T2.S1
type: test-only (Mode A — no doc surface, no source changes)
confidence: 9
---

# PRP — P1.M3.T2.S1: Fix stale enableReflection / responseFormat test assertions

## Goal

**Feature Goal**: Make the pre-existing (stale) prompt-contract assertions in two
integration test files pass against the **current, intentional** prompt behavior.
`createArchitectPrompt` and `createPRPBlueprintPrompt` were deliberately changed
(commit `a557b18`) to use a permissive `responseFormat: z.unknown()` and to OMIT
`enableReflection`, because the **written file is the contract** (a strict schema
would make Groundswell reject the agent's correct text summary). The tests still
assert the old strict shape and are RED.

**Deliverable**: Edited versions of two test files — no source changes:
- `tests/integration/agents.test.ts`
- `tests/integration/agents/architect-agent-integration.test.ts`

**Success Definition**:
1. Both files pass: `npx vitest run <file>` is green.
2. No prompt source files (`src/agents/prompts/**`) are modified — the design is intentional.
3. All other (already-correct) assertions in those files remain green (no collateral regressions).

---

## Why

- PRD §h2.3 / h3.2 (Issue 3): the full `vitest` suite is red (33 files / 223 tests failing).
  These two files contribute pre-existing failures from the `a557b18` behavior alignment that
  are unrelated to Delta D1. Fixing them is part of restoring `npm run validate` to a usable
  green gate.
- The prompt design is correct and documented in-source; the tests are the ones that drifted.
- Unblocks P1.M4 (changeset doc sync) by removing red noise from the suite.

---

## What

[User-visible behavior]: none — test-only.

### Success Criteria

- [ ] `createArchitectPrompt` test asserts the **current** behavior: permissive
      `responseFormat` (a Zod schema, NOT `BacklogSchema`) and **no** `enableReflection`.
- [ ] `createPRPBlueprintPrompt` test asserts the **current** behavior: permissive
      `responseFormat` (NOT `PRPDocumentSchema`) and **no** `enableReflection`.
- [ ] In `architect-agent-integration.test.ts`, the "Research-Driven Architecture section"
      drift test no longer asserts the removed `'SPAWN SUBAGENTS'` substring; it asserts
      text the prompt **actually** contains.
- [ ] `createBugHuntPrompt`, `createDeltaAnalysisPrompt`, and the agent-factory
      `enableReflection: true` assertions are **left untouched** (verified correct — see
      "Out of scope").
- [ ] `npx vitest run tests/integration/agents.test.ts tests/integration/agents/architect-agent-integration.test.ts` exits 0.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_
**Yes** — every assertion site is identified by its `describe`/`it` title and surrounding
code (line numbers drift; match by content), the exact current source behavior is quoted
verbatim below, and a ready-to-paste assertion pattern is provided that avoids a subtle
Zod deep-equality pitfall.

### Documentation & References

```yaml
# ── SOURCE OF TRUTH (read these FIRST; do NOT modify them) ──
- file: src/agents/prompts/architect-prompt.ts
  why: Defines the CURRENT, intentional shape of createArchitectPrompt.
  critical: |
    Lines 70-92. The block comment "No strict responseFormat / no enableReflection
    here — by design" explains WHY. The createPrompt({...}) call returns:
      responseFormat: z.unknown()
    and does NOT pass enableReflection. The docstring at line 25 still CLAIMS
    enableReflection:true — that docstring is stale but OUT OF SCOPE (do not touch source).

- file: src/agents/prompts/prp-blueprint-prompt.ts
  why: Defines the CURRENT shape of createPRPBlueprintPrompt.
  critical: |
    Final createPrompt({...}) call (near end of file): responseFormat: z.unknown(),
    NO enableReflection. NOTE: when prpOutputPath is undefined the `system` arg is
    the UNMUTATED PRP_BLUEPRINT_PROMPT, so the existing `system: PRP_BLUEPRINT_PROMPT`
    assertion STAYS VALID (the tests pass only 3 args → prpOutputPath undefined).

- file: src/agents/prompts.ts
  why: Defines TASK_BREAKDOWN_PROMPT (line 33) — needed for the content-drift test.
  section: "### 1. RESEARCH-DRIVEN ARCHITECTURE (NEW PRIORITY)" (line 53) and the
           bullet list beneath it.

# ── TEST FILES TO EDIT (match by describe/it title; line numbers drift) ──
- file: tests/integration/agents.test.ts
  why: Contains 2 stale assertion blocks (createArchitectPrompt, createPRPBlueprintPrompt).
  pattern: Uses vi.mock('groundswell') + spies on createPrompt; asserts via
           expect(createPrompt).toHaveBeenCalledWith(expect.objectContaining({...})).

- file: tests/integration/agents/architect-agent-integration.test.ts
  why: Contains 3 stale assertion blocks (2 prompt-shape tests + 1 content-drift test).
  pattern: Dynamic import of source modules; gs.createPrompt mocked; mockPrompt objects
           carry responseFormat/enableReflection (those are RETURN VALUES, not assertions
           — leave them unless they break).
```

### Current Codebase tree (relevant slice)

```bash
src/agents/
  prompts.ts                          # TASK_BREAKDOWN_PROMPT, PRP_BLUEPRINT_PROMPT, BUG_HUNT_PROMPT (constants)
  agent-factory.ts                    # createBaseConfig: enableReflection: true (CORRECT — leave alone)
  prompts/
    architect-prompt.ts               # createArchitectPrompt → responseFormat: z.unknown(), NO enableReflection
    prp-blueprint-prompt.ts           # createPRPBlueprintPrompt → responseFormat: z.unknown(), NO enableReflection
    bug-hunt-prompt.ts                # createBugHuntPrompt → enableReflection: true (CORRECT — leave alone)
    delta-analysis-prompt.ts          # createDeltaAnalysisPrompt → strict schema + enableReflection (CORRECT — leave alone)
tests/integration/
  agents.test.ts                      # EDIT: 2 stale blocks
  agents/architect-agent-integration.test.ts  # EDIT: 3 stale blocks
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL (Zod equality pitfall): Do NOT assert `expect.objectContaining({ responseFormat: z.unknown() })`.
// `z.unknown()` constructs a NEW ZodUnknown instance each call. expect's objectContaining
// does deep-equality on non-matcher values, and Zod schemas carry circular _def refs →
// the match is unreliable / will fail. Instead capture the call arg and check identity/instance:

const cfg = (createPrompt as unknown as { mock: { calls: any[][] } }).mock.calls.at(-1)![0];
expect(cfg.responseFormat).not.toBe(BacklogSchema);   // not the strict schema
expect(cfg.responseFormat).toBeInstanceOf(z.ZodType); // still a (permissive) Zod schema
expect(cfg.enableReflection).toBeUndefined();         // intentionally omitted

// GOTCHA: to assert "field is absent" you CANNOT use expect.objectContaining with a
// "not" matcher reliably — capture the arg and assert .toBeUndefined() (above).

// GOTCHA (test names): after editing, the `it('...with BacklogSchema')` title becomes a
// lie. Rename the test to reflect reality (e.g. '...uses permissive responseFormat by design').

// GOTCHA (imports): `z` must be imported in each test file that uses it:
import { z } from 'zod';
// (and `createPrompt` must be the spied mock in scope — it already is in both files.)
```

---

## Implementation Blueprint

### Ground truth: what the code ACTUALLY does (verified)

| Prompt generator | `responseFormat` | `enableReflection` | In scope? |
|---|---|---|---|
| `createArchitectPrompt` | `z.unknown()` | **omitted** | ✅ FIX its tests |
| `createPRPBlueprintPrompt` | `z.unknown()` | **omitted** | ✅ FIX its tests |
| `createBugHuntPrompt` | `TestResultsSchema` (no outputPath) / `z.unknown()` (with) | `true` | ❌ LEAVE (correct) |
| `createDeltaAnalysisPrompt` | `DeltaAnalysisSchema` | `true` | ❌ LEAVE (correct) |
| `createBaseConfig` (agent-factory:181) | n/a | `true` | ❌ LEAVE (correct) |

> If a test fails that is NOT in the ✅ rows above, STOP and re-read the corresponding
> source file before changing anything — do not "fix" a passing/correct assertion.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ the two prompt sources to confirm current shape (no edits)
  - READ: src/agents/prompts/architect-prompt.ts (lines ~70-92)
  - READ: src/agents/prompts/prp-blueprint-prompt.ts (final createPrompt call)
  - CONFIRM: both use responseFormat: z.unknown() and omit enableReflection.
  - This is a guard — if reality differs from this PRP, STOP and trust the source.

Task 2: EDIT tests/integration/agents.test.ts — createArchitectPrompt block
  - FIND: describe('createArchitectPrompt') → it('should create architect prompt with BacklogSchema')
  - CURRENT (stale):
      expect(createPrompt).toHaveBeenCalledWith(expect.objectContaining({
        user: prdContent,
        system: TASK_BREAKDOWN_PROMPT,
        responseFormat: BacklogSchema,   // ← stale
        enableReflection: true,          // ← stale
      }));
  - REPLACE WITH (capture arg; assert permissive + absent):
      createArchitectPrompt(prdContent);
      const cfg = (createPrompt as unknown as { mock: { calls: any[][] } })
        .mock.calls.at(-1)![0];
      expect(cfg.user).toBe(prdContent);
      expect(cfg.system).toBe(TASK_BREAKDOWN_PROMPT);
      expect(cfg.responseFormat).not.toBe(BacklogSchema);
      expect(cfg.responseFormat).toBeInstanceOf(z.ZodType); // permissive z.unknown()
      expect(cfg.enableReflection).toBeUndefined();         // omitted by design
  - ADD import at top: import { z } from 'zod';
  - RENAME the it() title to: 'should use permissive responseFormat and omit enableReflection by design'
  - PRESERVE: the note comment about Prompt<Backlog> being compile-time only.

Task 3: EDIT tests/integration/agents.test.ts — createPRPBlueprintPrompt block
  - FIND: describe('createPRPBlueprintPrompt') → it('should create PRP blueprint prompt with PRPDocumentSchema')
  - CURRENT (stale):
      expect(createPrompt).toHaveBeenCalledWith(expect.objectContaining({
        user: expect.stringContaining(task.title),
        system: PRP_BLUEPRINT_PROMPT,
        responseFormat: PRPDocumentSchema,  // ← stale
        enableReflection: true,             // ← stale
      }));
  - REPLACE WITH:
      const cfg = (createPrompt as unknown as { mock: { calls: any[][] } })
        .mock.calls.at(-1)![0];
      expect(cfg.user).toEqual(expect.stringContaining(task.title));
      expect(cfg.system).toBe(PRP_BLUEPRINT_PROMPT);
      expect(cfg.responseFormat).not.toBe(PRPDocumentSchema);
      expect(cfg.responseFormat).toBeInstanceOf(z.ZodType);
      expect(cfg.enableReflection).toBeUndefined();
  - RENAME it() title to reflect reality.
  - NOTE: the sibling it('should include codebase path...') test asserts only `user` — leave it.

Task 4: EDIT tests/integration/agents/architect-agent-integration.test.ts — prompt-shape tests
  - FIX TEST A: it('should create prompt with BacklogSchema responseFormat')
      CURRENT: expect(gs.createPrompt).toHaveBeenCalledWith(expect.objectContaining({
        user: prdContent, responseFormat: BacklogSchema }));
      REPLACE: capture arg via (gs.createPrompt as ...).mock.calls.at(-1)![0];
        expect(cfg.user).toBe(prdContent);
        expect(cfg.responseFormat).not.toBe(BacklogSchema);
        expect(cfg.responseFormat).toBeInstanceOf(z.ZodType);
      RENAME: 'should use permissive responseFormat by design (file is the contract)'
  - FIX TEST B: it('should create prompt with enableReflection')
      CURRENT: expect(gs.createPrompt).toHaveBeenCalledWith(expect.objectContaining({
        enableReflection: true }));
      REPLACE: const cfg = (gs.createPrompt as ...).mock.calls.at(-1)![0];
        expect(cfg.enableReflection).toBeUndefined();
      RENAME: 'should omit enableReflection by design'
  - PRESERVE: TEST C it('should create prompt with TASK_BREAKDOWN_SYSTEM_PROMPT')
      (asserts system: TASK_BREAKDOWN_PROMPT — still correct; leave as-is).
  - ADD import { z } from 'zod'; if not present.

Task 5: EDIT tests/integration/agents/architect-agent-integration.test.ts — content-drift test
  - FIND: describe('TASK_BREAKDOWN_PROMPT validation') →
          it('should contain Research-Driven Architecture section')
  - CURRENT (4 toContain):
      expect(TASK_BREAKDOWN_PROMPT).toContain('RESEARCH-DRIVEN ARCHITECTURE'); // ✓ present
      expect(TASK_BREAKDOWN_PROMPT).toContain('SPAWN SUBAGENTS');               // ✗ ABSENT — FAILS
      expect(TASK_BREAKDOWN_PROMPT).toContain('$SESSION_DIR/architecture/');    // ✓ present
      expect(TASK_BREAKDOWN_PROMPT).toContain('VALIDATE BEFORE BREAKING DOWN'); // ✓ present
  - REPLACE the failing line ONLY with text the prompt actually contains (verified):
      expect(TASK_BREAKDOWN_PROMPT).toContain('SUBAGENTS ARE OPTIONAL');
    (Current prompt §1 bullets read "SUBAGENTS ARE OPTIONAL" and "NEVER LOOP ON SUBAGENT
     CALLS" — pick one verbatim substring that is stable and meaningful. 'SUBAGENTS ARE
     OPTIONAL' is preferred.)
  - Do NOT touch the other 3 toContain lines (they pass).
  - VERIFY each kept/new substring with: grep -cF '<substring>' src/agents/prompts.ts  (must be >= 1)
    BEFORE finalizing.

Task 6: RUN + triage (do not change scope without re-reading source)
  - RUN: npx vitest run tests/integration/agents.test.ts \
              tests/integration/agents/architect-agent-integration.test.ts
  - EXPECT: both files green. If ANY OTHER test in these files fails, read the
    corresponding source first; only fix assertions that are genuinely stale.
  - If a failure is in createBugHuntPrompt/createDeltaAnalysisPrompt/agent-factory
    blocks, those are CORRECT — do NOT change them (re-check source).
```

### Implementation Patterns & Key Details

```ts
// PATTERN: robust "assert a Zod schema that is NOT the strict one + field omitted"
// Works regardless of Zod version's deep-equality quirks (identity + instanceof, not deep eq).
function assertPermissivePrompt(mockCreatePrompt: any, strictSchema: unknown) {
  const cfg = mockCreatePrompt.mock.calls.at(-1)![0] as Record<string, unknown>;
  expect(cfg.responseFormat).not.toBe(strictSchema);
  expect(cfg.responseFormat).toBeInstanceOf(z.ZodType);
  expect(cfg.enableReflection).toBeUndefined();
}

// PATTERN: the mock in architect-agent-integration.test.ts mocks createPrompt and also
// returns a mockPrompt carrying responseFormat: BacklogSchema / enableReflection: true.
// Those are the RETURN VALUE, not assertions — they do not by themselves fail tests.
// Leave them; only change if a test asserts on the returned prompt's fields (it does not).
```

### Integration Points

```yaml
SOURCE FILES: NONE modified (test-only — do not touch src/agents/prompts/**).
CONFIG: none.
IMPORTS: add `import { z } from 'zod';` to each edited test file if not already imported.
DOCUMENTATION: Mode A — none.
```

---

## Validation Loop

> This project is TypeScript + Vitest (NOT python/ruff/pytest). Use the commands below.

### Level 1: Typecheck + Lint (immediate)

```bash
# After each file edit — confirm no type/lint errors introduced.
npx tsc --noEmit
npx eslint tests/integration/agents.test.ts tests/integration/agents/architect-agent-integration.test.ts
# Expected: zero errors. (The `as unknown as { mock: ... }` cast is intentional to satisfy TS
# around the vi.Mock type; prefer vi.Mocked<typeof createPrompt> if the file already types it.)
```

### Level 2: Targeted Test Run (the core gate)

```bash
# The two files this work item owns:
npx vitest run tests/integration/agents.test.ts \
              tests/integration/agents/architect-agent-integration.test.ts
# Expected: both files pass (0 failures).
```

### Level 3: Confirm NO collateral regressions in adjacent prompt tests

```bash
# These must remain GREEN (they assert correct behavior — verify you didn't touch them):
npx vitest run tests/integration/agents.test.ts -t "createBugHuntPrompt"
npx vitest run tests/integration/agents.test.ts -t "createQAAgent"
# Expected: pass. If these fail, you changed something out of scope — revert.
```

### Level 4: Project gate

```bash
npm run validate   # lint && format:check && typecheck && test:run
# NOTE: Per PRD h3.2, the FULL suite is currently red with ~33 files / 223 tests of
# pre-existing failures OUTSIDE this task's scope. `npm run validate` is NOT expected to
# be fully green yet — it is tracked separately (P1.M3 + P1.M4). The acceptance gate for
# THIS task is Level 2 (the two target files green) plus Level 3 (no collateral damage).
```

---

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 passes: `tsc --noEmit` and `eslint` clean on both edited files.
- [ ] Level 2 passes: both target test files green via `npx vitest run`.
- [ ] Level 3 passes: `createBugHuntPrompt` / `createQAAgent` / agent-factory assertions untouched and green.
- [ ] No `src/` file modified (`git status` shows only the two test files).

### Feature Validation

- [ ] createArchitectPrompt assertions match reality (`z.unknown()`, no enableReflection).
- [ ] createPRPBlueprintPrompt assertions match reality (`z.unknown()`, no enableReflection).
- [ ] "Research-Driven Architecture section" drift test asserts substrings that `grep -cF` confirms exist in `src/agents/prompts.ts`.
- [ ] Each renamed `it()` title truthfully describes the assertion.

### Scope Discipline

- [ ] `createBugHuntPrompt`, `createDeltaAnalysisPrompt`, `createBaseConfig` assertions UNCHANGED.
- [ ] No prompt source edited (the `responseFormat: z.unknown()` / omitted-`enableReflection` design is intentional).
- [ ] mockPrompt *return values* in the integration file left as-is (they are not failing assertions).

---

## Anti-Patterns to Avoid

- ❌ Don't `expect.objectContaining({ responseFormat: z.unknown() })` — fresh Zod instances + deep equality = flaky/failing match. Capture the call arg and use `not.toBe(strict)` + `toBeInstanceOf(z.ZodType)`.
- ❌ Don't "fix" `createBugHuntPrompt` / `createDeltaAnalysisPrompt` / agent-factory `enableReflection: true` — they are CORRECT (verified in source).
- ❌ Don't edit any `src/agents/prompts/**` file to make a test pass — the design is intentional and documented in-source.
- ❌ Don't trust line numbers from the work-item description verbatim — they drift; match assertions by `describe`/`it` title and surrounding code.
- ❌ Don't blanket-delete the `'SPAWN SUBAGENTS'` assertion's siblings — only that one substring is absent; the other three pass.

---

## Research Notes (how findings were verified — for traceability)

1. `src/agents/prompts/architect-prompt.ts:70-92` — confirmed `responseFormat: z.unknown()`, no `enableReflection`; comment states "by design".
2. `src/agents/prompts/prp-blueprint-prompt.ts` (final `createPrompt` call) — confirmed `responseFormat: z.unknown()`, no `enableReflection`.
3. `src/agents/prompts/bug-hunt-prompt.ts:161-162` — confirmed STILL `enableReflection: true` and (no outputPath) `TestResultsSchema` → its test is correct, out of scope.
4. `src/agents/prompts/delta-analysis-prompt.ts:138,142` — confirmed strict `DeltaAnalysisSchema` + `enableReflection: true` → out of scope.
5. `src/agents/agent-factory.ts:181` — confirmed `createBaseConfig` still sets `enableReflection: true` → agent-level assertions correct, out of scope.
6. `src/agents/prompts.ts:53` — confirmed `### 1. RESEARCH-DRIVEN ARCHITECTURE (NEW PRIORITY)` exists; `grep -cF` confirmed `'SPAWN SUBAGENTS'`=0, `'SUBAGENTS ARE OPTIONAL'`>=1, `'$SESSION_DIR/architecture/'`=3, `'VALIDATE BEFORE BREAKING DOWN'`=1.
