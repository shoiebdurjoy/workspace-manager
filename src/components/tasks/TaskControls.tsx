import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TASK_PRIORITIES } from '@/lib/tasks';
import type { TaskPriority } from '@/types/database';
import ChoicePicker from './ChoicePicker';
import { PriorityFlag } from './TaskBadges';

/**
 * Priority as a control when the person may change it, and as a plain flag when they may not
 * (taskAccess decides; the database decides again). Shared by list rows and the detail sheet. The
 * stage of a task has its own control, WorkflowPicker.
 */

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
