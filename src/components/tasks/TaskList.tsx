import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ClipboardList, Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
import { useHierarchy } from '@/hooks/use-hierarchy';
import { useTableColumns } from '@/hooks/use-table-columns';
import { useTaskView } from '@/hooks/use-task-view';
import { useViewMode } from '@/hooks/use-view-mode';
import { useBulkTasks, useListTasks, useMoveTask, useSetAssignee, useUpdateTask, type BulkAction } from '@/hooks/use-tasks';
import { useWorkspaceMembers } from '@/hooks/use-team';
import { useWorkflow } from '@/hooks/use-workflow';
import { can } from '@/lib/permissions';
import { hierarchyPaths } from '@/lib/hierarchy';
import { TASK_LOAD_CAP, taskAccess } from '@/lib/tasks';
import { buildView, canReorderInView, groupTasks, type TaskGroup } from '@/lib/task-view';
import { nextSort } from '@/lib/task-views';
import { initialStatus, movesFor } from '@/lib/workflow';
import type { AssigneeRole, HierarchyList, HierarchySpace, TaskSummary, WorkspaceMember } from '@/types/database';
import BoardView from './BoardView';
import BulkBar from './BulkBar';
import DeleteTaskDialog from './DeleteTaskDialog';
import ListView from './ListView';
import QuickAdd from './QuickAdd';
import TableView, { ColumnsMenu, type ListContext } from './TableView';
import TaskDialog from './TaskDialog';
import TaskToolbar from './TaskToolbar';
import ViewSwitcher from './ViewSwitcher';

interface TaskListProps {
  space: HierarchySpace;
  list: HierarchyList;
  selectedTaskId?: string;
  /** The order tasks are shown in (after filters, sort and grouping), for previous / next in the sheet. */
  onVisibleOrder?: (taskIds: string[]) => void;
}

/** A stable empty list: a fresh `[]` default on every render would invalidate every memo below. */
const NO_MEMBERS: readonly WorkspaceMember[] = [];

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.closest('[role="dialog"],[role="menu"],[role="listbox"]'));

/**
 * The task workspace of a list: the same tasks as a grouped List, a stage Board or a Table. All three
 * share one query, one set of filters, one selection (List and Table), the inline controls and the
 * workflow rules; only the layout differs. The detail sheet is for the brief, links and checklist.
 */
const TaskList: React.FC<TaskListProps> = ({ space, list, selectedTaskId, onVisibleOrder }) => {
  const navigate = useNavigate();
  const { search } = useLocation();
  const { role, user } = useAuth();
  const me = user?.id ?? null;
  const canCreate = can(role, 'task:create');
  const query = useListTasks(list.id);
  const members = useWorkspaceMembers().data ?? NO_MEMBERS;
  const tree = useHierarchy().data;
  const { view, update: updateView, setFilters, toggleCollapsed, reset } = useTaskView(list.id);
  const [mode, setMode] = useViewMode(list.id);
  const [columns, setColumns, resetColumns] = useTableColumns();
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
  const workflow = useWorkflow().data;
  const ctx = useMemo(() => ({ me, role, workflow, members }), [me, role, workflow, members]);
  const { groups, visible: groupedVisible, matched, items } = useMemo(() => buildView(tasks, view, ctx), [tasks, view, ctx]);

  // The board always has the stages as its columns; its reading order is column by column.
  const boardVisible = useMemo(
    () => (mode === 'board' ? groupTasks(items, 'status', ctx, { keepEmpty: true }).filter((g) => !view.collapsed.includes(g.key)).flatMap((g) => g.tasks) : []),
    [mode, items, ctx, view.collapsed]
  );
  const visible = mode === 'board' ? boardVisible : groupedVisible;
  const visibleIds = useMemo(() => visible.map((t) => t.id), [visible]);
  const reorderable = mode === 'list' && canReorderInView(view) && can(role, 'task:edit-brief') && !loadingMore;
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const accessOf = useCallback((t: TaskSummary) => taskAccess(role, { isAssignedEditor: !!me && t.editorId === me }), [role, me]);

  // where each task lives (the table's List column)
  const contexts = useMemo(() => {
    const map = new Map<string, ListContext>();
    for (const sp of tree ?? []) {
      for (const l of sp.folderlessLists) map.set(l.id, { listName: l.name, folderName: null, spaceName: sp.name });
      for (const f of sp.folders) for (const l of f.lists) map.set(l.id, { listName: l.name, folderName: f.name, spaceName: sp.name });
    }
    return map;
  }, [tree]);
  const contextOf = useCallback((t: TaskSummary) => contexts.get(t.listId), [contexts]);

  /** A new task starts at the first stage; it can be added straight into a group one plain step away. */
  const canAddIn = useCallback(
    (group: TaskGroup) => {
      if (group.kind !== 'status') return true;
      const first = initialStatus(workflow)?.key;
      if (!first || group.value === first) return true;
      return movesFor(workflow, { status: first, editorId: null }, { role, isAssignedEditor: false }).some(
        (m) => m.to.key === group.value && m.allowed && !m.override && m.needs.length === 0
      );
    },
    [workflow, role]
  );

  useEffect(() => onVisibleOrder?.(visibleIds), [visibleIds, onVisibleOrder]);
  // selection only ever contains tasks that still exist
  useEffect(() => {
    setChecked((prev) => {
      const next = new Set([...prev].filter((id) => byId.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [byId]);
  // the board has no checkboxes: a selection made elsewhere would be invisible there
  useEffect(() => {
    if (mode === 'board') setChecked((prev) => (prev.size ? new Set() : prev));
  }, [mode]);

  // Opening a task keeps the URL's view and filters, so closing the sheet returns to the same screen.
  const listHref = `${hierarchyPaths.list(space.id, list.id)}${search}`;
  const taskHref = useCallback((id: string) => `${hierarchyPaths.task(space.id, list.id, id)}${search}`, [space.id, list.id, search]);
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
  const toggleIds = useCallback(
    (ids: readonly string[], on: boolean) =>
      setChecked((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      }),
    []
  );
  const toggleGroup = (group: TaskGroup, on: boolean) => toggleIds(group.tasks.map((t) => t.id), on);
  const runBulk = (taskIds: string[], action: BulkAction, skipped: number, why?: string) => {
    if (taskIds.length === 0) return;
    bulk.mutate(
      { taskIds, action },
      {
        onSuccess: () => {
          if (skipped > 0) {
            // not an error: the person's role does not allow that change on some of the selection
            toast.message(
              `${skipped} selected ${skipped === 1 ? 'task was' : 'tasks were'} skipped: ${why ?? 'your role cannot make that change there'}.`
            );
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
        document.querySelector(`[data-task-row="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
      } else if ((e.key === 'x' || e.key === 'X') && activeId && mode !== 'board') {
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
  }, [activeId, visibleIds, selectedTaskId, canCreate, checked.size, mode, navigate, taskHref, onCheck]);

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
  const showGroups = view.groupBy !== 'none';

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
            lead={<ViewSwitcher mode={mode} onChange={setMode} />}
            hideGroup={mode === 'board'}
            trail={mode === 'table' ? <ColumnsMenu visible={columns} onChange={setColumns} onReset={resetColumns} /> : undefined}
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

          {mode !== 'list' && matched === 0 && (
            <div className="rounded-xl border border-border/80 bg-card px-4 py-10 text-center" role="status">
              <p className="text-sm font-medium">No tasks match these filters.</p>
              <Button variant="link" size="sm" onClick={reset}>
                Clear filters
              </Button>
            </div>
          )}

          {mode === 'list' && (
            <ListView
              groups={groups}
              groupBy={view.groupBy}
              collapsed={view.collapsed}
              checked={checked}
              listId={list.id}
              listName={list.name}
              canCreate={canCreate}
              canAddIn={canAddIn}
              members={members}
              accessOf={accessOf}
              taskHref={taskHref}
              openId={selectedTaskId}
              activeId={activeId}
              reorderable={reorderable}
              movePending={move.isPending}
              matched={matched}
              quickAddRef={quickAddRef}
              addingIn={addingIn}
              onAddingIn={setAddingIn}
              onToggleGroupChecked={toggleGroup}
              onToggleCollapsed={toggleCollapsed}
              onCheck={onCheck}
              onPatch={onPatch}
              onAssign={onAssign}
              onMove={onMove}
              onDelete={onDelete}
              onFocusRow={setActiveId}
              onClearFilters={reset}
            />
          )}

          {mode === 'board' && matched > 0 && (
            <BoardView
              tasks={items}
              members={members}
              listId={list.id}
              canAddIn={canAddIn}
              canCreate={canCreate}
              openId={selectedTaskId}
              activeId={activeId}
              taskHref={taskHref}
              onFocusCard={setActiveId}
              collapsed={view.collapsed}
              onToggleCollapsed={toggleCollapsed}
              ctx={ctx}
            />
          )}

          {mode === 'table' && matched > 0 && (
            <TableView
              groups={groups}
              showGroups={showGroups}
              columns={columns}
              members={members}
              accessOf={accessOf}
              contextOf={contextOf}
              checked={checked}
              onCheck={onCheck}
              onToggleAll={toggleIds}
              activeId={activeId}
              openId={selectedTaskId}
              taskHref={taskHref}
              onFocusRow={setActiveId}
              onPatch={onPatch}
              onAssign={onAssign}
              sort={view.sort}
              dir={view.dir}
              onSort={(key) => updateView(nextSort(view, key))}
              collapsed={view.collapsed}
              onToggleCollapsed={toggleCollapsed}
              footer={
                canCreate ? (
                  <div className="border-t border-border/70">
                    <QuickAdd listId={list.id} inputRef={quickAddRef} />
                  </div>
                ) : undefined
              }
            />
          )}
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
            if (wasOpen) navigate(listHref, { replace: true });
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
                        if (selectedTaskId && ids.includes(selectedTaskId)) navigate(listHref, { replace: true });
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
