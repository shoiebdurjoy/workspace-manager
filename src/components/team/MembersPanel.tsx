import React, { useMemo, useState } from 'react';
import { Users, UserMinus } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useChangeMemberRole, useRemoveMember, useTeamMembers, useTeams, useWorkspaceMembers } from '@/hooks/use-team';
import { assignableRoles, canManageMember, ROLE_LABELS } from '@/lib/permissions';
import type { TbbRole, WorkspaceMember } from '@/types/database';
import { UserAvatar } from '@/components/ui/user-avatar';
import { LoadingState } from '@/components/ui/loading-state';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { IconButton } from '@/components/ui/icon-button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import RoleBadge from './RoleBadge';

const MembersPanel: React.FC = () => {
  const { user, role: myRole, workspace } = useAuth();
  const members = useWorkspaceMembers();
  const teams = useTeams();
  const teamMembers = useTeamMembers();
  const changeRole = useChangeMemberRole();
  const removeMember = useRemoveMember();
  const [filter, setFilter] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<WorkspaceMember | null>(null);

  const podsByUser = useMemo(() => {
    const names = new Map((teams.data ?? []).map((t) => [t.id, t.name]));
    const map = new Map<string, string[]>();
    for (const tm of teamMembers.data ?? []) {
      const name = names.get(tm.teamId);
      if (!name) continue;
      map.set(tm.userId, [...(map.get(tm.userId) ?? []), name]);
    }
    return map;
  }, [teams.data, teamMembers.data]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const order: TbbRole[] = ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR', 'CLIENT_VIEWER'];
    return (members.data ?? [])
      .filter((m) =>
        !q ||
        m.profile?.fullName.toLowerCase().includes(q) ||
        m.profile?.email.toLowerCase().includes(q) ||
        ROLE_LABELS[m.role].toLowerCase().includes(q)
      )
      .sort(
        (a, b) =>
          order.indexOf(a.role) - order.indexOf(b.role) ||
          (a.profile?.fullName ?? '').localeCompare(b.profile?.fullName ?? '')
      );
  }, [members.data, filter]);

  if (members.isLoading) return <LoadingState variant="skeleton" skeletonRows={4} />;
  if (members.isError) {
    return <ErrorState message={(members.error as Error).message} onRetry={() => void members.refetch()} />;
  }

  const roleOptions = assignableRoles(myRole);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {members.data?.length ?? 0} {members.data?.length === 1 ? 'person' : 'people'} in {workspace?.name}
        </p>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name, e-mail or role"
          aria-label="Filter members"
          className="h-8 w-full max-w-xs text-xs"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title="No matching members" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">Member</th>
                <th className="px-3 py-2 font-semibold">Role</th>
                <th className="hidden px-3 py-2 font-semibold md:table-cell">Pods</th>
                <th className="hidden px-3 py-2 font-semibold sm:table-cell">Joined</th>
                <th className="w-10 px-3 py-2" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((m) => {
                const isSelf = m.userId === user?.id;
                const manageable = canManageMember(myRole, m.role, isSelf);
                const name = m.profile?.fullName ?? 'Unknown member';
                return (
                  <tr key={m.userId} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <UserAvatar name={name} src={m.profile?.avatarUrl ?? undefined} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">
                            {name} {isSelf && <span className="font-normal text-muted-foreground">(you)</span>}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">{m.profile?.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {manageable ? (
                        <Select
                          value={m.role}
                          onValueChange={(value) => changeRole.mutate({ userId: m.userId, role: value as TbbRole })}
                          disabled={changeRole.isPending}
                        >
                          <SelectTrigger className="h-7 w-[168px] text-xs" aria-label={`Role for ${name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {roleOptions.map((r) => (
                              <SelectItem key={r} value={r} className="text-xs">
                                {ROLE_LABELS[r]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <RoleBadge role={m.role} />
                      )}
                    </td>
                    <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">
                      {(podsByUser.get(m.userId) ?? []).join(', ') || '—'}
                    </td>
                    <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">
                      {new Date(m.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {manageable && (
                        <IconButton
                          aria-label={`Remove ${name} from the workspace`}
                          tooltip="Remove from workspace"
                          icon={<UserMinus className="h-3.5 w-3.5" />}
                          variant="ghost"
                          size="xs"
                          onClick={() => setPendingRemoval(m)}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={!!pendingRemoval} onOpenChange={(open) => !open && setPendingRemoval(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingRemoval?.profile?.fullName}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to {workspace?.name} immediately and are removed from every pod. Their account is not
              deleted, and they can be invited again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingRemoval) removeMember.mutate(pendingRemoval.userId);
                setPendingRemoval(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default MembersPanel;
