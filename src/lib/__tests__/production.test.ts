import { describe, it, expect } from 'vitest';
import { creditsLabel, employeeRows, monthGrid, monthLabel, parseMonthParams, summarize, yearsFor } from '../production';
import type { ProductionMonth, WorkspaceMember } from '@/types/database';

const row = (editorId: string, year: number, month: number, credits: number): ProductionMonth => ({ editorId, year, month, credits });
const member = (userId: string, role: WorkspaceMember['role'], fullName: string): WorkspaceMember => ({
  workspaceId: 'w', userId, role, createdAt: 'c', updatedAt: 'u',
  profile: { id: userId, email: 'x', fullName, role: 'EDITOR', timezone: 'UTC', isActive: true, createdAt: 'c', updatedAt: 'u' },
});

const NOW = new Date(2026, 9, 15, 12); // October 2026
const ROWS = [
  row('a', 2025, 12, 5), row('a', 2026, 1, 12), row('a', 2026, 8, 20), row('a', 2026, 9, 16), row('a', 2026, 10, 24),
  row('b', 2026, 10, 3), row('gone', 2025, 3, 7),
];

describe('wording: the unit is a FIRST QC SUBMISSION, never "delivered"', () => {
  it('labels say so', () => {
    expect(creditsLabel(24)).toBe('24 videos first submitted for QC');
    expect(creditsLabel(1)).toBe('1 video first submitted for QC');
    expect(creditsLabel(0)).toBe('0 videos first submitted for QC');
    expect(monthLabel(2026, 10)).toBe('October 2026');
    expect(`${creditsLabel(2)} ${monthLabel(2026, 1)}`).not.toMatch(/deliver|approv|closed/i);
  });
});

describe('monthly grid', () => {
  it('is twelve counts for one editor in one year; other editors and years do not leak in', () => {
    expect(monthGrid(ROWS, 'a', 2026)).toEqual([12, 0, 0, 0, 0, 0, 0, 20, 16, 24, 0, 0]);
    expect(monthGrid(ROWS, 'a', 2025)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5]);
    expect(monthGrid(ROWS, 'b', 2026)[9]).toBe(3);
    expect(monthGrid(ROWS, 'nobody', 2026)).toEqual(new Array(12).fill(0));
  });

  it('ignores out-of-range months instead of crashing', () => {
    expect(monthGrid([row('a', 2026, 13, 9), row('a', 2026, 0, 9)], 'a', 2026)).toEqual(new Array(12).fill(0));
  });

  it('offers every year with credits plus the current one, newest first', () => {
    expect(yearsFor(ROWS, 'a', 2026)).toEqual([2026, 2025]);
    expect(yearsFor(ROWS, 'b', 2026)).toEqual([2026]);
    expect(yearsFor([], 'a', 2026)).toEqual([2026]);
  });
});

describe('summary', () => {
  it('this month, this year, all time and the last six months', () => {
    expect(summarize(ROWS, 'a', NOW)).toEqual({ thisMonth: 24, thisYear: 72, allTime: 77, recent: [0, 0, 0, 20, 16, 24] });
  });

  it('counts the recent months across a year boundary', () => {
    expect(summarize(ROWS, 'a', new Date(2026, 0, 10)).recent).toEqual([0, 0, 0, 0, 5, 12]);
  });

  it('an editor with nothing yet is all zeros', () => {
    expect(summarize(ROWS, 'nobody', NOW)).toEqual({ thisMonth: 0, thisYear: 0, allTime: 0, recent: [0, 0, 0, 0, 0, 0] });
  });
});

describe('employees', () => {
  const members = [member('a', 'EDITOR', 'Ada Editor'), member('b', 'EDITOR', 'Ben Editor'), member('c', 'EDITOR', 'Cy Newcomer'), member('q', 'QC_SPECIALIST', 'Quinn QC'), member('m', 'PRODUCTION_MANAGER', 'Mia Manager')];

  it('lists every current editor (even with no submissions) and anyone with credits, busiest this month first, then by all-time', () => {
    const list = employeeRows(members, ROWS, NOW);
    expect(list.map((e) => [e.name, e.summary.thisMonth])).toEqual([['Ada Editor', 24], ['Ben Editor', 3], ['Former member', 0], ['Cy Newcomer', 0]]);
  });

  it('people who left keep their history and are marked as no longer editors; non-editors without credits are not listed', () => {
    const list = employeeRows(members, ROWS, NOW);
    expect(list.find((e) => e.userId === 'gone')).toMatchObject({ current: false, summary: { allTime: 7 } });
    expect(list.some((e) => e.userId === 'q' || e.userId === 'm')).toBe(false);
  });

  it('someone who produced while an editor keeps showing after a role change', () => {
    const list = employeeRows(members, [...ROWS, row('q', 2026, 2, 4)], NOW);
    expect(list.find((e) => e.userId === 'q')).toMatchObject({ current: false, summary: { allTime: 4 } });
  });
});

describe('url params', () => {
  it('are read defensively', () => {
    expect(parseMonthParams('2025', '3', 2026)).toEqual({ year: 2025, month: 3 });
    expect(parseMonthParams(null, null, 2026)).toEqual({ year: 2026, month: null });
    expect(parseMonthParams('abc', '13', 2026)).toEqual({ year: 2026, month: null });
    expect(parseMonthParams('1999', '0', 2026)).toEqual({ year: 2026, month: null });
    expect(parseMonthParams('2026.5', '2.5', 2026)).toEqual({ year: 2026, month: null });
  });
});
