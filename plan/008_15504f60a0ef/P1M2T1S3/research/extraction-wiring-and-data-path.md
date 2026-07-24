# S3 Research — Extraction wiring, data path & test strategy

This note captures the non-obvious facts that make S3 (selector extraction at
PRP-generation time + full-PRD fallback) one-pass implementable. It complements
the S2 research (`../P1M2T1S2/research/selector-scheme-and-block-parsing.md`),
which proved the selector dialect and the `generateSectionIndex` contract.

## 1. The data path — how the resolved PRD reaches `PRPGenerator.generate()`

PRD §4.2 says "The Researcher receives only the referenced sections." For S3 to
extract sections it must hold the **resolved** (include-expanded) PRD string.
Tracing the data flow:

- `SessionManager.initialize()` (session-manager.ts:492): `prdSnapshot: resolved`
  — the in-memory `prdSnapshot` IS the resolved document (post P1.M1).
- `SessionManager.loadSession()` (session-manager.ts:559-560): reads
  `prd_snapshot.md` (the resolved materialization) into `prdSnapshot`.
- `SessionState.prdSnapshot: string` (models.ts:903) — readonly, always present
  on a loaded session.
- `PRPGenerator` holds `readonly sessionManager: SessionManager` (public,
  prp-generator.ts:121-122) and the constructor throws if there is no current
  session (prp-generator.ts:182-186).

**Conclusion**: inside `PRPGenerator.generate()`,
`this.sessionManager.currentSession?.prdSnapshot` is the resolved PRD string.
Read it once, pass to `extractPRDSections`. No new I/O, no new constructor arg.

`PRPGenerator.generate()` callers (research-queue.ts:347, prp-runtime.ts:182)
already pass the sessionManager in — no caller change needed.

## 2. The selector source — `Subtask.prd_selectors` (P1.M2.T1.S1)

S1 (Implementing in parallel) adds `readonly prd_selectors: string[]` to the
`Subtask` interface + `prd_selectors: z.array(z.string()).optional().default([])`
to `SubtaskSchema`. By S3's implementation time S1 is Complete, so every loaded
`Subtask` has `prd_selectors` (populated from `tasks.json`, `[]` when absent).

`prd_selectors` exists ONLY on `Subtask`, NOT on `Task`. So in `generate()` the
selector read must be type-guarded:
```ts
const selectors = task.type === 'Subtask' ? task.prd_selectors : [];
```
(`isSubtask` from task-utils is already imported in prp-blueprint-prompt.ts; in
prp-generator.ts use the `task.type === 'Subtask'` discriminant directly — it's
a string-literal union field on both `Task`/`Subtask`.) A `Task` → `selectors=[]`
→ `extractPRDSections` returns the full PRD (fallback) — correct (Tasks have no
section selectors).

## 3. `createPRPBlueprintPrompt` — backward-compatible 6th param

Current signature (prp-blueprint-prompt.ts:287):
```ts
export function createPRPBlueprintPrompt(
  task, backlog, codebasePath?, prpOutputPath?, issueFeedback?
): Prompt<unknown>
```
Only ONE production caller: `prp-generator.ts:658`. ~50 test call sites
(`prp-blueprint-prompt.test.ts`, `agent-context-injection.test.ts`, two
integration suites). Adding `prdSections?: string` as the **6th OPTIONAL** param
keeps every existing call valid (0-5 args). The internal helper
`constructUserPrompt` gets the same 6th param; it injects a conditional
`## PRD Context` block (mirroring the existing `codebaseSection`/`feedbackSection`
pattern — empty/undefined ⇒ no section, byte-identical to today).

## 4. Where `extractPRDSections` lives + what it does

Home: **`src/core/prd-selector.ts`** (the file S2 CREATES). S3 EXTENDS it with
`extractPRDSections` + Mode-A JSDoc. S2's `generateSectionIndex`/`SectionIndex`
are the building blocks (REUSE — import; S2's file will exist by S3's run):

```ts
export function extractPRDSections(resolvedPRD: string, selectors: string[]): string
```

Logic (all-or-nothing fallback — see §5):
1. `if (!selectors || selectors.length === 0) return resolvedPRD;` (full-PRD fallback)
2. `const { sections } = generateSectionIndex(resolvedPRD);`
3. for each `sel` in `selectors` (caller order): if `sections.get(sel) === undefined`
   → `return resolvedPRD;` (any-miss ⇒ full-PRD fallback)
4. else collect the text; `return collected.join('\n\n');`

SYNC, no I/O, pure (same invariant as `generateSectionIndex`).

## 5. All-or-nothing fallback — the decision

Contract wording (S3 task description): "If selectors is empty/absent or
extraction fails for any selector, fall back to the full PRD." Read literally:
a miss on ANY selector ⇒ full-PRD fallback. We implement **all-or-nothing**
(conservative, contract-literal). Rationale: a partial slice could omit critical
requirements and silently mislead the Researcher; falling back to the full PRD is
safe and correct. Per S2's research, every one of the 63 live selectors in
session 008's `tasks.json` is a heading that resolves byte-exactly, so the
all-or-nothing rule essentially never triggers fallback in practice. Documented in
JSDoc.

Section ORDER in the concatenation = caller (`selectors`) order. Deterministic &
predictable (the Architect emits selectors in document order already).

## 6. The prp-generator.test.ts suite is ALREADY RED — do not "fix" it, do not grow it

Verified empirically (`npx vitest run tests/unit/agents/prp-generator.test.ts` →
**15 failed | 9 passed**). Root cause is a PRE-EXISTING mock gap unrelated to S3:
`vi.mock('node:fs/promises', …)` makes `readFile` a bare `vi.fn()` returning
`undefined`, so `PRPGenerator.#parsePRPText` throws
`Cannot read properties of undefined (reading 'match')` at prp-generator.ts:270
inside the retry loop — BEFORE the `createPRPBlueprintPrompt` arg assertion in the
"forward issueFeedback as 4th arg" test can run.

Implications for S3's validation strategy:
- **Do NOT attempt to fix those 15 tests** — out of scope; they predate S3.
- **Do NOT let the failure count grow.** Before/after S3, the same 15 must fail
  (and the same 9 must pass). That is the regression bar for this file.
- The generate() WIRING (extractPRDSections → 6th arg) CAN still be asserted with
  the **swallow-the-throw** pattern: `createPRPBlueprintPrompt` (line 658) is
  called BEFORE the failing agent/file-read step (line 678+), so a spy records the
  call even though `generate()` later rejects. Test shape:
  ```ts
  await expect(generator.generate(subtask, backlog)).rejects.toThrow();
  expect(mockCreatePRPBlueprintPrompt).toHaveBeenCalledWith(
    subtask, backlog, expect.any(String), expect.any(String), undefined,
    expect.stringContaining(<slice of resolved PRD>)   // ← 6th arg prdSections
  );
  ```
- The RELIABLE, mock-free proof of the feature is the pure `extractPRDSections`
  unit tests (added to S2's `prd-selector.test.ts`) + the pure `prdSections`
  injection tests (added to `prp-blueprint-prompt.test.ts`). Both suites are green.

## 7. The mock session manager already carries prdSnapshot

`createMockSessionManager` (prp-generator.test.ts:77) sets
`prdSnapshot: '# PRD Content'`. So `generate()` can read it in tests. For a
deterministic wiring assertion, use `prd_selectors: []` (or a Task) ⇒ fallback ⇒
6th arg === `'# PRD Content'` (full PRD). For an extraction-positive assertion,
override `prdSnapshot` to a small PRD with a known `h1.0` and set
`prd_selectors: ['h1.0']` ⇒ 6th arg contains that heading's text.

`createMockSubtask` (prp-generator.test.ts:83) does NOT currently set
`prd_selectors`. After S1 it's required on the interface, but tests/ are excluded
from `tsc.build` so the factory compiles without it. For S3's wiring test, build
the subtask WITH an explicit `prd_selectors` (don't rely on the factory default).

## 8. File-disjointness from parallel/complete work

S3 edits 4 src files + 3 test files:
- `src/core/prd-selector.ts` (S2 CREATES; S3 EXTENDS) — S2 done before S3.
- `src/core/index.ts` (EDIT re-export) — also touched by S2; S3 adds ONE line.
  Conflict-safe: S2 adds `generateSectionIndex`/`SectionIndex`/`SelectorType`;
  S3 adds `extractPRDSections`. Different lines.
- `src/agents/prompts/prp-blueprint-prompt.ts` (EDIT) — owned by S3 only (S1/S2
  don't touch prompts). P1.M1.T2.S3 is Complete and file-disjoint.
- `src/agents/prp-generator.ts` (EDIT) — owned by S3 only.
- Tests: `prd-selector.test.ts` (S2+S3), `prp-blueprint-prompt.test.ts` (S3),
  `prp-generator.test.ts` (S3 — additive only).

No overlap with S1's files (`models.ts`, `fix-cycle-workflow.ts`, `models.test.ts`)
or S2's sole-owned logic (`generateSectionIndex` body). The one shared edit point
(`prd-selector.ts` + its barrel + its test) is sequentially safe: S2 completes
first (S3 depends on it).