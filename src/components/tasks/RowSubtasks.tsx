import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { useTask, useUpdateSubtask } from '@/hooks/use-tasks';
import type { TaskAccess } from '@/lib/tasks';

/**
 * A row's checklist, expanded in place. Loaded only when someone expands it (the list rows carry just
 * the counts), and ticking works right here with the same permissions as in the sheet.
 */
const RowSubtasks: React.FC<{ taskId: string; access: Pick<TaskAccess, 'tickSubtasks'> }> = ({ taskId, access }) => {
  const { data: task, isLoading, isError } = useTask(taskId);
  const update = useUpdateSubtask();

  if (isLoading) {
    return (
      <div className="relative z-10 flex items-center gap-2 py-1.5 pl-12 text-xs text-muted-foreground" role="status">
        <Loader2 aria-hidden className="h-3 w-3 animate-spin" /> Loading subtasks...
      </div>
    );
  }
  if (isError || !task) {
    return <p className="relative z-10 py-1.5 pl-12 text-xs text-destructive">The subtasks could not be loaded.</p>;
  }
  return (
    <ul className="relative z-10 mt-1 space-y-0.5 pb-1 pl-12" aria-label={`Subtasks of ${task.title}`}>
      {task.subtasks.map((s) => (
        <li key={s.id} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={s.isCompleted}
            disabled={!access.tickSubtasks}
            aria-label={`${s.isCompleted ? 'Mark not done' : 'Mark done'}: ${s.title}`}
            onCheckedChange={(checked) => update.mutate({ taskId, subtaskId: s.id, patch: { isCompleted: checked === true } })}
          />
          <span className={cn('truncate', s.isCompleted && 'text-muted-foreground line-through')}>{s.title}</span>
        </li>
      ))}
    </ul>
  );
};

export default RowSubtasks;
