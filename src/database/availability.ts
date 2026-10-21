import { getSupabaseClient } from './client';
import { toDatabaseError, ValidationError } from './errors';
import { AVAILABILITY_STATUSES, NOTE_MAX, type Availability, type AvailabilityStatus } from '@/lib/availability';

/** Everyone's availability in this workspace (RLS: internal staff only). */
export async function listAvailability(workspaceId: string): Promise<Map<string, Availability>> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');
  const { data, error } = await getSupabaseClient()
    .from('member_availability')
    .select('user_id, status, note, back_on, updated_at')
    .eq('workspace_id', workspaceId);
  if (error) throw toDatabaseError('load the team availability', error);
  const out = new Map<string, Availability>();
  for (const r of data ?? []) {
    out.set(r.user_id, { userId: r.user_id, status: r.status as AvailabilityStatus, note: r.note, backOn: r.back_on, updatedAt: r.updated_at });
  }
  return out;
}

/** Sets the signed-in person's own availability (update, or insert the first time). */
export async function setMyAvailability(
  workspaceId: string,
  userId: string,
  input: { status: AvailabilityStatus; note?: string | null; backOn?: string | null }
): Promise<void> {
  if (!workspaceId || !userId) throw new ValidationError('Workspace and person are required.');
  if (!AVAILABILITY_STATUSES.includes(input.status)) throw new ValidationError('Choose a status.');
  const note = input.note?.trim() ? input.note.trim().slice(0, NOTE_MAX) : null;
  const backOn = input.status === 'ON_LEAVE' && input.backOn ? input.backOn : null;
  const client = getSupabaseClient();
  const updated = await client
    .from('member_availability')
    .update({ status: input.status, note, back_on: backOn })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .select('user_id');
  if (updated.error) throw toDatabaseError('update your status', updated.error);
  if ((updated.data ?? []).length > 0) return;
  const inserted = await client.from('member_availability').insert({ workspace_id: workspaceId, user_id: userId, status: input.status, note, back_on: backOn });
  if (inserted.error) throw toDatabaseError('set your status', inserted.error);
}

/** Clears the signed-in person's status ("No status"). */
export async function clearMyAvailability(workspaceId: string, userId: string): Promise<void> {
  const { error } = await getSupabaseClient().from('member_availability').delete().eq('workspace_id', workspaceId).eq('user_id', userId);
  if (error) throw toDatabaseError('clear your status', error);
}

/** Live changes to anyone's availability in this workspace. Returns the function that stops listening. */
export function subscribeToAvailability(workspaceId: string, onChange: () => void): () => void {
  const client = getSupabaseClient();
  const channel = client
    .channel(`availability:${workspaceId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'member_availability', filter: `workspace_id=eq.${workspaceId}` }, () => onChange())
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
