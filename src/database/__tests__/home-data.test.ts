import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../config', () => ({ isSupabaseConfigured: true }));
vi.mock('../client', () => ({ getSupabaseClient: () => ({ rpc }) }));

import { getHomeSummary, mapHomeSummary } from '../home';
import { dayBounds } from '@/lib/day-bounds';
import { PermissionDeniedError, ValidationError } from '../errors';

const WS = '33333333-3333-4333-8333-333333333333';

beforeEach(() => rpc.mockReset());

describe('dayBounds (the viewer day)', () => {
  it('is local midnight today, local midnight tomorrow, and seven days after that', () => {
    const b = dayBounds(new Date(2026, 9, 21, 15, 30));
    expect(b.dayStart).toEqual(new Date(2026, 9, 21));
    expect(b.dayEnd).toEqual(new Date(2026, 9, 22));
    expect(b.weekEnd).toEqual(new Date(2026, 9, 29));
  });

  it('rolls over month ends', () => {
    const b = dayBounds(new Date(2026, 9, 31, 23, 59));
    expect(b.dayEnd).toEqual(new Date(2026, 10, 1));
    expect(b.weekEnd).toEqual(new Date(2026, 10, 8));
  });
});

describe('getHomeSummary', () => {
  it('calls my_home_summary with the workspace and the three boundaries as ISO times', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const bounds = dayBounds(new Date(2026, 9, 21, 9));
    await getHomeSummary(WS, bounds);
    expect(rpc).toHaveBeenCalledWith('my_home_summary', {
      p_workspace_id: WS,
      p_day_start: bounds.dayStart.toISOString(),
      p_day_end: bounds.dayEnd.toISOString(),
      p_week_end: bounds.weekEnd.toISOString(),
    });
  });

  it('refuses without a workspace, before asking the database', async () => {
    await expect(getHomeSummary('')).rejects.toBeInstanceOf(ValidationError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('turns the database refusals into readable errors', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'no' } });
    await expect(getHomeSummary(WS)).rejects.toBeInstanceOf(PermissionDeniedError);
    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'day boundaries must be ordered' } });
    await expect(getHomeSummary(WS)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('mapHomeSummary reads what the database returned, defensively', () => {
  it('maps a full summary', () => {
    const s = mapHomeSummary({
      role: 'PRODUCTION_MANAGER',
      mine: { total: 7, overdue: 2, dueToday: 1, dueThisWeek: 3, later: 1, finished: 4 },
      qcQueue: [{ id: 'a', title: 'T', listId: 'l', listName: 'L', status: 'QC_FIRST_APPROVAL', statusName: 'QC - FIRST APPROVAL', qcId: 'q', editorId: null, revisionCount: 1, since: '2026-10-20T10:00:00Z' }],
      revisions: [],
      manager: { open: 9, overdue: 1, noEditor: 2, noQc: 3 },
    });
    expect(s.mine).toEqual({ total: 7, overdue: 2, dueToday: 1, dueThisWeek: 3, later: 1, finished: 4 });
    expect(s.qcQueue[0]).toMatchObject({ id: 'a', title: 'T', qcId: 'q', editorId: null, revisionCount: 1, since: '2026-10-20T10:00:00Z' });
    expect(s.manager).toEqual({ open: 9, overdue: 1, noEditor: 2, noQc: 3 });
  });

  it('treats anything missing or malformed as empty or zero, never as an error', () => {
    for (const raw of [null, undefined, 'x', 7, [], {}]) {
      const s = mapHomeSummary(raw);
      expect(s.mine).toEqual({ total: 0, overdue: 0, dueToday: 0, dueThisWeek: 0, later: 0, finished: 0 });
      expect(s.qcQueue).toEqual([]);
      expect(s.revisions).toEqual([]);
      expect(s.manager).toBeNull();
    }
    const odd = mapHomeSummary({ mine: { total: 'many', overdue: NaN }, qcQueue: [null, 5, { title: 'no id' }, { id: 'ok' }], manager: 'yes' });
    expect(odd.mine.total).toBe(0);
    expect(odd.mine.overdue).toBe(0);
    expect(odd.qcQueue).toHaveLength(1);
    expect(odd.qcQueue[0]).toMatchObject({ id: 'ok', title: 'Untitled task', listName: '', revisionCount: 0, since: null });
    expect(odd.manager).toBeNull();
  });
});
