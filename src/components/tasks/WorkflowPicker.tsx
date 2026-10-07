import React, { useRef, useState } from 'react';
import { ArrowRight, ChevronDown, CornerUpLeft, ShieldAlert, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { useAuth } from '@/hooks/use-auth';
import { useWorkflow } from '@/hooks/use-workflow';
import { movesFor, REQUIREMENT_LABELS, stageNumber, type Move } from '@/lib/workflow';
import type { WorkspaceMember } from '@/types/database';
import { useMoveFlow, type WorkflowTaskRef } from './use-move-flow';
import { TaskStatusPill } from './TaskBadges';

const KIND_ICON = {
  forward: <ArrowRight aria-hidden className="h-3.5 w-3.5 text-primary" />,
  reject: <CornerUpLeft aria-hidden className="h-3.5 w-3.5 text-destructive" />,
  back: <Undo2 aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />,
} as const;

interface WorkflowPickerProps {
  task: WorkflowTaskRef;
  members?: readonly WorkspaceMember[];
  /** "cell" is the compact list-row pill; "field" fills a property row (detail panel). */
  variant?: 'cell' | 'field';
  label?: string;
  align?: 'start' | 'center' | 'end';
}

/**
 * The one control for a task's stage. It shows the current stage; opened, it lists the steps this
 * person can take from here (with the action's name: "Submit for QC"), then any admin override, then
 * the stages they cannot reach with the reason. Used in list rows and the detail panel alike.
 */
const WorkflowPicker: React.FC<WorkflowPickerProps> = ({ task, members = [], variant = 'cell', label = 'Status', align = 'start' }) => {
  const { role, user } = useAuth();
  const workflow = useWorkflow().data;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // a move that asks for something opens a dialog: the closing popover must not pull focus back to
  // its trigger, or the dialog would see focus leave and close at once
  const toDialog = useRef(false);
  const { start, dialog, pending } = useMoveFlow(task, members);

  const moves = movesFor(workflow, task, { role, isAssignedEditor: !!user && task.editorId === user.id });
  const editable = moves.some((m) => m.allowed);
  const needle = query.trim().toLowerCase();
  const shown = moves.filter((m) => !needle || `${m.label} ${m.to.name}`.toLowerCase().includes(needle));
  const steps = shown.filter((m) => m.allowed && !m.override);
  const overrides = shown.filter((m) => m.override);
  const blocked = shown.filter((m) => !m.allowed);
  const stage = stageNumber(workflow, task.status);

  const pill = <TaskStatusPill status={task.status} plain={variant === 'field'} />;

  if (!editable) {
    const why = moves[0]?.reason ?? undefined;
    return (
      <span className={cn('inline-flex max-w-full', variant === 'field' && 'h-8 items-center px-2')} title={why}>
        {pill}
      </span>
    );
  }

  const choose = (m: Move) => {
    toDialog.current = m.needs.length > 0;
    setOpen(false);
    start(m);
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setQuery('');
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-busy={pending || undefined}
            disabled={pending}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'group/status inline-flex min-w-0 max-w-full items-center rounded-full text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait',
              variant === 'field' && 'h-8 w-full justify-between rounded-md px-2 hover:bg-muted data-[state=open]:bg-muted'
            )}
          >
            {variant === 'field' ? (
              <>
                {pill}
                <ChevronDown aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
              </>
            ) : (
              <TaskStatusPill
                status={task.status}
                className="cursor-pointer transition-[filter,box-shadow] group-hover/status:brightness-95 group-data-[state=open]/status:ring-2 group-data-[state=open]/status:ring-ring"
              />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align={align}
          className="w-72 p-0"
          onClick={(e) => e.stopPropagation()}
          onCloseAutoFocus={(e) => {
            if (toDialog.current) e.preventDefault();
            toDialog.current = false;
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
            <TaskStatusPill status={task.status} />
            {stage > 0 && workflow && (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                Stage {stage} of {workflow.statuses.length}
              </span>
            )}
          </div>
          <Command shouldFilter={false}>
            <CommandInput value={query} onValueChange={setQuery} placeholder="Search stages..." aria-label="Search stages" />
            <CommandList className="max-h-80">
              {shown.length === 0 && <div className="px-3 py-4 text-center text-xs text-muted-foreground">No match.</div>}
              {steps.length > 0 && (
                <CommandGroup heading="Next steps">
                  {steps.map((m) => (
                    <CommandItem key={m.to.key} value={`step:${m.to.key}`} onSelect={() => choose(m)} className="flex-col items-start gap-1 py-2">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        {m.transition && KIND_ICON[m.transition.kind]}
                        {m.label}
                      </span>
                      <span className="ml-5 flex flex-wrap items-center gap-1.5">
                        <TaskStatusPill status={m.to.key} />
                        {m.needs.length > 0 && (
                          <span className="text-[11px] text-muted-foreground">asks for {m.needs.map((n) => REQUIREMENT_LABELS[n]).join(', ')}</span>
                        )}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {overrides.length > 0 && (
                <>
                  {steps.length > 0 && <CommandSeparator />}
                  <CommandGroup heading="Admin override">
                    {overrides.map((m) => (
                      <CommandItem key={m.to.key} value={`override:${m.to.key}`} onSelect={() => choose(m)} className="gap-2">
                        <ShieldAlert aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <TaskStatusPill status={m.to.key} />
                        <span className="sr-only">(override)</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
              {blocked.length > 0 && (
                <>
                  {(steps.length > 0 || overrides.length > 0) && <CommandSeparator />}
                  <CommandGroup heading="Not available">
                    {blocked.map((m) => (
                      <CommandItem key={m.to.key} value={`blocked:${m.to.key}`} disabled className="flex-col items-start gap-0.5 py-1.5">
                        <TaskStatusPill status={m.to.key} className="opacity-70" />
                        <span className="text-[11px] text-muted-foreground">{m.reason}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {dialog}
    </>
  );
};

export default WorkflowPicker;
