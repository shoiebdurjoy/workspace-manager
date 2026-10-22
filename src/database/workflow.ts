import { getSupabaseClient } from './client';
import type { StatusEvent, Task, TaskStatus, Workflow, WorkflowStatus, WorkflowTransition } from '@/types/database';
import type { Database } from '@/types/database.types';
import { DatabaseError, NotFoundError, toDatabaseError, ValidationError } from './errors';
import { mapTaskError } from './tasks';
import { mapTaskRow } from './task-mappers';
import { saveRow } from './save-row';
import { validateTaskUrl } from '@/lib/tasks';

/**
 * Workflow data access (Phase 7). The workflow is configuration the database owns; the app reads it
 * and asks the database to move tasks through it. The database (trigger enforce_task_workflow) is
 * the only authority on which moves are allowed.
 */

type Tables = Database['public']['Tables'];
type StatusRow = Tables['workflow_statuses']['Row'];
type TransitionRow = Tables['workflow_transitions']['Row'];
type EventRow = Tables['task_status_events']['Row'];

export const NOTE_MAX_LENGTH = 2000;

export function mapWorkflowStatus(row: StatusRow): WorkflowStatus {
  return {
    key: row.key,
    name: row.name,
    category: row.category,
    color: row.color,
    position: row.position,
    description: row.description,
    isInitial: row.is_initial,
    requiresEditor: row.requires_editor,
    requiresReviewLink: row.requires_review_link,
    requiresFinalExport: row.requires_final_export,
    requiresNote: row.requires_note,
    countsRevision: row.counts_revision,
  };
}

export function mapWorkflowTransition(row: TransitionRow): WorkflowTransition {
  return { from: row.from_key, to: row.to_key, label: row.label, kind: row.kind, roles: row.roles };
}

function mapEvent(row: EventRow): StatusEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    from: row.from_status,
    to: row.to_status,
    actorId: row.actor_id,
    note: row.note,
    isOverride: row.is_override,
    revisionNumber: row.revision_number,
    createdAt: row.created_at,
  };
}

/** The workspace's workflow (stages in order + transitions), in one request. */
export async function getWorkflow(workspaceId: string): Promise<Workflow> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');
  const { data, error } = await getSupabaseClient()
    .from('workflows')
    // Both child tables have a direct foreign key to workflows; workflow_transitions also links statuses
    // to each other, so PostgREST needs the column hint to know which relationship is meant.
    .select('id, name, workflow_statuses!workflow_id(*), workflow_transitions!workflow_id(*)')
    .eq('workspace_id', workspaceId)
    .eq('is_default', true)
    .maybeSingle();
  if (error) throw toDatabaseError('load the workflow', error);
  if (!data) throw new NotFoundError('Workflow', workspaceId);
  const row = data as unknown as { id: string; name: string; workflow_statuses: StatusRow[] | null; workflow_transitions: TransitionRow[] | null };
  return {
    id: row.id,
    name: row.name,
    statuses: (row.workflow_statuses ?? []).map(mapWorkflowStatus).sort((a, b) => a.position - b.position),
    transitions: (row.workflow_transitions ?? []).map(mapWorkflowTransition),
  };
}

export interface TransitionInput {
  to: TaskStatus;
  /** Required when the target stage asks for one (QC - REVISION NEEDED). */
  note?: string | null;
  /** Attached in the same call, e.g. when submitting a cut for QC. */
  reviewLink?: string | null;
  finalExportLink?: string | null;
  /** The status the person saw; if someone else moved the task since, nothing is applied. */
  expectedFrom?: TaskStatus | null;
}

/** A workflow decision someone else already overtook. */
export class StaleTransitionError extends DatabaseError {
  constructor() {
    super('Someone else moved this task in the meantime. It now shows its current stage; please check and try again.', 'STALE');
    this.name = 'StaleTransitionError';
  }
}

/** Moves a task to another stage in one atomic call; the database decides whether that is allowed. */
export async function transitionTask(taskId: string, input: TransitionInput): Promise<Task> {
  if (!taskId) throw new ValidationError('Task ID is required.');
  if (!input.to) throw new ValidationError('Choose a stage.');
  const note = input.note?.trim() || null;
  if (note && note.length > NOTE_MAX_LENGTH) throw new ValidationError(`The note must be ${NOTE_MAX_LENGTH} characters or fewer.`);
  for (const [label, value] of [['Review link', input.reviewLink], ['Final export', input.finalExportLink]] as const) {
    const message = value ? validateTaskUrl(value) : null;
    if (message) throw new ValidationError(`${label}: ${message}`);
  }

  const { data, error } = await getSupabaseClient().rpc('transition_task', {
    p_task_id: taskId,
    p_to: input.to,
    p_note: note,
    p_review_link: input.reviewLink?.trim() || null,
    p_final_export_link: input.finalExportLink?.trim() || null,
    p_expected_from: input.expectedFrom ?? null,
  });
  if (error) {
    // custom SQLSTATE of migration 10 (the standard 40001 hangs the hosted API instead of returning)
    if (error.code === 'TB409') throw new StaleTransitionError();
    // trigger messages ("QC - FIRST APPROVAL needs the review link of the cut") are already plain English
    if (error.code === '42501' && /cannot move|assigned to them/.test(error.message)) {
      throw new DatabaseError(error.message.charAt(0).toUpperCase() + error.message.slice(1) + '.', 'PERMISSION_DENIED', error);
    }
    if (error.code === '23514' && !/violates check constraint/.test(error.message)) {
      throw new ValidationError(error.message.charAt(0).toUpperCase() + error.message.slice(1) + '.', error);
    }
    throw mapTaskError('move the task', error);
  }
  if (!data) throw new DatabaseError('The task could not be moved.');
  return mapTaskRow(data);
}

/** A task's most recent request for changes, as My Tasks shows it under the title. */
export interface RevisionNote {
  taskId: string;
  note: string | null;
  revisionNumber: number | null;
  actorId: string | null;
  createdAt: string;
}

/**
 * The latest revision request of each of these tasks in one call (Phase 11). Tasks that never had one,
 * or that the person cannot read, are simply absent. At most 1,000 ids are read per call.
 */
export async function getLatestRevisionNotes(taskIds: readonly string[]): Promise<Map<string, RevisionNote>> {
  const out = new Map<string, RevisionNote>();
  if (taskIds.length === 0) return out;
  const { data, error } = await getSupabaseClient().rpc('latest_revision_notes', { p_task_ids: taskIds.slice(0, 1000) });
  if (error) throw toDatabaseError('load the revision notes', error);
  for (const row of data ?? []) {
    out.set(row.task_id, {
      taskId: row.task_id,
      note: row.note,
      revisionNumber: row.revision_number,
      actorId: row.actor_id,
      createdAt: row.created_at,
    });
  }
  return out;
}

/** The most recent request for changes on a task (who asked, when, and what to fix), if any. */
export async function getLatestRevisionRequest(taskId: string): Promise<StatusEvent | null> {
  if (!taskId) throw new ValidationError('Task ID is required.');
  const { data, error } = await getSupabaseClient()
    .from('task_status_events')
    .select('*')
    .eq('task_id', taskId)
    .not('revision_number', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw toDatabaseError('load the revision notes', error);
  const row = (data ?? [])[0];
  return row ? mapEvent(row) : null;
}

// ------------------------------------------------------------------------------------------------
// Customize (Owner / Admin, migration 27): presentational columns of statuses and the moves between
// them. Keys and rule flags stay system-owned; the database refuses anything else.
// ------------------------------------------------------------------------------------------------

// the generated types still describe these tables as read-only (they predate migration 27)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const writable = () => getSupabaseClient() as unknown as { from: (table: string) => any };

export interface StatusPatch {
  name?: string;
  color?: string;
  category?: WorkflowStatus['category'];
  position?: number;
  description?: string | null;
}

/** "Color grading!" -> "COLOR_GRADING" (unique within the workflow). */
export function statusKeyFor(name: string, taken: readonly string[]): string {
  const base = (name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'STATUS').replace(/^(\d)/, 'S_$1').slice(0, 44);
  let key = base.length >= 2 ? base : `${base}_X`;
  for (let i = 2; taken.includes(key); i += 1) key = `${base}_${i}`;
  return key;
}

export async function updateWorkflowStatus(workflowId: string, key: string, patch: StatusPatch): Promise<void> {
  const name = patch.name?.trim();
  if (patch.name !== undefined && !name) throw new ValidationError('A status needs a name.');
  const { error } = await writable()
    .from('workflow_statuses')
    .update({ ...patch, ...(name !== undefined ? { name } : {}) })
    .eq('workflow_id', workflowId)
    .eq('key', key);
  if (error) throw toDatabaseError('save the status', error);
}

export async function createWorkflowStatus(
  workflowId: string,
  input: { key: string; name: string; color: string; category: WorkflowStatus['category']; position: number }
): Promise<void> {
  if (!input.name.trim()) throw new ValidationError('A status needs a name.');
  const { error } = await writable()
    .from('workflow_statuses')
    .insert({ workflow_id: workflowId, key: input.key, name: input.name.trim(), color: input.color, category: input.category, position: input.position });
  if (error) throw toDatabaseError('add the status', error);
}

export async function deleteWorkflowStatus(workflowId: string, key: string): Promise<void> {
  const { error } = await writable().from('workflow_statuses').delete().eq('workflow_id', workflowId).eq('key', key);
  if (error) throw toDatabaseError('delete the status', error);
}

export async function saveWorkflowTransition(workflowId: string, t: WorkflowTransition): Promise<void> {
  const error = await saveRow('workflow_transitions', { workflow_id: workflowId, from_key: t.from, to_key: t.to }, { label: t.label.trim() || 'Move', kind: t.kind, roles: t.roles });
  if (error) throw toDatabaseError('save the move', error as never);
}

export async function deleteWorkflowTransition(workflowId: string, from: string, to: string): Promise<void> {
  const { error } = await writable().from('workflow_transitions').delete().eq('workflow_id', workflowId).eq('from_key', from).eq('to_key', to);
  if (error) throw toDatabaseError('remove the move', error);
}
