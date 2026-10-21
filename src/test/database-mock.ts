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
/** The real error is a class the hooks check with instanceof; a stand-in with the same name and code. */
class StaleTransitionError extends Error {
  code = 'STALE';
  constructor() {
    super('Someone else moved this task in the meantime. It now shows its current stage; please check and try again.');
    this.name = 'StaleTransitionError';
  }
}

export function createDatabaseMock() {
  return {
    // workflow
    getWorkflow: vi.fn(),
    transitionTask: vi.fn(),
    getLatestRevisionRequest: vi.fn(),
    getLatestRevisionNotes: vi.fn().mockResolvedValue(new Map()),
    // production analytics
    getProductionMonthly: vi.fn(),
    // home (Phase 11)
    getHomeSummary: vi.fn(),
    getProductionVideos: vi.fn(),
    StaleTransitionError,
    NOTE_MAX_LENGTH: 2000,
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
    searchTasks: vi.fn(),
    getTask: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    setTaskAssignee: vi.fn(),
    moveTask: vi.fn(),
    createSubtask: vi.fn(),
    updateSubtask: vi.fn(),
    deleteSubtask: vi.fn(),
    // collaboration (Phase 10): empty by default, so a screen that does not care about them renders its empty state
    listComments: vi.fn().mockResolvedValue([]),
    addComment: vi.fn(),
    editComment: vi.fn(),
    deleteComment: vi.fn(),
    listAttachments: vi.fn().mockResolvedValue([]),
    uploadAttachment: vi.fn(),
    getAttachmentUrl: vi.fn(),
    deleteAttachment: vi.fn(),
    taskFilePaths: vi.fn().mockResolvedValue([]),
    removeStoredFiles: vi.fn().mockResolvedValue(undefined),
    listTaskActivity: vi.fn().mockResolvedValue({ entries: [], hasMore: false }),
    ACTIVITY_PAGE_SIZE: 50,
    listNotifications: vi.fn().mockResolvedValue({ items: [], next: null }),
    countUnreadNotifications: vi.fn().mockResolvedValue(0),
    countInboxUnread: vi.fn().mockResolvedValue(0),
    setNotificationsDone: vi.fn().mockResolvedValue(undefined),
    markReadNotificationsDone: vi.fn().mockResolvedValue(undefined),
    markNotificationsRead: vi.fn().mockResolvedValue(undefined),
    markAllNotificationsRead: vi.fn().mockResolvedValue(undefined),
    markNotificationUnread: vi.fn().mockResolvedValue(undefined),
    subscribeToNotifications: vi.fn(() => () => undefined),
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
