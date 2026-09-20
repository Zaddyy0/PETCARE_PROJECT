import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    /**
     * Integration tests share one in-memory MongoDB instance, so they must not
     * run in parallel against the same collections. Unit tests are unaffected
     * by this and still run fast.
     */
    fileParallelism: false,
    /* Spinning up mongodb-memory-server the first time downloads a binary. */
    testTimeout: 30_000,
    hookTimeout: 120_000,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types/**', 'src/index.ts'],
    },
  },
});
