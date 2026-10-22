import { getSupabaseClient } from './client';
import { ValidationError, toDatabaseError } from './errors';

/** Automations (migration 31): WHEN a trigger [in a folder] THEN up to 5 actions. The database runs them. */
export type AutomationTrigger = 'task_created' | 'status_changed' | 'tag_added';

export type AutomationAction =
  | { type: 'set_priority'; priority: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW' }
  | { type: 'set_due_in_days'; days: number }
  | { type: 'add_tag'; tag_id: string }
  | { type: 'assign_editor'; user_id: string }
  | { type: 'assign_qc'; user_id: string }
  | { type: 'set_field'; field_id: string; value: unknown }
  | { type: 'notify'; to: string; message: string };

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  triggerType: AutomationTrigger;
  triggerStatus: string | null;
  triggerTagId: string | null;
  folderId: string | null;
  actions: AutomationAction[];
  runCount: number;
  lastRunAt: string | null;
}

export type AutomationInput = Omit<Automation, 'id' | 'runCount' | 'lastRunAt'>;

// the generated types predate migration 31
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseClient() as unknown as { from: (table: string) => any };

type Row = {
  id: string; name: string; enabled: boolean; trigger_type: AutomationTrigger; trigger_status: string | null; trigger_tag_id: string | null;
  folder_id: string | null; actions: AutomationAction[]; run_count: number; last_run_at: string | null;
};
const map = (r: Row): Automation => ({
  id: r.id, name: r.name, enabled: r.enabled, triggerType: r.trigger_type, triggerStatus: r.trigger_status, triggerTagId: r.trigger_tag_id,
  folderId: r.folder_id, actions: Array.isArray(r.actions) ? r.actions : [], runCount: r.run_count, lastRunAt: r.last_run_at,
});
const toRow = (a: Partial<AutomationInput>) => ({
  ...(a.name !== undefined ? { name: a.name.trim() } : {}),
  ...(a.enabled !== undefined ? { enabled: a.enabled } : {}),
  ...(a.triggerType !== undefined ? { trigger_type: a.triggerType } : {}),
  ...(a.triggerStatus !== undefined ? { trigger_status: a.triggerStatus } : {}),
  ...(a.triggerTagId !== undefined ? { trigger_tag_id: a.triggerTagId } : {}),
  ...(a.folderId !== undefined ? { folder_id: a.folderId } : {}),
  ...(a.actions !== undefined ? { actions: a.actions } : {}),
});

export async function listAutomations(workspaceId: string): Promise<Automation[]> {
  const { data, error } = await db().from('automations').select('*').eq('workspace_id', workspaceId).order('created_at');
  if (error) throw toDatabaseError('load the automations', error);
  return ((data ?? []) as Row[]).map(map);
}

export async function createAutomation(workspaceId: string, input: AutomationInput): Promise<void> {
  if (!input.name.trim()) throw new ValidationError('Give the automation a name.');
  if (input.actions.length === 0) throw new ValidationError('Add at least one action.');
  const { error } = await db().from('automations').insert({ workspace_id: workspaceId, ...toRow(input) });
  if (error) throw toDatabaseError('create the automation', error);
}

export async function updateAutomation(id: string, patch: Partial<AutomationInput>): Promise<void> {
  const { error } = await db().from('automations').update(toRow(patch)).eq('id', id);
  if (error) throw toDatabaseError('save the automation', error);
}

export async function deleteAutomation(id: string): Promise<void> {
  const { error } = await db().from('automations').delete().eq('id', id);
  if (error) throw toDatabaseError('delete the automation', error);
}
