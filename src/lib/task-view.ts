import { differenceInCalendarDays } from 'date-fns';
import type { TaskSummary, TbbRole, Workflow, WorkspaceMember } from '@/types/database';
import { TASK_PRIORITIES, dueState, priorityOption } from '@/lib/tasks';
import { EMPTY_FILTERS, NOBODY, countActiveFilters, type TaskFilters } from '@/lib/task-filters';
import { isFinishedStatus, needsMyAction } from '@/lib/workflow';

export { EMPTY_FILTERS, NOBODY, countActiveFilters };
export type { TaskFilters };

/**
 * Pure view logic for the task workspace: sorting and grouping the loaded tasks, refining them by what
 * only the browser knows, and reading / writing how a person likes to see them. No network, no React.
 *
 * Which tasks are shown is decided by the database (search_tasks, with the filters in lib/task-filters):
 * this file never filters by text, status, people or dates. It orders and groups what came back.
 */

export type GroupBy = 'status' | 'editor' | 'priority' | 'due' | 'list' | 'work' | 'none';
export type SortKey = 'manual' | 'dueDate' | 'clientDeadline' | 'priority' | 'status' | 'editor' | 'qc' | 'title' | 'created' | 'updated';
export type SortDir = 'asc' | 'desc';

export interface TaskViewState {
  groupBy: GroupBy;
  sort: SortKey;
  dir: SortDir;
  filters: TaskFilters;
  /** Collapsed group keys. */
  collapsed: string[];
}

/** Where a list lives, for grouping and labelling by list. */
export interface ListInfo {
  listName: string;
  folderName: string | null;
  spaceName: string;
}

/** Who is looking and with which workflow: what refining and grouping depend on besides the tasks. */
export interface ViewContext {
  me?: string | null;
  role?: TbbRole | null;
  workflow?: Workflow | null;
  members?: readonly WorkspaceMember[];
  lists?: ReadonlyMap<string, ListInfo>;
}

export const DEFAULT_VIEW: TaskViewState = {
  groupBy: 'status',
  sort: 'manual',
  dir: 'asc',
  filters: EMPTY_FILTERS,
  collapsed: [],
};

export const GROUP_OPTIONS: ReadonlyArray<{ value: GroupBy; label: string }> = [
  { value: 'status', label: 'Status' },
  { value: 'editor', label: 'Editor' },
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due date' },
  { value: 'list', label: 'List' },
  { value: 'work', label: 'My work' },
  { value: 'none', label: 'No grouping' },
];

/**
 * A single list has no use for grouping by list; "My work" (needs my action, then by date) only makes
 * sense where every task is the person's own (My Tasks).
 */
export const groupOptionsFor = (spansLists: boolean, mine = false) =>
  GROUP_OPTIONS.filter((o) => (spansLists || o.value !== 'list') && (mine || o.value !== 'work'));

export const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: 'manual', label: 'Manual order' },
  { value: 'dueDate', label: 'Internal QC due' },
  { value: 'clientDeadline', label: 'Client deadline' },
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'editor', label: 'Editor' },
  { value: 'qc', label: 'QC reviewer' },
  { value: 'title', label: 'Title' },
  { value: 'created', label: 'Date created' },
  { value: 'updated', label: 'Last updated' },
];

// ---------------------------------------------------------------------------------------
// Overdue, and refining what the database returned
// ---------------------------------------------------------------------------------------

/** Overdue = an unfinished task whose internal QC date or client deadline is before today. */
export function isOverdue(
  task: Pick<TaskSummary, 'status' | 'dueDate' | 'clientDeadline'>,
  workflow: Workflow | null | undefined,
  now: Date = new Date()
): boolean {
  if (isFinishedStatus(workflow, task.status)) return false;
  return dueState(task.dueDate, now) === 'overdue' || dueState(task.clientDeadline, now) === 'overdue';
}

/**
 * The one filter the browser applies itself: "needs my action" depends on the workflow rules for this
 * person's role, which the database does not know how to evaluate. It only ever narrows rows the
 * database already returned (assigned to me), so it can never reveal anything.
 */
export function refineLoaded(tasks: readonly TaskSummary[], f: TaskFilters, ctx: ViewContext): TaskSummary[] {
  if (!f.needsAction) return [...tasks];
  return tasks.filter((t) => needsMyAction(ctx.workflow, t, ctx.me, ctx.role));
}

// ---------------------------------------------------------------------------------------
// Sorting (stable; ties keep the manual order)
// ---------------------------------------------------------------------------------------

const manualOrder = (a: TaskSummary, b: TaskSummary) =>
  a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Empty dates sort last in both directions: a missing deadline is never "the most urgent". */
function compareDates(a: string | null, b: string | null, dir: SortDir): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const diff = new Date(a).getTime() - new Date(b).getTime();
  return dir === 'asc' ? diff : -diff;
}

/** People sort by name; nobody assigned sorts last in both directions (like a missing date). */
function comparePeople(a: string | null, b: string | null, dir: SortDir, nameOf: (id: string) => string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const diff = nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' });
  return dir === 'asc' ? diff : -diff;
}

export function sortTasks(tasks: readonly TaskSummary[], sort: SortKey, dir: SortDir, ctx: ViewContext = {}): TaskSummary[] {
  const flip = (n: number) => (dir === 'asc' ? n : -n);
  const nameOf = (id: string) => (ctx.members ?? []).find((m) => m.userId === id)?.profile?.fullName ?? 'Former member';
  const stageOf = (key: string) => {
    const i = ctx.workflow?.statuses.findIndex((x) => x.key === key) ?? -1;
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const by: Record<SortKey, (a: TaskSummary, b: TaskSummary) => number> = {
    manual: (a, b) => flip(manualOrder(a, b)),
    dueDate: (a, b) => compareDates(a.dueDate, b.dueDate, dir),
    clientDeadline: (a, b) => compareDates(a.clientDeadline, b.clientDeadline, dir),
    priority: (a, b) => flip(priorityOption(a.priority).rank - priorityOption(b.priority).rank),
    status: (a, b) => flip(stageOf(a.status) - stageOf(b.status)),
    editor: (a, b) => comparePeople(a.editorId, b.editorId, dir, nameOf),
    qc: (a, b) => comparePeople(a.qcId, b.qcId, dir, nameOf),
    title: (a, b) => flip(a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true })),
    created: (a, b) => flip(a.createdAt.localeCompare(b.createdAt)),
    updated: (a, b) => flip(a.updatedAt.localeCompare(b.updatedAt)),
  };
  return [...tasks].sort((a, b) => by[sort](a, b) || manualOrder(a, b));
}

// ---------------------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------------------

export interface TaskGroup {
  key: string;
  label: string;
  kind: GroupBy;
  /** The value a task created inside this group should get (status / editor / priority). */
  value: string | null;
  tasks: TaskSummary[];
}

const DUE_BUCKETS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Next 7 days' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No due date' },
  { key: 'done', label: 'Finished' },
] as const;

/** Where a task sits on the due-date timeline (by its internal QC due date; finished work is its own bucket). */
export function dueBucket(task: Pick<TaskSummary, 'status' | 'dueDate'>, workflow: Workflow | null | undefined, now: Date): string {
  if (isFinishedStatus(workflow, task.status)) return 'done';
  if (!task.dueDate) return 'none';
  const days = differenceInCalendarDays(new Date(task.dueDate), now);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  return days <= 7 ? 'week' : 'later';
}

const WORK_BUCKETS = [
  { key: 'needs', label: 'Needs my action' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'week', label: 'Next 7 days' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No date' },
  { key: 'done', label: 'Finished' },
] as const;

/**
 * My Tasks: where one of my tasks belongs. Finished work is its own bucket; a task whose next step is
 * mine comes first whatever its date; the rest is placed by its nearest date, the earlier of the
 * internal QC due date and the client deadline (the same rule as the Home summary).
 */
export function workBucket(
  task: Pick<TaskSummary, 'status' | 'dueDate' | 'clientDeadline' | 'editorId' | 'qcId'>,
  ctx: Pick<ViewContext, 'workflow' | 'me' | 'role'>,
  now: Date
): string {
  if (isFinishedStatus(ctx.workflow, task.status)) return 'done';
  if (needsMyAction(ctx.workflow, task, ctx.me, ctx.role)) return 'needs';
  const dates = [task.dueDate, task.clientDeadline].filter((d): d is string => !!d).map((d) => new Date(d));
  if (dates.length === 0) return 'none';
  const days = differenceInCalendarDays(new Date(Math.min(...dates.map((d) => d.getTime()))), now);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  return days <= 7 ? 'week' : 'later';
}

export function groupTasks(
  tasks: readonly TaskSummary[],
  groupBy: GroupBy,
  ctx: ViewContext = {},
  options: { keepEmpty?: boolean } = {}
): TaskGroup[] {
  const members = ctx.members ?? [];
  if (groupBy === 'none') return [{ key: 'all', label: 'All tasks', kind: 'none', value: null, tasks: [...tasks] }];

  let groups: TaskGroup[];
  if (groupBy === 'status') {
    // the workflow's stages in order; a status the workflow does not know (never expected) still shows
    const keys = ctx.workflow?.statuses.map((s) => s.key) ?? [];
    for (const t of tasks) if (!keys.includes(t.status)) keys.push(t.status);
    groups = keys.map((key) => ({
      key: `status:${key}`,
      label: ctx.workflow?.statuses.find((s) => s.key === key)?.name ?? key.replace(/_/g, ' '),
      kind: 'status' as const,
      value: key,
      tasks: tasks.filter((t) => t.status === key),
    }));
  } else if (groupBy === 'priority') {
    groups = TASK_PRIORITIES.map((p) => ({
      key: `priority:${p.value}`,
      label: p.label,
      kind: 'priority' as const,
      value: p.value,
      tasks: tasks.filter((t) => t.priority === p.value),
    }));
  } else if (groupBy === 'due') {
    const now = new Date();
    const buckets = DUE_BUCKETS.map((b) => ({
      key: `due:${b.key}`,
      label: b.label,
      kind: 'due' as const,
      value: b.key,
      tasks: tasks.filter((t) => dueBucket(t, ctx.workflow, now) === b.key),
    }));
    groups = buckets;
  } else if (groupBy === 'work') {
    const now = new Date();
    groups = WORK_BUCKETS.map((b) => ({
      key: `work:${b.key}`,
      label: b.label,
      kind: 'work' as const,
      value: b.key,
      tasks: tasks.filter((t) => workBucket(t, ctx, now) === b.key),
    }));
  } else if (groupBy === 'list') {
    const info = (id: string) => ctx.lists?.get(id);
    const label = (id: string) => {
      const i = info(id);
      return i ? [i.spaceName, i.folderName, i.listName].filter(Boolean).join(' / ') : 'Unknown list';
    };
    const ids = [...new Set(tasks.map((t) => t.listId))].sort((x, y) => label(x).localeCompare(label(y), undefined, { numeric: true }));
    groups = ids.map((id) => ({ key: `list:${id}`, label: label(id), kind: 'list' as const, value: id, tasks: tasks.filter((t) => t.listId === id) }));
  } else {
    const nameOf = (id: string) => members.find((m) => m.userId === id)?.profile?.fullName ?? 'Former member';
    const editors = [...new Set(tasks.map((t) => t.editorId).filter((id): id is string => !!id))].sort((a, b) =>
      nameOf(a).localeCompare(nameOf(b))
    );
    groups = [
      ...editors.map((id) => ({
        key: `editor:${id}`,
        label: nameOf(id),
        kind: 'editor' as const,
        value: id,
        tasks: tasks.filter((t) => t.editorId === id),
      })),
      { key: `editor:${NOBODY}`, label: 'No editor', kind: 'editor' as const, value: null, tasks: tasks.filter((t) => !t.editorId) },
    ];
  }
  return options.keepEmpty ? groups : groups.filter((g) => g.tasks.length > 0);
}

/** Refine, sort and group in one go: what the list renders, plus the flat visible order. */
export function buildView(
  tasks: readonly TaskSummary[],
  view: TaskViewState,
  ctx: ViewContext
): { groups: TaskGroup[]; visible: TaskSummary[]; matched: number; items: TaskSummary[] } {
  const filtered = refineLoaded(tasks, view.filters, ctx);
  const sorted = sortTasks(filtered, view.sort, view.dir, ctx);
  const groups = groupTasks(sorted, view.groupBy, ctx);
  // the visible order is the reading order: group by group, skipping collapsed groups
  const visible = groups.filter((g) => !view.collapsed.includes(g.key)).flatMap((g) => g.tasks);
  // `items`: the filtered, sorted tasks before grouping (what the board lays out in its own columns)
  return { groups, visible, matched: filtered.length, items: sorted };
}

/** Manual reordering only makes sense when the screen shows the list's own order, ungrouped and unfiltered. */
export function canReorderInView(view: TaskViewState): boolean {
  return view.groupBy === 'none' && view.sort === 'manual' && view.dir === 'asc' && countActiveFilters(view.filters) === 0;
}

// ---------------------------------------------------------------------------------------
// Preferences (browser-local, per list) and the URL
// ---------------------------------------------------------------------------------------

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T | null): T | null =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

/** How a person likes to see a list when the link they opened says nothing: never data, never filters. */
export interface ViewPrefs {
  groupBy: GroupBy | null;
  sort: SortKey | null;
  dir: SortDir | null;
  collapsed: string[];
}

export const NO_PREFS: ViewPrefs = { groupBy: null, sort: null, dir: null, collapsed: [] };

const GROUP_KEYS = GROUP_OPTIONS.map((g) => g.value);
const SORT_KEYS = SORT_OPTIONS.map((o) => o.value);

/** Reads stored preferences defensively: anything unknown or malformed is dropped. */
export function parseViewPrefs(raw: string | null | undefined): ViewPrefs {
  if (!raw) return NO_PREFS;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NO_PREFS;
  }
  if (!data || typeof data !== 'object') return NO_PREFS;
  return {
    groupBy: pick(data.groupBy, GROUP_KEYS, null),
    sort: pick(data.sort, SORT_KEYS, null),
    dir: pick(data.dir, ['asc', 'desc'] as const, null),
    collapsed: Array.isArray(data.collapsed)
      ? data.collapsed.filter((k): k is string => typeof k === 'string' && k.length <= 100).slice(0, 50)
      : [],
  };
}

export const serializeViewPrefs = (prefs: ViewPrefs): string => JSON.stringify(prefs);

/** The view as written in a URL (?group=editor&sort=dueDate&dir=desc): only what the link says. */
export function readViewParams(params: URLSearchParams): Pick<ViewPrefs, 'groupBy' | 'sort' | 'dir'> {
  return {
    groupBy: pick(params.get('group'), GROUP_KEYS, null),
    sort: pick(params.get('sort'), SORT_KEYS, null),
    dir: pick(params.get('dir'), ['asc', 'desc'] as const, null),
  };
}

export function writeViewParams(params: URLSearchParams, view: Partial<Pick<TaskViewState, 'groupBy' | 'sort' | 'dir'>>): URLSearchParams {
  const next = new URLSearchParams(params);
  if (view.groupBy) next.set('group', view.groupBy);
  if (view.sort) next.set('sort', view.sort);
  if (view.dir) next.set('dir', view.dir);
  return next;
}
