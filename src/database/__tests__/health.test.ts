import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkDatabaseHealth } from '../health';

describe('Database Health Check Service', () => {
  const originalEnv = { ...import.meta.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(import.meta.env, originalEnv);
  });

  it('accurately identifies an unconfigured environment when credentials are empty', async () => {
    import.meta.env.VITE_SUPABASE_URL = '';
    import.meta.env.VITE_SUPABASE_ANON_KEY = '';

    const report = await checkDatabaseHealth();
    expect(report.status).toBe('unconfigured');
    expect(report.isConfigured).toBe(false);
    expect(report.isReachable).toBe(false);
    expect(report.message).toContain('Missing required environment configuration');
  });

  it('accurately identifies placeholder credentials as unconfigured', async () => {
    import.meta.env.VITE_SUPABASE_URL = 'https://placeholder.supabase.co';
    import.meta.env.VITE_SUPABASE_ANON_KEY = 'placeholder';

    const report = await checkDatabaseHealth();
    expect(report.status).toBe('unconfigured');
    expect(report.isConfigured).toBe(false);
    expect(report.isReachable).toBe(false);
    expect(report.message).toContain('Placeholder Supabase credentials detected');
  });

  it('accurately identifies an unreachable endpoint without faking success', async () => {
    // Set a syntactically valid URL that is unreachable (NXDOMAIN)
    import.meta.env.VITE_SUPABASE_URL = 'https://unreachable-test-project-999.supabase.co';
    import.meta.env.VITE_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy';

    const report = await checkDatabaseHealth();
    expect(report.status).toBe('unreachable');
    expect(report.isConfigured).toBe(true);
    expect(report.isReachable).toBe(false);
    expect(report.endpoint).toBe('https://unreachable-test-project-999.supabase.co');
  });
});
