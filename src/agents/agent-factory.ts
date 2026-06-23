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
 * Environment configuration is performed at module load time to ensure
 * ANTHROPIC_AUTH_TOKEN is mapped to ANTHROPIC_API_KEY before any agents are created.
 *
 * @example
 * ```ts
 * import { createBaseConfig } from './agents/agent-factory.js';
 *
 * const architectConfig = createBaseConfig('architect');
 * // Returns AgentConfig with maxTokens: 8192, model: 'zai/glm-5.2', harness: 'pi'
 * ```
 */

import { configureEnvironment, getModel } from '../config/environment.js';
import { configureHarness } from '../config/harness.js';
import type { AgentHarness } from '../config/types.js';
import { getLogger } from '../utils/logger.js';
import { createAgent, type Agent, type MCPServer } from 'groundswell';
import {
  TASK_BREAKDOWN_PROMPT,
  PRP_BLUEPRINT_PROMPT,
  PRP_BUILDER_PROMPT,
  BUG_HUNT_PROMPT,
} from './prompts.js';
import { BashMCP } from '../tools/bash-mcp.js';
import { FilesystemMCP } from '../tools/filesystem-mcp.js';
import { GitMCP } from '../tools/git-mcp.js';

// PATTERN: Configure environment at module load time (intentional side effect)
// CRITICAL: This must execute before any agent creation
configureEnvironment();
/**
 * Resolved agent harness — captured once at startup from configureHarness()
 * (PRD §9.4.2 cascade: global default unless overridden). configureHarness() also
 * populates Groundswell's global singleton via configureHarnesses().
 */
const RESOLVED_HARNESS: AgentHarness = configureHarness();

// Module-level logger for agent factory
const logger = getLogger('AgentFactory');

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
 */
export type AgentPersona = 'architect' | 'researcher' | 'coder' | 'qa';

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
} as const;

/**
 * Create base agent configuration for a specific persona
 *
 * @remarks
 * Generates a Groundswell-compatible agent configuration optimized for
 * the specified persona. All personas use the sonnet model tier (glm-5.2)
 * with caching and reflection enabled for optimal performance.
 *
 * Environment variables are mapped from shell conventions (ANTHROPIC_AUTH_TOKEN)
 * to SDK expectations (ANTHROPIC_API_KEY) via configureEnvironment().
 *
 * @param persona - The agent persona to create configuration for
 * @returns Groundswell-compatible agent configuration object
 *
 * @example
 * ```ts
 * import { createBaseConfig } from './agents/agent-factory.js';
 *
 * const architectConfig = createBaseConfig('architect');
 * // { name: 'ArchitectAgent', model: 'zai/glm-5.2', harness: 'pi', maxTokens: 8192, ... }
 *
 * const coderConfig = createBaseConfig('coder');
 * // { name: 'CoderAgent', model: 'zai/glm-5.2', harness: 'pi', maxTokens: 4096, ... }
 * ```
 */
export function createBaseConfig(persona: AgentPersona): AgentConfig {
  // PATTERN: Use getModel() to resolve model tier to actual model name
  const model = getModel('sonnet'); // All personas use sonnet → glm-5.2

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
    harness: RESOLVED_HARNESS,
    enableCache: true,
    enableReflection: true,
    maxTokens: PERSONA_TOKEN_LIMITS[persona],
    env: {
      // CRITICAL: Map environment variables for SDK compatibility
      // configureEnvironment() already mapped AUTH_TOKEN → API_KEY
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? '',
    },
  };
}

/**
 * Create an Architect agent for PRD analysis and task breakdown
 *
 * @remarks
 * Uses the TASK_BREAKDOWN_PROMPT system prompt for analyzing PRDs
 * and generating structured task hierarchies.
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
  const baseConfig = createBaseConfig('architect');
  const config = {
    ...baseConfig,
    system: TASK_BREAKDOWN_PROMPT,
    mcps: MCP_TOOLS,
  };
  logger.debug({ persona: 'architect', model: config.model }, 'Creating agent');
  return createAgent(config);
}

/**
 * Create a Researcher agent for PRP generation and research
 *
 * @remarks
 * Uses the PRP_BLUEPRINT_PROMPT system prompt for researching codebase
 * patterns and generating comprehensive Product Requirement Prompts.
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
  const baseConfig = createBaseConfig('researcher');
  const config = {
    ...baseConfig,
    system: PRP_BLUEPRINT_PROMPT,
    mcps: MCP_TOOLS,
  };
  logger.debug(
    { persona: 'researcher', model: config.model },
    'Creating agent'
  );
  return createAgent(config);
}

/**
 * Create a Coder agent for code implementation from PRPs
 *
 * @remarks
 * Uses the PRP_BUILDER_PROMPT system prompt for implementing
 * features based on Product Requirement Prompt specifications.
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
  const baseConfig = createBaseConfig('coder');
  const config = {
    ...baseConfig,
    system: PRP_BUILDER_PROMPT,
    mcps: MCP_TOOLS,
  };
  logger.debug({ persona: 'coder', model: config.model }, 'Creating agent');
  return createAgent(config);
}

/**
 * Create a QA agent for validation and bug hunting
 *
 * @remarks
 * Uses the BUG_HUNT_PROMPT system prompt for comprehensive
 * end-to-end validation and creative bug finding.
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
  const baseConfig = createBaseConfig('qa');
  const config = {
    ...baseConfig,
    system: BUG_HUNT_PROMPT,
    mcps: MCP_TOOLS,
  };
  logger.debug({ persona: 'qa', model: config.model }, 'Creating agent');
  return createAgent(config);
}

// PATTERN: Re-export types for convenience

// PATTERN: Export MCP tools for external use and testing
export { MCP_TOOLS };
