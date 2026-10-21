import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, FilePlus2, FileX2, MessageSquare, Pencil, Plus, UserMinus, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ACTIVITY_PAGE_SIZE } from '@/database';
import { useHierarchy } from '@/hooks/use-hierarchy';
import { useTaskActivity } from '@/hooks/use-collaboration';
import { useWorkspaceMembers } from '@/hooks/use-team';
import { useWorkflow } from '@/hooks/use-workflow';
import { describeActivity, timeAgo, type ActivityLine } from '@/lib/collaboration';
import { findListById } from '@/lib/hierarchy';
import { memberLookup } from '@/lib/tasks';

const ICONS: Record<string, React.ReactNode> = {
  created: <Plus className="h-3.5 w-3.5" />,
  updated: <Pencil className="h-3.5 w-3.5" />,
  status: <ArrowRightLeft className="h-3.5 w-3.5" />,
  assigned: <UserPlus className="h-3.5 w-3.5" />,
  unassigned: <UserMinus className="h-3.5 w-3.5" />,
  commented: <MessageSquare className="h-3.5 w-3.5" />,
  attachment_added: <FilePlus2 className="h-3.5 w-3.5" />,
  attachment_removed: <FileX2 className="h-3.5 w-3.5" />,
};

interface ActivityFeedProps {
  taskId: string;
  /** Jump to a comment from its "commented" entry. */
  onOpenComment?: (commentId: string) => void;
}

/**
 * What really happened to this task, newest first: every line is a row the database wrote when the event
 * happened (stage changes from the status history, everything else from the activity log). Nothing before
 * the log existed is invented.
 */
const ActivityFeed: React.FC<ActivityFeedProps> = ({ taskId, onOpenComment }) => {
  const [limit, setLimit] = useState(ACTIVITY_PAGE_SIZE);
  const feed = useTaskActivity(taskId, limit);
  const { data: members } = useWorkspaceMembers();
  const workflow = useWorkflow().data;
  const { data: tree } = useHierarchy();
  const lookup = useMemo(() => memberLookup(members), [members]);

  const lines: ActivityLine[] = useMemo(
    () =>
      (feed.data?.entries ?? []).map((e) =>
        describeActivity(e, { members: lookup, workflow, listName: (id) => (tree ? findListById(tree, id)?.list.name : undefined) })
      ),
    [feed.data, lookup, workflow, tree]
  );

  if (feed.isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading activity">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
    );
  }
  if (feed.isError) {
    return <ErrorState title="Activity could not be loaded" message={feed.error instanceof Error ? feed.error.message : 'Please try again.'} onRetry={() => void feed.refetch()} />;
  }
  if (lines.length === 0) {
    return <p className="py-3 text-center text-xs text-muted-foreground">Nothing has happened to this task yet.</p>;
  }

  return (
    <div className="space-y-3">
      <ol className="space-y-3" aria-label="Activity">
        {lines.map((l) => (
          <li key={l.id} className="flex gap-2.5 text-sm">
            <span aria-hidden className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              {ICONS[l.kind] ?? ICONS.updated}
            </span>
            <div className="min-w-0 flex-1">
              <p className="leading-snug">
                <span className="font-medium">{l.actor}</span> {l.text}
                {l.commentId && onOpenComment && (
                  <>
                    {' · '}
                    <button type="button" className="text-primary underline underline-offset-2 hover:no-underline" onClick={() => onOpenComment(l.commentId as string)}>
                      view
                    </button>
                  </>
                )}
              </p>
              {l.detail && <p className="mt-0.5 whitespace-pre-wrap break-words rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground">{l.detail}</p>}
              <time dateTime={l.createdAt} title={new Date(l.createdAt).toLocaleString()} className="text-[11px] text-muted-foreground">
                {timeAgo(l.createdAt)}
              </time>
            </div>
          </li>
        ))}
      </ol>
      {feed.data?.hasMore && (
        <div className="text-center">
          <Button type="button" variant="outline" size="sm" disabled={feed.isFetching} onClick={() => setLimit((n) => n + ACTIVITY_PAGE_SIZE)}>
            Show older activity
          </Button>
        </div>
      )}
    </div>
  );
};

export default ActivityFeed;
