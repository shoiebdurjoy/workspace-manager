import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VIEW,
  EMPTY_FILTERS,
  NOBODY,
  buildView,
  canReorderInView,
  countActiveFilters,
  dueBucket,
  workBucket,
  groupOptionsFor,
  groupTasks,
  isOverdue,
  parseViewPrefs,
  readViewParams,
  refineLoaded,
  serializeViewPrefs,
  writeViewParams,
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

describe('what the browser still refines (everything else is the database)', () => {
  const ctx = { me: 'me', role: 'EDITOR' as const, workflow: WF };

  it('returns the rows untouched when nothing needs refining', () => {
    expect(refineLoaded(ALL, EMPTY_FILTERS, ctx)).toEqual(ALL);
    expect(refineLoaded(ALL, EMPTY_FILTERS, ctx)).not.toBe(ALL); // a copy, never the loaded array itself
  });

  it('"needs my action" keeps the tasks assigned to me where the next workflow step is mine', () => {
    const mine = task({ title: 'Mine to start', status: 'ASSIGNED', editorId: 'me', qcId: 'qc' });
    const waiting = task({ title: 'Waiting on QC', status: 'QC_FIRST_APPROVAL', editorId: 'me', qcId: 'qc' });
    const notMine = task({ title: 'Someone else', status: 'ASSIGNED', editorId: 'zara' });
    expect(titles(refineLoaded([mine, waiting, notMine], { ...EMPTY_FILTERS, needsAction: true }, ctx))).toEqual(['Mine to start']);
  });

  it('overdue = unfinished with a past QC date or client deadline; finished work never counts', () => {
    expect(isOverdue(A, WF, NOW)).toBe(true);
    expect(isOverdue(D, WF, NOW)).toBe(true); // a past client deadline
    expect(isOverdue(B, WF, NOW)).toBe(false);
    expect(isOverdue(C, WF, NOW)).toBe(false); // closed
    // without the workflow nothing is known to be finished, so a past date counts
    expect(isOverdue(C, null, NOW)).toBe(true);
  });

  it('counts active filters for the toolbar', () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...EMPTY_FILTERS, search: '  ' })).toBe(0);
    expect(countActiveFilters({ ...EMPTY_FILTERS, search: 'x', statuses: ['TO_BE_EDITED'], mine: true, overdue: true })).toBe(4);
    expect(countActiveFilters({ ...EMPTY_FILTERS, needsAction: true })).toBe(1);
    expect(countActiveFilters({ ...EMPTY_FILTERS, editors: ['a', NOBODY], due: 'week', client: 'today', created: 'past7' })).toBe(4);
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

describe('sorting by stage, people and last update', () => {
  const ctx = { workflow: WF, members: [member('me', 'Pat Person'), member('zara', 'Ada Zara'), member('qc', 'Quinn QC')] };

  it('stage follows the workflow order, unknown stages last', () => {
    const odd = task({ title: 'Odd', status: 'LEGACY' });
    expect(titles(sortTasks([...ALL, odd], 'status', 'asc', ctx))).toEqual(['Lori Bales video', 'Unassigned clip', 'Walmart series', 'Patton moving', 'Odd']);
    expect(titles(sortTasks([...ALL, odd], 'status', 'desc', ctx))[0]).toBe('Odd'.length ? 'Odd' : '');
  });

  it('editor and QC sort by name with nobody assigned last in both directions', () => {
    expect(titles(sortTasks(ALL, 'editor', 'asc', ctx))).toEqual(['Lori Bales video', 'Walmart series', 'Patton moving', 'Unassigned clip']);
    expect(titles(sortTasks(ALL, 'editor', 'desc', ctx))).toEqual(['Walmart series', 'Lori Bales video', 'Patton moving', 'Unassigned clip']);
    expect(titles(sortTasks(ALL, 'qc', 'asc', ctx)).slice(0, 2)).toEqual(['Patton moving', 'Walmart series']);
  });

  it('last updated sorts by time', () => {
    const a = task({ title: 'old', updatedAt: '2026-01-01T00:00:00Z' });
    const b = task({ title: 'new', updatedAt: '2026-06-01T00:00:00Z' });
    expect(titles(sortTasks([a, b], 'updated', 'desc'))).toEqual(['new', 'old']);
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
    const result = buildView(ALL, view, { me: 'me', workflow: WF });
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
  it('round-trips grouping, sort and collapsed groups, and nothing else', () => {
    const prefs = { groupBy: 'editor' as const, sort: 'dueDate' as const, dir: 'desc' as const, collapsed: ['editor:x'] };
    expect(parseViewPrefs(serializeViewPrefs(prefs))).toEqual(prefs);
    expect(serializeViewPrefs(prefs)).not.toMatch(/search|filters|status|mine/);
  });

  it('falls back to nothing stored for missing, corrupt or hostile values', () => {
    const none = { groupBy: null, sort: null, dir: null, collapsed: [] };
    expect(parseViewPrefs(null)).toEqual(none);
    expect(parseViewPrefs('{not json')).toEqual(none);
    expect(parseViewPrefs('"a string"')).toEqual(none);
    const odd = parseViewPrefs(JSON.stringify({ groupBy: 'everything', sort: 'drop table', dir: 'sideways', collapsed: [1, 'k', 'x'.repeat(500)] }));
    expect(odd).toEqual({ groupBy: null, sort: null, dir: null, collapsed: ['k'] });
  });

  it('reads and writes grouping and sort in a URL, leaving other parameters alone', () => {
    const url = writeViewParams(new URLSearchParams('view=board&q=x'), { groupBy: 'due', sort: 'priority', dir: 'desc' });
    expect(url.toString()).toBe('view=board&q=x&group=due&sort=priority&dir=desc');
    expect(readViewParams(url)).toEqual({ groupBy: 'due', sort: 'priority', dir: 'desc' });
    expect(readViewParams(new URLSearchParams('group=bogus&sort=;drop&dir=up'))).toEqual({ groupBy: null, sort: null, dir: null });
    expect(readViewParams(new URLSearchParams(''))).toEqual({ groupBy: null, sort: null, dir: null });
  });
});

describe('grouping by due date and by list', () => {
  const NOW_D = new Date();
  const inDays = (n: number) => new Date(NOW_D.getFullYear(), NOW_D.getMonth(), NOW_D.getDate() + n, 12).toISOString();

  it('puts each task in its place on the due-date timeline; finished work is its own bucket', () => {
    const overdue = task({ title: 'late', dueDate: inDays(-2) });
    const today = task({ title: 'today', dueDate: inDays(0) });
    const soon = task({ title: 'soon', dueDate: inDays(5) });
    const later = task({ title: 'later', dueDate: inDays(30) });
    const none = task({ title: 'none' });
    const done = task({ title: 'done', status: 'CLOSED', dueDate: inDays(-9) });
    const groups = groupTasks([overdue, today, soon, later, none, done], 'due', { workflow: WF });
    expect(groups.map((g) => [g.label, titles(g.tasks)])).toEqual([
      ['Overdue', ['late']],
      ['Today', ['today']],
      ['Next 7 days', ['soon']],
      ['Later', ['later']],
      ['No due date', ['none']],
      ['Finished', ['done']],
    ]);
    expect(groupTasks([overdue], 'due', { workflow: WF }, { keepEmpty: true })).toHaveLength(6);
  });

  it('dueBucket uses the QC due date, and without a workflow nothing counts as finished', () => {
    expect(dueBucket({ status: 'CLOSED', dueDate: null }, WF, NOW_D)).toBe('done');
    expect(dueBucket({ status: 'CLOSED', dueDate: null }, null, NOW_D)).toBe('none');
    expect(dueBucket({ status: 'IN_EDIT', dueDate: inDays(7) }, WF, NOW_D)).toBe('week');
    expect(dueBucket({ status: 'IN_EDIT', dueDate: inDays(8) }, WF, NOW_D)).toBe('later');
  });

  it('groups by list, labelled with where the list lives, in a stable order', () => {
    const lists = new Map([
      ['l1', { listName: 'Gamma', folderName: 'Pod B', spaceName: 'Content' }],
      ['l2', { listName: 'Alpha', folderName: null, spaceName: 'Content' }],
    ]);
    const t = [task({ title: 'a', listId: 'l1' }), task({ title: 'b', listId: 'l2' }), task({ title: 'c', listId: 'l1' }), task({ title: 'd', listId: 'gone' })];
    const groups = groupTasks(t, 'list', { lists });
    expect(groups.map((g) => [g.label, titles(g.tasks), g.value])).toEqual([
      ['Content / Alpha', ['b'], 'l2'],
      ['Content / Pod B / Gamma', ['a', 'c'], 'l1'],
      ['Unknown list', ['d'], 'gone'],
    ]);
  });

  it('offers grouping by list only where a view spans several lists, and "My work" only in My Tasks', () => {
    expect(groupOptionsFor(false).map((o) => o.value)).toEqual(['status', 'editor', 'priority', 'due', 'none']);
    expect(groupOptionsFor(true).map((o) => o.value)).toContain('list');
    expect(groupOptionsFor(true).map((o) => o.value)).not.toContain('work');
    expect(groupOptionsFor(true, true).map((o) => o.value)).toEqual(['status', 'editor', 'priority', 'due', 'list', 'work', 'none']);
  });

  describe('My work (My Tasks)', () => {
    const me = { me: 'me', role: 'EDITOR' as const, workflow: WF };
    const qcMe = { me: 'me', role: 'QC_SPECIALIST' as const, workflow: WF };

    it('puts a task whose next step is mine first, whatever its date', () => {
      expect(workBucket(task({ status: 'ASSIGNED', editorId: 'me', dueDate: inDays(30) }), me, NOW_D)).toBe('needs');
      expect(workBucket(task({ status: 'QC_REVISION_NEEDED', editorId: 'me', qcId: 'qc', dueDate: null }), me, NOW_D)).toBe('needs');
      expect(workBucket(task({ status: 'QC_FIRST_APPROVAL', editorId: 'ed', qcId: 'me' }), qcMe, NOW_D)).toBe('needs');
    });

    it('places the rest by the earlier of the QC due date and the client deadline', () => {
      // waiting on QC: not my step, so by date
      const waiting = (o: Partial<TaskSummary>) => task({ status: 'QC_FIRST_APPROVAL', editorId: 'me', qcId: 'qc', ...o });
      expect(workBucket(waiting({ dueDate: inDays(-1) }), me, NOW_D)).toBe('overdue');
      expect(workBucket(waiting({ dueDate: inDays(5), clientDeadline: inDays(0) }), me, NOW_D)).toBe('today');
      expect(workBucket(waiting({ clientDeadline: inDays(7) }), me, NOW_D)).toBe('week');
      expect(workBucket(waiting({ dueDate: inDays(8) }), me, NOW_D)).toBe('later');
      expect(workBucket(waiting({}), me, NOW_D)).toBe('none');
    });

    it('keeps finished work apart, even when it was mine and its date has passed', () => {
      expect(workBucket(task({ status: 'CLOSED', editorId: 'me', dueDate: inDays(-9) }), me, NOW_D)).toBe('done');
    });

    it('groups in the order a person works through them, each task once', () => {
      const t = [
        task({ title: 'later', status: 'QC_FIRST_APPROVAL', editorId: 'me', dueDate: inDays(20) }),
        task({ title: 'start', status: 'ASSIGNED', editorId: 'me' }),
        task({ title: 'late', status: 'QC_FIRST_APPROVAL', editorId: 'me', dueDate: inDays(-2) }),
        task({ title: 'done', status: 'CLOSED', editorId: 'me' }),
      ];
      const groups = groupTasks(t, 'work', me, { keepEmpty: true });
      expect(groups.map((g) => g.label)).toEqual(['Needs my action', 'Overdue', 'Due today', 'Next 7 days', 'Later', 'No date', 'Finished']);
      expect(groupTasks(t, 'work', me).map((g) => [g.label, titles(g.tasks)])).toEqual([
        ['Needs my action', ['start']],
        ['Overdue', ['late']],
        ['Later', ['later']],
        ['Finished', ['done']],
      ]);
    });
  });
});
