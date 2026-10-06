import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Team from '../Team';
import { makeAuth, makeProfile, renderWithAuth } from '@/test/auth-utils';
import type { TbbRole, Team as TeamModel, WorkspaceInvitation, WorkspaceMember } from '@/types/database';

const db = vi.hoisted(() => ({
  getWorkspaceMembers: vi.fn(),
  listInvitations: vi.fn(),
  listTeams: vi.fn(),
  listTeamMembers: vi.fn(),
  updateMemberRole: vi.fn(),
  removeWorkspaceMember: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
}));
vi.mock('@/database', () => db);

function member(userId: string, fullName: string, role: TbbRole): WorkspaceMember {
  return {
    workspaceId: 'ws-1',
    userId,
    role,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    profile: makeProfile({ id: userId, fullName, email: `${userId}@thinkbigbrand.com` }),
  };
}

const MEMBERS = [
  member('user-owner', 'Olive Owner', 'OWNER'),
  member('user-admin', 'Ada Admin', 'ADMIN'),
  member('user-1', 'Pat Person', 'EDITOR'), // "me" in makeAuth
  member('user-qc', 'Quinn QC', 'QC_SPECIALIST'),
];
const TEAM: TeamModel = {
  id: 'team-1',
  workspaceId: 'ws-1',
  name: 'Pod Zim',
  description: 'Zim pipeline',
  color: '#7B68EE',
  leadId: 'user-admin',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};
const PENDING: WorkspaceInvitation = {
  id: 'inv-1',
  workspaceId: 'ws-1',
  email: 'new.hire@thinkbigbrand.com',
  role: 'QC_SPECIALIST',
  createdAt: '2026-10-02T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  db.getWorkspaceMembers.mockResolvedValue(MEMBERS);
  db.listInvitations.mockResolvedValue([PENDING]);
  db.listTeams.mockResolvedValue([TEAM]);
  db.listTeamMembers.mockResolvedValue([{ teamId: 'team-1', userId: 'user-qc', workspaceId: 'ws-1', createdAt: '2026-10-01T00:00:00Z' }]);
  db.updateMemberRole.mockResolvedValue({});
  db.removeWorkspaceMember.mockResolvedValue(undefined);
  db.createInvitation.mockImplementation(async (i: { email: string; role: TbbRole }) => ({ ...PENDING, id: 'inv-2', email: i.email, role: i.role }));
  db.revokeInvitation.mockResolvedValue(undefined);
  db.createTeam.mockResolvedValue({ ...TEAM, id: 'team-2', name: 'Pod Myla' });
  db.addTeamMember.mockResolvedValue(undefined);
});

const renderTeam = (role: TbbRole, route = '/team', userId = 'user-1') =>
  renderWithAuth(<Team />, {
    auth: makeAuth(role, { user: { id: userId, email: `${userId}@thinkbigbrand.com` }, profile: makeProfile({ id: userId }) }),
    route,
  });

describe('Team page: members', () => {
  it('lists real members with their roles and pods', async () => {
    renderTeam('EDITOR');
    expect(await screen.findByText('Olive Owner')).toBeInTheDocument();
    expect(screen.getByText('Ada Admin')).toBeInTheDocument();
    expect(screen.getByText('Quinn QC')).toBeInTheDocument();
    expect(screen.getByText('(you)')).toBeInTheDocument();
    expect(screen.getByText(/4 people in Think Big Brand/)).toBeInTheDocument();
    // Quinn is in Pod Zim
    const row = screen.getByText('Quinn QC').closest('tr') as HTMLElement;
    expect(within(row).getByText('Pod Zim')).toBeInTheDocument();
  });

  it('an editor gets a read-only list: no role editing, no removal, no invitations tab', async () => {
    renderTeam('EDITOR');
    await screen.findByText('Olive Owner');
    expect(screen.queryByRole('tab', { name: 'Invitations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove .* from the workspace/i })).not.toBeInTheDocument();
    expect(db.listInvitations).not.toHaveBeenCalled();
  });

  it('a production manager cannot change roles either', async () => {
    renderTeam('PRODUCTION_MANAGER');
    await screen.findByText('Olive Owner');
    expect(screen.queryByRole('combobox', { name: /role for/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Invitations' })).not.toBeInTheDocument();
  });

  it('an admin can edit everyone except the owner and themselves', async () => {
    renderTeam('ADMIN', '/team', 'user-admin');
    await screen.findByText('Olive Owner');
    expect(screen.queryByRole('combobox', { name: 'Role for Olive Owner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Role for Ada Admin' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role for Pat Person' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role for Quinn QC' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove olive owner/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove pat person/i })).toBeInTheDocument();
  });

  it('an owner can also manage admins', async () => {
    renderTeam('OWNER', '/team', 'user-owner');
    await screen.findByText('Olive Owner');
    expect(screen.getByRole('combobox', { name: 'Role for Ada Admin' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Role for Olive Owner' })).not.toBeInTheDocument();
  });

  it('changing a role calls the database with the chosen role', async () => {
    renderTeam('ADMIN', '/team', 'user-admin');
    await screen.findByText('Olive Owner');
    await userEvent.click(screen.getByRole('combobox', { name: 'Role for Pat Person' }));
    const options = await screen.findAllByRole('option');
    // an Admin may never hand out OWNER
    expect(options.map((o) => o.textContent)).not.toContain('Owner');
    await userEvent.click(screen.getByRole('option', { name: 'Production Manager' }));
    await waitFor(() => expect(db.updateMemberRole).toHaveBeenCalledWith('ws-1', 'user-1', 'PRODUCTION_MANAGER'));
  });

  it('removing a member asks for confirmation first', async () => {
    renderTeam('ADMIN', '/team', 'user-admin');
    await screen.findByText('Olive Owner');
    await userEvent.click(screen.getByRole('button', { name: /remove quinn qc/i }));
    expect(db.removeWorkspaceMember).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Remove Quinn QC?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(db.removeWorkspaceMember).toHaveBeenCalledWith('ws-1', 'user-qc'));
  });

  it('filters by name, e-mail or role', async () => {
    renderTeam('EDITOR');
    await screen.findByText('Olive Owner');
    await userEvent.type(screen.getByLabelText('Filter members'), 'quinn');
    expect(screen.queryByText('Olive Owner')).not.toBeInTheDocument();
    expect(screen.getByText('Quinn QC')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Filter members'));
    await userEvent.type(screen.getByLabelText('Filter members'), 'zzz-nobody');
    expect(await screen.findByText('No matching members')).toBeInTheDocument();
  });

  it('shows a retryable error when members cannot be loaded', async () => {
    db.getWorkspaceMembers.mockRejectedValueOnce(new Error('Failed to load members'));
    renderTeam('EDITOR');
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load members');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Olive Owner')).toBeInTheDocument();
  });
});

describe('Team page: invitations', () => {
  it('only Owner/Admin see the Invitations tab', async () => {
    renderTeam('ADMIN', '/team', 'user-admin');
    expect(await screen.findByRole('tab', { name: 'Invitations' })).toBeInTheDocument();
  });

  it('a non-admin opening ?tab=invitations falls back to Members', async () => {
    renderTeam('QC_SPECIALIST', '/team?tab=invitations');
    expect(await screen.findByText('Olive Owner')).toBeInTheDocument();
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument();
  });

  it('invites a person: e-mail is validated and sent with the chosen role', async () => {
    renderTeam('OWNER', '/team?tab=invitations', 'user-owner');
    await screen.findByText('new.hire@thinkbigbrand.com');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));
    expect(await screen.findByText('Enter your e-mail address.')).toBeInTheDocument();
    expect(db.createInvitation).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('E-mail'), 'editor.person@thinkbigbrand.com');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));
    await waitFor(() =>
      expect(db.createInvitation).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        email: 'editor.person@thinkbigbrand.com',
        role: 'EDITOR',
      })
    );
  });

  it('the role list never offers OWNER', async () => {
    renderTeam('OWNER', '/team?tab=invitations', 'user-owner');
    await screen.findByText('new.hire@thinkbigbrand.com');
    await userEvent.click(screen.getByRole('combobox', { name: 'Role for the invited person' }));
    const names = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(names).toEqual(['Admin', 'Production Manager', 'QC Specialist', 'Editor', 'Client Viewer']);
  });

  it('lists pending invitations and revokes one', async () => {
    renderTeam('ADMIN', '/team?tab=invitations', 'user-admin');
    expect(await screen.findByText('new.hire@thinkbigbrand.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Revoke invitation for new.hire@thinkbigbrand.com' }));
    await waitFor(() => expect(db.revokeInvitation).toHaveBeenCalledWith('inv-1'));
  });
});

describe('Team page: pods', () => {
  it('everyone on staff sees pods; only Owner/Admin can create them', async () => {
    const { unmount } = renderTeam('EDITOR', '/team?tab=pods');
    expect(await screen.findByText('Pod Zim')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New pod' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete pod/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /add a member/i })).not.toBeInTheDocument();
    unmount();

    renderTeam('ADMIN', '/team?tab=pods', 'user-admin');
    expect(await screen.findByRole('button', { name: 'New pod' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete pod Pod Zim' })).toBeInTheDocument();
  });

  it('a production manager can add people to a pod but not create or delete pods', async () => {
    renderTeam('PRODUCTION_MANAGER', '/team?tab=pods');
    await screen.findByText('Pod Zim');
    expect(screen.queryByRole('button', { name: 'New pod' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete pod/i })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Add a member to Pod Zim' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove quinn qc from pod zim/i })).toBeInTheDocument();
  });

  it('shows the lead and the members of a pod', async () => {
    renderTeam('EDITOR', '/team?tab=pods');
    const card = (await screen.findByText('Pod Zim')).closest('article') as HTMLElement;
    expect(within(card).getByText(/Lead: Ada Admin/)).toBeInTheDocument();
    expect(within(card).getByText('Quinn QC')).toBeInTheDocument();
  });

  it('creating a pod validates the name and calls the database', async () => {
    renderTeam('ADMIN', '/team?tab=pods', 'user-admin');
    await userEvent.click(await screen.findByRole('button', { name: 'New pod' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create pod' }));
    expect(await within(dialog).findByText('Enter a pod name.')).toBeInTheDocument();
    expect(db.createTeam).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText('Name'), 'Pod Myla');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create pod' }));
    await waitFor(() =>
      expect(db.createTeam).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1', name: 'Pod Myla', leadId: null }))
    );
  });

  it('shows an empty state when there are no pods', async () => {
    db.listTeams.mockResolvedValue([]);
    renderTeam('EDITOR', '/team?tab=pods');
    expect(await screen.findByText('No pods yet')).toBeInTheDocument();
    expect(screen.getByText(/Owner or Admin can create pods/)).toBeInTheDocument();
  });
});
