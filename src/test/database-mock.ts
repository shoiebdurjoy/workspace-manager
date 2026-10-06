import { vi } from 'vitest';

/**
 * One shared stand-in for the `@/database` barrel, for component tests. Use it as:
 *
 *   vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
 *   import * as dbModule from '@/database';
 *   const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;
 *
 * Every export the hooks import exists as a vi.fn(), so nothing ever reaches a network.
 */
export function createDatabaseMock() {
  return {
    // hierarchy
    getWorkspaceHierarchy: vi.fn(),
    createSpace: vi.fn(),
    updateSpace: vi.fn(),
    deleteSpace: vi.fn(),
    createFolder: vi.fn(),
    updateFolder: vi.fn(),
    deleteFolder: vi.fn(),
    createList: vi.fn(),
    updateList: vi.fn(),
    deleteList: vi.fn(),
    reorderHierarchy: vi.fn(),
    // tasks (Phase 6)
    listTasks: vi.fn(),
    getTask: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    setTaskAssignee: vi.fn(),
    moveTask: vi.fn(),
    createSubtask: vi.fn(),
    updateSubtask: vi.fn(),
    deleteSubtask: vi.fn(),
    // team (used by Home and the Team page hooks)
    getWorkspaceMembers: vi.fn(),
    listInvitations: vi.fn(),
    listTeams: vi.fn(),
    listTeamMembers: vi.fn(),
    updateMemberRole: vi.fn(),
    removeWorkspaceMember: vi.fn(),
    createInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
    createTeam: vi.fn(),
    updateTeam: vi.fn(),
    deleteTeam: vi.fn(),
    addTeamMember: vi.fn(),
    removeTeamMember: vi.fn(),
    // profile / workspace
    updateProfile: vi.fn(),
    updateWorkspace: vi.fn(),
    createWorkspace: vi.fn(),
  };
}
