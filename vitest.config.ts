import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@hrbot/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/**/*.test.ts',
      'apps/bot/**/*.test.ts',
      'apps/dashboard/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
  },
});

