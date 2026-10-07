import React, { memo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  FileVideo,
  HardDrive,
  ListChecks,
  MonitorPlay,
  MoreHorizontal,
  PackageCheck,
  PanelRightOpen,
  Pencil,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { IconButton } from '@/components/ui/icon-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { TaskPatch } from '@/database';
import { isValidTaskUrl, linkHost, progressOf, validateTaskTitle, type LinkField, type TaskAccess } from '@/lib/tasks';
import { isFinishedStatus, statusOf } from '@/lib/workflow';
import { useWorkflow } from '@/hooks/use-workflow';
import type { AssigneeRole, TaskPriority, TaskSummary, WorkspaceMember } from '@/types/database';
import DatePicker from './DatePicker';
import PersonPicker from './PersonPicker';
import RowSubtasks from './RowSubtasks';
import { DueLabel, RevisionTag } from './TaskBadges';
import { PriorityControl } from './TaskControls';
import WorkflowPicker from './WorkflowPicker';
import { InlineText } from './fields';

/**
 * One grid for the column header and every row, so columns line up. Below md a row becomes a
 * two-line card (title, then its properties) instead of a squeezed table.
 */
export const ROW_GRID =
  'md:grid md:grid-cols-[1.5rem_minmax(0,1fr)_9rem_4.25rem_4.5rem_4.5rem_2rem_2rem] md:items-center md:gap-x-2 ' +
  'xl:grid-cols-[1.5rem_minmax(0,1fr)_11rem_4.5rem_5.5rem_4.75rem_4.75rem_2rem_2rem]';
/** The Links column only exists from xl; on tablets (md) the link icons sit after the title; between lg and xl (sidebar open, tight) they live in the task panel only. */
export const LINKS_COLUMN = 'hidden xl:block';

const LINK_ICONS: Record<LinkField, React.ComponentType<{ className?: string }>> = {
  rawFootageLink: HardDrive,
  projectFileLink: FileVideo,
  reviewLink: MonitorPlay,
  finalExportLink: PackageCheck,
};
const LINK_LABELS: Record<LinkField, string> = {
  rawFootageLink: 'Raw footage',
  projectFileLink: 'Project file',
  reviewLink: 'Review link',
  finalExportLink: 'Final export',
};

/** The production links a row has, as one-click icons (only safe http(s) links are ever linked). */
const RowLinks: React.FC<{ task: TaskSummary; compact?: boolean }> = ({ task, compact }) => {
  const present = (Object.keys(LINK_ICONS) as LinkField[]).filter((k) => task[k] && isValidTaskUrl(task[k] as string));
  if (present.length === 0) return compact ? null : <span className="text-xs text-muted-foreground/50" aria-label="No links">-</span>;
  return (
    <span className="inline-flex items-center gap-0.5">
      {present.map((k) => {
        const Icon = LINK_ICONS[k];
        const url = task[k] as string;
        return (
          <a
            key={k}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Open ${LINK_LABELS[k]} (${linkHost(url) ?? 'link'})`}
            title={`${LINK_LABELS[k]} · ${linkHost(url) ?? ''}`}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon className="h-3.5 w-3.5" />
          </a>
        );
      })}
    </span>
  );
};

export interface TaskRowProps {
  task: TaskSummary;
  href: string;
  /** This task is open in the sheet. */
  open: boolean;
  checked: boolean;
  /** Keyboard cursor is on this row. */
  active: boolean;
  members: readonly WorkspaceMember[];
  access: TaskAccess;
  canReorder: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** Something else is reordering right now. */
  busy?: boolean;
  onCheck: (taskId: string, range: boolean) => void;
  onPatch: (taskId: string, patch: TaskPatch) => void;
  onAssign: (taskId: string, role: AssigneeRole, userId: string | null) => void;
  onMove: (taskId: string, direction: 'up' | 'down') => void;
  onDelete: (task: TaskSummary) => void;
  onFocusRow: (taskId: string) => void;
}

const TaskRow: React.FC<TaskRowProps> = ({
  task,
  href,
  open,
  checked,
  active,
  members,
  access,
  canReorder,
  isFirst,
  isLast,
  busy,
  onCheck,
  onPatch,
  onAssign,
  onMove,
  onDelete,
  onFocusRow,
}) => {
  const [renaming, setRenaming] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const workflow = useWorkflow().data;
  const finished = isFinishedStatus(workflow, task.status);
  const inRevision = !!statusOf(workflow, task.status)?.countsRevision;
  const progress = progressOf(task.subtaskDone, task.subtaskTotal);
  const hasMenu = access.editBrief || access.delete || canReorder;

  const statusControl = <WorkflowPicker task={task} members={members} />;
  const people = (
    <span className="inline-flex items-center -space-x-1">
      {(['EDITOR', 'QC_REVIEWER'] as const).map((slot) => {
        const value = slot === 'EDITOR' ? task.editorId : task.qcId;
        const other = slot === 'EDITOR' ? task.qcId : task.editorId;
        const label = slot === 'EDITOR' ? 'Editor' : 'QC reviewer';
        return access.assign ? (
          <PersonPicker
            key={slot}
            slot={slot}
            label={label}
            variant="avatar"
            value={value}
            members={members}
            otherSlotUserId={other}
            onChange={(id) => onAssign(task.id, slot, id)}
            className="ring-2 ring-card"
          />
        ) : (
          <PersonBadge key={slot} label={label} userId={value} members={members} />
        );
      })}
    </span>
  );
  const date = (field: 'dueDate' | 'clientDeadline', label: string, emptyLabel?: string) =>
    access.editBrief ? (
      <DatePicker
        variant="cell"
        label={label}
        emptyLabel={emptyLabel}
        value={task[field]}
        finished={finished}
        onChange={(iso) => onPatch(task.id, { [field]: iso })}
      />
    ) : (
      <DueLabel iso={task[field]} finished={finished} label={label} className="px-1.5" />
    );
  const priority = (
    <PriorityControl priority={task.priority} editable={access.editBrief} onChange={(p: TaskPriority) => onPatch(task.id, { priority: p })} />
  );

  return (
    <li
      data-task-row={task.id}
      className={cn(
        'group relative border-b border-border/60 px-2 py-1.5 transition-colors last:border-b-0 hover:bg-muted/40 md:py-1',
        checked && 'bg-brand-subtle/60 hover:bg-brand-subtle/80',
        // a cut sent back for changes stands out in any list
        inRevision && !open && 'shadow-[inset_3px_0_0_hsl(var(--destructive))]',
        open && 'bg-muted shadow-[inset_2px_0_0_hsl(var(--brand-accent))]',
        active && 'ring-2 ring-inset ring-ring'
      )}
      onMouseDown={() => onFocusRow(task.id)}
    >
      <div className={cn('flex items-start gap-2', ROW_GRID)}>
        {/* select */}
        <div className="relative z-10 flex h-7 items-center md:justify-center">
          <Checkbox
            checked={checked}
            aria-label={`Select ${task.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onCheck(task.id, e.shiftKey);
            }}
            className={cn('transition-opacity', !checked && 'md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100')}
          />
        </div>

        {/* name */}
        <div className="flex min-w-0 flex-1 items-center gap-1 md:min-h-7">
          {task.subtaskTotal > 0 ? (
            <button
              type="button"
              aria-label={`${expanded ? 'Hide' : 'Show'} subtasks of ${task.title}`}
              aria-expanded={expanded}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((x) => !x);
              }}
              className="relative z-10 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight aria-hidden className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} />
            </button>
          ) : (
            <span aria-hidden className="hidden w-5 shrink-0 md:inline-block" />
          )}
          {renaming ? (
            <InlineText
              label={`Rename ${task.title}`}
              hideLabel
              autoFocus
              value={task.title}
              validate={(v) => validateTaskTitle(v)}
              onCommit={(v) => onPatch(task.id, { title: v })}
              onFinish={() => setRenaming(false)}
              className="relative z-10 min-w-0 flex-1"
              inputClassName="h-7 text-sm"
            />
          ) : (
            <>
              <Link
                to={href}
                aria-current={open ? 'true' : undefined}
                className={cn(
                  'min-w-0 break-words text-sm font-medium text-foreground outline-none line-clamp-2 xl:truncate',
                  // the whole row opens the task: stretch the title link over it
                  'after:absolute after:inset-0 after:content-[""] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring',
                  finished && 'text-muted-foreground line-through decoration-muted-foreground/50'
                )}
              >
                {task.title}
              </Link>
              <RevisionTag count={task.revisionCount} className="relative z-10" />
              {progress.total > 0 && (
                <span
                  className="relative z-10 inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[11px] tabular-nums text-muted-foreground"
                  title={`${progress.done} of ${progress.total} subtasks done`}
                >
                  <ListChecks aria-hidden className="h-3 w-3" />
                  <span aria-label={`${progress.done} of ${progress.total} subtasks done`}>
                    {progress.done}/{progress.total}
                  </span>
                </span>
              )}
              <span className="relative z-10 hidden md:inline-flex lg:hidden">
                <RowLinks task={task} compact />
              </span>
              {task.aspectRatio && (
                <span className="hidden shrink-0 rounded border border-border px-1 text-[10px] font-medium tabular-nums text-muted-foreground lg:inline">
                  {task.aspectRatio}
                </span>
              )}
              {access.editBrief && (
                <IconButton
                  aria-label={`Rename ${task.title}`}
                  icon={<Pencil className="h-3 w-3" />}
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenaming(true);
                  }}
                  className="relative z-10 hidden h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 md:inline-flex"
                />
              )}
            </>
          )}
        </div>

        {/* desktop columns */}
        <div className="relative z-10 hidden md:block">{statusControl}</div>
        <div className="relative z-10 hidden md:block">{people}</div>
        <div className={cn('relative z-10', LINKS_COLUMN)}>
          <RowLinks task={task} />
        </div>
        <div className="relative z-10 hidden md:block">{date('dueDate', 'Internal QC due')}</div>
        <div className="relative z-10 hidden md:block">{date('clientDeadline', 'Client deadline')}</div>
        <div className="relative z-10 hidden md:flex md:justify-center">{priority}</div>

        {/* actions */}
        <div className="relative z-10 flex h-7 items-center md:justify-end">
          {hasMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={`Actions for ${task.title}`}
                  icon={<MoreHorizontal className="h-4 w-4" />}
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem asChild className="cursor-pointer text-xs">
                  <Link to={href}>
                    <PanelRightOpen className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    Open
                  </Link>
                </DropdownMenuItem>
                {access.editBrief && (
                  <DropdownMenuItem className="cursor-pointer text-xs" onSelect={() => setRenaming(true)}>
                    <Pencil className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    Rename
                  </DropdownMenuItem>
                )}
                {canReorder && (
                  <>
                    <DropdownMenuItem className="cursor-pointer text-xs" disabled={isFirst || busy} onSelect={() => onMove(task.id, 'up')}>
                      <ArrowUp className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                      Move up
                    </DropdownMenuItem>
                    <DropdownMenuItem className="cursor-pointer text-xs" disabled={isLast || busy} onSelect={() => onMove(task.id, 'down')}>
                      <ArrowDown className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                      Move down
                    </DropdownMenuItem>
                  </>
                )}
                {access.delete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="cursor-pointer text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
                      onSelect={() => onDelete(task)}
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Delete task
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span aria-hidden className="w-7" />
          )}
        </div>
      </div>

      {/* phone: the properties that have their own columns on wider screens */}
      <div className="relative z-10 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-7 md:hidden">
        {statusControl}
        {people}
        {date('dueDate', 'Internal QC due', 'QC')}
        {date('clientDeadline', 'Client deadline', 'Client')}
        {priority}
        <RowLinks task={task} compact />
      </div>

      {expanded && <RowSubtasks taskId={task.id} access={access} />}
    </li>
  );
};

/** An assignee shown read-only in a row: face plus an accessible name. */
const PersonBadge: React.FC<{ label: string; userId: string | null; members: readonly WorkspaceMember[] }> = ({ label, userId, members }) => {
  const name = userId ? members.find((m) => m.userId === userId)?.profile?.fullName ?? 'Former member' : null;
  const text = `${label}: ${name ?? 'unassigned'}`;
  return (
    <span role="img" aria-label={text} title={text} className="inline-flex rounded-full p-0.5 ring-2 ring-card">
      {name ? (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background">
          {name
            .split(/\s+/)
            .slice(0, 2)
            .map((p) => p[0]?.toUpperCase() ?? '')
            .join('')}
        </span>
      ) : (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border text-[9px] text-muted-foreground">
          {label === 'Editor' ? 'Ed' : 'QC'}
        </span>
      )}
    </span>
  );
};

export default memo(TaskRow);
