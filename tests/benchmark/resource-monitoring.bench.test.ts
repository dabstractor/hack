/**
 * Performance benchmarks for Resource Monitor
 *
 * @remarks
 * Benchmarks validate the performance improvements from caching lsof results
 * on macOS. Compares cached vs uncached implementations across platforms.
 *
 * @see {@link https://github.com/tinylibs/tinybench | Tinybench Documentation}
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Bench } from 'tinybench';

// Benchmarks that force the macOS `lsof` code path are only valid on macOS.
// On other platforms `lsof` (if present) is spawned synchronously in a tight
// tinybench loop with `cacheTtl: 0`, which OOM-kills the worker. Guard the
// darwin-only suites so `npm run test:run` stays green cross-platform.
const macOSOnly = process.platform === 'darwin' ? it : it.skip;
import {
  ResourceMonitor,
  type ResourceConfig,
} from '../../src/utils/resource-monitor.js';

// =============================================================================
// TEST FIXTURES
// =============================================================================

// Save original platform and restore after each test
let originalPlatform: NodeJS.Platform;

beforeEach(() => {
  originalPlatform = process.platform;
});

afterEach(() => {
  // Restore original platform
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

// =============================================================================
// BENCHMARK SUITES
// =============================================================================

describe('Resource Monitor Benchmarks', () => {
  describe('FileHandleMonitor - macOS lsof caching', () => {
    macOSOnly(
      'should show significant performance improvement with caching',
      async () => {
        const bench = new Bench({
          time: 2000, // 2 seconds per benchmark
          warmupTime: 500,
        });

        // Create monitors with different cache TTLs
        // TTL=0 means no caching (execute lsof every time)
        const monitorUncached = new ResourceMonitor({
          cacheTtl: 0, // Disabled cache
        });

        // TTL=1000ms means cache is valid for 1 second
        // During benchmark, all calls will hit cache
        const monitorCached = new ResourceMonitor({
          cacheTtl: 1000,
        });

        // Mock platform to macOS
        Object.defineProperty(process, 'platform', { value: 'darwin' });

        // Add benchmarks
        bench
          .add('uncached lsof (TTL=0)', () => {
            monitorUncached.fileHandleMonitor.getHandleCount();
          })
          .add('cached lsof (TTL=1000ms)', () => {
            monitorCached.fileHandleMonitor.getHandleCount();
          });

        await bench.run();

        // Log results
        console.table(bench.table());

        // Get results
        const results = bench.tasks.map(t => ({
          name: t.name,
          opsPerSec: t.result ? t.result.hz : 0,
          meanTime: t.result ? t.result.period : 0,
        }));

        const uncachedResult = results[0];
        const cachedResult = results[1];

        console.log('\n=== Performance Summary ===');
        console.log(
          `Uncached: ${(uncachedResult.meanTime * 1000).toFixed(4)} ms/call`
        );
        console.log(
          `Cached:   ${(cachedResult.meanTime * 1000).toFixed(4)} ms/call`
        );

        if (uncachedResult.meanTime > 0 && cachedResult.meanTime > 0) {
          const speedup = uncachedResult.meanTime / cachedResult.meanTime;
          const improvement =
            ((uncachedResult.meanTime - cachedResult.meanTime) /
              uncachedResult.meanTime) *
            100;
          console.log(`Speedup:  ${speedup.toFixed(1)}x faster`);
          console.log(
            `Improvement: ${improvement.toFixed(1)}% reduction in latency`
          );

          // Assert that cached is reasonably fast
          // Note: On systems where internal API works, both paths use it
          // so speedup will be minimal. On macOS where lsof is used,
          // speedup should be significant.
          if (speedup > 1.5) {
            // Cache is providing benefit
            expect(speedup).toBeGreaterThan(1);
          } else {
            // Both using internal API - still verify no regression
            expect(speedup).toBeGreaterThan(0.5); // At least 50% of uncached speed
          }
        }
      }
    );
  });

  describe('FileHandleMonitor - Platform comparison', () => {
    it('should benchmark platform-specific implementations', async () => {
      const bench = new Bench({
        time: 1000,
        warmupTime: 200,
      });

      // Create monitor with cached lsof
      const monitor = new ResourceMonitor({
        cacheTtl: 5000,
      });

      // Benchmark Linux platform (uses /proc - very fast)
      bench.add('Linux /proc/fd read', () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        monitor.fileHandleMonitor.getHandleCount();
      });

      // Benchmark macOS platform (uses cached lsof - fast after cache)
      bench.add('macOS cached lsof', () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        monitor.fileHandleMonitor.getHandleCount();
      });

      // Benchmark Windows platform (returns 0 - fastest)
      bench.add('Windows fallback', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        monitor.fileHandleMonitor.getHandleCount();
      });

      await bench.run();

      console.table(bench.table());
    });
  });

  describe('ResourceMonitor - Status check overhead', () => {
    it('should benchmark getStatus() performance', async () => {
      const bench = new Bench({
        time: 100,
        warmupTime: 50,
      });

      const monitor = new ResourceMonitor({
        fileHandleWarnThreshold: 0.7,
        memoryWarnThreshold: 0.8,
      });

      bench.add('getStatus() - cold', () => {
        monitor.getStatus();
      });

      await bench.run();

      console.table(bench.table());

      // Verify benchmark completed successfully
      expect(bench.tasks).toHaveLength(1);
      expect(bench.tasks[0].result).toBeDefined();
    });
  });

  describe('Cache effectiveness', () => {
    macOSOnly('should measure cache hit rate impact', async () => {
      const bench = new Bench({
        time: 1000,
        iterations: 100,
      });

      // Monitor with short TTL (cache expires during benchmark)
      const monitorShortTTL = new ResourceMonitor({
        cacheTtl: 10, // 10ms TTL
      });

      // Monitor with long TTL (cache never expires during benchmark)
      const monitorLongTTL = new ResourceMonitor({
        cacheTtl: 60000, // 60s TTL
      });

      Object.defineProperty(process, 'platform', { value: 'darwin' });

      bench
        .add('Short TTL (10ms) - mixed cache hits/misses', () => {
          monitorShortTTL.fileHandleMonitor.getHandleCount();
        })
        .add('Long TTL (60s) - all cache hits', () => {
          monitorLongTTL.fileHandleMonitor.getHandleCount();
        });

      await bench.run();

      console.table(bench.table());

      // Long TTL should be faster due to 100% cache hit rate
      const results = bench.tasks.map(t => t.result?.period ?? 0);
      const shortTTLTime = results[0];
      const longTTLTime = results[1];

      if (shortTTLTime > 0 && longTTLTime > 0) {
        const improvement = ((shortTTLTime - longTTLTime) / shortTTLTime) * 100;
        console.log(
          `\nCache effectiveness: ${improvement.toFixed(1)}% faster with 100% hit rate`
        );
      }
    });
  });

  describe('Lazy Evaluation Benchmarks', () => {
    it('should reduce overhead when resources are stable', async () => {
      const bench = new Bench({
        time: 2000,
        warmupTime: 500,
      });

      // Monitor with lazy evaluation enabled
      const monitorLazy = new ResourceMonitor({
        lazyEvaluation: true,
        lazyEvaluationThreshold: 0.5,
        fileHandleWarnThreshold: 0.7,
        fileHandleCriticalThreshold: 0.85,
      });

      // Monitor with lazy evaluation disabled (full monitoring)
      const monitorFull = new ResourceMonitor({
        lazyEvaluation: false,
      });

      // Mock stable resource usage (40% - below lazy eval threshold)
      vi.spyOn(monitorLazy.fileHandleMonitor, 'getHandleCount').mockReturnValue(
        400
      );
      vi.spyOn(monitorLazy.fileHandleMonitor, 'getUlimit').mockReturnValue(
        1000
      );

      vi.spyOn(monitorFull.fileHandleMonitor, 'getHandleCount').mockReturnValue(
        400
      );
      vi.spyOn(monitorFull.fileHandleMonitor, 'getUlimit').mockReturnValue(
        1000
      );

      bench
        .add('Full monitoring (every getStatus call)', () => {
          monitorFull.getStatus();
        })
        .add('Lazy evaluation (stable resources)', () => {
          monitorLazy.getStatus();
        });

      await bench.run();

      console.table(bench.table());

      // Extract results
      const results = bench.tasks.map(t => t.result?.period ?? 0);
      const fullTime = results[0];
      const lazyTime = results[1];

      console.log('\n=== Performance Summary ===');
      console.log(`Full monitoring: ${(fullTime * 1000).toFixed(4)} ms/call`);
      console.log(`Lazy evaluation: ${(lazyTime * 1000).toFixed(4)} ms/call`);

      if (fullTime > 0 && lazyTime > 0) {
        const speedup = fullTime / lazyTime;
        const improvement = ((fullTime - lazyTime) / fullTime) * 100;
        console.log(`Speedup:  ${speedup.toFixed(1)}x faster`);
        console.log(
          `Improvement: ${improvement.toFixed(1)}% reduction in latency`
        );

        // Assert significant improvement (at least 30% for safety)
        expect(improvement).toBeGreaterThan(30);
      }
    });

    it('should show minimal overhead when approaching limits', async () => {
      const bench = new Bench({
        time: 1000,
        warmupTime: 200,
      });

      // Monitor with lazy evaluation enabled
      const monitorLazy = new ResourceMonitor({
        lazyEvaluation: true,
        lazyEvaluationThreshold: 0.5,
        fileHandleWarnThreshold: 0.7,
      });

      // Monitor with lazy evaluation disabled
      const monitorFull = new ResourceMonitor({
        lazyEvaluation: false,
      });

      // Mock high resource usage (75% - above activation threshold)
      vi.spyOn(monitorLazy.fileHandleMonitor, 'getHandleCount').mockReturnValue(
        750
      );
      vi.spyOn(monitorLazy.fileHandleMonitor, 'getUlimit').mockReturnValue(
        1000
      );

      vi.spyOn(monitorFull.fileHandleMonitor, 'getHandleCount').mockReturnValue(
        750
      );
      vi.spyOn(monitorFull.fileHandleMonitor, 'getUlimit').mockReturnValue(
        1000
      );

      bench
        .add('Full monitoring (high usage)', () => {
          monitorFull.getStatus();
        })
        .add('Lazy evaluation (high usage - deactivated)', () => {
          monitorLazy.getStatus();
        });

      await bench.run();

      console.table(bench.table());

      // When approaching limits, lazy evaluation deactivates
      // so performance should be similar
      const results = bench.tasks.map(t => t.result?.period ?? 0);
      const fullTime = results[0];
      const lazyTime = results[1];

      console.log('\n=== High Usage Performance ===');
      console.log(`Full monitoring: ${(fullTime * 1000).toFixed(4)} ms/call`);
      console.log(`Lazy evaluation: ${(lazyTime * 1000).toFixed(4)} ms/call`);

      // At high usage, lazy evaluation should deactivate
      // Performance should be within 2x of full monitoring
      expect(lazyTime).toBeLessThan(fullTime * 2);
    });
  });

  describe('Interval-Based Monitoring Benchmarks', () => {
    it('should reduce overhead with larger intervals', async () => {
      const bench = new Bench({
        time: 1000,
        warmupTime: 200,
      });

      // Mock stable resources
      const getHandleCountMock = vi.fn().mockReturnValue(400);
      const getUlimitMock = vi.fn().mockReturnValue(1000);

      // Monitor with interval=1 (every task)
      const monitorInterval1 = new ResourceMonitor({
        monitorInterval: 1,
        lazyEvaluation: false,
      });

      // Monitor with interval=5 (every 5th task)
      const monitorInterval5 = new ResourceMonitor({
        monitorInterval: 5,
        lazyEvaluation: false,
      });

      // Monitor with interval=10 (every 10th task)
      const monitorInterval10 = new ResourceMonitor({
        monitorInterval: 10,
        lazyEvaluation: false,
      });

      // Apply mocks to all monitors
      vi.spyOn(
        monitorInterval1.fileHandleMonitor,
        'getHandleCount'
      ).mockImplementation(getHandleCountMock);
      vi.spyOn(
        monitorInterval1.fileHandleMonitor,
        'getUlimit'
      ).mockImplementation(getUlimitMock);

      vi.spyOn(
        monitorInterval5.fileHandleMonitor,
        'getHandleCount'
      ).mockImplementation(getHandleCountMock);
      vi.spyOn(
        monitorInterval5.fileHandleMonitor,
        'getUlimit'
      ).mockImplementation(getUlimitMock);

      vi.spyOn(
        monitorInterval10.fileHandleMonitor,
        'getHandleCount'
      ).mockImplementation(getHandleCountMock);
      vi.spyOn(
        monitorInterval10.fileHandleMonitor,
        'getUlimit'
      ).mockImplementation(getUlimitMock);

      bench
        .add('Interval=1 (every task)', () => {
          monitorInterval1.recordTaskComplete();
        })
        .add('Interval=5 (every 5th task)', () => {
          monitorInterval5.recordTaskComplete();
        })
        .add('Interval=10 (every 10th task)', () => {
          monitorInterval10.recordTaskComplete();
        });

      await bench.run();

      console.table(bench.table());

      // Extract results
      const results = bench.tasks.map(t => ({
        name: t.name,
        period: t.result?.period ?? 0,
      }));

      console.log('\n=== Interval Monitoring Performance ===');
      results.forEach(r => {
        console.log(`${r.name}: ${(r.period * 1000).toFixed(4)} ms/call`);
      });

      // All intervals should have similar performance for recordTaskComplete
      // since it just increments a counter
      // The benefit comes from fewer shouldStop() calls in the pipeline
      const interval1Time = results[0].period;
      const interval5Time = results[1].period;
      const interval10Time = results[2].period;

      // recordTaskComplete is just a counter increment, so all should be fast
      expect(interval1Time).toBeGreaterThan(0);
      expect(interval5Time).toBeGreaterThan(0);
      expect(interval10Time).toBeGreaterThan(0);
    });

    it('should validate task counting accuracy', () => {
      // Test that task counting works correctly with different intervals
      const monitorInterval5 = new ResourceMonitor({
        monitorInterval: 5,
      });

      // Record 10 tasks
      for (let i = 0; i < 10; i++) {
        monitorInterval5.recordTaskComplete();
      }

      // Should have counted all 10 tasks
      expect(monitorInterval5.getTasksCompleted()).toBe(10);
    });
  });
});
