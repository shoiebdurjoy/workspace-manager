import type { Subtask, TaskDetail, TaskSummary, WorkspaceMember } from '@/types/database';
import { IDS } from './hierarchy-fixtures';

/** Test-only task fixtures. Valid UUIDs, because task routes validate their ids. */
export const TASK_IDS = {
  one: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  two: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  three: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  otherList: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
  sub1: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  sub2: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
};

/** The signed-in test user (makeAuth) is `user-1`; the others are colleagues. */
export const PEOPLE = {
  me: 'user-1',
  editor2: 'user-editor-2',
  qc: 'user-qc',
  manager: 'user-manager',
  admin: 'user-admin',
};

const stamp = '2026-10-01T00:00:00Z';

function member(userId: string, role: WorkspaceMember['role'], fullName: string): WorkspaceMember {
  return {
    workspaceId: 'ws-1',
    userId,
    role,
    createdAt: stamp,
    updatedAt: stamp,
    profile: { id: userId, email: `${userId}@thinkbigbrand.com`, fullName, role: 'EDITOR', timezone: 'UTC', isActive: true, createdAt: stamp, updatedAt: stamp },
  };
}

export const MEMBERS: WorkspaceMember[] = [
  member(PEOPLE.me, 'EDITOR', 'Pat Person'),
  member(PEOPLE.editor2, 'EDITOR', 'Eva Editor'),
  member(PEOPLE.qc, 'QC_SPECIALIST', 'Quinn QC'),
  member(PEOPLE.manager, 'PRODUCTION_MANAGER', 'Mia Manager'),
  member(PEOPLE.admin, 'ADMIN', 'Ada Admin'),
];

export function makeSummary(overrides: Partial<TaskSummary> & Pick<TaskSummary, 'id' | 'title'>): TaskSummary {
  return {
    listId: IDS.listEdaptx,
    status: 'TODO',
    priority: 'MEDIUM',
    position: 0,
    aspectRatio: null,
    dueDate: null,
    clientDeadline: null,
    rawFootageLink: null,
    projectFileLink: null,
    reviewLink: null,
    finalExportLink: null,
    createdAt: stamp,
    updatedAt: stamp,
    editorId: null,
    qcId: null,
    subtaskTotal: 0,
    subtaskDone: 0,
    ...overrides,
  };
}

export function makeSubtask(overrides: Partial<Subtask> & Pick<Subtask, 'id' | 'title'>): Subtask {
  return { taskId: TASK_IDS.one, isCompleted: false, position: 0, createdAt: stamp, updatedAt: stamp, ...overrides };
}

export function makeDetail(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: TASK_IDS.one,
    workspaceId: 'ws-1',
    listId: IDS.listEdaptx,
    title: 'Episode 12 - Founder story',
    description: 'Cut to 58 seconds.',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    position: 0,
    aspectRatio: '9:16',
    rawFootageLink: 'https://drive.google.com/drive/folders/abc',
    projectFileLink: null,
    reviewLink: 'https://app.frame.io/reviews/xyz',
    finalExportLink: null,
    dueDate: '2026-10-12T12:00:00.000Z',
    clientDeadline: '2026-10-20T12:00:00.000Z',
    createdBy: PEOPLE.manager,
    createdAt: stamp,
    updatedAt: stamp,
    editorId: PEOPLE.me,
    qcId: PEOPLE.qc,
    subtasks: [
      makeSubtask({ id: TASK_IDS.sub1, title: 'Rough cut', isCompleted: true, position: 0 }),
      makeSubtask({ id: TASK_IDS.sub2, title: 'Captions', isCompleted: false, position: 1 }),
    ],
    ...overrides,
  };
}
