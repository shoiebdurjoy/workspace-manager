import { getSupabaseClient } from './client';
import { HierarchySpace } from '@/types/database';
import { toDatabaseError, ValidationError } from './errors';
import { mapFolderRow, mapListRow, mapSpaceRow } from './hierarchy-mappers';
import { assembleHierarchy } from '@/lib/hierarchy';

/**
 * Loads the navigation tree of a workspace (Spaces -> Folders -> Lists) in ONE parallel
 * round-trip: three flat, workspace-filtered queries that hit the (workspace_id) indexes and
 * select only the columns the sidebar needs, assembled in memory. RLS decides what the caller
 * can see; there is no per-space (N+1) querying.
 */
export async function getWorkspaceHierarchy(workspaceId: string): Promise<HierarchySpace[]> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');

  const client = getSupabaseClient();
  const [spaces, folders, lists] = await Promise.all([
    client
      .from('spaces')
      .select('id, workspace_id, name, slug, description, icon, color, is_private, position, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true })
      .order('name', { ascending: true }),
    client
      .from('folders')
      .select('id, workspace_id, space_id, name, description, position, is_collapsed_default, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true })
      .order('name', { ascending: true }),
    client
      .from('lists')
      .select('id, workspace_id, space_id, folder_id, name, description, color, position, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true })
      .order('name', { ascending: true }),
  ]);

  if (spaces.error) throw toDatabaseError('load spaces', spaces.error);
  if (folders.error) throw toDatabaseError('load folders', folders.error);
  if (lists.error) throw toDatabaseError('load lists', lists.error);

  return assembleHierarchy(
    (spaces.data ?? []).map(mapSpaceRow),
    (folders.data ?? []).map(mapFolderRow),
    (lists.data ?? []).map(mapListRow)
  );
}

export type HierarchyKind = 'space' | 'folder' | 'list';

/**
 * Re-sequences siblings atomically (migration 6). `orderedIds` must be ALL siblings in the
 * desired order. The database applies the caller's own RLS and refuses partial results.
 */
export async function reorderHierarchy(kind: HierarchyKind, orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  const { error } = await getSupabaseClient().rpc('reorder_hierarchy', { kind, ids: orderedIds });
  if (error) throw toDatabaseError('reorder these items', error);
}
