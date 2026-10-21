import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { toast } from 'sonner';
import { ArrowRight, ListChecks, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useIsMobile } from '@/hooks/use-mobile';
import { useWorkflow } from '@/hooks/use-workflow';
import { groupTasks, type TaskGroup, type ViewContext } from '@/lib/task-view';
import { memberLookup, progressOf } from '@/lib/tasks';
import { canChangeStatus, isFinishedStatus, movesFor, nextSteps, type Move } from '@/lib/workflow';
import type { TaskSummary, WorkspaceMember } from '@/types/database';
import { AssigneeStack, DueLabel, PriorityFlag, RevisionTag, TaskStatusPill } from './TaskBadges';
import QuickAdd from './QuickAdd';
import TransitionDialog from './TransitionDialog';
import WorkflowPicker from './WorkflowPicker';
import { useMoveRunner } from './use-move-flow';

/** Cards drawn per column before "Show more": a column with hundreds of videos stays quick. */
const COLUMN_PAGE = 30;

interface BoardViewProps {
  /** Already filtered and sorted. The board only lays them out. */
  tasks: readonly TaskSummary[];
  members: readonly WorkspaceMember[];
  /** The list new tasks are created in (none when the board spans several lists). */
  listId?: string;
  canAddIn: (group: TaskGroup) => boolean;
  canCreate: boolean;
  openId?: string;
  activeId: string | null;
  taskHref: (taskId: string) => string;
  onFocusCard: (taskId: string) => void;
  /** Collapsed columns (their keys), a per-person preference. */
  collapsed: readonly string[];
  onToggleCollapsed: (key: string) => void;
  ctx: ViewContext;
}

type Verdicts = Map<string, Move>;

function useDropVerdicts(task: TaskSummary | null): Verdicts {
  const { role, user } = useAuth();
  const workflow = useWorkflow().data;
  return useMemo(() => {
    const out: Verdicts = new Map();
    if (!task) return out;
    for (const m of movesFor(workflow, task, { role, isAssignedEditor: !!user && task.editorId === user.id })) out.set(m.to.key, m);
    return out;
  }, [task, workflow, role, user]);
}

// ---------------------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------------------

interface CardProps {
  task: TaskSummary;
  members: readonly WorkspaceMember[];
  href: string;
  open: boolean;
  active: boolean;
  draggable: boolean;
  onFocusCard: (taskId: string) => void;
  onStart: (task: TaskSummary, move: Move) => void;
  overlay?: boolean;
}

const CardBody: React.FC<CardProps & { dragging?: boolean }> = ({
  task,
  members,
  href,
  open,
  active,
  onFocusCard,
  onStart,
  overlay,
  dragging,
}) => {
  const { role, user } = useAuth();
  const workflow = useWorkflow().data;
  const lookup = useMemo(() => memberLookup(members), [members]);
  const finished = isFinishedStatus(workflow, task.status);
  const steps = nextSteps(workflow, task, { role, isAssignedEditor: !!user && task.editorId === user.id });
  const primary = steps.find((m) => m.transition?.kind === 'forward') ?? steps[0];
  const progress = progressOf(task.subtaskDone, task.subtaskTotal);
  const revision = !!workflow?.statuses.find((s) => s.key === task.status)?.countsRevision;

  return (
    <div
      data-task-row={overlay ? undefined : task.id}
      onMouseDown={() => onFocusCard(task.id)}
      className={cn(
        'group relative rounded-[0.75rem] border border-border/60 bg-card p-3 text-sm shadow-soft transition-[box-shadow,transform,border-color] duration-200 ease-out hover:border-border hover:shadow-medium',
        revision && 'border-l-[3px] border-l-destructive',
        open && 'ring-2 ring-primary/40',
        active && 'ring-2 ring-ring',
        dragging && 'scale-[0.98] opacity-40',
        overlay && 'rotate-[1.5deg] scale-[1.03] shadow-float ring-2 ring-primary/40'
      )}
    >
      <div className="flex items-start gap-1.5">
        <Link
          to={href}
          aria-current={open ? 'true' : undefined}
          tabIndex={overlay ? -1 : 0}
          className={cn(
            'min-w-0 flex-1 break-words text-sm font-medium leading-snug outline-none',
            'line-clamp-3 after:absolute after:inset-0 after:content-[""] focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring',
            finished && 'text-muted-foreground line-through decoration-muted-foreground/50'
          )}
        >
          {task.title}
        </Link>
        <RevisionTag count={task.revisionCount} className="relative z-10" />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
        <PriorityFlag priority={task.priority} />
        <DueLabel iso={task.dueDate} finished={finished} label="Internal QC due" />
        {task.aspectRatio && <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums">{task.aspectRatio}</span>}
        {progress.total > 0 && (
          <span className="inline-flex items-center gap-0.5 tabular-nums" title={`${progress.done} of ${progress.total} subtasks done`}>
            <ListChecks aria-hidden className="h-3 w-3" />
            <span aria-label={`${progress.done} of ${progress.total} subtasks done`}>
              {progress.done}/{progress.total}
            </span>
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <AssigneeStack editorId={task.editorId} qcId={task.qcId} lookup={lookup} />
        {!overlay && (
          <span className="relative z-10 flex items-center gap-1">
            {primary && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px] font-medium opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onStart(task, primary);
                }}
                aria-label={`${primary.label}: ${task.title}`}
              >
                {primary.label}
                <ArrowRight aria-hidden className="h-3 w-3" />
              </Button>
            )}
            <WorkflowPicker task={task} members={members} variant="icon" label={`Move ${task.title}`} align="end" />
          </span>
        )}
      </div>
    </div>
  );
};

const BoardCard: React.FC<CardProps> = (props) => {
  const { task } = props;
  const { role, user } = useAuth();
  const workflow = useWorkflow().data;
  // a card nobody here may move is not draggable (it would only ever be refused)
  const draggable = props.draggable && canChangeStatus(workflow, task, { role, isAssignedEditor: !!user && task.editorId === user.id });
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !draggable });
  // Pointer listeners only: the card's own link and buttons stay the keyboard path (the stage
  // picker on every card is the accessible way to move it).
  return (
    <li ref={setNodeRef} {...(draggable ? listeners : {})} className={cn('touch-pan-y', draggable && 'cursor-grab active:cursor-grabbing')}>
      <CardBody {...props} dragging={isDragging} />
    </li>
  );
};

// ---------------------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------------------

interface ColumnProps {
  group: TaskGroup;
  collapsed: boolean;
  onToggleCollapsed: (key: string) => void;
  dragging: TaskSummary | null;
  verdict: Move | undefined;
  showAdd: boolean;
  listId?: string;
  renderCard: (task: TaskSummary) => React.ReactNode;
}

const BoardColumn: React.FC<ColumnProps> = ({ group, collapsed, onToggleCollapsed, dragging, verdict, showAdd, listId, renderCard }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${group.value}`, data: { status: group.value } });
  const [limit, setLimit] = useState(COLUMN_PAGE);
  const [adding, setAdding] = useState(false);
  const here = !!dragging && dragging.status === group.value;
  const allowed = !!verdict?.allowed;
  const blocked = !!dragging && !here && !allowed;

  return (
    <section
      ref={setNodeRef}
      role="group"
      aria-label={`${group.label}, ${group.tasks.length}`}
      className={cn(
        'flex max-h-[calc(100vh-15rem)] min-h-[12rem] shrink-0 snap-start flex-col rounded-card border border-border/40 bg-muted/50 transition-colors duration-200',
        collapsed ? 'w-12' : 'w-[82vw] max-w-[20rem] md:w-72',
        !!dragging && allowed && 'border-primary/50 bg-primary/5',
        isOver && allowed && 'bg-primary/10 ring-2 ring-primary/50 shadow-[0_0_0_6px_hsl(var(--primary)/0.08),0_12px_32px_-12px_hsl(var(--primary)/0.35)]',
        blocked && 'opacity-50',
        isOver && blocked && 'opacity-100 ring-2 ring-destructive/40'
      )}
    >
      <header className={cn('flex items-center gap-2 px-3 py-2.5', collapsed && 'flex-col py-3')}>
        <button
          type="button"
          onClick={() => onToggleCollapsed(group.key)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.label}`}
          className={cn('flex min-w-0 items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring', collapsed && 'flex-col')}
        >
          {collapsed ? (
            <span className="text-[11px] font-semibold uppercase tracking-wide [writing-mode:vertical-rl]">{group.label}</span>
          ) : (
            <TaskStatusPill status={group.value ?? ''} />
          )}
          <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">{group.tasks.length}</span>
        </button>
        {!collapsed && showAdd && listId && (
          <Button variant="ghost" size="sm" className="ml-auto h-7 w-7 p-0" onClick={() => setAdding(true)} aria-label={`Add a task to ${group.label}`}>
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </header>

      {!collapsed && (
        <>
          {isOver && blocked && verdict && (
            <p role="status" className="mx-2.5 mb-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
              {verdict.reason}
            </p>
          )}
          {isOver && allowed && verdict && (
            <p className="mx-2.5 mb-2 px-1 text-xs font-medium text-primary">
              {verdict.label}
              {verdict.needs.length > 0 ? '...' : ''}
            </p>
          )}
          <ul aria-label={`Tasks: ${group.label}`} className="flex min-h-[3rem] flex-1 flex-col gap-2 overflow-y-auto px-2.5 pb-2.5">
            {group.tasks.slice(0, limit).map((t) => renderCard(t))}
            {group.tasks.length === 0 && !adding && (
              <li className="px-1 py-3 text-center text-xs text-muted-foreground/70">{dragging ? 'Drop here' : 'No tasks'}</li>
            )}
          </ul>
          {group.tasks.length > limit && (
            <Button variant="ghost" size="sm" className="mx-2 mb-2 h-7 text-xs" onClick={() => setLimit((n) => n + COLUMN_PAGE)}>
              Show {Math.min(COLUMN_PAGE, group.tasks.length - limit)} more ({group.tasks.length - limit} hidden)
            </Button>
          )}
          {adding && listId && (
            <div className="border-t border-border/60">
              <QuickAdd listId={listId} group={group} autoFocus onDone={() => setAdding(false)} />
            </div>
          )}
        </>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------------------

/**
 * The tasks as stage columns. Dragging a card is a request to move it to that stage through the SAME
 * workflow path as the stage picker: stages it cannot reach light down (with the reason when you hover
 * one), a move that needs a link or a note opens the same dialog, and nothing is shown as moved before
 * the database has accepted it or the optimistic update can be rolled back.
 */
const BoardView: React.FC<BoardViewProps> = ({
  tasks,
  members,
  listId,
  canAddIn,
  canCreate,
  openId,
  activeId,
  taskHref,
  onFocusCard,
  collapsed,
  onToggleCollapsed,
  ctx,
}) => {
  const isMobile = useIsMobile();
  const { run, pending } = useMoveRunner();
  const [dragId, setDragId] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ task: TaskSummary; move: Move } | null>(null);

  const columns = useMemo(() => groupTasks(tasks, 'status', ctx, { keepEmpty: true }), [tasks, ctx]);
  const dragging = useMemo(() => tasks.find((t) => t.id === dragId) ?? null, [tasks, dragId]);
  const verdicts = useDropVerdicts(dragging);

  // Pointer drag on wide screens, press-and-hold on touch; phones use the card's own buttons instead.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  const start = (task: TaskSummary, move: Move) => {
    if (!move.allowed || pending) return;
    if (move.needs.length > 0) setAsking({ task, move });
    else void run(task, move);
  };

  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    const task = tasks.find((t) => t.id === String(e.active.id));
    setDragId(null);
    const to = e.over?.data.current?.status as string | undefined;
    if (!task || !to || to === task.status) return;
    const move = verdicts.get(to);
    if (!move) return;
    if (!move.allowed) {
      // refused cleanly: nothing was moved, so there is nothing to put back
      toast.error(move.reason ?? 'That move is not allowed.');
      return;
    }
    start(task, move);
  };

  return (
    <>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
        <div
          role="region"
          aria-label="Board"
          className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3 md:snap-none"
        >
          {columns.map((group) => (
            <BoardColumn
              key={group.key}
              group={group}
              collapsed={collapsed.includes(group.key)}
              onToggleCollapsed={onToggleCollapsed}
              dragging={dragging}
              verdict={verdicts.get(group.value ?? '')}
              showAdd={canCreate && canAddIn(group)}
              listId={listId}
              renderCard={(t) => (
                <BoardCard
                  key={t.id}
                  task={t}
                  members={members}
                  href={taskHref(t.id)}
                  open={t.id === openId}
                  active={t.id === activeId}
                  draggable={!isMobile && !pending}
                  onFocusCard={onFocusCard}
                  onStart={start}
                />
              )}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <CardBody
              task={dragging}
              members={members}
              href={taskHref(dragging.id)}
              open={false}
              active={false}
              draggable={false}
              onFocusCard={onFocusCard}
              onStart={start}
              overlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {asking && (
        <TransitionDialog
          title={asking.move.label}
          to={asking.move.to.key}
          needs={asking.move.needs}
          members={members}
          qcId={asking.task.qcId}
          override={asking.move.override}
          pending={pending}
          onCancel={() => setAsking(null)}
          onConfirm={(values) =>
            void run(asking.task, asking.move, values).then((ok) => {
              if (ok) setAsking(null);
            })
          }
        />
      )}
    </>
  );
};

export default BoardView;
