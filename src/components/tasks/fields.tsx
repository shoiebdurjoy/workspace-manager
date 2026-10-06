import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/auth/AuthLayout';

interface InlineTextProps {
  label: string;
  value: string;
  /** Called with the trimmed new value, only when it changed and passed validation. */
  onCommit: (value: string) => void | Promise<unknown>;
  validate?: (value: string) => string | null;
  disabled?: boolean;
  placeholder?: string;
  type?: 'text' | 'url';
  /** Long single-line values (titles) wrap onto more lines instead of scrolling sideways. */
  wrap?: boolean;
  /** Visually hide the label (it is still the accessible name). */
  hideLabel?: boolean;
  className?: string;
  inputClassName?: string;
}

/**
 * A single-line field that saves when you leave it (or press Enter) and reverts on Escape.
 * Invalid input is explained under the field and is never sent. While another save for the same
 * field is in flight the draft stays as typed; when the server value changes (someone else edited
 * it, or a save finished) an untouched field follows it.
 */
export const InlineText: React.FC<InlineTextProps> = ({
  label,
  value,
  onCommit,
  validate,
  disabled,
  placeholder,
  type = 'text',
  wrap,
  hideLabel,
  className,
  inputClassName,
}) => {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Escape cancels: the blur that follows must not save the text being discarded.
  const cancelled = useRef(false);

  // An untouched field follows the saved value; a field being edited keeps what is typed, and
  // after a save it keeps showing it until the refreshed value arrives (no flicker to the old text).
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  const commit = () => {
    const next = draft.trim();
    if (next === value.trim()) {
      setDraft(value);
      setError(null);
      return;
    }
    const message = validate ? validate(next) : null;
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    // a rejected save (the hook already toasted) puts the field back to the saved value
    Promise.resolve(onCommit(next)).catch(() => setDraft(value));
  };

  const growRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = growRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, wrap]);

  const handlers = {
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(e.target.value.replace(/\n/g, ' '));
      if (error) setError(null);
    },
    onFocus: () => {
      focusedRef.current = true;
    },
    onBlur: () => {
      focusedRef.current = false;
      if (cancelled.current) {
        cancelled.current = false;
        setDraft(value);
        setError(null);
        return;
      }
      commit();
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.currentTarget.blur();
      } else if (e.key === 'Escape') {
        cancelled.current = true;
        e.currentTarget.blur();
      }
    },
  };

  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={id} className={cn('text-xs font-medium text-muted-foreground', hideLabel && 'sr-only')}>
        {label}
      </label>
      {wrap ? (
        <Textarea
          id={id}
          ref={growRef}
          data-inline-field=""
          rows={1}
          value={draft}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          {...handlers}
          className={cn('min-h-0 resize-none overflow-hidden text-sm', inputClassName)}
        />
      ) : (
        <Input
          id={id}
          data-inline-field=""
          type={type}
          inputMode={type === 'url' ? 'url' : undefined}
          value={draft}
          disabled={disabled}
          placeholder={disabled ? '' : placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          {...handlers}
          className={cn('h-9 text-sm', inputClassName)}
        />
      )}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
};

interface InlineTextareaProps {
  label: string;
  value: string;
  onCommit: (value: string) => Promise<unknown>;
  validate?: (value: string) => string | null;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
}

/** A multi-line field with explicit Save / Cancel, because Enter must stay a newline. */
export const InlineTextarea: React.FC<InlineTextareaProps> = ({
  label,
  value,
  onCommit,
  validate,
  disabled,
  placeholder,
  rows = 5,
}) => {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = draft.trim() !== value.trim();

  useEffect(() => {
    if (!dirty) setDraft(value);
    // only follow the server while the person has no unsaved edits
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const save = async () => {
    const message = validate ? validate(draft) : null;
    setError(message);
    if (message) return;
    setSaving(true);
    try {
      await onCommit(draft.trim());
    } catch {
      // the mutation hook already showed the error toast; keep the draft so nothing is lost
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Textarea
        id={id}
        value={draft}
        rows={rows}
        disabled={disabled}
        placeholder={disabled ? 'No brief yet.' : placeholder}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        className="text-sm"
      />
      <FieldError id={`${id}-error`} message={error} />
      {dirty && !disabled && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving...' : 'Save brief'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(value);
              setError(null);
            }}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
};

/** A labelled slot in the overview grid. */
export const Field: React.FC<{ label: string; htmlFor?: string; children: React.ReactNode; className?: string }> = ({
  label,
  htmlFor,
  children,
  className,
}) => (
  <div className={cn('space-y-1', className)}>
    <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
      {label}
    </label>
    {children}
  </div>
);
