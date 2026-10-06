import { getSupabaseClient } from './client';
import { TbbRole, WorkspaceInvitation } from '@/types/database';
import { toDatabaseError, ValidationError } from './errors';

interface InvitationRow {
  id: string;
  workspace_id: string;
  email: string;
  role: TbbRole;
  invited_by: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  created_at: string;
}

export function mapInvitationRow(row: InvitationRow): WorkspaceInvitation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    role: row.role,
    invitedBy: row.invited_by,
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
    createdAt: row.created_at,
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(normaliseEmail(value));
}

/** Invitations are visible to OWNER/ADMIN only (RLS); everyone else gets an empty list. */
export async function listInvitations(workspaceId: string): Promise<WorkspaceInvitation[]> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');
  const { data, error } = await getSupabaseClient()
    .from('workspace_invitations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw toDatabaseError('load invitations', error);
  return (data ?? []).map(mapInvitationRow);
}

export async function createInvitation(input: {
  workspaceId: string;
  email: string;
  role: TbbRole;
}): Promise<WorkspaceInvitation> {
  if (!input.workspaceId) throw new ValidationError('Workspace ID is required.');
  if (!isValidEmail(input.email)) throw new ValidationError('Enter a valid e-mail address.');
  if (input.role === 'OWNER') throw new ValidationError('The OWNER role cannot be granted by invitation.');
  const { data, error } = await getSupabaseClient()
    .from('workspace_invitations')
    .insert({ workspace_id: input.workspaceId, email: normaliseEmail(input.email), role: input.role })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw new ValidationError('That address already has a pending invitation.', error);
    throw toDatabaseError('invite this person', error);
  }
  return mapInvitationRow(data);
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  if (!invitationId) throw new ValidationError('Invitation ID is required.');
  const { error } = await getSupabaseClient().from('workspace_invitations').delete().eq('id', invitationId);
  if (error) throw toDatabaseError('revoke the invitation', error);
}
