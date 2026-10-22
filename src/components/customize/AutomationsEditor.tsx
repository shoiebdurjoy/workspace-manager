import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Plus, Trash2, Workflow, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { createAutomation, deleteAutomation, listAutomations, updateAutomation, type Automation, type AutomationAction, type AutomationInput } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { useCustomFields } from '@/hooks/use-custom-fields';
import { useHierarchy } from '@/hooks/use-hierarchy';
import { useTags } from '@/hooks/use-tags';
import { useWorkspaceMembers } from '@/hooks/use-team';
import { useWorkflow } from '@/hooks/use-workflow';
import { validateFieldValue } from '@/lib/custom-fields';
import { cn } from '@/lib/utils';

const SELECT = 'focus-soft h-9 rounded-control border border-input bg-background px-2 text-sm outline-none';

const ACTION_LABELS: Record<AutomationAction['type'], string> = {
  set_priority: 'Set priority',
  set_due_in_days: 'Set QC due date',
  add_tag: 'Add a tag',
  assign_editor: 'Assign an editor',
  assign_qc: 'Assign a QC reviewer',
  set_field: 'Fill in a field',
  notify: 'Notify someone',
};

const blankAction = (type: AutomationAction['type']): AutomationAction => {
  switch (type) {
    case 'set_priority':
      return { type, priority: 'HIGH' };
    case 'set_due_in_days':
      return { type, days: 2 };
    case 'notify':
      return { type, to: 'editor', message: '' };
    case 'set_field':
      return { type, field_id: '', value: '' };
    case 'add_tag':
      return { type, tag_id: '' };
    default:
      return { type, user_id: '' } as AutomationAction;
  }
};

/**
 * Settings > Customize workspace > Automations. WHEN a video is created / moves to a status / gets a tag
 * [in a folder], THEN up to 5 actions. The database runs them right after the change, for every screen.
 * Owner / Admin edit; production managers can read them, to know why something happened.
 */
const AutomationsEditor: React.FC = () => {
  const { workspace, role } = useAuth();
  const ws = workspace?.id ?? '';
  const qc = useQueryClient();
  const canEdit = role === 'OWNER' || role === 'ADMIN';
  const key = ['workspace', ws, 'automations'];
  const autos = useQuery({ queryKey: key, queryFn: () => listAutomations(ws), enabled: !!ws });
  const statuses = useWorkflow().data?.statuses ?? [];
  const tags = useTags().data ?? [];
  const folders = (useHierarchy().data ?? []).flatMap((s) => s.folders);
  const members = useWorkspaceMembers().data ?? [];
  const fields = useCustomFields().data ?? [];
  const [creating, setCreating] = useState(false);
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : 'That did not save.');
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const save = useMutation({ mutationFn: (a: AutomationInput) => createAutomation(ws, a), onSuccess: () => { void refresh(); setCreating(false); toast.success('Automation created'); }, onError: fail });
  const patch = useMutation({ mutationFn: ({ id, p }: { id: string; p: Partial<AutomationInput> }) => updateAutomation(id, p), onSuccess: refresh, onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => deleteAutomation(id), onSuccess: refresh, onError: fail });

  const person = (id: string) => (id === 'editor' ? "the video's editor" : id === 'qc' ? "the video's QC reviewer" : (members.find((m) => m.userId === id)?.profile?.fullName ?? 'a former member'));
  const statusName = (k: string | null) => (k ? (statuses.find((s) => s.key === k)?.name ?? k) : 'any status');
  const describeTrigger = (a: Automation) =>
    `${a.triggerType === 'task_created' ? 'a video is created' : a.triggerType === 'status_changed' ? `a video moves to ${statusName(a.triggerStatus)}` : `the tag "${tags.find((t) => t.id === a.triggerTagId)?.name ?? '?'}" is added`}${a.folderId ? ` in ${folders.find((f) => f.id === a.folderId)?.name ?? 'a folder'}` : ''}`;
  const describeAction = (x: AutomationAction) => {
    switch (x.type) {
      case 'set_priority':
        return `priority ${x.priority.toLowerCase()}`;
      case 'set_due_in_days':
        return `QC due in ${x.days} day${x.days === 1 ? '' : 's'}`;
      case 'add_tag':
        return `tag "${tags.find((t) => t.id === x.tag_id)?.name ?? '?'}"`;
      case 'assign_editor':
        return `editor ${person(x.user_id)}`;
      case 'assign_qc':
        return `QC ${person(x.user_id)}`;
      case 'set_field':
        return `${fields.find((f) => f.id === x.field_id)?.name ?? 'a field'} = ${Array.isArray(x.value) ? x.value.join(', ') : String(x.value)}`;
      case 'notify':
        return `notify ${person(x.to)}: "${x.message}"`;
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        When something happens to a video, do the next steps for you. They run for every screen, right after the change. A step that no longer fits (someone left, a tag was deleted) is skipped.
      </p>
      {autos.isSuccess && autos.data.length === 0 && (
        <div className="rounded-card border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          <Zap aria-hidden className="mx-auto mb-2 h-5 w-5 text-primary" />
          No automations yet. Try: when a video moves to CLIENT REVISION NEEDED, set priority urgent and notify its editor.
        </div>
      )}
      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {(autos.data ?? []).map((a) => (
            <motion.li key={a.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className={cn('rounded-card border border-border/70 bg-background/40 p-3', !a.enabled && 'opacity-60')}>
              <div className="flex items-start gap-3">
                <span className="stat-icon mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-control"><Workflow className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{a.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">When</span> {describeTrigger(a)} <ArrowRight aria-hidden className="mx-0.5 inline h-3 w-3" />{' '}
                    <span className="font-medium text-foreground">then</span> {a.actions.map(describeAction).join(', ')}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Ran {a.runCount} time{a.runCount === 1 ? '' : 's'}{a.lastRunAt ? `, last ${new Date(a.lastRunAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    <Switch checked={a.enabled} aria-label={`${a.name} ${a.enabled ? 'on' : 'off'}`} onCheckedChange={(v) => patch.mutate({ id: a.id, p: { enabled: v } })} />
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label={`Delete ${a.name}`}
                      onClick={() => window.confirm(`Delete the automation "${a.name}"?`) && remove.mutate(a.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {canEdit &&
        (creating ? (
          <Builder
            busy={save.isPending}
            statuses={statuses}
            tags={tags}
            folders={folders}
            members={members.map((m) => ({ id: m.userId, name: m.profile?.fullName ?? m.profile?.email ?? 'Member', role: m.role }))}
            fields={fields}
            onCancel={() => setCreating(false)}
            onSave={(a) => save.mutate(a)}
          />
        ) : (
          <Button type="button" size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> New automation
          </Button>
        ))}
    </div>
  );
};

const Builder: React.FC<{
  busy: boolean;
  statuses: { key: string; name: string }[];
  tags: { id: string; name: string }[];
  folders: { id: string; name: string }[];
  members: { id: string; name: string; role: string }[];
  fields: { id: string; name: string; type: import('@/types/database').CustomFieldType; options: string[] | null }[];
  onCancel: () => void;
  onSave: (a: AutomationInput) => void;
}> = ({ busy, statuses, tags, folders, members, fields, onCancel, onSave }) => {
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<AutomationInput['triggerType']>('status_changed');
  const [triggerStatus, setTriggerStatus] = useState<string>('');
  const [triggerTagId, setTriggerTagId] = useState<string>('');
  const [folderId, setFolderId] = useState<string>('');
  const [actions, setActions] = useState<AutomationAction[]>([blankAction('set_priority')]);
  const [fieldText, setFieldText] = useState<Record<number, string>>({});
  const set = (i: number, a: AutomationAction) => setActions((all) => all.map((x, j) => (j === i ? a : x)));
  const editors = members.filter((m) => ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'EDITOR'].includes(m.role));
  const reviewers = members.filter((m) => ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST'].includes(m.role));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // a field value is typed like on a video, then checked against the field
    const final: AutomationAction[] = [];
    for (const [i, a] of actions.entries()) {
      if (a.type === 'set_field') {
        const f = fields.find((x) => x.id === a.field_id);
        if (!f) return void toast.error('Pick the field to fill in.');
        const raw = f.type === 'labels' ? JSON.stringify((fieldText[i] ?? '').split(',').map((x) => x.trim()).filter(Boolean)) : (fieldText[i] ?? '');
        const parsed = validateFieldValue(f.type, f.options, raw);
        if (!parsed.ok || parsed.value === null) return void toast.error(parsed.ok ? `Give ${f.name} a value.` : `${f.name}: ${parsed.error}`);
        final.push({ ...a, value: parsed.value });
      } else final.push(a);
    }
    onSave({ name: name || 'Automation', enabled: true, triggerType, triggerStatus: triggerType === 'status_changed' ? triggerStatus || null : null, triggerTagId: triggerType === 'tag_added' ? triggerTagId || null : null, folderId: folderId || null, actions: final });
  };

  return (
    <motion.form initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} onSubmit={submit} className="space-y-3 rounded-card border border-primary/30 bg-primary/[0.03] p-3">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Client wants changes" aria-label="Automation name" maxLength={80} className="h-9" />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">When</span>
        <select aria-label="Trigger" className={SELECT} value={triggerType} onChange={(e) => setTriggerType(e.target.value as AutomationInput['triggerType'])}>
          <option value="status_changed">a video moves to</option>
          <option value="task_created">a video is created</option>
          <option value="tag_added">a tag is added</option>
        </select>
        {triggerType === 'status_changed' && (
          <select aria-label="Status" className={SELECT} value={triggerStatus} onChange={(e) => setTriggerStatus(e.target.value)}>
            <option value="">any status</option>
            {statuses.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
        )}
        {triggerType === 'tag_added' && (
          <select aria-label="Tag" className={SELECT} value={triggerTagId} onChange={(e) => setTriggerTagId(e.target.value)}>
            <option value="">pick a tag</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <span className="text-muted-foreground">in</span>
        <select aria-label="Folder" className={SELECT} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
          <option value="">any folder</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        <span className="text-sm font-semibold">Then</span>
        {actions.map((a, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 pl-3">
            <select aria-label={`Action ${i + 1}`} className={SELECT} value={a.type} onChange={(e) => set(i, blankAction(e.target.value as AutomationAction['type']))}>
              {(Object.keys(ACTION_LABELS) as AutomationAction['type'][]).map((t) => <option key={t} value={t}>{ACTION_LABELS[t]}</option>)}
            </select>
            {a.type === 'set_priority' && (
              <select aria-label="Priority" className={SELECT} value={a.priority} onChange={(e) => set(i, { ...a, priority: e.target.value as typeof a.priority })}>
                {['URGENT', 'HIGH', 'MEDIUM', 'LOW'].map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}
              </select>
            )}
            {a.type === 'set_due_in_days' && (
              <label className="flex items-center gap-1.5 text-sm">
                in <Input type="number" min={0} max={365} value={a.days} onChange={(e) => set(i, { ...a, days: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} className="h-9 w-20" aria-label="Days" /> days
              </label>
            )}
            {a.type === 'add_tag' && (
              <select aria-label="Tag to add" className={SELECT} value={a.tag_id} onChange={(e) => set(i, { ...a, tag_id: e.target.value })}>
                <option value="">pick a tag</option>
                {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            {(a.type === 'assign_editor' || a.type === 'assign_qc') && (
              <select aria-label="Person" className={SELECT} value={a.user_id} onChange={(e) => set(i, { ...a, user_id: e.target.value })}>
                <option value="">pick a person</option>
                {(a.type === 'assign_editor' ? editors : reviewers).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
            {a.type === 'set_field' && (
              <>
                <select aria-label="Field" className={SELECT} value={a.field_id} onChange={(e) => set(i, { ...a, field_id: e.target.value })}>
                  <option value="">pick a field</option>
                  {fields.filter((f) => f.type !== 'people').map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <Input value={fieldText[i] ?? ''} onChange={(e) => setFieldText((t) => ({ ...t, [i]: e.target.value }))} placeholder="value" aria-label="Field value" className="h-9 w-40" />
              </>
            )}
            {a.type === 'notify' && (
              <>
                <select aria-label="Who to notify" className={SELECT} value={a.to} onChange={(e) => set(i, { ...a, to: e.target.value })}>
                  <option value="editor">the video's editor</option>
                  <option value="qc">the video's QC reviewer</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <Input value={a.message} onChange={(e) => set(i, { ...a, message: e.target.value })} placeholder="Message" aria-label="Message" maxLength={300} className="h-9 min-w-[12rem] flex-1" />
              </>
            )}
            {actions.length > 1 && (
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label={`Remove action ${i + 1}`} onClick={() => setActions((all) => all.filter((_, j) => j !== i))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
        {actions.length < 5 && (
          <Button type="button" variant="ghost" size="sm" className="ml-3" onClick={() => setActions((all) => [...all, blankAction('notify')])}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add another action
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>Save automation</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </motion.form>
  );
};

export default AutomationsEditor;
