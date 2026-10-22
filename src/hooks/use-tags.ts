import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createTag, deleteTag, listTags, listTaskTagMap, setTaskTag, updateTag, type Tag } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { useFeatures } from '@/hooks/use-features';

const keys = {
  tags: (ws: string) => ['workspace', ws, 'tags'] as const,
  map: (ws: string) => ['workspace', ws, 'tags', 'on-tasks'] as const,
};

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : 'That did not save.');

/** The workspace's tags (empty while the feature is switched off). */
export function useTags() {
  const { workspace, role } = useAuth();
  const on = useFeatures();
  const ws = workspace?.id ?? '';
  return useQuery({ queryKey: keys.tags(ws), queryFn: () => listTags(ws), enabled: !!ws && role !== 'CLIENT_VIEWER' && on('tags'), staleTime: 5 * 60_000 });
}

/** task id -> tag ids, for the chips in lists and the detail panel. */
export function useTaskTagMap() {
  const { workspace, role } = useAuth();
  const on = useFeatures();
  const ws = workspace?.id ?? '';
  return useQuery({ queryKey: keys.map(ws), queryFn: () => listTaskTagMap(ws), enabled: !!ws && role !== 'CLIENT_VIEWER' && on('tags'), staleTime: 60_000 });
}

export function useTagMutations() {
  const { workspace } = useAuth();
  const ws = workspace?.id ?? '';
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['workspace', ws, 'tags'] });
  return {
    create: useMutation({ mutationFn: (input: { name: string; color: string; position?: number }) => createTag(ws, input), onSuccess: refresh, onError: fail }),
    update: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<Tag, 'name' | 'color' | 'position'>> }) => updateTag(id, patch), onSuccess: refresh, onError: fail }),
    remove: useMutation({ mutationFn: (id: string) => deleteTag(id), onSuccess: refresh, onError: fail }),
    toggle: useMutation({
      mutationFn: ({ taskId, tagId, on }: { taskId: string; tagId: string; on: boolean }) => setTaskTag(taskId, tagId, on),
      // the chip moves at once; put back if the database refuses
      onMutate: async ({ taskId, tagId, on }) => {
        await qc.cancelQueries({ queryKey: keys.map(ws) });
        const before = qc.getQueryData<Map<string, string[]>>(keys.map(ws));
        const next = new Map(before ?? []);
        const cur = next.get(taskId) ?? [];
        next.set(taskId, on ? Array.from(new Set([...cur, tagId])) : cur.filter((x) => x !== tagId));
        qc.setQueryData(keys.map(ws), next);
        return { before };
      },
      onError: (e, _v, ctx) => {
        if (ctx?.before) qc.setQueryData(keys.map(ws), ctx.before);
        fail(e);
      },
      onSettled: () => qc.invalidateQueries({ queryKey: keys.map(ws) }),
    }),
  };
}
