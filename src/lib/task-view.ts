import type { TaskPriority, TaskStatus, TaskSummary, TbbRole, Workflow, WorkspaceMember } from '@/types/database';
import { TASK_PRIORITIES, dueState, priorityOption } from '@/lib/tasks';
import { isFinishedStatus, needsMyAction } from '@/lib/workflow';

/**
 * Pure view logic for the list workspace: filtering, searching, sorting and grouping a list's tasks,
 * and (de)serialising the person's view preferences. No network, no React.
 *
 * It works on the list's complete, already-loaded rows (a list loads all its pages), so counts and
 * groups are exact. Server-side search and saved views across lists are Phase 9; Board / Table views
 * reuse these same functions in Phase 8.
 */

export type GroupBy = 'status' | 'editor' | 'priority' | 'none';
export type SortKey = 'manual' | 'dueDate' | 'clientDeadline' | 'priority' | 'title' | 'created';
export type SortDir = 'asc' | 'desc';

/** A person filter matches the editor OR the QC reviewer; UNASSIGNED matches a task with neither. */
export const UNASSIGNED = '__unassigned__';

export interface TaskFilters {
  search: string;
  statuses: TaskStatus[];
  priorities: TaskPriority[];
  people: string[];
  mine: boolean;
  /** Tasks assigned to me where the next workflow step is mine. */
  needsAction: boolean;
  overdue: boolean;
  /** Completed / closed work is shown unless switched off. */
  hideFinished: boolean;
}

export interface TaskViewState {
  groupBy: GroupBy;
  sort: SortKey;
  dir: SortDir;
  filters: TaskFilters;
  /** Collapsed group keys. */
  collapsed: string[];
}

export const EMPTY_FILTERS: TaskFilters = {
  search: '',
  statuses: [],
  priorities: [],
  people: [],
  mine: false,
  needsAction: false,
  overdue: false,
  hideFinished: false,
};

/** Who is looking and with which workflow: what the filters and groups depend on besides the tasks. */
export interface ViewContext {
  me?: string | null;
  role?: TbbRole | null;
  workflow?: Workflow | null;
  members?: readonly WorkspaceMember[];
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
  { value: 'none', label: 'No grouping' },
];

export const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: 'manual', label: 'Manual order' },
  { value: 'dueDate', label: 'Internal QC due' },
  { value: 'clientDeadline', label: 'Client deadline' },
  { value: 'priority', label: 'Priority' },
  { value: 'title', label: 'Title' },
  { value: 'created', label: 'Date created' },
];

// ---------------------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------------------

export function countActiveFilters(f: TaskFilters): number {
  return (
    (f.search.trim() ? 1 : 0) +
    (f.statuses.length ? 1 : 0) +
    (f.priorities.length ? 1 : 0) +
    (f.people.length ? 1 : 0) +
    (f.mine ? 1 : 0) +
    (f.needsAction ? 1 : 0) +
    (f.overdue ? 1 : 0) +
    (f.hideFinished ? 1 : 0)
  );
}

/** Overdue = an unfinished task whose internal QC date or client deadline is before today. */
export function isOverdue(
  task: Pick<TaskSummary, 'status' | 'dueDate' | 'clientDeadline'>,
  workflow: Workflow | null | undefined,
  now: Date = new Date()
): boolean {
  if (isFinishedStatus(workflow, task.status)) return false;
  return dueState(task.dueDate, now) === 'overdue' || dueState(task.clientDeadline, now) === 'overdue';
}

export function applyFilters(
  tasks: readonly TaskSummary[],
  f: TaskFilters,
  ctx: ViewContext,
  now: Date = new Date()
): TaskSummary[] {
  const { me, role, workflow } = ctx;
  const needle = f.search.trim().toLowerCase();
  return tasks.filter((t) => {
    if (needle && !t.title.toLowerCase().includes(needle)) return false;
    if (f.statuses.length && !f.statuses.includes(t.status)) return false;
    if (f.priorities.length && !f.priorities.includes(t.priority)) return false;
    if (f.people.length) {
      const hit = f.people.some((p) =>
        p === UNASSIGNED ? !t.editorId && !t.qcId : t.editorId === p || t.qcId === p
      );
      if (!hit) return false;
    }
    if (f.mine && (!me || (t.editorId !== me && t.qcId !== me))) return false;
    if (f.needsAction && !needsMyAction(workflow, t, me, role)) return false;
    if (f.overdue && !isOverdue(t, workflow, now)) return false;
    if (f.hideFinished && isFinishedStatus(workflow, t.status)) return false;
    return true;
  });
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

export function sortTasks(tasks: readonly TaskSummary[], sort: SortKey, dir: SortDir): TaskSummary[] {
  const flip = (n: number) => (dir === 'asc' ? n : -n);
  const by: Record<SortKey, (a: TaskSummary, b: TaskSummary) => number> = {
    manual: (a, b) => flip(manualOrder(a, b)),
    dueDate: (a, b) => compareDates(a.dueDate, b.dueDate, dir),
    clientDeadline: (a, b) => compareDates(a.clientDeadline, b.clientDeadline, dir),
    priority: (a, b) => flip(priorityOption(a.priority).rank - priorityOption(b.priority).rank),
    title: (a, b) => flip(a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true })),
    created: (a, b) => flip(a.createdAt.localeCompare(b.createdAt)),
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
      { key: `editor:${UNASSIGNED}`, label: 'No editor', kind: 'editor' as const, value: null, tasks: tasks.filter((t) => !t.editorId) },
    ];
  }
  return options.keepEmpty ? groups : groups.filter((g) => g.tasks.length > 0);
}

/** Filter, sort and group in one go: what the list renders, plus the flat visible order. */
export function buildView(
  tasks: readonly TaskSummary[],
  view: TaskViewState,
  ctx: ViewContext,
  now: Date = new Date()
): { groups: TaskGroup[]; visible: TaskSummary[]; matched: number } {
  const filtered = applyFilters(tasks, view.filters, ctx, now);
  const sorted = sortTasks(filtered, view.sort, view.dir);
  const groups = groupTasks(sorted, view.groupBy, ctx);
  // the visible order is the reading order: group by group, skipping collapsed groups
  const visible = groups.filter((g) => !view.collapsed.includes(g.key)).flatMap((g) => g.tasks);
  return { groups, visible, matched: filtered.length };
}

/** Manual reordering only makes sense when the screen shows the list's own order, ungrouped and unfiltered. */
export function canReorderInView(view: TaskViewState): boolean {
  return view.groupBy === 'none' && view.sort === 'manual' && view.dir === 'asc' && countActiveFilters(view.filters) === 0;
}

// ---------------------------------------------------------------------------------------
// Persistence (a UI preference per list, never data)
// ---------------------------------------------------------------------------------------

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

const stringList = (value: unknown, allowed?: readonly string[] | RegExp): string[] =>
  Array.isArray(value)
    ? value
        .filter(
          (v): v is string =>
            typeof v === 'string' &&
            v.length <= 100 &&
            (!allowed || (allowed instanceof RegExp ? allowed.test(v) : allowed.includes(v)))
        )
        .slice(0, 50)
    : [];

/** Workflow status keys are configuration; a stored one only has to look like a key. */
const STATUS_KEY = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Reads a stored view defensively: anything unknown or malformed falls back to the default. */
export function parseStoredView(raw: string | null | undefined): TaskViewState {
  if (!raw) return DEFAULT_VIEW;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return DEFAULT_VIEW;
  }
  if (!data || typeof data !== 'object') return DEFAULT_VIEW;
  const f = (data.filters && typeof data.filters === 'object' ? data.filters : {}) as Record<string, unknown>;
  return {
    groupBy: pick(data.groupBy, GROUP_OPTIONS.map((g) => g.value), DEFAULT_VIEW.groupBy),
    sort: pick(data.sort, SORT_OPTIONS.map((o) => o.value), DEFAULT_VIEW.sort),
    dir: pick(data.dir, ['asc', 'desc'] as const, DEFAULT_VIEW.dir),
    filters: {
      // the search box is deliberately not restored: it is a momentary thing
      search: '',
      statuses: stringList(f.statuses, STATUS_KEY) as TaskStatus[],
      priorities: stringList(f.priorities, TASK_PRIORITIES.map((p) => p.value)) as TaskPriority[],
      people: stringList(f.people),
      mine: f.mine === true,
      needsAction: f.needsAction === true,
      overdue: f.overdue === true,
      hideFinished: f.hideFinished === true,
    },
    collapsed: stringList(data.collapsed),
  };
}

export function serializeView(view: TaskViewState): string {
  return JSON.stringify({ ...view, filters: { ...view.filters, search: '' } });
}
