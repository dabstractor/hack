# Research 02 — Audit: call sites + persona → stateless classification

## All `createAgent()` (Groundswell) call sites in src/
1. `src/agents/agent-factory.ts:316` — `createArchitectAgent()`
2. `src/agents/agent-factory.ts:348` — `createResearcherAgent()`
3. `src/agents/agent-factory.ts:378` — `createCoderAgent()`
4. `src/agents/agent-factory.ts:407` — `createQAAgent()`
5. `src/agents/agent-factory.ts:453` — `createCleanupAgent()`
6. `src/agents/commit-message-agent.ts:112` — `createCommitMessageAgent()`
   (uses `createBaseConfig('researcher','research')` then overrides)

ALL six go through `createBaseConfig()` → build `AgentConfig` → `createAgent(config)`.
NONE pass session/sessionId/persistence. (Confirms architecture/signatures.md:84
"No session/sessionId/persistence field in AgentConfig".)

## Call sites of the factory functions (where personas are USED)
| Persona / factory | Call site | PRD stateless list member? |
|---|---|---|
| architect (createArchitectAgent) | prp-pipeline.ts:783 (task breakdown) | NO — not in §9.3.2 stateless list |
| researcher (createResearcherAgent) | prp-generator.ts:218 (PRP creation) | NO — PRP creation is multi-turn research |
| coder (createCoderAgent) | prp-executor.ts:255 (PRP execution) | **YES** — "per-item PRP execution" |
| qa (createQAAgent) | bug-hunt-workflow.ts:267, delta-analysis-workflow.ts:121 | **YES** — "validation" / "bug-finder" |
| cleanup (createCleanupAgent) | cleanup-runner.ts:117 | **YES** — "cleanup" |
| commit-message (createCommitMessageAgent) | git-commit.ts:182 | **YES** — "post-validation fix"-adjacent; stagecoach is a single-shot mechanical call. Treat as stateless. |

## PRD §9.3.2 "Stateless single-shot invocations" list (verbatim)
> Agent calls that are stateless by nature (cleanup, mid-session task update,
> validation, post-validation fix, bug-finder, per-item PRP execution) MUST NOT
> create or resume sessions.

Mapping to the six pipeline personas:
- **cleanup** → createCleanupAgent ✓
- **validation** → createQAAgent (validation persona) ✓
- **bug-finder** → createQAAgent (bug-hunt persona) ✓
- **per-item PRP execution** → createCoderAgent ✓
- **post-validation fix** → the fix-loop in prp-executor uses the SAME createCoderAgent ✓
- **mid-session task update** → not yet a distinct persona; architect (re-breakdown) is
  the closest but breakdown is NOT in the stateless list. Leave architect OUT.
- **stagecoach commit-message** → createCommitMessageAgent (single-shot, reads diff
  from prompt). Not named in §9.3.2 but it is definitionally stateless single-shot.

=> STATELESS personas: coder, qa, cleanup, commit-message.
=> STATEFUL (state persists / multi-turn OK): architect (breakdown), researcher
   (PRP research — multi-pass, large context).

NOTE: "mid-session task update" has no persona yet in src/ (it is a P4 concern —
P4.M1.T2.T1 `--accept-prd-changes`). When added it should be registered stateless.

## Existing precedent: how a pipeline-internal marker rides on AgentConfig
`thinking?: ThinkingLevel` (agent-factory.ts:160-166) is a pipeline-internal reasoning
budget that Groundswell's AgentConfig does NOT model. The JSDoc says:
> Pipeline-internal budget marker — Groundswell's AgentConfig does not model thinking;
> harness wiring is downstream.

`stateless: boolean` follows the EXACT same pattern: it is a pipeline-internal invariant
marker. Groundswell ignores unknown extra fields (TS interface is open to its own fields
but the runtime object-spread `...baseConfig` carries the field through harmlessly).
This is the established, blessed pattern in this file — the PRP must reuse it, not invent
a new one.

## Test file + patterns
- `tests/unit/agents/agent-factory.test.ts` — vitest, 100% coverage enforced
  (vitest.config.ts:41 thresholds: statements/branches/functions/lines all 100).
  Uses `it.each(personas)` over the persona union; asserts `.toHaveProperty(...)`.
  `commit-message-agent` has its own `tests/unit/agents/commit-message-agent.test.ts`.
- No external session dir is created in unit tests (createAgent is not mocked to actually
  run pi); the `stateless` flag is verified by property assertion, matching `thinking`.