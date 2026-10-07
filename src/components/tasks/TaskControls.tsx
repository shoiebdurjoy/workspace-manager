import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TASK_PRIORITIES, TASK_STATUSES } from '@/lib/tasks';
import type { TaskPriority, TaskStatus } from '@/types/database';
import ChoicePicker from './ChoicePicker';
import { PriorityFlag, TaskStatusPill } from './TaskBadges';

/**
 * Status and priority as controls when the person may change them, and as plain badges when they
 * may not (taskAccess decides; the database decides again). Shared by list rows, bulk actions and
 * the detail sheet, so the same thing looks and behaves the same everywhere.
 */

export const StatusControl: React.FC<{
  status: TaskStatus;
  /** Statuses this person may choose; empty = read-only. */
  allowed: readonly TaskStatus[];
  onChange: (status: TaskStatus) => void;
  variant?: 'cell' | 'field';
  label?: string;
}> = ({ status, allowed, onChange, variant = 'cell', label = 'Status' }) => {
  if (allowed.length === 0) {
    return (
      <span className={cn('inline-flex', variant === 'field' && 'h-8 items-center px-2')}>
        <TaskStatusPill status={status} className={variant === 'field' ? 'border-0 bg-transparent px-0' : undefined} />
      </span>
    );
  }
  return (
    <ChoicePicker
      label={label}
      value={status}
      searchable
      heading="Statuses"
      choices={TASK_STATUSES.filter((s) => allowed.includes(s.value) || s.value === status).map((s) => ({
        value: s.value,
        label: s.label,
        render: <TaskStatusPill status={s.value} className="border-0 bg-transparent px-0" />,
        disabled: !allowed.includes(s.value),
      }))}
      onChange={onChange}
      className={cn(
        variant === 'field' ? 'h-8 w-full justify-between px-2 hover:bg-muted data-[state=open]:bg-muted' : 'rounded-full',
        'group/status'
      )}
      trigger={
        variant === 'field' ? (
          <>
            <TaskStatusPill status={status} className="border-0 bg-transparent px-0" />
            <ChevronDown aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          </>
        ) : (
          <TaskStatusPill status={status} className="cursor-pointer transition-colors group-hover/status:border-foreground/30 group-data-[state=open]/status:border-ring" />
        )
      }
    />
  );
};

export const PriorityControl: React.FC<{
  priority: TaskPriority;
  editable: boolean;
  onChange: (priority: TaskPriority) => void;
  variant?: 'cell' | 'field';
}> = ({ priority, editable, onChange, variant = 'cell' }) => {
  if (!editable) {
    return (
      <span className={cn('inline-flex items-center', variant === 'field' && 'h-8 px-2')}>
        <PriorityFlag priority={priority} withLabel={variant === 'field'} />
      </span>
    );
  }
  return (
    <ChoicePicker
      label="Priority"
      value={priority}
      choices={TASK_PRIORITIES.map((p) => ({ value: p.value, label: p.label, render: <PriorityFlag priority={p.value} withLabel /> }))}
      onChange={onChange}
      align={variant === 'cell' ? 'end' : 'start'}
      className={
        variant === 'field'
          ? 'h-8 w-full justify-between px-2 text-sm hover:bg-muted data-[state=open]:bg-muted'
          : 'h-7 w-7 justify-center hover:bg-muted data-[state=open]:bg-muted'
      }
      trigger={
        variant === 'field' ? (
          <>
            <PriorityFlag priority={priority} withLabel />
            <ChevronDown aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          </>
        ) : (
          <PriorityFlag priority={priority} />
        )
      }
    />
  );
};
