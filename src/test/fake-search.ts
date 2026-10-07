import { TBB_WORKFLOW } from '@/test/workflow-fixture';
import type { TaskSummary } from '@/types/database';

/**
 * Test-only stand-in for the database's search_tasks: it answers the same request shape over a fixed
 * set of rows, so component tests can exercise filters, search and URL state end to end. The real
 * function is tested against a real Postgres (supabase/tests); this keeps the UI tests honest about
 * WHAT is asked, and lets them check what is shown for the answer.
 */
interface Request {
  query?: string;
  filters?: Record<string, unknown>;
  sort?: string;
  dir?: string;
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const finished = (status: string) => TBB_WORKFLOW.statuses.find((s) => s.key === status)?.category === 'COMPLETED';

export function fakeSearch(rows: () => readonly TaskSummary[]) {
  return async (_workspaceId: string, request: Request = {}, page = 0, pageSize = 500) => {
    const f = request.filters ?? {};
    const words = (request.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const at = (v: unknown) => (typeof v === 'string' ? new Date(v).getTime() : NaN);
    const matched = rows().filter((t) => {
      const hay = `${t.title} ${t.id}`.toLowerCase();
      if (!words.every((w) => hay.includes(w.replace(/^#/, '')))) return false;
      if (arr(f.statuses).length && !arr(f.statuses).includes(t.status)) return false;
      if (arr(f.priorities).length && !arr(f.priorities).includes(t.priority)) return false;
      if (arr(f.aspectRatios).length && !arr(f.aspectRatios).includes(t.aspectRatio ?? '')) return false;
      if (arr(f.lists).length && !arr(f.lists).includes(t.listId)) return false;
      if (arr(f.editors).length || f.noEditor) {
        const ok = (arr(f.editors).length && t.editorId && arr(f.editors).includes(t.editorId)) || (f.noEditor && !t.editorId);
        if (!ok) return false;
      }
      if (arr(f.qcs).length || f.noQc) {
        const ok = (arr(f.qcs).length && t.qcId && arr(f.qcs).includes(t.qcId)) || (f.noQc && !t.qcId);
        if (!ok) return false;
      }
      if (arr(f.people).length && !(arr(f.people).includes(t.editorId ?? '') || arr(f.people).includes(t.qcId ?? ''))) return false;
      if (f.noDue && t.dueDate) return false;
      if (f.dueFrom && !(at(t.dueDate) >= at(f.dueFrom))) return false;
      if (f.dueTo && !(at(t.dueDate) <= at(f.dueTo))) return false;
      if (f.overdue) {
        const before = at(f.overdueBefore);
        if (!(at(t.dueDate) < before || at(t.clientDeadline) < before) || finished(t.status)) return false;
      }
      if (f.hideFinished && finished(t.status)) return false;
      return true;
    });
    const dir = request.dir === 'desc' ? -1 : 1;
    const sorted = [...matched].sort((a, b) => dir * (a.position - b.position));
    return { items: sorted.slice(page * pageSize, (page + 1) * pageSize), total: sorted.length };
  };
}
