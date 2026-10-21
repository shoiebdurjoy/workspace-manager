import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, ArrowUp, ChevronRight, Lock, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  createWorkflowStatus,
  deleteWorkflowStatus,
  deleteWorkflowTransition,
  saveWorkflowTransition,
  statusKeyFor,
  updateWorkflowStatus,
} from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { useWorkflow, workflowKeys } from '@/hooks/use-workflow';
import { cn } from '@/lib/utils';
import type { TbbRole, WorkflowStatus, WorkflowTransition } from '@/types/database';

const PALETTE = ['#94A3B8', '#64748B', '#F97316', '#EA580C', '#EAB308', '#CA8A04', '#22C55E', '#16A34A', '#0EA5E9', '#3B82F6', '#EC4899', '#EF4444', '#DC2626', '#14B8A6', '#A855F7', '#15803D'];

const CATEGORIES: { value: WorkflowStatus['category']; label: string }[] = [
  { value: 'NOT_STARTED', label: 'Not started' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'IN_REVIEW', label: 'In review (QC)' },
  { value: 'READY', label: 'Ready' },
  { value: 'CLIENT', label: 'With client' },
  { value: 'COMPLETED', label: 'Closed' },
];

const ROLE_CHIPS: { role: TbbRole; label: string }[] = [
  { role: 'ADMIN', label: 'Admin' },
  { role: 'PRODUCTION_MANAGER', label: 'Manager' },
  { role: 'QC_SPECIALIST', label: 'QC' },
  { role: 'EDITOR', label: 'Editor' },
];

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'That did not save. Please try again.');

/**
 * Settings > Customize > Statuses (Owner / Admin). Rename, recolour, re-order, re-categorise, add and delete
 * stages, and choose the moves out of each one and who may make them. Every change saves at once; the database
 * refuses what is not allowed (deleting a stage that still holds tasks, the starting stage, ...) and the message
 * is shown as is.
 */
const StatusEditor: React.FC = () => {
  const { data: wf, isLoading, isError } = useWorkflow();
  const { workspace } = useAuth();
  const queryClient = useQueryClient();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<WorkflowStatus['category']>('IN_PROGRESS');
  const [busy, setBusy] = useState(false);

  if (isLoading) return <Skeleton className="h-64 w-full rounded-card" />;
  if (isError || !wf) return <p className="text-sm text-destructive">The statuses could not be loaded.</p>;

  const refresh = () => queryClient.invalidateQueries({ queryKey: workflowKeys.workflow(workspace?.id ?? '') });
  const run = async (what: () => Promise<void>, done?: string) => {
    setBusy(true);
    try {
      await what();
      await refresh();
      if (done) toast.success(done);
    } catch (e) {
      toast.error(errorText(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const statuses = wf.statuses;
  const swap = (i: number, j: number) =>
    run(async () => {
      const a = statuses[i];
      const b = statuses[j];
      await updateWorkflowStatus(wf.id, a.key, { position: b.position });
      await updateWorkflowStatus(wf.id, b.key, { position: a.position });
    });

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    const open = statuses.filter((s) => s.category !== 'COMPLETED');
    const closed = statuses.filter((s) => s.category === 'COMPLETED');
    const position = (open.at(-1)?.position ?? 0) + 1;
    void run(async () => {
      // keep the closed stages last, like ClickUp
      for (const c of closed) if (c.position <= position) await updateWorkflowStatus(wf.id, c.key, { position: c.position + 2 });
      await createWorkflowStatus(wf.id, { key: statusKeyFor(name, statuses.map((s) => s.key)), name: name.toUpperCase(), color: PALETTE[statuses.length % PALETTE.length], category: newCategory, position });
      setNewName('');
    }, `${name.toUpperCase()} added`);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Changes apply to every list at once. A status that still holds videos cannot be deleted; move them first. Owners always keep every move.
      </p>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-card border border-border/70">
        {statuses.map((s, i) => {
          const moves = wf.transitions.filter((t) => t.from === s.key);
          const open = openKey === s.key;
          return (
            <li key={s.key} className="bg-background/40">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  aria-label={`${open ? 'Hide' : 'Show'} moves from ${s.name}`}
                  aria-expanded={open}
                  onClick={() => setOpenKey(open ? null : s.key)}
                  className="press rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight aria-hidden className={cn('h-4 w-4 transition-transform duration-200', open && 'rotate-90')} />
                </button>
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" aria-label={`Colour of ${s.name}`} className="press h-5 w-5 shrink-0 rounded-full ring-2 ring-background shadow" style={{ background: s.color }} />
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-2">
                    <div className="grid grid-cols-8 gap-1.5">
                      {PALETTE.map((c) => (
                        <button key={c} type="button" aria-label={c} onClick={() => void run(() => updateWorkflowStatus(wf.id, s.key, { color: c }))} className={cn('press h-6 w-6 rounded-full', c.toLowerCase() === s.color.toLowerCase() && 'ring-2 ring-ring ring-offset-2 ring-offset-background')} style={{ background: c }} />
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Input
                  key={`${s.key}-${s.name}`}
                  defaultValue={s.name}
                  aria-label={`Name of ${s.name}`}
                  maxLength={60}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== s.name) void run(() => updateWorkflowStatus(wf.id, s.key, { name: v }));
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  className="h-8 min-w-[10rem] flex-1 font-medium uppercase"
                />
                <Select value={s.category} onValueChange={(v) => void run(() => updateWorkflowStatus(wf.id, s.key, { category: v as WorkflowStatus['category'] }))}>
                  <SelectTrigger aria-label={`Group of ${s.name}`} className="h-8 w-[9.5rem] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[11px] tabular-nums text-muted-foreground">{moves.length} moves</span>
                <div className="ml-auto flex items-center">
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Move ${s.name} up`} disabled={busy || i === 0} onClick={() => void swap(i, i - 1)}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Move ${s.name} down`} disabled={busy || i === statuses.length - 1} onClick={() => void swap(i, i + 1)}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  {s.isInitial ? (
                    <span className="flex h-7 w-7 items-center justify-center text-muted-foreground" title="The starting status cannot be deleted">
                      <Lock className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${s.name}`}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Delete ${s.name}? Its moves are removed too. This only works when no video is in it.`)) void run(() => deleteWorkflowStatus(wf.id, s.key), `${s.name} deleted`);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} className="overflow-hidden">
                    <MovesEditor workflowId={wf.id} status={s} statuses={statuses} moves={moves} busy={busy} run={run} />
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New status, e.g. COLOR GRADING" aria-label="New status name" maxLength={60} className="h-9 min-w-[12rem] flex-1" />
        <Select value={newCategory} onValueChange={(v) => setNewCategory(v as WorkflowStatus['category'])}>
          <SelectTrigger aria-label="New status group" className="h-9 w-[10rem] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" size="sm" disabled={busy || !newName.trim()}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add status
        </Button>
      </form>
    </div>
  );
};

const MovesEditor: React.FC<{
  workflowId: string;
  status: WorkflowStatus;
  statuses: WorkflowStatus[];
  moves: WorkflowTransition[];
  busy: boolean;
  run: (what: () => Promise<void>, done?: string) => Promise<void>;
}> = ({ workflowId, status, statuses, moves, busy, run }) => {
  const targets = statuses.filter((t) => t.key !== status.key && !moves.some((m) => m.to === t.key));
  const save = (m: WorkflowTransition) => run(() => saveWorkflowTransition(workflowId, { ...m, roles: Array.from(new Set<TbbRole>(['OWNER', ...m.roles])) }));
  return (
    <div className="space-y-2 border-t border-border/50 bg-muted/30 px-4 py-3 pl-10">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Moves from {status.name}</p>
      {moves.length === 0 && <p className="text-xs text-muted-foreground">No moves: videos in this status cannot leave it. Add one below.</p>}
      {moves.map((m) => {
        const to = statuses.find((t) => t.key === m.to);
        return (
          <div key={m.to} className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: to?.color ?? '#64748B' }}>
              {to?.name ?? m.to}
            </span>
            <Input
              key={`${m.to}-${m.label}`}
              defaultValue={m.label}
              aria-label={`Button text for the move to ${to?.name}`}
              maxLength={60}
              onBlur={(e) => e.target.value.trim() !== m.label && void save({ ...m, label: e.target.value })}
              className="h-7 w-44 text-xs"
            />
            <div className="flex flex-wrap gap-1" role="group" aria-label="Who may make this move">
              {ROLE_CHIPS.map((r) => {
                const on = m.roles.includes(r.role);
                return (
                  <button
                    key={r.role}
                    type="button"
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => void save({ ...m, roles: on ? m.roles.filter((x) => x !== r.role) : [...m.roles, r.role] })}
                    className={cn('press rounded-full border px-2 py-0.5 text-[11px] transition-colors', on ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" aria-label={`Remove the move to ${to?.name}`} disabled={busy} onClick={() => void run(() => deleteWorkflowTransition(workflowId, m.from, m.to))}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        );
      })}
      {targets.length > 0 && (
        <Select
          value=""
          onValueChange={(to) => {
            const target = statuses.find((t) => t.key === to);
            if (!target) return;
            const kind: WorkflowTransition['kind'] = target.position > status.position ? 'forward' : 'back';
            void save({ from: status.key, to, label: `Move to ${target.name.toLowerCase()}`, kind, roles: ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'] });
          }}
        >
          <SelectTrigger aria-label={`Add a move from ${status.name}`} className="h-7 w-56 text-xs">
            <SelectValue placeholder="+ Allow a move to..." />
          </SelectTrigger>
          <SelectContent>
            {targets.map((t) => (
              <SelectItem key={t.key} value={t.key}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
};

export default StatusEditor;
