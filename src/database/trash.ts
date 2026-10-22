import { getSupabaseClient } from './client';
import { toDatabaseError } from './errors';

/** The trash (migration 39): what was deleted, by whom and when, grouped by the action that deleted it. */
export interface TrashBatch {
  batch: string;
  main: { table: string; label: string };
  parts: Record<string, number>;
  deletedBy: string | null;
  deletedAt: string;
  restored: boolean;
}

// the generated types predate migration 39
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseClient() as unknown as { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

const RANK = ['spaces', 'folders', 'lists', 'tasks', 'custom_fields', 'tags', 'automations', 'brief_forms', 'saved_views', 'task_comments', 'task_attachments', 'subtasks', 'time_entries'];

export async function listTrash(workspaceId: string): Promise<TrashBatch[]> {
  const { data, error } = await db()
    .from('trash_items')
    .select('batch,table_name,label,deleted_by,deleted_at,restored_at')
    .eq('workspace_id', workspaceId)
    .order('deleted_at', { ascending: false })
    .limit(2000);
  if (error) throw toDatabaseError('load the trash', error);
  const out = new Map<string, TrashBatch & { rank: number }>();
  for (const r of (data ?? []) as { batch: number | string; table_name: string; label: string | null; deleted_by: string | null; deleted_at: string; restored_at: string | null }[]) {
    const key = String(r.batch);
    const rank = RANK.indexOf(r.table_name) === -1 ? 99 : RANK.indexOf(r.table_name);
    const b = out.get(key) ?? { batch: key, main: { table: r.table_name, label: r.label ?? '' }, parts: {}, deletedBy: r.deleted_by, deletedAt: r.deleted_at, restored: !!r.restored_at, rank };
    b.parts[r.table_name] = (b.parts[r.table_name] ?? 0) + 1;
    if (rank < b.rank) {
      b.rank = rank;
      b.main = { table: r.table_name, label: r.label ?? '' };
    }
    b.restored = b.restored && !!r.restored_at;
    out.set(key, b);
  }
  return [...out.values()].map(({ rank: _r, ...b }) => b);
}

export async function restoreTrash(workspaceId: string, batch: string): Promise<{ restored: number; skipped: number }> {
  const { data, error } = await db().rpc('restore_trash_batch', { p_batch: batch, p_workspace_id: workspaceId });
  if (error) throw toDatabaseError('restore', error);
  return data as { restored: number; skipped: number };
}
