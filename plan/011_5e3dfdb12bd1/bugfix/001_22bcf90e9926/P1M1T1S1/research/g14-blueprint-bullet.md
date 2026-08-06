# Research — P1.M1.T1.S1 (add G1.4 throwaway-survival bullet to Blueprint prompt)

Bugfix 001 BUG-001 (MINOR): PRD §9.9.2 G1.4 mandates the throwaway-survival
instruction in BOTH the Blueprint (Researcher) and Builder (Coder) prompts. The
Builder has it (src/agents/prompts.ts:750); the Blueprint omits it. S1 adds the
missing bullet (+ PROMPTS.md mirror + a failing-first test).

## 1. Exact current state (verified file:line)

**`src/agents/prompts.ts`** — `PRP_BLUEPRINT_PROMPT` (182–677). The gate-construction
`CRITICAL RULES for gate commands` block (under `### Step 3: Research Integration` →
`**Validation Gates**`) enumerates, one bullet per line:
- L290: G1.1 (negative file/dir-existence gates forbidden)
- L291: G1.2 (scope boundaries are never shell gates)
- L292: G1.3 (cleanup/throwaway deletion is never a shell gate) ← STYLE TEMPLATE
- L293: G1.5 (negated content gates only on permanent own-deliverable absence)
- **G1.4 is ABSENT** → insert a new bullet line BETWEEN L292 and L293.

**Builder G1.4** (L750): `**Do not delete throwaway / spike artifacts during your turn
(PRD §9.9 G1.4).**` — the CONTENT REFERENCE. Note the Builder addresses the Coder
directly; the Blueprint bullet must be phrased as a PRP-construction rule (Researcher
instructs the Coder VIA the generated PRP).

**`PROMPTS.md`** mirror — same block at lines 274–277 (G1.1=274, G1.2=275, G1.3=276,
G1.5=277). Insert G1.4 between L276 and L277. PROMPTS.md uses REGULAR markdown
backticks (`` ` ``) and `_underscore_` emphasis; prompts.ts uses ESCAPED backticks
(`\``) and `*asterisk*` emphasis.

**`tests/unit/agents/prompts.test.ts`** — `describe('PRP_BLUEPRINT_PROMPT gate
monotonicity rules (PRD §9.9 REQ-G1)', …)` at L283–309. Cases for G1.1/G1.2/G1.3
(L~298)/G1.5 — NO G1.4 case. Add a new `it()` between the G1.3 case and the G1.5 case,
modeled on the G1.3 case. The Builder G1.4 is already tested at L360–400.

**Split wrapper** `src/agents/prompts/prp-blueprint-prompt.ts` embeds the monolith via
`import { PRP_BLUEPRINT_PROMPT }` — editing the monolith is sufficient; NO separate
split-file edit.

## 2. The new G1.4 bullet (Blueprint / Researcher framing)

**prompts.ts** (escaped backticks; insert between L292 G1.3 and L293 G1.5):
```
- **Throwaway artifacts must survive the coder's turn (PRD §9.9 G1.4).** The PRP you generate MUST instruct the Coder Agent not to delete any spike, scratch, or throwaway artifact during its own turn — cleanup happens only after validation passes. The artifact MUST survive on disk until the gates have passed, so the terminal-state batch re-run still satisfies its own existence gates; deleting it mid-turn would make the final-tree re-run fail. Express the "delete the artifact" step as a \`manual: true\` cleanup instruction, never as a shell gate (G1.1/G1.3 already forbid \`test ! -f <throwaway>\`).
```

Style match: bold-headed, single paragraph, references `PRD §9.9 G1.4`, escaped backticks
(`\``) consistent with G1.1/G1.3, em-dash `—` consistent with neighbors. Distinct from the
Builder (which addresses the Coder directly) — this is a PRP-construction rule.

**PROMPTS.md** (regular backticks; insert between L276 G1.3 and L277 G1.5): identical text
but with regular `` ` `` (drop the backslash escapes). No underscore emphasis needed (keeps
it simple; avoids the asterisk-vs-underscore divergence).

## 3. The new test case (failing-first; modeled on G1.3 at L298)

Insert between the G1.3 `it(...)` and the G1.5 `it(...)` in the L283–309 describe block:
```ts
it('requires the generated PRP to keep throwaway artifacts alive until after validation (G1.4)', () => {
  expect(PRP_BLUEPRINT_PROMPT).toContain('G1.4');
  expect(PRP_BLUEPRINT_PROMPT).toMatch(/throwaway/i);
  expect(PRP_BLUEPRINT_PROMPT).toMatch(/survive/i);
});
```
This FAILS before the prompt edit (no 'G1.4' in PRP_BLUEPRINT_PROMPT) and PASSES after.
Optional strengthening: `expect(PRP_BLUEPRINT_PROMPT).toContain('manual: true');` (the
bullet references it; passes after the edit). The Builder G1.4 test (L360–400) already
asserts `survive on disk` / `after validation` for the Coder prompt — do NOT duplicate;
this new case is Blueprint-specific.

## 4. Implicit-TDD order (per contract)

1. Add the test case → `npx vitest run tests/unit/agents/prompts.test.ts` → NEW case FAILS
   (RED), all others pass.
2. Edit prompts.ts (insert G1.4 bullet) → re-run → NEW case PASSES (GREEN).
3. Mirror to PROMPTS.md.
4. `npm run typecheck` → exit 0 (prompts.ts is source, in tsconfig.build.json; a string-
   literal addition cannot introduce type errors).

## 5. Scope / gotchas

- S1 = Blueprint bullet + PROMPTS.md mirror + 1 test. The Builder prompt ALREADY has G1.4 —
  do NOT touch it. The split wrapper needs NO edit (it embeds the monolith).
- The `§` and `—` are unicode literals already used throughout prompts.ts — copy them verbatim.
- Escaped backticks: in the TS template literal, inline code is `\`...\``; in PROMPTS.md it's
  `` `...` ``. Don't cross the two.
- vitest 100% coverage on src/**/*.ts is UNAFFECTED — adding string content to a template
  literal adds no executable branches.
- prettier is ERROR-enforced → run `npm run fix` after the edits (the long bullet line is fine;
  prettier does not reflow markdown-in-strings, but run it to be safe).
- Functional impact is LOW (Builder carries the Coder-facing rule; G1.3 already blocks the
  harmful gate) — this satisfies the literal "Blueprint AND Builder" spec wording.