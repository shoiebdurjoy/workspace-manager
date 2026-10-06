import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { AppSidebar } from '../AppSidebar';
import { AppHeader } from '../AppHeader';
import { CommandPalette } from '../CommandPalette';
import { makeAuth, makeProfile, renderWithAuth } from '@/test/auth-utils';
import type { TbbRole } from '@/types/database';
import type { createDatabaseMock } from '@/test/database-mock';
import * as dbModule from '@/database';
import { IDS, makeTree } from '@/test/hierarchy-fixtures';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

beforeEach(() => {
  vi.clearAllMocks();
  db.getWorkspaceHierarchy.mockResolvedValue([]);
});

const sidebar = (role: TbbRole | null = 'EDITOR', collapsed = false) =>
  renderWithAuth(
    <Routes>
      <Route path="*" element={<AppSidebar isCollapsed={collapsed} onToggleCollapse={() => undefined} onOpenSearch={() => undefined} />} />
    </Routes>,
    { auth: makeAuth(role, { profile: makeProfile({ fullName: 'Pat Person' }) }), route: '/home' }
  );

describe('AppSidebar (Phase 2 shell on real data)', () => {
  it('shows the real workspace, user and role: no demo clients or fake spaces', async () => {
    sidebar('QC_SPECIALIST');
    expect(screen.getByText('Think Big Brand')).toBeInTheDocument();
    expect(screen.getByText('Pat Person')).toBeInTheDocument();
    expect(screen.getByText('QC Specialist')).toBeInTheDocument();
    expect(screen.queryByText(/EDAPTX|KRAV|Client Video Production|Daily Instagram/i)).not.toBeInTheDocument();
    expect(await screen.findByText('No spaces yet.')).toBeInTheDocument();
    expect(screen.queryByText(/arrive in Phase 5/i)).not.toBeInTheDocument();
  });

  it('renders the real hierarchy from the database', async () => {
    db.getWorkspaceHierarchy.mockResolvedValue(makeTree());
    sidebar('OWNER');
    expect(await screen.findByRole('link', { name: 'Content Pipelines' })).toHaveAttribute('href', `/spaces/${IDS.spaceA}`);
    expect(screen.getByRole('link', { name: 'Design' })).toBeInTheDocument();
  });

  it('client viewers get no Spaces section and no hierarchy request', async () => {
    sidebar('CLIENT_VIEWER');
    await screen.findByText('Pat Person');
    expect(screen.queryByRole('region', { name: 'Spaces' })).not.toBeInTheDocument();
    expect(db.getWorkspaceHierarchy).not.toHaveBeenCalled();
  });

  it('later-phase areas are visibly disabled, not simulated (no fake badge counts)', () => {
    sidebar();
    for (const name of ['Inbox', 'My Tasks', 'Everything']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: /Home/ })).toBeEnabled();
    expect(screen.getAllByText('Soon')).toHaveLength(3);
    expect(screen.queryByText(/^2$/)).not.toBeInTheDocument();
  });

  it('marks the current page', () => {
    sidebar();
    expect(screen.getByRole('button', { name: /Home/ })).toHaveAttribute('aria-current', 'page');
  });

  it('shows Team to staff but not to client viewers', () => {
    const { unmount } = sidebar('EDITOR');
    expect(screen.getByRole('button', { name: /Team/ })).toBeInTheDocument();
    unmount();
    sidebar('CLIENT_VIEWER');
    expect(screen.queryByRole('button', { name: /Team/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Settings/ })).toBeInTheDocument();
  });

  it('collapses to icons only', () => {
    sidebar('EDITOR', true);
    expect(screen.queryByText('Pat Person')).not.toBeInTheDocument();
    expect(screen.queryByText('Soon')).not.toBeInTheDocument();
  });
});

describe('AppHeader', () => {
  const header = (auth = makeAuth('ADMIN', { profile: makeProfile({ fullName: 'Pat Person', email: 'pat@thinkbigbrand.com' }) })) =>
    renderWithAuth(
      <Routes>
        <Route path="/home" element={<AppHeader onToggleMobileSidebar={() => undefined} onOpenSearch={() => undefined} />} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>,
      { auth, route: '/home' }
    );

  it('has no quick-task button and no offline badge (tasks arrive in a later phase)', () => {
    header();
    expect(screen.queryByRole('button', { name: /new task/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/local mode|offline/i)).not.toBeInTheDocument();
  });

  it('notifications are an honest empty state, not fake entries', async () => {
    header();
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.queryByText(/QC Approval Required|New Assignment/)).not.toBeInTheDocument();
  });

  it('account menu shows the real person and role and signs out to /login', async () => {
    const auth = makeAuth('ADMIN', { profile: makeProfile({ fullName: 'Pat Person', email: 'pat@thinkbigbrand.com' }) });
    header(auth);
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Pat Person')).toBeInTheDocument();
    expect(within(menu).getByText('pat@thinkbigbrand.com')).toBeInTheDocument();
    expect(within(menu).getByText('Admin')).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: /sign out/i }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('login page')).toBeInTheDocument();
  });
});

describe('CommandPalette', () => {
  it('offers only real destinations, gated by role', async () => {
    renderWithAuth(<CommandPalette open onOpenChange={() => undefined} />, { auth: makeAuth('EDITOR') });
    expect(await screen.findByText('Team members')).toBeInTheDocument();
    expect(screen.queryByText('Invite someone')).not.toBeInTheDocument();
    expect(screen.queryByText(/Create New Task|Payments|Reports/)).not.toBeInTheDocument();
  });

  it('admins can jump straight to invitations', async () => {
    renderWithAuth(<CommandPalette open onOpenChange={() => undefined} />, { auth: makeAuth('ADMIN') });
    expect(await screen.findByText('Invite someone')).toBeInTheDocument();
  });

  it('client viewers get no team shortcuts', async () => {
    renderWithAuth(<CommandPalette open onOpenChange={() => undefined} />, { auth: makeAuth('CLIENT_VIEWER') });
    await screen.findByText('Home');
    expect(screen.queryByText('Team members')).not.toBeInTheDocument();
  });

  it('Ctrl+K toggles it', async () => {
    const onOpenChange = vi.fn();
    renderWithAuth(<CommandPalette open={false} onOpenChange={onOpenChange} />, { auth: makeAuth('EDITOR') });
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
