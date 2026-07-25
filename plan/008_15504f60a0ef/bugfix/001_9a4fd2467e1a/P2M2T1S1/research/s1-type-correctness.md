# S1 Type-correctness & exact schema definitions

## 1. The lenient schema block — full, type-correct, drop-in

Mirrors the strict hierarchy (`models.ts:106`–`804`) EXACTLY, swapping only
`ContextScopeSchema → ContextScopeReadSchema` and the nested arrays → Read twins.
Generic `z.ZodType<Interface, z.ZodTypeDef, InputType>` annotations are
**identical to the strict originals** (context_scope is `string` in both; the
only input widening is `prd_selectors?`, unchanged).

```ts
// ============================================================================
// READ-TIME LENIENT SCHEMAS (PRD §5.1; bugfix Issue 3B) — P2.M2.T1.S1
// ============================================================================
// The strict schemas above (ContextScopeSchema/BacklogSchema/…) remain the
// WRITE-time validation for architect OUTPUT. These lenient twins are used on
// READ (readTasksJSON/loadSession — wired in P2.M2.T1.S2) so legacy / hand-edited
// / externally-authored / test-fixture sessions load instead of being locked out
// by the CONTRACT DEFINITION format check. Leniency is on context_scope FORMAT
// only — structural validation (IDs, status, types, prd_selectors default) is
// IDENTICAL to the strict path. See JSDoc on each export.

/**
 * Lenient context_scope schema for READ-time validation (PRD §5.1; bugfix Issue 3B).
 *
 * @remarks
 * The strict {@link ContextScopeSchema} enforces the CONTRACT DEFINITION prefix
 * + four numbered sections — correct for architect OUTPUT (write time), but too
 * strict for READ: a recovery-oriented state file (`tasks.json`) must load
 * legacy, hand-edited, test-fixture, or externally-authored sessions that don't
 * follow the contract format. This schema accepts ANY non-empty string
 * (emptiness is still rejected — an empty scope is malformed data, not a mere
 * format deviation). All OTHER field validation in the read hierarchy is
 * unchanged from the strict schemas.
 *
 * @see {@link ContextScopeSchema} for the strict write-time validator.
 */
export const ContextScopeReadSchema: z.ZodType<string> =
  z.string().min(1, 'Context scope is required');

/**
 * Lenient Subtask schema for READ-time validation (PRD §5.1; bugfix Issue 3B).
 *
 * @remarks
 * Identical to {@link SubtaskSchema} except `context_scope` uses the lenient
 * {@link ContextScopeReadSchema} (no CONTRACT DEFINITION format check). Used by
 * the read hierarchy below; the architect OUTPUT path keeps {@link SubtaskSchema}.
 */
export const SubtaskReadSchema: z.ZodType<
  Subtask,
  z.ZodTypeDef,
  Omit<Subtask, 'prd_selectors'> & { prd_selectors?: string[] }
> = z.object({
  id: z.string().regex(/^P\d+\.M\d+\.T\d+\.S\d+$/, 'Invalid subtask ID format (expected P{N}.M{N}.T{N}.S{N})'),
  type: z.literal('Subtask'),
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  status: StatusEnum,
  story_points: z.number({ invalid_type_error: 'Story points must be a number' })
    .multipleOf(0.5, 'Story points must be in 0.5 increments')
    .min(0.5, 'Story points must be at least 0.5')
    .max(21, 'Story points cannot exceed 21'),
  dependencies: z.array(z.string()).min(0),
  context_scope: ContextScopeReadSchema,
  prd_selectors: z.array(z.string()).optional().default([]),
});

/** Lenient Task schema for READ — uses SubtaskReadSchema (PRD §5.1; Issue 3B). */
export const TaskReadSchema: z.ZodType<
  Task, z.ZodTypeDef,
  Omit<Task, 'subtasks'> & {
    subtasks: (Omit<Subtask, 'prd_selectors'> & { prd_selectors?: string[] })[];
  }
> = z.object({
  id: z.string().regex(/^P\d+\.M\d+\.T\d+$/, 'Invalid task ID format (expected P{N}.M{N}.T{N})'),
  type: z.literal('Task'),
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  status: StatusEnum,
  description: z.string().min(1, 'Description is required'),
  subtasks: z.array(SubtaskReadSchema),
});

/** Lenient Milestone schema for READ — uses TaskReadSchema (PRD §5.1; Issue 3B). */
export const MilestoneReadSchema: z.ZodType<
  Milestone, z.ZodTypeDef,
  Omit<Milestone, 'tasks'> & { tasks: z.input<typeof TaskReadSchema>[] }
> = z.lazy(() =>
  z.object({
    id: z.string().regex(/^P\d+\.M\d+$/, 'Invalid milestone ID format (expected P{N}.M{N})'),
    type: z.literal('Milestone'),
    title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
    status: StatusEnum,
    description: z.string().min(1, 'Description is required'),
    tasks: z.array(z.lazy(() => TaskReadSchema)),
  })
);

/** Lenient Phase schema for READ — uses MilestoneReadSchema (PRD §5.1; Issue 3B). */
export const PhaseReadSchema: z.ZodType<
  Phase, z.ZodTypeDef,
  Omit<Phase, 'milestones'> & { milestones: z.input<typeof MilestoneReadSchema>[] }
> = z.lazy(() =>
  z.object({
    id: z.string().regex(/^P\d+$/, 'Invalid phase ID format (expected P{N})'),
    type: z.literal('Phase'),
    title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
    status: StatusEnum,
    description: z.string().min(1, 'Description is required'),
    milestones: z.array(z.lazy(() => MilestoneReadSchema)),
  })
);

/**
 * Lenient Backlog schema for READ-time validation (PRD §5.1; bugfix Issue 3B).
 *
 * @remarks
 * Root of the READ-time lenient hierarchy. Identical to {@link BacklogSchema}
 * except every nested subtask's `context_scope` is validated leniently
 * (non-empty string, no CONTRACT DEFINITION format requirement) via
 * {@link PhaseReadSchema} → MilestoneReadSchema → TaskReadSchema →
 * {@link SubtaskReadSchema} → {@link ContextScopeReadSchema}. The strict
 * {@link BacklogSchema} continues to validate architect OUTPUT (write time).
 *
 * Wired into the read path (`readTasksJSON` / `loadSession`) by P2.M2.T1.S2.
 *
 * @see {@link BacklogSchema} for the strict write-time validator.
 */
export const BacklogReadSchema: z.ZodType<
  Backlog, z.ZodTypeDef,
  Omit<Backlog, 'backlog'> & { backlog: z.input<typeof PhaseReadSchema>[] }
> = z.object({
  backlog: z.array(PhaseReadSchema),
});
```

## 2. Why `z.lazy()` is preserved on Milestone/Phase Read twins

The strict `MilestoneSchema`/`PhaseSchema` use BOTH an outer `z.lazy(() => …)`
and an inner `z.array(z.lazy(() => X))`. This is the existing, compiling pattern.
**Mirror it verbatim** for the Read twins — do not collapse the inner
`z.lazy(() => TaskReadSchema)` into a bare `z.array(TaskReadSchema)`. Reasons:
- **Forward-reference safety**: although `TaskReadSchema` is defined ABOVE
  `MilestoneReadSchema`, the inner `z.lazy` defers resolution; deviating risks
  subtle zod 3.x inference mismatches with the `z.input<typeof TaskReadSchema>`
  annotation.
- **Type parity**: keeping the structure identical to the strict originals means
  the generic annotations resolve the same way and the build stays green
  (verified baseline `tsc --noEmit` exit 0).

## 3. Field body fidelity — copy, don't paraphrase

Every field body in the Read twins MUST be byte-identical to the strict original
(regex, error messages, `multipleOf(0.5)`, `.min(0.5)`, `.max(21)`, `StatusEnum`,
`.optional().default([])`, etc.). The ONLY change per schema is the one named in
the contract:
- `SubtaskReadSchema`: `context_scope: ContextScopeReadSchema`
- `TaskReadSchema` / `MilestoneReadSchema` / `PhaseReadSchema` / `BacklogReadSchema`:
  the nested array points at the Read twin.

If you paraphrase a regex or drop a `.min(...)`, you've silently changed READ-time
structural validation — that defeats the "lenient on context_scope FORMAT ONLY"
guarantee and risks S2 wiring regressions.

## 4. Placement

Insert the entire Read-schema block as a single cohesive unit **immediately AFTER
`BacklogSchema`** (currently ends ~line 804), before the `Session Metadata`
section (~line 807). Dependency order within the block: `ContextScopeReadSchema`
→ `SubtaskReadSchema` → `TaskReadSchema` → `MilestoneReadSchema` →
`PhaseReadSchema` → `BacklogReadSchema` (each references the one above it). A
section-header comment banner (above) frames the write-strict/read-lenient split.

## 5. Type-safety proof points (what the new `tsc --noEmit` must keep green)

- `ContextScopeReadSchema: z.ZodType<string>` assignable as
  `context_scope: ContextScopeReadSchema` in a `z.object` whose declared output is
  `Subtask` (context_scope is `string`). Identical to how the strict
  `ContextScopeSchema: z.ZodType<string>` is used today → compiles.
- `z.input<typeof TaskReadSchema>[]` assignable to `MilestoneReadSchema`'s
  declared input type (same shape as the strict chain).
- No new imports needed — `z`, `StatusEnum`, and all Interfaces (`Subtask`,
  `Task`, `Milestone`, `Phase`, `Backlog`) are already in scope in `models.ts`.