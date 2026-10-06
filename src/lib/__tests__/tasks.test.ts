import { describe, it, expect } from 'vitest';
import {
  ASPECT_RATIOS,
  EDITOR_LOCKED_STATUSES,
  QC_LOCKED_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  dateInputToIso,
  deadlineWarning,
  dueState,
  eligibleAssignees,
  formatDay,
  isFinished,
  isValidTaskUrl,
  isoToDateInput,
  linkHost,
  memberLookup,
  memberName,
  nextTaskPosition,
  priorityOption,
  progressOf,
  readOnlyReason,
  statusOption,
  subtaskProgress,
  taskAccess,
  validateTaskDescription,
  validateTaskTitle,
  validateTaskUrl,
} from '../tasks';
import type { TaskStatus, TbbRole, WorkspaceMember } from '@/types/database';

const member = (userId: string, role: TbbRole, fullName: string, isActive = true): WorkspaceMember => ({
  workspaceId: 'w', userId, role, createdAt: 'c', updatedAt: 'u',
  profile: { id: userId, email: `${userId}@x.co`, fullName, role: 'EDITOR', timezone: 'UTC', isActive, createdAt: 'c', updatedAt: 'u' },
});

describe('labels', () => {
  it('knows every status and priority the database allows, in order', () => {
    expect(TASK_STATUSES.map((s) => s.value)).toEqual(['TODO', 'IN_PROGRESS', 'IN_QC', 'READY_TO_DELIVER', 'CLIENT_REVIEW', 'COMPLETED', 'CLOSED']);
    expect(TASK_PRIORITIES.map((p) => p.value)).toEqual(['URGENT', 'HIGH', 'MEDIUM', 'LOW']);
    expect(ASPECT_RATIOS.map((a) => a.value)).toEqual(['9:16', '16:9', '1:1', '4:5', 'OTHER']);
  });

  it('falls back safely for an unknown value instead of crashing', () => {
    expect(statusOption('NOPE' as TaskStatus).value).toBe('TODO');
    expect(priorityOption('NOPE' as never).value).toBe('MEDIUM');
    expect(statusOption('IN_QC').label).toBe('In QC');
    expect(priorityOption('MEDIUM').label).toBe('Normal');
  });

  it('priorities sort most urgent first', () => {
    const ranks = TASK_PRIORITIES.map((p) => p.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('validation', () => {
  it('requires a title and caps its length like the database', () => {
    expect(validateTaskTitle('')).toBe('Enter a task title.');
    expect(validateTaskTitle('   ')).toBe('Enter a task title.');
    expect(validateTaskTitle('Episode 1')).toBeNull();
    expect(validateTaskTitle('x'.repeat(500))).toBeNull();
    expect(validateTaskTitle('x'.repeat(501))).toMatch(/500 characters/);
    expect(validateTaskTitle('', 'subtask')).toBe('Enter a subtask title.');
  });

  it('caps the description', () => {
    expect(validateTaskDescription('x'.repeat(20000))).toBeNull();
    expect(validateTaskDescription('x'.repeat(20001))).toMatch(/20,000/);
  });

  it.each([
    ['https://drive.google.com/drive/folders/abc', true],
    ['http://example.com', true],
    ['HTTPS://Frame.io/reviews/1?x=1#t', true],
    ['https://a.co:8080/p', true],
    ['javascript:alert(1)', false],
    ['JaVaScRiPt:alert(1)', false],
    ['data:text/html,<b>x</b>', false],
    ['ftp://files.example.com/a', false],
    ['//evil.example.com', false],
    ['drive.google.com/x', false],
    ['https://', false],
    ['https:///path', false],
    ['https://a.co/has space', false],
    ['https://a.co/\nnewline', false],
    ['', false],
  ])('URL %j is %s', (value, valid) => {
    expect(isValidTaskUrl(value)).toBe(valid);
  });

  it('rejects links over 2048 characters', () => {
    expect(isValidTaskUrl(`https://a.co/${'a'.repeat(2035)}`)).toBe(true);
    expect(isValidTaskUrl(`https://a.co/${'a'.repeat(2040)}`)).toBe(false);
    expect(validateTaskUrl(`https://a.co/${'a'.repeat(2100)}`)).toMatch(/2048/);
  });

  it('validateTaskUrl allows empty (optional) and explains anything else that is not a full link', () => {
    expect(validateTaskUrl('')).toBeNull();
    expect(validateTaskUrl('   ')).toBeNull();
    expect(validateTaskUrl(' https://a.co ')).toBeNull();
    expect(validateTaskUrl('www.a.co')).toMatch(/http:\/\/ or https:\/\//);
    expect(validateTaskUrl('javascript:alert(1)')).toMatch(/http:\/\/ or https:\/\//);
  });

  it('shows the host of a link and ignores junk', () => {
    expect(linkHost('https://www.drive.google.com/x')).toBe('drive.google.com');
    expect(linkHost('https://app.frame.io/reviews/1')).toBe('app.frame.io');
    expect(linkHost('not a url')).toBeNull();
    expect(linkHost(null)).toBeNull();
  });
});

describe('dates', () => {
  it('round-trips a calendar day through the stored instant without drifting', () => {
    for (const day of ['2026-01-01', '2026-03-29', '2026-10-25', '2026-12-31', '2028-02-29']) {
      expect(isoToDateInput(dateInputToIso(day))).toBe(day);
    }
    expect(dateInputToIso('')).toBeNull();
    expect(dateInputToIso('garbage')).toBeNull();
    expect(isoToDateInput(null)).toBe('');
    expect(isoToDateInput('not a date')).toBe('');
  });

  it('classifies deadlines by local calendar day', () => {
    const now = new Date(2026, 9, 7, 15, 0, 0);
    const at = (days: number, hour = 12) => new Date(2026, 9, 7 + days, hour).toISOString();
    expect(dueState(at(-1), now)).toBe('overdue');
    expect(dueState(at(0, 1), now)).toBe('today');
    expect(dueState(at(0, 23), now)).toBe('today');
    expect(dueState(at(1), now)).toBe('soon');
    expect(dueState(at(2), now)).toBe('soon');
    expect(dueState(at(3), now)).toBe('later');
    expect(dueState(null, now)).toBeNull();
    expect(dueState('garbage', now)).toBeNull();
  });

  it('finished tasks are recognised (they are never shown as overdue)', () => {
    expect(isFinished('COMPLETED')).toBe(true);
    expect(isFinished('CLOSED')).toBe(true);
    expect(isFinished('IN_QC')).toBe(false);
  });

  it('formats a day compactly and omits the current year', () => {
    const now = new Date(2026, 9, 7);
    expect(formatDay(new Date(2026, 9, 12, 12).toISOString(), now)).not.toMatch(/2026/);
    expect(formatDay(new Date(2027, 0, 5, 12).toISOString(), now)).toMatch(/2027/);
    expect(formatDay(null, now)).toBe('');
  });

  it('warns (softly) when the internal QC date is after the client deadline', () => {
    const early = dateInputToIso('2026-10-10');
    const late = dateInputToIso('2026-10-20');
    expect(deadlineWarning(early, late)).toBeNull();
    expect(deadlineWarning(late, early)).toMatch(/after the client deadline/);
    expect(deadlineWarning(late, late)).toBeNull();
    expect(deadlineWarning(null, late)).toBeNull();
    expect(deadlineWarning(late, null)).toBeNull();
  });
});

describe('subtask progress', () => {
  it('calculates done / total / percent', () => {
    expect(progressOf(0, 0)).toEqual({ done: 0, total: 0, percent: 0 });
    expect(progressOf(1, 3)).toEqual({ done: 1, total: 3, percent: 33 });
    expect(progressOf(2, 3)).toEqual({ done: 2, total: 3, percent: 67 });
    expect(progressOf(4, 4)).toEqual({ done: 4, total: 4, percent: 100 });
  });

  it('clamps nonsense instead of showing >100% or negatives', () => {
    expect(progressOf(9, 4)).toEqual({ done: 4, total: 4, percent: 100 });
    expect(progressOf(-2, 4)).toEqual({ done: 0, total: 4, percent: 0 });
    expect(progressOf(1, -4)).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it('counts completed subtasks of a checklist', () => {
    expect(subtaskProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
    expect(subtaskProgress([{ isCompleted: true }, { isCompleted: false }, { isCompleted: true }, { isCompleted: true }])).toEqual({ done: 3, total: 4, percent: 75 });
  });
});

describe('ordering', () => {
  it('appends after the highest position, and starts at 0', () => {
    expect(nextTaskPosition([])).toBe(0);
    expect(nextTaskPosition([{ position: 0 }, { position: 1 }])).toBe(2);
    expect(nextTaskPosition([{ position: 7 }, { position: 2 }])).toBe(8);
  });
});

describe('assignee eligibility (mirrors guard_task_assignee)', () => {
  const people = [
    member('owner', 'OWNER', 'Olive'),
    member('admin', 'ADMIN', 'Ada'),
    member('pm', 'PRODUCTION_MANAGER', 'Pat'),
    member('qc', 'QC_SPECIALIST', 'Quinn'),
    member('ed', 'EDITOR', 'Eddie'),
    member('ed2', 'EDITOR', 'Zed'),
    member('gone', 'EDITOR', 'Gone', false),
    member('client', 'CLIENT_VIEWER', 'Cleo'),
  ];

  it('offers owners, admins, managers and editors as the editor', () => {
    expect(eligibleAssignees(people, 'EDITOR', null).map((m) => m.userId)).toEqual(['admin', 'ed', 'owner', 'pm', 'ed2']);
  });

  it('offers owners, admins, managers and QC specialists as the QC reviewer', () => {
    expect(eligibleAssignees(people, 'QC_REVIEWER', null).map((m) => m.userId)).toEqual(['admin', 'owner', 'pm', 'qc']);
  });

  it('never offers deactivated accounts or client viewers', () => {
    for (const slot of ['EDITOR', 'QC_REVIEWER'] as const) {
      const ids = eligibleAssignees(people, slot, null).map((m) => m.userId);
      expect(ids).not.toContain('gone');
      expect(ids).not.toContain('client');
    }
  });

  it('never offers the person already in the other slot (nobody QCs their own cut)', () => {
    expect(eligibleAssignees(people, 'QC_REVIEWER', 'pm').map((m) => m.userId)).not.toContain('pm');
    expect(eligibleAssignees(people, 'EDITOR', 'admin').map((m) => m.userId)).not.toContain('admin');
  });

  it('sorts by name and tolerates members without a loaded profile', () => {
    const noProfile: WorkspaceMember = { workspaceId: 'w', userId: 'x', role: 'EDITOR', createdAt: 'c', updatedAt: 'u' };
    expect(() => eligibleAssignees([noProfile, ...people], 'EDITOR', null)).not.toThrow();
    const names = eligibleAssignees(people, 'EDITOR', null).map((m) => m.profile?.fullName);
    expect(names).toEqual([...names].sort((a, b) => (a ?? '').localeCompare(b ?? '')));
  });

  it('resolves names from the cached member list and labels people who left', () => {
    const lookup = memberLookup(people);
    expect(memberName(lookup, 'pm')).toBe('Pat');
    expect(memberName(lookup, null)).toBe('Unassigned');
    expect(memberName(lookup, 'someone-who-left')).toBe('Former member');
    expect(memberLookup(undefined).size).toBe(0);
  });
});

describe('taskAccess (UI mirror of the database guards)', () => {
  const MANAGERS: TbbRole[] = ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'];

  it.each(MANAGERS)('%s can edit, assign, add and manage subtasks, reorder and pick any status', (role) => {
    const a = taskAccess(role, { isAssignedEditor: false, currentStatus: 'CLOSED' });
    expect(a).toMatchObject({ editBrief: true, editWorkLinks: true, assign: true, addSubtasks: true, manageSubtasks: true, tickSubtasks: true, reorder: true, delete: true });
    expect(a.statusOptions).toHaveLength(TASK_STATUSES.length);
    expect(readOnlyReason(role, a)).toBeNull();
  });

  it('an editor assigned to the task: status (not late stages), review + project links, ticking: nothing else', () => {
    const a = taskAccess('EDITOR', { isAssignedEditor: true, currentStatus: 'IN_PROGRESS' });
    expect(a).toMatchObject({ editBrief: false, editWorkLinks: true, assign: false, addSubtasks: false, manageSubtasks: false, tickSubtasks: true, reorder: false, delete: false });
    expect(a.statusOptions).toEqual(['TODO', 'IN_PROGRESS', 'IN_QC']);
    for (const locked of EDITOR_LOCKED_STATUSES) expect(a.statusOptions).not.toContain(locked);
    expect(readOnlyReason('EDITOR', a)).toMatch(/assigned to you/);
  });

  it('an editor cannot change status once the task is in a late stage (cannot pull it back)', () => {
    for (const status of EDITOR_LOCKED_STATUSES) {
      expect(taskAccess('EDITOR', { isAssignedEditor: true, currentStatus: status }).statusOptions).toEqual([]);
    }
  });

  it('an editor NOT assigned to the task can only look', () => {
    const a = taskAccess('EDITOR', { isAssignedEditor: false, currentStatus: 'TODO' });
    expect(a).toMatchObject({ editBrief: false, editWorkLinks: false, assign: false, tickSubtasks: false, delete: false });
    expect(a.statusOptions).toEqual([]);
    expect(readOnlyReason('EDITOR', a)).toMatch(/not assigned to you/);
  });

  it('QC specialists change status (never to or from COMPLETED / CLOSED) and tick, nothing else', () => {
    const a = taskAccess('QC_SPECIALIST', { isAssignedEditor: false, currentStatus: 'IN_QC' });
    expect(a).toMatchObject({ editBrief: false, editWorkLinks: false, assign: false, tickSubtasks: true, manageSubtasks: false, delete: false });
    for (const locked of QC_LOCKED_STATUSES) expect(a.statusOptions).not.toContain(locked);
    expect(a.statusOptions).toContain('READY_TO_DELIVER');
    expect(taskAccess('QC_SPECIALIST', { isAssignedEditor: false, currentStatus: 'COMPLETED' }).statusOptions).toEqual([]);
    expect(readOnlyReason('QC_SPECIALIST', a)).toMatch(/QC specialists/);
  });

  it('client viewers and signed-out visitors get nothing', () => {
    for (const role of ['CLIENT_VIEWER', null, undefined] as const) {
      const a = taskAccess(role, { isAssignedEditor: false });
      expect(Object.values(a).every((v) => v === false || (Array.isArray(v) && v.length === 0))).toBe(true);
    }
    expect(readOnlyReason('CLIENT_VIEWER', taskAccess('CLIENT_VIEWER', { isAssignedEditor: false }))).toMatch(/Only managers/);
  });

  it('a user whose role is not EDITOR gains nothing from being flagged as the assigned editor', () => {
    expect(taskAccess('CLIENT_VIEWER', { isAssignedEditor: true }).editWorkLinks).toBe(false);
    expect(taskAccess('QC_SPECIALIST', { isAssignedEditor: true }).editWorkLinks).toBe(false);
  });
});
