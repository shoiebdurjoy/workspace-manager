import React, { forwardRef, useState } from 'react';
import { ArrowDownNarrowWide, ArrowUpNarrowWide, Check, ChevronDown, Keyboard, Layers, Plus, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { UserAvatar } from '@/components/ui/user-avatar';
import { TASK_PRIORITIES } from '@/lib/tasks';
import { useWorkflow } from '@/hooks/use-workflow';
import {
  GROUP_OPTIONS,
  SORT_OPTIONS,
  UNASSIGNED,
  countActiveFilters,
  type TaskFilters,
  type TaskViewState,
} from '@/lib/task-view';
import type { WorkspaceMember } from '@/types/database';
import { PriorityFlag, TaskStatusPill } from './TaskBadges';

interface Option {
  value: string;
  label: string;
  render?: React.ReactNode;
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
          className={cn('h-8 gap-1 px-2.5 text-xs font-normal', selected.length > 0 && 'border-brand/50 bg-brand-subtle text-brand-subtle-foreground')}
        >
          {label}
          {selected.length > 0 && <span className="rounded bg-brand px-1 text-[10px] font-semibold text-white">{selected.length}</span>}
          <ChevronDown aria-hidden className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0">
        <Command shouldFilter={false}>
          {options.length > 6 && <CommandInput value={query} onValueChange={setQuery} placeholder={`Search ${label.toLowerCase()}...`} />}
          <CommandList>
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

const Toggle: React.FC<{ pressed: boolean; onChange: (v: boolean) => void; children: React.ReactNode }> = ({ pressed, onChange, children }) => (
  <Button
    variant="outline"
    size="sm"
    aria-pressed={pressed}
    onClick={() => onChange(!pressed)}
    className={cn('h-8 px-2.5 text-xs font-normal', pressed && 'border-brand/50 bg-brand-subtle text-brand-subtle-foreground')}
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
        <Button variant="ghost" size="sm" aria-label={`${label}: ${current}`} className="h-8 gap-1.5 px-2 text-xs font-normal">
          {icon}
          <span className="hidden text-muted-foreground lg:inline">{label}:</span>
          <span className="font-medium">{current}</span>
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

interface TaskToolbarProps {
  view: TaskViewState;
  members: readonly WorkspaceMember[];
  total: number;
  matched: number;
  onFilters: (patch: Partial<TaskFilters>) => void;
  onView: (patch: Partial<TaskViewState>) => void;
  onClear: () => void;
  onNewTask?: () => void;
}

/**
 * The list's command strip: search, quick filters for the questions people ask all day ("what's
 * mine?", "what's waiting on me?", "what's late?"), property filters, grouping and sorting, and the new-task button. All of it
 * works on the list's loaded rows and is remembered per list.
 */
const TaskToolbar = forwardRef<HTMLInputElement, TaskToolbarProps>(
  ({ view, members, total, matched, onFilters, onView, onClear, onNewTask }, searchRef) => {
    const f = view.filters;
    const active = countActiveFilters(f);
    const staff = members.filter((m) => m.role !== 'CLIENT_VIEWER');
    const statuses = useWorkflow().data?.statuses ?? [];
    return (
      <div className="flex flex-col gap-2" role="toolbar" aria-label="Task view">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[10rem] flex-1 sm:max-w-xs">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              type="search"
              value={f.search}
              onChange={(e) => onFilters({ search: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  onFilters({ search: '' });
                  e.currentTarget.blur();
                }
              }}
              placeholder="Search tasks"
              aria-label="Search tasks"
              className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <Toggle pressed={f.mine} onChange={(v) => onFilters({ mine: v })}>
            Assigned to me
          </Toggle>
          <Toggle pressed={f.needsAction} onChange={(v) => onFilters({ needsAction: v })}>
            Needs my action
          </Toggle>
          <Toggle pressed={f.overdue} onChange={(v) => onFilters({ overdue: v })}>
            Overdue
          </Toggle>
          <div className="ml-auto flex items-center gap-1">
            <MenuChoice
              icon={<Layers aria-hidden className="h-3.5 w-3.5" />}
              label="Group"
              value={view.groupBy}
              options={GROUP_OPTIONS}
              onChange={(v) => onView({ groupBy: v as TaskViewState['groupBy'] })}
            />
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
              className="h-8 w-8 p-0"
              aria-label={view.dir === 'asc' ? 'Sort ascending (switch to descending)' : 'Sort descending (switch to ascending)'}
              onClick={() => onView({ dir: view.dir === 'asc' ? 'desc' : 'asc' })}
            >
              {view.dir === 'asc' ? <ArrowUpNarrowWide className="h-4 w-4" /> : <ArrowDownNarrowWide className="h-4 w-4" />}
            </Button>
            <ShortcutsHint />
            {onNewTask && (
              <Button size="sm" className="h-8" onClick={onNewTask} aria-label="New task">
                <Plus aria-hidden className="h-4 w-4 sm:mr-1" />
                <span aria-hidden className="hidden sm:inline">
                  New task
                </span>
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MultiFilter
            label="Status"
            selected={f.statuses}
            onChange={(v) => onFilters({ statuses: v as TaskFilters['statuses'] })}
            options={statuses.map((s) => ({ value: s.key, label: s.name, render: <TaskStatusPill status={s.key} /> }))}
          />
          <MultiFilter
            label="People"
            selected={f.people}
            onChange={(v) => onFilters({ people: v })}
            options={[
              { value: UNASSIGNED, label: 'Nobody assigned' },
              ...staff
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
            ]}
          />
          <MultiFilter
            label="Priority"
            selected={f.priorities}
            onChange={(v) => onFilters({ priorities: v as TaskFilters['priorities'] })}
            options={TASK_PRIORITIES.map((p) => ({ value: p.value, label: p.label, render: <PriorityFlag priority={p.value} withLabel /> }))}
          />
          <Toggle pressed={f.hideFinished} onChange={(v) => onFilters({ hideFinished: v })}>
            Hide finished
          </Toggle>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {active > 0 ? `${matched} of ${total} tasks` : `${total} ${total === 1 ? 'task' : 'tasks'}`}
          </span>
          {active > 0 && (
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={onClear}>
              <X className="mr-1 h-3.5 w-3.5" />
              Clear filters
            </Button>
          )}
        </div>
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
