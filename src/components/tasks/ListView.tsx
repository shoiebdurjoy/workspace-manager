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

const COLUMN = 'text-[11px] font-medium uppercase tracking-wide text-muted-foreground';

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
  <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-soft">
    {canCreate && listId && (
      <div className="border-b border-border/70">
        <QuickAdd listId={listId} inputRef={quickAddRef} />
      </div>
    )}
    <div role="presentation" className={cn('hidden border-b border-border/70 bg-muted/40 px-2 py-1.5', ROW_GRID)}>
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
      <div className="px-4 py-10 text-center" role="status">
        <p className="text-sm font-medium">No tasks match these filters.</p>
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
            <div className="group/header sticky top-0 z-20 flex items-center gap-2 border-b border-border/60 bg-card/95 px-2 py-1.5 backdrop-blur">
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
                className="inline-flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight aria-hidden className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', !isCollapsed && 'rotate-90')} />
                <GroupLabel group={group} />
                <span className="text-xs tabular-nums text-muted-foreground">{group.tasks.length}</span>
              </button>
              {canCreate && listId && !isCollapsed && canAddIn(group) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 px-2 text-xs text-muted-foreground md:opacity-0 md:group-hover/header:opacity-100 md:focus-visible:opacity-100"
                  onClick={() => onAddingIn(group.key)}
                  aria-label={`Add a task to ${group.label}`}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add task
                </Button>
              )}
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
