import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { useAuth } from '@/hooks/use-auth';
import { useTaskSearch, useUpdateTask } from '@/hooks/use-tasks';
import { useWorkflow } from '@/hooks/use-workflow';
import { dayKey, eventsOf, groupByDayKey, isoForDay, monthGrid, monthLabel, type CalendarEvent } from '@/lib/calendar';
import { taskAccess } from '@/lib/tasks';
import { hierarchyPaths } from '@/lib/hierarchy';
import { statusOf } from '@/lib/workflow';
import { cn } from '@/lib/utils';
import type { TaskStatus } from '@/types/database';

const OPEN_WORK = { query: '', filters: { hideFinished: true }, sort: 'manual', dir: 'asc' };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_PER_DAY = 3;

/**
 * Deadlines on a month calendar: every open task shows on its internal QC due date (a filled dot) and its
 * client deadline (a ring). Managers drag a chip to another day to reschedule that date; the database
 * decides who may (a refusal puts the chip back and says why).
 */
const CalendarPage: React.FC = () => {
  const { role } = useAuth();
  const workflow = useWorkflow().data;
  const query = useTaskSearch(OPEN_WORK);
  const update = useUpdateTask();
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const canMove = taskAccess(role, { isAssignedEditor: false }).editBrief;

  useEffect(() => {
    document.title = 'Calendar · TBB Workspace';
  }, []);

  const tasks = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const byDay = useMemo(() => groupByDayKey(eventsOf(tasks)), [tasks]);
  const grid = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const todayKey = dayKey(today);
  const step = (by: number) => setCursor((c) => { const d = new Date(c.year, c.month + by, 1); return { year: d.getFullYear(), month: d.getMonth() }; });
  const monthEvents = grid.flat().filter((d) => d.getMonth() === cursor.month).reduce((n, d) => n + (byDay.get(dayKey(d))?.length ?? 0), 0);

  const drop = (day: string, raw: string) => {
    setDragOver(null);
    try {
      const { taskId, kind, from } = JSON.parse(raw) as { taskId: string; kind: 'qc' | 'client'; from: string };
      if (from === day) return;
      update.mutate({ taskId, patch: kind === 'qc' ? { dueDate: isoForDay(day) } : { clientDeadline: isoForDay(day) } });
    } catch {
      /* not one of ours */
    }
  };

  const chip = (e: CalendarEvent) => {
    const color = statusOf(workflow, e.status as TaskStatus)?.color ?? 'hsl(var(--primary))';
    return (
      <Link
        key={`${e.taskId}-${e.kind}`}
        to={hierarchyPaths.taskById(e.taskId)}
        draggable={canMove}
        onDragStart={(ev) => ev.dataTransfer.setData('text/plain', JSON.stringify({ taskId: e.taskId, kind: e.kind, from: e.day }))}
        title={`${e.title} · ${e.kind === 'qc' ? 'QC due' : 'Client deadline'}`}
        className={cn('press group/chip flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium hover:bg-muted', canMove && 'cursor-grab active:cursor-grabbing')}
      >
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={e.kind === 'qc' ? { background: color } : { boxShadow: `inset 0 0 0 2px ${color}` }}
        />
        <span className="truncate">{e.title}</span>
      </Link>
    );
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-description">
            Deadlines for every open task. <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-foreground/70" /> QC due</span>{' '}
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full ring-2 ring-inset ring-foreground/70" /> client deadline</span>
            {canMove && ' · drag a chip to reschedule it'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-full" onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}>
            Today
          </Button>
          <div className="pill-group">
            <button type="button" aria-label="Previous month" className="pill-item px-2" onClick={() => step(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[8.5rem] text-center text-sm font-semibold tracking-tight" aria-live="polite">
              {monthLabel(cursor.year, cursor.month)}
            </span>
            <button type="button" aria-label="Next month" className="pill-item px-2" onClick={() => step(1)}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {query.isError ? (
        <ErrorState title="The calendar could not be loaded" message={query.error instanceof Error ? query.error.message : 'Please try again.'} onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <Skeleton className="h-[34rem] w-full rounded-card" />
      ) : (
        <section aria-label={`Calendar, ${monthLabel(cursor.year, cursor.month)}`} className="surface-card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border/60 bg-muted/30">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {grid.flat().map((d) => {
              const key = dayKey(d);
              const events = byDay.get(key) ?? [];
              const outside = d.getMonth() !== cursor.month;
              const isToday = key === todayKey;
              const shown = expanded === key ? events : events.slice(0, MAX_PER_DAY);
              return (
                <div
                  key={key}
                  role="gridcell"
                  aria-label={`${d.toDateString()}, ${events.length} ${events.length === 1 ? 'deadline' : 'deadlines'}`}
                  onDragOver={(e) => { if (canMove) { e.preventDefault(); setDragOver(key); } }}
                  onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
                  onDrop={(e) => { e.preventDefault(); drop(key, e.dataTransfer.getData('text/plain')); }}
                  className={cn(
                    'min-h-[6.5rem] border-b border-r border-border/50 p-1.5 transition-colors duration-150 [&:nth-child(7n)]:border-r-0',
                    outside && 'bg-muted/25 text-muted-foreground',
                    dragOver === key && 'bg-primary/10 ring-2 ring-inset ring-primary/40'
                  )}
                >
                  <div className="mb-1 flex justify-end">
                    <span className={cn('flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium tabular-nums', isToday && 'bg-primary text-primary-foreground shadow-sm')}>{d.getDate()}</span>
                  </div>
                  <div className="space-y-0.5">
                    {shown.map(chip)}
                    {events.length > MAX_PER_DAY && expanded !== key && (
                      <button type="button" onClick={() => setExpanded(key)} className="px-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                        +{events.length - MAX_PER_DAY} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" /> {monthEvents} {monthEvents === 1 ? 'deadline' : 'deadlines'} in {monthLabel(cursor.year, cursor.month)}
      </p>
    </div>
  );
};

export default CalendarPage;
