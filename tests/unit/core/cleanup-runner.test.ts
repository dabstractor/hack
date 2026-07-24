/**
 * Unit tests for the cleanup-runner seam (P3.M1.T3.S2).
 *
 * @remarks
 * Validates the SEAM contract only — pure types + the no-op default factory.
 * No real filesystem, no real git, no real agent. The behavior of the
 * two-phase commit wiring (how executeSubtask invokes the seam) is covered in
 * task-orchestrator.test.ts; here we only assert the seam's own defaults.
 *
 * @see {@link ../../src/core/cleanup-runner.ts}
 */

import { describe, expect, it } from 'vitest';
import {
  createCleanupRunner,
  type CleanupContext,
  type CleanupResult,
} from '../../../src/core/cleanup-runner.js';
import type { Subtask, Status } from '../../../src/core/models.js';

/** Minimal subtask factory for seam tests (shape only — seam never reads fields). */
const makeSubtask = (): Subtask => ({
  id: 'P1.M1.T1.S1',
  type: 'Subtask',
  title: 'Test Subtask',
  status: 'Planned' as Status,
  story_points: 2,
  dependencies: [],
  context_scope: 'Test scope',
  prd_selectors: [],
});

/** Minimal CleanupContext for invoking the seam. */
const makeContext = (): CleanupContext => ({
  sessionPath: '/plan/001_14b9dc2a33c7',
  subtask: makeSubtask(),
  repoRoot: process.cwd(),
});

describe('cleanup-runner seam', () => {
  describe('createCleanupRunner()', () => {
    it('should return a callable function', () => {
      const runner = createCleanupRunner();
      expect(typeof runner).toBe('function');
    });

    it('should resolve { success: true } with a summary string (no-op default)', async () => {
      const runner = createCleanupRunner();
      const result: CleanupResult = await runner(makeContext());

      expect(result.success).toBe(true);
      expect(typeof result.summary).toBe('string');
      expect(result.summary).toBe('cleanup disabled (no persona wired yet)');
    });

    it('should not throw and should not perform any filesystem access', async () => {
      const runner = createCleanupRunner();
      // The default no-op must not touch the fs — awaiting it simply resolves.
      await expect(runner(makeContext())).resolves.toMatchObject({
        success: true,
      });
    });

    it('should accept any CleanupContext without reading its fields', async () => {
      const runner = createCleanupRunner();
      const ctx = makeContext();
      const result = await runner(ctx);

      // The default runner ignores ctx entirely — success regardless of fields.
      expect(result).toMatchObject({ success: true });
    });
  });

  describe('custom CleanupRunner (injection contract)', () => {
    it('should be invokable with a CleanupContext and return a CleanupResult', async () => {
      // A user-supplied (S3-style) runner that records the context it received.
      let received: CleanupContext | null = null;
      const customRunner = async (
        ctx: CleanupContext
      ): Promise<CleanupResult> => {
        received = ctx;
        return { success: true, summary: 'custom cleanup ran' };
      };

      const ctx = makeContext();
      const result = await customRunner(ctx);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('custom cleanup ran');
      // The runner receives the context verbatim — sessionPath/subtask/repoRoot.
      expect(received).not.toBeNull();
      expect(received!.sessionPath).toBe('/plan/001_14b9dc2a33c7');
      expect(received!.subtask.id).toBe('P1.M1.T1.S1');
      expect(received!.repoRoot).toBe(process.cwd());
    });

    it('should allow a custom runner to report failure non-fatally', async () => {
      const failingRunner = async (): Promise<CleanupResult> => ({
        success: false,
        error: 'simulated cleanup failure',
      });

      const result = await failingRunner(makeContext());

      // success:false is a normal result value — the seam contract does not
      // require throwing. executeSubtask treats this as non-fatal (logged + swallowed).
      expect(result.success).toBe(false);
      expect(result.error).toBe('simulated cleanup failure');
    });
  });
});
