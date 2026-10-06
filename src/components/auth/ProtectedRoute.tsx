import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { can, Capability } from '@/lib/permissions';
import { LoadingState } from '@/components/ui/loading-state';
import { ErrorState } from '@/components/ui/error-state';
import { Button } from '@/components/ui/button';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Require a workspace membership (default). Onboarding only needs a session. */
  requireWorkspace?: boolean;
  /** Optional capability from the permission model; missing it shows /unauthorized. */
  capability?: Capability;
}

export const FullScreen: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen w-full items-center justify-center bg-background p-6">
    <div className="w-full max-w-md">{children}</div>
  </div>
);

/**
 * Single gate for every private route (docs/TBB_ARCHITECTURE_PROPOSAL.md 4.1):
 *  - no session          -> /login (remembering where the user wanted to go)
 *  - account load failed -> error screen with retry (never a fake session)
 *  - deactivated         -> blocked with sign-out
 *  - no membership       -> /onboarding
 *  - missing capability  -> /unauthorized
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requireWorkspace = true,
  capability,
}) => {
  const { status, error, refresh, signOut, memberships, role } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <FullScreen>
        <LoadingState title="Loading TBB Workspace" description="Checking your session..." />
      </FullScreen>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }

  if (status === 'error') {
    return (
      <FullScreen>
        <ErrorState
          title="We couldn't load your account"
          message={error ?? 'Please try again.'}
          onRetry={() => void refresh()}
          onBack={() => void signOut()}
          backLabel="Sign out"
        />
      </FullScreen>
    );
  }

  if (status === 'deactivated') {
    return (
      <FullScreen>
        <div className="rounded-xl border bg-card p-6 text-center shadow-sm" role="alert">
          <ShieldOff className="mx-auto mb-3 h-8 w-8 text-destructive" />
          <h1 className="text-base font-semibold">Account deactivated</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your account has been deactivated by an administrator. Contact your TBB administrator if you think this is
            a mistake.
          </p>
          <Button className="mt-4" variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </FullScreen>
    );
  }

  if (requireWorkspace && memberships.length === 0) {
    return <Navigate to="/onboarding" replace />;
  }

  if (capability && !can(role, capability)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
