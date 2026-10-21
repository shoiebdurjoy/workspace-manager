import { getSupabaseClient } from './client';
import type { Task, TaskSummary } from '@/types/database';
import { DatabaseError, ValidationError, toDatabaseError } from './errors';
import { TASK_SUMMARY_SELECT, mapTaskRow, mapTaskSummaryRow, type TaskSummaryRow } from './task-mappers';
import { mapTaskError } from './tasks';

/**
 * Phase 12 task batches: a batch is a task whose videos point to it (tasks.parent_id). The videos are full
 * tasks, so they are read with the same projection as the list view. A video is added only through
 * create_batch_video: the database refuses every other way of setting the parent.
 */

/** At most this many videos are shown per batch (a batch is about ten). */
export const BATCH_VIDEO_LIMIT = 200;
const MAX_PROGRESS_IDS = 500;
const TITLE_MAX = 500;

export interface BatchProgress {
  total: number;
  finished: number;
}

export async function listBatchVideos(parentId: string): Promise<TaskSummary[]> {
  if (!parentId) throw new ValidationError('Batch ID is required.');
  const { data, error } = await getSupabaseClient()
    .from('tasks')
    .select(TASK_SUMMARY_SELECT)
    .eq('parent_id', parentId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(BATCH_VIDEO_LIMIT);
  if (error) throw toDatabaseError('load the videos', error);
  return ((data ?? []) as unknown as TaskSummaryRow[]).map(mapTaskSummaryRow);
}

export async function createBatchVideo(parentId: string, title: string, editorId?: string | null, qcId?: string | null): Promise<Task> {
  if (!parentId) throw new ValidationError('Batch ID is required.');
  const clean = title.trim();
  if (!clean) throw new ValidationError('Give the video a title.');
  if (clean.length > TITLE_MAX) throw new ValidationError(`The title must be ${TITLE_MAX} characters or fewer.`);
  if (editorId && editorId === qcId) throw new ValidationError('The editor and the QC reviewer must be different people.');

  const { data, error } = await getSupabaseClient().rpc('create_batch_video', {
    p_parent_id: parentId,
    p_title: clean,
    p_editor_id: editorId ?? null,
    p_qc_id: qcId ?? null,
  });
  if (error) throw mapTaskError('add the video', error);
  if (!data) throw new DatabaseError('The video could not be added.');
  return mapTaskRow(data);
}

/** Video counts per batch (only batches that have videos appear in the map). */
export async function getBatchProgress(parentIds: string[]): Promise<Map<string, BatchProgress>> {
  const ids = [...new Set(parentIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  if (ids.length > MAX_PROGRESS_IDS) throw new ValidationError(`Ask for at most ${MAX_PROGRESS_IDS} batches at a time.`);
  const { data, error } = await getSupabaseClient().rpc('batch_progress', { p_parent_ids: ids });
  if (error) throw toDatabaseError('load the batch progress', error);
  return new Map((data ?? []).map((r) => [r.parent_id, { total: r.total, finished: r.finished }]));
}
