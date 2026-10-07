import { addDays, endOfDay, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import type { AspectRatio, TaskPriority, TaskStatus } from '@/types/database';
import { ASPECT_RATIOS, TASK_PRIORITIES } from '@/lib/tasks';

/**
 * What a person can filter tasks by, how that is written into a URL (so a filtered view can be shared
 * and bookmarked) and how it is turned into the request the database answers. Pure: no network, no
 * React. The database (search_tasks) does the filtering; nothing here decides what anyone may see.
 */

/** The "nobody" choice of the editor / QC filters. */
export const NOBODY = 'none';

export interface TaskFilters {
  search: string;
  statuses: TaskStatus[];
  priorities: TaskPriority[];
  /** Editor ids, or NOBODY. */
  editors: string[];
  /** QC reviewer ids, or NOBODY. */
  qcs: string[];
  /** Assigned to me (as editor or QC reviewer). */
  mine: boolean;
  /** Assigned to me and the next workflow step is mine (a refinement of "mine" done on the loaded rows). */
  needsAction: boolean;
  /** Unfinished with a past deadline (either date). */
  overdue: boolean;
  hideFinished: boolean;
  /** Internal QC due date: a preset or a range (see DateCode). */
  due: string | null;
  /** Client deadline. */
  client: string | null;
  created: string | null;
  aspectRatios: AspectRatio[];
  /** Where the task lives (used by views that span several lists). */
  spaces: string[];
  folders: string[];
  lists: string[];
}

export const EMPTY_FILTERS: TaskFilters = {
  search: '',
  statuses: [],
  priorities: [],
  editors: [],
  qcs: [],
  mine: false,
  needsAction: false,
  overdue: false,
  hideFinished: false,
  due: null,
  client: null,
  created: null,
  aspectRatios: [],
  spaces: [],
  folders: [],
  lists: [],
};

// ---------------------------------------------------------------------------------------
// Dates: presets and ranges
// ---------------------------------------------------------------------------------------

export type DatePreset = 'today' | 'tomorrow' | 'week' | 'next7' | 'past7' | 'past30' | 'month' | 'none';

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  week: 'This week',
  next7: 'Next 7 days',
  past7: 'Last 7 days',
  past30: 'Last 30 days',
  month: 'This month',
  none: 'No date',
};

/** The presets each date filter offers. */
export const DUE_PRESETS: readonly DatePreset[] = ['today', 'tomorrow', 'week', 'next7', 'month', 'none'];
export const CREATED_PRESETS: readonly DatePreset[] = ['today', 'week', 'past7', 'past30', 'month'];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const RANGE = /^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/;

/** A date filter is a preset ("week") or a range of days ("2026-10-01..2026-10-31"; either end may be empty). */
export function isDateCode(value: string | null | undefined): value is string {
  if (!value) return false;
  if ((Object.keys(DATE_PRESET_LABELS) as string[]).includes(value)) return true;
  const m = RANGE.exec(value);
  return !!m && (!!m[1] || !!m[2]);
}

export const rangeCode = (from: string | null, to: string | null): string | null => (from || to ? `${from ?? ''}..${to ?? ''}` : null);

export function splitRange(code: string): { from: string | null; to: string | null } | null {
  const m = RANGE.exec(code);
  return m ? { from: m[1] ?? null, to: m[2] ?? null } : null;
}

const localDay = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export interface ResolvedDates {
  from?: string;
  to?: string;
  none?: boolean;
}

/** The instants a date filter means for someone whose "today" is `today` (their own calendar). */
export function resolveDateCode(code: string, today: Date): ResolvedDates {
  const start = startOfDay(today);
  const iso = (d: Date) => d.toISOString();
  switch (code) {
    case 'today':
      return { from: iso(start), to: iso(endOfDay(start)) };
    case 'tomorrow':
      return { from: iso(addDays(start, 1)), to: iso(endOfDay(addDays(start, 1))) };
    case 'week':
      return { from: iso(startOfWeek(start, { weekStartsOn: 1 })), to: iso(endOfWeek(start, { weekStartsOn: 1 })) };
    case 'next7':
      return { from: iso(start), to: iso(endOfDay(addDays(start, 6))) };
    case 'past7':
      return { from: iso(addDays(start, -6)), to: iso(endOfDay(start)) };
    case 'past30':
      return { from: iso(addDays(start, -29)), to: iso(endOfDay(start)) };
    case 'month':
      return { from: iso(startOfMonth(start)), to: iso(endOfMonth(start)) };
    case 'none':
      return { none: true };
    default: {
      const r = splitRange(code);
      if (!r) return {};
      return {
        ...(r.from && ISO_DAY.test(r.from) ? { from: iso(startOfDay(localDay(r.from))) } : {}),
        ...(r.to && ISO_DAY.test(r.to) ? { to: iso(endOfDay(localDay(r.to))) } : {}),
      };
    }
  }
}

/** "Today", "Next 7 days", "1 Oct - 31 Oct": what a date filter says, for chips and buttons. */
export function dateCodeLabel(code: string): string {
  if (code in DATE_PRESET_LABELS) return DATE_PRESET_LABELS[code as DatePreset];
  const r = splitRange(code);
  if (!r) return code;
  const fmt = (d: string) => localDay(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (r.from && r.to) return `${fmt(r.from)} - ${fmt(r.to)}`;
  return r.from ? `From ${fmt(r.from)}` : `Until ${fmt(r.to as string)}`;
}

// ---------------------------------------------------------------------------------------
// Counting and describing
// ---------------------------------------------------------------------------------------

export function countActiveFilters(f: TaskFilters): number {
  return (
    (f.search.trim() ? 1 : 0) +
    (f.statuses.length ? 1 : 0) +
    (f.priorities.length ? 1 : 0) +
    (f.editors.length ? 1 : 0) +
    (f.qcs.length ? 1 : 0) +
    (f.mine ? 1 : 0) +
    (f.needsAction ? 1 : 0) +
    (f.overdue ? 1 : 0) +
    (f.hideFinished ? 1 : 0) +
    (f.due ? 1 : 0) +
    (f.client ? 1 : 0) +
    (f.created ? 1 : 0) +
    (f.aspectRatios.length ? 1 : 0) +
    (f.spaces.length ? 1 : 0) +
    (f.folders.length ? 1 : 0) +
    (f.lists.length ? 1 : 0)
  );
}

// ---------------------------------------------------------------------------------------
// The request the database answers
// ---------------------------------------------------------------------------------------

/** What search_tasks receives besides the text and sorting: only the filters in use. */
export type SearchFilters = Record<string, unknown>;

export interface SearchContext {
  me: string | null | undefined;
  /** The viewer's today (their time zone): dates, "overdue" and the week all depend on it. */
  today: Date;
}

/** Nobody has this id: "assigned to me" for someone who is not signed in matches nothing. */
const NO_ONE = '00000000-0000-0000-0000-000000000000';

export function toSearchFilters(f: TaskFilters, ctx: SearchContext): SearchFilters {
  const out: SearchFilters = {};
  const put = (key: string, value: unknown[]) => {
    if (value.length) out[key] = value;
  };
  put('spaces', f.spaces);
  put('folders', f.folders);
  put('lists', f.lists);
  put('statuses', f.statuses);
  put('priorities', f.priorities);
  put('aspectRatios', f.aspectRatios);
  put('editors', f.editors.filter((e) => e !== NOBODY));
  if (f.editors.includes(NOBODY)) out.noEditor = true;
  put('qcs', f.qcs.filter((e) => e !== NOBODY));
  if (f.qcs.includes(NOBODY)) out.noQc = true;
  if (f.mine || f.needsAction) out.people = [ctx.me ?? NO_ONE];

  for (const [code, from, to, none] of [
    [f.due, 'dueFrom', 'dueTo', 'noDue'],
    [f.client, 'clientFrom', 'clientTo', 'noClient'],
    [f.created, 'createdFrom', 'createdTo', null],
  ] as const) {
    if (!isDateCode(code)) continue;
    const r = resolveDateCode(code, ctx.today);
    if (r.from) out[from] = r.from;
    if (r.to) out[to] = r.to;
    if (r.none && none) out[none] = true;
  }
  if (f.overdue) {
    out.overdue = true;
    out.overdueBefore = startOfDay(ctx.today).toISOString();
  }
  if (f.hideFinished) out.hideFinished = true;
  return out;
}

// ---------------------------------------------------------------------------------------
// URL (a shareable view): ?q=walmart&status=QC_REVISION_NEEDED&editor=<id>&due=week
// ---------------------------------------------------------------------------------------

// An id from a link: letters, digits, dashes and underscores only (real ids are UUIDs; the database refuses
// anything that is not one, and nothing else, such as quotes or spaces, ever gets as far as a request).
const ID_LIKE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const STATUS_KEY = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_VALUES = 50;

/** The URL parameters that hold filters (the others, such as ?view=, belong to someone else). */
export const FILTER_PARAMS = ['q', 'status', 'priority', 'editor', 'qc', 'mine', 'needs', 'overdue', 'hide', 'due', 'client', 'created', 'aspect', 'space', 'folder', 'list'] as const;

const list = (raw: string | null, ok: (v: string) => boolean): string[] =>
  raw
    ? [...new Set(raw.split(',').map((v) => v.trim()).filter((v) => v.length > 0 && v.length <= 100 && ok(v)))].slice(0, MAX_VALUES)
    : [];

/** Reads filters from a URL defensively: anything unknown or malformed is simply ignored. */
export function readFilters(params: URLSearchParams): TaskFilters {
  const flag = (k: string) => params.get(k) === '1';
  const code = (k: string) => {
    const v = params.get(k);
    return isDateCode(v) ? v : null;
  };
  const person = (v: string) => v === NOBODY || ID_LIKE.test(v);
  return {
    search: (params.get('q') ?? '').slice(0, 200),
    statuses: list(params.get('status'), (v) => STATUS_KEY.test(v)) as TaskStatus[],
    priorities: list(params.get('priority'), (v) => TASK_PRIORITIES.some((p) => p.value === v)) as TaskPriority[],
    editors: list(params.get('editor'), person),
    qcs: list(params.get('qc'), person),
    mine: flag('mine'),
    needsAction: flag('needs'),
    overdue: flag('overdue'),
    hideFinished: flag('hide'),
    due: code('due'),
    client: code('client'),
    created: code('created'),
    aspectRatios: list(params.get('aspect'), (v) => ASPECT_RATIOS.some((a) => a.value === v)) as AspectRatio[],
    spaces: list(params.get('space'), (v) => ID_LIKE.test(v)),
    folders: list(params.get('folder'), (v) => ID_LIKE.test(v)),
    lists: list(params.get('list'), (v) => ID_LIKE.test(v)),
  };
}

/** Writes filters into `params` (returns a new object): only the ones in use, so a clean view has a clean URL. */
export function writeFilters(params: URLSearchParams, f: TaskFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const k of FILTER_PARAMS) next.delete(k);
  const set = (k: string, v: string | null | undefined) => {
    if (v) next.set(k, v);
  };
  set('q', f.search.trim());
  set('status', f.statuses.join(','));
  set('priority', f.priorities.join(','));
  set('editor', f.editors.join(','));
  set('qc', f.qcs.join(','));
  if (f.mine) next.set('mine', '1');
  if (f.needsAction) next.set('needs', '1');
  if (f.overdue) next.set('overdue', '1');
  if (f.hideFinished) next.set('hide', '1');
  set('due', f.due);
  set('client', f.client);
  set('created', f.created);
  set('aspect', f.aspectRatios.join(','));
  set('space', f.spaces.join(','));
  set('folder', f.folders.join(','));
  set('list', f.lists.join(','));
  return next;
}
