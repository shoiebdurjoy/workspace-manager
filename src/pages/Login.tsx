import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AuthLayout, { FieldError, FormError } from '@/components/auth/AuthLayout';
import { useAuth } from '@/hooks/use-auth';
import { validateEmail } from '@/lib/auth-errors';
import { safeRedirectTarget } from '@/lib/redirect';

interface LocationState {
  from?: string;
}

const Login: React.FC = () => {
  const { signIn, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const target = safeRedirectTarget((location.state as LocationState | null)?.from);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string | null; password?: string | null }>({});

  useEffect(() => {
    document.title = 'Sign in · TBB Workspace';
  }, []);

  if (status === 'authenticated' || status === 'error' || status === 'deactivated') {
    return <Navigate to={target} replace />;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = {
      email: validateEmail(email),
      password: password ? null : 'Enter your password.',
    };
    setFieldErrors(errors);
    if (errors.email || errors.password) return;

    setSubmitting(true);
    setFormError(null);
    const result = await signIn(email, password);
    setSubmitting(false);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    navigate(target, { replace: true });
  };

  return (
    <AuthLayout
      title="Sign in"
      description="Use your TBB Workspace account."
      footer={
        <>
          New to TBB Workspace?{' '}
          <Link to="/register" className="font-medium text-brand hover:underline">
            Create an account
          </Link>
        </>
      }
    >
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
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            className="h-9 text-sm"
          />
          <FieldError id="email-error" message={fieldErrors.email} />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-xs">
              Password
            </Label>
            <Link to="/forgot-password" className="text-[11px] font-medium text-brand hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            className="h-9 text-sm"
          />
          <FieldError id="password-error" message={fieldErrors.password} />
        </div>
        <Button type="submit" className="h-9 w-full text-sm" disabled={submitting || status === 'loading'}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
};

export default Login;
