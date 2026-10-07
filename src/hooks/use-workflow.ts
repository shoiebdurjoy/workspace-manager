import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getLatestRevisionRequest, getWorkflow, StaleTransitionError, transitionTask, type TransitionInput } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/permissions';
import { statusName, statusOf } from '@/lib/workflow';
import type { TaskDetail, TaskSummary, Workflow } from '@/types/database';
import { useTaskCache } from '@/hooks/use-tasks';

/**
 * The workspace's workflow (stages + allowed moves) and moving tasks through it.
 *
 * A move is optimistic like any other edit: the task shows its new stage (and revision number) at
 * once, everywhere it is on screen, and is put back if the database refuses. A refusal because
 * someone else moved the task first reloads it, so the person sees the real stage.
 */
export const workflowKeys = {
  workflow: (workspaceId: string) => ['workspace', workspaceId, 'workflow'] as const,
  revision: (workspaceId: string, taskId: string) => ['workspace', workspaceId, 'tasks', 'revision', taskId] as const,
};

export function useWorkflow() {
  const { workspace, role } = useAuth();
  const workspaceId = workspace?.id ?? '';
  return useQuery({
    queryKey: workflowKeys.workflow(workspaceId),
    queryFn: () => getWorkflow(workspaceId),
    enabled: !!workspaceId && can(role, 'hierarchy:view'),
    // configuration: it changes when an admin changes the workflow, not while someone works
    staleTime: 10 * 60_000,
  });
}

/** The latest request for changes on a task (who asked, when, what to fix). */
export function useLatestRevisionRequest(taskId: string | undefined, enabled = true) {
  const { workspace, role } = useAuth();
  const workspaceId = workspace?.id ?? '';
  return useQuery({
    queryKey: workflowKeys.revision(workspaceId, taskId ?? ''),
    queryFn: () => getLatestRevisionRequest(taskId ?? ''),
    enabled: enabled && !!workspaceId && !!taskId && can(role, 'hierarchy:view'),
    staleTime: 30_000,
  });
}

/** The stage change as it will look once saved (mirrors the trigger: entering a revision stage counts one). */
export function transitionChange(
  workflow: Workflow | null | undefined,
  row: Pick<TaskSummary, 'status' | 'revisionCount'>,
  input: TransitionInput
): Partial<TaskDetail> {
  const change: Partial<TaskDetail> = { status: input.to };
  if (statusOf(workflow, input.to)?.countsRevision) change.revisionCount = row.revisionCount + 1;
  if (input.reviewLink?.trim()) change.reviewLink = input.reviewLink.trim();
  if (input.finalExportLink?.trim()) change.finalExportLink = input.finalExportLink.trim();
  return change;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

export function useTransitionTask() {
  const cache = useTaskCache();
  const workflow = useWorkflow().data;
  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: TransitionInput }) => transitionTask(taskId, input),
    onMutate: async ({ taskId, input }) => {
      const snap = await cache.snapshot([taskId]);
      cache.patchDetail(taskId, (d) => ({ ...d, ...transitionChange(workflow, d, input) }));
      cache.patchRows([taskId], (row) => {
        const { reviewLink: _r, finalExportLink: _f, ...change } = transitionChange(workflow, row, input);
        void _r;
        void _f;
        return { ...row, ...change };
      });
      return snap;
    },
    onSuccess: (saved, { taskId, input }) => {
      cache.patchRows([taskId], (row) => ({ ...row, status: saved.status, revisionCount: saved.revisionCount, updatedAt: saved.updatedAt }));
      void cache.refreshDetail(taskId);
      if (statusOf(workflow, input.to)?.countsRevision) {
        void cache.queryClient.invalidateQueries({ queryKey: workflowKeys.revision(cache.workspaceId, taskId) });
      }
      toast.success(`Moved to ${statusName(workflow, saved.status)}`);
    },
    onError: (err, { taskId }, snap) => {
      toast.error(errorMessage(err));
      cache.restore(snap);
      void cache.refreshDetail(taskId);
      // someone else moved it: show the real stage in the list too
      if (err instanceof StaleTransitionError) void cache.refreshLists();
    },
  });
}
