/**
 * Team availability (migration 19): each staff member says whether they are free, working, at capacity
 * or on leave, so managers can see it instead of asking on WhatsApp. Pure helpers, no network.
 */

export const AVAILABILITY_STATUSES = ['AVAILABLE', 'WORKING', 'BUSY', 'ON_LEAVE'] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export interface Availability {
  userId: string;
  status: AvailabilityStatus;
  note: string | null;
  /** YYYY-MM-DD, only when on leave */
  backOn: string | null;
  updatedAt: string;
}

export interface AvailabilityMeta {
  label: string;
  short: string;
  hint: string;
  /** HSL triplet used for the dot, ring and chip */
  tone: string;
  /** Order when sorting people to assign: the most assignable first */
  rank: number;
}

export const AVAILABILITY_META: Record<AvailabilityStatus, AvailabilityMeta> = {
  AVAILABLE: { label: 'Available', short: 'Free', hint: 'Ready for new work', tone: '152 64% 40%', rank: 0 },
  WORKING: { label: 'Working, can take more', short: 'Working', hint: 'On a project, has capacity', tone: '217 91% 56%', rank: 1 },
  BUSY: { label: 'Busy, at capacity', short: 'Busy', hint: 'Do not assign new work', tone: '32 95% 52%', rank: 2 },
  ON_LEAVE: { label: 'On leave', short: 'Away', hint: 'Away from work', tone: '262 70% 60%', rank: 3 },
};
export const NO_STATUS_TONE = '28 8% 60%';

export const NOTE_MAX = 80;

export function validateNote(note: string): string | null {
  const t = note.trim();
  if (t.length > NOTE_MAX) return `Keep the note under ${NOTE_MAX} characters.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(t)) return 'The note cannot contain control characters.';
  return null;
}

/** "back Mon 27 Oct" for a leave with a return date. */
export function backOnLabel(backOn: string | null | undefined): string | null {
  if (!backOn) return null;
  const [y, m, d] = backOn.split('-').map(Number);
  if (!y || !m || !d) return null;
  return `back ${new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`;
}

/** Sort people so the most assignable come first (available, working, no status, busy, on leave). */
export function assignableRank(a: Availability | undefined): number {
  if (!a) return 1.5;
  return AVAILABILITY_META[a.status].rank;
}

export interface AvailabilitySummary {
  AVAILABLE: number;
  WORKING: number;
  BUSY: number;
  ON_LEAVE: number;
  NONE: number;
}

export function summarize(userIds: readonly string[], byUser: ReadonlyMap<string, Availability>): AvailabilitySummary {
  const out: AvailabilitySummary = { AVAILABLE: 0, WORKING: 0, BUSY: 0, ON_LEAVE: 0, NONE: 0 };
  for (const id of userIds) {
    const a = byUser.get(id);
    out[a ? a.status : 'NONE'] += 1;
  }
  return out;
}
