import React, { useMemo } from 'react';
import { parseComment } from '@/lib/collaboration';
import { cn } from '@/lib/utils';

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

/** Splits plain text into text and links. Trailing punctuation is not part of the link. Only http(s) is ever linked. */
function linkify(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(URL_PATTERN)) {
    const raw = m[0];
    const url = raw.replace(/[.,;:!?)\]}]+$/, '');
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <a
        key={`${keyPrefix}-l${i++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-primary underline underline-offset-2 hover:no-underline"
      >
        {url}
      </a>
    );
    last = start + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface MentionTextProps {
  body: string;
  /** Highlights the mentions of this person (the signed-in user). */
  selfId?: string | null;
  className?: string;
}

/**
 * A comment as text: mentions become "@Name" chips, links become links, everything else is plain text with
 * its line breaks. Nothing in a comment is ever rendered as HTML.
 */
const MentionText: React.FC<MentionTextProps> = ({ body, selfId, className }) => {
  const parts = useMemo(() => parseComment(body), [body]);
  return (
    <p className={cn('whitespace-pre-wrap break-words text-sm leading-relaxed', className)}>
      {parts.map((part, i) =>
        part.type === 'mention' ? (
          <span
            key={i}
            data-mention={part.userId}
            className={cn(
              'rounded px-1 py-0.5 font-medium',
              part.userId === selfId ? 'bg-primary/20 text-foreground' : 'bg-muted text-foreground'
            )}
          >
            @{part.name}
          </span>
        ) : (
          <React.Fragment key={i}>{linkify(part.text, String(i))}</React.Fragment>
        )
      )}
    </p>
  );
};

export default MentionText;
