import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { HierarchyDialogsProvider } from '@/components/hierarchy/HierarchyDialogsProvider';
import { AuthContext, AuthContextValue } from '@/context/auth-context';
import type { MyMembership, Profile, TbbRole, Workspace } from '@/types/database';

export const WORKSPACE: Workspace = {
  id: 'ws-1',
  name: 'Think Big Brand',
  slug: 'think-big-brand-ab12',
  description: null,
  logoUrl: null,
  ownerId: 'user-owner',
  settings: {},
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'user-1',
    email: 'person@thinkbigbrand.com',
    fullName: 'Pat Person',
    avatarUrl: null,
    role: 'EDITOR',
    phone: null,
    timezone: 'UTC',
    isActive: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

export function makeMembership(role: TbbRole): MyMembership {
  return { workspace: WORKSPACE, role, joinedAt: '2026-10-01T00:00:00Z' };
}

/** A fully signed-in auth value for the given workspace role; override anything per test. */
export function makeAuth(
  role: TbbRole | null = 'EDITOR',
  overrides: Partial<AuthContextValue> = {}
): AuthContextValue {
  const membership = role ? makeMembership(role) : null;
  const profile = makeProfile();
  return {
    status: 'authenticated',
    isLoading: false,
    isAuthenticated: true,
    user: { id: profile.id, email: profile.email },
    profile,
    memberships: membership ? [membership] : [],
    activeMembership: membership,
    workspace: membership?.workspace ?? null,
    role,
    error: null,
    signIn: vi.fn().mockResolvedValue({ ok: true }),
    signUp: vi.fn().mockResolvedValue({ ok: true, needsConfirmation: true }),
    signOut: vi.fn().mockResolvedValue(undefined),
    requestPasswordReset: vi.fn().mockResolvedValue({ ok: true }),
    updatePassword: vi.fn().mockResolvedValue({ ok: true }),
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

export function signedOut(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return makeAuth(null, {
    status: 'unauthenticated',
    isAuthenticated: false,
    user: null,
    profile: null,
    ...overrides,
  });
}

export function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

export function renderWithAuth(
  ui: React.ReactElement,
  { auth = makeAuth(), route = '/', client = newQueryClient() }: { auth?: AuthContextValue; route?: string | { pathname: string; state?: unknown }; client?: QueryClient } = {}
) {
  const result = render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[route]}>
          <HierarchyDialogsProvider>{ui}</HierarchyDialogsProvider>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
  return { ...result, auth, client };
}
