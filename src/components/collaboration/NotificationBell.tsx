import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, Bell, CheckCheck, MessageSquare, MoreHorizontal, UserPlus, ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/use-auth';
import { useNotificationActions, useNotificationRealtime, useNotifications, useUnreadCount } from '@/hooks/use-collaboration';
import { useWorkspaceMembers } from '@/hooks/use-team';
import { useWorkflow } from '@/hooks/use-workflow';
import { can } from '@/lib/permissions';
import { describeNotification, timeAgo } from '@/lib/collaboration';
import { memberLookup } from '@/lib/tasks';
import type { NotificationKind } from '@/types/database';
import { cn } from '@/lib/utils';

const ICONS: Record<NotificationKind, React.ReactNode> = {
  mention: <AtSign className="h-3.5 w-3.5" />,
  comment: <MessageSquare className="h-3.5 w-3.5" />,
  assigned: <UserPlus className="h-3.5 w-3.5" />,
  status: <ArrowRightLeft className="h-3.5 w-3.5" />,
};

/**
 * The notification centre. Every row is something the database recorded for this person (a mention, an
 * assignment, a comment on their task, their task changing stage); nothing is invented. The badge is the
 * unread count; it is live (Realtime) and also refreshes when the window regains focus.
 */
const NotificationBell: React.FC = () => {
  const { role } = useAuth();
  const navigate = useNavigate();
  const staff = can(role, 'comments:view-internal');
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  useNotificationRealtime();
  const unread = useUnreadCount();
  const list = useNotifications(open);
  const { markRead, markAllRead, markUnread } = useNotificationActions();
  const { data: members } = useWorkspaceMembers();
  const workflow = useWorkflow().data;
  const lookup = useMemo(() => memberLookup(members), [members]);

  const count = unread.data ?? 0;
  const lines = useMemo(
    () => (list.data?.pages.flatMap((p) => p.items) ?? []).map((n) => ({ n, line: describeNotification(n, lookup, workflow) })),
    [list.data, lookup, workflow]
  );
  const shown = unreadOnly ? lines.filter((l) => l.line.unread) : lines;

  const label = !staff ? 'Notifications' : count > 0 ? `Notifications, ${count} unread` : 'Notifications';

  const go = (id: string, to: string, wasUnread: boolean) => {
    if (wasUnread) markRead.mutate([id]);
    setOpen(false);
    navigate(to);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span className="relative inline-flex">
          <IconButton aria-label={label} tooltip="Notifications" icon={<Bell className="h-4 w-4" />} variant="ghost" size="sm" />
          {staff && count > 0 && (
            <span
              aria-hidden
              data-testid="unread-badge"
              className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-background"
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          <div className="ml-auto flex items-center gap-1" role="group" aria-label="Show">
            {(['All', 'Unread'] as const).map((f) => (
              <Button
                key={f}
                type="button"
                size="sm"
                variant={(f === 'Unread') === unreadOnly ? 'secondary' : 'ghost'}
                className="h-7 px-2 text-xs"
                aria-pressed={(f === 'Unread') === unreadOnly}
                onClick={() => setUnreadOnly(f === 'Unread')}
              >
                {f}
              </Button>
            ))}
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={count === 0 || markAllRead.isPending} onClick={() => markAllRead.mutate()}>
              <CheckCheck className="mr-1 h-3.5 w-3.5" />
              Mark all read
            </Button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {!staff ? (
            <p className="p-4 text-xs text-muted-foreground">Notifications are for the production team.</p>
          ) : list.isLoading ? (
            <div className="space-y-2 p-3" role="status" aria-label="Loading notifications">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : list.isError ? (
            <div className="space-y-2 p-4 text-xs" role="alert">
              <p className="text-destructive">{list.error instanceof Error ? list.error.message : 'Notifications could not be loaded.'}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void list.refetch()}>
                Try again
              </Button>
            </div>
          ) : shown.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">{unreadOnly && lines.length > 0 ? 'No unread notifications.' : "You're all caught up. Mentions, assignments and changes to your tasks show up here."}</p>
          ) : (
            <ul aria-label="Notifications">
              {shown.map(({ n, line }) => (
                <li key={n.id} className={cn('group relative flex items-start gap-2 border-b border-border/50 px-3 py-2.5 last:border-b-0', line.unread && 'bg-primary/5')}>
                  <button type="button" onClick={() => go(n.id, line.to, line.unread)} className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span aria-hidden className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      {ICONS[n.kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-1.5">
                        <span className={cn('line-clamp-2 break-words text-sm', line.unread ? 'font-semibold' : 'font-medium')}>{line.headline}</span>
                        {line.unread && <span className="sr-only">(unread)</span>}
                        {line.unread && <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                      </span>
                      <span className="line-clamp-2 break-words text-xs text-muted-foreground">{line.detail}</span>
                      <time dateTime={line.createdAt} className="text-[11px] text-muted-foreground">
                        {timeAgo(line.createdAt)}
                      </time>
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton aria-label="Notification actions" icon={<MoreHorizontal className="h-4 w-4" />} variant="ghost" size="sm" className="h-7 w-7 shrink-0" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      {line.unread ? (
                        <DropdownMenuItem className="cursor-pointer text-xs" onSelect={() => markRead.mutate([n.id])}>
                          Mark as read
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem className="cursor-pointer text-xs" onSelect={() => markUnread.mutate(n.id)}>
                          Mark as unread
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          )}
          {staff && (
            <div className="border-t border-border/50 p-2 text-center">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => {
                  setOpen(false);
                  navigate('/inbox');
                }}
              >
                Open Inbox
              </Button>
            </div>
          )}
          {list.hasNextPage && (
            <div className="border-t border-border/50 p-2 text-center">
              <Button type="button" size="sm" variant="ghost" className="text-xs" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {list.isFetchingNextPage ? 'Loading…' : 'Load older'}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
