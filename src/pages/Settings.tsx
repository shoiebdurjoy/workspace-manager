import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { updateWorkspace } from '@/database';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import CustomizePanel from '@/components/customize/CustomizePanel';
import { FieldError, FormError } from '@/components/auth/AuthLayout';

/**
 * Workspace settings. Per docs/TBB_PERMISSION_MODEL.md only the OWNER manages workspace
 * settings, so only the Owner gets an editable form; everyone else sees them read-only.
 */
const Settings: React.FC = () => {
  const { workspace, role, refresh } = useAuth();
  const editable = can(role, 'workspace:manage');
  const [name, setName] = useState(workspace?.name ?? '');
  const [description, setDescription] = useState(workspace?.description ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = 'Settings · TBB Workspace';
  }, []);

  useEffect(() => {
    setName(workspace?.name ?? '');
    setDescription(workspace?.description ?? '');
  }, [workspace]);

  if (!workspace) return null;

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Enter the workspace name.');
      return;
    }
    setNameError(null);
    setFormError(null);
    setSaving(true);
    try {
      await updateWorkspace(workspace.id, { name: name.trim(), description: description.trim() || null });
      await refresh();
      toast.success('Workspace settings saved');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-4">
      <header className="space-y-1 pt-1">
        <h1 className="page-title">Settings</h1>
        <p className="page-description">Workspace details for everyone at TBB.</p>
      </header>

      {/* saves by itself when you leave the form with changes; the button stays for those who like to press it */}
      <form
        onSubmit={onSave}
        onBlur={(e) => {
          const dirty = name.trim() !== workspace.name || (description.trim() || null) !== (workspace.description ?? null);
          if (editable && dirty && name.trim() && !e.currentTarget.contains(e.relatedTarget as Node | null)) void onSave(e as unknown as React.FormEvent);
        }}
        noValidate
        className="space-y-4 surface-card p-4"
      >
        <h2 className="section-label">Workspace</h2>
        <FormError message={formError} />
        <div className="space-y-1.5">
          <Label htmlFor="ws-name" className="text-xs">
            Name
          </Label>
          <Input
            id="ws-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!editable}
            aria-invalid={!!nameError}
            aria-describedby={nameError ? 'ws-name-error' : undefined}
            className="focus-soft h-10 rounded-control text-sm"
          />
          <FieldError id="ws-name-error" message={nameError} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-description" className="text-xs">
            Description
          </Label>
          <Textarea
            id="ws-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!editable}
            rows={3}
            className="focus-soft rounded-control text-sm"
          />
        </div>
        <dl className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          <dt>Workspace ID</dt>
          <dd className="truncate font-mono">{workspace.slug}</dd>
          <dt>Created</dt>
          <dd>{new Date(workspace.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
        </dl>
        {editable ? (
          <Button type="submit" size="sm" className="press rounded-full px-5" disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        ) : (
          <p className="text-[11px] text-muted-foreground">Only the workspace Owner can change these settings.</p>
        )}
      </form>

      <CustomizePanel />
    </div>
  );
};

export default Settings;
