import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, FileText, Inbox, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { briefLink, createBriefForm, deleteBriefForm, listBriefForms, listBriefSubmissions, updateBriefForm, type BriefForm } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { useCustomFields } from '@/hooks/use-custom-fields';
import { useHierarchy } from '@/hooks/use-hierarchy';
import { cn } from '@/lib/utils';

const SELECT = 'focus-soft h-9 w-full rounded-control border border-input bg-background px-2 text-sm outline-none';

/**
 * Settings > Customize workspace > Brief forms (managers). Each form belongs to one client list; its link opens a
 * public page where the client describes the video without an account, and a task appears in that list.
 */
const BriefFormsEditor: React.FC = () => {
  const { workspace } = useAuth();
  const ws = workspace?.id ?? '';
  const qc = useQueryClient();
  const key = ['workspace', ws, 'brief-forms'];
  const forms = useQuery({ queryKey: key, queryFn: () => listBriefForms(ws), enabled: !!ws });
  const lists = (useHierarchy().data ?? []).flatMap((s) => [...s.folders.flatMap((f) => f.lists.map((l) => ({ id: l.id, name: `${f.name} / ${l.name}` }))), ...s.folderlessLists.map((l) => ({ id: l.id, name: l.name }))]);
  const fields = (useCustomFields().data ?? []).filter((f) => f.type !== 'people');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [intro, setIntro] = useState('');
  const [listId, setListId] = useState('');
  const [fieldIds, setFieldIds] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : 'That did not save.');
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: () => createBriefForm(ws, { listId, title, intro, fieldIds }),
    onSuccess: () => {
      void refresh();
      setCreating(false);
      setTitle('');
      setIntro('');
      setListId('');
      setFieldIds([]);
      toast.success('Form created. Copy its link and send it to the client.');
    },
    onError: fail,
  });
  const patch = useMutation({ mutationFn: ({ id, p }: { id: string; p: Parameters<typeof updateBriefForm>[1] }) => updateBriefForm(id, p), onSuccess: refresh, onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => deleteBriefForm(id), onSuccess: refresh, onError: fail });
  const listName = (id: string) => lists.find((l) => l.id === id)?.name ?? 'a list';

  const copy = async (f: BriefForm) => {
    try {
      await navigator.clipboard.writeText(briefLink(f.token));
      toast.success('Link copied');
    } catch {
      toast.message(briefLink(f.token));
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Send a client a link; they describe the video (no account needed) and it lands as a new video in their list, with the fields you ask for. Anyone with the link can send briefs, so switch a form off when you no longer need it.
      </p>
      {forms.isSuccess && forms.data.length === 0 && !creating && <p className="text-sm text-muted-foreground">No brief forms yet.</p>}
      <ul className="space-y-2">
        {(forms.data ?? []).map((f) => (
          <li key={f.id} className={cn('rounded-card border border-border/70 bg-background/40 p-3', !f.enabled && 'opacity-60')}>
            <div className="flex flex-wrap items-center gap-2">
              <FileText aria-hidden className="h-4 w-4 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{f.title}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  Into {listName(f.listId)} · asks {f.fields.length} field{f.fields.length === 1 ? '' : 's'} · {f.submissionCount} brief{f.submissionCount === 1 ? '' : 's'} received
                </p>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => void copy(f)} disabled={!f.enabled}>
                <Copy className="mr-1 h-3.5 w-3.5" /> Copy link
              </Button>
              <a href={briefLink(f.token)} target="_blank" rel="noopener noreferrer" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Open ${f.title}`}>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpenId(openId === f.id ? null : f.id)} aria-expanded={openId === f.id}>
                <Inbox className="mr-1 h-3.5 w-3.5" /> Briefs
              </Button>
              <Switch checked={f.enabled} aria-label={`${f.title} ${f.enabled ? 'open' : 'closed'}`} onCheckedChange={(v) => patch.mutate({ id: f.id, p: { enabled: v } })} />
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label={`Delete ${f.title}`}
                onClick={() => window.confirm(`Delete the form "${f.title}"? Its link stops working. Videos it created stay.`) && remove.mutate(f.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {openId === f.id && <Submissions formId={f.id} />}
          </li>
        ))}
      </ul>
      {creating ? (
        <form
          className="space-y-3 rounded-card border border-primary/30 bg-primary/[0.03] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title the client sees, e.g. New video request" aria-label="Form title" maxLength={100} className="h-9" />
          <Textarea value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="A short note for the client (optional)" aria-label="Form intro" rows={2} maxLength={2000} />
          <select aria-label="Client list" className={SELECT} value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">Briefs go to which client list?</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          {fields.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium">Also ask for these fields (required ones stay required)</legend>
              <div className="flex flex-wrap gap-1.5">
                {fields.map((f) => {
                  const on = fieldIds.includes(f.id);
                  return (
                    <button key={f.id} type="button" aria-pressed={on} onClick={() => setFieldIds(on ? fieldIds.filter((x) => x !== f.id) : [...fieldIds, f.id])}
                      className={cn('press rounded-full border px-2.5 py-1 text-[11px]', on ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
                      {f.name}{f.isRequired ? ' *' : ''}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={create.isPending || !title.trim() || !listId}>Create form</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <Button type="button" size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> New brief form
        </Button>
      )}
    </div>
  );
};

const Submissions: React.FC<{ formId: string }> = ({ formId }) => {
  const subs = useQuery({ queryKey: ['brief-submissions', formId], queryFn: () => listBriefSubmissions(formId) });
  if (subs.isLoading) return <p className="mt-2 text-xs text-muted-foreground">Loading briefs...</p>;
  if (!subs.data?.length) return <p className="mt-2 text-xs text-muted-foreground">No briefs yet.</p>;
  return (
    <ul className="mt-2 divide-y divide-border/50 border-t border-border/50 pt-1 text-xs">
      {subs.data.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-2 py-1.5">
          <span className="font-medium">{s.title}</span>
          <span className="text-muted-foreground">{s.contactName ?? ''}{s.contactEmail ? ` <${s.contactEmail}>` : ''}</span>
          <span className="ml-auto text-muted-foreground">{new Date(s.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          {s.taskId && <a className="text-brand hover:underline" href={`/everything/tasks/${s.taskId}`}>Open video</a>}
        </li>
      ))}
    </ul>
  );
};

export default BriefFormsEditor;
