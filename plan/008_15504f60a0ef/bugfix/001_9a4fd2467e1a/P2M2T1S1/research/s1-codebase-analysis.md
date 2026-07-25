# S1 Codebase Analysis — lenient read schemas for tasks.json

> Scope: P2.M2.T1.S1 — "Create ContextScopeReadSchema (lenient) and
> BacklogReadSchema". This is the **schema-definition layer ONLY**. Wiring the
> read path (`readTasksJSON` / `loadSession`) to use the lenient schema is
> **P2.M2.T1.S2**. S1 must NOT touch `session-utils.ts` / `session-manager.ts`.

## 1. The bug (Issue 3B): strict schema enforced on READ → lockout

`ContextScopeSchema` (`src/core/models.ts:106`) is a `z.string().min(1)` **plus
a `superRefine`** that requires the literal prefix `CONTRACT DEFINITION:\n` AND
four numbered sections (`1. RESEARCH NOTE:`, `2. INPUT:`, `3. LOGIC:`,
`4. OUTPUT:`) in order. It is the field validator inside `SubtaskSchema` (line
402: `context_scope: ContextScopeSchema`), and `SubtaskSchema` → `TaskSchema` →
`MilestoneSchema` → `PhaseSchema` → `BacklogSchema`.

The **read path** enforces it: `readTasksJSON()` (`session-utils.ts:857`) calls
`BacklogSchema.parse(parsed)` at **line 870**. So ANY `tasks.json` whose subtasks
lack the contract prefix throws `context_scope must start with "CONTRACT
DEFITION:"` and the session fails to load. This locks out legacy / hand-edited /
externally-authored / test-fixture sessions (PRD §5.1 mandates survival).

## 2. The fix: write-strict / read-lenient SPLIT (S1 defines, S2 wires)

- **Strict** (`ContextScopeSchema`, `BacklogSchema`, etc.) → UNCHANGED. Still
  used for **architect OUTPUT validation** (write time) so the pipeline always
  PRODUCES the contract format.
- **Lenient** (NEW `ContextScopeReadSchema`, `BacklogReadSchema`, etc.) → used by
  the **read path** (S2 wires `readTasksJSON`/`loadSession` to them). Accept any
  non-empty string for `context_scope`; keep strict validation on everything else
  (ID formats, status enum, type discriminators, etc.).

S1 = **add the lenient schemas only**. Do not wire, do not touch the read path.

## 3. Exact schema hierarchy to mirror (verified from models.ts)

| Schema (strict)        | Line | Form                  | Lenient twin          | Only diff vs strict |
|------------------------|------|-----------------------|-----------------------|---------------------|
| `ContextScopeSchema`   | 106  | `z.string().min(1).superRefine(...)` | `ContextScopeReadSchema` | drops superRefine |
| `SubtaskSchema`        | 375  | direct `z.object({... context_scope: ContextScopeSchema ...})` | `SubtaskReadSchema` | `context_scope: ContextScopeReadSchema` |
| `TaskSchema`           | 497  | direct `z.object({... subtasks: z.array(SubtaskSchema) ...})` | `TaskReadSchema` | `subtasks: z.array(SubtaskReadSchema)` |
| `MilestoneSchema`      | 600  | `z.lazy(() => z.object({... tasks: z.array(z.lazy(() => TaskSchema)) ...}))` | `MilestoneReadSchema` | `... => TaskReadSchema` |
| `PhaseSchema`          | 702  | `z.lazy(() => z.object({... milestones: z.array(z.lazy(() => MilestoneSchema)) ...}))` | `PhaseReadSchema` | `... => MilestoneReadSchema` |
| `BacklogSchema`        | 797  | `z.object({ backlog: z.array(PhaseSchema) })` | `BacklogReadSchema` | `backlog: z.array(PhaseReadSchema)` |

**Recursion note**: `MilestoneSchema` and `PhaseSchema` use `z.lazy(...)` (both
the outer wrapper AND the inner array element: `z.array(z.lazy(() => X))`).
The Read twins MUST mirror this EXACT `z.lazy` placement (see
s1-type-correctness.md §2) — do not "simplify" the recursion away.

## 4. The generic ZodType annotations (keep IDENTICAL to strict)

Each strict schema is annotated `z.ZodType<Interface, z.ZodTypeDef, InputType>`
where `InputType` widens `prd_selectors` to optional (`.optional().default([])`).
The lenient twins use the **exact same annotations**, because:
- `context_scope` is `string` in BOTH (the Interface field is `readonly
  context_scope: string`, line 334). Leniency changes validation, not the type.
- The `prd_selectors` default is identical.

So e.g.:
```ts
export const SubtaskReadSchema: z.ZodType<
  Subtask, z.ZodTypeDef,
  Omit<Subtask, 'prd_selectors'> & { prd_selectors?: string[] }
> = z.object({ /* same fields, context_scope: ContextScopeReadSchema */ });
```
See s1-type-correctness.md §1 for the full annotation set + the input-type
chain (`z.input<typeof TaskReadSchema>` etc.).

## 5. `ContextScopeReadSchema` — contract verbatim

The contract specifies EXACTLY:
```ts
export const ContextScopeReadSchema: z.ZodType<string> =
  z.string().min(1, 'Context scope is required');
```
- Keep `.min(1)` — the leniency is about the **FORMAT** (CONTRACT DEFINITION
  prefix + 4 sections), NOT about emptiness. An empty `context_scope` is genuinely
  malformed data, so it still rejects. (~11 test fixtures use `''`; those flow
  through `.parse()` only in specific paths and are a separate concern — S1's
  contract is `.min(1)` verbatim. Do NOT relax to bare `z.string()`.)
- Annotate `: z.ZodType<string>` to match `ContextScopeSchema`'s annotation.

## 6. Naming reconciliation: contract OVERRIDES architecture doc

The architecture doc (`test_validation.md` §3B "Fix Strategy") SUGGESTED renaming
the strict schema to `ContextScopeWriteSchema`. The **contract for THIS task
explicitly overrides**: "Keep the existing strict ContextScopeSchema and
BacklogSchema UNCHANGED". → Do NOT rename anything. Only ADD the `*ReadSchema`
exports. The existing strict names stay as-is.

## 7. Test home + convention

- File: `tests/unit/core/models.test.ts` (GATED — `include:
  ['tests/**/*.{test,spec}.ts']`; runs under `npm run validate`).
- Pattern: explicit named imports from `src/core/models.js`; `safeParse()` +
  `expect(result.success).toBe(true/false)`; SETUP/EXECUTE/VERIFY comment blocks.
- Existing `describe('BacklogSchema', ...)` (line ~1208) defines a
  `validBacklog: Backlog` fixture with a minimal Phase — MIRROR this shape for
  the new `describe('Read schemas (lenient)')` block, but put a PLAIN
  (non-contract) `context_scope` on a nested subtask to prove the lenient path
  accepts what the strict path rejects.

## 8. vitest enforces 100% coverage

`vitest.config.ts` thresholds: statements/branches/functions/lines = **100** on
`src/**/*.ts`. The new schemas are object-literal + a string schema — **zero
runtime branches** — so coverage is achieved by parsing one valid plain-scope
backlog + one structurally-invalid backlog. No conditional logic to worry about.

## 9. Build baseline (verified)

`npx tsc --noEmit -p tsconfig.build.json` → **exit 0** (greenfield additions;
no existing Read schemas: `grep ReadSchema src/ tests/` = empty). The Zod import
is already present at the top of `models.ts`.

## 10. Out-of-scope (hard fences)

- **Wire `readTasksJSON`/`loadSession` to `BacklogReadSchema`** → **S2**. S1 must
  NOT edit `session-utils.ts` or `session-manager.ts`.
- **Rename strict schemas** (`ContextScopeWriteSchema`) → contract FORBIDS.
- **Relax `.min(1)` to bare `z.string()`** → contract specifies `.min(1)`.
- **Fix the ~297 rotted tests / mock drift** → P2.M3 (Issue 3A). S1 only adds
  schemas + their own focused tests.
- **Optional "warn (not reject)" logging for non-contract scopes** → the PRD
  Issue 3 mentions it as a *possible* enhancement, but the CONTRACT for S1 says
  "No mocking needed" and lists only the schema exports + JSDoc. Logging belongs
  to the wiring layer (S2), not the schema definition (S1). Do NOT add logging in S1.