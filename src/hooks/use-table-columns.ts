import { useCallback, useState } from 'react';
import { defaultColumns, parseColumns, type ColumnKey } from '@/lib/task-views';

/** Which table columns a person chose to see: a browser-local preference, safe to lose. */
export const tableColumnsStorageKey = 'tbb_table_columns';

function read(): ColumnKey[] {
  try {
    return parseColumns(window.localStorage.getItem(tableColumnsStorageKey));
  } catch {
    return defaultColumns();
  }
}

export function useTableColumns(): [ColumnKey[], (columns: ColumnKey[]) => void, () => void] {
  const [columns, setState] = useState<ColumnKey[]>(read);
  const set = useCallback((next: ColumnKey[]) => {
    setState(next);
    try {
      window.localStorage.setItem(tableColumnsStorageKey, JSON.stringify(next));
    } catch {
      // storage unavailable: the choice still holds for this visit
    }
  }, []);
  const reset = useCallback(() => {
    setState(defaultColumns());
    try {
      window.localStorage.removeItem(tableColumnsStorageKey);
    } catch {
      // nothing stored to remove
    }
  }, []);
  return [columns, set, reset];
}
