import React from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SaveState } from '@/hooks/use-save-indicator';

/** Small, quiet, announced politely to screen readers; takes no space when there is nothing to say. */
const SaveIndicator: React.FC<{ state: SaveState; className?: string }> = ({ state, className }) => (
  <span
    role="status"
    aria-live="polite"
    className={cn(
      'inline-flex h-5 items-center gap-1 text-[11px] transition-opacity',
      state === 'error' ? 'text-destructive' : 'text-muted-foreground',
      state === 'idle' && 'opacity-0',
      className
    )}
  >
    {state === 'saving' && (
      <>
        <Loader2 aria-hidden className="h-3 w-3 animate-spin" /> Saving...
      </>
    )}
    {state === 'saved' && (
      <>
        <Check aria-hidden className="h-3 w-3" /> Saved
      </>
    )}
    {state === 'error' && (
      <>
        <AlertCircle aria-hidden className="h-3 w-3" /> Not saved
      </>
    )}
  </span>
);

export default SaveIndicator;
