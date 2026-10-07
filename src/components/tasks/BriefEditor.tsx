import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { FieldError } from '@/components/auth/AuthLayout';

interface BriefEditorProps {
  label: string;
  value: string;
  onCommit: (value: string) => Promise<unknown>;
  validate?: (value: string) => string | null;
  /** Read-only people see the brief as text with its line breaks intact, not a disabled box. */
  readOnly: boolean;
}

const BASE = 'w-full whitespace-pre-wrap break-words text-sm leading-relaxed';

/**
 * The production instructions. Editable: a roomy, auto-growing text area that looks like a
 * document (no box until hovered or focused), saved when you click away or press Ctrl/Cmd+Enter;
 * Escape discards. Read-only: the same text, rendered with its line breaks. Line breaks are
 * always preserved.
 */
const BriefEditor: React.FC<BriefEditorProps> = ({ label, value, onCommit, validate, readOnly }) => {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const focusedRef = useRef(false);
  const cancelled = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const dirty = draft.trim() !== value.trim();

  // Follow the saved value only while there is nothing being typed.
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  // Fit the height to the text, now and whenever the width changes (the sheet slides in, the window resizes).
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 168)}px`;
  };
  useLayoutEffect(fit, [draft]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => fit());
    observer.observe(el);
    return () => observer.disconnect();
  }, [readOnly]);

  if (readOnly) {
    return value.trim() ? (
      <div role="region" aria-label={label} className={cn(BASE, 'px-2 py-1')}>
        {value}
      </div>
    ) : (
      <p role="region" aria-label={label} className="px-2 py-1 text-sm text-muted-foreground/70">
        No brief has been written for this task.
      </p>
    );
  }

  const save = async () => {
    const next = draft.trim();
    if (next === value.trim()) {
      setDraft(value);
      return;
    }
    const message = validate ? validate(next) : null;
    setError(message);
    if (message) return;
    try {
      await onCommit(next);
    } catch {
      // the mutation hook already showed the error; put the text back to what is saved
      setDraft(value);
    }
  };

  return (
    <div className="space-y-1">
      <textarea
        id={id}
        ref={ref}
        aria-label={label}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        value={draft}
        placeholder="What needs to be edited? References, hooks, captions, music, anything the editor needs."
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onBlur={() => {
          focusedRef.current = false;
          if (cancelled.current) {
            cancelled.current = false;
            setDraft(value);
            setError(null);
            return;
          }
          void save();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            cancelled.current = true;
            e.currentTarget.blur();
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        data-inline-field=""
        className={cn(
          BASE,
          'min-h-[168px] resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1 outline-none transition-colors',
          'placeholder:text-muted-foreground/70 hover:border-border focus-visible:border-input focus-visible:ring-2 focus-visible:ring-ring'
        )}
      />
      <FieldError id={`${id}-error`} message={error} />
      <p className={cn('px-2 text-[11px]', dirty ? 'text-foreground' : 'text-muted-foreground')} aria-live="polite">
        {dirty ? 'Unsaved changes: click away or press Ctrl+Enter to save, Esc to discard' : 'Saves when you click away'}
      </p>
    </div>
  );
};

export default BriefEditor;
