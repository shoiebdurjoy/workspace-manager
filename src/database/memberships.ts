import { getSupabaseClient } from './client';
import { WorkspaceMember, TbbRole, MyMembership } from '@/types/database';
import { DatabaseError, NotFoundError, ValidationError } from './errors';

interface MemberRowWithProfile {
  workspace_id: string;
  user_id: string;
  role: TbbRole;
  created_at: string;
  updated_at: string;
  profiles: {
    id: string;
    email: string;
    full_name: string;
    avatar_url: string | null;
    role: TbbRole;
    phone: string | null;
    timezone: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  } | null;
}

export async function getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('workspace_members')
    .select(`
      workspace_id,
      user_id,
      role,
      created_at,
      updated_at,
      profiles:user_id (
        id,
        email,
        full_name,
        avatar_url,
        role,
        phone,
        timezone,
        is_active,
        created_at,
        updated_at
      )
    `)
    .eq('workspace_id', workspaceId);

  if (error) {
    throw new DatabaseError(`Failed to fetch workspace members: ${error.message}`, error.code, error);
  }

  const rows = (data || []) as unknown as MemberRowWithProfile[];
  return rows.map((row) => ({
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role as TbbRole,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    profile: row.profiles
      ? {
          id: row.profiles.id,
          email: row.profiles.email,
          fullName: row.profiles.full_name,
          avatarUrl: row.profiles.avatar_url,
          role: row.profiles.role,
          phone: row.profiles.phone,
          timezone: row.profiles.timezone,
          isActive: row.profiles.is_active,
          createdAt: row.profiles.created_at,
          updatedAt: row.profiles.updated_at,
        }
      : undefined,
  }));
}

export async function addWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: TbbRole = 'EDITOR'
): Promise<WorkspaceMember> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');
  if (!userId) throw new ValidationError('User ID is required.');

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('workspace_members')
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      role,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new ValidationError('User is already a member of this workspace.');
    }
    throw new DatabaseError(`Failed to add workspace member: ${error.message}`, error.code, error);
  }

  return {
    workspaceId: data.workspace_id,
    userId: data.user_id,
    role: data.role,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  role: TbbRole
): Promise<WorkspaceMember> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');
  if (!userId) throw new ValidationError('User ID is required.');

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('workspace_members')
    .update({ role })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError('WorkspaceMember', `${workspaceId}/${userId}`);
    }
    throw new DatabaseError(`Failed to update member role: ${error.message}`, error.code, error);
  }

  return {
    workspaceId: data.workspace_id,
    userId: data.user_id,
    role: data.role,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function removeWorkspaceMember(
  workspaceId: string,
  userId: string
): Promise<void> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');
  if (!userId) throw new ValidationError('User ID is required.');

  const client = getSupabaseClient();
  const { error } = await client
    .from('workspace_members')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId);

  if (error) {
    throw new DatabaseError(`Failed to remove workspace member: ${error.message}`, error.code, error);
  }
}

export async function getUserRoleInWorkspace(
  workspaceId: string,
  userId: string
): Promise<TbbRole | null> {
  if (!workspaceId || !userId) return null;

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new DatabaseError(`Failed to get member role: ${error.message}`, error.code, error);
  }

  return data ? (data.role as TbbRole) : null;
}

interface MyMembershipRow {
  role: TbbRole;
  created_at: string;
  workspaces: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logo_url: string | null;
    owner_id: string;
    settings: unknown;
    created_at: string;
    updated_at: string;
  } | null;
}

/**
 * The signed-in user's memberships together with their workspace. RLS already limits the
 * result to the caller's own rows; the filter is explicit so the intent is obvious.
 */
export async function getMyMemberships(userId: string): Promise<MyMembership[]> {
  if (!userId) throw new ValidationError('User ID is required.');

  const { data, error } = await getSupabaseClient()
    .from('workspace_members')
    .select(
      'role, created_at, workspaces:workspace_id ( id, name, slug, description, logo_url, owner_id, settings, created_at, updated_at )'
    )
    .eq('user_id', userId);

  if (error) {
    throw new DatabaseError(`Failed to load your workspaces: ${error.message}`, error.code, error);
  }

  const rows = (data ?? []) as unknown as MyMembershipRow[];
  const memberships: MyMembership[] = [];
  for (const r of rows) {
    if (!r.workspaces) continue;
    memberships.push({
      role: r.role,
      joinedAt: r.created_at,
      workspace: {
        id: r.workspaces.id,
        name: r.workspaces.name,
        slug: r.workspaces.slug,
        description: r.workspaces.description,
        logoUrl: r.workspaces.logo_url,
        ownerId: r.workspaces.owner_id,
        settings: (r.workspaces.settings as Record<string, unknown>) ?? {},
        createdAt: r.workspaces.created_at,
        updatedAt: r.workspaces.updated_at,
      },
    });
  }
  return memberships;
}
