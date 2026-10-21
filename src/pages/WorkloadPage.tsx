import React, { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Clock, Eye } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import { AvailabilityChip, AvailabilityRing } from '@/components/team/Availability';
import { Stagger, StaggerItem } from '@/components/motion';
import { useAvailability } from '@/hooks/use-availability';
import { useTaskSearch } from '@/hooks/use-tasks';
import { useWorkspaceMembers } from '@/hooks/use-team';
import { useWorkflow } from '@/hooks/use-workflow';
import { workloadBy, type WorkloadRow } from '@/lib/calendar';
import { memberLookup, memberName } from '@/lib/tasks';
import { statusOf } from '@/lib/workflow';
import type { TaskStatus } from '@/types/database';

const OPEN_WORK = { query: '', filters: { hideFinished: true }, sort: 'manual', dir: 'asc' };

/**
 * Workload: who carries how much open work, how much of it is late or due within a week, and who is free
 * to take more (their own availability status beside them). Every number counts real open tasks.
 */
const WorkloadPage: React.FC = () => {
  const workflow = useWorkflow().data;
  const members = useWorkspaceMembers().data;
  const lookup = useMemo(() => memberLookup(members), [members]);
  const { byUser } = useAvailability();
  const query = useTaskSearch(OPEN_WORK);

  useEffect(() => {
    document.title = 'Workload · TBB Workspace';
  }, []);

  const tasks = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const isReview = (status: string) => statusOf(workflow, status as TaskStatus)?.category === 'IN_REVIEW';
  const editors = useMemo(() => workloadBy(tasks, 'editorId', isReview), [tasks, workflow]); // eslint-disable-line react-hooks/exhaustive-deps
  const reviewers = useMemo(() => workloadBy(tasks.filter((t) => isReview(t.status)), 'qcId', isReview), [tasks, workflow]); // eslint-disable-line react-hooks/exhaustive-deps
  const max = Math.max(1, ...editors.map((r) => r.open));
  const maxQc = Math.max(1, ...reviewers.map((r) => r.open));

  const row = (r: WorkloadRow, scale: number, filterParam: 'editor' | 'qc') => {
    const name = r.userId ? memberName(lookup, r.userId) : 'Unassigned';
    const member = r.userId ? members?.find((m) => m.userId === r.userId) : undefined;
    return (
      <StaggerItem key={r.userId ?? 'none'}>
        <Link
          to={`/everything?${filterParam}=${r.userId ?? 'none'}&hide=1`}
          className="lift group flex items-center gap-4 surface-card p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {r.userId ? (
            <AvailabilityRing availability={byUser.get(r.userId)}>
              <UserAvatar name={name} src={member?.profile?.avatarUrl ?? undefined} size="md" />
            </AvailabilityRing>
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">?</span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="truncate text-sm font-semibold">{name}</p>
              {r.userId && <AvailabilityChip availability={byUser.get(r.userId)} />}
            </div>
            <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-[hsl(24_94%_58%)] transition-[width] duration-700 ease-out"
                style={{ width: `${(r.open / scale) * 100}%` }}
              />
            </div>
          </div>
          <dl className="grid shrink-0 grid-cols-4 gap-4 text-center">
            <div>
              <dd className="text-xl font-semibold tabular-nums leading-none">{r.open}</dd>
              <dt className="mt-1 text-[10.5px] text-muted-foreground">open</dt>
            </div>
            <div className={r.overdue ? 'text-destructive' : 'text-muted-foreground'}>
              <dd className="flex items-center justify-center gap-0.5 text-xl font-semibold tabular-nums leading-none">
                {r.overdue > 0 && <AlertTriangle className="h-3.5 w-3.5" />}
                {r.overdue}
              </dd>
              <dt className="mt-1 text-[10.5px]">overdue</dt>
            </div>
            <div>
              <dd className="flex items-center justify-center gap-0.5 text-xl font-semibold tabular-nums leading-none">
                {r.dueSoon > 0 && <Clock className="h-3.5 w-3.5 text-amber-500" />}
                {r.dueSoon}
              </dd>
              <dt className="mt-1 text-[10.5px] text-muted-foreground">due in 7 days</dt>
            </div>
            <div>
              <dd className="flex items-center justify-center gap-0.5 text-xl font-semibold tabular-nums leading-none">
                {r.inReview > 0 && <Eye className="h-3.5 w-3.5 text-primary" />}
                {r.inReview}
              </dd>
              <dt className="mt-1 text-[10.5px] text-muted-foreground">in QC</dt>
            </div>
          </dl>
        </Link>
      </StaggerItem>
    );
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="page-title">Workload</h1>
        <p className="page-description">Who is carrying how much open work, and who can take more. Click a person to see their tasks.</p>
      </header>

      {query.isError ? (
        <ErrorState title="The workload could not be loaded" message={query.error instanceof Error ? query.error.message : 'Please try again.'} onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading workload">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-card" />
          ))}
        </div>
      ) : editors.length === 0 ? (
        <EmptyState icon={<Clock />} title="No open work" description="When tasks are assigned to editors, their workload appears here." />
      ) : (
        <>
          <section aria-label="Editors" className="space-y-2">
            <h2 className="section-label">Editors</h2>
            <Stagger className="space-y-2">{editors.map((r) => row(r, max, 'editor'))}</Stagger>
          </section>
          {reviewers.length > 0 && (
            <section aria-label="QC reviewers" className="space-y-2">
              <h2 className="section-label">QC reviewers · cuts waiting for review</h2>
              <Stagger className="space-y-2">{reviewers.map((r) => row(r, maxQc, 'qc'))}</Stagger>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default WorkloadPage;
