import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDatabaseConfig } from '../config';

describe('Database Configuration Loader', () => {
  const originalEnv = { ...import.meta.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env
    Object.assign(import.meta.env, originalEnv);
  });

  it('reports unconfigured when VITE_SUPABASE_URL or ANON_KEY are missing', () => {
    import.meta.env.VITE_SUPABASE_URL = '';
    import.meta.env.VITE_SUPABASE_ANON_KEY = '';

    const config = getDatabaseConfig();
    expect(config.isConfigured).toBe(false);
    expect(config.validationError).toContain('Missing required environment configuration');
  });

  it('rejects placeholder URLs and tokens', () => {
    import.meta.env.VITE_SUPABASE_URL = 'https://placeholder.supabase.co';
    import.meta.env.VITE_SUPABASE_ANON_KEY = 'placeholder';

    const config = getDatabaseConfig();
    expect(config.isConfigured).toBe(false);
    expect(config.validationError).toContain('Placeholder Supabase credentials detected');
  });

  it('rejects malformed URLs', () => {
    import.meta.env.VITE_SUPABASE_URL = 'not-a-valid-url';
    import.meta.env.VITE_SUPABASE_ANON_KEY = 'some-valid-looking-key';

    const config = getDatabaseConfig();
    expect(config.isConfigured).toBe(false);
    expect(config.validationError).toContain('Malformed Supabase URL');
  });

  it('accepts valid https URL and non-placeholder anon key', () => {
    import.meta.env.VITE_SUPABASE_URL = 'https://my-project.supabase.co';
    import.meta.env.VITE_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid-jwt-token';

    const config = getDatabaseConfig();
    expect(config.isConfigured).toBe(true);
    expect(config.validationError).toBeNull();
    expect(config.supabaseUrl).toBe('https://my-project.supabase.co');
    expect(config.supabaseAnonKey).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid-jwt-token');
  });
});
