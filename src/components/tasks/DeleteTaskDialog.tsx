import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useDeleteTask } from '@/hooks/use-tasks';

interface Props {
  task: { id: string; title: string };
  /** Mentioned in the warning so nobody is surprised by what goes with the task. */
  subtaskCount?: number;
  onClose: () => void;
  onDeleted: () => void;
}

/** Deleting a task is permanent, so it always asks first and says what goes with it. */
const DeleteTaskDialog: React.FC<Props> = ({ task, subtaskCount = 0, onClose, onDeleted }) => {
  const remove = useDeleteTask();

  const confirm = async (e: React.MouseEvent) => {
    // Keep the dialog open while the request runs; close it from the outcome.
    e.preventDefault();
    try {
      await remove.mutateAsync(task.id);
      onDeleted();
    } catch {
      // the mutation hook already showed the error toast; keep the dialog open to retry or cancel
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && !remove.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete task "{task.title}"?</AlertDialogTitle>
          <AlertDialogDescription>
            {subtaskCount > 0
              ? `The task, its assignments and its ${subtaskCount} ${subtaskCount === 1 ? 'subtask' : 'subtasks'} will be permanently deleted. This cannot be undone.`
              : 'The task and its assignments will be permanently deleted. This cannot be undone.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={remove.isPending}
            onClick={(e) => void confirm(e)}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {remove.isPending ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteTaskDialog;
