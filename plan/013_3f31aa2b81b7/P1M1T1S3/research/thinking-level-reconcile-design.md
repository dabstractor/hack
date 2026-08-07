# Design Note — P1.M1.T1.S3: Reconcile agent-factory `ThinkingLevel` (alias `ReasoningLevel`)

> Tiny type-reconcile of `src/agents/agent-factory.ts`. Captures the verified facts + the
> enforceable-test subtlety. Read before implementing.

## 0. What S3 consumes (S1 LANDED; S2 = parallel, orthogonal)

- **S1 (LANDED)**: `src/config/constants.ts` exports `type ReasoningLevel = 'off'|'minimal'|
  'low'|'medium'|'high'|'xhigh'` (:1519), `REASONING_LEVELS` (:1534, `as const`), `resolveReasoningLevel`
  (:1637), and `ReasoningConfigError` (from `types.ts`). The constants.ts header even notes
  "(alias ThinkingLevel = ReasoningLevel) is P1.M1.T1.S3" (:1505-1515).
- **S2 (parallel)**: adds the 5 per-role `getReasoning*` getters IN `constants.ts`. Orthogonal to S3
  (S3 only imports the `ReasoningLevel` TYPE; S2 adds functions). No file-level collision.
- **S3 (this)**: `agent-factory.ts:123`'s `ThinkingLevel` DIVERGES from the pi SDK / §9.2.9 — it has
  `max` and lacks `minimal`. S3 aliases it to `ReasoningLevel` (single source of truth) and rewrites
  the now-wrong JSDoc. **No factory/ROLE_CONFIG changes** (T3 owns those).

## 1. The exact edits (all in src/agents/agent-factory.ts, 2 edits)

**Verified current state** (read from HEAD):
- L33: `import { getBugFinderAgent } from '../config/constants.js';` — already imports from constants.
  S3 ADDS `type ReasoningLevel` inline → `import { getBugFinderAgent, type ReasoningLevel } from '../config/constants.js';`
- L108-123: the JSDoc + type. The JSDoc `@remarks` (L110-116) correctly notes "pipeline-internal
  budget marker … rides on AgentConfig … NOT consumed by Groundswell createAgent", BUT the `NOTE:`
  block (L118-120) claims the pipeline "**intentionally EXCLUDES `minimal`** per the P2.M2.T1.S1
  contract" vs the pi SDK — **factually wrong** (external-deps.md §2: the pi SDK
  `VALID_THINKING_LEVELS = ["off","minimal","low","medium","high","xhigh"]` == §9.2.9; the pipeline is
  the one that diverges). The type itself (L123): `'off'|'low'|'medium'|'high'|'xhigh'|'max'`.

**Edit 1 (import, L33):** add `type ReasoningLevel` to the existing constants import.

**Edit 2 (JSDoc + type, L108-123):**
- Rewrite the `NOTE:` block to state the pipeline MIRRORS the pi SDK / §9.2.9 vocabulary EXACTLY
  (`off|minimal|low|medium|high|xhigh`; `xhigh` is the max; no `max`).
- Keep the "pipeline-internal budget marker" `@remarks` (still true).
- Replace `export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';` with
  `export type ThinkingLevel = ReasoningLevel;` (alias — single source of truth).

**Unchanged (T3 owns):** `AgentConfig.thinking?: ThinkingLevel` (L167 — stays typed `ThinkingLevel`,
NO field rename → back-compat), `ROLE_CONFIG` (L251-255, `reasoning: { tier:'balanced', thinking:'xhigh' }`
— `'xhigh'` ∈ ReasoningLevel, still valid), `createBaseConfig` (L304-319), all factories.

## 2. Why `'max'` is safe to drop (verified)

Repo-wide grep for `'max'` in thinking/reasoning context: **only** at agent-factory.ts:123 (the union
literal) + its JSDoc. **No caller sets `'max'`** — not in `src/`, not in `tests/unit/agents/`.
`ROLE_CONFIG` uses `'xhigh'` (the §9.2.9 maximum), never `'max'`. So dropping `'max'` breaks nothing.
And `'minimal'` is ADDED (it's in the pi SDK + §9.2.9; nothing currently uses it, but its absence was
the bug the JSDoc lied about).

## 3. THE enforceable-test subtlety (type-level vs runtime)

`ThinkingLevel = ReasoningLevel` is a pure **type alias** — no runtime value to enumerate. So a test
can't `expect(ThinkingLevel).toContain('minimal')` (ThinkingLevel isn't a runtime value). The proof
must be either type-level or a runtime proxy:

| Assertion | Enforced by | Notes |
| --- | --- | --- |
| `expectTypeOf<ThinkingLevel>().toEqualTypeOf<ReasoningLevel>()` | `vitest typecheck` (NOT the default `vitest run` gate) | The canonical "ThinkingLevel === ReasoningLevel" proof. The project's default gate (`vitest run` + `tsc -p tsconfig.build.json`) does NOT run vitest's type-test runner, so this is documentation unless `vitest typecheck` is invoked. |
| `@ts-expect-error` on `const _bad: ThinkingLevel = 'max'` | `tsc` on the test file (the build typecheck EXCLUDES tests) | Inert under the default gate; a net-positive guard if tests are ever type-checked. Suppresses the expected error when `'max'` is correctly rejected; trips "Unused @ts-expect-error" if `'max'` is wrongly re-added. |
| `expect(REASONING_LEVELS).toContain('minimal')` / `.not.toContain('max')` | `vitest run` (runtime — the DEFAULT gate) ✅ | **The strongest enforceable proof.** `REASONING_LEVELS` is the `as const` array backing `ReasoningLevel`; since `ThinkingLevel` aliases `ReasoningLevel`, this directly verifies the reconciled vocabulary at runtime. |

→ **Lead with the runtime `REASONING_LEVELS` assertion** (enforced by the default gate). Include
`expectTypeOf<…>().toEqualTypeOf<…>()` (the item's "ThinkingLevel === ReasoningLevel" ask) + a
`@ts-expect-error` on `'max'` as type-level reinforcement. Document which gate enforces which.

## 4. Coverage + regression (nil impact)

- S3's source change is a TYPE alias + JSDoc — **no runtime branches added or removed**. So
  agent-factory.ts's existing 100% coverage is unaffected (nothing to re-cover).
- The existing agent-factory.test.ts doesn't reference `ThinkingLevel`; `ROLE_CONFIG.reasoning.thinking
  = 'xhigh'` is still valid (`'xhigh'` ∈ ReasoningLevel); `createBaseConfig` passes `thinking` through
  unchanged. **No existing test breaks.**
- S3's test additions (`REASONING_LEVELS` runtime check + `expectTypeOf` + `@ts-expect-error`) are
  purely additive — they don't perturb existing coverage.

## 5. Scope discipline

S3 touches ONLY `src/agents/agent-factory.ts` (2 edits: import + JSDoc/type) + appends a small
describe block to `tests/unit/agents/agent-factory.test.ts`. It does NOT modify `constants.ts` (S1/S2),
`ROLE_CONFIG`/`createBaseConfig`/factories (T3), `.env.example` (S4), `.hack` schema (T2), or the
startup validator (T4). The `AgentConfig.thinking` field is NOT renamed (back-compat — T3 composes
`ThinkingLevel` values onto it).