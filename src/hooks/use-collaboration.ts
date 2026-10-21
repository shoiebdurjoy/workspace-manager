import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  addComment,
  countUnreadNotifications,
  deleteAttachment,
  deleteComment,
  editComment,
  getAttachmentUrl,
  listAttachments,
  listComments,
  listNotifications,
  listTaskActivity,
  markAllNotificationsRead,
  markNotificationUnread,
  markNotificationsRead,
  subscribeToNotifications,
  uploadAttachment,
  ACTIVITY_PAGE_SIZE,
  type NotificationPage,
} from '@/database';
import type { AppNotification, TaskAttachment, TaskComment } from '@/types/database';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/permissions';
import { mentionedIds, sortComments, validateAttachmentFile } from '@/lib/collaboration';

/**
 * Comments, files, the activity feed and notifications.
 *
 * Everything is keyed by workspace (and, for notifications, by person), so signing out or switching never
 * shows someone else's data. Comments and file removals are optimistic and put back if the database says
 * no; uploads show real progress; the bell is live through Realtime, with a refetch on focus and a slow
 * poll as the fallback when the live connection is down.
 */
export const collabKeys = {
  comments: (ws: string, taskId: string) => ['workspace', ws, 'collab', 'comments', taskId] as const,
  attachments: (ws: string, taskId: string) => ['workspace', ws, 'collab', 'attachments', taskId] as const,
  activity: (ws: string, taskId: string) => ['workspace', ws, 'collab', 'activity', taskId] as const,
  notifications: (ws: string, userId: string) => ['workspace', ws, 'notifications', userId, 'list'] as const,
  unread: (ws: string, userId: string) => ['workspace', ws, 'notifications', userId, 'unread'] as const,
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

function useCollabScope() {
  const { workspace, role, user } = useAuth();
  const workspaceId = workspace?.id ?? '';
  return { workspaceId, userId: user?.id ?? '', enabled: !!workspaceId && can(role, 'comments:view-internal') };
}

// ---------------------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------------------

export function useComments(taskId: string | undefined) {
  const { workspaceId, enabled } = useCollabScope();
  return useQuery({
    queryKey: collabKeys.comments(workspaceId, taskId ?? ''),
    queryFn: () => listComments(taskId ?? ''),
    enabled: enabled && !!taskId,
    staleTime: 10_000,
    // a conversation: pick up what others wrote while this is open (not in a hidden tab)
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Posts at once under the id it will keep; if the database refuses, the comment disappears again and the
 * caller gets the error (the composer puts the text back).
 */
export function useAddComment(taskId: string) {
  const qc = useQueryClient();
  const { workspaceId, userId } = useCollabScope();
  const key = collabKeys.comments(workspaceId, taskId);
  return useMutation({
    mutationFn: ({ body, id }: { body: string; id: string }) => addComment(taskId, body, id),
    onMutate: async ({ body, id }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<TaskComment[]>(key);
      const now = new Date().toISOString();
      const pending: TaskComment = {
        id,
        taskId,
        workspaceId,
        authorId: userId,
        body: body.trim(),
        mentions: mentionedIds(body),
        createdAt: now,
        updatedAt: now,
        editedAt: null,
      };
      qc.setQueryData<TaskComment[]>(key, (old) => sortComments([...(old ?? []), pending]));
      return { previous };
    },
    onError: (_err, _vars, ctx) => qc.setQueryData(key, ctx?.previous),
    onSuccess: (saved) => qc.setQueryData<TaskComment[]>(key, (old) => sortComments((old ?? []).map((c) => (c.id === saved.id ? saved : c)))),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: collabKeys.activity(workspaceId, taskId) });
    },
  });
}

export function useEditComment(taskId: string) {
  const qc = useQueryClient();
  const { workspaceId } = useCollabScope();
  const key = collabKeys.comments(workspaceId, taskId);
  return useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) => editComment(commentId, body),
    onMutate: async ({ commentId, body }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<TaskComment[]>(key);
      const now = new Date().toISOString();
      qc.setQueryData<TaskComment[]>(key, (old) => (old ?? []).map((c) => (c.id === commentId ? { ...c, body: body.trim(), mentions: mentionedIds(body), editedAt: now, updatedAt: now } : c)));
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      qc.setQueryData(key, ctx?.previous);
      toast.error(errorMessage(err));
    },
    onSuccess: (saved) => qc.setQueryData<TaskComment[]>(key, (old) => (old ?? []).map((c) => (c.id === saved.id ? saved : c))),
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

export function useDeleteComment(taskId: string) {
  const qc = useQueryClient();
  const { workspaceId } = useCollabScope();
  const key = collabKeys.comments(workspaceId, taskId);
  return useMutation({
    mutationFn: (commentId: string) => deleteComment(commentId),
    onMutate: async (commentId) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<TaskComment[]>(key);
      qc.setQueryData<TaskComment[]>(key, (old) => (old ?? []).filter((c) => c.id !== commentId));
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      qc.setQueryData(key, ctx?.previous);
      toast.error(errorMessage(err));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

// ---------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------

export function useAttachments(taskId: string | undefined) {
  const { workspaceId, enabled } = useCollabScope();
  return useQuery({
    queryKey: collabKeys.attachments(workspaceId, taskId ?? ''),
    queryFn: () => listAttachments(taskId ?? ''),
    enabled: enabled && !!taskId,
    staleTime: 15_000,
  });
}

export interface UploadState {
  id: string;
  fileName: string;
  size: number;
  /** 0..1 */
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

/**
 * Uploads one or several files at once, each with its own real progress bar. A file that fails keeps its
 * message until dismissed; one that succeeds appears in the list and leaves the queue.
 */
export function useAttachmentUploads(taskId: string) {
  const qc = useQueryClient();
  const { workspaceId } = useCollabScope();
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const live = controllers.current;
    return () => {
      alive.current = false;
      live.forEach((c) => c.abort());
    };
  }, []);

  const patch = useCallback((id: string, change: Partial<UploadState>) => {
    if (!alive.current) return;
    setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...change } : u)));
  }, []);

  const start = useCallback(
    (files: readonly File[]) => {
      for (const file of files) {
        const id = crypto.randomUUID();
        const invalid = validateAttachmentFile(file);
        if (invalid) {
          setUploads((list) => [...list, { id, fileName: file.name, size: file.size, progress: 0, status: 'error', error: invalid }]);
          continue;
        }
        const controller = new AbortController();
        controllers.current.set(id, controller);
        setUploads((list) => [...list, { id, fileName: file.name, size: file.size, progress: 0, status: 'uploading' }]);
        uploadAttachment({ workspaceId, taskId, file, signal: controller.signal, onProgress: (progress) => patch(id, { progress }) })
          .then((saved) => {
            qc.setQueryData<TaskAttachment[]>(collabKeys.attachments(workspaceId, taskId), (old) => [saved, ...(old ?? []).filter((a) => a.id !== saved.id)]);
            void qc.invalidateQueries({ queryKey: collabKeys.attachments(workspaceId, taskId) });
            void qc.invalidateQueries({ queryKey: collabKeys.activity(workspaceId, taskId) });
            if (alive.current) setUploads((list) => list.filter((u) => u.id !== id));
          })
          .catch((err: unknown) => {
            if ((err as { code?: string } | null)?.code === 'ABORTED') {
              if (alive.current) setUploads((list) => list.filter((u) => u.id !== id));
              return;
            }
            patch(id, { status: 'error', error: errorMessage(err) });
          })
          .finally(() => controllers.current.delete(id));
      }
    },
    [patch, qc, taskId, workspaceId]
  );

  const cancel = useCallback((id: string) => controllers.current.get(id)?.abort(), []);
  const dismiss = useCallback((id: string) => setUploads((list) => list.filter((u) => u.id !== id)), []);
  return { uploads, start, cancel, dismiss };
}

export function useDeleteAttachment(taskId: string) {
  const qc = useQueryClient();
  const { workspaceId } = useCollabScope();
  const key = collabKeys.attachments(workspaceId, taskId);
  return useMutation({
    mutationFn: (attachment: TaskAttachment) => deleteAttachment(attachment),
    onMutate: async (attachment) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<TaskAttachment[]>(key);
      qc.setQueryData<TaskAttachment[]>(key, (old) => (old ?? []).filter((a) => a.id !== attachment.id));
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      qc.setQueryData(key, ctx?.previous);
      toast.error(errorMessage(err));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: collabKeys.activity(workspaceId, taskId) });
    },
  });
}

/** Opens or downloads a private file through a link that lasts a minute and is only made for people who may read it. */
export function useOpenAttachment() {
  return useCallback(async (attachment: TaskAttachment, mode: 'open' | 'download') => {
    // the window is opened first (inside the click) so a popup blocker does not eat it
    const popup = mode === 'open' ? window.open('', '_blank') : null;
    try {
      const url = await getAttachmentUrl(attachment, { download: mode === 'download' });
      if (mode === 'open') {
        if (popup) {
          popup.opener = null;
          popup.location.href = url;
        } else {
          window.location.assign(url);
        }
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = attachment.fileName;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      popup?.close();
      toast.error(errorMessage(err));
    }
  }, []);
}

// ---------------------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------------------

export function useTaskActivity(taskId: string | undefined, limit = ACTIVITY_PAGE_SIZE, enabledByCaller = true) {
  const { workspaceId, enabled } = useCollabScope();
  return useQuery({
    queryKey: [...collabKeys.activity(workspaceId, taskId ?? ''), limit],
    queryFn: () => listTaskActivity(taskId ?? '', limit),
    enabled: enabled && enabledByCaller && !!taskId,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

// ---------------------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------------------

export function useNotifications(enabledByCaller = true) {
  const { workspaceId, userId, enabled } = useCollabScope();
  return useInfiniteQuery({
    queryKey: collabKeys.notifications(workspaceId, userId),
    queryFn: ({ pageParam }) => listNotifications({ before: pageParam }),
    initialPageParam: null as NotificationPage['next'],
    getNextPageParam: (last: NotificationPage) => last.next,
    enabled: enabled && enabledByCaller && !!userId,
    staleTime: 15_000,
  });
}

export function useUnreadCount() {
  const { workspaceId, userId, enabled } = useCollabScope();
  return useQuery({
    queryKey: collabKeys.unread(workspaceId, userId),
    queryFn: countUnreadNotifications,
    enabled: enabled && !!userId,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    // the fallback when the live connection is down: a count is one tiny request
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

function patchNotifications(data: InfiniteData<NotificationPage> | undefined, change: (n: AppNotification) => AppNotification): InfiniteData<NotificationPage> | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map(change) })) };
}

export function useNotificationActions() {
  const qc = useQueryClient();
  const { workspaceId, userId } = useCollabScope();
  const listKey = collabKeys.notifications(workspaceId, userId);
  const unreadKey = collabKeys.unread(workspaceId, userId);

  const snapshot = async () => {
    await Promise.all([qc.cancelQueries({ queryKey: listKey }), qc.cancelQueries({ queryKey: unreadKey })]);
    return { list: qc.getQueryData<InfiniteData<NotificationPage>>(listKey), unread: qc.getQueryData<number>(unreadKey) };
  };
  const restore = (ctx: Awaited<ReturnType<typeof snapshot>> | undefined) => {
    qc.setQueryData(listKey, ctx?.list);
    qc.setQueryData(unreadKey, ctx?.unread);
  };
  const settle = () => {
    void qc.invalidateQueries({ queryKey: listKey });
    void qc.invalidateQueries({ queryKey: unreadKey });
  };

  const markRead = useMutation({
    mutationFn: (ids: readonly string[]) => markNotificationsRead(ids),
    onMutate: async (ids) => {
      const ctx = await snapshot();
      const now = new Date().toISOString();
      let newlyRead = 0;
      qc.setQueryData<InfiniteData<NotificationPage>>(listKey, (d) =>
        patchNotifications(d, (n) => {
          if (ids.includes(n.id) && n.readAt === null) {
            newlyRead++;
            return { ...n, readAt: now };
          }
          return n;
        })
      );
      qc.setQueryData<number>(unreadKey, (c) => Math.max(0, (c ?? 0) - newlyRead));
      return ctx;
    },
    onError: (err, _ids, ctx) => {
      restore(ctx);
      toast.error(errorMessage(err));
    },
    onSettled: settle,
  });

  const markAllRead = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onMutate: async () => {
      const ctx = await snapshot();
      const now = new Date().toISOString();
      qc.setQueryData<InfiniteData<NotificationPage>>(listKey, (d) => patchNotifications(d, (n) => (n.readAt === null ? { ...n, readAt: now } : n)));
      qc.setQueryData<number>(unreadKey, 0);
      return ctx;
    },
    onError: (err, _v, ctx) => {
      restore(ctx);
      toast.error(errorMessage(err));
    },
    onSettled: settle,
  });

  const markUnread = useMutation({
    mutationFn: (id: string) => markNotificationUnread(id),
    onMutate: async (id) => {
      const ctx = await snapshot();
      let changed = 0;
      qc.setQueryData<InfiniteData<NotificationPage>>(listKey, (d) =>
        patchNotifications(d, (n) => {
          if (n.id === id && n.readAt !== null) {
            changed++;
            return { ...n, readAt: null };
          }
          return n;
        })
      );
      qc.setQueryData<number>(unreadKey, (c) => (c ?? 0) + changed);
      return ctx;
    },
    onError: (err, _v, ctx) => {
      restore(ctx);
      toast.error(errorMessage(err));
    },
    onSettled: settle,
  });

  return { markRead, markAllRead, markUnread };
}

/**
 * Keeps the bell live. A new row for this person (the database created it) bumps the count and refreshes
 * the list; a change made in another tab (read / unread) does the same. No toast: the badge is the signal.
 * Called once, from the header.
 */
export function useNotificationRealtime() {
  const qc = useQueryClient();
  const { workspaceId, userId, enabled } = useCollabScope();
  const [status, setStatus] = useState<string>('idle');
  useEffect(() => {
    if (!enabled || !userId) return;
    let stop: (() => void) | undefined;
    try {
      stop = subscribeToNotifications(
        userId,
        () => {
          void qc.invalidateQueries({ queryKey: collabKeys.notifications(workspaceId, userId) });
          void qc.invalidateQueries({ queryKey: collabKeys.unread(workspaceId, userId) });
        },
        setStatus
      );
    } catch {
      // no live connection (e.g. not configured): the focus refetch and the slow poll still keep the bell right
      setStatus('unavailable');
    }
    return () => stop?.();
  }, [enabled, qc, userId, workspaceId]);
  return status;
}
