import React, { useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';
import { useAddSubtask, useDeleteSubtask, useUpdateSubtask } from '@/hooks/use-tasks';
import { subtaskProgress, validateTaskTitle, type TaskAccess } from '@/lib/tasks';
import type { Subtask } from '@/types/database';
import { InlineText } from './fields';

interface SubtaskChecklistProps {
  taskId: string;
  subtasks: Subtask[];
  access: Pick<TaskAccess, 'addSubtasks' | 'manageSubtasks' | 'tickSubtasks'>;
}

/**
 * The checklist under a task: one level, no nesting. Ticking is open to everyone who works the
 * task; adding, renaming and removing items is for managers (the database enforces the same).
 */
const SubtaskChecklist: React.FC<SubtaskChecklistProps> = ({ taskId, subtasks, access }) => {
  const add = useAddSubtask();
  const update = useUpdateSubtask();
  const remove = useDeleteSubtask();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const progress = subtaskProgress(subtasks);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = validateTaskTitle(title, 'subtask');
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    try {
      await add.mutateAsync({ taskId, title });
      setTitle('');
    } catch {
      // the hook already showed the error toast; keep the text
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label="Subtask progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <div className={cn('h-full rounded-full transition-[width]', progress.percent === 100 ? 'bg-status-rtd' : 'bg-brand-accent')} style={{ width: `${progress.percent}%` }} />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {progress.total === 0 ? (
            'No subtasks'
          ) : (
            <>
              <span>{`${progress.done}/${progress.total} done`}</span>
              {progress.done < progress.total && <span>{` · ${progress.total - progress.done} left`}</span>}
            </>
          )}
        </span>
      </div>

      {subtasks.length > 0 && (
        <ul className="space-y-1" aria-label="Subtasks">
          {subtasks.map((subtask) => (
            <li key={subtask.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
              <Checkbox
                checked={subtask.isCompleted}
                disabled={!access.tickSubtasks}
                aria-label={`${subtask.isCompleted ? 'Mark not done' : 'Mark done'}: ${subtask.title}`}
                onCheckedChange={(checked) =>
                  update.mutate({ taskId, subtaskId: subtask.id, patch: { isCompleted: checked === true } })
                }
              />
              {access.manageSubtasks ? (
                <InlineText
                  label={`Subtask title: ${subtask.title}`}
                  hideLabel
                  value={subtask.title}
                  validate={(v) => validateTaskTitle(v, 'subtask')}
                  onCommit={(v) => update.mutate({ taskId, subtaskId: subtask.id, patch: { title: v } })}
                  className="min-w-0 flex-1"
                  inputClassName={cn(
                    'h-8 border-transparent bg-transparent shadow-none hover:border-border focus-visible:border-input',
                    subtask.isCompleted && 'text-muted-foreground line-through'
                  )}
                />
              ) : (
                <span className={cn('min-w-0 flex-1 truncate text-sm', subtask.isCompleted && 'text-muted-foreground line-through')}>
                  {subtask.title}
                </span>
              )}
              {access.manageSubtasks && (
                <IconButton
                  aria-label={`Delete subtask: ${subtask.title}`}
                  icon={<X className="h-3.5 w-3.5" />}
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ taskId, subtaskId: subtask.id })}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {access.addSubtasks && (
        <form onSubmit={submit} noValidate>
          <div className="flex items-center gap-2">
            <Plus aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
            <label htmlFor={`add-subtask-${taskId}`} className="sr-only">
              Add a subtask
            </label>
            <Input
              id={`add-subtask-${taskId}`}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Add a subtask and press Enter"
              disabled={add.isPending}
              aria-invalid={!!error}
              aria-describedby={error ? `add-subtask-${taskId}-error` : undefined}
              className="h-8 text-sm"
            />
            {add.isPending && <Loader2 aria-label="Adding" className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          {error && (
            <p id={`add-subtask-${taskId}-error`} role="alert" className="mt-1 pl-6 text-xs text-destructive">
              {error}
            </p>
          )}
        </form>
      )}

      {subtasks.length === 0 && !access.addSubtasks && (
        <p className="text-xs text-muted-foreground">No subtasks on this task.</p>
      )}
    </div>
  );
};

export default SubtaskChecklist;
