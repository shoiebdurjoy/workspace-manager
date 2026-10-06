import { getSupabaseClient } from './client';
import { Workspace } from '@/types/database';
import { DatabaseError, NotFoundError, ValidationError } from './errors';

function mapWorkspaceRow(row: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  owner_id: string;
  settings: unknown;
  created_at: string;
  updated_at: string;
}): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    logoUrl: row.logo_url,
    ownerId: row.owner_id,
    settings: (row.settings as Record<string, unknown>) || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getWorkspaceById(workspaceId: string): Promise<Workspace> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('workspaces')
    .select('*')
    .eq('id', workspaceId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError('Workspace', workspaceId);
    }
    throw new DatabaseError(`Failed to fetch workspace: ${error.message}`, error.code, error);
  }

  if (!data) throw new NotFoundError('Workspace', workspaceId);
  return mapWorkspaceRow(data);
}

export async function getWorkspaceBySlug(slug: string): Promise<Workspace> {
  if (!slug) throw new ValidationError('Workspace slug is required.');

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('workspaces')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError('Workspace', slug);
    }
    throw new DatabaseError(`Failed to fetch workspace: ${error.message}`, error.code, error);
  }

  if (!data) throw new NotFoundError('Workspace', slug);
  return mapWorkspaceRow(data);
}

export async function listUserWorkspaces(): Promise<Workspace[]> {
  const client = getSupabaseClient();
  // RLS filters workspaces automatically to those the user is a member of
  const { data, error } = await client
    .from('workspaces')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw new DatabaseError(`Failed to list workspaces: ${error.message}`, error.code, error);
  }

  return (data || []).map(mapWorkspaceRow);
}

export async function createWorkspace(data: {
  name: string;
  slug: string;
  description?: string | null;
  ownerId: string;
  logoUrl?: string | null;
  settings?: Record<string, unknown>;
}): Promise<Workspace> {
  if (!data.name?.trim()) throw new ValidationError('Workspace name is required.');
  if (!data.slug?.trim()) throw new ValidationError('Workspace slug is required.');
  if (!data.ownerId) throw new ValidationError('Owner ID is required.');

  const client = getSupabaseClient();
  const { data: created, error } = await client
    .from('workspaces')
    .insert({
      name: data.name.trim(),
      slug: data.slug.trim().toLowerCase(),
      description: data.description || null,
      owner_id: data.ownerId,
      logo_url: data.logoUrl || null,
      settings: (data.settings as unknown as import('@/types/database.types').Json) || {},
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new ValidationError(`A workspace with slug "${data.slug}" already exists.`);
    }
    throw new DatabaseError(`Failed to create workspace: ${error.message}`, error.code, error);
  }

  return mapWorkspaceRow(created);
}

export async function updateWorkspace(
  workspaceId: string,
  updates: Partial<Omit<Workspace, 'id' | 'createdAt' | 'updatedAt' | 'ownerId'>>
): Promise<Workspace> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');

  const client = getSupabaseClient();
  const dbUpdates: Record<string, unknown> = {};

  if (updates.name !== undefined) dbUpdates.name = updates.name.trim();
  if (updates.slug !== undefined) dbUpdates.slug = updates.slug.trim().toLowerCase();
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.logoUrl !== undefined) dbUpdates.logo_url = updates.logoUrl;
  if (updates.settings !== undefined) dbUpdates.settings = updates.settings;

  const { data, error } = await client
    .from('workspaces')
    .update(dbUpdates)
    .eq('id', workspaceId)
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new ValidationError('A workspace with this slug already exists.');
    }
    throw new DatabaseError(`Failed to update workspace: ${error.message}`, error.code, error);
  }

  return mapWorkspaceRow(data);
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');

  const client = getSupabaseClient();
  const { error } = await client
    .from('workspaces')
    .delete()
    .eq('id', workspaceId);

  if (error) {
    throw new DatabaseError(`Failed to delete workspace: ${error.message}`, error.code, error);
  }
}
