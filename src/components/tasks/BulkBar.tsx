import React, { useState } from 'react';
import { ChevronDown, Flag, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TASK_PRIORITIES, type TaskAccess } from '@/lib/tasks';
import { bulkVerdict, summarizeSkips } from '@/lib/workflow';
import { useAuth } from '@/hooks/use-auth';
import { useWorkflow } from '@/hooks/use-workflow';
import type { AssigneeRole, TaskPriority, TaskStatus, TaskSummary, WorkspaceMember } from '@/types/database';
import type { BulkAction } from '@/hooks/use-tasks';
import TransitionDialog from './TransitionDialog';
import ChoicePicker from './ChoicePicker';
import PersonPicker from './PersonPicker';
import { PriorityFlag, TaskStatusPill } from './TaskBadges';

interface BulkBarProps {
  selected: TaskSummary[];
  accessOf: (task: TaskSummary) => TaskAccess;
  members: readonly WorkspaceMember[];
  busy: boolean;
  /** Runs `action` on exactly these tasks (the ones this person may change that way); `why` explains the skipped ones. */
  onRun: (taskIds: string[], action: BulkAction, skipped: number, why?: string) => void;
  onDelete: (tasks: TaskSummary[]) => void;
  onClear: () => void;
}

const BarButton: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 px-2.5 text-xs hover:bg-muted">
    {children}
    <ChevronDown aria-hidden className="h-3 w-3 opacity-60" />
  </span>
);

/**
 * Appears when tasks are selected. Each action is offered only if at least one selected task allows
 * it for this person, and is applied only to the tasks that do (the rest are reported as skipped,
 * with the reason); the database checks every write again. A stage move goes through the workflow
 * one task at a time, exactly like a single move; a move that needs a link per task is not offered
 * in bulk, and a revision request asks once for the note all of them get.
 */
const BulkBar: React.FC<BulkBarProps> = ({ selected, accessOf, members, busy, onRun, onDelete, onClear }) => {
  const { role, user } = useAuth();
  const workflow = useWorkflow().data;
  const [asking, setAsking] = useState<{ to: TaskStatus; ok: string[]; why?: string } | null>(null);
  const ids = (pred: (a: TaskAccess, t: TaskSummary) => boolean) => selected.filter((t) => pred(accessOf(t), t)).map((t) => t.id);

  const verdicts = (workflow?.statuses ?? []).map((s) => {
    const results = selected.map((t) => ({
      id: t.id,
      v: bulkVerdict(workflow, t, { role, isAssignedEditor: !!user && t.editorId === user.id }, s.key),
    }));
    const ok = results.filter((r) => r.v.ok).map((r) => r.id);
    const reasons = results.flatMap((r) => (r.v.ok ? [] : [r.v.reason]));
    // a stage nobody selected can reach: one short reason when they all share it, else a plain summary
    const unique = [...new Set(reasons)];
    const blocked = unique.length === 1 ? unique[0].replace(/\.$/, '').replace(/^./, (c) => c.toUpperCase()) : 'Not a step for the selected tasks';
    return { status: s, ok, why: summarizeSkips(reasons), blocked };
  });
  const anyStatus = verdicts.some((v) => v.ok.length > 0);
  const moveTo = (to: TaskStatus, note?: string) => {
    const v = verdicts.find((x) => x.status.key === to);
    if (!v || v.ok.length === 0) return;
    onRun(
      v.ok,
      { kind: 'transition', to, note, countsRevision: v.status.countsRevision, label: `Moved to ${v.status.name}` },
      n - v.ok.length,
      v.why
    );
  };
  const editable = ids((a) => a.editBrief);
  const assignable = ids((a) => a.assign);
  const deletable = selected.filter((t) => accessOf(t).delete);
  const n = selected.length;

  const assign = (role: AssigneeRole, label: string) =>
    assignable.length > 0 && (
      <PersonPicker
        slot={role}
        label={`Set ${label.toLowerCase()} for selected tasks`}
        variant="ghost"
        value={null}
        members={members}
        otherSlotUserId={null}
        emptyText={label}
        disabled={busy}
        onChange={(userId) => onRun(assignable, { kind: 'assign', role, userId }, n - assignable.length)}
        className="h-8 w-auto rounded-md border border-border/70 px-2.5 text-xs"
      />
    );

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-xl border border-border bg-popover p-2 shadow-medium md:bottom-5"
    >
      <span className="px-2 text-sm font-semibold tabular-nums" aria-live="polite">
        {n} selected
      </span>
      {anyStatus && (
        <ChoicePicker<TaskStatus>
          label="Move selected tasks to a stage"
          value={'__none__' as TaskStatus}
          searchable
          heading="Move to"
          disabled={busy}
          choices={verdicts.map(({ status, ok, blocked }) => ({
            value: status.key,
            label: status.name,
            disabled: ok.length === 0,
            render: (
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <TaskStatusPill status={status.key} />
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {ok.length === n ? 'all' : `${ok.length} of ${n}`}
                  </span>
                </span>
                {ok.length === 0 && <span className="text-[11px] text-muted-foreground">{blocked}</span>}
              </span>
            ),
          }))}
          opensDialog={(to) => !!verdicts.find((x) => x.status.key === to)?.status.requiresNote}
          onChange={(to) => {
            const v = verdicts.find((x) => x.status.key === to);
            if (v?.status.requiresNote) setAsking({ to, ok: v.ok, why: v.why });
            else moveTo(to);
          }}
          trigger={<BarButton>Status</BarButton>}
        />
      )}
      {editable.length > 0 && (
        <ChoicePicker<TaskPriority>
          label="Set priority for selected tasks"
          value={'__none__' as TaskPriority}
          disabled={busy}
          choices={TASK_PRIORITIES.map((p) => ({ value: p.value, label: p.label, render: <PriorityFlag priority={p.value} withLabel /> }))}
          onChange={(priority) => onRun(editable, { kind: 'patch', patch: { priority } }, n - editable.length)}
          trigger={
            <BarButton>
              <Flag aria-hidden className="h-3 w-3" /> Priority
            </BarButton>
          }
        />
      )}
      {assign('EDITOR', 'Editor')}
      {assign('QC_REVIEWER', 'QC reviewer')}
      {deletable.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => onDelete(deletable)}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
        </Button>
      )}
      {!anyStatus && editable.length === 0 && assignable.length === 0 && deletable.length === 0 && (
        <span className="text-xs text-muted-foreground">Your role cannot change these tasks.</span>
      )}
      <Button variant="ghost" size="sm" className="ml-auto h-8 text-xs" onClick={onClear} aria-label="Clear selection">
        <X className="mr-1 h-3.5 w-3.5" /> Clear
      </Button>
      {asking && (
        <TransitionDialog
          title={`Request revision (${asking.ok.length})`}
          to={asking.to}
          needs={['note']}
          count={asking.ok.length}
          onCancel={() => setAsking(null)}
          onConfirm={({ note }) => {
            setAsking(null);
            moveTo(asking.to, note);
          }}
        />
      )}
    </div>
  );
};

export default BulkBar;
