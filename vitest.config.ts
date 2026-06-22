/**
 * Vitest configuration for hacky-hack project
 *
 * @remarks
 * Configures Vitest for ESM TypeScript testing with v8 coverage provider.
 * Enforces 100% code coverage thresholds for all source files.
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
    exclude: ['**/dist/**', '**/node_modules/**'],
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
      thresholds: {
        global: {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
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
