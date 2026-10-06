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
        'src/lib/app-url.ts',
        'src/lib/auth-callback.ts',
        'src/lib/hierarchy.ts',
        'src/database/spaces.ts',
        'src/database/folders.ts',
        'src/database/lists.ts',
        'src/database/hierarchy.ts',
        'src/hooks/use-hierarchy.ts',
        'src/hooks/use-expanded-nodes.ts',
        'src/components/hierarchy/*.tsx',
        'src/context/AuthProvider.tsx',
        'src/components/auth/ProtectedRoute.tsx',
        'src/components/auth/Can.tsx',
        'src/database/teams.ts',
        'src/database/invitations.ts',
        'src/database/errors.ts',
        'src/database/health.ts',
        // Phase 6: task engine
        'src/lib/tasks.ts',
        'src/database/tasks.ts',
        'src/database/task-mappers.ts',
        'src/hooks/use-tasks.ts',
        'src/components/tasks/*.tsx',
        'src/pages/TaskRedirect.tsx',
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
