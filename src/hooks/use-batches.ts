import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createBatchVideo, getBatchProgress, listBatchVideos } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/permissions';

/**
 * Task batches (Phase 12): the videos of a batch task and how many are finished. Kept under the workspace's
 * 'tasks' prefix, so anything that refreshes the tasks (a status change, a delete) refreshes them too.
 */
export const batchKeys = {
  videos: (ws: string, parentId: string) => ['workspace', ws, 'tasks', 'batch-videos', parentId] as const,
  progress: (ws: string, parentId: string) => ['workspace', ws, 'tasks', 'batch-progress', parentId] as const,
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

function useBatchScope() {
  const { workspace, role } = useAuth();
  const workspaceId = workspace?.id ?? '';
  // staff only; client viewers have no task access (the database fails closed too)
  return { workspaceId, enabled: !!workspaceId && can(role, 'hierarchy:view') };
}

export function useBatchVideos(parentId: string | undefined) {
  const { workspaceId, enabled } = useBatchScope();
  return useQuery({
    queryKey: batchKeys.videos(workspaceId, parentId ?? ''),
    queryFn: () => listBatchVideos(parentId ?? ''),
    enabled: enabled && !!parentId,
    staleTime: 10_000,
  });
}

/** Videos finished / total for one batch; null when it has no videos. */
export function useBatchProgress(parentId: string | undefined) {
  const { workspaceId, enabled } = useBatchScope();
  return useQuery({
    queryKey: batchKeys.progress(workspaceId, parentId ?? ''),
    queryFn: async () => (await getBatchProgress([parentId ?? ''])).get(parentId ?? '') ?? null,
    enabled: enabled && !!parentId,
    staleTime: 10_000,
  });
}

export function useCreateBatchVideo(parentId: string) {
  const { workspaceId } = useBatchScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; editorId?: string | null; qcId?: string | null }) =>
      createBatchVideo(parentId, input.title, input.editorId, input.qcId),
    onSuccess: () => {
      // the new video is a task: refresh every task list / search / batch view of this workspace
      void queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'tasks'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
