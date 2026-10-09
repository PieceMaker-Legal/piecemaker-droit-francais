import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'server', environment: 'node', include: ['src/tests/**/*.test.ts'], exclude: ['src/tests/templates-ui.test.ts'] } },
      { test: { name: 'client', environment: 'jsdom', include: ['src/tests/templates-ui.test.ts'] } },
    ],
  },
});
