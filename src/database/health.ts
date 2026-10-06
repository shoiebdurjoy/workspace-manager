import { getDatabaseConfig } from './config';
import { getSupabaseClient } from './client';

export type HealthStatus = 'unconfigured' | 'unreachable' | 'healthy' | 'schema_mismatch';

export interface DatabaseHealthReport {
  status: HealthStatus;
  isConfigured: boolean;
  isReachable: boolean;
  responseTimeMs?: number;
  message: string;
  endpoint?: string;
  error?: string;
  checkedAt: string;
  schemaDetails?: {
    workspacesTable: boolean;
    spacesTable: boolean;
    profilesTable: boolean;
  };
}

export type TableProbeResult = 'present' | 'missing' | 'failed';

/**
 * Classifies the outcome of a `select id limit 1` probe on one table.
 *
 * - No error                         -> present (the caller can read it)
 * - 42501 permission denied          -> present. The table exists and is protected
 *                                       by grants/RLS; a signed-out request is
 *                                       SUPPOSED to be refused. That is the security
 *                                       model working, not an outage.
 * - 42P01 / PGRST205 undefined table -> missing (migrations not applied)
 * - anything else (network, 5xx...)  -> failed
 */
export function classifyTableProbe(error: { code?: string } | null): TableProbeResult {
  if (!error) return 'present';
  if (error.code === '42501') return 'present';
  if (error.code === '42P01' || error.code === 'PGRST205') return 'missing';
  return 'failed';
}

/**
 * Executes a live health check probe against the database.
 * Distinguishes unconfigured, unreachable, schema mismatch, and healthy states.
 * Never reports 'healthy' merely because configuration strings are present, and
 * never needs (or asks for) anonymous read access to application data.
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealthReport> {
  const checkedAt = new Date().toISOString();
  const config = getDatabaseConfig();

  if (!config.isConfigured) {
    return {
      status: 'unconfigured',
      isConfigured: false,
      isReachable: false,
      message: config.validationError || 'Database configuration is missing or invalid.',
      checkedAt,
    };
  }

  const startTime = Date.now();

  try {
    const client = getSupabaseClient();

    const [ws, spaces, profiles] = await Promise.all([
      client.from('workspaces').select('id').limit(1),
      client.from('spaces').select('id').limit(1),
      client.from('profiles').select('id').limit(1),
    ]);

    const responseTimeMs = Date.now() - startTime;
    const errors = [ws.error, spaces.error, profiles.error];
    const results = {
      workspacesTable: classifyTableProbe(ws.error),
      spacesTable: classifyTableProbe(spaces.error),
      profilesTable: classifyTableProbe(profiles.error),
    };
    const schemaDetails = {
      workspacesTable: results.workspacesTable === 'present',
      spacesTable: results.spacesTable === 'present',
      profilesTable: results.profilesTable === 'present',
    };

    const failedError = errors.find((e) => e && classifyTableProbe(e) === 'failed');
    if (failedError) {
      return {
        status: 'unreachable',
        isConfigured: true,
        isReachable: false,
        responseTimeMs,
        message: `Database unreachable or request failed: ${failedError.message}`,
        endpoint: config.supabaseUrl,
        error: failedError.message,
        checkedAt,
      };
    }

    if (Object.values(results).includes('missing')) {
      return {
        status: 'schema_mismatch',
        isConfigured: true,
        isReachable: true,
        responseTimeMs,
        message: 'Connected to database, but core schema tables are missing. Migrations need to be run.',
        endpoint: config.supabaseUrl,
        checkedAt,
        schemaDetails,
      };
    }

    const protectedByRls = errors.some((e) => e?.code === '42501');
    return {
      status: 'healthy',
      isConfigured: true,
      isReachable: true,
      responseTimeMs,
      message: protectedByRls
        ? 'Database is reachable and the core schema is present. Tables are protected; data is only readable when signed in.'
        : 'Database is reachable and responsive with core schema present.',
      endpoint: config.supabaseUrl,
      checkedAt,
      schemaDetails,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      status: 'unreachable',
      isConfigured: true,
      isReachable: false,
      responseTimeMs: Date.now() - startTime,
      message: `Database connection probe failed: ${errorMessage}`,
      endpoint: config.supabaseUrl,
      error: errorMessage,
      checkedAt,
    };
  }
}
