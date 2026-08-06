# P1.M1.T1.S1 — Research Notes

Forbid non-monotonic gates in `PRP_BLUEPRINT_PROMPT` and assert via prompt-text test.

## Edit target (verified)

- File: `src/agents/prompts.ts`
- `export const PRP_BLUEPRINT_PROMPT = \`` at **line 182**; closes `` ` as const; `` at **line 664**. It is a JS **template literal** → every backtick MUST be escaped as `` \` `` and any `${` would interpolate (avoid).
- The gate-construction rules block lives at **line 285** (`**Validation Gates**: … CRITICAL RULES for gate commands:`), with bullets **286–290**:
  - L286 ONE command per gate
  - L287 Prefer standard tooling (`npm test`, `npx vitest run <file>`, …)
  - L288 NEVER write `grep` with mixed single/double quotes (contains tricky `` \`["'"'']\`` — DO NOT touch)
  - L289 NEVER embed heredocs / `for` loops / multi-line scripts
  - L290 partial G1.2 scope-boundary bullet → **STRENGTHEN** (replace) per G1.2
- `rg -n "CRITICAL RULES for gate"` → **exactly one hit** (L285). The Builder prompt has NO such block (G1.4 lives elsewhere; sibling P1.M1.T2.S1). Edit target is unambiguous.

## Scope boundaries (do NOT touch — owned by siblings)

- `PRP_BUILDER_PROMPT` (lines 675–759) — G1.4 throwaway-survival is **P1.M1.T2.S1**.
- `src/agents/prp-executor.ts` `#runValidationGates()` — REQ-G2 neutralization is **P1.M2**.
- `PROMPTS.md` (doc mirror) — synced in **P1.M3.T1.S1** (Mode B). NOT imported at runtime.
- `src/core/models.ts` `ValidationGate` — NO schema change (P1.M2 is runtime-only).

## PRD source wording to encode (§9.9.2, from prd_snapshot.md)

- **G1.1** — forbid negative file/directory-existence gates; forms: `test ! -f|-e|-d <path>`, `! test -f|-e|-d <path>`, `[ ! -f|-e|-d <path> ]`, `! [ -f|-e|-d <path> ]`. Rationale: existence is owned by the task graph, non-monotonic across it.
- **G1.2** — "do not create/modify file X" / "do not import Y" MUST be a **Success Criterion** OR a **`manual: true` Level-4 gate**, never a shell gate.
- **G1.3** — spike/throwaway "delete the artifact" is a cleanup instruction; "the artifact is gone" MUST be `manual: true`. `test ! -f <throwaway>` forbidden by G1.1 + doubly here.
- **G1.5** — negated content gate (`! grep -q …`) permitted ONLY on this task's own deliverable when absence is permanent (e.g. no TODOs); never about another task's file.
- Keep all existing gate rules (one command, standard tooling, no mixed-quote grep, no heredocs).

## Test surface (verified pattern)

- File: `tests/unit/agents/prompts.test.ts` (44 tests, currently passing).
- Already imports `PRP_BLUEPRINT_PROMPT` (L8). Existing precedent: `describe('PRP_BLUEPRINT_PROMPT single-PRP / batching gates (PRD §6.2)')` uses `toContain` / `toMatch`.
- Add a `describe('PRP_BLUEPRINT_PROMPT gate monotonicity rules (PRD §9.9 REQ-G1)')` block with per-G-rule `it`s + a preservation `it`.

## Validation commands (verified executable)

- `npm run typecheck` → `tsc --noEmit -p tsconfig.build.json` (catches broken template literal / unescaped backtick / stray `${`).
- `npx vitest run tests/unit/agents/prompts.test.ts` → prompt-text assertions (ran: 44 tests pass today).
- `npm run lint` → `eslint . --ext .ts`.

All three are monotonic positive terminal-state assertions (per the very rules this task encodes).
