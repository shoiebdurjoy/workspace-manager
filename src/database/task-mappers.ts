import type { Database } from '@/types/database.types';
import type { Subtask, Task, TaskDetail, TaskSummary } from '@/types/database';

type Tables = Database['public']['Tables'];

export type TaskRow = Tables['tasks']['Row'];
export type SubtaskRow = Tables['subtasks']['Row'];
export type AssigneeRow = Pick<Tables['task_assignees']['Row'], 'role_type' | 'user_id'>;

export function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    listId: row.list_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    position: row.position,
    aspectRatio: row.aspect_ratio,
    rawFootageLink: row.raw_footage_link,
    projectFileLink: row.project_file_link,
    reviewLink: row.review_link,
    finalExportLink: row.final_export_link,
    dueDate: row.due_date,
    clientDeadline: row.client_deadline,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSubtaskRow(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    isCompleted: row.is_completed,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function slot(assignees: readonly AssigneeRow[] | null | undefined, role: AssigneeRow['role_type']): string | null {
  return assignees?.find((a) => a.role_type === role)?.user_id ?? null;
}

/** Columns the list view reads: everything a row shows or edits inline, never the (long) brief. */
export const TASK_SUMMARY_SELECT =
  'id, list_id, title, status, priority, position, aspect_ratio, due_date, client_deadline, ' +
  'raw_footage_link, project_file_link, review_link, final_export_link, created_at, updated_at, ' +
  'task_assignees(role_type, user_id), subtasks(is_completed)';

export interface TaskSummaryRow
  extends Pick<
    TaskRow,
    | 'id'
    | 'list_id'
    | 'title'
    | 'status'
    | 'priority'
    | 'position'
    | 'aspect_ratio'
    | 'due_date'
    | 'client_deadline'
    | 'raw_footage_link'
    | 'project_file_link'
    | 'review_link'
    | 'final_export_link'
    | 'created_at'
    | 'updated_at'
  > {
  task_assignees: AssigneeRow[] | null;
  subtasks: Array<{ is_completed: boolean }> | null;
}

export function mapTaskSummaryRow(row: TaskSummaryRow): TaskSummary {
  const subtasks = row.subtasks ?? [];
  return {
    id: row.id,
    listId: row.list_id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    position: row.position,
    aspectRatio: row.aspect_ratio,
    dueDate: row.due_date,
    clientDeadline: row.client_deadline,
    rawFootageLink: row.raw_footage_link,
    projectFileLink: row.project_file_link,
    reviewLink: row.review_link,
    finalExportLink: row.final_export_link,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editorId: slot(row.task_assignees, 'EDITOR'),
    qcId: slot(row.task_assignees, 'QC_REVIEWER'),
    subtaskTotal: subtasks.length,
    subtaskDone: subtasks.filter((s) => s.is_completed).length,
  };
}

/** The detail query: the task, its two assignment slots and its checklist in one request. */
export const TASK_DETAIL_SELECT = '*, task_assignees(role_type, user_id), subtasks(*)';

export interface TaskDetailRow extends TaskRow {
  task_assignees: AssigneeRow[] | null;
  subtasks: SubtaskRow[] | null;
}

export function mapTaskDetailRow(row: TaskDetailRow): TaskDetail {
  return {
    ...mapTaskRow(row),
    editorId: slot(row.task_assignees, 'EDITOR'),
    qcId: slot(row.task_assignees, 'QC_REVIEWER'),
    subtasks: (row.subtasks ?? [])
      .map(mapSubtaskRow)
      .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt)),
  };
}
