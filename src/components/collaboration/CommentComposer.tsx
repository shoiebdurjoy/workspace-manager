import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { UserAvatar } from '@/components/ui/user-avatar';
import { RoleLabel } from './RoleLabel';
import { activeMentionQuery, COMMENT_MAX_LENGTH, insertMention, mentionCandidates, validateComment } from '@/lib/collaboration';
import type { WorkspaceMember } from '@/types/database';
import { cn } from '@/lib/utils';

interface CommentComposerProps {
  members: readonly WorkspaceMember[];
  selfId: string | null | undefined;
  /** Called with the text; reject to keep the text in the box (the caller shows the reason). */
  onSubmit: (body: string) => Promise<unknown>;
  onCancel?: () => void;
  initialValue?: string;
  submitLabel?: string;
  placeholder?: string;
  autoFocus?: boolean;
  label: string;
}

/**
 * A comment box with @mentions: typing "@" after a space opens a list of the people who can be mentioned
 * (arrow keys and Enter, or the mouse). The text is cleared the moment it is sent, so posting feels instant;
 * if the database refuses, the text comes back, untouched, with the reason.
 */
const CommentComposer: React.FC<CommentComposerProps> = ({
  members,
  selfId,
  onSubmit,
  onCancel,
  initialValue = '',
  submitLabel = 'Comment',
  placeholder = 'Write a comment… type @ to mention someone',
  autoFocus,
  label,
}) => {
  const [text, setText] = useState(initialValue);
  const [caret, setCaret] = useState(initialValue.length);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();

  const mention = useMemo(() => (dismissed ? null : activeMentionQuery(text, caret)), [text, caret, dismissed]);
  const candidates = useMemo(() => (mention ? mentionCandidates(members, mention.query, selfId) : []), [members, mention, selfId]);
  const open = candidates.length > 0;

  useEffect(() => {
    setHighlight(0);
  }, [mention?.query, mention?.start]);

  useEffect(() => {
    if (autoFocus) {
      const el = ref.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }
  }, [autoFocus]);

  const pick = (member: WorkspaceMember) => {
    if (!mention) return;
    const next = insertMention(text, caret, mention, member.profile?.fullName ?? 'member', member.userId);
    setText(next.text);
    setCaret(next.caret);
    setDismissed(false);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  const submit = async () => {
    if (busy) return;
    const problem = validateComment(text);
    if (problem) {
      setError(problem);
      return;
    }
    const sent = text;
    setBusy(true);
    setError(null);
    // optimistic: the box empties now; the text returns if it fails
    if (!onCancel) setText('');
    try {
      await onSubmit(sent);
    } catch (err) {
      setText(sent);
      setError(err instanceof Error ? err.message : 'The comment could not be posted.');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % candidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(candidates[highlight]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  const remaining = COMMENT_MAX_LENGTH - text.length;

  return (
    <div className="relative space-y-2">
      <Textarea
        ref={ref}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
        aria-invalid={!!error}
        value={text}
        placeholder={placeholder}
        rows={onCancel ? 3 : 2}
        className="min-h-[64px] resize-y text-sm"
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setDismissed(false);
          setError(null);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        // a click on a suggestion must not close the list before it registers
        onBlur={() => window.setTimeout(() => setDismissed(true), 120)}
        onFocus={() => setDismissed(false)}
      />

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="People you can mention"
          className="absolute bottom-full left-0 z-20 mb-1 w-72 max-w-full overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {candidates.map((m, i) => (
            <li
              key={m.userId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm', i === highlight && 'bg-accent text-accent-foreground')}
            >
              <UserAvatar name={m.profile?.fullName} src={m.profile?.avatarUrl ?? undefined} size="xs" />
              <span className="min-w-0 flex-1 truncate">{m.profile?.fullName}</span>
              <RoleLabel role={m.role} />
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        {/* only near the limit: a live region that is always there is noise for screen readers */}
        {remaining <= 500 ? (
          <span className="text-[11px] text-muted-foreground" aria-live="polite">
            {remaining < 0 ? `${-remaining} over the limit` : `${remaining.toLocaleString()} characters left`}
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
          <Button type="button" size="sm" onClick={() => void submit()} disabled={busy || !text.trim()} title="Ctrl/⌘ + Enter">
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CommentComposer;
