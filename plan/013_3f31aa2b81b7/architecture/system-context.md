# System Context — Delta PRD §9.2.9 (Per-Role Reasoning Level)

> Research performed by Lead Architect session 013 against the **current** `hacky-hack`
> codebase (commit at time of research). All file:line references are VERIFIED by direct
> read, not inferred. Downstream PRP agents MUST treat this as ground truth and re-verify
> only the exact lines they edit.

## 1. Feature Summary

The extended-thinking ("reasoning") budget becomes a **first-class, independently-
configurable per-role setting**, fully decoupled from model (tier) selection. Five roles,
each controlled by exactly one `PRP_REASONING_<ROLE>` env var:

| # | Role (agent identity)        | Env var                          | Default | Factory that consumes it              |
|---|------------------------------|----------------------------------|---------|---------------------------------------|
| 1 | Research / PRP (`AGENT`)     | `PRP_REASONING_AGENT`            | `high`  | `createResearcherAgent`               |
| 2 | Breakdown (`BREAKDOWN_AGENT`)| `PRP_REASONING_BREAKDOWN_AGENT`  | `high`  | `createArchitectAgent`                |
| 3 | Bug finder (`BUG_FINDER_AGENT`) | `PRP_REASONING_BUG_FINDER_AGENT` | `high` | `createQAAgent` (bug-hunt caller)     |
| 4 | Validation (`VALIDATION_AGENT`)| `PRP_REASONING_VALIDATION_AGENT`| `high`  | `createQAAgent` (validation caller)   |
| 5 | Implementation (`IMPL_AGENT`)| `PRP_REASONING_IMPL_AGENT`       | `off`   | `createCoderAgent`                    |

Vocabulary (case-insensitive): `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.
(`xhigh` = maximum.)

## 2. Behavior change vs. prior hard-wired design

| Role        | Before                          | After (§9.2.9)                          |
|-------------|---------------------------------|-----------------------------------------|
| breakdown   | pinned `xhigh` (ROLE_CONFIG)    | default `high`, configurable per role   |
| bug-finder  | pinned `xhigh` (shared QA)      | default `high`, independent of validation |
| validation  | pinned `xhigh` (shared QA)      | default `high`, independent of bug-finder |
| research    | "normal" (field omitted)        | explicit `high`                         |
| impl        | model default (field omitted)   | explicit `off`                          |

`xhigh` remains available everywhere via explicit config. **Nothing removed — purely
additive + the default changes above.**

## 3. The core decoupling principle (the heart of this delta)

Today (`src/agents/agent-factory.ts`), `createBaseConfig(persona, role)` pulls BOTH the
model tier AND the thinking level from a single static map:

```ts
// agent-factory.ts:248-256 (CURRENT — to be changed)
export const ROLE_CONFIG: Readonly<Record<ModelRole, { tier: ModelTier; thinking?: ThinkingLevel }>> = {
  research:        { tier: 'balanced' },
  reasoning:       { tier: 'balanced', thinking: 'xhigh' },   // ← collapses 3 identities into one
  implementation:  { tier: 'fast' },
};
```

The delta requires: **the tier (model) keeps coming from `ROLE_CONFIG[role].tier`
(UNCHANGED), but the thinking level is resolved per agent-identity from `PRP_REASONING_*`,
independent of the tier.** Tuning one axis must never perturb the other.

The `ModelRole` type (`'research' | 'reasoning' | 'implementation'`, agent-factory.ts:132)
**stays** — it still selects the tier. Only the role→level coupling is severed; the level
becomes a per-factory resolution.

## 4. The shared-QA-persona split (verified — 4 callers, NOT 3)

`createQAAgent()` (agent-factory.ts:453) takes **no parameters today** and is reused by
**four** distinct callers (the PRD's §3 notes mentioned 3; this research found a 4th):

| Caller file:line                       | Semantic identity | Resolves via                  | Level (default) |
|----------------------------------------|-------------------|-------------------------------|-----------------|
| `src/workflows/bug-hunt-workflow.ts:273`  | bug-finder        | `getReasoningBugFinder()`     | `high`          |
| `src/workflows/validation-workflow.ts:235`| validation        | `getReasoningValidation()`    | `high`          |
| `src/workflows/delta-analysis-workflow.ts:121` | delta-analysis (research-leaning) | `getReasoningAgent()` | `high` |
| `src/core/change-classifier.ts:112` (`classifyChange`)   | change-classification (research-leaning) | `getReasoningAgent()` | `high` |
| `src/core/change-classifier.ts:161` (`classifyArtifact`) | change-classification (research-leaning) | `getReasoningAgent()` | `high` |

**Required:** bug-finder and validation MUST resolve **separate** `PRP_REASONING_*` values.
Therefore `createQAAgent` MUST gain a parameter so the two (now four) callers resolve
distinct levels. Recommended signature: `createQAAgent(reasoningLevel: ReasoningLevel)` —
each caller passes its resolved getter value, making the separation explicit and testable.

**Decision (documented, per PRD §3 "impl decision"):** the two non-§9.2.9 QA callers —
`delta-analysis-workflow` and `change-classifier` (classifyChange + classifyArtifact) — are
**research-leaning** and resolve to `PRP_REASONING_AGENT` (`getReasoningAgent()`), default
`high`. Rationale: both perform PRD-diff/artifact *analysis/classification*, not adversarial
bug-hunting or contract validation.

## 5. Auxiliary factories NOT in the §9.2.9 vocabulary (decision)

Two factories use `createBaseConfig` but are NOT among the five §9.2.9 roles. They are
mechanical/single-shot and default to reasoning **off**:

- `createCleanupAgent` (agent-factory.ts, role `'implementation'`) → passes `'off'`
  (mechanical post-validation reorg; reasoning adds cost, no value).
- `createCommitMessageAgent` (`src/agents/commit-message-agent.ts:361`,
  `createBaseConfig('researcher', 'research')`) → passes `'off'`
  (single-shot commit-message generation).

These are **hardcoded `'off'`** (not coupled to `PRP_REASONING_IMPL_AGENT`/`_AGENT`), so
tuning those knobs never surprises the auxiliary agents. This is a deliberate, documented
decision; the PRP agent must record it in JSDoc.

## 6. The `ThinkingLevel` reconciliation (verified)

Current type (`src/agents/agent-factory.ts:123`):
```ts
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
```
§9.2.9 mandates `'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'` — **add
`minimal`, drop `max`**. Repo-wide grep confirms NO caller sets `'max'` (it appears only in
this type union and its JSDoc), so dropping it is safe. The new canonical `ReasoningLevel`
type lives in `constants.ts`; `agent-factory.ts` makes `ThinkingLevel` an alias of it
(single source of truth): `export type ThinkingLevel = ReasoningLevel`. `AgentConfig.thinking`
stays typed `ThinkingLevel` (back-compat) — only its underlying set changes.

NOTE: `agent-factory.ts:119-121` JSDoc currently says the pipeline type *intentionally
excludes* `minimal`; that comment is now WRONG and must be rewritten.

## 7. Resolution & layering (PRD §9.2.1)

- `.hack` `[reasoning]` keys **seed** the five `PRP_REASONING_*` env vars (via the existing
  `HACK_KEY_TO_ENV` derivation + `seedProcessEnv`, which sets `process.env[ENV]` only if
  undefined — env-over-file, §9.2.1). Real shell env always wins over file.
- Each getter reads `process.env[PRP_REASONING_<ROLE>]`: `undefined`/empty/whitespace →
  default; non-empty → case-normalized (lowercased) + validated; invalid → **hard throw**.
- An empty value is NEVER forwarded to the harness.

## 8. Fail-fast validation — TWO complementary paths (critical)

The vocabulary must be enforced on BOTH config sources, and both must abort BEFORE any
session is created or agent invoked:

| Path | Mechanism | Where it fires |
|------|-----------|----------------|
| `.hack` value (e.g. `[reasoning] impl_agent = "loud"`) | `enum` in `HACK_CONFIG_SCHEMA` (hack-config.ts:632), checked in the loader's type/range/enum check (hack-config.ts:852-903). Error format: `[reasoning] impl_agent in <file>: "loud" is not one of the accepted values [off, minimal, low, medium, high, xhigh].` | during `loadHackConfig()` (index.ts:156) |
| shell/env value (e.g. `PRP_REASONING_AGENT=ultra`) | a shared `validateReasoningLevel()` helper (new, constants.ts) invoked by each getter; thrown as a `ReasoningConfigError` | startup pass in `index.ts` main() that calls all five getters, AFTER `configureEnvironment()` (index.ts:181), BEFORE any agent is created |

The shared validator must be **case-insensitive** (lowercase before membership check).
The `.hack` `enum` check (`!spec.enum.includes(value)` at hack-config.ts:898-899) is
**case-SENSITIVE** today — so `[reasoning] agent = "HIGH"` would be wrongly rejected. The
loader MUST normalize the parsed reasoning value to lowercase before the enum check (or the
reasoning enum check must be case-insensitive) to honor §9.2.9 #2. See integration-points.md §4.

## 9. The Groundswell harness seam (cross-repo dependency — OUT OF SCOPE)

Verified against installed `node_modules/groundswell@1.0.1` and local
`~/projects/groundswell/src`:

- `HarnessOptions` (`node_modules/groundswell/dist/types/harnesses.d.ts:61`) =
  `{ endpoint?, apiKey?, sessionId?, timeout?, headers?, authStorage?, modelRegistry? }`.
  **No thinking/thinkingLevel/maxThinkingTokens field.**
- `extendedThinking` exists only as a **boolean capability flag** (`HarnessCapabilities`,
  harnesses.d.ts:38), NOT a configurable level.
- `pi-harness` advertises "Extended Thinking: model-dependent" — **does NOT wire `--thinking`**.
- `claude-code-harness` mentions `maxThinkingTokens` only in JSDoc; it is not exposed via `HarnessOptions`.

**Conclusion:** hacky-hack's `AgentConfig.thinking` field is a **pipeline-internal marker**
(already present, agent-factory.ts:167) that is NOT consumed by Groundswell `createAgent`.
This delta's scope is therefore: **resolve → validate → store** the per-role level on
`AgentConfig.thinking` (exactly what the seam allows). Wiring the level through to the
harness (`--thinking` for pi, `maxThinkingTokens` for claude-code) requires a **Groundswell
API change** and is explicitly OUT OF SCOPE (PRD §3/§6) — noted as a cross-repo dependency,
not implemented here. All §9.2.9 acceptance criteria test config resolution, not harness
behavior, so they are fully satisfiable without the Groundswell change.

See `external-deps.md` for the minimal Groundswell surface change.

## 10. Test surface (where TDD lands)

Existing test files to extend (verified present):
- `tests/unit/config/constants.test.ts`, `hack-config.test.ts`, `validation-config.test.ts`,
  `bug-finder-config.test.ts`
- `tests/unit/agents/agent-factory.test.ts`, `commit-message-agent.test.ts`,
  `cleanup-agent.test.ts`
- `tests/unit/workflows/{bug-hunt-workflow,validation-workflow,delta-analysis-workflow}.test.ts`
- `tests/unit/core/change-classifier.test.ts`
- Startup/fail-fast: locate alongside existing auth-preflight / startup-error tests
  (`tests/unit/config/auth-preflight.test.ts`, `tests/unit/utils/startup-error-verifier*`).