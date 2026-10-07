import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_VIEW, parseStoredView, serializeView, type TaskFilters, type TaskViewState } from '@/lib/task-view';

/** UI preference only (grouping, sort, filters, collapsed groups): never task data, never search text. */
export const taskViewStorageKey = (listId: string) => `tbb_task_view:${listId}`;

function read(listId: string): TaskViewState {
  try {
    return parseStoredView(window.localStorage.getItem(taskViewStorageKey(listId)));
  } catch {
    return DEFAULT_VIEW;
  }
}

/**
 * How one person likes to see one list (grouping, sort, filters, collapsed groups). A browser-local
 * UI preference, like the sidebar's open folders: it never holds task data and it is safe to lose.
 */
export function useTaskView(listId: string) {
  const [view, setView] = useState<TaskViewState>(() => read(listId));

  // another list: load its own preference
  useEffect(() => setView(read(listId)), [listId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(taskViewStorageKey(listId), serializeView(view));
    } catch {
      // storage unavailable (private mode, quota): the view still works for this visit
    }
  }, [listId, view]);

  const update = useCallback((patch: Partial<TaskViewState>) => setView((v) => ({ ...v, ...patch })), []);
  const setFilters = useCallback(
    (patch: Partial<TaskFilters>) => setView((v) => ({ ...v, filters: { ...v.filters, ...patch } })),
    []
  );
  const toggleCollapsed = useCallback(
    (key: string) =>
      setView((v) => ({ ...v, collapsed: v.collapsed.includes(key) ? v.collapsed.filter((k) => k !== key) : [...v.collapsed, key] })),
    []
  );
  const reset = useCallback(() => setView((v) => ({ ...DEFAULT_VIEW, collapsed: v.collapsed })), []);

  return { view, update, setFilters, toggleCollapsed, reset };
}
