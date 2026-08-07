# External Dependencies — Groundswell Harness Seam (PRD §9.2.9)

> Research verified against installed `node_modules/groundswell@1.0.1` AND local source
> `~/projects/groundswell/src` (researcher brief + direct read). This documents the cross-repo
> dependency that is **explicitly OUT OF SCOPE** for this delta (PRD §3/§6) but must be
> understood so the in-scope work stops cleanly at the seam.

## 1. Current state (verified)

### Groundswell `HarnessOptions` — NO thinking field
File: `node_modules/groundswell/dist/types/harnesses.d.ts:61` (src: `~/projects/groundswell/src/types/harnesses.ts`)
```ts
export interface HarnessOptions {
  endpoint?: string;
  apiKey?: string;
  sessionId?: string;
  timeout?: number;
  headers?: Record<string, string>;
  authStorage?: AuthStorage;   // pi only
  modelRegistry?: ModelRegistry; // pi only
}
```
No `thinking` / `thinkingLevel` / `maxThinkingTokens` field. `extendedThinking` exists ONLY
as a boolean `HarnessCapabilities` flag (harnesses.d.ts:38) — a capability advertisement,
not a tunable.

### Per-request `HarnessExecutionOptions` — also NO thinking field
The per-request options carry only `model/systemPrompt/tools/hooks/sessionId/streaming`.

### pi-harness — does NOT forward `--thinking`
`PiHarness.execute()` / `executeStreaming()` call `createAgentSession({ model, modelRegistry,
authStorage, customTools, resourceLoader })` and **omit** `thinkingLevel`. Its capability
advertises "Extended Thinking: model-dependent".

### claude-code-harness — `maxThinkingTokens` is doc-only
Class/JSDoc comments claim "Extended Thinking via maxThinkingTokens", but the actual
`execute()` `sdkOptions` object has NO `maxThinkingTokens` key. Not wired.

## 2. The upstream seam that WOULD be targeted (EXISTS today)

The pi SDK (`@earendil-works/pi-coding-agent`) already defines:
```ts
CreateAgentSessionOptions.thinkingLevel?: ThinkingLevel  // default 'medium'
```
And its accepted vocabulary (`pi-coding-agent/dist/cli/args.js`):
```js
VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"]
```

**This is decisive for the delta:** the §9.2.9 vocabulary (`off/minimal/low/medium/high/xhigh`)
is **IDENTICAL** to the pi SDK's `VALID_THINKING_LEVELS`. Implications:

1. The pipeline's current `ThinkingLevel` (`'off'|'low'|'medium'|'high'|'xhigh'|'max'`)
   actually **DIVERGES** from the pi SDK (it has `max`, lacks `minimal`). The §9.2.9
   reconciliation (add `minimal`, drop `max`) **ALIGNS** the pipeline type with the pi SDK —
   this is a correctness improvement, not just a PRD compliance edit.
2. `agent-factory.ts:119-121` JSDoc claims the pipeline "intentionally EXCLUDES `minimal` per
   the P2.M2.T1.S1 contract" relative to the pi SDK. **That comment is now factually wrong**
   and must be rewritten to state the pipeline mirrors the pi SDK / §9.2.9 vocabulary exactly.
3. When the Groundswell seam is later added, the values forwarded will be accepted by pi
   verbatim — no translation table needed.

## 3. Minimal cross-repo Groundswell change (the dependency, NOT implemented here)

To make a resolved reasoning level actually take effect at the harness:

1. Add to Groundswell's per-request options (alongside `model`):
   `thinkingLevel?: ThinkingLevel` (import the pi SDK `ThinkingLevel`).
2. `PiHarness` → forward it: `createAgentSession({ ..., thinkingLevel })`.
3. `ClaudeCodeHarness` → map it to `maxThinkingTokens` in `sdkOptions` (budget mapping).

This is analogous to the `auth.json` contract change in PRD §9.2.6. It is a **separate,
later, agent-disjoint** piece of work against `~/projects/groundswell`. This delta MUST NOT
attempt it and MUST NOT block on it.

## 4. What hacky-hack does IN SCOPE (stops at the seam)

- Resolve each `PRP_REASONING_<ROLE>` per agent identity.
- Validate against the vocabulary (fail-fast).
- Store the resolved level on `AgentConfig.thinking` (the pipeline-internal marker that
  ALREADY EXISTS at `agent-factory.ts:167`). The field rides on the config object for the
  future harness wiring; today Groundswell `createAgent` ignores it.

This is exactly what the seam allows today. All §9.2.9 acceptance criteria test **config
resolution** (which env var wins, what default applies, fail-fast on invalid, decoupling from
tier), NOT harness execution behavior — so the delta is fully deliverable and testable without
the Groundswell change.