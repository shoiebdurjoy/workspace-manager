import type { TbbRole } from '@/types/database';

/**
 * Client-side capability model (Tier 2 of the two-tier authorization design in
 * docs/TBB_ARCHITECTURE_PROPOSAL.md 4.2).
 *
 * This only decides what the interface SHOWS. Row Level Security and the guard triggers in
 * the database (Tier 1) are the real enforcement: hiding a button never grants or removes
 * access. The matrix mirrors docs/TBB_PERMISSION_MODEL.md 2 row for row, and the unit tests
 * assert every cell.
 */

export const ROLES: readonly TbbRole[] = [
  'OWNER',
  'ADMIN',
  'PRODUCTION_MANAGER',
  'QC_SPECIALIST',
  'EDITOR',
  'CLIENT_VIEWER',
] as const;

export const ROLE_LABELS: Record<TbbRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  PRODUCTION_MANAGER: 'Production Manager',
  QC_SPECIALIST: 'QC Specialist',
  EDITOR: 'Editor',
  CLIENT_VIEWER: 'Client Viewer',
};

export const ROLE_DESCRIPTIONS: Record<TbbRole, string> = {
  OWNER: 'Executive: full authority, including workspace settings.',
  ADMIN: 'Operations: manages people, spaces and workflows.',
  PRODUCTION_MANAGER: 'Pod lead: runs client pipelines and assigns work.',
  QC_SPECIALIST: 'Quality gate: approves or rejects deliverables.',
  EDITOR: 'Production: works on assigned videos.',
  CLIENT_VIEWER: 'External reviewer: limited, read-mostly access.',
};

export type Capability =
  | 'workspace:manage'
  | 'users:invite'
  | 'users:change-role'
  | 'hierarchy:view'
  | 'space:create'
  | 'space:edit'
  | 'space:delete'
  | 'folder-list:create'
  | 'folder-list:edit'
  | 'folder-list:delete'
  | 'task:create'
  | 'task:delete'
  | 'task:assign'
  | 'task:edit-brief'
  | 'task:update-status'
  | 'task:approve-qc'
  | 'task:deliver'
  | 'task:close'
  | 'finance:view'
  | 'payments:approve'
  | 'comments:view-internal'
  | 'comments:post'
  | 'team:view'
  | 'team:manage-pods'
  | 'team:manage-pod-members'
  | 'production:view';

const OWNER_ONLY: readonly TbbRole[] = ['OWNER'];
const ADMINS: readonly TbbRole[] = ['OWNER', 'ADMIN'];
const MANAGERS: readonly TbbRole[] = ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'];
const REVIEWERS: readonly TbbRole[] = ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST'];
const STAFF: readonly TbbRole[] = ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR'];

const MATRIX: Record<Capability, readonly TbbRole[]> = {
  'workspace:manage': OWNER_ONLY, // Workspace Settings & Billing
  'users:invite': ADMINS, // Invite / Deactivate Users
  'users:change-role': ADMINS, // Change User Roles
  'hierarchy:view': STAFF, // Sidebar tree (client viewers fail closed until guest grants exist)
  'space:create': ADMINS, // Create Spaces & Global Workflows
  'space:edit': ADMINS, // Rename / restyle / reorder spaces (spaces_update policy)
  'space:delete': ADMINS, // Delete a space and everything in it (spaces_delete policy)
  'folder-list:create': MANAGERS, // Create Client Folders & Lists
  'folder-list:edit': MANAGERS, // Rename / move / reorder folders and lists (folders/lists_update policies)
  'folder-list:delete': ADMINS, // Delete Lists or Folders
  'task:create': MANAGERS, // Create Video Tasks
  'task:delete': MANAGERS, // Delete tasks (tasks_delete policy: managers; not a matrix row, so it follows task creation)
  'task:assign': MANAGERS, // Assign Editors & QC Reviewers
  'task:edit-brief': MANAGERS, // Edit Task Brief & Due Dates (QC: notes only, later phase)
  'task:update-status': STAFF, // Update Editing Status (editor: own tasks, enforced in DB)
  'task:approve-qc': REVIEWERS, // Approve Task to QC Passed (RTD)
  'task:deliver': REVIEWERS, // Deliver to Client (SENT TO CLIENT)
  'task:close': MANAGERS, // Close Task
  'finance:view': MANAGERS, // View Editor Pay Rates (editors: own rate, later phase)
  'payments:approve': MANAGERS, // Approve Editor Payments
  'comments:view-internal': STAFF, // View Internal Comments
  'comments:post': ROLES, // Post Comments & Revisions
  'team:view': STAFF, // Members and pods (client viewers fail closed)
  'team:manage-pods': ADMINS, // Create / edit / delete pods
  'team:manage-pod-members': MANAGERS, // Add / remove people in a pod
  'production:view': ADMINS, // Employee production analytics (first-QC submissions): Owner / Admin only
};

export function can(role: TbbRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return MATRIX[capability].includes(role);
}

export function canAny(role: TbbRole | null | undefined, capabilities: readonly Capability[]): boolean {
  return capabilities.some((c) => can(role, c));
}

export function capabilitiesOf(role: TbbRole | null | undefined): Capability[] {
  return (Object.keys(MATRIX) as Capability[]).filter((c) => can(role, c));
}

/**
 * Roles the actor may assign through the Team page. Mirrors the database policies:
 * OWNER can assign any role, ADMIN any role except OWNER, nobody else assigns roles.
 */
export function assignableRoles(actor: TbbRole | null | undefined): TbbRole[] {
  if (actor === 'OWNER') return [...ROLES];
  if (actor === 'ADMIN') return ROLES.filter((r) => r !== 'OWNER');
  return [];
}

/**
 * Roles that can be granted by invitation. OWNER can never be granted this way
 * (the database CHECK constraint enforces it as well).
 */
export function invitableRoles(actor: TbbRole | null | undefined): TbbRole[] {
  return assignableRoles(actor).filter((r) => r !== 'OWNER');
}

/**
 * Whether the actor may change or remove a member currently holding `target`.
 * Admins can never touch an OWNER; nobody can act on themselves through the member list.
 */
export function canManageMember(
  actor: TbbRole | null | undefined,
  target: TbbRole,
  isSelf: boolean
): boolean {
  if (isSelf) return false;
  if (!can(actor, 'users:change-role')) return false;
  if (target === 'OWNER') return actor === 'OWNER';
  return true;
}
