import { getSupabaseClient } from './client';
import { Profile, TbbRole } from '@/types/database';
import { DatabaseError, NotFoundError, ValidationError } from './errors';

// Helper to map DB row to Profile domain model
function mapProfileRow(row: {
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
}): Profile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    phone: row.phone,
    timezone: row.timezone,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getProfileById(userId: string): Promise<Profile> {
  if (!userId) throw new ValidationError('User ID is required.');

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError('Profile', userId);
    }
    throw new DatabaseError(`Failed to fetch profile: ${error.message}`, error.code, error);
  }

  if (!data) throw new NotFoundError('Profile', userId);
  return mapProfileRow(data);
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const client = getSupabaseClient();
  const { data: authData, error: authError } = await client.auth.getUser();

  if (authError || !authData.user) {
    return null;
  }

  try {
    return await getProfileById(authData.user.id);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return null;
    }
    throw err;
  }
}

export async function createProfile(data: {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string | null;
  role?: TbbRole;
  phone?: string | null;
  timezone?: string;
}): Promise<Profile> {
  if (!data.id) throw new ValidationError('User ID is required.');
  if (!data.email) throw new ValidationError('Email is required.');
  if (!data.fullName) throw new ValidationError('Full name is required.');

  const client = getSupabaseClient();
  const { data: created, error } = await client
    .from('profiles')
    .insert({
      id: data.id,
      email: data.email,
      full_name: data.fullName,
      avatar_url: data.avatarUrl || null,
      role: data.role || 'EDITOR',
      phone: data.phone || null,
      timezone: data.timezone || 'UTC',
    })
    .select('*')
    .single();

  if (error) {
    throw new DatabaseError(`Failed to create profile: ${error.message}`, error.code, error);
  }

  return mapProfileRow(created);
}

export async function updateProfile(
  userId: string,
  updates: Partial<Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<Profile> {
  if (!userId) throw new ValidationError('User ID is required.');

  const client = getSupabaseClient();
  const dbUpdates: Record<string, unknown> = {};

  if (updates.fullName !== undefined) dbUpdates.full_name = updates.fullName;
  if (updates.avatarUrl !== undefined) dbUpdates.avatar_url = updates.avatarUrl;
  if (updates.role !== undefined) dbUpdates.role = updates.role;
  if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
  if (updates.timezone !== undefined) dbUpdates.timezone = updates.timezone;
  if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;

  const { data, error } = await client
    .from('profiles')
    .update(dbUpdates)
    .eq('id', userId)
    .select('*')
    .single();

  if (error) {
    throw new DatabaseError(`Failed to update profile: ${error.message}`, error.code, error);
  }

  return mapProfileRow(data);
}

export async function listProfilesByIds(ids: string[]): Promise<Profile[]> {
  if (!ids || ids.length === 0) return [];

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .in('id', ids);

  if (error) {
    throw new DatabaseError(`Failed to fetch profiles: ${error.message}`, error.code, error);
  }

  return (data || []).map(mapProfileRow);
}
