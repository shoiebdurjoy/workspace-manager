import React, { useState } from 'react';
import { Loader2, MailPlus, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useInvitations, useInvite, useRevokeInvitation } from '@/hooks/use-team';
import { invitableRoles, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/permissions';
import { validateEmail } from '@/lib/auth-errors';
import type { TbbRole } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingState } from '@/components/ui/loading-state';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { FieldError } from '@/components/auth/AuthLayout';
import RoleBadge from './RoleBadge';

const InvitationsPanel: React.FC = () => {
  const { role } = useAuth();
  const invitations = useInvitations();
  const invite = useInvite();
  const revoke = useRevokeInvitation();
  const roles = invitableRoles(role);
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<TbbRole>('EDITOR');
  const [emailError, setEmailError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateEmail(email);
    setEmailError(err);
    if (err) return;
    invite.mutate({ email, role: newRole }, { onSuccess: () => setEmail('') });
  };

  const pending = (invitations.data ?? []).filter((i) => !i.acceptedAt);
  const accepted = (invitations.data ?? []).filter((i) => i.acceptedAt).slice(0, 10);

  return (
    <div className="space-y-5">
      <form
        onSubmit={onSubmit}
        noValidate
        className="space-y-3 rounded-lg border border-border/70 bg-card p-4"
        aria-label="Invite a person"
      >
        <div>
          <h3 className="text-sm font-semibold">Invite someone</h3>
          <p className="text-[11px] text-muted-foreground">
            They get access with this role as soon as they sign in with a confirmed account for this address. Nothing is
            e-mailed automatically yet: let them know to register at TBB Workspace.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="flex-1 space-y-1">
            <Label htmlFor="invite-email" className="sr-only">
              E-mail
            </Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="name@thinkbigbrand.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!emailError}
              aria-describedby={emailError ? 'invite-email-error' : undefined}
              className="h-8 text-xs"
            />
            <FieldError id="invite-email-error" message={emailError} />
          </div>
          <Select value={newRole} onValueChange={(v) => setNewRole(v as TbbRole)}>
            <SelectTrigger className="h-8 w-full text-xs sm:w-[180px]" aria-label="Role for the invited person">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r} value={r} className="text-xs">
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" size="sm" className="h-8 text-xs" disabled={invite.isPending}>
            {invite.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <MailPlus className="mr-1.5 h-3.5 w-3.5" />
            )}
            Invite
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">{ROLE_DESCRIPTIONS[newRole]}</p>
      </form>

      {invitations.isLoading ? (
        <LoadingState variant="skeleton" skeletonRows={2} />
      ) : invitations.isError ? (
        <ErrorState message={(invitations.error as Error).message} onRetry={() => void invitations.refetch()} />
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pending ({pending.length})
            </h3>
            {pending.length === 0 ? (
              <p className="text-xs text-muted-foreground">No pending invitations.</p>
            ) : (
              <ul className="divide-y divide-border/60 rounded-lg border border-border/70 bg-card">
                {pending.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{inv.email}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Invited {new Date(inv.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <RoleBadge role={inv.role} />
                      <IconButton
                        aria-label={`Revoke invitation for ${inv.email}`}
                        tooltip="Revoke"
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        variant="ghost"
                        size="xs"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(inv.id)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {accepted.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recently accepted</h3>
              <ul className="divide-y divide-border/60 rounded-lg border border-border/70 bg-card/60">
                {accepted.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
                    <span className="truncate">{inv.email}</span>
                    <span>{inv.acceptedAt ? new Date(inv.acceptedAt).toLocaleDateString() : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default InvitationsPanel;
