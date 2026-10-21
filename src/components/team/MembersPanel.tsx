import React, { useMemo, useState } from 'react';
import { Users, UserMinus } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useChangeMemberRole, useRemoveMember, useTeamMembers, useTeams, useWorkspaceMembers } from '@/hooks/use-team';
import { assignableRoles, canManageMember, ROLE_LABELS } from '@/lib/permissions';
import type { TbbRole, WorkspaceMember } from '@/types/database';
import { UserAvatar } from '@/components/ui/user-avatar';
import { AVAILABILITY_ICONS, AvailabilityChip, AvailabilityRing } from '@/components/team/Availability';
import { useAvailability } from '@/hooks/use-availability';
import { AVAILABILITY_META, AVAILABILITY_STATUSES, summarize, type AvailabilityStatus } from '@/lib/availability';
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

  const availability = useAvailability();
  const [statusFilter, setStatusFilter] = useState<AvailabilityStatus | null>(null);
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const order: TbbRole[] = ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR', 'CLIENT_VIEWER'];
    return (members.data ?? [])
      .filter((m) => !statusFilter || availability.byUser.get(m.userId)?.status === statusFilter)
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
  }, [members.data, filter, statusFilter, availability.byUser]);

  if (members.isLoading) return <LoadingState variant="skeleton" skeletonRows={4} />;
  if (members.isError) {
    return <ErrorState message={(members.error as Error).message} onRetry={() => void members.refetch()} />;
  }

  const roleOptions = assignableRoles(myRole);

  const counts = summarize((members.data ?? []).filter((m) => m.role !== 'CLIENT_VIEWER').map((m) => m.userId), availability.byUser);
  const staffTotal = Math.max(1, AVAILABILITY_STATUSES.reduce((n, s) => n + counts[s], 0) + counts.NONE);

  return (
    <div className="space-y-3">
      {/* Who can take work right now: a stacked bar and one chip per status (click to filter) */}
      <section aria-label="Team availability" className="surface-card space-y-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="section-label">Team availability</h3>
          <span className="text-[11px] text-muted-foreground">live</span>
        </div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          {AVAILABILITY_STATUSES.map((s) => (
            <span key={s} className="h-full transition-[width] duration-700 ease-out" style={{ width: `${(counts[s] / staffTotal) * 100}%`, background: `hsl(${AVAILABILITY_META[s].tone})` }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {AVAILABILITY_STATUSES.map((s) => {
            const meta = AVAILABILITY_META[s];
            const Icon = AVAILABILITY_ICONS[s];
            const on = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => setStatusFilter(on ? null : s)}
                className="press inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-left"
                style={{
                  borderColor: on ? `hsl(${meta.tone})` : `hsl(${meta.tone} / 0.25)`,
                  background: on ? `hsl(${meta.tone} / 0.14)` : `hsl(${meta.tone} / 0.06)`,
                }}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `hsl(${meta.tone} / 0.16)`, color: `hsl(${meta.tone})` }}>
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-lg font-semibold leading-none tabular-nums">{counts[s]}</span>
                  <span className="block text-[11px] text-muted-foreground">{meta.short}</span>
                </span>
              </button>
            );
          })}
          {counts.NONE > 0 && <span className="self-center text-[11px] text-muted-foreground">{counts.NONE} without a status</span>}
        </div>
      </section>

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
        <div className="overflow-hidden surface-card">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">Member</th>
                <th className="px-3 py-2 font-semibold">Status</th>
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
                        <AvailabilityRing availability={availability.byUser.get(m.userId)}>
                          <UserAvatar name={name} src={m.profile?.avatarUrl ?? undefined} size="sm" />
                        </AvailabilityRing>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">
                            {name} {isSelf && <span className="font-normal text-muted-foreground">(you)</span>}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">{m.profile?.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[16rem] px-3 py-2">
                      {m.role === 'CLIENT_VIEWER' ? <span className="text-[11px] text-muted-foreground">-</span> : <AvailabilityChip availability={availability.byUser.get(m.userId)} />}
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
                      {new Date(m.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
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
