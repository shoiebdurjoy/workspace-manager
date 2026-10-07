import React, { useState } from 'react';
import { useSetAssignee } from '@/hooks/use-tasks';
import { useTransitionTask } from '@/hooks/use-workflow';
import type { Move } from '@/lib/workflow';
import type { TaskSummary, WorkspaceMember } from '@/types/database';
import TransitionDialog, { type TransitionValues } from './TransitionDialog';

/** What a workflow control needs to know about the task. */
export type WorkflowTaskRef = Pick<TaskSummary, 'id' | 'status' | 'editorId' | 'qcId' | 'reviewLink' | 'finalExportLink' | 'revisionCount'>;

/**
 * Runs a workflow move for any task: first assigns the editor when the move asked for one, then moves
 * the task in one atomic call from the stage the person saw. Resolves true when the move was applied;
 * on a refusal the hooks have already explained why and put the task back. One runner for the stage
 * picker, the detail panel, the board's drag and drop and the table.
 */
export function useMoveRunner() {
  const transition = useTransitionTask();
  const setAssignee = useSetAssignee();
  const pending = transition.isPending || setAssignee.isPending;

  const run = async (task: WorkflowTaskRef, move: Move, values: TransitionValues = {}): Promise<boolean> => {
    try {
      if (values.editorId) await setAssignee.mutateAsync({ taskId: task.id, role: 'EDITOR', userId: values.editorId });
      await transition.mutateAsync({
        taskId: task.id,
        input: {
          to: move.to.key,
          note: values.note,
          reviewLink: values.reviewLink,
          finalExportLink: values.finalExportLink,
          expectedFrom: task.status,
        },
      });
      return true;
    } catch {
      return false;
    }
  };
  return { run, pending };
}

/**
 * Starting a move: straight away when the next stage needs nothing, otherwise through the dialog
 * that asks for it. One flow for the picker, the detail panel's action buttons and anything else.
 */
export function useMoveFlow(task: WorkflowTaskRef | null | undefined, members: readonly WorkspaceMember[] = []) {
  const { run, pending } = useMoveRunner();
  const [asking, setAsking] = useState<Move | null>(null);

  const start = (move: Move) => {
    if (!task || !move.allowed || pending) return;
    if (move.needs.length) setAsking(move);
    else void run(task, move);
  };

  const dialog =
    asking && task ? (
      <TransitionDialog
        title={asking.label}
        to={asking.to.key}
        needs={asking.needs}
        members={members}
        qcId={task.qcId}
        override={asking.override}
        pending={pending}
        onCancel={() => setAsking(null)}
        onConfirm={(values) =>
          void run(task, asking, values).then((ok) => {
            // keep the dialog on a refusal so nothing typed is lost
            if (ok) setAsking(null);
          })
        }
      />
    ) : null;

  return { start, dialog, pending };
}
