import type {
  AspectRatio,
  AssigneeRole,
  Subtask,
  TaskPriority,
  TaskStatus,
  TbbRole,
  WorkspaceMember,
} from '@/types/database';
import { can } from '@/lib/permissions';

/**
 * Pure helpers for the Task Engine (Phase 6). No network, no React: validation, labels, ordering,
 * checklist progress, deadline state, assignee eligibility and which fields a role may edit.
 *
 * The access rules below only decide what the interface OFFERS. The database (RLS + the guard
 * triggers of migration 7) is the real enforcement, and the offline/live RLS suites assert it.
 *
 * Status here is the generic status list from migration 1. The configurable TBB workflow
 * (TO BE EDITED ... CLOSED, revision counter, QC gating) is Phase 7, which replaces TASK_STATUSES
 * and the status guard; nothing else in this file depends on the individual status values.
 */

export const TITLE_MAX_LENGTH = 500;
export const DESCRIPTION_MAX_LENGTH = 20000;
export const URL_MAX_LENGTH = 2048;
export const TASK_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------

export interface StatusOption {
  value: TaskStatus;
  label: string;
  /** Tailwind class for the status dot (functional colour tokens from index.css). */
  dot: string;
}

export const TASK_STATUSES: readonly StatusOption[] = [
  { value: 'TODO', label: 'To do', dot: 'bg-status-backlog' },
  { value: 'IN_PROGRESS', label: 'In progress', dot: 'bg-status-progress' },
  { value: 'IN_QC', label: 'In QC', dot: 'bg-status-review' },
  { value: 'READY_TO_DELIVER', label: 'Ready to deliver', dot: 'bg-status-rtd' },
  { value: 'CLIENT_REVIEW', label: 'Client review', dot: 'bg-status-delivered' },
  { value: 'COMPLETED', label: 'Completed', dot: 'bg-status-rtd' },
  { value: 'CLOSED', label: 'Closed', dot: 'bg-status-backlog' },
];

export function statusOption(status: TaskStatus): StatusOption {
  return TASK_STATUSES.find((s) => s.value === status) ?? TASK_STATUSES[0];
}

/** Statuses an EDITOR may never move a task into or out of (mirrors guard_task_update). */
export const EDITOR_LOCKED_STATUSES: readonly TaskStatus[] = ['READY_TO_DELIVER', 'CLIENT_REVIEW', 'COMPLETED', 'CLOSED'];
/** Statuses a QC specialist may never move a task into or out of (mirrors guard_task_update). */
export const QC_LOCKED_STATUSES: readonly TaskStatus[] = ['COMPLETED', 'CLOSED'];

export interface PriorityOption {
  value: TaskPriority;
  label: string;
  /** Sort weight: lower = more urgent. */
  rank: number;
  flag: string;
}

export const TASK_PRIORITIES: readonly PriorityOption[] = [
  { value: 'URGENT', label: 'Urgent', rank: 0, flag: 'text-priority-urgent' },
  { value: 'HIGH', label: 'High', rank: 1, flag: 'text-priority-high' },
  { value: 'MEDIUM', label: 'Normal', rank: 2, flag: 'text-priority-normal' },
  { value: 'LOW', label: 'Low', rank: 3, flag: 'text-priority-low' },
];

export function priorityOption(priority: TaskPriority): PriorityOption {
  return TASK_PRIORITIES.find((p) => p.value === priority) ?? TASK_PRIORITIES[2];
}

export const ASPECT_RATIOS: ReadonlyArray<{ value: AspectRatio; label: string }> = [
  { value: '9:16', label: '9:16 · Vertical' },
  { value: '16:9', label: '16:9 · Horizontal' },
  { value: '1:1', label: '1:1 · Square' },
  { value: '4:5', label: '4:5 · Portrait' },
  { value: 'OTHER', label: 'Other' },
];

export const ASSIGNEE_SLOTS: ReadonlyArray<{ role: AssigneeRole; label: string; hint: string }> = [
  { role: 'EDITOR', label: 'Editor', hint: 'Edits the video' },
  { role: 'QC_REVIEWER', label: 'QC reviewer', hint: 'Reviews and approves it' },
];

export type LinkField = 'rawFootageLink' | 'projectFileLink' | 'reviewLink' | 'finalExportLink';

export const LINK_FIELDS: ReadonlyArray<{ key: LinkField; label: string; placeholder: string }> = [
  { key: 'rawFootageLink', label: 'Raw footage', placeholder: 'Google Drive folder link' },
  { key: 'projectFileLink', label: 'Project file', placeholder: 'Premiere / project file link' },
  { key: 'reviewLink', label: 'Review link', placeholder: 'Frame.io or Vimeo review link' },
  { key: 'finalExportLink', label: 'Final export', placeholder: 'Final deliverable link' },
];

// ---------------------------------------------------------------------------------------
// Validation (the database re-checks everything; these give people a readable message first)
// ---------------------------------------------------------------------------------------

export function validateTaskTitle(value: string, label = 'task'): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `Enter a ${label} title.`;
  if (trimmed.length > TITLE_MAX_LENGTH) return `The ${label} title must be ${TITLE_MAX_LENGTH} characters or fewer.`;
  return null;
}

export function validateTaskDescription(value: string): string | null {
  if (value.trim().length > DESCRIPTION_MAX_LENGTH) {
    return `The description must be ${DESCRIPTION_MAX_LENGTH.toLocaleString()} characters or fewer.`;
  }
  return null;
}

/** Same rule as the database CHECK: http(s), a host, no whitespace. `javascript:` etc. are refused. */
const URL_PATTERN = /^https?:\/\/[^\s/?#]+([/?#]\S*)?$/i;

export function isValidTaskUrl(value: string): boolean {
  return value.length <= URL_MAX_LENGTH && URL_PATTERN.test(value);
}

/** Empty is allowed (the field is optional); anything else must be a full http(s) link. */
export function validateTaskUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > URL_MAX_LENGTH) return `The link must be ${URL_MAX_LENGTH} characters or fewer.`;
  if (!isValidTaskUrl(trimmed)) return 'Enter a full link that starts with http:// or https://.';
  return null;
}

/** "https://drive.google.com/x" -> "drive.google.com" (shown next to a link). Null if not parseable. */
export function linkHost(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** A soft warning, not an error: the internal QC date normally comes before the client deadline. */
export function deadlineWarning(dueDate: string | null | undefined, clientDeadline: string | null | undefined): string | null {
  if (!dueDate || !clientDeadline) return null;
  return new Date(dueDate).getTime() > new Date(clientDeadline).getTime()
    ? 'The internal QC date is after the client deadline.'
    : null;
}

// ---------------------------------------------------------------------------------------
// Dates (date inputs hold a calendar day; stored as that day's instant in the person's zone)
// ---------------------------------------------------------------------------------------

/** "2026-10-07" (from <input type="date">) -> ISO instant at local noon, immune to DST edges. */
export function dateInputToIso(value: string): string | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

/** ISO instant -> "2026-10-07" for <input type="date"> in the person's local time. */
export function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A calendar day picked in a date picker (a local Date) -> the stored instant (local noon of that day). */
export function dateToIso(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0).toISOString();
}

/** The stored instant -> the local calendar day it represents, for a date picker. Undefined if unset/invalid. */
export function isoToDate(iso: string | null | undefined): Date | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** `days` calendar days from `from` (default now), as a stored instant. Used by the picker shortcuts. */
export function daysFromNowIso(days: number, from: Date = new Date()): string {
  return dateToIso(new Date(from.getFullYear(), from.getMonth(), from.getDate() + days));
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later';

/** Days are compared as local calendar days; "soon" is within the next 2 days. */
export function dueState(iso: string | null | undefined, now: Date = new Date()): DueState | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return null;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000);
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays <= 2) return 'soon';
  return 'later';
}

/** A finished task is never "overdue". */
export function isFinished(status: TaskStatus): boolean {
  return status === 'COMPLETED' || status === 'CLOSED';
}

export function formatDay(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

// ---------------------------------------------------------------------------------------
// Checklist progress
// ---------------------------------------------------------------------------------------

export interface Progress {
  done: number;
  total: number;
  /** 0-100, rounded; 0 when there are no subtasks. */
  percent: number;
}

export function progressOf(done: number, total: number): Progress {
  const safeTotal = Math.max(0, total);
  const safeDone = Math.min(Math.max(0, done), safeTotal);
  return { done: safeDone, total: safeTotal, percent: safeTotal === 0 ? 0 : Math.round((safeDone / safeTotal) * 100) };
}

export function subtaskProgress(subtasks: ReadonlyArray<Pick<Subtask, 'isCompleted'>>): Progress {
  return progressOf(subtasks.filter((s) => s.isCompleted).length, subtasks.length);
}

// ---------------------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------------------

/** Position for a new task or subtask: appended after the current last one. */
export function nextTaskPosition(siblings: ReadonlyArray<{ position: number }>): number {
  return siblings.reduce((max, s) => Math.max(max, s.position), -1) + 1;
}

// ---------------------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------------------

/** Workspace roles that may hold each slot (mirrors guard_task_assignee in migration 7). */
const SLOT_ROLES: Record<AssigneeRole, readonly TbbRole[]> = {
  EDITOR: ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'EDITOR'],
  QC_REVIEWER: ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST'],
};

/**
 * People who can be offered for a slot: active, in an eligible role, and not already the person
 * in the other slot (nobody QC's their own cut). The database enforces the same rules.
 */
export function eligibleAssignees(
  members: readonly WorkspaceMember[],
  slot: AssigneeRole,
  otherSlotUserId: string | null | undefined
): WorkspaceMember[] {
  return members
    .filter((m) => SLOT_ROLES[slot].includes(m.role))
    .filter((m) => m.profile?.isActive !== false)
    .filter((m) => m.userId !== otherSlotUserId)
    .sort((a, b) => (a.profile?.fullName ?? '').localeCompare(b.profile?.fullName ?? ''));
}

// ---------------------------------------------------------------------------------------
// What a person may do with a task (mirrors the migration-7 guards; UI only)
// ---------------------------------------------------------------------------------------

export interface TaskAccess {
  /** Title, description, priority, aspect ratio, dates, raw footage / final export links. */
  editBrief: boolean;
  /** Review link and project file link. */
  editWorkLinks: boolean;
  assign: boolean;
  /** Which statuses can be chosen (empty = status is read-only). */
  statusOptions: readonly TaskStatus[];
  addSubtasks: boolean;
  /** Rename / delete subtasks. */
  manageSubtasks: boolean;
  tickSubtasks: boolean;
  reorder: boolean;
  delete: boolean;
}

const ALL_STATUSES = TASK_STATUSES.map((s) => s.value);

export function taskAccess(
  role: TbbRole | null | undefined,
  options: { isAssignedEditor: boolean; currentStatus?: TaskStatus }
): TaskAccess {
  const manager = can(role, 'task:edit-brief');
  const status = options.currentStatus;

  if (manager) {
    return {
      editBrief: true,
      editWorkLinks: true,
      assign: can(role, 'task:assign'),
      statusOptions: ALL_STATUSES,
      addSubtasks: true,
      manageSubtasks: true,
      tickSubtasks: true,
      reorder: true,
      delete: can(role, 'task:delete'),
    };
  }

  const none: TaskAccess = {
    editBrief: false,
    editWorkLinks: false,
    assign: false,
    statusOptions: [],
    addSubtasks: false,
    manageSubtasks: false,
    tickSubtasks: false,
    reorder: false,
    delete: false,
  };

  if (role === 'QC_SPECIALIST') {
    const locked = status !== undefined && QC_LOCKED_STATUSES.includes(status);
    return {
      ...none,
      statusOptions: locked ? [] : ALL_STATUSES.filter((s) => !QC_LOCKED_STATUSES.includes(s)),
      tickSubtasks: true,
    };
  }

  if (role === 'EDITOR' && options.isAssignedEditor) {
    const locked = status !== undefined && EDITOR_LOCKED_STATUSES.includes(status);
    return {
      ...none,
      editWorkLinks: true,
      statusOptions: locked ? [] : ALL_STATUSES.filter((s) => !EDITOR_LOCKED_STATUSES.includes(s)),
      tickSubtasks: true,
    };
  }

  return none;
}

/** Plain-language reason shown next to a read-only task so people know it is not a bug. */
export function readOnlyReason(role: TbbRole | null | undefined, access: TaskAccess): string | null {
  if (access.editBrief) return null;
  if (role === 'EDITOR') {
    return access.editWorkLinks
      ? 'You can update the status, review link and project file on tasks assigned to you.'
      : 'This task is not assigned to you, so you can view it but not change it.';
  }
  if (role === 'QC_SPECIALIST') return 'QC specialists can update the status and tick the checklist. The brief is managed by a Production Manager.';
  return 'You can view this task. Only managers can change it.';
}

// ---------------------------------------------------------------------------------------
// People lookup (assignees are stored as user ids; names come from the cached member list)
// ---------------------------------------------------------------------------------------

export type MemberLookup = ReadonlyMap<string, WorkspaceMember>;

export function memberLookup(members: readonly WorkspaceMember[] | undefined): MemberLookup {
  return new Map((members ?? []).map((m) => [m.userId, m]));
}

export function memberName(lookup: MemberLookup, userId: string | null | undefined): string {
  if (!userId) return 'Unassigned';
  return lookup.get(userId)?.profile?.fullName ?? 'Former member';
}

/** "Mon 12 Oct" (adds the year when it is not the current one): the long form used in the detail sheet. */
export function formatDayLong(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}
