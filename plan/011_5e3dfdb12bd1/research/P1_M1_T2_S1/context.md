# PRP for P1.M1.T2.S1

## Goal

**Feature Goal**: Extend the Coder (Builder) runtime prompt `PRP_BUILDER_PROMPT` in `src/agents/prompts.ts` so the executor's terminal-state validation model is taught to the coder, and the coder is instructed NOT to delete a throwaway/spike artifact during its own turn. Encode PRD §9.9.2 **G1.4** and the §6.3 "terminal-state re-execution" note as two bold sub-paragraphs placed within/right-after step 4 (Progressive Validation). Phrase G1.4 so it **composes with** the existing `## FORBIDDEN ACTIONS — Critical-File Deletion Protection` block without contradicting it (the two rules protect different file classes).

**Deliverable**: (1) Edited `src/agents/prompts.ts` — two new bold sub-paragraphs inside `PRP_BUILDER_PROMPT` (terminal-state batch re-execution + G1.4 throwaway survival), inserted immediately after the line `**Each level must pass before proceeding to the next.**` and before `5. **Completion Verification**`; the JSON output contract at the end of the prompt is byte-for-byte unchanged. (2) A new `describe(...)` block in `tests/unit/agents/prompts.test.ts` asserting the new wording is present, correctly ordered before the JSON contract, and that the pre-existing anchors (FORBIDDEN ACTIONS block, progressive-validation steps, failure protocol, JSON contract) survive.

**Success Definition**: `npm run typecheck` passes (template literal still compiles — every backtick escaped, no stray dollar-brace interpolation); `npx vitest run tests/unit/agents/prompts.test.ts` passes with the new assertions green and all 49 baseline tests still green; `npm run lint` passes; `git diff --stat` touches only `src/agents/prompts.ts` and `tests/unit/agents/prompts.test.ts`.

## Why

PRD §9.9.1 documents a permanent-failure regression (`pi-nvim-bridge-hack P1.M1.T1.S1`): a spike PRP has gates 1–3 asserting a spike file EXISTS while gate 4 asserts the spike is GONE (`test ! -f extension/spike.ts`). No single terminal filesystem state satisfies both. REQ-G1 fixes this at the prompt layer: the **Researcher** side (sibling P1.M1.T1.S1, DONE — forbids emitting such gates); the **Coder** side is THIS task — G1.4 + the terminal-state re-execution note. The two together guarantee the coder leaves the spike on disk so its existence gates pass on the final tree, and the coder understands WHY (the executor re-runs every gate as a batch on the terminal state). Consumed by P1.M3.T1.S1 (Mode B doc mirror into PROMPTS.md). The runtime backstop (REQ-G2, neutralizing cached `! test -f` gates) is sibling P1.M2.

## What

Add two bold sub-paragraphs under step **4. Progressive Validation** of `PRP_BUILDER_PROMPT` (a single contiguous insertion, so the two instructions read as one logical unit):

(a) **Terminal-state gate re-execution (PRD §9.9)** — the executor re-runs every gate as a batch against the FINAL filesystem state, so every gate must be a *monotonic terminal-state assertion*.

(b) **Do not delete throwaway / spike artifacts during your turn (PRD §9.9 G1.4)** — leave any spike/scratch/throwaway artifact on disk until AFTER validation; cleanup runs only once gates have passed. The paragraph explicitly cross-references the FORBIDDEN ACTIONS block, stating it composes with — and does not relax — that block (which still forbids `rm` / `git rm` / `git clean` / `mv` on `PRD.md` / `PRP.md` / `plan/`); here the additional protected class is the *work artifact* the coder created.

### Success Criteria

- [ ] PRP_BUILDER_PROMPT contains a terminal-state-re-execution sub-paragraph naming "re-runs every validation gate as a ... batch", "FINAL filesystem state", and "monotonic terminal-state assertion".
- [ ] PRP_BUILDER_PROMPT contains a G1.4 sub-paragraph ("PRD §9.9 G1.4") stating the coder MUST NOT delete a throwaway/spike artifact during its own turn and that cleanup happens after validation.
- [ ] The G1.4 wording explicitly composes with the FORBIDDEN ACTIONS block (phrases "composes with" and "does not relax") and does not contradict it.
- [ ] The new guidance is placed AFTER "Each level must pass before proceeding to the next." and BEFORE the JSON output contract; the JSON contract ("Strictly output your results in this JSON format", `"result"`, `<PRP-README>`) is byte-for-byte unchanged.
- [ ] The pre-existing anchors survive: FORBIDDEN ACTIONS block (`` `rm` `` etc.), "Each level must pass before proceeding to the next", "Failure Protocol", "One-Pass Implementation Success", "Execute BASE PRP".
- [ ] No prompt structure outside step 4's new sub-paragraphs is changed — in particular PRP_BLUEPRINT_PROMPT, the executor, the model, PROMPTS.md, and PRD.md are untouched.

## All Needed Context

### Context Completeness Check

A developer who knows nothing about this repo can implement this from: the exact file + anchor lines, the fact that the target is a JS template literal (backticks must be escaped; never introduce dollar-brace interpolation), the verbatim target wording, the test file + the established toContain/toMatch pattern (and the green 49-test baseline), and the explicit list of sibling-owned regions not to touch. All five are provided below.

### Documentation & References (YAML)

```yaml
- docfile: PRD.md (already-merged §9.9.2 REQ-G1 G1.4 and §6.3 "terminal-state re-execution")
  why: canonical behavior to encode into the Coder prompt
  critical: G1.4 = coder MUST NOT delete a throwaway mid-turn; §6.3 = executor re-runs gates as a batch on the terminal state; both must be present and must compose with the FORBIDDEN ACTIONS block.
- file: src/agents/prompts.ts
  why: the ONLY runtime Coder prompt; the edit target
  pattern: PRP_BUILDER_PROMPT is a backtick template literal (L678 open, L762 close). Step 4 header at L731; the line `**Each level must pass before proceeding to the next.**` at L739 is the INSERT POINT; step 5 at L741; JSON output contract at L751. Inline code in the prompt escapes backticks (see the FORBIDDEN ACTIONS block: \`rm\`, \`git rm\`, \`PRD.md\`, \`plan/\`).
  gotcha: the JSON output contract (L751 "Strictly output your results in this JSON format" through the ```json block and the <PRP-README> placeholder) MUST NOT be altered; an unescaped backtick terminates the literal and breaks `npm run typecheck`; a dollar-brace sequence would start interpolation — never introduce one.
- file: tests/unit/agents/prompts.test.ts
  why: prompt-text assertion home; already imports PRP_BUILDER_PROMPT (L15) — NO import change needed
  pattern: mirror the existing describe('PRP_BLUEPRINT_PROMPT gate monotonicity rules (PRD §9.9 REQ-G1)') block (uses toContain for literals, toMatch(/.../i) for phrases). Also note the existing describe('critical-file deletion prohibition (PRD §5.1)') already asserts PRP_BUILDER_PROMPT contains `rm` / `PRD.md` / `plan/` / 'NOT temporary' via it.each — your additions must keep those green (they will — you are only adding text).
- docfile: plan/011_5e3dfdb12bd1/architecture/implementation-status.md
  section: A.2 (Builder prompt) and C (test surfaces)
  why: confirms the insertion point, the do-not-edit scope (PROMPTS.md / model / executor / Blueprint prompt), and the per-prompt-body assertion guidance.
- docfile: plan/011_5e3dfdb12bd1/prps/P1_M1_T1_S1.md
  why: the parallel sibling (Blueprint G1.1/G1.2/G1.3/G1.5) — its structure, escaping notes, and test block are the template to follow for this Builder-side task.
```

### Current codebase tree (relevant excerpt)

```
src/agents/
  prompts.ts        # <- EDIT: PRP_BUILDER_PROMPT step 4 (insert after L739, before L741)
  prp-executor.ts   # <- DO NOT TOUCH (P1.M2 / REQ-G2)
src/core/
  models.ts         # <- DO NOT TOUCH (ValidationGate; no schema change)
tests/unit/agents/
  prompts.test.ts   # <- EDIT: add describe block for G1.4 + terminal-state re-execution
PROMPTS.md          # <- DO NOT TOUCH (doc mirror; synced in P1.M3.T1.S1, Mode B)
PRD.md              # <- DO NOT TOUCH (human-owned)
```

### Known Gotchas of our codebase

```
# CRITICAL: PRP_BUILDER_PROMPT is a JS template literal. Inside it:
#   - every inline backtick MUST be escaped as  \`
#   - a dollar-brace sequence would start interpolation — never introduce one
#   - single quotes, < > | / are fine verbatim
# Example from the existing FORBIDDEN ACTIONS block (raw source bytes): \`rm\`
#
# GOTCHA: the JSON output contract at the end of the prompt (the
# "Strictly output your results in this JSON format:" line + the ```json fence
# + the { "result" ... } object + the <PRP-README> placeholder) is LOAD-BEARING
# for the executor output parsing. Do NOT alter it. Place the new guidance
# BEFORE it (it sits inside step 4, far above the contract).
#
# GOTCHA: keep the two new sub-paragraphs at the same indentation as the other
# bold sub-paragraphs under step 4 (3 leading spaces: "   **...**").
```

## Implementation Blueprint

### Task 1: ADD two sub-paragraphs in PRP_BUILDER_PROMPT (src/agents/prompts.ts)

**File:** `src/agents/prompts.ts` — template literal `PRP_BUILDER_PROMPT` (L678–L762).

**Exact change.** Inside step `4. **Progressive Validation**`, immediately after the line `   **Each level must pass before proceeding to the next.**` (L739) and before the blank line + `5. **Completion Verification**` (L741), insert the two bold sub-paragraphs below. The text shown is the RENDERED form (what the string value must contain); in the SOURCE, escape every inline backtick as `\``.

Target RENDERED text (3-space indent to match sibling step-4 sub-paragraphs):

```
   **Terminal-state gate re-execution (PRD §9.9).** The executor does not trust
   the order in which you ran the levels. Once you finish, it RE-RUNS every
   validation gate as a single BATCH against the FINAL filesystem state you leave
   behind. Therefore every gate must be a *monotonic terminal-state assertion* —
   once true, it stays true against the final tree. A gate whose result flips on
   intermediate state, or on whether a sibling task's file exists yet, cannot
   survive that final batch re-run and will permanently fail the item.

   **Do not delete throwaway / spike artifacts during your turn (PRD §9.9 G1.4).**
   Any spike, scratch file, or throwaway artifact you created to explore or prove
   something MUST survive on disk until *after* validation — leave it in place
   when you finish, and run any cleanup only once the gates have passed. Deleting
   it mid-turn would make the final-tree batch re-run fail the artifact's own
   existence gates (the artifact would be absent from the terminal state). This
   composes with — and does not relax — the FORBIDDEN ACTIONS block above: that
   block still forbids `rm` / `git rm` / `git clean` / `mv` on `PRD.md`,
   `PRP.md`, and `plan/`; here the additional protected class is the *work
   artifact* you created, which must stay alive until validation completes.
```

Distinctive substrings the test asserts are present verbatim (case-insensitive where marked): 'terminal-state gate re-execution'; /re-runs every validation gate as a.*batch/i; 'FINAL filesystem state'; 'monotonic terminal-state assertion'; 'G1.4'; /throwaway/i; /spike/i; /do not delete throwaway/i; 'during your turn'; 'after validation'; 'composes with'; 'does not relax'.

**NAMING/PLACEMENT:** plain markdown bold sub-paragraphs (3-space indent) directly under step 4, between the "Each level must pass..." line and step 5. No new section headings; no renumbering.

### Task 2: ADD prompt-text assertions (tests/unit/agents/prompts.test.ts)

**File:** `tests/unit/agents/prompts.test.ts` (PRP_BUILDER_PROMPT imported at L15 — no import change). Add a new describe block alongside the existing Blueprint monotonicity describe. **Robustness pattern (IMPORTANT):** the new prompt text is hard-wrapped across multiple lines for readability, and uses `*emphasis*`/`**bold**`. So normalize before asserting phrases: `const norm = PRP_BUILDER_PROMPT.replace(/[`*]/g, '').replace(/\s+/g, ' ');` then run the phrase `toMatch`/`toContain` assertions against `norm`. This makes assertions immune to line-wrapping and emphasis markers. Keep backtick-token assertions (`` `rm` `` etc.) and `indexOf()` ordering on the RAW `PRP_BUILDER_PROMPT`. For backtick-containing assertions write the toContain argument as a single-quoted JS string with literal backticks inside — exactly as the existing `critical-file deletion prohibition` block already does for PRP_BUILDER_PROMPT (read that block first to copy the quoting).

```ts
describe('PRP_BUILDER_PROMPT throwaway-survival + terminal-state re-execution (PRD §9.9 G1.4)', () => {
  // Normalize: strip backticks/asterisks and collapse whitespace so the
  // assertions are immune to the prompt's hard line-wrapping and emphasis.
  const norm = PRP_BUILDER_PROMPT.replace(/[`*]/g, '').replace(/\s+/g, ' ');

  it('explains the executor re-runs every gate as a batch on the final filesystem state', () => {
    expect(norm).toMatch(/terminal-state gate re-execution/i);
    expect(norm).toMatch(/re-runs every validation gate as a single batch/i);
    expect(norm).toMatch(/final filesystem state/i);
    expect(norm).toMatch(/monotonic terminal-state assertion/i);
  });

  it('instructs the coder not to delete throwaway/spike artifacts during its own turn (G1.4)', () => {
    expect(norm).toContain('G1.4');
    expect(norm).toMatch(/throwaway/i);
    expect(norm).toMatch(/spike/i);
    expect(norm).toMatch(/do not delete throwaway/i);
    expect(norm).toMatch(/during your turn/i);
    expect(norm).toMatch(/survive on disk/i);
    expect(norm).toMatch(/after validation/i);
  });

  it('composes the G1.4 rule with the existing FORBIDDEN ACTIONS block without contradicting it', () => {
    expect(norm).toMatch(/composes with/i);
    expect(norm).toMatch(/does not relax/i);
    expect(PRP_BUILDER_PROMPT).toContain('FORBIDDEN ACTIONS — Critical-File Deletion Protection');
    expect(PRP_BUILDER_PROMPT).toContain('`rm`');
    expect(PRP_BUILDER_PROMPT).toContain('`PRD.md`');
    expect(PRP_BUILDER_PROMPT).toContain('`plan/`');
  });

  it('places the new guidance after step 4 and before the JSON output contract, leaving the contract unchanged', () => {
    const eachLevelIdx = PRP_BUILDER_PROMPT.indexOf('Each level must pass before proceeding to the next');
    const guidanceIdx = PRP_BUILDER_PROMPT.search(/monotonic terminal-state assertion/i);
    const contractIdx = PRP_BUILDER_PROMPT.indexOf('Strictly output your results in this JSON format');
    expect(eachLevelIdx).toBeGreaterThan(-1);
    expect(guidanceIdx).toBeGreaterThan(-1);
    expect(contractIdx).toBeGreaterThan(-1);
    expect(eachLevelIdx).toBeLessThan(guidanceIdx);
    expect(guidanceIdx).toBeLessThan(contractIdx);
    expect(PRP_BUILDER_PROMPT).toContain('Strictly output your results in this JSON format');
    expect(PRP_BUILDER_PROMPT).toContain('"result"');
    expect(PRP_BUILDER_PROMPT).toContain('<PRP-README>');
  });

  it('preserves the pre-existing execution-process and header anchors', () => {
    expect(PRP_BUILDER_PROMPT).toContain('Execute BASE PRP');
    expect(PRP_BUILDER_PROMPT).toContain('One-Pass Implementation Success');
    expect(PRP_BUILDER_PROMPT).toContain('Failure Protocol');
    expect(PRP_BUILDER_PROMPT).toContain('NOT temporary');
  });
});
```

### Integration Points / Scope Boundaries (HARD — do not cross)

- `PRP_BLUEPRINT_PROMPT` (same file, L182–L667): owned by P1.M1.T1.S1 (DONE). Do not edit.
- `src/agents/prp-executor.ts` `#runValidationGates()`: owned by P1.M2 (REQ-G2). Do not edit.
- `src/core/models.ts` `ValidationGate`: NO schema change anywhere in §9.9.
- The JSON output contract at the end of PRP_BUILDER_PROMPT (L751–L760): verbatim preserved.
- `PROMPTS.md`: doc mirror, synced in P1.M3.T1.S1 (Mode B; depends on this task). Not imported at runtime; do not edit here.
- `PRD.md`: human-owned; never modify.

## Validation Loop

- **Level 1 (Syntax):** `npm run typecheck` — compiles the edited template literal; catches an unescaped backtick or a stray dollar-brace that would break the file.
- **Level 2 (Unit Tests):** `npx vitest run tests/unit/agents/prompts.test.ts` — the new G1.4 / terminal-state assertions pass and the 49 baseline tests stay green.
- **Level 3 (Style):** `npm run lint` — eslint clean on the edited .ts files.
- **Level 4 (Scope/Contract — manual):** `git diff --stat` shows only the two files; the JSON output contract is byte-identical. (Emitted as a manual/null-command gate per the very G1.2/G1.3 rules this changeset teaches.)

No service to start / no integration harness — this task ships static prompt text + its text assertions.

## DOCS Impact

Mode B (changeset-level). This subtask touches an internal runtime prompt (`src/agents/prompts.ts`) and has NO per-item doc. The `PROMPTS.md` doc mirror of the G1.4 + terminal-state wording is synced by the final changeset-level task **P1.M3.T1.S1** (which lists this task as a dependency).

## Final Validation Checklist

- [ ] `npm run typecheck` passes.
- [ ] `npx vitest run tests/unit/agents/prompts.test.ts` passes (new block + 49 baseline).
- [ ] `npm run lint` passes.
- [ ] `git diff --stat` touches only `src/agents/prompts.ts` and `tests/unit/agents/prompts.test.ts`.
- [ ] The JSON output contract ("Strictly output your results in this JSON format" → `{ "result" ... }` → `<PRP-README>`) is unchanged.

## Confidence Score: 9/10

Localized static text in one template-literal step + a parallel test block. The only real risks are (1) backtick escaping in the template literal — caught immediately by `npm run typecheck`; (2) the backtick-in-toContain assertion quoting in the test — verifiable against the existing `critical-file deletion prohibition` block that already does it for PRP_BUILDER_PROMPT.
