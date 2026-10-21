import { getSupabaseClient } from './client';
import type { Database } from '@/types/database.types';
import type { CustomField, CustomFieldType, CustomFieldValue } from '@/types/database';
import { ValidationError, toDatabaseError } from './errors';
import { readOptions, validateFieldName, validateFieldOptions } from '@/lib/custom-fields';

/**
 * Phase 12 data access: custom field definitions and the values on tasks. Every call goes through the
 * signed-in person's own session, so RLS and the guard triggers decide what is allowed; the checks here only
 * give a readable message before the round trip.
 */

type Tables = Database['public']['Tables'];

export function mapCustomFieldRow(row: Tables['custom_fields']['Row']): CustomField {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    type: row.field_type,
    options: row.field_type === 'dropdown' ? readOptions(row.options) : null,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCustomFields(workspaceId: string): Promise<CustomField[]> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');
  const { data, error } = await getSupabaseClient()
    .from('custom_fields')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(100);
  if (error) throw toDatabaseError('load the custom fields', error);
  return (data ?? []).map(mapCustomFieldRow);
}

export interface NewCustomField {
  name: string;
  type: CustomFieldType;
  options?: string[];
  position?: number;
}

export async function createCustomField(workspaceId: string, input: NewCustomField): Promise<CustomField> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');
  const nameError = validateFieldName(input.name);
  if (nameError) throw new ValidationError(nameError);
  if (input.type === 'dropdown') {
    const optionsError = validateFieldOptions(input.options ?? []);
    if (optionsError) throw new ValidationError(optionsError);
  }
  const { data, error } = await getSupabaseClient()
    .from('custom_fields')
    .insert({
      workspace_id: workspaceId,
      name: input.name.trim(),
      field_type: input.type,
      options: input.type === 'dropdown' ? (input.options ?? []) : null,
      ...(input.position !== undefined ? { position: input.position } : {}),
    })
    .select('*')
    .single();
  if (error) throw toDatabaseError('add this field', error);
  return mapCustomFieldRow(data);
}

/** The type cannot change; name, choices and position can. */
export async function updateCustomField(
  fieldId: string,
  patch: { name?: string; options?: string[]; position?: number }
): Promise<CustomField> {
  if (!fieldId) throw new ValidationError('Field ID is required.');
  if (patch.name !== undefined) {
    const message = validateFieldName(patch.name);
    if (message) throw new ValidationError(message);
  }
  if (patch.options !== undefined) {
    const message = validateFieldOptions(patch.options);
    if (message) throw new ValidationError(message);
  }
  const update: Tables['custom_fields']['Update'] = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.options !== undefined) update.options = patch.options;
  if (patch.position !== undefined) update.position = patch.position;
  const { data, error } = await getSupabaseClient().from('custom_fields').update(update).eq('id', fieldId).select('*').single();
  if (error) throw toDatabaseError('change this field', error);
  return mapCustomFieldRow(data);
}

/** Deleting a field deletes its values on every task (cascade). */
export async function deleteCustomField(fieldId: string): Promise<void> {
  if (!fieldId) throw new ValidationError('Field ID is required.');
  const { error } = await getSupabaseClient().from('custom_fields').delete().eq('id', fieldId);
  if (error) throw toDatabaseError('delete this field', error);
}

/** Writes the new order: each id gets its index as the position. */
export async function reorderCustomFields(orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i += 1) {
    const { error } = await getSupabaseClient().from('custom_fields').update({ position: i }).eq('id', orderedIds[i]);
    if (error) throw toDatabaseError('reorder the fields', error);
  }
}

/** How many tasks have a value for this field (shown before a delete). */
export async function countFieldValues(fieldId: string): Promise<number> {
  if (!fieldId) throw new ValidationError('Field ID is required.');
  const { count, error } = await getSupabaseClient()
    .from('custom_field_values')
    .select('task_id', { count: 'exact', head: true })
    .eq('field_id', fieldId);
  if (error) throw toDatabaseError('count the values of this field', error);
  return count ?? 0;
}

/** field id -> value for one task; only fields that have a value are present. */
export async function listTaskFieldValues(taskId: string): Promise<Map<string, CustomFieldValue>> {
  if (!taskId) throw new ValidationError('Task ID is required.');
  const { data, error } = await getSupabaseClient()
    .from('custom_field_values')
    .select('field_id, value')
    .eq('task_id', taskId)
    .limit(100);
  if (error) throw toDatabaseError('load the fields of this task', error);
  const out = new Map<string, CustomFieldValue>();
  for (const row of (data ?? []) as Array<{ field_id: string; value: unknown }>) {
    const v = typeof row.value === 'number' ? row.value : typeof row.value === 'string' ? row.value : undefined;
    if (v !== undefined) out.set(row.field_id, v);
  }
  return out;
}

/**
 * Saves one value, or clears it when `value` is null / an empty string (the row is deleted, because an
 * empty field has no row). An existing row is updated, a missing one inserted.
 */
export async function setTaskFieldValue(taskId: string, fieldId: string, value: CustomFieldValue | null): Promise<void> {
  if (!taskId) throw new ValidationError('Task ID is required.');
  if (!fieldId) throw new ValidationError('Field ID is required.');
  const client = getSupabaseClient();
  if (value === null || value === '') {
    const { error } = await client.from('custom_field_values').delete().eq('task_id', taskId).eq('field_id', fieldId);
    if (error) throw toDatabaseError('clear this field', error);
    return;
  }
  const { data, error } = await client
    .from('custom_field_values')
    .update({ value })
    .eq('task_id', taskId)
    .eq('field_id', fieldId)
    .select('field_id');
  if (error) throw toDatabaseError('save this field', error);
  if ((data ?? []).length > 0) return;
  const { error: insertError } = await client.from('custom_field_values').insert({ task_id: taskId, field_id: fieldId, value });
  if (insertError) throw toDatabaseError('save this field', insertError);
}
