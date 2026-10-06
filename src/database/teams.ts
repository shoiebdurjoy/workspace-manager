import { getSupabaseClient } from './client';
import { Team, TeamMember } from '@/types/database';
import { toDatabaseError, ValidationError } from './errors';
import { DEFAULT_CONTENT_COLOR } from '@/lib/brand';

interface TeamRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  color: string;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
}

export function mapTeamRow(row: TeamRow): Team {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    color: row.color,
    leadId: row.lead_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTeams(workspaceId: string): Promise<Team[]> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');
  const { data, error } = await getSupabaseClient()
    .from('teams')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('name', { ascending: true });
  if (error) throw toDatabaseError('load pods', error);
  return (data ?? []).map(mapTeamRow);
}

export async function listTeamMembers(workspaceId: string): Promise<TeamMember[]> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');
  const { data, error } = await getSupabaseClient()
    .from('team_members')
    .select('team_id, user_id, workspace_id, created_at')
    .eq('workspace_id', workspaceId);
  if (error) throw toDatabaseError('load pod members', error);
  return (data ?? []).map((r) => ({
    teamId: r.team_id,
    userId: r.user_id,
    workspaceId: r.workspace_id,
    createdAt: r.created_at,
  }));
}

export async function createTeam(input: {
  workspaceId: string;
  name: string;
  description?: string | null;
  color?: string;
  leadId?: string | null;
}): Promise<Team> {
  const name = input.name?.trim();
  if (!name) throw new ValidationError('Pod name is required.');
  if (!input.workspaceId) throw new ValidationError('Workspace ID is required.');
  const { data, error } = await getSupabaseClient()
    .from('teams')
    .insert({
      workspace_id: input.workspaceId,
      name,
      description: input.description?.trim() || null,
      color: input.color ?? DEFAULT_CONTENT_COLOR,
      lead_id: input.leadId ?? null,
    })
    .select('*')
    .single();
  if (error) throw toDatabaseError('create the pod', error);
  return mapTeamRow(data);
}

export async function updateTeam(
  teamId: string,
  updates: { name?: string; description?: string | null; color?: string; leadId?: string | null }
): Promise<Team> {
  if (!teamId) throw new ValidationError('Team ID is required.');
  const dbUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) {
    if (!updates.name.trim()) throw new ValidationError('Pod name is required.');
    dbUpdates.name = updates.name.trim();
  }
  if (updates.description !== undefined) dbUpdates.description = updates.description?.trim() || null;
  if (updates.color !== undefined) dbUpdates.color = updates.color;
  if (updates.leadId !== undefined) dbUpdates.lead_id = updates.leadId;
  const { data, error } = await getSupabaseClient()
    .from('teams')
    .update(dbUpdates)
    .eq('id', teamId)
    .select('*')
    .single();
  if (error) throw toDatabaseError('update the pod', error);
  return mapTeamRow(data);
}

export async function deleteTeam(teamId: string): Promise<void> {
  if (!teamId) throw new ValidationError('Team ID is required.');
  const { error } = await getSupabaseClient().from('teams').delete().eq('id', teamId);
  if (error) throw toDatabaseError('delete the pod', error);
}

export async function addTeamMember(teamId: string, userId: string): Promise<void> {
  if (!teamId || !userId) throw new ValidationError('Team and user are required.');
  const { error } = await getSupabaseClient().from('team_members').insert({ team_id: teamId, user_id: userId });
  if (error) throw toDatabaseError('add the person to the pod', error);
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  if (!teamId || !userId) throw new ValidationError('Team and user are required.');
  const { error } = await getSupabaseClient()
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId);
  if (error) throw toDatabaseError('remove the person from the pod', error);
}
