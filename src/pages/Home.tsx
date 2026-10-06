import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Layers, ListTodo, MailPlus, Plus, ShieldCheck, Users, UsersRound } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useInvitations, useTeams, useWorkspaceMembers } from '@/hooks/use-team';
import { useHierarchy } from '@/hooks/use-hierarchy';
import { useHierarchyDialogs } from '@/hooks/use-hierarchy-dialogs';
import { can, capabilitiesOf, ROLE_DESCRIPTIONS } from '@/lib/permissions';
import { hierarchyPaths, totalsOf } from '@/lib/hierarchy';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import RoleBadge from '@/components/team/RoleBadge';
import SpaceIcon from '@/components/hierarchy/SpaceIcon';

const Stat: React.FC<{ label: string; value: number | undefined; icon: React.ReactNode; to?: string }> = ({
  label,
  value,
  icon,
  to,
}) => {
  const body = (
    <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-card p-3 transition-colors hover:bg-muted/30">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</div>
      <div>
        {value === undefined ? (
          <Skeleton className="h-5 w-8" />
        ) : (
          <p className="text-lg font-semibold leading-none">{value}</p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
};

/**
 * Home: who you are, your role and the real state of the workspace, including its spaces.
 * The personal Home / Inbox / My Tasks hub is Phase 11 and is not simulated here.
 */
const Home: React.FC = () => {
  const { profile, role, workspace } = useAuth();
  const members = useWorkspaceMembers();
  const teams = useTeams();
  const invitations = useInvitations();
  const hierarchy = useHierarchy();
  const dialogs = useHierarchyDialogs();
  const canInvite = can(role, 'users:invite');
  const canSeeTeam = can(role, 'team:view');
  const canSeeSpaces = can(role, 'hierarchy:view');
  const canCreateSpace = can(role, 'space:create');
  const pendingInvites = invitations.data?.filter((i) => !i.acceptedAt).length;
  const totals = hierarchy.data ? totalsOf(hierarchy.data) : undefined;

  useEffect(() => {
    document.title = 'Home · TBB Workspace';
  }, []);

  const firstName = profile?.fullName.split(' ')[0] ?? '';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{workspace?.name}</p>
          <h1 className="text-xl font-semibold tracking-tight">Welcome, {firstName}</h1>
        </div>
        {role && <RoleBadge role={role} className="text-[11px]" />}
      </header>

      {canSeeTeam && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Workspace summary">
          <Stat label="Spaces" value={totals?.spaces} icon={<Layers className="h-4 w-4" />} />
          <Stat label="Lists" value={totals?.lists} icon={<ListTodo className="h-4 w-4" />} />
          <Stat label="Members" value={members.data?.length} icon={<Users className="h-4 w-4" />} to="/team" />
          <Stat label="Pods" value={teams.data?.length} icon={<UsersRound className="h-4 w-4" />} to="/team?tab=pods" />
          {canInvite && (
            <Stat
              label="Pending invitations"
              value={pendingInvites}
              icon={<MailPlus className="h-4 w-4" />}
              to="/team?tab=invitations"
            />
          )}
        </section>
      )}

      {canSeeSpaces && (
        <section aria-label="Spaces" className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Spaces</h2>
            {canCreateSpace && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => dialogs.open({ type: 'space' })}>
                <Plus className="mr-1 h-3.5 w-3.5" /> New space
              </Button>
            )}
          </div>
          {hierarchy.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : hierarchy.isError ? (
            <p role="alert" className="text-xs text-destructive">
              Spaces could not be loaded.{' '}
              <button type="button" className="font-medium underline" onClick={() => void hierarchy.refetch()}>
                Try again
              </button>
            </p>
          ) : (hierarchy.data ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 p-4 text-xs text-muted-foreground">
              No spaces yet.{' '}
              {canCreateSpace ? 'Create one to start organising client pipelines.' : 'An Owner or Admin can create spaces.'}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(hierarchy.data ?? []).map((space) => (
                <Link
                  key={space.id}
                  to={hierarchyPaths.space(space.id)}
                  className="flex items-center gap-3 rounded-lg border border-border/70 bg-card p-3 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <SpaceIcon icon={space.icon} color={space.color} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{space.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {space.folders.length} {space.folders.length === 1 ? 'folder' : 'folders'}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg border border-border/70 bg-card p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Your access</h2>
        </div>
        {role && <p className="mt-1 text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>}
        <p className="mt-2 text-[11px] text-muted-foreground">
          {capabilitiesOf(role).length} capabilities from the TBB permission model apply to your role. The database
          enforces them for every request.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {canSeeTeam && (
            <Button asChild size="sm" variant="outline" className="h-8 text-xs">
              <Link to="/team">
                Open team <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
          <Button asChild size="sm" variant="outline" className="h-8 text-xs">
            <Link to="/profile">Edit profile</Link>
          </Button>
        </div>
      </section>
    </div>
  );
};

export default Home;
