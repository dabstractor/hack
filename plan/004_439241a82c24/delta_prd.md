# Delta PRD: Pluggable Agent Harness System

**Delta from:** `plan/003_b3d3efdaf0ed` (Phase 1–3 of the PRP Pipeline are Complete)
**Scope driver:** PRD.md §3, §9.1, §9.2.2, §9.2.3, §9.2.4, §9.3.3, and new §9.4

## 1. Delta Summary

The PRD was updated to introduce a **pluggable agent harness** layer that decouples the _agent runtime_ (how prompting/tool-execution/streaming is driven) from the _LLM provider/model_. This is a single, coherent change concentrated in **§9 Technical Specification**. Everything else in the PRD (sessions, task orchestration, delta logic, bug hunt, prompts) is unchanged.

### What Actually Changed (diff inventory)

| Location                 | Change                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §3 (System Architecture) | Agent Runtime now "drives the agent loop through a pluggable **harness**" (default `pi`, optional `claude-code`), orthogonal to the LLM provider.                                                                                          |
| §9.1 (Tech Stack)        | Added **Agent Harness** line item: `pi` default, `claude-code` optional. LLM provider now described as "orthogonal to the harness."                                                                                                        |
| §9.2.2 (Env Vars)        | **NEW** `PRP_AGENT_HARNESS` (`pi` \| `claude-code`, default `pi`).                                                                                                                                                                         |
| §9.2.3 (Model Selection) | Models are now **provider-qualified strings** (`provider/model`), e.g. `GLM-4.7` → resolved as `zai/GLM-4.7`. Model strings are **never harness-qualified** (`pi/zai/GLM-4.7` is invalid).                                                 |
| §9.2.4 (Safeguards)      | Clarified the z.ai safeguard constrains the LLM **provider**, not the harness. `claude-code` is **Anthropic-only** and incompatible with z.ai.                                                                                             |
| §9.3.3 (Agent Runtime)   | Agents execute through the configured harness; tools execute locally via Groundswell `MCPHandler` **regardless of harness**.                                                                                                               |
| §9.4 (**NEW SECTION**)   | "Agent Harness System (Runtime Selection)" — supported harnesses table, `configureHarnesses()` config, critical rules (no harness in model string, provider/harness compatibility, feature parity, cache isolation), capability reference. |
| §9.5 (Roadmap)           | Added startup step: call `configureHarnesses({ defaultHarness: 'pi', defaultModelProvider: 'zai' })`.                                                                                                                                      |

**Removed requirements:** None.

## 2. Key Insight — Do Not Rebuild What Exists

**Groundswell already implements the entire harness system** (Groundswell PRD §7, v1.2; `configureHarnesses`, `HarnessOptions`, `PiHarness`/`ClaudeCodeHarness` adapters, and harness-parity tests all exist in `~/projects/groundswell/src`).

Therefore this delta is **integration/adoption work** on the PRP side:

1. Wire `configureHarnesses()` at startup.
2. Read `PRP_AGENT_HARNESS` from the environment.
3. Resolve model names to provider-qualified `zai/<model>` strings.
4. Enforce/clarify the provider-vs-harness compatibility rules.
5. Verify feature parity (tools still run via `MCPHandler` under both harnesses).

The implementation should **import and delegate** to Groundswell — not reimplement harness selection, adapters, or cache-key logic.

## 3. Impact on Completed Work (Session 003)

Session 003 implemented the original §9.2/§9.3. The following **already-complete** artifacts need updates:

| Completed artifact                         | Required update                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config/environment.ts` → `getModel()` | Return **provider-qualified** model strings (e.g. `zai/GLM-4.7`) instead of bare `GLM-4.7`.                                                                   |
| `src/config/constants.ts` → `MODEL_NAMES`  | Either store provider-qualified defaults, or qualify at resolution time.                                                                                      |
| `src/config/types.ts`                      | Update model type JSDoc/examples to reflect `provider/model` form.                                                                                            |
| `src/agents/agent-factory.ts`              | Call `configureHarnesses()` once; pass harness config through to `createAgent()`; keep `mcps`/tools unchanged (they run via `MCPHandler` for both harnesses). |
| z.ai safeguard tests/validation            | Clarify the guard targets the **provider** endpoint, not the harness; `claude-code`+z.ai must be rejected as a config error.                                  |
| `docs/CONFIGURATION.md`                    | Document `PRP_AGENT_HARNESS`, provider-qualified model strings, and harness/provider independence.                                                            |
| `docs/GROUNDSWELL_GUIDE.md`                | Add a "Harness System" section mirroring PRD §9.4.                                                                                                            |

## 4. Leverage Prior Research

- `plan/003_b3d3efdaf0ed/docs/GROUNDSWELL_GUIDE.md` — existing Groundswell integration patterns (currently **0** mentions of "harness"; this delta adds the section).
- `plan/003_b3d3efdaf0ed/docs/external_deps.md` — Groundswell exports reference (verify `configureHarnesses`, `HarnessOptions` are listed).
- `plan/003_b3d3efdaf0ed/docs/CONFIGURATION.md` — env-var reference to extend.
- No new web research required; Groundswell's own PRD §7 and source are the authoritative spec.

## 5. Implementation Plan

**One phase, two milestones.** Sized to the diff — a focused integration, not an epic.

### Phase 1: Harness Integration & Adoption

#### Milestone 1.1: Configuration & Model Resolution

**Task 1.1.1 — Read harness from environment and wire `configureHarnesses()`**

- Add `PRP_AGENT_HARNESS` (`pi` \| `claude-code`, default `pi`) to `src/config/constants.ts` / `environment.ts`.
- At startup (alongside existing `configureEnvironment()`), call Groundswell's `configureHarnesses({ defaultHarness: 'pi', defaultModelProvider: 'zai' })`.
- Validate: reject `claude-code` + z.ai provider as a configuration error surfaced at init (per §9.4.3), with a clear message pointing to the §9.2.4 safeguard.
- _Subtasks:_ (1) env var + config wiring; (2) startup `configureHarnesses()` call + compatibility validation.

**Task 1.1.2 — Provider-qualify model strings**

- Update `getModel()` so returned models are `provider/model` (e.g. `zai/GLM-4.7`, `zai/GLM-4.5-Air`), sourced from env at runtime, never harness-qualified.
- Update `MODEL_NAMES` / types and JSDoc to match.
- _Subtasks:_ (1) qualify defaults with `zai` provider; (2) update types/docs and any hardcoded `'GLM-*'` literals in factory configs.

#### Milestone 1.2: Parity, Validation & Docs

**Task 1.2.1 — Provider-vs-harness safeguard clarification (tests)**

- Update z.ai endpoint guard tests to assert the constraint is on the **provider**, and that `claude-code` + z.ai is rejected at init while `pi` + z.ai is allowed.
- _Subtasks:_ (1) provider-endpoint guard tests; (2) harness/provider compatibility rejection test.

**Task 1.2.2 — Feature parity verification**

- Verify MCP tools, skills, streaming, sessions, extended thinking, and caching work identically under `pi` and `claude-code` (tools flow through `MCPHandler` for both). Cache keys must incorporate harness + provider/model.
- _Subtasks:_ (1) tool-execution parity test via `MCPHandler`; (2) cache-key isolation test (harness + provider dimensions).

**Task 1.2.3 — Documentation update**

- Update `docs/CONFIGURATION.md` (new env var, provider-qualified models, independence of harness/provider) and add a Harness System section to `docs/GROUNDSWELL_GUIDE.md` mirroring PRD §9.4 (supported harnesses, config, critical rules, capability table).
- _Subtasks:_ (1) CONFIGURATION.md update; (2) GROUNDSWELL_GUIDE.md harness section.

## 6. Out of Scope

- Building a new harness adapter (Groundswell owns `PiHarness`/`ClaudeCodeHarness`).
- Changes to session/task/delta/bug-hunt logic (untouched by this diff).
- Any modification to `PRD.md` (human-owned).
