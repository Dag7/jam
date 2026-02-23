import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['electron/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['electron/**/*.ts'],
      exclude: ['electron/main.ts', 'electron/preload.ts', 'electron/**/*.test.ts'],
    },
  },
});
