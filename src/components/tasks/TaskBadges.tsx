import React from 'react';
import { Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/components/ui/user-avatar';
import { dueState, formatDay, memberName, priorityOption, statusOption, type MemberLookup } from '@/lib/tasks';
import type { TaskPriority, TaskStatus } from '@/types/database';

/** Status as a neutral pill with a coloured dot: the label carries the meaning, colour is a cue. */
export const TaskStatusPill: React.FC<{ status: TaskStatus; className?: string }> = ({ status, className }) => {
  const option = statusOption(status);
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-muted/50 px-2.5 text-[11px] font-medium text-foreground',
        className
      )}
    >
      <span aria-hidden className={cn('h-2 w-2 rounded-full', option.dot)} />
      {option.label}
    </span>
  );
};

export const PriorityFlag: React.FC<{ priority: TaskPriority; withLabel?: boolean; className?: string }> = ({
  priority,
  withLabel = false,
  className,
}) => {
  const option = priorityOption(priority);
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', className)} title={`${option.label} priority`}>
      <Flag aria-hidden className={cn('h-3.5 w-3.5 fill-current', option.flag)} />
      {withLabel ? <span>{option.label}</span> : <span className="sr-only">{option.label} priority</span>}
    </span>
  );
};

/** Editor + QC reviewer as two small avatars for a list row (names are in the labels). */
export const AssigneeStack: React.FC<{
  editorId: string | null;
  qcId: string | null;
  lookup: MemberLookup;
  className?: string;
}> = ({ editorId, qcId, lookup, className }) => {
  const slots = [
    { id: editorId, label: 'Editor' },
    { id: qcId, label: 'QC' },
  ];
  return (
    <span className={cn('inline-flex items-center -space-x-1', className)}>
      {slots.map(({ id, label }) => {
        const text = id ? `${label}: ${memberName(lookup, id)}` : `${label}: unassigned`;
        return (
          <span
            key={label}
            title={text}
            aria-label={text}
            role="img"
            className="inline-flex rounded-full ring-2 ring-background"
          >
            {id ? (
              <UserAvatar name={memberName(lookup, id)} src={lookup.get(id)?.profile?.avatarUrl ?? undefined} size="xs" />
            ) : (
              <span
                aria-hidden
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border bg-background text-[9px] font-medium text-muted-foreground"
              >
                {label === 'QC' ? 'QC' : 'Ed'}
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
};

const DUE_TONE: Record<string, string> = {
  overdue: 'font-semibold text-destructive',
  today: 'font-semibold text-foreground',
  soon: 'font-medium text-foreground',
  later: 'text-muted-foreground',
};

/** A deadline as "12 Oct", flagged when overdue (never for finished tasks). */
export const DueLabel: React.FC<{
  iso: string | null | undefined;
  finished?: boolean;
  /** "Internal QC due" / "Client deadline": read by screen readers and shown as a tooltip. */
  label: string;
  className?: string;
}> = ({ iso, finished = false, label, className }) => {
  if (!iso) return <span className={cn('text-xs text-muted-foreground/60', className)} aria-label={`${label}: not set`}>-</span>;
  const state = finished ? 'later' : dueState(iso) ?? 'later';
  return (
    <span className={cn('whitespace-nowrap text-xs tabular-nums', DUE_TONE[state], className)} title={`${label}: ${formatDay(iso)}`}>
      <span className="sr-only">{label}: </span>
      {formatDay(iso)}
      {state === 'overdue' && <span className="sr-only"> (overdue)</span>}
    </span>
  );
};
