import React, { useEffect } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { MailX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/loading-state';
import AuthLayout from '@/components/auth/AuthLayout';
import { useAuth } from '@/hooks/use-auth';
import { readCallbackError } from '@/lib/auth-callback';

/**
 * Landing page of the sign-up confirmation link (/auth/callback?code=...).
 *
 * supabase-js (PKCE) exchanges the one-time code for a session while the client starts up, and
 * AuthProvider only leaves `loading` once that has finished. This page just waits for the
 * result: a session continues to the app (Home, or onboarding for people without a workspace);
 * anything else explains what happened. No session is ever fabricated here.
 */
const AuthCallback: React.FC = () => {
  const { status, error } = useAuth();
  const location = useLocation();
  const linkError = readCallbackError(location.search, location.hash);

  useEffect(() => {
    document.title = 'Confirming your account · TBB Workspace';
  }, []);

  if (!linkError && status === 'loading') {
    return (
      <AuthLayout title="Confirming your account">
        <LoadingState title="Signing you in..." className="min-h-[120px]" />
      </AuthLayout>
    );
  }

  if (!linkError && (status === 'authenticated' || status === 'deactivated')) {
    return <Navigate to="/home" replace />;
  }

  const message =
    linkError?.message ??
    error ??
    'We could not sign you in from this link. If you opened it on a different device or browser than the one you registered in, your e-mail is still confirmed: just sign in with your password.';

  return (
    <AuthLayout
      title="Could not complete sign-in"
      footer={
        <Link to="/register" className="font-medium text-brand hover:underline">
          Create an account
        </Link>
      }
    >
      <div className="space-y-4">
        <MailX className="h-8 w-8 text-destructive" />
        <p role="alert" className="text-sm text-muted-foreground">
          {message}
        </p>
        <Button asChild className="h-9 w-full text-sm">
          <Link to="/login">Go to sign in</Link>
        </Button>
        <p className="text-center text-[11px] text-muted-foreground">
          <Link to="/forgot-password" className="font-medium text-brand hover:underline">
            Forgot your password?
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
};

export default AuthCallback;
