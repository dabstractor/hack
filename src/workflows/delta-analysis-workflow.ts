/**
 * Delta Analysis workflow for PRD comparison and task patching
 *
 * @module workflows/delta-analysis-workflow
 *
 * @remarks
 * Analyzes PRD version differences to detect changes and generate
 * structured patch instructions for delta session task re-execution.
 *
 * @example
 * ```typescript
 * import { DeltaAnalysisWorkflow } from './workflows/delta-analysis-workflow.js';
 *
 * const workflow = new DeltaAnalysisWorkflow(oldPRD, newPRD, ['P1.M1.T1']);
 * const analysis = await workflow.run();
 * console.log(`Found ${analysis.changes.length} changes`);
 * ```
 */

import { Workflow, Step } from 'groundswell';
import type { DeltaAnalysis } from '../core/models.js';
import type { Logger } from '../utils/logger.js';
import { getLogger } from '../utils/logger.js';
import { createQAAgent } from '../agents/agent-factory.js';
import { getReasoningAgent } from '../config/constants.js';
import { createDeltaAnalysisPrompt } from '../agents/prompts/delta-analysis-prompt.js';
import { retryAgentPrompt } from '../utils/retry.js';

/**
 * Delta Analysis workflow class
 *
 * @remarks
 * Orchestrates the delta analysis process for PRD comparison:
 * 1. Accepts old and new PRD versions plus completed task IDs
 * 2. Uses QA agent with delta analysis prompt for semantic comparison
 * 3. Returns structured DeltaAnalysis with changes and patch instructions
 *
 * Uses Groundswell Workflow base class with public state fields for observability.
 */
export class DeltaAnalysisWorkflow extends Workflow {
  // ========================================================================
  // Public State Fields (observable via Groundswell Workflow base)
  // ========================================================================

  /** Previous PRD content for comparison */
  oldPRD: string;

  /** Current PRD content for comparison */
  newPRD: string;

  /** List of completed task IDs to preserve */
  completedTasks: string[];

  /** Delta analysis result (null until analyzeDelta completes) */
  deltaAnalysis: DeltaAnalysis | null = null;

  /** Correlation logger with correlation ID for tracing */
  private correlationLogger: Logger;

  // ========================================================================
  // Constructor
  // ========================================================================

  /**
   * Creates a new DeltaAnalysisWorkflow instance
   *
   * @param oldPRD - Previous PRD markdown content. MUST be the fully-resolved, include-expanded
   *   PRD document (PRD §2.3 "Single canonical document downstream"). Callers resolve before
   *   constructing; agents must not chase `@`-includes themselves.
   * @param newPRD - Current PRD markdown content. MUST be the fully-resolved, include-expanded
   *   PRD document (PRD §2.3). Callers resolve before constructing; agents must not chase
   *   `@`-includes themselves.
   * @param completedTasks - List of completed task IDs to preserve
   * @throws {Error} If oldPRD or newPRD is empty
   */
  constructor(oldPRD: string, newPRD: string, completedTasks: string[]) {
    super('DeltaAnalysisWorkflow');

    if (!oldPRD || oldPRD.trim() === '') {
      throw new Error('oldPRD cannot be empty');
    }

    if (!newPRD || newPRD.trim() === '') {
      throw new Error('newPRD cannot be empty');
    }

    this.oldPRD = oldPRD;
    this.newPRD = newPRD;
    this.completedTasks = completedTasks;

    // Create correlation logger with correlation ID
    const correlationId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.correlationLogger = getLogger('DeltaAnalysisWorkflow').child({
      correlationId,
    });

    this.correlationLogger.info('[DeltaAnalysisWorkflow] Initialized', {
      correlationId,
      completedTasksCount: completedTasks.length,
    });
  }

  // ========================================================================
  // Step Methods
  // ========================================================================

  /**
   * Analyze PRD delta and generate patch instructions
   *
   * @remarks
   * Uses QA agent with delta analysis prompt to compare PRD versions
   * and generate structured DeltaAnalysis output.
   *
   * @returns Delta analysis with changes, patch instructions, and affected task IDs
   */
  @Step({ trackTiming: true })
  async analyzeDelta(): Promise<DeltaAnalysis> {
    this.logger.info('[DeltaAnalysisWorkflow] Starting delta analysis');

    try {
      // RESEARCH-LEANING (PRD §9.2.9): delta-analysis is an analysis/research task, not a bug-finder or
      // validation step, so it reuses the AGENT (research) reasoning level via getReasoningAgent().
      // (bug-finder + validation callers resolve their OWN levels independently.)
      const qaAgent = createQAAgent(getReasoningAgent());

      // Create delta analysis prompt
      const prompt = createDeltaAnalysisPrompt(
        this.oldPRD,
        this.newPRD,
        this.completedTasks
      );

      // Execute analysis with retry logic
      const agentResponse = await retryAgentPrompt(
        () => qaAgent.prompt(prompt),
        { agentType: 'QA', operation: 'deltaAnalysis' }
      );

      // Extract DeltaAnalysis from AgentResponse
      if (agentResponse.status !== 'success' || agentResponse.data === null) {
        const errorMessage =
          agentResponse.status === 'error' && agentResponse.error
            ? agentResponse.error.message
            : 'Unknown error';
        throw new Error(`QA agent failed: ${errorMessage}`);
      }

      const result: DeltaAnalysis = agentResponse.data;

      // Store result
      this.deltaAnalysis = result;

      this.logger.info('[DeltaAnalysisWorkflow] Analysis complete');
      this.logger.info(
        `[DeltaAnalysisWorkflow] Found ${result.changes.length} changes`
      );
      this.logger.info(
        `[DeltaAnalysisWorkflow] Affected tasks: ${result.taskIds.length}`
      );

      return result;
    } catch (error) {
      this.logger.error(`[DeltaAnalysisWorkflow] Analysis failed: ${error}`);
      throw error;
    }
  }

  // ========================================================================
  // Main Entry Point
  // ========================================================================

  /**
   * Run the delta analysis workflow
   *
   * @remarks
   * Orchestrates the complete delta analysis process:
   * 1. Set status to running
   * 2. Execute analyzeDelta() step
   * 3. Set status to completed
   * 4. Return DeltaAnalysis result
   *
   * @returns Delta analysis with changes, patch instructions, and affected task IDs
   */
  async run(): Promise<DeltaAnalysis> {
    this.setStatus('running');

    this.correlationLogger.info('[DeltaAnalysisWorkflow] Starting workflow');
    this.logger.info('[DeltaAnalysisWorkflow] Starting workflow');
    this.logger.info('[DeltaAnalysisWorkflow] Comparing PRD versions');
    this.logger.info(
      `[DeltaAnalysisWorkflow] Completed tasks to preserve: ${this.completedTasks.length}`
    );

    const analysis = await this.analyzeDelta();

    this.setStatus('completed');

    this.logger.info('[DeltaAnalysisWorkflow] Workflow completed');

    return analysis;
  }
}
