import React, { useState } from 'react';
import { Copy, ExternalLink, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';
import { isValidTaskUrl, linkHost, validateTaskUrl } from '@/lib/tasks';
import { InlineText } from './fields';

interface LinkRowProps {
  icon: React.ReactNode;
  label: string;
  /** What belongs here, shown while the link is empty and as the input placeholder. */
  hint: string;
  value: string;
  editable: boolean;
  onCommit: (value: string) => void | Promise<unknown>;
}

/** "https://drive.google.com/drive/folders/abc?x=1" -> "/drive/folders/abc" (the part after the host). */
function pathOf(value: string): string {
  try {
    const url = new URL(value);
    const path = `${url.pathname === '/' ? '' : url.pathname}`;
    return path.length > 40 ? `${path.slice(0, 39)}…` : path;
  } catch {
    return '';
  }
}

/**
 * One production resource (raw footage, project file, review, final export). A saved link is shown
 * as what it is (its host) and opens in a new tab; people who may edit it get Copy and Edit, and an
 * empty link offers "Add link". Only http(s) links are ever stored (the database enforces it), and
 * a stored value that is somehow not a safe link is shown as plain text, never as an href.
 */
const LinkRow: React.FC<LinkRowProps> = ({ icon, label, hint, value, editable, onCommit }) => {
  const [editing, setEditing] = useState(false);
  const safe = !!value && isValidTaskUrl(value);
  const host = linkHost(value);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} link copied`);
    } catch {
      toast.error('The link could not be copied.');
    }
  };

  return (
    <div className="grid grid-cols-[1.25rem_6.5rem_minmax(0,1fr)] items-start gap-x-2 py-1.5">
      <span aria-hidden className="mt-1 text-muted-foreground">
        {icon}
      </span>
      <span className="mt-1 text-xs font-medium text-muted-foreground">{label}</span>

      {editing ? (
        <InlineText
          label={label}
          hideLabel
          type="url"
          autoFocus
          value={value}
          placeholder={hint}
          validate={validateTaskUrl}
          onCommit={onCommit}
          onFinish={() => setEditing(false)}
          inputClassName="h-8"
        />
      ) : value ? (
        <div className="group flex min-w-0 items-center gap-1">
          {safe ? (
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${label}${host ? ` (${host})` : ''}`}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="shrink-0 font-medium text-brand">{host}</span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">{pathOf(value)}</span>
              <ExternalLink aria-hidden className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </a>
          ) : (
            <span className="min-w-0 flex-1 truncate px-2 py-1 text-sm text-muted-foreground" title="This link is not a safe web address">
              {value}
            </span>
          )}
          {safe && (
            <IconButton
              aria-label={`Copy ${label}`}
              icon={<Copy className="h-3.5 w-3.5" />}
              variant="ghost"
              size="sm"
              className="h-7 w-7 shrink-0"
              onClick={() => void copy()}
            />
          )}
          {editable && (
            <IconButton
              aria-label={`Edit ${label}`}
              icon={<Pencil className="h-3.5 w-3.5" />}
              variant="ghost"
              size="sm"
              className="h-7 w-7 shrink-0"
              onClick={() => setEditing(true)}
            />
          )}
        </div>
      ) : editable ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Add ${label}`}
          className={cn('h-8 justify-start px-2 text-muted-foreground hover:text-foreground')}
          onClick={() => setEditing(true)}
        >
          <Plus aria-hidden className="mr-1.5 h-3.5 w-3.5" />
          <span className="truncate font-normal">{hint}</span>
        </Button>
      ) : (
        <span className="px-2 py-1 text-sm text-muted-foreground/70">Not added</span>
      )}
    </div>
  );
};

export default LinkRow;
