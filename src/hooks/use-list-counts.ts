import { useQuery } from '@tanstack/react-query';
import { getSupabaseClient } from '@/database/client';
import { useAuth } from '@/hooks/use-auth';

/** Open (not closed) tasks per list, for the counts beside each client in the sidebar, like ClickUp. */
export function useListOpenCounts() {
  const { workspace } = useAuth();
  const ws = workspace?.id ?? '';
  return useQuery({
    queryKey: ['workspace', ws, 'list-open-counts'],
    enabled: !!ws,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().from('tasks').select('list_id').eq('workspace_id', ws).neq('status', 'CLOSED').is('parent_id', null).limit(20000);
      if (error) throw new Error(error.message);
      const counts = new Map<string, number>();
      for (const t of data ?? []) counts.set(t.list_id, (counts.get(t.list_id) ?? 0) + 1);
      return counts;
    },
  });
}
