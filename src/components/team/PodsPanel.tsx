import React, { useMemo, useState } from 'react';
import { Crown, Loader2, Plus, Trash2, UsersRound, X } from 'lucide-react';
import { useCan } from '@/hooks/use-auth';
import {
  useCreateTeam,
  useDeleteTeam,
  useTeamMembers,
  useTeamMembership,
  useTeams,
  useUpdateTeam,
  useWorkspaceMembers,
} from '@/hooks/use-team';
import type { Team, WorkspaceMember } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { LoadingState } from '@/components/ui/loading-state';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { UserAvatar } from '@/components/ui/user-avatar';
import { FieldError } from '@/components/auth/AuthLayout';
import RoleBadge from './RoleBadge';

const NO_LEAD = '__none__';

const PodCard: React.FC<{
  team: Team;
  members: WorkspaceMember[];
  memberIds: string[];
}> = ({ team, members, memberIds }) => {
  const canManagePods = useCan('team:manage-pods');
  const canManageMembers = useCan('team:manage-pod-members');
  const { add, remove } = useTeamMembership();
  const updateTeam = useUpdateTeam();
  const deleteTeam = useDeleteTeam();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const byId = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members]);
  const inPod = memberIds.map((id) => byId.get(id)).filter((m): m is WorkspaceMember => !!m);
  const candidates = members.filter((m) => !memberIds.includes(m.userId) && m.role !== 'CLIENT_VIEWER');
  const lead = team.leadId ? byId.get(team.leadId) : undefined;

  return (
    <article className="flex flex-col rounded-lg border border-border/70 bg-card">
      <header className="flex items-start justify-between gap-2 border-b border-border/60 p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: team.color }} />
            <h3 className="truncate text-sm font-semibold">{team.name}</h3>
          </div>
          {team.description && <p className="mt-0.5 text-[11px] text-muted-foreground">{team.description}</p>}
        </div>
        {canManagePods && (
          <IconButton
            aria-label={`Delete pod ${team.name}`}
            tooltip="Delete pod"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            variant="ghost"
            size="xs"
            onClick={() => setConfirmDelete(true)}
          />
        )}
      </header>

      <div className="space-y-3 p-3 text-xs">
        <div className="flex items-center gap-2">
          <Crown className="h-3.5 w-3.5 text-amber-500" />
          {canManagePods ? (
            <Select
              value={team.leadId ?? NO_LEAD}
              onValueChange={(v) => updateTeam.mutate({ teamId: team.id, leadId: v === NO_LEAD ? null : v })}
            >
              <SelectTrigger className="h-7 text-xs" aria-label={`Lead of ${team.name}`}>
                <SelectValue placeholder="No lead" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LEAD} className="text-xs">
                  No lead
                </SelectItem>
                {members
                  .filter((m) => m.role !== 'CLIENT_VIEWER')
                  .map((m) => (
                    <SelectItem key={m.userId} value={m.userId} className="text-xs">
                      {m.profile?.fullName ?? m.userId}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-muted-foreground">Lead: {lead?.profile?.fullName ?? 'none'}</span>
          )}
        </div>

        {inPod.length === 0 ? (
          <p className="text-muted-foreground">No members yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {inPod.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <UserAvatar name={m.profile?.fullName} src={m.profile?.avatarUrl ?? undefined} size="xs" />
                  <span className="truncate">{m.profile?.fullName}</span>
                  <RoleBadge role={m.role} />
                </div>
                {canManageMembers && (
                  <IconButton
                    aria-label={`Remove ${m.profile?.fullName} from ${team.name}`}
                    icon={<X className="h-3 w-3" />}
                    variant="ghost"
                    size="xs"
                    onClick={() => remove.mutate({ teamId: team.id, userId: m.userId })}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {canManageMembers && candidates.length > 0 && (
          <Select value="" onValueChange={(userId) => add.mutate({ teamId: team.id, userId })}>
            <SelectTrigger className="h-7 text-xs" aria-label={`Add a member to ${team.name}`}>
              <SelectValue placeholder="+ Add member" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((m) => (
                <SelectItem key={m.userId} value={m.userId} className="text-xs">
                  {m.profile?.fullName ?? m.userId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete pod "{team.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The pod and its member list are removed. Nobody loses workspace access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTeam.mutate(team.id)}
            >
              Delete pod
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
};

const PodsPanel: React.FC = () => {
  const canManagePods = useCan('team:manage-pods');
  const teams = useTeams();
  const teamMembers = useTeamMembers();
  const members = useWorkspaceMembers();
  const createTeam = useCreateTeam();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [leadId, setLeadId] = useState<string>(NO_LEAD);
  const [nameError, setNameError] = useState<string | null>(null);

  const memberIdsByTeam = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const tm of teamMembers.data ?? []) map.set(tm.teamId, [...(map.get(tm.teamId) ?? []), tm.userId]);
    return map;
  }, [teamMembers.data]);

  if (teams.isLoading || members.isLoading || teamMembers.isLoading) {
    return <LoadingState variant="skeleton" skeletonRows={3} />;
  }
  const failed = teams.error ?? members.error ?? teamMembers.error;
  if (failed) {
    return (
      <ErrorState
        message={(failed as Error).message}
        onRetry={() => {
          void teams.refetch();
          void members.refetch();
          void teamMembers.refetch();
        }}
      />
    );
  }

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Enter a pod name.');
      return;
    }
    setNameError(null);
    createTeam.mutate(
      { name, description, leadId: leadId === NO_LEAD ? null : leadId },
      {
        onSuccess: () => {
          setOpen(false);
          setName('');
          setDescription('');
          setLeadId(NO_LEAD);
        },
      }
    );
  };

  const staff = (members.data ?? []).filter((m) => m.role !== 'CLIENT_VIEWER');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Pods group editors and QC specialists under a lead producer (for example Pod Zim, Pod Myla).
        </p>
        {canManagePods && (
          <Button size="sm" className="h-8 text-xs" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            New pod
          </Button>
        )}
      </div>

      {(teams.data ?? []).length === 0 ? (
        <EmptyState
          icon={<UsersRound className="h-6 w-6" />}
          title="No pods yet"
          description={canManagePods ? 'Create the first creative pod.' : 'An Owner or Admin can create pods.'}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(teams.data ?? []).map((team) => (
            <PodCard
              key={team.id}
              team={team}
              members={members.data ?? []}
              memberIds={memberIdsByTeam.get(team.id) ?? []}
            />
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={onCreate} noValidate className="space-y-4">
            <DialogHeader>
              <DialogTitle>New pod</DialogTitle>
              <DialogDescription>Members can be added after the pod is created.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="pod-name" className="text-xs">
                Name
              </Label>
              <Input
                id="pod-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Pod Zim"
                aria-invalid={!!nameError}
                aria-describedby={nameError ? 'pod-name-error' : undefined}
                className="h-9 text-sm"
              />
              <FieldError id="pod-name-error" message={nameError} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pod-description" className="text-xs">
                Description
              </Label>
              <Textarea
                id="pod-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Lead</Label>
              <Select value={leadId} onValueChange={setLeadId}>
                <SelectTrigger className="h-9 text-sm" aria-label="Pod lead">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LEAD}>No lead</SelectItem>
                  {staff.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.profile?.fullName ?? m.userId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createTeam.isPending}>
                {createTeam.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create pod
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PodsPanel;
