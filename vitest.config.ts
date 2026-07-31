import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Modules that need a DOM opt in per file with `@vitest-environment jsdom`.
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
  },
});
