import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '@/hooks/use-auth';
import { makeMembership, makeProfile } from '@/test/auth-utils';
import { NETWORK_ERROR_MESSAGE } from '@/lib/auth-errors';

// ---- a controllable stand-in for the Supabase browser client ---------------------------
type AuthListener = (event: string, session: Session | null) => void;
let listener: AuthListener | null = null;

const authApi = {
  onAuthStateChange: vi.fn((cb: AuthListener) => {
    listener = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  }),
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
};

vi.mock('@/database/client', () => ({ getSupabaseClient: () => ({ auth: authApi }) }));
const getProfileById = vi.fn();
const getMyMemberships = vi.fn();
vi.mock('@/database/profiles', () => ({ getProfileById: (...a: unknown[]) => getProfileById(...a) }));
vi.mock('@/database/memberships', () => ({ getMyMemberships: (...a: unknown[]) => getMyMemberships(...a) }));

const SESSION = { user: { id: 'user-1', email: 'person@thinkbigbrand.com' } } as unknown as Session;

type Auth = ReturnType<typeof useAuth>;
let current: Auth;
const Probe: React.FC = () => {
  current = useAuth();
  return (
    <div>
      <span data-testid="status">{current.status}</span>
      <span data-testid="role">{current.role ?? 'none'}</span>
      <span data-testid="workspace">{current.workspace?.name ?? 'none'}</span>
      <span data-testid="error">{current.error ?? ''}</span>
    </div>
  );
};

function renderProvider(client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>
  );
  return client;
}

const status = () => screen.getByTestId('status').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  listener = null;
  window.localStorage.clear();
  authApi.getSession.mockResolvedValue({ data: { session: null }, error: null });
  authApi.signOut.mockResolvedValue({ error: null });
  getProfileById.mockResolvedValue(makeProfile());
  getMyMemberships.mockResolvedValue([makeMembership('QC_SPECIALIST')]);
});

describe('session restore', () => {
  it('starts loading, then unauthenticated when there is no session', async () => {
    renderProvider();
    expect(status()).toBe('loading');
    await waitFor(() => expect(status()).toBe('unauthenticated'));
    expect(getProfileById).not.toHaveBeenCalled();
  });

  it('restores an existing session on page load and exposes the real workspace role', async () => {
    authApi.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    renderProvider();
    await waitFor(() => expect(status()).toBe('authenticated'));
    expect(screen.getByTestId('role')).toHaveTextContent('QC_SPECIALIST');
    expect(screen.getByTestId('workspace')).toHaveTextContent('Think Big Brand');
    expect(getProfileById).toHaveBeenCalledWith('user-1');
    expect(getMyMemberships).toHaveBeenCalledWith('user-1');
    expect(current.isAuthenticated).toBe(true);
  });

  it('is authenticated but has no role or workspace when the user belongs to no workspace', async () => {
    authApi.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    getMyMemberships.mockResolvedValue([]);
    renderProvider();
    await waitFor(() => expect(status()).toBe('authenticated'));
    expect(current.memberships).toHaveLength(0);
    expect(screen.getByTestId('role')).toHaveTextContent('none');
  });

  it('reports an error state (never signed in) when the account cannot be loaded', async () => {
    authApi.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    getProfileById.mockRejectedValue(new TypeError('Failed to fetch'));
    renderProvider();
    await waitFor(() => expect(status()).toBe('error'));
    expect(current.isAuthenticated).toBe(false);
    expect(current.role).toBeNull();
    expect(screen.getByTestId('error')).toHaveTextContent(NETWORK_ERROR_MESSAGE);
  });

  it('a retry after an error loads the account', async () => {
    authApi.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    getProfileById.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderProvider();
    await waitFor(() => expect(status()).toBe('error'));
    await act(async () => {
      await current.refresh();
    });
    await waitFor(() => expect(status()).toBe('authenticated'));
  });

  it('blocks a deactivated account even though the session is valid', async () => {
    authApi.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    getProfileById.mockResolvedValue(makeProfile({ isActive: false }));
    renderProvider();
    await waitFor(() => expect(status()).toBe('deactivated'));
    expect(current.isAuthenticated).toBe(false);
    expect(current.role).toBeNull();
    expect(current.memberships).toHaveLength(0);
  });

  it('treats a failing getSession as signed out and shows the reason', async () => {
    authApi.getSession.mockRejectedValue(new TypeError('Failed to fetch'));
    renderProvider();
    await waitFor(() => expect(status()).toBe('unauthenticated'));
    expect(screen.getByTestId('error')).toHaveTextContent(NETWORK_ERROR_MESSAGE);
  });
});

describe('auth events', () => {
  it('signing in elsewhere (SIGNED_IN event) loads the account', async () => {
    renderProvider();
    await waitFor(() => expect(status()).toBe('unauthenticated'));
    act(() => listener?.('SIGNED_IN', SESSION));
    await waitFor(() => expect(status()).toBe('authenticated'));
  });

  it('SIGNED_OUT (for example from another tab) clears the account immediately', async () => {
    authApi.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    renderProvider();
    await waitFor(() => expect(status()).toBe('authenticated'));
    act(() => listener?.('SIGNED_OUT', null));
    await waitFor(() => expect(status()).toBe('unauthenticated'));
    expect(current.profile).toBeNull();
    expect(current.memberships).toHaveLength(0);
  });
});

describe('signIn', () => {
  beforeEach(async () => {
    renderProvider();
    await waitFor(() => expect(status()).toBe('unauthenticated'));
  });

  it('passes trimmed e-mail and password to Supabase Auth and reports success', async () => {
    authApi.signInWithPassword.mockResolvedValue({ data: { session: SESSION }, error: null });
    let result: Awaited<ReturnType<Auth['signIn']>> | undefined;
    await act(async () => {
      result = await current.signIn('  person@thinkbigbrand.com ', 'Secret123');
    });
    expect(authApi.signInWithPassword).toHaveBeenCalledWith({ email: 'person@thinkbigbrand.com', password: 'Secret123' });
    expect(result).toEqual({ ok: true });
  });

  it('invalid credentials give a clear message and no session', async () => {
    authApi.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 },
    });
    let result: Awaited<ReturnType<Auth['signIn']>> | undefined;
    await act(async () => {
      result = await current.signIn('person@thinkbigbrand.com', 'wrong');
    });
    expect(result).toEqual({ ok: false, message: 'Incorrect e-mail or password.' });
    expect(status()).toBe('unauthenticated');
  });

  it('NO OFFLINE FALLBACK: a network failure reports the outage and never fakes a login', async () => {
    authApi.signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'));
    let result: Awaited<ReturnType<Auth['signIn']>> | undefined;
    await act(async () => {
      result = await current.signIn('person@thinkbigbrand.com', 'Secret123');
    });
    expect(result).toEqual({ ok: false, message: NETWORK_ERROR_MESSAGE });
    expect(status()).toBe('unauthenticated');
    expect(current.user).toBeNull();
    // zero fake sessions in browser storage
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('an unconfirmed e-mail is explained', async () => {
    authApi.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { code: 'email_not_confirmed', message: 'Email not confirmed', status: 400 },
    });
    let result: Awaited<ReturnType<Auth['signIn']>> | undefined;
    await act(async () => {
      result = await current.signIn('a@b.co', 'Secret123');
    });
    expect(result && !result.ok && result.message).toMatch(/confirm your e-mail/i);
  });
});

describe('signUp', () => {
  beforeEach(async () => {
    renderProvider();
    await waitFor(() => expect(status()).toBe('unauthenticated'));
  });

  it('sends only the display name as metadata: a role can never be requested', async () => {
    authApi.signUp.mockResolvedValue({ data: { session: null, user: { id: 'new' } }, error: null });
    let result: Awaited<ReturnType<Auth['signUp']>> | undefined;
    await act(async () => {
      result = await current.signUp('  New Hire ', ' new@thinkbigbrand.com ', 'Secret123');
    });
    const arg = authApi.signUp.mock.calls[0][0] as { email: string; options: { data: Record<string, unknown>; emailRedirectTo: string } };
    expect(arg.email).toBe('new@thinkbigbrand.com');
    expect(arg.options.data).toEqual({ full_name: 'New Hire' });
    expect(Object.keys(arg.options.data)).not.toContain('role');
    expect(arg.options.emailRedirectTo).toBe(`${window.location.origin}/auth/callback`);
    expect(result).toEqual({ ok: true, needsConfirmation: true });
  });

  it('reports no confirmation needed when a session starts immediately', async () => {
    authApi.signUp.mockResolvedValue({ data: { session: SESSION, user: { id: 'u' } }, error: null });
    let result: Awaited<ReturnType<Auth['signUp']>> | undefined;
    await act(async () => {
      result = await current.signUp('A B', 'a@b.co', 'Secret123');
    });
    expect(result).toEqual({ ok: true, needsConfirmation: false });
  });

  it('maps errors and network failures', async () => {
    authApi.signUp.mockResolvedValueOnce({ data: {}, error: { code: 'weak_password', message: 'weak' } });
    authApi.signUp.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    let a: Awaited<ReturnType<Auth['signUp']>> | undefined;
    let b: Awaited<ReturnType<Auth['signUp']>> | undefined;
    await act(async () => {
      a = await current.signUp('A', 'a@b.co', 'x');
      b = await current.signUp('A', 'a@b.co', 'x');
    });
    expect(a && !a.ok && a.message).toMatch(/too weak/i);
    expect(b).toEqual({ ok: false, message: NETWORK_ERROR_MESSAGE });
  });
});

describe('signOut', () => {
  it('ends the session, clears the query cache and resets all account state', async () => {
    authApi.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    const client = renderProvider();
    client.setQueryData(['workspace', 'ws-1', 'members'], [{ id: 'secret' }]);
    await waitFor(() => expect(status()).toBe('authenticated'));
    await act(async () => {
      await current.signOut();
    });
    expect(authApi.signOut).toHaveBeenCalledTimes(1);
    expect(status()).toBe('unauthenticated');
    expect(current.profile).toBeNull();
    expect(current.role).toBeNull();
    expect(client.getQueryData(['workspace', 'ws-1', 'members'])).toBeUndefined();
  });

  it('still signs out on this device when the server cannot be reached', async () => {
    authApi.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    authApi.signOut.mockResolvedValueOnce({ error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' } });
    renderProvider();
    await waitFor(() => expect(status()).toBe('authenticated'));
    await act(async () => {
      await current.signOut();
    });
    expect(authApi.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
    expect(status()).toBe('unauthenticated');
  });

  it('survives signOut throwing', async () => {
    authApi.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    authApi.signOut.mockRejectedValue(new Error('boom'));
    renderProvider();
    await waitFor(() => expect(status()).toBe('authenticated'));
    await act(async () => {
      await current.signOut();
    });
    expect(status()).toBe('unauthenticated');
  });
});

describe('environment-aware e-mail links', () => {
  beforeEach(async () => {
    renderProvider();
    await waitFor(() => expect(status()).toBe('unauthenticated'));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('production: sign-up confirmation and password reset use VITE_APP_URL, never localhost', async () => {
    vi.stubEnv('VITE_APP_URL', 'https://workspace-manager-five.vercel.app');
    authApi.signUp.mockResolvedValue({ data: { session: null, user: { id: 'n' } }, error: null });
    authApi.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    await act(async () => {
      await current.signUp('A B', 'a@b.co', 'Secret123');
      await current.requestPasswordReset('a@b.co');
    });
    const signUpArg = authApi.signUp.mock.calls[0][0] as { options: { emailRedirectTo: string } };
    expect(signUpArg.options.emailRedirectTo).toBe('https://workspace-manager-five.vercel.app/auth/callback');
    expect(authApi.resetPasswordForEmail).toHaveBeenCalledWith('a@b.co', {
      redirectTo: 'https://workspace-manager-five.vercel.app/reset-password',
    });
    expect(JSON.stringify(authApi.signUp.mock.calls)).not.toMatch(/localhost/);
  });
});

describe('password reset', () => {
  beforeEach(async () => {
    renderProvider();
    await waitFor(() => expect(status()).toBe('unauthenticated'));
  });

  it('requests a reset link that returns to /reset-password on this origin', async () => {
    authApi.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    let result: Awaited<ReturnType<Auth['requestPasswordReset']>> | undefined;
    await act(async () => {
      result = await current.requestPasswordReset(' person@thinkbigbrand.com ');
    });
    expect(authApi.resetPasswordForEmail).toHaveBeenCalledWith('person@thinkbigbrand.com', {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    expect(result).toEqual({ ok: true });
  });

  it('maps reset and update failures', async () => {
    authApi.resetPasswordForEmail.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    authApi.updateUser.mockResolvedValueOnce({ data: {}, error: { code: 'same_password', message: 'x' } });
    authApi.updateUser.mockResolvedValueOnce({ data: {}, error: null });
    let a: Awaited<ReturnType<Auth['requestPasswordReset']>> | undefined;
    let b: Awaited<ReturnType<Auth['updatePassword']>> | undefined;
    let c: Awaited<ReturnType<Auth['updatePassword']>> | undefined;
    await act(async () => {
      a = await current.requestPasswordReset('a@b.co');
      b = await current.updatePassword('Secret123');
      c = await current.updatePassword('Secret456');
    });
    expect(a).toEqual({ ok: false, message: NETWORK_ERROR_MESSAGE });
    expect(b && !b.ok && b.message).toMatch(/different/i);
    expect(c).toEqual({ ok: true });
  });
});
