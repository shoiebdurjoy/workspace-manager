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
    <div className="max-w-2xl space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="text-xs text-muted-foreground">Workspace details for everyone at TBB.</p>
      </header>

      <form onSubmit={onSave} noValidate className="space-y-4 rounded-lg border border-border/70 bg-card p-4">
        <h2 className="text-sm font-semibold">Workspace</h2>
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
            className="h-9 text-sm"
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
            className="text-sm"
          />
        </div>
        <dl className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          <dt>Workspace ID</dt>
          <dd className="truncate font-mono">{workspace.slug}</dd>
          <dt>Created</dt>
          <dd>{new Date(workspace.createdAt).toLocaleDateString()}</dd>
        </dl>
        {editable ? (
          <Button type="submit" size="sm" disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        ) : (
          <p className="text-[11px] text-muted-foreground">Only the workspace Owner can change these settings.</p>
        )}
      </form>
    </div>
  );
};

export default Settings;
