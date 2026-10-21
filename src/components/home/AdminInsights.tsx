import React, { useMemo } from 'react';
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { useProductionMonthly } from '@/hooks/use-production';
import { useTaskSearch } from '@/hooks/use-tasks';
import { useWorkspaceMembers } from '@/hooks/use-team';
import { useWorkflow } from '@/hooks/use-workflow';
import { can } from '@/lib/permissions';
import { memberLookup, memberName } from '@/lib/tasks';
import { isFinishedStatus } from '@/lib/workflow';
import { Stagger, StaggerItem } from '@/components/motion';

/**
 * Charts for the people who run the floor (Owner, Admin, Production Manager): where the open work sits in
 * the pipeline, who is carrying it, how healthy the deadlines are, and how many cuts reached first QC per
 * month. Every number comes from the database (search_tasks under RLS, production_monthly).
 */

const OPEN_WORK = { query: '', filters: { hideFinished: true }, sort: 'manual', dir: 'asc' };
const BRAND = 'hsl(var(--primary))';

const ChartCard: React.FC<{ title: string; hint?: string; children: React.ReactNode; className?: string }> = ({ title, hint, children, className }) => (
  <StaggerItem className={className}>
    <section aria-label={title} className="lift surface-card h-full p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="section-label">{title}</h3>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  </StaggerItem>
);

const tooltipStyle = {
  contentStyle: {
    background: 'hsl(var(--popover) / 0.92)',
    backdropFilter: 'blur(12px)',
    border: '1px solid hsl(var(--border))',
    borderRadius: 12,
    fontSize: 12,
    boxShadow: 'var(--shadow-float)',
  },
  cursor: { fill: 'hsl(var(--muted) / 0.6)' },
} as const;

const Empty: React.FC<{ text: string }> = ({ text }) => <p className="py-8 text-center text-xs text-muted-foreground">{text}</p>;

const AdminInsights: React.FC = () => {
  const { role } = useAuth();
  const workflow = useWorkflow().data;
  const members = useWorkspaceMembers().data;
  const lookup = useMemo(() => memberLookup(members), [members]);
  const open = useTaskSearch(OPEN_WORK);
  const monthly = useProductionMonthly();
  const tasks = useMemo(() => (open.data?.pages.flatMap((p) => p.items) ?? []).filter((t) => !isFinishedStatus(workflow, t.status)), [open.data, workflow]);

  const byStage = useMemo(
    () =>
      (workflow?.statuses ?? [])
        .filter((s) => !isFinishedStatus(workflow, s.key))
        .map((s) => ({ name: s.name, count: tasks.filter((t) => t.status === s.key).length, color: s.color })),
    [workflow, tasks]
  );

  const byEditor = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) counts.set(t.editorId ?? '', (counts.get(t.editorId ?? '') ?? 0) + 1);
    return [...counts.entries()]
      .map(([id, count]) => ({ name: id ? memberName(lookup, id).split(' ')[0] : 'Unassigned', count, unassigned: !id }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [tasks, lookup]);

  const health = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const soon = new Date(today);
    soon.setDate(soon.getDate() + 3);
    let overdue = 0;
    let dueSoon = 0;
    let onTrack = 0;
    let noDate = 0;
    for (const t of tasks) {
      const dates = [t.dueDate, t.clientDeadline].filter((d): d is string => !!d).map((d) => new Date(d).getTime());
      if (!dates.length) noDate++;
      else if (Math.min(...dates) < today.getTime()) overdue++;
      else if (Math.min(...dates) < soon.getTime()) dueSoon++;
      else onTrack++;
    }
    return [
      { name: 'Overdue', value: overdue, color: 'hsl(var(--destructive))' },
      { name: 'Due in 3 days', value: dueSoon, color: 'hsl(38 92% 50%)' },
      { name: 'On track', value: onTrack, color: 'hsl(142 64% 40%)' },
      { name: 'No date', value: noDate, color: 'hsl(var(--muted-foreground) / 0.45)' },
    ];
  }, [tasks]);

  const trend = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      const credits = (monthly.data ?? []).filter((m) => m.year === d.getFullYear() && m.month === d.getMonth() + 1).reduce((n, m) => n + m.credits, 0);
      return { name: d.toLocaleDateString(undefined, { month: 'short' }), credits };
    });
  }, [monthly.data]);

  const loading = open.isLoading || !workflow;
  const totalOpen = tasks.length;
  const seesProduction = can(role, 'production:view');

  return (
    <section aria-label="Insights" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="section-label">Insights</h2>
        <span className="text-[11px] text-muted-foreground">{totalOpen} open tasks</span>
      </div>
      <Stagger className="grid gap-3 lg:grid-cols-3">
        <ChartCard title="Pipeline by stage" hint="open tasks" className="lg:col-span-2">
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : totalOpen === 0 ? (
            <Empty text="No open work in the pipeline." />
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byStage} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" name="Tasks" radius={[6, 6, 2, 2]} animationDuration={700}>
                    {byStage.map((s) => (
                      <Cell key={s.name} fill={s.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Deadline health" hint="open tasks">
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : totalOpen === 0 ? (
            <Empty text="Nothing open." />
          ) : (
            <div className="flex h-48 items-center gap-3">
              <div className="h-full flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={health} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none" animationDuration={700}>
                      {health.map((h) => (
                        <Cell key={h.name} fill={h.color} />
                      ))}
                    </Pie>
                    <Tooltip {...tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1.5 text-xs">
                {health.map((h) => (
                  <li key={h.name} className="flex items-center gap-2">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: h.color }} />
                    <span className="text-muted-foreground">{h.name}</span>
                    <span className="ml-auto font-semibold tabular-nums">{h.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Workload by editor" hint="open tasks" className={seesProduction ? '' : 'lg:col-span-3'}>
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : byEditor.length === 0 ? (
            <Empty text="No open work assigned." />
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byEditor} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
                  <XAxis type="number" allowDecimals={false} hide />
                  <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }} tickLine={false} axisLine={false} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" name="Open tasks" radius={[2, 6, 6, 2]} animationDuration={700}>
                    {byEditor.map((e) => (
                      <Cell key={e.name} fill={e.unassigned ? 'hsl(var(--muted-foreground) / 0.4)' : BRAND} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        {seesProduction && (
          <ChartCard title="Cuts reaching first QC" hint="last 6 months" className="lg:col-span-2">
            {monthly.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                    <defs>
                      <linearGradient id="qcTrend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={BRAND} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                    <Tooltip {...tooltipStyle} />
                    <Area type="monotone" dataKey="credits" name="First QC submissions" stroke={BRAND} strokeWidth={2.5} fill="url(#qcTrend)" animationDuration={900} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        )}
      </Stagger>
    </section>
  );
};

export default AdminInsights;
