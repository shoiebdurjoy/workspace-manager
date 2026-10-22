import { getSupabaseClient } from './client';
import { toDatabaseError } from './errors';
import { saveRow } from './save-row';

/** Recurring videos, dependencies and time tracking (migrations 36-38). Calls run as the signed-in person. */
export type RepeatUnit = 'day' | 'week' | 'month';
export interface RepeatRule {
  every: number;
  unit: RepeatUnit;
  copyPeople: boolean;
}
export interface DependencyTask {
  id: string;
  title: string;
  status: string;
}
export interface TimeEntry {
  id: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  note: string | null;
}

// the generated types predate these migrations
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseClient() as unknown as { from: (table: string) => any };

export async function getRepeat(taskId: string): Promise<RepeatRule | null> {
  const { data, error } = await db().from('task_recurrence').select('every,unit,copy_people,spawned_task_id').eq('task_id', taskId).maybeSingle();
  if (error) throw toDatabaseError('load the repeat rule', error);
  return data && !data.spawned_task_id ? { every: data.every, unit: data.unit, copyPeople: data.copy_people } : null;
}

export async function setRepeat(taskId: string, rule: RepeatRule | null): Promise<void> {
  if (!rule) {
    const { error } = await db().from('task_recurrence').delete().eq('task_id', taskId);
    if (error) throw toDatabaseError('stop the repeat', error);
    return;
  }
  const error = await saveRow('task_recurrence', { task_id: taskId }, { every: rule.every, unit: rule.unit, copy_people: rule.copyPeople });
  if (error) throw toDatabaseError('save the repeat', error);
}

/** What this video waits on, and what waits on it. */
export async function getDependencies(taskId: string): Promise<{ waitingOn: DependencyTask[]; blocking: DependencyTask[] }> {
  const [on, by] = await Promise.all([
    db().from('task_dependencies').select('depends_on_id, tasks!task_dependencies_depends_on_id_fkey(id,title,status)').eq('task_id', taskId),
    db().from('task_dependencies').select('task_id, tasks!task_dependencies_task_id_fkey(id,title,status)').eq('depends_on_id', taskId),
  ]);
  if (on.error) throw toDatabaseError('load the dependencies', on.error);
  if (by.error) throw toDatabaseError('load the dependencies', by.error);
  const pick = (rows: { tasks: DependencyTask | null }[]) => rows.map((r) => r.tasks).filter((t): t is DependencyTask => !!t);
  return { waitingOn: pick(on.data ?? []), blocking: pick(by.data ?? []) };
}

export async function addDependency(taskId: string, dependsOnId: string): Promise<void> {
  const { error } = await db().from('task_dependencies').insert({ task_id: taskId, depends_on_id: dependsOnId });
  if (error) throw toDatabaseError('add the dependency', error);
}

export async function removeDependency(taskId: string, dependsOnId: string): Promise<void> {
  const { error } = await db().from('task_dependencies').delete().eq('task_id', taskId).eq('depends_on_id', dependsOnId);
  if (error) throw toDatabaseError('remove the dependency', error);
}

/** Videos to pick from when adding a dependency (title search). */
export async function searchTasksByTitle(workspaceId: string, text: string, exclude: string): Promise<DependencyTask[]> {
  const q = db().from('tasks').select('id,title,status').eq('workspace_id', workspaceId).neq('id', exclude).order('updated_at', { ascending: false }).limit(12);
  const { data, error } = await (text.trim() ? q.ilike('title', `%${text.trim().replace(/[%_]/g, '')}%`) : q);
  if (error) throw toDatabaseError('search videos', error);
  return data ?? [];
}

export async function listTimeEntries(taskId: string): Promise<TimeEntry[]> {
  const { data, error } = await db().from('time_entries').select('id,user_id,started_at,ended_at,note').eq('task_id', taskId).order('started_at', { ascending: false }).limit(200);
  if (error) throw toDatabaseError('load the time', error);
  return (data ?? []).map((r: { id: string; user_id: string; started_at: string; ended_at: string | null; note: string | null }) => ({
    id: r.id, userId: r.user_id, startedAt: r.started_at, endedAt: r.ended_at, note: r.note,
  }));
}

/** The signed-in person's running timer, wherever it is. */
export async function getRunningTimer(userId: string): Promise<{ id: string; taskId: string; startedAt: string } | null> {
  const { data, error } = await db().from('time_entries').select('id,task_id,started_at').eq('user_id', userId).is('ended_at', null).maybeSingle();
  if (error) throw toDatabaseError('load your timer', error);
  return data ? { id: data.id, taskId: data.task_id, startedAt: data.started_at } : null;
}

export async function startTimer(taskId: string, userId: string): Promise<void> {
  // one timer at a time: stop the one running elsewhere first
  const running = await getRunningTimer(userId);
  if (running) await stopTimer(running.id, running.startedAt);
  const { error } = await db().from('time_entries').insert({ task_id: taskId, started_at: new Date().toISOString() });
  if (error) throw toDatabaseError('start the timer', error);
}

export async function stopTimer(entryId: string, startedAt: string): Promise<void> {
  const start = new Date(startedAt).getTime();
  // never longer than the 24 hours the database allows, never zero
  const end = Math.max(start + 60_000, Math.min(Date.now(), start + 24 * 3_600_000));
  const { error } = await db().from('time_entries').update({ ended_at: new Date(end).toISOString() }).eq('id', entryId);
  if (error) throw toDatabaseError('stop the timer', error);
}

export async function addManualTime(taskId: string, minutes: number, day: string, note: string): Promise<void> {
  const end = new Date(`${day}T17:00:00`);
  const start = new Date(end.getTime() - minutes * 60_000);
  const { error } = await db().from('time_entries').insert({ task_id: taskId, started_at: start.toISOString(), ended_at: end.toISOString(), note: note.trim() || null });
  if (error) throw toDatabaseError('add the time', error);
}

export async function deleteTimeEntry(id: string): Promise<void> {
  const { error } = await db().from('time_entries').delete().eq('id', id);
  if (error) throw toDatabaseError('delete the time', error);
}

export async function setTimeEstimate(taskId: string, minutes: number | null): Promise<void> {
  const { error } = await db().from('tasks').update({ time_estimate_minutes: minutes }).eq('id', taskId);
  if (error) throw toDatabaseError('save the estimate', error);
}

export async function getTimeEstimate(taskId: string): Promise<number | null> {
  const { data, error } = await db().from('tasks').select('time_estimate_minutes').eq('id', taskId).maybeSingle();
  if (error) throw toDatabaseError('load the estimate', error);
  return data?.time_estimate_minutes ?? null;
}
