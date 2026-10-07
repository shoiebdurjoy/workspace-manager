import React, { useRef, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useCreateTask } from '@/hooks/use-tasks';
import { useTransitionTask } from '@/hooks/use-workflow';
import { validateTaskTitle } from '@/lib/tasks';
import type { TaskGroup } from '@/lib/task-view';
import type { TaskPriority } from '@/types/database';

/** Title-only entry. Inside a group the new task gets the group's status / priority / editor. */
export const QuickAdd: React.FC<{
  listId: string;
  group?: TaskGroup;
  inputRef?: React.Ref<HTMLInputElement>;
  autoFocus?: boolean;
  onDone?: () => void;
}> = ({ listId, group, inputRef, autoFocus, onDone }) => {
  const create = useCreateTask();
  const transition = useTransitionTask();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const localRef = useRef<HTMLInputElement>(null);
  const label = group && group.kind !== 'none' ? `Add a task to ${group.label}` : 'Add a task';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = validateTaskTitle(title);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    try {
      const task = await create.mutateAsync({
        listId,
        title,
        ...(group?.kind === 'priority' && group.value ? { priority: group.value as TaskPriority } : {}),
        ...(group?.kind === 'editor' && group.value ? { editorId: group.value } : {}),
      });
      // tasks start at the workflow's first stage; quick add is only offered in groups a new task can reach (addableIn)
      if (group?.kind === 'status' && group.value && group.value !== task.status) {
        await transition.mutateAsync({ taskId: task.id, input: { to: group.value, expectedFrom: task.status } });
      }
      setTitle('');
      localRef.current?.focus();
    } catch {
      // the hook already showed the error toast; keep the text so nothing is lost
    }
  };

  const id = `quick-add-${group?.key ?? 'list'}`;
  return (
    <form onSubmit={submit} noValidate className="px-2 py-1.5">
      <div className="flex items-center gap-2 pl-7">
        <Plus aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <input
          id={id}
          ref={(el) => {
            (localRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
            if (typeof inputRef === 'function') inputRef(el);
            else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
          }}
          value={title}
          autoFocus={autoFocus}
          onChange={(e) => {
            setTitle(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setTitle('');
              e.currentTarget.blur();
              onDone?.();
            }
          }}
          onBlur={() => !title && onDone?.()}
          placeholder={group && group.kind !== 'none' ? `${label} and press Enter` : 'Add a task and press Enter'}
          disabled={create.isPending}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {create.isPending && <Loader2 aria-label="Adding" className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 pl-[3.25rem] text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
};

export default QuickAdd;
