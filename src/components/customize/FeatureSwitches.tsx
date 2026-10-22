import React, { useState } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { setWorkspaceFeature } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { FEATURES, isFeatureOn, type FeatureKey } from '@/lib/features';

/**
 * Settings > Customize workspace > Features (Owner / Admin). Each switch hides or shows a part of the app for
 * everyone in the workspace; nothing is deleted, so switching back on brings everything back.
 */
const FeatureSwitches: React.FC = () => {
  const { workspace, refresh } = useAuth();
  const [busy, setBusy] = useState<FeatureKey | null>(null);
  if (!workspace) return null;

  const flip = async (key: FeatureKey, enabled: boolean) => {
    setBusy(key);
    try {
      await setWorkspaceFeature(workspace.id, key, enabled);
      await refresh();
      toast.success(`${FEATURES.find((f) => f.key === key)?.label} ${enabled ? 'switched on' : 'switched off'}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Switch off what your team does not use. It disappears for everyone; its data stays and returns when you switch it back on.</p>
      {(['Tasks', 'Team', 'Pages'] as const).map((group) => (
        <fieldset key={group} className="space-y-1">
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</legend>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-card border border-border/70">
            {FEATURES.filter((f) => f.group === group).map((f) => {
              const on = isFeatureOn(workspace, f.key);
              return (
                <li key={f.key} className="flex items-center gap-3 bg-background/40 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{f.label}</p>
                    <p className="text-[11px] text-muted-foreground">{f.hint}</p>
                  </div>
                  <Switch checked={on} disabled={busy !== null} aria-label={`${f.label} ${on ? 'on' : 'off'}`} onCheckedChange={(v) => void flip(f.key, v)} />
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  );
};

export default FeatureSwitches;
