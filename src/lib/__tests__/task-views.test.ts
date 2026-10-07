import { describe, it, expect } from 'vitest';
import { TABLE_COLUMNS, VIEW_MODES, defaultColumns, nextSort, parseColumns, parseViewMode, shortId } from '../task-views';

describe('view modes', () => {
  it('are List, Board and Table, and nothing else is accepted from a URL', () => {
    expect(VIEW_MODES.map((m) => m.value)).toEqual(['list', 'board', 'table']);
    expect(parseViewMode('board')).toBe('board');
    for (const bad of ['calendar', 'BOARD', '', null, undefined, '<script>']) expect(parseViewMode(bad as never)).toBeNull();
  });
});

describe('table columns', () => {
  it('start with the useful ones and every column is known', () => {
    expect(defaultColumns()).toEqual(['status', 'editor', 'qc', 'dueDate', 'clientDeadline', 'priority', 'links']);
    expect(new Set(TABLE_COLUMNS.map((c) => c.key)).size).toBe(TABLE_COLUMNS.length);
  });

  it('a stored choice is read defensively, kept in display order, and unknown columns are dropped', () => {
    expect(parseColumns(JSON.stringify(['priority', 'status', 'nope', 3]))).toEqual(['status', 'priority']);
    expect(parseColumns('[]')).toEqual([]);
    for (const bad of [null, undefined, '', '{bad json', '{"a":1}', '"str"']) expect(parseColumns(bad as never)).toEqual(defaultColumns());
  });

  it('sortable columns map to real sort keys', () => {
    expect(TABLE_COLUMNS.filter((c) => c.sort).map((c) => c.sort)).toEqual(['status', 'editor', 'qc', 'dueDate', 'clientDeadline', 'priority', 'created', 'updated']);
  });
});

describe('header sorting', () => {
  it('cycles ascending, descending, manual', () => {
    expect(nextSort({ sort: 'manual', dir: 'asc' }, 'title')).toEqual({ sort: 'title', dir: 'asc' });
    expect(nextSort({ sort: 'title', dir: 'asc' }, 'title')).toEqual({ sort: 'title', dir: 'desc' });
    expect(nextSort({ sort: 'title', dir: 'desc' }, 'title')).toEqual({ sort: 'manual', dir: 'asc' });
    expect(nextSort({ sort: 'title', dir: 'desc' }, 'priority')).toEqual({ sort: 'priority', dir: 'asc' });
  });
});

describe('short id', () => {
  it('is the first block of the task id', () => {
    expect(shortId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')).toBe('aaaaaaaa');
  });
});
