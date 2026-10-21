import React from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { RevisionNote, TaskPatch } from '@/database';
import type { TaskAccess } from '@/lib/tasks';
import type { GroupBy, TaskGroup } from '@/lib/task-view';
import type { AssigneeRole, TaskPriority, TaskStatus, TaskSummary, WorkspaceMember } from '@/types/database';
import QuickAdd from './QuickAdd';
import TaskRow, { LINKS_COLUMN, ROW_GRID } from './TaskRow';
import { PriorityFlag, TaskStatusPill } from './TaskBadges';

const COLUMN = 'section-label';

const GroupLabel: React.FC<{ group: TaskGroup }> = ({ group }) => {
  if (group.kind === 'status' && group.value) return <TaskStatusPill status={group.value as TaskStatus} className="font-semibold uppercase tracking-wide" />;
  if (group.kind === 'priority' && group.value) return <PriorityFlag priority={group.value as TaskPriority} withLabel className="font-semibold" />;
  return <span className="text-sm font-semibold">{group.label}</span>;
};

interface ListViewProps {
  groups: readonly TaskGroup[];
  groupBy: GroupBy;
  collapsed: readonly string[];
  checked: ReadonlySet<string>;
  /** Where new tasks go; without it (a view spanning several lists) there is no quick add. */
  listId?: string;
  listName: string;
  canCreate: boolean;
  canAddIn: (group: TaskGroup) => boolean;
  members: readonly WorkspaceMember[];
  accessOf: (task: TaskSummary) => TaskAccess;
  taskHref: (taskId: string) => string;
  openId?: string;
  activeId: string | null;
  reorderable: boolean;
  movePending: boolean;
  matched: number;
  quickAddRef?: React.Ref<HTMLInputElement>;
  addingIn: string | null;
  onAddingIn: (groupKey: string | null) => void;
  onToggleGroupChecked: (group: TaskGroup, on: boolean) => void;
  onToggleCollapsed: (key: string) => void;
  onCheck: (taskId: string, range: boolean) => void;
  onPatch: (taskId: string, patch: TaskPatch) => void;
  onAssign: (taskId: string, role: AssigneeRole, userId: string | null) => void;
  onMove: (taskId: string, direction: 'up' | 'down') => void;
  onDelete: (task: TaskSummary) => void;
  onFocusRow: (taskId: string) => void;
  onClearFilters: () => void;
  /** My Tasks: the latest revision request of tasks sent back to the person, shown under the title. */
  revisionNotes?: ReadonlyMap<string, RevisionNote>;
}

/** The grouped list: collapsible group headers with counts, and the inline-editable rows. */
const ListView: React.FC<ListViewProps> = ({
  groups,
  groupBy,
  collapsed,
  checked,
  listId,
  listName,
  canCreate,
  canAddIn,
  members,
  accessOf,
  taskHref,
  openId,
  activeId,
  reorderable,
  movePending,
  matched,
  quickAddRef,
  addingIn,
  onAddingIn,
  onToggleGroupChecked,
  onToggleCollapsed,
  onCheck,
  onPatch,
  onAssign,
  onMove,
  onDelete,
  onFocusRow,
  onClearFilters,
  revisionNotes,
}) => (
  <div className="surface-card overflow-hidden !shadow-soft">
    {canCreate && listId && (
      <div className="border-b border-border/70">
        <QuickAdd listId={listId} inputRef={quickAddRef} />
      </div>
    )}
    <div role="presentation" className={cn('hidden border-b border-border/70 bg-muted/30 px-2 py-2', ROW_GRID)}>
      <span />
      <span className={cn(COLUMN, 'pl-6')}>Task</span>
      <span className={COLUMN}>Status</span>
      <span className={COLUMN}>People</span>
      <span className={cn(COLUMN, LINKS_COLUMN)}>Links</span>
      <span className={COLUMN}>QC due</span>
      <span className={COLUMN}>Client</span>
      <span className={cn(COLUMN, 'text-center')} aria-label="Priority">
        !
      </span>
      <span />
    </div>

    {matched === 0 && (
      <div className="px-4 py-14 text-center" role="status">
        <p className="text-sm font-medium">No tasks match these filters.</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Try a different search, or widen the filters.</p>
        <Button variant="link" size="sm" onClick={onClearFilters}>
          Clear filters
        </Button>
      </div>
    )}

    {groups.map((group) => {
      const isCollapsed = collapsed.includes(group.key);
      const allChecked = group.tasks.length > 0 && group.tasks.every((t) => checked.has(t.id));
      const someChecked = group.tasks.some((t) => checked.has(t.id));
      const showHeader = groupBy !== 'none';
      return (
        <div key={group.key} role="group" aria-label={showHeader ? `${group.label}, ${group.tasks.length}` : 'Tasks'}>
          {showHeader && (
            <div className="group/header sticky top-0 z-20 flex items-center gap-2 border-b border-border/50 bg-card/85 px-2 py-2 backdrop-blur-md [&:not(:first-child)]:border-t [&:not(:first-child)]:border-t-border/40">
              <Checkbox
                checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                onCheckedChange={(v) => onToggleGroupChecked(group, v === true)}
                aria-label={`Select all in ${group.label}`}
                className={cn(!someChecked && 'md:opacity-0 md:group-hover/header:opacity-100 md:focus-visible:opacity-100')}
              />
              <button
                type="button"
                onClick={() => onToggleCollapsed(group.key)}
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${group.label}`}
                className="press inline-flex items-center gap-2 rounded-full px-1.5 py-0.5 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight aria-hidden className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', !isCollapsed && 'rotate-90')} />
                <GroupLabel group={group} />
                <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">{group.tasks.length}</span>
              </button>
            </div>
          )}
          {!isCollapsed && (
            <ul aria-label={showHeader ? `Tasks: ${group.label}` : `Tasks in ${listName}`}>
              {group.tasks.map((task, index) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  href={taskHref(task.id)}
                  open={task.id === openId}
                  checked={checked.has(task.id)}
                  active={task.id === activeId}
                  members={members}
                  access={accessOf(task)}
                  canReorder={reorderable}
                  isFirst={index === 0}
                  isLast={index === group.tasks.length - 1}
                  busy={movePending}
                  onCheck={onCheck}
                  onPatch={onPatch}
                  onAssign={onAssign}
                  onMove={onMove}
                  onDelete={onDelete}
                  onFocusRow={onFocusRow}
                  revisionNote={revisionNotes?.get(task.id)}
                />
              ))}
            </ul>
          )}
          {canCreate && listId && !isCollapsed && canAddIn(group) && addingIn !== group.key && (
            <button
              type="button"
              onClick={() => onAddingIn(group.key)}
              aria-label={`Add a task to ${group.label}`}
              className="flex h-9 w-full items-center gap-2 border-b border-border/40 px-3 text-xs text-muted-foreground/70 outline-none transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:pl-[2.9rem]"
            >
              <Plus aria-hidden className="h-3.5 w-3.5" /> Add task
            </button>
          )}
          {addingIn === group.key && !isCollapsed && listId && (
            <div className="border-b border-border/60">
              <QuickAdd listId={listId} group={group} autoFocus onDone={() => onAddingIn(null)} />
            </div>
          )}
        </div>
      );
    })}
  </div>
);

export default ListView;
