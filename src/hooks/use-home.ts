import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { getHomeSummary } from '@/database';
import { dayBounds } from '@/lib/day-bounds';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/permissions';

export const homeKeys = {
  // under 'tasks', so anything that refreshes tasks (a move, an assignment) refreshes the summary too;
  // the viewer's calendar day is part of the key, so "today" moves on at midnight
  summary: (workspaceId: string, day: string) => ['workspace', workspaceId, 'tasks', 'home-summary', day] as const,
};

/** The Home page's counts and queues (my_home_summary), for the production team. */
export function useHomeSummary() {
  const { workspace, role } = useAuth();
  const workspaceId = workspace?.id ?? '';
  const day = format(new Date(), 'yyyy-MM-dd');
  return useQuery({
    queryKey: homeKeys.summary(workspaceId, day),
    // the viewer's own today / tomorrow / next 7 days, computed when the request is made
    queryFn: () => getHomeSummary(workspaceId, dayBounds()),
    enabled: !!workspaceId && can(role, 'hierarchy:view'),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
