import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { useCreateTask, useListTasks, useMoveTask } from '@/hooks/use-tasks';
import { useWorkspaceMembers } from '@/hooks/use-team';
import { can } from '@/lib/permissions';
import { hierarchyPaths } from '@/lib/hierarchy';
import { validateTaskTitle } from '@/lib/tasks';
import type { HierarchyList, HierarchySpace } from '@/types/database';
import { memberLookup } from '@/lib/tasks';
import DeleteTaskDialog from './DeleteTaskDialog';
import TaskDialog from './TaskDialog';
import TaskRow, { ROW_GRID } from './TaskRow';

interface TaskListProps {
  space: HierarchySpace;
  list: HierarchyList;
  selectedTaskId?: string;
}

const COLUMN = 'text-[11px] font-medium uppercase tracking-wide text-muted-foreground';

/** Title-only entry: type, press Enter, the task is appended and the field is ready for the next one. */
const QuickAdd: React.FC<{ listId: string }> = ({ listId }) => {
  const create = useCreateTask();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = validateTaskTitle(title);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    try {
      await create.mutateAsync({ listId, title });
      setTitle('');
      inputRef.current?.focus();
    } catch {
      // the hook already showed the error toast; keep the text so nothing is lost
    }
  };

  return (
    <form onSubmit={submit} noValidate className="border-b border-border/70 px-3 py-2">
      <div className="flex items-center gap-2">
        <Plus aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        <label htmlFor="quick-add-task" className="sr-only">
          Add a task
        </label>
        <Input
          id="quick-add-task"
          ref={inputRef}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Add a task and press Enter"
          disabled={create.isPending}
          aria-invalid={!!error}
          aria-describedby={error ? 'quick-add-task-error' : undefined}
          className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
        />
        {create.isPending && <Loader2 aria-label="Adding" className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && (
        <p id="quick-add-task-error" role="alert" className="mt-1 pl-6 text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
};

const TaskList: React.FC<TaskListProps> = ({ space, list, selectedTaskId }) => {
  const navigate = useNavigate();
  const { role } = useAuth();
  const canCreate = can(role, 'task:create');
  const canDelete = can(role, 'task:delete');
  const canReorder = can(role, 'task:edit-brief');
  const query = useListTasks(list.id);
  const { data: members } = useWorkspaceMembers();
  const move = useMoveTask();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; title: string; subtasks: number } | null>(null);

  const lookup = useMemo(() => memberLookup(members), [members]);
  const tasks = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;
  const openTask = (taskId: string) => hierarchyPaths.task(space.id, list.id, taskId);

  const newTaskButton = canCreate ? (
    <Button size="sm" onClick={() => setCreating(true)}>
      <Plus className="mr-1.5 h-4 w-4" />
      New task
    </Button>
  ) : null;

  if (query.isError) {
    return (
      <ErrorState
        title="The tasks could not be loaded"
        message={query.error instanceof Error ? query.error.message : 'Please try again.'}
        onRetry={() => void query.refetch()}
      />
    );
  }

  if (query.isLoading) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading tasks">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <section aria-label="Tasks" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Tasks <span className="ml-1 text-xs font-normal text-muted-foreground tabular-nums">{total}</span>
        </h2>
        {tasks.length > 0 && newTaskButton}
      </div>

      {tasks.length === 0 ? (
        <>
          {canCreate && (
            <div className="rounded-xl border border-border/80 bg-card">
              <QuickAdd listId={list.id} />
            </div>
          )}
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" />}
            title="No tasks in this list yet"
            description={
              canCreate
                ? 'Each task is one video deliverable: add the brief, assign an editor and a QC reviewer, set the deadlines and keep the links together. Type a title above to start, or use New task for the full form.'
                : 'Tasks added to this list by a Production Manager will appear here.'
            }
            action={newTaskButton ?? undefined}
          />
        </>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-soft">
          {canCreate && <QuickAdd listId={list.id} />}
          <div role="presentation" className={`hidden border-b border-border/70 bg-muted/40 px-3 py-2 ${ROW_GRID}`}>
            <span className={COLUMN}>Status</span>
            <span className={COLUMN}>Task</span>
            <span className={COLUMN}>People</span>
            <span className={COLUMN}>QC due</span>
            <span className={COLUMN}>Client</span>
            <span className={COLUMN} aria-label="Priority">
              !
            </span>
            <span />
          </div>
          <ul aria-label={`Tasks in ${list.name}`}>
            {tasks.map((task, index) => (
              <TaskRow
                key={task.id}
                task={task}
                href={openTask(task.id)}
                selected={task.id === selectedTaskId}
                lookup={lookup}
                canReorder={canReorder}
                canDelete={canDelete}
                isFirst={index === 0}
                isLast={index === tasks.length - 1 && !query.hasNextPage}
                busy={move.isPending}
                onMove={(direction) => move.mutate({ taskId: task.id, direction })}
                onDelete={() => setDeleting({ id: task.id, title: task.title, subtasks: task.subtaskTotal })}
              />
            ))}
          </ul>
          {query.hasNextPage && (
            <div className="border-t border-border/70 p-2 text-center">
              <Button variant="ghost" size="sm" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                {query.isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Show more ({total - tasks.length} more)
              </Button>
            </div>
          )}
        </div>
      )}

      {creating && (
        <TaskDialog
          listId={list.id}
          listName={list.name}
          onClose={() => setCreating(false)}
          onCreated={(task) => {
            setCreating(false);
            navigate(openTask(task.id));
          }}
        />
      )}
      {deleting && (
        <DeleteTaskDialog
          task={deleting}
          subtaskCount={deleting.subtasks}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            const wasOpen = deleting.id === selectedTaskId;
            setDeleting(null);
            if (wasOpen) navigate(hierarchyPaths.list(space.id, list.id), { replace: true });
          }}
        />
      )}
    </section>
  );
};

export default TaskList;
