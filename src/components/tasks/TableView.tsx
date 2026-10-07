import React, { memo, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronRight, FileVideo, HardDrive, Link2, MonitorPlay, PackageCheck, Pencil, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { TaskPatch } from '@/database';
import { useWorkflow } from '@/hooks/use-workflow';
import { ASPECT_RATIOS, formatDay, LINK_FIELDS, progressOf, validateTaskTitle, type LinkField, type TaskAccess } from '@/lib/tasks';
import type { SortDir, SortKey, TaskGroup } from '@/lib/task-view';
import { TABLE_COLUMNS, shortId, type ColumnKey } from '@/lib/task-views';
import { isFinishedStatus } from '@/lib/workflow';
import type { AspectRatio, AssigneeRole, TaskPriority, TaskSummary, WorkspaceMember } from '@/types/database';
import ChoicePicker from './ChoicePicker';
import DatePicker from './DatePicker';
import LinkRow from './LinkRow';
import PersonPicker, { PersonValue } from './PersonPicker';
import { RowLinks } from './TaskRow';
import { DueLabel, RevisionTag } from './TaskBadges';
import { PriorityControl } from './TaskControls';
import WorkflowPicker from './WorkflowPicker';
import { InlineText } from './fields';

/** Rows drawn before "Show more": a table of thousands stays quick. */
const ROW_PAGE = 150;
const NO_RATIO = '__none__';

export interface ListContext {
  listName: string;
  folderName: string | null;
  spaceName: string;
}

const LINK_ICONS: Record<LinkField, React.ReactNode> = {
  rawFootageLink: <HardDrive className="h-4 w-4" />,
  projectFileLink: <FileVideo className="h-4 w-4" />,
  reviewLink: <MonitorPlay className="h-4 w-4" />,
  finalExportLink: <PackageCheck className="h-4 w-4" />,
};

// ---------------------------------------------------------------------------------------
// Column chooser
// ---------------------------------------------------------------------------------------

export const ColumnsMenu: React.FC<{ visible: readonly ColumnKey[]; onChange: (columns: ColumnKey[]) => void; onReset: () => void }> = ({
  visible,
  onChange,
  onReset,
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs font-normal" aria-label={`Columns: ${visible.length + 1} shown`}>
        <SlidersHorizontal aria-hidden className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Columns</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-56 p-2">
      <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Show columns</p>
      <ul className="max-h-72 overflow-y-auto">
        <li className="flex items-center gap-2 px-1 py-1 text-sm text-muted-foreground">
          <Checkbox checked disabled aria-label="Task (always shown)" /> Task
        </li>
        {TABLE_COLUMNS.map((c) => {
          const on = visible.includes(c.key);
          return (
            <li key={c.key} className="flex items-center gap-2 px-1 py-1 text-sm">
              <Checkbox
                id={`col-${c.key}`}
                checked={on}
                onCheckedChange={(v) => onChange(TABLE_COLUMNS.filter((x) => (x.key === c.key ? v === true : visible.includes(x.key))).map((x) => x.key))}
              />
              <label htmlFor={`col-${c.key}`} className="flex-1 cursor-pointer">
                {c.label}
              </label>
            </li>
          );
        })}
      </ul>
      <Button variant="ghost" size="sm" className="mt-1 h-7 w-full text-xs" onClick={onReset}>
        Reset to default
      </Button>
    </PopoverContent>
  </Popover>
);

// ---------------------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------------------

interface RowProps {
  task: TaskSummary;
  columns: readonly ColumnKey[];
  href: string;
  open: boolean;
  checked: boolean;
  active: boolean;
  members: readonly WorkspaceMember[];
  access: TaskAccess;
  context?: ListContext;
  onCheck: (taskId: string, range: boolean) => void;
  onPatch: (taskId: string, patch: TaskPatch) => void;
  onAssign: (taskId: string, role: AssigneeRole, userId: string | null) => void;
  onFocusRow: (taskId: string) => void;
}

const LinksCell: React.FC<{ task: TaskSummary; access: TaskAccess; onPatch: RowProps['onPatch'] }> = ({ task, access, onPatch }) => {
  const editable = access.editBrief || access.editWorkLinks || access.editFinalExport;
  return (
    <span className="flex items-center gap-0.5">
      <RowLinks task={task} compact />
      {editable && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Edit links of ${task.title}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 outline-none hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100 data-[state=open]:opacity-100"
            >
              <Link2 aria-hidden className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 divide-y divide-border/50 p-2" onClick={(e) => e.stopPropagation()}>
            {LINK_FIELDS.map(({ key, label }) => (
              <LinkRow
                key={key}
                icon={LINK_ICONS[key]}
                label={label}
                hint={`Add ${label.toLowerCase()}`}
                value={task[key] ?? ''}
                editable={key === 'reviewLink' || key === 'projectFileLink' ? access.editWorkLinks : key === 'finalExportLink' ? access.editFinalExport : access.editBrief}
                onCommit={(v) => onPatch(task.id, { [key]: v })}
              />
            ))}
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
};

const Row = memo(function Row({ task, columns, href, open, checked, active, members, access, context, onCheck, onPatch, onAssign, onFocusRow }: RowProps) {
  const workflow = useWorkflow().data;
  const finished = isFinishedStatus(workflow, task.status);
  const [renaming, setRenaming] = useState(false);
  const progress = progressOf(task.subtaskDone, task.subtaskTotal);
  const stick = checked ? 'bg-brand-subtle' : open ? 'bg-muted' : 'bg-card group-hover/row:bg-muted';

  const person = (slot: AssigneeRole) => {
    const value = slot === 'EDITOR' ? task.editorId : task.qcId;
    const other = slot === 'EDITOR' ? task.qcId : task.editorId;
    const label = slot === 'EDITOR' ? 'Editor' : 'QC reviewer';
    return access.assign ? (
      <PersonPicker
        slot={slot}
        label={label}
        variant="ghost"
        value={value}
        members={members}
        otherSlotUserId={other}
        onChange={(id) => onAssign(task.id, slot, id)}
        className="h-8 w-full max-w-full"
      />
    ) : (
      <PersonValue userId={value} members={members} />
    );
  };

  const date = (field: 'dueDate' | 'clientDeadline', label: string) =>
    access.editBrief ? (
      <DatePicker variant="cell" label={label} value={task[field]} finished={finished} onChange={(iso) => onPatch(task.id, { [field]: iso })} />
    ) : (
      <DueLabel iso={task[field]} finished={finished} label={label} className="px-1.5" />
    );

  const cell: Record<ColumnKey, React.ReactNode> = {
    status: <WorkflowPicker task={task} members={members} />,
    editor: person('EDITOR'),
    qc: person('QC_REVIEWER'),
    dueDate: date('dueDate', 'Internal QC due'),
    clientDeadline: date('clientDeadline', 'Client deadline'),
    priority: <PriorityControl variant="field" priority={task.priority} editable={access.editBrief} onChange={(p: TaskPriority) => onPatch(task.id, { priority: p })} />,
    list: context ? (
      <span className="block truncate text-xs text-muted-foreground" title={`${context.spaceName}${context.folderName ? ` / ${context.folderName}` : ''} / ${context.listName}`}>
        {context.listName}
      </span>
    ) : (
      <span className="text-xs text-muted-foreground/60">-</span>
    ),
    aspectRatio: access.editBrief ? (
      <ChoicePicker<string>
        label="Aspect ratio"
        value={task.aspectRatio ?? NO_RATIO}
        choices={[{ value: NO_RATIO, label: 'Not set' }, ...ASPECT_RATIOS.map((a) => ({ value: a.value as string, label: a.label }))]}
        onChange={(v) => onPatch(task.id, { aspectRatio: v === NO_RATIO ? null : (v as AspectRatio) })}
        className="h-8 w-full px-2 text-xs hover:bg-muted"
        trigger={<span className={cn('tabular-nums', !task.aspectRatio && 'text-muted-foreground/60')}>{task.aspectRatio ?? '-'}</span>}
      />
    ) : (
      <span className="px-2 text-xs tabular-nums">{task.aspectRatio ?? '-'}</span>
    ),
    links: <LinksCell task={task} access={access} onPatch={onPatch} />,
    subtasks:
      progress.total > 0 ? (
        <span className="inline-flex items-center gap-2 px-2 text-xs tabular-nums" aria-label={`${progress.done} of ${progress.total} subtasks done`}>
          <span aria-hidden className="h-1.5 w-10 overflow-hidden rounded-full bg-border">
            <span className="block h-full bg-primary" style={{ width: `${progress.percent}%` }} />
          </span>
          {progress.done}/{progress.total}
        </span>
      ) : (
        <span className="px-2 text-xs text-muted-foreground/60">-</span>
      ),
    revisions: task.revisionCount > 0 ? <RevisionTag count={task.revisionCount} className="ml-2" /> : <span className="px-2 text-xs text-muted-foreground/60">-</span>,
    created: <span className="px-2 text-xs tabular-nums text-muted-foreground">{formatDay(task.createdAt)}</span>,
    updated: <span className="px-2 text-xs tabular-nums text-muted-foreground">{formatDay(task.updatedAt)}</span>,
    id: (
      <code className="px-2 text-[11px] text-muted-foreground" title={task.id}>
        {shortId(task.id)}
      </code>
    ),
  };

  return (
    <tr
      data-task-row={task.id}
      onMouseDown={() => onFocusRow(task.id)}
      className={cn('group/row border-b border-border/60 last:border-b-0 hover:bg-muted/40', checked && 'bg-brand-subtle/60', open && 'bg-muted', active && 'outline outline-2 -outline-offset-2 outline-ring')}
    >
      <td className={cn('sticky left-0 z-10 w-8 px-2', stick)}>
        <Checkbox checked={checked} aria-label={`Select ${task.title}`} onClick={(e) => { e.stopPropagation(); onCheck(task.id, e.shiftKey); }} />
      </td>
      <td className={cn('sticky left-8 z-10 min-w-[16rem] max-w-[26rem] border-r border-border/40 px-1 py-1', stick)}>
        <div className="flex min-w-0 items-center gap-1">
          {renaming ? (
            <InlineText
              label={`Rename ${task.title}`}
              hideLabel
              autoFocus
              value={task.title}
              validate={(v) => validateTaskTitle(v)}
              onCommit={(v) => onPatch(task.id, { title: v })}
              onFinish={() => setRenaming(false)}
              className="min-w-0 flex-1"
              inputClassName="h-7 text-sm"
            />
          ) : (
            <>
              <Link
                to={href}
                aria-current={open ? 'true' : undefined}
                className={cn(
                  'min-w-0 flex-1 truncate rounded px-1 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  finished && 'text-muted-foreground line-through decoration-muted-foreground/50'
                )}
              >
                {task.title}
              </Link>
              <RevisionTag count={task.revisionCount} />
              {access.editBrief && (
                <button
                  type="button"
                  aria-label={`Rename ${task.title}`}
                  onClick={() => setRenaming(true)}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 outline-none hover:bg-muted focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100"
                >
                  <Pencil aria-hidden className="h-3 w-3" />
                </button>
              )}
            </>
          )}
        </div>
      </td>
      {columns.map((key) => (
        <td key={key} className={cn('px-1 py-1 align-middle', TABLE_COLUMNS.find((c) => c.key === key)?.width)}>
          {cell[key]}
        </td>
      ))}
    </tr>
  );
});

// ---------------------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------------------

interface TableViewProps {
  groups: readonly TaskGroup[];
  showGroups: boolean;
  columns: readonly ColumnKey[];
  members: readonly WorkspaceMember[];
  accessOf: (task: TaskSummary) => TaskAccess;
  contextOf?: (task: TaskSummary) => ListContext | undefined;
  checked: ReadonlySet<string>;
  onCheck: (taskId: string, range: boolean) => void;
  onToggleAll: (taskIds: readonly string[], on: boolean) => void;
  activeId: string | null;
  openId?: string;
  taskHref: (taskId: string) => string;
  onFocusRow: (taskId: string) => void;
  onPatch: (taskId: string, patch: TaskPatch) => void;
  onAssign: (taskId: string, role: AssigneeRole, userId: string | null) => void;
  sort: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  collapsed: readonly string[];
  onToggleCollapsed: (key: string) => void;
  /** Rendered under the rows (quick add). */
  footer?: React.ReactNode;
}

/**
 * A spreadsheet of the same tasks: sortable column headers, sticky header and task column, inline
 * editing in every cell (stage, people, dates, priority, aspect ratio, links), selection with
 * shift-click ranges, optional grouping and a column chooser. Rows are drawn progressively.
 */
const TableView: React.FC<TableViewProps> = ({
  groups,
  showGroups,
  columns,
  members,
  accessOf,
  contextOf,
  checked,
  onCheck,
  onToggleAll,
  activeId,
  openId,
  taskHref,
  onFocusRow,
  onPatch,
  onAssign,
  sort,
  dir,
  onSort,
  collapsed,
  onToggleCollapsed,
  footer,
}) => {
  const [limit, setLimit] = useState(ROW_PAGE);
  const shownColumns = useMemo(() => TABLE_COLUMNS.filter((c) => columns.includes(c.key)), [columns]);
  const open = groups.filter((g) => !collapsed.includes(g.key) || !showGroups);
  const allIds = useMemo(() => open.flatMap((g) => g.tasks.map((t) => t.id)), [open]);
  const allChecked = allIds.length > 0 && allIds.every((id) => checked.has(id));
  const someChecked = allIds.some((id) => checked.has(id));
  const total = open.reduce((n, g) => n + g.tasks.length, 0);

  let budget = limit;
  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-soft">
      <div className="max-h-[calc(100vh-14rem)] overflow-auto">
        <table className="w-full min-w-max border-separate border-spacing-0 text-sm" aria-label="Tasks table">
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted/80 backdrop-blur">
              <th scope="col" className="sticky left-0 z-30 w-8 border-b border-border/70 bg-muted px-2 py-2 text-left">
                <Checkbox
                  checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                  onCheckedChange={(v) => onToggleAll(allIds, v === true)}
                  aria-label="Select all tasks"
                />
              </th>
              <th
                scope="col"
                aria-sort={sort === 'title' ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="sticky left-8 z-30 min-w-[16rem] border-b border-r border-border/70 bg-muted px-2 py-2 text-left"
              >
                <HeaderButton label="Task" active={sort === 'title'} dir={dir} onClick={() => onSort('title')} />
              </th>
              {shownColumns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={c.sort && sort === c.sort ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={cn('border-b border-border/70 px-2 py-2 text-left', c.width)}
                >
                  {c.sort ? <HeaderButton label={c.label} active={sort === c.sort} dir={dir} onClick={() => onSort(c.sort as SortKey)} /> : <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{c.label}</span>}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((group) => {
            const isCollapsed = showGroups && collapsed.includes(group.key);
            const rows = isCollapsed ? [] : group.tasks.slice(0, Math.max(0, budget));
            budget -= rows.length;
            return (
              <tbody key={group.key} aria-label={showGroups ? `${group.label}, ${group.tasks.length}` : 'Tasks'}>
                {showGroups && (
                  <tr className="bg-muted/30">
                    <td colSpan={shownColumns.length + 2} className="border-b border-border/60 px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => onToggleCollapsed(group.key)}
                        aria-expanded={!isCollapsed}
                        aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${group.label}`}
                        className="inline-flex items-center gap-2 rounded px-1 py-0.5 text-sm font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronRight aria-hidden className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', !isCollapsed && 'rotate-90')} />
                        {group.label}
                        <span className="text-xs font-normal tabular-nums text-muted-foreground">{group.tasks.length}</span>
                      </button>
                    </td>
                  </tr>
                )}
                {rows.map((task) => (
                  <Row
                    key={task.id}
                    task={task}
                    columns={shownColumns.map((c) => c.key)}
                    href={taskHref(task.id)}
                    open={task.id === openId}
                    checked={checked.has(task.id)}
                    active={task.id === activeId}
                    members={members}
                    access={accessOf(task)}
                    context={contextOf?.(task)}
                    onCheck={onCheck}
                    onPatch={onPatch}
                    onAssign={onAssign}
                    onFocusRow={onFocusRow}
                  />
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
      {total > limit && (
        <div className="border-t border-border/70 p-2 text-center">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setLimit((n) => n + ROW_PAGE)}>
            Show {Math.min(ROW_PAGE, total - limit)} more ({total - limit} not shown yet)
          </Button>
        </div>
      )}
      {footer}
    </div>
  );
};

const HeaderButton: React.FC<{ label: string; active: boolean; dir: SortDir; onClick: () => void }> = ({ label, active, dir, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={`Sort by ${label}${active ? (dir === 'asc' ? ', ascending' : ', descending') : ''}`}
    className={cn(
      'inline-flex items-center gap-1 rounded px-1 text-[11px] font-medium uppercase tracking-wide outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
      active ? 'text-foreground' : 'text-muted-foreground'
    )}
  >
    {label}
    {active && (dir === 'asc' ? <ArrowUp aria-hidden className="h-3 w-3" /> : <ArrowDown aria-hidden className="h-3 w-3" />)}
  </button>
);

export default TableView;
