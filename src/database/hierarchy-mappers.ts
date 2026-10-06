import type { Database } from '@/types/database.types';
import type { Folder, List, Space } from '@/types/database';

type Tables = Database['public']['Tables'];

export type SpaceRow = Tables['spaces']['Row'];
export type FolderRow = Tables['folders']['Row'];
export type ListRow = Tables['lists']['Row'];

export function mapSpaceRow(row: SpaceRow): Space {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    icon: row.icon,
    color: row.color,
    isPrivate: row.is_private,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapFolderRow(row: FolderRow): Folder {
  return {
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    description: row.description,
    position: row.position,
    isCollapsedDefault: row.is_collapsed_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapListRow(row: ListRow): List {
  return {
    id: row.id,
    spaceId: row.space_id,
    folderId: row.folder_id,
    name: row.name,
    description: row.description,
    color: row.color,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
