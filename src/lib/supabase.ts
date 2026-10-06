import { dbClient, getSupabaseClient } from '@/database';

/**
 * Legacy Supabase client export.
 * Delegates directly to the typed, validated database client.
 * Does not use artificial placeholder fallbacks.
 */
export const supabase = dbClient;
export { getSupabaseClient };
