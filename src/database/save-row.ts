import { getSupabaseClient } from './client';

/**
 * Saves one row: updates it when it exists, inserts it otherwise. Used instead of an "upsert", which the database
 * refuses on tables whose key columns may not be updated (only the value columns carry an UPDATE grant).
 */
export async function saveRow(table: string, keys: Record<string, unknown>, values: Record<string, unknown>): Promise<{ message: string; code?: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseClient() as unknown as { from: (t: string) => any };
  let q = db.from(table).update(values);
  for (const [k, v] of Object.entries(keys)) q = q.eq(k, v);
  const updated = await q.select(Object.keys(keys)[0]);
  if (updated.error) return updated.error;
  if ((updated.data ?? []).length > 0) return null;
  const inserted = await db.from(table).insert({ ...keys, ...values });
  return inserted.error ?? null;
}
