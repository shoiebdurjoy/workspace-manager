import { getSupabaseClient } from './client';
import { ValidationError, toDatabaseError } from './errors';

/**
 * Tags (migration 30): workspace tags and the tags on each task. Calls run with the signed-in person's session;
 * RLS and the guard triggers decide what is allowed.
 */
export interface Tag {
  id: string;
  name: string;
  color: string;
  position: number;
}

export const TAG_NAME_MAX = 40;

// the generated types predate migration 30
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseClient() as unknown as { from: (table: string) => any };

const mapTag = (r: { id: string; name: string; color: string; position: number }): Tag => ({ id: r.id, name: r.name, color: r.color, position: r.position });

export function validateTagName(name: string, others: readonly string[] = []): string | null {
  const t = name.trim();
  if (!t) return 'Enter a tag name.';
  if (t.length > TAG_NAME_MAX) return `A tag can be at most ${TAG_NAME_MAX} characters.`;
  if (others.some((o) => o.trim().toLowerCase() === t.toLowerCase())) return 'That tag already exists.';
  return null;
}

export async function listTags(workspaceId: string): Promise<Tag[]> {
  const { data, error } = await db().from('tags').select('id,name,color,position').eq('workspace_id', workspaceId).order('position').order('created_at');
  if (error) throw toDatabaseError('load the tags', error);
  return (data ?? []).map(mapTag);
}

export async function createTag(workspaceId: string, input: { name: string; color: string; position?: number }): Promise<Tag> {
  const message = validateTagName(input.name);
  if (message) throw new ValidationError(message);
  const { data, error } = await db()
    .from('tags')
    .insert({ workspace_id: workspaceId, name: input.name.trim(), color: input.color, position: input.position ?? 0 })
    .select('id,name,color,position')
    .single();
  if (error) throw toDatabaseError('create the tag', error);
  return mapTag(data);
}

export async function updateTag(tagId: string, patch: { name?: string; color?: string; position?: number }): Promise<void> {
  if (patch.name !== undefined) {
    const message = validateTagName(patch.name);
    if (message) throw new ValidationError(message);
  }
  const { error } = await db().from('tags').update({ ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}) }).eq('id', tagId);
  if (error) throw toDatabaseError('change the tag', error);
}

export async function deleteTag(tagId: string): Promise<void> {
  const { error } = await db().from('tags').delete().eq('id', tagId);
  if (error) throw toDatabaseError('delete the tag', error);
}

/** task id -> tag ids, for every tagged task the person can see in the workspace. */
export async function listTaskTagMap(workspaceId: string): Promise<Map<string, string[]>> {
  const { data, error } = await db().from('task_tags').select('task_id,tag_id').eq('workspace_id', workspaceId).limit(20000);
  if (error) throw toDatabaseError('load the tags on tasks', error);
  const out = new Map<string, string[]>();
  for (const r of (data ?? []) as { task_id: string; tag_id: string }[]) out.set(r.task_id, [...(out.get(r.task_id) ?? []), r.tag_id]);
  return out;
}

export async function setTaskTag(taskId: string, tagId: string, on: boolean): Promise<void> {
  const q = on ? db().from('task_tags').insert({ task_id: taskId, tag_id: tagId }) : db().from('task_tags').delete().eq('task_id', taskId).eq('tag_id', tagId);
  const { error } = await q;
  if (error && !(on && error.code === '23505')) throw toDatabaseError(on ? 'add the tag' : 'remove the tag', error);
}
