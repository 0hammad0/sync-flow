import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

/**
 * Three Vitest projects (Playwright runs e2e separately):
 * - unit:      pure logic in node (`*.test.ts`)
 * - unit-dom:  React components in jsdom (`*.test.tsx`)
 * - integration: route handlers and services in node, later against the
 *   Firestore emulator. Slower, so it runs as its own CI job.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', environment: 'node', include: ['tests/unit/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'unit-dom',
          environment: 'jsdom',
          include: ['tests/unit/**/*.test.tsx'],
          setupFiles: ['tests/support/setup-dom.ts'],
        },
      },
      {
        extends: true,
        test: { name: 'integration', environment: 'node', include: ['tests/integration/**/*.test.ts'] },
      },
    ],
  },
});
