import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  countInboxUnread,
  listNotifications,
  markAllNotificationsRead,
  markNotificationUnread,
  markNotificationsRead,
  markReadNotificationsDone,
  setNotificationsDone,
  type NotificationPage,
} from '@/database';
import type { AppNotification } from '@/types/database';
import { useAuth } from '@/hooks/use-auth';
import { collabKeys } from '@/hooks/use-collaboration';
import { can } from '@/lib/permissions';
import type { InboxState } from '@/lib/collaboration';

/**
 * The Inbox page (Phase 11): the person's notifications by tab (Inbox / Done / All), with read / unread,
 * Done / back to the Inbox and the two bulk actions. Every change is optimistic across every cached list
 * (the bell's and each Inbox tab) and put back if the database says no.
 */

function useInboxScope() {
  const { workspace, role, user } = useAuth();
  const workspaceId = workspace?.id ?? '';
  return { workspaceId, userId: user?.id ?? '', enabled: !!workspaceId && can(role, 'comments:view-internal') };
}

export const INBOX_PAGE_SIZE = 30;

export function useInboxNotifications(state: InboxState) {
  const { workspaceId, userId, enabled } = useInboxScope();
  return useInfiniteQuery({
    queryKey: collabKeys.inbox(workspaceId, userId, state),
    queryFn: ({ pageParam }) =>
      listNotifications({ before: pageParam, view: state.tab, kinds: state.kinds, unreadOnly: state.unreadOnly, limit: INBOX_PAGE_SIZE }),
    initialPageParam: null as NotificationPage['next'],
    getNextPageParam: (last: NotificationPage) => last.next,
    enabled: enabled && !!userId,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

/** The sidebar's Inbox badge: unread and not Done. */
export function useInboxCount() {
  const { workspaceId, userId, enabled } = useInboxScope();
  return useQuery({
    queryKey: collabKeys.inboxCount(workspaceId, userId),
    queryFn: countInboxUnread,
    enabled: enabled && !!userId,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    // the fallback when the live connection is down: a count is one tiny request
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

type Lists = Array<[readonly unknown[], InfiniteData<NotificationPage> | undefined]>;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

export function useInboxActions() {
  const qc = useQueryClient();
  const { workspaceId, userId } = useInboxScope();
  const listKey = collabKeys.notifications(workspaceId, userId);
  const unreadKey = collabKeys.unread(workspaceId, userId);
  const countKey = collabKeys.inboxCount(workspaceId, userId);

  const lists = () => qc.getQueriesData<InfiniteData<NotificationPage>>({ queryKey: listKey }) as Lists;
  /** The cached copy of each of these notifications (any list will do: they are the same row). */
  const cached = (ids: readonly string[]) => {
    const out = new Map<string, AppNotification>();
    for (const [, data] of lists()) for (const p of data?.pages ?? []) for (const n of p.items) if (ids.includes(n.id)) out.set(n.id, n);
    return out;
  };
  /** Which Inbox tab a cached list is (undefined for the bell's list). */
  const tabOf = (key: readonly unknown[]) => (key[6] as InboxState | undefined)?.tab;

  const snapshot = async () => {
    await Promise.all([qc.cancelQueries({ queryKey: listKey }), qc.cancelQueries({ queryKey: unreadKey }), qc.cancelQueries({ queryKey: countKey })]);
    return { lists: lists(), unread: qc.getQueryData<number>(unreadKey), count: qc.getQueryData<number>(countKey) };
  };
  type Snapshot = Awaited<ReturnType<typeof snapshot>>;
  const restore = (ctx: Snapshot | undefined) => {
    if (!ctx) return;
    for (const [key, data] of ctx.lists) qc.setQueryData(key, data);
    qc.setQueryData(unreadKey, ctx.unread);
    qc.setQueryData(countKey, ctx.count);
  };
  const settle = () => {
    void qc.invalidateQueries({ queryKey: listKey });
    void qc.invalidateQueries({ queryKey: unreadKey });
    void qc.invalidateQueries({ queryKey: countKey });
  };
  const failed = (err: unknown, ctx: Snapshot | undefined) => {
    restore(ctx);
    toast.error(errorMessage(err));
  };
  /** Change the matching rows in every cached list, and drop them from the lists they no longer belong to. */
  const apply = (pick: (n: AppNotification) => boolean, change: (n: AppNotification) => AppNotification, leaves?: (key: readonly unknown[]) => boolean) => {
    for (const [key, data] of lists()) {
      if (!data) continue;
      const drop = leaves?.(key) ?? false;
      qc.setQueryData<InfiniteData<NotificationPage>>(key, {
        ...data,
        pages: data.pages.map((p) => ({ ...p, items: p.items.flatMap((n) => (pick(n) ? (drop ? [] : [change(n)]) : [n])) })),
      });
    }
  };
  const bump = (key: readonly unknown[], by: number) => qc.setQueryData<number>(key, (c) => (c === undefined ? c : Math.max(0, c + by)));

  /** Read or unread. */
  const read = useMutation({
    mutationFn: async ({ ids, read: on }: { ids: readonly string[]; read: boolean }) => {
      if (on) await markNotificationsRead(ids);
      else for (const id of ids) await markNotificationUnread(id);
    },
    onMutate: async ({ ids, read: on }) => {
      const ctx = await snapshot();
      const rows = [...cached(ids).values()];
      const changing = rows.filter((n) => (on ? n.readAt === null : n.readAt !== null));
      const now = new Date().toISOString();
      apply(
        (n) => changing.some((c) => c.id === n.id),
        (n) => ({ ...n, readAt: on ? now : null })
      );
      const sign = on ? -1 : 1;
      bump(unreadKey, sign * changing.length);
      bump(countKey, sign * changing.filter((n) => n.archivedAt === null).length);
      return ctx;
    },
    onError: (err, _v, ctx) => failed(err, ctx),
    onSettled: settle,
  });

  /** Done (out of the Inbox) or back to the Inbox. */
  const done = useMutation({
    mutationFn: ({ ids, done: on }: { ids: readonly string[]; done: boolean }) => setNotificationsDone(ids, on),
    onMutate: async ({ ids, done: on }) => {
      const ctx = await snapshot();
      const rows = [...cached(ids).values()];
      const changing = rows.filter((n) => (on ? n.archivedAt === null : n.archivedAt !== null));
      const now = new Date().toISOString();
      apply(
        (n) => changing.some((c) => c.id === n.id),
        (n) => ({ ...n, archivedAt: on ? now : null }),
        (key) => tabOf(key) === (on ? 'inbox' : 'done')
      );
      bump(countKey, (on ? -1 : 1) * changing.filter((n) => n.readAt === null).length);
      return ctx;
    },
    onError: (err, _v, ctx) => failed(err, ctx),
    onSettled: settle,
  });

  /** Every read notification still in the Inbox becomes Done. */
  const clearRead = useMutation({
    mutationFn: () => markReadNotificationsDone(),
    onMutate: async () => {
      const ctx = await snapshot();
      const now = new Date().toISOString();
      apply(
        (n) => n.readAt !== null && n.archivedAt === null,
        (n) => ({ ...n, archivedAt: now }),
        (key) => tabOf(key) === 'inbox'
      );
      return ctx;
    },
    onError: (err, _v, ctx) => failed(err, ctx),
    onSettled: settle,
  });

  const markAllRead = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onMutate: async () => {
      const ctx = await snapshot();
      const now = new Date().toISOString();
      apply(
        (n) => n.readAt === null,
        (n) => ({ ...n, readAt: now })
      );
      qc.setQueryData<number>(unreadKey, 0);
      qc.setQueryData<number>(countKey, 0);
      return ctx;
    },
    onError: (err, _v, ctx) => failed(err, ctx),
    onSettled: settle,
  });

  return { read, done, clearRead, markAllRead };
}
