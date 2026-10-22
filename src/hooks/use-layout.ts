import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getSupabaseClient } from '@/database/client';
import { useAuth } from '@/hooks/use-auth';

/** A person's own layout (migration 35): sidebar favourites and the Home cards' order and visibility. */
export interface UserLayout {
  favorites?: string[];
  home?: { order?: string[]; hidden?: string[] };
}

// the generated types predate migration 35
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseClient() as unknown as { from: (table: string) => any };

export function useLayout() {
  const { workspace, user } = useAuth();
  const ws = workspace?.id ?? '';
  const me = user?.id ?? '';
  const qc = useQueryClient();
  const key = ['workspace', ws, 'layout', me];
  const query = useQuery({
    queryKey: key,
    enabled: !!ws && !!me,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<UserLayout> => {
      const { data, error } = await db().from('user_layouts').select('layout').eq('workspace_id', ws).eq('user_id', me).maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.layout as UserLayout) ?? {};
    },
  });
  const save = useMutation({
    mutationFn: async (next: UserLayout) => {
      const { error } = await db().from('user_layouts').upsert({ user_id: me, workspace_id: ws, layout: next }, { onConflict: 'user_id,workspace_id' });
      if (error) throw new Error(error.message);
    },
    // the layout changes on screen at once and is put back if saving fails
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<UserLayout>(key);
      qc.setQueryData(key, next);
      return { before };
    },
    onError: (e, _n, ctx) => {
      if (ctx) qc.setQueryData(key, ctx.before);
      toast.error(e instanceof Error ? e.message : 'Your layout could not be saved.');
    },
  });
  const layout = query.data ?? {};
  return {
    layout,
    update: (patch: (l: UserLayout) => UserLayout) => save.mutate(patch(layout)),
    isFavorite: (id: string) => (layout.favorites ?? []).includes(id),
    toggleFavorite: (id: string) =>
      save.mutate({ ...layout, favorites: (layout.favorites ?? []).includes(id) ? (layout.favorites ?? []).filter((x) => x !== id) : [...(layout.favorites ?? []), id].slice(0, 50) }),
  };
}
