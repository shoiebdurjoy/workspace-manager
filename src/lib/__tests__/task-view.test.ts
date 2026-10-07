import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VIEW,
  EMPTY_FILTERS,
  UNASSIGNED,
  applyFilters,
  buildView,
  canReorderInView,
  countActiveFilters,
  groupTasks,
  isOverdue,
  parseStoredView,
  serializeView,
  sortTasks,
} from '../task-view';
import type { TaskSummary, WorkspaceMember } from '@/types/database';
import { TBB_WORKFLOW as WF } from '@/test/workflow-fixture';

const NOW = new Date(2026, 9, 7, 12);
const day = (n: number) => new Date(2026, 9, 7 + n, 12).toISOString();
let n = 0;
const task = (o: Partial<TaskSummary>): TaskSummary => ({
  id: `t${++n}`,
  listId: 'l',
  title: `Task ${n}`,
  status: 'TO_BE_EDITED',
  priority: 'MEDIUM',
  position: n,
  revisionCount: 0,
  aspectRatio: null,
  dueDate: null,
  clientDeadline: null,
  rawFootageLink: null,
  projectFileLink: null,
  reviewLink: null,
  finalExportLink: null,
  createdAt: `2026-10-0${(n % 9) + 1}T00:00:00Z`,
  updatedAt: 'u',
  editorId: null,
  qcId: null,
  subtaskTotal: 0,
  subtaskDone: 0,
  ...o,
});
const member = (userId: string, fullName: string): WorkspaceMember => ({
  workspaceId: 'w', userId, role: 'EDITOR', createdAt: 'c', updatedAt: 'u',
  profile: { id: userId, email: 'x', fullName, role: 'EDITOR', timezone: 'UTC', isActive: true, createdAt: 'c', updatedAt: 'u' },
});

const A = task({ title: 'Walmart series', status: 'STARTED_EDITING', priority: 'URGENT', editorId: 'me', qcId: 'qc', dueDate: day(-1), position: 2 });
const B = task({ title: 'Lori Bales video', status: 'TO_BE_EDITED', priority: 'LOW', editorId: 'zara', clientDeadline: day(5), position: 0 });
const C = task({ title: 'Patton moving', status: 'CLOSED', priority: 'HIGH', qcId: 'me', dueDate: day(-10), position: 1 });
const D = task({ title: 'Unassigned clip', status: 'TO_BE_EDITED', priority: 'MEDIUM', clientDeadline: day(-2), position: 3 });
const ALL = [A, B, C, D];
const titles = (ts: TaskSummary[]) => ts.map((t) => t.title);

describe('filters', () => {
  it('searches titles case-insensitively', () => {
    expect(titles(applyFilters(ALL, { ...EMPTY_FILTERS, search: '  WALMART ' }, { me: 'me', workflow: WF }, NOW))).toEqual(['Walmart series']);
  });

  it('"mine" matches the editor OR the QC reviewer slot', () => {
    expect(titles(applyFilters(ALL, { ...EMPTY_FILTERS, mine: true }, { me: 'me', workflow: WF }, NOW))).toEqual(['Walmart series', 'Patton moving']);
    expect(applyFilters(ALL, { ...EMPTY_FILTERS, mine: true }, { workflow: WF }, NOW)).toEqual([]);
  });

  it('people filter matches either slot, and "nobody assigned" matches only fully unassigned tasks', () => {
    expect(titles(applyFilters(ALL, { ...EMPTY_FILTERS, people: ['qc'] }, { workflow: WF }, NOW))).toEqual(['Walmart series']);
    expect(titles(applyFilters(ALL, { ...EMPTY_FILTERS, people: [UNASSIGNED] }, { workflow: WF }, NOW))).toEqual(['Unassigned clip']);
    expect(titles(applyFilters(ALL, { ...EMPTY_FILTERS, people: ['zara', UNASSIGNED] }, { workflow: WF }, NOW))).toEqual(['Lori Bales video', 'Unassigned clip']);
  });

  it('overdue = unfinished with a past QC date or client deadline; finished work never counts', () => {
    expect(titles(applyFilters(ALL, { ...EMPTY_FILTERS, overdue: true }, { workflow: WF }, NOW))).toEqual(['Walmart series', 'Unassigned clip']);
    expect(isOverdue(C, WF, NOW)).toBe(false);
    // without the workflow nothing is known to be finished, so a past date counts
    expect(isOverdue(C, null, NOW)).toBe(true);
  });

  it('combines status, priority and hide-finished (AND across filters, OR within one)', () => {
    expect(titles(applyFilters(ALL, { ...EMPTY_FILTERS, statuses: ['TO_BE_EDITED', 'CLOSED'], priorities: ['LOW', 'HIGH'] }, { workflow: WF }, NOW))).toEqual([
      'Lori Bales video',
      'Patton moving',
    ]);
    expect(titles(applyFilters(ALL, { ...EMPTY_FILTERS, hideFinished: true }, { workflow: WF }, NOW))).not.toContain('Patton moving');
  });

  it('counts active filters for the toolbar', () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...EMPTY_FILTERS, search: '  ' })).toBe(0);
    expect(countActiveFilters({ ...EMPTY_FILTERS, search: 'x', statuses: ['TO_BE_EDITED'], mine: true, overdue: true })).toBe(4);
    expect(countActiveFilters({ ...EMPTY_FILTERS, needsAction: true })).toBe(1);
  });
});

describe('sorting', () => {
  it('manual order follows position', () => {
    expect(titles(sortTasks(ALL, 'manual', 'asc'))).toEqual(['Lori Bales video', 'Patton moving', 'Walmart series', 'Unassigned clip']);
    expect(titles(sortTasks(ALL, 'manual', 'desc'))).toEqual(['Unassigned clip', 'Walmart series', 'Patton moving', 'Lori Bales video']);
  });

  it('dates sort with empty dates LAST in both directions', () => {
    expect(titles(sortTasks(ALL, 'dueDate', 'asc'))).toEqual(['Patton moving', 'Walmart series', 'Lori Bales video', 'Unassigned clip']);
    expect(titles(sortTasks(ALL, 'dueDate', 'desc')).slice(0, 2)).toEqual(['Walmart series', 'Patton moving']);
    expect(titles(sortTasks(ALL, 'clientDeadline', 'asc'))).toEqual(['Unassigned clip', 'Lori Bales video', 'Patton moving', 'Walmart series']);
  });

  it('priority sorts most urgent first; title sorts naturally ("Clip 2" before "Clip 10")', () => {
    expect(titles(sortTasks(ALL, 'priority', 'asc'))[0]).toBe('Walmart series');
    const clips = [task({ title: 'Clip 10' }), task({ title: 'clip 2' }), task({ title: 'Clip 1' })];
    expect(titles(sortTasks(clips, 'title', 'asc'))).toEqual(['Clip 1', 'clip 2', 'Clip 10']);
  });

  it('never mutates its input', () => {
    const input = [...ALL];
    sortTasks(input, 'title', 'desc');
    expect(input).toEqual(ALL);
  });
});

describe('grouping', () => {
  it('groups by status in workflow order and drops empty groups (unless asked to keep them)', () => {
    expect(groupTasks(ALL, 'status', { workflow: WF }).map((g) => [g.label, g.tasks.length])).toEqual([
      ['TO BE EDITED', 2],
      ['STARTED EDITING', 1],
      ['CLOSED', 1],
    ]);
    expect(groupTasks(ALL, 'status', { workflow: WF }, { keepEmpty: true }).map((g) => g.value)).toEqual(WF.statuses.map((s) => s.key));
    expect(groupTasks(ALL, 'status', { workflow: WF })[0].value).toBe('TO_BE_EDITED');
  });

  it('a status the workflow does not know still gets a group (never hidden); without the workflow keys are humanised', () => {
    const odd = task({ status: 'LEGACY_STAGE' });
    expect(groupTasks([...ALL, odd], 'status', { workflow: WF }).at(-1)).toMatchObject({ value: 'LEGACY_STAGE', label: 'LEGACY STAGE' });
    expect(groupTasks(ALL, 'status').map((g) => g.label)).toEqual(['STARTED EDITING', 'TO BE EDITED', 'CLOSED']);
  });

  it('groups by priority, most urgent first', () => {
    expect(groupTasks(ALL, 'priority').map((g) => g.label)).toEqual(['Urgent', 'High', 'Normal', 'Low']);
  });

  it('groups by editor alphabetically, with "No editor" last, and labels people who left', () => {
    const members = [member('me', 'Pat Person'), member('zara', 'Ada Zara')];
    const groups = groupTasks([...ALL, task({ editorId: 'gone' })], 'editor', { members });
    expect(groups.map((g) => g.label)).toEqual(['Ada Zara', 'Former member', 'Pat Person', 'No editor']);
    expect(groups.at(-1)?.value).toBeNull();
  });

  it('"none" is one group holding everything', () => {
    expect(groupTasks(ALL, 'none')).toHaveLength(1);
    expect(groupTasks(ALL, 'none')[0].tasks).toHaveLength(4);
  });

});

describe('the whole view', () => {
  it('filters, sorts within groups, and reports the reading order (skipping collapsed groups)', () => {
    const view = { ...DEFAULT_VIEW, sort: 'title' as const, collapsed: ['status:STARTED_EDITING'] };
    const result = buildView(ALL, view, { me: 'me', workflow: WF }, NOW);
    expect(result.matched).toBe(4);
    expect(result.groups.map((g) => titles(g.tasks))).toEqual([['Lori Bales video', 'Unassigned clip'], ['Walmart series'], ['Patton moving']]);
    expect(titles(result.visible)).toEqual(['Lori Bales video', 'Unassigned clip', 'Patton moving']);
  });

  it('manual reordering is offered only when the screen shows the manual order', () => {
    expect(canReorderInView(DEFAULT_VIEW)).toBe(false); // grouped by status
    expect(canReorderInView({ ...DEFAULT_VIEW, groupBy: 'none' })).toBe(true);
    expect(canReorderInView({ ...DEFAULT_VIEW, groupBy: 'none', sort: 'title' })).toBe(false);
    expect(canReorderInView({ ...DEFAULT_VIEW, groupBy: 'none', dir: 'desc' })).toBe(false);
    expect(canReorderInView({ ...DEFAULT_VIEW, groupBy: 'none', filters: { ...EMPTY_FILTERS, mine: true } })).toBe(false);
  });
});

describe('stored view preference', () => {
  it('round-trips, but never stores or restores the search text', () => {
    const view = { ...DEFAULT_VIEW, groupBy: 'editor' as const, sort: 'dueDate' as const, dir: 'desc' as const, collapsed: ['editor:x'], filters: { ...EMPTY_FILTERS, search: 'secret client', mine: true, statuses: ['TO_BE_EDITED'], needsAction: true } };
    const raw = serializeView(view);
    expect(raw).not.toContain('secret client');
    expect(parseStoredView(raw)).toEqual({ ...view, filters: { ...view.filters, search: '' } });
  });

  it('falls back to the default for missing, corrupt or hostile values', () => {
    expect(parseStoredView(null)).toEqual(DEFAULT_VIEW);
    expect(parseStoredView('{not json')).toEqual(DEFAULT_VIEW);
    expect(parseStoredView('"a string"')).toEqual(DEFAULT_VIEW);
    const odd = parseStoredView(
      JSON.stringify({ groupBy: 'everything', sort: 'drop table', dir: 'sideways', filters: { statuses: ['TO_BE_EDITED', 'lower case', 'DROP TABLE x;', 42], priorities: 'URGENT', mine: 'yes', people: ['x'.repeat(500), 'ok'] }, collapsed: [1, 'k'] })
    );
    expect(odd.groupBy).toBe('status');
    expect(odd.sort).toBe('manual');
    expect(odd.dir).toBe('asc');
    expect(odd.filters.statuses).toEqual(['TO_BE_EDITED']);
    expect(odd.filters.needsAction).toBe(false);
    expect(odd.filters.priorities).toEqual([]);
    expect(odd.filters.mine).toBe(false);
    expect(odd.filters.people).toEqual(['ok']);
    expect(odd.collapsed).toEqual(['k']);
  });
});
