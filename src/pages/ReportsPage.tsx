import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Clapperboard, RotateCcw, Timer, TrendingUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { AnimatedNumber, Stagger, StaggerItem } from '@/components/motion';
import { getKpiReport } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { useProductionTimezone } from '@/hooks/use-production';
import { cn } from '@/lib/utils';

const RANGES = [
  { weeks: 4, label: '4 weeks' },
  { weeks: 12, label: '12 weeks' },
  { weeks: 26, label: '6 months' },
] as const;

const tick = { fontSize: 10, fill: 'hsl(var(--muted-foreground))' } as const;
const tooltip = {
  contentStyle: { background: 'hsl(var(--popover) / 0.92)', backdropFilter: 'blur(12px)', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12, boxShadow: 'var(--shadow-float)' },
  cursor: { fill: 'hsl(var(--muted) / 0.6)' },
} as const;

const hoursLabel = (h: number | null) => (h === null ? '-' : h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h.toFixed(1)} h`);

const Kpi: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode; tone: string }> = ({ icon, label, children, tone }) => (
  <StaggerItem>
    <div className="lift surface-card flex items-center gap-3 p-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control" style={{ background: `hsl(${tone} / 0.14)`, color: `hsl(${tone})`, boxShadow: `inset 0 0 0 1px hsl(${tone} / 0.18)` }}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-semibold leading-none tracking-tight tabular-nums">{children}</p>
        <p className="mt-1.5 truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  </StaggerItem>
);

/** Reports for Owner and Admin: output per week, turnaround and revisions per client (first-QC based). */
const ReportsPage: React.FC = () => {
  const { workspace } = useAuth();
  const tz = useProductionTimezone();
  const [weeks, setWeeks] = useState<number>(12);
  const ws = workspace?.id ?? '';
  const report = useQuery({ queryKey: ['workspace', ws, 'kpi-report', weeks, tz], queryFn: () => getKpiReport(ws, weeks, tz), enabled: !!ws, staleTime: 60_000 });

  useEffect(() => {
    document.title = 'Reports · TBB Workspace';
  }, []);

  const data = report.data;
  const weekly = (data?.weekly ?? []).map((w) => ({ name: new Date(`${w.weekStart}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), videos: w.videos }));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-description">Videos reaching first QC, how long they take, and how many revisions each client needs.</p>
        </div>
        <div role="group" aria-label="Range" className="pill-group">
          {RANGES.map((r) => (
            <button key={r.weeks} type="button" aria-pressed={weeks === r.weeks} onClick={() => setWeeks(r.weeks)} className={cn('pill-item', weeks === r.weeks && 'text-foreground')}>
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {report.isError ? (
        <ErrorState title="The report could not be loaded" message={report.error instanceof Error ? report.error.message : 'Please try again.'} onRetry={() => void report.refetch()} />
      ) : report.isLoading || !data ? (
        <div className="space-y-3" role="status" aria-label="Loading report">
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 rounded-card" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-card" />
        </div>
      ) : data.totals.videos === 0 ? (
        <EmptyState icon={<TrendingUp />} title="No finished first cuts in this period" description="When editors send videos to QC for the first time, their output, turnaround and revisions are reported here." />
      ) : (
        <>
          <Stagger className="grid gap-3 sm:grid-cols-3">
            <Kpi icon={<Clapperboard className="h-5 w-5" />} label="Videos reaching first QC" tone="217 91% 56%">
              <AnimatedNumber value={data.totals.videos} />
            </Kpi>
            <Kpi icon={<Timer className="h-5 w-5" />} label={`Average turnaround · median ${hoursLabel(data.turnaround.medianHours)}`} tone="262 70% 60%">
              {hoursLabel(data.turnaround.avgHours)}
            </Kpi>
            <Kpi icon={<RotateCcw className="h-5 w-5" />} label="Revisions per video" tone="32 95% 52%">
              {data.totals.avgRevisions === null ? '-' : data.totals.avgRevisions.toFixed(1)}
            </Kpi>
          </Stagger>

          <section aria-label="Videos per week" className="lift surface-card p-4">
            <h2 className="section-label mb-3">Videos reaching first QC, per week</h2>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weekly} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                  <defs>
                    <linearGradient id="kpiWeekly" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                  <XAxis dataKey="name" tick={tick} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={tick} tickLine={false} axisLine={false} />
                  <Tooltip {...tooltip} />
                  <Area type="monotone" dataKey="videos" name="Videos" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#kpiWeekly)" animationDuration={900} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <section aria-label="Videos per client" className="lift surface-card p-4">
              <h2 className="section-label mb-3">Videos per client list</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.clients} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
                    <XAxis type="number" allowDecimals={false} hide />
                    <YAxis type="category" dataKey="name" width={110} tick={{ ...tick, fill: 'hsl(var(--foreground))', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip {...tooltip} />
                    <Bar dataKey="videos" name="Videos" fill="hsl(var(--primary))" radius={[2, 6, 6, 2]} animationDuration={700} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section aria-label="Revisions per client" className="lift surface-card p-4">
              <h2 className="section-label mb-3">Average revisions per video, by client list</h2>
              <ul className="space-y-3">
                {[...data.clients]
                  .sort((a, b) => b.avgRevisions - a.avgRevisions)
                  .map((c) => (
                    <li key={c.listId} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="truncate font-medium">{c.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {c.avgRevisions.toFixed(1)} revisions · {hoursLabel(c.avgHours)} · {c.videos} {c.videos === 1 ? 'video' : 'videos'}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div className="h-full rounded-full bg-gradient-to-r from-[hsl(32_95%_52%)] to-destructive transition-[width] duration-700 ease-out" style={{ width: `${Math.min(100, (c.avgRevisions / Math.max(1, ...data.clients.map((x) => x.avgRevisions))) * 100)}%` }} />
                      </div>
                    </li>
                  ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
};

export default ReportsPage;
