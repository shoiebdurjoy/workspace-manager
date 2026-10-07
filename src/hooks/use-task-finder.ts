import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { searchTasks } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/permissions';

/** The command palette starts searching once two characters are typed, and waits for a pause in typing. */
export const FINDER_MIN_CHARS = 2;
export const FINDER_DEBOUNCE_MS = 200;
export const FINDER_LIMIT = 8;

/**
 * "Find any task": asks the database (search_tasks) for the best few matches of what is typed: title,
 * short id, list / folder / space and people's names. Most recently updated first. Only for staff; for
 * anyone else nothing is requested.
 */
export function useTaskFinder(text: string, open: boolean) {
  const { workspace, role } = useAuth();
  const ws = workspace?.id ?? '';
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), FINDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const term = debounced.length >= FINDER_MIN_CHARS && text.trim().length >= FINDER_MIN_CHARS ? debounced : '';
  const query = useQuery({
    queryKey: ['workspace', ws, 'tasks', 'finder', term],
    queryFn: () => searchTasks(ws, { query: term, sort: 'updated', dir: 'desc' }, 0, FINDER_LIMIT),
    enabled: open && !!ws && !!term && can(role, 'hierarchy:view'),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  return { term, tasks: term ? (query.data?.items ?? []) : [], total: query.data?.total ?? 0, isFetching: query.isFetching, isError: query.isError };
}
