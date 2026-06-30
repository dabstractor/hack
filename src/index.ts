#!/usr/bin/env node
/**
 * Main entry point for PRP Pipeline CLI application
 *
 * @packageDocumentation
 *
 * @module index
 *
 * @remarks
 * This is the primary entry point for the PRD-to-PRP Pipeline application.
 * It configures the environment, parses CLI arguments, creates the pipeline,
 * and manages the complete application lifecycle from start to exit.
 *
 * Exit codes:
 * - 0: Success
 * - 1: Error (general)
 * - 130: SIGINT (Ctrl+C)
 *
 * @example
 * ```bash
 * # Run full pipeline
 * npm run dev -- --prd ./PRD.md
 *
 * # Run with scope
 * npm run dev -- --prd ./PRD.md --scope P3.M4
 *
 * # Resume interrupted session
 * npm run dev -- --prd ./PRD.md --continue
 *
 * # Debug mode
 * npm run dev -- --prd ./PRD.md --verbose
 *
 * # Preview mode
 * npm run dev -- --prd ./PRD.md --dry-run
 * ```
 */

import { configureEnvironment } from './config/environment.js';
import {
  configureHarness,
  ensureHarnessInitialized,
  runAuthPreflight,
} from './config/harness.js';
import {
  AuthPreflightError,
  HarnessProviderMismatchError,
  UnsupportedHarnessError,
} from './config/types.js';
import { parseCLIArgs, type ValidatedCLIArgs } from './cli/index.js';
import { PRPPipeline } from './workflows/prp-pipeline.js';
import { parseScope, type Scope } from './core/scope-resolver.js';
import { getLogger, type Logger } from './utils/logger.js';
import { PRDValidator } from './utils/prd-validator.js';

// ============================================================================
// GLOBAL ERROR HANDLERS
// ============================================================================

/**
 * Sets up global error handlers for uncaught exceptions and rejections
 *
 * @remarks
 * These handlers prevent silent failures and provide debugging information.
 * They set process.exitCode but don't exit immediately to allow cleanup.
 */
function setupGlobalHandlers(verbose: boolean): void {
  // Handle uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    console.error('\n❌ UNCAUGHT EXCEPTION');
    console.error(`Message: ${error.message}`);
    if (verbose && (error.stack ?? undefined)) {
      console.error(`Stack:\n${error.stack}`);
    }
    process.exitCode = 1;
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason: unknown) => {
    console.error('\n❌ UNHANDLED PROMISE REJECTION');
    console.error(`Reason: ${reason}`);
    process.exitCode = 1;
  });
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Main application entry point
 *
 * @returns Exit code (0=success, 1=error, 130=SIGINT)
 *
 * @remarks
 * Executes the complete PRP Pipeline workflow:
 * 1. Configures environment
 * 2. Creates root logger (independent of credentials/harness)
 * 3. Handles pure-local modes (--dry-run, --validate-prd) credential-free
 * 4. Configures agent harness eagerly (agent paths only; throws on claude-code+zai mismatch — PRD §9.4.3 / bugfix §h3.3)
 * 5. Runs auth preflight + harness initialization (agent paths only, §9.2.7)
 * 6. Creates pipeline instance, runs pipeline, displays results
 *
 * The harness/provider mismatch error from step 4 renders via the same clean main().catch()
 * handler as AuthPreflightError (❌ <message> + exit 1).
 *
 * Pure-local modes (--dry-run, --validate-prd) make zero API calls and run
 * BEFORE the §9.2.7 credential preflight and harness init (bugfix PRD §h3.2).
 * Environment configuration MUST happen first to ensure API keys are set.
 */
async function main(): Promise<number> {
  // Parse CLI arguments first (this may exit on validation failure)
  const parseResult = parseCLIArgs();

  // If inspect subcommand was invoked, it already handled execution
  if ('subcommand' in parseResult) {
    // The inspect command action already ran and called process.exit()
    // This return is for type safety; execution never reaches here
    return 0;
  }

  // Otherwise, use the regular CLI args for pipeline execution
  const args: ValidatedCLIArgs = parseResult;

  // Setup global error handlers (preserve console.error for uncaught exceptions)
  setupGlobalHandlers(args.verbose);

  // CRITICAL: Configure environment before any API operations
  configureEnvironment();

  // Initialize root logger (independent of creds/harness; function-scope — REQ-L2 safe)
  const logger: Logger = getLogger('App', {
    verbose: args.verbose,
    machineReadable: args.machineReadable,
  });

  // Verbose logging
  if (args.verbose) {
    logger.debug('Verbose mode enabled');
    logger.debug('Parsed CLI arguments:', args);
  }

  // Handle dry-run mode (credential-free — makes zero API calls)
  if (args.dryRun) {
    logger.info('🔍 DRY RUN - would execute with:');
    logger.info(`  PRD: ${args.prd}`);
    logger.info(`  Mode: ${args.mode}`);
    if (args.scope) {
      logger.info(`  Scope: ${args.scope}`);
    }
    if (args.continue) {
      logger.info(`  Resume: enabled`);
    }
    return 0;
  }

  // Handle --validate-prd mode: early exit after validation (credential-free)
  if (args.validatePrd) {
    logger.info('🔍 Validating PRD...');

    const validator = new PRDValidator();
    const result = await validator.validate(args.prd);

    // Print validation report
    logger.info('\n' + '='.repeat(60));
    logger.info('PRD Validation Report');
    logger.info('='.repeat(60));
    logger.info(`File: ${result.prdPath}`);
    logger.info(`Status: ${result.valid ? '✅ VALID' : '❌ INVALID'}`);
    logger.info(`\nSummary:`);
    logger.info(`  Critical: ${result.summary.critical}`);
    logger.info(`  Warnings: ${result.summary.warning}`);
    logger.info(`  Info: ${result.summary.info}`);

    if (result.issues.length > 0) {
      logger.info(`\nIssues:`);
      for (const issue of result.issues) {
        const icon =
          issue.severity === 'critical'
            ? '❌'
            : issue.severity === 'warning'
              ? '⚠️'
              : 'ℹ️';
        logger.info(
          `\n${icon} [${issue.severity.toUpperCase()}] ${issue.message}`
        );
        if (issue.suggestion) {
          logger.info(`   Suggestion: ${issue.suggestion}`);
        }
        if (issue.reference) {
          logger.info(`   Reference: ${issue.reference}`);
        }
      }
    }

    logger.info('='.repeat(60) + '\n');

    // Exit with appropriate code
    return result.valid ? 0 : 1;
  }

  // CRITICAL: Configure the agent harness eagerly on the agent-invoking path (bugfix §h3.3 / Issue 2).
  // configureHarness() resolves PRP_AGENT_HARNESS, validates it, enforces harness↔provider
  // compatibility (throws on claude-code+zai mismatch — PRD §9.4.3), and registers PiHarness.
  // Run AFTER configureEnvironment() and the local-only early-returns, BEFORE
  // runAuthPreflight()/ensureHarnessInitialized(). Idempotent: the lazy resolvedHarness() accessor in
  // agent-factory.ts becomes a no-op cache hit when createBaseConfig later runs. Errors are rendered
  // cleanly by the main().catch() harness-mismatch arm below.
  configureHarness();

  // CRITICAL: Fail-fast auth preflight (PRD §9.2.7). Aborts here if no credential
  // is configured for the selected harness + provider/model — BEFORE any session
  // directory is created or any agent is invoked.
  await runAuthPreflight();

  // CRITICAL: Initialize the agent harness before any agent runs.
  // The harness is registered at module-load but never initialized; without
  // this, every agent.prompt() fails instantly (see ensureHarnessInitialized()).
  await ensureHarnessInitialized();

  // Parse scope if provided
  const scope: Scope | undefined = args.scope
    ? parseScope(args.scope)
    : undefined;

  if (args.verbose && scope) {
    logger.debug('Parsed scope:', scope);
  }

  // Create pipeline instance
  if (args.verbose) {
    logger.debug('Creating PRPPipeline instance');
  }
  const pipeline = new PRPPipeline(
    args.prd,
    scope,
    args.mode,
    args.noCache,
    args.continueOnError,
    args.maxTasks,
    args.maxDuration,
    args.monitorInterval,
    args.monitorTaskInterval,
    args.noResourceMonitor,
    undefined, // planDir - use default
    args.progressMode ?? 'auto',
    args.parallelism,
    args.researchConcurrency,
    args.taskRetry,
    args.retryBackoff,
    args.noRetry,
    args.flushRetries,
    args.cacheTtl,
    args.prpCompression,
    args.metricsOutput
  );

  // Run pipeline
  if (args.verbose) {
    logger.debug('Starting pipeline execution');
  }
  const result = await pipeline.run();

  // Handle result based on state
  if (result.shutdownInterrupted) {
    // User interrupted with Ctrl+C
    logger.info(`\n⚠️  Pipeline interrupted by ${result.shutdownReason}`);
    logger.info(
      `📊 Progress: ${result.completedTasks}/${result.totalTasks} tasks completed`
    );
    logger.info(`💾 State saved to: ${result.sessionPath}`);
    logger.info(`\n🚀 To resume, run:`);
    logger.info(`   npm run dev -- --prd ${args.prd} --continue`);
    return 130; // SIGINT exit code
  }

  if (!result.success) {
    // Pipeline failed with fatal error
    logger.info(`\n❌ Pipeline failed`);
    if (result.error) {
      logger.info(`Error: ${result.error}`);
    }
    logger.info(`📊 Failed tasks: ${result.failedTasks}/${result.totalTasks}`);
    logger.info(`💾 Session: ${result.sessionPath}`);
    if (result.hasFailures && result.sessionPath) {
      logger.info(`\n📄 Error report: ${result.sessionPath}/ERROR_REPORT.md`);
    }
    if (args.continue) {
      logger.info(`\n🚀 To retry, run:`);
      logger.info(`   npm run dev -- --prd ${args.prd} --continue`);
    }
    return 1;
  }

  if (result.hasFailures) {
    // Pipeline completed but some tasks failed
    logger.info(`\n⚠️  Pipeline completed with failures`);
    logger.info(
      `📊 Tasks: ${result.completedTasks}/${result.totalTasks} completed, ${result.failedTasks} failed`
    );
    logger.info(`⏱️  Duration: ${(result.duration / 1000).toFixed(1)}s`);
    logger.info(`💾 Session: ${result.sessionPath}`);
    logger.info(`\n📄 Error report: ${result.sessionPath}/ERROR_REPORT.md`);
    logger.info(`\n🚀 To retry failed tasks, run:`);
    logger.info(
      `   npm run dev -- --prd ${args.prd} --continue --scope <task-id>`
    );
    return 1; // Exit with error code when any tasks failed
  }

  // Pipeline succeeded
  logger.info(`\n✅ Pipeline completed successfully`);
  logger.info(
    `📊 Tasks: ${result.completedTasks}/${result.totalTasks} completed`
  );
  logger.info(`⏱️  Duration: ${(result.duration / 1000).toFixed(1)}s`);
  logger.info(`💾 Session: ${result.sessionPath}`);
  if (result.bugsFound > 0) {
    logger.info(`🐛 Bugs found: ${result.bugsFound}`);
  }

  return 0;
}

// ============================================================================
// ENTRY POINT INVOCATION
// ============================================================================

/**
 * Application entry point
 *
 * @remarks
 * Uses the void main().catch() pattern for proper top-level error handling.
 * The promise result is used as the exit code.
 */
void main().catch((error: unknown) => {
  if (error instanceof AuthPreflightError) {
    console.error(`\n❌ ${error.message}`); // ONE actionable message (PRD §9.2.7)
    process.exit(1);
  }
  if (error instanceof HarnessProviderMismatchError) {
    console.error(`\n❌ ${error.message}`); // actionable: harness+provider+§9.2.4+both remediations
    process.exit(1);
  }
  if (error instanceof UnsupportedHarnessError) {
    console.error(`\n❌ ${error.message}`); // actionable: unsupported harness id + supported list
    process.exit(1);
  }
  console.error('\n❌ Fatal error in main():', error);
  process.exit(1);
});
