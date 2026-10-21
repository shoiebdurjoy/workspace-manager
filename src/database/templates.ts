import { getSupabaseClient } from './client';
import { PermissionDeniedError, toDatabaseError, ValidationError } from './errors';
import { mapListRow } from './hierarchy-mappers';
import type { List } from '@/types/database';

/** A saved list: the standard videos a new client list starts with (migration 21). */
export interface ListTemplate {
  id: string;
  name: string;
  description: string | null;
  videoCount: number;
  createdAt: string;
}

function mapError(action: string, error: { code?: string; message: string }) {
  if (error.code === '42501') return new PermissionDeniedError('Only the owner, admins and production managers can manage templates.');
  if (error.code === '23505') return new ValidationError('A template with that name already exists.', error);
  if (error.code === '23514') return new ValidationError(error.message, error);
  return toDatabaseError(action, error);
}

export async function listTemplates(workspaceId: string): Promise<ListTemplate[]> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');
  const { data, error } = await getSupabaseClient()
    .from('list_templates')
    .select('id, name, description, items, created_at')
    .eq('workspace_id', workspaceId)
    .order('name');
  if (error) throw mapError('load the templates', error);
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    videoCount: Array.isArray(t.items) ? t.items.length : 0,
    createdAt: t.created_at,
  }));
}

export async function saveListAsTemplate(listId: string, name: string, description?: string): Promise<void> {
  if (!listId) throw new ValidationError('List ID is required.');
  if (!name.trim()) throw new ValidationError('Give the template a name.');
  const { error } = await getSupabaseClient().rpc('save_list_as_template', { p_list_id: listId, p_name: name.trim(), p_description: description?.trim() || null });
  if (error) throw mapError('save the template', error);
}

export async function createListFromTemplate(input: {
  templateId: string;
  spaceId: string;
  folderId: string | null;
  name: string;
  description?: string;
  color?: string;
}): Promise<List> {
  const { data, error } = await getSupabaseClient().rpc('create_list_from_template', {
    p_template_id: input.templateId,
    p_space_id: input.spaceId,
    p_folder_id: input.folderId,
    p_name: input.name.trim(),
    p_description: input.description?.trim() || null,
    p_color: input.color ?? null,
  });
  if (error) throw mapError('create the list from the template', error);
  return mapListRow(data);
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await getSupabaseClient().from('list_templates').delete().eq('id', id);
  if (error) throw mapError('delete the template', error);
}
