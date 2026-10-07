import React from 'react';
import { ArrowRight, CornerUpLeft, Hourglass, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLatestRevisionRequest, useWorkflow } from '@/hooks/use-workflow';
import { formatDayLong, memberName } from '@/lib/tasks';
import { nextSteps, stageNumber, statusColor, statusOf, waitingOn } from '@/lib/workflow';
import type { WorkspaceMember } from '@/types/database';
import { RevisionTag, TaskStatusPill } from './TaskBadges';
import { useMoveFlow, type WorkflowTaskRef } from './use-move-flow';

const STEP_ICON = {
  forward: ArrowRight,
  reject: CornerUpLeft,
  back: Undo2,
} as const;

/**
 * The top of the task panel: where the task is in the workflow, the step(s) this person can take
 * now as buttons ("Submit for QC", "Request revision"), who it waits on otherwise, and, while a cut is
 * sent back, what QC asked to change. Only the latest request is shown; the full history is Phase 10.
 */
const TaskWorkflowPanel: React.FC<{ task: WorkflowTaskRef; members: readonly WorkspaceMember[] }> = ({ task, members }) => {
  const { role, user } = useAuth();
  const workflow = useWorkflow().data;
  const { start, dialog, pending } = useMoveFlow(task, members);
  const current = statusOf(workflow, task.status);
  const inRevision = !!current?.countsRevision;
  const revision = useLatestRevisionRequest(task.id, inRevision);

  if (!workflow || !current) return null;

  const steps = nextSteps(workflow, task, { role, isAssignedEditor: !!user && task.editorId === user.id });
  const stage = stageNumber(workflow, task.status);
  const waiting = steps.length === 0 ? waitingOn(workflow, task.status) : null;
  const lookup = new Map(members.map((m) => [m.userId, m]));
  const request = revision.data;

  return (
    <section
      aria-label="Workflow"
      className={cn(
        'space-y-3 rounded-xl border p-3',
        inRevision ? 'border-destructive/40 bg-destructive/5' : 'border-border/80 bg-muted/30'
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <TaskStatusPill status={task.status} />
        <RevisionTag count={task.revisionCount} />
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          Stage {stage} of {workflow.statuses.length}
        </span>
      </div>

      {/* progress through the stages: a cue, the pill above carries the name */}
      <ol aria-hidden className="flex gap-0.5">
        {workflow.statuses.map((s) => (
          <li
            key={s.key}
            title={s.name}
            className="h-1.5 flex-1 rounded-full bg-border"
            style={s.position <= current.position ? { backgroundColor: statusColor(workflow, task.status) } : undefined}
          />
        ))}
      </ol>

      {inRevision && (
        <div role="note" aria-label="Requested changes" className="rounded-lg border border-destructive/30 bg-background p-2.5 text-sm">
          <p className="text-xs font-semibold text-destructive">
            Revision {task.revisionCount} requested
            {request ? ` by ${request.actorId ? memberName(lookup, request.actorId) : 'someone'} on ${formatDayLong(request.createdAt)}` : ''}
          </p>
          {request?.note ? (
            <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{request.note}</p>
          ) : revision.isLoading ? (
            <p className="mt-1 text-xs text-muted-foreground">Loading the note...</p>
          ) : null}
        </div>
      )}

      {steps.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {steps.map((m, i) => {
            const kind = m.transition?.kind ?? 'forward';
            const Icon = STEP_ICON[kind];
            return (
              <Button
                key={m.to.key}
                size="sm"
                disabled={pending}
                variant={kind === 'reject' ? 'outline' : kind === 'back' ? 'ghost' : i === 0 ? 'default' : 'outline'}
                className={cn('h-8', kind === 'reject' && 'border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive')}
                onClick={() => start(m)}
              >
                <Icon aria-hidden className="mr-1.5 h-3.5 w-3.5" />
                {m.label}
              </Button>
            );
          })}
        </div>
      ) : waiting ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Hourglass aria-hidden className="h-3.5 w-3.5" /> Waiting on {waiting}
        </p>
      ) : null}
      {dialog}
    </section>
  );
};

export default TaskWorkflowPanel;
