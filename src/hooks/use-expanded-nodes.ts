import { useCallback, useState } from 'react';

/** UI preference only (which tree nodes are open). Never holds data or auth state. */
export const SIDEBAR_EXPANDED_STORAGE_KEY = 'tbb_sidebar_expanded';

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function write(ids: Set<string>): void {
  try {
    window.localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // storage may be unavailable (private mode); the tree still works for this session
  }
}

export function useExpandedNodes() {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(read()));

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      write(next);
      return next;
    });
  }, []);

  /** Opens every id in the list (used to reveal the active route's ancestors). */
  const reveal = useCallback((ids: string[]) => {
    setExpanded((prev) => {
      if (ids.every((id) => prev.has(id))) return prev;
      const next = new Set([...prev, ...ids]);
      write(next);
      return next;
    });
  }, []);

  return { expanded, toggle, reveal };
}
