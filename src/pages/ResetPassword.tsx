import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingState } from '@/components/ui/loading-state';
import AuthLayout, { FieldError, FormError } from '@/components/auth/AuthLayout';
import { useAuth } from '@/hooks/use-auth';
import { validatePassword } from '@/lib/auth-errors';

/**
 * Target of the password-reset e-mail. supabase-js exchanges the PKCE code from the link for
 * a short recovery session on load; with that session the user can set a new password.
 */
const ResetPassword: React.FC = () => {
  const { status, user, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string | null; confirm?: string | null }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Choose a new password · TBB Workspace';
  }, []);

  if (status === 'loading') {
    return (
      <AuthLayout title="Choose a new password">
        <LoadingState title="Checking your reset link..." className="min-h-[120px]" />
      </AuthLayout>
    );
  }

  if (!user) {
    return (
      <AuthLayout
        title="Link expired"
        description="This password reset link is invalid or has expired. Reset links only work once, on the device that requested them."
      >
        <Button asChild className="h-9 w-full text-sm">
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </AuthLayout>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = {
      password: validatePassword(password),
      confirm: confirm === password ? null : 'Passwords do not match.',
    };
    setErrors(next);
    if (next.password || next.confirm) return;
    setSubmitting(true);
    setFormError(null);
    const result = await updatePassword(password);
    setSubmitting(false);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    navigate('/home', { replace: true });
  };

  return (
    <AuthLayout title="Choose a new password" description={`Signed in as ${user.email}.`}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <FormError message={formError} />
        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-xs">
            New password
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password}
            aria-describedby="password-error"
            className="h-9 text-sm"
          />
          <FieldError id="password-error" message={errors.password} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm" className="text-xs">
            Confirm new password
          </Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={!!errors.confirm}
            aria-describedby="confirm-error"
            className="h-9 text-sm"
          />
          <FieldError id="confirm-error" message={errors.confirm} />
        </div>
        <Button type="submit" className="h-9 w-full text-sm" disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
};

export default ResetPassword;
