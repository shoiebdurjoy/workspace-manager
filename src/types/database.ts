export type { TbbRole, TaskStatus, TaskPriority, AspectRatio, AssigneeRole, WorkflowCategory, Json } from './database.types';
import type { TbbRole, TaskStatus, TaskPriority, AspectRatio, AssigneeRole, WorkflowCategory } from './database.types';

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
  /** How many times QC (or the client) sent it back. System-managed. */
  revisionCount: number;
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
    | 'id'
    | 'listId'
    | 'title'
    | 'status'
    | 'priority'
    | 'position'
    | 'aspectRatio'
    | 'dueDate'
    | 'clientDeadline'
    | 'revisionCount'
    | 'rawFootageLink'
    | 'projectFileLink'
    | 'reviewLink'
    | 'finalExportLink'
    | 'createdAt'
    | 'updatedAt'
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

// ==============================================================================
// PHASE 7: WORKFLOW
// ==============================================================================

export interface WorkflowStatus {
  key: TaskStatus;
  name: string;
  category: WorkflowCategory;
  color: string;
  position: number;
  description: string | null;
  isInitial: boolean;
  requiresEditor: boolean;
  requiresReviewLink: boolean;
  requiresFinalExport: boolean;
  requiresNote: boolean;
  countsRevision: boolean;
}

export interface WorkflowTransition {
  from: TaskStatus;
  to: TaskStatus;
  /** The action as people say it ("Submit for QC", "Request revision"). */
  label: string;
  kind: 'forward' | 'back' | 'reject';
  roles: TbbRole[];
}

export interface Workflow {
  id: string;
  name: string;
  /** In workflow order. */
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
}

/** One recorded status change (task_status_events). The foundation of Phase 10's activity feed. */
export interface StatusEvent {
  id: string;
  taskId: string;
  from: TaskStatus | null;
  to: TaskStatus;
  actorId: string | null;
  note: string | null;
  isOverride: boolean;
  revisionNumber: number | null;
  createdAt: string;
}


// ==============================================================================
// PHASE 7b: PRODUCTION ANALYTICS (first-QC submissions)
// ==============================================================================

/** How many videos an editor FIRST submitted for QC in a calendar month. Never "delivered". */
export interface ProductionMonth {
  editorId: string;
  year: number;
  /** 1-12 */
  month: number;
  credits: number;
}

/** One video behind a month: the real task, with where it lives and its own links. */
export interface ProductionVideo {
  taskId: string;
  title: string;
  /** The task's status NOW (it may have moved on long after its first QC submission). */
  status: TaskStatus;
  firstQcSubmittedAt: string;
  /** Who made the move (the editor, or a manager on their behalf). */
  submittedBy: string | null;
  listId: string;
  listName: string;
  folderName: string | null;
  spaceId: string;
  spaceName: string;
  reviewLink: string | null;
  finalExportLink: string | null;
  projectFileLink: string | null;
}
