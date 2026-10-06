import { getSupabaseClient } from './client';
import { Space } from '@/types/database';
import { toDatabaseError, ValidationError } from './errors';
import { mapSpaceRow } from './hierarchy-mappers';
import { slugify } from '@/lib/slug';
import {
  DEFAULT_COLOR,
  ICON_SLUG_PATTERN,
  isValidColor,
  validateDescription,
  validateHierarchyName,
} from '@/lib/hierarchy';

export interface SpaceInput {
  name: string;
  description?: string | null;
  icon?: string;
  color?: string;
}

function validateSpaceInput(input: Partial<SpaceInput>, requireName: boolean): void {
  if (requireName || input.name !== undefined) {
    const message = validateHierarchyName(input.name ?? '', 'space');
    if (message) throw new ValidationError(message);
  }
  if (input.description !== undefined && input.description !== null) {
    const message = validateDescription(input.description);
    if (message) throw new ValidationError(message);
  }
  if (input.color !== undefined && !isValidColor(input.color)) throw new ValidationError('Choose a valid color.');
  if (input.icon !== undefined && !ICON_SLUG_PATTERN.test(input.icon)) throw new ValidationError('Choose a valid icon.');
}

/** Slugs are unique per workspace; on a clash retry with a short random suffix. */
export async function createSpace(input: SpaceInput & { workspaceId: string; position: number }): Promise<Space> {
  if (!input.workspaceId) throw new ValidationError('Workspace ID is required.');
  validateSpaceInput(input, true);

  const base = slugify(input.name);
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await getSupabaseClient()
      .from('spaces')
      .insert({
        workspace_id: input.workspaceId,
        name: input.name.trim(),
        slug,
        description: input.description?.trim() || null,
        icon: input.icon ?? 'folder',
        color: input.color ?? DEFAULT_COLOR,
        position: input.position,
      })
      .select('*')
      .single();
    if (!error) return mapSpaceRow(data);
    if (error.code !== '23505') throw toDatabaseError('create the space', error);
  }
  throw new ValidationError('Could not create a unique address for this space. Try a different name.');
}

export async function updateSpace(spaceId: string, updates: Partial<SpaceInput>): Promise<Space> {
  if (!spaceId) throw new ValidationError('Space ID is required.');
  validateSpaceInput(updates, false);

  const dbUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name.trim();
  if (updates.description !== undefined) dbUpdates.description = updates.description?.trim() || null;
  if (updates.icon !== undefined) dbUpdates.icon = updates.icon;
  if (updates.color !== undefined) dbUpdates.color = updates.color;

  const { data, error } = await getSupabaseClient()
    .from('spaces')
    .update(dbUpdates)
    .eq('id', spaceId)
    .select('*')
    .maybeSingle();
  if (error) throw toDatabaseError('edit the space', error);
  // RLS hides rows the caller may not update: zero rows means "not yours" or "gone".
  if (!data) throw toDatabaseError('edit the space', { code: '42501', message: 'no rows updated' });
  return mapSpaceRow(data);
}

/** Deleting a space permanently deletes its folders and lists (and, later, their tasks). */
export async function deleteSpace(spaceId: string): Promise<void> {
  if (!spaceId) throw new ValidationError('Space ID is required.');
  const { data, error } = await getSupabaseClient().from('spaces').delete().eq('id', spaceId).select('id');
  if (error) throw toDatabaseError('delete the space', error);
  if (!data || data.length === 0) throw toDatabaseError('delete the space', { code: '42501', message: 'no rows deleted' });
}
