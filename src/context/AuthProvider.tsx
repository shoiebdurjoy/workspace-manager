import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/database/client';
import { getMyMemberships } from '@/database/memberships';
import { getProfileById } from '@/database/profiles';
import type { MyMembership, Profile } from '@/types/database';
import { describeAuthError } from '@/lib/auth-errors';
import {
  ActionResult,
  AuthContext,
  AuthContextValue,
  AuthStatus,
  AuthUser,
  SignUpResult,
} from '@/context/auth-context';

interface AccountState {
  profile: Profile | null;
  memberships: MyMembership[];
}

const EMPTY_ACCOUNT: AccountState = { profile: null, memberships: [] };

/**
 * Real Supabase Auth, nothing else. There is no localStorage user, no offline mode and no
 * demo login: if the backend cannot be reached the user sees an error and stays signed out
 * (or in the `error` state), never a fabricated session. Session persistence and token
 * refresh are handled by supabase-js (PKCE flow).
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [account, setAccount] = useState<AccountState>(EMPTY_ACCOUNT);
  const [accountStatus, setAccountStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const loadToken = useRef(0);

  // 1) Restore the session and follow auth events.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    try {
      const client = getSupabaseClient();

      const { data } = client.auth.onAuthStateChange((event, next) => {
        if (cancelled) return;
        // Never call supabase APIs inside this callback (it can deadlock); just record state.
        setSession(next);
        if (event === 'SIGNED_OUT') {
          setAccount(EMPTY_ACCOUNT);
          setAccountStatus('idle');
          setError(null);
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();

      client.auth
        .getSession()
        .then(({ data: sessionData, error: sessionError }) => {
          if (cancelled) return;
          if (sessionError) {
            setError(describeAuthError(sessionError));
          }
          setSession(sessionData.session);
          setSessionReady(true);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(describeAuthError(err));
          setSessionReady(true);
        });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The application is not configured.');
      setSessionReady(true);
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // 2) Load profile + memberships whenever the signed-in user changes.
  const userId = session?.user.id ?? null;

  const loadAccount = useCallback(async (id: string) => {
    const token = ++loadToken.current;
    setAccountStatus('loading');
    try {
      const [profile, memberships] = await Promise.all([getProfileById(id), getMyMemberships(id)]);
      if (token !== loadToken.current) return;
      setAccount({ profile, memberships });
      setAccountStatus('ready');
      setError(null);
    } catch (err) {
      if (token !== loadToken.current) return;
      setAccount(EMPTY_ACCOUNT);
      setAccountStatus('error');
      setError(describeAuthError(err).replace('Something went wrong. Please try again.', 'Your account could not be loaded. Please try again.'));
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      loadToken.current++;
      setAccount(EMPTY_ACCOUNT);
      setAccountStatus('idle');
      return;
    }
    void loadAccount(userId);
  }, [userId, loadAccount]);

  const refresh = useCallback(async () => {
    if (userId) await loadAccount(userId);
  }, [userId, loadAccount]);

  // 3) Actions
  const signIn = useCallback(async (email: string, password: string): Promise<ActionResult> => {
    try {
      const { error: signInError } = await getSupabaseClient().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) return { ok: false, message: describeAuthError(signInError) };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: describeAuthError(err) };
    }
  }, []);

  const signUp = useCallback(
    async (fullName: string, email: string, password: string): Promise<SignUpResult> => {
      try {
        const { data, error: signUpError } = await getSupabaseClient().auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: fullName.trim() },
            emailRedirectTo: `${window.location.origin}/login`,
          },
        });
        if (signUpError) return { ok: false, message: describeAuthError(signUpError) };
        return { ok: true, needsConfirmation: !data.session };
      } catch (err) {
        return { ok: false, message: describeAuthError(err) };
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    try {
      const { error: signOutError } = await getSupabaseClient().auth.signOut();
      if (signOutError) {
        // The server could not be told (e.g. offline): still end the session on this device.
        await getSupabaseClient().auth.signOut({ scope: 'local' });
      }
    } catch {
      try {
        await getSupabaseClient().auth.signOut({ scope: 'local' });
      } catch {
        // nothing more can be done; state is reset below
      }
    }
    queryClient.clear();
    setSession(null);
    setAccount(EMPTY_ACCOUNT);
    setAccountStatus('idle');
    setError(null);
  }, [queryClient]);

  const requestPasswordReset = useCallback(async (email: string): Promise<ActionResult> => {
    try {
      const { error: resetError } = await getSupabaseClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) return { ok: false, message: describeAuthError(resetError) };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: describeAuthError(err) };
    }
  }, []);

  const updatePassword = useCallback(async (newPassword: string): Promise<ActionResult> => {
    try {
      const { error: updateError } = await getSupabaseClient().auth.updateUser({ password: newPassword });
      if (updateError) return { ok: false, message: describeAuthError(updateError) };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: describeAuthError(err) };
    }
  }, []);

  // 4) Derived state
  const value = useMemo<AuthContextValue>(() => {
    let status: AuthStatus;
    if (!sessionReady) status = 'loading';
    else if (!session) status = 'unauthenticated';
    else if (accountStatus === 'idle' || accountStatus === 'loading') status = 'loading';
    else if (accountStatus === 'error') status = 'error';
    else if (account.profile && !account.profile.isActive) status = 'deactivated';
    else status = 'authenticated';

    const user: AuthUser | null = session ? { id: session.user.id, email: session.user.email ?? '' } : null;
    const activeMembership = status === 'authenticated' ? account.memberships[0] ?? null : null;

    return {
      status,
      isLoading: status === 'loading',
      isAuthenticated: status === 'authenticated',
      user,
      profile: status === 'authenticated' || status === 'deactivated' ? account.profile : null,
      memberships: status === 'authenticated' ? account.memberships : [],
      activeMembership,
      workspace: activeMembership?.workspace ?? null,
      role: activeMembership?.role ?? null,
      error,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
      refresh,
    };
  }, [
    sessionReady,
    session,
    account,
    accountStatus,
    error,
    signIn,
    signUp,
    signOut,
    requestPasswordReset,
    updatePassword,
    refresh,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
