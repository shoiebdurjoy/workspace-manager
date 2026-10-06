import { getSupabaseClient } from './client';
import { TaskFoundation, SubtaskFoundation, TaskStatus, TaskPriority } from '@/types/database';
import { DatabaseError, NotFoundError, ValidationError } from './errors';

function mapTaskRow(row: {
  id: string;
  list_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}): TaskFoundation {
  return {
    id: row.id,
    listId: row.list_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    position: row.position,
    dueDate: row.due_date,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSubtaskRow(row: {
  id: string;
  task_id: string;
  title: string;
  description: string | null;
  is_completed: boolean;
  position: number;
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}): SubtaskFoundation {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    description: row.description,
    isCompleted: row.is_completed,
    position: row.position,
    dueDate: row.due_date,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getTasksByList(listId: string): Promise<TaskFoundation[]> {
  if (!listId) throw new ValidationError('List ID is required.');

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('tasks')
    .select('*')
    .eq('list_id', listId)
    .order('position', { ascending: true });

  if (error) {
    throw new DatabaseError(`Failed to fetch tasks for list: ${error.message}`, error.code, error);
  }

  return (data || []).map(mapTaskRow);
}

export async function getTaskById(taskId: string): Promise<TaskFoundation> {
  if (!taskId) throw new ValidationError('Task ID is required.');

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError('Task', taskId);
    }
    throw new DatabaseError(`Failed to fetch task: ${error.message}`, error.code, error);
  }

  if (!data) throw new NotFoundError('Task', taskId);
  return mapTaskRow(data);
}

export async function createTaskFoundation(data: {
  listId: string;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  position?: number;
  dueDate?: string | null;
  createdBy?: string | null;
}): Promise<TaskFoundation> {
  if (!data.listId) throw new ValidationError('List ID is required.');
  if (!data.title?.trim()) throw new ValidationError('Task title is required.');

  const client = getSupabaseClient();
  const { data: created, error } = await client
    .from('tasks')
    .insert({
      list_id: data.listId,
      title: data.title.trim(),
      description: data.description || null,
      status: data.status || 'TODO',
      priority: data.priority || 'MEDIUM',
      position: data.position ?? 0,
      due_date: data.dueDate || null,
      created_by: data.createdBy || null,
    })
    .select('*')
    .single();

  if (error) {
    throw new DatabaseError(`Failed to create task foundation: ${error.message}`, error.code, error);
  }

  return mapTaskRow(created);
}

export async function updateTaskFoundation(
  taskId: string,
  updates: Partial<Omit<TaskFoundation, 'id' | 'createdAt' | 'updatedAt' | 'listId'>>
): Promise<TaskFoundation> {
  if (!taskId) throw new ValidationError('Task ID is required.');

  const client = getSupabaseClient();
  const dbUpdates: Record<string, unknown> = {};

  if (updates.title !== undefined) dbUpdates.title = updates.title.trim();
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.priority !== undefined) dbUpdates.priority = updates.priority;
  if (updates.position !== undefined) dbUpdates.position = updates.position;
  if (updates.dueDate !== undefined) dbUpdates.due_date = updates.dueDate;

  const { data, error } = await client
    .from('tasks')
    .update(dbUpdates)
    .eq('id', taskId)
    .select('*')
    .single();

  if (error) {
    throw new DatabaseError(`Failed to update task: ${error.message}`, error.code, error);
  }

  return mapTaskRow(data);
}

export async function deleteTaskFoundation(taskId: string): Promise<void> {
  if (!taskId) throw new ValidationError('Task ID is required.');

  const client = getSupabaseClient();
  const { error } = await client
    .from('tasks')
    .delete()
    .eq('id', taskId);

  if (error) {
    throw new DatabaseError(`Failed to delete task: ${error.message}`, error.code, error);
  }
}

// ------------------------------------------------------------------------------
// SUBTASKS
// ------------------------------------------------------------------------------

export async function getSubtasksByTask(taskId: string): Promise<SubtaskFoundation[]> {
  if (!taskId) throw new ValidationError('Task ID is required.');

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('subtasks')
    .select('*')
    .eq('task_id', taskId)
    .order('position', { ascending: true });

  if (error) {
    throw new DatabaseError(`Failed to fetch subtasks: ${error.message}`, error.code, error);
  }

  return (data || []).map(mapSubtaskRow);
}

export async function createSubtaskFoundation(data: {
  taskId: string;
  title: string;
  description?: string | null;
  isCompleted?: boolean;
  position?: number;
  dueDate?: string | null;
  createdBy?: string | null;
}): Promise<SubtaskFoundation> {
  if (!data.taskId) throw new ValidationError('Task ID is required.');
  if (!data.title?.trim()) throw new ValidationError('Subtask title is required.');

  const client = getSupabaseClient();
  const { data: created, error } = await client
    .from('subtasks')
    .insert({
      task_id: data.taskId,
      title: data.title.trim(),
      description: data.description || null,
      is_completed: data.isCompleted || false,
      position: data.position ?? 0,
      due_date: data.dueDate || null,
      created_by: data.createdBy || null,
    })
    .select('*')
    .single();

  if (error) {
    throw new DatabaseError(`Failed to create subtask: ${error.message}`, error.code, error);
  }

  return mapSubtaskRow(created);
}

export async function updateSubtaskFoundation(
  subtaskId: string,
  updates: Partial<Omit<SubtaskFoundation, 'id' | 'createdAt' | 'updatedAt' | 'taskId'>>
): Promise<SubtaskFoundation> {
  if (!subtaskId) throw new ValidationError('Subtask ID is required.');

  const client = getSupabaseClient();
  const dbUpdates: Record<string, unknown> = {};

  if (updates.title !== undefined) dbUpdates.title = updates.title.trim();
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.isCompleted !== undefined) dbUpdates.is_completed = updates.isCompleted;
  if (updates.position !== undefined) dbUpdates.position = updates.position;
  if (updates.dueDate !== undefined) dbUpdates.due_date = updates.dueDate;

  const { data, error } = await client
    .from('subtasks')
    .update(dbUpdates)
    .eq('id', subtaskId)
    .select('*')
    .single();

  if (error) {
    throw new DatabaseError(`Failed to update subtask: ${error.message}`, error.code, error);
  }

  return mapSubtaskRow(data);
}

export async function deleteSubtaskFoundation(subtaskId: string): Promise<void> {
  if (!subtaskId) throw new ValidationError('Subtask ID is required.');

  const client = getSupabaseClient();
  const { error } = await client
    .from('subtasks')
    .delete()
    .eq('id', subtaskId);

  if (error) {
    throw new DatabaseError(`Failed to delete subtask: ${error.message}`, error.code, error);
  }
}
