import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { getNotificationPrefs, saveNotificationPrefs, type MutableNotificationKind, type NotificationPrefs } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { useHierarchy } from '@/hooks/use-hierarchy';
import { desktopNotifyOn, desktopNotifySupported, setDesktopNotify } from '@/lib/desktop-notify';
import { cn } from '@/lib/utils';

const KINDS: { kind: MutableNotificationKind; label: string; hint: string }[] = [
  { kind: 'mention', label: 'Mentions', hint: 'Someone @mentions you' },
  { kind: 'assigned', label: 'Assignments', hint: 'You become the editor or QC reviewer of a video' },
  { kind: 'comment', label: 'Comments', hint: 'New comments on videos you work on' },
  { kind: 'status', label: 'Stage changes', hint: 'Videos you work on move to another status' },
  { kind: 'automation', label: 'Automation notices', hint: 'Messages sent by your workspace automations' },
];

const PRESETS: { id: string; label: string; muted: MutableNotificationKind[] }[] = [
  { id: 'all', label: 'Everything', muted: [] },
  { id: 'focused', label: 'Focused', muted: ['comment', 'status'] },
  { id: 'mentions', label: 'Mentions only', muted: ['assigned', 'comment', 'status', 'automation'] },
];

/** Profile > Notifications: what notifies you, which clients you mute, and desktop notices on this device. */
const NotificationSettings: React.FC = () => {
  const { workspace, user } = useAuth();
  const ws = workspace?.id ?? '';
  const me = user?.id ?? '';
  const qc = useQueryClient();
  const key = ['workspace', ws, 'notification-prefs', me];
  const prefs = useQuery({ queryKey: key, queryFn: () => getNotificationPrefs(ws, me), enabled: !!ws && !!me });
  const tree = useHierarchy().data ?? [];
  const allLists = tree.flatMap((s) => [...s.folders.flatMap((f) => f.lists), ...s.folderlessLists]);
  const [draft, setDraft] = useState<NotificationPrefs | null>(null);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [desktop, setDesktop] = useState(desktopNotifyOn());
  useEffect(() => {
    if (prefs.data && !draft) setDraft(prefs.data);
  }, [prefs.data, draft]);

  // every change saves itself a moment later (no Save button to forget)
  useEffect(() => {
    if (!draft || !prefs.data || JSON.stringify(draft) === JSON.stringify(prefs.data)) return;
    const t = window.setTimeout(() => {
      setSaving(true);
      saveNotificationPrefs(ws, me, draft)
        .then(() => qc.invalidateQueries({ queryKey: key }))
        .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'That did not save.'))
        .finally(() => setSaving(false));
    }, 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  if (!draft) return <div className="surface-card p-4 text-sm text-muted-foreground">Loading your notification settings...</div>;
  const preset = PRESETS.find((p) => p.muted.length === draft.mutedKinds.length && p.muted.every((k) => draft.mutedKinds.includes(k)))?.id ?? 'custom';
  const shownLists = allLists.filter((l) => !filter.trim() || l.name.toLowerCase().includes(filter.trim().toLowerCase()));


  return (
    <section aria-label="Notifications" className="space-y-4 surface-card p-4">
      <div className="flex items-center gap-2">
        <BellRing aria-hidden className="h-4 w-4 text-primary" />
        <h2 className="section-label">Notifications</h2>
      </div>
      <div role="group" aria-label="Preset" className="pill-group w-fit">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => setDraft({ ...draft, mutedKinds: p.muted })} className={cn('pill-item', preset === p.id && 'text-foreground')}>
            {p.label}
          </button>
        ))}
        {preset === 'custom' && <span className="pill-item text-foreground">Custom</span>}
      </div>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-card border border-border/70">
        {KINDS.map((k) => {
          const on = !draft.mutedKinds.includes(k.kind);
          return (
            <li key={k.kind} className="flex items-center gap-3 bg-background/40 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{k.label}</p>
                <p className="text-[11px] text-muted-foreground">{k.hint}</p>
              </div>
              <Switch
                checked={on}
                aria-label={`${k.label} ${on ? 'on' : 'off'}`}
                onCheckedChange={(v) => setDraft({ ...draft, mutedKinds: v ? draft.mutedKinds.filter((x) => x !== k.kind) : [...draft.mutedKinds, k.kind] })}
              />
            </li>
          );
        })}
      </ul>
      <div className="space-y-2">
        <p className="text-xs font-medium">Mute clients ({draft.mutedListIds.length} muted): nothing about them reaches you</p>
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a client" aria-label="Find a client" className="h-8 text-sm" />
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {shownLists.map((l) => {
            const muted = draft.mutedListIds.includes(l.id);
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={muted}
                onClick={() => setDraft({ ...draft, mutedListIds: muted ? draft.mutedListIds.filter((x) => x !== l.id) : [...draft.mutedListIds, l.id] })}
                className={cn('press rounded-full border px-2.5 py-1 text-[11px]', muted ? 'border-destructive/40 bg-destructive/10 text-foreground line-through' : 'border-border text-muted-foreground hover:text-foreground')}
              >
                {l.name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-card border border-border/70 bg-background/40 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Desktop notifications on this device</p>
          <p className="text-[11px] text-muted-foreground">
            {desktopNotifySupported() ? 'A pop-up when something new arrives while TBB is in a background tab.' : 'This browser does not support desktop notifications.'}
          </p>
        </div>
        <Switch
          checked={desktop}
          disabled={!desktopNotifySupported()}
          aria-label={`Desktop notifications ${desktop ? 'on' : 'off'}`}
          onCheckedChange={async (v) => {
            const result = await setDesktopNotify(v);
            setDesktop(result);
            if (v && !result) toast.error('The browser blocked notifications. Allow them in the site settings, then try again.');
          }}
        />
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground" role="status">
        {saving ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving...</> : 'Changes save automatically.'}
      </p>
    </section>
  );
};

export default NotificationSettings;
