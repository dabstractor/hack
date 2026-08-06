# Research notes — P1.M1.T2.S1

Task: Add throwaway-survival (G1.4) + terminal-state-re-execution guidance to
`PRP_BUILDER_PROMPT` and assert via prompt-text test.

## Target file & exact anchors (CURRENT working tree, verified)

`src/agents/prompts.ts` — `PRP_BUILDER_PROMPT` is a JS template literal:
- L678  `export const PRP_BUILDER_PROMPT = \``  (open)
- L683  `## FORBIDDEN ACTIONS — Critical-File Deletion Protection (PRD §5.1)`
- L731  `4. **Progressive Validation**`
- L739  `   **Each level must pass before proceeding to the next.**`   ← INSERT AFTER
- L741  `5. **Completion Verification**`
- L747  `**Failure Protocol**: ...`
- L751  `Strictly output your results in this JSON format:`   ← JSON output contract (DO NOT TOUCH)
- L762  ` as const;`  (close)

NOTE: the work-item contract said "lines 675–744" but the tree shifted because
sibling P1.M1.T1.S1 (Blueprint prompt) already landed its G1.x bullets
(PRDP_BLUEPRINT_PROMPT close is now L667; G1.3 bullet visible at L292). Use the
anchors above, not the contract's stale line numbers.

## The two additions (from PRD §9.9.2 REQ-G1 G1.4 + §6.3 "terminal-state re-execution")

(a) Terminal-state batch re-execution note — the executor RE-RUNS every gate as
    a BATCH against the FINAL filesystem state, so gates must be monotonic
    terminal-state assertions. Place within/right-after step 4 (after L739).
(b) G1.4 — coder MUST NOT delete a throwaway/spike artifact during its own turn;
    cleanup happens AFTER validation. Wording must COMPOSE WITH (not contradict)
    the existing FORBIDDEN ACTIONS block (which forbids rm/git-rm/git-clean/mv
    on PRD.md/PRP.md/plan/). The two rules protect different file classes:
    pipeline-state (FORBIDDEN ACTIONS) vs the work artifact (G1.4).

Both go together as two bold sub-paragraphs under step 4, right after
"Each level must pass before proceeding to the next." and before step 5.

## CRITICAL gotcha — template-literal escaping

`PRP_BUILDER_PROMPT` is a backtick template literal. In the SOURCE:
- every inline backtick MUST be escaped as  \`   (the G1.4 paragraph references
  `rm`, `git rm`, `git clean`, `mv`, `PRD.md`, `PRP.md`, `plan/` — all escaped)
- the sequence  ${  would start interpolation — never introduce one
- In the RENDERED string value, the escapes collapse to literal backticks, so a
  test asserting `toContain('`rm`')` matches the rendered backtick. The existing
  `describe('critical-file deletion prohibition')` block already does exactly
  this for PRP_BUILDER_PROMPT → confirms the pattern.
- `npm run typecheck` (`tsc --noEmit -p tsconfig.build.json`) catches an
  unescaped backtick immediately (it would terminate the literal → compile error).

## DO NOT TOUCH (scope boundaries, per §E / sibling ownership)

- `PRP_BLUEPRINT_PROMPT` (same file, L182–L667) — owned by P1.M1.T1.S1 (DONE).
- `src/agents/prp-executor.ts` `#runValidationGates()` — owned by P1.M2 (REQ-G2).
- `src/core/models.ts` `ValidationGate` — NO schema change anywhere in §9.9.
- The JSON output contract at the END of the prompt (L751–L760) — verbatim
  preserved; new guidance placed BEFORE it.
- `PROMPTS.md` — Mode B doc mirror, synced in P1.M3.T1.S1 (depends on THIS task).
- `PRD.md` — human-owned.

## Test home & pattern (verified green baseline = 49 tests)

`tests/unit/agents/prompts.test.ts`:
- imports `PRP_BUILDER_PROMPT` at L15 (already present — no import change needed).
- Existing assertions on PRP_BUILDER_PROMPT that MUST stay green: 'Execute BASE
  PRP', 'One-Pass Implementation Success', '<PRP-README>'/'</PRP-README>',
  PROMPTS.PRP_BUILDER identity, and the `critical-file deletion prohibition`
  block (asserts '`rm`','`git rm`','`git clean`','`mv`','`PRD.md`','`PRP.md`',
  '`plan/`','NOT temporary' via it.each).
- Pattern to mirror: the `describe('PRP_BLUEPRINT_PROMPT gate monotonicity rules
  (PRD §9.9 REQ-G1)')` block (added by sibling T1.S1) uses toContain for literal
  substrings and toMatch(/.../i) for phrases. Add a parallel describe for the
  Builder prompt.

## Verified commands

- `npm run typecheck` → `tsc --noEmit -p tsconfig.build.json` (exists).
- `npx vitest run tests/unit/agents/prompts.test.ts` → 49 passed (baseline).
- `npm run lint` → `eslint . --ext .ts` (exists).
