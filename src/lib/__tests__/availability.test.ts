import { describe, expect, it } from 'vitest';
import { assignableRank, backOnLabel, summarize, validateNote, type Availability } from '../availability';

const a = (userId: string, status: Availability['status']): Availability => ({ userId, status, note: null, backOn: null, updatedAt: '2026-10-22T08:00:00Z' });

describe('team availability', () => {
  it('ranks the most assignable people first, with no status in the middle', () => {
    const order = [a('1', 'ON_LEAVE'), undefined, a('2', 'BUSY'), a('3', 'AVAILABLE'), a('4', 'WORKING')]
      .map((x, i) => ({ x, i }))
      .sort((p, q) => assignableRank(p.x) - assignableRank(q.x))
      .map((p) => p.x?.status ?? 'NONE');
    expect(order).toEqual(['AVAILABLE', 'WORKING', 'NONE', 'BUSY', 'ON_LEAVE']);
  });

  it('counts each status, and people without one', () => {
    const byUser = new Map([['a', a('a', 'AVAILABLE')], ['b', a('b', 'AVAILABLE')], ['c', a('c', 'ON_LEAVE')]]);
    expect(summarize(['a', 'b', 'c', 'd'], byUser)).toEqual({ AVAILABLE: 2, WORKING: 0, BUSY: 0, ON_LEAVE: 1, NONE: 1 });
  });

  it('validates the note and labels a return date', () => {
    expect(validateNote('Editing the Medicus batch')).toBeNull();
    expect(validateNote('x'.repeat(81))).toMatch(/under 80/);
    expect(backOnLabel(null)).toBeNull();
    expect(backOnLabel('2026-10-27')).toMatch(/^back /);
  });
});
