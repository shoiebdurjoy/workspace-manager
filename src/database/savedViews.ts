import { getSupabaseClient } from './client';
import { ValidationError, toDatabaseError } from './errors';

/** Saved views (migration 32): filters + grouping + sort (the URL query) and the layout, per list / Everything / My Tasks. */
export type ViewLayout = 'list' | 'board' | 'table';

export interface SavedView {
  id: string;
  ownerId: string | null;
  scope: string;
  name: string;
  query: string;
  mode: ViewLayout;
  isShared: boolean;
  isDefault: boolean;
}

// the generated types predate migration 32
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseClient() as unknown as { from: (table: string) => any };

type Row = { id: string; owner_id: string | null; scope: string; name: string; query: string; mode: ViewLayout; is_shared: boolean; is_default: boolean };
const map = (r: Row): SavedView => ({ id: r.id, ownerId: r.owner_id, scope: r.scope, name: r.name, query: r.query, mode: r.mode, isShared: r.is_shared, isDefault: r.is_default });

export async function listSavedViews(workspaceId: string, scope: string): Promise<SavedView[]> {
  const { data, error } = await db().from('saved_views').select('*').eq('workspace_id', workspaceId).eq('scope', scope).order('is_shared', { ascending: false }).order('created_at');
  if (error) throw toDatabaseError('load the saved views', error);
  return ((data ?? []) as Row[]).map(map);
}

export async function createSavedView(workspaceId: string, v: Omit<SavedView, 'id' | 'ownerId'>): Promise<void> {
  if (!v.name.trim()) throw new ValidationError('Give the view a name.');
  const { error } = await db()
    .from('saved_views')
    .insert({ workspace_id: workspaceId, scope: v.scope, name: v.name.trim(), query: v.query, mode: v.mode, is_shared: v.isShared, is_default: v.isDefault });
  if (error) throw toDatabaseError('save the view', error);
}

export async function updateSavedView(id: string, patch: Partial<Pick<SavedView, 'name' | 'query' | 'mode' | 'isDefault'>>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.query !== undefined) row.query = patch.query;
  if (patch.mode !== undefined) row.mode = patch.mode;
  if (patch.isDefault !== undefined) row.is_default = patch.isDefault;
  const { error } = await db().from('saved_views').update(row).eq('id', id);
  if (error) throw toDatabaseError('change the view', error);
}

export async function deleteSavedView(id: string): Promise<void> {
  const { error } = await db().from('saved_views').delete().eq('id', id);
  if (error) throw toDatabaseError('delete the view', error);
}

/** The view to open when someone arrives without filters: their own default, else the team's. */
export function pickDefaultView(views: readonly SavedView[], me: string | null): SavedView | null {
  return views.find((v) => v.isDefault && !v.isShared && v.ownerId === me) ?? views.find((v) => v.isDefault && v.isShared) ?? null;
}

/** Same filters regardless of parameter order. */
export function sameQuery(a: string, b: string): boolean {
  const norm = (q: string) => [...new URLSearchParams(q).entries()].map(([k, v]) => `${k}=${v}`).sort().join('&');
  return norm(a) === norm(b);
}
