export type { TbbRole, TaskStatus, TaskPriority, Json } from './database.types';
import type { TbbRole, TaskStatus, TaskPriority } from './database.types';

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string | null;
  role: TbbRole;
  phone?: string | null;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  logoUrl?: string | null;
  ownerId: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  role: TbbRole;
  createdAt: string;
  updatedAt: string;
  profile?: Profile;
}

export interface Space {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description?: string | null;
  icon: string;
  color: string;
  isPrivate: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  spaceId: string;
  name: string;
  description?: string | null;
  position: number;
  isCollapsedDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface List {
  id: string;
  spaceId: string;
  folderId?: string | null;
  name: string;
  description?: string | null;
  color: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskFoundation {
  id: string;
  listId: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  dueDate?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubtaskFoundation {
  id: string;
  taskId: string;
  title: string;
  description?: string | null;
  isCompleted: boolean;
  position: number;
  dueDate?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ==============================================================================
// 6-LEVEL HIERARCHY TREE TYPES
// ==============================================================================

export interface HierarchyList extends List {
  taskCount?: number;
}

export interface HierarchyFolder extends Folder {
  lists: HierarchyList[];
}

export interface HierarchySpace extends Space {
  folders: HierarchyFolder[];
  folderlessLists: HierarchyList[];
}

export interface WorkspaceHierarchy {
  workspace: Workspace;
  spaces: HierarchySpace[];
}
