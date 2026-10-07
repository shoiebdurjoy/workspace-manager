import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import type { AssigneeRole, TaskDetail } from '@/types/database';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/permissions';
import { nextTaskPosition, TASK_PAGE_SIZE } from '@/lib/tasks';

/**
 * Query keys are scoped by workspace, so switching or signing out never mixes data, and a list's
 * tasks and a single task are cached separately: editing one task refreshes its list rows without
 * refetching the whole hierarchy tree.
 */
export const taskKeys = {
  all: (workspaceId: string) => ['workspace', workspaceId, 'tasks'] as const,
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

/** A list's tasks, 100 per page; "load more" fetches the next page only when asked. */
export function useListTasks(listId: string | undefined) {
  const { workspaceId, enabled } = useTasksEnabled();
  return useInfiniteQuery({
    queryKey: taskKeys.list(workspaceId, listId ?? ''),
    queryFn: ({ pageParam }) => listTasks(listId ?? '', pageParam),
    initialPageParam: 0,
    getNextPageParam: (last: TaskPage, pages) => (pages.length * TASK_PAGE_SIZE < last.total ? pages.length : undefined),
    enabled: enabled && !!listId,
    staleTime: 15_000,
  });
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

function useTaskCache() {
  const { workspaceId } = useTasksEnabled();
  const queryClient = useQueryClient();
  return {
    workspaceId,
    queryClient,
    /** Rows of every loaded list page may have changed (title, status, counts, order...). */
    refreshLists: () => queryClient.invalidateQueries({ queryKey: [...taskKeys.all(workspaceId), 'list'] }),
    refreshDetail: (taskId: string) => queryClient.invalidateQueries({ queryKey: taskKeys.detail(workspaceId, taskId) }),
    detail: (taskId: string) => queryClient.getQueryData<TaskDetail>(taskKeys.detail(workspaceId, taskId)),
  };
}

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

/** What the detail cache should show for a patch while the save is in flight (mirrors what the server stores). */
function optimisticPatch(patch: TaskPatch): Partial<TaskDetail> {
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

/**
 * The detail is updated at once, so a chosen status / date / person is on screen immediately; if the
 * save fails the previous detail is restored, and either way the server's version is fetched after.
 */
function useOptimisticDetail() {
  const { workspaceId, queryClient } = useTaskCache();
  return {
    apply: async (taskId: string, change: Partial<TaskDetail>) => {
      const key = taskKeys.detail(workspaceId, taskId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TaskDetail>(key);
      if (previous) queryClient.setQueryData<TaskDetail>(key, { ...previous, ...change });
      return { previous, key };
    },
    rollback: (context: { previous?: TaskDetail; key: readonly unknown[] } | undefined) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
    },
  };
}

export function useUpdateTask() {
  const { refreshLists, refreshDetail } = useTaskCache();
  const optimistic = useOptimisticDetail();
  return useMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; patch: TaskPatch }) => updateTask(taskId, patch),
    onMutate: ({ taskId, patch }) => optimistic.apply(taskId, optimisticPatch(patch)),
    onSuccess: (_task, { taskId }) => {
      void refreshDetail(taskId);
      void refreshLists();
    },
    onError: (err, { taskId }, context) => {
      toast.error(errorMessage(err));
      optimistic.rollback(context);
      // Show the truth again: the field the person edited did not change.
      void refreshDetail(taskId);
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
  const { refreshLists, refreshDetail } = useTaskCache();
  const optimistic = useOptimisticDetail();
  return useMutation({
    mutationFn: ({ taskId, role, userId }: { taskId: string; role: AssigneeRole; userId: string | null }) =>
      setTaskAssignee(taskId, role, userId),
    onMutate: ({ taskId, role, userId }) =>
      optimistic.apply(taskId, role === 'EDITOR' ? { editorId: userId } : { qcId: userId }),
    onSuccess: (_void, { taskId }) => {
      void refreshDetail(taskId);
      void refreshLists();
    },
    onError: (err, { taskId }, context) => {
      toast.error(errorMessage(err));
      optimistic.rollback(context);
      void refreshDetail(taskId);
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
  const { refreshLists, refreshDetail, detail } = useTaskCache();
  return useMutation({
    mutationFn: ({ taskId, title }: { taskId: string; title: string }) =>
      createSubtask(taskId, title, nextTaskPosition(detail(taskId)?.subtasks ?? [])),
    onSuccess: (_subtask, { taskId }) => {
      void refreshDetail(taskId);
      void refreshLists();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useUpdateSubtask() {
  const { workspaceId, queryClient, refreshLists, refreshDetail } = useTaskCache();
  return useMutation({
    mutationFn: ({ subtaskId, patch }: { taskId: string; subtaskId: string; patch: { title?: string; isCompleted?: boolean } }) =>
      updateSubtask(subtaskId, patch),
    // Ticking is instant and safe to roll back; renaming waits for the server.
    onMutate: async ({ taskId, subtaskId, patch }) => {
      if (patch.isCompleted === undefined) return undefined;
      const key = taskKeys.detail(workspaceId, taskId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TaskDetail>(key);
      if (previous) {
        queryClient.setQueryData<TaskDetail>(key, {
          ...previous,
          subtasks: previous.subtasks.map((s) => (s.id === subtaskId ? { ...s, isCompleted: patch.isCompleted as boolean } : s)),
        });
      }
      return { previous, key };
    },
    onSuccess: (_subtask, { taskId }) => {
      void refreshDetail(taskId);
      void refreshLists();
    },
    onError: (err, { taskId }, context) => {
      toast.error(errorMessage(err));
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      void refreshDetail(taskId);
    },
  });
}

export function useDeleteSubtask() {
  const { refreshLists, refreshDetail } = useTaskCache();
  return useMutation({
    mutationFn: ({ subtaskId }: { taskId: string; subtaskId: string }) => deleteSubtask(subtaskId),
    onSuccess: (_void, { taskId }) => {
      void refreshDetail(taskId);
      void refreshLists();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
