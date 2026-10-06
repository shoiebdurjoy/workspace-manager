import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/database.types';
import { getDatabaseConfig } from './config';
import { ConfigurationError } from './errors';

let clientInstance: SupabaseClient<Database> | null = null;

/**
 * Returns the typed Supabase client instance.
 * Throws a ConfigurationError if environment configuration is absent or invalid.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (clientInstance) {
    return clientInstance;
  }

  const config = getDatabaseConfig();
  if (!config.isConfigured) {
    throw new ConfigurationError(
      config.validationError || 'Database is not properly configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
    );
  }

  clientInstance = createClient<Database>(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // PKCE per docs/TBB_ARCHITECTURE_PROPOSAL.md 4.1
      flowType: 'pkce',
    },
  });

  return clientInstance;
}

/**
 * Direct reference to the Supabase client.
 * Uses a Proxy to throw a descriptive ConfigurationError when accessed if not configured,
 * preventing silent crashes or false-positive initialization.
 */
export const dbClient: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    const client = getSupabaseClient();
    const val = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof val === 'function') {
      return val.bind(client);
    }
    return val;
  },
});
