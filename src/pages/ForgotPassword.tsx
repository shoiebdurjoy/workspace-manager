import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AuthLayout, { FieldError, FormError } from '@/components/auth/AuthLayout';
import { useAuth } from '@/hooks/use-auth';
import { validateEmail } from '@/lib/auth-errors';

const ForgotPassword: React.FC = () => {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    document.title = 'Reset password · TBB Workspace';
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateEmail(email);
    setFieldError(err);
    if (err) return;
    setSubmitting(true);
    setFormError(null);
    const result = await requestPasswordReset(email);
    setSubmitting(false);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    setSent(true);
  };

  return (
    <AuthLayout
      title="Reset your password"
      description={sent ? undefined : 'We will e-mail you a link to choose a new password.'}
      footer={
        <Link to="/login" className="font-medium text-brand hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-3 text-sm">
          <MailCheck className="h-8 w-8 text-brand" />
          <p>
            If an account exists for <span className="font-medium">{email.trim()}</span>, a reset link is on its way.
            The link opens TBB Workspace on this device.
          </p>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <FormError message={formError} />
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs">
              E-mail
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!fieldError}
              aria-describedby={fieldError ? 'email-error' : undefined}
              className="h-9 text-sm"
            />
            <FieldError id="email-error" message={fieldError} />
          </div>
          <Button type="submit" className="h-9 w-full text-sm" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
};

export default ForgotPassword;
