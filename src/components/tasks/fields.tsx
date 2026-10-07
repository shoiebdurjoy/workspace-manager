import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  autoFocus?: boolean;
  /** Called when editing is over: saved, unchanged or cancelled (NOT when validation failed). */
  onFinish?: () => void;
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
  autoFocus,
  onFinish,
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

  /** Returns true when editing is over (saved or unchanged), false when the input is invalid. */
  const commit = (): boolean => {
    const next = draft.trim();
    if (next === value.trim()) {
      setDraft(value);
      setError(null);
      return true;
    }
    const message = validate ? validate(next) : null;
    if (message) {
      setError(message);
      return false;
    }
    setError(null);
    // a rejected save (the hook already toasted) puts the field back to the saved value
    Promise.resolve(onCommit(next)).catch(() => setDraft(value));
    return true;
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
        onFinish?.();
        return;
      }
      if (commit()) onFinish?.();
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
          autoFocus={autoFocus}
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
          autoFocus={autoFocus}
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
