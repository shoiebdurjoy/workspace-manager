import { getSupabaseClient } from './client';
import type { ProductionMonth, ProductionVideo } from '@/types/database';
import { PermissionDeniedError, toDatabaseError, ValidationError } from './errors';

/**
 * Employee production analytics (Phase 7b). Owner / Admin only: the database functions refuse everyone
 * else (and RLS hides the credits table), this module only asks.
 *
 * The unit is a FIRST QC SUBMISSION: a video counts once, for the editor who first submitted it, in
 * the month it first reached QC - FIRST APPROVAL. It is not "delivered" and not "approved".
 */

function mapError(action: string, error: { code?: string; message: string }) {
  if (error.code === '42501') return new PermissionDeniedError('Only the owner and admins can see production analytics.');
  if (error.code === '22023') return new ValidationError(error.message, error);
  return toDatabaseError(action, error);
}

/** Every editor's first-QC submissions per calendar month (months in `timezone`). */
export async function getProductionMonthly(workspaceId: string, timezone = 'UTC'): Promise<ProductionMonth[]> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');
  const { data, error } = await getSupabaseClient().rpc('production_monthly', { p_workspace_id: workspaceId, p_timezone: timezone });
  if (error) throw mapError('load production', error);
  return (data ?? []).map((r) => ({ editorId: r.editor_id, year: r.year, month: r.month, credits: r.credits }));
}

/** The videos behind one editor's month, newest first. */
export async function getProductionVideos(
  workspaceId: string,
  editorId: string,
  year: number,
  month: number,
  timezone = 'UTC'
): Promise<ProductionVideo[]> {
  if (!workspaceId || !editorId) throw new ValidationError('Choose an editor.');
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new ValidationError('Choose a valid month.');
  const { data, error } = await getSupabaseClient().rpc('production_videos', {
    p_workspace_id: workspaceId,
    p_editor_id: editorId,
    p_year: year,
    p_month: month,
    p_timezone: timezone,
  });
  if (error) throw mapError('load the videos', error);
  return (data ?? []).map((r) => ({
    taskId: r.task_id,
    title: r.title,
    status: r.status,
    firstQcSubmittedAt: r.first_qc_submitted_at,
    submittedBy: r.submitted_by,
    listId: r.list_id,
    listName: r.list_name,
    folderName: r.folder_name,
    spaceId: r.space_id,
    spaceName: r.space_name,
    reviewLink: r.review_link,
    finalExportLink: r.final_export_link,
    projectFileLink: r.project_file_link,
  }));
}
