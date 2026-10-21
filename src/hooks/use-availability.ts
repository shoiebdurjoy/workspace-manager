import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clearMyAvailability, listAvailability, setMyAvailability, subscribeToAvailability } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/permissions';
import type { Availability, AvailabilityStatus } from '@/lib/availability';

export const availabilityKeys = {
  all: (workspaceId: string) => ['workspace', workspaceId, 'availability'] as const,
};

const EMPTY = new Map<string, Availability>();

/** Everyone's availability (staff only), live: a change anywhere refreshes it. */
export function useAvailability() {
  const { workspace, role } = useAuth();
  const qc = useQueryClient();
  const workspaceId = workspace?.id ?? '';
  const enabled = !!workspaceId && can(role, 'comments:view-internal');
  const query = useQuery({
    queryKey: availabilityKeys.all(workspaceId),
    queryFn: () => listAvailability(workspaceId),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (!enabled) return;
    let stop: (() => void) | undefined;
    try {
      stop = subscribeToAvailability(workspaceId, () => void qc.invalidateQueries({ queryKey: availabilityKeys.all(workspaceId) }));
    } catch {
      // no live connection: focus refetch keeps it fresh
    }
    return () => stop?.();
  }, [enabled, workspaceId, qc]);
  return { ...query, byUser: query.data ?? EMPTY };
}

/** Set or clear my own status, optimistically. */
export function useSetMyAvailability() {
  const { workspace, user } = useAuth();
  const qc = useQueryClient();
  const workspaceId = workspace?.id ?? '';
  const userId = user?.id ?? '';
  const key = availabilityKeys.all(workspaceId);
  return useMutation({
    mutationFn: (input: { status: AvailabilityStatus; note?: string | null; backOn?: string | null } | null) =>
      input ? setMyAvailability(workspaceId, userId, input) : clearMyAvailability(workspaceId, userId),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Map<string, Availability>>(key);
      const next = new Map(prev ?? []);
      if (input) next.set(userId, { userId, status: input.status, note: input.note?.trim() || null, backOn: input.status === 'ON_LEAVE' ? input.backOn ?? null : null, updatedAt: new Date().toISOString() });
      else next.delete(userId);
      qc.setQueryData(key, next);
      return { prev };
    },
    onError: (err, _v, ctx) => {
      qc.setQueryData(key, ctx?.prev);
      toast.error(err instanceof Error ? err.message : 'Your status could not be saved.');
    },
    onSuccess: (_d, input) => toast.success(input ? 'Status updated' : 'Status cleared'),
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });
}
