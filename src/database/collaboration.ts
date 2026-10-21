import { getSupabaseClient } from './client';
import { getDatabaseConfig } from './config';
import type { Database } from '@/types/database.types';
import type { ActivityEntry, ActivityKind, AppNotification, NotificationKind, StatusEvent, TaskAttachment, TaskComment } from '@/types/database';
import { AuthenticationRequiredError, DatabaseError, PermissionDeniedError, toDatabaseError, ValidationError } from './errors';
import {
  ATTACHMENT_BUCKET,
  NOTIFICATION_PAGE_SIZE,
  attachmentMimeType,
  attachmentPath,
  mergeActivity,
  validateAttachmentFile,
  validateComment,
} from '@/lib/collaboration';

/**
 * Phase 10 data access: comments, attachments, activity and notifications. Every call goes through the
 * signed-in person's own Supabase session, so RLS, the guard triggers and the storage policies decide what
 * is allowed; the checks here only give a readable message before the round trip. Nothing here writes
 * activity or notifications: the database does, in the same transaction as the event.
 */

type Tables = Database['public']['Tables'];

/** Safety cap for one task's thread; a task with more than this is not a conversation any more. */
export const COMMENT_LOAD_CAP = 500;
export const ACTIVITY_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------------------

export function mapCommentRow(row: Tables['task_comments']['Row']): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    workspaceId: row.workspace_id,
    authorId: row.author_id,
    body: row.body,
    mentions: row.mentions ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editedAt: row.edited_at,
  };
}

export async function listComments(taskId: string): Promise<TaskComment[]> {
  if (!taskId) throw new ValidationError('Task ID is required.');
  const { data, error } = await getSupabaseClient()
    .from('task_comments')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(COMMENT_LOAD_CAP);
  if (error) throw toDatabaseError('load the comments', error);
  return (data ?? []).map(mapCommentRow);
}

/** `id` lets the caller show the comment at once under the id it will keep. */
export async function addComment(taskId: string, body: string, id?: string): Promise<TaskComment> {
  if (!taskId) throw new ValidationError('Task ID is required.');
  const message = validateComment(body);
  if (message) throw new ValidationError(message);
  const { data, error } = await getSupabaseClient()
    .from('task_comments')
    .insert({ ...(id ? { id } : {}), task_id: taskId, body: body.trim() })
    .select('*')
    .single();
  if (error) throw toDatabaseError('comment on this task', error);
  return mapCommentRow(data);
}

export async function editComment(commentId: string, body: string): Promise<TaskComment> {
  if (!commentId) throw new ValidationError('Comment ID is required.');
  const message = validateComment(body);
  if (message) throw new ValidationError(message);
  const { data, error } = await getSupabaseClient().from('task_comments').update({ body: body.trim() }).eq('id', commentId).select('*');
  if (error) throw toDatabaseError('edit this comment', error);
  // RLS hides other people's comments from UPDATE: zero rows means "not yours" (or already deleted)
  if (!data?.length) throw new PermissionDeniedError('You can only edit your own comments.');
  return mapCommentRow(data[0]);
}

export async function deleteComment(commentId: string): Promise<void> {
  if (!commentId) throw new ValidationError('Comment ID is required.');
  const { data, error } = await getSupabaseClient().from('task_comments').delete().eq('id', commentId).select('id');
  if (error) throw toDatabaseError('delete this comment', error);
  if (!data?.length) throw new PermissionDeniedError('You can only delete your own comments.');
}

// ---------------------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------------------

export function mapAttachmentRow(row: Tables['task_attachments']['Row']): TaskAttachment {
  return {
    id: row.id,
    taskId: row.task_id,
    workspaceId: row.workspace_id,
    uploadedBy: row.uploaded_by,
    fileName: row.file_name,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
  };
}

export async function listAttachments(taskId: string): Promise<TaskAttachment[]> {
  if (!taskId) throw new ValidationError('Task ID is required.');
  const { data, error } = await getSupabaseClient()
    .from('task_attachments')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(200);
  if (error) throw toDatabaseError('load the files', error);
  return (data ?? []).map(mapAttachmentRow);
}

export interface UploadRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * The one description of "upload this object to the private bucket", shared by the browser upload (which
 * needs progress events, so it uses XMLHttpRequest) and by the live test (fetch), so the shape the live test
 * proves is the shape the app sends.
 */
export function buildUploadRequest(options: { supabaseUrl: string; anonKey: string; accessToken: string; path: string; contentType: string }): UploadRequest {
  return {
    url: `${options.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${ATTACHMENT_BUCKET}/${options.path}`,
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      apikey: options.anonKey,
      'Content-Type': options.contentType,
      'Cache-Control': 'max-age=3600',
      'x-upsert': 'false',
    },
  };
}

function uploadErrorMessage(status: number, body: string): DatabaseError {
  let message = '';
  try {
    message = String((JSON.parse(body) as { message?: string }).message ?? '');
  } catch {
    message = body;
  }
  if (status === 413 || /too large|exceeded the maximum/i.test(message)) return new ValidationError('The file is too large (the limit is 25 MB).');
  if (/mime type|not supported|invalid.*type/i.test(message)) return new ValidationError('This kind of file cannot be attached.');
  if (status === 401 || status === 403 || /row-level security|unauthorized/i.test(message)) {
    return new PermissionDeniedError('You do not have permission to attach files to this task.');
  }
  if (status === 409 || /already exists|duplicate/i.test(message)) return new ValidationError('That file was already uploaded.');
  return new DatabaseError('The file could not be uploaded. Please try again.', 'UPLOAD_FAILED', { status, message });
}

/** Sends the file with progress; resolves when Storage has stored it. */
function putObject(request: UploadRequest, file: Blob, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', request.url);
    for (const [k, v] of Object.entries(request.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(uploadErrorMessage(xhr.status, xhr.responseText));
      }
    };
    xhr.onerror = () => reject(new DatabaseError('The upload was interrupted. Check your connection and try again.', 'NETWORK'));
    xhr.onabort = () => reject(new DatabaseError('The upload was cancelled.', 'ABORTED'));
    if (signal) {
      if (signal.aborted) return reject(new DatabaseError('The upload was cancelled.', 'ABORTED'));
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

export interface UploadAttachmentInput {
  workspaceId: string;
  taskId: string;
  file: File;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Upload, then record. The record is what makes the file visible to anyone else, and the database reads size
 * and type back from the stored object, so a file that Storage refused (type, size) can never get a row. If the
 * record is refused after the bytes were stored, the stored object is removed again.
 */
export async function uploadAttachment({ workspaceId, taskId, file, onProgress, signal }: UploadAttachmentInput): Promise<TaskAttachment> {
  const invalid = validateAttachmentFile(file);
  if (invalid) throw new ValidationError(invalid);
  const mime = attachmentMimeType(file);
  if (!mime) throw new ValidationError('This kind of file cannot be attached.');

  const client = getSupabaseClient();
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new AuthenticationRequiredError();
  const config = getDatabaseConfig();

  const id = crypto.randomUUID();
  const path = attachmentPath(workspaceId, taskId, id, file.name);
  const request = buildUploadRequest({ supabaseUrl: config.supabaseUrl, anonKey: config.supabaseAnonKey, accessToken: token, path, contentType: mime });
  await putObject(request, file, onProgress ?? (() => undefined), signal);

  const { data, error } = await client
    .from('task_attachments')
    .insert({ id, task_id: taskId, file_name: file.name, storage_path: path, mime_type: mime, size_bytes: file.size })
    .select('*')
    .single();
  if (error) {
    await client.storage.from(ATTACHMENT_BUCKET).remove([path]).catch(() => undefined);
    throw toDatabaseError('attach this file', error);
  }
  return mapAttachmentRow(data);
}

/** A short-lived link to the private file; only created for someone the storage policy lets read it. */
export async function getAttachmentUrl(attachment: Pick<TaskAttachment, 'storagePath' | 'fileName'>, options: { download?: boolean } = {}): Promise<string> {
  const { data, error } = await getSupabaseClient()
    .storage.from(ATTACHMENT_BUCKET)
    .createSignedUrl(attachment.storagePath, 60, options.download ? { download: attachment.fileName } : undefined);
  if (error || !data?.signedUrl) throw new DatabaseError('The file could not be opened. It may have been removed.', 'NOT_FOUND', error);
  return data.signedUrl;
}

/** The record goes first (it is what everyone sees), then the stored bytes. */
export async function deleteAttachment(attachment: Pick<TaskAttachment, 'id' | 'storagePath'>): Promise<void> {
  const client = getSupabaseClient();
  const { data, error } = await client.from('task_attachments').delete().eq('id', attachment.id).select('id');
  if (error) throw toDatabaseError('remove this file', error);
  if (!data?.length) throw new PermissionDeniedError('Only the person who attached a file, or a manager, can remove it.');
  // an orphaned object is only visible to its uploader and managers, so a failure here is not worth failing the removal
  await client.storage.from(ATTACHMENT_BUCKET).remove([attachment.storagePath]).catch(() => undefined);
}

/** The stored files of these tasks, read BEFORE the tasks are deleted (the records cascade away with them). */
export async function taskFilePaths(taskIds: readonly string[]): Promise<string[]> {
  if (!taskIds.length) return [];
  const { data, error } = await getSupabaseClient().from('task_attachments').select('storage_path').in('task_id', [...taskIds]).limit(1000);
  if (error) return [];
  return (data ?? []).map((r) => r.storage_path);
}

/** Best effort: the task is already gone, and an object nobody has a record for is only visible to its uploader and managers. */
export async function removeStoredFiles(paths: readonly string[]): Promise<void> {
  if (!paths.length) return;
  await getSupabaseClient().storage.from(ATTACHMENT_BUCKET).remove([...paths]).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------------------

function mapStatusEvent(row: Tables['task_status_events']['Row']): StatusEvent {
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

/** The task's feed: property / assignment / comment / file events and stage changes, newest first. */
export async function listTaskActivity(taskId: string, limit = ACTIVITY_PAGE_SIZE): Promise<{ entries: ActivityEntry[]; hasMore: boolean }> {
  if (!taskId) throw new ValidationError('Task ID is required.');
  const client = getSupabaseClient();
  // one more than asked, from each source, so "is there more" is exact after merging
  const [activity, status] = await Promise.all([
    client.from('task_activity').select('*').eq('task_id', taskId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1),
    client.from('task_status_events').select('*').eq('task_id', taskId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1),
  ]);
  if (activity.error) throw toDatabaseError('load the activity', activity.error);
  if (status.error) throw toDatabaseError('load the activity', status.error);
  const all: ActivityEntry[] = [
    ...(activity.data ?? []).map((r): ActivityEntry => ({
      source: 'activity',
      id: r.id,
      taskId: r.task_id,
      actorId: r.actor_id,
      createdAt: r.created_at,
      kind: r.kind as ActivityKind,
      data: (r.data ?? {}) as Record<string, unknown>,
    })),
    ...(status.data ?? []).map((r): ActivityEntry => ({ source: 'status', id: r.id, taskId: r.task_id, actorId: r.actor_id, createdAt: r.created_at, event: mapStatusEvent(r) })),
  ];
  const merged = mergeActivity(all);
  return { entries: merged.slice(0, limit), hasMore: merged.length > limit };
}

// ---------------------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------------------

export function mapNotificationRow(row: Tables['notifications']['Row']): AppNotification {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    actorId: row.actor_id,
    kind: row.kind as NotificationKind,
    data: (row.data ?? {}) as Record<string, unknown>,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export interface NotificationPage {
  items: AppNotification[];
  /** Pass back as `before` for the next (older) page; null at the end. */
  next: { createdAt: string; id: string } | null;
}

/** Newest first, a page at a time (keyset on created_at + id: stable while new ones arrive). */
export async function listNotifications(options: { before?: { createdAt: string; id: string } | null; unreadOnly?: boolean; limit?: number } = {}): Promise<NotificationPage> {
  const limit = Math.min(Math.max(options.limit ?? NOTIFICATION_PAGE_SIZE, 1), 100);
  let query = getSupabaseClient().from('notifications').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (options.unreadOnly) query = query.is('read_at', null);
  if (options.before) {
    const { createdAt, id } = options.before;
    // strictly older, or the same instant with a smaller id
    query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
  }
  const { data, error } = await query;
  if (error) throw toDatabaseError('load your notifications', error);
  const rows = data ?? [];
  const page = rows.slice(0, limit).map(mapNotificationRow);
  const last = page[page.length - 1];
  return { items: page, next: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null };
}

export async function countUnreadNotifications(): Promise<number> {
  const { count, error } = await getSupabaseClient().from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  if (error) throw toDatabaseError('count your notifications', error);
  return count ?? 0;
}

/** Marks these (yours; anyone else's are invisible to the database) as read now. */
export async function markNotificationsRead(ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await getSupabaseClient().from('notifications').update({ read_at: new Date().toISOString() }).in('id', [...ids]).is('read_at', null);
  if (error) throw toDatabaseError('mark notifications as read', error);
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await getSupabaseClient().from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
  if (error) throw toDatabaseError('mark notifications as read', error);
}

export async function markNotificationUnread(id: string): Promise<void> {
  const { error } = await getSupabaseClient().from('notifications').update({ read_at: null }).eq('id', id);
  if (error) throw toDatabaseError('mark the notification as unread', error);
}

/**
 * Live updates for the bell. Realtime applies the table's RLS, so a person only ever receives their own
 * rows; the filter just keeps the stream small. Returns the function that stops listening.
 */
export function subscribeToNotifications(userId: string, onChange: (event: { type: 'INSERT' | 'UPDATE'; notification: AppNotification }) => void, onStatus?: (status: string) => void): () => void {
  const client = getSupabaseClient();
  const channel = client
    .channel(`notifications:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
      if (payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE') return;
      onChange({ type: payload.eventType, notification: mapNotificationRow(payload.new as Tables['notifications']['Row']) });
    })
    .subscribe((status) => onStatus?.(status));
  return () => {
    void client.removeChannel(channel);
  };
}
