import { useQuery } from '@tanstack/react-query';
import { getProductionMonthly, getProductionVideos } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/permissions';

/** Production analytics queries. Owner / Admin only: for anyone else nothing is requested at all. */
export const productionKeys = {
  monthly: (ws: string, tz: string) => ['workspace', ws, 'production', 'monthly', tz] as const,
  videos: (ws: string, editorId: string, year: number, month: number, tz: string) =>
    ['workspace', ws, 'production', 'videos', editorId, year, month, tz] as const,
};

/** Months are calendar months in the viewer's time zone (so "October" matches their own calendar). */
export function useProductionTimezone(): string {
  const { profile } = useAuth();
  return profile?.timezone || 'UTC';
}

export function useProductionMonthly() {
  const { workspace, role } = useAuth();
  const ws = workspace?.id ?? '';
  const tz = useProductionTimezone();
  return useQuery({
    queryKey: productionKeys.monthly(ws, tz),
    queryFn: () => getProductionMonthly(ws, tz),
    enabled: !!ws && can(role, 'production:view'),
    staleTime: 60_000,
  });
}

export function useProductionVideos(editorId: string | null, year: number, month: number | null) {
  const { workspace, role } = useAuth();
  const ws = workspace?.id ?? '';
  const tz = useProductionTimezone();
  return useQuery({
    queryKey: productionKeys.videos(ws, editorId ?? '', year, month ?? 0, tz),
    queryFn: () => getProductionVideos(ws, editorId ?? '', year, month ?? 1, tz),
    enabled: !!ws && !!editorId && month !== null && can(role, 'production:view'),
    staleTime: 60_000,
  });
}
