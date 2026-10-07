import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Quiet save feedback for autosaving screens. Wrap each save in `track()`: the state is "saving"
 * while any tracked save is in flight, "saved" for a moment after the last one succeeds, and "error"
 * if the latest one failed (cleared by the next save). Errors are re-thrown so callers still decide
 * what to do; this hook only reports.
 */
export function useSaveIndicator(savedForMs = 2500) {
  const [state, setState] = useState<SaveState>('idle');
  const inFlight = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const track = useCallback(
    <T,>(work: Promise<T>): Promise<T> => {
      inFlight.current += 1;
      clearTimeout(timer.current);
      setState('saving');
      return work.then(
        (value) => {
          inFlight.current -= 1;
          if (inFlight.current === 0) {
            setState('saved');
            timer.current = setTimeout(() => setState('idle'), savedForMs);
          }
          return value;
        },
        (error: unknown) => {
          inFlight.current -= 1;
          setState('error');
          throw error;
        }
      );
    },
    [savedForMs]
  );

  return { state, track };
}
