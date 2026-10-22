import { getSupabaseClient } from './client';
import { toDatabaseError } from './errors';
import { saveRow } from './save-row';

/** Profile > Notifications (migration 34): what notifies this person in this workspace. Missing row = everything. */
export type MutableNotificationKind = 'mention' | 'comment' | 'assigned' | 'status' | 'automation';

export interface NotificationPrefs {
  mutedKinds: MutableNotificationKind[];
  mutedListIds: string[];
}

// the generated types predate migration 34
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseClient() as unknown as { from: (table: string) => any };

export async function getNotificationPrefs(workspaceId: string, userId: string): Promise<NotificationPrefs> {
  const { data, error } = await db().from('notification_prefs').select('muted_kinds,muted_list_ids').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
  if (error) throw toDatabaseError('load your notification settings', error);
  return { mutedKinds: data?.muted_kinds ?? [], mutedListIds: data?.muted_list_ids ?? [] };
}

export async function saveNotificationPrefs(workspaceId: string, userId: string, prefs: NotificationPrefs): Promise<void> {
  const error = await saveRow('notification_prefs', { user_id: userId, workspace_id: workspaceId }, { muted_kinds: prefs.mutedKinds, muted_list_ids: prefs.mutedListIds });
  if (error) throw toDatabaseError('save your notification settings', error);
}
