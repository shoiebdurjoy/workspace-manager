import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArchiveRestore, ArrowRightLeft, AtSign, Check, CheckCheck, Inbox, MailOpen, Mail, MessageSquare, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { useInboxActions, useInboxNotifications } from '@/hooks/use-inbox';
import { useWorkspaceMembers } from '@/hooks/use-team';
import { useWorkflow } from '@/hooks/use-workflow';
import {
  INBOX_KINDS,
  INBOX_KIND_LABELS,
  describeNotification,
  groupByDay,
  readInboxParams,
  timeAgo,
  writeInboxParams,
  type InboxState,
  type InboxTab,
} from '@/lib/collaboration';
import { memberLookup } from '@/lib/tasks';
import { cn } from '@/lib/utils';
import type { AppNotification, NotificationKind } from '@/types/database';

const ICONS: Record<NotificationKind, React.ReactNode> = {
  mention: <AtSign className="h-3.5 w-3.5" />,
  comment: <MessageSquare className="h-3.5 w-3.5" />,
  assigned: <UserPlus className="h-3.5 w-3.5" />,
  status: <ArrowRightLeft className="h-3.5 w-3.5" />,
};

const TABS: ReadonlyArray<{ value: InboxTab; label: string }> = [
  { value: 'inbox', label: 'Inbox' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All' },
];

const EMPTY: Record<InboxTab, { title: string; description: string }> = {
  inbox: { title: "You're all caught up", description: 'Mentions, assignments, comments on your tasks and stage changes arrive here.' },
  done: { title: 'Nothing marked Done yet', description: 'Mark a notification Done to clear it from your Inbox. It stays here.' },
  all: { title: 'No notifications yet', description: 'Mentions, assignments, comments on your tasks and stage changes arrive here.' },
};

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * The Inbox: everything the database recorded for this person (mentions, comments on their tasks,
 * assignments, stage changes), by tab. "Done" clears a notification from the Inbox without losing it.
 * Keyboard: j / k (or the arrows) move, Enter opens, e marks Done (or back), u toggles read.
 */
const InboxPage: React.FC = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => readInboxParams(params), [params]);
  const list = useInboxNotifications(state);
  const { read, done, clearRead, markAllRead } = useInboxActions();
  const { data: members } = useWorkspaceMembers();
  const workflow = useWorkflow().data;
  const lookup = useMemo(() => memberLookup(members), [members]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    document.title = 'Inbox · TBB Workspace';
  }, []);

  // the tab decides what belongs: an optimistic change can leave a row that no longer does for a moment
  const items = useMemo(() => {
    const all = list.data?.pages.flatMap((p) => p.items) ?? [];
    return all.filter((n) => (state.tab === 'inbox' ? n.archivedAt === null : state.tab === 'done' ? n.archivedAt !== null : true));
  }, [list.data, state.tab]);
  const groups = useMemo(() => groupByDay(items), [items]);
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const hasUnread = items.some((n) => n.readAt === null);
  const hasRead = state.tab === 'inbox' && items.some((n) => n.readAt !== null);

  const update = useCallback((change: Partial<InboxState>) => setParams((prev) => writeInboxParams(prev, change), { replace: true }), [setParams]);
  const toggleKind = (kind: NotificationKind) =>
    update({ kinds: state.kinds.includes(kind) ? state.kinds.filter((k) => k !== kind) : [...state.kinds, kind] });

  const open = useCallback(
    (n: AppNotification) => {
      const line = describeNotification(n, lookup, workflow);
      if (n.readAt === null) read.mutate({ ids: [n.id], read: true });
      navigate(line.to);
    },
    [lookup, workflow, read, navigate]
  );
  const toggleRead = useCallback((n: AppNotification) => read.mutate({ ids: [n.id], read: n.readAt === null }), [read]);
  const toggleDone = useCallback((n: AppNotification) => done.mutate({ ids: [n.id], done: n.archivedAt === null }), [done]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (ordered.length === 0) return;
      const index = activeId ? ordered.findIndex((n) => n.id === activeId) : -1;
      const current = index >= 0 ? ordered[index] : undefined;
      const moveTo = (i: number) => {
        const next = ordered[Math.max(0, Math.min(ordered.length - 1, i))];
        setActiveId(next.id);
        rowRefs.current.get(next.id)?.scrollIntoView?.({ block: 'nearest' });
      };
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          moveTo(index + 1);
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          moveTo(index < 0 ? 0 : index - 1);
          break;
        case 'Enter':
          if (current) {
            e.preventDefault();
            open(current);
          }
          break;
        case 'e':
          if (current) {
            e.preventDefault();
            // keep the place: the next row becomes active when this one leaves the tab
            const after = ordered[index + 1] ?? ordered[index - 1];
            toggleDone(current);
            if (state.tab !== 'all' && after) setActiveId(after.id);
          }
          break;
        case 'u':
          if (current) {
            e.preventDefault();
            toggleRead(current);
          }
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered, activeId, open, toggleDone, toggleRead, state.tab]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3 pt-1">
        <div>
          <h1 className="page-title">Inbox</h1>
          <p className="page-description">
            Mentions, comments on your tasks, assignments and stage changes. <span className="hidden sm:inline">Keys: j / k move, Enter opens, e Done, u read.</span>
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" disabled={!hasUnread || markAllRead.isPending} onClick={() => markAllRead.mutate()}>
            <CheckCheck className="mr-1 h-3.5 w-3.5" />
            Mark all read
          </Button>
          {state.tab === 'inbox' && (
            <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" disabled={!hasRead || clearRead.isPending} onClick={() => clearRead.mutate()}>
              <Check className="mr-1 h-3.5 w-3.5" />
              Clear read
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-3">
        <div role="tablist" aria-label="Inbox tabs" className="flex items-center gap-1">
          {TABS.map((t) => (
            <Button
              key={t.value}
              type="button"
              role="tab"
              size="sm"
              variant={state.tab === t.value ? 'secondary' : 'ghost'}
              aria-selected={state.tab === t.value}
              className="press h-8 rounded-full px-3.5 text-xs"
              onClick={() => update({ tab: t.value })}
            >
              {t.label}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1" role="group" aria-label="Filter notifications">
          {INBOX_KINDS.map((kind) => (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant={state.kinds.includes(kind) ? 'secondary' : 'outline'}
              aria-pressed={state.kinds.includes(kind)}
              className="press h-7 rounded-full px-3 text-xs"
              onClick={() => toggleKind(kind)}
            >
              {INBOX_KIND_LABELS[kind]}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant={state.unreadOnly ? 'secondary' : 'outline'}
            aria-pressed={state.unreadOnly}
            className="press h-7 rounded-full px-3 text-xs"
            onClick={() => update({ unreadOnly: !state.unreadOnly })}
          >
            Unread only
          </Button>
        </div>
      </div>

      {list.isError ? (
        <ErrorState
          title="Your notifications could not be loaded"
          message={list.error instanceof Error ? list.error.message : 'Please try again.'}
          onRetry={() => void list.refetch()}
        />
      ) : list.isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading notifications">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        state.kinds.length || state.unreadOnly ? (
          <div className="surface-card px-4 py-10 text-center" role="status">
            <p className="text-sm font-medium">No notifications match these filters.</p>
            <Button variant="link" size="sm" onClick={() => update({ kinds: [], unreadOnly: false })}>
              Clear filters
            </Button>
          </div>
        ) : (
          <EmptyState icon={<Inbox className="h-6 w-6" />} title={EMPTY[state.tab].title} description={EMPTY[state.tab].description} />
        )
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`inbox-${group.key}`}>
              <h2 id={`inbox-${group.key}`} className="mb-1 px-1 section-label">
                {group.label}
              </h2>
              <ul aria-label={group.label} className="overflow-hidden surface-card">
                {group.items.map((n) => {
                  const line = describeNotification(n, lookup, workflow);
                  const isDone = n.archivedAt !== null;
                  return (
                    <li
                      key={n.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(n.id, el);
                        else rowRefs.current.delete(n.id);
                      }}
                      data-notification={n.id}
                      aria-current={activeId === n.id ? 'true' : undefined}
                      onMouseDown={() => setActiveId(n.id)}
                      className={cn(
                        'group flex items-start gap-2 border-b border-border/50 px-3 py-2.5 last:border-b-0',
                        line.unread && 'bg-primary/5',
                        activeId === n.id && 'ring-2 ring-inset ring-ring'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => open(n)}
                        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span aria-hidden className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          {ICONS[n.kind]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start gap-1.5">
                            <span className={cn('line-clamp-2 break-words text-sm', line.unread ? 'font-semibold' : 'font-medium')}>{line.headline}</span>
                            {line.unread && <span className="sr-only">(unread)</span>}
                            {line.unread && <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                            {isDone && state.tab === 'all' && <span className="shrink-0 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">Done</span>}
                          </span>
                          <span className="line-clamp-2 break-words text-xs text-muted-foreground">{line.detail}</span>
                          <time dateTime={line.createdAt} className="text-[11px] text-muted-foreground">
                            {timeAgo(line.createdAt)}
                          </time>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                        <IconButton
                          aria-label={line.unread ? 'Mark as read' : 'Mark as unread'}
                          tooltip={line.unread ? 'Mark as read (u)' : 'Mark as unread (u)'}
                          icon={line.unread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7"
                          onClick={() => toggleRead(n)}
                        />
                        <IconButton
                          aria-label={isDone ? 'Move back to Inbox' : 'Mark as Done'}
                          tooltip={isDone ? 'Move back to Inbox (e)' : 'Done (e)'}
                          icon={isDone ? <ArchiveRestore className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7"
                          onClick={() => toggleDone(n)}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {list.hasNextPage && (
            <div className="text-center">
              <Button type="button" size="sm" variant="ghost" className="text-xs" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {list.isFetchingNextPage ? 'Loading…' : 'Load older'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default InboxPage;
