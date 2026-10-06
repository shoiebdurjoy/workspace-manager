import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Building2, Loader2, MailQuestion, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AuthLayout, { FieldError, FormError } from '@/components/auth/AuthLayout';
import { useAuth } from '@/hooks/use-auth';
import { createWorkspace, PermissionDeniedError } from '@/database';
import { slugify } from '@/lib/slug';

/**
 * Shown to a signed-in person who belongs to no workspace yet.
 *
 * Access normally comes from an invitation (claimed automatically once the e-mail is
 * confirmed). Only while NO workspace exists at all can the first person create the TBB
 * workspace and become its Owner; the database refuses this for everyone afterwards.
 */
const Onboarding: React.FC = () => {
  const { user, memberships, refresh, signOut, status } = useAuth();
  const [checking, setChecking] = useState(false);
  const [name, setName] = useState('Think Big Brand');
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    document.title = 'Get access · TBB Workspace';
  }, []);

  if (status === 'authenticated' && memberships.length > 0) return <Navigate to="/home" replace />;

  const checkAgain = async () => {
    setChecking(true);
    await refresh();
    setChecking(false);
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Enter the workspace name.');
      return;
    }
    setNameError(null);
    setFormError(null);
    setCreating(true);
    try {
      const suffix = Math.random().toString(36).slice(2, 6);
      await createWorkspace({ name: trimmed, slug: `${slugify(trimmed)}-${suffix}`, ownerId: user.id });
      await refresh();
    } catch (err) {
      setFormError(
        err instanceof PermissionDeniedError || (err instanceof Error && /row-level security|permission/i.test(err.message))
          ? 'The TBB workspace already exists. Ask an administrator to invite your e-mail address.'
          : err instanceof Error
            ? err.message
            : 'The workspace could not be created.'
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <AuthLayout
      title="You're signed in"
      description={
        <>
          Signed in as <span className="font-medium text-foreground">{user?.email}</span>. Your account is not part of a
          workspace yet.
        </>
      }
      footer={
        <button type="button" onClick={() => void signOut()} className="font-medium text-primary hover:underline">
          Sign out
        </button>
      }
    >
      <div className="space-y-5">
        <section className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MailQuestion className="h-4 w-4 text-primary" />
            Waiting for an invitation
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Ask a TBB Owner or Admin to invite <span className="font-medium text-foreground">{user?.email}</span>. As soon
            as they do, your access appears here automatically.
          </p>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void checkAgain()} disabled={checking}>
            {checking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Check again
          </Button>
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Building2 className="h-4 w-4 text-primary" />
            First-time setup
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Setting up TBB Workspace for the very first time? Create the workspace and you become its Owner. This is
            only possible while no workspace exists.
          </p>
          <form className="space-y-3" onSubmit={onCreate} noValidate>
            <FormError message={formError} />
            <div className="space-y-1.5">
              <Label htmlFor="ws-name" className="text-xs">
                Workspace name
              </Label>
              <Input
                id="ws-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!nameError}
                aria-describedby={nameError ? 'ws-name-error' : undefined}
                className="h-9 text-sm"
              />
              <FieldError id="ws-name-error" message={nameError} />
            </div>
            <Button type="submit" className="h-9 w-full text-sm" disabled={creating}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create workspace
            </Button>
          </form>
        </section>
      </div>
    </AuthLayout>
  );
};

export default Onboarding;
