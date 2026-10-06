import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import Onboarding from '../Onboarding';
import Home from '../Home';
import Profile from '../Profile';
import Settings from '../Settings';
import { makeAuth, makeProfile, renderWithAuth, signedOut } from '@/test/auth-utils';
import type { TbbRole } from '@/types/database';

const db = vi.hoisted(() => {
  class PermissionDeniedError extends Error {}
  return {
    PermissionDeniedError,
    createWorkspace: vi.fn(),
    updateProfile: vi.fn(),
    updateWorkspace: vi.fn(),
    getWorkspaceMembers: vi.fn(),
    listInvitations: vi.fn(),
    listTeams: vi.fn(),
    listTeamMembers: vi.fn(),
    getWorkspaceHierarchy: vi.fn(),
  };
});
vi.mock('@/database', () => db);

beforeEach(() => {
  vi.clearAllMocks();
  db.getWorkspaceMembers.mockResolvedValue([{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }]);
  db.listInvitations.mockResolvedValue([
    { id: '1', acceptedAt: null },
    { id: '2', acceptedAt: null },
    { id: '3', acceptedAt: '2026-10-01' },
  ]);
  db.listTeams.mockResolvedValue([{ id: 't1' }]);
  db.getWorkspaceHierarchy.mockResolvedValue([]);
  db.listTeamMembers.mockResolvedValue([]);
  db.createWorkspace.mockResolvedValue({ id: 'ws-new' });
  db.updateProfile.mockResolvedValue(makeProfile());
  db.updateWorkspace.mockResolvedValue({});
});

describe('Onboarding', () => {
  const renderOnboarding = (auth = makeAuth(null)) =>
    renderWithAuth(
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/home" element={<div>home page</div>} />
      </Routes>,
      { auth, route: '/onboarding' }
    );

  it('tells the person which address must be invited and lets them check again', async () => {
    const auth = makeAuth(null);
    renderOnboarding(auth);
    expect(screen.getAllByText(auth.user!.email).length).toBeGreaterThan(0);
    expect(screen.getByText('Waiting for an invitation')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /check again/i }));
    await waitFor(() => expect(auth.refresh).toHaveBeenCalledTimes(1));
  });

  it('first-time setup creates the workspace owned by the signed-in user', async () => {
    const auth = makeAuth(null);
    renderOnboarding(auth);
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => expect(db.createWorkspace).toHaveBeenCalledTimes(1));
    const arg = db.createWorkspace.mock.calls[0][0] as { name: string; slug: string; ownerId: string };
    expect(arg.name).toBe('Think Big Brand');
    expect(arg.slug).toMatch(/^think-big-brand-[a-z0-9]{1,4}$/);
    expect(arg.ownerId).toBe(auth.user!.id);
    await waitFor(() => expect(auth.refresh).toHaveBeenCalled());
  });

  it('requires a workspace name', async () => {
    renderOnboarding();
    await userEvent.clear(screen.getByLabelText('Workspace name'));
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(await screen.findByText('Enter the workspace name.')).toBeInTheDocument();
    expect(db.createWorkspace).not.toHaveBeenCalled();
  });

  it('once the workspace exists the database refuses and the person is told to ask for an invitation', async () => {
    db.createWorkspace.mockRejectedValue(new db.PermissionDeniedError('You do not have permission to create the workspace.'));
    renderOnboarding();
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/workspace already exists/i);
  });

  it('shows unexpected errors', async () => {
    db.createWorkspace.mockRejectedValue(new Error('Database is on fire'));
    renderOnboarding();
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is on fire');
  });

  it('moves on to Home as soon as a membership exists', () => {
    renderOnboarding(makeAuth('EDITOR'));
    expect(screen.getByText('home page')).toBeInTheDocument();
  });

  it('can sign out', async () => {
    const auth = makeAuth(null);
    renderOnboarding(auth);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalled();
  });
});

describe('Home', () => {
  const renderHome = (role: TbbRole) =>
    renderWithAuth(<Home />, { auth: makeAuth(role, { profile: makeProfile({ fullName: 'Pat Person' }) }) });

  it('greets the person and shows their real role and workspace', async () => {
    renderHome('QC_SPECIALIST');
    expect(screen.getByRole('heading', { name: 'Welcome, Pat' })).toBeInTheDocument();
    expect(screen.getByText('Think Big Brand')).toBeInTheDocument();
    expect(screen.getAllByText('QC Specialist').length).toBeGreaterThan(0);
  });

  it('an admin sees members, pods and pending invitations from the database', async () => {
    renderHome('ADMIN');
    expect(await screen.findByText('Pending invitations')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Members').previousElementSibling).toHaveTextContent('3'));
    expect(screen.getByText('Pods').previousElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Pending invitations').previousElementSibling).toHaveTextContent('2');
  });

  it('an editor sees members and pods but not invitations', async () => {
    renderHome('EDITOR');
    expect(await screen.findByText('Members')).toBeInTheDocument();
    expect(screen.queryByText('Pending invitations')).not.toBeInTheDocument();
    expect(db.listInvitations).not.toHaveBeenCalled();
  });

  it('a client viewer sees no internal summary or team link', () => {
    renderHome('CLIENT_VIEWER');
    expect(screen.queryByText('Members')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open team/i })).not.toBeInTheDocument();
    expect(db.getWorkspaceMembers).not.toHaveBeenCalledWith(undefined);
  });

  it('does not invent tasks or notifications', async () => {
    renderHome('OWNER');
    await screen.findByText('No spaces yet.', { exact: false });
    expect(screen.queryByText(/overdue|due today|assigned to you/i)).not.toBeInTheDocument();
  });
});

describe('Profile', () => {
  it('saves only display fields: role, e-mail and active status are never sent', async () => {
    const auth = makeAuth('EDITOR', { profile: makeProfile({ fullName: 'Pat Person', phone: null, timezone: 'UTC' }) });
    renderWithAuth(<Profile />, { auth });
    await userEvent.clear(screen.getByLabelText('Full name'));
    await userEvent.type(screen.getByLabelText('Full name'), 'Patricia Person');
    await userEvent.type(screen.getByLabelText('Phone'), '+880 1700 000000');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(db.updateProfile).toHaveBeenCalledTimes(1));
    const [id, updates] = db.updateProfile.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe('user-1');
    expect(Object.keys(updates).sort()).toEqual(['fullName', 'phone', 'timezone']);
    expect(updates).toMatchObject({ fullName: 'Patricia Person', phone: '+880 1700 000000', timezone: 'UTC' });
    await waitFor(() => expect(auth.refresh).toHaveBeenCalled());
  });

  it('requires a name and reports save failures', async () => {
    renderWithAuth(<Profile />, { auth: makeAuth('EDITOR') });
    await userEvent.clear(screen.getByLabelText('Full name'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter your name.')).toBeInTheDocument();
    expect(db.updateProfile).not.toHaveBeenCalled();

    db.updateProfile.mockRejectedValue(new Error('You do not have permission to update your profile.'));
    await userEvent.type(screen.getByLabelText('Full name'), 'Pat');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('do not have permission');
  });

  it('changes the password through Supabase Auth after validating it', async () => {
    const auth = makeAuth('EDITOR');
    renderWithAuth(<Profile />, { auth });
    await userEvent.type(screen.getByLabelText('New password'), 'weakpass');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'weakpass');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText(/upper-case/i)).toBeInTheDocument();
    expect(auth.updatePassword).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.clear(screen.getByLabelText('Confirm new password'));
    await userEvent.type(screen.getByLabelText('New password'), 'Strong123');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'Strong123');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    await waitFor(() => expect(auth.updatePassword).toHaveBeenCalledWith('Strong123'));
  });

  it('shows the password change error from the server', async () => {
    const auth = makeAuth('EDITOR', { updatePassword: async () => ({ ok: false, message: 'Your new password must be different from the current one.' }) });
    renderWithAuth(<Profile />, { auth });
    await userEvent.type(screen.getByLabelText('New password'), 'Strong123');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'Strong123');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('must be different');
  });
});

describe('Settings', () => {
  it('only the Owner can edit workspace settings', async () => {
    const auth = makeAuth('OWNER');
    renderWithAuth(<Settings />, { auth });
    const name = screen.getByLabelText('Name');
    expect(name).toBeEnabled();
    await userEvent.clear(name);
    await userEvent.type(name, 'TBB Studio');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(db.updateWorkspace).toHaveBeenCalledWith('ws-1', { name: 'TBB Studio', description: null }));
    await waitFor(() => expect(auth.refresh).toHaveBeenCalled());
  });

  it.each(['ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR', 'CLIENT_VIEWER'] as TbbRole[])(
    '%s sees the settings read-only',
    (role) => {
      renderWithAuth(<Settings />, { auth: makeAuth(role) });
      expect(screen.getByLabelText('Name')).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
      expect(screen.getByText(/Only the workspace Owner/)).toBeInTheDocument();
    }
  );

  it('requires a name and reports failures', async () => {
    renderWithAuth(<Settings />, { auth: makeAuth('OWNER') });
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter the workspace name.')).toBeInTheDocument();
    db.updateWorkspace.mockRejectedValue(new Error('Failed to update workspace'));
    await userEvent.type(screen.getByLabelText('Name'), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to update workspace');
  });

  it('renders nothing without a workspace', () => {
    const { container } = renderWithAuth(<Settings />, { auth: signedOut() });
    expect(container).toBeEmptyDOMElement();
  });
});
