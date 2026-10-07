import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Info, Search, UsersRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/ui/user-avatar';
import MonthBars from '@/components/production/MonthBars';
import MonthVideos from '@/components/production/MonthVideos';
import { useProductionMonthly } from '@/hooks/use-production';
import { useWorkspaceMembers } from '@/hooks/use-team';
import { EmployeeRow, employeeRows, monthGrid, parseMonthParams, summarize, yearsFor, UNIT_PLURAL } from '@/lib/production';
import type { WorkspaceMember } from '@/types/database';

const NO_MEMBERS: readonly WorkspaceMember[] = [];

const Spark: React.FC<{ values: readonly number[] }> = ({ values }) => {
  const max = Math.max(1, ...values);
  return (
    <span aria-hidden className="flex h-6 items-end gap-0.5">
      {values.map((n, i) => (
        <span key={i} className={cn('w-1.5 rounded-sm', n ? 'bg-primary/70' : 'bg-border')} style={{ height: n ? `${Math.max(4, Math.round((n / max) * 24))}px` : 2 }} />
      ))}
    </span>
  );
};

const Kpi: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-xl border border-border/80 bg-card px-4 py-3">
    <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
    <div className="text-xs text-muted-foreground">{label}</div>
  </div>
);

/**
 * Employee production (Owner / Admin). Counts VIDEOS FIRST SUBMITTED FOR QC: a video is credited once, in
 * the month it first reached QC - FIRST APPROVAL, to the editor who submitted it. Later revisions,
 * reassignment, approval or delivery never move it.
 */
const Production: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const monthly = useProductionMonthly();
  const members = useWorkspaceMembers().data ?? NO_MEMBERS;
  const [filter, setFilter] = useState('');
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    document.title = 'Production · TBB Workspace';
  }, []);

  const rows = monthly.data;
  const employees = useMemo(() => (rows ? employeeRows(members, rows, now) : []), [members, rows, now]);
  const editorId = params.get('editor');
  const selected: EmployeeRow | undefined = employees.find((e) => e.userId === editorId);
  const { year, month } = parseMonthParams(params.get('year'), params.get('month'), now.getFullYear());

  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: false });
  };

  const shown = employees.filter((e) => !filter.trim() || e.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const teamThisMonth = employees.reduce((n, e) => n + e.summary.thisMonth, 0);

  let list: React.ReactNode;
  if (monthly.isError) {
    list = <ErrorState title="Production could not be loaded" message={monthly.error instanceof Error ? monthly.error.message : 'Please try again.'} onRetry={() => void monthly.refetch()} />;
  } else if (monthly.isLoading || !rows) {
    list = (
      <div role="status" aria-label="Loading production" className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  } else if (employees.length === 0) {
    list = <EmptyState icon={<UsersRound className="h-6 w-6" />} title="No editors yet" description="Editors appear here as soon as they are added to the workspace." />;
  } else {
    list = (
      <>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search employees"
            aria-label="Search employees"
            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Team this month: <strong className="font-semibold text-foreground tabular-nums">{teamThisMonth}</strong> {UNIT_PLURAL}
        </p>
        <ul aria-label="Employees" className="overflow-hidden rounded-xl border border-border/80 bg-card">
          {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No employee matches.</li>}
          {shown.map((e) => {
            const on = e.userId === selected?.userId;
            const member = members.find((m) => m.userId === e.userId);
            return (
              <li key={e.userId} className="border-b border-border/60 last:border-b-0">
                <button
                  type="button"
                  aria-current={on ? 'true' : undefined}
                  onClick={() => go({ editor: e.userId, year: String(now.getFullYear()), month: null })}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    on && 'bg-brand-subtle/60 shadow-[inset_2px_0_0_hsl(var(--brand-accent))]'
                  )}
                >
                  <UserAvatar name={e.name} src={member?.profile?.avatarUrl ?? undefined} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{e.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {e.summary.thisYear} this year · {e.summary.allTime} all time{e.current ? '' : ' · no longer an editor'}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-0.5">
                    <span className="text-sm font-semibold tabular-nums" aria-label={`${e.summary.thisMonth} this month`}>
                      {e.summary.thisMonth}
                    </span>
                    <Spark values={e.summary.recent} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  let detail: React.ReactNode = null;
  if (selected && rows) {
    const s = summarize(rows, selected.userId, now);
    const grid = monthGrid(rows, selected.userId, year);
    const years = yearsFor(rows, selected.userId, now.getFullYear());
    const idx = years.indexOf(year);
    const older = years[idx + 1];
    const newer = idx > 0 ? years[idx - 1] : undefined;
    const yearTotal = grid.reduce((a, b) => a + b, 0);
    const setYear = (y: number) => go({ year: String(y), month: null });
    detail = (
      <section aria-label={`Production of ${selected.name}`} className="min-w-0 space-y-5">
        <header className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="-ml-2 h-8 px-2 lg:hidden" onClick={() => go({ editor: null, year: null, month: null })} aria-label="Back to all employees">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <UserAvatar name={selected.name} src={members.find((m) => m.userId === selected.userId)?.profile?.avatarUrl ?? undefined} size="md" />
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight">{selected.name}</h2>
            <p className="text-xs text-muted-foreground">Videos first submitted for QC</p>
          </div>
        </header>

        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Kpi label="This month" value={s.thisMonth} />
          <Kpi label="This year" value={s.thisYear} />
          <Kpi label="All time" value={s.allTime} />
        </div>

        <div className="rounded-xl border border-border/80 bg-card p-3 sm:p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={older === undefined} onClick={() => older !== undefined && setYear(older)} aria-label="Previous year">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h3 className="min-w-[3.5rem] text-center text-sm font-semibold tabular-nums">{year}</h3>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={newer === undefined} onClick={() => newer !== undefined && setYear(newer)} aria-label="Next year">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              <strong className="font-semibold tabular-nums text-foreground">{yearTotal}</strong> in {year}
            </span>
          </div>
          <MonthBars
            year={year}
            counts={grid}
            selected={month}
            lastMonth={year === now.getFullYear() ? now.getMonth() + 1 : 12}
            onSelect={(m) => go({ month: month === m ? null : String(m) })}
          />
        </div>

        {month ? (
          <MonthVideos editorId={selected.userId} year={year} month={month} />
        ) : (
          <p className="text-sm text-muted-foreground">Select a month to see the videos behind its number.</p>
        )}
      </section>
    );
  } else if (editorId && rows && !selected) {
    detail = <EmptyState title="Employee not found" description="They may have been removed from the workspace and never submitted a video." />;
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">Production</h1>
        <p className="flex max-w-3xl items-start gap-1.5 text-xs text-muted-foreground">
          <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Counts <strong className="font-medium text-foreground">videos first submitted for QC</strong>: a video is credited once, to the editor who first moved it to
            QC - FIRST APPROVAL, in the month that happened. Revisions, reassignment, final approval and delivery never change it.
          </span>
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className={cn('min-w-0 space-y-3', selected && 'hidden lg:block')}>{list}</div>
        <div className={cn('min-w-0', !detail && 'hidden lg:block')}>
          {detail ?? (
            <div className="hidden rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground lg:block">
              Select an employee to see their production by month.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Production;
