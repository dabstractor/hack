# Research — P1.M2.T3.S1: Update Coder-Agent error assertion to §4.5.1 format-nudge terminal message

> Load-bearing facts for a surgical, single-assertion test fix (bugfix 001, BUG-002 §(c)).
> Captured 2026-08-12 by direct inspection + **running the failing test**.

## 1. The single edit (confirmed by execution)

`tests/integration/prp-executor-integration.test.ts`, test `'should handle invalid
JSON from Coder Agent'` (line 482):

- **Line 496** — KEEP unchanged: `expect(result.success).toBe(false);`
- **Line 497** — CHANGE the `toContain` substring:
  - FROM: `expect(result.error).toContain('Failed to parse Coder Agent response');`
  - TO:   `expect(result.error).toContain('did not return a parseable JSON result envelope after 2 format nudge(s)');`

That is the entire change. One string literal on one line. No import change, no
setup change, no `src/` change.

## 2. The ACTUAL emitted message (captured by RUNNING the test)

Ran `npx vitest run tests/integration/prp-executor-integration.test.ts -t 'should handle invalid JSON from Coder Agent'`.
The failure output shows the real `result.error`:

```
Coder Agent did not return a parseable JSON result envelope after 2 format nudge(s) (PRD §4.5.1). Last response: Not valid JSON at all
```

- **The nudge count is `2`** — confirmed. Two WARN log lines
  ("Coder Agent response had no parseable JSON result envelope — sending format
  nudge (PRD §4.5.1)") fired before the terminal message.
- The test setup does NOT override `FORMAT_NUDGE_MAX` (grep: the test file has
  zero `FORMAT_NUDGE` references), so the **default `2`** applies
  (`src/config/constants.ts:459` → `export const FORMAT_NUDGE_MAX = 2;`).
- The contract's "run the test once to confirm the exact number" instruction is
  satisfied: **the number is 2.**

## 3. Why the new substring is the right one (and the legacy one is wrong)

`src/agents/prp-executor.ts` has TWO messages that look related — only ONE is the
terminal `result.error` for a no-envelope response:

| Location | Message | Role | Reaches `result.error`? |
| -------- | ------- | ---- | ----------------------- |
| ~line 382–385 (after the format-nudge `while` loop) | `` `Coder Agent did not return a parseable JSON result envelope after ${formatNudges} format nudge(s) (PRD §4.5.1). Last response: ${coderResponse.slice(0,300)}` `` | **Terminal** message — overwrites `coderResult.message` when `formatFailure === true` after nudge exhaustion | **YES** ← assert THIS |
| ~line 866 (inside `#parseCoderResult`'s `catch`) | `` `Failed to parse Coder Agent response: ${response}` `` | **Intermediate** — sets `formatFailure: true` on the parse result, then gets **overwritten** by the terminal message above | **NO** (overwritten) |

So the test's old assertion (`'Failed to parse Coder Agent response'`) targets a
message that is structurally never the final `result.error` for this code path.
The §4.5.1 format-nudge loop (lines ~360–378) re-prompts the SAME coder up to
`FORMAT_NUDGE_MAX` times; on exhaustion the terminal message (line ~385) wins.

## 4. The format-nudge loop mechanics (why the mock exhausts at 2)

The test's mock: `mockAgent.prompt.mockResolvedValue('Not valid JSON at all');`
(returns the same unparseable string on EVERY call). The loop:

```ts
let formatNudges = 0;
const maxFormatNudges = FORMAT_NUDGE_MAX;            // 2
while (coderResult.formatFailure === true && formatNudges < maxFormatNudges) {
  formatNudges++;                                     // 1, then 2
  // ... #nudgeForFormat re-prompts the coder (mock returns 'Not valid JSON at all' again)
  coderResult = this.#parseCoderResult(coderResponse); // still formatFailure: true
}
if (coderResult.formatFailure === true) {            // exhausted
  coderResult = { result:'error', formatFailure:true,
    message: `Coder Agent did not return a parseable JSON result envelope after ${formatNudges} format nudge(s) (PRD §4.5.1). Last response: ${coderResponse.slice(0,300)}` };
}
```

Because the mock never produces a parseable envelope, `formatNudges` reaches 2
(== `FORMAT_NUDGE_MAX`), the loop exits, and the terminal message interpolates
`${formatNudges}` = **2**. Confirmed by the live run.

## 5. Substring-choice rationale (robustness)

The chosen substring `'did not return a parseable JSON result envelope after 2
format nudge(s)'`:
- **Includes the count `2`** — load-bearing: it proves the nudge loop ran to
  exhaustion (the §4.5.1 path), distinguishing it from the legacy single-shot
  parse-failure path. Asserting without the count would pass even if the loop
  regressed to zero iterations.
- **Excludes the `Last response: …` tail** — that tail interpolates the mock's
  raw output (`'Not valid JSON at all'`), which is brittle to assert on.
- **Excludes the `(PRD §4.5.1)` citation** — optional; including it would also be
  fine but isn't necessary. The count-bearing prefix is the meaningful anchor.

**Alternative (more robust to a future default change):** import `FORMAT_NUDGE_MAX`
and build the substring dynamically —
`` `did not return a parseable JSON result envelope after ${FORMAT_NUDGE_MAX} format nudge(s)` ``
(requires `import { FORMAT_NUDGE_MAX } from '../../src/config/constants.js';`).
The contract prescribes the literal `'2'` (and the live run confirms 2), so the
literal is PRIMARY; the dynamic form is an optional robustness variant the
implementer may choose. Either passes.

## 6. Boundaries (no overlap with siblings)

- **No `src/` change.** Test-only. The implementation already behaves per PRD
  §4.5.1; only the stale assertion is wrong.
- **File-disjoint from the parallel sibling P1.M2.T2.S1** — that item edits
  `tests/unit/protected-files.test.ts`; this item edits
  `tests/integration/prp-executor-integration.test.ts`. Zero file overlap → no
  merge conflict.
- **File-disjoint from P1.M2.T1.S1** (`tests/unit/workflows/fix-cycle-workflow.test.ts`).
- **Consumed by P1.M2.T4.S1** (full-suite verification: this is 1 of the 8 stale
  tests; T4.S1 confirms `npx vitest run` → 0 failed).

## 7. Validation (verified commands)

```bash
# The targeted test — currently FAILS; after the edit, PASSES:
npx vitest run tests/integration/prp-executor-integration.test.ts -t 'should handle invalid JSON from Coder Agent'

# The whole file stays green (the other 11 tests are unaffected — it's a one-literal change):
npx vitest run tests/integration/prp-executor-integration.test.ts

# Lint/format on the touched test file (the edit is inside a test override block where
# no-unused-vars etc. are relaxed, and the change is a string literal — stays clean):
npx eslint tests/integration/prp-executor-integration.test.ts
npx prettier --check tests/integration/prp-executor-integration.test.ts
```
The full-suite `npm run test:run` / `npm run validate` green-check is P1.M2.T4.S1's
job (this item owns exactly this 1 test).