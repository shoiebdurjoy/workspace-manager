import { getSupabaseClient } from './client';
import { Folder } from '@/types/database';
import { toDatabaseError, ValidationError } from './errors';
import { mapFolderRow } from './hierarchy-mappers';
import { validateDescription, validateHierarchyName } from '@/lib/hierarchy';

export interface FolderInput {
  name: string;
  description?: string | null;
}

function validateFolderInput(input: Partial<FolderInput>, requireName: boolean): void {
  if (requireName || input.name !== undefined) {
    const message = validateHierarchyName(input.name ?? '', 'folder');
    if (message) throw new ValidationError(message);
  }
  if (input.description !== undefined && input.description !== null) {
    const message = validateDescription(input.description);
    if (message) throw new ValidationError(message);
  }
}

export async function createFolder(input: FolderInput & { spaceId: string; position: number }): Promise<Folder> {
  if (!input.spaceId) throw new ValidationError('Space ID is required.');
  validateFolderInput(input, true);

  const { data, error } = await getSupabaseClient()
    .from('folders')
    .insert({
      space_id: input.spaceId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      position: input.position,
    })
    .select('*')
    .single();
  if (error) throw toDatabaseError('create the folder', error);
  return mapFolderRow(data);
}

export async function updateFolder(folderId: string, updates: Partial<FolderInput>): Promise<Folder> {
  if (!folderId) throw new ValidationError('Folder ID is required.');
  validateFolderInput(updates, false);

  const dbUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name.trim();
  if (updates.description !== undefined) dbUpdates.description = updates.description?.trim() || null;

  const { data, error } = await getSupabaseClient()
    .from('folders')
    .update(dbUpdates)
    .eq('id', folderId)
    .select('*')
    .maybeSingle();
  if (error) throw toDatabaseError('edit the folder', error);
  if (!data) throw toDatabaseError('edit the folder', { code: '42501', message: 'no rows updated' });
  return mapFolderRow(data);
}

/**
 * A folder that still contains lists cannot be deleted: the database refuses so lists are never
 * silently orphaned or destroyed. Move or delete the lists first.
 */
export async function deleteFolder(folderId: string): Promise<void> {
  if (!folderId) throw new ValidationError('Folder ID is required.');
  const { data, error } = await getSupabaseClient().from('folders').delete().eq('id', folderId).select('id');
  if (error) {
    if (error.code === '23503') {
      throw new ValidationError('This folder still contains lists. Move or delete its lists first.', error);
    }
    throw toDatabaseError('delete the folder', error);
  }
  if (!data || data.length === 0) throw toDatabaseError('delete the folder', { code: '42501', message: 'no rows deleted' });
}
