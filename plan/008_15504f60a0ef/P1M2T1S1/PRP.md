# PRP — P1.M2.T1.S1: Add `prd_selectors` field to the Subtask model and Zod schema

---

## Goal

**Feature Goal**: Add a `prd_selectors: string[]` field to the `Subtask` interface
and `SubtaskSchema` (PRD §4.2 "Selective PRD Section Extraction") so that PRD
section selectors carried by each subtask are **modeled, validated, and
round-tripped** through `tasks.json` instead of being silently stripped on read.
The field is optional on the parsed input with a `[]` default (backward compat
for existing serialized files), and required on the in-memory type (so every
loaded `Subtask` always has it).

**Deliverable**:
1. **`src/core/models.ts`** — EDIT: (a) add `readonly prd_selectors: string[];`
   to the `Subtask` interface immediately after `context_scope`; (b) add
   `prd_selectors: z.array(z.string()).optional().default([])` to `SubtaskSchema`
   immediately after `context_scope: ContextScopeSchema`; (c) add a JSDoc block
   on the interface field (Mode A — rides with the work) citing PRD §4.2.
2. **`src/workflows/fix-cycle-workflow.ts`** — EDIT: add `prd_selectors: []` to
   the object returned by `#createFixSubtask()` (the only src/ `Subtask` literal;
   required so `npm run typecheck` stays green).
3. **`tests/unit/core/models.test.ts`** — EDIT: add `prd_selectors: []` to the
   inline `validSubtask` fixture at line ~334 (so the `SubtaskSchema.safeParse →
   toEqual` assertion at line ~358 stays green).

**Success Definition**:
- `SubtaskSchema.safeParse({ id, type, title, status, story_points, dependencies,
  context_scope })` (no `prd_selectors`) succeeds and yields `prd_selectors: []`.
- `SubtaskSchema.safeParse({ …, prd_selectors: ['h3.0','h2.1'] })` succeeds and
  yields `prd_selectors: ['h3.0','h2.1']`.
- `BacklogSchema.safeParse(<a full Phase>Milestone>Task>Subtask tree>)` still
  succeeds (recursive validation intact), and a subtask carrying `prd_selectors`
  in the input **retains** it in the parsed output (no longer stripped).
- `npm run typecheck` clean (fix-cycle-workflow.ts construction site fixed).
- `npm run lint && npm run format:check` clean.
- `npm run test:run` green — no regression; `src/core/models.ts` at 100% coverage.

---

## Why

- **PRD §4.2 mandates it.** Each subtask carries a `prd_selectors` field
  (`["h2.1","h3.0"]`) so the Researcher receives only the referenced PRD sections
  instead of the whole document. This task adds the **field**; P1.M2.T1.S2
  generates the section index and P1.M2.T1.S3 performs the extraction. Without
  the field, S3 has nowhere to read selectors from.
- **Fixes silent data loss TODAY.** The Task-Breakdown agent already emits
  `prd_selectors` into `tasks.json` (verified: session 008's `P1.M1.T1.S1` has
  `["h3.2","h2.1"]`), but `SubtaskSchema` doesn't model it and zod's default
  **STRIP** behavior drops the key on every `BacklogSchema.parse`. So the data is
  written, then thrown away on read. Modeling the field makes it round-trip.
- **Backward compatible.** `.optional().default([])` means old `tasks.json` files
  (subtasks without the key) parse cleanly to `[]`, and new files with populated
  selectors parse intact. No migration, no breakage of completed sessions.
- **Standalone & disjoint.** No prior subtask output is consumed (contract). The
  change is a pure model/schema addition plus the two minimal knock-on edits the
  type system + a parse→`toEqual` test require. File-disjoint from the parallel
  P1.M1.T2.S3 (prompts).
- **Out of scope (hard boundary):** the section-index generator (T1.S2), selector
  extraction / full-PRD fallback (T1.S3), any change to `TaskSchema`/
  `MilestoneSchema`/`PhaseSchema`/`BacklogSchema` bodies (they compose
  `SubtaskSchema` and inherit the field automatically), populating selectors in
  the Task-Breakdown prompt, and any `docs/*.md` (DOCS: Mode A — JSDoc only).

---

## What

### User-visible behavior
None at the CLI/runtime surface for normal operation. Observable only via model
inspection: a parsed `Subtask` now always has `prd_selectors: string[]`
(populated from `tasks.json` when present, `[]` when absent). The previously
silent strip-on-read becomes a faithful round-trip.

### Technical requirements (exact contract)

**`src/core/models.ts`** — `Subtask` interface (lines 273-337). Insert AFTER the
`context_scope` field's closing (line 334):

```ts
  /**
   * PRD section selectors for selective extraction (PRD §4.2).
   *
   * @remarks
   * Each entry is a PRD section-index selector (e.g. 'h2.1', 'h3.0') computed
   * from a generated PRD section index by the section-index generator. At
   * PRP-generation time the Researcher receives ONLY the referenced PRD
   * sections instead of the full document, keeping its context focused. When
   * the array is empty OR extraction fails, the full PRD is used as a fallback.
   * Serialized to/loaded from tasks.json; absent on disk parses to [].
   *
   * @example ['h2.1', 'h3.0']
   */
  readonly prd_selectors: string[];
```

**`src/core/models.ts`** — `SubtaskSchema` (lines 360-381). Insert AFTER
`context_scope: ContextScopeSchema,` (line 379):

```ts
  prd_selectors: z.array(z.string()).optional().default([]),
```

The `.optional().default([])` chain: input may omit the key (→ output `[]`);
input may provide any `string[]` (→ output as-is). The schema's inferred OUTPUT
type is `string[]`, which satisfies the required interface field and the
`z.ZodType<Subtask>` annotation. **Do NOT** use `.default([])` without
`.optional()` (the contract specifies both).

**`src/workflows/fix-cycle-workflow.ts`** — `#createFixSubtask()` (lines 567-613).
Add `prd_selectors: []` to the returned object (bug-fix subtasks have no PRD
selectors). Place it after `context_scope: contextScope,`.

**`tests/unit/core/models.test.ts`** — the inline `validSubtask: Subtask` fixture
inside `describe('SubtaskSchema', …)` (~line 334). Add `prd_selectors: []` after
the `context_scope` field so the `expect(result.data).toEqual(validSubtask)`
assertion (~line 358) holds once the parser injects `prd_selectors: []`.

### Success Criteria
- [ ] `Subtask` interface has `readonly prd_selectors: string[]` after
      `context_scope`, with the PRD §4.2 JSDoc.
- [ ] `SubtaskSchema` has `prd_selectors: z.array(z.string()).optional().default([])`
      after `context_scope: ContextScopeSchema`.
- [ ] Parsing a subtask WITHOUT `prd_selectors` → `prd_selectors: []`.
- [ ] Parsing a subtask WITH `prd_selectors: ['h3.0']` → retained unchanged.
- [ ] `BacklogSchema.safeParse(<full tree>)` still succeeds; a nested subtask's
      `prd_selectors` survives (not stripped).
- [ ] `#createFixSubtask()` returns an object including `prd_selectors: []`.
- [ ] `npm run typecheck` clean; `npm run lint && npm run format:check` clean;
      `npm run test:run` green; `src/core/models.ts` 100% covered.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes** — exact insertion anchors (the `context_scope` field in both the interface
and schema), the verbatim JSDoc, the single src/ construction site
(`fix-cycle-workflow.ts:567`), the single runtime `toEqual` breaker
(`models.test.ts:358` ← fixture at `:334`), the zod-STRIP insight (why this
matters), the typecheck-excludes-tests scoping (why only 1 src/ site matters),
the backward-compat reasoning, and verified validation commands. See
`research/prd-selectors-model-field.md` for the grep evidence behind every claim.

### Documentation & References
```yaml
# MUST READ — PRD spec (the field's reason for existing)
- docfile: PRD.md
  section: "4.2 The Execution Loop (The "Inner Loop")" → step 2 "Selective PRD Section Extraction"
  why: Defines prd_selectors as an array of selector strings (e.g. ['h2.1','h3.0'])
       computed from a generated PRD section index; absent/failed → full PRD fallback.
  critical: This task adds the FIELD only. T1.S2 populates the index; T1.S3 extracts.
            Treat [] / absent identically (fallback) downstream.

# MUST READ — architecture (authoritative current-state finding)
- docfile: plan/008_15504f60a0ef/architecture/system_context.md
  section: "Critical Cross-Cutting Findings → 1. Subtask Model Has No prd_selectors Field"
  why: Confirms Subtask interface (models.ts:273-337) + SubtaskSchema (360-381) lack the field.

# THIS subtask's research (read first — the traps + blast-radius scoping)
- docfile: plan/008_15504f60a0ef/P1M2T1S1/research/prd-selectors-model-field.md
  section: "1. ...dropped on read", "3. typecheck excludes tests", "4. ONE src/ site",
           "5. toEqual breakers", "8. Parallel disjointness"
  why: The zod-STRIP insight, why only fix-cycle-workflow.ts breaks in src/, why only
        models.test.ts:358 breaks at runtime, and the disjointness proof vs P1.M1.T2.S3.

# PATTERN FILES — exact edit anchors
- file: src/core/models.ts
  why: EDIT — Subtask interface (insert prd_selectors after context_scope @334) +
        SubtaskSchema (insert after context_scope: ContextScopeSchema @379).
  pattern: "readonly context_scope: string;\n}\n…\nexport const SubtaskSchema … context_scope: ContextScopeSchema,"
  gotcha: Recursion is automatic — TaskSchema/MilestoneSchema/PhaseSchema/BacklogSchema compose
          SubtaskSchema and inherit the field. DO NOT edit them.

- file: src/workflows/fix-cycle-workflow.ts
  why: EDIT — #createFixSubtask() @567-613 returns the only src/ Subtask literal. Add
        prd_selectors: [] after context_scope: contextScope. Required for npm run typecheck
        (src/ IS typechecked; tests/ are NOT — see research §3).
  pattern: "return { id, type: 'Subtask', title, status, story_points, dependencies: [], context_scope: contextScope };"
  gotcha: prp-pipeline.ts:940 {id,title,type:'Subtask'} is a DISPLAY PARTIAL, not a Subtask — DO NOT touch.

- file: tests/unit/core/models.test.ts
  why: EDIT — inline validSubtask: Subtask inside describe('SubtaskSchema') @~334. Add
        prd_selectors: [] so the @~358 expect(result.data).toEqual(validSubtask) holds.
  pattern: "const validSubtask: Subtask = { id, type:'Subtask', title, status, story_points, dependencies, context_scope: `…` };"
  gotcha: Only THIS fixture is used in a parse→toEqual. Other : Subtask literals in this file
          are not typechecked (tests excluded from tsc.build) and not in a parse→toEqual —
          non-blocking; optionally add prd_selectors: [] for hygiene.

# CONSUMERS (read-only — proves non-breaking / what uses the field later)
- file: src/core/index.ts
  why: Barrel re-export of Subtask + SubtaskSchema (lines 47, 74). No edit — the types
        flow through unchanged (Subtask gains a field; SubtaskSchema gains a key).
- file: tests/fixtures/task-breakdown-samples.ts
  why: validSubtask fixture (line 103) used by task-breakdown-schema.test.ts for .success
        checks only (0 toEqual). Lacks prd_selectors → still parses (optional). NO edit
        required for green; leave as-is unless adding for hygiene.
- file: tests/unit/core/task-breakdown-schema.test.ts
  why: 0 toEqual; only asserts result.success on SubtaskSchema.safeParse(validSubtask).
        Adding the optional field does not change success → stays green. NO edit.

# DOWNSTREAM (future — NOT this task)
- file: plan/008_15504f60a0ef/P1M2T1S3  (selector extraction + full-PRD fallback)
  why: Consumes subtask.prd_selectors. Treats []/absent as "use full PRD" (PRD §4.2).
        This task only adds the field; do not implement extraction here.
```

### Current Codebase tree (relevant slice)
```bash
src/core/
└── models.ts                         # EDIT — Subtask interface + SubtaskSchema (+JSDoc)
src/workflows/
└── fix-cycle-workflow.ts             # EDIT — #createFixSubtask() += prd_selectors: []
tests/unit/core/
└── models.test.ts                    # EDIT — validSubtask fixture += prd_selectors: []
# (tests/fixtures/task-breakdown-samples.ts, task-breakdown-schema.test.ts — NO edit, optional hygiene)
```

### Desired Codebase tree with files to be added/edited
```bash
src/core/models.ts                    # MODIFIED (interface field + schema key + JSDoc)
src/workflows/fix-cycle-workflow.ts   # MODIFIED (1 literal += prd_selectors: [])
tests/unit/core/models.test.ts        # MODIFIED (1 fixture += prd_selectors: [])
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — zod default = STRIP. Unknown keys are silently removed on parse. The live
// tasks.json ALREADY contains prd_selectors (e.g. P1.M1.T1.S1 → ["h3.2","h2.1"]) but it is
// DROPPED on every BacklogSchema.parse today. Adding the key to SubtaskSchema makes it
// round-trip. Do NOT add .passthrough()/.strict() anywhere (would change global behavior).

// CRITICAL — typecheck (tsc -p tsconfig.build.json) EXCLUDES tests/ (include: src/**).
// So a REQUIRED prd_selectors on the interface only breaks SRC/ construction sites. There
// is exactly ONE: fix-cycle-workflow.ts #createFixSubtask. Tests' : Subtask literals are
// not typechecked (esbuild strips types; eslint doesn't emit raw TS diagnostics) — they
// only matter at RUNTIME for parse→toEqual comparisons. See research §3.

// CRITICAL — the ONLY runtime toEqual breaker is models.test.ts:358 (SubtaskSchema.safeParse
// result vs the validSubtask fixture @334). Fix the fixture once; done. If any OTHER test
// fails on a parse→toEqual after the change, add prd_selectors: [] to the compared fixture
// (the full npm run test:run gate pinpoints it). See research §5.

// CRITICAL — use BOTH .optional() and .default([]): `z.array(z.string()).optional().default([])`.
// .optional() lets the INPUT omit the key (old tasks.json); .default([]) makes the OUTPUT
// always string[] (satisfies the required interface field + z.ZodType<Subtask>). The contract
// specifies exactly this chain.

// GOTCHA — recursion is automatic. TaskSchema (z.array(SubtaskSchema)), MilestoneSchema /
// PhaseSchema (z.lazy), BacklogSchema (z.array(PhaseSchema)) all compose SubtaskSchema. DO
// NOT edit them — they inherit the new key. "Ensure BacklogSchema recursive validation
// passes" = run BacklogSchema.safeParse on a sample tree (existing tests cover it).

// GOTCHA — prp-pipeline.ts:940 { id, title, type: 'Subtask' } is a 3-field progress-DISPLAY
// partial, NOT a Subtask (a Subtask needs 7 fields). It does NOT break and MUST NOT be edited.

// GOTCHA — DO NOT populate prd_selectors anywhere except [] where a literal is required
// (fix-cycle-workflow bug-fix subtasks genuinely have none). Population is the section-index
// generator's job (T1.S2) / architect's job — out of scope here.

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` before validate.
// 100% coverage is globally enforced; the new schema key is exercised by every SubtaskSchema
// safeParse in models.test.ts (incl. the line-358 round trip) → coverage preserved.

// CRITICAL — DO NOT touch TaskSchema/MilestoneSchema/PhaseSchema/BacklogSchema bodies, the
// section-index generator (T1.S2), selector extraction/fallback (T1.S3), the Task-Breakdown
// prompt, any docs/*.md (DOCS: Mode A = JSDoc only), or any P1.M1.T2.S3 file (prompts.ts,
// architect/bug-hunt/delta-analysis prompt generators) — parallel + out of scope.
```

---

## Implementation Blueprint

### Data models and structure
No new types. One new required readonly field on `Subtask`; one optional+default
key on `SubtaskSchema`:

```ts
// src/core/models.ts — interface (after context_scope)
export interface Subtask {
  // …existing fields…
  readonly context_scope: string;
  /** PRD section selectors for selective extraction (PRD §4.2). @example ['h2.1','h3.0'] */
  readonly prd_selectors: string[];
}

// src/core/models.ts — schema (after context_scope: ContextScopeSchema)
export const SubtaskSchema: z.ZodType<Subtask> = z.object({
  // …existing keys…
  context_scope: ContextScopeSchema,
  prd_selectors: z.array(z.string()).optional().default([]),
});
```

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)
```yaml
Task 1: EDIT src/core/models.ts  (interface field + JSDoc)
  - In the Subtask interface, immediately AFTER the `readonly context_scope: string;`
    field (and its JSDoc), insert the new field with the verbatim JSDoc from the
    "Technical requirements" block above (PRD §4.2 selective-extraction remark, the
    empty/absent→full-PRD-fallback semantics, and the @example).
  - DO NOT change field order elsewhere; DO NOT touch any other interface.

Task 2: EDIT src/core/models.ts  (schema key)
  - In SubtaskSchema, immediately AFTER `context_scope: ContextScopeSchema,`, insert:
        prd_selectors: z.array(z.string()).optional().default([]),
  - Keep the `z.ZodType<Subtask>` annotation — the .default([]) output type is string[],
    which satisfies the now-required interface field.
  - EXPECTED (RED→GREEN): run `npx vitest run tests/unit/core/models.test.ts` — the
    'should parse valid subtask' test FAILS at the toEqual (parsed data now has
    prd_selectors:[], the line-334 fixture doesn't) until Task 4.

Task 3: EDIT src/workflows/fix-cycle-workflow.ts  (the one src/ construction site)
  - In #createFixSubtask() (line ~567-613), add `prd_selectors: []` to the returned
    object, after `context_scope: contextScope,`. Bug-fix subtasks have no PRD selectors.
  - EXPECTED: `npm run typecheck` stays green (this is the only src/ Subtask literal;
    without this edit typecheck FAILS "Property 'prd_selectors' is missing").

Task 4: EDIT tests/unit/core/models.test.ts  (the one runtime toEqual breaker)
  - In the inline `validSubtask: Subtask` fixture inside `describe('SubtaskSchema', …)`
    (line ~334), add `prd_selectors: []` after the `context_scope` field.
  - EXPECTED (GREEN): the 'should parse valid subtask' toEqual at line ~358 now passes
    (both sides have prd_selectors: []).

Task 5: ADD focused regression assertions  (lock the new behavior — optional but recommended)
  - In tests/unit/core/models.test.ts describe('SubtaskSchema'), add 2 small it() blocks:
      * 'should default prd_selectors to [] when absent':
            const { prd_selectors: _, ...without } = validSubtask;  // strip the key
            const r = SubtaskSchema.safeParse(without);
            expect(r.success).toBe(true); if (r.success) expect(r.data.prd_selectors).toEqual([]);
      * 'should retain provided prd_selectors':
            const r = SubtaskSchema.safeParse({ ...validSubtask, prd_selectors: ['h3.0','h2.1'] });
            expect(r.success).toBe(true); if (r.success) expect(r.data.prd_selectors).toEqual(['h3.0','h2.1']);
      * (optional) 'should retain prd_selectors through BacklogSchema recursion':
            parse a minimal Phase>Milestone>Task>Subtask tree whose subtask has prd_selectors
            and assert the parsed nested subtask still has it (proves no strip).
  - These cover the new schema key for 100% coverage and document the round-trip contract.

Task 6: FORMAT + VERIFY
  - RUN: npm run fix → npm run validate (lint + format:check + typecheck).
  - RUN: npx vitest run tests/unit/core/models.test.ts tests/unit/core/task-breakdown-schema.test.ts.
  - RUN: npx vitest run tests/unit/core/session-state-serialization.test.ts
        tests/unit/core/task-patcher.test.ts tests/unit/core/scope-resolver.test.ts
        tests/unit/core/task-utils.test.ts   (the JSON.stringify round-trip tests — verify safe).
  - RUN: npm run test:run (full suite — no regression; 100% coverage on models.ts).
  - EXPECTED: all green. If any parse→toEqual fails elsewhere, add prd_selectors: [] to the
    compared fixture (the suite pinpoints it).
```

### Implementation Patterns & Key Details
```ts
// ---- src/core/models.ts: interface field (insert after context_scope) ----
  readonly context_scope: string;

  /**
   * PRD section selectors for selective extraction (PRD §4.2).
   *
   * @remarks
   * Each entry is a PRD section-index selector (e.g. 'h2.1', 'h3.0') computed from a
   * generated PRD section index. At PRP-generation time the Researcher receives ONLY the
   * referenced PRD sections instead of the full document. When the array is empty OR
   * extraction fails, the full PRD is used as a fallback. Serialized to / loaded from
   * tasks.json; absent on disk parses to [].
   *
   * @example ['h2.1', 'h3.0']
   */
  readonly prd_selectors: string[];
}

// ---- src/core/models.ts: schema key (insert after context_scope: ContextScopeSchema) ----
export const SubtaskSchema: z.ZodType<Subtask> = z.object({
  id: z.string().regex(/^P\d+\.M\d+\.T\d+\.S\d+$/, '…'),
  type: z.literal('Subtask'),
  title: z.string().min(1).max(200),
  status: StatusEnum,
  story_points: z.number().multipleOf(0.5).min(0.5).max(21),
  dependencies: z.array(z.string()).min(0),
  context_scope: ContextScopeSchema,
  prd_selectors: z.array(z.string()).optional().default([]),   // ← NEW (PRD §4.2)
});

// ---- src/workflows/fix-cycle-workflow.ts: #createFixSubtask return (+= field) ----
    return {
      id,
      type: 'Subtask',
      title: `[BUG FIX] ${bug.title}`,
      status: 'Planned' as Status,
      story_points: severityToPoints[bug.severity],
      dependencies: [],
      context_scope: contextScope,
      prd_selectors: [],   // ← NEW (bug-fix subtasks have no PRD selectors)
    };

// ---- tests/unit/core/models.test.ts: validSubtask fixture (+= field, for the toEqual) ----
    const validSubtask: Subtask = {
      id: 'P1.M1.T1.S1',
      type: 'Subtask',
      title: 'Create Zod schemas',
      status: 'Planned',
      story_points: 2,
      dependencies: [],
      context_scope: `CONTRACT DEFINITION: …`,
      prd_selectors: [],   // ← NEW (keeps the line-358 toEqual green)
    };
```

### Integration Points
```yaml
MODELS (src/core/models.ts):
  - Subtask interface += readonly prd_selectors: string[] (after context_scope) + JSDoc
  - SubtaskSchema += prd_selectors: z.array(z.string()).optional().default([]) (after context_scope)
  - NO edit to TaskSchema/MilestoneSchema/PhaseSchema/BacklogSchema (compose SubtaskSchema → inherit)

PRODUCTION LITERAL (src/workflows/fix-cycle-workflow.ts):
  - #createFixSubtask() return += prd_selectors: []   (only src/ Subtask literal; typecheck gate)

TEST FIXTURE (tests/unit/core/models.test.ts):
  - validSubtask (in describe SubtaskSchema) += prd_selectors: []   (parse→toEqual gate)
  - optional: 2-3 new it() blocks locking default([]) + retain + recursive round-trip

DOCS (Mode A — contract: JSDoc rides with the work):
  - JSDoc on the prd_selectors interface field is the ONLY doc artifact (PRD §4.2 reference).
  - NO docs/*.md, README, or .env.example changes.

DOWNSTREAM CONSUMERS (becomes correct via this subtask):
  - tasks.json prd_selectors data STOPS being stripped on read (round-trips intact).
  - P1.M2.T1.S3 reads subtask.prd_selectors ([]/absent → full-PRD fallback per PRD §4.2).
  - P1.M2.T1.S2 (section-index generator) populates the field later — out of scope here.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first)
npm run validate       # = lint && format:check && typecheck   (MUST be green)
# Targeted:
npx eslint src/core/models.ts src/workflows/fix-cycle-workflow.ts
npx tsc --noEmit -p tsconfig.build.json
npx prettier --check src/core/models.ts src/workflows/fix-cycle-workflow.ts tests/unit/core/models.test.ts
# Expected: Zero errors. Most likely failure: typecheck "Property 'prd_selectors' is missing in type"
#   at fix-cycle-workflow.ts (Task 3 not applied) — add prd_selectors: [] to #createFixSubtask's return.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The directly-affected suites:
npx vitest run tests/unit/core/models.test.ts
npx vitest run tests/unit/core/task-breakdown-schema.test.ts
# Coverage on the touched source file:
npx vitest run tests/unit/core/models.test.ts --coverage
# Expected: green. If models.test.ts:358 toEqual fails → Task 4 (add prd_selectors: [] to the
#   line-334 validSubtask fixture). If models.ts coverage <100% → Task 5 (add the default/retain
#   assertions to exercise the new schema key).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Round-trip / serialization suites (verify prd_selectors isn't stripped & no toEqual regresses):
npx vitest run tests/unit/core/session-state-serialization.test.ts tests/unit/core/task-patcher.test.ts \
              tests/unit/core/scope-resolver.test.ts tests/unit/core/task-utils.test.ts \
              tests/unit/core/session-utils.test.ts tests/unit/core/tasks-json-recovery.test.ts
# Full suite — MUST stay green (proves recursion intact + no parse→toEqual regression):
npm run test:run
# Build emits dist/ cleanly (proves the interface/schema change compiles):
npx tsc -p tsconfig.build.json
# Expected: all green; build succeeds. Any parse→toEqual failure → add prd_selectors: [] to that fixture.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. Round-trip proof — a subtask carrying prd_selectors survives BacklogSchema.parse:
node --input-type=module -e "
import { BacklogSchema } from './dist/core/models.js';   # build first: npm run build
const tree = { backlog: [{ id:'P1', type:'Phase', title:'P', status:'Planned', description:'d',
  milestones: [{ id:'P1.M1', type:'Milestone', title:'M', status:'Planned', description:'d',
    tasks: [{ id:'P1.M1.T1', type:'Task', title:'T', status:'Planned', description:'d',
      subtasks: [{ id:'P1.M1.T1.S1', type:'Subtask', title:'S', status:'Planned', story_points:1,
        dependencies: [], context_scope: 'CONTRACT DEFINITION:\n1. x', prd_selectors: ['h3.4','h3.3'] }] }] }] }] };
const r = BacklogSchema.safeParse(tree);
console.log('success=', r.success,
  'retained=', r.success && r.data.backlog[0].milestones[0].tasks[0].subtasks[0].prd_selectors);
"   # Expected: success=true retained=['h3.4','h3.3']  (no longer stripped)
#   2. Backward-compat proof — a subtask WITHOUT prd_selectors parses to []:
#       (covered by the Task 5 'should default to []' unit test)
#   3. Live-data proof — session 008 tasks.json's P1.M1.T1.S1 prd_selectors ["h3.2","h2.1"]
#       now survives a BacklogSchema parse (manual: load + parse + inspect; was stripped before).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean (fix-cycle-workflow.ts `prd_selectors: []` present).
- [ ] `npm run lint` clean; `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/models.test.ts` green (incl. line-358 toEqual).
- [ ] `npm run test:run` (full suite) green — no regression; `src/core/models.ts` 100% covered.
- [ ] `npx tsc -p tsconfig.build.json` compiles.

### Feature Validation
- [ ] `Subtask` interface has `readonly prd_selectors: string[]` (after `context_scope`) + JSDoc.
- [ ] `SubtaskSchema` has `prd_selectors: z.array(z.string()).optional().default([])`.
- [ ] Parse WITHOUT the key → `prd_selectors: []`; parse WITH `['h3.0']` → retained.
- [ ] `BacklogSchema.safeParse` of a full tree succeeds; nested `prd_selectors` survives.
- [ ] `#createFixSubtask()` returns `prd_selectors: []`.

### Code Quality Validation
- [ ] Field placed immediately after `context_scope` in BOTH the interface and the schema.
- [ ] `.optional().default([])` chain used exactly as specified (not `.default([])` alone).
- [ ] No edits to `TaskSchema`/`MilestoneSchema`/`PhaseSchema`/`BacklogSchema` bodies.
- [ ] No edits to any P1.M1.T2.S3 file (prompts) — parallel-disjoint.
- [ ] JSDoc cites PRD §4.2 and documents the empty/absent → full-PRD-fallback semantics.

### Documentation & Deployment
- [ ] JSDoc on `prd_selectors` is the only doc artifact (Mode A — rides with the code).
- [ ] No `docs/*.md`, README, or `.env.example` changes.
- [ ] Commit message notes: zod-STRIP round-trip fix, the single src/ construction site, the
      single toEqual fixture, and the optional+default backward-compat design.

---

## Anti-Patterns to Avoid

- ❌ Don't use `.default([])` WITHOUT `.optional()` — the contract specifies
  `z.array(z.string()).optional().default([])`. `.optional()` lets old `tasks.json`
  (key absent) parse; `.default([])` guarantees the output is always `string[]`.
- ❌ Don't edit `TaskSchema`/`MilestoneSchema`/`PhaseSchema`/`BacklogSchema` — they
  compose `SubtaskSchema` and inherit the field automatically. Editing them duplicates
  the key / risks breaking the `z.lazy()` recursion.
- ❌ Don't forget `fix-cycle-workflow.ts` `#createFixSubtask()` — it's the ONLY src/
  `Subtask` literal, and src/ IS typechecked. Missing it = `npm run typecheck` fails.
- ❌ Don't edit `prp-pipeline.ts:940` — `{ id, title, type: 'Subtask' }` is a progress
  display partial, not a `Subtask`. It does not break and must not be touched.
- ❌ Don't add `.passthrough()`/`.strict()`/`.catchall()` to "preserve unknown keys" —
  that changes zod behavior globally. Model `prd_selectors` explicitly instead.
- ❌ Don't populate `prd_selectors` with real selectors anywhere except `[]` where a
  literal is required. Population is the section-index generator's (T1.S2) / architect's
  job — out of scope.
- ❌ Don't implement selector extraction or the full-PRD fallback here — that's T1.S3.
  This task only adds the field + schema key.
- ❌ Don't edit any `docs/*.md` — DOCS is Mode A (JSDoc on the field only).
- ❌ Don't touch any P1.M1.T2.S3 file (`prompts.ts`, `architect/bug-hunt/delta-analysis`
  prompt generators) — parallel execution; file-disjoint.
- ❌ Don't mass-edit every `: Subtask` test literal — tests/ are excluded from `tsc.build`
  and esbuild strips types, so they don't block green (only the line-334 fixture does, via
  the parse→toEqual). Adding `prd_selectors: []` elsewhere is optional hygiene, not required.
- ❌ Don't skip running the full `npm run test:run` — it's the gate that surfaces any other
  parse→toEqual regression (the JSON.stringify round-trip tests in scope-resolver/
  task-utils/task-patcher are expected safe but must be verified).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, well-bounded model/schema addition with exactly two knock-on
edits, both pinpointed by verified grep evidence. The non-obvious facts are all nailed down
in `research/prd-selectors-model-field.md`: (1) zod's default STRIP was silently dropping
the field that already exists in `tasks.json` — this task fixes the round-trip; (2)
`tsconfig.build.json` excludes `tests/`, so the required interface field breaks exactly ONE
src/ site (`fix-cycle-workflow.ts:567`, fixed by `prd_selectors: []`); (3) the only runtime
`toEqual` breaker is `models.test.ts:358` (fixed by adding `prd_selectors: []` to the
line-334 fixture); (4) recursion through `TaskSchema`/`MilestoneSchema`/`PhaseSchema`/
`BacklogSchema` is automatic (no edits needed). The work is file-disjoint from the parallel
P1.M1.T2.S3 (prompts). Validation commands are verified executable. Residual risks are minor
and gate-caught: (a) an unanticipated parse→`toEqual` elsewhere (the full `npm run test:run`
pinpoints it; fix = add `prd_selectors: []` to that fixture); (b) a prettier nit (auto-fixed
via `npm run fix`). No runtime/network/LLM unknowns.