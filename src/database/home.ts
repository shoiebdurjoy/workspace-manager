import { getSupabaseClient } from './client';
import { dayBounds, type DayBounds } from '@/lib/day-bounds';
import { PermissionDeniedError, toDatabaseError, ValidationError } from './errors';

/**
 * The Home page in one call (Phase 11, migration 16: my_home_summary). The function runs with the
 * caller's own rights, so every count respects RLS; it refuses client viewers and non-members.
 *
 * Day boundaries are the VIEWER's: the start of their today, of tomorrow, and the end of "next 7 days".
 */

export interface HomeQueueItem {
  id: string;
  title: string;
  listId: string;
  listName: string;
  status: string;
  statusName: string;
  qcId: string | null;
  editorId: string | null;
  revisionCount: number;
  /** When the task entered its current stage (null if no stage change was ever recorded). */
  since: string | null;
}

export interface HomeSummary {
  role: string | null;
  mine: { total: number; overdue: number; dueToday: number; dueThisWeek: number; later: number; finished: number };
  /** Tasks waiting for QC (first / final approval). QC specialists: the ones they review; managers: all. */
  qcQueue: HomeQueueItem[];
  /** Tasks back with the editor for changes. Same visibility as the queue. */
  revisions: HomeQueueItem[];
  /** Owners, admins and production managers only. */
  manager: { open: number; overdue: number; noEditor: number; noQc: number } | null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

function mapQueue(raw: unknown): HomeQueueItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).id === 'string')
    .map((x) => ({
      id: x.id as string,
      title: str(x.title) ?? 'Untitled task',
      listId: str(x.listId) ?? '',
      listName: str(x.listName) ?? '',
      status: str(x.status) ?? '',
      statusName: str(x.statusName) ?? str(x.status) ?? '',
      qcId: str(x.qcId),
      editorId: str(x.editorId),
      revisionCount: num(x.revisionCount),
      since: str(x.since),
    }));
}

/** Reads the JSON the database returns defensively: anything missing or malformed becomes empty / zero. */
export function mapHomeSummary(raw: unknown): HomeSummary {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mine = (r.mine && typeof r.mine === 'object' ? r.mine : {}) as Record<string, unknown>;
  const manager = r.manager && typeof r.manager === 'object' ? (r.manager as Record<string, unknown>) : null;
  return {
    role: str(r.role),
    mine: {
      total: num(mine.total),
      overdue: num(mine.overdue),
      dueToday: num(mine.dueToday),
      dueThisWeek: num(mine.dueThisWeek),
      later: num(mine.later),
      finished: num(mine.finished),
    },
    qcQueue: mapQueue(r.qcQueue),
    revisions: mapQueue(r.revisions),
    manager: manager ? { open: num(manager.open), overdue: num(manager.overdue), noEditor: num(manager.noEditor), noQc: num(manager.noQc) } : null,
  };
}

export async function getHomeSummary(workspaceId: string, bounds: DayBounds = dayBounds()): Promise<HomeSummary> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');
  const { data, error } = await getSupabaseClient().rpc('my_home_summary', {
    p_workspace_id: workspaceId,
    p_day_start: bounds.dayStart.toISOString(),
    p_day_end: bounds.dayEnd.toISOString(),
    p_week_end: bounds.weekEnd.toISOString(),
  });
  if (error) {
    if (error.code === '42501') throw new PermissionDeniedError('Your role cannot see the task summary of this workspace.');
    if (error.code === '22023') throw new ValidationError(error.message, error);
    throw toDatabaseError('load your summary', error);
  }
  return mapHomeSummary(data);
}
