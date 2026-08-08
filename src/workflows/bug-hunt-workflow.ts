/**
 * Bug Hunt workflow for three-phase QA testing
 *
 * @module workflows/bug-hunt-workflow
 *
 * @remarks
 * Orchestrates comprehensive QA testing across three phases:
 * 1. Scope Analysis - Understand PRD requirements and expected behaviors
 * 2. Creative E2E Testing - Test happy paths, edge cases, integrations
 * 3. Adversarial Testing - Test unexpected inputs, missing features, UX issues
 *
 * Uses AI-powered QA agent with adversarial mindset to find bugs beyond
 * standard validation. Generates structured TestResults for automated
 * bug fix pipeline integration.
 *
 * @example
 * ```typescript
 * import { BugHuntWorkflow } from './workflows/bug-hunt-workflow.js';
 *
 * const workflow = new BugHuntWorkflow(prdContent, completedTasks);
 * const results = await workflow.run();
 * console.log(`Found ${results.bugs.length} bugs`);
 * ```
 */

import { Workflow, Step } from 'groundswell';
import { resolve, join } from 'node:path';
import { readFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Task, TestResults } from '../core/models.js';
import type { Logger } from '../utils/logger.js';
import { getLogger } from '../utils/logger.js';
import { createQAAgent } from '../agents/agent-factory.js';
import { createBugHuntPrompt } from '../agents/prompts/bug-hunt-prompt.js';
import { retryAgentPrompt } from '../utils/retry.js';
import { toErrorMessage } from '../utils/errors.js';
import { atomicWrite } from '../core/session-utils.js';
import { TestResultsSchema } from '../core/models.js';
import {
  getBugFinderAgent,
  getReasoningBugFinder,
} from '../config/constants.js';
import { smartCommit } from '../utils/git-commit.js';

/** Marker file written when a bug hunt finds no actionable bugs (PRD §4.4). */
const NO_ISSUES_FOUND_FILE = 'NO_ISSUES_FOUND.md';

/**
 * Bug Hunt workflow class
 *
 * @remarks
 * Orchestrates the three-phase QA testing process:
 * 1. Scope Analysis - Analyze PRD content to understand requirements
 * 2. Creative E2E Testing - Generate comprehensive test scenarios
 * 3. Adversarial Testing - Find bugs beyond standard validation
 * 4. Generate Report - Execute QA agent and produce TestResults
 *
 * Uses Groundswell Workflow base class with public state fields
 * and @Step decorators for method tracking.
 */
export class BugHuntWorkflow extends Workflow {
  // ========================================================================
  // Public State Fields (observable via Groundswell Workflow base)
  // ========================================================================

  /** Original PRD content for requirement validation */
  prdContent: string;

  /** List of completed tasks to test against PRD */
  completedTasks: Task[];

  /** Generated test results (null until report phase completes) */
  testResults: TestResults | null = null;

  /** Session path for file-as-contract output (set by run()) */
  private sessionPath?: string;

  /** Correlation logger with correlation ID for tracing */
  private correlationLogger: Logger;

  // ========================================================================
  // Constructor
  // ========================================================================

  /**
   * Creates a new BugHuntWorkflow instance
   *
   * @param prdContent - The original PRD content for requirement validation
   * @param completedTasks - List of completed tasks to test against PRD
   * @throws {Error} If prdContent is empty or not a string
   * @throws {Error} If completedTasks is not an array
   */
  constructor(prdContent: string, completedTasks: Task[]) {
    super('BugHuntWorkflow');

    // PATTERN: Input validation in constructor
    if (typeof prdContent !== 'string' || prdContent.trim() === '') {
      throw new Error('prdContent must be a non-empty string');
    }

    if (!Array.isArray(completedTasks)) {
      throw new Error('completedTasks must be an array');
    }

    // Initialize properties
    this.prdContent = prdContent;
    this.completedTasks = completedTasks;

    // Create correlation logger with correlation ID
    const correlationId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.correlationLogger = getLogger('BugHuntWorkflow').child({
      correlationId,
    });

    this.correlationLogger.info('[BugHuntWorkflow] Initialized', {
      prdLength: prdContent.length,
      tasksCount: completedTasks.length,
    });
    this.correlationLogger.info('[BugHuntWorkflow] Initialized', {
      correlationId,
      prdLength: prdContent.length,
      tasksCount: completedTasks.length,
    });
  }

  // ========================================================================
  // Step Methods
  // ========================================================================

  /**
   * Phase 1: Scope Analysis
   *
   * Analyzes PRD content to understand requirements, expected behaviors,
   * user journeys, and edge cases. This phase builds context for testing.
   *
   * @remarks
   * Logs scope analysis findings for observability. Actual analysis
   * is performed by QA agent in generateReport() phase.
   */
  @Step({ trackTiming: true })
  async analyzeScope(): Promise<void> {
    this.correlationLogger.info('[BugHuntWorkflow] Phase 1: Scope Analysis');
    this.correlationLogger.info(
      '[BugHuntWorkflow] Analyzing PRD requirements...',
      {
        prdLength: this.prdContent.length,
      }
    );

    // Log completed tasks for context
    this.correlationLogger.info(
      '[BugHuntWorkflow] Completed tasks for testing:',
      {
        count: this.completedTasks.length,
        tasks: this.completedTasks.map(t => `${t.id}: ${t.title}`),
      }
    );

    // PATTERN: Log scope findings (QA agent will do actual analysis)
    this.correlationLogger.info(
      '[BugHuntWorkflow] Scope analysis complete - QA context established'
    );
  }

  /**
   * Phase 2: Creative End-to-End Testing
   *
   * Generates and executes comprehensive test scenarios covering:
   * - Happy path testing (primary use cases)
   * - Edge case testing (boundaries, empty inputs, unicode)
   * - Workflow testing (complete user journeys)
   * - Integration testing (component interactions)
   * - Error handling (graceful failures)
   * - State testing (transitions and persistence)
   * - Concurrency testing (parallel operations)
   *
   * @remarks
   * Logs test scenario categories. Actual testing is performed
   * by QA agent in generateReport() phase.
   */
  @Step({ trackTiming: true })
  async creativeE2ETesting(): Promise<void> {
    this.correlationLogger.info(
      '[BugHuntWorkflow] Phase 2: Creative E2E Testing'
    );

    // PATTERN: Log test categories for observability
    const testCategories = [
      'Happy Path Testing',
      'Edge Case Testing',
      'Workflow Testing',
      'Integration Testing',
      'Error Handling',
      'State Testing',
      'Concurrency Testing',
      'Regression Testing',
    ];

    this.correlationLogger.info(
      '[BugHuntWorkflow] E2E test categories:',
      testCategories
    );

    // QA agent will perform actual testing in generateReport()
    this.correlationLogger.info(
      '[BugHuntWorkflow] E2E testing scenarios defined - awaiting QA agent execution'
    );
  }

  /**
   * Phase 3: Adversarial Testing
   *
   * Performs adversarial testing to find bugs beyond standard validation:
   * - Unexpected inputs (undefined scenarios, malformed data)
   * - Missing features (PRD requirements not implemented)
   * - Incomplete features (partial implementations)
   * - Implicit requirements (obvious but unstated functionality)
   * - User experience issues (usability, intuitiveness)
   *
   * @remarks
   * Logs adversarial test categories. Actual testing is performed
   * by QA agent in generateReport() phase.
   */
  @Step({ trackTiming: true })
  async adversarialTesting(): Promise<void> {
    this.correlationLogger.info(
      '[BugHuntWorkflow] Phase 3: Adversarial Testing'
    );

    // PATTERN: Log adversarial categories for observability
    const adversarialCategories = [
      'Unexpected Inputs',
      'Missing Features',
      'Incomplete Features',
      'Implicit Requirements',
      'User Experience Issues',
      'Security Concerns',
      'Performance Issues',
    ];

    this.correlationLogger.info(
      '[BugHuntWorkflow] Adversarial test categories:',
      adversarialCategories
    );

    // QA agent will perform actual adversarial testing in generateReport()
    this.correlationLogger.info(
      '[BugHuntWorkflow] Adversarial testing scenarios defined - awaiting QA agent execution'
    );
  }

  /**
   * Phase 4: Generate Bug Report
   *
   * Uses QA agent with createBugHuntPrompt() to generate structured
   * TestResults containing found bugs, severity classification, and
   * fix recommendations.
   *
   * @returns Promise<TestResults> - Structured test results with bug reports
   * @throws {Error} If QA agent fails to generate report
   *
   * @remarks
   * This is the only phase that makes actual LLM calls. The previous
   * phases (analyzeScope, creativeE2ETesting, adversarialTesting) are
   * logical phases for tracking and observability. The QA agent
   * performs all testing work based on PRD + completed tasks context.
   */
  @Step({ trackTiming: true })
  async generateReport(): Promise<TestResults> {
    this.correlationLogger.info(
      '[BugHuntWorkflow] Phase 4: Generating Bug Report'
    );

    try {
      // PATTERN: Create QA agent — reasoning resolved per-role per PRD §9.2.9 (bug-finder level).
      const qaAgent = createQAAgent(getReasoningBugFinder());
      this.correlationLogger.info('[BugHuntWorkflow] QA agent created');

      // FILE-AS-CONTRACT: write TestResults JSON to a file the agent controls,
      // then read it back. Reasoning models reliably write files but do NOT
      // reliably honor responseFormat for structured JSON (the prior
      // responseFormat-only path failed with VALIDATION_ERROR because the
      // model returned prose). The file is the source of truth.
      const outputPath =
        this.sessionPath !== undefined
          ? join(this.sessionPath, 'bug_hunt_results.json')
          : undefined;

      // PATTERN: Create bug hunt prompt with PRD, completed tasks, and output path
      const prompt = createBugHuntPrompt(
        this.prdContent,
        this.completedTasks,
        outputPath
      );
      this.correlationLogger.info('[BugHuntWorkflow] Bug hunt prompt created', {
        usingFileContract: outputPath !== undefined,
        outputPath,
      });

      // PATTERN: Execute QA agent with retry logic
      const agentResponse = await retryAgentPrompt(
        () => qaAgent.prompt(prompt),
        { agentType: 'QA', operation: 'bugHunt' }
      );

      let results: TestResults;

      if (outputPath !== undefined) {
        // FILE-AS-CONTRACT path: read + validate the JSON file the agent wrote
        results = await this.#readResultsFile(outputPath);
      } else {
        // Legacy responseFormat path: extract from AgentResponse
        if (agentResponse.status !== 'success' || agentResponse.data === null) {
          const errorMessage =
            agentResponse.status === 'error' && agentResponse.error
              ? toErrorMessage(agentResponse.error)
              : 'Unknown error';
          throw new Error(`QA agent failed: ${errorMessage}`);
        }
        results = agentResponse.data;
      }

      // Store results for observability
      this.testResults = results;

      // Log summary
      this.correlationLogger.info('[BugHuntWorkflow] Bug report generated', {
        hasBugs: results.hasBugs,
        bugCount: results.bugs.length,
        criticalCount: results.bugs.filter(b => b.severity === 'critical')
          .length,
        majorCount: results.bugs.filter(b => b.severity === 'major').length,
        minorCount: results.bugs.filter(b => b.severity === 'minor').length,
        cosmeticCount: results.bugs.filter(b => b.severity === 'cosmetic')
          .length,
      });

      // Log summary and recommendations
      this.correlationLogger.info(
        `[BugHuntWorkflow] Summary: ${results.summary}`
      );
      this.correlationLogger.info(
        '[BugHuntWorkflow] Recommendations:',
        results.recommendations
      );

      return results;
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      this.correlationLogger.error(
        '[BugHuntWorkflow] Failed to generate bug report',
        {
          error: errorMessage,
        }
      );
      throw new Error(`Bug report generation failed: ${errorMessage}`);
    }
  }

  /**
   * Reads + validates the TestResults JSON file written by the QA agent.
   *
   * @remarks
   * File-as-contract reader (mirrors the architect/prp-generator pattern).
   * Tolerates a leading/trailing markdown fence and parses-first, then
   * validates against TestResultsSchema. Throws a clear AgentError if the
   * file is missing, unparseable, or fails schema validation.
   */
  async #readResultsFile(outputPath: string): Promise<TestResults> {
    let raw: string;
    try {
      raw = await readFile(outputPath, 'utf-8');
    } catch {
      throw new Error(`QA agent did not write results file: ${outputPath}`);
    }
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Tolerate a ```json ... ``` fence (some models wrap the file)
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenced) {
        try {
          parsed = JSON.parse(fenced[1].trim());
        } catch (e) {
          throw new Error(
            `QA results file is not valid JSON: ${toErrorMessage(e)}`
          );
        }
      } else {
        throw new Error('QA results file is not valid JSON');
      }
    }
    const result = TestResultsSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `QA results file failed validation: ${toErrorMessage(result.error)}`
      );
    }
    return result.data;
  }

  /**
   * Writes bug report to TEST_RESULTS.md in session directory
   *
   * @param sessionPath - Absolute path to session directory
   * @param testResults - Test results to persist
   * @throws {Error} If sessionPath is invalid or write fails
   * @remarks
   * Only writes if critical or major bugs are present. Uses atomic
   * write pattern to prevent corruption. Validates with Zod before writing.
   */
  public async writeBugReport(
    sessionPath: string,
    testResults: TestResults
  ): Promise<void> {
    // PATTERN: Input validation for sessionPath
    if (typeof sessionPath !== 'string' || sessionPath.trim() === '') {
      throw new Error('sessionPath must be a non-empty string');
    }

    // PATTERN: Severity checking - only write if critical or major bugs present
    const hasCriticalOrMajor = testResults.bugs.some(
      bug => bug.severity === 'critical' || bug.severity === 'major'
    );

    if (!hasCriticalOrMajor) {
      this.correlationLogger.info(
        '[BugHuntWorkflow] No critical or major bugs - skipping bug report write'
      );
      return;
    }

    // PATTERN: Zod validation before writing
    try {
      TestResultsSchema.parse(testResults);
    } catch (error) {
      throw new Error(
        `Invalid TestResults provided to writeBugReport: ${error}`
      );
    }

    // PATTERN: JSON serialization with 2-space indentation
    const content = JSON.stringify(testResults, null, 2);

    // PATTERN: Path construction with resolve()
    const resultsPath = resolve(sessionPath, 'TEST_RESULTS.md');

    // PATTERN: Atomic write with error handling
    try {
      this.correlationLogger.info('[BugHuntWorkflow] Writing bug report', {
        resultsPath,
        hasBugs: testResults.hasBugs,
        bugCount: testResults.bugs.length,
        criticalCount: testResults.bugs.filter(b => b.severity === 'critical')
          .length,
        majorCount: testResults.bugs.filter(b => b.severity === 'major').length,
      });
      await atomicWrite(resultsPath, content);
      this.correlationLogger.info(
        '[BugHuntWorkflow] Bug report written successfully',
        { resultsPath }
      );
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      this.correlationLogger.error(
        '[BugHuntWorkflow] Failed to write bug report',
        { error: errorMessage, resultsPath }
      );
      throw new Error(
        `Failed to write bug report to ${resultsPath}: ${errorMessage}`
      );
    }
  }

  // ========================================================================
  // No-issues marker (PRD §4.4)
  // ========================================================================

  /**
   * Records the latest QA result in the directory (PRD §4.4 No-issues marker).
   *
   * - Clean (no critical/major/minor bugs): write `NO_ISSUES_FOUND.md` and commit
   *   it via {@link smartCommit} (a clean result is persisted like a real bug report).
   * - Bugs found (any critical/major/minor): remove a stale `NO_ISSUES_FOUND.md`
   *   if present (`TEST_RESULTS.md` is handled separately by {@link writeBugReport}).
   *
   * Called from {@link run} inside the `if (sessionPath)` block, after
   * {@link writeBugReport}.
   *
   * @param sessionPath - Absolute path to session/bugfix directory.
   * @param testResults - The TestResults produced by the bug hunt.
   */
  public async recordQAMarker(
    sessionPath: string,
    testResults: TestResults
  ): Promise<void> {
    const isClean = !testResults.bugs.some(
      b =>
        b.severity === 'critical' ||
        b.severity === 'major' ||
        b.severity === 'minor'
    );
    if (isClean) {
      await this.writeNoIssuesMarker(sessionPath, testResults);
      const commitHash = await smartCommit(
        sessionPath,
        'chore(qa): bug hunt clean — no issues found (NO_ISSUES_FOUND.md)'
      );
      this.correlationLogger.info(
        '[BugHuntWorkflow] Committed clean-hunt marker',
        { commitHash }
      );
    } else {
      await this.removeNoIssuesMarker(sessionPath);
    }
  }

  /**
   * Writes `NO_ISSUES_FOUND.md` (real Markdown) recording a clean bug hunt
   * (PRD §4.4). Content: ISO timestamp, session path tested, SHA-256 of the
   * current `tasks.json` (sentinel if missing), and the bug-finder agent.
   *
   * @param sessionPath - Absolute path to session/bugfix directory.
   * @param testResults - The clean TestResults (no critical/major/minor bugs).
   * @throws {Error} If `sessionPath` is invalid or the write fails.
   */
  public async writeNoIssuesMarker(
    sessionPath: string,
    testResults: TestResults
  ): Promise<void> {
    // PATTERN: Input validation for sessionPath (mirrors writeBugReport)
    if (typeof sessionPath !== 'string' || sessionPath.trim() === '') {
      throw new Error('sessionPath must be a non-empty string');
    }

    const timestamp = new Date().toISOString();

    // tasks.json hash — sentinel on missing so the marker is still written.
    const tasksJsonPath = resolve(sessionPath, 'tasks.json');
    let tasksHash: string;
    try {
      const raw = await readFile(tasksJsonPath, 'utf-8');
      tasksHash = createHash('sha256').update(raw).digest('hex');
    } catch {
      tasksHash = 'tasks.json-not-found';
    }

    const bugFinderAgent = getBugFinderAgent();

    const content = [
      '# No Issues Found',
      '',
      'This directory was hunted clean by the QA bug-finder: no critical, major, or minor bugs.',
      '',
      `- **Timestamp:** ${timestamp}`,
      `- **Session path tested:** ${sessionPath}`,
      `- **tasks.json hash (SHA-256):** ${tasksHash}`,
      `- **Bug-finder agent:** ${bugFinderAgent}`,
      '',
      'PRD §4.4 — distinguishes "already hunted clean" from "never hunted." ' +
        'Removed automatically if a later hunt finds bugs.',
      '',
    ].join('\n');

    const markerPath = resolve(sessionPath, NO_ISSUES_FOUND_FILE);

    // PATTERN: Atomic write with error handling (mirrors writeBugReport)
    try {
      this.correlationLogger.info(
        '[BugHuntWorkflow] Writing NO_ISSUES_FOUND.md',
        {
          markerPath,
          tasksHash,
          bugFinderAgent,
          bugCount: testResults.bugs.length,
        }
      );
      await atomicWrite(markerPath, content);
      this.correlationLogger.info(
        '[BugHuntWorkflow] NO_ISSUES_FOUND.md written successfully',
        { markerPath }
      );
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      this.correlationLogger.error(
        '[BugHuntWorkflow] Failed to write NO_ISSUES_FOUND.md',
        { markerPath, error: errorMessage }
      );
      throw new Error(
        `Failed to write marker to ${markerPath}: ${errorMessage}`
      );
    }
  }

  /**
   * Removes a stale `NO_ISSUES_FOUND.md` marker (PRD §4.4).
   *
   * Tolerant of a missing file (ENOENT) — a clean marker from a prior hunt is
   * removed when the current hunt finds bugs, so the directory always reflects
   * the latest result. A missing marker is the common case and is not an error.
   *
   * @param sessionPath - Absolute path to session/bugfix directory.
   * @throws {Error} If the unlink fails for a reason other than ENOENT.
   */
  public async removeNoIssuesMarker(sessionPath: string): Promise<void> {
    const markerPath = resolve(sessionPath, NO_ISSUES_FOUND_FILE);
    try {
      await unlink(markerPath);
      this.correlationLogger.info(
        '[BugHuntWorkflow] Removed stale NO_ISSUES_FOUND.md marker',
        { markerPath }
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        // No prior marker — nothing to remove. Not an error.
        return;
      }
      // Real failure to delete — log + rethrow (matches writeBugReport's throw style).
      const errorMessage = toErrorMessage(error);
      this.correlationLogger.error(
        '[BugHuntWorkflow] Failed to remove NO_ISSUES_FOUND.md marker',
        { markerPath, error: errorMessage }
      );
      throw new Error(`Failed to remove marker ${markerPath}: ${errorMessage}`);
    }
  }

  // ========================================================================
  // Main Entry Point
  // ========================================================================

  /**
   * Runs the complete bug hunt workflow
   *
   * Orchestrates all four phases sequentially:
   * 1. Scope Analysis - Understand PRD requirements
   * 2. Creative E2E Testing - Define test scenarios
   * 3. Adversarial Testing - Define adversarial scenarios
   * 4. Generate Report - Execute QA and produce TestResults
   *
   * @param sessionPath - Optional path to session directory for writing TEST_RESULTS.md
   * @returns Promise<TestResults> - Structured test results with bug findings
   * @throws {Error} If any phase fails or QA agent fails
   *
   * @remarks
   * The workflow status transitions through: idle → running → completed/failed
   * TestResults.hasBugs drives the bug fix pipeline (true = trigger fix cycle)
   *
   * If sessionPath is provided and critical/major bugs are found, TEST_RESULTS.md
   * is automatically written to the session directory before returning.
   */
  async run(sessionPath?: string): Promise<TestResults> {
    this.setStatus('running');
    this.sessionPath = sessionPath;
    this.correlationLogger.info('[BugHuntWorkflow] Starting bug hunt workflow');
    this.correlationLogger.info('[BugHuntWorkflow] Starting bug hunt workflow');

    try {
      // Execute phases sequentially
      await this.analyzeScope();
      await this.creativeE2ETesting();
      await this.adversarialTesting();

      // Generate and return bug report
      const results = await this.generateReport();

      // Write bug report if sessionPath provided
      if (sessionPath) {
        this.correlationLogger.info(
          `[BugHuntWorkflow] Writing TEST_RESULTS.md to ${sessionPath}`
        );
        await this.writeBugReport(sessionPath, results);
        await this.recordQAMarker(sessionPath, results);
      }

      this.setStatus('completed');
      this.correlationLogger.info(
        '[BugHuntWorkflow] Bug hunt workflow completed successfully',
        {
          hasBugs: results.hasBugs,
          bugCount: results.bugs.length,
        }
      );

      return results;
    } catch (error) {
      // PATTERN: Set status to failed on error
      this.setStatus('failed');
      const errorMessage = toErrorMessage(error);
      this.correlationLogger.error(
        '[BugHuntWorkflow] Bug hunt workflow failed',
        {
          error: errorMessage,
        }
      );
      throw error;
    }
  }
}
