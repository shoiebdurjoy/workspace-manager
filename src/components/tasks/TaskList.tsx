import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronRight, ClipboardList, Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { TaskPatch } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { useTaskView } from '@/hooks/use-task-view';
import {
  useBulkTasks,
  useCreateTask,
  useListTasks,
  useMoveTask,
  useSetAssignee,
  useUpdateTask,
  type BulkAction,
} from '@/hooks/use-tasks';
import { useWorkspaceMembers } from '@/hooks/use-team';
import { can } from '@/lib/permissions';
import { hierarchyPaths } from '@/lib/hierarchy';
import { TASK_LOAD_CAP, taskAccess, validateTaskTitle } from '@/lib/tasks';
import { buildView, canReorderInView, countActiveFilters, type TaskGroup } from '@/lib/task-view';
import type { AssigneeRole, HierarchyList, HierarchySpace, TaskPriority, TaskStatus, TaskSummary, WorkspaceMember } from '@/types/database';
import BulkBar from './BulkBar';
import DeleteTaskDialog from './DeleteTaskDialog';
import TaskDialog from './TaskDialog';
import TaskRow, { LINKS_COLUMN, ROW_GRID } from './TaskRow';
import TaskToolbar from './TaskToolbar';
import { PriorityFlag, TaskStatusPill } from './TaskBadges';

interface TaskListProps {
  space: HierarchySpace;
  list: HierarchyList;
  selectedTaskId?: string;
  /** The order tasks are shown in (after filters, sort and grouping), for previous / next in the sheet. */
  onVisibleOrder?: (taskIds: string[]) => void;
}

/** A stable empty list: a fresh `[]` default on every render would invalidate every memo below. */
const NO_MEMBERS: readonly WorkspaceMember[] = [];

const COLUMN = 'text-[11px] font-medium uppercase tracking-wide text-muted-foreground';

/** Title-only entry. Inside a group the new task gets the group's status / priority / editor. */
const QuickAdd: React.FC<{
  listId: string;
  group?: TaskGroup;
  inputRef?: React.Ref<HTMLInputElement>;
  autoFocus?: boolean;
  onDone?: () => void;
}> = ({ listId, group, inputRef, autoFocus, onDone }) => {
  const create = useCreateTask();
  const update = useUpdateTask();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const localRef = useRef<HTMLInputElement>(null);
  const label = group && group.kind !== 'none' ? `Add a task to ${group.label}` : 'Add a task';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = validateTaskTitle(title);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    try {
      const task = await create.mutateAsync({
        listId,
        title,
        ...(group?.kind === 'priority' && group.value ? { priority: group.value as TaskPriority } : {}),
        ...(group?.kind === 'editor' && group.value ? { editorId: group.value } : {}),
      });
      // tasks are created "To do"; a task added under another status group is moved there
      if (group?.kind === 'status' && group.value && group.value !== 'TODO') {
        await update.mutateAsync({ taskId: task.id, patch: { status: group.value as TaskStatus } });
      }
      setTitle('');
      localRef.current?.focus();
    } catch {
      // the hook already showed the error toast; keep the text so nothing is lost
    }
  };

  const id = `quick-add-${group?.key ?? 'list'}`;
  return (
    <form onSubmit={submit} noValidate className="px-2 py-1.5">
      <div className="flex items-center gap-2 pl-7">
        <Plus aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <input
          id={id}
          ref={(el) => {
            (localRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
            if (typeof inputRef === 'function') inputRef(el);
            else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
          }}
          value={title}
          autoFocus={autoFocus}
          onChange={(e) => {
            setTitle(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setTitle('');
              e.currentTarget.blur();
              onDone?.();
            }
          }}
          onBlur={() => !title && onDone?.()}
          placeholder={group && group.kind !== 'none' ? `${label} and press Enter` : 'Add a task and press Enter'}
          disabled={create.isPending}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {create.isPending && <Loader2 aria-label="Adding" className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 pl-[3.25rem] text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
};

const GroupLabel: React.FC<{ group: TaskGroup }> = ({ group }) => {
  if (group.kind === 'status' && group.value) return <TaskStatusPill status={group.value as TaskStatus} className="font-semibold uppercase tracking-wide" />;
  if (group.kind === 'priority' && group.value) return <PriorityFlag priority={group.value as TaskPriority} withLabel className="font-semibold" />;
  return <span className="text-sm font-semibold">{group.label}</span>;
};

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.closest('[role="dialog"],[role="menu"],[role="listbox"]'));

/**
 * The list workspace: everything about the list's tasks is visible and most of it is editable right
 * here (status, people, deadlines, priority, title, checklist), grouped and filtered the way the
 * person likes, with multi-select bulk actions and keyboard navigation. The detail sheet is for the
 * brief, links and the full checklist.
 */
const TaskList: React.FC<TaskListProps> = ({ space, list, selectedTaskId, onVisibleOrder }) => {
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const me = user?.id ?? null;
  const canCreate = can(role, 'task:create');
  const query = useListTasks(list.id);
  const members = useWorkspaceMembers().data ?? NO_MEMBERS;
  const { view, update: updateView, setFilters, toggleCollapsed, reset } = useTaskView(list.id);
  const updateTask = useUpdateTask();
  const setAssignee = useSetAssignee();
  const move = useMoveTask();
  const bulk = useBulkTasks();

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TaskSummary | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState<TaskSummary[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const quickAddRef = useRef<HTMLInputElement>(null);

  const tasks = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;
  const loadingMore = query.hasNextPage || query.isFetchingNextPage;
  const { groups, visible, matched } = useMemo(() => buildView(tasks, view, me, members), [tasks, view, me, members]);
  const visibleIds = useMemo(() => visible.map((t) => t.id), [visible]);
  const reorderable = canReorderInView(view) && can(role, 'task:edit-brief') && !loadingMore;
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const accessOf = useCallback(
    (t: TaskSummary) => taskAccess(role, { isAssignedEditor: !!me && t.editorId === me, currentStatus: t.status }),
    [role, me]
  );

  useEffect(() => onVisibleOrder?.(visibleIds), [visibleIds, onVisibleOrder]);
  // selection only ever contains tasks that still exist
  useEffect(() => {
    setChecked((prev) => {
      const next = new Set([...prev].filter((id) => byId.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [byId]);

  const taskHref = useCallback((id: string) => hierarchyPaths.task(space.id, list.id, id), [space.id, list.id]);
  const onPatch = useCallback((taskId: string, patch: TaskPatch) => updateTask.mutate({ taskId, patch }), [updateTask]);
  const onAssign = useCallback(
    (taskId: string, slot: AssigneeRole, userId: string | null) => setAssignee.mutate({ taskId, role: slot, userId }),
    [setAssignee]
  );
  const onMove = useCallback((taskId: string, direction: 'up' | 'down') => move.mutate({ taskId, direction }), [move]);
  const onDelete = useCallback((t: TaskSummary) => setDeleting(t), []);
  const onCheck = useCallback(
    (taskId: string, range: boolean) => {
      setChecked((prev) => {
        const next = new Set(prev);
        if (range && anchor && anchor !== taskId) {
          const a = visibleIds.indexOf(anchor);
          const b = visibleIds.indexOf(taskId);
          if (a >= 0 && b >= 0) {
            const [from, to] = a < b ? [a, b] : [b, a];
            for (const id of visibleIds.slice(from, to + 1)) next.add(id);
            return next;
          }
        }
        if (next.has(taskId)) next.delete(taskId);
        else next.add(taskId);
        return next;
      });
      setAnchor(taskId);
    },
    [anchor, visibleIds]
  );
  const toggleGroup = (group: TaskGroup, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      for (const t of group.tasks) {
        if (on) next.add(t.id);
        else next.delete(t.id);
      }
      return next;
    });
  const runBulk = (taskIds: string[], action: BulkAction, skipped: number) => {
    if (taskIds.length === 0) return;
    bulk.mutate(
      { taskIds, action },
      {
        onSuccess: () => {
          if (skipped > 0) {
            // not an error: the person's role does not allow that change on some of the selection
            toast.message(`${skipped} selected ${skipped === 1 ? 'task was' : 'tasks were'} skipped: your role cannot make that change there.`);
          }
        },
      }
    );
  };

  // keyboard: / search, n quick add, j/k (arrows) move, enter open, x select, esc clear
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || selectedTaskId) return;
      const at = activeId ? visibleIds.indexOf(activeId) : -1;
      const go = (i: number) => {
        const id = visibleIds[Math.max(0, Math.min(visibleIds.length - 1, i))];
        if (!id) return;
        setActiveId(id);
        document.querySelector(`[data-task-row="${id}"]`)?.scrollIntoView({ block: 'nearest' });
      };
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if ((e.key === 'n' || e.key === 'N') && canCreate) {
        e.preventDefault();
        quickAddRef.current?.focus();
      } else if (e.key === 'j' || e.key === 'ArrowDown') {
        if (!visibleIds.length) return;
        e.preventDefault();
        go(at + 1);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        if (!visibleIds.length) return;
        e.preventDefault();
        go(at < 0 ? 0 : at - 1);
      } else if (e.key === 'Enter' && activeId) {
        e.preventDefault();
        navigate(taskHref(activeId));
      } else if ((e.key === 'x' || e.key === 'X') && activeId) {
        e.preventDefault();
        onCheck(activeId, e.shiftKey);
      } else if (e.key === 'Escape') {
        // one step back at a time: first the selection, then the cursor
        if (checked.size) setChecked(new Set());
        else setActiveId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, visibleIds, selectedTaskId, canCreate, checked.size, navigate, taskHref, onCheck]);

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
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const selectedTasks = [...checked].map((id) => byId.get(id)).filter((t): t is TaskSummary => !!t);
  const filtersOn = countActiveFilters(view.filters) > 0;

  return (
    <section aria-label="Tasks" className={cn('space-y-3', checked.size > 0 && 'pb-20')}>
      {tasks.length === 0 ? (
        <>
          {canCreate && (
            <div className="rounded-xl border border-border/80 bg-card">
              <QuickAdd listId={list.id} inputRef={quickAddRef} />
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
            action={
              canCreate ? (
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  New task
                </Button>
              ) : undefined
            }
          />
        </>
      ) : (
        <>
          <TaskToolbar
            ref={searchRef}
            view={view}
            members={members}
            total={total}
            matched={matched}
            onFilters={setFilters}
            onView={updateView}
            onClear={reset}
            onNewTask={canCreate ? () => setCreating(true) : undefined}
          />
          {loadingMore && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 aria-hidden className="h-3 w-3 animate-spin" /> Loading the rest of this list ({tasks.length} of {total})...
            </p>
          )}
          {!loadingMore && total > tasks.length && (
            <p className="text-xs text-muted-foreground" role="note">
              Showing the first {TASK_LOAD_CAP.toLocaleString()} of {total.toLocaleString()} tasks. Narrow the list with filters.
            </p>
          )}

          <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-soft">
            {canCreate && (
              <div className="border-b border-border/70">
                <QuickAdd listId={list.id} inputRef={quickAddRef} />
              </div>
            )}
            <div role="presentation" className={cn('hidden border-b border-border/70 bg-muted/40 px-2 py-1.5', ROW_GRID)}>
              <span />
              <span className={cn(COLUMN, 'pl-6')}>Task</span>
              <span className={COLUMN}>Status</span>
              <span className={COLUMN}>People</span>
              <span className={cn(COLUMN, LINKS_COLUMN)}>Links</span>
              <span className={COLUMN}>QC due</span>
              <span className={COLUMN}>Client</span>
              <span className={cn(COLUMN, 'text-center')} aria-label="Priority">
                !
              </span>
              <span />
            </div>

            {matched === 0 && (
              <div className="px-4 py-10 text-center" role="status">
                <p className="text-sm font-medium">No tasks match these filters.</p>
                <Button variant="link" size="sm" onClick={reset}>
                  Clear filters
                </Button>
              </div>
            )}

            {groups.map((group) => {
              const collapsed = view.collapsed.includes(group.key);
              const allChecked = group.tasks.length > 0 && group.tasks.every((t) => checked.has(t.id));
              const someChecked = group.tasks.some((t) => checked.has(t.id));
              const showHeader = view.groupBy !== 'none';
              return (
                <div key={group.key} role="group" aria-label={showHeader ? `${group.label}, ${group.tasks.length}` : 'Tasks'}>
                  {showHeader && (
                    <div className="group/header sticky top-0 z-20 flex items-center gap-2 border-b border-border/60 bg-card/95 px-2 py-1.5 backdrop-blur">
                      <Checkbox
                        checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                        onCheckedChange={(v) => toggleGroup(group, v === true)}
                        aria-label={`Select all in ${group.label}`}
                        className={cn(!someChecked && 'md:opacity-0 md:group-hover/header:opacity-100 md:focus-visible:opacity-100')}
                      />
                      <button
                        type="button"
                        onClick={() => toggleCollapsed(group.key)}
                        aria-expanded={!collapsed}
                        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.label}`}
                        className="inline-flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronRight aria-hidden className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', !collapsed && 'rotate-90')} />
                        <GroupLabel group={group} />
                        <span className="text-xs tabular-nums text-muted-foreground">{group.tasks.length}</span>
                      </button>
                      {canCreate && !collapsed && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-7 px-2 text-xs text-muted-foreground md:opacity-0 md:group-hover/header:opacity-100 md:focus-visible:opacity-100"
                          onClick={() => setAddingIn(group.key)}
                          aria-label={`Add a task to ${group.label}`}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" /> Add task
                        </Button>
                      )}
                    </div>
                  )}
                  {!collapsed && (
                    <ul aria-label={showHeader ? `Tasks: ${group.label}` : `Tasks in ${list.name}`}>
                      {group.tasks.map((task, index) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          href={taskHref(task.id)}
                          open={task.id === selectedTaskId}
                          checked={checked.has(task.id)}
                          active={task.id === activeId}
                          members={members}
                          access={accessOf(task)}
                          canReorder={reorderable}
                          isFirst={index === 0}
                          isLast={index === group.tasks.length - 1}
                          busy={move.isPending}
                          onCheck={onCheck}
                          onPatch={onPatch}
                          onAssign={onAssign}
                          onMove={onMove}
                          onDelete={onDelete}
                          onFocusRow={setActiveId}
                        />
                      ))}
                    </ul>
                  )}
                  {addingIn === group.key && !collapsed && (
                    <div className="border-b border-border/60">
                      <QuickAdd listId={list.id} group={group} autoFocus onDone={() => setAddingIn(null)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {filtersOn && matched > 0 && <span className="sr-only">Filters are on.</span>}
        </>
      )}

      {checked.size > 0 && (
        <BulkBar
          selected={selectedTasks}
          accessOf={accessOf}
          members={members}
          busy={bulk.isPending}
          onRun={runBulk}
          onDelete={(ts) => setBulkDeleting(ts)}
          onClear={() => setChecked(new Set())}
        />
      )}

      {creating && (
        <TaskDialog
          listId={list.id}
          listName={list.name}
          onClose={() => setCreating(false)}
          onCreated={(task) => {
            setCreating(false);
            navigate(taskHref(task.id));
          }}
        />
      )}
      {deleting && (
        <DeleteTaskDialog
          task={deleting}
          subtaskCount={deleting.subtaskTotal}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            const wasOpen = deleting.id === selectedTaskId;
            setDeleting(null);
            if (wasOpen) navigate(hierarchyPaths.list(space.id, list.id), { replace: true });
          }}
        />
      )}
      {bulkDeleting && (
        <AlertDialog open onOpenChange={(o) => !o && !bulk.isPending && setBulkDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete {bulkDeleting.length} {bulkDeleting.length === 1 ? 'task' : 'tasks'}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                The selected tasks, their assignments and their subtasks will be permanently deleted. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={bulk.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={bulk.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  const ids = bulkDeleting.map((t) => t.id);
                  bulk.mutate(
                    { taskIds: ids, action: { kind: 'delete' } },
                    {
                      onSettled: () => {
                        setBulkDeleting(null);
                        setChecked(new Set());
                        if (selectedTaskId && ids.includes(selectedTaskId)) navigate(hierarchyPaths.list(space.id, list.id), { replace: true });
                      },
                    }
                  );
                }}
              >
                {bulk.isPending ? 'Deleting...' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </section>
  );
};

export default TaskList;
