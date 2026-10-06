import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  addTeamMember,
  createInvitation,
  createTeam,
  deleteTeam,
  getWorkspaceMembers,
  listInvitations,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  removeWorkspaceMember,
  revokeInvitation,
  updateMemberRole,
  updateTeam,
} from '@/database';
import type { TbbRole } from '@/types/database';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/permissions';

/** Query keys are scoped by workspace so switching or signing out never mixes data. */
export const teamKeys = {
  members: (ws: string) => ['workspace', ws, 'members'] as const,
  invitations: (ws: string) => ['workspace', ws, 'invitations'] as const,
  teams: (ws: string) => ['workspace', ws, 'teams'] as const,
  teamMembers: (ws: string) => ['workspace', ws, 'team-members'] as const,
};

const STALE = 60_000; // metadata cache window from docs/TBB_ARCHITECTURE_PROPOSAL.md 2.1

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

export function useWorkspaceMembers() {
  const { workspace } = useAuth();
  const ws = workspace?.id ?? '';
  return useQuery({
    queryKey: teamKeys.members(ws),
    queryFn: () => getWorkspaceMembers(ws),
    enabled: !!ws,
    staleTime: STALE,
  });
}

export function useInvitations() {
  const { workspace, role } = useAuth();
  const ws = workspace?.id ?? '';
  return useQuery({
    queryKey: teamKeys.invitations(ws),
    queryFn: () => listInvitations(ws),
    // RLS returns nothing to non-admins anyway; skip the request entirely for them.
    enabled: !!ws && can(role, 'users:invite'),
    staleTime: STALE,
  });
}

export function useTeams() {
  const { workspace, role } = useAuth();
  const ws = workspace?.id ?? '';
  return useQuery({
    queryKey: teamKeys.teams(ws),
    queryFn: () => listTeams(ws),
    enabled: !!ws && can(role, 'team:view'),
    staleTime: STALE,
  });
}

export function useTeamMembers() {
  const { workspace, role } = useAuth();
  const ws = workspace?.id ?? '';
  return useQuery({
    queryKey: teamKeys.teamMembers(ws),
    queryFn: () => listTeamMembers(ws),
    enabled: !!ws && can(role, 'team:view'),
    staleTime: STALE,
  });
}

function useWorkspaceId(): string {
  const { workspace } = useAuth();
  return workspace?.id ?? '';
}

export function useChangeMemberRole() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: TbbRole }) => updateMemberRole(ws, userId, role),
    onSuccess: () => {
      toast.success('Role updated');
      void qc.invalidateQueries({ queryKey: teamKeys.members(ws) });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useRemoveMember() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeWorkspaceMember(ws, userId),
    onSuccess: () => {
      toast.success('Member removed');
      void qc.invalidateQueries({ queryKey: ['workspace', ws] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useInvite() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: TbbRole }) =>
      createInvitation({ workspaceId: ws, email, role }),
    onSuccess: (inv) => {
      toast.success(inv.acceptedAt ? `${inv.email} already had an account and now has access` : `Invitation saved for ${inv.email}`);
      void qc.invalidateQueries({ queryKey: teamKeys.invitations(ws) });
      void qc.invalidateQueries({ queryKey: teamKeys.members(ws) });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useRevokeInvitation() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: () => {
      toast.success('Invitation revoked');
      void qc.invalidateQueries({ queryKey: teamKeys.invitations(ws) });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useCreateTeam() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string; leadId?: string | null; color?: string }) =>
      createTeam({ workspaceId: ws, ...input }),
    onSuccess: (team) => {
      toast.success(`Pod "${team.name}" created`);
      void qc.invalidateQueries({ queryKey: teamKeys.teams(ws) });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useUpdateTeam() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, ...updates }: { teamId: string; leadId?: string | null; name?: string }) =>
      updateTeam(teamId, updates),
    onSuccess: () => void qc.invalidateQueries({ queryKey: teamKeys.teams(ws) }),
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useDeleteTeam() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) => deleteTeam(teamId),
    onSuccess: () => {
      toast.success('Pod deleted');
      void qc.invalidateQueries({ queryKey: teamKeys.teams(ws) });
      void qc.invalidateQueries({ queryKey: teamKeys.teamMembers(ws) });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useTeamMembership() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: teamKeys.teamMembers(ws) });
  const add = useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) => addTeamMember(teamId, userId),
    onSuccess: invalidate,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) => removeTeamMember(teamId, userId),
    onSuccess: invalidate,
    onError: (err) => toast.error(errorMessage(err)),
  });
  return { add, remove };
}
