import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTERS,
  FILTER_PARAMS,
  NOBODY,
  countActiveFilters,
  dateCodeLabel,
  isDateCode,
  rangeCode,
  readFilters,
  resolveDateCode,
  splitRange,
  toSearchFilters,
  writeFilters,
  type TaskFilters,
} from '../task-filters';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
// Wednesday 7 October 2026, local time
const TODAY = new Date(2026, 9, 7, 15, 30);
const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, min, s, ms).toISOString();

describe('date filters', () => {
  it('recognise presets and ranges, and nothing else', () => {
    for (const ok of ['today', 'tomorrow', 'week', 'next7', 'past7', 'past30', 'month', 'none', '2026-10-01..2026-10-31', '2026-10-01..', '..2026-10-31']) {
      expect(isDateCode(ok)).toBe(true);
    }
    for (const bad of ['', null, undefined, 'yesterday', '..', '2026-10-01', 'today; drop table', '2026-10-01..2026-10-31..']) {
      expect(isDateCode(bad as never)).toBe(false);
    }
  });

  it("turn presets into the viewer's own calendar days", () => {
    expect(resolveDateCode('today', TODAY)).toEqual({ from: local(2026, 10, 7), to: local(2026, 10, 7, 23, 59, 59, 999) });
    expect(resolveDateCode('tomorrow', TODAY)).toEqual({ from: local(2026, 10, 8), to: local(2026, 10, 8, 23, 59, 59, 999) });
    expect(resolveDateCode('week', TODAY)).toEqual({ from: local(2026, 10, 5), to: local(2026, 10, 11, 23, 59, 59, 999) }); // Monday to Sunday
    expect(resolveDateCode('next7', TODAY)).toEqual({ from: local(2026, 10, 7), to: local(2026, 10, 13, 23, 59, 59, 999) });
    expect(resolveDateCode('past7', TODAY)).toEqual({ from: local(2026, 10, 1), to: local(2026, 10, 7, 23, 59, 59, 999) });
    expect(resolveDateCode('past30', TODAY).from).toBe(local(2026, 9, 8));
    expect(resolveDateCode('month', TODAY)).toEqual({ from: local(2026, 10, 1), to: local(2026, 10, 31, 23, 59, 59, 999) });
    expect(resolveDateCode('none', TODAY)).toEqual({ none: true });
  });

  it('turn a custom range into whole days, either end optional', () => {
    expect(resolveDateCode('2026-10-01..2026-10-31', TODAY)).toEqual({ from: local(2026, 10, 1), to: local(2026, 10, 31, 23, 59, 59, 999) });
    expect(resolveDateCode('2026-10-05..', TODAY)).toEqual({ from: local(2026, 10, 5) });
    expect(resolveDateCode('..2026-10-05', TODAY)).toEqual({ to: local(2026, 10, 5, 23, 59, 59, 999) });
    expect(resolveDateCode('garbage', TODAY)).toEqual({});
  });

  it('build and split ranges', () => {
    expect(rangeCode('2026-10-01', null)).toBe('2026-10-01..');
    expect(rangeCode(null, null)).toBeNull();
    expect(splitRange('2026-10-01..2026-10-31')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(splitRange('week')).toBeNull();
  });

  it('read as plain words', () => {
    expect(dateCodeLabel('next7')).toBe('Next 7 days');
    expect(dateCodeLabel('none')).toBe('No date');
    expect(dateCodeLabel('2026-10-01..2026-10-31')).toMatch(/Oct.*Oct/);
    expect(dateCodeLabel('2026-10-01..')).toMatch(/^From /);
    expect(dateCodeLabel('..2026-10-31')).toMatch(/^Until /);
  });
});

describe('the request sent to the database', () => {
  const ctx = { me: ID, today: TODAY };

  it('is empty when no filter is on', () => {
    expect(toSearchFilters(EMPTY_FILTERS, ctx)).toEqual({});
  });

  it('carries only the filters in use, with people and "nobody" mapped', () => {
    const out = toSearchFilters(
      { ...EMPTY_FILTERS, statuses: ['QC_REVISION_NEEDED'], priorities: ['HIGH'], editors: [ID2, NOBODY], qcs: [NOBODY], aspectRatios: ['9:16'], lists: [ID], hideFinished: true },
      ctx
    );
    expect(out).toEqual({
      statuses: ['QC_REVISION_NEEDED'],
      priorities: ['HIGH'],
      editors: [ID2],
      noEditor: true,
      noQc: true,
      aspectRatios: ['9:16'],
      lists: [ID],
      hideFinished: true,
    });
  });

  it('turns "assigned to me" and "needs my action" into the viewer\'s own id', () => {
    expect(toSearchFilters({ ...EMPTY_FILTERS, mine: true }, ctx)).toEqual({ people: [ID] });
    expect(toSearchFilters({ ...EMPTY_FILTERS, needsAction: true }, ctx)).toEqual({ people: [ID] });
    // not signed in: matches nobody rather than everybody
    expect(toSearchFilters({ ...EMPTY_FILTERS, mine: true }, { me: null, today: TODAY })).toEqual({ people: ['00000000-0000-0000-0000-000000000000'] });
  });

  it('resolves date filters against the viewer\'s today, and "overdue" against the start of it', () => {
    const out = toSearchFilters({ ...EMPTY_FILTERS, due: 'week', client: 'none', created: 'past7', overdue: true }, ctx);
    expect(out).toMatchObject({
      dueFrom: local(2026, 10, 5),
      dueTo: local(2026, 10, 11, 23, 59, 59, 999),
      noClient: true,
      createdFrom: local(2026, 10, 1),
      overdue: true,
      overdueBefore: local(2026, 10, 7),
    });
    expect(out).not.toHaveProperty('noDue');
  });

  it('never sends the search text as a filter (it is its own parameter)', () => {
    expect(toSearchFilters({ ...EMPTY_FILTERS, search: 'walmart' }, ctx)).toEqual({});
  });
});

describe('filters in a URL', () => {
  const full: TaskFilters = {
    ...EMPTY_FILTERS,
    search: 'walmart hook',
    statuses: ['QC_REVISION_NEEDED', 'IN_EDIT'],
    priorities: ['HIGH'],
    editors: [ID, NOBODY],
    qcs: [ID2],
    mine: true,
    needsAction: true,
    overdue: true,
    hideFinished: true,
    due: 'week',
    client: '2026-10-01..2026-10-31',
    created: 'past30',
    aspectRatios: ['9:16'],
    spaces: [ID],
    folders: [ID2],
    lists: [ID],
  };

  it('round-trips every filter', () => {
    const params = writeFilters(new URLSearchParams(), full);
    expect(readFilters(new URLSearchParams(params.toString()))).toEqual(full);
  });

  it('writes only what is in use, so a clean view has a clean URL', () => {
    expect(writeFilters(new URLSearchParams(), EMPTY_FILTERS).toString()).toBe('');
    expect(writeFilters(new URLSearchParams(), { ...EMPTY_FILTERS, statuses: ['CLOSED'] }).toString()).toBe('status=CLOSED');
  });

  it('keeps the parameters that are not filters (the view, grouping...)', () => {
    const out = writeFilters(new URLSearchParams('view=board&group=editor&q=old&status=CLOSED'), { ...EMPTY_FILTERS, search: 'new' });
    expect(out.get('view')).toBe('board');
    expect(out.get('group')).toBe('editor');
    expect(out.get('q')).toBe('new');
    expect(out.has('status')).toBe(false);
  });

  it('ignores anything malformed or hostile instead of passing it on', () => {
    const f = readFilters(
      new URLSearchParams({
        status: 'IN_EDIT,not a key,drop table;,lower',
        priority: 'HIGH,URGENT!,BLOCKER',
        editor: `${ID},has space,none,'; drop,a/b`,
        qc: 'x'.repeat(300),
        due: 'yesterday',
        client: 'today',
        created: '..',
        aspect: '9:16,3:2',
        space: `${ID},<script>`,
        mine: 'yes',
        overdue: '1',
        q: 'y'.repeat(500),
      })
    );
    expect(f.statuses).toEqual(['IN_EDIT']);
    expect(f.priorities).toEqual(['HIGH']);
    expect(f.editors).toEqual([ID, NOBODY]);
    expect(f.qcs).toEqual([]);
    expect(f.due).toBeNull();
    expect(f.client).toBe('today');
    expect(f.created).toBeNull();
    expect(f.aspectRatios).toEqual(['9:16']);
    expect(f.spaces).toEqual([ID]);
    expect(f.mine).toBe(false); // only "1" turns a switch on
    expect(f.overdue).toBe(true);
    expect(f.search).toHaveLength(200);
  });

  it('caps a very long list and drops duplicates', () => {
    const many = Array.from({ length: 80 }, (_, i) => `S${i}`).join(',');
    expect(readFilters(new URLSearchParams({ status: many })).statuses).toHaveLength(50);
    expect(readFilters(new URLSearchParams({ status: 'IN_EDIT,IN_EDIT' })).statuses).toEqual(['IN_EDIT']);
  });

  it('puts nothing sensitive in a URL: only ids, enum words, dates and the search words typed', () => {
    const text = writeFilters(new URLSearchParams(), full).toString();
    expect(text).not.toMatch(/token|password|email|@/i);
    expect(FILTER_PARAMS).toContain('q');
  });

  it('counts every kind of filter once', () => {
    expect(countActiveFilters(full)).toBe(16);
  });
});
