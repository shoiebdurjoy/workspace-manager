import { describe, it, expect } from 'vitest';
import {
  assignableRoles,
  can,
  canAny,
  canManageMember,
  capabilitiesOf,
  invitableRoles,
  ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type Capability,
} from '../permissions';
import type { TbbRole } from '@/types/database';

const [OWNER, ADMIN, PM, QC, EDITOR, CLIENT] = ROLES;

/**
 * docs/TBB_PERMISSION_MODEL.md 2 — every row of the matrix, in column order
 * Owner | Admin | Production Manager | QC Specialist | Editor | Client Viewer
 */
const MATRIX: Array<[Capability, string, [boolean, boolean, boolean, boolean, boolean, boolean]]> = [
  ['workspace:manage', 'Workspace Settings & Billing', [true, false, false, false, false, false]],
  ['users:invite', 'Invite / Deactivate Users', [true, true, false, false, false, false]],
  ['users:change-role', 'Change User Roles', [true, true, false, false, false, false]],
  ['space:create', 'Create Spaces & Global Workflows', [true, true, false, false, false, false]],
  ['folder-list:create', 'Create Client Folders & Lists', [true, true, true, false, false, false]],
  ['folder-list:delete', 'Delete Lists or Folders', [true, true, false, false, false, false]],
  // Phase 5: rows implied by the model and enforced by the spaces/folders/lists RLS policies
  ['hierarchy:view', 'See the workspace tree (staff only)', [true, true, true, true, true, false]],
  ['space:edit', 'Edit / reorder spaces', [true, true, false, false, false, false]],
  ['space:delete', 'Delete a space', [true, true, false, false, false, false]],
  ['folder-list:edit', 'Rename / move / reorder folders and lists', [true, true, true, false, false, false]],
  ['task:create', 'Create Video Tasks', [true, true, true, false, false, false]],
  ['task:delete', 'Delete tasks (tasks_delete policy: managers)', [true, true, true, false, false, false]],
  ['task:assign', 'Assign Editors & QC Reviewers', [true, true, true, false, false, false]],
  ['task:edit-brief', 'Edit Task Brief & Due Dates', [true, true, true, false, false, false]],
  ['task:update-status', 'Update Editing Status', [true, true, true, true, true, false]],
  ['task:approve-qc', 'Approve Task to QC Passed (RTD)', [true, true, true, true, false, false]],
  ['task:deliver', 'Deliver to Client (SENT TO CLIENT)', [true, true, true, true, false, false]],
  ['task:close', 'Close Task', [true, true, true, false, false, false]],
  ['finance:view', 'View Editor Pay Rates / Financials', [true, true, true, false, false, false]],
  ['payments:approve', 'Approve Editor Payments', [true, true, true, false, false, false]],
  ['comments:view-internal', 'View Internal Comments', [true, true, true, true, true, false]],
  ['comments:post', 'Post Comments & Revisions', [true, true, true, true, true, true]],
];

describe('permission matrix (docs/TBB_PERMISSION_MODEL.md)', () => {
  for (const [capability, label, expected] of MATRIX) {
    it(`${label} (${capability})`, () => {
      ROLES.forEach((role, i) => {
        expect(can(role, capability), `${role} -> ${capability}`).toBe(expected[i]);
      });
    });
  }

  it('an editor can never approve to RTD, deliver or close (no self-approval)', () => {
    expect(can(EDITOR, 'task:approve-qc')).toBe(false);
    expect(can(EDITOR, 'task:deliver')).toBe(false);
    expect(can(EDITOR, 'task:close')).toBe(false);
  });

  it('client viewers fail closed on everything internal', () => {
    expect(can(CLIENT, 'team:view')).toBe(false);
    expect(can(CLIENT, 'comments:view-internal')).toBe(false);
    expect(capabilitiesOf(CLIENT)).toEqual(['comments:post']);
  });

  it('team capabilities: staff view, admins manage pods, managers manage pod members', () => {
    expect(ROLES.filter((r) => can(r, 'team:view'))).toEqual([OWNER, ADMIN, PM, QC, EDITOR]);
    expect(ROLES.filter((r) => can(r, 'team:manage-pods'))).toEqual([OWNER, ADMIN]);
    expect(ROLES.filter((r) => can(r, 'team:manage-pod-members'))).toEqual([OWNER, ADMIN, PM]);
  });
});

describe('can / canAny with missing roles', () => {
  it('null and undefined roles have no capabilities', () => {
    expect(can(null, 'comments:post')).toBe(false);
    expect(can(undefined, 'comments:post')).toBe(false);
    expect(capabilitiesOf(null)).toEqual([]);
  });

  it('canAny is true if at least one capability is granted', () => {
    expect(canAny(EDITOR, ['users:invite', 'task:update-status'])).toBe(true);
    expect(canAny(EDITOR, ['users:invite', 'task:create'])).toBe(false);
    expect(canAny(null, ['comments:post'])).toBe(false);
  });
});

describe('role assignment rules (mirror the database policies)', () => {
  it('owner can assign every role, admin everything except OWNER, others nothing', () => {
    expect(assignableRoles(OWNER)).toEqual([...ROLES]);
    expect(assignableRoles(ADMIN)).toEqual([ADMIN, PM, QC, EDITOR, CLIENT]);
    for (const r of [PM, QC, EDITOR, CLIENT] as TbbRole[]) expect(assignableRoles(r)).toEqual([]);
    expect(assignableRoles(null)).toEqual([]);
  });

  it('OWNER can never be granted by invitation, even by an owner', () => {
    expect(invitableRoles(OWNER)).not.toContain('OWNER');
    expect(invitableRoles(OWNER)).toEqual([ADMIN, PM, QC, EDITOR, CLIENT]);
    expect(invitableRoles(ADMIN)).not.toContain('OWNER');
    expect(invitableRoles(EDITOR)).toEqual([]);
  });

  it('canManageMember: not yourself, admins never touch an owner, owners can', () => {
    expect(canManageMember(OWNER, EDITOR, true)).toBe(false);
    expect(canManageMember(OWNER, EDITOR, false)).toBe(true);
    expect(canManageMember(ADMIN, OWNER, false)).toBe(false);
    expect(canManageMember(OWNER, OWNER, false)).toBe(true);
    expect(canManageMember(ADMIN, ADMIN, false)).toBe(true);
    expect(canManageMember(PM, EDITOR, false)).toBe(false);
    expect(canManageMember(EDITOR, EDITOR, false)).toBe(false);
    expect(canManageMember(null, EDITOR, false)).toBe(false);
  });
});

describe('role metadata', () => {
  it('has a label and description for each of the six TBB roles', () => {
    expect(ROLES).toHaveLength(6);
    for (const r of ROLES) {
      expect(ROLE_LABELS[r]).toBeTruthy();
      expect(ROLE_DESCRIPTIONS[r]).toBeTruthy();
    }
  });
});
