import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_MODE, parseViewMode, type ViewMode } from '@/lib/task-views';

/** Last mode a person used for a list: a convenience, never the source of truth (the URL is). */
export const viewModeStorageKey = (listId: string) => `tbb_view_mode:${listId}`;

function stored(listId: string): ViewMode | null {
  try {
    return parseViewMode(window.localStorage.getItem(viewModeStorageKey(listId)));
  } catch {
    return null;
  }
}

/**
 * The current view (list / board / table). The URL decides (?view=board); a link without one opens the
 * mode this person last used for the list, then the default. Changing it keeps every other parameter.
 */
export function useViewMode(listId: string): [ViewMode, (mode: ViewMode) => void] {
  const [params, setParams] = useSearchParams();
  const mode = parseViewMode(params.get('view')) ?? stored(listId) ?? DEFAULT_MODE;
  const setMode = useCallback(
    (next: ViewMode) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set('view', next);
          return p;
        },
        { replace: true }
      );
      try {
        window.localStorage.setItem(viewModeStorageKey(listId), next);
      } catch {
        // storage unavailable: the URL still carries the choice
      }
    },
    [listId, setParams]
  );
  return [mode, setMode];
}
