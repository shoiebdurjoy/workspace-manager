import React, { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CalendarClock, CalendarDays, CircleDot, Layers, ListTodo, MailPlus, Plus, ShieldCheck, UserX, Users, UsersRound } from 'lucide-react';
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
import AdminInsights from '@/components/home/AdminInsights';
import { AnimatedNumber, Stagger, StaggerItem } from '@/components/motion';
import { TaskStatusPill } from '@/components/tasks/TaskBadges';
import type { HomeQueueItem } from '@/database';
import { useHomeSummary } from '@/hooks/use-home';
import { useInboxNotifications } from '@/hooks/use-inbox';
import { useTaskSearch } from '@/hooks/use-tasks';
import { useWorkflow } from '@/hooks/use-workflow';
import { describeNotification, timeAgo } from '@/lib/collaboration';
import { memberLookup, memberName } from '@/lib/tasks';
import { needsMyAction } from '@/lib/workflow';
import type { TaskStatus } from '@/types/database';

const Stat: React.FC<{ label: string; value: number | undefined; icon: React.ReactNode; to?: string }> = ({
  label,
  value,
  icon,
  to,
}) => {
  const body = (
    <div className="lift group/stat relative flex items-center gap-3 overflow-hidden surface-card p-4">
      {/* a soft brand glow that follows the hover */}
      <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-primary/10 blur-2xl opacity-0 transition-opacity duration-300 group-hover/stat:opacity-100" />
      <div className="stat-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-control transition-transform duration-300 group-hover/stat:scale-110">
        {icon}
      </div>
      <div className="min-w-0">
        {value === undefined ? (
          <Skeleton className="h-6 w-10" />
        ) : (
          <p className="text-2xl font-semibold tabular-nums leading-none tracking-tight">
            <AnimatedNumber value={value} />
          </p>
        )}
        <p className="mt-1.5 truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
  return (
    <StaggerItem>
      {to ? (
        <Link to={to} className="block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {body}
        </Link>
      ) : (
        body
      )}
    </StaggerItem>
  );
};

const UNREAD_INBOX = { tab: 'inbox' as const, kinds: [], unreadOnly: true };

/** A titled card on Home with an optional "see all" link. */
const Card: React.FC<{ title: string; to?: string; toLabel?: string; children: React.ReactNode }> = ({ title, to, toLabel, children }) => (
  <section aria-label={title} className="surface-card p-4">
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="section-label">{title}</h2>
      {to && (
        <Link to={to} className="inline-flex items-center text-xs font-medium text-muted-foreground hover:text-foreground">
          {toLabel ?? 'See all'} <ArrowRight className="ml-1 h-3 w-3" />
        </Link>
      )}
    </div>
    {children}
  </section>
);

/** One task waiting in a queue: title, where it lives, its stage and how long it has waited. */
const QueueRow: React.FC<{ item: HomeQueueItem; who?: string | null }> = ({ item, who }) => (
  <li>
    <Link
      to={hierarchyPaths.taskById(item.id)}
      className="flex items-start gap-2 rounded-md px-1 py-1.5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {item.listName}
          {who ? ` · ${who}` : ''}
          {item.revisionCount > 0 ? ` · revision ${item.revisionCount}` : ''}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <TaskStatusPill status={item.status as TaskStatus} className="text-[10px]" />
        {item.since && <span className="text-[11px] text-muted-foreground">since {timeAgo(item.since)}</span>}
      </span>
    </Link>
  </li>
);

/**
 * Home: the person's own work first (what needs them, unread notifications, recent changes), then for QC
 * and managers the QC queue and revisions in progress, and for managers the workspace's open, overdue
 * and unassigned work. Every number is the database's (my_home_summary under the caller's RLS); nothing
 * is simulated. Below: the workspace, its spaces and the person's access.
 */
const Home: React.FC = () => {
  const { profile, role, workspace, user } = useAuth();
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
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  // ---- the personal hub (staff only: client viewers have no task access) ----
  const me = user?.id ?? null;
  const summary = useHomeSummary();
  const inbox = useInboxNotifications(UNREAD_INBOX);
  const workflow = useWorkflow().data;
  const lookup = useMemo(() => memberLookup(members.data), [members.data]);
  const myTasks = useTaskSearch({ query: '', filters: { people: [me ?? ''] }, sort: 'updated', dir: 'desc' }, canSeeSpaces && !!me);
  const mine = useMemo(() => myTasks.data?.pages.flatMap((p) => p.items) ?? [], [myTasks.data]);
  const needsMe = useMemo(() => mine.filter((t) => needsMyAction(workflow, t, me, role)).length, [mine, workflow, me, role]);
  const recent = mine.slice(0, 5);
  const notes = (inbox.data?.pages.flatMap((p) => p.items) ?? []).slice(0, 5);
  const s = summary.data;
  const isManager = role === 'OWNER' || role === 'ADMIN' || role === 'PRODUCTION_MANAGER';
  const showQueues = isManager || role === 'QC_SPECIALIST';
  const headline = !canSeeSpaces
    ? 'Here is your workspace at a glance.'
    : !s
      ? 'Getting your day ready...'
      : s.mine.overdue > 0
        ? `${s.mine.overdue} of your tasks ${s.mine.overdue === 1 ? 'is' : 'are'} overdue. Start there.`
        : s.mine.dueToday > 0
          ? `${s.mine.dueToday} ${s.mine.dueToday === 1 ? 'task is' : 'tasks are'} due today. You are on track.`
          : s.mine.total > 0
            ? 'Nothing overdue and nothing due today. A clear runway.'
            : 'Nothing assigned to you yet. Enjoy the calm.';

  return (
    <div className="space-y-6">
      <header className="hero-surface relative overflow-hidden rounded-card px-6 py-7 sm:px-8 sm:py-9">
        <div aria-hidden className="hero-glow" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <p className="section-label">
              {workspace?.name} · {todayLabel}
            </p>
            <h1 className="page-title text-3xl sm:text-4xl">
              {greeting}, {firstName}
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground">{headline}</p>
          </div>
          {role && <RoleBadge role={role} className="text-[11px]" />}
        </div>
      </header>

      {canSeeSpaces && (
        <>
          <section aria-label="My work" className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="section-label">My work</h2>
              <Link to="/my-tasks" className="inline-flex items-center text-xs font-medium text-muted-foreground hover:text-foreground">
                Open My Tasks <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </div>
            {summary.isError ? (
              <p role="alert" className="text-xs text-destructive">
                Your summary could not be loaded.{' '}
                <button type="button" className="font-medium underline" onClick={() => void summary.refetch()}>
                  Try again
                </button>
              </p>
            ) : (
              <Stagger className="stat-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Needs my action" value={myTasks.isLoading || !workflow ? undefined : needsMe} icon={<CircleDot className="h-4 w-4" />} to="/my-tasks" />
                <Stat label="Overdue" value={s?.mine.overdue} icon={<AlertTriangle className="h-4 w-4" />} to="/my-tasks" />
                <Stat label="Due today" value={s?.mine.dueToday} icon={<CalendarClock className="h-4 w-4" />} to="/my-tasks" />
                <Stat label="Next 7 days" value={s?.mine.dueThisWeek} icon={<CalendarDays className="h-4 w-4" />} to="/my-tasks" />
              </Stagger>
            )}
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Unread notifications" to="/inbox" toLabel="Open Inbox">
              {inbox.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : notes.length === 0 ? (
                <p className="text-xs text-muted-foreground">You are all caught up.</p>
              ) : (
                <ul className="space-y-0.5">
                  {notes.map((n) => {
                    const line = describeNotification(n, lookup, workflow);
                    return (
                      <li key={n.id}>
                        <Link
                          to={line.to}
                          className="block rounded-md px-1 py-1.5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="block truncate text-sm font-medium">{line.headline}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {line.detail} · {timeAgo(line.createdAt)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            <Card title="Recently updated, assigned to me" to="/my-tasks">
              {myTasks.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : recent.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing assigned to you yet.</p>
              ) : (
                <ul className="space-y-0.5">
                  {recent.map((t) => (
                    <li key={t.id}>
                      <Link
                        to={hierarchyPaths.myTask(t.id)}
                        className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}</span>
                        <TaskStatusPill status={t.status} className="shrink-0 text-[10px]" />
                        <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(t.updatedAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {showQueues && s && (
            <div className="grid gap-3 lg:grid-cols-2">
              <Card title={isManager ? 'Waiting for QC' : 'My QC queue'}>
                {s.qcQueue.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nothing is waiting for QC.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {s.qcQueue.map((item) => (
                      <QueueRow key={item.id} item={item} who={isManager ? (item.qcId ? memberName(lookup, item.qcId) : 'No QC reviewer') : null} />
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Revisions in progress">
                {s.revisions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No cuts are back with editors.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {s.revisions.map((item) => (
                      <QueueRow key={item.id} item={item} who={item.editorId ? memberName(lookup, item.editorId) : 'No editor'} />
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}

          {isManager && <AdminInsights />}

          {isManager && s?.manager && (
            <section aria-label="Across the workspace" className="space-y-2">
              <h2 className="section-label">Across the workspace</h2>
              <div className="stat-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Open tasks" value={s.manager.open} icon={<ListTodo className="h-4 w-4" />} to="/everything?hide=1" />
                <Stat label="Overdue" value={s.manager.overdue} icon={<AlertTriangle className="h-4 w-4" />} to="/everything?overdue=1&hide=1" />
                <Stat label="No editor" value={s.manager.noEditor} icon={<UserX className="h-4 w-4" />} to="/everything?editor=none&hide=1" />
                <Stat label="No QC reviewer" value={s.manager.noQc} icon={<UserX className="h-4 w-4" />} to="/everything?qc=none&hide=1" />
              </div>
            </section>
          )}
        </>
      )}

      {canSeeTeam && (
        <section className="stat-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Workspace summary">
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
            <h2 className="section-label">Spaces</h2>
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
                  className="flex items-center gap-3 surface-card p-3 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      <section className="surface-card p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <h2 className="section-label">Your access</h2>
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
