/**
 * Vitest configuration for benchmark suites only.
 *
 * @remarks
 * The default vitest config excludes benchmark test files because
 * tinybench loops are slow, memory-heavy, and the macOS `lsof` code path can
 * OOM-kill a worker on non-macOS hosts. This config re-includes them so
 * `npm run bench` can run the suites on demand without polluting the default
 * `npm test` gate.
 *
 * @see https://vitest.dev/guide/browser/config.html
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/benchmark/**/*.bench.test.ts'],
    // Benchmarks are long-running; a single fork keeps memory bounded and
    // avoids cross-suite interference in the timings.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true, memoryLimit: 4096 },
    },
  },
  esbuild: {
    target: 'esnext',
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    },
  },
});
