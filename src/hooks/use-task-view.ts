import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DEFAULT_VIEW,
  NO_PREFS,
  parseViewPrefs,
  readViewParams,
  serializeViewPrefs,
  writeViewParams,
  type TaskFilters,
  type TaskViewState,
  type ViewPrefs,
} from '@/lib/task-view';
import { FILTER_PARAMS, readFilters, writeFilters } from '@/lib/task-filters';

/** UI preference only (grouping, sort, collapsed groups): never task data, never filters or search text. */
export const taskViewStorageKey = (scopeKey: string) => `tbb_task_view:${scopeKey}`;

function readPrefs(scopeKey: string): ViewPrefs {
  try {
    return parseViewPrefs(window.localStorage.getItem(taskViewStorageKey(scopeKey)));
  } catch {
    return NO_PREFS;
  }
}

function writePrefs(scopeKey: string, prefs: ViewPrefs) {
  try {
    window.localStorage.setItem(taskViewStorageKey(scopeKey), serializeViewPrefs(prefs));
  } catch {
    // storage unavailable (private mode, quota): the view still works for this visit
  }
}

/**
 * The view of a set of tasks (filters, search, grouping, sort) lives in the URL, so a filtered view is a
 * link that can be bookmarked or sent to a colleague, and the Back button and reloads behave. The
 * browser only remembers the person's own way of grouping / sorting (and which groups are collapsed)
 * for links that do not say; filters are never remembered silently.
 *
 * `scopeKey` is the list (or "everything") the preferences belong to.
 */
export function useTaskView(scopeKey: string) {
  const [params, setParams] = useSearchParams();
  const [prefs, setPrefsState] = useState<ViewPrefs>(() => readPrefs(scopeKey));
  const [forKey, setForKey] = useState(scopeKey);
  // another list: load its own preferences (adjusting state while rendering, not in an effect)
  if (forKey !== scopeKey) {
    setForKey(scopeKey);
    setPrefsState(readPrefs(scopeKey));
  }

  const fromUrl = useMemo(() => readViewParams(params), [params]);
  const filters = useMemo(() => readFilters(params), [params]);
  const view: TaskViewState = useMemo(
    () => ({
      groupBy: fromUrl.groupBy ?? prefs.groupBy ?? DEFAULT_VIEW.groupBy,
      sort: fromUrl.sort ?? prefs.sort ?? DEFAULT_VIEW.sort,
      dir: fromUrl.dir ?? prefs.dir ?? DEFAULT_VIEW.dir,
      filters,
      collapsed: prefs.collapsed,
    }),
    [fromUrl, prefs, filters]
  );

  const savePrefs = useCallback(
    (change: Partial<ViewPrefs>) =>
      setPrefsState((p) => {
        const next = { ...p, ...change };
        writePrefs(scopeKey, next);
        return next;
      }),
    [scopeKey]
  );

  /** Grouping and sorting: written into the URL (so the link carries them) and remembered. */
  const update = useCallback(
    (patch: Partial<Pick<TaskViewState, 'groupBy' | 'sort' | 'dir'>>) => {
      setParams((prev) => writeViewParams(prev, patch), { replace: true });
      savePrefs(patch);
    },
    [setParams, savePrefs]
  );

  const setFilters = useCallback(
    (patch: Partial<TaskFilters>) => setParams((prev) => writeFilters(prev, { ...readFilters(prev), ...patch }), { replace: true }),
    [setParams]
  );

  const toggleCollapsed = useCallback(
    (key: string) =>
      savePrefs({ collapsed: prefs.collapsed.includes(key) ? prefs.collapsed.filter((k) => k !== key) : [...prefs.collapsed, key] }),
    [prefs.collapsed, savePrefs]
  );

  /** Clears every filter and the search; grouping, sorting and the chosen view stay. */
  const reset = useCallback(
    () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const k of FILTER_PARAMS) next.delete(k);
          return next;
        },
        { replace: true }
      ),
    [setParams]
  );

  return { view, update, setFilters, toggleCollapsed, reset };
}
