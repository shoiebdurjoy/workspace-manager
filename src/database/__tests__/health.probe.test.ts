import { describe, it, expect, vi, beforeEach } from 'vitest';

type ProbeError = { code?: string; message: string } | null;
const responses: Record<string, ProbeError> = {};

vi.mock('../client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => ({
      select: () => ({
        limit: () => Promise.resolve({ data: [], error: responses[table] ?? null }),
      }),
    }),
  }),
}));

import { checkDatabaseHealth, classifyTableProbe } from '../health';

const PERMISSION_DENIED = { code: '42501', message: 'permission denied for table workspaces' };
const MISSING_PG = { code: '42P01', message: 'relation "public.workspaces" does not exist' };
const MISSING_REST = { code: 'PGRST205', message: 'Could not find the table public.workspaces in the schema cache' };

describe('classifyTableProbe', () => {
  it('treats no error as present', () => {
    expect(classifyTableProbe(null)).toBe('present');
  });
  it('treats 42501 permission denied as present (table exists, RLS is working)', () => {
    expect(classifyTableProbe({ code: '42501' })).toBe('present');
  });
  it('treats undefined-table errors as missing', () => {
    expect(classifyTableProbe({ code: '42P01' })).toBe('missing');
    expect(classifyTableProbe({ code: 'PGRST205' })).toBe('missing');
  });
  it('treats anything else as failed', () => {
    expect(classifyTableProbe({ code: '08006' })).toBe('failed');
    expect(classifyTableProbe({})).toBe('failed');
  });
});

describe('checkDatabaseHealth with a signed-out (anon) client', () => {
  beforeEach(() => {
    for (const k of Object.keys(responses)) delete responses[k];
    import.meta.env.VITE_SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co';
    import.meta.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test_key_value_0000000000';
  });

  it('reports healthy when every protected table answers 42501', async () => {
    responses.workspaces = PERMISSION_DENIED;
    responses.spaces = { ...PERMISSION_DENIED, message: 'permission denied for table spaces' };
    responses.profiles = { ...PERMISSION_DENIED, message: 'permission denied for table profiles' };

    const report = await checkDatabaseHealth();
    expect(report.status).toBe('healthy');
    expect(report.isReachable).toBe(true);
    expect(report.schemaDetails).toEqual({ workspacesTable: true, spacesTable: true, profilesTable: true });
    expect(report.message).toContain('protected');
  });

  it('reports healthy when tables are directly readable (signed-in user)', async () => {
    const report = await checkDatabaseHealth();
    expect(report.status).toBe('healthy');
  });

  it('reports schema_mismatch when a table is missing (PostgREST or Postgres code)', async () => {
    responses.workspaces = MISSING_REST;
    expect((await checkDatabaseHealth()).status).toBe('schema_mismatch');

    responses.workspaces = MISSING_PG;
    const report = await checkDatabaseHealth();
    expect(report.status).toBe('schema_mismatch');
    expect(report.schemaDetails?.workspacesTable).toBe(false);
    expect(report.isReachable).toBe(true);
  });

  it('still reports unreachable for genuine failures, even if other tables answer 42501', async () => {
    responses.workspaces = PERMISSION_DENIED;
    responses.spaces = { message: 'Failed to fetch' };

    const report = await checkDatabaseHealth();
    expect(report.status).toBe('unreachable');
    expect(report.isReachable).toBe(false);
    expect(report.error).toBe('Failed to fetch');
  });
});
