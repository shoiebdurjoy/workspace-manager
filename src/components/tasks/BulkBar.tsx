import React from 'react';
import { ChevronDown, Flag, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TASK_PRIORITIES, TASK_STATUSES, type TaskAccess } from '@/lib/tasks';
import type { AssigneeRole, TaskPriority, TaskStatus, TaskSummary, WorkspaceMember } from '@/types/database';
import type { BulkAction } from '@/hooks/use-tasks';
import ChoicePicker from './ChoicePicker';
import PersonPicker from './PersonPicker';
import { PriorityFlag, TaskStatusPill } from './TaskBadges';

interface BulkBarProps {
  selected: TaskSummary[];
  accessOf: (task: TaskSummary) => TaskAccess;
  members: readonly WorkspaceMember[];
  busy: boolean;
  /** Runs `action` on exactly these tasks (the ones this person may change that way). */
  onRun: (taskIds: string[], action: BulkAction, skipped: number) => void;
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
 * it for this person, and is applied only to the tasks that do (the rest are reported as skipped);
 * the database checks every write again.
 */
const BulkBar: React.FC<BulkBarProps> = ({ selected, accessOf, members, busy, onRun, onDelete, onClear }) => {
  const ids = (pred: (a: TaskAccess, t: TaskSummary) => boolean) => selected.filter((t) => pred(accessOf(t), t)).map((t) => t.id);
  const anyStatus = selected.some((t) => accessOf(t).statusOptions.length > 0);
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
          label="Set status for selected tasks"
          value={'__none__' as TaskStatus}
          searchable
          disabled={busy}
          choices={TASK_STATUSES.map((s) => ({ value: s.value, label: s.label, render: <TaskStatusPill status={s.value} className="border-0 bg-transparent px-0" /> }))}
          onChange={(status) => {
            const ok = ids((a) => a.statusOptions.includes(status));
            onRun(ok, { kind: 'patch', patch: { status } }, n - ok.length);
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
    </div>
  );
};

export default BulkBar;
