import type { SortKey } from '@/lib/task-view';

/**
 * The three ways to look at the same tasks. They share one query, one selection and one set of
 * inline controls; only the layout differs. The mode lives in the URL (?view=board), so a link opens
 * the same view for whoever receives it.
 */
export type ViewMode = 'list' | 'board' | 'table';

export const VIEW_MODES: ReadonlyArray<{ value: ViewMode; label: string }> = [
  { value: 'list', label: 'List' },
  { value: 'board', label: 'Board' },
  { value: 'table', label: 'Table' },
];

export const DEFAULT_MODE: ViewMode = 'list';

export const parseViewMode = (value: string | null | undefined): ViewMode | null =>
  VIEW_MODES.some((m) => m.value === value) ? (value as ViewMode) : null;

// ---------------------------------------------------------------------------------------
// Table columns
// ---------------------------------------------------------------------------------------

export type ColumnKey =
  | 'status'
  | 'editor'
  | 'qc'
  | 'dueDate'
  | 'clientDeadline'
  | 'priority'
  | 'list'
  | 'aspectRatio'
  | 'links'
  | 'subtasks'
  | 'revisions'
  | 'created'
  | 'updated'
  | 'id';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  /** Sorting by this column header (null = not sortable). */
  sort: SortKey | null;
  defaultVisible: boolean;
  /** Tailwind width of the column. */
  width: string;
}

/** The Task column is always there; these are the others, in display order. */
export const TABLE_COLUMNS: readonly ColumnDef[] = [
  { key: 'status', label: 'Status', sort: 'status', defaultVisible: true, width: 'w-44' },
  { key: 'editor', label: 'Editor', sort: 'editor', defaultVisible: true, width: 'w-40' },
  { key: 'qc', label: 'QC reviewer', sort: 'qc', defaultVisible: true, width: 'w-40' },
  { key: 'dueDate', label: 'QC due', sort: 'dueDate', defaultVisible: true, width: 'w-28' },
  { key: 'clientDeadline', label: 'Client deadline', sort: 'clientDeadline', defaultVisible: true, width: 'w-32' },
  { key: 'priority', label: 'Priority', sort: 'priority', defaultVisible: true, width: 'w-28' },
  { key: 'list', label: 'List', sort: null, defaultVisible: false, width: 'w-44' },
  { key: 'aspectRatio', label: 'Aspect ratio', sort: null, defaultVisible: false, width: 'w-24' },
  { key: 'links', label: 'Links', sort: null, defaultVisible: true, width: 'w-24' },
  { key: 'subtasks', label: 'Subtasks', sort: null, defaultVisible: false, width: 'w-24' },
  { key: 'revisions', label: 'Revisions', sort: null, defaultVisible: false, width: 'w-24' },
  { key: 'created', label: 'Created', sort: 'created', defaultVisible: false, width: 'w-28' },
  { key: 'updated', label: 'Updated', sort: 'updated', defaultVisible: false, width: 'w-28' },
  { key: 'id', label: 'ID', sort: null, defaultVisible: false, width: 'w-24' },
];

export const defaultColumns = (): ColumnKey[] => TABLE_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);

/** Reads a stored column list defensively; unknown or malformed values fall back to the defaults. */
export function parseColumns(raw: string | null | undefined): ColumnKey[] {
  if (!raw) return defaultColumns();
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return defaultColumns();
    const known = new Set<string>(TABLE_COLUMNS.map((c) => c.key));
    const picked = data.filter((k): k is ColumnKey => typeof k === 'string' && known.has(k));
    return TABLE_COLUMNS.filter((c) => picked.includes(c.key)).map((c) => c.key);
  } catch {
    return defaultColumns();
  }
}

/** The next sort when a column header is clicked: ascending, then descending, then back to manual order. */
export function nextSort(current: { sort: SortKey; dir: 'asc' | 'desc' }, clicked: SortKey): { sort: SortKey; dir: 'asc' | 'desc' } {
  if (current.sort !== clicked) return { sort: clicked, dir: 'asc' };
  if (current.dir === 'asc') return { sort: clicked, dir: 'desc' };
  return { sort: 'manual', dir: 'asc' };
}

/** A short, shareable identifier for a task: the first block of its id (what search by id matches). */
export const shortId = (taskId: string): string => taskId.slice(0, 8);
