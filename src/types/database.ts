export type { TbbRole, TaskStatus, TaskPriority, AspectRatio, AssigneeRole, Json } from './database.types';
import type { TbbRole, TaskStatus, TaskPriority, AspectRatio, AssigneeRole } from './database.types';

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

/** A task (video deliverable): the full record, used by the detail view. */
export interface Task {
  id: string;
  workspaceId: string;
  listId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  aspectRatio: AspectRatio | null;
  rawFootageLink: string | null;
  projectFileLink: string | null;
  reviewLink: string | null;
  finalExportLink: string | null;
  /** Internal QC due date. */
  dueDate: string | null;
  clientDeadline: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Which slot of a task a person fills. One of each per task. */
export interface TaskAssignee {
  taskId: string;
  roleType: AssigneeRole;
  userId: string;
}

/** One row of the list view: only what a row shows, plus assignee ids and checklist counts. */
export interface TaskSummary
  extends Pick<
    Task,
    'id' | 'listId' | 'title' | 'status' | 'priority' | 'position' | 'aspectRatio' | 'dueDate' | 'clientDeadline' | 'createdAt' | 'updatedAt'
  > {
  editorId: string | null;
  qcId: string | null;
  subtaskTotal: number;
  subtaskDone: number;
}

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  isCompleted: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** A task with its assignees and checklist: everything the detail sheet needs, in one request. */
export interface TaskDetail extends Task {
  editorId: string | null;
  qcId: string | null;
  subtasks: Subtask[];
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

// ==============================================================================
// PHASE 4: MEMBERSHIP, PODS AND INVITATIONS
// ==============================================================================

/** A workspace together with the signed-in user's role in it. */
export interface MyMembership {
  workspace: Workspace;
  role: TbbRole;
  joinedAt: string;
}

export interface Team {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  color: string;
  leadId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  workspaceId: string;
  createdAt: string;
}

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string;
  role: TbbRole;
  invitedBy?: string | null;
  acceptedAt?: string | null;
  acceptedBy?: string | null;
  createdAt: string;
}
