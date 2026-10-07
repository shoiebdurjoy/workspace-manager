import React from 'react';
import { Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/components/ui/user-avatar';
import { dueState, formatDay, memberName, priorityOption, type MemberLookup } from '@/lib/tasks';
import { statusColor, statusName, statusOf } from '@/lib/workflow';
import { useWorkflow } from '@/hooks/use-workflow';
import type { TaskPriority, TaskStatus } from '@/types/database';

/**
 * A workflow stage as a pill: the stage's exact name, tinted with its colour from the workflow. The
 * name carries the meaning, the colour is a cue. A revision stage is unmistakable (solid red).
 */
export const TaskStatusPill: React.FC<{ status: TaskStatus; className?: string; plain?: boolean }> = ({ status, className, plain }) => {
  const workflow = useWorkflow().data;
  const color = statusColor(workflow, status);
  const revision = !!statusOf(workflow, status)?.countsRevision;
  return (
    <span
      data-status={status}
      title={statusName(workflow, status)}
      className={cn(
        'inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-wide',
        revision && !plain ? 'border-transparent text-white' : 'text-foreground',
        plain && 'border-0 bg-transparent px-0',
        className
      )}
      style={
        plain
          ? undefined
          : revision
            ? { backgroundColor: color }
            : { backgroundColor: `${color}1f`, borderColor: `${color}66` }
      }
    >
      <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', revision && !plain && 'bg-white')} style={revision && !plain ? undefined : { backgroundColor: color }} />
      <span className="truncate">{statusName(workflow, status)}</span>
    </span>
  );
};

/** "Rev 2": how many times this cut has been sent back. Nothing when it never was. */
export const RevisionTag: React.FC<{ count: number; className?: string }> = ({ count, className }) =>
  count > 0 ? (
    <span
      title={`Sent back for changes ${count} ${count === 1 ? 'time' : 'times'}`}
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded border border-destructive/40 bg-destructive/10 px-1.5 text-[10px] font-semibold tabular-nums text-destructive',
        className
      )}
    >
      <span aria-hidden>Rev {count}</span>
      <span className="sr-only">Revision {count}</span>
    </span>
  ) : null;

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
