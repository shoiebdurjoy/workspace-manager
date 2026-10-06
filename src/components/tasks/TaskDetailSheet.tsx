import React, { useMemo, useState } from 'react';
import { ExternalLink, Loader2, SearchX, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { TaskPatch } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { useSetAssignee, useTask, useUpdateTask } from '@/hooks/use-tasks';
import { useWorkspaceMembers } from '@/hooks/use-team';
import { isUuid } from '@/lib/hierarchy';
import {
  ASPECT_RATIOS,
  LINK_FIELDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  dateInputToIso,
  deadlineWarning,
  isValidTaskUrl,
  isoToDateInput,
  linkHost,
  memberLookup,
  memberName,
  readOnlyReason,
  statusOption,
  taskAccess,
  validateTaskDescription,
  validateTaskTitle,
  validateTaskUrl,
} from '@/lib/tasks';
import type { AspectRatio, AssigneeRole, HierarchyList, TaskPriority, TaskStatus } from '@/types/database';
import AssigneeSelect from './AssigneeSelect';
import DeleteTaskDialog from './DeleteTaskDialog';
import SubtaskChecklist from './SubtaskChecklist';
import { Field, InlineText, InlineTextarea } from './fields';
import { PriorityFlag, TaskStatusPill } from './TaskBadges';

const NO_RATIO = '__none__';

interface TaskDetailSheetProps {
  taskId: string;
  list: HierarchyList;
  onClose: () => void;
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section aria-label={title} className="space-y-3">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
    {children}
  </section>
);

/**
 * The task as a side sheet over its list (the URL is /spaces/:s/lists/:l/tasks/:t, so it is
 * linkable and the Back button closes it). Sections are independent blocks on purpose: comments,
 * attachments, activity and QC history (later phases) are added as further sections or tabs
 * without touching the fields below.
 */
const TaskDetailSheet: React.FC<TaskDetailSheetProps> = ({ taskId, list, onClose }) => {
  const { user, role } = useAuth();
  const malformed = !isUuid(taskId);
  const { data: task, isLoading, isError, error, refetch } = useTask(malformed ? undefined : taskId);
  const { data: members = [] } = useWorkspaceMembers();
  const update = useUpdateTask();
  const setAssignee = useSetAssignee();
  const [deleting, setDeleting] = useState(false);
  const lookup = useMemo(() => memberLookup(members), [members]);

  // A task id from the URL that belongs to a different list is treated as "not found".
  const mismatched = !!task && task.listId !== list.id;
  const missing = malformed || (isError && (error as { code?: string } | null)?.code === 'NOT_FOUND') || mismatched;
  const access = task && !mismatched
    ? taskAccess(role, { isAssignedEditor: !!user && task.editorId === user.id, currentStatus: task.status })
    : null;
  const busy = update.isPending || setAssignee.isPending;

  const save = (patch: TaskPatch) => update.mutateAsync({ taskId, patch });
  const assign = (slot: AssigneeRole, userId: string | null) => setAssignee.mutate({ taskId, role: slot, userId });

  let body: React.ReactNode;
  if (isLoading && !malformed) {
    body = (
      <div className="space-y-4 p-5" role="status" aria-label="Loading task">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  } else if (missing) {
    body = (
      <div className="px-5 py-12 text-center" role="alert">
        <SearchX className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h2 className="text-base font-semibold">Task not found</h2>
        <p className="mt-1 text-sm text-muted-foreground">It may have been deleted, or you may not have access to it.</p>
        <Button className="mt-4" variant="outline" onClick={onClose}>
          Back to {list.name}
        </Button>
      </div>
    );
  } else if (isError || !task || !access) {
    body = (
      <div className="p-5">
        <ErrorState
          title="The task could not be loaded"
          message={error instanceof Error ? error.message : 'Please try again.'}
          onRetry={() => void refetch()}
        />
      </div>
    );
  } else {
    const warning = deadlineWarning(task.dueDate, task.clientDeadline);
    const reason = readOnlyReason(role, access);
    const statusChoices = TASK_STATUSES.filter((s) => access.statusOptions.includes(s.value) || s.value === task.status);
    const creator = task.createdBy ? memberName(lookup, task.createdBy) : null;

    body = (
      <>
        <SheetHeader className="space-y-1.5 border-b border-border/70 px-5 pb-3 pt-5 text-left">
          <p className="truncate pr-8 text-[11px] text-muted-foreground">{list.name}</p>
          <SheetTitle className="sr-only">{task.title}</SheetTitle>
          <SheetDescription className="sr-only">Task details for {task.title}</SheetDescription>
          <InlineText
            label="Task title"
            hideLabel
            value={task.title}
            disabled={!access.editBrief}
            validate={(v) => validateTaskTitle(v)}
            onCommit={(v) => save({ title: v })}
            wrap
            inputClassName="border-transparent bg-transparent px-2 text-lg font-semibold leading-snug tracking-tight shadow-none hover:border-border focus-visible:border-input disabled:opacity-100"
          />
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground" aria-live="polite">
            {busy ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Saving...
              </>
            ) : (
              <span>Changes save as you go</span>
            )}
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {reason && (
            <p className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground" role="note">
              {reason}
            </p>
          )}

          <Section title="Overview">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status" htmlFor="task-status">
                {access.statusOptions.length > 0 ? (
                  <Select value={task.status} onValueChange={(v) => void save({ status: v as TaskStatus }).catch(() => undefined)}>
                    <SelectTrigger id="task-status" aria-label="Status" className="h-9 text-sm">
                      <SelectValue>{statusOption(task.status).label}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {statusChoices.map((s) => (
                        <SelectItem key={s.value} value={s.value} disabled={!access.statusOptions.includes(s.value)}>
                          <TaskStatusPill status={s.value} className="border-0 bg-transparent px-0" />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex h-9 items-center">
                    <TaskStatusPill status={task.status} />
                  </div>
                )}
              </Field>

              <Field label="Priority" htmlFor="task-priority">
                {access.editBrief ? (
                  <Select value={task.priority} onValueChange={(v) => void save({ priority: v as TaskPriority }).catch(() => undefined)}>
                    <SelectTrigger id="task-priority" aria-label="Priority" className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_PRIORITIES.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex h-9 items-center">
                    <PriorityFlag priority={task.priority} withLabel />
                  </div>
                )}
              </Field>

              <Field label="Editor" htmlFor="task-editor">
                <AssigneeSelect
                  id="task-editor"
                  slot="EDITOR"
                  label="Editor"
                  value={task.editorId}
                  members={members}
                  otherSlotUserId={task.qcId}
                  disabled={!access.assign || setAssignee.isPending}
                  onChange={(id) => assign('EDITOR', id)}
                />
              </Field>

              <Field label="QC reviewer" htmlFor="task-qc">
                <AssigneeSelect
                  id="task-qc"
                  slot="QC_REVIEWER"
                  label="QC reviewer"
                  value={task.qcId}
                  members={members}
                  otherSlotUserId={task.editorId}
                  disabled={!access.assign || setAssignee.isPending}
                  onChange={(id) => assign('QC_REVIEWER', id)}
                />
              </Field>

              <Field label="Internal QC due" htmlFor="task-due">
                <Input
                  id="task-due"
                  type="date"
                  value={isoToDateInput(task.dueDate)}
                  disabled={!access.editBrief}
                  onChange={(e) => void save({ dueDate: dateInputToIso(e.target.value) }).catch(() => undefined)}
                  className="h-9 text-sm"
                />
              </Field>

              <Field label="Client deadline" htmlFor="task-client">
                <Input
                  id="task-client"
                  type="date"
                  value={isoToDateInput(task.clientDeadline)}
                  disabled={!access.editBrief}
                  onChange={(e) => void save({ clientDeadline: dateInputToIso(e.target.value) }).catch(() => undefined)}
                  className="h-9 text-sm"
                />
              </Field>

              <Field label="Aspect ratio" htmlFor="task-ratio">
                <Select
                  value={task.aspectRatio ?? NO_RATIO}
                  disabled={!access.editBrief}
                  onValueChange={(v) => void save({ aspectRatio: v === NO_RATIO ? null : (v as AspectRatio) }).catch(() => undefined)}
                >
                  <SelectTrigger id="task-ratio" aria-label="Aspect ratio" className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_RATIO}>Not set</SelectItem>
                    {ASPECT_RATIOS.map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {warning && (
              <p className="text-xs text-muted-foreground" role="status">
                {warning}
              </p>
            )}
          </Section>

          <Section title="Links">
            <div className="space-y-3">
              {LINK_FIELDS.map(({ key, label, placeholder }) => {
                const value = task[key] ?? '';
                const editable = key === 'reviewLink' || key === 'projectFileLink' ? access.editWorkLinks : access.editBrief;
                const host = linkHost(value);
                return (
                  <div key={key} className="flex items-end gap-2">
                    <InlineText
                      label={label}
                      type="url"
                      value={value}
                      disabled={!editable}
                      placeholder={placeholder}
                      validate={validateTaskUrl}
                      onCommit={(v) => save({ [key]: v })}
                      className="min-w-0 flex-1"
                    />
                    {value && isValidTaskUrl(value) ? (
                      <Button asChild variant="outline" size="sm" className="mb-px h-9 shrink-0">
                        <a href={value} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label}${host ? ` (${host})` : ''}`}>
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                          Open
                        </a>
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title="Brief">
            <InlineTextarea
              label="Task brief"
              value={task.description ?? ''}
              disabled={!access.editBrief}
              placeholder="What needs to be edited, references, notes for the editor"
              validate={validateTaskDescription}
              onCommit={(v) => save({ description: v })}
            />
          </Section>

          <Section title="Subtasks">
            <SubtaskChecklist taskId={task.id} subtasks={task.subtasks} access={access} />
          </Section>

          <footer className="space-y-3 border-t border-border/70 pt-4">
            <p className="text-[11px] text-muted-foreground">
              Created {new Date(task.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
              {creator ? ` by ${creator}` : ''}. Last updated{' '}
              {new Date(task.updatedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.
            </p>
            {access.delete && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setDeleting(true)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete task
              </Button>
            )}
          </footer>
        </div>

        {deleting && (
          <DeleteTaskDialog
            task={{ id: task.id, title: task.title }}
            subtaskCount={task.subtasks.length}
            onClose={() => setDeleting(false)}
            onDeleted={() => {
              setDeleting(false);
              onClose();
            }}
          />
        )}
      </>
    );
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
        // Focus the panel itself (not the close button), so no stray ring appears and a screen reader starts at the title.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
        // Escape inside an inline field cancels that edit first; the sheet closes on the next Escape.
        onEscapeKeyDown={(e) => {
          const active = document.activeElement;
          if (active instanceof HTMLElement && active.hasAttribute('data-inline-field')) e.preventDefault();
        }}
      >
        {(isLoading && !malformed) || missing || isError || !task ? (
          <SheetHeader className="sr-only">
            <SheetTitle>Task</SheetTitle>
            <SheetDescription>Task details</SheetDescription>
          </SheetHeader>
        ) : null}
        {body}
      </SheetContent>
    </Sheet>
  );
};

export default TaskDetailSheet;
