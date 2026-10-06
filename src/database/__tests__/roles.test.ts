import { describe, it, expect } from 'vitest';
import { TbbRole } from '@/types/database';

/**
 * Authorization policy matrix matching docs/TBB_PERMISSION_MODEL.md
 */
const ROLE_HIERARCHY: Record<TbbRole, number> = {
  OWNER: 6,
  ADMIN: 5,
  PRODUCTION_MANAGER: 4,
  QC_SPECIALIST: 3,
  EDITOR: 2,
  CLIENT_VIEWER: 1,
};

function hasMinimumRole(userRole: TbbRole, requiredRole: TbbRole): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 0);
}

function canManageWorkspace(role: TbbRole): boolean {
  return role === 'OWNER';
}

function canManageSpaces(role: TbbRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

function canManageFoldersAndLists(role: TbbRole): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'PRODUCTION_MANAGER';
}

function canApproveQc(role: TbbRole): boolean {
  return (
    role === 'OWNER' ||
    role === 'ADMIN' ||
    role === 'PRODUCTION_MANAGER' ||
    role === 'QC_SPECIALIST'
  );
}

function canViewFinancials(role: TbbRole, isAssignedEditor: boolean): boolean {
  if (role === 'OWNER' || role === 'ADMIN' || role === 'PRODUCTION_MANAGER') {
    return true;
  }
  if (role === 'EDITOR' && isAssignedEditor) {
    return true; // Editor can only view own payout
  }
  return false;
}

describe('TBB Role-Based Access Control Matrix', () => {
  it('correctly ranks the 6 operational roles hierarchically', () => {
    expect(hasMinimumRole('OWNER', 'ADMIN')).toBe(true);
    expect(hasMinimumRole('ADMIN', 'PRODUCTION_MANAGER')).toBe(true);
    expect(hasMinimumRole('PRODUCTION_MANAGER', 'QC_SPECIALIST')).toBe(true);
    expect(hasMinimumRole('QC_SPECIALIST', 'EDITOR')).toBe(true);
    expect(hasMinimumRole('EDITOR', 'CLIENT_VIEWER')).toBe(true);

    expect(hasMinimumRole('EDITOR', 'QC_SPECIALIST')).toBe(false);
    expect(hasMinimumRole('CLIENT_VIEWER', 'EDITOR')).toBe(false);
    expect(hasMinimumRole('PRODUCTION_MANAGER', 'ADMIN')).toBe(false);
  });

  it('restricts workspace-level settings to OWNER only', () => {
    expect(canManageWorkspace('OWNER')).toBe(true);
    expect(canManageWorkspace('ADMIN')).toBe(false);
    expect(canManageWorkspace('PRODUCTION_MANAGER')).toBe(false);
    expect(canManageWorkspace('QC_SPECIALIST')).toBe(false);
    expect(canManageWorkspace('EDITOR')).toBe(false);
    expect(canManageWorkspace('CLIENT_VIEWER')).toBe(false);
  });

  it('allows OWNER and ADMIN to manage spaces and global workflows', () => {
    expect(canManageSpaces('OWNER')).toBe(true);
    expect(canManageSpaces('ADMIN')).toBe(true);
    expect(canManageSpaces('PRODUCTION_MANAGER')).toBe(false);
    expect(canManageSpaces('EDITOR')).toBe(false);
  });

  it('allows PRODUCTION_MANAGER, ADMIN, and OWNER to create client folders and lists', () => {
    expect(canManageFoldersAndLists('OWNER')).toBe(true);
    expect(canManageFoldersAndLists('ADMIN')).toBe(true);
    expect(canManageFoldersAndLists('PRODUCTION_MANAGER')).toBe(true);
    expect(canManageFoldersAndLists('QC_SPECIALIST')).toBe(false);
    expect(canManageFoldersAndLists('EDITOR')).toBe(false);
    expect(canManageFoldersAndLists('CLIENT_VIEWER')).toBe(false);
  });

  it('restricts QC approvals so EDITORS cannot approve their own videos', () => {
    expect(canApproveQc('OWNER')).toBe(true);
    expect(canApproveQc('ADMIN')).toBe(true);
    expect(canApproveQc('PRODUCTION_MANAGER')).toBe(true);
    expect(canApproveQc('QC_SPECIALIST')).toBe(true);
    expect(canApproveQc('EDITOR')).toBe(false);
    expect(canApproveQc('CLIENT_VIEWER')).toBe(false);
  });

  it('enforces financial privacy boundaries', () => {
    expect(canViewFinancials('OWNER', false)).toBe(true);
    expect(canViewFinancials('ADMIN', false)).toBe(true);
    expect(canViewFinancials('PRODUCTION_MANAGER', false)).toBe(true);
    expect(canViewFinancials('QC_SPECIALIST', false)).toBe(false);
    expect(canViewFinancials('EDITOR', false)).toBe(false);
    expect(canViewFinancials('EDITOR', true)).toBe(true);
    expect(canViewFinancials('CLIENT_VIEWER', false)).toBe(false);
  });
});
