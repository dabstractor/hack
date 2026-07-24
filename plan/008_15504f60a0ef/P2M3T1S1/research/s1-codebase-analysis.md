# S1 Codebase Analysis — P2.M3.T1.S1

> Update `PRP_BLUEPRINT_PROMPT` with strict single-PRP default + batching gates.

## 1. The single source of truth: `PRP_BLUEPRINT_PROMPT`

- **File**: `src/agents/prompts.ts`
- **Symbol**: `export const PRP_BLUEPRINT_PROMPT` (line **182**)
- **Length**: the file is 1038 lines; the constant spans lines 182 → ~815 (it is a
  big template literal embedding `$PRP_README`, `$PRP_TEMPLATE`,
  `${PRD_PREMERGED_DECLARATION}`, etc.).
- It is a template-literal **string** (so editing it = editing raw prompt text; no
  TS types/logic involved).
- Re-exported via the `PROMPTS` lookup object at line 1028:
  `PRP_BLUEPRINT: PRP_BLUEPRINT_PROMPT`.

The contract's "`createPRPBlueprintPrompt` in `prp-blueprint-prompt.ts:288`" refers
to the **consumer** of the constant, not the edit site. The edit site is the
constant text itself in `prompts.ts`. `createPRPBlueprintPrompt` imports and
interpolates `PRP_BLUEPRINT_PROMPT` verbatim (and optionally `.replace()`s one line
when `prpOutputPath` is set — that replace targets a specific sentence and is
unaffected by this change).

## 2. The exact insertion seam (proven by reading the file)

Current structure at the top of the constant (lines 187–195):

```
## Work Item Information

**ITEM TITLE**: <item_title>
**ITEM DESCRIPTION**: <item_description>

You are creating a PRP (Product Requirement Prompt) for this specific work item.

## PRP Creation Mission

Create a comprehensive PRP that enables **one-pass implementation success** through systematic research and context curation.
```

**The two highest-leverage insertion points** (both keep the change isolated and
visible to the LLM at the very top of the prompt):

- **(A)** Immediately AFTER the line
  `You are creating a PRP (Product Requirement Prompt) for this specific work item.`
  (line 192) — before `## PRP Creation Mission`. This is where the item task prompt
  itself places the MULTI-PRP BATCHING POLICY (it sits right after "for this
  specific work item"). Mirroring that placement keeps the orchestrator's task
  prompt and the system prompt in sync.
- **(B)** Immediately AFTER the `## PRP Creation Mission` header paragraph
  (line 196) — before `**Critical Understanding**:`. This gives the gating policy
  its own visible `##` section.

**Recommendation: (A)** — a dedicated `## MULTI-PRP BATCHING POLICY — READ THIS
BEFORE WRITING MORE THAN ONE PRP` section inserted right after line 192, matching
the item task prompt's own structure verbatim (so the LLM sees the same gates on
both channels). This is the lowest-risk, highest-fidelity option.

## 3. Existing tests that assert on `PRP_BLUEPRINT_PROMPT` text (must NOT break)

### `tests/unit/agents/prompts.test.ts`
- `PRP_BLUEPRINT_PROMPT should contain expected header` → asserts `.toContain('Create PRP for Work Item')` and `'PRP Creation Mission'`. ✅ Both strings remain present.
- `PRP_BLUEPRINT_PROMPT should contain template placeholders` → asserts `<item_title>` and `<item_description>`. ✅ Unchanged.
- `PRP_BLUEPRINT_PROMPT should carry the declaration (system channel)` → asserts `.toContain('do not chase @include directives yourself')`. ✅ `${PRD_PREMERGED_DECLARATION}` untouched.
- `PRP_BLUEPRINT_PROMPT should export as string, length > 100`. ✅ Still a string, longer.

### `tests/unit/agents/prompts/prp-blueprint-prompt.test.ts`
- Asserts `prompt.systemOverride` contains `'Create PRP for Work Item'` and `'PRP Creation Mission'`. ✅ Both preserved.
- Asserts `prompt.user` contains task title, context_scope, `<item_title>` placeholder, parent context. ✅ All in the **user** prompt (unchanged); our edit is to the **system** constant.
- `PRP_BLUEPRINT_PROMPT DOCS impact reminder (PRD §6.4)` describe block asserts `systemOverride` matches `/DOCS impact/i`, `/Mode A/i`, `DOCS:`, `/Mode B/i`, `/changeset-level/i`. ✅ That text lives much later in the constant (~Step 3 / Docs Impact) and is untouched.

**Conclusion**: the proposed text insertion does NOT touch any asserted substring.
No existing test needs modification, and the change is purely additive text.

## 4. What SHOULD be added (regression coverage for the new contract)

There is currently **no** test asserting the single-PRP / batching-gates policy.
Since PRD §6.2 makes this a hard rule, S1 should ADD a small test in
`tests/unit/agents/prompts.test.ts` (inside the existing `describe('PRP_BLUEPRINT_PROMPT'...)`
or a sibling describe) asserting the key substrings land in the constant:

- `exactly ONE PRP` (or `one PRP`)
- `MULTI-PRP` (section header)
- `When in doubt, write one`
- the per-item research budget phrasing, e.g. `3–5` or `3-5`
- `No Prior Knowledge`

This mirrors the existing `should carry the declaration (system channel)` test
pattern (substring assertions on the constant) and locks the contract against
future regressions (exactly the style used by P2.M2.T1.S3's "lock the invariant"
approach).

## 5. Validation commands (proven to exist in package.json)

```
npm run validate        # = lint && format:check && typecheck && test:run
npm run typecheck       # tsc --noEmit -p tsconfig.build.json
npm run lint            # eslint . --ext .ts
npm run format:check    # prettier --check "**/*.{ts,js,json,md,yml,yaml}"
npx vitest run tests/unit/agents/prompts.test.ts
npx vitest run tests/unit/agents/prompts/prp-blueprint-prompt.test.ts
npm run test:run        # full suite
```

Coverage: `vitest.config.ts` enforces **100%** coverage on `include: ['src/**/*.ts']`
with `include: ['tests/**/*.{test,spec}.ts']` for test files. Adding a few lines of
string-literal text to a constant does NOT change any executable branch, so the
100% threshold is unaffected. Adding a substring-assertion test only adds coverage.

## 6. Scope fences (from the item contract)

- **Only `src/agents/prompts.ts` is edited** (the `PRP_BLUEPRINT_PROMPT` text).
- **`tests/unit/agents/prompts.test.ts` may be edited** (add 1 describe/it block
  asserting the new policy substrings — this is the regression lock).
- **NOT edited**: `prp-blueprint-prompt.ts` (the consumer — its
  `.replace('Store the PRP...')` targets a different sentence and is unaffected),
  `prp-generator.ts`, any other prompt constant, any docs (item 5: DOCS none),
  `PRD.md`, `tasks.json`.
- **No input consumed** from prior subtasks (item 2: prompt-content change).
- **No user-facing/config/API surface** (item 5: prompt-internal).

## 7. The verbatim PRD §6.2 text to encode (single source)

> **Single-PRP default with strict batching gates:** A PRP call writes exactly
> **ONE** PRP — the one it was asked for — not several batched into one session.
> Batching is permitted _only_ as an optimization for tightly-coupled items, at a
> _higher_ bar (not a lower one): before any second PRP is written, the agent must
> hold the full task-tree and full-PRD context, run 3–5 subagent research calls
> _per item_ (the research budget is per PRP, so an N-PRP batch needs ~N× the
> research), pass a per-item "No Prior Knowledge" check, and declare the batch
> explicitly. **When in doubt, write one.** This prevents the thin,
> under-researched PRPs that batching produced in the past.

This is the exact normative content. The item task prompt already contains an
expanded version of this policy (the "MULTI-PRP BATCHING POLICY" block in the task
template) — the system prompt should encode the same gates.

## 8. Subagent caveat (important wording detail)

The current `## Research Process` block in this same constant was rewritten
(likely in P1/P2) to say:

> "Subagents are OPTIONAL and may be unavailable … Do NOT invent names … If a
> subagent call returns 'Unknown agent', STOP calling subagents and do the research
> yourself."

So the new batching-gates text must be **compatible** with "subagents may be
unavailable." The item contract says "run 3-5 subagent research calls per item" —
to stay consistent with the existing subagent-optional caveat, phrase it as
"a per-item research budget (3–5 deep research calls — yourself if no subagents
are available)". This keeps §6.2's intent (per-item thoroughness) without
contradicting the subagent-optional note 30 lines below. The PRD §6.2 phrasing
("3–5 subagent research calls per item") is the spec; the implementation should
preserve its meaning while honoring the existing subagent-optional caveat.