/**
 * Agent factory module for creating Groundswell agent configurations
 *
 * @module agents/agent-factory
 *
 * @remarks
 * Provides factory functions for creating type-safe agent configurations
 * tailored to specific personas (architect, researcher, coder, qa).
 * Each persona has optimized token limits and model selection.
 *
 * Harness and environment configuration are resolved lazily via a memoized accessor
 * on first agent creation (not at module load), per PRD §9.6.2 REQ-L2 and
 * bugfix §h3.3 (mismatch surfaces at initialize/execute, not module load).
 *
 * @example
 * ```ts
 * import { createBaseConfig } from './agents/agent-factory.js';
 *
 * // reasoning role (balanced tier) running with thinking OFF — the decoupling proof (PRD §9.2.9)
 * const cfg = createBaseConfig('architect', 'reasoning', 'off');
 * // { name: 'ArchitectAgent', model: 'zai/glm-5.2', thinking: 'off', harness: 'pi', ... }
 * ```
 */

import {
  configureEnvironment,
  getModel,
  getResolvedProvider,
} from '../config/environment.js';
import {
  configureHarness,
  resolveApiKeyForProvider,
} from '../config/harness.js';
import { getBugFinderAgent, type ReasoningLevel } from '../config/constants.js';
import type { AgentHarness, ModelTier } from '../config/types.js';
import { getLogger, type Logger } from '../utils/logger.js';
import { createAgent, type Agent, type MCPServer } from 'groundswell';
import {
  TASK_BREAKDOWN_PROMPT,
  PRP_BLUEPRINT_PROMPT,
  PRP_BUILDER_PROMPT,
  BUG_HUNT_PROMPT,
  CLEANUP_PROMPT,
} from './prompts.js';
import { BashMCP } from '../tools/bash-mcp.js';
import { FilesystemMCP } from '../tools/filesystem-mcp.js';
import { GitMCP } from '../tools/git-mcp.js';

// PATTERN: Lazy-accessor singleton (PRD §9.6.2 REQ-L2) — mirrors the _logger pattern below.
// configureHarness() is deferred out of module-eval scope so importing this module (and thus
// index.ts's static import graph) no longer throws HarnessProviderMismatchError at load time
// (bugfix §h3.3 / PRD §9.4.3: mismatch surfaces at first agent creation, not module load).
// configureEnvironment() MUST run before configureHarness() (env.ts: "Must be called before
// configureHarness()"); both are idempotent — HarnessRegistry.has('pi') guards double-registration
// and configureHarnesses() is a config-singleton setter — so repeat accessor calls are a no-op.
let _resolvedHarness: AgentHarness | undefined;
const resolvedHarness = (): AgentHarness => {
  if (_resolvedHarness === undefined) {
    configureEnvironment();
    _resolvedHarness = configureHarness();
  }
  return _resolvedHarness;
};

// Module-level logger for agent factory
let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('AgentFactory'));

/**
 * Singleton MCP server instances
 *
 * @remarks
 * One instance of each MCP server is shared across all agents.
 * This avoids redundant server registration and memory overhead.
 * MCP servers register their tools in the constructor via MCPHandler.
 */
const BASH_MCP = new BashMCP();
const FILESYSTEM_MCP = new FilesystemMCP();
const GIT_MCP = new GitMCP();

/**
 * Combined array of all MCP tools for agent integration
 *
 * @remarks
 * This array is passed to createAgent() via the mcps parameter.
 * All agents (architect, researcher, coder, qa) receive the same tool set.
 * Typed as MCPServer[] to match createAgent() expectations.
 */
const MCP_TOOLS: MCPServer[] = [BASH_MCP, FILESYSTEM_MCP, GIT_MCP];

/**
 * Agent persona identifier for selecting specialized configurations
 *
 * @remarks
 * Each persona corresponds to a specific role in the PRP Pipeline:
 * - 'architect': Analyzes PRDs and creates task breakdowns (needs larger token limit)
 * - 'researcher': Performs codebase and external research
 * - 'coder': Implements code based on PRP specifications
 * - 'qa': Validates implementations and hunts for bugs
 * - 'cleanup': Reorganizes the working tree after a subtask passes validation
 *   (PRD §4.2 step 4 — remove temp artifacts, move docs to `docs/`)
 */
export type AgentPersona =
  | 'architect'
  | 'researcher'
  | 'coder'
  | 'qa'
  | 'cleanup';

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

/**
 * Model role selecting the model TIER for a pipeline agent (PRD §9.2.3).
 *
 * @remarks
 * - 'research'       → balanced tier (architecture research, PRP creation)
 * - 'reasoning'      → balanced tier (decomposition, bug-finding, validation)
 * - 'implementation' → fast tier (PRP execution, post-validation fix)
 *
 * The role selects the MODEL TIER ONLY (PRD §9.2.3). The reasoning LEVEL is a SEPARATE axis
 * resolved per-role via the `PRP_REASONING_*` env vars (PRD §9.2.9), independent of the tier —
 * see {@link createBaseConfig}'s explicit `thinking` param. The two axes are deliberately
 * decoupled so a role can run a strong model with reasoning off (or a fast model with reasoning on).
 *
 * @see {@link ROLE_CONFIG} for the role → tier mapping.
 */
export type ModelRole = 'research' | 'reasoning' | 'implementation';

/**
 * Agent configuration interface matching Groundswell's createAgent() options
 *
 * @remarks
 * Extends the core Groundswell configuration with environment variable mapping.
 * All properties are readonly to ensure immutability after creation.
 *
 * @see {@link file:///home/dustin/projects/hacky-hack/plan/001_14b9dc2a33c7/architecture/groundswell_api.md#L119} | Groundswell Agent Creation docs
 */
export interface AgentConfig {
  /** Agent identifier for logging and debugging */
  readonly name: string;
  /** System prompt for the agent */
  readonly system: string;
  /** Model identifier — provider-qualified 'provider/model' (e.g. 'zai/glm-5.2'); never harness-qualified */
  readonly model: string;
  /** Agent runtime harness id (PRD §9.4.2) — 'pi' | 'claude-code' */
  readonly harness: AgentHarness;
  /** Enable LLM response caching */
  readonly enableCache: boolean;
  /** Enable error recovery with reflection */
  readonly enableReflection: boolean;
  /** Maximum tokens in response */
  readonly maxTokens: number;
  /** Extended-thinking (reasoning) budget for this agent (PRD §6.1, §9.2.3).
   *
   * Set to 'xhigh' for the Reasoning role (decomposition/bug-finding/validation);
   * undefined for Research/Implementation roles. Pipeline-internal budget marker —
   * Groundswell's AgentConfig does not model thinking; harness wiring is downstream.
   */
  readonly thinking?: ThinkingLevel;
  /** Stateless single-shot invariant (PRD §9.3.2 / P3.M2.T3.S1).
   *
   * `true` for personas in {@link STATELESS_PERSONAS}: the agent is single-shot and
   * MUST NOT create or resume a pi session (the `pi --no-session` equivalent).
   * Pipeline-internal invariant marker — Groundswell's `AgentConfig` /
   * `HarnessOptions` do NOT model a session-disable field, and
   * `PiHarness.execute()` hardcodes `createAgentSession({…})` WITHOUT a
   * `sessionManager` (so pi defaults to the disk-persisted
   * `SessionManager.create(cwd)` → orphaned JSONL under
   * `~/.pi/agent/sessions/<encoded-cwd>/`). This flag records the intent and
   * future-wires the disable: the moment a harness seam exposes
   * `SessionManager.inMemory()` (the pi SDK supports it), the wiring is one
   * line (`sessionManager: config.stateless ? SessionManager.inMemory(cwd)
   * : undefined`). Today it is a guarded, tested, documented marker — NOT a
   * mechanical switch (research/01).
   */
  readonly stateless: boolean;
  /** Environment variable overrides for SDK configuration */
  readonly env: {
    readonly ANTHROPIC_API_KEY: string;
    readonly ANTHROPIC_BASE_URL: string;
  };
}

/**
 * Persona-specific token limits
 *
 * @remarks
 * Architect agents need more tokens for complex task breakdown analysis.
 * Other agents use standard token limits for their specific tasks.
 */
const PERSONA_TOKEN_LIMITS = {
  architect: 8192,
  researcher: 4096,
  coder: 4096,
  qa: 4096,
  cleanup: 4096,
} as const;

/**
 * Personas that are stateless single-shot invocations per PRD §9.3.2.
 *
 * @remarks
 * Derivation from the PRD §9.3.2 list ("cleanup, mid-session task update,
 * validation, post-validation fix, bug-finder, per-item PRP execution"):
 * - per-item PRP execution → `coder` (`createCoderAgent`, prp-executor.ts:255)
 * - post-validation fix   → `coder` (same coder agent, prp-executor fix-loop)
 * - validation / bug-finder → `qa` (`createQAAgent`, bug-hunt-workflow.ts:267,
 *   delta-analysis-workflow.ts:121)
 * - cleanup → `cleanup` (`createCleanupAgent`, cleanup-runner.ts:117)
 *
 * `architect` (task breakdown) and `researcher` (PRP creation) are EXCLUDED —
 * they are multi-turn / large-context and NOT in the §9.3.2 stateless list.
 * "mid-session task update" has no persona yet (P4.M1.T2); when added it MUST
 * be registered here.
 *
 * @see {@link AgentConfig.stateless}
 */
export const STATELESS_PERSONAS: ReadonlySet<AgentPersona> =
  new Set<AgentPersona>(['coder', 'qa', 'cleanup']);

/**
 * Role → tier mapping (PRD §9.2.3 / §9.2.9).
 *
 * @remarks
 * Single source of truth for the role→TIER decision ONLY. The reasoning (extended-thinking) level
 * is NO LONGER derived from the role — it is resolved per-role via the `PRP_REASONING_*` env vars
 * (§9.2.9) and passed EXPLICITLY to {@link createBaseConfig}. `thinking` was therefore REMOVED from
 * this map: the model (tier) and the reasoning level are now two INDEPENDENT axes (§9.2.3 "two
 * independent axes").
 *
 * The role→tier MODEL mapping is UNCHANGED: research/reasoning → `balanced`; implementation → `fast`.
 *
 * @example
 * ```ts
 * ROLE_CONFIG.reasoning.tier;       // 'balanced'
 * ROLE_CONFIG.implementation.tier;  // 'fast'
 * ```
 */
export const ROLE_CONFIG: Readonly<
  Record<ModelRole, { readonly tier: ModelTier }>
> = {
  research: { tier: 'balanced' },
  reasoning: { tier: 'balanced' },
  implementation: { tier: 'fast' },
} as const;

/**
 * Create base agent configuration for a specific persona.
 *
 * @remarks
 * The `role` selects the MODEL TIER via {@link ROLE_CONFIG} (PRD §9.2.3); `getModel(tier)` resolves
 * the provider-qualified model id — UNCHANGED (research/reasoning → `zai/glm-5.2`; implementation →
 * `zai/glm-5-turbo`). The `thinking` (extended-thinking/reasoning budget) is a SEPARATE,
 * caller-resolved axis (PRD §9.2.9): each factory passes its resolved `PRP_REASONING_*` level (via
 * the `getReasoning*()` getters), INDEPENDENT of the tier. Tuning the reasoning level never
 * perturbs the model, and vice versa — a reasoning role can run with thinking `off`, an
 * implementation role can run with thinking `xhigh`. This is the §9.2.9 / §9.2.3 "two independent
 * axes" decoupling: which model a role runs and how hard it reasons are controlled separately.
 *
 * `thinking` is REQUIRED (no default): the decoupling is load-bearing, so a caller that forgets to
 * resolve a level is a compile error (TS2554), not a silent `undefined` that would re-couple the
 * axes. (The `role` default of `'research'` is preserved for the one-arg-with-default call shape
 * via `createBaseConfig(persona, undefined, level)`.)
 *
 * The returned config carries the **stateless single-shot invariant**
 * (PRD §9.3.2 / P3.M2.T3.S1) via {@link AgentConfig.stateless}, derived from
 * {@link STATELESS_PERSONAS} — the persona is the single source of truth, NOT a per-factory manual
 * override. Environment variables are mapped from shell conventions (ANTHROPIC_AUTH_TOKEN) to SDK
 * expectations (ANTHROPIC_API_KEY) via configureEnvironment().
 *
 * @param persona - The agent persona to create configuration for
 * @param role - The model role ('research' | 'reasoning' | 'implementation'); defaults to 'research'
 * @param thinking - The resolved extended-thinking level (PRD §9.2.9), INDEPENDENT of `role`/tier
 * @returns Groundswell-compatible agent configuration object
 *
 * @example
 * ```ts
 * import { createBaseConfig } from './agents/agent-factory.js';
 *
 * // reasoning role (balanced tier) running with thinking OFF — the decoupling proof
 * const cfg = createBaseConfig('architect', 'reasoning', 'off');
 * // { name: 'ArchitectAgent', model: 'zai/glm-5.2', thinking: 'off', harness: 'pi', ... }
 *
 * // implementation role (fast tier) running with thinking xhigh
 * const coderCfg = createBaseConfig('coder', 'implementation', 'xhigh');
 * // { name: 'CoderAgent', model: 'zai/glm-5-turbo', thinking: 'xhigh', ... }
 * ```
 */
export function createBaseConfig(
  persona: AgentPersona,
  role: ModelRole = 'research',
  thinking: ThinkingLevel // REQUIRED — no default (load-bearing §9.2.9 decoupling)
): AgentConfig {
  // PATTERN: Use getModel() to resolve model tier to actual model name.
  // The MODEL TIER is driven by ROLE_CONFIG[role] (PRD §9.2.3): default role 'research' → balanced
  // tier (glm-5.2); the Coder requests the 'implementation' role → fast tier (glm-5-turbo) via
  // ROLE_CONFIG. The reasoning LEVEL is a SEPARATE caller-resolved axis (PRD §9.2.9) — passed in
  // via the `thinking` param, independent of the tier.
  const { tier } = ROLE_CONFIG[role];
  const model = getModel(tier);

  // PATTERN: Persona-specific naming (PascalCase with "Agent" suffix)
  const name = `${persona.charAt(0).toUpperCase() + persona.slice(1)}Agent`;

  // GOTCHA: System prompt will be added in next subtask (P2.M1.T1.S2)
  // For now, use placeholder - this will be replaced with actual system prompts
  const system = `You are a ${persona} agent.`;

  // PATTERN: Readonly configuration object for immutability
  return {
    name,
    system,
    model,
    thinking,
    stateless: STATELESS_PERSONAS.has(persona), // P3.M2.T3.S1
    harness: resolvedHarness(),
    enableCache: true,
    enableReflection: true,
    maxTokens: PERSONA_TOKEN_LIMITS[persona],
    env: {
      // CRITICAL: Provider-aware API key resolution (PRD §9.2.6).
      // The resolver checks PRP_API_KEY → provider-native env var → auth.json (deferred).
      // The terminal ?? '' is an honest 'genuinely unconfigured' default;
      // the T3 preflight aborts before createBaseConfig runs with nothing configured.
      ANTHROPIC_API_KEY: resolveApiKeyForProvider(getResolvedProvider()) ?? '',
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? '',
    },
  };
}

/**
 * Create an Architect agent for PRD analysis and task breakdown
 *
 * @remarks
 * Uses the **Reasoning** model role (balanced tier, `xhigh` reasoning budget per PRD §6.1 —
 * decomposition is the most reasoning-intensive step). Uses the TASK_BREAKDOWN_PROMPT
 * system prompt for analyzing PRDs and generating structured task hierarchies.
 *
 * @returns Configured Groundswell Agent instance
 *
 * @example
 * ```ts
 * import { createArchitectAgent } from './agents/agent-factory.js';
 *
 * const architect = createArchitectAgent();
 * const result = await architect.prompt(prdAnalysisPrompt);
 * ```
 */
export function createArchitectAgent(): Agent {
  const baseConfig = createBaseConfig('architect', 'reasoning');
  const config = {
    ...baseConfig,
    system: TASK_BREAKDOWN_PROMPT,
    mcps: MCP_TOOLS,
  };
  logger().debug(
    { persona: 'architect', model: config.model },
    'Creating agent'
  );
  return createAgent(config);
}

/**
 * Create a Researcher agent for PRP generation and research
 *
 * @remarks
 * Uses the **Research** model role (balanced tier, normal reasoning budget per PRD §9.2.3).
 * Uses the PRP_BLUEPRINT_PROMPT system prompt for researching codebase patterns
 * and generating comprehensive Product Requirement Prompts.
 *
 * @returns Configured Groundswell Agent instance
 *
 * @example
 * ```ts
 * import { createResearcherAgent } from './agents/agent-factory.js';
 *
 * const researcher = createResearcherAgent();
 * const prp = await researcher.prompt(workItemPrompt);
 * ```
 */
export function createResearcherAgent(): Agent {
  const baseConfig = createBaseConfig('researcher', 'research');
  const config = {
    ...baseConfig,
    system: PRP_BLUEPRINT_PROMPT,
    mcps: MCP_TOOLS,
  };
  logger().debug(
    { persona: 'researcher', model: config.model },
    'Creating agent'
  );
  return createAgent(config);
}

/**
 * Create a Coder agent for code implementation from PRPs
 *
 * @remarks
 * Uses the **Implementation** model role (fast tier, normal reasoning budget per PRD §9.2.3).
 * Uses the PRP_BUILDER_PROMPT system prompt for implementing features based on Product
 * Requirement Prompt specifications. The fast tier is driven solely by
 * ROLE_CONFIG.implementation (no manual model override).
 *
 * @returns Configured Groundswell Agent instance
 *
 * @example
 * ```ts
 * import { createCoderAgent } from './agents/agent-factory.js';
 *
 * const coder = createCoderAgent();
 * const result = await coder.prompt(prpExecutionPrompt);
 * ```
 */
export function createCoderAgent(): Agent {
  const baseConfig = createBaseConfig('coder', 'implementation');
  const config = {
    ...baseConfig,
    system: PRP_BUILDER_PROMPT,
    mcps: MCP_TOOLS,
  };
  logger().debug({ persona: 'coder', model: config.model }, 'Creating agent');
  return createAgent(config);
}

/**
 * Create a QA agent for validation and bug hunting
 *
 * @remarks
 * The runtime realization of `BUG_FINDER_AGENT` (default `pizr`, PRD §4.4 / §9.2.2 / §9.2.3):
 * the reasoning persona (balanced tier @ `xhigh`) = the bash `pizr` agent (`pi` with
 * `--thinking xhigh`). Uses the **Reasoning** model role (balanced tier, `xhigh` reasoning
 * budget per PRD §6.5 / §9.2.3 — bug-finding is a reasoning-tier activity). The configured
 * bug-finder identifier is resolved from `BUG_FINDER_AGENT` at agent-creation time and
 * surfaced via {@link getBugFinderAgent} for observability (it NAMES the persona; it does
 * NOT change the model tier, which stays balanced @ `xhigh`). Uses the BUG_HUNT_PROMPT
 * system prompt for comprehensive end-to-end validation and creative bug finding.
 *
 * @returns Configured Groundswell Agent instance
 *
 * @example
 * ```ts
 * import { createQAAgent } from './agents/agent-factory.js';
 *
 * const qa = createQAAgent();
 * const bugReport = await qa.prompt(validationPrompt);
 * ```
 */
export function createQAAgent(): Agent {
  const baseConfig = createBaseConfig('qa', 'reasoning');
  const config = {
    ...baseConfig,
    system: BUG_HUNT_PROMPT,
    mcps: MCP_TOOLS,
  };
  logger().debug(
    { persona: 'qa', model: config.model, bugFinderAgent: getBugFinderAgent() },
    'Creating agent'
  );
  return createAgent(config);
}

/**
 * Create a Cleanup agent for post-validation artifact reorganization
 *
 * @remarks
 * Uses the **Implementation** model role (fast tier, normal reasoning budget per
 * PRD §9.2.3) — cleanup is a mechanical reorganization, not a reasoning task.
 * Uses the `CLEANUP_PROMPT` system prompt, which encodes the cleanup job
 * (PRD §4.2 step 4: remove temp artifacts, move docs to `docs/`, leave
 * `tasks.json` intact) and the **prompt-layer** critical-file deletion
 * protection mandated by PRD §5.1 (no `rm` / `git rm` / `git clean` / `mv`
 * against `PRD.md`, any `PRP.md`, or anything under `plan/`; no self-`git
 * commit` — the orchestrator's stagecoach does the post-cleanup commit).
 *
 * **Stateless single-shot** (PRD §9.3.3): `enableReflection: false` +
 * `enableCache: false` — cleanup is a one-shot reorg with no reflection loop
 * and no cacheable prompt. Cleanup is also marked **stateless** via
 * {@link STATELESS_PERSONAS} (PRD §9.3.2 / P3.M2.T3.S1), so
 * {@link AgentConfig.stateless} is `true` on the returned config. The
 * mechanical session-disable waits on a Groundswell `PiHarness` seam (no
 * `sessionManager` / `HarnessOptions` field today; `PiHarness.execute()`
 * hardcodes `createAgentSession` without a `sessionManager` → disk-persisted
 * default) — the flag records the intent and future-wires the wiring; see
 * {@link AgentConfig.stateless} JSDoc for the full gap.
 *
 * **Diverges from {@link createCommitMessageAgent}** by carrying `MCP_TOOLS`
 * (bash + filesystem + git): cleanup actually mutates the filesystem (move docs,
 * remove temp), whereas the commit-message agent reads a diff from the prompt
 * text and needs no tools.
 *
 * @returns Configured Groundswell Agent instance
 *
 * @example
 * ```ts
 * import { createCleanupAgent } from './agents/agent-factory.js';
 *
 * const cleanup = createCleanupAgent();
 * const result = await cleanup.prompt(cleanupPrompt);
 * ```
 */
export function createCleanupAgent(): Agent {
  const baseConfig = createBaseConfig('cleanup', 'implementation');
  const config = {
    ...baseConfig,
    system: CLEANUP_PROMPT,
    mcps: MCP_TOOLS,
    enableReflection: false,
    enableCache: false,
  };
  logger().debug({ persona: 'cleanup', model: config.model }, 'Creating agent');
  return createAgent(config);
}

// PATTERN: Re-export types for convenience

// PATTERN: Export MCP tools for external use and testing
export { MCP_TOOLS };
