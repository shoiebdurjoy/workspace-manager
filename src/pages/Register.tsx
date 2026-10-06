import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AuthLayout, { FieldError, FormError } from '@/components/auth/AuthLayout';
import { useAuth } from '@/hooks/use-auth';
import { validateEmail, validatePassword } from '@/lib/auth-errors';

/**
 * Account registration. There is deliberately NO role picker: every new account is an
 * EDITOR profile with no workspace access. Access and role come only from an invitation by
 * an Owner/Admin (or, for the very first person, from creating the TBB workspace).
 */
const Register: React.FC = () => {
  const { signUp, status } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Create account · TBB Workspace';
  }, []);

  if (status === 'authenticated') return <Navigate to="/home" replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string | null> = {
      fullName: fullName.trim() ? null : 'Enter your full name.',
      email: validateEmail(email),
      password: validatePassword(password),
      confirm: confirm === password ? null : 'Passwords do not match.',
    };
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    setSubmitting(true);
    setFormError(null);
    const result = await signUp(fullName, email, password);
    setSubmitting(false);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    if (result.needsConfirmation) setSentTo(email.trim());
    // When confirmation is disabled the session starts immediately and the router moves on.
  };

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your e-mail"
        footer={
          <Link to="/login" className="font-medium text-brand hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="space-y-3 text-sm">
          <MailCheck className="h-8 w-8 text-brand" />
          <p>
            If <span className="font-medium">{sentTo}</span> is a new address, we have sent a confirmation link to it.
            Open the link, then sign in.
          </p>
          <p className="text-xs text-muted-foreground">
            Already have an account with this address? Sign in or reset your password instead.
          </p>
          <p className="text-xs text-muted-foreground">
            You will see your workspace once an administrator has invited this address.
          </p>
        </div>
      </AuthLayout>
    );
  }

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    type: string,
    autoComplete: string,
    hint?: string
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-invalid={!!fieldErrors[id]}
        aria-describedby={fieldErrors[id] ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className="h-9 text-sm"
      />
      {hint && !fieldErrors[id] && (
        <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">
          {hint}
        </p>
      )}
      <FieldError id={`${id}-error`} message={fieldErrors[id]} />
    </div>
  );

  return (
    <AuthLayout
      title="Create your account"
      description="TBB Workspace is internal. Your account gets access once an administrator has invited your e-mail address."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <FormError message={formError} />
        {field('fullName', 'Full name', fullName, setFullName, 'text', 'name')}
        {field('email', 'Work e-mail', email, setEmail, 'email', 'email')}
        {field(
          'password',
          'Password',
          password,
          setPassword,
          'password',
          'new-password',
          'At least 8 characters with upper-case, lower-case and a number.'
        )}
        {field('confirm', 'Confirm password', confirm, setConfirm, 'password', 'new-password')}
        <Button type="submit" className="h-9 w-full text-sm" disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
};

export default Register;
