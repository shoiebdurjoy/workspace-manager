import { getSupabaseClient } from './client';
import type { AspectRatio, AssigneeRole, Subtask, Task, TaskDetail, TaskPriority, TaskSummary } from '@/types/database';
import { DatabaseError, NotFoundError, toDatabaseError, ValidationError } from './errors';
import {
  mapSubtaskRow,
  mapTaskDetailRow,
  mapTaskRow,
  mapTaskSummaryRow,
  TASK_DETAIL_SELECT,
  TASK_SUMMARY_SELECT,
  type TaskDetailRow,
  type TaskSummaryRow,
} from './task-mappers';
import {
  ASPECT_RATIOS,
  LINK_FIELDS,
  TASK_PAGE_SIZE,
  TASK_PRIORITIES,
  TASK_STATUSES,
  validateTaskDescription,
  validateTaskTitle,
  validateTaskUrl,
  type LinkField,
} from '@/lib/tasks';

/**
 * Task Engine data access (Phase 6). Every call goes through the signed-in user's own Supabase
 * session, so RLS and the guard triggers decide what is allowed; the checks here only give
 * people a readable message before the round trip.
 */

export interface TaskInput {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  aspectRatio?: AspectRatio | null;
  rawFootageLink?: string | null;
  projectFileLink?: string | null;
  reviewLink?: string | null;
  finalExportLink?: string | null;
  /** Internal QC due date (ISO instant). */
  dueDate?: string | null;
  clientDeadline?: string | null;
  editorId?: string | null;
  qcId?: string | null;
}

/** Fields that can be changed after creation. Assignees have their own call (setTaskAssignee). */
export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'description'
    | 'status'
    | 'priority'
    | 'aspectRatio'
    | 'rawFootageLink'
    | 'projectFileLink'
    | 'reviewLink'
    | 'finalExportLink'
    | 'dueDate'
    | 'clientDeadline'
  >
>;

const LINK_LABEL: Record<LinkField, string> = Object.fromEntries(LINK_FIELDS.map((f) => [f.key, f.label])) as Record<LinkField, string>;

/** "" / whitespace -> null, so clearing a field in a form clears it in the database. */
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function validateFields(input: TaskPatch, requireTitle: boolean): void {
  if (requireTitle || input.title !== undefined) {
    const message = validateTaskTitle(input.title ?? '');
    if (message) throw new ValidationError(message);
  }
  if (input.description !== undefined && input.description !== null) {
    const message = validateTaskDescription(input.description);
    if (message) throw new ValidationError(message);
  }
  for (const { key } of LINK_FIELDS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    const message = validateTaskUrl(value);
    if (message) throw new ValidationError(`${LINK_LABEL[key]}: ${message}`);
  }
  if (input.priority !== undefined && !TASK_PRIORITIES.some((p) => p.value === input.priority)) {
    throw new ValidationError('Choose a valid priority.');
  }
  if (input.status !== undefined && !TASK_STATUSES.some((s) => s.value === input.status)) {
    throw new ValidationError('Choose a valid status.');
  }
  if (input.aspectRatio !== undefined && input.aspectRatio !== null && !ASPECT_RATIOS.some((a) => a.value === input.aspectRatio)) {
    throw new ValidationError('Choose a valid aspect ratio.');
  }
}

// Postgres quotes the constraint name, so match it quoted: "tasks_title_check" must not match inside "subtasks_title_check".
const CONSTRAINT_MESSAGES: Array<[RegExp, string]> = [
  [/"tasks_raw_footage_link_url"/, 'Raw footage: enter a full link that starts with http:// or https://.'],
  [/"tasks_project_file_link_url"/, 'Project file: enter a full link that starts with http:// or https://.'],
  [/"tasks_review_link_url"/, 'Review link: enter a full link that starts with http:// or https://.'],
  [/"tasks_final_export_link_url"/, 'Final export: enter a full link that starts with http:// or https://.'],
  [/"tasks_aspect_ratio_valid"/, 'Choose a valid aspect ratio.'],
  [/"tasks_description_length"/, 'The description is too long.'],
  [/"tasks_title_check"/, 'Enter a task title.'],
  [/"subtasks_title_check"/, 'Enter a subtask title.'],
  [/"tasks_priority_check"/, 'Choose a valid priority.'],
  [/"tasks_status_check"/, 'Choose a valid status.'],
];

/** Constraint violations become readable sentences; trigger messages are already plain English. */
export function mapTaskError(action: string, error: { code?: string; message: string }): DatabaseError {
  if (error.code === 'P0002') return new NotFoundError('Task', 'requested');
  if (error.code === '23514' && /violates check constraint/.test(error.message)) {
    const known = CONSTRAINT_MESSAGES.find(([pattern]) => pattern.test(error.message));
    return new ValidationError(known ? known[1] : 'Some of the information is not valid. Please check it and try again.', error);
  }
  if (error.code === '23503') {
    return new ValidationError('That list or person no longer exists.', error);
  }
  return toDatabaseError(action, error);
}

// ------------------------------------------------------------------------------
// Reading
// ------------------------------------------------------------------------------

export interface TaskPage {
  items: TaskSummary[];
  /** Total tasks in the list (not just this page). */
  total: number;
}

/**
 * One page of a list's tasks, in display order (position, then creation time). A single request:
 * assignee slots and checklist counts are embedded, so there is no per-row follow-up query.
 */
export async function listTasks(listId: string, page = 0, pageSize = TASK_PAGE_SIZE): Promise<TaskPage> {
  if (!listId) throw new ValidationError('List ID is required.');
  const from = page * pageSize;
  const { data, error, count } = await getSupabaseClient()
    .from('tasks')
    .select(TASK_SUMMARY_SELECT, { count: 'exact' })
    .eq('list_id', listId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, from + pageSize - 1);
  if (error) throw toDatabaseError('load the tasks', error);
  const rows = (data ?? []) as unknown as TaskSummaryRow[];
  return { items: rows.map(mapTaskSummaryRow), total: count ?? rows.length };
}

/** The full task with assignees and checklist. NotFoundError if it does not exist or is not visible. */
export async function getTask(taskId: string): Promise<TaskDetail> {
  if (!taskId) throw new ValidationError('Task ID is required.');
  const { data, error } = await getSupabaseClient()
    .from('tasks')
    .select(TASK_DETAIL_SELECT)
    .eq('id', taskId)
    .maybeSingle();
  if (error) throw toDatabaseError('load the task', error);
  if (!data) throw new NotFoundError('Task', taskId);
  return mapTaskDetailRow(data as unknown as TaskDetailRow);
}

// ------------------------------------------------------------------------------
// Writing
// ------------------------------------------------------------------------------

/** Creates the task and its assignees in one transaction; it is appended at the end of the list. */
export async function createTask(listId: string, input: TaskInput): Promise<Task> {
  if (!listId) throw new ValidationError('List ID is required.');
  validateFields(input, true);
  if (input.editorId && input.editorId === input.qcId) {
    throw new ValidationError('The editor and the QC reviewer must be different people.');
  }

  const { data, error } = await getSupabaseClient().rpc('create_task', {
    p_list_id: listId,
    p_title: input.title.trim(),
    p_description: blankToNull(input.description),
    p_priority: input.priority ?? 'MEDIUM',
    p_aspect_ratio: input.aspectRatio ?? null,
    p_raw_footage_link: blankToNull(input.rawFootageLink),
    p_project_file_link: blankToNull(input.projectFileLink),
    p_review_link: blankToNull(input.reviewLink),
    p_final_export_link: blankToNull(input.finalExportLink),
    p_due_date: input.dueDate ?? null,
    p_client_deadline: input.clientDeadline ?? null,
    p_editor_id: input.editorId ?? null,
    p_qc_id: input.qcId ?? null,
  });
  if (error) throw mapTaskError('create the task', error);
  if (!data) throw new DatabaseError('The task could not be created.');
  return mapTaskRow(data);
}

/** Changes only the fields given, so two people editing different fields never overwrite each other. */
export async function updateTask(taskId: string, patch: TaskPatch): Promise<Task> {
  if (!taskId) throw new ValidationError('Task ID is required.');
  validateFields(patch, false);

  const updates: Record<string, unknown> = {};
  if (patch.title !== undefined) updates.title = patch.title.trim();
  if (patch.description !== undefined) updates.description = blankToNull(patch.description);
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.priority !== undefined) updates.priority = patch.priority;
  if (patch.aspectRatio !== undefined) updates.aspect_ratio = patch.aspectRatio;
  if (patch.rawFootageLink !== undefined) updates.raw_footage_link = blankToNull(patch.rawFootageLink);
  if (patch.projectFileLink !== undefined) updates.project_file_link = blankToNull(patch.projectFileLink);
  if (patch.reviewLink !== undefined) updates.review_link = blankToNull(patch.reviewLink);
  if (patch.finalExportLink !== undefined) updates.final_export_link = blankToNull(patch.finalExportLink);
  if (patch.dueDate !== undefined) updates.due_date = patch.dueDate;
  if (patch.clientDeadline !== undefined) updates.client_deadline = patch.clientDeadline;
  if (Object.keys(updates).length === 0) throw new ValidationError('There is nothing to save.');

  const { data, error } = await getSupabaseClient()
    .from('tasks')
    .update(updates)
    .eq('id', taskId)
    .select('*')
    .maybeSingle();
  if (error) throw mapTaskError('update the task', error);
  // RLS hides rows the caller may not update: zero rows means "not yours" or "gone".
  if (!data) throw toDatabaseError('update the task', { code: '42501', message: 'no rows updated' });
  return mapTaskRow(data);
}

export async function deleteTask(taskId: string): Promise<void> {
  if (!taskId) throw new ValidationError('Task ID is required.');
  const { data, error } = await getSupabaseClient().from('tasks').delete().eq('id', taskId).select('id');
  if (error) throw mapTaskError('delete the task', error);
  if (!data || data.length === 0) throw toDatabaseError('delete the task', { code: '42501', message: 'no rows deleted' });
}

/** Sets (or, with null, clears) the editor / QC reviewer atomically. */
export async function setTaskAssignee(taskId: string, role: AssigneeRole, userId: string | null): Promise<void> {
  if (!taskId) throw new ValidationError('Task ID is required.');
  const { error } = await getSupabaseClient().rpc('set_task_assignee', {
    p_task_id: taskId,
    p_role_type: role,
    p_user_id: userId,
  });
  if (error) throw mapTaskError('change the assignment', error);
}

/** Moves a task one place up or down. Resolves false when it is already first / last. */
export async function moveTask(taskId: string, direction: 'up' | 'down'): Promise<boolean> {
  if (!taskId) throw new ValidationError('Task ID is required.');
  const { data, error } = await getSupabaseClient().rpc('move_task', { p_task_id: taskId, p_direction: direction });
  if (error) throw mapTaskError('reorder the task', error);
  return data === true;
}

// ------------------------------------------------------------------------------
// Subtasks (one level: a checklist under a task)
// ------------------------------------------------------------------------------

export async function createSubtask(taskId: string, title: string, position: number): Promise<Subtask> {
  if (!taskId) throw new ValidationError('Task ID is required.');
  const message = validateTaskTitle(title, 'subtask');
  if (message) throw new ValidationError(message);
  const { data, error } = await getSupabaseClient()
    .from('subtasks')
    .insert({ task_id: taskId, title: title.trim(), position })
    .select('*')
    .single();
  if (error) throw mapTaskError('add the subtask', error);
  return mapSubtaskRow(data);
}

export async function updateSubtask(
  subtaskId: string,
  patch: { title?: string; isCompleted?: boolean }
): Promise<Subtask> {
  if (!subtaskId) throw new ValidationError('Subtask ID is required.');
  const updates: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const message = validateTaskTitle(patch.title, 'subtask');
    if (message) throw new ValidationError(message);
    updates.title = patch.title.trim();
  }
  if (patch.isCompleted !== undefined) updates.is_completed = patch.isCompleted;
  if (Object.keys(updates).length === 0) throw new ValidationError('There is nothing to save.');

  const { data, error } = await getSupabaseClient()
    .from('subtasks')
    .update(updates)
    .eq('id', subtaskId)
    .select('*')
    .maybeSingle();
  if (error) throw mapTaskError('update the subtask', error);
  if (!data) throw toDatabaseError('update the subtask', { code: '42501', message: 'no rows updated' });
  return mapSubtaskRow(data);
}

export async function deleteSubtask(subtaskId: string): Promise<void> {
  if (!subtaskId) throw new ValidationError('Subtask ID is required.');
  const { data, error } = await getSupabaseClient().from('subtasks').delete().eq('id', subtaskId).select('id');
  if (error) throw mapTaskError('delete the subtask', error);
  if (!data || data.length === 0) throw toDatabaseError('delete the subtask', { code: '42501', message: 'no rows deleted' });
}
