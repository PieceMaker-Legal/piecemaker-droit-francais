import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['src/tests/**/*.test.ts'],
    environment: 'node',
  },
});
