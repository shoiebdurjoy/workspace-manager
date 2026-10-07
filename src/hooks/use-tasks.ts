import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  createSubtask,
  createTask,
  deleteSubtask,
  deleteTask,
  getTask,
  listTasks,
  moveTask,
  setTaskAssignee,
  updateSubtask,
  updateTask,
  type TaskInput,
  type TaskPage,
  type TaskPatch,
} from '@/database';
import type { AssigneeRole, TaskDetail, TaskSummary } from '@/types/database';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/permissions';
import { nextTaskPosition, TASK_LOAD_CAP, TASK_PAGE_SIZE } from '@/lib/tasks';

/**
 * Query keys are scoped by workspace, so switching or signing out never mixes data, and a list's
 * tasks and a single task are cached separately.
 *
 * Edits are optimistic in BOTH places a task is shown (its list rows and its open detail), so a
 * change made inline in the list or in the sheet is on screen at once everywhere. A failed write puts
 * the previous values back. Field edits do not refetch the list (the rows already hold the new
 * values); creating, deleting and reordering do, because they change which rows exist or their order.
 */
export const taskKeys = {
  all: (workspaceId: string) => ['workspace', workspaceId, 'tasks'] as const,
  lists: (workspaceId: string) => ['workspace', workspaceId, 'tasks', 'list'] as const,
  list: (workspaceId: string, listId: string) => ['workspace', workspaceId, 'tasks', 'list', listId] as const,
  detail: (workspaceId: string, taskId: string) => ['workspace', workspaceId, 'tasks', 'detail', taskId] as const,
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

/** Staff only: client viewers have no task access until guest grants exist (fails closed in RLS too). */
function useTasksEnabled(): { workspaceId: string; enabled: boolean } {
  const { workspace, role } = useAuth();
  const workspaceId = workspace?.id ?? '';
  return { workspaceId, enabled: !!workspaceId && can(role, 'hierarchy:view') };
}

/**
 * A list's tasks. Pages of TASK_PAGE_SIZE are fetched one after another until the whole list (up to
 * TASK_LOAD_CAP) is loaded, so grouping, counts and filters in the list workspace are exact.
 */
export function useListTasks(listId: string | undefined) {
  const { workspaceId, enabled } = useTasksEnabled();
  const query = useInfiniteQuery({
    queryKey: taskKeys.list(workspaceId, listId ?? ''),
    queryFn: ({ pageParam }) => listTasks(listId ?? '', pageParam),
    initialPageParam: 0,
    getNextPageParam: (last: TaskPage, pages) => {
      const loaded = pages.length * TASK_PAGE_SIZE;
      return loaded < last.total && loaded < TASK_LOAD_CAP ? pages.length : undefined;
    },
    enabled: enabled && !!listId,
    staleTime: 15_000,
  });
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage]);
  return query;
}

export function useTask(taskId: string | undefined) {
  const { workspaceId, enabled } = useTasksEnabled();
  return useQuery({
    queryKey: taskKeys.detail(workspaceId, taskId ?? ''),
    queryFn: () => getTask(taskId ?? ''),
    enabled: enabled && !!taskId,
    staleTime: 15_000,
    // A deleted / invisible task will not appear by retrying.
    retry: (count, error) => (error as { code?: string } | null)?.code !== 'NOT_FOUND' && count < 1,
  });
}

// ---------------------------------------------------------------------------------------
// Cache plumbing
// ---------------------------------------------------------------------------------------

type ListData = InfiniteData<TaskPage, number>;
type Snapshot = {
  lists: Array<[QueryKey, ListData | undefined]>;
  details: Array<[QueryKey, TaskDetail | undefined]>;
};

function useTaskCache() {
  const { workspaceId } = useTasksEnabled();
  const queryClient = useQueryClient();

  const patchRows = (taskIds: readonly string[], change: (row: TaskSummary) => TaskSummary) => {
    const ids = new Set(taskIds);
    queryClient.setQueriesData<ListData>({ queryKey: taskKeys.lists(workspaceId) }, (data) =>
      data
        ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((row) => (ids.has(row.id) ? change(row) : row)) })) }
        : data
    );
  };
  const patchDetail = (taskId: string, change: (d: TaskDetail) => TaskDetail) => {
    queryClient.setQueryData<TaskDetail>(taskKeys.detail(workspaceId, taskId), (d) => (d ? change(d) : d));
  };

  return {
    workspaceId,
    queryClient,
    patchRows,
    patchDetail,
    /** Stop in-flight reads that could overwrite an optimistic value, then remember the current state. */
    snapshot: async (taskIds: readonly string[]): Promise<Snapshot> => {
      await queryClient.cancelQueries({ queryKey: taskKeys.all(workspaceId) });
      return {
        lists: queryClient.getQueriesData<ListData>({ queryKey: taskKeys.lists(workspaceId) }),
        details: taskIds.map((id) => {
          const key = taskKeys.detail(workspaceId, id);
          return [key, queryClient.getQueryData<TaskDetail>(key)];
        }),
      };
    },
    restore: (snap: Snapshot | undefined) => {
      if (!snap) return;
      for (const [key, data] of snap.lists) queryClient.setQueryData(key, data);
      for (const [key, data] of snap.details) if (data) queryClient.setQueryData(key, data);
    },
    /** Put back only some tasks' rows (a bulk action where a few writes failed). */
    restoreRows: (snap: Snapshot, taskIds: readonly string[]) => {
      const before = new Map<string, TaskSummary>();
      for (const [, data] of snap.lists) for (const p of data?.pages ?? []) for (const r of p.items) before.set(r.id, r);
      patchRows(taskIds, (row) => before.get(row.id) ?? row);
      for (const [key, data] of snap.details) if (data && taskIds.includes(data.id)) queryClient.setQueryData(key, data);
    },
    refreshLists: () => queryClient.invalidateQueries({ queryKey: taskKeys.lists(workspaceId) }),
    refreshDetail: (taskId: string) => queryClient.invalidateQueries({ queryKey: taskKeys.detail(workspaceId, taskId) }),
    detail: (taskId: string) => queryClient.getQueryData<TaskDetail>(taskKeys.detail(workspaceId, taskId)),
  };
}

/** What a patch looks like once saved (mirrors the server: trimmed, blanks become null). */
export function optimisticPatch(patch: TaskPatch): Partial<TaskDetail> {
  const next: Partial<TaskDetail> = {};
  const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  if (patch.title !== undefined) next.title = patch.title.trim();
  if (patch.description !== undefined) next.description = blank(patch.description);
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.aspectRatio !== undefined) next.aspectRatio = patch.aspectRatio;
  if (patch.rawFootageLink !== undefined) next.rawFootageLink = blank(patch.rawFootageLink);
  if (patch.projectFileLink !== undefined) next.projectFileLink = blank(patch.projectFileLink);
  if (patch.reviewLink !== undefined) next.reviewLink = blank(patch.reviewLink);
  if (patch.finalExportLink !== undefined) next.finalExportLink = blank(patch.finalExportLink);
  if (patch.dueDate !== undefined) next.dueDate = patch.dueDate;
  if (patch.clientDeadline !== undefined) next.clientDeadline = patch.clientDeadline;
  return next;
}

/** The row-shaped part of a detail change (rows do not carry the brief). */
function rowChange(change: Partial<TaskDetail>): Partial<TaskSummary> {
  const { description: _brief, subtasks: _subtasks, ...rest } = change;
  void _brief;
  void _subtasks;
  return rest as Partial<TaskSummary>;
}

// ---------------------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------------------

export function useCreateTask() {
  const { refreshLists } = useTaskCache();
  return useMutation({
    mutationFn: ({ listId, ...input }: TaskInput & { listId: string }) => createTask(listId, input),
    onSuccess: (task) => {
      toast.success(`Task "${task.title}" created`);
      void refreshLists();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useUpdateTask() {
  const cache = useTaskCache();
  return useMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; patch: TaskPatch }) => updateTask(taskId, patch),
    onMutate: async ({ taskId, patch }) => {
      const snap = await cache.snapshot([taskId]);
      const change = optimisticPatch(patch);
      cache.patchDetail(taskId, (d) => ({ ...d, ...change }));
      cache.patchRows([taskId], (row) => ({ ...row, ...rowChange(change) }));
      return snap;
    },
    onSuccess: (saved, { taskId }) => {
      // the server's version (trimmed values, updated_at) without refetching the whole list
      cache.patchRows([taskId], (row) => ({ ...row, updatedAt: saved.updatedAt }));
      void cache.refreshDetail(taskId);
    },
    onError: (err, { taskId }, snap) => {
      toast.error(errorMessage(err));
      cache.restore(snap);
      // Show the truth again: the field the person edited did not change.
      void cache.refreshDetail(taskId);
    },
  });
}

export function useDeleteTask() {
  const { workspaceId, queryClient, refreshLists } = useTaskCache();
  return useMutation({
    mutationFn: (taskId: string) => deleteTask(taskId),
    onSuccess: (_void, taskId) => {
      toast.success('Task deleted');
      queryClient.removeQueries({ queryKey: taskKeys.detail(workspaceId, taskId) });
      void refreshLists();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useSetAssignee() {
  const cache = useTaskCache();
  return useMutation({
    mutationFn: ({ taskId, role, userId }: { taskId: string; role: AssigneeRole; userId: string | null }) =>
      setTaskAssignee(taskId, role, userId),
    onMutate: async ({ taskId, role, userId }) => {
      const snap = await cache.snapshot([taskId]);
      const change = role === 'EDITOR' ? { editorId: userId } : { qcId: userId };
      cache.patchDetail(taskId, (d) => ({ ...d, ...change }));
      cache.patchRows([taskId], (row) => ({ ...row, ...change }));
      return snap;
    },
    onSuccess: (_void, { taskId }) => void cache.refreshDetail(taskId),
    onError: (err, { taskId }, snap) => {
      toast.error(errorMessage(err));
      cache.restore(snap);
      void cache.refreshDetail(taskId);
    },
  });
}

export function useMoveTask() {
  const { refreshLists } = useTaskCache();
  return useMutation({
    mutationFn: ({ taskId, direction }: { taskId: string; direction: 'up' | 'down' }) => moveTask(taskId, direction),
    onSuccess: () => void refreshLists(),
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useAddSubtask() {
  const cache = useTaskCache();
  return useMutation({
    mutationFn: ({ taskId, title }: { taskId: string; title: string }) =>
      createSubtask(taskId, title, nextTaskPosition(cache.detail(taskId)?.subtasks ?? [])),
    onSuccess: (_subtask, { taskId }) => {
      cache.patchRows([taskId], (row) => ({ ...row, subtaskTotal: row.subtaskTotal + 1 }));
      void cache.refreshDetail(taskId);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useUpdateSubtask() {
  const cache = useTaskCache();
  return useMutation({
    mutationFn: ({ subtaskId, patch }: { taskId: string; subtaskId: string; patch: { title?: string; isCompleted?: boolean } }) =>
      updateSubtask(subtaskId, patch),
    // Ticking is instant and safe to roll back; renaming waits for the server.
    onMutate: async ({ taskId, subtaskId, patch }) => {
      if (patch.isCompleted === undefined) return undefined;
      const snap = await cache.snapshot([taskId]);
      const done = patch.isCompleted;
      const was = cache.detail(taskId)?.subtasks.find((s) => s.id === subtaskId)?.isCompleted;
      cache.patchDetail(taskId, (d) => ({
        ...d,
        subtasks: d.subtasks.map((s) => (s.id === subtaskId ? { ...s, isCompleted: done } : s)),
      }));
      if (was !== undefined && was !== done) {
        cache.patchRows([taskId], (row) => ({
          ...row,
          subtaskDone: Math.min(row.subtaskTotal, Math.max(0, row.subtaskDone + (done ? 1 : -1))),
        }));
      }
      return snap;
    },
    onSuccess: (_subtask, { taskId }) => void cache.refreshDetail(taskId),
    onError: (err, { taskId }, snap) => {
      toast.error(errorMessage(err));
      cache.restore(snap);
      void cache.refreshDetail(taskId);
    },
  });
}

export function useDeleteSubtask() {
  const cache = useTaskCache();
  return useMutation({
    mutationFn: ({ subtaskId }: { taskId: string; subtaskId: string }) => deleteSubtask(subtaskId),
    onSuccess: (_void, { taskId, subtaskId }) => {
      const wasDone = cache.detail(taskId)?.subtasks.find((s) => s.id === subtaskId)?.isCompleted ?? false;
      cache.patchRows([taskId], (row) => ({
        ...row,
        subtaskTotal: Math.max(0, row.subtaskTotal - 1),
        subtaskDone: Math.max(0, row.subtaskDone - (wasDone ? 1 : 0)),
      }));
      void cache.refreshDetail(taskId);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

// ---------------------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------------------

export type BulkAction =
  | { kind: 'patch'; patch: TaskPatch }
  | { kind: 'assign'; role: AssigneeRole; userId: string | null }
  | { kind: 'delete' };

export interface BulkResult {
  ok: string[];
  failed: Array<{ id: string; message: string }>;
}

/** Runs `work` over `items` with at most `limit` in flight (polite to the API, fast for people). */
export async function runPool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<Array<PromiseSettledResult<void>>> {
  const results: Array<PromiseSettledResult<void>> = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        await work(items[i]);
        results[i] = { status: 'fulfilled', value: undefined };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

/**
 * Applies one change to many tasks through the SAME per-task calls (and so the same RLS and guards)
 * as single edits: nothing new is trusted on the server. Rows change at once; writes run a few at a
 * time; any that fail are put back individually and reported, the rest stay.
 */
export function useBulkTasks() {
  const cache = useTaskCache();
  return useMutation({
    mutationFn: async ({ taskIds, action }: { taskIds: string[]; action: BulkAction }): Promise<BulkResult> => {
      const snap = await cache.snapshot(taskIds);
      if (action.kind === 'patch') {
        const change = rowChange(optimisticPatch(action.patch));
        cache.patchRows(taskIds, (row) => ({ ...row, ...change }));
      } else if (action.kind === 'assign') {
        const change = action.role === 'EDITOR' ? { editorId: action.userId } : { qcId: action.userId };
        cache.patchRows(taskIds, (row) => ({ ...row, ...change }));
      }
      const settled = await runPool(taskIds, 6, async (id) => {
        if (action.kind === 'patch') await updateTask(id, action.patch);
        else if (action.kind === 'assign') await setTaskAssignee(id, action.role, action.userId);
        else await deleteTask(id);
      });
      const result: BulkResult = { ok: [], failed: [] };
      settled.forEach((s, i) => {
        if (s.status === 'fulfilled') result.ok.push(taskIds[i]);
        else result.failed.push({ id: taskIds[i], message: errorMessage(s.reason) });
      });
      if (result.failed.length && action.kind !== 'delete') cache.restoreRows(snap, result.failed.map((f) => f.id));
      return result;
    },
    onSuccess: (result, { taskIds, action }) => {
      for (const id of taskIds) void cache.refreshDetail(id);
      if (action.kind === 'delete') void cache.refreshLists();
      const verb = action.kind === 'delete' ? 'Deleted' : 'Updated';
      const noun = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`;
      if (result.failed.length === 0) toast.success(`${verb} ${noun(result.ok.length)}`);
      else
        toast.error(
          `${verb} ${noun(result.ok.length)}; ${noun(result.failed.length)} could not be changed: ${result.failed[0].message}`
        );
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      void cache.refreshLists();
    },
  });
}
