import { getSupabaseClient } from './client';
import { List } from '@/types/database';
import { toDatabaseError, ValidationError } from './errors';
import { mapListRow } from './hierarchy-mappers';
import { DEFAULT_COLOR, isValidColor, validateDescription, validateHierarchyName } from '@/lib/hierarchy';

export interface ListInput {
  name: string;
  description?: string | null;
  color?: string;
  /** Parent folder inside the same space, or null for a list directly in the space. */
  folderId?: string | null;
}

function validateListInput(input: Partial<ListInput>, requireName: boolean): void {
  if (requireName || input.name !== undefined) {
    const message = validateHierarchyName(input.name ?? '', 'list');
    if (message) throw new ValidationError(message);
  }
  if (input.description !== undefined && input.description !== null) {
    const message = validateDescription(input.description);
    if (message) throw new ValidationError(message);
  }
  if (input.color !== undefined && !isValidColor(input.color)) throw new ValidationError('Choose a valid color.');
}

function mapListError(action: string, error: { code?: string; message: string }) {
  // The composite foreign key (folder_id, space_id) rejects a folder from another space.
  if (error.code === '23503') {
    return new ValidationError('That folder does not belong to this space.', error);
  }
  return toDatabaseError(action, error);
}

export async function createList(input: ListInput & { spaceId: string; position: number }): Promise<List> {
  if (!input.spaceId) throw new ValidationError('Space ID is required.');
  validateListInput(input, true);

  const { data, error } = await getSupabaseClient()
    .from('lists')
    .insert({
      space_id: input.spaceId,
      folder_id: input.folderId ?? null,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      color: input.color ?? DEFAULT_COLOR,
      position: input.position,
    })
    .select('*')
    .single();
  if (error) throw mapListError('create the list', error);
  return mapListRow(data);
}

/**
 * `position` is only set together with a folder change (append to the new parent); ordinary
 * ordering goes through reorderHierarchy so it stays atomic.
 */
export async function updateList(
  listId: string,
  updates: Partial<ListInput> & { position?: number }
): Promise<List> {
  if (!listId) throw new ValidationError('List ID is required.');
  validateListInput(updates, false);

  const dbUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name.trim();
  if (updates.description !== undefined) dbUpdates.description = updates.description?.trim() || null;
  if (updates.color !== undefined) dbUpdates.color = updates.color;
  if (updates.folderId !== undefined) dbUpdates.folder_id = updates.folderId;
  if (updates.position !== undefined) dbUpdates.position = updates.position;

  const { data, error } = await getSupabaseClient()
    .from('lists')
    .update(dbUpdates)
    .eq('id', listId)
    .select('*')
    .maybeSingle();
  if (error) throw mapListError('edit the list', error);
  if (!data) throw toDatabaseError('edit the list', { code: '42501', message: 'no rows updated' });
  return mapListRow(data);
}

export async function deleteList(listId: string): Promise<void> {
  if (!listId) throw new ValidationError('List ID is required.');
  const { data, error } = await getSupabaseClient().from('lists').delete().eq('id', listId).select('id');
  if (error) throw toDatabaseError('delete the list', error);
  if (!data || data.length === 0) throw toDatabaseError('delete the list', { code: '42501', message: 'no rows deleted' });
}
