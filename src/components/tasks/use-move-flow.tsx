import React, { useState } from 'react';
import { useSetAssignee } from '@/hooks/use-tasks';
import { useTransitionTask } from '@/hooks/use-workflow';
import type { Move } from '@/lib/workflow';
import type { TaskSummary, WorkspaceMember } from '@/types/database';
import TransitionDialog, { type TransitionValues } from './TransitionDialog';

/** What a workflow control needs to know about the task. */
export type WorkflowTaskRef = Pick<TaskSummary, 'id' | 'status' | 'editorId' | 'qcId' | 'reviewLink' | 'finalExportLink' | 'revisionCount'>;

/**
 * Starting a move: straight away when the next stage needs nothing, otherwise through the dialog
 * that asks for it. One flow for the picker, the detail panel's action buttons and anything else.
 */
export function useMoveFlow(task: WorkflowTaskRef | null | undefined, members: readonly WorkspaceMember[] = []) {
  const transition = useTransitionTask();
  const setAssignee = useSetAssignee();
  const [asking, setAsking] = useState<Move | null>(null);
  const pending = transition.isPending || setAssignee.isPending;

  const run = async (move: Move, values: TransitionValues) => {
    if (!task) return;
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
      setAsking(null);
    } catch {
      // the hooks already said what went wrong and put the task back; keep the dialog so nothing typed is lost
    }
  };

  const start = (move: Move) => {
    if (!move.allowed || pending) return;
    if (move.needs.length) setAsking(move);
    else void run(move, {});
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
        onConfirm={(values) => void run(asking, values)}
      />
    ) : null;

  return { start, dialog, pending };
}
