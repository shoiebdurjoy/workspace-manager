import { describe, it, expect, vi, beforeEach } from 'vitest';

type Result = { data?: unknown; error?: { code?: string; message: string } | null };
let result: Result = { data: [], error: null };
const calls: Array<{ method: string; args: unknown[] }> = [];
const tables: string[] = [];

function makeBuilder() {
  const b: Record<string, unknown> = {
    then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null, ...result }).then(resolve, reject),
  };
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'single', 'limit', 'in']) {
    b[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return b;
    };
  }
  return b;
}

vi.mock('../client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      tables.push(table);
      return makeBuilder();
    },
  }),
}));

import {
  addTeamMember,
  createTeam,
  deleteTeam,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  updateTeam,
} from '../teams';
import { createInvitation, isValidEmail, listInvitations, normaliseEmail, revokeInvitation } from '../invitations';
import { getMyMemberships } from '../memberships';
import { DatabaseError, PermissionDeniedError, toDatabaseError, ValidationError } from '../errors';

const called = (method: string) => calls.filter((c) => c.method === method);

beforeEach(() => {
  result = { data: [], error: null };
  calls.length = 0;
  tables.length = 0;
});

describe('toDatabaseError', () => {
  it('maps privilege errors, duplicates and constraint failures to safe messages', () => {
    const denied = toDatabaseError('create the pod', { code: '42501', message: 'new row violates row-level security policy' });
    expect(denied).toBeInstanceOf(PermissionDeniedError);
    expect(denied.message).toBe('You do not have permission to create the pod.');
    expect(denied.message).not.toMatch(/row-level/);

    expect(toDatabaseError('x', { code: '23505', message: 'dup' })).toBeInstanceOf(ValidationError);
    const check = toDatabaseError('x', { code: '23514', message: 'only workspace members can join a team' });
    expect(check).toBeInstanceOf(ValidationError);
    expect(check.message).toBe('only workspace members can join a team');
    expect(toDatabaseError('x', { code: '23503', message: 'fk' })).toBeInstanceOf(ValidationError);

    const other = toDatabaseError('load pods', { code: '08006', message: 'connection failure' });
    expect(other).toBeInstanceOf(DatabaseError);
    expect(other.code).toBe('08006');
    expect(other.message).toContain('connection failure');
  });
});

describe('teams data access', () => {
  const row = {
    id: 't1', workspace_id: 'w1', name: 'Pod Zim', description: null, color: '#7B68EE',
    lead_id: 'u1', created_at: 'c', updated_at: 'u',
  };

  it('lists pods for a workspace ordered by name', async () => {
    result = { data: [row] };
    const teams = await listTeams('w1');
    expect(tables).toEqual(['teams']);
    expect(called('eq')[0].args).toEqual(['workspace_id', 'w1']);
    expect(called('order')[0].args[0]).toBe('name');
    expect(teams).toEqual([
      { id: 't1', workspaceId: 'w1', name: 'Pod Zim', description: null, color: '#7B68EE', leadId: 'u1', createdAt: 'c', updatedAt: 'u' },
    ]);
  });

  it('requires a workspace id and surfaces database errors as domain errors', async () => {
    await expect(listTeams('')).rejects.toBeInstanceOf(ValidationError);
    await expect(listTeamMembers('')).rejects.toBeInstanceOf(ValidationError);
    result = { error: { code: '42501', message: 'permission denied' } };
    await expect(listTeams('w1')).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(listTeamMembers('w1')).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('maps pod membership rows', async () => {
    result = { data: [{ team_id: 't1', user_id: 'u1', workspace_id: 'w1', created_at: 'c' }] };
    expect(await listTeamMembers('w1')).toEqual([{ teamId: 't1', userId: 'u1', workspaceId: 'w1', createdAt: 'c' }]);
  });

  it('creates a pod with trimmed values', async () => {
    result = { data: row };
    const team = await createTeam({ workspaceId: 'w1', name: '  Pod Zim ', description: '  desc ', leadId: 'u1', color: '#fff' });
    expect(called('insert')[0].args[0]).toEqual({ workspace_id: 'w1', name: 'Pod Zim', description: 'desc', color: '#fff', lead_id: 'u1' });
    expect(team.name).toBe('Pod Zim');
  });

  it('validates pod input before touching the database', async () => {
    await expect(createTeam({ workspaceId: 'w1', name: '   ' })).rejects.toThrow('Pod name is required.');
    await expect(createTeam({ workspaceId: '', name: 'x' })).rejects.toThrow('Workspace ID is required.');
    expect(tables).toHaveLength(0);
  });

  it('defaults the color and lead on create, reports duplicates', async () => {
    result = { data: row };
    await createTeam({ workspaceId: 'w1', name: 'A' });
    expect(called('insert')[0].args[0]).toEqual({ workspace_id: 'w1', name: 'A', description: null, lead_id: null });
    result = { error: { code: '23505', message: 'duplicate key' } };
    await expect(createTeam({ workspaceId: 'w1', name: 'A' })).rejects.toThrow(/already exists/);
  });

  it('updates only the provided fields', async () => {
    result = { data: row };
    await updateTeam('t1', { name: ' New ', leadId: null, description: ' d ', color: '#000' });
    expect(called('update')[0].args[0]).toEqual({ name: 'New', lead_id: null, description: 'd', color: '#000' });
    calls.length = 0;
    await updateTeam('t1', { leadId: 'u2' });
    expect(called('update')[0].args[0]).toEqual({ lead_id: 'u2' });
    await expect(updateTeam('t1', { name: ' ' })).rejects.toThrow('Pod name is required.');
    await expect(updateTeam('', {})).rejects.toBeInstanceOf(ValidationError);
    result = { error: { code: '42501', message: 'x' } };
    await expect(updateTeam('t1', { leadId: 'u2' })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('deletes pods and manages pod members', async () => {
    result = { error: null };
    await deleteTeam('t1');
    expect(called('delete')).toHaveLength(1);
    await addTeamMember('t1', 'u1');
    expect(called('insert')[0].args[0]).toEqual({ team_id: 't1', user_id: 'u1' });
    await removeTeamMember('t1', 'u1');
    expect(called('eq').map((c) => c.args)).toEqual(expect.arrayContaining([['id', 't1'], ['team_id', 't1'], ['user_id', 'u1']]));

    await expect(deleteTeam('')).rejects.toBeInstanceOf(ValidationError);
    await expect(addTeamMember('', 'u1')).rejects.toBeInstanceOf(ValidationError);
    await expect(removeTeamMember('t1', '')).rejects.toBeInstanceOf(ValidationError);

    result = { error: { code: '23514', message: 'only workspace members can join a team' } };
    await expect(addTeamMember('t1', 'stranger')).rejects.toThrow('only workspace members can join a team');
    result = { error: { code: '42501', message: 'x' } };
    await expect(removeTeamMember('t1', 'u1')).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(deleteTeam('t1')).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('invitations data access', () => {
  const row = {
    id: 'i1', workspace_id: 'w1', email: 'new@x.co', role: 'EDITOR', invited_by: 'u1',
    accepted_at: null, accepted_by: null, created_at: 'c',
  };

  it('normalises and validates e-mail addresses', () => {
    expect(normaliseEmail('  New.Hire@TBB.co ')).toBe('new.hire@tbb.co');
    expect(isValidEmail(' a@b.co ')).toBe(true);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  it('lists invitations newest first', async () => {
    result = { data: [row] };
    const list = await listInvitations('w1');
    expect(called('order')[0].args).toEqual(['created_at', { ascending: false }]);
    expect(list[0]).toMatchObject({ id: 'i1', workspaceId: 'w1', email: 'new@x.co', role: 'EDITOR', invitedBy: 'u1', acceptedAt: null });
    await expect(listInvitations('')).rejects.toBeInstanceOf(ValidationError);
    result = { error: { code: '42501', message: 'x' } };
    await expect(listInvitations('w1')).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('creates an invitation with a normalised address and the chosen role only', async () => {
    result = { data: row };
    await createInvitation({ workspaceId: 'w1', email: '  New@X.co ', role: 'QC_SPECIALIST' });
    expect(called('insert')[0].args[0]).toEqual({ workspace_id: 'w1', email: 'new@x.co', role: 'QC_SPECIALIST' });
  });

  it('refuses OWNER, malformed addresses and missing workspace before any request', async () => {
    await expect(createInvitation({ workspaceId: 'w1', email: 'a@b.co', role: 'OWNER' })).rejects.toThrow(/OWNER role cannot be granted/);
    await expect(createInvitation({ workspaceId: 'w1', email: 'nope', role: 'EDITOR' })).rejects.toThrow(/valid e-mail/);
    await expect(createInvitation({ workspaceId: '', email: 'a@b.co', role: 'EDITOR' })).rejects.toBeInstanceOf(ValidationError);
    expect(tables).toHaveLength(0);
  });

  it('explains duplicates and permission failures', async () => {
    result = { error: { code: '23505', message: 'duplicate' } };
    await expect(createInvitation({ workspaceId: 'w1', email: 'a@b.co', role: 'EDITOR' })).rejects.toThrow(/already has a pending invitation/);
    result = { error: { code: '42501', message: 'rls' } };
    await expect(createInvitation({ workspaceId: 'w1', email: 'a@b.co', role: 'EDITOR' })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('revokes by id', async () => {
    result = { error: null };
    await revokeInvitation('i1');
    expect(called('delete')).toHaveLength(1);
    expect(called('eq')[0].args).toEqual(['id', 'i1']);
    await expect(revokeInvitation('')).rejects.toBeInstanceOf(ValidationError);
    result = { error: { code: '42501', message: 'x' } };
    await expect(revokeInvitation('i1')).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('getMyMemberships', () => {
  const ws = {
    id: 'w1', name: 'TBB', slug: 'tbb-1', description: null, logo_url: null, owner_id: 'u0',
    settings: null, created_at: 'c', updated_at: 'u',
  };

  it('maps memberships with their workspace and skips orphans', async () => {
    result = {
      data: [
        { role: 'ADMIN', created_at: 'j', workspaces: ws },
        { role: 'EDITOR', created_at: 'j2', workspaces: null },
      ],
    };
    const list = await getMyMemberships('u1');
    expect(called('eq')[0].args).toEqual(['user_id', 'u1']);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ role: 'ADMIN', joinedAt: 'j', workspace: { id: 'w1', name: 'TBB', slug: 'tbb-1', ownerId: 'u0', settings: {} } });
  });

  it('returns an empty list for a person with no workspace and throws real errors', async () => {
    result = { data: null };
    expect(await getMyMemberships('u1')).toEqual([]);
    result = { error: { code: '08006', message: 'down' } };
    await expect(getMyMemberships('u1')).rejects.toBeInstanceOf(DatabaseError);
    await expect(getMyMemberships('')).rejects.toBeInstanceOf(ValidationError);
  });
});
