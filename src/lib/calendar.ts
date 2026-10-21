import type { TaskSummary } from '@/types/database';

/** Calendar helpers (Phase 13): pure, local-time, no network. Weeks start on Monday. */

export type DateKind = 'qc' | 'client';

export interface CalendarEvent {
  taskId: string;
  title: string;
  status: string;
  kind: DateKind;
  /** YYYY-MM-DD in the viewer's time zone */
  day: string;
  editorId: string | null;
}

export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The local calendar day of a stored timestamp, or null for none / invalid. */
export function dayOfIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dayKey(d);
}

/** Noon on that local day as a timestamp: moving a deadline keeps it safely inside the day in any zone. */
export function isoForDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}

/** 6 weeks x 7 days covering the month, Monday first. */
export function monthGrid(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d)));
}

/** Both of a task's dates (internal QC due, client deadline) as separate events. */
export function eventsOf(tasks: readonly Pick<TaskSummary, 'id' | 'title' | 'status' | 'dueDate' | 'clientDeadline' | 'editorId'>[]): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const t of tasks) {
    const qc = dayOfIso(t.dueDate);
    const client = dayOfIso(t.clientDeadline);
    if (qc) out.push({ taskId: t.id, title: t.title, status: t.status, kind: 'qc', day: qc, editorId: t.editorId });
    if (client) out.push({ taskId: t.id, title: t.title, status: t.status, kind: 'client', day: client, editorId: t.editorId });
  }
  return out;
}

export function groupByDayKey(events: readonly CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = map.get(e.day);
    if (list) list.push(e);
    else map.set(e.day, [e]);
  }
  return map;
}

export const monthLabel = (year: number, month: number): string => new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/** Workload per person: what is open, late, due soon and waiting in review. */
export interface WorkloadRow {
  userId: string | null;
  open: number;
  overdue: number;
  dueSoon: number;
  inReview: number;
}

export function workloadBy(
  tasks: readonly Pick<TaskSummary, 'status' | 'dueDate' | 'clientDeadline' | 'editorId' | 'qcId'>[],
  who: 'editorId' | 'qcId',
  isReviewStage: (status: string) => boolean,
  now: Date = new Date()
): WorkloadRow[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const soon = today + 7 * 86_400_000;
  const rows = new Map<string | null, WorkloadRow>();
  for (const t of tasks) {
    const id = t[who] ?? null;
    const row = rows.get(id) ?? { userId: id, open: 0, overdue: 0, dueSoon: 0, inReview: 0 };
    row.open += 1;
    const times = [t.dueDate, t.clientDeadline].filter((x): x is string => !!x).map((x) => new Date(x).getTime());
    const nearest = times.length ? Math.min(...times) : null;
    if (nearest !== null && nearest < today) row.overdue += 1;
    else if (nearest !== null && nearest < soon) row.dueSoon += 1;
    if (isReviewStage(t.status)) row.inReview += 1;
    rows.set(id, row);
  }
  return [...rows.values()].sort((a, b) => (a.userId === null ? 1 : b.userId === null ? -1 : b.open - a.open));
}
