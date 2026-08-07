# PRP — P1.M1.T1.S3: Reconcile agent-factory `ThinkingLevel` type (add `minimal`, drop `max`, alias `ReasoningLevel`)

> Plan 013, PRD §9.2.9 (Per-Role Reasoning Level). S1 (LANDED) added the canonical `ReasoningLevel`
> (`off|minimal|low|medium|high|xhigh`) + `REASONING_LEVELS` in `src/config/constants.ts`. S3 reconciles
> the **divergent** `ThinkingLevel` in `src/agents/agent-factory.ts` (which has `max`, lacks `minimal`,
> and carries a JSDoc that factually contradicts the upstream pi SDK) by aliasing it to `ReasoningLevel`
> — single source of truth — and rewriting the JSDoc. **Type + JSDoc only; no factory/ROLE_CONFIG
> changes (T3 owns those); no field rename (back-compat).** Consumed by T3 (factories compose
> `ThinkingLevel` values onto `AgentConfig.thinking`).

---

## Goal

**Feature Goal**: In `src/agents/agent-factory.ts`, replace the divergent `ThinkingLevel` literal
union (`'off'|'low'|'medium'|'high'|'xhigh'|'max'`, L123) with `export type ThinkingLevel =
ReasoningLevel;` — aliasing S1's canonical `ReasoningLevel` from `src/config/constants.ts` (which
mirrors the pi SDK's `VALID_THINKING_LEVELS` / PRD §9.2.9 exactly: adds `minimal`, drops `max`).
Rewrite the now-factually-wrong JSDoc block (L108-122) that claimed the pipeline "intentionally
EXCLUDES `minimal`" vs the pi SDK. Add `type ReasoningLevel` to the existing constants import.

**Deliverable**:
1. **`src/agents/agent-factory.ts`** — 2 edits: (a) extend the L33 constants import with
   `type ReasoningLevel`; (b) rewrite the ThinkingLevel JSDoc + replace the type with the alias.
2. **`tests/unit/agents/agent-factory.test.ts`** — TDD: append a `describe('ThinkingLevel
   reconciliation …')` block asserting `ThinkingLevel === ReasoningLevel` (type-level) + the runtime
   vocabulary proxy (`REASONING_LEVELS` has `minimal`, not `max`).

**Success Definition**:
- `ThinkingLevel` is an alias of `ReasoningLevel` (single source of truth): `off|minimal|low|medium|
  high|xhigh`. `minimal` is IN; `max` is OUT.
- The JSDoc states the pipeline mirrors the pi SDK / §9.2.9 vocabulary exactly; the "intentionally
  excludes `minimal`" claim is gone.
- `AgentConfig.thinking` stays typed `ThinkingLevel` (NO field rename — back-compat). `ROLE_CONFIG`,
  `createBaseConfig`, and the factories are UNCHANGED (T3 owns them).
- `npm run typecheck && npm run lint && npm run format:check` clean; the agent-factory test suite
  stays green; the new reconcile assertions pass (runtime `REASONING_LEVELS` check enforced by
  `vitest run`; `expectTypeOf` enforced by `vitest typecheck`).

---

## Why

- **Correctness: the type contradicted its own documented upstream.** The JSDoc at agent-factory.ts
  L118-120 claimed the pi SDK "also includes `minimal`" and the pipeline "intentionally EXCLUDES"
  it. But the pi SDK's `VALID_THINKING_LEVELS == ["off","minimal","low","medium","high","xhigh"]`
  (external-deps.md §2, verified in `node_modules/.../args.js`) — IDENTICAL to §9.2.9. The pipeline
  was the divergent one (had `max`, lacked `minimal`). The comment was factually wrong; the type was
  wrong. S3 fixes both.
- **Single source of truth for the §9.2.9 vocabulary.** With `ReasoningLevel` canonical in
  `constants.ts` (consumed by S2 getters, T2 `.hack` schema, T4 startup validation), keeping a
  second hand-maintained union in `agent-factory.ts` guarantees drift. Aliasing (`ThinkingLevel =
  ReasoningLevel`) makes them one type — future vocabulary changes happen in one place.
- **Enables T3 cleanly.** T3 decouples model from reasoning and composes `ThinkingLevel` values onto
  `AgentConfig.thinking`. For that composition to accept the full §9.2.9 vocabulary (including
  `minimal`), `ThinkingLevel` must be the reconciled set. S3 is the prerequisite type fix.
- **`max` is dead weight.** Repo-wide grep confirms `'max'` is set by NO caller (only in the union +
  its JSDoc). `ROLE_CONFIG` uses `'xhigh'` (the §9.2.9 maximum), never `'max'`. Dropping it is safe
  and removes a token the pi SDK doesn't recognize.
- **Scope discipline.** S3 = type alias + JSDoc + import + tests ONLY. It does NOT touch the factories,
  `ROLE_CONFIG`, `createBaseConfig` (T3), `.env.example` (S4), `.hack` schema (T2), or the startup
  validator (T4). `AgentConfig.thinking` is NOT renamed (back-compat).

---

## What

### User-visible behavior
None (internal type reconcile). Indirectly, once T3 lands: the implementation agent can be configured
to `PRP_REASONING_IMPL_AGENT=minimal` (previously rejected by the divergent type) and the `max` token
(that no caller used and the pi SDK doesn't recognize) is gone.

### Technical requirements (exact contract)

**File 1 — `src/agents/agent-factory.ts`** (2 edits):

**(a) Import (L33)** — add the canonical type to the existing constants import:
```ts
// BEFORE:
import { getBugFinderAgent } from '../config/constants.js';
// AFTER:
import { getBugFinderAgent, type ReasoningLevel } from '../config/constants.js';
```
(Inline `type` modifier — consistent with the file's existing `type AgentPersona, type ModelRole`
inline-style imports.)

**(b) ThinkingLevel JSDoc + type (L108-123)** — rewrite the JSDoc (remove the wrong "intentionally
excludes `minimal`" claim; state the vocabulary mirrors the pi SDK / §9.2.9) and replace the union
with the alias:
```ts
/**
 * Extended-thinking (reasoning) budget for an agent (PRD §9.2.9).
 *
 * @remarks
 * An alias of {@link ReasoningLevel} (`src/config/constants.ts`) — the single source of truth for
 * the §9.2.9 vocabulary, which MIRRORS the pi SDK's `VALID_THINKING_LEVELS` exactly:
 * `off | minimal | low | medium | high | xhigh` (`xhigh` is the maximum; there is no `max`).
 *
 * This is a pipeline-internal budget marker: it rides on {@link AgentConfig.thinking} for downstream
 * harness wiring (the `pi` harness maps it to `--thinking <level>`); Groundswell's `AgentConfig`
 * itself does not model thinking. Each agent role resolves its own level via the `PRP_REASONING_*`
 * env vars (§9.2.9), decoupled from its model tier (§9.2.3).
 */
export type ThinkingLevel = ReasoningLevel;
```
(The `@remarks` about being a pipeline-internal marker that rides on `AgentConfig.thinking` is KEPT —
still true. The role→level specifics are NOT documented here — that's `ROLE_CONFIG`'s domain, owned by
T3. `AgentConfig.thinking?: ThinkingLevel` at L167 is UNCHANGED — no field rename.)

**File 2 — `tests/unit/agents/agent-factory.test.ts`** (append a describe block; TDD).

### Success Criteria
- [ ] `ThinkingLevel` exported from `agent-factory.ts` as `export type ThinkingLevel = ReasoningLevel;`.
- [ ] `type ReasoningLevel` added to the L33 constants import.
- [ ] JSDoc rewritten: states the vocabulary mirrors the pi SDK / §9.2.9 (`off|minimal|low|medium|high|
      xhigh`; `xhigh` is max; no `max`); the "intentionally excludes `minimal`" claim removed.
- [ ] `AgentConfig.thinking` unchanged (still `ThinkingLevel`); `ROLE_CONFIG` / `createBaseConfig` /
      factories untouched.
- [ ] New test block: runtime `REASONING_LEVELS` has `minimal`, not `max` (enforced by `vitest run`);
      `expectTypeOf<ThinkingLevel>().toEqualTypeOf<ReasoningLevel>()` (enforced by `vitest typecheck`);
      `@ts-expect-error` on `'max'` (compile-time guard).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/agents/agent-factory.test.ts` green (existing + new).

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the exact current code (with line numbers), the exact before/after for
both edits, the verified vocabulary-alignment proof (pi SDK == §9.2.9 == ReasoningLevel), the
verified fact that `'max'` has no caller, the enforceable-test subtlety (which gate enforces which
assertion), and the executable validation commands.

### Documentation & References

```yaml
# MUST READ — the reconcile site + the JSDoc-is-wrong proof
- docfile: plan/013_3f31aa2b81b7/architecture/integration-points.md
  section: "C. src/agents/agent-factory.ts — type reconcile + factory decoupling"
  why: Pins the exact change: ThinkingLevel:123 → `export type ThinkingLevel = ReasoningLevel` (add
        minimal, drop max); JSDoc:114-122 rewrite. Confirms the prior "intentionally excludes minimal"
        comment is wrong. (The factory-decoupling bullets in §C are T3, NOT S3.)

# MUST READ — the pi SDK vocabulary proof (decisive)
- docfile: plan/013_3f31aa2b81b7/architecture/external-deps.md
  section: "§2" → "VALID_THINKING_LEVELS = [\"off\", \"minimal\", \"low\", \"medium\", \"high\", \"xhigh\"]"
  why: Proves the pi SDK vocabulary is IDENTICAL to §9.2.9; the pipeline's current ThinkingLevel
        DIVERGES (has max, lacks minimal); the agent-factory.ts:119-121 JSDoc is "now factually wrong".

# MUST READ — S1's canonical type (the alias target) + S3 design + enforceable-test subtlety
- file: plan/013_3f31aa2b81b7/P1M1T1S1/PRP.md
  why: S1 defined ReasoningLevel/REASONING_LEVELS/resolveReasoningLevel/ReasoningConfigError. S3 aliases
        ThinkingLevel to that ReasoningLevel (single source of truth).
- docfile: plan/013_3f31aa2b81b7/P1M1T1S3/research/thinking-level-reconcile-design.md
  section: "2. Why 'max' is safe to drop" and "3. THE enforceable-test subtlety"
  why: grep-confirmed 'max' has no caller; which gate (vitest run vs vitest typecheck vs build tsc)
        enforces each assertion style.

# PATTERN FILE 1 — the ONLY source file edited (current state verified in-repo)
- file: src/agents/agent-factory.ts
  why: L33 (the constants import to extend), L108-123 (the ThinkingLevel JSDoc + type to rewrite),
        L167 (AgentConfig.thinking — UNCHANGED), L251-255 (ROLE_CONFIG — UNCHANGED, T3), L304-319
        (createBaseConfig — UNCHANGED, T3).
  pattern: "import { getBugFinderAgent } from '../config/constants.js';  →  + type ReasoningLevel"
  gotcha: Do NOT touch ROLE_CONFIG/createBaseConfig/factories (T3) or rename AgentConfig.thinking.

# PATTERN FILE 2 — the canonical type S3 aliases to (READ-ONLY — consume, don't modify)
- file: src/config/constants.ts
  why: ReasoningLevel (:1519) + REASONING_LEVELS (:1534, `as const`) — the single source of truth.
        The constants.ts header itself notes "(alias ThinkingLevel = ReasoningLevel) is P1.M1.T1.S3".
  critical: Do NOT modify constants.ts (S1/S2 own it). S3 only IMPORTS the ReasoningLevel type.

# VOCABULARY PROOF (pi SDK == §9.2.9 == ReasoningLevel)
- file: node_modules/@earendil-works/pi-coding-agent/dist/cli/args.js
  why: `VALID_THINKING_LEVELS = ["off","minimal","low","medium","high","xhigh"]` — IDENTICAL to §9.2.9.
        Confirms the pipeline (off|low|medium|high|xhigh|max) is the divergent one.

# TEST FILE — append the reconcile assertions
- file: tests/unit/agents/agent-factory.test.ts
  why: The existing suite (imports createBaseConfig/…/type AgentPersona/ModelRole from agent-factory.js).
        Append a describe('ThinkingLevel reconciliation …') block. Reuse the existing vitest import
        line (add expectTypeOf). Import REASONING_LEVELS from constants.js + type ThinkingLevel/
        ReasoningLevel for the assertions.
  gotcha: ThinkingLevel is a pure TYPE alias — no runtime value. The enforceable runtime proof is via
        REASONING_LEVELS (the array backing ReasoningLevel). expectTypeOf/@ts-expect-error are
        type-level (enforced by `vitest typecheck`, not the default `vitest run` gate) — see research §3.

# VERIFIED API SURFACE
- type ReasoningLevel = 'off'|'minimal'|'low'|'medium'|'high'|'xhigh'   (constants.ts:1519 — S1 LANDED)
- const REASONING_LEVELS = ['off','minimal','low','medium','high','xhigh'] as const  (constants.ts:1534)
```

### Current Codebase tree (relevant slice)

```bash
src/agents/agent-factory.ts               # EDIT — import (L33) + ThinkingLevel JSDoc/type (L108-123)
src/config/constants.ts                   # READ-ONLY (S1/S2 — ReasoningLevel/REASONING_LEVELS consumed, not modified)
tests/unit/agents/agent-factory.test.ts   # EDIT — append the reconcile describe block
```

### Desired Codebase tree with files to be edited

```bash
src/agents/agent-factory.ts               # MODIFIED (2 edits: import + JSDoc/type alias)
tests/unit/agents/agent-factory.test.ts   # MODIFIED (append describe block)
# No other files. No ROLE_CONFIG/factory changes (T3). No .env.example (S4). No docs files
# (Mode A: the JSDoc rewrite IS the doc — a correctness fix to a comment that contradicted the SDK).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — S3 is the TYPE + JSDoc + import ONLY. Do NOT change ROLE_CONFIG (L251-255),
//   createBaseConfig (L304-319), or any factory (T3 owns those). Do NOT rename AgentConfig.thinking
//   (L167 — back-compat; T3 composes ThinkingLevel values onto it).

// CRITICAL — do NOT modify src/config/constants.ts (S1/S2 own it). S3 only IMPORTS the ReasoningLevel
//   type from it. The alias makes constants.ts the single source of truth.

// CRITICAL — 'max' has NO caller (grep-confirmed: only at agent-factory.ts:123 + its JSDoc). Dropping
//   it is safe. ROLE_CONFIG uses 'xhigh' (the §9.2.9 maximum), never 'max'. Do NOT keep 'max' "for
//   safety" — it diverges from the pi SDK and is the bug.

// CRITICAL — ThinkingLevel is a pure TYPE alias (no runtime value). A test CANNOT do
//   expect(ThinkingLevel).toContain('minimal'). The enforceable runtime proof is via REASONING_LEVELS
//   (the `as const` array backing ReasoningLevel, which ThinkingLevel now aliases). Lead with that.

// GOTCHA — enforcement gates differ by assertion style:
//   - expect(REASONING_LEVELS).toContain('minimal') / .not.toContain('max') → enforced by `vitest run`
//     (the DEFAULT runtime gate). ✅ This is the primary proof.
//   - expectTypeOf<ThinkingLevel>().toEqualTypeOf<ReasoningLevel>() → enforced by `vitest typecheck`
//     (NOT the default gate; the project's typecheck is `tsc -p tsconfig.build.json` which EXCLUDES
//     tests). Include it as the item's "ThinkingLevel === ReasoningLevel" type-level proof.
//   - @ts-expect-error on `const _bad: ThinkingLevel = 'max'` → inert under the default gate (build
//     tsc excludes tests); a net-positive guard if tests are ever type-checked. Suppresses the expected
//     error when 'max' is correctly rejected; trips "Unused @ts-expect-error" if 'max' is re-added.

// GOTCHA — inline `type` import modifier (`import { getBugFinderAgent, type ReasoningLevel }`) matches
//   the file's existing style (`type AgentPersona, type ModelRole`). Keep it on ONE import line.

// GOTCHA — no runtime branches are added/removed (type alias + JSDoc). So agent-factory.ts's existing
//   100% coverage is unaffected; the new test additions are purely additive (no re-coverage needed).

// GOTCHA — prettier is ERROR-enforced (prettier/prettier: error). Run `npm run fix` before format:check.

// GOTCHA — do NOT run the full `npm run test:run` as the gate (orthogonal pre-existing failures per
//   the plan's TEST_RESULTS). S3's gate: typecheck + lint + format + tests/unit/agents/agent-factory.test.ts.
```

---

## Implementation Blueprint

### Data models and structure

```ts
// src/agents/agent-factory.ts — the alias (single source of truth).
import { getBugFinderAgent, type ReasoningLevel } from '../config/constants.js';
// …
export type ThinkingLevel = ReasoningLevel;   // was: 'off'|'low'|'medium'|'high'|'xhigh'|'max'
// AgentConfig.thinking?: ThinkingLevel  — UNCHANGED (no field rename; back-compat).
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/agents/agent-factory.ts — the import + the alias + JSDoc
  - EDIT L33: `import { getBugFinderAgent } from '../config/constants.js';` → add `, type ReasoningLevel`.
  - EDIT L108-123: rewrite the JSDoc (per "Technical requirements" (b)) + replace
        `export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';` with
        `export type ThinkingLevel = ReasoningLevel;`.
  - DO NOT: touch AgentConfig.thinking (L167), ROLE_CONFIG (L251-255), createBaseConfig (L304-319),
        any factory, or constants.ts.
  - EXPECTED: typecheck clean. (ROLE_CONFIG.reasoning.thinking = 'xhigh' is still valid — 'xhigh' ∈
        ReasoningLevel. No caller referenced 'max', so nothing breaks.)

Task 2: EDIT tests/unit/agents/agent-factory.test.ts — append the reconcile describe block (TDD)
  - ADD `expectTypeOf` to the existing `import { … } from 'vitest';` line (if not already present).
  - ADD imports: `REASONING_LEVELS` from '../../../src/config/constants.js'; `type ThinkingLevel`
        from '../../../src/agents/agent-factory.js'; `type ReasoningLevel` from
        '../../../src/config/constants.js'.
  - APPEND describe('ThinkingLevel reconciliation (PRD §9.2.9 / P1.M1.T1.S3)') with:
      * it('aliases ReasoningLevel — minimal present, max absent (runtime vocabulary)'):
          expect(REASONING_LEVELS).toContain('minimal'); expect(REASONING_LEVELS).not.toContain('max');
          expect(REASONING_LEVELS).toEqual(['off','minimal','low','medium','high','xhigh']);  // exact
      * it('ThinkingLevel === ReasoningLevel (type-level)'):
          expectTypeOf<ThinkingLevel>().toEqualTypeOf<ReasoningLevel>();
          // compile-time guard (enforced if tests are type-checked):
          // @ts-expect-error 'max' was dropped from the reconciled vocabulary
          const _rejectedMax: ThinkingLevel = 'max';
          void _rejectedMax;
  - PLACEMENT: append at the end of the file (a new top-level describe, sibling to the existing
        describe('agents/agent-factory')). Do NOT modify existing tests.
  - EXPECTED: green under `vitest run` (the REASONING_LEVELS runtime assertions); the expectTypeOf +
        @ts-expect-error are type-level (pass under `vitest typecheck`; inert otherwise — documented).

Task 3: FORMAT + VERIFY
  - RUN: npm run fix (lint:fix + prettier --write) → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/agents/agent-factory.test.ts   # existing + new reconcile block.
  - (OPTIONAL) npx vitest typecheck tests/unit/agents/agent-factory.test.ts   # enforces expectTypeOf.
  - EXPECTED: clean; agent-factory suite green. If typecheck errors on an unused 'max' literal
        somewhere, grep for `'max'` and confirm no caller (the only one was the union you replaced).
        If lint flags the `_rejectedMax` unused var, confirm it starts with `_` (varsIgnorePattern ^_).
```

### Implementation Patterns & Key Details

```ts
// ---- src/agents/agent-factory.ts (the 2 edits) ----
import { getBugFinderAgent, type ReasoningLevel } from '../config/constants.js';
// …
/**
 * Extended-thinking (reasoning) budget for an agent (PRD §9.2.9).
 *
 * @remarks
 * An alias of {@link ReasoningLevel} (`src/config/constants.ts`) — the single source of truth for
 * the §9.2.9 vocabulary, which MIRRORS the pi SDK's `VALID_THINKING_LEVELS` exactly:
 * `off | minimal | low | medium | high | xhigh` (`xhigh` is the maximum; there is no `max`).
 *
 * This is a pipeline-internal budget marker: it rides on {@link AgentConfig.thinking} for downstream
 * harness wiring (the `pi` harness maps it to `--thinking <level>`); Groundswell's `AgentConfig`
 * itself does not model thinking. Each agent role resolves its own level via the `PRP_REASONING_*`
 * env vars (§9.2.9), decoupled from its model tier (§9.2.3).
 */
export type ThinkingLevel = ReasoningLevel;

// ---- tests/unit/agents/agent-factory.test.ts (the appended block) ----
import { expectTypeOf } from 'vitest';
import { REASONING_LEVELS } from '../../../src/config/constants.js';
import type { ThinkingLevel } from '../../../src/agents/agent-factory.js';
import type { ReasoningLevel } from '../../../src/config/constants.js';

describe('ThinkingLevel reconciliation (PRD §9.2.9 / P1.M1.T1.S3)', () => {
  it('aliases ReasoningLevel — minimal present, max absent (runtime vocabulary)', () => {
    // ThinkingLevel is a pure type alias, so verify via REASONING_LEVELS (the array backing it).
    expect(REASONING_LEVELS).toContain('minimal');
    expect(REASONING_LEVELS).not.toContain('max');
    expect([...REASONING_LEVELS]).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  });

  it('ThinkingLevel === ReasoningLevel (type-level)', () => {
    // Enforced by `vitest typecheck` (the canonical "same type" proof).
    expectTypeOf<ThinkingLevel>().toEqualTypeOf<ReasoningLevel>();
    // Compile-time guard: 'max' is no longer assignable. Inert under the default gate (build tsc
    // excludes tests); trips "Unused @ts-expect-error" if 'max' is ever re-added.
    // @ts-expect-error 'max' was dropped from the reconciled vocabulary
    const _rejectedMax: ThinkingLevel = 'max';
    void _rejectedMax;
  });
});
```

### Integration Points

```yaml
DEPENDS ON (must be LANDED):
  - P1.M1.T1.S1 (ReasoningLevel/REASONING_LEVELS/resolveReasoningLevel/ReasoningConfigError): LANDED —
        the alias target. constants.ts:1519/1534.

DOWNSTREAM (S3 ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T3 (factory decoupling): createBaseConfig takes an explicit `thinking: ThinkingLevel` param;
        factories compose role-resolved levels onto AgentConfig.thinking. Depends on ThinkingLevel being
        the reconciled §9.2.9 vocabulary (this subtask).
  - P1.M1.T2 (.hack [reasoning] schema): acceptedValues = ['off','minimal','low','medium','high','xhigh']
        (matches ThinkingLevel post-S3).

NO SOURCE INTEGRATION beyond src/agents/agent-factory.ts (2 edits) + the test file. constants.ts
  (S1/S2), ROLE_CONFIG/createBaseConfig/factories (T3), .env.example (S4), .hack (T2), startup
  validation (T4) are UNCHANGED. AgentConfig.thinking is NOT renamed (back-compat).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean (src/ is type-checked)
npm run lint                 # eslint . --ext .ts — clean
npm run format:check         # prettier --check — clean
# Expected: clean. If typecheck errors, the most likely cause is a stale 'max' literal somewhere —
#   grep ` ThinkingLevel` / `'max'` and fix the caller (there should be none). If lint flags the
#   `_rejectedMax` unused var, confirm it's `_`-prefixed (varsIgnorePattern: ^_).
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run tests/unit/agents/agent-factory.test.ts   # existing suite + the new reconcile block
# Expected: green. The REASONING_LEVELS runtime assertions are enforced here. The expectTypeOf +
#   @ts-expect-error are type-level (enforced by `vitest typecheck`, not `vitest run`) — they don't
#   fail the runtime gate but document + guard the alias.
# (OPTIONAL) npx vitest typecheck tests/unit/agents/agent-factory.test.ts   # enforces expectTypeOf.
# Do NOT run the full `npm run test:run` — orthogonal pre-existing failures (per the plan's TEST_RESULTS).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S3 — a type alias + JSDoc with no runtime behavior change. Smoke-confirm the alias resolves
# and the vocabulary is the §9.2.9 set:
npx tsx -e "
import { REASONING_LEVELS } from './src/config/constants.ts';
console.log('vocab:', REASONING_LEVELS.join(','));
// ThinkingLevel is a type-only alias — confirm it accepts 'minimal' and rejects 'max' at the type
// level by compiling a tiny snippet (the test file's @ts-expect-error does this permanently).
"
# Expected: vocab: off,minimal,low,medium,high,xhigh  (minimal IN, max OUT — matches pi SDK / §9.2.9).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface. Domain checks (record in commit message):
#   - ThinkingLevel now aliases ReasoningLevel (single source of truth; off/minimal/low/medium/high/xhigh).
#   - 'minimal' added (was wrongly excluded); 'max' dropped (diverged from pi SDK; no caller).
#   - The factually-wrong "intentionally excludes minimal" JSDoc is rewritten to state the pipeline
#     mirrors the pi SDK / §9.2.9 vocabulary exactly.
#   - AgentConfig.thinking unchanged (no field rename); ROLE_CONFIG/createBaseConfig/factories untouched (T3).
#   - The reconcile is the prerequisite for T3's factory decoupling (compose ThinkingLevel values).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/agents/agent-factory.test.ts` green (existing + reconcile block).

### Feature Validation
- [ ] `export type ThinkingLevel = ReasoningLevel;` (alias — single source of truth).
- [ ] `type ReasoningLevel` added to the L33 constants import.
- [ ] JSDoc rewritten: mirrors pi SDK / §9.2.9 vocabulary; "intentionally excludes minimal" gone.
- [ ] `AgentConfig.thinking` unchanged; `ROLE_CONFIG` / `createBaseConfig` / factories untouched.
- [ ] New test: `REASONING_LEVELS` has `minimal`, not `max` (runtime); `expectTypeOf<ThinkingLevel>()
      .toEqualTypeOf<ReasoningLevel>()` (type-level); `@ts-expect-error` on `'max'` (compile-time guard).

### Code Quality Validation
- [ ] Only `src/agents/agent-factory.ts` (2 edits) + the test file are touched.
- [ ] `src/config/constants.ts` (S1/S2), `ROLE_CONFIG`/`createBaseConfig`/factories (T3) UNCHANGED.
- [ ] `AgentConfig.thinking` NOT renamed (back-compat).
- [ ] `'max'` confirmed dropped with no caller (grep-verified).
- [ ] No runtime branches added/removed (type alias + JSDoc) → coverage unaffected.

### Documentation & Deployment
- [ ] JSDoc rewrite is the doc (Mode A — a correctness fix to a comment that contradicted the upstream SDK).
- [ ] Commit message notes: ThinkingLevel aliased to ReasoningLevel (minimal in, max out); the prior
      "excludes minimal" JSDoc was factually wrong (pi SDK == §9.2.9); factories = T3; no field rename.

---

## Anti-Patterns to Avoid

- ❌ Don't keep `'max'` "for safety" — it diverges from the pi SDK / §9.2.9 and is the bug. grep confirms
      no caller; `ROLE_CONFIG` uses `'xhigh'` (the real maximum), never `'max'`.
- ❌ Don't drop `'minimal'` — it IS in the pi SDK + §9.2.9 (its absence was the bug the JSDoc lied about).
- ❌ Don't modify `src/config/constants.ts` — S1/S2 own it. S3 only IMPORTS the `ReasoningLevel` type.
- ❌ Don't touch `ROLE_CONFIG` / `createBaseConfig` / factories / `AgentConfig.thinking` — T3 owns those;
      S3 is the TYPE + JSDoc + import ONLY. No field rename (back-compat).
- ❌ Don't try `expect(ThinkingLevel).toContain('minimal')` — `ThinkingLevel` is a pure type alias (no
      runtime value). The enforceable runtime proof is via `REASONING_LEVELS`.
- ❌ Don't rely on `expectTypeOf` / `@ts-expect-error` as the SOLE gate — they're enforced by
      `vitest typecheck` (not the default `vitest run` gate; build `tsc` excludes tests). Lead with the
      runtime `REASONING_LEVELS` assertion; include the type-level ones as reinforcement.
- ❌ Don't hand-maintain a second union — alias (`export type ThinkingLevel = ReasoningLevel;`) so the
      vocabulary has ONE source of truth (prevents future drift).
- ❌ Don't document role→level specifics in the ThinkingLevel JSDoc — that's `ROLE_CONFIG`'s domain (T3).
- ❌ Don't run the full `npm run test:run` as the gate — orthogonal pre-existing failures. Use the
      targeted agent-factory.test.ts + typecheck/lint/format.

---

## Confidence Score

**9/10** — one-pass implementation success likelihood.

Rationale: This is a 2-edit type-reconcile of a single file (import extension + JSDoc/type alias),
with the exact current code and before/after verified in-repo (line numbers confirmed). The key facts
are grep-verified: `'max'` has no caller (safe to drop), `ReasoningLevel`/`REASONING_LEVELS` are LANDED
in constants.ts (S1), and the pi SDK `VALID_THINKING_LEVELS` == §9.2.9 (external-deps.md §2). The one
subtlety — that `ThinkingLevel` is a pure type alias so the test can't enumerate it at runtime — is
resolved by leading with the runtime `REASONING_LEVELS` assertion (enforced by the default `vitest run`
gate) and including `expectTypeOf`/`@ts-expect-error` as type-level reinforcement (with their
enforcement gates documented). No runtime branches change → coverage unaffected; no existing test
breaks (`'xhigh'` ∈ ReasoningLevel). Residual risks: (a) a stale `'max'` literal surfacing elsewhere on
typecheck (grep says none — verify at implementation); (b) a prettier nit (auto-fixed). No
external/runtime unknowns.