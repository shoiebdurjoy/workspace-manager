import type {
  ActivityEntry,
  AppNotification,
  TaskAttachment,
  TaskComment,
  Workflow,
  WorkspaceMember,
} from '@/types/database';
import { memberName, type MemberLookup } from '@/lib/tasks';
import { statusName } from '@/lib/workflow';
import { hierarchyPaths } from '@/lib/hierarchy';
import type { TbbRole } from '@/types/database';

/**
 * Pure helpers for Phase 10: comments and @mentions, attachments, the activity feed, notifications.
 * No network, no React. The database (RLS, guard triggers, storage policies) is the real authority on
 * every rule below; these only give people a readable message before the round trip and turn stored
 * rows into sentences.
 */

// ---------------------------------------------------------------------------------------
// Comments and mentions
// ---------------------------------------------------------------------------------------

export const COMMENT_MAX_LENGTH = 10000;

export function validateComment(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Write a comment first.';
  if (trimmed.length > COMMENT_MAX_LENGTH) return `A comment can be at most ${COMMENT_MAX_LENGTH.toLocaleString()} characters.`;
  return null;
}

/**
 * A mention is written into the text as @[Name](user-id). The database reads the same token and keeps
 * only the people it can verify, so the text can say anything but a mention can never reach outside the
 * workspace. (No id is ever shown: the interface renders the token as "@Name".)
 */
const UUID_TEXT = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const MENTION_SOURCE = `@\\[([^\\]\\n]{1,100})\\]\\((${UUID_TEXT})\\)`;

export function mentionToken(name: string, userId: string): string {
  // a name cannot contain the characters that would end the token early
  const safe = name.replace(/[[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'member';
  return `@[${safe}](${userId})`;
}

export type CommentSegment = { type: 'text'; text: string } | { type: 'mention'; name: string; userId: string };

/** The comment as a list of plain text and mentions, in order. */
export function parseComment(body: string): CommentSegment[] {
  const out: CommentSegment[] = [];
  const pattern = new RegExp(MENTION_SOURCE, 'g');
  let last = 0;
  for (let m = pattern.exec(body); m; m = pattern.exec(body)) {
    if (m.index > last) out.push({ type: 'text', text: body.slice(last, m.index) });
    out.push({ type: 'mention', name: m[1], userId: m[2].toLowerCase() });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ type: 'text', text: body.slice(last) });
  return out;
}

/** The comment with mention tokens turned back into "@Name" (previews, notifications). */
export function commentPlainText(body: string): string {
  return parseComment(body)
    .map((s) => (s.type === 'mention' ? `@${s.name}` : s.text))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Who is in the text, by id (what the database will verify and notify). */
export function mentionedIds(body: string): string[] {
  return [...new Set(parseComment(body).flatMap((s) => (s.type === 'mention' ? [s.userId] : [])))];
}

export interface MentionQuery {
  /** Index of the "@" in the text. */
  start: number;
  /** What was typed after it. */
  query: string;
}

/**
 * Is the caret inside an "@name" being typed? The "@" must start the text or follow whitespace (so an
 * email address never opens the picker), and the query is short and contains no brackets or new line.
 */
export function activeMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 30 || /[[\]\n]/.test(query)) return null;
  return { start: at, query };
}

/** Replaces the "@query" with a finished mention token and a trailing space; returns the new text and caret. */
export function insertMention(text: string, caret: number, mention: MentionQuery, name: string, userId: string): { text: string; caret: number } {
  const token = `${mentionToken(name, userId)} `;
  return { text: text.slice(0, mention.start) + token + text.slice(caret), caret: mention.start + token.length };
}

/** Staff the picker may offer: active people with a name, matching what was typed, the author last. */
export function mentionCandidates(members: readonly WorkspaceMember[], query: string, selfId: string | null | undefined, limit = 6): WorkspaceMember[] {
  const q = query.trim().toLowerCase();
  return members
    .filter((m) => m.role !== 'CLIENT_VIEWER' && m.profile && m.profile.isActive !== false)
    .filter((m) => !q || (m.profile?.fullName ?? '').toLowerCase().includes(q))
    .sort((a, b) => {
      const an = (a.profile?.fullName ?? '').toLowerCase();
      const bn = (b.profile?.fullName ?? '').toLowerCase();
      // names that START with the query first, yourself last
      const as = q && an.startsWith(q) ? 0 : 1;
      const bs = q && bn.startsWith(q) ? 0 : 1;
      if (as !== bs) return as - bs;
      if ((a.userId === selfId) !== (b.userId === selfId)) return a.userId === selfId ? 1 : -1;
      return an.localeCompare(bn);
    })
    .slice(0, limit);
}

/** Oldest first (a conversation reads top to bottom); a post that is not saved yet stays at the end. */
export function sortComments<T extends Pick<TaskComment, 'createdAt' | 'id'>>(comments: readonly T[]): T[] {
  return [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------------------
// What the interface offers (the database decides; these mirror its policies row for row)
// ---------------------------------------------------------------------------------------

const ADMIN_ROLES: readonly TbbRole[] = ['OWNER', 'ADMIN'];
const MANAGER_ROLES: readonly TbbRole[] = ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'];

/** Only the author edits a comment. */
export function canEditComment(comment: Pick<TaskComment, 'authorId'>, userId: string | null | undefined): boolean {
  return !!userId && comment.authorId === userId;
}

/** The author, or an Owner / Admin (moderation). */
export function canDeleteComment(comment: Pick<TaskComment, 'authorId'>, userId: string | null | undefined, role: TbbRole | null | undefined): boolean {
  return canEditComment(comment, userId) || (!!role && ADMIN_ROLES.includes(role));
}

/** Managers and QC on any task; an editor on the tasks assigned to them. */
export function canAttachFiles(role: TbbRole | null | undefined, isAssignedEditor: boolean): boolean {
  if (!role) return false;
  if (MANAGER_ROLES.includes(role) || role === 'QC_SPECIALIST') return true;
  return role === 'EDITOR' && isAssignedEditor;
}

/** Whoever uploaded it, and any manager. */
export function canDeleteAttachment(attachment: Pick<TaskAttachment, 'uploadedBy'>, userId: string | null | undefined, role: TbbRole | null | undefined): boolean {
  return (!!userId && attachment.uploadedBy === userId) || (!!role && MANAGER_ROLES.includes(role));
}

// ---------------------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------------------

export const ATTACHMENT_BUCKET = 'task-attachments';
export const ATTACHMENT_MAX_BYTES = 26214400; // 25 MB (the bucket enforces the same)
export const ATTACHMENT_NAME_MAX = 180;

/** What may be attached. Mirrors the bucket's allowed_mime_types and the table's CHECK (migration 13). */
export const ATTACHMENT_TYPES: ReadonlyArray<{ mime: string; label: string; extensions: readonly string[] }> = [
  { mime: 'image/png', label: 'Image', extensions: ['png'] },
  { mime: 'image/jpeg', label: 'Image', extensions: ['jpg', 'jpeg'] },
  { mime: 'image/webp', label: 'Image', extensions: ['webp'] },
  { mime: 'image/gif', label: 'Image', extensions: ['gif'] },
  { mime: 'application/pdf', label: 'PDF', extensions: ['pdf'] },
  { mime: 'text/plain', label: 'Text', extensions: ['txt'] },
  { mime: 'text/csv', label: 'Spreadsheet', extensions: ['csv'] },
  { mime: 'text/markdown', label: 'Text', extensions: ['md'] },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Document', extensions: ['docx'] },
  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Spreadsheet', extensions: ['xlsx'] },
  { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'Presentation', extensions: ['pptx'] },
  { mime: 'audio/mpeg', label: 'Audio', extensions: ['mp3'] },
  { mime: 'audio/wav', label: 'Audio', extensions: ['wav'] },
  { mime: 'audio/x-wav', label: 'Audio', extensions: [] },
  { mime: 'audio/aac', label: 'Audio', extensions: ['aac'] },
  { mime: 'audio/mp4', label: 'Audio', extensions: ['m4a'] },
  { mime: 'audio/ogg', label: 'Audio', extensions: ['ogg'] },
  { mime: 'audio/flac', label: 'Audio', extensions: ['flac'] },
  { mime: 'application/zip', label: 'Archive', extensions: ['zip'] },
];

/** For the file picker's `accept` attribute. */
export const ATTACHMENT_ACCEPT = ATTACHMENT_TYPES.flatMap((t) => t.extensions.map((e) => `.${e}`)).join(',');

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * The type to upload a file as: its own type when allowed, else by extension (browsers often give an
 * empty type for .md or .csv). null = not an allowed kind of file.
 */
export function attachmentMimeType(file: { name: string; type: string }): string | null {
  const own = file.type.toLowerCase();
  if (ATTACHMENT_TYPES.some((t) => t.mime === own)) return own;
  const ext = extensionOf(file.name);
  if (!ext) return null;
  // a file whose type is a different known type (a .png that says it is a PDF) is not trusted by its extension
  if (own && own !== 'application/octet-stream') return null;
  return ATTACHMENT_TYPES.find((t) => t.extensions.includes(ext))?.mime ?? null;
}

export function attachmentKind(mime: string): string {
  return ATTACHMENT_TYPES.find((t) => t.mime === mime)?.label ?? 'File';
}

export function isImageType(mime: string): boolean {
  return mime.startsWith('image/');
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function validateAttachmentFile(file: { name: string; size: number; type: string }): string | null {
  if (!file.name.trim()) return 'The file has no name.';
  if (file.size <= 0) return `${file.name} is empty.`;
  if (file.size > ATTACHMENT_MAX_BYTES) return `${file.name} is ${formatBytes(file.size)}. Files can be at most ${formatBytes(ATTACHMENT_MAX_BYTES)}; put large videos in Drive or Frame.io and add the link.`;
  if (!attachmentMimeType(file)) return `${file.name}: this kind of file cannot be attached. Images, PDFs, documents, spreadsheets, text, audio and zip files can.`;
  if (file.name.length > ATTACHMENT_NAME_MAX || /[/\\]/.test(file.name) || hasControlCharacter(file.name)) return `${file.name.slice(0, 40)}: the file name is not valid.`;
  return null;
}

/** A storage-safe name: letters, digits, dot, dash, underscore; keeps the extension. The original name is kept for display. */
export function storageFileName(fullName: string): string {
  // only the file's own name: a path in front of it (which the picker never gives, but a caller might) is dropped
  const name = fullName.split(/[\\/]/).pop() ?? '';
  const ext = extensionOf(name);
  const stem = (ext ? name.slice(0, name.length - ext.length - 1) : name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100);
  const safeExt = ext.replace(/[^a-z0-9]/g, '').slice(0, 10);
  return `${stem || 'file'}${safeExt ? `.${safeExt}` : ''}`;
}

/** <workspace>/<task>/<attachment>/<file>: the shape the storage policies read (migration 13). */
export function attachmentPath(workspaceId: string, taskId: string, attachmentId: string, fileName: string): string {
  return `${workspaceId}/${taskId}/${attachmentId}/${storageFileName(fileName)}`.replace(/^[^/]+\/[^/]+\/[^/]+\//, (dirs) => dirs.toLowerCase());
}

export function sortAttachments<T extends Pick<TaskAttachment, 'createdAt' | 'id'>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------------------

export interface ActivityContext {
  members: MemberLookup;
  workflow: Workflow | null | undefined;
  /** list id -> name, for "moved to <list>" */
  listName?: (listId: string) => string | undefined;
}

const FIELD_LABELS: Record<string, string> = {
  title: 'the title',
  priority: 'the priority',
  due_date: 'the internal QC due date',
  client_deadline: 'the client deadline',
  aspect_ratio: 'the aspect ratio',
  list: 'the list',
  description: 'the brief',
  raw_footage_link: 'the raw footage link',
  project_file_link: 'the project file link',
  review_link: 'the review link',
  final_export_link: 'the final export link',
};

const PRIORITY_LABEL: Record<string, string> = { URGENT: 'Urgent', HIGH: 'High', MEDIUM: 'Normal', LOW: 'Low' };

function shortDate(value: unknown): string {
  if (typeof value !== 'string') return 'none';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'none' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function describeChange(change: Record<string, unknown>, ctx: ActivityContext): string {
  const field = String(change.field ?? '');
  const label = FIELD_LABELS[field] ?? `the ${field.replace(/_/g, ' ')}`;
  if (change.changed === true) return `changed ${label}`;
  const show = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return 'none';
    if (field === 'priority') return PRIORITY_LABEL[String(v)] ?? String(v);
    if (field === 'due_date' || field === 'client_deadline') return shortDate(v);
    if (field === 'list') return ctx.listName?.(String(v)) ?? 'another list';
    return String(v);
  };
  if (field === 'list') return `moved the task to ${show(change.to)}`;
  if (field === 'title') return `renamed the task from “${show(change.from)}” to “${show(change.to)}”`;
  return `changed ${label} from ${show(change.from)} to ${show(change.to)}`;
}

const ROLE_WORD: Record<string, string> = { EDITOR: 'editor', QC_REVIEWER: 'QC reviewer' };

export interface ActivityLine {
  id: string;
  createdAt: string;
  actor: string;
  /** What they did, without the actor ("started editing", "added cut.pdf"). */
  text: string;
  kind: string;
  /** A short quote under the sentence (a revision note). */
  detail?: string;
  /** Set for a comment, to jump to it. */
  commentId?: string;
}

export function describeActivity(entry: ActivityEntry, ctx: ActivityContext): ActivityLine {
  const actor = entry.actorId ? memberName(ctx.members, entry.actorId) : 'Someone';
  const base = { id: `${entry.source}:${entry.id}`, createdAt: entry.createdAt, actor };

  if (entry.source === 'status') {
    const e = entry.event;
    const to = statusName(ctx.workflow, e.to);
    if (!e.from) return { ...base, kind: 'status', text: `created the task as ${to}` };
    const from = statusName(ctx.workflow, e.from);
    return {
      ...base,
      kind: 'status',
      text: `moved the task from ${from} to ${to}${e.isOverride ? ' (manager override)' : ''}${e.revisionNumber ? ` · revision ${e.revisionNumber}` : ''}`,
      detail: e.note ?? undefined,
    };
  }

  const data = entry.data;
  switch (entry.kind) {
    case 'created':
      return { ...base, kind: 'created', text: 'created the task' };
    case 'updated': {
      const changes = Array.isArray(data.changes) ? (data.changes as Record<string, unknown>[]) : [];
      const text = changes.length ? changes.map((c) => describeChange(c, ctx)).join('; ') : 'updated the task';
      return { ...base, kind: 'updated', text };
    }
    case 'assigned': {
      const who = memberName(ctx.members, String(data.user_id ?? ''));
      const role = ROLE_WORD[String(data.role_type)] ?? 'assignee';
      return { ...base, kind: 'assigned', text: `assigned ${who} as ${role}` };
    }
    case 'unassigned': {
      const who = memberName(ctx.members, String(data.user_id ?? ''));
      const role = ROLE_WORD[String(data.role_type)] ?? 'assignee';
      return { ...base, kind: 'unassigned', text: `removed ${who} as ${role}` };
    }
    case 'commented':
      return { ...base, kind: 'commented', text: 'commented', commentId: typeof data.comment_id === 'string' ? data.comment_id : undefined };
    case 'attachment_added':
      return { ...base, kind: 'attachment_added', text: `attached ${String(data.file_name ?? 'a file')}` };
    case 'attachment_removed':
      return { ...base, kind: 'attachment_removed', text: `removed ${String(data.file_name ?? 'a file')}` };
    default:
      return { ...base, kind: String(entry.kind), text: 'updated the task' };
  }
}

/** Newest first; ties broken by id so the order never flickers between loads. */
export function mergeActivity(entries: readonly ActivityEntry[], limit?: number): ActivityEntry[] {
  const sorted = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return limit ? sorted.slice(0, limit) : sorted;
}

// ---------------------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------------------

export const NOTIFICATION_PAGE_SIZE = 20;

export interface NotificationLine {
  id: string;
  /** "Quentin mentioned you" */
  headline: string;
  /** The task, or a quote of the comment. */
  detail: string;
  unread: boolean;
  createdAt: string;
  to: string;
}

export const COLLAB_TABS = ['comments', 'files', 'activity'] as const;
export type CollabTab = (typeof COLLAB_TABS)[number];

export function isCollabTab(value: string | null | undefined): value is CollabTab {
  return !!value && (COLLAB_TABS as readonly string[]).includes(value);
}

/**
 * Where a notification leads: the task (resolved to its list by /tasks/:id), on the tab that shows
 * what happened, and for a comment the comment itself. Only ids go into the address, never text.
 */
export function notificationPath(n: Pick<AppNotification, 'taskId' | 'kind' | 'data'>): string {
  const base = hierarchyPaths.taskById(n.taskId);
  const commentId = typeof n.data.comment_id === 'string' ? n.data.comment_id : null;
  if ((n.kind === 'mention' || n.kind === 'comment') && commentId && /^[0-9a-f-]{36}$/i.test(commentId)) {
    return `${base}?tab=comments&comment=${commentId}`;
  }
  return `${base}?tab=activity`;
}

export function describeNotification(n: AppNotification, members: MemberLookup, workflow?: Workflow | null): NotificationLine {
  const actor = n.actorId ? memberName(members, n.actorId) : 'Someone';
  const title = typeof n.data.title === 'string' && n.data.title ? n.data.title : 'a task';
  const snippet = typeof n.data.snippet === 'string' ? n.data.snippet : '';
  let headline: string;
  let detail = title;
  switch (n.kind) {
    case 'mention':
      headline = `${actor} mentioned you`;
      detail = snippet ? `${title} · “${snippet}”` : title;
      break;
    case 'comment':
      headline = `${actor} commented`;
      detail = snippet ? `${title} · “${snippet}”` : title;
      break;
    case 'assigned':
      headline = n.actorId ? `${actor} assigned you as ${ROLE_WORD[String(n.data.role_type)] ?? 'assignee'}` : `You were assigned as ${ROLE_WORD[String(n.data.role_type)] ?? 'assignee'}`;
      break;
    case 'status': {
      const to = typeof n.data.to === 'string' ? statusName(workflow, n.data.to) : 'a new stage';
      headline = `${actor} moved a task to ${to}`;
      break;
    }
    default:
      headline = 'Update';
  }
  return { id: n.id, headline, detail, unread: n.readAt === null, createdAt: n.createdAt, to: notificationPath(n) };
}

/** "just now", "5 min ago", "3 h ago", "yesterday", or the date. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
