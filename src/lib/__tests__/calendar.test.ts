import { describe, expect, it } from 'vitest';
import { dayKey, dayOfIso, eventsOf, groupByDayKey, isoForDay, monthGrid, workloadBy } from '../calendar';

const task = (o: Record<string, unknown>) =>
  ({ id: 't', title: 'T', status: 'IN_EDIT', dueDate: null, clientDeadline: null, editorId: null, qcId: null, ...o }) as Parameters<typeof eventsOf>[0][number] & { qcId: string | null };

describe('calendar', () => {
  it('builds six Monday-first weeks covering the month', () => {
    const grid = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(grid).toHaveLength(6);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(dayKey(grid[0][0])).toBe('2026-09-28'); // Monday before the 1st
    expect(dayKey(grid[0][3])).toBe('2026-10-01');
    expect(grid.flat().some((d) => dayKey(d) === '2026-10-31')).toBe(true);
  });

  it('maps a stored timestamp to the local day and back to noon of that day', () => {
    expect(dayOfIso(null)).toBeNull();
    expect(dayOfIso('not a date')).toBeNull();
    const iso = isoForDay('2026-10-22');
    expect(dayOfIso(iso)).toBe('2026-10-22');
    expect(new Date(iso).getHours()).toBe(12);
  });

  it('turns both deadlines of a task into separate events and groups them by day', () => {
    const events = eventsOf([task({ id: 'a', dueDate: isoForDay('2026-10-20'), clientDeadline: isoForDay('2026-10-22') }), task({ id: 'b', clientDeadline: isoForDay('2026-10-22') }), task({ id: 'c' })]);
    expect(events.map((e) => [e.taskId, e.kind, e.day])).toEqual([
      ['a', 'qc', '2026-10-20'],
      ['a', 'client', '2026-10-22'],
      ['b', 'client', '2026-10-22'],
    ]);
    expect(groupByDayKey(events).get('2026-10-22')).toHaveLength(2);
  });

  it('counts workload per person: open, overdue, due within a week, waiting in review; unassigned last', () => {
    const now = new Date(2026, 9, 22, 9);
    const day = (n: number) => isoForDay(`2026-10-${String(22 + n).padStart(2, '0')}`);
    const rows = workloadBy(
      [
        task({ editorId: 'x', dueDate: day(-3) }),
        task({ editorId: 'x', dueDate: day(2), status: 'QC_FIRST_APPROVAL' }),
        task({ editorId: 'x', dueDate: day(20) }),
        task({ editorId: 'y' }),
        task({ editorId: null, dueDate: day(1) }),
      ],
      'editorId',
      (s) => s.startsWith('QC_'),
      now
    );
    expect(rows.map((r) => r.userId)).toEqual(['x', 'y', null]);
    expect(rows[0]).toMatchObject({ open: 3, overdue: 1, dueSoon: 1, inReview: 1 });
    expect(rows[1]).toMatchObject({ open: 1, overdue: 0, dueSoon: 0 });
    expect(rows[2]).toMatchObject({ open: 1, dueSoon: 1 });
  });
});
