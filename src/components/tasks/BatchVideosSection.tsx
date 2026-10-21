import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useAuth } from '@/hooks/use-auth';
import { useBatchProgress, useBatchVideos, useCreateBatchVideo } from '@/hooks/use-batches';
import { useTask } from '@/hooks/use-tasks';
import { useWorkspaceMembers } from '@/hooks/use-team';
import { can } from '@/lib/permissions';
import { formatDay, memberLookup, memberName } from '@/lib/tasks';
import type { TaskDetail } from '@/types/database';
import { TaskStatusPill } from './TaskBadges';

interface BatchVideosSectionProps {
  task: Pick<TaskDetail, 'id' | 'parentId'>;
  /** Where a task's sheet lives (the same path logic the sheet uses for previous / next). */
  taskPath: (taskId: string) => string;
}

const Heading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-1.5">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
  </div>
);

/** A video of this task's batch points up to it: "Part of <batch>". */
const PartOf: React.FC<{ parentId: string; taskPath: (id: string) => string }> = ({ parentId, taskPath }) => {
  const parent = useTask(parentId);
  return (
    <section aria-label="Batch" className="space-y-2.5">
      <Heading>Batch</Heading>
      <div className="text-sm text-muted-foreground">
        Part of{' '}
        {parent.data ? (
          <Link to={taskPath(parentId)} className="font-medium text-brand hover:underline">
            {parent.data.title}
          </Link>
        ) : parent.isLoading ? (
          <Skeleton className="inline-block h-4 w-32 align-middle" />
        ) : (
          <span>a batch you cannot open</span>
        )}
      </div>
    </section>
  );
};

/**
 * The videos of a batch (Phase 12): progress, one row per video (its own stage, editor and due date) and
 * "Add video" for the roles that can create tasks. A video shows a link to its batch instead. Hidden when
 * the task has no videos and the person cannot add any.
 */
const BatchVideosSection: React.FC<BatchVideosSectionProps> = ({ task, taskPath }) => {
  const { role } = useAuth();
  const canAdd = can(role, 'task:create');
  const isVideo = !!task.parentId;
  const videos = useBatchVideos(isVideo ? undefined : task.id);
  const progress = useBatchProgress(isVideo ? undefined : task.id);
  const { data: members } = useWorkspaceMembers();
  const create = useCreateBatchVideo(task.id);
  const [title, setTitle] = useState('');

  if (task.parentId) return <PartOf parentId={task.parentId} taskPath={taskPath} />;

  const rows = videos.data ?? [];
  if (!canAdd && !videos.isLoading && !videos.isError && rows.length === 0) return null;

  const lookup = memberLookup(members);
  const total = progress.data?.total ?? rows.length;
  const finished = progress.data?.finished ?? 0;

  const add = () => {
    const clean = title.trim();
    if (!clean || create.isPending) return;
    create.mutate({ title: clean }, { onSuccess: () => setTitle('') });
  };

  return (
    <section aria-label="Videos" className="space-y-2.5">
      <Heading>Videos</Heading>

      {videos.isLoading ? (
        <div className="space-y-2" aria-label="Loading videos">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : videos.isError ? (
        <div role="alert" className="flex items-center justify-between gap-3 text-sm text-destructive">
          <span>The videos could not be loaded.</span>
          <Button variant="outline" size="sm" onClick={() => void videos.refetch()}>
            Try again
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No videos yet. Add one below to turn this task into a batch.</p>
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {finished} of {total} {total === 1 ? 'video' : 'videos'} finished
            </p>
            <div
              role="progressbar"
              aria-label="Videos finished"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={finished}
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full rounded-full bg-brand" style={{ width: `${total ? Math.round((finished / total) * 100) : 0}%` }} />
            </div>
          </div>
          <ul className="divide-y divide-border/60">
            {rows.map((v) => {
              const member = v.editorId ? lookup.get(v.editorId) : undefined;
              return (
                <li key={v.id} className="flex items-center gap-3 py-1.5">
                  <Link to={taskPath(v.id)} className="min-w-0 flex-1 truncate text-sm font-medium text-foreground transition-colors hover:text-brand hover:underline">
                    {v.title}
                  </Link>
                  <TaskStatusPill status={v.status} />
                  <span className="flex w-28 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    {v.editorId ? (
                      <>
                        <UserAvatar name={memberName(lookup, v.editorId)} src={member?.profile?.avatarUrl ?? undefined} size="xs" />
                        <span className="truncate">{memberName(lookup, v.editorId)}</span>
                      </>
                    ) : (
                      'Unassigned'
                    )}
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{formatDay(v.dueDate)}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {canAdd && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input
            aria-label="Add video"
            placeholder="Add video, press Enter"
            value={title}
            maxLength={500}
            disabled={create.isPending}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={!title.trim() || create.isPending}>
            <Plus aria-hidden className="mr-1 h-4 w-4" />
            Add
          </Button>
        </form>
      )}
    </section>
  );
};

export default BatchVideosSection;
