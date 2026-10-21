import React, { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownNarrowWide, ArrowUpNarrowWide, CalendarDays, Check, ChevronDown, Keyboard, Layers, Loader2, Plus, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { UserAvatar } from '@/components/ui/user-avatar';
import { ASPECT_RATIOS, TASK_PRIORITIES, eligibleAssignees } from '@/lib/tasks';
import { useWorkflow } from '@/hooks/use-workflow';
import { SORT_OPTIONS, countActiveFilters, type GroupBy, type TaskFilters, type TaskViewState } from '@/lib/task-view';
import {
  CREATED_PRESETS,
  DATE_PRESET_LABELS,
  DUE_PRESETS,
  NOBODY,
  dateCodeLabel,
  isDateCode,
  rangeCode,
  splitRange,
  type DatePreset,
} from '@/lib/task-filters';
import type { WorkspaceMember } from '@/types/database';
import { PriorityFlag, TaskStatusPill } from './TaskBadges';

/** How long typing pauses before the database is asked: a search per keystroke would be wasteful. */
export const SEARCH_DEBOUNCE_MS = 250;

export interface Option {
  value: string;
  label: string;
  render?: React.ReactNode;
}

export interface ScopeOptions {
  spaces: readonly Option[];
  folders: readonly Option[];
  lists: readonly Option[];
}

/** A filter chip that opens a searchable multi-select. Shows how many values are on. */
const MultiFilter: React.FC<{
  label: string;
  options: readonly Option[];
  selected: readonly string[];
  onChange: (values: string[]) => void;
}> = ({ label, options, selected, onChange }) => {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = options.filter((o) => !needle || o.label.toLowerCase().includes(needle));
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <Popover onOpenChange={(o) => o && setQuery('')}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={selected.length ? `${label} filter: ${selected.length} selected` : `${label} filter`}
          className={cn('h-8 shrink-0 gap-1 rounded-full border-transparent bg-muted/60 px-3 text-xs font-medium text-muted-foreground shadow-none press hover:bg-muted hover:text-foreground', selected.length > 0 && 'border-brand/30 bg-brand-subtle text-brand-subtle-foreground hover:bg-brand-subtle')}
        >
          {label}
          {selected.length > 0 && <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold tabular-nums text-white">{selected.length}</span>}
          <ChevronDown aria-hidden className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command shouldFilter={false}>
          {options.length > 6 && <CommandInput value={query} onValueChange={setQuery} placeholder={`Search ${label.toLowerCase()}...`} />}
          <CommandList>
            {shown.length === 0 && <div className="px-3 py-4 text-center text-xs text-muted-foreground">No match.</div>}
            <CommandGroup>
              {shown.map((o) => (
                <CommandItem key={o.value} value={o.value} onSelect={() => toggle(o.value)} className="gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-input',
                      selected.includes(o.value) && 'border-primary bg-primary text-primary-foreground'
                    )}
                  >
                    {selected.includes(o.value) && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{o.render ?? o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {selected.length > 0 && (
            <div className="border-t border-border/70 p-1">
              <Button variant="ghost" size="sm" className="h-7 w-full text-xs" onClick={() => onChange([])}>
                Clear {label.toLowerCase()} filter
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
};

/** A date filter: a few presets people actually use, or their own range. */
const DateFilterMenu: React.FC<{
  label: string;
  code: string | null;
  presets: readonly DatePreset[];
  onChange: (code: string | null) => void;
}> = ({ label, code, presets, onChange }) => {
  const range = code ? splitRange(code) : null;
  const active = isDateCode(code);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={active ? `${label} filter: ${dateCodeLabel(code as string)}` : `${label} filter`}
          className={cn('h-8 shrink-0 gap-1 rounded-full border-transparent bg-muted/60 px-3 text-xs font-medium text-muted-foreground shadow-none press hover:bg-muted hover:text-foreground', active && 'border-brand/30 bg-brand-subtle text-brand-subtle-foreground hover:bg-brand-subtle')}
        >
          <CalendarDays aria-hidden className="h-3 w-3 opacity-70" />
          {label}
          {active && <span className="font-medium">: {dateCodeLabel(code as string)}</span>}
          <ChevronDown aria-hidden className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div role="listbox" aria-label={label} className="space-y-0.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              role="option"
              aria-selected={code === p}
              onClick={() => onChange(code === p ? null : p)}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              {DATE_PRESET_LABELS[p]}
              {code === p && <Check aria-hidden className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
        <div className="mt-2 border-t border-border/70 pt-2">
          <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Between</p>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              aria-label={`${label} from`}
              value={range?.from ?? ''}
              onChange={(e) => onChange(rangeCode(e.target.value || null, range?.to ?? null))}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span aria-hidden className="text-xs text-muted-foreground">
              to
            </span>
            <input
              type="date"
              aria-label={`${label} to`}
              value={range?.to ?? ''}
              onChange={(e) => onChange(rangeCode(range?.from ?? null, e.target.value || null))}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
        {active && (
          <Button variant="ghost" size="sm" className="mt-2 h-7 w-full text-xs" onClick={() => onChange(null)}>
            Clear {label.toLowerCase()} filter
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
};

const Toggle: React.FC<{ pressed: boolean; onChange: (v: boolean) => void; children: React.ReactNode }> = ({ pressed, onChange, children }) => (
  <Button
    variant="outline"
    size="sm"
    aria-pressed={pressed}
    onClick={() => onChange(!pressed)}
    className={cn('h-8 shrink-0 gap-1 rounded-full border-transparent bg-muted/60 px-3 text-xs font-medium text-muted-foreground shadow-none press hover:bg-muted hover:text-foreground', pressed && 'border-brand/30 bg-brand-subtle text-brand-subtle-foreground hover:bg-brand-subtle')}
  >
    {children}
  </Button>
);

/** A small choice menu (group by, sort by). */
const MenuChoice: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (v: string) => void;
}> = ({ icon, label, value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? '';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`${label}: ${current}`} className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-xs font-normal text-muted-foreground press hover:bg-muted hover:text-foreground">
          {icon}
          <span className="hidden text-muted-foreground lg:inline">{label}:</span>
          <span className="font-medium text-foreground">{current}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        <div role="listbox" aria-label={label}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              {o.label}
              {o.value === value && <Check aria-hidden className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

/** The search box: what is typed shows at once, the database is asked once typing pauses. */
const SearchBox = forwardRef<HTMLInputElement, { value: string; onCommit: (text: string) => void; loading: boolean }>(({ value, onCommit, loading }, ref) => {
  const [text, setText] = useState(value);
  const committed = useRef(value);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  // the URL changed from outside (Clear filters, Back, a pasted link): follow it
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    if (text === committed.current) return;
    const timer = setTimeout(() => {
      committed.current = text;
      commit.current(text);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const clear = () => {
    committed.current = '';
    setText('');
    commit.current('');
  };

  return (
    <div className="relative min-w-[10rem] flex-1 sm:max-w-sm">
      <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            clear();
            e.currentTarget.blur();
          }
        }}
        placeholder="Search tasks, lists, people"
        aria-label="Search tasks"
        aria-busy={loading || undefined}
        className="focus-soft h-8 w-full rounded-full border border-transparent bg-muted/60 pl-8 pr-8 text-sm outline-none transition-colors placeholder:text-muted-foreground hover:bg-muted focus-visible:bg-background [&::-webkit-search-cancel-button]:hidden"
      />
      {loading ? (
        <Loader2 aria-label="Searching" className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : (
        text && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={clear}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden className="h-3 w-3" />
          </button>
        )
      )}
    </div>
  );
});
SearchBox.displayName = 'SearchBox';

interface TaskToolbarProps {
  view: TaskViewState;
  members: readonly WorkspaceMember[];
  /** Tasks shown now. */
  matched: number;
  /** The database is answering a new request (the previous answer is still on screen). */
  loading?: boolean;
  onFilters: (patch: Partial<TaskFilters>) => void;
  onView: (patch: Partial<TaskViewState>) => void;
  onClear: () => void;
  onNewTask?: () => void;
  /** Leading control (the List / Board / Table switcher). */
  lead?: React.ReactNode;
  /** Extra trailing controls (column chooser). */
  trail?: React.ReactNode;
  /** The board's columns are always the stages, so grouping is not offered there. */
  hideGroup?: boolean;
  groupOptions: ReadonlyArray<{ value: GroupBy; label: string }>;
  /** Space / folder / list filters, for views that span several lists. */
  scopeOptions?: ScopeOptions;
}

const personOptions = (members: readonly WorkspaceMember[], slot: 'EDITOR' | 'QC_REVIEWER'): Option[] => [
  { value: NOBODY, label: 'Nobody assigned' },
  ...eligibleAssignees(members, slot, null)
    .slice()
    .sort((a, b) => (a.profile?.fullName ?? '').localeCompare(b.profile?.fullName ?? ''))
    .map((m) => ({
      value: m.userId,
      label: m.profile?.fullName ?? m.userId,
      render: (
        <span className="flex items-center gap-2">
          <UserAvatar name={m.profile?.fullName} src={m.profile?.avatarUrl ?? undefined} size="xs" />
          {m.profile?.fullName}
        </span>
      ),
    })),
];

/**
 * The command strip of the task workspace: the search box, quick filters for the questions people ask
 * all day, property filters, grouping and sorting, and the chips that say what is on. Every filter goes
 * into the URL and is answered by the database.
 */
const TaskToolbar = forwardRef<HTMLInputElement, TaskToolbarProps>(
  ({ view, members, matched, loading = false, onFilters, onView, onClear, onNewTask, lead, trail, hideGroup, groupOptions, scopeOptions }, searchRef) => {
    const f = view.filters;
    const active = countActiveFilters(f);
    const workflow = useWorkflow().data;
    const statuses = useMemo(() => workflow?.statuses ?? [], [workflow]);
    const editorOptions = useMemo(() => personOptions(members, 'EDITOR'), [members]);
    const qcOptions = useMemo(() => personOptions(members, 'QC_REVIEWER'), [members]);
    const statusOptions = useMemo(() => statuses.map((s) => ({ value: s.key, label: s.name, render: <TaskStatusPill status={s.key} /> })), [statuses]);
    const priorityOptions = useMemo(() => TASK_PRIORITIES.map((p) => ({ value: p.value as string, label: p.label, render: <PriorityFlag priority={p.value} withLabel /> })), []);
    const aspectOptions = useMemo(() => ASPECT_RATIOS.map((a) => ({ value: a.value as string, label: a.label })), []);

    const labelIn = (options: readonly Option[], value: string) => options.find((o) => o.value === value)?.label ?? 'Unknown';
    const names = (options: readonly Option[], values: readonly string[]) => values.map((v) => labelIn(options, v)).join(', ');
    const nameOf = (id: string) => members.find((m) => m.userId === id)?.profile?.fullName ?? 'Former member';

    // what is on, as removable chips (the search text and the quick toggles included)
    const chips: Array<{ key: string; text: string; remove: () => void }> = [];
    if (f.search.trim()) chips.push({ key: 'q', text: `Search: "${f.search.trim()}"`, remove: () => onFilters({ search: '' }) });
    if (f.statuses.length) chips.push({ key: 'status', text: `Status: ${f.statuses.map((s) => statuses.find((x) => x.key === s)?.name ?? s).join(', ')}`, remove: () => onFilters({ statuses: [] }) });
    if (f.editors.length) chips.push({ key: 'editor', text: `Editor: ${f.editors.map((v) => (v === NOBODY ? 'Nobody' : nameOf(v))).join(', ')}`, remove: () => onFilters({ editors: [] }) });
    if (f.qcs.length) chips.push({ key: 'qc', text: `QC reviewer: ${f.qcs.map((v) => (v === NOBODY ? 'Nobody' : nameOf(v))).join(', ')}`, remove: () => onFilters({ qcs: [] }) });
    if (f.priorities.length) chips.push({ key: 'priority', text: `Priority: ${names(priorityOptions, f.priorities)}`, remove: () => onFilters({ priorities: [] }) });
    if (f.due) chips.push({ key: 'due', text: `QC due: ${dateCodeLabel(f.due)}`, remove: () => onFilters({ due: null }) });
    if (f.client) chips.push({ key: 'client', text: `Client deadline: ${dateCodeLabel(f.client)}`, remove: () => onFilters({ client: null }) });
    if (f.created) chips.push({ key: 'created', text: `Created: ${dateCodeLabel(f.created)}`, remove: () => onFilters({ created: null }) });
    if (f.aspectRatios.length) chips.push({ key: 'aspect', text: `Aspect ratio: ${f.aspectRatios.join(', ')}`, remove: () => onFilters({ aspectRatios: [] }) });
    if (scopeOptions) {
      if (f.spaces.length) chips.push({ key: 'space', text: `Space: ${names(scopeOptions.spaces, f.spaces)}`, remove: () => onFilters({ spaces: [] }) });
      if (f.folders.length) chips.push({ key: 'folder', text: `Folder: ${names(scopeOptions.folders, f.folders)}`, remove: () => onFilters({ folders: [] }) });
      if (f.lists.length) chips.push({ key: 'list', text: `List: ${names(scopeOptions.lists, f.lists)}`, remove: () => onFilters({ lists: [] }) });
    }
    if (f.mine) chips.push({ key: 'mine', text: 'Assigned to me', remove: () => onFilters({ mine: false }) });
    if (f.needsAction) chips.push({ key: 'needs', text: 'Needs my action', remove: () => onFilters({ needsAction: false }) });
    if (f.overdue) chips.push({ key: 'overdue', text: 'Overdue', remove: () => onFilters({ overdue: false }) });
    if (f.hideFinished) chips.push({ key: 'hide', text: 'Finished hidden', remove: () => onFilters({ hideFinished: false }) });

    return (
      <div className="flex flex-col gap-2.5" role="toolbar" aria-label="Task view">
        <div className="flex flex-wrap items-center gap-2">
          {lead}
          <SearchBox ref={searchRef} value={f.search} onCommit={(text) => onFilters({ search: text })} loading={loading} />
          <Toggle pressed={f.mine} onChange={(v) => onFilters({ mine: v })}>
            Assigned to me
          </Toggle>
          <Toggle pressed={f.needsAction} onChange={(v) => onFilters({ needsAction: v })}>
            Needs my action
          </Toggle>
          <Toggle pressed={f.overdue} onChange={(v) => onFilters({ overdue: v })}>
            Overdue
          </Toggle>
          <div className="ml-auto flex items-center gap-0.5">
            {!hideGroup && (
              <MenuChoice
                icon={<Layers aria-hidden className="h-3.5 w-3.5" />}
                label="Group"
                value={view.groupBy}
                options={groupOptions}
                onChange={(v) => onView({ groupBy: v as TaskViewState['groupBy'] })}
              />
            )}
            <MenuChoice
              icon={view.dir === 'asc' ? <ArrowUpNarrowWide aria-hidden className="h-3.5 w-3.5" /> : <ArrowDownNarrowWide aria-hidden className="h-3.5 w-3.5" />}
              label="Sort"
              value={view.sort}
              options={SORT_OPTIONS}
              onChange={(v) => onView({ sort: v as TaskViewState['sort'] })}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 rounded-full p-0 text-muted-foreground"
              aria-label={view.dir === 'asc' ? 'Sort ascending (switch to descending)' : 'Sort descending (switch to ascending)'}
              onClick={() => onView({ dir: view.dir === 'asc' ? 'desc' : 'asc' })}
            >
              {view.dir === 'asc' ? <ArrowUpNarrowWide className="h-4 w-4" /> : <ArrowDownNarrowWide className="h-4 w-4" />}
            </Button>
            {trail}
            <ShortcutsHint />
            {onNewTask && (
              <Button size="sm" className="press h-8 rounded-full px-3.5 shadow-soft" onClick={onNewTask} aria-label="New task">
                <Plus aria-hidden className="h-4 w-4 sm:mr-1" />
                <span aria-hidden className="hidden sm:inline">
                  New task
                </span>
              </Button>
            )}
          </div>
        </div>

        <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          <MultiFilter label="Status" selected={f.statuses} onChange={(v) => onFilters({ statuses: v as TaskFilters['statuses'] })} options={statusOptions} />
          <MultiFilter label="Editor" selected={f.editors} onChange={(v) => onFilters({ editors: v })} options={editorOptions} />
          <MultiFilter label="QC reviewer" selected={f.qcs} onChange={(v) => onFilters({ qcs: v })} options={qcOptions} />
          <MultiFilter label="Priority" selected={f.priorities} onChange={(v) => onFilters({ priorities: v as TaskFilters['priorities'] })} options={priorityOptions} />
          <DateFilterMenu label="QC due" code={f.due} presets={DUE_PRESETS} onChange={(code) => onFilters({ due: code })} />
          <DateFilterMenu label="Client deadline" code={f.client} presets={DUE_PRESETS} onChange={(code) => onFilters({ client: code })} />
          <DateFilterMenu label="Created" code={f.created} presets={CREATED_PRESETS} onChange={(code) => onFilters({ created: code })} />
          <MultiFilter label="Aspect ratio" selected={f.aspectRatios} onChange={(v) => onFilters({ aspectRatios: v as TaskFilters['aspectRatios'] })} options={aspectOptions} />
          {scopeOptions && (
            <>
              <MultiFilter label="Space" selected={f.spaces} onChange={(v) => onFilters({ spaces: v })} options={scopeOptions.spaces} />
              <MultiFilter label="Folder" selected={f.folders} onChange={(v) => onFilters({ folders: v })} options={scopeOptions.folders} />
              <MultiFilter label="List" selected={f.lists} onChange={(v) => onFilters({ lists: v })} options={scopeOptions.lists} />
            </>
          )}
          <Toggle pressed={f.hideFinished} onChange={(v) => onFilters({ hideFinished: v })}>
            Hide finished
          </Toggle>
          <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {active > 0 ? `${matched} ${matched === 1 ? 'task matches' : 'tasks match'}` : `${matched} ${matched === 1 ? 'task' : 'tasks'}`}
          </span>
        </div>

        {chips.length > 0 && (
          <ul aria-label="Active filters" className="flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={c.remove}
                  aria-label={`Remove filter: ${c.text}`}
                  className="press inline-flex max-w-[18rem] items-center gap-1 rounded-full border border-brand/25 bg-brand-subtle px-2.5 py-0.5 text-xs text-brand-subtle-foreground outline-none hover:bg-brand-subtle/70 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="truncate">{c.text}</span>
                  <X aria-hidden className="h-3 w-3 shrink-0" />
                </button>
              </li>
            ))}
            <li>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClear}>
                Clear filters
              </Button>
            </li>
          </ul>
        )}
      </div>
    );
  }
);
TaskToolbar.displayName = 'TaskToolbar';

const SHORTCUTS: Array<[string, string]> = [
  ['/', 'Search'],
  ['N', 'New task (title only)'],
  ['J / K or ↓ / ↑', 'Next / previous task'],
  ['Enter', 'Open task'],
  ['X', 'Select / unselect task'],
  ['Esc', 'Clear selection'],
  ['Ctrl / Cmd + K', 'Find any task or page'],
];

const ShortcutsHint: React.FC = () => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="sm" className="hidden h-8 w-8 p-0 md:inline-flex" aria-label="Keyboard shortcuts">
        <Keyboard className="h-4 w-4" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-64 p-3">
      <p className="mb-2 text-xs font-semibold">Keyboard shortcuts</p>
      <dl className="space-y-1 text-xs">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{v}</dt>
            <dd>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{k}</kbd>
            </dd>
          </div>
        ))}
      </dl>
    </PopoverContent>
  </Popover>
);

export default TaskToolbar;
