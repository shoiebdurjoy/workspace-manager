/** Pure helpers for time tracking (no database). */
/** 95 -> "1 h 35 min" */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}

export function entryMinutes(e: { startedAt: string; endedAt: string | null }, now = Date.now()): number {
  return Math.max(0, ((e.endedAt ? new Date(e.endedAt).getTime() : now) - new Date(e.startedAt).getTime()) / 60_000);
}
