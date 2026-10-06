import { getSupabaseClient } from './client';
import { Space, Folder, List, HierarchySpace, HierarchyFolder, HierarchyList } from '@/types/database';
import { DatabaseError, NotFoundError, ValidationError } from './errors';

// ------------------------------------------------------------------------------
// SPACES
// ------------------------------------------------------------------------------

export async function createSpace(data: {
  workspaceId: string;
  name: string;
  slug: string;
  description?: string | null;
  icon?: string;
  color?: string;
  isPrivate?: boolean;
  position?: number;
}): Promise<Space> {
  if (!data.workspaceId) throw new ValidationError('Workspace ID is required.');
  if (!data.name?.trim()) throw new ValidationError('Space name is required.');
  if (!data.slug?.trim()) throw new ValidationError('Space slug is required.');

  const client = getSupabaseClient();
  const { data: created, error } = await client
    .from('spaces')
    .insert({
      workspace_id: data.workspaceId,
      name: data.name.trim(),
      slug: data.slug.trim().toLowerCase(),
      description: data.description || null,
      icon: data.icon || 'folder',
      color: data.color || '#7B68EE',
      is_private: data.isPrivate || false,
      position: data.position ?? 0,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new ValidationError(`A space with slug "${data.slug}" already exists in this workspace.`);
    }
    throw new DatabaseError(`Failed to create space: ${error.message}`, error.code, error);
  }

  return {
    id: created.id,
    workspaceId: created.workspace_id,
    name: created.name,
    slug: created.slug,
    description: created.description,
    icon: created.icon,
    color: created.color,
    isPrivate: created.is_private,
    position: created.position,
    createdAt: created.created_at,
    updatedAt: created.updated_at,
  };
}

export async function updateSpace(
  spaceId: string,
  updates: Partial<Omit<Space, 'id' | 'createdAt' | 'updatedAt' | 'workspaceId'>>
): Promise<Space> {
  if (!spaceId) throw new ValidationError('Space ID is required.');

  const client = getSupabaseClient();
  const dbUpdates: Record<string, unknown> = {};

  if (updates.name !== undefined) dbUpdates.name = updates.name.trim();
  if (updates.slug !== undefined) dbUpdates.slug = updates.slug.trim().toLowerCase();
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.icon !== undefined) dbUpdates.icon = updates.icon;
  if (updates.color !== undefined) dbUpdates.color = updates.color;
  if (updates.isPrivate !== undefined) dbUpdates.is_private = updates.isPrivate;
  if (updates.position !== undefined) dbUpdates.position = updates.position;

  const { data, error } = await client
    .from('spaces')
    .update(dbUpdates)
    .eq('id', spaceId)
    .select('*')
    .single();

  if (error) {
    throw new DatabaseError(`Failed to update space: ${error.message}`, error.code, error);
  }

  return {
    id: data.id,
    workspaceId: data.workspace_id,
    name: data.name,
    slug: data.slug,
    description: data.description,
    icon: data.icon,
    color: data.color,
    isPrivate: data.is_private,
    position: data.position,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function deleteSpace(spaceId: string): Promise<void> {
  if (!spaceId) throw new ValidationError('Space ID is required.');

  const client = getSupabaseClient();
  const { error } = await client
    .from('spaces')
    .delete()
    .eq('id', spaceId);

  if (error) {
    throw new DatabaseError(`Failed to delete space: ${error.message}`, error.code, error);
  }
}

// ------------------------------------------------------------------------------
// FOLDERS
// ------------------------------------------------------------------------------

export async function createFolder(data: {
  spaceId: string;
  name: string;
  description?: string | null;
  position?: number;
  isCollapsedDefault?: boolean;
}): Promise<Folder> {
  if (!data.spaceId) throw new ValidationError('Space ID is required.');
  if (!data.name?.trim()) throw new ValidationError('Folder name is required.');

  const client = getSupabaseClient();
  const { data: created, error } = await client
    .from('folders')
    .insert({
      space_id: data.spaceId,
      name: data.name.trim(),
      description: data.description || null,
      position: data.position ?? 0,
      is_collapsed_default: data.isCollapsedDefault || false,
    })
    .select('*')
    .single();

  if (error) {
    throw new DatabaseError(`Failed to create folder: ${error.message}`, error.code, error);
  }

  return {
    id: created.id,
    spaceId: created.space_id,
    name: created.name,
    description: created.description,
    position: created.position,
    isCollapsedDefault: created.is_collapsed_default,
    createdAt: created.created_at,
    updatedAt: created.updated_at,
  };
}

export async function updateFolder(
  folderId: string,
  updates: Partial<Omit<Folder, 'id' | 'createdAt' | 'updatedAt' | 'spaceId'>>
): Promise<Folder> {
  if (!folderId) throw new ValidationError('Folder ID is required.');

  const client = getSupabaseClient();
  const dbUpdates: Record<string, unknown> = {};

  if (updates.name !== undefined) dbUpdates.name = updates.name.trim();
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.position !== undefined) dbUpdates.position = updates.position;
  if (updates.isCollapsedDefault !== undefined) dbUpdates.is_collapsed_default = updates.isCollapsedDefault;

  const { data, error } = await client
    .from('folders')
    .update(dbUpdates)
    .eq('id', folderId)
    .select('*')
    .single();

  if (error) {
    throw new DatabaseError(`Failed to update folder: ${error.message}`, error.code, error);
  }

  return {
    id: data.id,
    spaceId: data.space_id,
    name: data.name,
    description: data.description,
    position: data.position,
    isCollapsedDefault: data.is_collapsed_default,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function deleteFolder(folderId: string): Promise<void> {
  if (!folderId) throw new ValidationError('Folder ID is required.');

  const client = getSupabaseClient();
  const { error } = await client
    .from('folders')
    .delete()
    .eq('id', folderId);

  if (error) {
    throw new DatabaseError(`Failed to delete folder: ${error.message}`, error.code, error);
  }
}

// ------------------------------------------------------------------------------
// LISTS
// ------------------------------------------------------------------------------

export async function createList(data: {
  spaceId: string;
  folderId?: string | null;
  name: string;
  description?: string | null;
  color?: string;
  position?: number;
}): Promise<List> {
  if (!data.spaceId) throw new ValidationError('Space ID is required.');
  if (!data.name?.trim()) throw new ValidationError('List name is required.');

  const client = getSupabaseClient();
  const { data: created, error } = await client
    .from('lists')
    .insert({
      space_id: data.spaceId,
      folder_id: data.folderId || null,
      name: data.name.trim(),
      description: data.description || null,
      color: data.color || '#7B68EE',
      position: data.position ?? 0,
    })
    .select('*')
    .single();

  if (error) {
    throw new DatabaseError(`Failed to create list: ${error.message}`, error.code, error);
  }

  return {
    id: created.id,
    spaceId: created.space_id,
    folderId: created.folder_id,
    name: created.name,
    description: created.description,
    color: created.color,
    position: created.position,
    createdAt: created.created_at,
    updatedAt: created.updated_at,
  };
}

export async function updateList(
  listId: string,
  updates: Partial<Omit<List, 'id' | 'createdAt' | 'updatedAt' | 'spaceId'>>
): Promise<List> {
  if (!listId) throw new ValidationError('List ID is required.');

  const client = getSupabaseClient();
  const dbUpdates: Record<string, unknown> = {};

  if (updates.name !== undefined) dbUpdates.name = updates.name.trim();
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.color !== undefined) dbUpdates.color = updates.color;
  if (updates.position !== undefined) dbUpdates.position = updates.position;
  if (updates.folderId !== undefined) dbUpdates.folder_id = updates.folderId;

  const { data, error } = await client
    .from('lists')
    .update(dbUpdates)
    .eq('id', listId)
    .select('*')
    .single();

  if (error) {
    throw new DatabaseError(`Failed to update list: ${error.message}`, error.code, error);
  }

  return {
    id: data.id,
    spaceId: data.space_id,
    folderId: data.folder_id,
    name: data.name,
    description: data.description,
    color: data.color,
    position: data.position,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function deleteList(listId: string): Promise<void> {
  if (!listId) throw new ValidationError('List ID is required.');

  const client = getSupabaseClient();
  const { error } = await client
    .from('lists')
    .delete()
    .eq('id', listId);

  if (error) {
    throw new DatabaseError(`Failed to delete list: ${error.message}`, error.code, error);
  }
}

// ------------------------------------------------------------------------------
// COMPLETE HIERARCHY TREE
// ------------------------------------------------------------------------------

/**
 * Builds the hierarchical nested tree of Spaces -> Folders -> Lists for a workspace.
 */
export async function getWorkspaceHierarchy(workspaceId: string): Promise<HierarchySpace[]> {
  if (!workspaceId) throw new ValidationError('Workspace ID is required.');

  const client = getSupabaseClient();

  // 1. Fetch spaces
  const { data: spaces, error: spacesErr } = await client
    .from('spaces')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('position', { ascending: true });

  if (spacesErr) {
    throw new DatabaseError(`Failed to fetch spaces: ${spacesErr.message}`, spacesErr.code, spacesErr);
  }

  if (!spaces || spaces.length === 0) {
    return [];
  }

  const spaceIds = spaces.map((s) => s.id);

  // 2. Fetch folders and lists for these spaces in parallel
  const [foldersRes, listsRes] = await Promise.all([
    client
      .from('folders')
      .select('*')
      .in('space_id', spaceIds)
      .order('position', { ascending: true }),
    client
      .from('lists')
      .select('*')
      .in('space_id', spaceIds)
      .order('position', { ascending: true }),
  ]);

  if (foldersRes.error) {
    throw new DatabaseError(`Failed to fetch folders: ${foldersRes.error.message}`, foldersRes.error.code, foldersRes.error);
  }
  if (listsRes.error) {
    throw new DatabaseError(`Failed to fetch lists: ${listsRes.error.message}`, listsRes.error.code, listsRes.error);
  }

  const foldersBySpace: Record<string, HierarchyFolder[]> = {};
  const folderMap: Record<string, HierarchyFolder> = {};

  for (const f of foldersRes.data || []) {
    const folderItem: HierarchyFolder = {
      id: f.id,
      spaceId: f.space_id,
      name: f.name,
      description: f.description,
      position: f.position,
      isCollapsedDefault: f.is_collapsed_default,
      createdAt: f.created_at,
      updatedAt: f.updated_at,
      lists: [],
    };
    folderMap[f.id] = folderItem;
    if (!foldersBySpace[f.space_id]) foldersBySpace[f.space_id] = [];
    foldersBySpace[f.space_id].push(folderItem);
  }

  const folderlessListsBySpace: Record<string, HierarchyList[]> = {};

  for (const l of listsRes.data || []) {
    const listItem: HierarchyList = {
      id: l.id,
      spaceId: l.space_id,
      folderId: l.folder_id,
      name: l.name,
      description: l.description,
      color: l.color,
      position: l.position,
      createdAt: l.created_at,
      updatedAt: l.updated_at,
    };

    if (l.folder_id && folderMap[l.folder_id]) {
      folderMap[l.folder_id].lists.push(listItem);
    } else {
      if (!folderlessListsBySpace[l.space_id]) folderlessListsBySpace[l.space_id] = [];
      folderlessListsBySpace[l.space_id].push(listItem);
    }
  }

  return spaces.map((s) => ({
    id: s.id,
    workspaceId: s.workspace_id,
    name: s.name,
    slug: s.slug,
    description: s.description,
    icon: s.icon,
    color: s.color,
    isPrivate: s.is_private,
    position: s.position,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    folders: foldersBySpace[s.id] || [],
    folderlessLists: folderlessListsBySpace[s.id] || [],
  }));
}
