import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    // Database/unit tests run in node; component tests (*.test.tsx) need a DOM.
    environment: 'node',
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text'],
      // Quality gate: >= 85% on new utility/service code (docs/TBB_TESTING_STRATEGY.md 3)
      include: [
        'src/lib/permissions.ts',
        'src/lib/auth-errors.ts',
        'src/lib/redirect.ts',
        'src/lib/slug.ts',
        'src/context/AuthProvider.tsx',
        'src/components/auth/ProtectedRoute.tsx',
        'src/components/auth/Can.tsx',
        'src/database/teams.ts',
        'src/database/invitations.ts',
        'src/database/errors.ts',
        'src/database/health.ts',
      ],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 75 },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
