import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ListChecks, MoreHorizontal, PanelRightOpen, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/ui/icon-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isFinished, progressOf } from '@/lib/tasks';
import type { TaskSummary } from '@/types/database';
import { AssigneeStack, DueLabel, PriorityFlag, TaskStatusPill } from './TaskBadges';
import type { MemberLookup } from '@/lib/tasks';

/** One grid for the header and every row, so columns line up. Below md rows stack instead. */
export const ROW_GRID = 'md:grid md:grid-cols-[136px_minmax(0,1fr)_64px_76px_76px_24px_32px] md:items-center md:gap-3';

interface TaskRowProps {
  task: TaskSummary;
  href: string;
  selected: boolean;
  lookup: MemberLookup;
  canReorder: boolean;
  canDelete: boolean;
  isFirst: boolean;
  isLast: boolean;
  busy?: boolean;
  onMove: (direction: 'up' | 'down') => void;
  onDelete: () => void;
}

const TaskRow: React.FC<TaskRowProps> = ({
  task,
  href,
  selected,
  lookup,
  canReorder,
  canDelete,
  isFirst,
  isLast,
  busy,
  onMove,
  onDelete,
}) => {
  const finished = isFinished(task.status);
  const progress = progressOf(task.subtaskDone, task.subtaskTotal);
  const hasMenu = canReorder || canDelete;

  return (
    <li
      className={cn(
        'group relative border-b border-border/70 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-muted/50 focus-within:bg-muted/50',
        'focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring',
        selected && 'bg-muted shadow-[inset_2px_0_0_hsl(var(--brand-accent))]',
        ROW_GRID
      )}
    >
      <div className="hidden md:block">
        <TaskStatusPill status={task.status} />
      </div>

      <div className="min-w-0 pr-8 md:pr-0">
        <Link
          to={href}
          aria-current={selected ? 'true' : undefined}
          className={cn(
            'block truncate text-sm font-medium text-foreground outline-none',
            // the whole row is the click target: stretch the title link over it
            'after:absolute after:inset-0 after:content-[""]',
            finished && 'text-muted-foreground line-through decoration-muted-foreground/50'
          )}
        >
          {task.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <TaskStatusPill status={task.status} className="md:hidden" />
          {task.aspectRatio && (
            <span className="rounded border border-border px-1.5 py-px font-medium tabular-nums">{task.aspectRatio}</span>
          )}
          {progress.total > 0 && (
            <span
              className="inline-flex items-center gap-1 tabular-nums"
              title={`${progress.done} of ${progress.total} subtasks done`}
            >
              <ListChecks aria-hidden className="h-3 w-3" />
              <span aria-label={`${progress.done} of ${progress.total} subtasks done`}>
                {progress.done}/{progress.total}
              </span>
            </span>
          )}
          {/* phone: the details that have their own columns on wider screens */}
          <span className="inline-flex items-center gap-3 md:hidden">
            <AssigneeStack editorId={task.editorId} qcId={task.qcId} lookup={lookup} />
            {task.dueDate && <DueLabel iso={task.dueDate} finished={finished} label="Internal QC due" />}
            {task.clientDeadline && <DueLabel iso={task.clientDeadline} finished={finished} label="Client deadline" />}
            <PriorityFlag priority={task.priority} />
          </span>
        </div>
      </div>

      <div className="hidden md:block">
        <AssigneeStack editorId={task.editorId} qcId={task.qcId} lookup={lookup} />
      </div>
      <div className="hidden md:block">
        <DueLabel iso={task.dueDate} finished={finished} label="Internal QC due" />
      </div>
      <div className="hidden md:block">
        <DueLabel iso={task.clientDeadline} finished={finished} label="Client deadline" />
      </div>
      <div className="hidden md:block">
        <PriorityFlag priority={task.priority} />
      </div>

      <div className="absolute right-2 top-2 z-10 md:static md:flex md:justify-end">
        {hasMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={`Actions for ${task.title}`}
                icon={<MoreHorizontal className="h-4 w-4" />}
                variant="ghost"
                size="sm"
                className="h-7 w-7 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem asChild className="cursor-pointer text-xs">
                <Link to={href}>
                  <PanelRightOpen className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                  Open
                </Link>
              </DropdownMenuItem>
              {canReorder && (
                <>
                  <DropdownMenuItem className="cursor-pointer text-xs" disabled={isFirst || busy} onSelect={() => onMove('up')}>
                    <ArrowUp className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer text-xs" disabled={isLast || busy} onSelect={() => onMove('down')}>
                    <ArrowDown className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    Move down
                  </DropdownMenuItem>
                </>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
                    onSelect={onDelete}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Delete task
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  );
};

export default TaskRow;
