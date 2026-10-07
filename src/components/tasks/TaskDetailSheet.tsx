import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  FileVideo,
  HardDrive,
  Lock,
  MonitorPlay,
  MoreHorizontal,
  PackageCheck,
  SearchX,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { TaskPatch } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { useSaveIndicator } from '@/hooks/use-save-indicator';
import { useListTasks, useSetAssignee, useTask, useUpdateTask } from '@/hooks/use-tasks';
import { useWorkspaceMembers } from '@/hooks/use-team';
import { hierarchyPaths, isUuid } from '@/lib/hierarchy';
import {
  ASPECT_RATIOS,
  LINK_FIELDS,
  deadlineWarning,
  readOnlyReason,
  taskAccess,
  validateTaskDescription,
  validateTaskTitle,
  type LinkField,
} from '@/lib/tasks';
import { isFinishedStatus } from '@/lib/workflow';
import { useWorkflow } from '@/hooks/use-workflow';
import type { AspectRatio, AssigneeRole, HierarchyFolder, HierarchyList, HierarchySpace, TaskPriority } from '@/types/database';
import BriefEditor from './BriefEditor';
import DatePicker, { DateValue } from './DatePicker';
import DeleteTaskDialog from './DeleteTaskDialog';
import LinkRow from './LinkRow';
import PersonPicker, { PersonValue } from './PersonPicker';
import PropertyRow from './PropertyRow';
import SaveIndicator from './SaveIndicator';
import SubtaskChecklist from './SubtaskChecklist';
import { InlineText } from './fields';
import { PriorityControl } from './TaskControls';
import TaskWorkflowPanel from './TaskWorkflowPanel';
import WorkflowPicker from './WorkflowPicker';
import { GHOST_SELECT_TRIGGER, STATIC_VALUE } from './task-styles';

const NO_RATIO = '__none__';

interface TaskDetailSheetProps {
  taskId: string;
  space: HierarchySpace;
  folder: HierarchyFolder | null;
  list: HierarchyList;
  /** The order the list shows tasks in right now (filters, sort, groups), for previous / next. */
  orderedIds?: readonly string[];
  onClose: () => void;
}

const LINK_ICONS: Record<LinkField, React.ReactNode> = {
  rawFootageLink: <HardDrive className="h-4 w-4" />,
  projectFileLink: <FileVideo className="h-4 w-4" />,
  reviewLink: <MonitorPlay className="h-4 w-4" />,
  finalExportLink: <PackageCheck className="h-4 w-4" />,
};

const LINK_HINTS: Record<LinkField, string> = {
  rawFootageLink: 'Add the Google Drive footage folder',
  projectFileLink: 'Add the Premiere / project file',
  reviewLink: 'Add the Frame.io or Vimeo review link',
  finalExportLink: 'Add the final deliverable',
};

const Section: React.FC<{ title: string; aside?: React.ReactNode; children: React.ReactNode }> = ({ title, aside, children }) => (
  <section aria-label={title} className="space-y-2.5">
    <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {aside}
    </div>
    {children}
  </section>
);

/**
 * The task as a side sheet over its list (the URL is /spaces/:s/lists/:l/tasks/:t, so it is
 * linkable and Back closes it). Everything a person may change is edited in place and saved as they
 * go; everything they may not change is plain text, never a control that looks editable and then
 * fails. The database (RLS + guard triggers) is still the only real enforcement.
 *
 * Extension point: comments, attachments, activity and QC history (later phases) are added as
 * further <Section>s below the checklist, or as tabs around the body, without touching the fields
 * above them. Nothing is simulated for them here.
 */
const TaskDetailSheet: React.FC<TaskDetailSheetProps> = ({ taskId, space, folder, list, orderedIds: visibleOrder, onClose }) => {
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const malformed = !isUuid(taskId);
  const { data: task, isLoading, isError, error, refetch } = useTask(malformed ? undefined : taskId);
  const { data: members = [] } = useWorkspaceMembers();
  const siblings = useListTasks(list.id);
  const update = useUpdateTask();
  const setAssignee = useSetAssignee();
  const { state: saveState, track } = useSaveIndicator();
  const workflow = useWorkflow().data;
  const [deleting, setDeleting] = useState(false);

  // A task id from the URL that belongs to a different list is treated as "not found".
  const mismatched = !!task && task.listId !== list.id;
  const missing = malformed || (isError && (error as { code?: string } | null)?.code === 'NOT_FOUND') || mismatched;
  const access =
    task && !mismatched
      ? taskAccess(role, { isAssignedEditor: !!user && task.editorId === user.id })
      : null;

  // Previous / next task in the list's own order, from the page the list already loaded.
  const loadedIds = useMemo(() => siblings.data?.pages.flatMap((p) => p.items.map((t) => t.id)) ?? [], [siblings.data]);
  // follow what the list shows (filtered / sorted / grouped) when the task is in it, else the list's own order
  const orderedIds = visibleOrder && visibleOrder.includes(taskId) ? visibleOrder : loadedIds;
  const index = orderedIds.indexOf(taskId);
  const total = orderedIds === loadedIds ? siblings.data?.pages[0]?.total ?? loadedIds.length : orderedIds.length;
  const goTo = (id: string | undefined) => {
    if (id) navigate(hierarchyPaths.task(space.id, list.id, id), { replace: true });
  };

  const save = (patch: TaskPatch) => track(update.mutateAsync({ taskId, patch }));
  const saveQuietly = (patch: TaskPatch) => void save(patch).catch(() => undefined);
  const assign = (slot: AssigneeRole, userId: string | null) =>
    void track(setAssignee.mutateAsync({ taskId, role: slot, userId })).catch(() => undefined);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${hierarchyPaths.taskById(taskId)}`);
      toast.success('Task link copied');
    } catch {
      toast.error('The link could not be copied.');
    }
  };

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
    const finished = isFinishedStatus(workflow, task.status);
    const warning = deadlineWarning(task.dueDate, task.clientDeadline);
    const reason = readOnlyReason(role, access);
    const creator = task.createdBy ? members.find((m) => m.userId === task.createdBy)?.profile?.fullName ?? 'a former member' : null;
    const ratio = ASPECT_RATIOS.find((a) => a.value === task.aspectRatio);

    body = (
      <>
        <SheetHeader className="space-y-1.5 border-b border-border/70 px-5 pb-2.5 pt-4 text-left">
          <div className="flex items-center gap-1 pr-8">
            <IconButton
              aria-label="Previous task"
              icon={<ChevronUp className="h-4 w-4" />}
              variant="ghost"
              size="sm"
              className="h-8 w-8"
              disabled={index <= 0}
              onClick={() => goTo(orderedIds[index - 1])}
            />
            <IconButton
              aria-label="Next task"
              icon={<ChevronDown className="h-4 w-4" />}
              variant="ghost"
              size="sm"
              className="h-8 w-8"
              disabled={index < 0 || index >= orderedIds.length - 1}
              onClick={() => goTo(orderedIds[index + 1])}
            />
            {index >= 0 && (
              <span className="mr-2 text-[11px] tabular-nums text-muted-foreground" aria-label={`Task ${index + 1} of ${total}`}>
                {index + 1} / {total}
              </span>
            )}
            <nav aria-label="Task location" className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-muted-foreground">
              <Link to={hierarchyPaths.space(space.id)} className="hidden max-w-[28%] shrink truncate hover:text-foreground hover:underline sm:inline">
                {space.name}
              </Link>
              <ChevronRight aria-hidden className="hidden h-3 w-3 shrink-0 sm:block" />
              {folder && (
                <>
                  <Link to={hierarchyPaths.folder(space.id, folder.id)} className="hidden max-w-[28%] shrink truncate hover:text-foreground hover:underline sm:inline">
                    {folder.name}
                  </Link>
                  <ChevronRight aria-hidden className="hidden h-3 w-3 shrink-0 sm:block" />
                </>
              )}
              <Link to={hierarchyPaths.list(space.id, list.id)} className="min-w-0 truncate font-medium text-foreground hover:underline">
                {list.name}
              </Link>
            </nav>
            <IconButton
              aria-label="Copy task link"
              icon={<Copy className="h-4 w-4" />}
              variant="ghost"
              size="sm"
              className="h-8 w-8 shrink-0"
              onClick={() => void copyLink()}
            />
            {access.delete && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label="More task actions"
                    icon={<MoreHorizontal className="h-4 w-4" />}
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 shrink-0"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    className="cursor-pointer text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
                    onSelect={() => setDeleting(true)}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Delete task
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

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
            inputClassName="-mx-2 w-[calc(100%+1rem)] rounded-md border-transparent bg-transparent px-2 py-1 text-xl font-semibold leading-snug tracking-tight shadow-none hover:bg-muted/60 focus-visible:border-input focus-visible:bg-background disabled:cursor-default disabled:opacity-100 disabled:hover:bg-transparent"
          />
          <SaveIndicator state={saveState} className="-mt-0.5" />
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5">
          {reason && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground" role="note">
              <Lock aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {reason}
            </p>
          )}

          <TaskWorkflowPanel task={task} members={members} />

          <Section title="Overview">
            <div className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
              <PropertyRow label="Status">
                <WorkflowPicker variant="field" task={task} members={members} />
              </PropertyRow>

              <PropertyRow label="Priority">
                <PriorityControl
                  variant="field"
                  priority={task.priority}
                  editable={access.editBrief}
                  onChange={(priority: TaskPriority) => saveQuietly({ priority })}
                />
              </PropertyRow>

              <PropertyRow label="Editor" htmlFor="task-editor">
                {access.assign ? (
                  <PersonPicker
                    id="task-editor"
                    slot="EDITOR"
                    label="Editor"
                    variant="ghost"
                    value={task.editorId}
                    members={members}
                    otherSlotUserId={task.qcId}
                    disabled={setAssignee.isPending}
                    onChange={(id) => assign('EDITOR', id)}
                  />
                ) : (
                  <PersonValue userId={task.editorId} members={members} />
                )}
              </PropertyRow>

              <PropertyRow label="QC reviewer" htmlFor="task-qc">
                {access.assign ? (
                  <PersonPicker
                    id="task-qc"
                    slot="QC_REVIEWER"
                    label="QC reviewer"
                    variant="ghost"
                    value={task.qcId}
                    members={members}
                    otherSlotUserId={task.editorId}
                    disabled={setAssignee.isPending}
                    onChange={(id) => assign('QC_REVIEWER', id)}
                  />
                ) : (
                  <PersonValue userId={task.qcId} members={members} />
                )}
              </PropertyRow>

              <PropertyRow label="Internal QC due" htmlFor="task-due">
                {access.editBrief ? (
                  <DatePicker id="task-due" label="Internal QC due" value={task.dueDate} finished={finished} onChange={(iso) => saveQuietly({ dueDate: iso })} />
                ) : (
                  <DateValue label="Internal QC due" value={task.dueDate} finished={finished} />
                )}
              </PropertyRow>

              <PropertyRow label="Client deadline" htmlFor="task-client">
                {access.editBrief ? (
                  <DatePicker
                    id="task-client"
                    label="Client deadline"
                    value={task.clientDeadline}
                    finished={finished}
                    onChange={(iso) => saveQuietly({ clientDeadline: iso })}
                  />
                ) : (
                  <DateValue label="Client deadline" value={task.clientDeadline} finished={finished} />
                )}
              </PropertyRow>

              <PropertyRow label="Aspect ratio" htmlFor="task-ratio">
                {access.editBrief ? (
                  <Select
                    value={task.aspectRatio ?? NO_RATIO}
                    onValueChange={(v) => saveQuietly({ aspectRatio: v === NO_RATIO ? null : (v as AspectRatio) })}
                  >
                    <SelectTrigger id="task-ratio" aria-label="Aspect ratio" className={GHOST_SELECT_TRIGGER}>
                      <SelectValue>
                        {ratio ? ratio.label : <span className="text-muted-foreground">Not set</span>}
                      </SelectValue>
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
                ) : (
                  <div className={STATIC_VALUE}>{ratio ? ratio.label : <span className="text-muted-foreground">Not set</span>}</div>
                )}
              </PropertyRow>
            </div>
            {warning && (
              <p className="text-xs text-muted-foreground" role="status">
                {warning}
              </p>
            )}
          </Section>

          <Section title="Production links">
            <div className="divide-y divide-border/50">
              {LINK_FIELDS.map(({ key, label }) => (
                <LinkRow
                  key={key}
                  icon={LINK_ICONS[key]}
                  label={label}
                  hint={LINK_HINTS[key]}
                  value={task[key] ?? ''}
                  editable={
                    key === 'reviewLink' || key === 'projectFileLink'
                      ? access.editWorkLinks
                      : key === 'finalExportLink'
                        ? access.editFinalExport
                        : access.editBrief
                  }
                  onCommit={(v) => save({ [key]: v })}
                />
              ))}
            </div>
          </Section>

          <Section title="Brief">
            <BriefEditor
              label="Task brief"
              value={task.description ?? ''}
              readOnly={!access.editBrief}
              validate={validateTaskDescription}
              onCommit={(v) => save({ description: v })}
            />
          </Section>

          <Section title="Subtasks">
            <SubtaskChecklist taskId={task.id} subtasks={task.subtasks} access={access} />
          </Section>

          <footer className="border-t border-border/70 pt-4 text-[11px] text-muted-foreground">
            Created {new Date(task.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
            {creator ? ` by ${creator}` : ''}. Last updated{' '}
            {new Date(task.updatedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.
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
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[640px] lg:max-w-[720px]"
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
