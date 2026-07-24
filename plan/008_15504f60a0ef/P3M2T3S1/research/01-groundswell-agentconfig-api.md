# Research 01 — Groundswell AgentConfig / createAgent session surface

## Question
Does Groundswell's `createAgent()` / `AgentConfig` / `HarnessOptions` let a caller
DISABLE per-agent Pi session persistence (the `pi --no-session` equivalent)?

## Source of truth (read from installed package)
- `node_modules/groundswell/dist/types/agent.d.ts` — `AgentConfig` interface.
- `node_modules/groundswell/dist/core/factory.d.ts` — `createAgent(config: AgentConfig)`.
- `node_modules/groundswell/dist/types/harnesses.d.ts` — `HarnessOptions`.
- `node_modules/groundswell/dist/harnesses/pi-harness.d.ts` + `.js`.

## Findings

### AgentConfig (agent.d.ts) has NO top-level session field
Fields: name, system, tools, mcps, skills, hooks, env, enableReflection, enableCache,
model, maxTokens, temperature, harness, harnessOptions, provider (DEPRECATED),
providerOptions (DEPRECATED).

The session-persistence config (`sessionStore`, `sessionPersistence`, `sessionTtl`,
`sessionPath`) lives ONLY on the deprecated `ProviderOptions` (agent.d.ts: line ~73-150
@providerOptions JSDoc). The JSDoc explicitly says:

> HarnessOptions is SLIMMED relative to this type — it omits `sessionStore`,
> `sessionPersistence`, `sessionTtl`, and `sessionPath` (those are now harness-adapter
> internals …). Migrating callers that relied on session-persistence config must move
> it to the concrete harness adapter.

So `providerOptions.sessionPersistence` is DEPRECATED and NOT a viable disable path.

### HarnessOptions (harnesses.d.ts:61) has NO sessionManager field
Fields: endpoint, apiKey, **sessionId** (session/resume id), timeout, headers,
authStorage, modelRegistry.

There is `sessionId?: string` (used to RESUME a specific session) but NO
`sessionManager`, NO `noSession`, NO `disablePersistence`. So a caller CANNOT
inject `SessionManager.inMemory()` through `HarnessOptions`.

### pi-harness.js execute() does NOT pass sessionManager → defaults to disk
`PiHarness.execute()` (pi-harness.js ~line 188) calls:
```js
const { session } = await this.sdk.createAgentSession({
  model, modelRegistry, authStorage, customTools,
  ...(resourceLoader ? { resourceLoader } : {}),
});
```
NO `sessionManager` is forwarded. Per the pi SDK
(`CreateAgentSessionOptions.sessionManager` — sdk.d.ts:48):
> Session manager. Default: SessionManager.create(cwd)

So EVERY agent run (stateless or not) defaults to a **disk-persisted**
`SessionManager.create(cwd)` writing append-only JSONL to
`~/.pi/agent/sessions/<encoded-cwd>/`. THIS is the orphaned-session source.

### createAgentSession (pi SDK) DOES support stateless
`CreateAgentSessionOptions.sessionManager?: SessionManager` (sdk.d.ts:48-49).
`SessionManager.inMemory(cwd?, options?)` (session-manager.d.ts ~line 338):
> Create an in-memory session (no file persistence)

sdk.d.ts:101 example: `sessionManager: SessionManager.inMemory()`.

README.md:572 confirms the CLI mirror: `--no-session | Ephemeral mode (don't save)`.
README.md:246: `pi --no-session`.

## Conclusion / IMPLICATION FOR PRP
The mechanical disable (pass `SessionManager.inMemory()` to the harness) CANNOT be
done from the pipeline via the current Groundswell public API:
- `AgentConfig` has no session field.
- `HarnessOptions` has no `sessionManager` / `noSession` field.
- The pi-harness hardcodes `createAgentSession({...})` without `sessionManager`.

Therefore the deliverable for P3.M2.T3.S1 is:
1. AUDIT (contract a) — confirm ALL call sites (done; see research/02).
2. Add an explicit pipeline-internal `stateless: boolean` flag to AgentConfig
   (Mode A) so the invariant is EXPLICIT, defended, and future-wired — NOT an
   implicit assumption. (Groundswell ignores unknown fields; the flag rides on the
   config object exactly like `thinking` does — see agent-factory.ts:115-116,160-166.)
3. MECHANICAL disable is BLOCKED by Groundswell → document the blocker, and record
   the upstream seam (`HarnessOptions.sessionManager` / harness execute() forward) as
   the required future change. Do NOT hack around it (no monkey-patching the harness).
4. DOCS (Mode A) — JSDoc on createBaseConfig + AgentConfig + a STATELESS_PERSONAS
   constant noting the invariant and the Groundswell gap.

This satisfies the contract's escape hatch: "add defensive flags/comments to prevent
future regressions" (contract item d).