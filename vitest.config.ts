/**
 * Vitest configuration for hacky-hack project
 *
 * @remarks
 * Configures Vitest for ESM TypeScript testing with v8 coverage provider.
 * Enforces a coverage regression floor for all source files.
 *
 * @see https://vitest.dev/config/
 */

import os from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.{test,spec}.ts'],
    // Exclude benchmark suites from the default test run: tinybench loops
    // are slow and memory-heavy, and the macOS `lsof` code path can OOM-kill
    // a worker on non-macOS hosts. Run them on demand via `npm run bench`.
    exclude: ['**/dist/**', '**/node_modules/**', '**/*.bench.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Pool configuration to prevent OOM on large test files
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: Math.min(os.cpus().length, 4),
        memoryLimit: 4096,
      },
    },
    deps: {
      interopDefault: true,
    },
    fs: {
      allow: ['.', '..'],
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**'],
      // NOTE: vitest 1.6.x reads the FLAT threshold keys (statements/branches/
      // functions/lines directly on `thresholds`). The `thresholds.global`
      // nesting is a vitest 2.x shape that 1.6 silently ignores — `global`
      // is then treated as a glob pattern and the real (flat) global keys are
      // all undefined, so `checkThresholds` early-returns and the gate is a
      // no-op. Use the flat form here so the gate actually fires.
      //
      // These are deliberately set BELOW current actual coverage (~90%) to
      // act as a REGRESSION FLOOR (catch drops) rather than an aspirational
      // 100% target that would immediately fail the build. Raise the floors
      // as coverage improves; do not remove them.
      thresholds: {
        statements: 89,
        branches: 90,
        functions: 94,
        lines: 89,
      },
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
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      '#': new URL('./src/agents', import.meta.url).pathname,
      groundswell: new URL('../groundswell/dist/index.js', import.meta.url)
        .pathname,
    },
    extensions: ['.ts', '.js', '.tsx'],
  },
});
