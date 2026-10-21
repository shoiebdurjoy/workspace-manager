import { getSupabaseClient } from './client';
import { PermissionDeniedError, toDatabaseError, ValidationError } from './errors';

/** The KPI report (migration 22): first-QC submissions, turnaround and revisions per client list. */
export interface KpiReport {
  weekly: Array<{ weekStart: string; videos: number }>;
  turnaround: { videos: number; avgHours: number | null; medianHours: number | null };
  clients: Array<{ listId: string; name: string; videos: number; avgRevisions: number; avgHours: number }>;
  totals: { videos: number; avgRevisions: number | null };
}

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));

/** Reads the JSON defensively: anything missing or malformed becomes empty or zero. */
export function mapKpiReport(raw: unknown): KpiReport {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);
  const t = (r.turnaround && typeof r.turnaround === 'object' ? r.turnaround : {}) as Record<string, unknown>;
  const totals = (r.totals && typeof r.totals === 'object' ? r.totals : {}) as Record<string, unknown>;
  return {
    weekly: arr(r.weekly).map((w) => ({ weekStart: String(w.weekStart ?? ''), videos: num(w.videos) })),
    turnaround: { videos: num(t.videos), avgHours: numOrNull(t.avgHours), medianHours: numOrNull(t.medianHours) },
    clients: arr(r.clients).map((c) => ({ listId: String(c.listId ?? ''), name: String(c.name ?? 'Unnamed list'), videos: num(c.videos), avgRevisions: num(c.avgRevisions), avgHours: num(c.avgHours) })),
    totals: { videos: num(totals.videos), avgRevisions: numOrNull(totals.avgRevisions) },
  };
}

export async function getKpiReport(workspaceId: string, weeks = 12, timezone = 'UTC'): Promise<KpiReport> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');
  const { data, error } = await getSupabaseClient().rpc('kpi_report', { p_workspace_id: workspaceId, p_weeks: weeks, p_timezone: timezone });
  if (error) {
    if (error.code === '42501') throw new PermissionDeniedError('Only the owner and admins can see reports.');
    throw toDatabaseError('load the report', error);
  }
  return mapKpiReport(data);
}
