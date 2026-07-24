/**
 * Cleanup runner seam (P3.M1.T3.S2) — default runner filled (P3.M1.T3.S3).
 *
 * @module core/cleanup-runner
 *
 * @remarks
 * This module is the **injectable seam** between the two-phase commit wiring
 * in {@link executeSubtask} (P3.M1.T3.S2) and the cleanup-agent persona
 * (P3.M1.T3.S3).
 *
 * The {@link CleanupContext} / {@link CleanupResult} / {@link CleanupRunner}
 * types are the FROZEN seam contract (P3.M1.T3.S2) — consumers must not rename
 * their fields. {@link createCleanupRunner}'s default runner (filled by
 * P3.M1.T3.S3) builds a runtime user prompt from the context, invokes the
 * cleanup agent persona (`createCleanupAgent`), and maps the agent result into a
 * {@link CleanupResult}. Cleanup is **non-fatal** to `executeSubtask`: on agent
 * failure the runner returns `{ success: false, error }` (and any unexpected
 * throw propagates to P3.M1.T3.S2's nested try/catch, which swallows it). The
 * agent itself is created INSIDE the returned closure (lazy, per-call) so each
 * cleanup gets a fresh single-shot agent.
 */

import { createPrompt } from 'groundswell';
import { z } from 'zod';
import { createCleanupAgent } from '../agents/agent-factory.js';
import { getLogger } from '../utils/logger.js';
import type { Subtask } from './models.js';

// PATTERN: Lazy-accessor logger (PRD §9.6.2 REQ-L2) — mirrors the _logger pattern
// used across the agents/ factories; defers logger construction to first use.
let _logger: ReturnType<typeof getLogger> | undefined;
const logger = () => (_logger ??= getLogger('CleanupRunner'));

/** Context handed to a cleanup runner (P3.M1.T3.S2 seam → P3.M1.T3.S3 persona). */
export interface CleanupContext {
  /** Absolute path to the session dir: `plan/{seq}_{hash}/` (or bugfix child). */
  readonly sessionPath: string;
  /** The subtask whose artifacts are being cleaned up. */
  readonly subtask: Subtask;
  /** Git repo root = `process.cwd()`. Cleanup operates at repo root. */
  readonly repoRoot: string;
}

/** Result of a cleanup run. `success:false` MUST be non-fatal to executeSubtask. */
export interface CleanupResult {
  /** Whether the cleanup completed its reorganization. */
  readonly success: boolean;
  /** Optional human-readable summary of what the cleanup did. */
  readonly summary?: string;
  /** Optional error message when `success` is `false`. */
  readonly error?: string;
}

/**
 * Injectable cleanup callable. The default is provided by
 * {@link createCleanupRunner}; callers may inject a custom one (e.g. a test spy).
 */
export type CleanupRunner = (ctx: CleanupContext) => Promise<CleanupResult>;

/**
 * Build the runtime user prompt for the cleanup agent from a
 * {@link CleanupContext}.
 *
 * @remarks
 * The cleanup job itself (remove temp, move docs to `docs/`, leave
 * `tasks.json`, forbidden paths) lives in the agent's system prompt
 * (`CLEANUP_PROMPT`, PRP P3.M1.T3.S3). This user prompt supplies the
 * subtask-specific coordinates and restates the hard rules so the agent cannot
 * misread the system prompt in isolation.
 */
function buildCleanupUserPrompt(ctx: CleanupContext): string {
  return [
    `Cleanup task for subtask ${ctx.subtask.id}: ${ctx.subtask.title}`,
    ``,
    `Repository root: ${ctx.repoRoot}`,
    `Subtask work directory (under plan/ — DO NOT TOUCH): ${ctx.sessionPath}`,
    ``,
    `Perform the cleanup job described in your system prompt:`,
    `1. Remove temporary artifacts (scratch files, transient build/test outputs).`,
    `2. Move generated documentation into docs/.`,
    `3. Leave tasks.json intact (the orchestrator saves it).`,
    ``,
    `FORBIDDEN (per PRD §5.1): do NOT rm / git rm / git clean / mv against`,
    `PRD.md, any PRP.md, or anything under plan/. Do NOT git commit or git add`,
    `(the orchestrator commits via stagecoach). If nothing needs cleanup, output`,
    `'no cleanup needed'.`,
    ``,
    `Output a one-line summary of what you did.`,
  ].join('\n');
}

/**
 * DEFAULT cleanup runner: invokes the cleanup agent persona (P3.M1.T3.S3).
 *
 * @returns A {@link CleanupRunner} that builds a user prompt from the context,
 *   calls `createCleanupAgent().prompt(...)`, and maps the agent result into a
 *   {@link CleanupResult}.
 *
 * @remarks
 * The agent is created INSIDE the returned closure (lazy, per-call) so each
 * cleanup invocation gets a fresh single-shot agent (PRD §9.3.3) and a failed
 * agent construction surfaces at cleanup time, not at pipeline boot.
 *
 * **Non-fatal**: on agent failure (`r.status === 'error'`) the runner returns
 * `{ success: false, error }`; on an unexpected throw it also returns
 * `{ success: false, error }`. P3.M1.T3.S2's `executeSubtask` additionally
 * wraps this runner in a nested try/catch that swallows any propagating throw —
 * so cleanup failure never fails the subtask (the survival commit already
 * persisted substance + status).
 *
 * Groundswell's `agent.prompt()` never throws on LLM failure — it returns
 * `{ status: 'error', error: ... }` — so the `r.status` check is the primary
 * failure path; the try/catch guards unexpected (construction/prompt-build) errors.
 */
export function createCleanupRunner(): CleanupRunner {
  return async (ctx: CleanupContext): Promise<CleanupResult> => {
    const agent = createCleanupAgent(); // lazy, per-call (single-shot)
    const prompt = createPrompt({
      user: buildCleanupUserPrompt(ctx),
      responseFormat: z.string(),
    });
    try {
      const r = await agent.prompt(prompt);
      if (r.status === 'error') {
        const msg = r.error?.message ?? 'cleanup agent returned error status';
        logger().warn(
          { error: msg, subtaskId: ctx.subtask.id },
          'Cleanup agent reported error status'
        );
        return { success: false, error: msg };
      }
      // 'success' and 'partial' both carry r.data; treat partial as a success
      // (the reorg produced a usable summary). Groundswell only sets r.data on
      // success/partial, never on error.
      const data = r.data as unknown;
      const summary =
        (typeof data === 'string' ? data : String(data ?? '')).trim() ||
        'cleanup complete';
      logger().info(
        { subtaskId: ctx.subtask.id, summary },
        'Cleanup agent succeeded'
      );
      return { success: true, summary };
    } catch (err) {
      // Unexpected (agent construction, prompt build) — non-fatal. Return rather
      // than throw so cleanup failure never fails the subtask; S2's nested
      // try/catch is the outer belt-and-suspenders guard.
      const msg = err instanceof Error ? err.message : String(err);
      logger().warn(
        { error: msg, subtaskId: ctx.subtask.id },
        'Cleanup agent threw — returning non-fatal failure'
      );
      return { success: false, error: msg };
    }
  };
}
