import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import ProtectedRoute from '../ProtectedRoute';
import Can from '../Can';
import { makeAuth, renderWithAuth, signedOut } from '@/test/auth-utils';
import type { AuthContextValue } from '@/context/auth-context';

const LocationProbe: React.FC<{ label: string }> = ({ label }) => {
  const location = useLocation();
  return (
    <div>
      <span>{label}</span>
      <span data-testid="from">{JSON.stringify(location.state)}</span>
    </div>
  );
};

function app(auth: AuthContextValue, route = '/team?tab=pods', capability?: Parameters<typeof ProtectedRoute>[0]['capability']) {
  return renderWithAuth(
    <Routes>
      <Route path="/login" element={<LocationProbe label="login page" />} />
      <Route path="/onboarding" element={<LocationProbe label="onboarding page" />} />
      <Route path="/unauthorized" element={<LocationProbe label="unauthorized page" />} />
      <Route
        path="/team"
        element={
          <ProtectedRoute capability={capability}>
            <LocationProbe label="private team page" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/onboarding-only"
        element={
          <ProtectedRoute requireWorkspace={false}>
            <LocationProbe label="session-only page" />
          </ProtectedRoute>
        }
      />
    </Routes>,
    { auth, route }
  );
}

describe('ProtectedRoute', () => {
  it('shows a loading state while the session is being restored (no flash of private content)', () => {
    app(makeAuth('OWNER', { status: 'loading', isLoading: true, isAuthenticated: false }));
    expect(screen.getByText(/Checking your session/i)).toBeInTheDocument();
    expect(screen.queryByText('private team page')).not.toBeInTheDocument();
  });

  it('redirects signed-out visitors to /login and remembers where they were going', () => {
    app(signedOut());
    expect(screen.getByText('login page')).toBeInTheDocument();
    expect(screen.getByTestId('from')).toHaveTextContent('/team?tab=pods');
    expect(screen.queryByText('private team page')).not.toBeInTheDocument();
  });

  it('renders the page for a signed-in workspace member', () => {
    app(makeAuth('EDITOR'));
    expect(screen.getByText('private team page')).toBeInTheDocument();
  });

  it('sends a signed-in person without a workspace to /onboarding', () => {
    app(makeAuth(null));
    expect(screen.getByText('onboarding page')).toBeInTheDocument();
  });

  it('lets a person without a workspace use session-only routes', () => {
    app(makeAuth(null), '/onboarding-only');
    expect(screen.getByText('session-only page')).toBeInTheDocument();
  });

  it('shows an error with retry and sign-out (never the private page) when the account fails to load', async () => {
    const auth = makeAuth('OWNER', { status: 'error', isAuthenticated: false, error: 'Your account could not be loaded.' });
    app(auth);
    expect(screen.getByRole('alert')).toHaveTextContent('Your account could not be loaded.');
    expect(screen.queryByText('private team page')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('blocks a deactivated account', async () => {
    const auth = makeAuth('EDITOR', { status: 'deactivated', isAuthenticated: false });
    app(auth);
    expect(screen.getByText(/Account deactivated/i)).toBeInTheDocument();
    expect(screen.queryByText('private team page')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('enforces capabilities: roles without access go to /unauthorized', () => {
    app(makeAuth('CLIENT_VIEWER'), '/team', 'team:view');
    expect(screen.getByText('unauthorized page')).toBeInTheDocument();
  });

  it('enforces capabilities: roles with access get the page', () => {
    app(makeAuth('PRODUCTION_MANAGER'), '/team', 'team:view');
    expect(screen.getByText('private team page')).toBeInTheDocument();
  });
});

describe('<Can>', () => {
  it('renders children only when the role has the capability', () => {
    const { unmount } = renderWithAuth(
      <Can perform="users:invite" fallback={<span>no access</span>}>
        <button>Invite</button>
      </Can>,
      { auth: makeAuth('ADMIN') }
    );
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();
    unmount();

    renderWithAuth(
      <Can perform="users:invite" fallback={<span>no access</span>}>
        <button>Invite</button>
      </Can>,
      { auth: makeAuth('EDITOR') }
    );
    expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument();
    expect(screen.getByText('no access')).toBeInTheDocument();
  });

  it('renders nothing by default and hides everything when there is no role', () => {
    renderWithAuth(
      <Can perform="comments:post">
        <span>secret</span>
      </Can>,
      { auth: makeAuth(null) }
    );
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });
});

describe('useAuth outside a provider', () => {
  it('throws a clear error', async () => {
    const { useAuth } = await import('@/hooks/use-auth');
    const Broken: React.FC = () => {
      useAuth();
      return null;
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { render } = await import('@testing-library/react');
    expect(() => render(<Broken />)).toThrow(/within an AuthProvider/);
    spy.mockRestore();
  });
});
