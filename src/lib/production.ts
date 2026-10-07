import type { ProductionMonth, TbbRole, WorkspaceMember } from '@/types/database';

/**
 * Pure logic for the production section. The unit is a FIRST QC SUBMISSION (a video's first arrival in
 * QC - FIRST APPROVAL, credited to the editor who submitted it). The words in this file and in the UI
 * say so on purpose: it is not "delivered", "approved" or "closed".
 */

export const UNIT_SINGULAR = 'video first submitted for QC';
export const UNIT_PLURAL = 'videos first submitted for QC';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_SHORT = MONTHS.map((m) => m.slice(0, 3));

export const monthName = (month: number): string => MONTHS[month - 1] ?? '';
export const monthLabel = (year: number, month: number): string => `${monthName(month)} ${year}`;
export const creditsLabel = (n: number): string => `${n} ${n === 1 ? UNIT_SINGULAR : UNIT_PLURAL}`;

/** Twelve counts (Jan..Dec) for one editor in one year. */
export function monthGrid(rows: readonly ProductionMonth[], editorId: string, year: number): number[] {
  const grid = new Array<number>(12).fill(0);
  for (const r of rows) if (r.editorId === editorId && r.year === year && r.month >= 1 && r.month <= 12) grid[r.month - 1] += r.credits;
  return grid;
}

/** Years to offer for an editor: every year with credits plus the current one, newest first. */
export function yearsFor(rows: readonly ProductionMonth[], editorId: string, currentYear: number): number[] {
  const years = new Set<number>([currentYear]);
  for (const r of rows) if (r.editorId === editorId) years.add(r.year);
  return [...years].sort((a, b) => b - a);
}

export interface ProductionSummary {
  thisMonth: number;
  thisYear: number;
  allTime: number;
  /** The last six calendar months, oldest first, ending with the current one. */
  recent: number[];
}

export function summarize(rows: readonly ProductionMonth[], editorId: string, now: Date = new Date()): ProductionSummary {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const mine = rows.filter((r) => r.editorId === editorId);
  const at = (year: number, month: number) => mine.filter((r) => r.year === year && r.month === month).reduce((n, r) => n + r.credits, 0);
  return {
    thisMonth: at(y, m),
    thisYear: mine.filter((r) => r.year === y).reduce((n, r) => n + r.credits, 0),
    allTime: mine.reduce((n, r) => n + r.credits, 0),
    recent: Array.from({ length: 6 }, (_, i) => {
      const d = new Date(y, m - 1 - (5 - i), 1);
      return at(d.getFullYear(), d.getMonth() + 1);
    }),
  };
}

export interface EmployeeRow {
  userId: string;
  name: string;
  /** Still an editor in the workspace. False for someone who has credits but has since left or changed role. */
  current: boolean;
  summary: ProductionSummary;
}

/**
 * Everyone who produces: all current editors (even with no submissions yet) plus anyone who has credits
 * (people who left keep their history). Most productive this month first, then by name.
 */
export function employeeRows(
  members: readonly WorkspaceMember[],
  rows: readonly ProductionMonth[],
  now: Date = new Date(),
  producerRole: TbbRole = 'EDITOR'
): EmployeeRow[] {
  const ids = new Set<string>(members.filter((m) => m.role === producerRole).map((m) => m.userId));
  for (const r of rows) ids.add(r.editorId);
  return [...ids]
    .map((userId) => {
      const member = members.find((m) => m.userId === userId);
      return {
        userId,
        name: member?.profile?.fullName ?? 'Former member',
        current: member?.role === producerRole,
        summary: summarize(rows, userId, now),
      };
    })
    .sort((a, b) => b.summary.thisMonth - a.summary.thisMonth || b.summary.allTime - a.summary.allTime || a.name.localeCompare(b.name));
}

/** Parses ?year=&month= defensively (anything else falls back). */
export function parseMonthParams(year: string | null, month: string | null, fallbackYear: number): { year: number; month: number | null } {
  const y = Number(year);
  const m = Number(month);
  return {
    year: Number.isInteger(y) && y >= 2000 && y <= 2200 ? y : fallbackYear,
    month: Number.isInteger(m) && m >= 1 && m <= 12 ? m : null,
  };
}
