import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Pause, Play, Plus, Repeat, Timer, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  addDependency,
  addManualTime,
  deleteTimeEntry,
  getDependencies,
  getRepeat,
  getRunningTimer,
  getTimeEstimate,
  listTimeEntries,
  removeDependency,
  searchTasksByTitle,
  setRepeat,
  setTimeEstimate,
  startTimer,
  stopTimer,
  type RepeatUnit,
} from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { entryMinutes, formatMinutes } from '@/lib/time-format';
import { useWorkspaceMembers } from '@/hooks/use-team';
import { useWorkflow } from '@/hooks/use-workflow';
import { TaskStatusPill } from './TaskBadges';
import { cn } from '@/lib/utils';

const MANAGERS = ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'];
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : 'That did not save.');

/** Repeat: Off, or every N days / weeks / months (the next video is made when this one is closed). */
export const RepeatField: React.FC<{ taskId: string }> = ({ taskId }) => {
  const { role } = useAuth();
  const qc = useQueryClient();
  const key = ['task-repeat', taskId];
  const rule = useQuery({ queryKey: key, queryFn: () => getRepeat(taskId) });
  const save = useMutation({ mutationFn: (r: Parameters<typeof setRepeat>[1]) => setRepeat(taskId, r), onSuccess: () => qc.invalidateQueries({ queryKey: key }), onError: fail });
  const canEdit = !!role && MANAGERS.includes(role);
  const r = rule.data;
  const label = r ? `Every ${r.every === 1 ? '' : `${r.every} `}${r.unit}${r.every === 1 ? '' : 's'}` : 'Does not repeat';
  const summary = (
    <span className="flex items-center gap-1.5">
      {r ? <Repeat className="h-3.5 w-3.5 text-primary" /> : null}
      <span className={r ? '' : 'text-muted-foreground/70'}>{label}</span>
    </span>
  );
  if (!canEdit) return <span className="flex h-8 items-center px-2 text-sm">{summary}</span>;
  // the controls live in a popover, so the panel stays calm until someone opens it
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Repeat: ${label}`} className="flex h-8 w-full items-center rounded-md px-2 text-left text-sm hover:bg-muted">
          {summary}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2 p-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!r} onChange={(e) => save.mutate(e.target.checked ? { every: 1, unit: 'week', copyPeople: true } : null)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
          Repeat this video
        </label>
        {r && (
          <>
            <div className="flex items-center gap-1.5 text-sm">
              every
              <Input type="number" min={1} max={365} aria-label="Every how many" defaultValue={r.every} key={`${r.every}`} onBlur={(e) => { const n = Math.max(1, Math.min(365, Number(e.target.value) || 1)); if (n !== r.every) save.mutate({ ...r, every: n }); }} className="h-8 w-16" />
              <div role="radiogroup" aria-label="Repeat unit" className="flex gap-1">
                {(['day', 'week', 'month'] as RepeatUnit[]).map((u) => (
                  <button key={u} type="button" role="radio" aria-checked={r.unit === u} onClick={() => save.mutate({ ...r, unit: u })} className={cn('rounded-md border px-2 py-1 text-xs', r.unit === u ? 'border-primary/50 bg-primary/10' : 'border-border text-muted-foreground')}>
                    {u}s
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={r.copyPeople} onChange={(e) => save.mutate({ ...r, copyPeople: e.target.checked })} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" /> Same editor and QC reviewer
            </label>
            <p className="text-[11px] text-muted-foreground">When this video is closed, the next one is created with its dates moved forward.</p>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};

/** Waiting on: the videos this one waits for (red while still open), and what it is blocking. */
export const DependenciesField: React.FC<{ taskId: string }> = ({ taskId }) => {
  const { role, workspace } = useAuth();
  const qc = useQueryClient();
  const workflow = useWorkflow().data;
  const key = ['task-deps', taskId];
  const deps = useQuery({ queryKey: key, queryFn: () => getDependencies(taskId) });
  const [text, setText] = useState('');
  const found = useQuery({ queryKey: ['task-search', workspace?.id, text, taskId], queryFn: () => searchTasksByTitle(workspace?.id ?? '', text, taskId), enabled: !!workspace });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const add = useMutation({ mutationFn: (id: string) => addDependency(taskId, id), onSuccess: refresh, onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => removeDependency(taskId, id), onSuccess: refresh, onError: fail });
  const canEdit = !!role && MANAGERS.includes(role);
  const closed = (status: string) => workflow?.statuses.find((s) => s.key === status)?.category === 'COMPLETED';
  const waiting = deps.data?.waitingOn ?? [];
  const open = waiting.filter((t) => !closed(t.status)).length;
  return (
    <div className="space-y-1 px-1 py-1">
      {waiting.length === 0 && !canEdit && <span className="px-1 text-sm text-muted-foreground/70">Nothing</span>}
      {open > 0 && <p className="px-1 text-[11px] font-medium text-destructive">Waiting on {open} open video{open === 1 ? '' : 's'}</p>}
      <ul className="space-y-0.5">
        {waiting.map((t) => (
          <li key={t.id} className="flex items-center gap-1.5 text-sm">
            <Link2 aria-hidden className={cn('h-3.5 w-3.5 shrink-0', closed(t.status) ? 'text-emerald-500' : 'text-destructive')} />
            <span className={cn('min-w-0 flex-1 truncate', closed(t.status) && 'text-muted-foreground line-through')}>{t.title}</span>
            <TaskStatusPill status={t.status} className="shrink-0 text-[10px]" />
            {canEdit && (
              <button type="button" aria-label={`Stop waiting on ${t.title}`} onClick={() => remove.mutate(t.id)} className="rounded p-0.5 text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {(deps.data?.blocking.length ?? 0) > 0 && <p className="px-1 text-[11px] text-muted-foreground">Blocking: {deps.data?.blocking.map((t) => t.title).join(', ')}</p>}
      {canEdit && (
        <Popover onOpenChange={(o) => !o && setText('')}>
          <PopoverTrigger asChild>
            <button type="button" className="press flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground">
              <Plus className="h-3 w-3" /> Wait on a video
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Search videos" aria-label="Search videos" className="mb-1.5 h-8 text-sm" />
            <ul className="max-h-56 overflow-y-auto">
              {(found.data ?? []).filter((t) => !waiting.some((w) => w.id === t.id)).map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => add.mutate(t.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <TaskStatusPill status={t.status} className="shrink-0 text-[10px]" />
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};

/** Time: start / stop your timer, add time by hand, the estimate, and everyone's entries. */
export const TimeSection: React.FC<{ taskId: string; canLog: boolean }> = ({ taskId, canLog }) => {
  const { role, user } = useAuth();
  const me = user?.id ?? '';
  const qc = useQueryClient();
  const members = useWorkspaceMembers().data ?? [];
  const entries = useQuery({ queryKey: ['task-time', taskId], queryFn: () => listTimeEntries(taskId) });
  const running = useQuery({ queryKey: ['my-timer', me], queryFn: () => getRunningTimer(me), enabled: !!me });
  const estimate = useQuery({ queryKey: ['task-estimate', taskId], queryFn: () => getTimeEstimate(taskId) });
  const [, tick] = useState(0);
  const [manual, setManual] = useState({ minutes: '', day: new Date().toISOString().slice(0, 10), note: '' });
  const isManager = !!role && MANAGERS.includes(role);
  const mineHere = running.data?.taskId === taskId ? running.data : null;
  useEffect(() => {
    if (!mineHere) return;
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [mineHere]);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['task-time', taskId] }), qc.invalidateQueries({ queryKey: ['my-timer', me] })]);
  const run = async (what: () => Promise<void>) => {
    try {
      await what();
      await refresh();
    } catch (e) {
      fail(e);
    }
  };
  const total = (entries.data ?? []).reduce((n, e) => n + entryMinutes(e), 0);
  const est = estimate.data;
  const name = (id: string) => members.find((m) => m.userId === id)?.profile?.fullName ?? 'Someone';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {canLog && <Button type="button" size="sm" variant={mineHere ? 'destructive' : 'default'} onClick={() => void run(() => (mineHere ? stopTimer(mineHere.id, mineHere.startedAt) : startTimer(taskId, me)))}>
          {mineHere ? <><Pause className="mr-1 h-3.5 w-3.5" /> Stop · {formatMinutes(entryMinutes({ startedAt: mineHere.startedAt, endedAt: null }))}</> : <><Play className="mr-1 h-3.5 w-3.5" /> Start timer</>}
        </Button>}
        <span className="text-sm"><Timer aria-hidden className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" />{formatMinutes(total)} tracked</span>
        {est ? (
          <span className={cn('text-xs', total > est ? 'text-destructive' : 'text-muted-foreground')}>of {formatMinutes(est)} estimated</span>
        ) : null}
        {isManager && (
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            estimate (min)
            <Input type="number" min={1} max={100000} defaultValue={est ?? ''} key={`${est}`} aria-label="Time estimate in minutes" className="h-7 w-20"
              onBlur={(e) => { const v = e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null; if (v !== est) void setTimeEstimate(taskId, v).then(() => qc.invalidateQueries({ queryKey: ['task-estimate', taskId] })).catch(fail); }} />
          </label>
        )}
      </div>
      {canLog && running.data && !mineHere && <p className="text-[11px] text-muted-foreground">Your timer is running on another video; starting here stops it there.</p>}
      {canLog && <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); const m = Math.round(Number(manual.minutes)); if (!m || m < 1 || m > 1440) return void toast.error('Enter 1 to 1440 minutes.'); void run(() => addManualTime(taskId, m, manual.day, manual.note)).then(() => setManual((x) => ({ ...x, minutes: '', note: '' }))); }}>
        <Input type="number" min={1} max={1440} value={manual.minutes} onChange={(e) => setManual({ ...manual, minutes: e.target.value })} placeholder="min" aria-label="Minutes to add" className="h-8 w-20" />
        <Input type="date" value={manual.day} onChange={(e) => setManual({ ...manual, day: e.target.value })} aria-label="Day" className="h-8 w-36" />
        <Input value={manual.note} onChange={(e) => setManual({ ...manual, note: e.target.value })} placeholder="What for (optional)" aria-label="Note" maxLength={500} className="h-8 min-w-[8rem] flex-1" />
        <Button type="submit" size="sm" variant="outline">Add time</Button>
      </form>}
      {(entries.data ?? []).length > 0 && (
        <ul className="divide-y divide-border/50 text-xs">
          {(entries.data ?? []).slice(0, 20).map((e) => (
            <li key={e.id} className="flex items-center gap-2 py-1.5">
              <span className="font-medium">{name(e.userId)}</span>
              <span className="text-muted-foreground">{new Date(e.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.note ?? ''}</span>
              <span className="tabular-nums">{e.endedAt ? formatMinutes(entryMinutes(e)) : 'running'}</span>
              {(e.userId === me || isManager) && e.endedAt && (
                <button type="button" aria-label="Delete this time" onClick={() => window.confirm('Delete this time entry?') && void run(() => deleteTimeEntry(e.id))} className="rounded p-0.5 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
