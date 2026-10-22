import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listTrash, restoreTrash, type TrashBatch } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceMembers } from '@/hooks/use-team';
import { cn } from '@/lib/utils';

const KIND: Record<string, string> = {
  spaces: 'space',
  folders: 'folder',
  lists: 'client list',
  tasks: 'video',
  custom_fields: 'custom field',
  tags: 'tag',
  automations: 'automation',
  brief_forms: 'brief form',
  saved_views: 'saved view',
  task_comments: 'comment',
  task_attachments: 'attachment',
  subtasks: 'subtask',
  time_entries: 'time entry',
  task_assignees: 'assignment',
  custom_field_values: 'field value',
  task_tags: 'tag on a video',
  task_dependencies: 'dependency',
  task_recurrence: 'repeat rule',
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Settings > Customize workspace > Trash (managers). Everything deleted in the last 30 days, grouped by the action
 * that deleted it, with who and when; Restore puts the whole group back exactly as it was.
 */
const TrashBin: React.FC = () => {
  const { workspace } = useAuth();
  const ws = workspace?.id ?? '';
  const qc = useQueryClient();
  const members = useWorkspaceMembers().data ?? [];
  const trash = useQuery({ queryKey: ['workspace', ws, 'trash'], queryFn: () => listTrash(ws), enabled: !!ws });
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const who = (id: string | null) => (id ? (members.find((m) => m.userId === id)?.profile?.fullName ?? 'a former member') : 'the system');

  const restore = async (b: TrashBatch) => {
    setBusy(b.batch);
    try {
      const res = await restoreTrash(ws, b.batch);
      await qc.invalidateQueries();
      if (res.skipped > 0) toast.warning(`Restored ${res.restored} item(s). ${res.skipped} could not come back because what they belonged to is still deleted; restore that first.`);
      else toast.success(`Restored "${b.main.label || KIND[b.main.table]}" with everything that went with it`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That could not be restored.');
    } finally {
      setBusy(null);
    }
  };

  const shown = (trash.data ?? []).filter((b) => !filter.trim() || b.main.label.toLowerCase().includes(filter.trim().toLowerCase()) || who(b.deletedBy).toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Everything deleted in the last 30 days, with who deleted it and when. Restore brings it back exactly as it was, with everything that went with it (a client list comes back with its videos, comments, fields and time). Nobody is notified again.
      </p>
      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find by name or by who deleted it" aria-label="Search the trash" className="h-8 text-sm" />
      {trash.isSuccess && shown.length === 0 && (
        <div className="rounded-card border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          <Trash2 aria-hidden className="mx-auto mb-2 h-5 w-5" /> Nothing in the trash.
        </div>
      )}
      <ul className="space-y-2">
        {shown.map((b) => {
          const extra = Object.entries(b.parts)
            .filter(([t]) => t !== b.main.table && KIND[t])
            .map(([t, n]) => plural(n, KIND[t]));
          return (
            <li key={b.batch} className={cn('flex flex-wrap items-center gap-3 rounded-card border border-border/70 bg-background/40 p-3', b.restored && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{KIND[b.main.table] ?? b.main.table}</span>
                  {b.main.label || '(no name)'}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Deleted by {who(b.deletedBy)} · {new Date(b.deletedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {extra.length > 0 && ` · with ${extra.join(', ')}`}
                </p>
              </div>
              {b.restored ? (
                <span className="text-xs text-muted-foreground">Restored</span>
              ) : (
                <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void restore(b)}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> {busy === b.batch ? 'Restoring...' : 'Restore'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default TrashBin;
